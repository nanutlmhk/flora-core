import type { TimeGridValues } from "../../components/timegrid/types";
import type { ReportChartVisibility } from "./types";

type Props = {
  axis: number[];
  values: TimeGridValues;
  colWidth: number;
  labelColWidth: number;
  height?: number;
  visible?: ReportChartVisibility;
  onToggle?: (series: keyof ReportChartVisibility) => void;
};

type XY = {
  ts: number;
  x: number;
  y: number;
};

const CHART_MIN = 0;
const CHART_MAX = 200;
const CHART_PADDING_Y = 8;
const GRID_STROKE = "var(--chart-grid-line)";
const SPO2_COLOR = "var(--chart-spo2)";
const HR_COLOR = "var(--chart-hr)";
const NIBP_COLOR = "var(--chart-nibp)";
const ART_COLOR = "var(--chart-art)";
const CVP_COLOR = "var(--chart-cvp)";

function toNumber(value: unknown): number | undefined {
  if (value == null || value === "") return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

function buildPath(points: XY[]): string {
  if (points.length < 2) return "";
  return points.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`).join(" ");
}

function splitByGap(points: XY[], maxGapMs: number): XY[][] {
  if (points.length === 0) return [];
  const parts: XY[][] = [[points[0]]];
  for (let i = 1; i < points.length; i += 1) {
    const prev = points[i - 1];
    const curr = points[i];
    if (curr.ts - prev.ts > maxGapMs) {
      parts.push([curr]);
    } else {
      parts[parts.length - 1].push(curr);
    }
  }
  return parts;
}

type Connector = { key: string; x: number; yMin: number; yMax: number };
function buildConnectors(label: string, a: XY[], b: XY[], c: XY[]): Connector[] {
  const byTs = new Map<number, { x: number; ys: number[] }>();
  const add = (point: XY) => {
    const current = byTs.get(point.ts);
    if (current) {
      current.ys.push(point.y);
      return;
    }
    byTs.set(point.ts, { x: point.x, ys: [point.y] });
  };
  a.forEach(add);
  b.forEach(add);
  c.forEach(add);

  const out: Connector[] = [];
  for (const [ts, value] of byTs.entries()) {
    if (value.ys.length < 2) continue;
    out.push({
      key: `${label}-${ts}`,
      x: value.x,
      yMin: Math.min(...value.ys),
      yMax: Math.max(...value.ys),
    });
  }
  return out;
}

function TriangleUp({ x, y, color }: { x: number; y: number; color: string }) {
  return <path d={`M ${x} ${y - 3} L ${x - 3} ${y + 3} L ${x + 3} ${y + 3} Z`} fill={color} />;
}

function TriangleDown({ x, y, color }: { x: number; y: number; color: string }) {
  return <path d={`M ${x} ${y + 3} L ${x - 3} ${y - 3} L ${x + 3} ${y - 3} Z`} fill={color} />;
}

function Dot({ x, y, color }: { x: number; y: number; color: string }) {
  return <circle cx={x} cy={y} r={2} fill={color} />;
}

export default function ReportTimeChart({
  axis,
  values,
  colWidth,
  labelColWidth,
  height = 92,
  visible = { spo2: true, hr: true, nibp: true, art: true, cvp: true },
  onToggle,
}: Props) {
  if (axis.length === 0) return null;
  const stepMs = axis.length > 1 ? Math.max(1, axis[1] - axis[0]) : 60_000;
  const startTs = axis[0];
  const endExclusiveTs = axis[axis.length - 1] + stepMs;
  const chartWidth = axis.length * colWidth;
  const totalWidth = labelColWidth + chartWidth;
  const innerHeight = Math.max(0, height - CHART_PADDING_Y * 2);

  const yFor = (value: number) => {
    const clamped = Math.min(CHART_MAX, Math.max(CHART_MIN, value));
    return CHART_PADDING_Y + ((CHART_MAX - clamped) / (CHART_MAX - CHART_MIN)) * innerHeight;
  };

  const xForTs = (ts: number) => ((ts - startTs) / stepMs) * colWidth;

  const pointsFor = (key: string): XY[] => {
    const row = values[key];
    if (!row) return [];
    return Object.entries(row)
      .map(([tsKey, raw]) => ({ ts: Number(tsKey), value: toNumber(raw) }))
      .filter(
        (point): point is { ts: number; value: number } =>
          Number.isFinite(point.ts) &&
          point.value != null &&
          point.ts >= startTs &&
          point.ts < endExclusiveTs,
      )
      .sort((a, b) => a.ts - b.ts)
      .map(point => ({ ts: point.ts, x: xForTs(point.ts), y: yFor(point.value) }));
  };

  const spo2 = pointsFor("spo2");
  const hr = pointsFor("hr");
  const nibpSys = pointsFor("nibp_sys");
  const nibpMap = pointsFor("nibp_map");
  const nibpDia = pointsFor("nibp_dia");
  const artSys = pointsFor("art_sys");
  const artMap = pointsFor("art_map");
  const artDia = pointsFor("art_dia");
  const cvp = pointsFor("cvp");

  const hrSegments = splitByGap(hr, 10 * 60_000);
  const nibpConnectors = buildConnectors("nibp", nibpSys, nibpMap, nibpDia);
  const artConnectors = buildConnectors("art", artSys, artMap, artDia);
  const hasSpO2 = Boolean(values.spo2);
  const hasHr = Boolean(values.hr);
  const hasNibp = Boolean(values.nibp_sys || values.nibp_map || values.nibp_dia);
  const hasArt = Boolean(values.art_sys || values.art_map || values.art_dia);
  const hasCvp = Boolean(values.cvp);
  const canToggle = typeof onToggle === "function";
  const makeToggleClass = (enabled: boolean, hasData: boolean) =>
    `report-chart-toggle ${enabled ? "is-on" : "is-off"} ${hasData ? "" : "is-empty"} ${canToggle ? "is-clickable" : ""}`;

  return (
    <div className="report-chart report-surface border-x border-t report-border" style={{ width: totalWidth, minWidth: totalWidth }}>
      <div style={{ display: "grid", gridTemplateColumns: `${labelColWidth}px ${chartWidth}px` }}>
        <div className="border-r report-border px-2 py-2 text-[10px] leading-4 report-cell-text">
          <div className={makeToggleClass(visible.spo2, hasSpO2)} onClick={() => onToggle?.("spo2")} role={canToggle ? "button" : undefined}>
            <span className="report-chart-checkbox">{visible.spo2 ? "✓" : ""}</span>
            <span>SpO2</span>
          </div>
          <div className={makeToggleClass(visible.hr, hasHr)} onClick={() => onToggle?.("hr")} role={canToggle ? "button" : undefined}>
            <span className="report-chart-checkbox">{visible.hr ? "✓" : ""}</span>
            <span>HR / Pulse</span>
          </div>
          <div className={makeToggleClass(visible.nibp, hasNibp)} onClick={() => onToggle?.("nibp")} role={canToggle ? "button" : undefined}>
            <span className="report-chart-checkbox">{visible.nibp ? "✓" : ""}</span>
            <span>NIBP</span>
          </div>
          <div className={makeToggleClass(visible.art, hasArt)} onClick={() => onToggle?.("art")} role={canToggle ? "button" : undefined}>
            <span className="report-chart-checkbox">{visible.art ? "✓" : ""}</span>
            <span>ART</span>
          </div>
          <div className={makeToggleClass(visible.cvp, hasCvp)} onClick={() => onToggle?.("cvp")} role={canToggle ? "button" : undefined}>
            <span className="report-chart-checkbox">{visible.cvp ? "✓" : ""}</span>
            <span>CVP</span>
          </div>
        </div>
        <svg width={chartWidth} height={height} className="block">
          {Array.from({ length: axis.length + 1 }, (_, i) => (
            <line
              key={i}
              x1={i * colWidth}
              y1={0}
              x2={i * colWidth}
              y2={height}
              stroke={GRID_STROKE}
              strokeWidth={1}
            />
          ))}

          {visible.spo2 && spo2.length > 1 ? <path d={buildPath(spo2)} fill="none" stroke={SPO2_COLOR} strokeWidth={1} /> : null}
          {visible.spo2 ? spo2.map(point => <Dot key={`spo2-${point.ts}`} x={point.x} y={point.y} color={SPO2_COLOR} />) : null}

          {visible.hr ? hrSegments.map(segment =>
            segment.length > 1 ? (
              <path key={`hr-${segment[0].ts}`} d={buildPath(segment)} fill="none" stroke={HR_COLOR} strokeWidth={0.9} />
            ) : null,
          ) : null}
          {visible.hr ? hr.map(point => <Dot key={`hr-dot-${point.ts}`} x={point.x} y={point.y} color={HR_COLOR} />) : null}

          {visible.nibp ? nibpConnectors.map(line => (
            <line key={line.key} x1={line.x} y1={line.yMin} x2={line.x} y2={line.yMax} stroke={NIBP_COLOR} strokeWidth={0.9} />
          )) : null}
          {visible.nibp ? nibpSys.map(point => <TriangleDown key={`nibp-s-${point.ts}`} x={point.x} y={point.y} color={NIBP_COLOR} />) : null}
          {visible.nibp ? nibpMap.map(point => <Dot key={`nibp-m-${point.ts}`} x={point.x} y={point.y} color={NIBP_COLOR} />) : null}
          {visible.nibp ? nibpDia.map(point => <TriangleUp key={`nibp-d-${point.ts}`} x={point.x} y={point.y} color={NIBP_COLOR} />) : null}

          {visible.art ? artConnectors.map(line => (
            <line key={line.key} x1={line.x} y1={line.yMin} x2={line.x} y2={line.yMax} stroke={ART_COLOR} strokeWidth={0.9} />
          )) : null}
          {visible.art ? artSys.map(point => <TriangleDown key={`art-s-${point.ts}`} x={point.x} y={point.y} color={ART_COLOR} />) : null}
          {visible.art ? artMap.map(point => <Dot key={`art-m-${point.ts}`} x={point.x} y={point.y} color={ART_COLOR} />) : null}
          {visible.art ? artDia.map(point => <TriangleUp key={`art-d-${point.ts}`} x={point.x} y={point.y} color={ART_COLOR} />) : null}

          {visible.cvp ? cvp.map(point => <Dot key={`cvp-${point.ts}`} x={point.x} y={point.y} color={CVP_COLOR} />) : null}
        </svg>
      </div>
    </div>
  );
}
