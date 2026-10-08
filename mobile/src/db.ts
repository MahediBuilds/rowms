/**
 * Local offline store (SQLite).
 *
 * Every synced record is kept as JSON in `records`, keyed by (entity, id).
 * Local edits are written immediately and queued in `outbox`; photos are
 * queued in `docs`. Nothing is lost if the phone is offline or the app closes.
 */
import * as SQLite from "expo-sqlite";

export type Entity = "farmer" | "land" | "ownership" | "asset" | "milestone" | "crop";
export const ENTITIES: Entity[] = ["farmer", "land", "ownership", "asset", "milestone", "crop"];

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

export function db() {
  if (!dbPromise) {
    dbPromise = (async () => {
      const d = await SQLite.openDatabaseAsync("rowfield.db");
      await d.execAsync(`
        PRAGMA journal_mode = WAL;
        CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY NOT NULL, value TEXT);
        CREATE TABLE IF NOT EXISTS records (
          entity TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL,
          dirty INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (entity, id)
        );
        CREATE TABLE IF NOT EXISTS outbox (
          seq INTEGER PRIMARY KEY AUTOINCREMENT, op_id TEXT NOT NULL UNIQUE, entity TEXT NOT NULL,
          action TEXT NOT NULL, record_id TEXT NOT NULL, data TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'pending', error TEXT, attempts INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS docs (
          id TEXT PRIMARY KEY NOT NULL, uri TEXT NOT NULL, category TEXT NOT NULL, title TEXT,
          links TEXT NOT NULL, latitude REAL, longitude REAL, accuracy REAL,
          captured_live INTEGER NOT NULL DEFAULT 0, captured_at TEXT,
          status TEXT NOT NULL DEFAULT 'pending', error TEXT, created_at TEXT NOT NULL
        );
      `);
      return d;
    })();
  }
  return dbPromise;
}

// ---------------------------------------------------------------- change notifications

type Listener = () => void;
const listeners = new Set<Listener>();
export function onDbChange(fn: Listener) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
export function notifyChange() {
  listeners.forEach((l) => l());
}

// ---------------------------------------------------------------- key/value

export async function kvGet<T = any>(key: string): Promise<T | null> {
  const row = await (await db()).getFirstAsync<{ value: string }>("SELECT value FROM kv WHERE key = ?", key);
  return row ? (JSON.parse(row.value) as T) : null;
}

export async function kvSet(key: string, value: any) {
  await (await db()).runAsync("INSERT OR REPLACE INTO kv (key, value) VALUES (?, ?)", key, JSON.stringify(value));
}

// ---------------------------------------------------------------- records

export async function all<T = any>(entity: Entity): Promise<T[]> {
  const rows = await (await db()).getAllAsync<{ data: string; dirty: number }>("SELECT data, dirty FROM records WHERE entity = ?", entity);
  return rows.map((r) => ({ ...JSON.parse(r.data), _dirty: !!r.dirty }));
}

export async function get<T = any>(entity: Entity, id: string): Promise<T | null> {
  const r = await (await db()).getFirstAsync<{ data: string; dirty: number }>("SELECT data, dirty FROM records WHERE entity = ? AND id = ?", entity, id);
  return r ? { ...JSON.parse(r.data), _dirty: !!r.dirty } : null;
}

export async function put(entity: Entity, rec: any, dirty?: boolean) {
  const { _dirty, ...data } = rec;
  const d = await db();
  if (dirty === undefined) {
    await d.runAsync(
      "INSERT INTO records (entity, id, data, dirty) VALUES (?, ?, ?, 0) ON CONFLICT(entity, id) DO UPDATE SET data = excluded.data",
      entity,
      data.id,
      JSON.stringify(data),
    );
  } else {
    await d.runAsync("INSERT OR REPLACE INTO records (entity, id, data, dirty) VALUES (?, ?, ?, ?)", entity, data.id, JSON.stringify(data), dirty ? 1 : 0);
  }
}

export async function remove(entity: Entity, id: string) {
  await (await db()).runAsync("DELETE FROM records WHERE entity = ? AND id = ?", entity, id);
}

export async function isDirty(entity: Entity, id: string) {
  const r = await (await db()).getFirstAsync<{ dirty: number }>("SELECT dirty FROM records WHERE entity = ? AND id = ?", entity, id);
  return !!r?.dirty;
}

export async function clearAll() {
  const d = await db();
  await d.execAsync("DELETE FROM records; DELETE FROM outbox; DELETE FROM docs; DELETE FROM kv;");
}
