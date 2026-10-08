import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "react-router-dom";
import { FileSpreadsheet, Pencil, Plus, Trash2 } from "lucide-react";
import { api, downloadFile } from "../api";
import { Documents } from "../components/Documents";
import { FieldDef, FormModal, REFS } from "../components/Form";
import { ProgressStrip } from "../components/Progress";
import { AGREEMENT_TONE, Badge, COMP_TONE, Empty, Facts, fmtDate, KYC_TONE, Loading, Money, PageHead, Pager, Panel, PAY_LABEL, PAY_TONE } from "../components/ui";
import { useDebounced, useDeleter, useList, useSaver } from "../hooks";
import { useAuth, useLabel, useMeta, useProject, useToast } from "../state";
import type { Agreement, Asset, Compensation, CropAssessment, Farmer, Land, Payment } from "../types";

export function farmerFields(canBank: boolean, canVerify: boolean, projectLabels?: Record<string, string>): FieldDef[] {
  const f: FieldDef[] = [
    { name: "s1", label: "Farmer", type: "section" },
    { name: "name", label: "Farmer name", required: true, span: 2 },
    { name: "relation_type", label: "Relation", type: "select", options: "relations" },
    { name: "relation_name", label: "Father / husband name" },
    { name: "mobile", label: "Mobile", type: "tel" },
    { name: "alt_mobile", label: "Alternate mobile", type: "tel" },
    { name: "status", label: "Status", type: "select", options: "farmer_statuses", required: true },
    { name: "project_ids", label: "Projects", type: "refs", ref: REFS.project, refLabels: projectLabels },
    { name: "s2", label: "Address", type: "section" },
    { name: "address", label: "Address", type: "textarea", span: 2 },
    { name: "village", label: "Village" },
    { name: "hobli", label: "Hobli" },
    { name: "taluk", label: "Taluk" },
    { name: "district", label: "District" },
    { name: "s3", label: "KYC", type: "section" },
    { name: "aadhaar_last4", label: "Aadhaar, last 4 digits only", maxLength: 4, hint: "Never enter the full Aadhaar number. Upload the card on the farmer page." },
    {
      name: "kyc_status",
      label: "KYC status",
      type: "select",
      required: true,
      options: canVerify ? "kyc_statuses" : [
        { value: "NOT_COLLECTED", label: "Not collected" },
        { value: "COLLECTED", label: "Collected" },
      ],
      hint: canVerify ? undefined : "Admin, Project Manager or ROW Officer marks KYC as verified.",
    },
  ];
  if (canBank) {
    f.push(
      { name: "s4", label: "Bank details (restricted)", type: "section" },
      { name: "bank_account_holder", label: "Account holder" },
      { name: "bank_name", label: "Bank" },
      { name: "bank_branch", label: "Branch" },
      { name: "bank_ifsc", label: "IFSC", maxLength: 11 },
      { name: "bank_account_number", label: "Account number", hint: "Stored encrypted" },
    );
  }
  f.push({ name: "remarks", label: "Remarks", type: "textarea", span: 2 });
  return f;
}

export function Farmers() {
  const { can, me } = useAuth();
  const meta = useMeta();
  const { projectId, current } = useProject();
  const [search, setSearch] = useState("");
  const [kyc, setKyc] = useState("");
  const q = useDebounced(search);
  const list = useList<Farmer>("farmers", { search: q, kyc_status: kyc, ordering: "farmer_code" });
  const save = useSaver();
  const nav = useNavigate();
  const [adding, setAdding] = useState(false);
  return (
    <>
      <PageHead
        title="Farmers"
        sub="One permanent Farmer ID per person, across every project and survey number."
        actions={
          can("farmer", "write") && (
            <button className="btn btn-primary" onClick={() => setAdding(true)}>
              <Plus /> Register farmer
            </button>
          )
        }
      />
      <div className="filters">
        <input type="search" placeholder="Search name, Farmer ID, mobile, village, survey no." value={search} onChange={(e) => setSearch(e.target.value)} />
        <select value={kyc} onChange={(e) => setKyc(e.target.value)} aria-label="KYC status">
          <option value="">Any KYC status</option>
          {meta?.kyc_statuses.map((k) => (
            <option key={k.value} value={k.value}>
              KYC {k.label.toLowerCase()}
            </option>
          ))}
        </select>
        <span className="count">{list.count} farmers</span>
      </div>
      <Panel pad={false}>
        {list.isLoading ? (
          <Loading />
        ) : !list.rows.length ? (
          <Empty title="No farmers found">Register a farmer here, or they will appear when surveyors sync from the field app.</Empty>
        ) : (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Farmer ID</th>
                  <th>Name</th>
                  <th>Village</th>
                  <th>Mobile</th>
                  <th>KYC</th>
                  <th className="num">Land records</th>
                  <th>Projects</th>
                </tr>
              </thead>
              <tbody>
                {list.rows.map((f) => (
                  <tr key={f.id} className="clickable" onClick={() => nav(`/farmers/${f.id}`)}>
                    <td className="id">{f.farmer_code}</td>
                    <td>
                      <div style={{ fontWeight: 600 }}>{f.name}</div>
                      {f.relation_name && (
                        <div className="muted small">
                          {f.relation_type} {f.relation_name}
                        </div>
                      )}
                    </td>
                    <td>
                      {f.village}
                      {f.taluk && <div className="muted small">{f.taluk}</div>}
                    </td>
                    <td className="nowrap">{f.mobile || <span className="muted">—</span>}</td>
                    <td>
                      <Badge tone={KYC_TONE[f.kyc_status]}>{meta?.kyc_statuses.find((k) => k.value === f.kyc_status)?.label}</Badge>
                    </td>
                    <td className="num">{f.land_count}</td>
                    <td className="small">{f.projects.map((p) => p.code).join(", ")}</td>
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
          title="Register farmer"
          fields={farmerFields(can("bank", "write"), can("kyc", "verify"), current ? { [current.id]: `${current.code} - ${current.name}` } : undefined)}
          initial={{ status: "ACTIVE", kyc_status: "NOT_COLLECTED", state: "Karnataka", project_ids: projectId ? [projectId] : [] }}
          onClose={() => setAdding(false)}
          intro={<p className="muted small">The Farmer ID (FRM-…) is created automatically when you save. Logged in as {me?.role_label}.</p>}
          onSubmit={async (v) => {
            const f = await save("farmers", null, v, "Farmer registered");
            setAdding(false);
            nav(`/farmers/${f.id}`);
          }}
        />
      )}
    </>
  );
}

type History = {
  farmer: Farmer;
  lands: Land[];
  assets: Asset[];
  agreements: Agreement[];
  crop_assessments: CropAssessment[];
  compensations?: Compensation[];
  payments?: Payment[];
  totals?: { approved: number; paid: number; balance: number; proposed: number };
  timeline: { date: string; type: string; title: string; project: string | null }[];
};

export function FarmerDetail() {
  const { id } = useParams();
  const { can } = useAuth();
  const label = useLabel();
  const nav = useNavigate();
  const save = useSaver();
  const del = useDeleter();
  const toast = useToast();
  const [tab, setTab] = useState("overview");
  const [editing, setEditing] = useState(false);
  const { data, isLoading } = useQuery({ queryKey: ["farmer-history", id], queryFn: () => api<History>(`farmers/${id}/history/`) });
  if (isLoading || !data) return <Loading />;
  const f = data.farmer;
  const tabs: [string, string, number | null][] = [
    ["overview", "Overview", null],
    ["land", "Land & locations", data.lands.length],
    ["agreements", "Agreements", data.agreements.length],
    ...(data.compensations ? ([["money", "Compensation & payments", data.compensations.length]] as [string, string, number][]) : []),
    ["crop", "Crop", data.crop_assessments.length],
    ["docs", "Documents", null],
  ];

  return (
    <>
      <PageHead
        crumb={<Link to="/farmers">Farmers</Link>}
        title={f.name}
        sub={
          <>
            <strong style={{ color: "var(--ink)" }}>{f.farmer_code}</strong>
            {f.relation_name ? `, ${f.relation_type} ${f.relation_name}` : ""}
            {f.village ? `, ${f.village}` : ""} <Badge tone={KYC_TONE[f.kyc_status]}>KYC {label("kyc_statuses", f.kyc_status).toLowerCase()}</Badge>{" "}
            {f.status !== "ACTIVE" && <Badge>{label("farmer_statuses", f.status)}</Badge>}
          </>
        }
        actions={
          <>
            {can("report") && can("compensation") && (
              <button className="btn" onClick={() => downloadFile(`farmers/${f.id}/statement/`, `${f.farmer_code}.xlsx`).catch((e) => toast(e.message, "error"))}>
                <FileSpreadsheet /> Farmer statement
              </button>
            )}
            {can("farmer", "write") && (
              <button className="btn" onClick={() => setEditing(true)}>
                <Pencil /> Edit
              </button>
            )}
            {can("farmer", "delete") && (
              <button className="btn btn-danger" onClick={async () => (await del("farmers", f.id, "farmer")) && nav("/farmers")}>
                <Trash2 />
              </button>
            )}
          </>
        }
      />
      <div className="tabs" role="tablist">
        {tabs.map(([k, t, n]) => (
          <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>
            {t}
            {n !== null && <span className="n">{n}</span>}
          </button>
        ))}
      </div>

      {tab === "overview" && (
        <div className="grid-2">
          <Panel title="Lifetime history">
            {data.timeline.length === 0 ? (
              <p className="muted">Nothing recorded yet.</p>
            ) : (
              <ul className="timeline">
                {[...data.timeline].reverse().map((e, i) => (
                  <li key={i} className={`t-${e.type}`}>
                    <div className="when">
                      {fmtDate(e.date)}
                      {e.project ? `, ${e.project}` : ""}
                    </div>
                    <div className="what">{e.title}</div>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
          <div className="stack">
            {data.totals && (
              <Panel title="Compensation">
                <Facts
                  items={[
                    ["Approved", <Money v={data.totals.approved} />],
                    ["Paid", <Money v={data.totals.paid} />],
                    ["Balance", <strong><Money v={data.totals.balance} /></strong>],
                    ["Awaiting approval", data.totals.proposed > 0 ? <Money v={data.totals.proposed} /> : null],
                  ]}
                />
              </Panel>
            )}
            <Panel title="Details">
              <Facts
                items={[
                  ["Mobile", f.mobile || "—"],
                  ["Alternate mobile", f.alt_mobile],
                  ["Address", f.address],
                  ["Village", f.village],
                  ["Hobli", f.hobli],
                  ["Taluk", f.taluk],
                  ["District", f.district],
                  ["Projects", f.projects.map((p) => p.code).join(", ") || "—"],
                  ["Registered", `${fmtDate(f.created_at)}${f.created_by_name ? ` by ${f.created_by_name}` : ""}`],
                ]}
              />
            </Panel>
            <Panel title="KYC">
              <Facts
                items={[
                  ["Status", <Badge tone={KYC_TONE[f.kyc_status]}>{label("kyc_statuses", f.kyc_status)}</Badge>],
                  ["Aadhaar", f.aadhaar_last4 ? `XXXX XXXX ${f.aadhaar_last4}` : "Not recorded"],
                  ["Collected on", f.kyc_collected_on ? fmtDate(f.kyc_collected_on) : null],
                  ["Verified on", f.kyc_verified_on ? fmtDate(f.kyc_verified_on) : null],
                  ["KYC documents", `${f.kyc_document_count} uploaded`],
                ]}
              />
            </Panel>
            <Panel title="Bank details">
              {f.can_view_bank ? (
                f.bank_account_number ? (
                  <Facts
                    items={[
                      ["Account holder", f.bank_account_holder],
                      ["Bank", f.bank_name],
                      ["Branch", f.bank_branch],
                      ["IFSC", f.bank_ifsc],
                      ["Account no.", f.bank_account_number],
                    ]}
                  />
                ) : (
                  <p className="muted">Not recorded.</p>
                )
              ) : (
                <p className="muted">{f.bank_account_masked ? `Account ${f.bank_account_masked}. ` : ""}Full bank details are visible to Finance, ROW Officers and Admin.</p>
              )}
            </Panel>
          </div>
        </div>
      )}

      {tab === "land" && (
        <div className="stack">
          {data.lands.length === 0 && <Empty title="No land linked">Link this farmer as an owner from a land record.</Empty>}
          {data.lands.map((l) => (
            <Panel
              key={l.id}
              title={
                <Link to={`/lands/${l.id}`} style={{ color: "inherit" }}>
                  Sy.No. {l.survey_label}, {l.village}
                </Link>
              }
              pad={false}
              actions={<span className="muted small">{l.owners.length > 1 ? `Joint: ${l.owners.map((o) => o.name + (o.is_primary_payee ? " (payee)" : "")).join(", ")}` : `${Number(l.total_acres).toFixed(2)} acres`}</span>}
            >
              {data.assets.filter((a) => a.land_parcel === l.id).length === 0 ? (
                <div className="panel-body muted">No pole or tower on this land.</div>
              ) : (
                <table className="data">
                  <tbody>
                    {data.assets
                      .filter((a) => a.land_parcel === l.id)
                      .map((a) => (
                        <tr key={a.id} className="clickable" onClick={() => nav(`/locations/${a.id}`)}>
                          <td className="id">{a.asset_number}</td>
                          <td>{a.project_code}</td>
                          <td>
                            <ProgressStrip progress={a.progress} />
                          </td>
                          <td className="muted small">{a.progress.latest_completed ?? "Not started"}</td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              )}
            </Panel>
          ))}
        </div>
      )}

      {tab === "agreements" && (
        <Panel pad={false}>
          {!data.agreements.length ? (
            <Empty title="No agreements" />
          ) : (
            <table className="data">
              <thead>
                <tr>
                  <th>Agreement</th>
                  <th>Project</th>
                  <th>Type</th>
                  <th>Date</th>
                  <th className="num">Consideration</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {data.agreements.map((g) => (
                  <tr key={g.id} className="clickable" onClick={() => nav(`/agreements/${g.id}`)}>
                    <td className="id">{g.agreement_number}</td>
                    <td>{g.project_code}</td>
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
          )}
        </Panel>
      )}

      {tab === "money" && data.compensations && (
        <div className="stack">
          <Panel title="Compensation" pad={false}>
            {!data.compensations.length ? (
              <Empty title="No compensation recorded" />
            ) : (
              <table className="data">
                <thead>
                  <tr>
                    <th>Project</th>
                    <th>Category</th>
                    <th>Location</th>
                    <th>Status</th>
                    <th className="num">Approved</th>
                    <th className="num">Paid</th>
                    <th className="num">Balance</th>
                  </tr>
                </thead>
                <tbody>
                  {data.compensations.map((c) => (
                    <tr key={c.id} className="clickable" onClick={() => nav(`/compensation/${c.id}`)}>
                      <td>{c.project_code}</td>
                      <td>
                        {label("compensation_categories", c.category)}
                        {c.description && <div className="muted small">{c.description}</div>}
                      </td>
                      <td className="small">{c.asset_number || c.land_label || "—"}</td>
                      <td>{c.status === "APPROVED" ? <Badge tone={PAY_TONE[c.payment_status]}>{PAY_LABEL[c.payment_status]}</Badge> : <Badge tone={COMP_TONE[c.status]}>{label("compensation_statuses", c.status)}</Badge>}</td>
                      <td className="num">
                        <Money v={c.approved_amount} />
                      </td>
                      <td className="num">
                        <Money v={c.paid_amount} />
                      </td>
                      <td className="num">
                        <Money v={c.balance_amount} />
                      </td>
                    </tr>
                  ))}
                </tbody>
                {data.totals && (
                  <tfoot>
                    <tr>
                      <td colSpan={4}>Total approved</td>
                      <td className="num">
                        <Money v={data.totals.approved} />
                      </td>
                      <td className="num">
                        <Money v={data.totals.paid} />
                      </td>
                      <td className="num">
                        <Money v={data.totals.balance} />
                      </td>
                    </tr>
                  </tfoot>
                )}
              </table>
            )}
          </Panel>
          <Panel title="Payments recorded" pad={false}>
            {!data.payments?.length ? (
              <Empty title="No payments recorded yet" />
            ) : (
              <table className="data">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Towards</th>
                    <th>Mode</th>
                    <th>Reference</th>
                    <th className="num">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {data.payments.map((p) => (
                    <tr key={p.id}>
                      <td className="nowrap">{fmtDate(p.payment_date)}</td>
                      <td>
                        {p.compensation_category}, {p.project_code}
                      </td>
                      <td>{label("payment_modes", p.mode)}</td>
                      <td className="muted">{p.reference_number || "—"}</td>
                      <td className="num">
                        <Money v={p.amount} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Panel>
        </div>
      )}

      {tab === "crop" && (
        <Panel pad={false}>
          {!data.crop_assessments.length ? (
            <Empty title="No crop assessments" />
          ) : (
            <table className="data">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Crop</th>
                  <th>Season / stage</th>
                  <th>Land</th>
                  <th className="num">Area (acres)</th>
                  <th className="num">Company assessment</th>
                </tr>
              </thead>
              <tbody>
                {data.crop_assessments.map((c) => (
                  <tr key={c.id}>
                    <td className="nowrap">{fmtDate(c.assessment_date)}</td>
                    <td style={{ fontWeight: 600 }}>{c.crop_type}</td>
                    <td>
                      {label("crop_seasons", c.season)}
                      {c.crop_stage ? `, ${label("crop_stages", c.crop_stage).toLowerCase()}` : ""}
                    </td>
                    <td className="small">{c.land_label}</td>
                    <td className="num">{c.crop_area_acres ?? "—"}</td>
                    <td className="num">
                      <Money v={c.company_assessment} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Panel>
      )}

      {tab === "docs" && (
        <Panel title="KYC, bank and other documents">
          <Documents filter={{ farmer: f.id }} categories={["KYC_AADHAAR", "KYC_OTHER", "BANK_PROOF", "LAND_RTC", "LAND_OTHER", "OTHER"]} defaultCategory="KYC_AADHAAR" />
        </Panel>
      )}

      {editing && (
        <FormModal
          title={`Edit ${f.farmer_code}`}
          fields={farmerFields(f.can_view_bank && can("bank", "write"), can("kyc", "verify") || f.kyc_status === "VERIFIED", Object.fromEntries(f.projects.map((p) => [p.id, `${p.code} - ${p.name}`])))}
          initial={{ ...f, project_ids: f.projects.map((p) => p.id) }}
          onClose={() => setEditing(false)}
          onSubmit={async (v) => {
            await save("farmers", f.id, v, "Farmer updated");
            setEditing(false);
          }}
        />
      )}
    </>
  );
}
