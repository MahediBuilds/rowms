import { useMemo } from "react";
import type { Asset, Progress } from "../types";

/** Seven-segment progress strip: one segment per stage, in stage order. */
export function ProgressStrip({ progress, large, showPct = true }: { progress: Progress; large?: boolean; showPct?: boolean }) {
  const title = progress.stages.map((s) => `${s.completed ? "✓" : s.partial ? "◐" : "○"} ${s.name}${s.partial ? ` (${s.detail})` : ""}`).join("\n");
  return (
    <span className="nowrap" title={title} aria-label={`${progress.completed_count} of ${progress.total} stages complete`}>
      <span className={`strip ${large ? "lg" : ""}`}>
        {progress.stages.map((s) => (
          <i key={s.code} className={s.completed ? "done" : s.partial ? "part" : ""} />
        ))}
      </span>
      {showPct && (
        <span className="strip-pct">
          {progress.completed_count}/{progress.total}
        </span>
      )}
    </span>
  );
}

/** Colour for a location by number of stages complete (used on map + corridor). */
export function progressColor(done: number, total: number) {
  if (!total || done === 0) return "#9aa5a0";
  const r = done / total;
  if (r >= 1) return "#1f5a3e";
  if (r >= 0.7) return "#2e7d55";
  if (r >= 0.45) return "#6aa04a";
  if (r >= 0.25) return "#d9a21b";
  return "#d07a2a";
}

/**
 * Corridor view: the line drawn as a single-line diagram with every pole/tower
 * as a marker coloured by progress, so a whole route can be read at a glance.
 */
export function Corridor({ assets, onSelect, stageNames }: { assets: Asset[]; onSelect?: (a: Asset) => void; stageNames?: string[] }) {
  const items = useMemo(() => {
    const natural = (s: string) => s.replace(/\d+/g, (d) => d.padStart(6, "0"));
    return [...assets].sort((a, b) => natural(a.asset_number).localeCompare(natural(b.asset_number)));
  }, [assets]);
  if (!items.length) return null;
  const stages = items[0].progress.stages;
  const names = stageNames ?? stages.map((s) => s.name);
  const labelW = 200;
  const step = 44;
  const pad = 26;
  const width = Math.max(320, pad * 2 + step * (items.length - 1));
  const lineY = 46;
  const rowH = 15;
  const rowsTop = lineY + 24;
  const height = rowsTop + stages.length * rowH + 6;
  return (
    <div className="corridor">
      <svg className="corridor-labels" width={labelW} height={height} aria-hidden="true">
        {names.map((n, si) => (
          <g key={n}>
            <rect x={0} y={rowsTop + si * rowH - 2} width={labelW} height={rowH} fill={si % 2 ? "#f6f8f5" : "transparent"} />
            <text x={0} y={rowsTop + si * rowH + 9} fontSize={12} fill="#3c4c57">
              {n}
            </text>
          </g>
        ))}
        <text x={0} y={lineY + 4} fontSize={12} fill="#5e6b73">
          Route ({items.length})
        </text>
      </svg>
      <div className="corridor-scroll">
        <svg width={width} height={height} role="img" aria-label="Line progress: each column is a pole or tower, each row a stage">
          {names.map((n, si) => (
            <rect key={n} x={0} y={rowsTop + si * rowH - 2} width={width} height={rowH} fill={si % 2 ? "#f6f8f5" : "transparent"} />
          ))}
          <line x1={pad - 16} x2={width - pad + 16} y1={lineY} y2={lineY} stroke="#18242E" strokeWidth={2} />
          {items.map((a, i) => {
            const x = pad + i * step;
            const p = a.progress;
            const color = progressColor(p.completed_count, p.total);
            const tower = a.asset_type === "TOWER";
            const boxy = a.asset_type === "SUBSTATION" || a.asset_type === "ACCESS_ROAD";
            return (
              <g key={a.id} transform={`translate(${x},0)`} style={{ cursor: onSelect ? "pointer" : "default" }} onClick={() => onSelect?.(a)}>
                <title>{`${a.asset_number}: ${p.completed_count} of ${p.total} stages done${p.latest_completed ? ` (latest: ${p.latest_completed})` : ""}`}</title>
                <rect x={-step / 2} y={0} width={step} height={height} fill="transparent" />
                <text x={0} y={16} textAnchor="middle" fontSize={11} fill="#3c4c57" fontWeight={600}>
                  {a.asset_number.length > 7 ? a.asset_number.slice(0, 6) + "…" : a.asset_number}
                </text>
                {boxy ? (
                  <rect x={-8} y={lineY - 8} width={16} height={16} fill={color} stroke="#18242E" strokeWidth={1.5} />
                ) : tower ? (
                  <path d={`M0 ${lineY - 12} L10 ${lineY + 8} L-10 ${lineY + 8} Z`} fill={color} stroke="#18242E" strokeWidth={1.5} strokeLinejoin="round" />
                ) : (
                  <circle cx={0} cy={lineY} r={8} fill={color} stroke="#18242E" strokeWidth={1.5} />
                )}
                {p.stages.map((st, si) => {
                  const fill = st.completed ? "#2e6a4f" : st.partial ? "#d9a21b" : "#dde3dd";
                  return <rect key={st.code} x={-9} y={rowsTop + si * rowH} width={18} height={10} rx={2} fill={fill} />;
                })}
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}
