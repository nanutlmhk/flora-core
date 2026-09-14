import { BACKEND_BASE } from "./backendBase";

const BASE = `${BACKEND_BASE}/api/case`;

export type VitalMinuteRow = {
  ts_minute: number;
  payload: Record<string, unknown>;
};

type VitalMinuteResponse = {
  rows: VitalMinuteRow[];
};

export type TimelineActor = {
  username: string;
  name?: string;
  role?: string;
};

export type TimelineChange = {
  ts_minute: number;
  param_key: string;
  value?: unknown;
  value_type?: "number" | "text" | "code";
  source?: "manual" | "override";
  action?: "upsert" | "delete";
  note?: string;
  unit?: string;
};

export async function getEffectiveTimeline(
  caseId: number,
  fromTs: number,
  toTs: number,
): Promise<VitalMinuteRow[]> {
  const params = new URLSearchParams({
    from: String(fromTs),
    to: String(toTs),
  });

  const res = await fetch(
    `${BASE}/${caseId}/timeline/effective?${params.toString()}`,
  );

  if (!res.ok) {
    throw new Error(`timeline effective fetch failed ${res.status}`);
  }

  const data = (await res.json()) as VitalMinuteResponse;
  return Array.isArray(data.rows) ? data.rows : [];
}

export async function putTimelineChanges(
  caseId: number,
  actor: TimelineActor,
  changes: TimelineChange[],
  reason?: string,
) {
  const res = await fetch(`${BASE}/${caseId}/timeline`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      actor,
      reason,
      changes,
    }),
  });

  if (!res.ok) {
    throw new Error(`timeline save failed ${res.status}`);
  }

  return res.json();
}
