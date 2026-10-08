// Thin fetch wrapper for the Django REST API.

const TOKEN_KEY = "rowms.token";

export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(token: string | null) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* storage unavailable - session only */
  }
}

export class ApiError extends Error {
  status: number;
  data: any;
  constructor(status: number, data: any) {
    super(errorMessage(data) || `Request failed (${status})`);
    this.status = status;
    this.data = data;
  }
  fieldErrors(): Record<string, string> {
    const out: Record<string, string> = {};
    if (this.data && typeof this.data === "object" && !Array.isArray(this.data)) {
      for (const [k, v] of Object.entries(this.data)) {
        out[k] = Array.isArray(v) ? String(v[0]) : typeof v === "string" ? v : JSON.stringify(v);
      }
    }
    return out;
  }
}

function errorMessage(data: any): string {
  if (!data) return "";
  if (typeof data === "string") return data.slice(0, 300);
  if (Array.isArray(data)) return String(data[0]);
  if (data.detail) return String(data.detail);
  if (data.non_field_errors) return String(data.non_field_errors[0]);
  const first = Object.entries(data)[0];
  if (first) {
    const [k, v] = first;
    const msg = Array.isArray(v) ? v[0] : typeof v === "object" ? errorMessage(v) : v;
    return k === "detail" ? String(msg) : `${humanize(k)}: ${msg}`;
  }
  return "";
}

export function humanize(key: string) {
  const s = key.replace(/_ids?$/, "").replace(/_/g, " ");
  return s.charAt(0).toUpperCase() + s.slice(1);
}

let onUnauthorized: () => void = () => {};
export function setUnauthorizedHandler(fn: () => void) {
  onUnauthorized = fn;
}

export function qs(params: Record<string, any> = {}) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === "") continue;
    p.set(k, String(v));
  }
  const s = p.toString();
  return s ? `?${s}` : "";
}

export async function api<T = any>(path: string, opts: { method?: string; body?: any; form?: FormData } = {}): Promise<T> {
  const headers: Record<string, string> = { Accept: "application/json" };
  const token = getToken();
  if (token) headers.Authorization = `Token ${token}`;
  let body: BodyInit | undefined;
  if (opts.form) body = opts.form;
  else if (opts.body !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(opts.body);
  }
  const res = await fetch(`/api/${path.replace(/^\//, "")}`, { method: opts.method || (body ? "POST" : "GET"), headers, body });
  if (res.status === 401) {
    onUnauthorized();
  }
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  let data: any = text;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    /* non-JSON */
  }
  if (!res.ok) throw new ApiError(res.status, data);
  return data as T;
}

/** Download a file from an authenticated endpoint (reports, KML). */
export async function downloadFile(path: string, fallbackName: string) {
  const token = getToken();
  const res = await fetch(`/api/${path.replace(/^\//, "")}`, { headers: token ? { Authorization: `Token ${token}` } : {} });
  if (!res.ok) {
    let data: any = null;
    try {
      data = await res.json();
    } catch {
      /* ignore */
    }
    throw new ApiError(res.status, data);
  }
  const blob = await res.blob();
  const cd = res.headers.get("Content-Disposition") || "";
  const m = /filename="?([^";]+)"?/.exec(cd);
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = m ? m[1] : fallbackName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

export type Paged<T> = { count: number; next: string | null; previous: string | null; results: T[] };
