import { useEffect, useState } from "react";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError, qs } from "./api";
import { useProject, useToast } from "./state";
import type { Paged } from "./types";

export const PAGE_SIZE = 50;

/** Paged list bound to the global project filter. */
export function useList<T>(endpoint: string, params: Record<string, any>, opts: { projectParam?: string | false; pageSize?: number } = {}) {
  const { projectId } = useProject();
  const [page, setPage] = useState(1);
  const pageSize = opts.pageSize ?? PAGE_SIZE;
  const projectParam = opts.projectParam === undefined ? "project" : opts.projectParam;
  const all = { ...params, ...(projectParam && projectId ? { [projectParam]: projectId } : {}) };
  const key = JSON.stringify(all);
  useEffect(() => setPage(1), [key]);
  const query = useQuery({
    queryKey: [endpoint, "list", all, page, pageSize],
    queryFn: () => api<Paged<T>>(`${endpoint}/${qs({ ...all, page, page_size: pageSize })}`),
    placeholderData: keepPreviousData,
  });
  return { ...query, page, setPage, pageSize, rows: query.data?.results || [], count: query.data?.count || 0 };
}

export function useDebounced<T>(value: T, ms = 250) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

/** Save helper: create (POST) or update (PATCH), refresh lists, toast. */
export function useSaver() {
  const qc = useQueryClient();
  const toast = useToast();
  return async (endpoint: string, id: string | number | null | undefined, body: any, message = "Saved", invalidate: string[] = []) => {
    const res = await api(id ? `${endpoint}/${id}/` : `${endpoint}/`, { method: id ? "PATCH" : "POST", body });
    toast(message);
    for (const k of [endpoint, ...invalidate, "dashboard", "farmer-history"]) qc.invalidateQueries({ queryKey: [k] });
    return res;
  };
}

export function useDeleter() {
  const qc = useQueryClient();
  const toast = useToast();
  return async (endpoint: string, id: string | number, what: string, invalidate: string[] = []) => {
    if (!window.confirm(`Delete this ${what}? This cannot be undone from the web screen.`)) return false;
    try {
      await api(`${endpoint}/${id}/`, { method: "DELETE" });
      toast(`${what.charAt(0).toUpperCase() + what.slice(1)} deleted`);
      for (const k of [endpoint, ...invalidate, "dashboard", "farmer-history"]) qc.invalidateQueries({ queryKey: [k] });
      return true;
    } catch (e) {
      toast(e instanceof ApiError ? e.message : String(e), "error");
      return false;
    }
  };
}
