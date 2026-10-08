import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { AlertTriangle, Check, Download, MapPin, Pencil, Plus, Trash2, Upload } from "lucide-react";
import { api, ApiError, downloadFile } from "../api";
import { Documents } from "../components/Documents";
import { FieldDef, FormModal, REFS } from "../components/Form";
import { MiniMap } from "../components/MiniMap";
import { ProgressStrip } from "../components/Progress";
import { Badge, coords, Empty, Facts, fmtDate, fmtDateTime, KYC_TONE, Loading, Modal, Money, PageHead, Pager, Panel, PAY_LABEL, PAY_TONE, today } from "../components/ui";
import { useDebounced, useDeleter, useList, useSaver } from "../hooks";
import { useAuth, useLabel, useMeta, useProject, useToast } from "../state";
import type { Asset, Compensation, Paged, StageProgress } from "../types";

export function assetFields(projects: { id: string; code: string; name: string }[], projectId?: string): FieldDef[] {
  return [
    { name: "project", label: "Project", type: "select", required: true, options: projects.map((p) => ({ value: p.id, label: `${p.code} - ${p.name}` })) },
    { name: "asset_type", label: "Type", type: "select", options: "asset_types", required: true },
    { name: "asset_number", label: "Pole / tower / asset number", required: true, hint: "For example P-245 or T-118" },
    { name: "line_name", label: "Line / corridor" },
    { name: "land_parcel", label: "Land (survey number)", type: "ref", ref: { ...REFS.land, params: projectId ? { project: projectId } : {} }, span: 2, hint: "Farmers on this land are linked to the location automatically" },
    { name: "gps", label: "GPS location", type: "section" },
    { name: "latitude", label: "Latitude", type: "number", step: "0.0000001", hint: "Decimal degrees, e.g. 15.6420123" },
    { name: "longitude", label: "Longitude", type: "number", step: "0.0000001", hint: "Decimal degrees, e.g. 76.0320456" },
    { name: "gps_accuracy_m", label: "GPS accuracy (m)", type: "number" },
    { name: "remarks", label: "Remarks", type: "textarea", span: 2 },
  ];
}

export function Locations() {
  const { can } = useAuth();
  const meta = useMeta();
  const { projects, projectId } = useProject();
  const [params, setParams] = useSearchParams();
  const [search, setSearch] = useState("");
  const q = useDebounced(search);
  const stage = params.get("stage") || "";
  const done = params.get("done") || "false";
  const type = params.get("type") || "";
  const list = useList<Asset>("assets", { search: q, stage, stage_done: stage ? done : undefined, asset_type: type, ordering: "asset_number" });
  const save = useSaver();
  const nav = useNavigate();
  const [adding, setAdding] = useState(false);
  const [importing, setImporting] = useState(false);
  const toast = useToast();
  const setParam = (k: string, v: string) => {
    const next = new URLSearchParams(params);
    if (v) next.set(k, v);
    else next.delete(k);
    setParams(next, { replace: true });
  };

  return (
    <>
      <PageHead
        title="Poles & towers"
        sub="Every field location with its progress across the seven stages."
        actions={
          <>
            {projectId && (
              <button className="btn" onClick={() => downloadFile(`kml/export/?project=${projectId}`, "locations.kml").catch((e) => toast(e.message, "error"))}>
                <Download /> Export KML
              </button>
            )}
            {can("asset", "write") && (
              <button className="btn" onClick={() => setImporting(true)}>
                <Upload /> Import KML / KMZ
              </button>
            )}
            {can("asset", "write") && (
              <button className="btn btn-primary" onClick={() => setAdding(true)}>
                <Plus /> Add location
              </button>
            )}
          </>
        }
      />
      <div className="filters">
        <input type="search" placeholder="Search number, survey no., village, farmer" value={search} onChange={(e) => setSearch(e.target.value)} />
        <select value={type} onChange={(e) => setParam("type", e.target.value)} aria-label="Type">
          <option value="">All types</option>
          {meta?.asset_types.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
        <select value={stage} onChange={(e) => setParam("stage", e.target.value)} aria-label="Stage">
          <option value="">Any stage</option>
          {meta?.stages.map((s) => (
            <option key={s.code} value={s.code}>
              {s.name}
            </option>
          ))}
        </select>
        {stage && (
          <span className="seg">
            <button className={done === "false" ? "on" : ""} onClick={() => setParam("done", "false")}>
              Pending
            </button>
            <button className={done === "true" ? "on" : ""} onClick={() => setParam("done", "true")}>
              Done
            </button>
          </span>
        )}
        <span className="count">{list.count} locations</span>
      </div>
      <Panel pad={false}>
        {list.isLoading ? (
          <Loading />
        ) : list.rows.length === 0 ? (
          <Empty title="No locations match">Add a location, import a KML file from your survey, or capture points with the field app.</Empty>
        ) : (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Location</th>
                  <th>Project / line</th>
                  <th>Land</th>
                  <th>Farmers</th>
                  <th>Progress</th>
                  <th>GPS</th>
                </tr>
              </thead>
              <tbody>
                {list.rows.map((a) => (
                  <tr key={a.id} className="clickable" onClick={() => nav(`/locations/${a.id}`)}>
                    <td>
                      <div className="id">{a.asset_number}</div>
                      <div className="muted small">{meta?.asset_types.find((t) => t.value === a.asset_type)?.label}</div>
                    </td>
                    <td>
                      <div>{a.project_code}</div>
                      <div className="muted small">{a.line_name}</div>
                    </td>
                    <td className="small">{a.land_label ?? <span className="muted">Not linked</span>}</td>
                    <td className="small">{a.farmers.length ? a.farmers.map((f) => f.name).join(", ") : <span className="muted">None</span>}</td>
                    <td>
                      <ProgressStrip progress={a.progress} />
                    </td>
                    <td className="small nowrap">
                      {a.latitude === null ? (
                        <span className="muted">No GPS</span>
                      ) : a.gps_warning ? (
                        <span title={`Accuracy ${a.gps_accuracy_m} m`} style={{ color: "var(--phase-y)" }}>
                          <AlertTriangle style={{ width: 14, height: 14, verticalAlign: -2 }} /> ±{a.gps_accuracy_m} m
                        </span>
                      ) : (
                        <span>
                          <MapPin style={{ width: 14, height: 14, verticalAlign: -2, color: "var(--field)" }} /> {a.gps_accuracy_m ? `±${a.gps_accuracy_m} m` : "Set"}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <Pager page={list.page} count={list.count} pageSize={list.pageSize} onPage={list.setPage} />
      </Panel>
      {adding && (
        <FormModal
          title="Add location"
          fields={assetFields(projects, projectId)}
          initial={{ project: projectId || projects[0]?.id, asset_type: "POLE" }}
          onClose={() => setAdding(false)}
          onSubmit={async (v) => {
            const a = await save("assets", null, v, "Location added");
            setAdding(false);
            nav(`/locations/${a.id}`);
          }}
        />
      )}
      {importing && <KmlImport onClose={() => setImporting(false)} />}
    </>
  );
}

function KmlImport({ onClose }: { onClose: () => void }) {
  const { projects, projectId } = useProject();
  const meta = useMeta();
  const qc = useQueryClient();
  const [project, setProject] = useState(projectId || projects[0]?.id || "");
  const [type, setType] = useState("POLE");
  const [line, setLine] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<any>(null);
  const run = async () => {
    if (!file) return setError("Choose a KML or KMZ file.");
    setBusy(true);
    setError("");
    try {
      const form = new FormData();
      form.set("project", project);
      form.set("asset_type", type);
      form.set("line_name", line);
      form.set("file", file);
      setResult(await api("kml/import/", { form }));
      qc.invalidateQueries();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title="Import KML / KMZ"
      onClose={onClose}
      narrow
      footer={
        result ? (
          <button className="btn btn-primary" onClick={onClose}>
            Done
          </button>
        ) : (
          <>
            <button className="btn" onClick={onClose}>
              Cancel
            </button>
            <button className="btn btn-primary" disabled={busy} onClick={run}>
              {busy ? "Importing…" : "Import"}
            </button>
          </>
        )
      }
    >
      {result ? (
        <div>
          <p>
            <strong>{result.assets_created}</strong> locations added, <strong>{result.assets_updated}</strong> updated, {result.route_lines} route line(s) and {result.land_boundaries} land boundaries imported.
          </p>
          {result.skipped.length > 0 && (
            <>
              <p className="muted">Skipped:</p>
              <ul className="small">
                {result.skipped.map((s: string) => (
                  <li key={s}>{s}</li>
                ))}
              </ul>
            </>
          )}
        </div>
      ) : (
        <div className="form-grid" style={{ gridTemplateColumns: "1fr" }}>
          {error && <div className="form-error">{error}</div>}
          <p className="muted small" style={{ margin: 0 }}>
            Points become poles/towers (the placemark name is used as the number; existing numbers are updated). Lines become the project route. Polygons named with a survey number (e.g. 45/2) become that land's boundary.
          </p>
          <label className="field">
            <span className="lbl">Project</span>
            <select value={project} onChange={(e) => setProject(e.target.value)}>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.code} - {p.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span className="lbl">Default type for points</span>
            <select value={type} onChange={(e) => setType(e.target.value)}>
              {meta?.asset_types.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
            <span className="hint">Names starting with T are treated as towers and P as poles.</span>
          </label>
          <label className="field">
            <span className="lbl">Line / corridor name (optional)</span>
            <input type="text" value={line} onChange={(e) => setLine(e.target.value)} />
          </label>
          <label className="field">
            <span className="lbl">File</span>
            <input type="file" accept=".kml,.kmz" onChange={(e) => setFile(e.target.files?.[0] || null)} />
          </label>
        </div>
      )}
    </Modal>
  );
}

export function LocationDetail() {
  const { id } = useParams();
  const { can } = useAuth();
  const label = useLabel();
  const { projects } = useProject();
  const nav = useNavigate();
  const save = useSaver();
  const del = useDeleter();
  const qc = useQueryClient();
  const { data: a, isLoading } = useQuery({ queryKey: ["assets", "one", id], queryFn: () => api<Asset>(`assets/${id}/`) });
  const { data: comps } = useQuery({
    queryKey: ["compensations", "asset", id],
    queryFn: () => api<Paged<Compensation>>(`compensations/?asset=${id}&page_size=100`),
    enabled: can("compensation"),
  });
  const { data: ags } = useQuery({ queryKey: ["agreements", "asset", id], queryFn: () => api<Paged<any>>(`agreements/?asset=${id}&page_size=50`) });
  const [editing, setEditing] = useState(false);
  const [stage, setStage] = useState<StageProgress | null>(null);
  if (isLoading || !a) return <Loading />;

  return (
    <>
      <PageHead
        crumb={
          <>
            <Link to="/locations">Poles & towers</Link> / {a.project_code}
          </>
        }
        title={`${label("asset_types", a.asset_type)} ${a.asset_number}`}
        sub={a.line_name || a.project_name}
        actions={
          <>
            {can("asset", "write") && (
              <button className="btn" onClick={() => setEditing(true)}>
                <Pencil /> Edit
              </button>
            )}
            {can("asset", "delete") && (
              <button className="btn btn-danger" onClick={async () => (await del("assets", a.id, "location")) && nav("/locations")}>
                <Trash2 /> Delete
              </button>
            )}
          </>
        }
      />
      <div className="detail-grid">
        <div className="stack">
          <Panel title="Progress" pad={false} actions={<ProgressStrip progress={a.progress} large />}>
            <div className="stages">
              {a.progress.stages.map((s) => {
                const editable = s.scope !== "FARMER" && can("milestone", "write");
                return (
                  <div className="stage-row" key={s.code}>
                    <button
                      className={`tick ${s.completed ? "done" : s.partial ? "part" : ""}`}
                      disabled={!editable}
                      aria-label={`${s.name}: ${s.completed ? "done" : "pending"}`}
                      title={s.scope === "FARMER" ? "KYC is updated on the farmer record" : editable ? "Update this stage" : "Your role cannot update this stage"}
                      onClick={() => setStage(s)}
                    >
                      {(s.completed || s.partial) && <Check strokeWidth={3} />}
                    </button>
                    <div>
                      <div className="name">{s.name}</div>
                      <div className="meta">
                        {s.scope === "FARMER"
                          ? s.detail
                          : s.completed
                            ? `Done ${fmtDate(s.completed_on)}${s.source === "AUTO" ? ", updated automatically" : ""}${s.detail && s.source !== "AUTO" ? `. ${s.detail}` : ""}`
                            : "Pending"}
                      </div>
                    </div>
                    <div>
                      {s.scope === "FARMER" ? (
                        <span className="muted small">From farmer KYC</span>
                      ) : editable ? (
                        <button className="btn btn-small" onClick={() => setStage(s)}>
                          {s.completed ? "Change" : "Mark done"}
                        </button>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
          </Panel>

          <Panel title="Photos & documents">
            <Documents filter={{ asset: a.id }} categories={["SITE_PHOTO", "CROP_PHOTO", "LAND_OTHER", "AGREEMENT", "OTHER"]} />
          </Panel>

          {comps && (
            <Panel title="Compensation for this location" pad={false}>
              {comps.results.length === 0 ? (
                <Empty title="No compensation recorded" />
              ) : (
                <table className="data">
                  <thead>
                    <tr>
                      <th>Payee</th>
                      <th>Category</th>
                      <th className="num">Approved</th>
                      <th className="num">Paid</th>
                      <th className="num">Balance</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {comps.results.map((c) => (
                      <tr key={c.id} className="clickable" onClick={() => nav(`/compensation/${c.id}`)}>
                        <td>{c.payee_name}</td>
                        <td>{label("compensation_categories", c.category)}</td>
                        <td className="num">
                          <Money v={c.approved_amount} />
                        </td>
                        <td className="num">
                          <Money v={c.paid_amount} />
                        </td>
                        <td className="num">
                          <Money v={c.balance_amount} />
                        </td>
                        <td>{c.status === "APPROVED" ? <Badge tone={PAY_TONE[c.payment_status]}>{PAY_LABEL[c.payment_status]}</Badge> : <Badge tone="yellow">{label("compensation_statuses", c.status)}</Badge>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Panel>
          )}
        </div>

        <div className="stack">
          <Panel title="Location">
            {a.latitude !== null && a.longitude !== null ? <MiniMap lat={Number(a.latitude)} lng={Number(a.longitude)} /> : <p className="muted">No GPS coordinates yet.</p>}
            {a.gps_warning && (
              <div className="form-error" style={{ background: "var(--phase-y-tint)", color: "#6d4d00", marginTop: 10 }}>
                GPS accuracy was ±{a.gps_accuracy_m} m, worse than the warning limit. Consider re-capturing on site.
              </div>
            )}
            <div style={{ marginTop: 12 }}>
              <Facts
                items={[
                  ["Coordinates", coords(a.latitude, a.longitude)],
                  ["Accuracy", a.gps_accuracy_m !== null ? `±${a.gps_accuracy_m} m` : null],
                  ["Captured", a.gps_captured_at ? fmtDateTime(a.gps_captured_at) : null],
                  ["Project", <Link to={`/projects/${a.project}`}>{a.project_code}</Link>],
                  ["Land", a.land_parcel ? <Link to={`/lands/${a.land_parcel}`}>{a.land_label}</Link> : "Not linked"],
                ]}
              />
            </div>
            {a.latitude !== null && (
              <a className="btn btn-small" style={{ marginTop: 12 }} href={`https://www.google.com/maps?q=${a.latitude},${a.longitude}`} target="_blank" rel="noreferrer">
                Open in Google Maps
              </a>
            )}
          </Panel>
          <Panel title="Farmers on this land" pad={false}>
            {a.farmers.length === 0 ? (
              <div className="panel-body muted">Link a land record to show its owners here.</div>
            ) : (
              <table className="data">
                <tbody>
                  {a.farmers.map((f) => (
                    <tr key={f.id} className="clickable" onClick={() => nav(`/farmers/${f.id}`)}>
                      <td>
                        <div style={{ fontWeight: 600 }}>{f.name}</div>
                        <div className="muted small">
                          {f.farmer_code}
                          {f.mobile ? `, ${f.mobile}` : ""}
                        </div>
                      </td>
                      <td className="right">
                        <Badge tone={KYC_TONE[f.kyc_status]}>KYC {label("kyc_statuses", f.kyc_status).toLowerCase()}</Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Panel>
          <Panel title="Agreements" pad={false}>
            {!ags?.results.length ? (
              <div className="panel-body muted">No agreement covers this location yet.</div>
            ) : (
              <table className="data">
                <tbody>
                  {ags.results.map((g: any) => (
                    <tr key={g.id} className="clickable" onClick={() => nav(`/agreements/${g.id}`)}>
                      <td className="id">{g.agreement_number}</td>
                      <td>{label("agreement_types", g.agreement_type)}</td>
                      <td className="right">
                        <Badge tone={g.status === "EXECUTED" || g.status === "REGISTERED" ? "green" : "yellow"}>{label("agreement_statuses", g.status)}</Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Panel>
        </div>
      </div>

      {editing && (
        <FormModal
          title={`Edit ${a.asset_number}`}
          fields={assetFields(projects, a.project)}
          initial={a}
          onClose={() => setEditing(false)}
          onSubmit={async (v) => {
            await save("assets", a.id, v, "Location updated");
            setEditing(false);
          }}
        />
      )}
      {stage && (
        <StageModal
          asset={a}
          stage={stage}
          onClose={() => setStage(null)}
          onSaved={(updated) => {
            qc.setQueryData(["assets", "one", id], updated);
            qc.invalidateQueries({ queryKey: ["assets"] });
            qc.invalidateQueries({ queryKey: ["dashboard"] });
            setStage(null);
          }}
        />
      )}
    </>
  );
}

function StageModal({ asset, stage, onClose, onSaved }: { asset: Asset; stage: StageProgress; onClose: () => void; onSaved: (a: Asset) => void }) {
  const toast = useToast();
  const [date, setDate] = useState(stage.completed_on || today());
  const [remarks, setRemarks] = useState(stage.source === "AUTO" ? "" : stage.detail || "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const send = async (completed: boolean) => {
    setBusy(true);
    setError("");
    try {
      const res = await api<Asset>(`assets/${asset.id}/set-stage/`, { body: { stage_code: stage.code, completed, completed_on: completed ? date : null, remarks } });
      toast(completed ? `${stage.name}: marked done` : `${stage.name}: marked pending`);
      onSaved(res);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title={stage.name}
      onClose={onClose}
      narrow
      footer={
        <>
          {stage.completed && (
            <button className="btn btn-danger" disabled={busy} onClick={() => send(false)} style={{ marginRight: "auto" }}>
              Mark as pending
            </button>
          )}
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" disabled={busy} onClick={() => send(true)}>
            {stage.completed ? "Save" : "Mark done"}
          </button>
        </>
      }
    >
      {error && <div className="form-error">{error}</div>}
      <div className="form-grid" style={{ gridTemplateColumns: "1fr" }}>
        <p className="muted small" style={{ margin: 0 }}>
          {asset.asset_number}, {asset.project_code}. Stages can be updated in any order.
        </p>
        <label className="field">
          <span className="lbl">Completed on</span>
          <input type="date" value={date} max={today()} onChange={(e) => setDate(e.target.value)} />
        </label>
        <label className="field">
          <span className="lbl">Remarks</span>
          <textarea value={remarks} onChange={(e) => setRemarks(e.target.value)} />
        </label>
      </div>
    </Modal>
  );
}
