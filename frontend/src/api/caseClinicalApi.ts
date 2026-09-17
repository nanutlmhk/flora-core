import { BACKEND_BASE } from "./backendBase";

const BASE = `${BACKEND_BASE}/api/case`;

export type Icd10Match = {
  icd10: string;
  icd10who: string;
  diagseq?: number | null;
  name_en?: string | null;
  name_th?: string | null;
  extcause?: number | null;
  mcode?: number | null;
  ca?: number | null;
};

export type Icd9ProcedureMatch = {
  icd9cm: string;
  short_name_en?: string | null;
  name_en?: string | null;
};

export type CaseDiagnosisRow = {
  id: number;
  diagnosis_text: string;
  icd_text?: string | null;
  icd_code?: string | null;
  icd_version?: string | null;
  concept_id?: number | null;
  coding_snapshot?: Record<string, string> | null;
  seq: number;
  event_ts: number;
  entry_context: "preoperative" | "intraoperative" | "postoperative";
  created_at: number;
};

export type CaseProcedureRow = {
  id: number;
  procedure_text: string;
  icd_text?: string | null;
  icd_code?: string | null;
  icd_version?: string | null;
  concept_id?: number | null;
  coding_snapshot?: Record<string, string> | null;
  seq: number;
  event_ts: number;
  entry_context: "planned" | "performed";
  created_at: number;
};

async function buildApiError(prefix: string, res: Response) {
  const body = await res.text();
  const short = body.replace(/\s+/g, " ").slice(0, 180);
  return new Error(`${prefix} (${res.status}) ${short}`);
}

export async function searchIcd10(
  q: string,
  limit = 20,
): Promise<Icd10Match[]> {
  const query = q.trim();
  if (!query) return [];
  const params = new URLSearchParams({
    q: query,
    limit: String(limit),
  });
  const res = await fetch(`${BASE}/icd10/search?${params.toString()}`);
  if (!res.ok) throw await buildApiError("ICD10 search failed", res);
  const data = (await res.json()) as { rows?: Icd10Match[] };
  return Array.isArray(data.rows) ? data.rows : [];
}

export async function searchIcd9Procedures(
  q: string,
  limit = 20,
): Promise<Icd9ProcedureMatch[]> {
  const query = q.trim();
  if (!query) return [];
  const params = new URLSearchParams({
    q: query,
    limit: String(limit),
  });
  const res = await fetch(`${BASE}/icd9/search?${params.toString()}`);
  if (!res.ok) throw await buildApiError("ICD9 search failed", res);
  const data = (await res.json()) as { rows?: Icd9ProcedureMatch[] };
  return Array.isArray(data.rows) ? data.rows : [];
}

export async function getCaseDiagnosis(caseId: number): Promise<CaseDiagnosisRow[]> {
  const res = await fetch(`${BASE}/${caseId}/diagnosis`);
  if (!res.ok) throw await buildApiError("Diagnosis load failed", res);
  const data = (await res.json()) as { rows?: CaseDiagnosisRow[] };
  return Array.isArray(data.rows) ? data.rows : [];
}

export async function createCaseDiagnosis(
  caseId: number,
  payload: {
    diagnosis_text: string;
    icd_text?: string;
    icd_code?: string;
    icd_version?: string;
    terminology_entry_id?: number;
    concept_id?: number;
    local_id?: string;
    seq?: number;
    event_ts?: number;
    entry_context?: "preoperative" | "intraoperative" | "postoperative";
  },
): Promise<CaseDiagnosisRow> {
  const res = await fetch(`${BASE}/${caseId}/diagnosis`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw await buildApiError("Diagnosis create failed", res);
  const data = (await res.json()) as { row?: CaseDiagnosisRow };
  if (!data.row) throw new Error("Diagnosis create failed");
  return data.row;
}

export async function deleteCaseDiagnosis(caseId: number, diagnosisId: number) {
  const res = await fetch(`${BASE}/${caseId}/diagnosis/${diagnosisId}`, {
    method: "DELETE",
  });
  if (!res.ok) throw await buildApiError("Diagnosis delete failed", res);
}

export async function updateCaseDiagnosis(
  caseId: number,
  diagnosisId: number,
  payload: {
    diagnosis_text?: string;
    icd_text?: string;
    icd_code?: string;
    icd_version?: string;
    terminology_entry_id?: number;
    concept_id?: number;
    local_id?: string;
    seq?: number;
    event_ts?: number;
    entry_context?: "preoperative" | "intraoperative" | "postoperative";
  },
): Promise<CaseDiagnosisRow> {
  const res = await fetch(`${BASE}/${caseId}/diagnosis/${diagnosisId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw await buildApiError("Diagnosis update failed", res);
  const data = (await res.json()) as { row?: CaseDiagnosisRow };
  if (!data.row) throw new Error("Diagnosis update failed");
  return data.row;
}

export async function getCaseProcedures(caseId: number): Promise<CaseProcedureRow[]> {
  const res = await fetch(`${BASE}/${caseId}/procedures`);
  if (!res.ok) throw await buildApiError("Operation load failed", res);
  const data = (await res.json()) as { rows?: CaseProcedureRow[] };
  return Array.isArray(data.rows) ? data.rows : [];
}

export async function createCaseProcedure(
  caseId: number,
  payload: {
    procedure_text: string;
    icd_text?: string;
    icd_code?: string;
    icd_version?: string;
    terminology_entry_id?: number;
    concept_id?: number;
    local_id?: string;
    seq?: number;
    event_ts?: number;
    entry_context?: "planned" | "performed";
  },
): Promise<CaseProcedureRow> {
  const res = await fetch(`${BASE}/${caseId}/procedures`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw await buildApiError("Operation create failed", res);
  const data = (await res.json()) as { row?: CaseProcedureRow };
  if (!data.row) throw new Error("Operation create failed");
  return data.row;
}

export async function deleteCaseProcedure(caseId: number, procedureId: number) {
  const res = await fetch(`${BASE}/${caseId}/procedures/${procedureId}`, {
    method: "DELETE",
  });
  if (!res.ok) throw await buildApiError("Operation delete failed", res);
}

export async function updateCaseProcedure(
  caseId: number,
  procedureId: number,
  payload: {
    procedure_text?: string;
    icd_text?: string;
    icd_code?: string;
    icd_version?: string;
    terminology_entry_id?: number;
    concept_id?: number;
    local_id?: string;
    seq?: number;
    event_ts?: number;
    entry_context?: "planned" | "performed";
  },
): Promise<CaseProcedureRow> {
  const res = await fetch(`${BASE}/${caseId}/procedures/${procedureId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw await buildApiError("Operation update failed", res);
  const data = (await res.json()) as { row?: CaseProcedureRow };
  if (!data.row) throw new Error("Operation update failed");
  return data.row;
}
