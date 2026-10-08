import { createContext, ReactNode, useCallback, useContext, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import NetInfo from "@react-native-community/netinfo";
import { ApiError, loadCredentials, normaliseServer, request, saveCredentials } from "./api";
import { clearAll, kvGet, kvSet, onDbChange } from "./db";
import { Project, setAfterSaveHook, Stage } from "./store";
import { clearAuthRequired, onSyncStatus, refreshCounts, syncNow, SyncStatus } from "./sync";

export type Me = {
  id: number;
  username: string;
  display_name: string;
  role: string;
  role_label: string;
  permissions: Record<string, any> & { stages: Record<string, boolean> };
};

type Ctx = {
  ready: boolean;
  me: Me | null;
  projects: Project[];
  projectId: string | null;
  project: Project | null;
  stages: Stage[];
  gpsLimit: number;
  online: boolean;
  sync: SyncStatus;
  login: (server: string, username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  setProjectId: (id: string) => void;
  syncNow: (full?: boolean) => Promise<void>;
  canEditStage: (code: string) => boolean;
  can: (resource: string, action?: string) => boolean;
};

const SessionContext = createContext<Ctx>(null as any);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [me, setMe] = useState<Me | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [stages, setStages] = useState<Stage[]>([]);
  const [gpsLimit, setGpsLimit] = useState(15);
  const [projectId, setPid] = useState<string | null>(null);
  const [online, setOnline] = useState(true);
  const [sync, setSync] = useState<SyncStatus>({ syncing: false, lastSync: null, lastError: null, pendingChanges: 0, failedChanges: 0, pendingPhotos: 0, failedPhotos: 0, authRequired: false });
  const onlineRef = useRef(true);
  const meRef = useRef<Me | null>(null);
  meRef.current = me;

  const loadCached = useCallback(async () => {
    const [cachedMe, cachedProjects, cachedStages, cachedSettings, pid] = await Promise.all([
      kvGet<Me>("me"), kvGet<Project[]>("projects"), kvGet<Stage[]>("stages"), kvGet<Record<string, any>>("settings"), kvGet<string>("project_id"),
    ]);
    if (cachedMe) setMe(cachedMe);
    const plist = cachedProjects || [];
    setProjects(plist);
    setStages((cachedStages || []).sort((a, b) => a.order - b.order));
    setGpsLimit(Number(cachedSettings?.GPS_ACCURACY_WARNING_METERS ?? 15));
    setPid(pid && plist.some((p) => p.id === pid) ? pid : plist[0]?.id ?? null);
  }, []);

  const runSync = useCallback(
    async (full = false) => {
      if (!meRef.current) return;
      await syncNow({ full });
      await loadCached();
    },
    [loadCached],
  );

  // start-up: restore session from the phone, then sync in the background
  useEffect(() => {
    (async () => {
      const { token } = await loadCredentials();
      if (token) await loadCached();
      await refreshCounts();
      setReady(true);
      if (token) runSync();
    })();
  }, [loadCached, runSync]);

  const syncRef = useRef(sync);
  useEffect(
    () =>
      onSyncStatus((st) => {
        syncRef.current = st;
        setSync(st);
        // sign-in no longer valid (password changed, account deactivated, signed out elsewhere):
        // show the sign-in screen but keep everything on the phone
        if (st.authRequired && meRef.current) setMe(null);
        // a successful sync proves we are online, whatever the OS reports
        if (!st.syncing && st.lastSync && !st.lastError && !onlineRef.current) {
          onlineRef.current = true;
          setOnline(true);
        }
      }),
    [],
  );

  // sync when signal comes back, when the app is reopened, and every 5 minutes
  useEffect(() => {
    const unsubNet = NetInfo.addEventListener((s) => {
      // Trust the connection state only; whether the server is reachable is found out by syncing.
      const now = s.isConnected !== false;
      if (now && !onlineRef.current) runSync();
      onlineRef.current = now;
      setOnline(now);
    });
    const sub = AppState.addEventListener("change", (st) => st === "active" && onlineRef.current && runSync());
    const timer = setInterval(() => onlineRef.current && runSync(), 5 * 60 * 1000);
    // While anything is waiting, retry every minute even if the phone claims to be offline
    // (connectivity reports are not always right in weak-signal areas).
    const retry = setInterval(() => {
      const st = syncRef.current;
      if (!st.syncing && st.pendingChanges + st.pendingPhotos > 0) runSync();
    }, 60 * 1000);
    return () => {
      unsubNet();
      sub.remove();
      clearInterval(timer);
      clearInterval(retry);
    };
  }, [runSync]);

  // after any local save: update counters, and upload a few seconds later
  useEffect(() => {
    let t: ReturnType<typeof setTimeout> | null = null;
    setAfterSaveHook(() => {
      refreshCounts();
      if (t) clearTimeout(t);
      t = setTimeout(() => runSync(), 4000);
    });
    return () => {
      if (t) clearTimeout(t);
    };
  }, [runSync]);

  const login = useCallback(
    async (serverInput: string, username: string, password: string) => {
      const server = normaliseServer(serverInput);
      await saveCredentials(server, "");
      const res = await request<{ token: string; user: Me }>("auth/login/", { body: { username, password, client: "MOBILE" }, auth: false });
      const previous = await kvGet<Me>("me");
      if (previous && previous.username !== res.user.username) await clearAll(); // different person on this phone
      clearAuthRequired();
      await saveCredentials(server, res.token);
      await kvSet("me", res.user);
      setMe(res.user);
      await syncNow({ full: true });
      await loadCached();
    },
    [loadCached],
  );

  const logout = useCallback(async () => {
    try {
      await request("auth/logout/", { method: "POST", timeoutMs: 8000 });
    } catch (e) {
      if (!(e instanceof ApiError)) throw e;
    }
    await clearAll();
    const { server } = await loadCredentials();
    await saveCredentials(server, "");
    setMe(null);
    setProjects([]);
    await refreshCounts();
  }, []);

  const setProjectId = (id: string) => {
    setPid(id);
    kvSet("project_id", id);
  };

  const can = useCallback((resource: string, action = "read") => !!me?.permissions?.[resource]?.[action], [me]);
  const canEditStage = useCallback((code: string) => !!me?.permissions?.stages?.[code], [me]);

  return (
    <SessionContext.Provider
      value={{
        ready, me, projects, projectId, project: projects.find((p) => p.id === projectId) || null, stages, gpsLimit, online, sync,
        login, logout, setProjectId, syncNow: runSync, canEditStage, can,
      }}
    >
      {children}
    </SessionContext.Provider>
  );
}

export const useSession = () => useContext(SessionContext);

/** Re-run a loader whenever local data changes. */
export function useLocal<T>(loader: () => Promise<T>, deps: any[] = []): [T | undefined, () => void] {
  const [data, setData] = useState<T>();
  const [tick, setTick] = useState(0);
  useEffect(() => onDbChange(() => setTick((t) => t + 1)), []);
  useEffect(() => {
    let alive = true;
    loader().then((d) => alive && setData(d));
    return () => {
      alive = false;
    };
  }, [tick, ...deps]); // eslint-disable-line react-hooks/exhaustive-deps
  return [data, () => setTick((t) => t + 1)];
}
