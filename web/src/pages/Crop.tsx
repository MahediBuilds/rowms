import { useState } from "react";
import { Link } from "react-router-dom";
import { Pencil, Plus } from "lucide-react";
import { Documents } from "../components/Documents";
import { FieldDef, FormModal, REFS } from "../components/Form";
import { coords, Empty, Facts, fmtDate, Loading, Modal, Money, PageHead, Pager, Panel, today } from "../components/ui";
import { useDebounced, useList, useSaver } from "../hooks";
import { useAuth, useLabel, useMeta, useProject } from "../state";
import type { CropAssessment } from "../types";

function cropFields(projects: { id: string; code: string; name: string }[], projectId?: string): FieldDef[] {
  const p = projectId ? { project: projectId } : {};
  return [
    { name: "project", label: "Project", type: "select", required: true, options: projects.map((x) => ({ value: x.id, label: `${x.code} - ${x.name}` })) },
    { name: "assessment_date", label: "Assessment date", type: "date" },
    { name: "farmer", label: "Farmer", type: "ref", ref: { ...REFS.farmer, params: p }, required: true, span: 2 },
    { name: "land_parcel", label: "Land (survey number)", type: "ref", ref: { ...REFS.land, params: p } },
    { name: "asset", label: "Pole / tower", type: "ref", ref: { ...REFS.asset, params: p } },
    { name: "crop_type", label: "Crop", required: true, hint: "For example maize, groundnut, cotton" },
    { name: "season", label: "Season", type: "select", options: "crop_seasons" },
    { name: "crop_area_acres", label: "Affected area (acres)", type: "number" },
    { name: "crop_stage", label: "Crop stage", type: "select", options: "crop_stages" },
    { name: "field_inspection_notes", label: "Field inspection notes", type: "textarea", span: 2 },
    { name: "revenue_assessment", label: "Revenue department assessment (₹)", type: "number" },
    { name: "company_assessment", label: "Company assessment (₹)", type: "number" },
    { name: "latitude", label: "Latitude", type: "number", step: "0.0000001" },
    { name: "longitude", label: "Longitude", type: "number", step: "0.0000001" },
  ];
}

export function CropList() {
  const { can } = useAuth();
  const meta = useMeta();
  const label = useLabel();
  const { projects, projectId } = useProject();
  const [search, setSearch] = useState("");
  const [season, setSeason] = useState("");
  const q = useDebounced(search);
  const list = useList<CropAssessment>("crop-assessments", { search: q, season, ordering: "-assessment_date" });
  const save = useSaver();
  const [editing, setEditing] = useState<CropAssessment | "new" | null>(null);
  const [open, setOpen] = useState<CropAssessment | null>(null);
  return (
    <>
      <PageHead
        title="Crop assessments"
        sub="Field inspections of crop damage, with revenue and company assessments."
        actions={
          can("crop", "write") && (
            <button className="btn btn-primary" onClick={() => setEditing("new")}>
              <Plus /> New assessment
            </button>
          )
        }
      />
      <div className="filters">
        <input type="search" placeholder="Search crop, farmer, survey no., pole" value={search} onChange={(e) => setSearch(e.target.value)} />
        <select value={season} onChange={(e) => setSeason(e.target.value)} aria-label="Season">
          <option value="">Any season</option>
          {meta?.crop_seasons.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
        <span className="count">{list.count} assessments</span>
      </div>
      <Panel pad={false}>
        {list.isLoading ? (
          <Loading />
        ) : !list.rows.length ? (
          <Empty title="No crop assessments yet" />
        ) : (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Farmer</th>
                  <th>Crop</th>
                  <th>Land / location</th>
                  <th className="num">Area (acres)</th>
                  <th className="num">Revenue</th>
                  <th className="num">Company</th>
                  {can("compensation") && <th className="num">Approved / paid</th>}
                </tr>
              </thead>
              <tbody>
                {list.rows.map((c) => (
                  <tr key={c.id} className="clickable" onClick={() => setOpen(c)}>
                    <td className="nowrap">{fmtDate(c.assessment_date)}</td>
                    <td>
                      <div style={{ fontWeight: 600 }}>{c.farmer_name}</div>
                      <div className="muted small">{c.farmer_code}</div>
                    </td>
                    <td>
                      {c.crop_type}
                      <div className="muted small">{[label("crop_seasons", c.season), label("crop_stages", c.crop_stage)].filter(Boolean).join(", ")}</div>
                    </td>
                    <td className="small">
                      {c.land_label}
                      {c.asset_number && <div className="muted">{c.asset_number}</div>}
                    </td>
                    <td className="num">{c.crop_area_acres ?? "—"}</td>
                    <td className="num">
                      <Money v={c.revenue_assessment} />
                    </td>
                    <td className="num">
                      <Money v={c.company_assessment} />
                    </td>
                    {can("compensation") && (
                      <td className="num small">
                        {c.compensation_summary && c.compensation_summary.approved > 0 ? (
                          <>
                            <Money v={c.compensation_summary.approved} />
                            <div className="muted">
                              paid <Money v={c.compensation_summary.paid} />
                            </div>
                          </>
                        ) : (
                          <span className="muted">Not approved</span>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <Pager page={list.page} count={list.count} pageSize={list.pageSize} onPage={list.setPage} />
      </Panel>
      {open && (
        <Modal
          title={`${open.crop_type}: ${open.farmer_name}`}
          onClose={() => setOpen(null)}
          footer={
            can("crop", "write") && (
              <button
                className="btn"
                onClick={() => {
                  setEditing(open);
                  setOpen(null);
                }}
              >
                <Pencil /> Edit
              </button>
            )
          }
        >
          <Facts
            items={[
              ["Farmer", <Link to={`/farmers/${open.farmer}`}>{open.farmer_name} ({open.farmer_code})</Link>],
              ["Project", open.project_code],
              ["Assessed on", fmtDate(open.assessment_date)],
              ["Land", open.land_label],
              ["Location", open.asset_number],
              ["Season / stage", [label("crop_seasons", open.season), label("crop_stages", open.crop_stage)].filter(Boolean).join(", ")],
              ["Area", open.crop_area_acres !== null ? `${open.crop_area_acres} acres` : null],
              ["Revenue assessment", <Money v={open.revenue_assessment} />],
              ["Company assessment", <Money v={open.company_assessment} />],
              ["GPS", coords(open.latitude, open.longitude)],
              ["Inspection notes", open.field_inspection_notes],
            ]}
          />
          <h4 style={{ margin: "18px 0 10px" }}>Photos</h4>
          <Documents filter={{ crop_assessment: open.id }} categories={["CROP_PHOTO", "SITE_PHOTO", "OTHER"]} defaultCategory="CROP_PHOTO" compact />
        </Modal>
      )}
      {editing && (
        <FormModal
          title={editing === "new" ? "New crop assessment" : "Edit crop assessment"}
          fields={cropFields(projects, editing === "new" ? projectId : editing.project)}
          initial={editing === "new" ? { project: projectId || projects[0]?.id, assessment_date: today() } : editing}
          onClose={() => setEditing(null)}
          onSubmit={async (v) => {
            await save("crop-assessments", editing === "new" ? null : editing.id, v, "Crop assessment saved");
            setEditing(null);
          }}
        />
      )}
    </>
  );
}
