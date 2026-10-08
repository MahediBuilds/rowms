import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { api } from "../api";
import { Documents } from "../components/Documents";
import { FieldDef, FormModal, REFS } from "../components/Form";
import { AGREEMENT_TONE, Badge, Empty, Facts, fmtDate, Loading, Money, PageHead, Pager, Panel } from "../components/ui";
import { useDebounced, useDeleter, useList, useSaver } from "../hooks";
import { useAuth, useLabel, useMeta, useProject } from "../state";
import type { Agreement } from "../types";

function agreementFields(projects: { id: string; code: string; name: string }[], projectId?: string, labels?: { farmers?: Record<string, string>; assets?: Record<string, string> }): FieldDef[] {
  return [
    { name: "project", label: "Project", type: "select", required: true, options: projects.map((p) => ({ value: p.id, label: `${p.code} - ${p.name}` })) },
    { name: "agreement_number", label: "Agreement number", hint: "Leave blank to number automatically (AGR-…)" },
    { name: "agreement_type", label: "Agreement type", type: "select", options: "agreement_types", required: true },
    { name: "status", label: "Status", type: "select", options: "agreement_statuses", required: true, hint: "Executed or registered marks 'Agreement Executed' on the linked locations" },
    { name: "land_parcel", label: "Land (survey number)", type: "ref", ref: { ...REFS.land, params: projectId ? { project: projectId } : {} }, span: 2 },
    { name: "farmer_ids", label: "Farmers (signatories)", type: "refs", ref: REFS.farmer, refLabels: labels?.farmers, span: 2 },
    { name: "asset_ids", label: "Poles / towers covered", type: "refs", ref: { ...REFS.asset, params: projectId ? { project: projectId } : {} }, refLabels: labels?.assets, span: 2 },
    { name: "purpose", label: "Purpose", span: 2 },
    { name: "land_extent", label: "Land extent" },
    { name: "agreement_date", label: "Agreement date", type: "date" },
    { name: "period_months", label: "Period (months)", type: "number", step: "1" },
    { name: "start_date", label: "Start date", type: "date" },
    { name: "end_date", label: "End date", type: "date" },
    { name: "renewal_date", label: "Renewal date", type: "date" },
    { name: "compensation_rate", label: "Compensation rate" },
    { name: "total_consideration", label: "Total consideration (₹)", type: "number" },
    { name: "stamp_duty", label: "Stamp duty / charges (₹)", type: "number" },
    { name: "registration_details", label: "Registration details" },
    { name: "witness_details", label: "Witnesses", type: "textarea", span: 2 },
    { name: "remarks", label: "Remarks", type: "textarea", span: 2 },
  ];
}

export function Agreements() {
  const { can } = useAuth();
  const meta = useMeta();
  const label = useLabel();
  const { projects, projectId } = useProject();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const q = useDebounced(search);
  const list = useList<Agreement>("agreements", { search: q, status });
  const save = useSaver();
  const nav = useNavigate();
  const [adding, setAdding] = useState(false);
  return (
    <>
      <PageHead
        title="Agreements"
        sub="Lease, ROW, easement and consent agreements with farmers."
        actions={
          can("agreement", "write") && (
            <button className="btn btn-primary" onClick={() => setAdding(true)}>
              <Plus /> New agreement
            </button>
          )
        }
      />
      <div className="filters">
        <input type="search" placeholder="Search number, farmer, survey no., pole" value={search} onChange={(e) => setSearch(e.target.value)} />
        <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
          <option value="">Any status</option>
          {meta?.agreement_statuses.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
        <span className="count">{list.count} agreements</span>
      </div>
      <Panel pad={false}>
        {list.isLoading ? (
          <Loading />
        ) : !list.rows.length ? (
          <Empty title="No agreements found" />
        ) : (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Agreement</th>
                  <th>Farmers</th>
                  <th>Land / locations</th>
                  <th>Type</th>
                  <th>Date</th>
                  <th className="num">Consideration</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {list.rows.map((g) => (
                  <tr key={g.id} className="clickable" onClick={() => nav(`/agreements/${g.id}`)}>
                    <td>
                      <div className="id">{g.agreement_number}</div>
                      <div className="muted small">{g.project_code}</div>
                    </td>
                    <td className="small">{g.farmer_list.map((f) => f.name).join(", ") || "—"}</td>
                    <td className="small">
                      {g.land_label}
                      {g.asset_list.length > 0 && <div className="muted">{g.asset_list.map((a) => a.asset_number).join(", ")}</div>}
                    </td>
                    <td>{label("agreement_types", g.agreement_type)}</td>
                    <td className="nowrap">{fmtDate(g.agreement_date)}</td>
                    <td className="num">
                      <Money v={g.total_consideration} />
                    </td>
                    <td>
                      <Badge tone={AGREEMENT_TONE[g.status]}>{label("agreement_statuses", g.status)}</Badge>
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
          title="New agreement"
          fields={agreementFields(projects, projectId)}
          initial={{ project: projectId || projects[0]?.id, agreement_type: "ROW", status: "DRAFT", farmer_ids: [], asset_ids: [] }}
          onClose={() => setAdding(false)}
          onSubmit={async (v) => {
            const g = await save("agreements", null, v, "Agreement saved", ["assets"]);
            setAdding(false);
            nav(`/agreements/${g.id}`);
          }}
        />
      )}
    </>
  );
}

export function AgreementDetail() {
  const { id } = useParams();
  const { can } = useAuth();
  const label = useLabel();
  const { projects } = useProject();
  const nav = useNavigate();
  const save = useSaver();
  const del = useDeleter();
  const [editing, setEditing] = useState(false);
  const { data: g, isLoading } = useQuery({ queryKey: ["agreements", "one", id], queryFn: () => api<Agreement>(`agreements/${id}/`) });
  if (isLoading || !g) return <Loading />;
  return (
    <>
      <PageHead
        crumb={<Link to="/agreements">Agreements</Link>}
        title={g.agreement_number}
        sub={
          <>
            {label("agreement_types", g.agreement_type)} agreement, {g.project_code} <Badge tone={AGREEMENT_TONE[g.status]}>{label("agreement_statuses", g.status)}</Badge>
          </>
        }
        actions={
          <>
            {can("agreement", "write") && (
              <button className="btn" onClick={() => setEditing(true)}>
                <Pencil /> Edit
              </button>
            )}
            {can("agreement", "delete") && (
              <button className="btn btn-danger" onClick={async () => (await del("agreements", g.id, "agreement", ["assets"])) && nav("/agreements")}>
                <Trash2 />
              </button>
            )}
          </>
        }
      />
      <div className="detail-grid">
        <div className="stack">
          <Panel title="Signed agreement & attachments">
            <Documents filter={{ agreement: g.id }} categories={["AGREEMENT", "KYC_AADHAAR", "KYC_OTHER", "OTHER"]} defaultCategory="AGREEMENT" />
          </Panel>
          <Panel title="Terms">
            <Facts
              items={[
                ["Purpose", g.purpose],
                ["Land extent", g.land_extent],
                ["Agreement date", fmtDate(g.agreement_date)],
                ["Period", g.period_months ? `${g.period_months} months` : null],
                ["Start", g.start_date ? fmtDate(g.start_date) : null],
                ["End", g.end_date ? fmtDate(g.end_date) : null],
                ["Renewal", g.renewal_date ? fmtDate(g.renewal_date) : null],
                ["Compensation rate", g.compensation_rate],
                ["Total consideration", g.total_consideration !== null ? <Money v={g.total_consideration} /> : null],
                ["Stamp duty / charges", g.stamp_duty !== null ? <Money v={g.stamp_duty} /> : null],
                ["Registration", g.registration_details],
                ["Witnesses", g.witness_details ? <span style={{ whiteSpace: "pre-line" }}>{g.witness_details}</span> : null],
                ["Remarks", g.remarks],
              ]}
            />
          </Panel>
        </div>
        <div className="stack">
          <Panel title="Farmers" pad={false}>
            {!g.farmer_list.length ? (
              <div className="panel-body muted">No farmer linked.</div>
            ) : (
              <table className="data">
                <tbody>
                  {g.farmer_list.map((f) => (
                    <tr key={f.id} className="clickable" onClick={() => nav(`/farmers/${f.id}`)}>
                      <td style={{ fontWeight: 600 }}>{f.name}</td>
                      <td className="muted small right">{f.farmer_code}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Panel>
          <Panel title="Land & locations">
            <Facts
              items={[
                ["Land", g.land_parcel ? <Link to={`/lands/${g.land_parcel}`}>{g.land_label}</Link> : "—"],
                [
                  "Locations",
                  g.asset_list.length ? (
                    <span>
                      {g.asset_list.map((a, i) => (
                        <span key={a.id}>
                          {i > 0 && ", "}
                          <Link to={`/locations/${a.id}`}>{a.asset_number}</Link>
                        </span>
                      ))}
                    </span>
                  ) : (
                    "All locations on this land"
                  ),
                ],
              ]}
            />
          </Panel>
        </div>
      </div>
      {editing && (
        <FormModal
          title={`Edit ${g.agreement_number}`}
          fields={agreementFields(projects, g.project, {
            farmers: Object.fromEntries(g.farmer_list.map((f) => [f.id, `${f.farmer_code} ${f.name}`])),
            assets: Object.fromEntries(g.asset_list.map((a) => [a.id, a.asset_number])),
          })}
          initial={{ ...g, farmer_ids: g.farmer_list.map((f) => f.id), asset_ids: g.asset_list.map((a) => a.id) }}
          onClose={() => setEditing(false)}
          onSubmit={async (v) => {
            await save("agreements", g.id, v, "Agreement updated", ["assets"]);
            setEditing(false);
          }}
        />
      )}
    </>
  );
}
