import { ECG_OPTIONS, ecgValueToCode } from "./ecgOptions";
import { COL_WIDTH, LABEL_COL_WIDTH } from "./layout";
import type { TimeGridRow, TimeGridValues } from "./types";
import { useState } from "react";
import { useVirtualColumns } from "../../hooks/useVirtualColumns";
import {
  AntibioticIcon,
  BloodIcon,
  EndAnesthesiaIcon,
  EndSurgeryIcon,
  InductionIcon,
  NoteIcon,
  ReversalIcon,
  StartAnesthesiaIcon,
  StartSurgeryIcon,
  TimeoutIcon,
} from "../../assets/icons";

export type TimeGridEventMarker = {
  id: number;
  event_ts: number;
  event_type: "event" | "note";
  title: string;
};

export type TimeGridPreparedMarker = {
  run_id: number;
  item_id: number;
  kind: "fluid" | "med" | "output";
  item_name: string;
  item_code?: string;
  item_unit?: string;
  note?: string | null;
  marker_code?: "i" | "o" | "d";
  marker_label?: string;
};

interface Props {
  columns: number[];
  ivyRows: TimeGridRow[];
  rowsAfterEvent?: TimeGridRow[];
  values: TimeGridValues;
  eventMarkersByTs?: Record<number, TimeGridEventMarker[]>;
  preparedMarkersByTs?: Record<number, TimeGridPreparedMarker[]>;
  includeSystemRows?: boolean;
  nowTs: number;
  scrollLeft?: number;
  viewportWidth?: number;
  onChange?: (rowId: string, ts: number, value: unknown) => void;
  onPreparedMarkerClick?: (ts: number, marker: TimeGridPreparedMarker) => void;
  onIoCellClick?: (rowId: string, ts: number) => void;
  onIoRowRemove?: (rowId: string) => void;
  onEventCellClick?: (ts: number) => void;
  onEventMarkerClick?: (marker: TimeGridEventMarker) => void;
  sectionCollapseState?: {
    ioCollapsed: boolean;
    vitalCollapsed: boolean;
  };
  onSectionCollapseToggle?: (section: "io" | "vital") => void;
  colWidth?: number;
  labelColWidth?: number;
}

const SYSTEM_ROWS: TimeGridRow[] = [
  { id: "event", label: "Event", type: "event" },
  { id: "ecg", label: "ECG", type: "ecg" },
];

const CORE_ROW_IDS = new Set([
  "hr",
  "spo2",
  // rr removed so it shows [M] badge
  "nibp_sys",
  "nibp_map",
  "nibp_dia",
  "art_sys",
  "art_map",
  "art_dia",
  "art_pr",
  "cvp",
  "temperature",
]);

const MINUTE_MS = 60_000;

type DisplayCell = {
  value: unknown;
  isFallback: boolean;
  sourceTs: number | null;
};

type IoDripPart = "start" | "mid" | "end" | "single";

type IoDisplayCellValue = {
  kind: "io_cell";
  amount?: number;
  dripPart?: IoDripPart;
  dripRateMlPerHr?: number;
  dripCarrierMlPerHr?: number;
  minuteValues?: Array<{ ts: number; amount: number }>;
};

const isIoDisplayCellValue = (value: unknown): value is IoDisplayCellValue =>
  Boolean(
    value &&
      typeof value === "object" &&
      "kind" in (value as Record<string, unknown>) &&
      (value as { kind?: unknown }).kind === "io_cell",
  );

export default function TimeGrid({
  columns,
  ivyRows,
  rowsAfterEvent = [],
  values,
  eventMarkersByTs = {},
  preparedMarkersByTs = {},
  includeSystemRows = true,
  nowTs,
  scrollLeft = 0,
  viewportWidth = 0,
  onChange,
  onPreparedMarkerClick,
  onIoCellClick,
  onIoRowRemove,
  onEventCellClick,
  onEventMarkerClick,
  sectionCollapseState,
  onSectionCollapseToggle,
  colWidth = COL_WIDTH,
  labelColWidth = LABEL_COL_WIDTH,
}: Props) {
  const [activeRowId, setActiveRowId] = useState<string | null>(null);

  const { startIndex, endIndex } = useVirtualColumns(
    scrollLeft,
    viewportWidth,
    colWidth,
    columns.length
  );

  if (columns.length === 0) return null;

  const baseRows = includeSystemRows
    ? [SYSTEM_ROWS[0], ...rowsAfterEvent, SYSTEM_ROWS[1], ...ivyRows]
    : ivyRows;
  const rows = baseRows.filter(row => {
    if (sectionCollapseState?.ioCollapsed && row.type === "io" && row.id.startsWith("io_run_")) {
      return false;
    }
    if (sectionCollapseState?.vitalCollapsed && (row.id === "ecg" || row.type === "vital")) {
      return false;
    }
    return true;
  });
  const tableWidth = labelColWidth + columns.length * colWidth;
  const stepMs =
    columns.length > 1 ? Math.max(1, columns[1] - columns[0]) : MINUTE_MS;
  const rowEntriesById = new Map<string, Array<{ ts: number; value: unknown }>>();

  for (const [rowId, rowValues] of Object.entries(values)) {
    const entries = Object.entries(rowValues)
      .map(([tsKey, value]) => ({
        ts: Number(tsKey),
        value,
      }))
      .filter(item => Number.isFinite(item.ts))
      .sort((a, b) => a.ts - b.ts);
    rowEntriesById.set(rowId, entries);
  }

  const getECGCodeAt = (ts: number) => {
    let last: string | undefined;
    for (const t of columns) {
      if (t > ts) break;
      const v = values.ecg?.[t];
      if (typeof v === "string" && v) last = v;
    }
    return ecgValueToCode(last);
  };

  const formatHHMM = (ts: number) => {
    const d = new Date(ts);
    const hh = String(d.getHours()).padStart(2, "0");
    const mm = String(d.getMinutes()).padStart(2, "0");
    return `${hh}:${mm}`;
  };

  const formatAmount = (value: number) => {
    if (!Number.isFinite(value)) return "";
    if (Math.abs(value - Math.round(value)) < 0.0001) return String(Math.round(value));
    return value.toFixed(2).replace(/\.?0+$/, "");
  };

  const getDisplayCell = (
    rowId: string,
    ts: number,
    columnIndex: number,
  ): DisplayCell => {
    const rowValues = values[rowId];
    if (rowValues && Object.prototype.hasOwnProperty.call(rowValues, ts)) {
      return {
        value: rowValues[ts],
        isFallback: false,
        sourceTs: ts,
      };
    }

    if (stepMs <= MINUTE_MS) {
      return { value: undefined, isFallback: false, sourceTs: null };
    }

    const entries = rowEntriesById.get(rowId);
    if (!entries || entries.length === 0) {
      return { value: undefined, isFallback: false, sourceTs: null };
    }

    const windowStart =
      columnIndex > 0 ? columns[columnIndex - 1] : ts - stepMs;
    for (let i = entries.length - 1; i >= 0; i -= 1) {
      const item = entries[i];
      if (item.ts >= ts) continue;
      if (item.ts <= windowStart) break;
      return {
        value: item.value,
        isFallback: true,
        sourceTs: item.ts,
      };
    }

    return { value: undefined, isFallback: false, sourceTs: null };
  };

  const normalizeEventTitle = (title: string) =>
    title.toLowerCase().replace(/\s+/g, " ").trim();

  const markerForEvent = (marker: TimeGridEventMarker) => {
    if (marker.event_type === "note") {
      return {
        label: "Note",
        iconSrc: NoteIcon,
        className: "badge-note",
      };
    }

    const title = normalizeEventTitle(marker.title);
    if (
      title === "start ane" ||
      title === "start anes" ||
      title === "start anesthesia" ||
      title === "start anaesthesia"
    ) {
      return {
        label: "Start ANE",
        iconSrc: StartAnesthesiaIcon,
        className: "badge-start",
      };
    }
    if (
      title === "end ane" ||
      title === "end anes" ||
      title === "end anesthesia" ||
      title === "end anaesthesia"
    ) {
      return {
        label: "End ANE",
        iconSrc: EndAnesthesiaIcon,
        className: "badge-end",
      };
    }
    if (title === "start surg" || title === "start surgery") {
      return {
        label: "Start Surg",
        iconSrc: StartSurgeryIcon,
        className: "badge-start",
      };
    }
    if (title === "end surg" || title === "end surgery") {
      return {
        label: "End Surg",
        iconSrc: EndSurgeryIcon,
        className: "badge-end",
      };
    }
    if (title === "induction") {
      return {
        label: "Induction",
        iconSrc: InductionIcon,
        className: "badge-mid",
      };
    }
    if (title === "ssi prophylaxis") {
      return {
        label: "SSI",
        iconSrc: AntibioticIcon,
        className: "badge-mid",
      };
    }
    if (title === "blood product") {
      return {
        label: "Blood Product",
        iconSrc: BloodIcon,
        className: "badge-mid",
      };
    }
    if (title === "time out") {
      return {
        label: "Time Out",
        iconSrc: TimeoutIcon,
        className: "badge-timeout",
      };
    }
    if (title === "reversal") {
      return {
        label: "Reversal",
        iconSrc: ReversalIcon,
        className: "badge-mid",
      };
    }

    return {
      label: "E",
      className: "badge-event",
    };
  };
  const markerForPrepared = (marker: TimeGridPreparedMarker) => {
    if (marker.marker_code === "i") {
      return {
        label: marker.marker_label || "B",
        className: "badge-intake",
      };
    }
    if (marker.marker_code === "o") {
      return {
        label: marker.marker_label || "O",
        className: "badge-output",
      };
    }
    if (marker.marker_code === "d") {
      return {
        label: marker.marker_label || "D",
        className: "badge-drip",
      };
    }
    if (marker.kind === "med") {
      return {
        label: "B",
        className: "badge-intake",
      };
    }
    if (marker.kind === "fluid") {
      return {
        label: "B",
        className: "badge-intake",
      };
    }
    return {
      label: "O",
      className: "badge-output",
    };
  };

  const markerForRowType = (row: TimeGridRow) => {
    if (row.type !== "vital") return null;
    if (row.id.startsWith("set_")) {
      return {
        label: "S",
        className: "badge-setting",
      };
    }
    if (CORE_ROW_IDS.has(row.id)) return null;
    return {
      label: "M",
      className: "badge-measure",
    };
  };

  const isNumericLike = (value: unknown) => {
    if (typeof value === "number") return Number.isFinite(value);
    if (typeof value !== "string") return false;
    const trimmed = value.trim();
    if (!trimmed) return false;
    const n = Number(trimmed);
    return Number.isFinite(n);
  };

  const visibleColumns = columns.slice(startIndex, endIndex + 1);

  return (
    <table
      className="timegrid-compact border-collapse table-fixed text-[10px] leading-none"
      style={{ width: tableWidth, minWidth: tableWidth }}
    >
      <tbody>
        {rows.map((row, rowIndex) => {
          const rowTypeMarker = markerForRowType(row);
          const fullLabel = row.unit ? `${row.label} (${row.unit})` : row.label;
          const isEventRowLabel = row.id === "event";
          const isIoHeaderRowLabel = row.id === "__io_header__";
          const isVitalAgentHeaderRowLabel = row.id === "__vital_agent_header__";
          const isIoDataRow = row.type === "io" && row.id.startsWith("io_run_");
          const isIoSectionHeaderRow = row.id === "__io_header__";
          const isVitalSectionHeaderRow = row.id === "__vital_agent_header__";
          const isSectionHeaderRow = isIoSectionHeaderRow || isVitalSectionHeaderRow;
          const sectionCollapsed = isIoSectionHeaderRow
            ? Boolean(sectionCollapseState?.ioCollapsed)
            : isVitalSectionHeaderRow
              ? Boolean(sectionCollapseState?.vitalCollapsed)
              : false;
          const isSpecialRow =
            isEventRowLabel || isIoHeaderRowLabel || isVitalAgentHeaderRowLabel;
          const isRowActive = activeRowId === row.id;
          const rowToneClass =
            rowIndex % 2 === 0 ? "timegrid-row-even" : "timegrid-row-odd";
          const rowCellToneClass = isSpecialRow
            ? isEventRowLabel
              ? "timegrid-row-event-header"
              : isIoHeaderRowLabel
                ? "timegrid-row-io-header"
                : "timegrid-row-vital-header"
            : rowToneClass === "timegrid-row-even"
              ? "timegrid-cell-even"
              : "timegrid-cell-odd";
          const baseLabelClass =
            isRowActive
              ? "font-semibold text-blue-700 dark:text-blue-200"
              : "";
          const specialLabelClass = isEventRowLabel
            ? "badge-event font-semibold"
            : isIoHeaderRowLabel
              ? "badge-start font-semibold"
              : isVitalAgentHeaderRowLabel
                ? "badge-measure font-semibold"
              : "";
          const labelClass = `${specialLabelClass || baseLabelClass}`;

          const labelToneClass = rowCellToneClass;
          const rowClass = isSpecialRow
            ? "transition-colors"
            : `timegrid-row ${rowToneClass} ${isRowActive ? "timegrid-row-active" : ""} transition-colors`;
          const rowHeightClass = isEventRowLabel ? "h-12" : "h-6";

          return (
            <tr
              key={row.id}
              className={rowClass}
              onFocusCapture={() => setActiveRowId(row.id)}
              onPointerDown={() => setActiveRowId(row.id)}
              onBlurCapture={e => {
                const next = e.relatedTarget as Node | null;
                if (!next || !e.currentTarget.contains(next)) {
                  setActiveRowId(null);
                }
              }}
            >
              <td
                style={{
                  width: labelColWidth,
                  minWidth: labelColWidth,
                  transform: `translateX(${scrollLeft}px)`,
                }}
                className={`
                  sticky left-0 z-50 timegrid-sticky-label
                  ${labelToneClass}
                  border-r border-gray-200 dark:border-gray-800
                  px-1.5 py-1
                  text-[10px] leading-none
                  text-gray-800 dark:text-gray-200
                  whitespace-nowrap
                `}
              >
                <div
                  data-tooltip={fullLabel}
                  className={`app-tooltip rounded px-1 py-0.5 w-full flex items-center gap-1 min-w-0 ${labelClass}`}
                >
                  {rowTypeMarker ? (
                    <span
                      className={`inline-flex h-3.5 min-w-[14px] items-center justify-center rounded px-0.5 text-[9px] leading-none font-bold ${rowTypeMarker.className}`}
                    >
                      {rowTypeMarker.label}
                    </span>
                  ) : null}
                  {isSectionHeaderRow ? (
                    <button
                      type="button"
                      onClick={event => {
                        event.stopPropagation();
                        onSectionCollapseToggle?.(isIoSectionHeaderRow ? "io" : "vital");
                      }}
                      className="flex-1 min-w-0 inline-flex items-center justify-between rounded px-1 py-0.5 hover:bg-white/10"
                      title={sectionCollapsed ? "Show" : "Hide"}
                    >
                      <span className="truncate block text-[10px] font-medium text-gray-800 dark:text-gray-200">
                        {row.label}
                      </span>
                      <span className="ml-1 text-[10px] leading-none">{sectionCollapsed ? "+" : "-"}</span>
                    </button>
                  ) : (
                    <div className="flex-1 min-w-0">
                      <span className="truncate block text-[10px] font-medium text-gray-800 dark:text-gray-200">
                        {row.label}
                      </span>
                    </div>
                  )}
                  {isIoDataRow && onIoRowRemove ? (
                    <button
                      type="button"
                      onClick={event => {
                        event.stopPropagation();
                        onIoRowRemove(row.id);
                      }}
                      className="shrink-0 rounded px-1 text-[10px] font-semibold text-red-500 hover:bg-red-500/15 hover:text-red-400"
                      title="Remove item"
                      aria-label={`Remove ${row.label}`}
                    >
                      x
                    </button>
                  ) : null}
                </div>
            </td>

            {startIndex > 0 && (
              <td style={{ width: startIndex * colWidth }} />
            )}

            {visibleColumns.map((ts, i) => {
              const actualIndex = startIndex + i;
              const next = columns[actualIndex + 1] ?? Infinity;
              const isNow = ts <= nowTs && next > nowTs;

              const cellClass = `
                timegrid-row-cell
                border-r border-gray-200 dark:border-gray-800
                text-center ${rowHeightClass}
                relative
                ${rowCellToneClass}
                ${isNow ? "timegrid-now-cell" : ""}
                transition-colors
              `;

              if (row.type === "event") {
                const isPrimaryEventRow = row.id === "event";
                const isFluidMedHeaderRow = row.id === "__io_header__";
                const isVitalAgentHeaderRow = row.id === "__vital_agent_header__";
                const markers = isPrimaryEventRow ? eventMarkersByTs[ts] ?? [] : [];
                const prepared = isFluidMedHeaderRow ? preparedMarkersByTs[ts] ?? [] : [];
                const canOpenEvent = isPrimaryEventRow && Boolean(onEventCellClick);
                const cellActionClass = canOpenEvent
                  ? "cursor-pointer hover:bg-blue-500/15"
                  : "";
                const emptyTooltip = isPrimaryEventRow
                  ? "Add Event/Note"
                  : isFluidMedHeaderRow
                    ? "Fluid&Med segment"
                    : isVitalAgentHeaderRow
                      ? "Vital&Agent segment"
                      : "";

                return (
                  <td
                    key={ts}
                    style={{ width: colWidth, minWidth: colWidth }}
                    className={`app-tooltip ${cellClass} px-0.5 ${cellActionClass}`}
                    onClick={() => {
                      if (canOpenEvent) onEventCellClick?.(ts);
                    }}
                    data-tooltip={
                      markers.length > 0 || prepared.length > 0
                        ? ""
                        : emptyTooltip
                    }
                  >
                    {markers.length > 0 || prepared.length > 0 ? (
                      <div className="h-full w-full flex items-center justify-center gap-0.5 overflow-visible">
                        {markers.slice(0, 3).map(marker => {
                          const token = markerForEvent(marker);
                          return (
                            <button
                              key={marker.id}
                              type="button"
                              className={`app-tooltip inline-flex h-8 min-w-8 items-center justify-center rounded px-0.5 leading-none font-semibold ${token.className}`}
                              data-tooltip={marker.title}
                              title={marker.title}
                              onClick={event => {
                                event.stopPropagation();
                                onEventMarkerClick?.(marker);
                              }}
                            >
                              {token.iconSrc ? (
                                (() => {
                                  const TokenIcon = token.iconSrc;
                                  return <TokenIcon className="h-5 w-5" />;
                                })()
                              ) : (
                                <span className="text-[11px]">{token.label}</span>
                              )}
                            </button>
                          );
                        })}
                        {prepared.slice(0, 2).map(marker => {
                          const token = markerForPrepared(marker);
                          return (
                            <button
                              key={`prepared-${marker.run_id}-${marker.item_id}`}
                              type="button"
                              className={`app-tooltip inline-flex h-3 min-w-3 items-center justify-center rounded px-[2px] text-[8px] leading-none font-semibold ${token.className}`}
                              data-tooltip={`Prepared: ${marker.item_name}`}
                              onClick={event => {
                                event.stopPropagation();
                                onPreparedMarkerClick?.(ts, marker);
                              }}
                            >
                              {token.label}
                            </button>
                          );
                        })}
                        {markers.length > 3 ? (
                          <span
                            className="app-tooltip text-[8px] leading-none text-gray-600 dark:text-gray-300"
                            data-tooltip={`${markers.length - 3} more events`}
                          >
                            +{markers.length - 3}
                          </span>
                        ) : null}
                        {prepared.length > 2 ? (
                          <span
                            className="app-tooltip text-[8px] leading-none text-emerald-700 dark:text-emerald-300"
                            data-tooltip={`${prepared.length - 2} more prepared items`}
                          >
                            +{prepared.length - 2}
                          </span>
                        ) : null}
                      </div>
                    ) : null}
                  </td>
                );
              }

              if (row.type === "ecg") {
                const displayCode = getECGCodeAt(ts);

                return (
                  <td
                    key={ts}
                    style={{ width: colWidth, minWidth: colWidth }}
                    className={`app-tooltip ${cellClass}`}
                    data-tooltip={(values.ecg?.[ts] as string) ?? ""}
                  >
                    <select
                      className="
                        w-full h-full
                        bg-transparent
                        text-center
                        text-[10px] leading-none
                        text-gray-900 dark:text-gray-100
                        font-inherit
                        focus:outline-none
                        cursor-pointer
                      "
                      value={(values.ecg?.[ts] as string) ?? ""}
                      onChange={e => onChange?.("ecg", ts, e.target.value)}
                    >
                      <option value="">{displayCode || "-"}</option>
                      {ECG_OPTIONS.map(o => (
                        <option
                          key={o.value}
                          value={o.value}
                          className="bg-gray-50 dark:bg-gray-900 text-[10px] leading-none"
                        >
                          {o.code}
                        </option>
                      ))}
                    </select>
                  </td>
                );
              }

              if (row.type === "io") {
                const rawValue = values[row.id]?.[ts];
                const ioCell = isIoDisplayCellValue(rawValue) ? rawValue : null;
                const numericAmount =
                  ioCell && Number.isFinite(Number(ioCell.amount))
                    ? Number(ioCell.amount)
                    : null;
                const dripPart = ioCell?.dripPart;
                const hasDrip = Boolean(dripPart);
                const legacyValue =
                  ioCell || rawValue == null ? "" : String(rawValue);
                const shouldShowAmount =
                  numericAmount != null &&
                  (!hasDrip || dripPart === "start" || dripPart === "single");
                const displayValue = shouldShowAmount
                  ? formatAmount(numericAmount)
                  : legacyValue;
                const tooltipParts: string[] = [];
                if (numericAmount != null) {
                  const unitText = row.unit ? ` ${row.unit}` : "";
                  tooltipParts.push(`${formatAmount(numericAmount)}${unitText}`);
                }
                
                // Add minute-by-minute breakdown to tooltip if multiple entries exist
                if (ioCell?.minuteValues && ioCell.minuteValues.length > 0) {
                  const activeMins = ioCell.minuteValues.filter(mv => mv.amount > 0);
                  if (activeMins.length > 1) {
                    const breakdown = activeMins
                      .map(mv => `${formatHHMM(mv.ts)}: ${formatAmount(mv.amount)}${row.unit ? ` ${row.unit}` : ""}`)
                      .join("\n");
                    tooltipParts.push(`\nBreakdown:\n${breakdown}`);
                  }
                }

                if (hasDrip) {
                  const dripLabel =
                    dripPart === "start"
                      ? "Drip start"
                      : dripPart === "end"
                        ? "Drip end"
                        : dripPart === "single"
                          ? "Drip (single bucket)"
                          : "Drip running";
                  tooltipParts.push(dripLabel);
                  if (Number.isFinite(Number(ioCell?.dripRateMlPerHr))) {
                    tooltipParts.push(`Rate ${formatAmount(Number(ioCell?.dripRateMlPerHr))} mL/hr`);
                  }
                  if (Number.isFinite(Number(ioCell?.dripCarrierMlPerHr))) {
                    tooltipParts.push(
                      `Carrier ${formatAmount(Number(ioCell?.dripCarrierMlPerHr))} mL/hr`,
                    );
                  }
                }
                const tooltipText =
                  tooltipParts.length > 0
                    ? tooltipParts.join("\n")
                    : displayValue || "Input value";
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
                  <td
                    key={ts}
                    style={{ width: colWidth, minWidth: colWidth }}
                    className={`app-tooltip ${cellClass} px-0.5 cursor-pointer hover:bg-emerald-500/10`}
                    onClick={() => onIoCellClick?.(row.id, ts)}
                    data-tooltip={tooltipText}
                  >
                    <div
                      className="
                        h-full w-full
                        px-1
                        relative
                        flex items-center justify-center
                        text-[10px] leading-none
                        text-gray-900 dark:text-gray-100
                        truncate
                      "
                    >
                      {hasDrip ? <span className={dripClass} /> : null}
                      {displayValue ? (
                        <span className="relative z-10">{displayValue}</span>
                      ) : !hasDrip ? (
                        <span className="relative z-10">+</span>
                      ) : null}
                    </div>
                  </td>
                );
              }

              const displayCell = getDisplayCell(row.id, ts, actualIndex);
              const raw = displayCell.value;
              const value = raw == null ? "" : String(raw);
              const fallbackHint =
                displayCell.isFallback && displayCell.sourceTs != null
                  ? `Nearest from ${formatHHMM(displayCell.sourceTs)}`
                  : "";

              if (value !== "" && !isNumericLike(raw)) {
                return (
                  <td
                    key={ts}
                    style={{ width: colWidth, minWidth: colWidth }}
                    className={`app-tooltip ${cellClass}`}
                    data-tooltip={fallbackHint ? `${value} (${fallbackHint})` : value}
                  >
                    <div
                      className="
                        h-full w-full overflow-hidden
                        px-1
                        flex items-center justify-center
                        text-[10px] leading-none
                        text-gray-900 dark:text-gray-100
                        whitespace-nowrap
                      "
                    >
                      <span
                        className={`block w-full truncate ${
                          displayCell.isFallback
                            ? "text-amber-700 dark:text-amber-300"
                            : ""
                        }`}
                      >
                        {value}
                      </span>
                    </div>
                  </td>
                );
              }

              return (
                <td
                  key={ts}
                  style={{ width: colWidth, minWidth: colWidth }}
                  className={`app-tooltip ${cellClass}`}
                  data-tooltip={fallbackHint ? `${value} (${fallbackHint})` : value}
                >
                  <input
                    type="number"
                    step="any"
                    className={`
                      w-full h-full
                      bg-transparent
                      text-center
                      text-[10px] leading-none
                      ${displayCell.isFallback ? "text-amber-600 dark:text-amber-400 font-medium" : "text-gray-900 dark:text-gray-100"}
                      font-inherit
                      focus:outline-none
                      relative z-10
                    `}
                    value={value}
                    onWheel={e => e.currentTarget.blur()}
                    onChange={e => {
                      const nextValue = e.target.value.trim();
                      onChange?.(
                        row.id,
                        ts,
                        nextValue === "" ? undefined : Number(nextValue),
                      );
                    }}
                  />
                </td>
              );
            })}

            {endIndex < columns.length - 1 && (
              <td style={{ width: (columns.length - 1 - endIndex) * colWidth }} />
            )}
          </tr>
          );
        })}
      </tbody>
    </table>
  );
}
