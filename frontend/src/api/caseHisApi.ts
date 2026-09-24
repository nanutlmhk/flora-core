import { BACKEND_BASE } from "./backendBase";

const BASE = `${BACKEND_BASE}/api/case`;

export type HisSyncStatus = "connected" | "fallback" | "unavailable";

export type CasePatientInfo = {
  hn: string;
  an?: string | null;
  is_patient?: string | null;
  notype?: string | null;
  id_card?: string | null;
  patient_name?: string | null;
  title_th?: string | null;
  title_en?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  first_name_en?: string | null;
  last_name_en?: string | null;
  sex?: string | null;
  dob?: string | null;
  age_text?: string | null;
  weight_kg?: number | null;
  asa_status?: string | null;
  asa_emergency?: boolean;
  height_cm?: number | null;
  blood_group_text?: string | null;
  blood_group_abo?: string | null;
  blood_group_rh?: string | null;
  race?: string | null;
  ethnicity?: string | null;
  religion?: string | null;
  marital_status?: string | null;
  present_address?: string | null;
  present_province?: string | null;
  legal_address?: string | null;
  legal_province?: string | null;
  mobile?: string | null;
  contact_name?: string | null;
  contact_tel?: string | null;
  relation_desc?: string | null;
  nationality?: string | null;
  pre_admit_at?: number | null;
  pre_admit_note?: string | null;
  his_updated_at?: number | null;
  his_payload?: unknown;
};

export type CaseAllergyRow = {
  id: string;
  allergen: string;
  reaction?: string | null;
  severity?: string | null;
  status?: string | null;
  source?: string | null;
  updated_at?: number | null;
};

export type CaseLabRow = {
  id: string;
  test_name: string;
  test_group?: string | null;
  value_text?: string | null;
  unit?: string | null;
  ref_range?: string | null;
  flag?: string | null;
  collected_at?: number | null;
  source?: string | null;
};

export type CaseHisSyncResult = {
  ok: boolean;
  case_id: number;
  hn: string;
  source?: "HIS" | "BUFFER";
  offline?: boolean;
  saved?: {
    patient?: number;
    allergies?: number;
    labs?: number;
    vitals?: number;
  };
  his_errors?: Record<string, string>;
};

export type CaseHisLookupResult = {
  ok: boolean;
  hn: string;
  source?: "HIS" | "BUFFER" | "DEMO_HIS";
  offline?: boolean;
  row: CasePatientInfo | null;
  allergies: CaseAllergyRow[];
  labs: CaseLabRow[];
  his_payload?: unknown;
  exchange?: HisExchangeProvenance | null;
  his_errors?: Record<string, string>;
};

export type HisExchangeProvenance = {
  protocol: string;
  label: string;
  event: string;
  message_id: string;
  source_system: string;
  encounter?: {
    class?: string;
    service?: string;
    priority?: string;
    location?: string;
    attending?: string;
  };
  sample_format?: string;
  sample?: string;
  synthetic: boolean;
};

export type DemoHisPatient = {
  hn: string;
  patient_name: string;
  patient_name_en: string;
  protocol: string;
  protocol_label: string;
  event: string;
  source_system: string;
  encounter?: HisExchangeProvenance["encounter"];
  sample_format: string;
  sample: string;
  synthetic: boolean;
};

export type HisBufferListRow = {
  hn: string;
  patient_name?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  first_name_en?: string | null;
  last_name_en?: string | null;
  sex?: string | null;
  dob?: string | null;
  blood_group_text?: string | null;
  pre_admit_at?: number | null;
  pre_admit_note?: string | null;
  his_updated_at?: number | null;
  updated_at?: number | null;
  allergy_count?: number;
  lab_count?: number;
};

export type HisFetchRowsResult<T> = {
  ok: boolean;
  hn: string;
  source?: "HIS" | "BUFFER";
  offline?: boolean;
  rows: T[];
  his_errors?: Record<string, string>;
};

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function optionalText(value: unknown): string | null {
  const normalized = text(value);
  return normalized || null;
}

function numberOrNull(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

async function buildApiError(prefix: string, res: Response) {
  const body = await res.text();
  const short = body.replace(/\s+/g, " ").slice(0, 180);
  return new Error(`${prefix} (${res.status}) ${short}`);
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function parseLookupPayload(
  payload: {
    ok?: boolean;
    hn?: unknown;
    source?: unknown;
    offline?: unknown;
    row?: unknown;
    allergies?: unknown[];
    labs?: unknown[];
    his_payload?: unknown;
    exchange?: unknown;
    his_errors?: unknown;
  },
  fallbackHn: string,
): CaseHisLookupResult {
  const rowRaw = asObject(payload.row);
  const hnText = text(rowRaw.hn || payload.hn || fallbackHn);
  const row: CasePatientInfo | null = hnText
    ? {
        hn: hnText,
        an: optionalText(rowRaw.an),
        is_patient: optionalText(rowRaw.is_patient),
        notype: optionalText(rowRaw.notype),
        id_card: optionalText(rowRaw.id_card || rowRaw.idCard),
        patient_name: optionalText(rowRaw.patient_name || rowRaw.patientName),
        title_th: optionalText(rowRaw.title_th || rowRaw.titleTh),
        title_en: optionalText(rowRaw.title_en || rowRaw.titleEn),
        first_name: optionalText(rowRaw.first_name || rowRaw.firstName),
        last_name: optionalText(rowRaw.last_name || rowRaw.lastName),
        first_name_en: optionalText(rowRaw.first_name_en || rowRaw.firstNameEn),
        last_name_en: optionalText(rowRaw.last_name_en || rowRaw.lastNameEn),
        sex: optionalText(rowRaw.sex),
        dob: optionalText(rowRaw.dob),
        age_text: optionalText(rowRaw.age_text || rowRaw.age),
        weight_kg: numberOrNull(rowRaw.weight_kg || rowRaw.weightKg),
        height_cm: numberOrNull(rowRaw.height_cm || rowRaw.heightCm),
        blood_group_text: optionalText(rowRaw.blood_group_text || rowRaw.bloodGroupText),
        blood_group_abo: optionalText(rowRaw.blood_group_abo || rowRaw.bloodGroupABO),
        blood_group_rh: optionalText(rowRaw.blood_group_rh || rowRaw.bloodGroupRh),
        race: optionalText(rowRaw.race),
        ethnicity: optionalText(rowRaw.ethnicity),
        religion: optionalText(rowRaw.religion),
        marital_status: optionalText(rowRaw.marital_status || rowRaw.maritalStatus),
        present_address: optionalText(rowRaw.present_address || rowRaw.presentAddress),
        present_province: optionalText(rowRaw.present_province || rowRaw.presentProvince),
        legal_address: optionalText(rowRaw.legal_address || rowRaw.legalAddress),
        legal_province: optionalText(rowRaw.legal_province || rowRaw.legalProvince),
        mobile: optionalText(rowRaw.mobile),
        contact_name: optionalText(rowRaw.contact_name || rowRaw.contactName),
        contact_tel: optionalText(rowRaw.contact_tel || rowRaw.contactTel),
        relation_desc: optionalText(rowRaw.relation_desc || rowRaw.relationDesc),
        nationality: optionalText(rowRaw.nationality),
        pre_admit_at: numberOrNull(rowRaw.pre_admit_at || rowRaw.preAdmitAt),
        pre_admit_note: optionalText(rowRaw.pre_admit_note || rowRaw.preAdmitNote),
        his_updated_at: numberOrNull(rowRaw.his_updated_at || rowRaw.updated_at),
        his_payload: rowRaw.his_payload ?? payload.his_payload ?? null,
      }
    : null;

  const allergiesRaw = Array.isArray(payload.allergies) ? payload.allergies : [];
  const allergies = allergiesRaw
    .map((item, index) => {
      const a = asObject(item);
      const allergen = text(a.allergen || a.substance || a.name);
      if (!allergen) return null;
      return {
        id: text(a.id) || `allergy-lookup-${index}`,
        allergen,
        reaction: optionalText(a.reaction),
        severity: optionalText(a.severity),
        status: optionalText(a.status),
        source: optionalText(a.source),
        updated_at: numberOrNull(a.updated_at),
      } as CaseAllergyRow;
    })
    .filter((r): r is CaseAllergyRow => r != null);

  const labsRaw = Array.isArray(payload.labs) ? payload.labs : [];
  const labs = labsRaw
    .map((item, index) => {
      const l = asObject(item);
      const testName = text(l.test_name || l.testName || l.name);
      if (!testName) return null;
      return {
        id: text(l.id) || `lab-lookup-${index}`,
        test_name: testName,
        test_group: optionalText(l.test_group || l.group),
        value_text: optionalText(l.value_text || l.value),
        unit: optionalText(l.unit),
        ref_range: optionalText(l.ref_range || l.refRange),
        flag: optionalText(l.flag),
        collected_at: numberOrNull(l.collected_at || l.ts),
        source: optionalText(l.source),
      } as CaseLabRow;
    })
    .filter((r): r is CaseLabRow => r != null);

  const exchangeRaw = asObject(payload.exchange);
  const encounterRaw = asObject(exchangeRaw.encounter);
  const exchange: HisExchangeProvenance | null = text(exchangeRaw.protocol) ? {
    protocol: text(exchangeRaw.protocol),
    label: text(exchangeRaw.label),
    event: text(exchangeRaw.event),
    message_id: text(exchangeRaw.message_id),
    source_system: text(exchangeRaw.source_system),
    encounter: {
      class: text(encounterRaw.class), service: text(encounterRaw.service), priority: text(encounterRaw.priority),
      location: text(encounterRaw.location), attending: text(encounterRaw.attending),
    },
    sample_format: text(exchangeRaw.sample_format),
    sample: text(exchangeRaw.sample),
    synthetic: Boolean(exchangeRaw.synthetic),
  } : null;

  return {
    ok: payload.ok !== false,
    hn: hnText || fallbackHn,
    source: String(payload.source || "").trim().toUpperCase() === "BUFFER" ? "BUFFER" : String(payload.source || "").trim().toUpperCase() === "DEMO_HIS" ? "DEMO_HIS" : "HIS",
    offline: Boolean(payload.offline),
    row,
    allergies,
    labs,
    his_payload: payload.his_payload ?? null,
    exchange,
    his_errors:
      payload.his_errors && typeof payload.his_errors === "object"
        ? (payload.his_errors as Record<string, string>)
        : undefined,
  };
}

export async function getCasePatientInfo(caseId: number): Promise<CasePatientInfo | null> {
  const res = await fetch(`${BASE}/${caseId}/patient`);
  if (!res.ok) throw await buildApiError("Patient info load failed", res);
  const payload = (await res.json()) as { row?: unknown; patient?: unknown } | unknown;
  const body = asObject(payload);
  const row = asObject(body.row || body.patient || payload);
  if (!row || Object.keys(row).length === 0) return null;

  const hn = text(row.hn);
  if (!hn) return null;

  return {
    hn,
    an: optionalText(row.an),
    is_patient: optionalText(row.is_patient),
    notype: optionalText(row.notype),
    id_card: optionalText(row.id_card || row.idCard),
    patient_name: optionalText(row.patient_name || row.patientName),
    title_th: optionalText(row.title_th || row.titleTh),
    title_en: optionalText(row.title_en || row.titleEn),
    first_name: optionalText(row.first_name || row.firstName || row.given_name),
    last_name: optionalText(row.last_name || row.lastName || row.family_name),
    first_name_en: optionalText(row.first_name_en || row.firstNameEn),
    last_name_en: optionalText(row.last_name_en || row.lastNameEn),
    sex: optionalText(row.sex || row.gender),
    dob: optionalText(row.dob || row.date_of_birth),
    age_text: optionalText(row.age_text || row.age),
    weight_kg: numberOrNull(row.weight_kg || row.weightKg),
    asa_status: optionalText(row.asa_status || row.asaStatus),
    asa_emergency: row.asa_emergency === true || row.asaEmergency === true || Number(row.asa_emergency || row.asaEmergency || 0) === 1,
    height_cm: numberOrNull(row.height_cm || row.heightCm),
    blood_group_text: optionalText(row.blood_group_text || row.bloodGroupText),
    blood_group_abo: optionalText(row.blood_group_abo || row.bloodGroupABO),
    blood_group_rh: optionalText(row.blood_group_rh || row.bloodGroupRh),
    race: optionalText(row.race),
    ethnicity: optionalText(row.ethnicity),
    religion: optionalText(row.religion),
    marital_status: optionalText(row.marital_status || row.maritalStatus),
    present_address: optionalText(row.present_address || row.presentAddress),
    present_province: optionalText(row.present_province || row.presentProvince),
    legal_address: optionalText(row.legal_address || row.legalAddress),
    legal_province: optionalText(row.legal_province || row.legalProvince),
    mobile: optionalText(row.mobile),
    contact_name: optionalText(row.contact_name || row.contactName),
    contact_tel: optionalText(row.contact_tel || row.contactTel),
    relation_desc: optionalText(row.relation_desc || row.relationDesc),
    nationality: optionalText(row.nationality),
    pre_admit_at: numberOrNull(row.pre_admit_at || row.preAdmitAt),
    pre_admit_note: optionalText(row.pre_admit_note || row.preAdmitNote),
    his_updated_at: numberOrNull(row.his_updated_at || row.updated_at),
    his_payload: row.his_payload ?? row.raw_payload ?? null,
  };
}

export async function updateCasePatientInfo(
  caseId: number,
  patch: {
    hn: string;
    an?: string;
    idType?: string;
    idCard?: string;
    titleTh?: string;
    titleEn?: string;
    firstName?: string;
    lastName?: string;
    firstNameEn?: string;
    lastNameEn?: string;
    sex?: string;
    dob?: string;
    ageText?: string;
    weightKg?: string;
    heightCm?: string;
    bloodGroupABO?: string;
    bloodGroupRh?: string;
    race?: string;
    ethnicity?: string;
    religion?: string;
    maritalStatus?: string;
    presentAddress?: string;
    presentProvince?: string;
    legalAddress?: string;
    legalProvince?: string;
    mobile?: string;
    contactName?: string;
    contactTel?: string;
    contactRelation?: string;
    nationality?: string;
  },
): Promise<{ ok: boolean; row?: unknown }> {
  const res = await fetch(`${BASE}/${caseId}/patient`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw await buildApiError("Patient update failed", res);
  return (await res.json()) as { ok: boolean; row?: unknown };
}

export async function getCaseAllergies(caseId: number): Promise<CaseAllergyRow[]> {
  const res = await fetch(`${BASE}/${caseId}/allergies`);
  if (!res.ok) throw await buildApiError("Allergy load failed", res);
  const payload = (await res.json()) as { rows?: unknown[] } | unknown;
  const body = asObject(payload);
  const rows = Array.isArray(body.rows) ? body.rows : Array.isArray(payload) ? payload : [];
  return rows
    .map((item, index) => {
      const row = asObject(item);
      const allergen = text(row.allergen || row.substance || row.name);
      if (!allergen) return null;
      const id = row.id ?? `allergy-${index}`;
      return {
        id,
        allergen,
        reaction: optionalText(row.reaction),
        severity: optionalText(row.severity),
        status: optionalText(row.status),
        source: optionalText(row.source),
        updated_at: numberOrNull(row.updated_at || row.recorded_at),
      } as CaseAllergyRow;
    })
    .filter((row): row is CaseAllergyRow => row != null);
}

export async function getCaseLabs(
  caseId: number,
  options?: {
    fromTs?: number;
    toTs?: number;
    limit?: number;
  },
): Promise<CaseLabRow[]> {
  const params = new URLSearchParams();
  if (Number.isFinite(options?.fromTs)) params.set("from", String(options?.fromTs));
  if (Number.isFinite(options?.toTs)) params.set("to", String(options?.toTs));
  if (Number.isFinite(options?.limit)) params.set("limit", String(options?.limit));
  const query = params.toString();
  const url = `${BASE}/${caseId}/labs${query ? `?${query}` : ""}`;
  const res = await fetch(url);
  if (!res.ok) throw await buildApiError("Lab load failed", res);
  const payload = (await res.json()) as { rows?: unknown[] } | unknown;
  const body = asObject(payload);
  const rows = Array.isArray(body.rows) ? body.rows : Array.isArray(payload) ? payload : [];
  return rows
    .map((item, index) => {
      const row = asObject(item);
      const testName = text(row.test_name || row.testName || row.name);
      if (!testName) return null;
      const id = text(row.id) || `lab-${index}`;
      const valueText = optionalText(row.value_text || row.value || row.result);
      return {
        id,
        test_name: testName,
        test_group: optionalText(row.test_group || row.group),
        value_text: valueText,
        unit: optionalText(row.unit),
        ref_range: optionalText(row.ref_range || row.refRange),
        flag: optionalText(row.flag),
        collected_at: numberOrNull(row.collected_at || row.ts || row.updated_at),
        source: optionalText(row.source),
      } as CaseLabRow;
    })
    .filter((row): row is CaseLabRow => row != null);
}

export async function syncCaseHis(
  caseId: number,
  options?: { labgrp?: string; allow_buffer_fallback?: boolean },
): Promise<CaseHisSyncResult> {
  const res = await fetch(`${BASE}/${caseId}/his/sync`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      labgrp: options?.labgrp || "28",
      allow_buffer_fallback: options?.allow_buffer_fallback ?? true,
    }),
  });
  if (!res.ok) throw await buildApiError("HIS sync failed", res);
  return (await res.json()) as CaseHisSyncResult;
}

export async function syncCasePatientInfo(
  caseId: number,
): Promise<CaseHisSyncResult> {
  const res = await fetch(`${BASE}/${caseId}/his/patient-info-sync`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  if (!res.ok) throw await buildApiError("Patient info HIS sync failed", res);
  return (await res.json()) as CaseHisSyncResult;
}

export async function lookupHisByHn(
  hn: string,
  options?: { labgrp?: string },
): Promise<CaseHisLookupResult> {
  const res = await fetch(`${BASE}/his/lookup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      hn,
      labgrp: options?.labgrp || "28",
    }),
  });
  if (!res.ok) throw await buildApiError("HIS lookup failed", res);
  const payload = (await res.json()) as {
    ok?: boolean;
    hn?: unknown;
    source?: unknown;
    offline?: unknown;
    row?: unknown;
    allergies?: unknown[];
    labs?: unknown[];
    his_payload?: unknown;
    his_errors?: unknown;
  };

  return parseLookupPayload(payload, hn);
}

export async function lookupPatientInfoByHn(
  hn: string,
): Promise<CaseHisLookupResult> {
  const res = await fetch(`${BASE}/his/patient-info-lookup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ hn }),
  });
  if (!res.ok) throw await buildApiError("Patient info HIS lookup failed", res);
  const payload = (await res.json()) as {
    ok?: boolean;
    hn?: unknown;
    source?: unknown;
    offline?: unknown;
    row?: unknown;
    allergies?: unknown[];
    labs?: unknown[];
    his_payload?: unknown;
    exchange?: unknown;
    his_errors?: unknown;
  };

  return parseLookupPayload(payload, hn);
}

export async function preloadHisByHn(
  hn: string,
  options?: {
    labgrp?: string;
    pre_admit_at?: number;
    pre_admit_note?: string;
    allow_buffer_fallback?: boolean;
  },
): Promise<CaseHisLookupResult> {
  const res = await fetch(`${BASE}/his/preload`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      hn,
      labgrp: options?.labgrp || "28",
      pre_admit_at: options?.pre_admit_at,
      pre_admit_note: options?.pre_admit_note,
      allow_buffer_fallback: options?.allow_buffer_fallback ?? true,
    }),
  });
  if (!res.ok) throw await buildApiError("HIS preload failed", res);
  const payload = (await res.json()) as {
    ok?: boolean;
    hn?: unknown;
    source?: unknown;
    offline?: unknown;
    row?: unknown;
    allergies?: unknown[];
    labs?: unknown[];
    his_payload?: unknown;
    his_errors?: unknown;
  };
  return parseLookupPayload(payload, hn);
}

export async function listHisBuffer(options?: {
  q?: string;
  limit?: number;
}): Promise<HisBufferListRow[]> {
  const params = new URLSearchParams();
  if (options?.q) params.set("q", options.q);
  if (Number.isFinite(options?.limit)) params.set("limit", String(options?.limit));
  const q = params.toString();
  const res = await fetch(`${BASE}/his/buffer${q ? `?${q}` : ""}`);
  if (!res.ok) throw await buildApiError("HIS buffer list failed", res);
  const payload = (await res.json()) as { rows?: unknown[] } | unknown;
  const body = asObject(payload);
  const rows = Array.isArray(body.rows) ? body.rows : [];
  return rows
    .map(item => {
      const row = asObject(item);
      const hn = text(row.hn);
      if (!hn) return null;
      return {
        hn,
        patient_name: optionalText(row.patient_name),
        first_name: optionalText(row.first_name),
        last_name: optionalText(row.last_name),
        first_name_en: optionalText(row.first_name_en),
        last_name_en: optionalText(row.last_name_en),
        sex: optionalText(row.sex),
        dob: optionalText(row.dob),
        blood_group_text: optionalText(row.blood_group_text),
        pre_admit_at: numberOrNull(row.pre_admit_at),
        pre_admit_note: optionalText(row.pre_admit_note),
        his_updated_at: numberOrNull(row.his_updated_at),
        updated_at: numberOrNull(row.updated_at),
        allergy_count: numberOrNull(row.allergy_count) ?? 0,
        lab_count: numberOrNull(row.lab_count) ?? 0,
      } as HisBufferListRow;
    })
    .filter((row): row is HisBufferListRow => row != null);
}

export async function getHisBufferByHn(hn: string): Promise<CaseHisLookupResult> {
  const safeHn = encodeURIComponent(String(hn || "").trim());
  const res = await fetch(`${BASE}/his/buffer/${safeHn}`);
  if (!res.ok) throw await buildApiError("HIS buffer load failed", res);
  const payload = (await res.json()) as {
    ok?: boolean;
    hn?: unknown;
    source?: unknown;
    offline?: unknown;
    row?: unknown;
    allergies?: unknown[];
    labs?: unknown[];
    his_payload?: unknown;
    his_errors?: unknown;
  };
  return parseLookupPayload(payload, hn);
}

export async function deleteHisBufferByHn(hn: string): Promise<void> {
  const safeHn = encodeURIComponent(String(hn || "").trim());
  const res = await fetch(`${BASE}/his/buffer/${safeHn}`, {
    method: "DELETE",
  });
  if (!res.ok) throw await buildApiError("HIS buffer delete failed", res);
}

export async function fetchHisAllergyByHn(
  hn: string,
  options?: { allow_buffer_fallback?: boolean },
): Promise<HisFetchRowsResult<CaseAllergyRow>> {
  const res = await fetch(`${BASE}/his/allergy`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      hn,
      allow_buffer_fallback: options?.allow_buffer_fallback ?? true,
    }),
  });
  if (!res.ok) throw await buildApiError("HIS allergy failed", res);
  const payload = (await res.json()) as {
    ok?: boolean;
    hn?: unknown;
    source?: unknown;
    offline?: unknown;
    rows?: unknown[];
    his_errors?: unknown;
  };
  const rowsRaw = Array.isArray(payload.rows) ? payload.rows : [];
  const rows = rowsRaw
    .map((item, index) => {
      const row = asObject(item);
      const allergen = text(row.allergen || row.substance || row.name);
      if (!allergen) return null;
      return {
        id: text(row.id) || `allergy-fetch-${index}`,
        allergen,
        reaction: optionalText(row.reaction),
        severity: optionalText(row.severity),
        status: optionalText(row.status),
        source: optionalText(row.source),
        updated_at: numberOrNull(row.updated_at),
      } as CaseAllergyRow;
    })
    .filter((row): row is CaseAllergyRow => row != null);

  return {
    ok: payload.ok !== false,
    hn: text(payload.hn || hn),
    source: String(payload.source || "").toUpperCase() === "BUFFER" ? "BUFFER" : "HIS",
    offline: Boolean(payload.offline),
    rows,
    his_errors:
      payload.his_errors && typeof payload.his_errors === "object"
        ? (payload.his_errors as Record<string, string>)
        : undefined,
  };
}

export async function fetchHisLabByHn(
  hn: string,
  labgrp: string,
  options?: { allow_buffer_fallback?: boolean },
): Promise<HisFetchRowsResult<CaseLabRow>> {
  const res = await fetch(`${BASE}/his/lab`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      hn,
      labgrp,
      allow_buffer_fallback: options?.allow_buffer_fallback ?? true,
    }),
  });
  if (!res.ok) throw await buildApiError("HIS lab failed", res);
  const payload = (await res.json()) as {
    ok?: boolean;
    hn?: unknown;
    source?: unknown;
    offline?: unknown;
    rows?: unknown[];
    his_errors?: unknown;
  };
  const rowsRaw = Array.isArray(payload.rows) ? payload.rows : [];
  const rows = rowsRaw
    .map((item, index) => {
      const row = asObject(item);
      const testName = text(row.test_name || row.testName || row.name);
      if (!testName) return null;
      return {
        id: text(row.id) || `lab-fetch-${index}`,
        test_name: testName,
        test_group: optionalText(row.test_group || row.group),
        value_text: optionalText(row.value_text || row.value),
        unit: optionalText(row.unit),
        ref_range: optionalText(row.ref_range || row.refRange),
        flag: optionalText(row.flag),
        collected_at: numberOrNull(row.collected_at || row.ts),
        source: optionalText(row.source),
      } as CaseLabRow;
    })
    .filter((row): row is CaseLabRow => row != null);

  return {
    ok: payload.ok !== false,
    hn: text(payload.hn || hn),
    source: String(payload.source || "").toUpperCase() === "BUFFER" ? "BUFFER" : "HIS",
    offline: Boolean(payload.offline),
    rows,
    his_errors:
      payload.his_errors && typeof payload.his_errors === "object"
        ? (payload.his_errors as Record<string, string>)
        : undefined,
  };
}

export async function syncCaseHisAllergy(
  caseId: number,
  options?: { allow_buffer_fallback?: boolean },
): Promise<{
  ok: boolean;
  case_id: number;
  hn: string;
  source?: "HIS" | "BUFFER";
  offline?: boolean;
  rows: CaseAllergyRow[];
  his_errors?: Record<string, string>;
}> {
  const res = await fetch(`${BASE}/${caseId}/his/allergy/sync`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      allow_buffer_fallback: options?.allow_buffer_fallback ?? true,
    }),
  });
  if (!res.ok) throw await buildApiError("Case allergy sync failed", res);
  const payload = (await res.json()) as {
    ok?: boolean;
    case_id?: unknown;
    hn?: unknown;
    source?: unknown;
    offline?: unknown;
    rows?: unknown[];
    his_errors?: unknown;
  };
  const rowsRaw = Array.isArray(payload.rows) ? payload.rows : [];
  const rows = rowsRaw
    .map((item, index) => {
      const row = asObject(item);
      const allergen = text(row.allergen || row.substance || row.name);
      if (!allergen) return null;
      return {
        id: text(row.id) || `allergy-sync-${index}`,
        allergen,
        reaction: optionalText(row.reaction),
        severity: optionalText(row.severity),
        status: optionalText(row.status),
        source: optionalText(row.source),
        updated_at: numberOrNull(row.updated_at),
      } as CaseAllergyRow;
    })
    .filter((row): row is CaseAllergyRow => row != null);
  return {
    ok: payload.ok !== false,
    case_id: Number(payload.case_id || caseId),
    hn: text(payload.hn),
    source: String(payload.source || "").toUpperCase() === "BUFFER" ? "BUFFER" : "HIS",
    offline: Boolean(payload.offline),
    rows,
    his_errors:
      payload.his_errors && typeof payload.his_errors === "object"
        ? (payload.his_errors as Record<string, string>)
        : undefined,
  };
}

export async function syncCaseHisLab(
  caseId: number,
  labgrp: string,
  options?: { allow_buffer_fallback?: boolean },
): Promise<{
  ok: boolean;
  case_id: number;
  hn: string;
  source?: "HIS" | "BUFFER";
  offline?: boolean;
  rows: CaseLabRow[];
  his_errors?: Record<string, string>;
}> {
  const res = await fetch(`${BASE}/${caseId}/his/lab/sync`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      labgrp,
      allow_buffer_fallback: options?.allow_buffer_fallback ?? true,
    }),
  });
  if (!res.ok) throw await buildApiError("Case lab sync failed", res);
  const payload = (await res.json()) as {
    ok?: boolean;
    case_id?: unknown;
    hn?: unknown;
    source?: unknown;
    offline?: unknown;
    rows?: unknown[];
    his_errors?: unknown;
  };
  const rowsRaw = Array.isArray(payload.rows) ? payload.rows : [];
  const rows = rowsRaw
    .map((item, index) => {
      const row = asObject(item);
      const testName = text(row.test_name || row.testName || row.name);
      if (!testName) return null;
      return {
        id: text(row.id) || `lab-sync-${index}`,
        test_name: testName,
        test_group: optionalText(row.test_group || row.group),
        value_text: optionalText(row.value_text || row.value),
        unit: optionalText(row.unit),
        ref_range: optionalText(row.ref_range || row.refRange),
        flag: optionalText(row.flag),
        collected_at: numberOrNull(row.collected_at || row.ts),
        source: optionalText(row.source),
      } as CaseLabRow;
    })
    .filter((row): row is CaseLabRow => row != null);
  return {
    ok: payload.ok !== false,
    case_id: Number(payload.case_id || caseId),
    hn: text(payload.hn),
    source: String(payload.source || "").toUpperCase() === "BUFFER" ? "BUFFER" : "HIS",
    offline: Boolean(payload.offline),
    rows,
    his_errors:
      payload.his_errors && typeof payload.his_errors === "object"
        ? (payload.his_errors as Record<string, string>)
        : undefined,
  };
}

export async function listDemoHisPatients(): Promise<DemoHisPatient[]> {
  const res = await fetch(`${BASE}/his/demo-patients`);
  if (!res.ok) throw await buildApiError("Demo HIS patient list failed", res);
  const payload = asObject(await res.json());
  if (!payload.enabled || !Array.isArray(payload.rows)) return [];
  return payload.rows.map(item => {
    const row = asObject(item);
    const encounter = asObject(row.encounter);
    return {
      hn: text(row.hn),
      patient_name: text(row.patient_name),
      patient_name_en: text(row.patient_name_en),
      protocol: text(row.protocol),
      protocol_label: text(row.protocol_label),
      event: text(row.event),
      source_system: text(row.source_system),
      encounter: {
        class: text(encounter.class), service: text(encounter.service), priority: text(encounter.priority),
        location: text(encounter.location), attending: text(encounter.attending),
      },
      sample_format: text(row.sample_format),
      sample: text(row.sample),
      synthetic: Boolean(row.synthetic),
    };
  }).filter(row => Boolean(row.hn));
}

export async function createCaseAllergy(
  caseId: number,
  params: {
    allergen: string;
    reaction?: string;
    severity?: string;
    status?: string;
  },
): Promise<{ id: number }> {
  const res = await fetch(`${BASE}/${caseId}/allergies`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  if (!res.ok) throw await buildApiError("Allergy create failed", res);
  return (await res.json()) as { id: number };
}

export async function updateCaseAllergy(
  caseId: number,
  allergyId: number | string,
  params: {
    allergen: string;
    reaction?: string;
    severity?: string;
    status?: string;
  },
): Promise<{ ok: boolean }> {
  const res = await fetch(`${BASE}/${caseId}/allergies/${allergyId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  if (!res.ok) throw await buildApiError("Allergy update failed", res);
  return (await res.json()) as { ok: boolean };
}

export async function deleteCaseAllergy(
  caseId: number,
  allergyId: number | string,
): Promise<{ ok: boolean }> {
  const res = await fetch(`${BASE}/${caseId}/allergies/${allergyId}`, {
    method: "DELETE",
  });
  if (!res.ok) throw await buildApiError("Allergy delete failed", res);
  return (await res.json()) as { ok: boolean };
}
