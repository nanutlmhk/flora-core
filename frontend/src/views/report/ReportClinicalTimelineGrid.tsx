import { ecgValueToCode } from "../../components/clinical-timeline/ecgOptions";
import type { ClinicalTimelineRow, ClinicalTimelineValues } from "../../components/clinical-timeline/types";
import type { IoGridCellValue, ReportEventMarker, ReportPreparedMarker } from "./types";

type Props = {
  axis: number[];
  rows: ClinicalTimelineRow[];
  values: ClinicalTimelineValues;
  eventMarkersByTs?: Record<number, ReportEventMarker[]>;
  preparedMarkersByTs?: Record<number, ReportPreparedMarker[]>;
  colWidth: number;
  labelColWidth: number;
};

function formatHHMM(ts: number) {
  const d = new Date(ts);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

function formatAmount(value: number) {
  if (!Number.isFinite(value)) return "";
  if (Math.abs(value - Math.round(value)) < 0.0001) return String(Math.round(value));
  return value.toFixed(2).replace(/\.?0+$/, "");
}

function isIoCellValue(value: unknown): value is IoGridCellValue {
  return Boolean(
    value &&
      typeof value === "object" &&
      "kind" in (value as Record<string, unknown>) &&
      (value as { kind?: unknown }).kind === "io_cell",
  );
}

function markerForEvent(marker: ReportEventMarker) {
  if (marker.event_type === "note") return { label: "N", className: "badge-note" };
  const title = marker.title.toLowerCase().replace(/\s+/g, " ").trim();
  if (title === "start ane" || title === "start anes" || title === "start anesthesia" || title === "start anaesthesia") {
    return { label: "SA", className: "badge-start" };
  }
  if (title === "end ane" || title === "end anes" || title === "end anesthesia" || title === "end anaesthesia") {
    return { label: "EA", className: "badge-end" };
  }
  if (title === "start surg" || title === "start surgery") return { label: "SS", className: "badge-start" };
  if (title === "end surg" || title === "end surgery") return { label: "ES", className: "badge-end" };
  if (title === "induction") return { label: "IN", className: "badge-mid" };
  if (title === "blood product") return { label: "BP", className: "badge-mid" };
  if (title === "time out") return { label: "TO", className: "badge-timeout" };
  if (title === "reversal") return { label: "RV", className: "badge-mid" };
  return { label: "E", className: "badge-event" };
}

function markerForPrepared(marker: ReportPreparedMarker) {
  const category = String(marker.item_category || "").toLowerCase();
  if (marker.kind === "med") return marker.marker_code === "d" ? "#9B6DFF" : "#5B8FF9";
  if (marker.kind === "fluid") return category === "bloodproduct" ? "#E05252" : "#39C6C8";
  if (category === "bloodlossoutput") return "#8B2635";
  return category === "urineoutput" ? "#D99A24" : "var(--badge-output-text)";
}

export default function ReportClinicalTimelineGrid({
  axis,
  rows,
  values,
  eventMarkersByTs = {},
  preparedMarkersByTs = {},
  colWidth,
  labelColWidth,
}: Props) {
  if (axis.length === 0 || rows.length === 0) return null;
  const totalWidth = labelColWidth + axis.length * colWidth;
  const stepMs = axis.length > 1 ? Math.max(1, axis[1] - axis[0]) : 60_000;

  const rowEntriesById = new Map<string, Array<{ ts: number; value: unknown }>>();
  for (const [rowId, rowValues] of Object.entries(values)) {
    const entries = Object.entries(rowValues)
      .map(([ts, value]) => ({ ts: Number(ts), value }))
      .filter(entry => Number.isFinite(entry.ts))
      .sort((a, b) => a.ts - b.ts);
    rowEntriesById.set(rowId, entries);
  }

  const getDisplayCell = (rowId: string, ts: number, columnIndex: number) => {
    const rowValues = values[rowId];
    if (rowValues && Object.prototype.hasOwnProperty.call(rowValues, ts)) {
      return { value: rowValues[ts], isFallback: false, sourceTs: ts };
    }

    if (stepMs <= 60_000) {
      return { value: undefined, isFallback: false, sourceTs: null as number | null };
    }

    const entries = rowEntriesById.get(rowId);
    if (!entries || entries.length === 0) {
      return { value: undefined, isFallback: false, sourceTs: null as number | null };
    }

    const windowStart = columnIndex > 0 ? axis[columnIndex - 1] : ts - stepMs;
    for (let i = entries.length - 1; i >= 0; i -= 1) {
      const item = entries[i];
      if (item.ts >= ts) continue;
      if (item.ts <= windowStart) break;
      return { value: item.value, isFallback: true, sourceTs: item.ts };
    }
    return { value: undefined, isFallback: false, sourceTs: null as number | null };
  };

  const getEcgCodeAt = (ts: number) => {
    const entries = rowEntriesById.get("ecg");
    if (!entries || entries.length === 0) return "-";
    let last: string | undefined;
    for (const entry of entries) {
      if (entry.ts > ts) break;
      if (typeof entry.value === "string" && entry.value.trim()) {
        last = entry.value;
      }
    }
    return ecgValueToCode(last) || "-";
  };

  return (
    <div className="report-grid report-surface border-x border-t report-border" style={{ width: totalWidth, minWidth: totalWidth }}>
      {rows.map((row) => {
        const isEventLabel = row.id === "event";
        const isIoHeader = row.id === "__io_header__";
        return (
          <div
            key={row.id}
            style={{
              display: "grid",
              gridTemplateColumns: `${labelColWidth}px repeat(${axis.length}, ${colWidth}px)`,
            }}
            className="border-b report-border"
          >
            <div className="border-r report-border px-2 py-1 text-[10px] leading-5 report-cell-text">
              <div
                className={`inline-flex items-center rounded px-1.5 py-0.5 ${isEventLabel ? "badge-event font-semibold" : isIoHeader ? "badge-start font-semibold" : ""}`}
              >
                {row.label}
                {row.unit && row.type !== "event" ? (
                  <span className="ml-1 text-[9px] report-muted-text">({row.unit})</span>
                ) : null}
              </div>
            </div>

            {axis.map((ts, i) => {
              if (row.type === "event") {
                const events = eventMarkersByTs[ts] || [];
                const prepared = preparedMarkersByTs[ts] || [];
                return (
                  <div key={`${row.id}-${ts}`} className="border-l report-border px-1 py-1 text-center">
                    <div className="flex h-5 items-center justify-center gap-0.5 overflow-hidden">
                      {events.slice(0, 3).map(marker => {
                        const token = markerForEvent(marker);
                        return (
                          <span key={marker.id} className={`inline-flex h-3 min-w-3 items-center justify-center rounded px-[2px] text-[8px] font-semibold ${token.className}`}>
                            {token.label}
                          </span>
                        );
                      })}
                      {prepared.map((marker, markerIndex) => {
                        const markerColor = markerForPrepared(marker);
                        return (
                          <span key={`p-${marker.run_id}-${marker.item_id}-${markerIndex}`} className="inline-flex h-4 w-2 min-w-0 items-center justify-center">
                            <span className="block h-3.5 w-[3px] rounded-full" style={{ backgroundColor: markerColor }} aria-hidden="true" />
                          </span>
                        );
                      })}
                    </div>
                  </div>
                );
              }

              if (row.type === "ecg") {
                return (
                  <div key={`${row.id}-${ts}`} className="border-l report-border px-1 py-1 text-center text-[10px] report-cell-text">
                    {getEcgCodeAt(ts)}
                  </div>
                );
              }

              const display = getDisplayCell(row.id, ts, i);
              const raw = display.value;
              const fallbackHint =
                display.isFallback && display.sourceTs != null
                  ? ` ~ ${formatHHMM(display.sourceTs)}`
                  : "";

              if (row.type === "io") {
                const ioCell = isIoCellValue(raw) ? raw : null;
                // Plain numbers come from timelineIoPrepared (summed bolus amounts per bucket)
                const rawNum = !ioCell && raw != null && Number.isFinite(Number(raw)) ? Number(raw) : null;
                const amount = ioCell
                  ? (Number.isFinite(Number(ioCell.amount)) ? Number(ioCell.amount) : null)
                  : rawNum;
                const dripPart = ioCell?.dripPart;
                const showAmount = amount != null && (!dripPart || dripPart === "start" || dripPart === "single");
                // Never show "+"; show amount or blank
                const text = showAmount ? formatAmount(amount) : "";
                const dripClass =
                  dripPart === "single"
                    ? "io-drip-bar io-drip-single"
                    : dripPart === "start"
                      ? "io-drip-bar io-drip-start"
                      : dripPart === "end"
                        ? "io-drip-bar io-drip-end"
                        : dripPart === "mid"
                          ? "io-drip-bar io-drip-mid"
                          : "";
                return (
                  <div key={`${row.id}-${ts}`} className="relative border-l report-border px-1 py-1 text-center text-[10px] report-cell-text">
                    {dripPart ? <span className={dripClass} /> : null}
                    <span className="relative z-10">{text}</span>
                  </div>
                );
              }

              const valueText = raw == null ? "-" : String(raw);
              return (
                <div
                  key={`${row.id}-${ts}`}
                  className={`border-l report-border px-1 py-1 text-center text-[10px] ${
                    display.isFallback ? "report-muted-text" : "report-cell-text"
                  }`}
                  title={display.isFallback ? `${valueText}${fallbackHint}` : valueText}
                >
                  {valueText}
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}
