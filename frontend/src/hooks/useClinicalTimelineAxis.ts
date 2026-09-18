import { useEffect, useState } from "react";
import { getClinicalTimelineAxis } from "../api/clinicalTimelineApi";

type CaseStatus = "IDLE" | "ACTIVE" | "DISCHARGED" | "ARCHIVED";

export function useClinicalTimelineAxis(
  caseId: number | null,
  status: CaseStatus,
  stepMin = 1,
) {
  const [axis, setAxis] = useState<number[]>([]);
  const [loading, setLoading] = useState(false);
  const [serverOffsetMs, setServerOffsetMs] = useState(0);
  const [lastSyncedAt, setLastSyncedAt] = useState<number | null>(null);

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
        const receivedAt = Date.now();
        const result = await getClinicalTimelineAxis(activeCaseId, stepMin);
        const next = result.axis;
        if (!alive) return;

        if (Number.isFinite(result.serverTime)) {
          setServerOffsetMs(result.serverTime - (receivedAt + Date.now()) / 2);
        }
        setLastSyncedAt(Date.now());

        setAxis(prev => {
          if (prev.length !== next.length) return next;
          for (let i = 0; i < prev.length; i += 1) {
            if (prev[i] !== next[i]) return next;
          }
          return prev;
        });
      } catch (err) {
        console.error("[useClinicalTimelineAxis] fetch failed", err);
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
      window.addEventListener("flora:case-start-time-updated", onStartTimeUpdated);
      return () => {
        alive = false;
        clearInterval(timer);
        window.removeEventListener("flora:case-start-time-updated", onStartTimeUpdated);
      };
    }

    return () => {
      alive = false;
    };
  }, [caseId, status, stepMin]);

  return { axis, loading, serverOffsetMs, lastSyncedAt };
}
