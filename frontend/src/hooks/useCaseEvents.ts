import { useEffect, useState } from "react";
import { getCaseEvents, type CaseEvent } from "../api/caseEventApi";

type CaseStatus = "IDLE" | "ACTIVE" | "DISCHARGED" | "ARCHIVED";

export function useCaseEvents(
  caseId: number | null,
  status: CaseStatus,
  axis: number[],
) {
  const fromTs = axis[0];
  const stepMs = axis.length > 1 ? Math.max(1, axis[1] - axis[0]) : 60_000;
  const toTs = axis.length > 0 ? axis[axis.length - 1] + stepMs - 1 : 0;
  const requestKey =
    caseId == null || status === "IDLE" || axis.length === 0
      ? ""
      : `${caseId}:${fromTs}:${toTs}`;
  const [snapshot, setSnapshot] = useState<{ key: string; rows: CaseEvent[] }>({
    key: "",
    rows: [],
  });

  useEffect(() => {
    if (!requestKey || caseId == null) return;

    const activeCaseId = caseId;
    let alive = true;

    async function fetchEvents() {
      try {
        const rows = await getCaseEvents(activeCaseId, fromTs, toTs, 500);
        if (!alive) return;
        setSnapshot({ key: requestKey, rows });
      } catch (err) {
        console.error("[useCaseEvents] fetch failed", err);
      }
    }

    void fetchEvents();

    const onExternalRefresh = (event: Event) => {
      const custom = event as CustomEvent<{ caseId?: number }>;
      if (custom.detail?.caseId !== activeCaseId) return;
      void fetchEvents();
    };
    window.addEventListener("flora:case-events-changed", onExternalRefresh);

    if (status === "ACTIVE") {
      const timer = setInterval(() => {
        void fetchEvents();
      }, 15_000);
      return () => {
        alive = false;
        clearInterval(timer);
        window.removeEventListener(
          "flora:case-events-changed",
          onExternalRefresh,
        );
      };
    }

    return () => {
      alive = false;
      window.removeEventListener("flora:case-events-changed", onExternalRefresh);
    };
  }, [caseId, fromTs, requestKey, status, toTs]);

  return snapshot.key === requestKey ? snapshot.rows : [];
}
