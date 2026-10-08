import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { CheckCircle2, Pencil, Plus, Trash2 } from "lucide-react";
import { api, ApiError, qs } from "../api";
import { Documents } from "../components/Documents";
import { FieldDef, FormModal, REFS } from "../components/Form";
import { Badge, COMP_TONE, Empty, Facts, fmtDate, Loading, money, Money, PageHead, Pager, Panel, PAY_LABEL, PAY_TONE, today } from "../components/ui";
import { useDebounced, useDeleter, useList, useSaver } from "../hooks";
import { useAuth, useLabel, useMeta, useProject, useToast } from "../state";
import type { Compensation, Payment } from "../types";

function compensationFields(projects: { id: string; code: string; name: string }[], canApprove: boolean, projectId?: string): FieldDef[] {
  return [
    { name: "project", label: "Project", type: "select", required: true, options: projects.map((p) => ({ value: p.id, label: `${p.code} - ${p.name}` })) },
    { name: "category", label: "Category", type: "select", options: "compensation_categories", required: true },
    { name: "payee", label: "Payee (primary farmer)", type: "ref", ref: { ...REFS.farmer, params: projectId ? { project: projectId } : {} }, required: true, span: 2 },
    { name: "asset", label: "Pole / tower", type: "ref", ref: { ...REFS.asset, params: projectId ? { project: projectId } : {} } },
    { name: "land_parcel", label: "Land (survey number)", type: "ref", ref: { ...REFS.land, params: projectId ? { project: projectId } : {} } },
    { name: "crop_assessment", label: "Crop assessment", type: "ref", ref: { ...REFS.crop, params: projectId ? { project: projectId } : {} }, span: 2, show: (v) => v.category === "CROP" },
    { name: "description", label: "Description", span: 2, hint: "For example: standing groundnut, 0.4 acre" },
    { name: "quantity", label: "Quantity", type: "number", show: (v) => ["TREE", "CROP", "LAND", "OTHER"].includes(v.category) },
    { name: "unit", label: "Unit", hint: "trees, acres, …", show: (v) => ["TREE", "CROP", "LAND", "OTHER"].includes(v.category) },
    { name: "approved_amount", label: "Amount (₹)", type: "number", required: true },
    {
      name: "status",
      label: "Status",
      type: "select",
      required: true,
      options: canApprove
        ? "compensation_statuses"
        : [
            { value: "PROPOSED", label: "Proposed" },
            { value: "CANCELLED", label: "Cancelled" },
          ],
      hint: canApprove ? undefined : "A Project Manager or Admin approves the amount.",
    },
    { name: "remarks", label: "Remarks", type: "textarea", span: 2 },
  ];
}

function paymentFields(): FieldDef[] {
  return [
    { name: "amount", label: "Amount paid (₹)", type: "number", required: true },
    { name: "payment_date", label: "Payment date", type: "date", required: true },
    { name: "mode", label: "Mode", type: "select", options: "payment_modes", required: true },
    { name: "reference_number", label: "UTR / cheque / reference no." },
    { name: "receipt_number", label: "Receipt number" },
    { name: "paid_to", label: "Paid to", type: "ref", ref: REFS.farmer, hint: "Defaults to the payee" },
    { name: "remarks", label: "Remarks", type: "textarea", span: 2 },
  ];
}

export function CompensationList() {
  const { can } = useAuth();
  const meta = useMeta();
  const label = useLabel();
  const { projects, projectId } = useProject();
  const [params] = useSearchParams();
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");
  const [status, setStatus] = useState(params.get("status") || "");
  const [payStatus, setPayStatus] = useState("");
  const q = useDebounced(search);
  const filters = { search: q, category, status, payment_status: payStatus };
  const list = useList<Compensation>("compensations", { ...filters, ordering: "-created_at" });
  const { data: totals } = useQuery({
    queryKey: ["compensations", "totals", filters, projectId],
    queryFn: () => api(`compensations/totals/${qs({ ...filters, project: projectId })}`),
  });
  const save = useSaver();
  const nav = useNavigate();
  const [adding, setAdding] = useState(false);
  return (
    <>
      <PageHead
        title="Compensation"
        sub="Approved amounts per farmer and location, with what has been paid and what is still due."
        actions={
          can("compensation", "write") && (
            <button className="btn btn-primary" onClick={() => setAdding(true)}>
              <Plus /> Add compensation
            </button>
          )
        }
      />
      {totals && (
        <div className="ledger" style={{ gridTemplateColumns: "repeat(4, minmax(0,1fr))", marginBottom: 14 }}>
          <div>
            <div className="v">{money(totals.approved)}</div>
            <div className="k">Approved</div>
          </div>
          <div>
            <div className="v" style={{ color: "var(--field)" }}>
              {money(totals.paid)}
            </div>
            <div className="k">Paid</div>
          </div>
          <div>
            <div className="v" style={{ color: totals.balance > 0 ? "var(--phase-r)" : undefined }}>{money(totals.balance)}</div>
            <div className="k">Balance to pay</div>
          </div>
          <div>
            <div className="v">{money(totals.proposed)}</div>
            <div className="k">Awaiting approval</div>
          </div>
        </div>
      )}
      <div className="filters">
        <input type="search" placeholder="Search farmer, pole, survey no." value={search} onChange={(e) => setSearch(e.target.value)} />
        <select value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Category">
          <option value="">All categories</option>
          {meta?.compensation_categories.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </select>
        <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Approval">
          <option value="">Any approval status</option>
          {meta?.compensation_statuses.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </select>
        <select value={payStatus} onChange={(e) => setPayStatus(e.target.value)} aria-label="Payment">
          <option value="">Any payment status</option>
          <option value="PENDING">Balance pending</option>
          <option value="UNPAID">Unpaid</option>
          <option value="PARTIAL">Part paid</option>
          <option value="PAID">Fully paid</option>
        </select>
        <span className="count">{list.count} records</span>
      </div>
      <Panel pad={false}>
        {list.isLoading ? (
          <Loading />
        ) : !list.rows.length ? (
          <Empty title="No compensation records match" />
        ) : (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Payee</th>
                  <th>Category</th>
                  <th>Location</th>
                  <th>Status</th>
                  <th className="num">Approved</th>
                  <th className="num">Paid</th>
                  <th className="num">Balance</th>
                </tr>
              </thead>
              <tbody>
                {list.rows.map((c) => (
                  <tr key={c.id} className="clickable" onClick={() => nav(`/compensation/${c.id}`)}>
                    <td>
                      <div style={{ fontWeight: 600 }}>{c.payee_name}</div>
                      <div className="muted small">
                        {c.payee_code}, {c.project_code}
                      </div>
                    </td>
                    <td>
                      {label("compensation_categories", c.category)}
                      {c.description && <div className="muted small">{c.description}</div>}
                    </td>
                    <td className="small">
                      {c.asset_number && <div>{c.asset_number}</div>}
                      {c.land_label && <div className="muted">{c.land_label}</div>}
                    </td>
                    <td>{c.status === "APPROVED" ? <Badge tone={PAY_TONE[c.payment_status]}>{PAY_LABEL[c.payment_status]}</Badge> : <Badge tone={COMP_TONE[c.status]}>{label("compensation_statuses", c.status)}</Badge>}</td>
                    <td className="num">
                      <Money v={c.approved_amount} />
                    </td>
                    <td className="num">
                      <Money v={c.paid_amount} />
                    </td>
                    <td className="num">{c.status === "APPROVED" ? <Money v={c.balance_amount} /> : <span className="muted">—</span>}</td>
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
          title="Add compensation"
          fields={compensationFields(projects, can("compensation", "approve"), projectId)}
          initial={{ project: projectId || projects[0]?.id, category: "POLE_TOWER", status: "PROPOSED" }}
          onClose={() => setAdding(false)}
          onSubmit={async (v) => {
            const c = await save("compensations", null, v, "Compensation saved", ["assets"]);
            setAdding(false);
            nav(`/compensation/${c.id}`);
          }}
        />
      )}
    </>
  );
}

export function CompensationDetail() {
  const { id } = useParams();
  const { can } = useAuth();
  const label = useLabel();
  const { projects } = useProject();
  const nav = useNavigate();
  const save = useSaver();
  const del = useDeleter();
  const toast = useToast();
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [paying, setPaying] = useState<Payment | "new" | null>(null);
  const { data: c, isLoading } = useQuery({ queryKey: ["compensations", "one", id], queryFn: () => api<Compensation>(`compensations/${id}/`) });
  const { data: pays } = useQuery({
    queryKey: ["payments", "comp", id],
    queryFn: () => api<{ results: Payment[] }>(`payments/?compensation=${id}&page_size=100&ordering=payment_date`),
  });
  if (isLoading || !c) return <Loading />;
  const pct = c.approved_amount > 0 ? Math.min(100, Math.round((100 * c.paid_amount) / c.approved_amount)) : 0;
  const approve = async () => {
    try {
      await api(`compensations/${c.id}/`, { method: "PATCH", body: { status: "APPROVED" } });
      toast("Compensation approved");
      qc.invalidateQueries({ queryKey: ["compensations"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
    } catch (e) {
      toast(e instanceof ApiError ? e.message : String(e), "error");
    }
  };
  const canPay = can("payment", "write") && c.status === "APPROVED" && c.balance_amount > 0;

  return (
    <>
      <PageHead
        crumb={<Link to="/compensation">Compensation</Link>}
        title={`${label("compensation_categories", c.category)}: ${c.payee_name}`}
        sub={
          <>
            {c.payee_code}, {c.project_code}
            {c.asset_number ? `, ${c.asset_number}` : ""} <Badge tone={COMP_TONE[c.status]}>{label("compensation_statuses", c.status)}</Badge>
          </>
        }
        actions={
          <>
            {c.status === "PROPOSED" && can("compensation", "approve") && (
              <button className="btn btn-primary" onClick={approve}>
                <CheckCircle2 /> Approve {money(c.approved_amount)}
              </button>
            )}
            {canPay && (
              <button className="btn btn-primary" onClick={() => setPaying("new")}>
                <Plus /> Record payment
              </button>
            )}
            {can("compensation", "write") && (
              <button className="btn" onClick={() => setEditing(true)}>
                <Pencil /> Edit
              </button>
            )}
            {can("compensation", "delete") && c.payment_count === 0 && (
              <button className="btn btn-danger" onClick={async () => (await del("compensations", c.id, "compensation record", ["assets"])) && nav("/compensation")}>
                <Trash2 />
              </button>
            )}
          </>
        }
      />
      <Panel>
        <div className="money-row">
          <div>
            <div className="v">{money(c.approved_amount)}</div>
            <div className="k">{c.status === "APPROVED" ? `Approved${c.approved_on ? ` on ${fmtDate(c.approved_on)}` : ""}${c.approved_by_name ? ` by ${c.approved_by_name}` : ""}` : "Proposed amount"}</div>
          </div>
          <div>
            <div className="v" style={{ color: "var(--field)" }}>
              {money(c.paid_amount)}
            </div>
            <div className="k">Paid in {c.payment_count} instalment{c.payment_count === 1 ? "" : "s"}</div>
          </div>
          <div>
            <div className="v" style={{ color: c.balance_amount > 0 ? "var(--phase-r)" : undefined }}>{money(c.balance_amount)}</div>
            <div className="k">Balance</div>
          </div>
        </div>
        <div className="paybar">
          <span style={{ width: `${pct}%` }} />
        </div>
        <div className="muted small">
          {c.status !== "APPROVED"
            ? "Payments can be recorded once the amount is approved."
            : c.payment_status === "PAID"
              ? "Fully paid."
              : `${pct}% paid. Payments are recorded here for tracking only; no money moves through this system.`}
        </div>
      </Panel>
      <div className="detail-grid mt">
        <div className="stack">
          <Panel title="Payments" pad={false}>
            {!pays?.results.length ? (
              <Empty title="No payments recorded">{canPay ? "Record each instalment after it has been paid." : null}</Empty>
            ) : (
              <table className="data">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Mode</th>
                    <th>Reference</th>
                    <th>Paid to</th>
                    <th>Recorded by</th>
                    <th className="num">Amount</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {pays.results.map((p) => (
                    <tr key={p.id}>
                      <td className="nowrap">{fmtDate(p.payment_date)}</td>
                      <td>{label("payment_modes", p.mode)}</td>
                      <td>
                        {p.reference_number || "—"}
                        {p.receipt_number && <div className="muted small">Receipt {p.receipt_number}</div>}
                      </td>
                      <td>{p.paid_to_name}</td>
                      <td className="muted small">{p.created_by_name}</td>
                      <td className="num">
                        <Money v={p.amount} />
                      </td>
                      <td className="right nowrap">
                        {can("payment", "write") && (
                          <button className="icon-btn" aria-label="Edit payment" onClick={() => setPaying(p)}>
                            <Pencil />
                          </button>
                        )}
                        {can("payment", "delete") && (
                          <button
                            className="icon-btn"
                            aria-label="Delete payment"
                            onClick={async () => {
                              if (await del("payments", p.id, "payment", ["compensations", "assets"])) qc.invalidateQueries({ queryKey: ["compensations"] });
                            }}
                          >
                            <Trash2 />
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={5}>Total paid</td>
                    <td className="num">
                      <Money v={c.paid_amount} />
                    </td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            )}
          </Panel>
          <Panel title="Receipts & supporting documents">
            <Documents filter={{ compensation: c.id }} categories={["PAYMENT_RECEIPT", "SITE_PHOTO", "CROP_PHOTO", "OTHER"]} defaultCategory={can("payment", "write") ? "PAYMENT_RECEIPT" : "SITE_PHOTO"} />
          </Panel>
        </div>
        <Panel title="Details">
          <Facts
            items={[
              ["Payee", <Link to={`/farmers/${c.payee}`}>{c.payee_name}</Link>],
              ["Category", label("compensation_categories", c.category)],
              ["Description", c.description],
              ["Quantity", c.quantity !== null ? `${c.quantity} ${c.unit}` : null],
              ["Location", c.asset ? <Link to={`/locations/${c.asset}`}>{c.asset_number}</Link> : null],
              ["Land", c.land_parcel ? <Link to={`/lands/${c.land_parcel}`}>{c.land_label}</Link> : null],
              ["Entered by", c.created_by_name],
              ["Remarks", c.remarks],
            ]}
          />
        </Panel>
      </div>
      {editing && (
        <FormModal
          title="Edit compensation"
          fields={compensationFields(projects, can("compensation", "approve"), c.project)}
          initial={c}
          onClose={() => setEditing(false)}
          onSubmit={async (v) => {
            await save("compensations", c.id, v, "Compensation updated", ["assets"]);
            setEditing(false);
          }}
        />
      )}
      {paying && (
        <FormModal
          title={paying === "new" ? "Record payment" : "Edit payment"}
          intro={<p className="muted small">Balance before this payment: {money(c.balance_amount + (paying !== "new" ? paying.amount : 0))}</p>}
          fields={paymentFields()}
          initial={paying === "new" ? { amount: c.balance_amount, payment_date: today(), mode: "NEFT", paid_to: c.payee } : paying}
          submitLabel={paying === "new" ? "Record payment" : "Save"}
          onClose={() => setPaying(null)}
          onSubmit={async (v) => {
            await save("payments", paying === "new" ? null : paying.id, { ...v, compensation: c.id }, paying === "new" ? "Payment recorded" : "Payment updated", ["compensations", "assets"]);
            setPaying(null);
          }}
        />
      )}
    </>
  );
}

export function Payments() {
  const meta = useMeta();
  const label = useLabel();
  const nav = useNavigate();
  const [search, setSearch] = useState("");
  const [mode, setMode] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const q = useDebounced(search);
  const list = useList<Payment>("payments", { search: q, mode, date_from: from, date_to: to, ordering: "-payment_date" });
  const pageTotal = list.rows.reduce((s, p) => s + Number(p.amount), 0);
  return (
    <>
      <PageHead title="Payments" sub="Every payment recorded against approved compensation." />
      <div className="filters">
        <input type="search" placeholder="Search farmer, UTR, receipt" value={search} onChange={(e) => setSearch(e.target.value)} />
        <select value={mode} onChange={(e) => setMode(e.target.value)} aria-label="Mode">
          <option value="">Any mode</option>
          {meta?.payment_modes.map((m) => (
            <option key={m.value} value={m.value}>
              {m.label}
            </option>
          ))}
        </select>
        <label className="small muted">
          From <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} style={{ width: "auto" }} />
        </label>
        <label className="small muted">
          To <input type="date" value={to} onChange={(e) => setTo(e.target.value)} style={{ width: "auto" }} />
        </label>
        <span className="count">{list.count} payments</span>
      </div>
      <Panel pad={false}>
        {list.isLoading ? (
          <Loading />
        ) : !list.rows.length ? (
          <Empty title="No payments recorded">Payments are recorded from a compensation record once it is approved.</Empty>
        ) : (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Farmer</th>
                  <th>Towards</th>
                  <th>Mode</th>
                  <th>Reference</th>
                  <th>Recorded by</th>
                  <th className="num">Amount</th>
                </tr>
              </thead>
              <tbody>
                {list.rows.map((p) => (
                  <tr key={p.id} className="clickable" onClick={() => nav(`/compensation/${p.compensation}`)}>
                    <td className="nowrap">{fmtDate(p.payment_date)}</td>
                    <td>
                      <div style={{ fontWeight: 600 }}>{p.paid_to_name || p.payee_name}</div>
                      <div className="muted small">{p.payee_code}</div>
                    </td>
                    <td>
                      {p.compensation_category}
                      <div className="muted small">
                        {p.project_code}
                        {p.asset_number ? `, ${p.asset_number}` : ""}
                      </div>
                    </td>
                    <td>{label("payment_modes", p.mode)}</td>
                    <td className="small">{p.reference_number || "—"}</td>
                    <td className="small muted">{p.created_by_name}</td>
                    <td className="num">
                      <Money v={p.amount} />
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={6}>Total on this page</td>
                  <td className="num">
                    <Money v={pageTotal} />
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
        <Pager page={list.page} count={list.count} pageSize={list.pageSize} onPage={list.setPage} />
      </Panel>
    </>
  );
}
