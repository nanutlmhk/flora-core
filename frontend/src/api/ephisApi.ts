const BASE = "http://localhost:3001/api/ephis";

export type EphisImportStatus = {
  total_rows: number;
  first_admit_date: string | null;
  last_admit_date: string | null;
  last_imported_at: number | null;
};

export type EphisDailySummaryRow = {
  admit_date: string;
  case_count: number;
};

export type EphisDailyCaseRow = {
  hn: string;
  admit_date: string;
  admit_datetime: string | null;
  raw_admit_value: string | null;
};

export async function getEphisImportStatus(): Promise<EphisImportStatus> {
  const res = await fetch(`${BASE}/import-status`);
  if (!res.ok) {
    throw new Error(`load import status failed (${res.status})`);
  }
  return (await res.json()) as EphisImportStatus;
}

export async function importEphisDailyCases(tsvText: string, replaceExisting = true) {
  const res = await fetch(`${BASE}/import-daily-cases`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tsvText, replaceExisting }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message =
      data && typeof data.error === "string"
        ? data.error
        : `daily case import failed (${res.status})`;
    throw new Error(message);
  }
  return data as {
    ok: true;
    imported_rows: number;
    total_rows: number;
    first_admit_date: string | null;
    last_admit_date: string | null;
    imported_at: number;
  };
}

export async function getEphisDailySummary(filters?: {
  from?: string;
  to?: string;
}): Promise<EphisDailySummaryRow[]> {
  const params = new URLSearchParams();
  if (filters?.from) params.set("from", filters.from);
  if (filters?.to) params.set("to", filters.to);
  const res = await fetch(`${BASE}/daily-summary?${params.toString()}`);
  if (!res.ok) {
    throw new Error(`load daily summary failed (${res.status})`);
  }
  const data = (await res.json()) as { rows?: EphisDailySummaryRow[] };
  return Array.isArray(data.rows) ? data.rows : [];
}

export async function getEphisDailyCases(filters?: {
  admit_date?: string;
  hn?: string;
}): Promise<EphisDailyCaseRow[]> {
  const params = new URLSearchParams();
  if (filters?.admit_date) params.set("admit_date", filters.admit_date);
  if (filters?.hn) params.set("hn", filters.hn);
  const res = await fetch(`${BASE}/daily-cases?${params.toString()}`);
  if (!res.ok) {
    throw new Error(`load daily cases failed (${res.status})`);
  }
  const data = (await res.json()) as { rows?: EphisDailyCaseRow[] };
  return Array.isArray(data.rows) ? data.rows : [];
}
