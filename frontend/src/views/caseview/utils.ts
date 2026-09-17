import type { TimeGridValues } from "../../components/timegrid/types";
import { normalizeTimeInputHHMM } from "../../utils/clinicalInput";
import {
  formatConfiguredTime,
  getStoredDateTimePreferences,
  timestampToWallClockInput,
  wallClockInputToTimestamp,
} from "../../utils/dateTime";

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
  return formatConfiguredTime(ts, getStoredDateTimePreferences());
}

export function toTsOnSameDate(baseTs: number, hhmm: string): number | null {
  const normalized = normalizeHHMM(hhmm);
  if (!normalized) return null;
  const preferences = getStoredDateTimePreferences();
  const date = timestampToWallClockInput(baseTs, preferences.timezone).slice(0, 10);
  return wallClockInputToTimestamp(`${date}T${normalized}`, preferences.timezone);
}
