const BASE = "http://localhost:3001/api/case";

export type CaseStatus =
  | { status: "IDLE" }
  | {
      status: "ACTIVE" | "DISCHARGED" | "ARCHIVED";
      case_id: number;
      hn: string;
      start_time: number;
      discharge_time?: number;
    };

export type CaseListRow = {
  case_id: number;
  case_code: string;
  hn: string;
  status: "ACTIVE" | "DISCHARGED" | "ARCHIVED";
  start_time: number;
  discharge_time?: number;
  created_at: number;
};

export type SuggestedCaseEnd = {
  case_id: number;
  suggested_end_time: number;
  last_activity_time: number;
  idle_tail_ms: number;
  has_end_ane: boolean;
  based_on: string;
} | null;

export type StartCaseOverlapPolicy = "include" | "exclude";

export type CaseStartOverlap = {
  previous_case_id: number;
  previous_case_hn: string;
  previous_case_status: "DISCHARGED" | "ARCHIVED";
  previous_case_end_time: number;
  overlap_start_time: number;
  overlap_end_time: number;
  overlap_minute_count: number;
  suggested_capture_start_time: number;
};

export async function getCaseStatus(): Promise<CaseStatus> {
  const res = await fetch(`${BASE}/status`);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message =
      data && typeof data.error === "string"
        ? data.error
        : `get case status failed (${res.status})`;
    throw new Error(message);
  }
  return data as CaseStatus;
}

export async function getCaseStartOverlap(
  start_time: number,
): Promise<CaseStartOverlap | null> {
  const res = await fetch(`${BASE}/start-overlap-check`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ start_time }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message =
      data && typeof data.error === "string"
        ? data.error
        : `start overlap check failed (${res.status})`;
    throw new Error(message);
  }
  return ((data as { overlap?: CaseStartOverlap | null }).overlap ?? null);
}

export async function startCase(
  hn: string,
  start_time: number,
  options?: { overlapPolicy?: StartCaseOverlapPolicy },
) {
  const res = await fetch(`${BASE}/start`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      hn,
      start_time,
      ...(options?.overlapPolicy ? { overlap_policy: options.overlapPolicy } : {}),
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message =
      data && typeof data.error === "string"
        ? data.error
        : `start case failed (${res.status})`;
    throw new Error(message);
  }
  return data;
}

export async function dischargeCase(case_id: number, discharge_time?: number) {
  const res = await fetch(`${BASE}/discharge`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      case_id,
      ...(Number.isFinite(discharge_time) ? { discharge_time } : {}),
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message =
      data && typeof data.error === "string"
        ? data.error
        : `discharge failed (${res.status})`;
    throw new Error(message);
  }
  return data;
}

export async function archiveCase(case_id: number) {
  const res = await fetch(`${BASE}/archive`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ case_id }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message =
      data && typeof data.error === "string"
        ? data.error
        : `archive failed (${res.status})`;
    throw new Error(message);
  }
  return data;
}

export async function updateCaseStartTime(case_id: number, start_time: number) {
  const res = await fetch(`${BASE}/${case_id}/start-time`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ start_time }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message =
      data && typeof data.error === "string"
        ? data.error
        : `update start time failed (${res.status})`;
    throw new Error(message);
  }
  return data;
}

export async function updateCaseDischargeTime(case_id: number, discharge_time: number) {
  const res = await fetch(`${BASE}/${case_id}/discharge-time`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ discharge_time }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message =
      data && typeof data.error === "string"
        ? data.error
        : `update discharge time failed (${res.status})`;
    throw new Error(message);
  }
  return data;
}

export async function getCaseList(
  limit = 30,
  includeArchived = true,
): Promise<CaseListRow[]> {
  const params = new URLSearchParams();
  params.set("limit", String(limit));
  params.set("include_archived", includeArchived ? "1" : "0");
  const res = await fetch(`${BASE}/list?${params.toString()}`);
  if (!res.ok) return [];
  const data = (await res.json()) as { rows?: unknown[] };
  const rows = Array.isArray(data.rows) ? data.rows : [];
  const normalized: CaseListRow[] = [];
  for (const row of rows) {
    const value = row as Partial<CaseListRow>;
    const status = String(value.status || "").toUpperCase();
    if (status !== "ACTIVE" && status !== "DISCHARGED" && status !== "ARCHIVED") {
      continue;
    }
    const caseId = Number(value.case_id);
    const startTime = Number(value.start_time);
    if (!Number.isFinite(caseId) || !Number.isFinite(startTime)) continue;

    normalized.push({
      case_id: caseId,
      case_code: String(value.case_code || ""),
      hn: String(value.hn || ""),
      status,
      start_time: startTime,
      discharge_time:
        value.discharge_time == null ? undefined : Number(value.discharge_time),
      created_at: Number(value.created_at || 0),
    });
  }
  return normalized;
}

export type WriterStatus = {
  caseId: number;
  currentMinute: number;
  running: boolean;
  startedAt: number;
  lastTickTs: number | null;
  lastWrittenMinute: number | null;
  lastError: string | null;
  consecutiveErrors: number;
  ivyRetryAfterTs: number;
} | null;

export async function getWriterStatus(case_id: number): Promise<WriterStatus> {
  const res = await fetch(`${BASE}/${case_id}/writer-status`);
  if (!res.ok) return null;
  const data = await res.json().catch(() => ({}));
  return (data as { writer: WriterStatus }).writer ?? null;
}

export async function triggerWriterRefetch(case_id: number): Promise<void> {
  const res = await fetch(`${BASE}/${case_id}/writer-refetch`, { method: "POST" });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message =
      data && typeof data.error === "string"
        ? data.error
        : `writer refetch failed (${res.status})`;
    throw new Error(message);
  }
}

export async function getSuggestedCaseEndTime(case_id: number): Promise<SuggestedCaseEnd> {
  const res = await fetch(`${BASE}/${case_id}/suggested-end`);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message =
      data && typeof data.error === "string"
        ? data.error
        : `get suggested end failed (${res.status})`;
    throw new Error(message);
  }
  const suggestion = (data as { suggestion?: SuggestedCaseEnd }).suggestion;
  return suggestion ?? null;
}
