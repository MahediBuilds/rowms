import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { CircleMarker, GeoJSON, LayersControl, MapContainer, Popup, TileLayer, useMap } from "react-leaflet";
import L from "leaflet";
import { api, qs } from "../api";
import { TILE_ATTRIB, TILE_URL } from "../components/MiniMap";
import { progressColor } from "../components/Progress";
import { Loading, PageHead } from "../components/ui";
import { useLabel, useMeta, useProject } from "../state";

type Feature = { type: "Feature"; geometry: any; properties: any };
type FC = { type: "FeatureCollection"; features: Feature[]; stages: { code: string; name: string }[] };

function FitBounds({ features }: { features: Feature[] }) {
  const map = useMap();
  useEffect(() => {
    const pts: [number, number][] = [];
    for (const f of features) {
      const g = f.geometry;
      if (g.type === "Point") pts.push([g.coordinates[1], g.coordinates[0]]);
      else if (g.type === "LineString") g.coordinates.forEach((c: number[]) => pts.push([c[1], c[0]]));
      else if (g.type === "MultiLineString") g.coordinates.flat().forEach((c: number[]) => pts.push([c[1], c[0]]));
    }
    if (pts.length) map.fitBounds(L.latLngBounds(pts), { padding: [40, 40], maxZoom: 16 });
  }, [features, map]);
  return null;
}

export default function MapPage() {
  const { projectId } = useProject();
  const meta = useMeta();
  const label = useLabel();
  const [colorBy, setColorBy] = useState("");
  const [only, setOnly] = useState<"" | "true" | "false">("");
  const params = { project: projectId, stage: colorBy && only ? colorBy : undefined, stage_done: colorBy && only ? only : undefined };
  const { data, isLoading } = useQuery({ queryKey: ["map", params], queryFn: () => api<FC>(`map/${qs(params)}`) });
  const features = data?.features || [];
  const assets = useMemo(() => features.filter((f) => f.properties.kind === "asset"), [features]);
  const lands = useMemo(() => features.filter((f) => f.properties.kind === "land" && f.geometry.type !== "Point"), [features]);
  const routes = useMemo(() => features.filter((f) => f.properties.kind === "route"), [features]);
  const stageCount = meta?.stages.length || 7;
  const colorFor = (p: any) => {
    if (!colorBy) return progressColor(p.completed.length, stageCount);
    return p.completed.includes(colorBy) ? "#2e6a4f" : "#b83b32";
  };
  const stageName = meta?.stages.find((s) => s.code === colorBy)?.name;

  return (
    <>
      <PageHead
        title="Map"
        sub={`${assets.length} locations with GPS${lands.length ? `, ${lands.length} land boundaries` : ""}. Select a marker for the farmer, survey number and progress.`}
        actions={
          <div className="filters" style={{ margin: 0 }}>
            <select value={colorBy} onChange={(e) => setColorBy(e.target.value)} aria-label="Colour markers by">
              <option value="">Colour by overall progress</option>
              {meta?.stages.map((s) => (
                <option key={s.code} value={s.code}>
                  Colour by: {s.name}
                </option>
              ))}
            </select>
            {colorBy && (
              <span className="seg">
                <button className={only === "" ? "on" : ""} onClick={() => setOnly("")}>
                  All
                </button>
                <button className={only === "false" ? "on" : ""} onClick={() => setOnly("false")}>
                  Pending
                </button>
                <button className={only === "true" ? "on" : ""} onClick={() => setOnly("true")}>
                  Done
                </button>
              </span>
            )}
          </div>
        }
      />
      <div className="map-wrap">
        {isLoading ? (
          <Loading />
        ) : (
          <MapContainer center={[15.4, 76.0]} zoom={9} preferCanvas>
            <LayersControl position="topright">
              <LayersControl.BaseLayer checked name="Street map">
                <TileLayer url={TILE_URL} attribution={TILE_ATTRIB} />
              </LayersControl.BaseLayer>
              <LayersControl.BaseLayer name="Satellite (Esri)">
                <TileLayer url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}" attribution="Imagery &copy; Esri" />
              </LayersControl.BaseLayer>
              <LayersControl.Overlay checked name="Routes">
                <GeoJSON key={`r-${routes.length}-${projectId}`} data={{ type: "FeatureCollection", features: routes } as any} style={{ color: "#18242E", weight: 3, dashArray: "6 5" }} />
              </LayersControl.Overlay>
              <LayersControl.Overlay checked name="Land boundaries">
                <GeoJSON
                  key={`l-${lands.length}-${projectId}`}
                  data={{ type: "FeatureCollection", features: lands } as any}
                  style={{ color: "#2b5ba6", weight: 1.5, fillOpacity: 0.06 }}
                  onEachFeature={(f, layer) => layer.bindTooltip(`Sy.No. ${f.properties.survey}, ${f.properties.village}${f.properties.owners?.length ? `: ${f.properties.owners.join(", ")}` : ""}`)}
                />
              </LayersControl.Overlay>
            </LayersControl>
            {assets.map((f) => {
              const p = f.properties;
              const [lng, lat] = f.geometry.coordinates;
              return (
                <CircleMarker key={p.id} center={[lat, lng]} radius={p.asset_type === "TOWER" ? 8 : 6.5} pathOptions={{ color: "#18242E", weight: 1.5, fillColor: colorFor(p), fillOpacity: 1 }}>
                  <Popup>
                    <h4>
                      {label("asset_types", p.asset_type)} {p.asset_number}
                    </h4>
                    <div className="muted">
                      {p.project_code}
                      {p.line_name ? `, ${p.line_name}` : ""}
                    </div>
                    {p.survey && (
                      <div>
                        Sy.No. {p.survey}, {p.village}
                      </div>
                    )}
                    <div>{p.farmers.length ? p.farmers.map((x: any) => x.name).join(", ") : <span className="muted">No farmer linked</span>}</div>
                    <div style={{ margin: "6px 0" }}>
                      <span className="strip">
                        {(meta?.stages || []).map((s) => (
                          <i key={s.code} className={p.completed.includes(s.code) ? "done" : ""} title={s.name} />
                        ))}
                      </span>{" "}
                      <span className="muted small">{p.latest ? `Latest: ${p.latest}` : "Not started"}</span>
                    </div>
                    <Link to={`/locations/${p.id}`}>Open location</Link>
                  </Popup>
                </CircleMarker>
              );
            })}
            <FitBounds features={features} />
          </MapContainer>
        )}
        <div className="map-legend" aria-label="Legend">
          {colorBy ? (
            <>
              <strong>{stageName}</strong>
              <div>
                <span className="dot" style={{ background: "#2e6a4f" }} /> Done
              </div>
              <div>
                <span className="dot" style={{ background: "#b83b32" }} /> Pending
              </div>
            </>
          ) : (
            <>
              <strong>Stages done</strong>
              {[
                [0, "None"],
                [1, "1"],
                [3, "2–3"],
                [4, "4"],
                [6, "5–6"],
                [7, "All 7"],
              ].map(([n, t]) => (
                <div key={t}>
                  <span className="dot" style={{ background: progressColor(n as number, 7) }} /> {t}
                </div>
              ))}
            </>
          )}
        </div>
      </div>
    </>
  );
}
