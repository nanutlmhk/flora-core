const BASE = "http://localhost:3001/api/case";

export type CaseEventType = "event" | "note";

export type CaseEvent = {
  id: number;
  event_ts: number;
  event_type: CaseEventType;
  title: string;
  detail?: string | null;
  created_by: string;
  created_at: number;
  updated_by?: string;
  updated_at?: number;
};

export type EventActor = {
  username: string;
  name?: string;
  role?: string;
};

type CaseEventResponse = {
  rows: CaseEvent[];
};

async function buildApiError(prefix: string, res: Response) {
  const body = await res.text();
  const short = body.replace(/\s+/g, " ").slice(0, 140);
  return new Error(`${prefix} (${res.status}) ${short}`);
}

export async function getCaseEvents(
  caseId: number,
  fromTs: number,
  toTs: number,
  limit = 300,
): Promise<CaseEvent[]> {
  const params = new URLSearchParams({
    from: String(fromTs),
    to: String(toTs),
    limit: String(limit),
  });

  const res = await fetch(`${BASE}/${caseId}/events?${params.toString()}`);
  if (!res.ok) {
    throw await buildApiError("Events load failed", res);
  }

  const data = (await res.json()) as CaseEventResponse;
  return Array.isArray(data.rows) ? data.rows : [];
}

export async function createCaseEvent(
  caseId: number,
  payload: {
    event_ts: number;
    event_type: CaseEventType;
    title: string;
    detail?: string;
    actor: EventActor;
    reason?: string;
  },
) {
  const res = await fetch(`${BASE}/${caseId}/events`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    throw await buildApiError("Save event failed", res);
  }
  return res.json();
}

export async function deleteCaseEvent(
  caseId: number,
  eventId: number,
  actor: EventActor,
  reason?: string,
) {
  const res = await fetch(`${BASE}/${caseId}/events/${eventId}`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ actor, reason }),
  });

  if (!res.ok) {
    throw await buildApiError("Delete event failed", res);
  }
  return res.json();
}

export async function updateCaseEvent(
  caseId: number,
  eventId: number,
  payload: {
    event_ts?: number;
    event_type?: CaseEventType;
    title?: string;
    detail?: string;
    actor: EventActor;
    reason?: string;
  },
) {
  const res = await fetch(`${BASE}/${caseId}/events/${eventId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    throw await buildApiError("Update event failed", res);
  }
  return res.json();
}
