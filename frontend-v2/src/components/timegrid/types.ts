export type GridRowType = "event" | "ecg" | "vital" | "io";

export interface TimeGridRow {
  id: string;
  label: string;
  type: GridRowType;
  unit?: string;
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
