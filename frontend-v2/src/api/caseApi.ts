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

export async function getCaseStatus(): Promise<CaseStatus> {
  const res = await fetch(`${BASE}/status`);
  return res.json();
}

export async function startCase(hn: string, start_time: number) {
  const res = await fetch(`${BASE}/start`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ hn, start_time }),
  });
  return res.json();
}

export async function dischargeCase(case_id: number) {
  const res = await fetch(`${BASE}/discharge`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ case_id }),
  });
  return res.json();
}

export async function archiveCase(case_id: number) {
  const res = await fetch(`${BASE}/archive`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ case_id }),
  });
  return res.json();
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
