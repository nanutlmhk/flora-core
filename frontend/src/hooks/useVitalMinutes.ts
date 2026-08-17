import { useEffect, useState } from "react";
import { getEffectiveTimeline } from "../api/vitalMinutesApi";
import type { TimeGridValues } from "../components/timegrid/types";

type CaseStatus = "IDLE" | "ACTIVE" | "DISCHARGED" | "ARCHIVED";

const PARAM_KEY_MAP: Record<string, string> = {
  heart_rate: "hr",
  pulse_rate: "pr",
  spo2_pr: "pr",
  pr: "pr",
  spo2: "spo2",
  nibp_sys: "nibp_sys",
  nibp_dia: "nibp_dia",
  nibp_mean: "nibp_map",
  nibp_map: "nibp_map",
  art_sys: "art_sys",
  art_dia: "art_dia",
  art_mean: "art_map",
  art_map: "art_map",
  cvp: "cvp",

  "unknown::147842": "hr",
  "unknown::149530": "pr",
  "unknown::150456": "spo2",
  "unknown::150021": "nibp_sys",
  "unknown::150022": "nibp_dia",
  "unknown::150023": "nibp_map",
  "unknown::hr": "hr",
  "unknown::pr": "pr",
  "unknown::spo2": "spo2",
  "unknown::nibp sys": "nibp_sys",
  "unknown::nibp dia": "nibp_dia",
  "unknown::nibp map": "nibp_map",
  "unknown::ventilation mode": "set_vent_mode",
};

function toRowId(key: string) {
  const normalized = key.trim().toLowerCase();
  return PARAM_KEY_MAP[normalized] || normalized;
}

function toTimeGridValues(
  rows: Array<{ ts_minute: number; payload: Record<string, unknown> }>,
): TimeGridValues {
  const next: TimeGridValues = {};

  for (const row of rows) {
    const ts = Number(row.ts_minute);
    if (!Number.isFinite(ts)) continue;

    for (const [rawKey, rawValue] of Object.entries(row.payload || {})) {
      if (rawValue == null || rawValue === "") continue;

      const rowId = toRowId(rawKey);
      const byTs = next[rowId] ?? {};
      byTs[ts] = rawValue;
      next[rowId] = byTs;
    }
  }

  return next;
}

export function useVitalMinutes(
  caseId: number | null,
  status: CaseStatus,
  axis: number[],
) {
  const [values, setValues] = useState<TimeGridValues>({});
  const [loading, setLoading] = useState(false);
  const [fetchedAxis, setFetchedAxis] = useState<number[]>([]);

  useEffect(() => {
    if (
      caseId == null ||
      status === "IDLE" ||
      axis.length === 0
    ) {
      setValues({});
      setFetchedAxis([]);
      setLoading(false);
      return;
    }

    const activeCaseId = caseId;
    const currentAxis = axis;
    const fromTs = axis[0];
    const stepMs = axis.length > 1 ? Math.max(1, axis[1] - axis[0]) : 60_000;
    const toTs = axis[axis.length - 1] + stepMs - 1;
    let alive = true;

    async function fetchVitals(showLoading = false) {
      if (showLoading) setLoading(true);
      try {
        const rows = await getEffectiveTimeline(activeCaseId, fromTs, toTs);
        if (!alive) return;
        setValues(toTimeGridValues(rows));
        setFetchedAxis(currentAxis);
      } catch (err) {
        console.error("[useVitalMinutes] fetch failed", err);
      } finally {
        if (alive) setLoading(false);
      }
    }

    fetchVitals(true);

    if (status === "ACTIVE") {
      const onStartTimeUpdated = (event: Event) => {
        const custom = event as CustomEvent<{ caseId?: number }>;
        const changedCaseId = Number(custom.detail?.caseId);
        if (!Number.isFinite(changedCaseId) || changedCaseId !== activeCaseId) return;
        void fetchVitals(true);
      };
      const timer = setInterval(() => fetchVitals(false), 15_000);
      window.addEventListener("aidas:case-start-time-updated", onStartTimeUpdated);
      return () => {
        alive = false;
        clearInterval(timer);
        window.removeEventListener("aidas:case-start-time-updated", onStartTimeUpdated);
      };
    }

    return () => {
      alive = false;
    };
  }, [caseId, status, axis]);

  return { values, loading, fetchedAxis };
}
