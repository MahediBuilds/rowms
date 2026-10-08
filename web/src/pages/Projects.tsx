import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Pencil, Plus } from "lucide-react";
import { api } from "../api";
import { FieldDef, FormModal } from "../components/Form";
import { Corridor } from "../components/Progress";
import { Badge, Empty, Facts, fmtDate, Loading, money, PageHead, Panel } from "../components/ui";
import { useSaver } from "../hooks";
import { useAuth, useLabel, useProject } from "../state";
import type { Asset, Paged, Project } from "../types";

const projectFields: FieldDef[] = [
  { name: "code", label: "Project code", required: true, hint: "Short unique code, e.g. KPL-SOL-33KV" },
  { name: "name", label: "Project name", required: true },
  { name: "developer", label: "Developer / client" },
  { name: "project_type", label: "Project type", type: "select", options: "project_types", required: true },
  { name: "voltage_level", label: "Voltage", type: "select", options: "voltage_levels", blank: "Not applicable" },
  { name: "status", label: "Status", type: "select", options: "project_statuses", required: true },
  { name: "corridor", label: "Corridor / route", span: 2 },
  { name: "district", label: "District" },
  { name: "taluk", label: "Taluk" },
  { name: "start_date", label: "Start date", type: "date" },
  { name: "description", label: "Description", type: "textarea", span: 2 },
];

const STATUS_TONE: Record<string, "green" | "yellow" | "grey" | "blue"> = { ACTIVE: "green", PLANNING: "blue", ON_HOLD: "yellow", COMPLETED: "grey" };

export function Projects() {
  const { can } = useAuth();
  const label = useLabel();
  const nav = useNavigate();
  const save = useSaver();
  const { projects } = useProject();
  const [adding, setAdding] = useState(false);
  return (
    <>
      <PageHead
        title="Projects"
        sub="Solar, wind, transmission and substation projects you are assigned to."
        actions={
          can("project", "write") && (
            <button className="btn btn-primary" onClick={() => setAdding(true)}>
              <Plus /> New project
            </button>
          )
        }
      />
      <Panel pad={false}>
        {!projects.length ? (
          <Empty title="No projects yet">An administrator creates projects and assigns users to them.</Empty>
        ) : (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Project</th>
                  <th>Type</th>
                  <th>Developer</th>
                  <th>District</th>
                  <th className="num">Locations</th>
                  <th className="num">Farmers</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {projects.map((p) => (
                  <tr key={p.id} className="clickable" onClick={() => nav(`/projects/${p.id}`)}>
                    <td>
                      <div className="id">{p.code}</div>
                      <div className="muted small">{p.name}</div>
                    </td>
                    <td>
                      {label("project_types", p.project_type)}
                      {p.voltage_level && <div className="muted small">{label("voltage_levels", p.voltage_level)}</div>}
                    </td>
                    <td>{p.developer || "—"}</td>
                    <td>{[p.taluk, p.district].filter(Boolean).join(", ") || "—"}</td>
                    <td className="num">{p.asset_count}</td>
                    <td className="num">{p.farmer_count}</td>
                    <td>
                      <Badge tone={STATUS_TONE[p.status]}>{label("project_statuses", p.status)}</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
      {adding && (
        <FormModal
          title="New project"
          fields={projectFields}
          initial={{ project_type: "TRANSMISSION", status: "ACTIVE", voltage_level: "", state: "Karnataka" }}
          onClose={() => setAdding(false)}
          onSubmit={async (v) => {
            const p = await save("projects", null, v, "Project created");
            setAdding(false);
            nav(`/projects/${p.id}`);
          }}
        />
      )}
    </>
  );
}

export function ProjectDetail() {
  const { id } = useParams();
  const { can } = useAuth();
  const label = useLabel();
  const nav = useNavigate();
  const save = useSaver();
  const { projectId, setProjectId } = useProject();
  const [editing, setEditing] = useState(false);
  const { data: p, isLoading } = useQuery({ queryKey: ["projects", "one", id], queryFn: () => api<Project>(`projects/${id}/`) });
  const { data: sum } = useQuery({ queryKey: ["dashboard", "project", id], queryFn: () => api<any>(`projects/${id}/summary/`) });
  const { data: assets } = useQuery({ queryKey: ["assets", "corridor", id], queryFn: () => api<Paged<Asset>>(`assets/?project=${id}&page_size=1000`) });
  if (isLoading || !p) return <Loading />;
  return (
    <>
      <PageHead
        crumb={<Link to="/projects">Projects</Link>}
        title={p.name}
        sub={
          <>
            {p.code}, {label("project_types", p.project_type)}
            {p.voltage_level ? ` ${label("voltage_levels", p.voltage_level)}` : ""} <Badge tone={STATUS_TONE[p.status]}>{label("project_statuses", p.status)}</Badge>
          </>
        }
        actions={
          <>
            {projectId !== p.id && (
              <button className="btn" onClick={() => setProjectId(p.id)}>
                Work in this project
              </button>
            )}
            {can("project", "write") && (
              <button className="btn" onClick={() => setEditing(true)}>
                <Pencil /> Edit
              </button>
            )}
          </>
        }
      />
      {sum && (
        <div className="ledger" style={{ marginBottom: 16 }}>
          <div>
            <div className="v">{sum.farmers}</div>
            <div className="k">Farmers</div>
          </div>
          <div>
            <div className="v">{sum.survey_numbers}</div>
            <div className="k">Survey numbers</div>
          </div>
          <div>
            <div className="v">{sum.assets}</div>
            <div className="k">Locations</div>
          </div>
          <div>
            <div className="v">{sum.agreements_executed}</div>
            <div className="k">Agreements executed</div>
            <div className="s">{sum.agreements_pending} pending</div>
          </div>
          <div>
            <div className="v">{sum.compensation ? money(sum.compensation.balance) : sum.crop_claims}</div>
            <div className="k">{sum.compensation ? "Balance to pay" : "Crop claims"}</div>
          </div>
          <div>
            <div className="v">{sum.row_cleared_percent}%</div>
            <div className="k">ROW cleared</div>
          </div>
        </div>
      )}
      <Panel title="Line progress">
        {assets?.results.length ? (
          <Corridor assets={assets.results} onSelect={(a) => nav(`/locations/${a.id}`)} />
        ) : (
          <Empty title="No locations yet">Import a KML file or add poles and towers from the Poles & towers page.</Empty>
        )}
      </Panel>
      <Panel title="About this project" className="mt">
        <Facts
          items={[
            ["Developer / client", p.developer],
            ["Corridor", p.corridor],
            ["District", [p.taluk, p.district].filter(Boolean).join(", ")],
            ["Start date", p.start_date ? fmtDate(p.start_date) : null],
            ["Description", p.description],
          ]}
        />
      </Panel>
      {editing && (
        <FormModal
          title={`Edit ${p.code}`}
          fields={projectFields}
          initial={p}
          onClose={() => setEditing(false)}
          onSubmit={async (v) => {
            await save("projects", p.id, v, "Project updated");
            setEditing(false);
          }}
        />
      )}
    </>
  );
}
