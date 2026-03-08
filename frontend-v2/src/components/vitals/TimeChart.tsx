import { useEffect, useState } from "react";
import type { TimeGridValues } from "../timegrid/types";
import { COL_WIDTH, LABEL_COL_WIDTH } from "../timegrid/layout";
import { useVirtualColumns } from "../../hooks/useVirtualColumns";

type VitalGroup = "spo2" | "hr" | "nibp" | "art" | "cvp" | "temp";

type VisibilityState = {
  spo2: boolean;
  hr: boolean;
  nibp: boolean;
  art: boolean;
  cvp: boolean;
  temp: boolean;
};

type XY = {
  ts: number;
  x: number;
  y: number;
  value: number;
};

type Props = {
  axis: number[];
  values: TimeGridValues;
  nowTs: number;
  height?: number;
  storageKey?: string;
  colWidth?: number;
  labelColWidth?: number;
  scrollLeft?: number;
  viewportWidth?: number;
};

const CHART_MIN = 0;
const CHART_MAX = 200;
const CHART_PADDING_Y = 10;
const NOW_HIGHLIGHT_STROKE = "var(--timegrid-now-line)";
const GRID_STROKE = "var(--chart-grid-line)";
const SPO2_COLOR = "var(--chart-spo2)";
const NIBP_COLOR = "var(--chart-nibp)";
const ART_COLOR = "var(--chart-art)";
const CVP_COLOR = "var(--chart-cvp)";
const TEMP_COLOR = "var(--chart-temp)";
const HR_COLOR = "var(--chart-hr)";
const MINUTE_MS = 60_000;
const LEGACY_STORAGE_KEY = "aidas.chartVisible";
const VITAL_LINE_STROKE = 1;
const CONNECTOR_LINE_STROKE = 0.9;
const DOT_RADIUS = 1.6;
const TRIANGLE_HALF_WIDTH = 3;
const TRIANGLE_HALF_HEIGHT = 3;
const Y_TICKS = [200, 180, 160, 140, 120, 100, 80, 60, 40, 20, 0];

const DEFAULT_VISIBILITY: VisibilityState = {
  spo2: true,
  hr: true,
  nibp: true,
  art: false,
  cvp: false,
  temp: false,
};

function parseVisibility(raw: string | null): VisibilityState | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<Record<VitalGroup, unknown>>;
    return {
      spo2: parsed.spo2 === undefined ? DEFAULT_VISIBILITY.spo2 : Boolean(parsed.spo2),
      hr: parsed.hr === undefined ? DEFAULT_VISIBILITY.hr : Boolean(parsed.hr),
      nibp: parsed.nibp === undefined ? DEFAULT_VISIBILITY.nibp : Boolean(parsed.nibp),
      art: parsed.art === undefined ? DEFAULT_VISIBILITY.art : Boolean(parsed.art),
      cvp: parsed.cvp === undefined ? DEFAULT_VISIBILITY.cvp : Boolean(parsed.cvp),
      temp: parsed.temp === undefined ? DEFAULT_VISIBILITY.temp : Boolean(parsed.temp),
    };
  } catch {
    return null;
  }
}

function readVisibility(storageKey?: string): VisibilityState {
  if (typeof window === "undefined") return DEFAULT_VISIBILITY;
  const keys = [storageKey, LEGACY_STORAGE_KEY].filter(Boolean) as string[];
  for (const key of keys) {
    const parsed = parseVisibility(window.localStorage.getItem(key));
    if (parsed) return parsed;
  }
  return DEFAULT_VISIBILITY;
}

function toNumber(value: unknown): number | undefined {
  if (value == null || value === "") return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

function buildPath(points: XY[]): string {
  if (points.length < 2) return "";
  return points
    .map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`)
    .join(" ");
}

function splitByTimeGap(points: XY[], maxGapMs: number): XY[][] {
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

type VerticalConnector = {
  key: string;
  x: number;
  yMin: number;
  yMax: number;
};

function buildVerticalConnectors(
  label: string,
  sysPoints: XY[],
  mapPoints: XY[],
  diaPoints: XY[],
): VerticalConnector[] {
  const grouped = new Map<number, { x: number; yValues: number[] }>();
  const add = (point: XY) => {
    const existing = grouped.get(point.ts);
    if (existing) {
      existing.yValues.push(point.y);
      return;
    }
    grouped.set(point.ts, { x: point.x, yValues: [point.y] });
  };

  sysPoints.forEach(add);
  mapPoints.forEach(add);
  diaPoints.forEach(add);

  const rows: VerticalConnector[] = [];
  for (const [ts, payload] of grouped.entries()) {
    if (payload.yValues.length < 2) continue;
    const yMin = Math.min(...payload.yValues);
    const yMax = Math.max(...payload.yValues);
    rows.push({
      key: `${label}-${ts}`,
      x: payload.x,
      yMin,
      yMax,
    });
  }
  return rows;
}

function formatPointValue(n: number): string {
  if (!Number.isFinite(n)) return "-";
  if (Math.abs(n) >= 100) return String(Math.round(n));
  if (Math.abs(n) >= 10) return Number(n.toFixed(1)).toString();
  return Number(n.toFixed(2)).toString();
}

function TriangleUp({ x, y, color }: { x: number; y: number; color: string }) {
  return (
    <path
      d={`M ${x} ${y - TRIANGLE_HALF_HEIGHT} L ${x - TRIANGLE_HALF_WIDTH} ${
        y + TRIANGLE_HALF_HEIGHT
      } L ${x + TRIANGLE_HALF_WIDTH} ${y + TRIANGLE_HALF_HEIGHT} Z`}
      fill={color}
      stroke={color}
      strokeWidth={VITAL_LINE_STROKE}
    />
  );
}

function TriangleDown({
  x,
  y,
  color,
}: {
  x: number;
  y: number;
  color: string;
}) {
  return (
    <path
      d={`M ${x} ${y + TRIANGLE_HALF_HEIGHT} L ${x - TRIANGLE_HALF_WIDTH} ${
        y - TRIANGLE_HALF_HEIGHT
      } L ${x + TRIANGLE_HALF_WIDTH} ${y - TRIANGLE_HALF_HEIGHT} Z`}
      fill={color}
      stroke={color}
      strokeWidth={VITAL_LINE_STROKE}
    />
  );
}

function CircleDot({ x, y, color }: { x: number; y: number; color: string }) {
  return <circle cx={x} cy={y} r={DOT_RADIUS} fill={color} stroke={color} />;
}

function HeartDot({ x, y }: { x: number; y: number }) {
  return (
    <text x={x} y={y + 2.5} textAnchor="middle" fontSize={7.5} fill="currentColor">
      {"\u2665"}
    </text>
  );
}

export default function TimeChart({
  axis,
  values,
  nowTs,
  height = 150,
  storageKey,
  colWidth = COL_WIDTH,
  labelColWidth = LABEL_COL_WIDTH,
  scrollLeft = 0,
  viewportWidth = 0,
}: Props) {
  const [visible, setVisible] = useState<VisibilityState>(() =>
    readVisibility(storageKey),
  );
  const [hoverColumnIndex, setHoverColumnIndex] = useState<number | null>(null);

  const { startIndex, endIndex } = useVirtualColumns(
    scrollLeft,
    viewportWidth,
    colWidth,
    axis.length,
    10 // larger overscan for chart to handle lines better
  );

  useEffect(() => {
    setVisible(readVisibility(storageKey));
  }, [storageKey]);

  useEffect(() => {
    if (typeof window === "undefined" || !storageKey) return;
    window.localStorage.setItem(storageKey, JSON.stringify(visible));
  }, [storageKey, visible]);

  useEffect(() => {
    setHoverColumnIndex(prev =>
      prev != null && prev >= axis.length ? null : prev,
    );
  }, [axis.length]);

  const toggle = (key: VitalGroup) => {
    setVisible(prev => ({ ...prev, [key]: !prev[key] }));
  };

  if (axis.length === 0) return null;

  const stepMs = axis.length > 1 ? Math.max(1, axis[1] - axis[0]) : MINUTE_MS;
  const startTs = axis[0];
  const endExclusiveTs = axis[axis.length - 1] + stepMs;
  const chartWidth = axis.length * colWidth;
  const innerHeight = Math.max(0, height - CHART_PADDING_Y * 2);

  const yFor = (value: number) => {
    const clamped = Math.min(CHART_MAX, Math.max(CHART_MIN, value));
    return (
      CHART_PADDING_Y +
      ((CHART_MAX - clamped) / (CHART_MAX - CHART_MIN)) * innerHeight
    );
  };

  const xForTs = (ts: number) =>
    ((ts - startTs + MINUTE_MS / 2) / stepMs) * colWidth;

  const pointsFor = (key: string): XY[] => {
    const row = values[key];
    if (!row) return [];

    // Buffer for line drawing continuity
    const buffer = 5;
    const sIdx = Math.max(0, startIndex - buffer);
    const eIdx = Math.min(axis.length - 1, endIndex + buffer);
    const minTs = axis[sIdx];
    const maxTs = axis[eIdx] + stepMs;

    return Object.entries(row)
      .map(([tsKey, raw]) => {
        const ts = Number(tsKey);
        const n = toNumber(raw);
        return { ts, n };
      })
      .filter(
        (p): p is { ts: number; n: number } =>
          Number.isFinite(p.ts) &&
          p.n != null &&
          p.ts >= minTs &&
          p.ts < maxTs,
      )
      .sort((a, b) => a.ts - b.ts)
      .map(p => ({
        ts: p.ts,
        x: xForTs(p.ts),
        y: yFor(p.n),
        value: p.n,
      }))
      .filter(p => p.x >= 0 && p.x <= chartWidth);
  };

  const spo2Points = pointsFor("spo2");
  const hrPoints = pointsFor("hr");
  const nibpSysPoints = pointsFor("nibp_sys");
  const nibpMapPoints = pointsFor("nibp_map");
  const nibpDiaPoints = pointsFor("nibp_dia");
  const artSysPoints = pointsFor("art_sys");
  const artMapPoints = pointsFor("art_map");
  const artDiaPoints = pointsFor("art_dia");
  const cvpPoints = pointsFor("cvp");
  const tempPoints = pointsFor("temperature");
  const nibpConnectors = buildVerticalConnectors(
    "nibp",
    nibpSysPoints,
    nibpMapPoints,
    nibpDiaPoints,
  );
  const artConnectors = buildVerticalConnectors(
    "art",
    artSysPoints,
    artMapPoints,
    artDiaPoints,
  );

  const hrSegments = splitByTimeGap(hrPoints, 2 * MINUTE_MS);
  
  // Only calculate tooltips for visible area
  const tooltipsByColumn: Record<number, string> = {};
  for (let i = startIndex; i <= endIndex; i++) {
    const bucketStart = axis[i];
    const bucketEnd = axis[i + 1] ?? endExclusiveTs;
    const lines: string[] = [];
    const fmtTime = (ts: number) => {
      const d = new Date(ts);
      const hh = String(d.getHours()).padStart(2, "0");
      const mm = String(d.getMinutes()).padStart(2, "0");
      return `${hh}:${mm}`;
    };
    lines.push(`Time ${fmtTime(bucketStart)}`);

    const pushLastInBucket = (label: string, points: XY[]) => {
      const inBucket = points.filter(
        p => p.ts >= bucketStart && p.ts < bucketEnd,
      );
      if (inBucket.length === 0) return;
      const last = inBucket[inBucket.length - 1];
      lines.push(`${label}: ${formatPointValue(last.value)}`);
    };

    pushLastInBucket("SpO2", spo2Points);
    pushLastInBucket("HR/Pulse", hrPoints);
    pushLastInBucket("NIBP SYS", nibpSysPoints);
    pushLastInBucket("NIBP MAP", nibpMapPoints);
    pushLastInBucket("NIBP DIA", nibpDiaPoints);
    pushLastInBucket("ART SYS", artSysPoints);
    pushLastInBucket("ART MAP", artMapPoints);
    pushLastInBucket("ART DIA", artDiaPoints);
    pushLastInBucket("CVP", cvpPoints);
    pushLastInBucket("Temp", tempPoints);

    tooltipsByColumn[i] = lines.join("\n");
  }

  const nowIndex = axis.findIndex((ts, i) => {
    const next = axis[i + 1] ?? Infinity;
    return ts <= nowTs && next > nowTs;
  });
  const hoverTooltipLines =
    hoverColumnIndex == null
      ? []
      : (tooltipsByColumn[hoverColumnIndex] || "")
          .split("\n")
          .filter(Boolean);
  const hoverTooltipLeft =
    hoverColumnIndex == null
      ? 0
      : hoverColumnIndex * colWidth + colWidth / 2;

  return (
    <div className="flex border-b border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-900 text-gray-800 dark:text-gray-100">
      <div
        style={{
          width: labelColWidth,
          minWidth: labelColWidth,
          height,
        }}
        className="sticky left-0 z-40 shrink-0 border-r border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-900"
      >
        {/* Legend Checkboxes */}
        <div className="relative z-10 p-1.5 space-y-0.5">
          <label className="flex items-center gap-1.5 cursor-pointer hover:text-blue-400 transition-colors">
            <input
              type="checkbox"
              className="w-3 h-3"
              checked={visible.spo2}
              onChange={() => toggle("spo2")}
            />
            <span className="text-[10px] scale-90 origin-left">SpO2</span>
          </label>
          <label className="flex items-center gap-1.5 cursor-pointer hover:text-blue-400 transition-colors">
            <input
              type="checkbox"
              className="w-3 h-3"
              checked={visible.hr}
              onChange={() => toggle("hr")}
            />
            <span className="text-[10px] scale-90 origin-left">HR</span>
          </label>
          <label className="flex items-center gap-1.5 cursor-pointer hover:text-blue-400 transition-colors">
            <input
              type="checkbox"
              className="w-3 h-3"
              checked={visible.nibp}
              onChange={() => toggle("nibp")}
            />
            <span className="text-[10px] scale-90 origin-left">NIBP</span>
          </label>
          <label className="flex items-center gap-1.5 cursor-pointer hover:text-blue-400 transition-colors">
            <input
              type="checkbox"
              className="w-3 h-3"
              checked={visible.art}
              onChange={() => toggle("art")}
            />
            <span className="text-[10px] scale-90 origin-left">ART</span>
          </label>
          <label className="flex items-center gap-1.5 cursor-pointer hover:text-blue-400 transition-colors">
            <input
              type="checkbox"
              className="w-3 h-3"
              checked={visible.cvp}
              onChange={() => toggle("cvp")}
            />
            <span className="text-[10px] scale-90 origin-left">CVP</span>
          </label>
          <label className="flex items-center gap-1.5 cursor-pointer hover:text-blue-400 transition-colors">
            <input
              type="checkbox"
              className="w-3 h-3"
              checked={visible.temp}
              onChange={() => toggle("temp")}
            />
            <span className="text-[10px] scale-90 origin-left">Temp</span>
          </label>
        </div>

        {/* Y-Axis Labels - Absolutely positioned to match SVG yFor logic */}
        <div className="absolute inset-0 pointer-events-none border-t border-gray-200 dark:border-gray-800 mt-[-1px]">
          {Y_TICKS.map(val => {
            const y = yFor(val);
            return (
              <div
                key={val}
                className="absolute right-1.5 -translate-y-1/2 text-[9px] font-mono"
                style={{
                  top: y,
                  color: "var(--chart-axis-text)",
                  textShadow: "0 1px 0 var(--chart-axis-text-shadow)",
                }}
              >
                {val}
              </div>
            );
          })}
        </div>
      </div>

      <div
        className="relative shrink-0"
        style={{ width: chartWidth, minWidth: chartWidth }}
      >
        <svg
          width={chartWidth}
          height={height}
          className="block"
          onMouseLeave={() => setHoverColumnIndex(null)}
        >
          {/* Horizontal Grid Lines */}
          {Y_TICKS.map(val => (
            <line
              key={`grid-y-${val}`}
              x1={0}
              y1={yFor(val)}
              x2={chartWidth}
              y2={yFor(val)}
              stroke={val % 40 === 0 ? "var(--chart-grid-line-strong)" : GRID_STROKE}
              strokeWidth={val % 40 === 0 ? 0.85 : 0.65}
            />
          ))}

          {/* Virtualized Vertical Grid Lines */}
          {axis.slice(startIndex, endIndex + 1).map((ts, i) => {
            const actualIndex = startIndex + i;
            return (
              <line
                key={ts}
                x1={actualIndex * colWidth}
                y1={0}
                x2={actualIndex * colWidth}
                y2={height}
                stroke={GRID_STROKE}
                strokeWidth={1}
              />
            );
          })}

          <line
            x1={chartWidth}
            y1={0}
            x2={chartWidth}
            y2={height}
            stroke="var(--chart-grid-line-strong)"
            strokeWidth={1}
          />

          {Y_TICKS.map(val => (
            <line
              key={`axis-right-tick-${val}`}
              x1={chartWidth - 6}
              y1={yFor(val)}
              x2={chartWidth}
              y2={yFor(val)}
              stroke="var(--chart-grid-line-strong)"
              strokeWidth={1}
            />
          ))}

          {nowIndex >= 0 && nowIndex >= startIndex && nowIndex <= endIndex && (
            <>
              <line
                x1={nowIndex * colWidth}
                y1={0}
                x2={nowIndex * colWidth}
                y2={height}
                stroke={NOW_HIGHLIGHT_STROKE}
                strokeWidth={1.2}
              />
              <line
                x1={(nowIndex + 1) * colWidth}
                y1={0}
                x2={(nowIndex + 1) * colWidth}
                y2={height}
                stroke={NOW_HIGHLIGHT_STROKE}
                strokeWidth={1.2}
              />
            </>
          )}

          {visible.spo2 && spo2Points.length > 1 && (
            <path
              d={buildPath(spo2Points)}
              fill="none"
              stroke={SPO2_COLOR}
              strokeWidth={VITAL_LINE_STROKE}
            />
          )}

          {visible.spo2 &&
            spo2Points.map((p, i) => (
              <CircleDot
                key={`spo2-dot-${i}-${p.ts}`}
                x={p.x}
                y={p.y}
                color={SPO2_COLOR}
              />
            ))}

          {visible.hr && (
            <g style={{ color: HR_COLOR }}>
              {hrSegments.map(segment =>
                segment.length > 1 ? (
                  <path
                    key={`hr-seg-${segment[0].ts}`}
                    d={buildPath(segment)}
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={VITAL_LINE_STROKE}
                  />
                ) : null,
              )}
              {hrPoints.map(p => (
                <HeartDot key={`hr-dot-${p.ts}`} x={p.x} y={p.y} />
              ))}
            </g>
          )}

          {visible.nibp &&
            nibpConnectors.map(line => (
              <line
                key={line.key}
                x1={line.x}
                y1={line.yMin}
                x2={line.x}
                y2={line.yMax}
                stroke={NIBP_COLOR}
                strokeWidth={CONNECTOR_LINE_STROKE}
                opacity={0.8}
              />
            ))}

          {visible.nibp &&
            nibpSysPoints.map(p => (
              <TriangleDown
                key={`nibp-sys-${p.ts}`}
                x={p.x}
                y={p.y}
                color={NIBP_COLOR}
              />
            ))}
          {visible.nibp &&
            nibpMapPoints.map(p => (
              <CircleDot
                key={`nibp-map-${p.ts}`}
                x={p.x}
                y={p.y}
                color={NIBP_COLOR}
              />
            ))}
          {visible.nibp &&
            nibpDiaPoints.map(p => (
              <TriangleUp
                key={`nibp-dia-${p.ts}`}
                x={p.x}
                y={p.y}
                color={NIBP_COLOR}
              />
            ))}

          {visible.art &&
            artConnectors.map(line => (
              <line
                key={line.key}
                x1={line.x}
                y1={line.yMin}
                x2={line.x}
                y2={line.yMax}
                stroke={ART_COLOR}
                strokeWidth={CONNECTOR_LINE_STROKE}
                opacity={0.8}
              />
            ))}

          {visible.art &&
            artSysPoints.map(p => (
              <TriangleDown
                key={`art-sys-${p.ts}`}
                x={p.x}
                y={p.y}
                color={ART_COLOR}
              />
            ))}
          {visible.art &&
            artMapPoints.map(p => (
              <CircleDot
                key={`art-map-${p.ts}`}
                x={p.x}
                y={p.y}
                color={ART_COLOR}
              />
            ))}
          {visible.art &&
            artDiaPoints.map(p => (
              <TriangleUp
                key={`art-dia-${p.ts}`}
                x={p.x}
                y={p.y}
                color={ART_COLOR}
              />
            ))}

          {visible.cvp &&
            cvpPoints.map(p => (
              <CircleDot
                key={`cvp-${p.ts}`}
                x={p.x}
                y={p.y}
                color={CVP_COLOR}
              />
            ))}

          {visible.temp && tempPoints.length > 1 ? (
            <path
              d={buildPath(tempPoints)}
              fill="none"
              stroke={TEMP_COLOR}
              strokeWidth={VITAL_LINE_STROKE}
            />
          ) : null}
          {visible.temp &&
            tempPoints.map(p => (
              <CircleDot
                key={`temp-${p.ts}`}
                x={p.x}
                y={p.y}
                color={TEMP_COLOR}
              />
            ))}

          {/* Virtualized Tooltip Rects */}
          {axis.slice(startIndex, endIndex + 1).map((ts, i) => {
            const actualIndex = startIndex + i;
            return (
              <rect
                key={`tip-${ts}`}
                x={actualIndex * colWidth}
                y={0}
                width={colWidth}
                height={height}
                fill="transparent"
                onMouseEnter={() => setHoverColumnIndex(actualIndex)}
                onMouseMove={() => setHoverColumnIndex(actualIndex)}
              />
            );
          })}
        </svg>
        {hoverColumnIndex != null && hoverTooltipLines.length > 0 ? (
          <div
            className="pointer-events-none absolute z-40 -translate-x-1/2 rounded-md border border-[var(--app-tooltip-border)] bg-[var(--app-tooltip-bg)] px-2 py-1 text-[10px] leading-tight text-[var(--app-tooltip-text)] shadow-[var(--app-tooltip-shadow)]"
            style={{ left: hoverTooltipLeft, top: 4 }}
          >
            {hoverTooltipLines.map((line, index) => (
              <div key={`${hoverColumnIndex}-${index}`}>{line}</div>
            ))}
          </div>
        ) : null}
        <div className="absolute inset-y-0 right-0 pointer-events-none">
          {Y_TICKS.map(val => (
            <div
              key={`right-y-label-${val}`}
              className="absolute right-1 -translate-y-1/2 text-[9px] font-mono"
              style={{
                top: yFor(val),
                color: "var(--chart-axis-text)",
                textShadow: "0 1px 0 var(--chart-axis-text-shadow)",
              }}
            >
              {val}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
