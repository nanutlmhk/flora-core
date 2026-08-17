import type { TimeGridValues } from "../../components/timegrid/types";
import { normalizeTimeInputHHMM } from "../../utils/clinicalInput";

export function mergeValues(base: TimeGridValues, override: TimeGridValues): TimeGridValues {
  const merged: TimeGridValues = {};

  for (const [rowId, rowValues] of Object.entries(base)) {
    merged[rowId] = { ...rowValues };
  }

  for (const [rowId, rowValues] of Object.entries(override)) {
    const nextRow = { ...(merged[rowId] ?? {}) };

    for (const [tsKey, value] of Object.entries(rowValues)) {
      const ts = Number(tsKey);
      if (value === undefined || value === "") {
        delete nextRow[ts];
      } else {
        nextRow[ts] = value;
      }
    }

    if (Object.keys(nextRow).length === 0) {
      delete merged[rowId];
    } else {
      merged[rowId] = nextRow;
    }
  }

  return merged;
}

export function normalizeHHMM(value: string): string | null {
  return normalizeTimeInputHHMM(value);
}

export function formatHHMM(ts: number): string {
  const d = new Date(ts);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

export function toTsOnSameDate(baseTs: number, hhmm: string): number | null {
  const normalized = normalizeHHMM(hhmm);
  if (!normalized) return null;
  const [hh, mm] = normalized.split(":");
  const d = new Date(baseTs);
  d.setHours(Number(hh), Number(mm), 0, 0);
  return d.getTime();
}
