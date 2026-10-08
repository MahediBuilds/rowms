/**
 * Sync engine: upload queued changes, upload photos, then download what changed.
 * Safe to call any time; concurrent calls share one run. Retries are harmless
 * because every queued change has a unique op_id the server remembers.
 */
import { ApiError, request } from "./api";
import { db, Entity, ENTITIES, kvGet, kvSet, notifyChange, put } from "./db";

export type SyncStatus = {
  syncing: boolean;
  lastSync: string | null;
  lastError: string | null;
  pendingChanges: number;
  failedChanges: number;
  pendingPhotos: number;
  failedPhotos: number;
  /** the server no longer accepts this phone's sign-in; data stays on the phone until the user signs in again */
  authRequired: boolean;
};

let status: SyncStatus = { syncing: false, lastSync: null, lastError: null, pendingChanges: 0, failedChanges: 0, pendingPhotos: 0, failedPhotos: 0, authRequired: false };

export function clearAuthRequired() {
  setStatus({ authRequired: false, lastError: null });
}
const subs = new Set<(s: SyncStatus) => void>();
export function onSyncStatus(fn: (s: SyncStatus) => void) {
  subs.add(fn);
  fn(status);
  return () => {
    subs.delete(fn);
  };
}
function setStatus(patch: Partial<SyncStatus>) {
  status = { ...status, ...patch };
  subs.forEach((f) => f(status));
}

export async function refreshCounts() {
  const d = await db();
  const ops = await d.getAllAsync<{ status: string; n: number }>("SELECT status, COUNT(*) AS n FROM outbox GROUP BY status");
  const docs = await d.getAllAsync<{ status: string; n: number }>("SELECT status, COUNT(*) AS n FROM docs WHERE status != 'uploaded' GROUP BY status");
  const n = (rows: { status: string; n: number }[], st: string) => rows.find((r) => r.status === st)?.n ?? 0;
  setStatus({
    pendingChanges: n(ops, "pending") + n(ops, "failed"),
    failedChanges: n(ops, "failed"),
    pendingPhotos: n(docs, "pending") + n(docs, "failed"),
    failedPhotos: n(docs, "failed"),
    lastSync: (await kvGet<string>("last_sync")) || null,
  });
}

let running: Promise<void> | null = null;
export function syncNow(opts: { full?: boolean } = {}) {
  if (!running) {
    running = run(opts).finally(() => {
      running = null;
    });
  }
  return running;
}

async function run(opts: { full?: boolean }) {
  setStatus({ syncing: true, lastError: null });
  try {
    await pushChanges();
    await uploadPhotos(); // never stops the download below
    await pull(!!opts.full);
    const now = new Date().toISOString();
    await kvSet("last_sync", now);
    setStatus({ lastSync: now });
  } catch (e: any) {
    if (e instanceof ApiError && e.status === 401) {
      setStatus({ authRequired: true, lastError: "Your sign-in has ended. Sign in again; nothing on this phone is lost." });
    } else {
      setStatus({ lastError: e instanceof ApiError ? e.message : String(e?.message || e) });
    }
  } finally {
    await refreshCounts();
    setStatus({ syncing: false });
    notifyChange();
  }
}

// ---------------------------------------------------------------- push

type Op = { seq: number; op_id: string; entity: Entity; action: string; record_id: string; data: string };

async function pushChanges() {
  const d = await db();
  let lastSeq = 0;
  for (;;) {
    const ops = await d.getAllAsync<Op>(
      "SELECT seq, op_id, entity, action, record_id, data FROM outbox WHERE seq > ? AND status IN ('pending','failed') ORDER BY seq LIMIT 100",
      lastSeq,
    );
    if (!ops.length) return;
    lastSeq = ops[ops.length - 1].seq;
    const res = await request<{ results: any[] }>("sync/push/", {
      body: { ops: ops.map((o) => ({ op_id: o.op_id, entity: o.entity, action: o.action, data: JSON.parse(o.data) })) },
      timeoutMs: 60000,
    });
    for (const r of res.results) {
      const op = ops.find((o) => o.op_id === r.op_id);
      if (!op) continue;
      if (r.ok) {
        await d.runAsync("DELETE FROM outbox WHERE op_id = ?", op.op_id);
        let id = op.record_id;
        if (r.id && r.id !== op.record_id) {
          await remapId(op.entity, op.record_id, r.id);
          id = r.id;
        }
        const stillQueued = await d.getFirstAsync<{ n: number }>(
          "SELECT COUNT(*) AS n FROM outbox WHERE entity = ? AND record_id = ? AND status IN ('pending','failed')", op.entity, id,
        );
        if (r.record && !stillQueued?.n) await put(op.entity, r.record, false);
      } else {
        await d.runAsync("UPDATE outbox SET status = 'failed', error = ?, attempts = attempts + 1 WHERE op_id = ?", String(r.error || "Rejected by server"), op.op_id);
      }
    }
  }
}

/** The server matched our record to an existing one (same pole + stage, or same land + farmer). */
async function remapId(entity: Entity, oldId: string, newId: string) {
  const d = await db();
  const exists = await d.getFirstAsync("SELECT 1 FROM records WHERE entity = ? AND id = ?", entity, newId);
  if (exists) await d.runAsync("DELETE FROM records WHERE entity = ? AND id = ?", entity, oldId);
  else await d.runAsync("UPDATE records SET id = ?, data = REPLACE(data, ?, ?) WHERE entity = ? AND id = ?", newId, oldId, newId, entity, oldId);
  await d.runAsync("UPDATE outbox SET record_id = REPLACE(record_id, ?, ?), data = REPLACE(data, ?, ?)", oldId, newId, oldId, newId);
  await d.runAsync("UPDATE docs SET links = REPLACE(links, ?, ?)", oldId, newId);
}

// ---------------------------------------------------------------- photos

const LINK_ENTITY: Record<string, Entity> = { farmer: "farmer", land_parcel: "land", asset: "asset", milestone: "milestone", crop_assessment: "crop" };

async function uploadPhotos() {
  const d = await db();
  const docs = await d.getAllAsync<any>("SELECT * FROM docs WHERE status IN ('pending','failed') ORDER BY created_at");
  for (const doc of docs) {
    const links: Record<string, string> = JSON.parse(doc.links);
    // wait until the records the photo belongs to have reached the server
    let waiting = false;
    for (const [field, id] of Object.entries(links)) {
      const ent = LINK_ENTITY[field];
      if (!ent) continue;
      const q = await d.getFirstAsync<{ n: number }>("SELECT COUNT(*) AS n FROM outbox WHERE entity = ? AND record_id = ?", ent, id);
      if (q?.n) waiting = true;
    }
    if (waiting) continue;
    const form = new FormData();
    form.append("id", doc.id);
    form.append("category", doc.category);
    if (doc.title) form.append("title", doc.title);
    for (const [k, v] of Object.entries(links)) form.append(k, v);
    if (doc.latitude !== null) {
      form.append("latitude", String(Math.round(doc.latitude * 1e7) / 1e7));
      form.append("longitude", String(Math.round(doc.longitude * 1e7) / 1e7));
      if (doc.accuracy !== null) form.append("gps_accuracy_m", String(Math.round(doc.accuracy * 100) / 100));
    }
    form.append("captured_live", doc.captured_live ? "true" : "false");
    if (doc.captured_at) form.append("captured_at", doc.captured_at);
    form.append("file", { uri: doc.uri, name: `${doc.id}.jpg`, type: "image/jpeg" } as any);
    try {
      await request("documents/", { form, timeoutMs: 180000 });
      await d.runAsync("UPDATE docs SET status = 'uploaded', error = NULL WHERE id = ?", doc.id);
    } catch (e: any) {
      if (e instanceof ApiError && e.status === 401) throw e;
      if (e instanceof ApiError && e.kind === "network") return; // connection dropped - try the rest next time
      if (e instanceof ApiError && e.kind === "timeout") {
        // slow link: keep it queued and carry on with the next photo
        await d.runAsync("UPDATE docs SET error = ? WHERE id = ?", "Upload timed out, will retry", doc.id);
        continue;
      }
      await d.runAsync("UPDATE docs SET status = 'failed', error = ? WHERE id = ?", String(e?.message || e), doc.id);
    }
  }
}

// ---------------------------------------------------------------- pull

async function pull(full: boolean) {
  const d = await db();
  const cursor = full ? null : await kvGet<string>("cursor");
  const scope = await kvGet<string>("scope");
  const qs = cursor ? `?since=${encodeURIComponent(cursor)}&scope=${encodeURIComponent(scope || "")}` : "";
  const res = await request<any>(`sync/pull/${qs}`, { timeoutMs: 90000 });
  await kvSet("projects", res.projects);
  await kvSet("stages", res.stages);
  await kvSet("settings", res.settings);
  await kvSet("me", res.me);
  await kvSet("choices", res.choices);
  // Exclusive transaction: a save made on screen while this runs waits instead of joining it.
  await d.withExclusiveTransactionAsync(async (txn) => {
    for (const entity of ENTITIES) {
      const rows: any[] = res[entity] || [];
      const dirtyRows = await txn.getAllAsync<{ id: string }>("SELECT id FROM records WHERE entity = ? AND dirty = 1", entity);
      const dirty = new Set(dirtyRows.map((r) => r.id));
      if (res.full) await txn.runAsync("DELETE FROM records WHERE entity = ? AND dirty = 0", entity);
      for (const row of rows) {
        if (dirty.has(row.id)) continue; // keep the local edit until it is uploaded
        if (row.is_deleted) await txn.runAsync("DELETE FROM records WHERE entity = ? AND id = ?", entity, row.id);
        else
          await txn.runAsync(
            "INSERT INTO records (entity, id, data, dirty) VALUES (?, ?, ?, 0) ON CONFLICT(entity, id) DO UPDATE SET data = excluded.data",
            entity, row.id, JSON.stringify(row),
          );
      }
    }
  });
  // records whose queued changes have all been sent are no longer dirty
  await d.runAsync(
    "UPDATE records SET dirty = 0 WHERE dirty = 1 AND NOT EXISTS (SELECT 1 FROM outbox o WHERE o.entity = records.entity AND o.record_id = records.id)",
  );
  await kvSet("cursor", res.server_time);
  await kvSet("scope", res.scope);
}

// ---------------------------------------------------------------- queue management (Sync screen)

export async function listQueue() {
  const d = await db();
  const ops = await d.getAllAsync<any>("SELECT * FROM outbox ORDER BY seq");
  const docs = await d.getAllAsync<any>("SELECT id, category, title, status, error, created_at, links FROM docs WHERE status != 'uploaded' ORDER BY created_at");
  return { ops, docs };
}

export async function discardOp(opId: string) {
  const d = await db();
  const op = await d.getFirstAsync<Op>("SELECT * FROM outbox WHERE op_id = ?", opId);
  await d.runAsync("DELETE FROM outbox WHERE op_id = ?", opId);
  if (op) {
    const left = await d.getFirstAsync<{ n: number }>("SELECT COUNT(*) AS n FROM outbox WHERE entity = ? AND record_id = ?", op.entity, op.record_id);
    if (op.action === "create" && !left?.n) {
      // the record never reached the server: remove it and its photos from the phone
      await d.runAsync("DELETE FROM records WHERE entity = ? AND id = ?", op.entity, op.record_id);
      const docs = await d.getAllAsync<{ id: string; links: string }>("SELECT id, links FROM docs WHERE status != 'uploaded'");
      for (const doc of docs) if (Object.values(JSON.parse(doc.links)).includes(op.record_id)) await d.runAsync("DELETE FROM docs WHERE id = ?", doc.id);
    } else if (!left?.n) {
      // drop the local edit: the next sync re-downloads the server's version
      await d.runAsync("UPDATE records SET dirty = 0 WHERE entity = ? AND id = ?", op.entity, op.record_id);
      await kvSet("cursor", null);
    }
  }
  await refreshCounts();
  notifyChange();
}

export async function discardDoc(id: string) {
  await (await db()).runAsync("DELETE FROM docs WHERE id = ?", id);
  await refreshCounts();
  notifyChange();
}
