import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, getToken, setToken, setUnauthorizedHandler } from "./api";
import type { Me, Meta, Project, Paged } from "./types";

// ---------------------------------------------------------------- auth

type AuthCtx = {
  me: Me | null;
  loading: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => void;
  can: (resource: string, action?: string) => boolean;
};

const AuthContext = createContext<AuthCtx>(null as any);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(!!getToken());
  const qc = useQueryClient();

  const logout = useCallback(() => {
    if (getToken()) api("auth/logout/", { method: "POST" }).catch(() => {});
    setToken(null);
    setMe(null);
    qc.clear();
  }, [qc]);

  useEffect(() => {
    setUnauthorizedHandler(() => {
      setToken(null);
      setMe(null);
    });
    if (getToken()) {
      api<Me>("auth/me/")
        .then(setMe)
        .catch(() => setToken(null))
        .finally(() => setLoading(false));
    }
  }, []);

  const login = useCallback(async (username: string, password: string) => {
    const res = await api<{ token: string; user: Me }>("auth/login/", { body: { username, password, client: "WEB" } });
    setToken(res.token);
    setMe(res.user);
  }, []);

  const can = useCallback(
    (resource: string, action = "read") => {
      const p = me?.permissions?.[resource] as any;
      return !!p?.[action];
    },
    [me],
  );

  return <AuthContext.Provider value={{ me, loading, login, logout, can }}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);

// ---------------------------------------------------------------- choice lists

export function useMeta() {
  const { data } = useQuery({ queryKey: ["meta"], queryFn: () => api<Meta>("meta/"), staleTime: 10 * 60_000 });
  return data;
}

export function useLabel() {
  const meta = useMeta();
  return useCallback(
    (list: keyof Meta, value: string | null | undefined) => {
      if (!value) return "";
      const arr = (meta?.[list] as any[]) || [];
      return arr.find((c) => c.value === value)?.label ?? value;
    },
    [meta],
  );
}

// ---------------------------------------------------------------- current project filter

type ProjectCtx = {
  projectId: string;
  setProjectId: (id: string) => void;
  projects: Project[];
  current: Project | undefined;
};

const ProjectContext = createContext<ProjectCtx>(null as any);
const PROJECT_KEY = "rowms.project";

export function ProjectProvider({ children }: { children: ReactNode }) {
  const { me } = useAuth();
  const [projectId, setPid] = useState<string>(() => {
    try {
      return localStorage.getItem(PROJECT_KEY) || "";
    } catch {
      return "";
    }
  });
  const { data } = useQuery({
    queryKey: ["projects", "all"],
    queryFn: () => api<Paged<Project>>("projects/?page_size=500"),
    enabled: !!me,
  });
  const projects = data?.results || [];
  const setProjectId = (id: string) => {
    setPid(id);
    try {
      localStorage.setItem(PROJECT_KEY, id);
    } catch {
      /* ignore */
    }
  };
  // Drop a remembered project the user can no longer see
  useEffect(() => {
    if (data && projectId && !projects.some((p) => p.id === projectId)) setProjectId("");
  }, [data]); // eslint-disable-line react-hooks/exhaustive-deps
  const current = useMemo(() => projects.find((p) => p.id === projectId), [projects, projectId]);
  return <ProjectContext.Provider value={{ projectId, setProjectId, projects, current }}>{children}</ProjectContext.Provider>;
}

export const useProject = () => useContext(ProjectContext);

// ---------------------------------------------------------------- toasts

type Toast = { id: number; text: string; kind: "ok" | "error" };
const ToastContext = createContext<(text: string, kind?: "ok" | "error") => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((text: string, kind: "ok" | "error" = "ok") => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, text, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === "error" ? 7000 : 3500);
  }, []);
  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast-${t.kind}`}>
            {t.text}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);
