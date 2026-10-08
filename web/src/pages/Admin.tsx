import { Fragment, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { api, ApiError } from "../api";
import { FieldDef, FormModal, REFS } from "../components/Form";
import { Badge, Empty, fmtDateTime, Loading, PageHead, Pager, Panel } from "../components/ui";
import { useDebounced, useList, useSaver } from "../hooks";
import { useToast } from "../state";
import type { Stage, User } from "../types";

function userFields(isNew: boolean, labels?: Record<string, string>): FieldDef[] {
  return [
    { name: "username", label: "Username", required: true, disabled: !isNew },
    { name: "role", label: "Role", type: "select", options: "roles", required: true },
    { name: "first_name", label: "First name", required: true },
    { name: "last_name", label: "Last name" },
    { name: "phone", label: "Mobile", type: "tel" },
    { name: "email", label: "Email", type: "email" },
    { name: "project_ids", label: "Assigned projects", type: "refs", ref: REFS.project, refLabels: labels, span: 2, hint: "Admin, Management and Finance see all projects. Others see only the projects assigned here." },
    { name: "password", label: isNew ? "Password" : "New password", type: "password", required: isNew, hint: isNew ? "At least 8 characters" : "Leave blank to keep the current password" },
    { name: "is_active", label: "Active (can sign in)", type: "checkbox" },
  ];
}

export function Users() {
  const save = useSaver();
  const [search, setSearch] = useState("");
  const q = useDebounced(search);
  const list = useList<User>("users", { search: q }, { projectParam: false });
  const [editing, setEditing] = useState<User | "new" | null>(null);
  return (
    <>
      <PageHead
        title="Users"
        sub="Who can sign in, their role and the projects they work on."
        actions={
          <button className="btn btn-primary" onClick={() => setEditing("new")}>
            <Plus /> Add user
          </button>
        }
      />
      <div className="filters">
        <input type="search" placeholder="Search name or username" value={search} onChange={(e) => setSearch(e.target.value)} />
        <span className="count">{list.count} users</span>
      </div>
      <Panel pad={false}>
        {list.isLoading ? (
          <Loading />
        ) : (
          <table className="data">
            <thead>
              <tr>
                <th>Name</th>
                <th>Username</th>
                <th>Role</th>
                <th>Projects</th>
                <th>Last sign-in</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {list.rows.map((u) => (
                <tr key={u.id} className="clickable" onClick={() => setEditing(u)}>
                  <td style={{ fontWeight: 600 }}>{u.display_name}</td>
                  <td>{u.username}</td>
                  <td>{u.role_label}</td>
                  <td className="small">{["ADMIN", "MANAGEMENT", "FINANCE"].includes(u.role) ? <span className="muted">All projects</span> : u.projects.map((p) => p.code).join(", ") || <span className="muted">None assigned</span>}</td>
                  <td className="small muted">{fmtDateTime(u.last_login)}</td>
                  <td>{u.is_active ? <Badge tone="green">Active</Badge> : <Badge>Deactivated</Badge>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <Pager page={list.page} count={list.count} pageSize={list.pageSize} onPage={list.setPage} />
      </Panel>
      <p className="muted small" style={{ marginTop: 10 }}>
        Farmer logins are planned for a later version.
      </p>
      {editing && (
        <FormModal
          title={editing === "new" ? "Add user" : `Edit ${editing.display_name}`}
          fields={userFields(editing === "new", editing === "new" ? undefined : Object.fromEntries(editing.projects.map((p) => [p.id, `${p.code} - ${p.name}`])))}
          initial={editing === "new" ? { role: "SURVEYOR", is_active: true, project_ids: [] } : { ...editing, password: "", project_ids: editing.projects.map((p) => p.id) }}
          onClose={() => setEditing(null)}
          onSubmit={async (v) => {
            if (editing !== "new") delete v.username;
            await save("users", editing === "new" ? null : editing.id, v, editing === "new" ? "User added" : "User updated");
            setEditing(null);
          }}
        />
      )}
    </>
  );
}

type Log = { id: number; timestamp: string; user_name: string; action: string; model_name: string; object_repr: string; changes: Record<string, any> | null; source: string; ip_address: string | null };

const ACTION_TONE: Record<string, "green" | "yellow" | "red" | "blue" | "grey"> = { CREATE: "green", UPDATE: "blue", DELETE: "red", APPROVE: "green", VIEW_SENSITIVE: "yellow", EXPORT: "grey", IMPORT: "grey", LOGIN: "grey" };

export function Activity() {
  const [search, setSearch] = useState("");
  const [action, setAction] = useState("");
  const [open, setOpen] = useState<number | null>(null);
  const q = useDebounced(search);
  const list = useList<Log>("audit-logs", { search: q, action }, { projectParam: false });
  return (
    <>
      <PageHead title="Activity log" sub="Every addition, change, approval, export and view of sensitive documents." />
      <div className="filters">
        <input type="search" placeholder="Search record or user" value={search} onChange={(e) => setSearch(e.target.value)} />
        <select value={action} onChange={(e) => setAction(e.target.value)} aria-label="Action">
          <option value="">All actions</option>
          {Object.keys(ACTION_TONE).map((a) => (
            <option key={a} value={a}>
              {a.charAt(0) + a.slice(1).toLowerCase().replace("_", " ")}
            </option>
          ))}
        </select>
        <span className="count">{list.count} entries</span>
      </div>
      <Panel pad={false}>
        {list.isLoading ? (
          <Loading />
        ) : !list.rows.length ? (
          <Empty title="No activity found" />
        ) : (
          <table className="data">
            <thead>
              <tr>
                <th>When</th>
                <th>User</th>
                <th>Action</th>
                <th>Record</th>
                <th>From</th>
              </tr>
            </thead>
            <tbody>
              {list.rows.map((l) => (
                <Fragment key={l.id}>
                  <tr className={l.changes ? "clickable" : ""} onClick={() => l.changes && setOpen(open === l.id ? null : l.id)}>
                    <td className="nowrap small">{fmtDateTime(l.timestamp)}</td>
                    <td>{l.user_name}</td>
                    <td>
                      <Badge tone={ACTION_TONE[l.action]}>{l.action.charAt(0) + l.action.slice(1).toLowerCase().replace("_", " ")}</Badge>
                    </td>
                    <td>
                      <span className="muted small">{l.model_name}</span> {l.object_repr}
                      {l.changes && <span className="muted small"> ({Object.keys(l.changes).length} fields)</span>}
                    </td>
                    <td className="small muted">{l.source === "MOBILE" ? "Field app" : l.source === "WEB" ? "Web" : l.source}</td>
                  </tr>
                  {open === l.id && l.changes && (
                    <tr key={`${l.id}-c`}>
                      <td colSpan={5} style={{ background: "#f7f8f6" }}>
                        <table className="data" style={{ fontSize: 13 }}>
                          <tbody>
                            {Object.entries(l.changes).map(([k, v]) => (
                              <tr key={k}>
                                <td style={{ width: 200 }} className="muted">
                                  {k}
                                </td>
                                <td>{Array.isArray(v) && v.length === 2 ? <>{String(v[0] ?? "—")} <span className="muted">to</span> {String(v[1] ?? "—")}</> : JSON.stringify(v)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        )}
        <Pager page={list.page} count={list.count} pageSize={list.pageSize} onPage={list.setPage} />
      </Panel>
    </>
  );
}

export function SettingsPage() {
  const toast = useToast();
  const qc = useQueryClient();
  const { data: settings } = useQuery({ queryKey: ["settings"], queryFn: () => api<{ key: string; value: any; description: string }[]>("settings/") });
  const { data: stages } = useQuery({ queryKey: ["stages"], queryFn: () => api<Stage[]>("stages/") });
  const gps = settings?.find((s) => s.key === "GPS_ACCURACY_WARNING_METERS");
  const [limit, setLimit] = useState<string>("");
  const [names, setNames] = useState<Record<string, string>>({});
  const saveGps = async () => {
    try {
      await api("settings/GPS_ACCURACY_WARNING_METERS/", { method: "PATCH", body: { value: Number(limit || gps?.value) } });
      toast("GPS warning limit saved");
      qc.invalidateQueries();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : String(e), "error");
    }
  };
  const saveStage = async (code: string) => {
    try {
      await api(`stages/${code}/`, { method: "PATCH", body: { name: names[code] } });
      toast("Stage renamed");
      qc.invalidateQueries();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : String(e), "error");
    }
  };
  return (
    <>
      <PageHead title="Settings" />
      <div className="grid-2-even">
        <Panel title="Field app GPS warning">
          <p className="muted">The field app warns the surveyor when the phone's GPS accuracy is worse than this. It never blocks saving.</p>
          <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
            <label className="field" style={{ width: 160 }}>
              <span className="lbl">Warning above (metres)</span>
              <input type="number" min={1} value={limit || gps?.value || ""} onChange={(e) => setLimit(e.target.value)} />
            </label>
            <button className="btn btn-primary" onClick={saveGps}>
              Save
            </button>
          </div>
        </Panel>
        <Panel title="Progress stages" pad={false}>
          <div className="panel-body muted small" style={{ paddingBottom: 0 }}>
            Rename a stage to match your project wording. The same stages apply to every asset type in this version.
          </div>
          <table className="data">
            <tbody>
              {stages?.map((s) => (
                <tr key={s.code}>
                  <td style={{ width: 30 }} className="muted">
                    {s.order}
                  </td>
                  <td>
                    <input type="text" value={names[s.code] ?? s.name} onChange={(e) => setNames((n) => ({ ...n, [s.code]: e.target.value }))} disabled={s.scope === "FARMER"} />
                  </td>
                  <td className="right">
                    {names[s.code] !== undefined && names[s.code] !== s.name && (
                      <button className="btn btn-small" onClick={() => saveStage(s.code)}>
                        Save
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      </div>
    </>
  );
}
