import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router-dom";
import { api, qs } from "../api";
import { Corridor } from "../components/Progress";
import { fmtDate, Loading, money, PageHead, Panel } from "../components/ui";
import { useAuth, useLabel, useProject } from "../state";
import type { Asset, Paged } from "../types";

type Dash = {
  project_count: number;
  farmers: number;
  farmers_kyc_done: number;
  survey_numbers: number;
  assets: number;
  assets_by_type: Record<string, number>;
  assets_with_gps: number;
  agreements_executed: number;
  agreements_pending: number;
  crop_claims: number;
  stages: { code: string; name: string; completed: number; total: number }[];
  row_cleared: number;
  row_cleared_percent: number;
  compensation?: { approved: number; paid: number; balance: number; proposed: number };
  compensation_by_category?: { category: string; approved: number }[];
  recent_payments?: { id: string; date: string; amount: number; farmer: string; farmer_code: string; project: string; mode: string; reference: string }[];
  projects: {
    id: string;
    code: string;
    name: string;
    project_type: string;
    voltage_level: string;
    assets: number;
    row_cleared: number;
    stage_counts: Record<string, number>;
    compensation?: { approved: number; paid: number; balance: number };
  }[];
};

const SHORT: Record<string, string> = {
  SURVEYED: "Surveyed",
  KYC: "KYC",
  AGREEMENT: "Agreement",
  PAYMENT: "Payment",
  ERECTION: "Erection",
  STRINGING: "Stringing",
  STAYWIRE: "Staywire",
};

export default function Dashboard() {
  const { projectId, current, projects } = useProject();
  const { me } = useAuth();
  const label = useLabel();
  const nav = useNavigate();
  const { data, isLoading } = useQuery({ queryKey: ["dashboard", projectId], queryFn: () => api<Dash>(`dashboard/${qs({ project: projectId })}`) });
  const { data: assets } = useQuery({
    queryKey: ["assets", "corridor", projectId],
    queryFn: () => api<Paged<Asset>>(`assets/${qs({ project: projectId, page_size: 1000 })}`),
    enabled: !!projectId,
  });
  if (isLoading || !data) return <Loading />;
  const c = data.compensation;
  const paidPct = c && c.approved > 0 ? Math.round((100 * c.paid) / c.approved) : 0;
  const types = Object.entries(data.assets_by_type)
    .map(([t, n]) => `${n} ${label("asset_types", t).toLowerCase()}${n === 1 ? "" : "s"}`)
    .join(", ");

  return (
    <>
      <PageHead
        title={current ? current.name : "All projects"}
        sub={current ? `${current.code}, ${current.corridor || label("project_types", current.project_type)}` : `${projects.length} projects you can see. Welcome, ${me?.first_name || me?.display_name}.`}
      />

      <div className="ledger" style={{ marginBottom: 16 }}>
        <div>
          <div className="v">{data.farmers}</div>
          <div className="k">Farmers</div>
          <div className="s">KYC done for {data.farmers_kyc_done}</div>
        </div>
        <div>
          <div className="v">{data.survey_numbers}</div>
          <div className="k">Survey numbers</div>
        </div>
        <div>
          <div className="v">{data.assets}</div>
          <div className="k">Poles, towers & sites</div>
          <div className="s">{types || "None yet"}</div>
        </div>
        <div>
          <div className="v">{data.agreements_executed}</div>
          <div className="k">Agreements executed</div>
          <div className="s">{data.agreements_pending} pending</div>
        </div>
        <div>
          <div className="v">{data.crop_claims}</div>
          <div className="k">Crop claims</div>
        </div>
        <div>
          <div className="v">{data.row_cleared_percent}%</div>
          <div className="k">ROW cleared</div>
          <div className="s">
            {data.row_cleared} of {data.assets} locations with agreement and payment done
          </div>
        </div>
      </div>

      {current && assets && assets.results.length > 0 && (
        <Panel
          title="Line progress"
          actions={
            <Link to="/locations" className="btn btn-small">
              View all locations
            </Link>
          }
          className="mb"
        >
          <Corridor assets={assets.results} onSelect={(a) => nav(`/locations/${a.id}`)} stageNames={data.stages.map((s) => s.name)} />
        </Panel>
      )}

      <div className="grid-2" style={{ marginTop: 16 }}>
        <Panel title="Progress by stage">
          <div className="stage-bars">
            {data.stages.map((s) => {
              const pct = s.total ? (100 * s.completed) / s.total : 0;
              return (
                <Link key={s.code} to={`/locations?stage=${s.code}&done=false`} className="stage-bar" style={{ color: "inherit", textDecoration: "none" }} title={`Show locations where "${s.name}" is pending`}>
                  <span>{s.name}</span>
                  <span className="track">
                    <span className="fill" style={{ width: `${pct}%`, display: "block" }} />
                  </span>
                  <span className="n">
                    {s.completed} / {s.total}
                  </span>
                </Link>
              );
            })}
          </div>
          <p className="muted small" style={{ marginTop: 12, marginBottom: 0 }}>
            Select a stage to see the locations where it is still pending.
          </p>
        </Panel>

        {c ? (
          <Panel title="Compensation">
            <div className="money-row">
              <div>
                <div className="v">{money(c.approved)}</div>
                <div className="k">Approved</div>
              </div>
              <div>
                <div className="v" style={{ color: "var(--field)" }}>
                  {money(c.paid)}
                </div>
                <div className="k">Paid</div>
              </div>
              <div>
                <div className="v" style={{ color: c.balance > 0 ? "var(--phase-r)" : undefined }}>{money(c.balance)}</div>
                <div className="k">Balance to pay</div>
              </div>
            </div>
            <div className="paybar" aria-label={`${paidPct}% paid`}>
              <span style={{ width: `${paidPct}%` }} />
            </div>
            <div className="muted small">{paidPct}% of approved compensation paid</div>
            {c.proposed > 0 && (
              <p style={{ marginTop: 12 }}>
                <Link to="/compensation?status=PROPOSED">{money(c.proposed)} proposed</Link> <span className="muted">is waiting for approval.</span>
              </p>
            )}
            {data.compensation_by_category && data.compensation_by_category.length > 0 && (
              <table className="data" style={{ marginTop: 12 }}>
                <tbody>
                  {data.compensation_by_category.map((r) => (
                    <tr key={r.category}>
                      <td>{label("compensation_categories", r.category)}</td>
                      <td className="num">{money(r.approved)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Panel>
        ) : (
          <Panel title="Locations with GPS">
            <p>
              {data.assets_with_gps} of {data.assets} locations have GPS coordinates.
            </p>
            <Link to="/map" className="btn">
              Open map
            </Link>
          </Panel>
        )}
      </div>

      {!current && data.projects.length > 0 && (
        <Panel title="Projects" pad={false} className="mt">
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Project</th>
                  <th>Type</th>
                  <th className="num">Locations</th>
                  {data.stages.map((s) => (
                    <th key={s.code} className="num" title={s.name}>
                      {SHORT[s.code] ?? s.name}
                    </th>
                  ))}
                  {c && <th className="num">Balance to pay</th>}
                </tr>
              </thead>
              <tbody>
                {data.projects.map((p) => (
                  <tr key={p.id} className="clickable" onClick={() => nav(`/projects/${p.id}`)}>
                    <td style={{ minWidth: 220 }}>
                      <div className="id">{p.code}</div>
                      <div className="muted small">{p.name}</div>
                    </td>
                    <td className="nowrap">
                      {label("project_types", p.project_type)}
                      {p.voltage_level ? `, ${label("voltage_levels", p.voltage_level)}` : ""}
                    </td>
                    <td className="num">{p.assets}</td>
                    {data.stages.map((s) => (
                      <td key={s.code} className="num">
                        {p.assets ? `${Math.round((100 * (p.stage_counts[s.code] || 0)) / p.assets)}%` : "—"}
                      </td>
                    ))}
                    {c && <td className="num">{money(p.compensation?.balance)}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      )}

      {data.recent_payments && data.recent_payments.length > 0 && (
        <Panel title="Recently recorded payments" pad={false} className="mt" actions={<Link to="/payments" className="btn btn-small">All payments</Link>}>
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Farmer</th>
                  <th>Project</th>
                  <th>Mode</th>
                  <th>Reference</th>
                  <th className="num">Amount</th>
                </tr>
              </thead>
              <tbody>
                {data.recent_payments.map((p) => (
                  <tr key={p.id}>
                    <td className="nowrap">{fmtDate(p.date)}</td>
                    <td>
                      {p.farmer} <span className="muted small">{p.farmer_code}</span>
                    </td>
                    <td>{p.project}</td>
                    <td>{label("payment_modes", p.mode)}</td>
                    <td className="muted">{p.reference || "—"}</td>
                    <td className="num">{money(p.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      )}
    </>
  );
}
