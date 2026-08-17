import { useMemo, useState } from "react";
import type { TimeGridValues } from "../timegrid/types";
import { COL_WIDTH, LABEL_COL_WIDTH } from "../timegrid/layout";

type VitalGroup = "spo2" | "hr" | "nibp" | "art" | "cvp";

type VisibilityState = {
  spo2: boolean;
  hr: boolean;
  nibp: boolean;
  art: boolean;
  cvp: boolean;
};

type VitalPoint = {
  ts: number;
  hr?: number;
  spo2?: number;
  nibp_sys?: number;
  nibp_map?: number;
  nibp_dia?: number;
  art_sys?: number;
  art_map?: number;
  art_dia?: number;
  cvp?: number;
};

type XY = {
  x: number;
  y: number;
};

type Props = {
  axis: number[];
  values: TimeGridValues;
  nowTs: number;
  height?: number;
};

const CHART_MIN = 0;
const CHART_MAX = 200;
const CHART_PADDING_Y = 10;
const NOW_HIGHLIGHT_FILL = "rgba(59, 130, 246, 0.10)";

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

function splitByMissing(points: Array<XY | undefined>): XY[][] {
  const parts: XY[][] = [];
  let current: XY[] = [];

  for (const p of points) {
    if (!p) {
      if (current.length > 0) parts.push(current);
      current = [];
      continue;
    }
    current.push(p);
  }

  if (current.length > 0) parts.push(current);
  return parts;
}

function TriangleUp({ x, y, color }: { x: number; y: number; color: string }) {
  return (
    <path
      d={`M ${x} ${y - 6} L ${x - 5} ${y + 4} L ${x + 5} ${y + 4} Z`}
      fill={color}
      stroke={color}
      strokeWidth={1.5}
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
      d={`M ${x} ${y + 6} L ${x - 5} ${y - 4} L ${x + 5} ${y - 4} Z`}
      fill={color}
      stroke={color}
      strokeWidth={1.5}
    />
  );
}

function CircleDot({ x, y, color }: { x: number; y: number; color: string }) {
  return <circle cx={x} cy={y} r={3} fill={color} stroke={color} />;
}

function HeartDot({ x, y }: { x: number; y: number }) {
  return (
    <text x={x} y={y + 4} textAnchor="middle" fontSize={12} fill="#e33444">
      {"\u2665"}
    </text>
  );
}

export default function CombinedVitalsChart({
  axis,
  values,
  nowTs,
  height = 120,
}: Props) {
  const [visible, setVisible] = useState<VisibilityState>({
    spo2: true,
    hr: true,
    nibp: true,
    art: false,
    cvp: false,
  });

  const toggle = (key: VitalGroup) => {
    setVisible(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const chartWidth = axis.length * COL_WIDTH;
  const innerHeight = Math.max(0, height - CHART_PADDING_Y * 2);

  const points = useMemo<VitalPoint[]>(
    () =>
      axis.map(ts => ({
        ts,
        hr: toNumber(values.hr?.[ts]),
        spo2: toNumber(values.spo2?.[ts]),
        nibp_sys: toNumber(values.nibp_sys?.[ts]),
        nibp_map: toNumber(values.nibp_map?.[ts]),
        nibp_dia: toNumber(values.nibp_dia?.[ts]),
        art_sys: toNumber(values.art_sys?.[ts]),
        art_map: toNumber(values.art_map?.[ts]),
        art_dia: toNumber(values.art_dia?.[ts]),
        cvp: toNumber(values.cvp?.[ts]),
      })),
    [axis, values],
  );

  const yFor = (value: number) => {
    const clamped = Math.min(CHART_MAX, Math.max(CHART_MIN, value));
    return (
      CHART_PADDING_Y +
      ((CHART_MAX - clamped) / (CHART_MAX - CHART_MIN)) * innerHeight
    );
  };

  const xFor = (index: number) => index * COL_WIDTH + COL_WIDTH / 2;
  const nowIndex = axis.findIndex((ts, i) => {
    const next = axis[i + 1] ?? Infinity;
    return ts <= nowTs && next > nowTs;
  });

  const spo2Points = points.flatMap((p, i) =>
    p.spo2 == null ? [] : [{ x: xFor(i), y: yFor(p.spo2) }],
  );

  const hrPointsWithGaps: Array<XY | undefined> = points.map((p, i) =>
    p.hr == null ? undefined : { x: xFor(i), y: yFor(p.hr) },
  );
  const hrSegments = splitByMissing(hrPointsWithGaps);

  if (axis.length === 0) return null;

  return (
    <div className="flex border-b border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-900 text-gray-800 dark:text-gray-100">
      <div
        style={{ width: LABEL_COL_WIDTH, minWidth: LABEL_COL_WIDTH }}
        className="sticky left-0 z-30 shrink-0 border-r border-gray-200 dark:border-gray-800 px-2 py-2 text-xs bg-gray-50 dark:bg-gray-900"
      >
        <div className="space-y-2">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={visible.spo2}
              onChange={() => toggle("spo2")}
            />
            SpO2
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={visible.hr}
              onChange={() => toggle("hr")}
            />
            HR / Pulse
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={visible.nibp}
              onChange={() => toggle("nibp")}
            />
            NIBP
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={visible.art}
              onChange={() => toggle("art")}
            />
            ART
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={visible.cvp}
              onChange={() => toggle("cvp")}
            />
            CVP
          </label>
        </div>
      </div>

      <div
        className="relative shrink-0"
        style={{ width: chartWidth, minWidth: chartWidth }}
      >
        <svg width={chartWidth} height={height} className="block">
          {nowIndex >= 0 && (
            <rect
              x={nowIndex * COL_WIDTH}
              y={0}
              width={COL_WIDTH}
              height={height}
              fill={NOW_HIGHLIGHT_FILL}
            />
          )}

          {axis.map((ts, i) => (
            <line
              key={ts}
              x1={i * COL_WIDTH}
              y1={0}
              x2={i * COL_WIDTH}
              y2={height}
              stroke="rgba(148, 163, 184, 0.25)"
              strokeWidth={1}
            />
          ))}

          <line
            x1={chartWidth}
            y1={0}
            x2={chartWidth}
            y2={height}
            stroke="rgba(148, 163, 184, 0.25)"
            strokeWidth={1}
          />

          {visible.spo2 && spo2Points.length > 1 && (
            <path
              d={buildPath(spo2Points)}
              fill="none"
              stroke="#3b82f6"
              strokeWidth={2}
            />
          )}

          {visible.spo2 &&
            spo2Points.map((p, i) => (
              <CircleDot key={`spo2-dot-${i}-${p.x}`} x={p.x} y={p.y} color="#3b82f6" />
            ))}

          {visible.hr &&
            hrSegments.map(segment => (
              <path
                key={`hr-${segment[0].x}`}
                d={buildPath(segment)}
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
              />
            ))}

          {visible.hr &&
            hrPointsWithGaps.map((p, i) =>
              p ? <HeartDot key={`hr-dot-${axis[i]}`} x={p.x} y={p.y} /> : null,
            )}

          {visible.nibp &&
            points.map((p, i) => {
              const x = xFor(i);
              return (
                <g key={`nibp-${p.ts}`}>
                  {p.nibp_sys != null ? (
                    <TriangleDown x={x} y={yFor(p.nibp_sys)} color="#22c55e" />
                  ) : null}
                  {p.nibp_map != null ? (
                    <CircleDot x={x} y={yFor(p.nibp_map)} color="#22c55e" />
                  ) : null}
                  {p.nibp_dia != null ? (
                    <TriangleUp x={x} y={yFor(p.nibp_dia)} color="#22c55e" />
                  ) : null}
                </g>
              );
            })}

          {visible.art &&
            points.map((p, i) => {
              const x = xFor(i);
              return (
                <g key={`art-${p.ts}`}>
                  {p.art_sys != null ? (
                    <TriangleDown x={x} y={yFor(p.art_sys)} color="#ef4444" />
                  ) : null}
                  {p.art_map != null ? (
                    <CircleDot x={x} y={yFor(p.art_map)} color="#ef4444" />
                  ) : null}
                  {p.art_dia != null ? (
                    <TriangleUp x={x} y={yFor(p.art_dia)} color="#ef4444" />
                  ) : null}
                </g>
              );
            })}

          {visible.cvp &&
            points.map((p, i) => {
              if (p.cvp == null) return null;
              return (
                <CircleDot
                  key={`cvp-${p.ts}`}
                  x={xFor(i)}
                  y={yFor(p.cvp)}
                  color="#f97316"
                />
              );
            })}
        </svg>
      </div>
    </div>
  );
}
