import { useEffect, useState } from "react";
import { getTimeAxis } from "../api/timeAxisApi";

type CaseStatus = "IDLE" | "ACTIVE" | "DISCHARGED" | "ARCHIVED";

export function useTimeAxis(
  caseId: number | null,
  status: CaseStatus,
  stepMin = 1,
) {
  const [axis, setAxis] = useState<number[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (caseId == null || status === "IDLE") {
      setAxis([]);
      setLoading(false);
      return;
    }

    const activeCaseId = caseId;
    let alive = true;

    async function fetchAxis(showLoading = false) {
      if (showLoading) setLoading(true);
      try {
        const next = await getTimeAxis(activeCaseId, stepMin);
        if (!alive) return;

        setAxis(prev => {
          if (prev.length !== next.length) return next;
          for (let i = 0; i < prev.length; i += 1) {
            if (prev[i] !== next[i]) return next;
          }
          return prev;
        });
      } catch (err) {
        console.error("[useTimeAxis] fetch failed", err);
      } finally {
        if (alive) setLoading(false);
      }
    }

    // always fetch once, show loading only on initial/scale change
    fetchAxis(true);

    // poll only when ACTIVE
    if (status === "ACTIVE") {
      const onStartTimeUpdated = (event: Event) => {
        const custom = event as CustomEvent<{ caseId?: number }>;
        const changedCaseId = Number(custom.detail?.caseId);
        if (!Number.isFinite(changedCaseId) || changedCaseId !== activeCaseId) return;
        void fetchAxis(true);
      };
      const timer = setInterval(() => fetchAxis(false), 60_000);
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
  }, [caseId, status, stepMin]);

  return { axis, loading };
}
