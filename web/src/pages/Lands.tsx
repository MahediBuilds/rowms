import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Pencil, Plus, Trash2, UserPlus } from "lucide-react";
import { api, ApiError } from "../api";
import { Documents } from "../components/Documents";
import { FieldDef, FormModal, REFS } from "../components/Form";
import { MiniMap } from "../components/MiniMap";
import { ProgressStrip } from "../components/Progress";
import { Badge, coords, Empty, Facts, KYC_TONE, Loading, PageHead, Pager, Panel } from "../components/ui";
import { useDebounced, useDeleter, useList, useSaver } from "../hooks";
import { useAuth, useLabel, useMeta, useProject, useToast } from "../state";
import type { Asset, Land, Paged } from "../types";

function landFields(projectLabels?: Record<string, string>): FieldDef[] {
  return [
    { name: "survey_number", label: "Survey number", required: true },
    { name: "hissa", label: "Sub-division / hissa" },
    { name: "village", label: "Village", required: true },
    { name: "hobli", label: "Hobli" },
    { name: "taluk", label: "Taluk" },
    { name: "district", label: "District" },
    { name: "extent_acres", label: "Extent (acres)", type: "number" },
    { name: "extent_guntas", label: "Extent (guntas)", type: "number", hint: "40 guntas = 1 acre" },
    { name: "ownership_type", label: "Ownership type", type: "select", options: "ownership_types", required: true },
    { name: "land_type", label: "Land type", type: "select", options: "land_types", required: true },
    { name: "rtc_reference", label: "RTC / Pahani reference" },
    { name: "project_ids", label: "Projects", type: "refs", ref: REFS.project, refLabels: projectLabels },
    { name: "mutation_details", label: "Mutation details", type: "textarea", span: 2 },
    { name: "gps", label: "Location", type: "section" },
    { name: "latitude", label: "Latitude", type: "number", step: "0.0000001" },
    { name: "longitude", label: "Longitude", type: "number", step: "0.0000001" },
    { name: "remarks", label: "Remarks", type: "textarea", span: 2 },
  ];
}

export function Lands() {
  const { can } = useAuth();
  const meta = useMeta();
  const { projectId, current } = useProject();
  const [search, setSearch] = useState("");
  const q = useDebounced(search);
  const list = useList<Land>("lands", { search: q, ordering: "village" });
  const save = useSaver();
  const nav = useNavigate();
  const [adding, setAdding] = useState(false);
  return (
    <>
      <PageHead
        title="Land records"
        sub="Survey numbers, their owners and the poles or towers on them."
        actions={
          can("land", "write") && (
            <button className="btn btn-primary" onClick={() => setAdding(true)}>
              <Plus /> Add land record
            </button>
          )
        }
      />
      <div className="filters">
        <input type="search" placeholder="Search survey no., village, RTC, owner" value={search} onChange={(e) => setSearch(e.target.value)} />
        <span className="count">{list.count} land records</span>
      </div>
      <Panel pad={false}>
        {list.isLoading ? (
          <Loading />
        ) : !list.rows.length ? (
          <Empty title="No land records found" />
        ) : (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Survey no.</th>
                  <th>Village</th>
                  <th>Extent</th>
                  <th>Type</th>
                  <th>Owners</th>
                  <th className="num">Locations</th>
                  <th>RTC</th>
                </tr>
              </thead>
              <tbody>
                {list.rows.map((l) => (
                  <tr key={l.id} className="clickable" onClick={() => nav(`/lands/${l.id}`)}>
                    <td className="id">{l.survey_label}</td>
                    <td>
                      {l.village}
                      <div className="muted small">
                        {[l.hobli, l.taluk].filter(Boolean).join(", ")}
                      </div>
                    </td>
                    <td className="nowrap">
                      {Number(l.extent_acres)} A {Number(l.extent_guntas)} G
                    </td>
                    <td>{meta?.land_types.find((t) => t.value === l.land_type)?.label}</td>
                    <td className="small">
                      {l.owners.map((o) => (
                        <div key={o.ownership_id}>
                          {o.name}
                          {o.is_primary_payee && l.owners.length > 1 ? <span className="muted"> (payee)</span> : null}
                        </div>
                      ))}
                      {!l.owners.length && <span className="muted">No owner linked</span>}
                    </td>
                    <td className="num">{l.asset_count}</td>
                    <td className="small muted">{l.rtc_reference || "—"}</td>
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
          title="Add land record"
          fields={landFields(current ? { [current.id]: `${current.code} - ${current.name}` } : undefined)}
          initial={{ ownership_type: "INDIVIDUAL", land_type: "DRY", extent_acres: 0, extent_guntas: 0, state: "Karnataka", project_ids: projectId ? [projectId] : [] }}
          onClose={() => setAdding(false)}
          onSubmit={async (v) => {
            const l = await save("lands", null, v, "Land record added");
            setAdding(false);
            nav(`/lands/${l.id}`);
          }}
        />
      )}
    </>
  );
}

export function LandDetail() {
  const { id } = useParams();
  const { can } = useAuth();
  const label = useLabel();
  const nav = useNavigate();
  const save = useSaver();
  const del = useDeleter();
  const toast = useToast();
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [addingOwner, setAddingOwner] = useState(false);
  const { data: l, isLoading } = useQuery({ queryKey: ["lands", "one", id], queryFn: () => api<Land>(`lands/${id}/`) });
  const { data: assets } = useQuery({ queryKey: ["assets", "land", id], queryFn: () => api<Paged<Asset>>(`assets/?land_parcel=${id}&page_size=100`) });
  if (isLoading || !l) return <Loading />;
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["lands"] });
    qc.invalidateQueries({ queryKey: ["assets"] });
  };
  const setPayee = async (ownershipId: string) => {
    try {
      await api(`ownerships/${ownershipId}/`, { method: "PATCH", body: { is_primary_payee: true } });
      toast("Primary payee updated");
      refresh();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : String(e), "error");
    }
  };
  const removeOwner = async (ownershipId: string) => {
    if (await del("ownerships", ownershipId, "owner link", ["lands"])) refresh();
  };

  return (
    <>
      <PageHead
        crumb={<Link to="/lands">Land records</Link>}
        title={`Sy.No. ${l.survey_label}`}
        sub={[l.village, l.hobli, l.taluk, l.district].filter(Boolean).join(", ")}
        actions={
          <>
            {can("land", "write") && (
              <button className="btn" onClick={() => setEditing(true)}>
                <Pencil /> Edit
              </button>
            )}
            {can("land", "delete") && (
              <button className="btn btn-danger" onClick={async () => (await del("lands", l.id, "land record")) && nav("/lands")}>
                <Trash2 />
              </button>
            )}
          </>
        }
      />
      <div className="detail-grid">
        <div className="stack">
          <Panel
            title="Owners"
            pad={false}
            actions={
              can("ownership", "write") && (
                <button className="btn btn-small" onClick={() => setAddingOwner(true)}>
                  <UserPlus /> Add owner
                </button>
              )
            }
          >
            {!l.owners.length ? (
              <Empty title="No owner linked">Add the registered owner(s) of this survey number.</Empty>
            ) : (
              <table className="data">
                <thead>
                  <tr>
                    <th>Farmer</th>
                    <th>KYC</th>
                    <th>Compensation payee</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {l.owners.map((o) => (
                    <tr key={o.ownership_id}>
                      <td>
                        <Link to={`/farmers/${o.farmer_id}`} style={{ fontWeight: 600 }}>
                          {o.name}
                        </Link>
                        <div className="muted small">{o.farmer_code}</div>
                      </td>
                      <td>
                        <Badge tone={KYC_TONE[o.kyc_status]}>{label("kyc_statuses", o.kyc_status)}</Badge>
                      </td>
                      <td>
                        {o.is_primary_payee ? (
                          <Badge tone="blue">Primary payee</Badge>
                        ) : can("ownership", "write") ? (
                          <button className="link-btn" onClick={() => setPayee(o.ownership_id)}>
                            Make primary payee
                          </button>
                        ) : null}
                      </td>
                      <td className="right">
                        {can("ownership", "delete") && (
                          <button className="icon-btn" aria-label="Remove owner" onClick={() => removeOwner(o.ownership_id)}>
                            <Trash2 />
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Panel>
          <Panel title="Poles & towers on this land" pad={false}>
            {!assets?.results.length ? (
              <div className="panel-body muted">None yet.</div>
            ) : (
              <table className="data">
                <tbody>
                  {assets.results.map((a) => (
                    <tr key={a.id} className="clickable" onClick={() => nav(`/locations/${a.id}`)}>
                      <td className="id">{a.asset_number}</td>
                      <td>{a.project_code}</td>
                      <td>
                        <ProgressStrip progress={a.progress} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Panel>
          <Panel title="Land documents">
            <Documents filter={{ land_parcel: l.id }} categories={["LAND_RTC", "LAND_OTHER", "SITE_PHOTO", "OTHER"]} defaultCategory="LAND_RTC" />
          </Panel>
        </div>
        <div className="stack">
          <Panel title="Details">
            {l.latitude !== null && l.longitude !== null && (
              <div style={{ marginBottom: 12 }}>
                <MiniMap lat={Number(l.latitude)} lng={Number(l.longitude)} polygon={l.boundary_geojson} />
              </div>
            )}
            <Facts
              items={[
                ["Extent", `${Number(l.extent_acres)} acres ${Number(l.extent_guntas)} guntas (${Number(l.total_acres).toFixed(3)} acres)`],
                ["Ownership", label("ownership_types", l.ownership_type)],
                ["Land type", label("land_types", l.land_type)],
                ["RTC / Pahani", l.rtc_reference || "—"],
                ["Mutation", l.mutation_details],
                ["Coordinates", coords(l.latitude, l.longitude)],
                ["Boundary", l.boundary_geojson ? "Polygon recorded" : null],
                ["Projects", l.projects.map((p) => p.code).join(", ") || "—"],
                ["Remarks", l.remarks],
              ]}
            />
          </Panel>
        </div>
      </div>
      {editing && (
        <FormModal
          title={`Edit Sy.No. ${l.survey_label}`}
          fields={landFields(Object.fromEntries(l.projects.map((p) => [p.id, `${p.code} - ${p.name}`])))}
          initial={{ ...l, project_ids: l.projects.map((p) => p.id) }}
          onClose={() => setEditing(false)}
          onSubmit={async (v) => {
            await save("lands", l.id, v, "Land record updated");
            setEditing(false);
          }}
        />
      )}
      {addingOwner && (
        <FormModal
          title="Add owner"
          fields={[
            { name: "farmer", label: "Farmer", type: "ref", ref: REFS.farmer, required: true, span: 2, hint: "Register the farmer first if they are not in the list" },
            { name: "is_primary_payee", label: "Primary / representative payee for compensation", type: "checkbox", span: 2 },
          ]}
          initial={{ is_primary_payee: l.owners.length === 0 }}
          onClose={() => setAddingOwner(false)}
          onSubmit={async (v) => {
            await save("ownerships", null, { ...v, land: l.id }, "Owner added", ["lands", "assets"]);
            setAddingOwner(false);
          }}
        />
      )}
    </>
  );
}
