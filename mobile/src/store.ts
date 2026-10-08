/** Local data operations used by the screens. Every change is saved on the phone
 *  first and queued for upload; the sync engine sends it when there is signal. */
import * as Crypto from "expo-crypto";
import * as FileSystem from "expo-file-system/legacy";
import { manipulateAsync, SaveFormat } from "expo-image-manipulator";
import { all, db, Entity, get, kvGet, notifyChange, put, remove } from "./db";

export const uuid = () => Crypto.randomUUID();
const nowIso = () => new Date().toISOString();
export const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

// ---------------------------------------------------------------- types

export type Project = { id: string; code: string; name: string; project_type: string; voltage_level: string; district: string; taluk: string; status: string };
export type Stage = { code: string; name: string; order: number; scope: "ASSET" | "FARMER"; asset_types: string[] };
export type Farmer = {
  id: string; farmer_code: string | null; name: string; relation_type: string; relation_name: string; mobile: string; alt_mobile: string;
  address: string; village: string; hobli: string; taluk: string; district: string; state: string; status: string;
  aadhaar_last4: string; kyc_status: string; kyc_collected_on: string | null; remarks: string; project_ids: string[]; _dirty?: boolean;
};
export type Land = {
  id: string; survey_number: string; hissa: string; village: string; hobli: string; taluk: string; district: string; state: string;
  extent_acres: number | string; extent_guntas: number | string; ownership_type: string; land_type: string; rtc_reference: string;
  latitude: number | null; longitude: number | null; gps_accuracy_m: number | null; gps_captured_at: string | null; remarks: string;
  project_ids: string[]; _dirty?: boolean;
};
export type Ownership = { id: string; land_id: string; farmer_id: string; is_primary_payee: boolean; _dirty?: boolean };
export type Asset = {
  id: string; project_id: string; asset_type: string; asset_number: string; line_name: string; land_parcel_id: string | null;
  latitude: number | null; longitude: number | null; gps_accuracy_m: number | null; gps_captured_at: string | null; remarks: string; _dirty?: boolean;
};
export type Milestone = {
  id: string; asset_id: string; stage_code: string; completed: boolean; completed_on: string | null; source?: string; remarks: string;
  latitude: number | null; longitude: number | null; gps_accuracy_m: number | null; _dirty?: boolean;
};
export type Crop = {
  id: string; project_id: string; farmer_id: string; land_parcel_id: string | null; asset_id: string | null; season: string; crop_type: string;
  crop_area_acres: number | string | null; crop_stage: string; assessment_date: string | null; field_inspection_notes: string;
  revenue_assessment: number | string | null; company_assessment: number | string | null; latitude: number | null; longitude: number | null;
  gps_accuracy_m: number | null; gps_captured_at: string | null; _dirty?: boolean;
};
export type Gps = { latitude: number; longitude: number; accuracy: number | null; at: string };

// ---------------------------------------------------------------- outbox

let syncHook: () => void = () => {};
export function setAfterSaveHook(fn: () => void) {
  syncHook = fn;
}

async function enqueue(entity: Entity, action: "create" | "update" | "delete", recordId: string, data: any) {
  const d = await db();
  if (action !== "delete") {
    // Fold the change into a create/update for the same record that is still waiting (or was
    // refused), so a correction fixes the queued record instead of queueing a broken partial edit.
    const waiting = await d.getFirstAsync<{ seq: number; action: string; data: string }>(
      `SELECT seq, action, data FROM outbox WHERE entity = ? AND record_id = ? AND status IN ('pending','failed')
       AND action IN ('create','update') ORDER BY seq DESC LIMIT 1`,
      entity, recordId,
    );
    const laterDelete = waiting
      ? await d.getFirstAsync("SELECT 1 FROM outbox WHERE entity = ? AND record_id = ? AND action = 'delete' AND seq > ?", entity, recordId, waiting.seq)
      : null;
    if (waiting && !laterDelete) {
      const mergedData = { ...JSON.parse(waiting.data), ...data };
      // new op_id: the earlier one may already have reached the server with its reply lost
      await d.runAsync("UPDATE outbox SET op_id = ?, data = ?, status = 'pending', error = NULL WHERE seq = ?", uuid(), JSON.stringify(mergedData), waiting.seq);
      return;
    }
  }
  await d.runAsync(
    "INSERT INTO outbox (op_id, entity, action, record_id, data, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    uuid(), entity, action, recordId, JSON.stringify(data), nowIso(),
  );
}

const SERVER_ONLY = new Set(["farmer_code", "updated_at", "is_deleted", "source", "kyc_collected_on"]);

function same(a: any, b: any) {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

/** Fields the server uses to match records created on two phones (same pole + stage, same land + farmer). */
function naturalKeys(entity: Entity, r: any) {
  if (entity === "milestone") return { asset_id: r.asset_id, stage_code: r.stage_code };
  if (entity === "ownership") return { land_id: r.land_id, farmer_id: r.farmer_id };
  return {};
}

/**
 * Create or update a record locally and queue the change for upload.
 * For updates only the fields the user changed are sent, compared with `base` - the record
 * as it was when the form was opened - so office edits that arrived meanwhile are not overwritten.
 */
export async function saveRecord<T extends { id?: string }>(entity: Entity, rec: T, base?: any): Promise<T & { id: string }> {
  const prev: any = rec.id ? await get(entity, rec.id) : null;
  const id = rec.id || uuid();
  if (!prev) {
    const full: any = { ...rec, id };
    const payload = Object.fromEntries(Object.entries(full).filter(([k]) => !k.startsWith("_") && !SERVER_ONLY.has(k)));
    await put(entity, full, true);
    await enqueue(entity, "create", id, payload);
    notifyChange();
    syncHook();
    return full;
  }
  const ref = base ?? prev;
  const changed: any = {};
  for (const [k, v] of Object.entries(rec)) {
    if (k.startsWith("_") || SERVER_ONLY.has(k) || k === "id") continue;
    if (!same(ref[k], v)) changed[k] = v;
  }
  if (!Object.keys(changed).length) return prev;
  const merged: any = { ...prev, ...changed, id };
  await put(entity, merged, true);
  await enqueue(entity, "update", id, { id, ...changed, ...naturalKeys(entity, merged) });
  notifyChange();
  syncHook();
  return merged;
}

export async function deleteRecord(entity: Entity, id: string) {
  await remove(entity, id);
  await enqueue(entity, "delete", id, { id });
  notifyChange();
  syncHook();
}

/** Real calendar date in YYYY-MM-DD form. */
export function isValidDate(v: string | null | undefined) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v || "");
  if (!m) return false;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return d.getFullYear() === Number(m[1]) && d.getMonth() === Number(m[2]) - 1 && d.getDate() === Number(m[3]);
}

export const PHONE_RE = /^[0-9+\- ]{6,15}$/;

// ---------------------------------------------------------------- domain helpers

export async function setStage(asset: Asset, stageCode: string, completed: boolean, completedOn: string | null, remarks: string, gps?: Gps | null) {
  const existing = (await all<Milestone>("milestone")).find((m) => m.asset_id === asset.id && m.stage_code === stageCode);
  const rec: Partial<Milestone> = {
    id: existing?.id,
    asset_id: asset.id,
    stage_code: stageCode,
    completed,
    completed_on: completed ? completedOn || todayIso() : null,
    remarks,
  };
  if (gps) Object.assign(rec, { latitude: round7(gps.latitude), longitude: round7(gps.longitude), gps_accuracy_m: gps.accuracy !== null ? round2(gps.accuracy) : null });
  return saveRecord<any>("milestone", rec);
}

export async function linkOwner(landId: string, farmerId: string, primary: boolean) {
  const owners = (await all<Ownership>("ownership")).filter((o) => o.land_id === landId);
  const existing = owners.find((o) => o.farmer_id === farmerId);
  if (primary) {
    // mirror the server rule locally: only one primary payee per land
    for (const o of owners) if (o.is_primary_payee && o.farmer_id !== farmerId) await put("ownership", { ...o, is_primary_payee: false });
  }
  return saveRecord<any>("ownership", { id: existing?.id, land_id: landId, farmer_id: farmerId, is_primary_payee: primary });
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** 2026-07-27 -> 27 Jul 2026 */
export function fmtDate(iso: string | null | undefined) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || "");
  return m ? `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}` : iso || "";
}

export const round7 = (n: number) => Math.round(n * 1e7) / 1e7;
export const round2 = (n: number) => Math.round(n * 100) / 100;

// ---------------------------------------------------------------- photos & documents

export type LocalDoc = {
  id: string; uri: string; category: string; title: string | null; links: Record<string, string>; latitude: number | null;
  longitude: number | null; accuracy: number | null; captured_live: number; captured_at: string | null; status: string; error: string | null;
};

const PHOTO_DIR = (FileSystem.documentDirectory || "") + "photos/";

/** Shrink and copy a picked/captured image into app storage, then queue it for upload. */
export async function addPhoto(opts: { sourceUri: string; category: string; title?: string; links: Record<string, string>; gps?: Gps | null; capturedLive: boolean }) {
  await FileSystem.makeDirectoryAsync(PHOTO_DIR, { intermediates: true }).catch(() => {});
  const id = uuid();
  let uri = opts.sourceUri;
  try {
    const small = await manipulateAsync(opts.sourceUri, [{ resize: { width: 1600 } }], { compress: 0.72, format: SaveFormat.JPEG });
    uri = small.uri;
  } catch {
    /* keep original if resizing fails (e.g. PDF) */
  }
  const dest = `${PHOTO_DIR}${id}.jpg`;
  await FileSystem.copyAsync({ from: uri, to: dest });
  await (await db()).runAsync(
    `INSERT INTO docs (id, uri, category, title, links, latitude, longitude, accuracy, captured_live, captured_at, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`,
    id, dest, opts.category, opts.title || null, JSON.stringify(opts.links), opts.gps?.latitude ?? null, opts.gps?.longitude ?? null,
    opts.gps?.accuracy ?? null, opts.capturedLive ? 1 : 0, opts.gps?.at || nowIso(), nowIso(),
  );
  notifyChange();
  syncHook();
  return id;
}

export async function docsFor(field: string, id: string): Promise<LocalDoc[]> {
  const rows = await (await db()).getAllAsync<any>("SELECT * FROM docs ORDER BY created_at DESC");
  return rows.map((r) => ({ ...r, links: JSON.parse(r.links) })).filter((d: LocalDoc) => d.links[field] === id);
}

export async function deleteLocalDoc(doc: LocalDoc) {
  if (doc.status === "uploaded") return;
  await (await db()).runAsync("DELETE FROM docs WHERE id = ?", doc.id);
  await FileSystem.deleteAsync(doc.uri, { idempotent: true }).catch(() => {});
  notifyChange();
}

// ---------------------------------------------------------------- read models

export async function settings() {
  return (await kvGet<Record<string, any>>("settings")) || { GPS_ACCURACY_WARNING_METERS: 15 };
}

export async function stages(): Promise<Stage[]> {
  return ((await kvGet<Stage[]>("stages")) || []).sort((a, b) => a.order - b.order);
}

export type StageState = { code: string; name: string; scope: string; completed: boolean; partial: boolean; detail: string; completed_on: string | null; milestone?: Milestone };

export function progressFor(asset: Asset, stageList: Stage[], milestones: Milestone[], owners: Farmer[]): StageState[] {
  const mine = milestones.filter((m) => m.asset_id === asset.id);
  return stageList
    .filter((s) => !s.asset_types?.length || s.asset_types.includes(asset.asset_type))
    .map((s) => {
      if (s.scope === "FARMER") {
        const done = owners.filter((f) => f.kyc_status === "COLLECTED" || f.kyc_status === "VERIFIED").length;
        return {
          code: s.code, name: s.name, scope: s.scope, completed: owners.length > 0 && done === owners.length,
          partial: done > 0 && done < owners.length, detail: owners.length ? `${done} of ${owners.length} farmers` : "No farmer linked", completed_on: null,
        };
      }
      const m = mine.find((x) => x.stage_code === s.code);
      return { code: s.code, name: s.name, scope: s.scope, completed: !!m?.completed, partial: false, detail: m?.remarks || "", completed_on: m?.completed ? m.completed_on : null, milestone: m };
    });
}

/** Everything the lists need in one read. */
export async function snapshot() {
  const [farmers, lands, ownerships, assets, milestones, crops, stageList] = await Promise.all([
    all<Farmer>("farmer"), all<Land>("land"), all<Ownership>("ownership"), all<Asset>("asset"), all<Milestone>("milestone"), all<Crop>("crop"), stages(),
  ]);
  const farmerById = new Map(farmers.map((f) => [f.id, f]));
  const landById = new Map(lands.map((l) => [l.id, l]));
  const ownersOf = (landId: string | null) =>
    landId ? ownerships.filter((o) => o.land_id === landId).map((o) => farmerById.get(o.farmer_id)).filter(Boolean) as Farmer[] : [];
  return { farmers, lands, ownerships, assets, milestones, crops, stageList, farmerById, landById, ownersOf };
}
export type Snapshot = Awaited<ReturnType<typeof snapshot>>;

export function landLabel(l?: Land | null) {
  if (!l) return "";
  return `Sy.No. ${l.hissa ? `${l.survey_number}/${l.hissa}` : l.survey_number}${l.village ? `, ${l.village}` : ""}`;
}
