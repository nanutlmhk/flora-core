import type { ClinicalTimelineValues } from "../../components/clinical-timeline/types";
import { normalizeTimeInputHHMM } from "../../utils/clinicalInput";
import {
  formatConfiguredTime,
  getStoredDateTimePreferences,
  timestampToWallClockInput,
  wallClockInputToTimestamp,
} from "../../utils/dateTime";

export function mergeValues(base: ClinicalTimelineValues, override: ClinicalTimelineValues): ClinicalTimelineValues {
  const merged: ClinicalTimelineValues = {};

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

export function hasMeaningfulTimelineValue(values: Record<number, unknown> | undefined): boolean {
  if (!values) return false;
  return Object.values(values).some(value => {
    if (value == null || value === false) return false;
    if (typeof value === "number") return Number.isFinite(value) && value !== 0;
    const normalized = String(value).trim().toLowerCase();
    if (!normalized || normalized === "-" || normalized === "—" || normalized === "null" || normalized === "n/a") return false;
    const numeric = Number(normalized);
    return !Number.isFinite(numeric) || numeric !== 0;
  });
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
