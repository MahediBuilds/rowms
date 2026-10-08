import { Platform } from "react-native";
import * as NativeSecureStore from "expo-secure-store";

// SecureStore (Android keystore) on the phone; browser storage only for the web preview.
const SecureStore =
  Platform.OS === "web"
    ? {
        getItemAsync: async (k: string) => globalThis.localStorage?.getItem(k) ?? null,
        setItemAsync: async (k: string, v: string) => globalThis.localStorage?.setItem(k, v),
        deleteItemAsync: async (k: string) => globalThis.localStorage?.removeItem(k),
      }
    : NativeSecureStore;

const SERVER_KEY = "rowfield.server";
const TOKEN_KEY = "rowfield.token";

let server = "";
let token = "";

export async function loadCredentials() {
  server = (await SecureStore.getItemAsync(SERVER_KEY)) || "";
  token = (await SecureStore.getItemAsync(TOKEN_KEY)) || "";
  return { server, token };
}

export function normaliseServer(input: string) {
  let s = input.trim().replace(/\/+$/, "");
  if (s && !/^https?:\/\//i.test(s)) s = "http://" + s;
  return s.replace(/\/api$/, "");
}

export async function saveCredentials(srv: string, tok: string) {
  server = srv;
  token = tok;
  await SecureStore.setItemAsync(SERVER_KEY, srv);
  if (tok) await SecureStore.setItemAsync(TOKEN_KEY, tok);
  else await SecureStore.deleteItemAsync(TOKEN_KEY);
}

export function getServer() {
  return server;
}

export class ApiError extends Error {
  status: number;
  data: any;
  /** "http" = the server answered with an error, "timeout" = no answer in time, "network" = could not connect */
  kind: "http" | "timeout" | "network";
  constructor(status: number, data: any, message?: string, kind: "http" | "timeout" | "network" = "http") {
    super(message || messageFrom(data) || `Server error (${status})`);
    this.status = status;
    this.data = data;
    this.kind = kind;
  }
}

function messageFrom(data: any): string {
  if (!data) return "";
  if (typeof data === "string") return data.slice(0, 200);
  if (data.detail) return String(data.detail);
  const first = Object.entries(data)[0];
  if (first) return `${first[0]}: ${Array.isArray(first[1]) ? first[1][0] : JSON.stringify(first[1])}`;
  return "";
}

export async function request<T = any>(path: string, opts: { method?: string; body?: any; form?: FormData; timeoutMs?: number; auth?: boolean } = {}): Promise<T> {
  if (!server) throw new ApiError(0, null, "Server address is not set");
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 30000);
  const headers: Record<string, string> = { Accept: "application/json" };
  if (opts.auth !== false && token) headers.Authorization = `Token ${token}`;
  let body: any;
  if (opts.form) body = opts.form;
  else if (opts.body !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(opts.body);
  }
  try {
    const res = await fetch(`${server}/api/${path.replace(/^\//, "")}`, {
      method: opts.method || (body ? "POST" : "GET"),
      headers,
      body,
      signal: ctrl.signal,
    });
    const text = await res.text();
    let data: any = text;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      /* not json */
    }
    if (!res.ok) throw new ApiError(res.status, data);
    return data as T;
  } catch (e: any) {
    if (e instanceof ApiError) throw e;
    if (e?.name === "AbortError") throw new ApiError(0, null, "The server did not respond in time", "timeout");
    throw new ApiError(0, null, "Cannot reach the server. Check the internet connection and server address.", "network");
  } finally {
    clearTimeout(timer);
  }
}
