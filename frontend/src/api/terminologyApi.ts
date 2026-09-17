import { BACKEND_BASE } from "./backendBase";

const BASE = `${BACKEND_BASE}/api/config/terminology`;

export type ClinicalDomain = "observation" | "fluid" | "blood_product" | "medication" | "output" | "diagnosis" | "procedure";

export type ClinicalConcept = {
  id?: number;
  domain: ClinicalDomain;
  local_id: string;
  local_name: string;
  snomed_id?: string;
  snomed_name?: string;
  icd10_id?: string;
  icd10_name?: string;
  icd9cm_id?: string;
  icd9cm_name?: string;
  loinc_id?: string;
  loinc_name?: string;
  rxnorm_id?: string;
  rxnorm_name?: string;
  atc_id?: string;
  atc_name?: string;
  ucum_id?: string;
  ucum_name?: string;
  is_active: number;
  catalog_item_id?: number;
  default_unit?: string;
  group_id?: number;
  group_code?: string;
  codings?: Record<string, {
    system?: string;
    code?: string;
    display?: string;
    version?: string;
    terminology_entry_id?: number;
  }>;
};

export type TerminologyCatalogEntry = {
  id: number;
  domain: "diagnosis" | "procedure" | "observation" | "medication" | "unit";
  code: string;
  display: string;
  display_th?: string | null;
  system_key: string;
  system_uri: string;
  edition: string;
  version: string;
  release_date?: string | null;
};

export type ObservationParameter = {
  id: number;
  param_key: string;
  concept_id?: number | null;
  short_name: string;
  display_name: string;
  value_type: "number" | "text" | "code";
  unit?: string | null;
  is_active: number;
  display_order: number;
  table_group: "core" | "set" | "measured";
  show_in_table: number;
  chart_group_key?: "spo2" | "hr" | "pr" | "nibp" | "art" | "cvp" | "temp" | null;
  chart_label?: string | null;
  chart_style?: "line" | "point" | "range" | null;
  chart_color?: string | null;
  chart_marker?: "circle" | "heart" | "diamond" | "square" | "triangle" | "range" | null;
  show_in_chart: number;
  chart_default_visible: number;
  source_aliases?: string[];
  local_id?: string | null;
  local_name?: string | null;
  codings?: ClinicalConcept["codings"];
};

export async function searchTerminologyCatalog(domain: "diagnosis" | "procedure", q: string, limit = 12) {
  const query = q.trim();
  if (query.length < 2) return [] as TerminologyCatalogEntry[];
  const params = new URLSearchParams({ domain, q: query, limit: String(limit) });
  const response = await fetch(`${BASE}/catalog/search?${params}`);
  const body = await response.json().catch(() => ({})) as { error?: string; rows?: TerminologyCatalogEntry[] };
  if (!response.ok) throw new Error(body.error || "Unable to search terminology catalog");
  return body.rows || [];
}

async function responseRow(response: Response, fallback: string) {
  const body = await response.json().catch(() => ({})) as { error?: string; row?: ClinicalConcept };
  if (!response.ok) throw new Error(body.error || fallback);
  if (!body.row) throw new Error(fallback);
  return body.row;
}

export async function getClinicalConcepts(domain: ClinicalDomain, q = "", includeInactive = true) {
  const params = new URLSearchParams({ domain, q, include_inactive: String(includeInactive), limit: "1000" });
  const response = await fetch(`${BASE}?${params}`);
  const body = await response.json().catch(() => ({})) as { error?: string; rows?: ClinicalConcept[] };
  if (!response.ok) throw new Error(body.error || "Unable to load clinical terminology");
  return body.rows || [];
}

export async function searchClinicalConcepts(domain: "diagnosis" | "procedure", q: string, limit = 12) {
  const query = q.trim();
  if (query.length < 2) return [] as ClinicalConcept[];
  const params = new URLSearchParams({ domain, q: query, include_inactive: "false", limit: String(limit) });
  const response = await fetch(`${BASE}?${params}`);
  const body = await response.json().catch(() => ({})) as { error?: string; rows?: ClinicalConcept[] };
  if (!response.ok) throw new Error(body.error || "Unable to search clinical terminology");
  return body.rows || [];
}

export async function createClinicalConcept(value: ClinicalConcept) {
  return responseRow(await fetch(BASE, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(value) }), "Unable to create clinical concept");
}

export async function updateClinicalConcept(value: ClinicalConcept) {
  if (!value.id) throw new Error("Concept ID required");
  return responseRow(await fetch(`${BASE}/${value.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(value) }), "Unable to update clinical concept");
}

export async function deactivateClinicalConcept(id: number) {
  const response = await fetch(`${BASE}/${id}`, { method: "DELETE" });
  const body = await response.json().catch(() => ({})) as { error?: string };
  if (!response.ok) throw new Error(body.error || "Unable to deactivate clinical concept");
}

export async function getObservationParameters() {
  const response = await fetch(`${BASE}/parameters`);
  const body = await response.json().catch(() => ({})) as { error?: string; rows?: ObservationParameter[] };
  if (!response.ok) throw new Error(body.error || "Unable to load observation parameters");
  return body.rows || [];
}

export async function updateObservationParameter(value: ObservationParameter) {
  const response = await fetch(`${BASE}/parameters/${encodeURIComponent(value.param_key)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(value),
  });
  const body = await response.json().catch(() => ({})) as { error?: string; row?: ObservationParameter };
  if (!response.ok) throw new Error(body.error || "Unable to update observation parameter");
  if (!body.row) throw new Error("Unable to update observation parameter");
  return body.row;
}
