import { useEffect, useState } from "react";
import { getCaseEvents, type CaseEvent } from "../api/caseEventApi";

type CaseStatus = "IDLE" | "ACTIVE" | "DISCHARGED" | "ARCHIVED";

export function useCaseEvents(
  caseId: number | null,
  status: CaseStatus,
  axis: number[],
) {
  const [events, setEvents] = useState<CaseEvent[]>([]);

  useEffect(() => {
    if (
      caseId == null ||
      status === "IDLE" ||
      axis.length === 0
    ) {
      setEvents([]);
      return;
    }

    const activeCaseId = caseId;
    const fromTs = axis[0];
    const stepMs = axis.length > 1 ? Math.max(1, axis[1] - axis[0]) : 60_000;
    const toTs = axis[axis.length - 1] + stepMs - 1;
    let alive = true;

    async function fetchEvents() {
      try {
        const rows = await getCaseEvents(activeCaseId, fromTs, toTs, 500);
        if (!alive) return;
        setEvents(rows);
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
    window.addEventListener("aidas:case-events-changed", onExternalRefresh);

    if (status === "ACTIVE") {
      const timer = setInterval(() => {
        void fetchEvents();
      }, 15_000);
      return () => {
        alive = false;
        clearInterval(timer);
        window.removeEventListener(
          "aidas:case-events-changed",
          onExternalRefresh,
        );
      };
    }

    return () => {
      alive = false;
      window.removeEventListener("aidas:case-events-changed", onExternalRefresh);
    };
  }, [caseId, status, axis]);

  return events;
}
