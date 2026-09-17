export type GridRowType = "event" | "ecg" | "vital" | "io";

export interface TimeGridRow {
  id: string;
  label: string;
  type: GridRowType;
  unit?: string;
  /** Clinical master-data detail shown when the row label is inspected. */
  referenceTooltip?: string;
  /** For IO rows: whether this item was added as bolus or drip */
  displayMode?: "bolus" | "drip";
  /** For IO rows: kind of item (med / fluid / output) */
  ioKind?: "med" | "fluid" | "output";
  /** For IO rows: item category (e.g. bloodProduct) */
  ioCategory?: string;
  /** For blood product IO rows: current bag state */
  ioStatus?: string;
  /** For IO rows that need a second-line summary */
  ioDetail?: string;
}

/**
 * values[rowId][timestamp] = value
 * timestamp is number (ms) — SAME as TimeAxis
 */
export type TimeGridValues = {
  [rowId: string]: {
    [ts: number]: unknown;
  };
};
