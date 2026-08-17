const express = require("express");
const router = express.Router();
const { db } = require("./floradb");
const { startMinuteWriter, stopMinuteWriter, rewindMinuteWriter, getMinuteWriterStatus } = require("./minuteWriter");

const HIS_GATEWAY_BASE_URL =
  String(process.env.HIS_GATEWAY_BASE_URL || "http://10.35.202.6:8590").replace(/\/+$/, "");
const HIS_GATEWAY_TIMEOUT_MS = Math.max(
  3000,
  Number(process.env.HIS_GATEWAY_TIMEOUT_MS) || 45000,
);
const HIS_BLOOD_PRODUCT_VERIFY_PATH =
  String(process.env.HIS_BLOOD_PRODUCT_VERIFY_PATH || "/api/blood-product-verify").trim() ||
  "/api/blood-product-verify";
const HIS_BLOOD_PRODUCT_LIST_PATH =
  String(process.env.HIS_BLOOD_PRODUCT_LIST_PATH || "/api/blood-product-list").trim() ||
  "/api/blood-product-list";
const HIS_BLOOD_PRODUCT_VERIFY_REAL = parseBooleanFlag(
  process.env.HIS_BLOOD_PRODUCT_VERIFY_REAL,
  false,
);
const HIS_BLOOD_PRODUCT_VERIFY_MOCK = parseBooleanFlag(
  process.env.HIS_BLOOD_PRODUCT_VERIFY_MOCK,
  false,
);
const HIS_BLOOD_PRODUCT_LIST_REAL = parseBooleanFlag(
  process.env.HIS_BLOOD_PRODUCT_LIST_REAL,
  HIS_BLOOD_PRODUCT_VERIFY_REAL,
);
const HIS_BLOOD_PRODUCT_LIST_MOCK = parseBooleanFlag(
  process.env.HIS_BLOOD_PRODUCT_LIST_MOCK,
  HIS_BLOOD_PRODUCT_VERIFY_MOCK,
);

const MUTATING_HTTP_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/* helper */
function floorMinute(ts) {
  return Math.floor(ts / 60000) * 60000;
}

function floorQuarterHour(ts) {
  return Math.floor(ts / (15 * 60000)) * (15 * 60000);
}

function ceilMinute(ts) {
  return Math.ceil(ts / 60000) * 60000;
}

function normalizeSource(source) {
  return source === "override" ? "override" : "manual";
}

function isArchivedCaseStatus(status) {
  return String(status || "").trim().toLowerCase() === "archived";
}

function normalizeCaseStatusLabel(status) {
  const value = String(status || "").trim().toLowerCase();
  if (value === "archived") return "ARCHIVED";
  return "DISCHARGED";
}

function getCaseStartOverlap(startTs) {
  const normalizedStartTs = Number(startTs);
  if (!Number.isFinite(normalizedStartTs)) return null;

  const previousCase = db
    .prepare(
      `SELECT id, hn, status, start_time, discharge_time
       FROM cases
       WHERE status IN ('discharged', 'archived')
         AND COALESCE(discharge_time, start_time) > ?
       ORDER BY COALESCE(discharge_time, start_time) DESC, id DESC
       LIMIT 1`,
    )
    .get(normalizedStartTs);

  if (!previousCase) return null;

  const previousCaseEndTs = Number(previousCase.discharge_time ?? previousCase.start_time);
  if (!Number.isFinite(previousCaseEndTs) || previousCaseEndTs <= normalizedStartTs) {
    return null;
  }

  const overlapStats = db
    .prepare(
      `SELECT MIN(ts_minute) AS first_minute,
              MAX(ts_minute) AS last_minute,
              COUNT(*) AS minute_count
       FROM vital_minutes
       WHERE case_id = ?
         AND ts_minute >= ?
         AND ts_minute <= ?`,
    )
    .get(previousCase.id, floorMinute(normalizedStartTs), floorMinute(previousCaseEndTs));

  const firstMinute = Number(overlapStats?.first_minute);
  const lastMinute = Number(overlapStats?.last_minute);
  const minuteCount = Number(overlapStats?.minute_count || 0);
  if (!Number.isFinite(firstMinute) || !Number.isFinite(lastMinute) || minuteCount <= 0) {
    return null;
  }

  return {
    previous_case_id: Number(previousCase.id),
    previous_case_hn: String(previousCase.hn || "").trim(),
    previous_case_status: normalizeCaseStatusLabel(previousCase.status),
    previous_case_end_time: previousCaseEndTs,
    overlap_start_time: Math.max(normalizedStartTs, firstMinute),
    overlap_end_time: previousCaseEndTs,
    overlap_minute_count: minuteCount,
    suggested_capture_start_time: Math.max(
      ceilMinute(previousCaseEndTs),
      Number.isFinite(lastMinute) ? lastMinute + 60000 : ceilMinute(previousCaseEndTs),
    ),
  };
}

// Archived cases are read-only across case-specific mutation routes.
router.use("/:id", (req, res, next) => {
  if (!MUTATING_HTTP_METHODS.has(String(req.method || "").toUpperCase())) {
    return next();
  }

  const caseId = Number(req.params.id);
  if (!Number.isFinite(caseId) || caseId <= 0) {
    return next();
  }

  const row = db
    .prepare(`SELECT status FROM cases WHERE id = ?`)
    .get(caseId);
  if (!row) {
    return next();
  }

  const archivedAllowed =
    (String(req.method || "").toUpperCase() === "PUT" && req.path === "/patient") ||
    (String(req.method || "").toUpperCase() === "POST" && req.path === "/his/patient-info-sync");
  if (archivedAllowed) {
    return next();
  }

  if (isArchivedCaseStatus(row.status)) {
    return res.status(409).json({ error: "archived case is read-only" });
  }

  return next();
});

function normalizeEventType(eventType) {
  return eventType === "note" ? "note" : "event";
}

function normalizeNullableText(value) {
  if (value == null) return null;
  const text = String(value).trim();
  return text ? text : null;
}

function parseJsonSafeObject(value) {
  if (!value || typeof value !== "string") return null;
  try {
    const parsed = JSON.parse(value);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function normalizeIcdCode(value) {
  const text = normalizeNullableText(value);
  if (!text) return null;
  return text.replace(/\s+/g, "").toUpperCase();
}

function normalizeIcd9ProcedureCode(value) {
  const text = normalizeNullableText(value);
  if (!text) return null;
  return text.replace(/[\s.]+/g, "");
}

function resolveIcd10Text(icdCode, fallbackText = null) {
  const normalizedCode = normalizeIcdCode(icdCode);
  if (!normalizedCode) return normalizeNullableText(fallbackText);
  const row = db.prepare(
    `SELECT name_en, name_th
     FROM icd10_master
     WHERE icd10 = ? OR icd10who = ?
     LIMIT 1`
  ).get(normalizedCode, normalizedCode);
  return (
    normalizeNullableText(row?.name_en) ||
    normalizeNullableText(row?.name_th) ||
    normalizeNullableText(fallbackText)
  );
}

function isLikelyIcd10Code(code) {
  const normalizedCode = normalizeIcdCode(code);
  return Boolean(normalizedCode && /^[A-Z]/.test(normalizedCode));
}

function resolveIcd9ProcedureText(icdCode, fallbackText = null) {
  const normalizedCode = normalizeIcd9ProcedureCode(icdCode);
  if (!normalizedCode) return normalizeNullableText(fallbackText);
  const row = db.prepare(
    `SELECT name_en
     FROM icd9cm_master
     WHERE icd9cm = ?
     LIMIT 1`
  ).get(normalizedCode);
  return normalizeNullableText(row?.name_en) || normalizeNullableText(fallbackText);
}

function isLikelyIcd9ProcedureCode(code) {
  const normalizedCode = normalizeIcd9ProcedureCode(code);
  return Boolean(normalizedCode && /^\d{4}$/.test(normalizedCode));
}

function parseIsoOrDmyToTs(dateRaw, timeRaw = "") {
  const dateText = String(dateRaw || "").trim();
  const timeText = String(timeRaw || "").trim();
  if (!dateText) return null;

  const dmy = dateText.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (dmy) {
    let year = Number(dmy[3]);
    if (year < 100) year += 2000;
    const month = Number(dmy[2]);
    const day = Number(dmy[1]);
    const hhmm = timeText.match(/^(\d{1,2}):?(\d{2})?$/);
    const hours = hhmm ? Number(hhmm[1]) : 0;
    const minutes = hhmm ? Number(hhmm[2] || 0) : 0;
    const dt = new Date(year, month - 1, day, hours, minutes, 0, 0);
    if (!Number.isNaN(dt.getTime())) return dt.getTime();
    return null;
  }

  const merged = timeText ? `${dateText} ${timeText}` : dateText;
  const ts = Date.parse(merged);
  return Number.isFinite(ts) ? ts : null;
}

function asRowsFromSoapResult(result) {
  if (!result || typeof result !== "object") return [];
  const rowSet = result?.["diffgr:diffgram"]?.NewDataSet?.DATATBL;
  if (Array.isArray(rowSet)) return rowSet.filter(x => x && typeof x === "object");
  if (rowSet && typeof rowSet === "object") return [rowSet];
  return [];
}

function getFirstResultRow(payload) {
  if (!payload || typeof payload !== "object") return null;
  const soapRows = asRowsFromSoapResult(payload);
  if (soapRows.length > 0) return soapRows[0];
  if (Array.isArray(payload.rows) && payload.rows[0] && typeof payload.rows[0] === "object") {
    return payload.rows[0];
  }
  if (Array.isArray(payload.data) && payload.data[0] && typeof payload.data[0] === "object") {
    return payload.data[0];
  }
  if (payload.row && typeof payload.row === "object") return payload.row;
  if (payload.data && typeof payload.data === "object" && !Array.isArray(payload.data)) return payload.data;
  return payload;
}

function pickPayloadText(row, keys) {
  if (!row || typeof row !== "object") return null;
  for (const key of keys) {
    const direct = normalizeNullableText(row[key]);
    if (direct) return direct;
    const upper = normalizeNullableText(row[String(key).toUpperCase()]);
    if (upper) return upper;
  }
  return null;
}

function normalizeBloodBagVerification(payload) {
  const row = getFirstResultRow(payload);
  if (!row) return null;
  const unitstas = pickPayloadText(row, ["unitstas", "unit_status", "status"]);
  return {
    hn: pickPayloadText(row, ["hn"]),
    an: pickPayloadText(row, ["an"]),
    patient_name: pickPayloadText(row, ["patient_name", "patientName", "pname", "name"]),
    reqno: pickPayloadText(row, ["reqno", "request_no", "requestNo"]),
    bdtype: pickPayloadText(row, ["bdtype", "blood_type", "bloodType"]),
    dnrno: pickPayloadText(row, ["dnrno", "blood_bag_no", "bloodBagNo", "bag_no", "bagNo"]),
    bloodgrp: pickPayloadText(row, ["bloodgrp", "blood_group", "bloodGroup"]),
    rh: pickPayloadText(row, ["rh"]),
    unitstas,
    raw: row,
  };
}

function asBloodProductRows(payload) {
  if (!payload || typeof payload !== "object") return [];
  const soapRows = asRowsFromSoapResult(payload);
  if (soapRows.length > 0) return soapRows;
  if (Array.isArray(payload.rows)) return payload.rows.filter(row => row && typeof row === "object");
  if (Array.isArray(payload.data)) return payload.data.filter(row => row && typeof row === "object");
  const row = getFirstResultRow(payload);
  return row ? [row] : [];
}

function normalizeBloodBagList(payload) {
  return asBloodProductRows(payload)
    .map(row => normalizeBloodBagVerification(row))
    .filter(row => row && row.dnrno);
}

function parseBloodGroup(raw) {
  const text = String(raw || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "");
  if (!text) return { abo: null, rh: null };
  const aboMatch = text.match(/^(AB|A|B|O)/);
  const abo = aboMatch ? aboMatch[1] : null;
  const rh = text.includes("-") ? "-" : text.includes("+") ? "+" : null;
  return { abo, rh };
}

function mapHisPatientRecord({ hn, infoRow, anRow, latestVital, hisUpdatedAt }) {
  const sourceBloodGroup =
    normalizeNullableText(infoRow?.P_OUT_BLOODGROUP || infoRow?.BLOODGROUP) ||
    normalizeNullableText(latestVital?.BLOODGROUP);
  const blood = parseBloodGroup(sourceBloodGroup);

  return {
    hn: normalizeNullableText(hn),
    an: normalizeNullableText(anRow?.AN || anRow?.P_OUT_AN),
    is_patient: normalizeNullableText(infoRow?.P_OUT_ISPATIENT),
    notype: normalizeNullableText(infoRow?.P_NOTYPE),
    id_card: normalizeNullableText(infoRow?.P_OUT_IDCARD || infoRow?.IDCARD),
    patient_name: normalizeNullableText(
      infoRow?.P_OUT_PATIENT_NAME || infoRow?.PATIENT_NAME,
    ),
    title_th: normalizeNullableText(infoRow?.P_OUT_PNAME || infoRow?.PNAME),
    title_en: normalizeNullableText(
      infoRow?.P_OUT_EN_PNAME || infoRow?.EN_PNAME,
    ),
    first_name: normalizeNullableText(infoRow?.P_OUT_FNAME || infoRow?.FNAME),
    last_name: normalizeNullableText(infoRow?.P_OUT_LNAME || infoRow?.LNAME),
    first_name_en: normalizeNullableText(
      infoRow?.P_OUT_EN_FNAME || infoRow?.EN_FNAME,
    ),
    last_name_en: normalizeNullableText(
      infoRow?.P_OUT_EN_LNAME || infoRow?.EN_LNAME,
    ),
    sex: normalizeNullableText(infoRow?.P_OUT_SEX || infoRow?.SEX),
    dob: normalizeNullableText(infoRow?.P_OUT_PATIENT_DOB || infoRow?.DOB),
    age_text: normalizeNullableText(
      infoRow?.P_OUT_AGE || infoRow?.AGE || infoRow?.P_OUT_AGE_DESC,
    ),
    weight_kg:
      parseNullableNumber(infoRow?.P_OUT_WEIGHT) ??
      parseNullableNumber(latestVital?.WEIGHT),
    height_cm:
      parseNullableNumber(infoRow?.P_OUT_HEIGHT) ??
      parseNullableNumber(latestVital?.HEIGHT),
    blood_group_text: sourceBloodGroup,
    blood_group_abo: blood.abo,
    blood_group_rh: blood.rh,
    race: normalizeNullableText(infoRow?.P_OUT_RACE || infoRow?.RACE),
    ethnicity: normalizeNullableText(infoRow?.P_OUT_ETHNICITY || infoRow?.ETHNICITY),
    religion: normalizeNullableText(infoRow?.P_OUT_RELIGION || infoRow?.RELIGION),
    marital_status: normalizeNullableText(
      infoRow?.P_OUT_MARITAL_STATUS || infoRow?.MARITAL_STATUS,
    ),
    present_address: normalizeNullableText(infoRow?.P_OUT_PRESENT_ADDRESS),
    present_province: normalizeNullableText(
      infoRow?.P_OUT_PRESENT_C_PROV || infoRow?.P_OUT_PRESENT_PROV,
    ),
    legal_address: normalizeNullableText(infoRow?.P_OUT_LICE_ADDRESS),
    legal_province: normalizeNullableText(
      infoRow?.P_OUT_LICE_C_PROV || infoRow?.P_OUT_LICE_PROV,
    ),
    mobile: normalizeNullableText(infoRow?.P_OUT_PRESENT_MOBILE || infoRow?.MOBILE),
    contact_name: normalizeNullableText(infoRow?.P_OUT_CON_NAME),
    contact_tel: normalizeNullableText(infoRow?.P_OUT_CON_TEL),
    relation_desc: normalizeNullableText(infoRow?.P_OUT_RELATION_DESC),
    nationality: normalizeNullableText(infoRow?.P_OUT_NATIONALITY || infoRow?.NATIONALITY),
    source: "HIS",
    his_updated_at: hisUpdatedAt,
  };
}

function buildPatientInfoHisPayload(mappedPatient, patientInfoPayload, errors = {}) {
  return {
    patientMapped: mappedPatient,
    patientInfo: patientInfoPayload ?? null,
    errors: errors && typeof errors === "object" ? errors : {},
  };
}

function upsertCaseHisPatientOnly(caseId, mappedPatient, hisPayload, now) {
  db.prepare(
    `INSERT INTO case_his_patient (
       case_id, hn, an, is_patient, notype, id_card, patient_name,
       title_th, title_en, first_name, last_name, first_name_en, last_name_en,
       sex, dob, age_text, weight_kg, height_cm, blood_group_text, blood_group_abo, blood_group_rh,
       race, ethnicity, religion, marital_status,
       present_address, present_province, legal_address, legal_province,
       mobile, contact_name, contact_tel, relation_desc, nationality,
       source, raw_payload, his_updated_at, created_at, updated_at
     )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(case_id) DO UPDATE SET
       hn=excluded.hn,
       an=excluded.an,
       is_patient=excluded.is_patient,
       notype=excluded.notype,
       id_card=excluded.id_card,
       patient_name=excluded.patient_name,
       title_th=excluded.title_th,
       title_en=excluded.title_en,
       first_name=excluded.first_name,
       last_name=excluded.last_name,
       first_name_en=excluded.first_name_en,
       last_name_en=excluded.last_name_en,
       sex=excluded.sex,
       dob=excluded.dob,
       age_text=excluded.age_text,
       weight_kg=excluded.weight_kg,
       height_cm=excluded.height_cm,
       blood_group_text=excluded.blood_group_text,
       blood_group_abo=excluded.blood_group_abo,
       blood_group_rh=excluded.blood_group_rh,
       race=excluded.race,
       ethnicity=excluded.ethnicity,
       religion=excluded.religion,
       marital_status=excluded.marital_status,
       present_address=excluded.present_address,
       present_province=excluded.present_province,
       legal_address=excluded.legal_address,
       legal_province=excluded.legal_province,
       mobile=excluded.mobile,
       contact_name=excluded.contact_name,
       contact_tel=excluded.contact_tel,
       relation_desc=excluded.relation_desc,
       nationality=excluded.nationality,
       source=excluded.source,
       raw_payload=excluded.raw_payload,
       his_updated_at=excluded.his_updated_at,
       updated_at=excluded.updated_at`
  ).run(
    caseId,
    mappedPatient.hn || null,
    mappedPatient.an || null,
    mappedPatient.is_patient || null,
    mappedPatient.notype || null,
    mappedPatient.id_card || null,
    mappedPatient.patient_name || null,
    mappedPatient.title_th || null,
    mappedPatient.title_en || null,
    mappedPatient.first_name || null,
    mappedPatient.last_name || null,
    mappedPatient.first_name_en || null,
    mappedPatient.last_name_en || null,
    mappedPatient.sex || null,
    mappedPatient.dob || null,
    mappedPatient.age_text || null,
    mappedPatient.weight_kg ?? null,
    mappedPatient.height_cm ?? null,
    mappedPatient.blood_group_text || null,
    mappedPatient.blood_group_abo || null,
    mappedPatient.blood_group_rh || null,
    mappedPatient.race || null,
    mappedPatient.ethnicity || null,
    mappedPatient.religion || null,
    mappedPatient.marital_status || null,
    mappedPatient.present_address || null,
    mappedPatient.present_province || null,
    mappedPatient.legal_address || null,
    mappedPatient.legal_province || null,
    mappedPatient.mobile || null,
    mappedPatient.contact_name || null,
    mappedPatient.contact_tel || null,
    mappedPatient.relation_desc || null,
    mappedPatient.nationality || null,
    mappedPatient.source || "HIS",
    JSON.stringify(hisPayload),
    mappedPatient.his_updated_at || now,
    now,
    now,
  );
}

async function fetchPatientInfoOnly(hn) {
  const payload = await postHisGateway("/api/patient-info", { hn });
  const infoRow = asRowsFromSoapResult(payload)[0] || null;
  const now = Date.now();
  const mappedPatient = mapHisPatientRecord({
    hn,
    infoRow,
    anRow: null,
    latestVital: null,
    hisUpdatedAt: now,
  });
  const hisPayload = buildPatientInfoHisPayload(mappedPatient, payload, {});
  return { payload, infoRow, mappedPatient, hisPayload, now };
}

async function postHisGateway(path, payload) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), HIS_GATEWAY_TIMEOUT_MS);
  try {
    const res = await fetch(`${HIS_GATEWAY_BASE_URL}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    const raw = await res.text();
    let parsed = null;
    try {
      parsed = raw ? JSON.parse(raw) : null;
    } catch {
      parsed = null;
    }
    if (!res.ok) {
      const detail = parsed && typeof parsed === "object" ? JSON.stringify(parsed) : raw;
      throw new Error(`HIS gateway ${res.status}: ${detail || "request failed"}`);
    }
    return parsed;
  } finally {
    clearTimeout(timeout);
  }
}

const STAFF_ROLE_DEFS = [
  { id: "anesthetist", label: "Anesthetist" },
  { id: "assistant", label: "Assistant" },
  { id: "circulatingNurse", label: "Circulating nurse" },
  { id: "fellowAnesthetist", label: "Fellow Anesthetist" },
  { id: "instrumentNurse", label: "Instrument nurse" },
  { id: "medicalStudent", label: "Medical Student" },
  { id: "nurseAnesthetist", label: "Nurse anesthetist" },
  { id: "rotateResident", label: "Rotate resident" },
  { id: "scrubNurse", label: "Scrub nurse" },
  { id: "surgeon", label: "Surgeon" },
  { id: "surgeryResident", label: "Surgery resident" },
  { id: "anesthetistResident", label: "Anesthetist Resident" },
];

const STAFF_ROLE_LABEL_BY_ID = new Map(
  STAFF_ROLE_DEFS.map(row => [row.id, row.label]),
);
const STAFF_ROLE_ID_BY_LABEL = new Map(
  STAFF_ROLE_DEFS.map(row => [row.label.toLowerCase(), row.id]),
);

function parseEntryYear(raw) {
  const text = String(raw || "").trim();
  if (!text) return null;

  const n = Number(text);
  if (!Number.isFinite(n)) return null;

  if (n >= 2500 && n <= 2700) return Math.trunc(n);
  if (n >= 1900 && n <= 2200) return Math.trunc(n);
  if (n >= 50 && n <= 99) return 2500 + Math.trunc(n);
  if (n >= 0 && n <= 49) return 2000 + Math.trunc(n);
  return null;
}

function resolveStaffRole(roleIdRaw, roleLabelRaw) {
  const roleId = String(roleIdRaw || "").trim();
  if (roleId && STAFF_ROLE_LABEL_BY_ID.has(roleId)) {
    return {
      roleId,
      roleLabel: STAFF_ROLE_LABEL_BY_ID.get(roleId),
    };
  }

  const roleLabel = String(roleLabelRaw || "")
    .trim()
    .replace(/\s+/g, " ");
  if (!roleLabel) return null;

  if (/^anes resident\b/i.test(roleLabel)) {
    return {
      roleId: "anesthetistResident",
      roleLabel: "Anesthetist Resident",
    };
  }

  const matchedRoleId = STAFF_ROLE_ID_BY_LABEL.get(roleLabel.toLowerCase());
  if (!matchedRoleId) return null;

  return {
    roleId: matchedRoleId,
    roleLabel: STAFF_ROLE_LABEL_BY_ID.get(matchedRoleId),
  };
}

const LIFECYCLE_EVENT_ALIASES = {
  ane: {
    start: new Set([
      "start ane",
      "start anes",
      "start anesthesia",
      "start anaesthesia",
      "sa",
    ]),
    end: new Set(["end ane", "end anes", "end anesthesia", "end anaesthesia", "ea"]),
  },
  surg: {
    start: new Set(["start surg", "start surgery", "ss"]),
    end: new Set(["end surg", "end surgery", "es"]),
  },
};

function normalizeLifecycleTitle(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function parseLifecycleEventTitle(title) {
  const normalized = normalizeLifecycleTitle(title);

  for (const scope of Object.keys(LIFECYCLE_EVENT_ALIASES)) {
    const aliases = LIFECYCLE_EVENT_ALIASES[scope];
    if (aliases.start.has(normalized)) {
      return { scope, phase: "start" };
    }
    if (aliases.end.has(normalized)) {
      return { scope, phase: "end" };
    }
  }

  return null;
}

const SUGGESTED_END_EVENT_GROUPS = {
  timeOut: new Set(["time out", "timeout", "to"]),
  startAne: new Set([
    "start ane",
    "start anes",
    "start anesthesia",
    "start anaesthesia",
    "sa",
  ]),
  induction: new Set(["induction"]),
  ssi: new Set(["ssi", "ssi prophylaxis", "ssiprophylaxis"]),
  startSurg: new Set(["start surg", "start surgery", "ss"]),
  endSurg: new Set(["end surg", "end surgery", "es"]),
  reversal: new Set(["reversal", "rev"]),
  endAne: new Set([
    "end ane",
    "end anes",
    "end anesthesia",
    "end anaesthesia",
    "ea",
  ]),
};

function parseSuggestedEndEventGroup(title) {
  const normalized = normalizeLifecycleTitle(title);
  for (const [group, aliases] of Object.entries(SUGGESTED_END_EVENT_GROUPS)) {
    if (aliases.has(normalized)) return group;
  }
  return null;
}

function hasMeaningfulVitalPayload(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return false;
  return Object.values(payload).some((value) => Number.isFinite(Number(value)));
}

function ceilToBucket(ts, bucketMs) {
  if (!Number.isFinite(ts) || !Number.isFinite(bucketMs) || bucketMs <= 0) return 0;
  return Math.ceil(ts / bucketMs) * bucketMs;
}

function buildSuggestedEndForCase(caseRow, referenceNowTs = Date.now()) {
  if (!caseRow) return null;

  const caseId = Number(caseRow.id);
  const startTs = Number(caseRow.start_time);
  const status = String(caseRow.status || "").trim().toLowerCase();
  const dischargeTs = Number(caseRow.discharge_time);
  const actualEndTs =
    status === "discharged" || status === "archived"
      ? dischargeTs
      : Number(referenceNowTs);

  if (!Number.isFinite(caseId) || caseId <= 0) return null;
  if (!Number.isFinite(startTs) || !Number.isFinite(actualEndTs) || actualEndTs <= startTs) {
    return null;
  }

  let maxVitalTs = 0;
  const vitalRows = db
    .prepare(
      `SELECT ts_minute, payload
       FROM vital_minutes
       WHERE case_id = ?
       ORDER BY ts_minute DESC, id DESC`,
    )
    .all(caseId);
  for (const row of vitalRows) {
    const payload = parseJsonSafe(row.payload);
    if (!hasMeaningfulVitalPayload(payload)) continue;
    const ts = Number(row.ts_minute);
    if (Number.isFinite(ts) && ts > 0) {
      maxVitalTs = ts;
      break;
    }
  }

  const ioEventRow = db
    .prepare(
      `SELECT MAX(event_ts) AS max_ts
       FROM case_io_event
       WHERE case_id = ?`,
    )
    .get(caseId);
  const maxIoEventTs = Number(ioEventRow?.max_ts) || 0;

  const ioRunRow = db
    .prepare(
      `SELECT MAX(ts) AS max_ts
       FROM (
         SELECT s.ts_from AS ts
         FROM case_io_segment s
         INNER JOIN case_io_run r ON r.id = s.run_id
         WHERE r.case_id = ?
         UNION ALL
         SELECT COALESCE(s.ts_to, 0) AS ts
         FROM case_io_segment s
         INNER JOIN case_io_run r ON r.id = s.run_id
         WHERE r.case_id = ?
        )`,
    )
    .get(caseId, caseId);
  const maxIoRunTs = Number(ioRunRow?.max_ts) || 0;

  let maxMilestoneTs = 0;
  let endAneTs = 0;
  const eventRows = db
    .prepare(
      `SELECT title, event_ts
       FROM case_event_note
       WHERE case_id = ?
         AND is_deleted = 0
         AND event_type = 'event'
       ORDER BY event_ts ASC, id ASC`,
    )
    .all(caseId);
  for (const row of eventRows) {
    const ts = Number(row.event_ts);
    if (!Number.isFinite(ts) || ts <= 0) continue;
    const group = parseSuggestedEndEventGroup(row.title);
    if (!group) continue;
    if (ts > maxMilestoneTs) maxMilestoneTs = ts;
    if (group === "endAne" && ts > endAneTs) endAneTs = ts;
  }

  const lastActivityTs = Math.max(startTs, maxVitalTs, maxIoEventTs, maxIoRunTs, maxMilestoneTs);
  if (!Number.isFinite(lastActivityTs) || lastActivityTs <= 0) return null;

  let suggestionAnchorTs = lastActivityTs;
  if (endAneTs > 0 && lastActivityTs - endAneTs > 30 * 60_000) {
    suggestionAnchorTs = endAneTs;
  }

  const idleTailMs = Math.max(0, actualEndTs - suggestionAnchorTs);
  const totalSpanMs = Math.max(0, actualEndTs - startTs);
  const hasEndAne = endAneTs > 0;
  const idleThresholdMs =
    status === "active"
      ? hasEndAne
        ? 45 * 60_000
        : 60 * 60_000
      : 4 * 60 * 60_000;
  const minSpanMs =
    status === "active"
      ? 2 * 60 * 60_000
      : 8 * 60 * 60_000;
  if (totalSpanMs < minSpanMs || idleTailMs < idleThresholdMs) return null;

  const suggestedEndTs = ceilToBucket(suggestionAnchorTs + 15 * 60_000, 15 * 60_000);
  if (!Number.isFinite(suggestedEndTs) || suggestedEndTs >= actualEndTs) return null;

  let basedOn = "activity";
  if (suggestionAnchorTs === endAneTs) basedOn = "end_ane";
  else if (maxIoEventTs === suggestionAnchorTs || maxIoRunTs === suggestionAnchorTs) basedOn = "io";
  else if (maxVitalTs === suggestionAnchorTs) basedOn = "vitals";
  else if (maxMilestoneTs === suggestionAnchorTs) basedOn = "milestone";

  return {
    case_id: caseId,
    suggested_end_time: suggestedEndTs,
    last_activity_time: suggestionAnchorTs,
    idle_tail_ms: idleTailMs,
    has_end_ane: hasEndAne,
    based_on: basedOn,
  };
}

function getLifecycleOpenCount(caseId, scope, eventTs, excludeEventId) {
  const hasExclude = Number.isFinite(excludeEventId);
  // Filter event_type = 'event' in SQL — avoids fetching 'note' rows into JS
  const query = hasExclude
    ? `SELECT id, title
       FROM case_event_note
       WHERE case_id = ?
         AND is_deleted = 0
         AND event_type = 'event'
         AND event_ts <= ?
         AND id <> ?
       ORDER BY event_ts ASC, id ASC`
    : `SELECT id, title
       FROM case_event_note
       WHERE case_id = ?
         AND is_deleted = 0
         AND event_type = 'event'
         AND event_ts <= ?
       ORDER BY event_ts ASC, id ASC`;

  const rows = hasExclude
    ? db.prepare(query).all(caseId, eventTs, excludeEventId)
    : db.prepare(query).all(caseId, eventTs);

  let openCount = 0;
  for (const row of rows) {
    const parsed = parseLifecycleEventTitle(row.title);
    if (!parsed || parsed.scope !== scope) continue;

    if (parsed.phase === "start") {
      openCount += 1;
      continue;
    }
    openCount = Math.max(0, openCount - 1);
  }

  return openCount;
}

function getLastCaseIoActivityTs(caseId) {
  const eventRow = db
    .prepare(
      `SELECT MAX(event_ts) AS max_ts
       FROM case_io_event
       WHERE case_id = ?`,
    )
    .get(caseId);
  const maxEventTs = Number(eventRow?.max_ts) || 0;

  const runRow = db
    .prepare(
      `SELECT MAX(ts) AS max_ts
       FROM (
         SELECT COALESCE(started_at, 0) AS ts
         FROM case_io_run
         WHERE case_id = ?
         UNION ALL
         SELECT COALESCE(stopped_at, 0) AS ts
         FROM case_io_run
         WHERE case_id = ?
         UNION ALL
         SELECT COALESCE(s.ts_from, 0) AS ts
         FROM case_io_segment s
         INNER JOIN case_io_run r ON r.id = s.run_id
         WHERE r.case_id = ?
         UNION ALL
         SELECT COALESCE(s.ts_to, 0) AS ts
         FROM case_io_segment s
         INNER JOIN case_io_run r ON r.id = s.run_id
         WHERE r.case_id = ?
       )`,
    )
    .get(caseId, caseId, caseId, caseId);
  const maxRunTs = Number(runRow?.max_ts) || 0;

  return Math.max(maxEventTs, maxRunTs);
}

function hasLifecycleStartInCase(caseId, scope, excludeEventId) {
  const hasExclude = Number.isFinite(excludeEventId);
  // Filter event_type = 'event' in SQL — avoids fetching 'note' rows into JS
  const query = hasExclude
    ? `SELECT title
       FROM case_event_note
       WHERE case_id = ?
         AND is_deleted = 0
         AND event_type = 'event'
         AND id <> ?`
    : `SELECT title
       FROM case_event_note
       WHERE case_id = ?
         AND is_deleted = 0
         AND event_type = 'event'`;

  const rows = hasExclude
    ? db.prepare(query).all(caseId, excludeEventId)
    : db.prepare(query).all(caseId);

  for (const row of rows) {
    const parsed = parseLifecycleEventTitle(row.title);
    if (!parsed) continue;
    if (parsed.scope === scope && parsed.phase === "start") {
      return true;
    }
  }

  return false;
}

function validateLifecycleTransition({ caseId, eventType, title, eventTs, excludeEventId }) {
  if (eventType !== "event") return null;
  const parsed = parseLifecycleEventTitle(title);
  if (!parsed) return null;

  const openCount = getLifecycleOpenCount(
    caseId,
    parsed.scope,
    eventTs,
    excludeEventId,
  );
  const label = parsed.scope === "ane" ? "ANE" : "Surgery";

  if (parsed.phase === "end" && openCount <= 0) {
    return `Need Start ${label} before End ${label}`;
  }

  if (
    parsed.phase === "start" &&
    hasLifecycleStartInCase(caseId, parsed.scope, excludeEventId)
  ) {
    return `Start ${label} already recorded in this case`;
  }

  return null;
}

const AUTO_EVENT_TITLE_BY_CATEGORY = new Map([
  ["ivanesth", "Induction"],
  ["ivanesthetic", "Induction"],
  ["antibiotics", "SSI Prophylaxis"],
  ["antimicrobial", "SSI Prophylaxis"],
  ["reversal", "Reversal"],
]);

function normalizeCategoryToken(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
    .trim();
}

function resolveAutoEventTitleByCategory(category) {
  const token = normalizeCategoryToken(category);
  if (!token) return null;
  return AUTO_EVENT_TITLE_BY_CATEGORY.get(token) || null;
}

function hasCaseEventTitle(caseId, title) {
  // normalizeLifecycleTitle = lower + collapse whitespace + trim.
  // TRIM(LOWER(?)) is equivalent for the simple titles used here ("Induction" etc.).
  // EXISTS stops at the first match — no need to fetch all rows.
  const normalized = normalizeLifecycleTitle(title);
  const row = db
    .prepare(
      `SELECT 1
         FROM case_event_note
        WHERE case_id = ?
          AND is_deleted = 0
          AND event_type = 'event'
          AND TRIM(LOWER(title)) = ?
        LIMIT 1`
    )
    .get(caseId, normalized);
  return row != null;
}

function createAutoCaseEventIfNeeded({ caseId, eventTs, itemCategory, actor, reason }) {
  const title = resolveAutoEventTitleByCategory(itemCategory);
  if (!title) return null;
  if (hasCaseEventTitle(caseId, title)) return null;

  const lifecycleError = validateLifecycleTransition({
    caseId,
    eventType: "event",
    title,
    eventTs,
  });
  if (lifecycleError) return null;

  const now = Date.now();
  const insertEvent = db.prepare(
    `INSERT INTO case_event_note
      (
        case_id, event_ts, event_type, title, detail,
        created_by, created_at, updated_by, updated_at, is_deleted
      )
     VALUES (?, ?, 'event', ?, NULL, ?, ?, ?, ?, 0)`
  );
  const insertAudit = db.prepare(
    `INSERT INTO case_event_note_audit
      (
        case_id, event_note_id, action,
        old_event_ts, old_event_type, old_title, old_detail,
        new_event_ts, new_event_type, new_title, new_detail,
        reason, actor_username, actor_name, actor_role, created_at
      )
     VALUES (?, ?, 'insert', NULL, NULL, NULL, NULL, ?, 'event', ?, NULL, ?, ?, ?, ?, ?)`
  );

  const info = insertEvent.run(
    caseId,
    eventTs,
    title,
    actor.username,
    now,
    actor.username,
    now,
  );
  const eventId = Number(info.lastInsertRowid);

  insertAudit.run(
    caseId,
    eventId,
    eventTs,
    title,
    reason || null,
    actor.username,
    actor.name,
    actor.role,
    now,
  );

  return {
    id: eventId,
    event_ts: eventTs,
    event_type: "event",
    title,
  };
}

function isBloodProductCategory(category) {
  return normalizeCategoryToken(category) === "bloodproduct";
}

function parseIoNoteMeta(note) {
  const map = {};
  const text = String(note || "").trim();
  if (!text) return map;

  for (const chunk of text.split("|")) {
    const token = String(chunk || "").trim();
    if (!token) continue;
    const idx = token.indexOf(":");
    if (idx <= 0) continue;
    const rawKey = token.slice(0, idx);
    const rawValue = token.slice(idx + 1);
    const key = normalizeCategoryToken(rawKey);
    const value = String(rawValue || "").trim();
    if (!key || !value) continue;
    map[key] = value;
  }
  return map;
}

function validateBloodGivingAuthorization(caseId, note, actor) {
  const meta = parseIoNoteMeta(note);
  const authorization = normalizeCategoryToken(meta.givingauthorization);
  const authorizedBy = normalizeNullableText(meta.givingauthorizedby);
  const authorizedRole = normalizeCategoryToken(meta.givingauthorizedrole);

  if (!authorization || !authorizedBy || authorizedRole !== "anesthetist") {
    return "Actual blood giving must be verified by an anesthetist before recording";
  }
  if (authorization === "self" && normalizeCategoryToken(actor?.role) !== "anesthetist") {
    return "Only an anesthetist can self-verify actual blood giving";
  }
  if (authorization !== "self" && authorization !== "supervised") {
    return "Invalid blood giving authorization";
  }
  if (authorization === "supervised") {
    const verifier = db
      .prepare(
        `SELECT id
         FROM case_staff
         WHERE case_id = ? AND staff_name = ? AND lower(staff_role_id) = 'anesthetist'
         LIMIT 1`
      )
      .get(caseId, authorizedBy);
    if (!verifier) {
      return "Selected verifier is not an anesthetist assigned to this case";
    }
  }
  return null;
}

function formatCompactNumber(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  if (Math.abs(n - Math.round(n)) < 0.0001) return String(Math.round(n));
  return n.toFixed(2).replace(/\.?0+$/, "");
}

function inferBloodProductType({ itemCode, itemName, noteMeta }) {
  const fromNote = normalizeNullableText(noteMeta?.bloodproducttype);
  if (fromNote) return fromNote.toUpperCase();

  const token = normalizeCategoryToken(`${itemCode || ""} ${itemName || ""}`);
  if (
    token.includes("ffp") ||
    token.includes("freshfrozenplasma") ||
    token.includes("freshfrozen")
  ) {
    return "FFP";
  }
  if (
    token.includes("prc") ||
    token.includes("lprc") ||
    token.includes("packedredcell") ||
    token.includes("packedcell") ||
    token.includes("redcell")
  ) {
    return "PRC";
  }
  return null;
}

function buildBloodProductEventDetail({
  itemCode,
  itemName,
  volumeMl,
  note,
}) {
  const meta = parseIoNoteMeta(note);
  const parts = [];

  const bloodType = inferBloodProductType({ itemCode, itemName, noteMeta: meta });
  if (bloodType) {
    parts.push(bloodType);
  } else if (normalizeNullableText(itemName)) {
    parts.push(String(itemName).trim());
  } else if (normalizeNullableText(itemCode)) {
    parts.push(String(itemCode).trim());
  }

  const bloodGroup = normalizeNullableText(meta.bloodgroup);
  if (bloodGroup) {
    parts.push(`Group: ${bloodGroup.toUpperCase()}`);
  }
  const bloodBagNo = normalizeNullableText(meta.bloodbagno);
  if (bloodBagNo) {
    parts.push(`Bag No: ${bloodBagNo}`);
  }

  const amountFromEvent = parseNullableNumber(volumeMl);
  const amountFromNote = parseNullableNumber(meta.dripvolumeml);
  const amountMl = amountFromEvent != null && amountFromEvent > 0
    ? amountFromEvent
    : amountFromNote != null && amountFromNote > 0
      ? amountFromNote
      : null;
  const amountText = amountMl == null ? null : formatCompactNumber(amountMl);
  if (amountText) {
    parts.push(`Amount: ${amountText} mL`);
  }
  const status = normalizeNullableText(meta.status);
  if (status) {
    parts.push(`Status: ${status}`);
  }

  const detail = parts.join(" | ").trim();
  return detail || null;
}

function createBloodProductEventIfNeeded({
  caseId,
  eventTs,
  itemCategory,
  itemCode,
  itemName,
  volumeMl,
  note,
  actor,
  reason,
}) {
  if (!isBloodProductCategory(itemCategory)) return null;

  const now = Date.now();
  const title = "Blood Product";
  const detail = buildBloodProductEventDetail({
    itemCode,
    itemName,
    volumeMl,
    note,
  });
  const insertEvent = db.prepare(
    `INSERT INTO case_event_note
      (
        case_id, event_ts, event_type, title, detail,
        created_by, created_at, updated_by, updated_at, is_deleted
      )
     VALUES (?, ?, 'event', ?, ?, ?, ?, ?, ?, 0)`
  );
  const insertAudit = db.prepare(
    `INSERT INTO case_event_note_audit
      (
        case_id, event_note_id, action,
        old_event_ts, old_event_type, old_title, old_detail,
        new_event_ts, new_event_type, new_title, new_detail,
        reason, actor_username, actor_name, actor_role, created_at
      )
     VALUES (?, ?, 'insert', NULL, NULL, NULL, NULL, ?, 'event', ?, ?, ?, ?, ?, ?, ?)`
  );

  const info = insertEvent.run(
    caseId,
    eventTs,
    title,
    detail,
    actor.username,
    now,
    actor.username,
    now,
  );
  const eventId = Number(info.lastInsertRowid);

  insertAudit.run(
    caseId,
    eventId,
    eventTs,
    title,
    detail,
    reason || null,
    actor.username,
    actor.name,
    actor.role,
    now,
  );

  return {
    id: eventId,
    event_ts: eventTs,
    event_type: "event",
    title,
    detail,
  };
}

function normalizeParamKey(paramKey) {
  return String(paramKey || "").trim().toLowerCase();
}

function normalizeStaffList(input) {
  const rows = Array.isArray(input) ? input : [];
  const seen = new Set();
  const normalized = [];

  for (const row of rows) {
    if (!row || typeof row !== "object" || Array.isArray(row)) continue;
    const hospitalId = String(
      row.hospital_id || row.hospitalId || row.hospital_no || row.hospitalNo || "",
    ).trim();
    const personalId = String(
      row.personal_id || row.personalId || "",
    ).trim();
    const email = String(row.email || "").trim().toLowerCase();
    const thFirstName = String(
      row.th_first_name || row.thFirstName || "",
    ).trim();
    const thLastName = String(
      row.th_last_name || row.thLastName || "",
    ).trim();
    const enFirstName = String(
      row.en_first_name || row.enFirstName || "",
    ).trim();
    const enLastName = String(
      row.en_last_name || row.enLastName || "",
    ).trim();
    const innovianId = String(
      row.innovian_id || row.innovianId || "",
    ).trim();
    const resolvedRole = resolveStaffRole(
      row.role_id || row.roleId || row.staff_role_id || row.staffRoleId || "",
      row.role || row.staff_role || row.staffRole || "",
    );
    if (!resolvedRole) continue;

    const role = resolvedRole.roleLabel;
    const roleId = resolvedRole.roleId;
    const entryYear = parseEntryYear(row.entry_year || row.entryYear || "");
    const name =
      String(row.name || row.staff_name || "").trim() ||
      [enFirstName, enLastName].filter(Boolean).join(" ").trim();
    if (!name) continue;

    const key = `${name.toLowerCase()}::${roleId.toLowerCase()}::${hospitalId.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);

    normalized.push({
      hospitalId: hospitalId || null,
      personalId: personalId || null,
      email: email || null,
      thFirstName: thFirstName || null,
      thLastName: thLastName || null,
      enFirstName: enFirstName || null,
      enLastName: enLastName || null,
      innovianId: innovianId || null,
      roleId,
      entryYear,
      name,
      role,
    });
  }

  return normalized;
}

function normalizeValueInput(paramKey, value, valueType) {
  if (value === undefined || value === null || value === "") return null;

  if (valueType === "number" || typeof value === "number") {
    const n = Number(value);
    if (!Number.isFinite(n)) {
      throw new Error(`invalid numeric value for ${paramKey}`);
    }
    return {
      valueType: "number",
      valueNum: n,
      valueText: null,
    };
  }

  const text = String(value).trim();
  if (!text) return null;

  const normalizedType =
    valueType === "code" || valueType === "text"
      ? valueType
      : paramKey === "ecg"
        ? "code"
        : "text";

  return {
    valueType: normalizedType,
    valueNum: null,
    valueText: text,
  };
}

function resolveCaseRange(caseRow, query) {
  const ADVANCE_MIN = 5;

  const defaultFrom = floorMinute(caseRow.start_time);
  const defaultTo =
    caseRow.status === "active"
      ? floorMinute(Date.now() + ADVANCE_MIN * 60000)
      : floorMinute(caseRow.discharge_time || Date.now());

  const queryFrom = Number(query.from);
  const queryTo = Number(query.to);

  const fromTs = Number.isFinite(queryFrom)
    ? floorMinute(queryFrom)
    : defaultFrom;
  const toTs = Number.isFinite(queryTo)
    ? floorMinute(queryTo)
    : defaultTo;

  if (toTs < fromTs) {
    return null;
  }

  return { fromTs, toTs };
}

function parseIoKind(rawKind) {
  const kind = String(rawKind || "").trim().toLowerCase();
  if (kind === "fluid" || kind === "med" || kind === "output") return kind;
  return null;
}

function parseEntryMode(raw) {
  const val = String(raw || "").trim().toLowerCase();
  if (val === "bolus" || val === "drip") return val;
  return null;
}

function normalizeIoCode(rawCode) {
  const text = String(rawCode || "").trim();
  if (!text) return "";

  const alnum = text.replace(/[^A-Za-z0-9]+/g, " ");
  const tokens = alnum
    .split(" ")
    .map(part => part.trim())
    .filter(Boolean);
  if (tokens.length === 0) return "";

  const [first, ...rest] = tokens;
  return (
    first.toLowerCase() +
    rest
      .map(part => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
      .join("")
  );
}

function buildIoCodeCandidate(rawCode, rawName) {
  const explicit = normalizeIoCode(rawCode);
  if (explicit) return explicit;

  const fromName = normalizeIoCode(rawName);
  if (fromName) return fromName;

  return "";
}

function ensureUniqueIoCode(baseCode, excludeId) {
  if (!baseCode) return "";
  const existsStmt = excludeId
    ? db.prepare(`SELECT id FROM io_item_master WHERE code = ? AND id <> ? LIMIT 1`)
    : db.prepare(`SELECT id FROM io_item_master WHERE code = ? LIMIT 1`);

  let code = baseCode;
  let suffix = 2;
  while (true) {
    const row = excludeId ? existsStmt.get(code, excludeId) : existsStmt.get(code);
    if (!row) return code;
    code = `${baseCode}${suffix}`;
    suffix += 1;
  }
}

function parseBooleanFlag(raw, defaultValue = true) {
  if (raw === undefined || raw === null || raw === "") return defaultValue;
  if (typeof raw === "boolean") return raw;
  if (typeof raw === "number") return raw !== 0;
  const text = String(raw).trim().toLowerCase();
  if (text === "1" || text === "true" || text === "yes") return true;
  if (text === "0" || text === "false" || text === "no") return false;
  return defaultValue;
}

function parseNullableTs(raw) {
  if (raw === undefined || raw === null || raw === "") return null;
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  return floorMinute(n);
}

function parseNullableNumber(raw) {
  if (raw === undefined || raw === null || raw === "") return null;
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  return n;
}

function normalizeRateUnit(rawUnit) {
  const unit = String(rawUnit || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "");
  if (!unit) return null;

  if (
    unit === "ml/hr" ||
    unit === "ml/h" ||
    unit === "mlhr" ||
    unit === "mlperhour" ||
    unit === "mL/hr".toLowerCase()
  ) {
    return "ml/hr";
  }

  if (unit === "l/hr" || unit === "l/h" || unit === "lhr" || unit === "lperhour") {
    return "l/hr";
  }

  return String(rawUnit || "").trim();
}

function rateToMlPerHour(rateValue, rateUnit) {
  if (!Number.isFinite(rateValue)) return null;
  const normalizedUnit = normalizeRateUnit(rateUnit);
  if (normalizedUnit === "ml/hr") return rateValue;
  if (normalizedUnit === "l/hr") return rateValue * 1000;
  return null;
}

function normalizeVolumeUnit(rawUnit) {
  const unit = String(rawUnit || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "");
  if (!unit) return null;
  if (unit === "ml" || unit === "milliliter" || unit === "millilitre") {
    return "ml";
  }
  if (unit === "l" || unit === "liter" || unit === "litre") {
    return "l";
  }
  return null;
}

function valueWithUnitToMl(rawValue, rawUnit) {
  const value = Number(rawValue);
  if (!Number.isFinite(value) || value <= 0) return null;
  const normalizedUnit = normalizeVolumeUnit(rawUnit);
  if (normalizedUnit === "ml") return value;
  if (normalizedUnit === "l") return value * 1000;
  return null;
}

function getActor(req) {
  return {
    username: String(req.body?.actor?.username || "").trim() || "unknown",
    name: String(req.body?.actor?.name || "").trim() || null,
    role: String(req.body?.actor?.role || "").trim() || null,
  };
}

const insertIoAudit = db.prepare(
  `INSERT INTO case_io_audit
    (
      case_id, entity_type, entity_id, action,
      before_json, after_json, reason,
      actor_username, actor_name, actor_role, created_at
    )
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
);

function writeIoAudit({
  caseId,
  entityType,
  entityId,
  action,
  beforeJson,
  afterJson,
  reason,
  actor,
}) {
  insertIoAudit.run(
    caseId,
    entityType,
    entityId,
    action,
    beforeJson == null ? null : JSON.stringify(beforeJson),
    afterJson == null ? null : JSON.stringify(afterJson),
    reason || null,
    actor.username,
    actor.name,
    actor.role,
    Date.now(),
  );
}

/* =======================
   START CASE OVERLAP CHECK
======================= */
router.post("/start-overlap-check", (req, res) => {
  const rawStartTs = Number(req.body?.start_time);
  if (!Number.isFinite(rawStartTs)) {
    return res.status(400).json({ error: "start_time required" });
  }

  const startTs = floorQuarterHour(rawStartTs);
  const overlap = getCaseStartOverlap(startTs);
  res.json({ ok: true, start_time: startTs, overlap });
});

/* =======================
   START CASE
======================= */
router.post("/start", (req, res) => {
  const { hn, start_time } = req.body;
  if (!hn) return res.status(400).json({ error: "hn required" });
  const actor = getActor(req);
  const reason =
    typeof req.body?.reason === "string" ? req.body.reason.trim() : "default output rows";

  const rawStartTs = Number(req.body?.start_time);
  if (!Number.isFinite(rawStartTs)) {
    return res.status(400).json({ error: "start_time required" });
  }
  const startTs = floorQuarterHour(rawStartTs);
  const overlapPolicy =
    req.body?.overlap_policy === "exclude"
      ? "exclude"
      : req.body?.overlap_policy === "include"
      ? "include"
      : null;

  const existingActive = db
    .prepare(`SELECT id, hn, start_time FROM cases WHERE status = 'active' ORDER BY start_time DESC, id DESC LIMIT 1`)
    .get();
  if (existingActive) {
    return res.status(409).json({
      error: "an active case already exists",
      active_case_id: existingActive.id,
      active_case_hn: existingActive.hn,
      active_case_start_time: existingActive.start_time,
    });
  }

  const overlap = getCaseStartOverlap(startTs);
  if (overlap && !overlapPolicy) {
    return res.status(409).json({
      error: "overlap choice required",
      code: "OVERLAP_CHOICE_REQUIRED",
      overlap,
    });
  }
  const deviceCaptureStartTs =
    overlap && overlapPolicy === "exclude"
      ? Number(overlap.suggested_capture_start_time)
      : startTs;

  const d = new Date(startTs);
  const ymd =
    d.getFullYear().toString() +
    String(d.getMonth() + 1).padStart(2, "0") +
    String(d.getDate()).padStart(2, "0");

  const row = db
    .prepare(
      `SELECT COUNT(*) AS c
       FROM cases
       WHERE hn = ? AND case_code LIKE ?`
    )
    .get(hn, `${hn}_${ymd}%`);

  const seq = String(row.c + 1).padStart(2, "0");
  const caseCode = `${hn}_${ymd}_${seq}`;

  const now = Date.now();

  const createCaseWithDefaults = db.transaction(() => {
    const info = db
      .prepare(
        `INSERT INTO cases
          (case_code, hn, start_time, device_capture_start_time, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'active', ?, ?)`
      )
      .run(caseCode, hn, startTs, deviceCaptureStartTs, now, now);

    const caseId = Number(info.lastInsertRowid);

    const defaultOutputItems = db
      .prepare(
        `SELECT id, code, name, default_unit, category
         FROM io_item_master
         WHERE kind = 'output'
           AND is_active = 1
           AND code IN ('urine', 'bloodLoss')
         ORDER BY CASE code WHEN 'urine' THEN 1 WHEN 'bloodLoss' THEN 2 ELSE 9 END`
      )
      .all();

    const insertRun = db.prepare(
      `INSERT INTO case_io_run
        (
          case_id, item_id, kind, route, started_at, stopped_at,
          entry_mode, note, include_in_balance, created_by, created_at, updated_at
        )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    const selectRun = db.prepare(`SELECT * FROM case_io_run WHERE id = ?`);

    for (const item of defaultOutputItems) {
      const runInfo = insertRun.run(
        caseId,
        item.id,
        "output",
        null,
        startTs,
        null,
        "bolus",
        null,
        1,
        actor.username,
        now,
        now,
      );
      const runId = Number(runInfo.lastInsertRowid);
      writeIoAudit({
        caseId,
        entityType: "run",
        entityId: runId,
        action: "insert",
        beforeJson: null,
        afterJson: selectRun.get(runId),
        reason,
        actor,
      });
    }

    return caseId;
  });

  const caseId = createCaseWithDefaults();

  try {
    startMinuteWriter(caseId);
  } catch (err) {
    console.error(
      `[CASE] startMinuteWriter failed for case=${caseId}: ${err?.message || err}`,
    );
  }

  res.json({
    ok: true,
    case_id: caseId,
    case_code: caseCode,
    start_time: startTs,
    device_capture_start_time: deviceCaptureStartTs,
    overlap_policy: overlap ? overlapPolicy : null,
  });
});

/* =======================
   DISCHARGE
======================= */
router.post("/discharge", (req, res) => {
  const { case_id } = req.body;
  if (!case_id) return res.status(400).json({ error: "case_id required" });

  const caseRow = db
    .prepare(`SELECT id, status, start_time FROM cases WHERE id = ?`)
    .get(case_id);
  if (!caseRow) {
    return res.status(404).json({ error: "not found" });
  }
  if (String(caseRow.status || "").toLowerCase() !== "active") {
    return res.status(400).json({ error: "case not active" });
  }

  const rawDischargeTs = req.body?.discharge_time;
  const requestedTs = Number(rawDischargeTs);
  const dischargeTs = Number.isFinite(requestedTs) ? floorMinute(requestedTs) : Date.now();
  const startTs = Number(caseRow.start_time);
  if (Number.isFinite(startTs) && dischargeTs < startTs) {
    return res.status(400).json({ error: "discharge_time must be >= start_time" });
  }

  const lastMinuteRow = db
    .prepare(
      `SELECT MAX(ts_minute) AS last_ts_minute
       FROM vital_minutes
       WHERE case_id = ?`,
    )
    .get(case_id);
  const lastMinuteTs = Number(lastMinuteRow?.last_ts_minute);
  if (Number.isFinite(lastMinuteTs) && dischargeTs <= lastMinuteTs) {
    return res.status(400).json({
      error: "discharge_time must be later than last minute-writer data",
    });
  }

  // Auto-stop any open drip runs at discharge time instead of blocking
  const openRuns = db
    .prepare(
      `SELECT r.id, r.started_at, r.note, COALESCE(m.name, m.code, 'Unknown') AS item_name
       FROM case_io_run r
       JOIN io_item_master m ON m.id = r.item_id
       WHERE r.case_id = ? AND r.stopped_at IS NULL AND r.entry_mode = 'drip'`,
    )
    .all(case_id);
  const now = Date.now();
  const stoppedDrips = [];
  for (const run of openRuns) {
    const segments = db
      .prepare(`SELECT ts_from, ts_to, carrier_ml_per_hr, rate_value, rate_unit FROM case_io_segment WHERE run_id = ? ORDER BY ts_from`)
      .all(run.id);
    let totalMl = 0;
    for (const seg of segments) {
      const from = Number(seg.ts_from);
      const to = seg.ts_to != null ? Math.min(Number(seg.ts_to), dischargeTs) : dischargeTs;
      if (to > from) {
        const mlPerHr = Number(seg.carrier_ml_per_hr) > 0
          ? Number(seg.carrier_ml_per_hr)
          : (rateToMlPerHour(Number(seg.rate_value), seg.rate_unit) ?? 0);
        totalMl += mlPerHr * (to - from) / 3_600_000;
      }
    }
    // Parse planned volume from note tokens (format: "key:value|key:value")
    const noteMeta = {};
    for (const part of String(run.note || '').split('|')) {
      const idx = part.indexOf(':');
      if (idx > 0) noteMeta[part.slice(0, idx).trim()] = part.slice(idx + 1).trim();
    }
    const plannedVolumeMl = parseFloat(noteMeta.totalVolumeMl);
    const stopAt = Math.max(Number(run.started_at) || dischargeTs, dischargeTs);
    db.prepare(`UPDATE case_io_run SET stopped_at = ?, updated_at = ? WHERE id = ?`).run(stopAt, now, run.id);
    stoppedDrips.push({
      name: run.item_name,
      delivered_ml: Math.round(totalMl * 10) / 10,
      planned_volume_ml: Number.isFinite(plannedVolumeMl) && plannedVolumeMl > 0 ? plannedVolumeMl : null,
    });
  }

  const r = db
    .prepare(
      `UPDATE cases
       SET status='discharged', discharge_time=?, updated_at=?
       WHERE id=? AND status='active'`
    )
    .run(dischargeTs, now, case_id);

  if (!r.changes) {
    return res.status(400).json({ error: "case not active" });
  }

  try {
    stopMinuteWriter(case_id);
  } catch (err) {
    console.error(
      `[CASE] stopMinuteWriter failed for case=${case_id}: ${err?.message || err}`,
    );
  }
  res.json({ ok: true, case_id, discharge_time: dischargeTs, stopped_drips: stoppedDrips });
});

/* =======================
   ARCHIVE
======================= */
router.post("/archive", (req, res) => {
  const { case_id } = req.body;
  if (!case_id) return res.status(400).json({ error: "case_id required" });

  const caseRow = db
    .prepare(`SELECT id, status FROM cases WHERE id = ?`)
    .get(case_id);
  if (!caseRow) {
    return res.status(404).json({ error: "not found" });
  }

  const status = String(caseRow.status || "").toLowerCase();
  if (status === "archived") {
    return res.json({ ok: true, case_id, archive_time: null });
  }
  if (status !== "discharged") {
    return res.status(400).json({ error: "case must be discharged before archive" });
  }

  const now = Date.now();

  const r = db.prepare(
    `UPDATE cases
     SET status='archived', archive_time=?, updated_at=?
     WHERE id=? AND status='discharged'`
  ).run(now, now, case_id);

  if (!r.changes) {
    return res.status(400).json({ error: "case must be discharged before archive" });
  }

  res.json({ ok: true, case_id, archive_time: now });
});

/* =======================
   UPDATE START TIME
======================= */
router.put("/:id/start-time", (req, res) => {
  const caseId = Number(req.params.id);
  if (!Number.isFinite(caseId) || caseId <= 0) {
    return res.status(400).json({ error: "invalid case id" });
  }

  const caseRow = db
    .prepare(`SELECT id, status, start_time, discharge_time, device_capture_start_time FROM cases WHERE id = ?`)
    .get(caseId);
  if (!caseRow) return res.status(404).json({ error: "not found" });

  const rawStartTs = Number(req.body?.start_time);
  if (!Number.isFinite(rawStartTs)) {
    return res.status(400).json({ error: "start_time required" });
  }
  const startTs = floorQuarterHour(rawStartTs);

  const isDischarged = String(caseRow.status || "").toLowerCase() === "discharged";
  const dischargeTs = Number(caseRow.discharge_time);
  if (isDischarged && Number.isFinite(dischargeTs) && startTs > dischargeTs) {
    return res.status(400).json({ error: "start_time must be <= discharge_time" });
  }

  const previousCaptureStartTs = Number(caseRow.device_capture_start_time);
  const nextCaptureStartTs = Math.max(
    startTs,
    Number.isFinite(previousCaptureStartTs) ? previousCaptureStartTs : startTs,
  );

  const now = Date.now();
  db.prepare(
    `UPDATE cases
     SET start_time = ?, device_capture_start_time = ?, updated_at = ?
     WHERE id = ?`,
  ).run(
    startTs,
    nextCaptureStartTs,
    now,
    caseId,
  );

  if (String(caseRow.status || "").toLowerCase() === "active") {
    try {
      rewindMinuteWriter(caseId, nextCaptureStartTs);
    } catch (err) {
      console.error(
        `[CASE] rewindMinuteWriter failed for case=${caseId}: ${err?.message || err}`,
      );
    }
  }

  res.json({
    ok: true,
    case_id: caseId,
    start_time: startTs,
    device_capture_start_time: nextCaptureStartTs,
  });
});

/* =======================
   UPDATE DISCHARGE TIME
======================= */
router.put("/:id/discharge-time", (req, res) => {
  const caseId = Number(req.params.id);
  if (!Number.isFinite(caseId) || caseId <= 0) {
    return res.status(400).json({ error: "invalid case id" });
  }

  const caseRow = db
    .prepare(`SELECT id, status, start_time, discharge_time FROM cases WHERE id = ?`)
    .get(caseId);
  if (!caseRow) return res.status(404).json({ error: "not found" });

  const status = String(caseRow.status || "").toLowerCase();
  if (status !== "discharged" && status !== "archived") {
    return res.status(400).json({ error: "case must be discharged or archived" });
  }

  const rawDischargeTs = Number(req.body?.discharge_time);
  if (!Number.isFinite(rawDischargeTs)) {
    return res.status(400).json({ error: "discharge_time required" });
  }
  const dischargeTs = floorMinute(rawDischargeTs);

  const startTs = Number(caseRow.start_time);
  if (Number.isFinite(startTs) && dischargeTs < startTs) {
    return res.status(400).json({ error: "discharge_time must be >= start_time" });
  }

  const lastMinuteRow = db
    .prepare(
      `SELECT MAX(ts_minute) AS last_ts_minute
       FROM vital_minutes
       WHERE case_id = ?`,
    )
    .get(caseId);
  const lastMinuteTs = Number(lastMinuteRow?.last_ts_minute);
  if (Number.isFinite(lastMinuteTs) && dischargeTs <= lastMinuteTs) {
    return res.status(400).json({
      error: "discharge_time must be later than last minute-writer data",
    });
  }

  // Auto-stop any open drip runs at discharge time instead of blocking
  const openRuns2 = db
    .prepare(
      `SELECT r.id, r.started_at, COALESCE(m.name, m.code, 'Unknown') AS item_name
       FROM case_io_run r
       JOIN io_item_master m ON m.id = r.item_id
       WHERE r.case_id = ? AND r.stopped_at IS NULL AND r.entry_mode = 'drip'`,
    )
    .all(caseId);
  const now = Date.now();
  const stoppedDrips2 = [];
  for (const run of openRuns2) {
    const segments = db
      .prepare(`SELECT ts_from, ts_to, carrier_ml_per_hr, rate_value, rate_unit FROM case_io_segment WHERE run_id = ? ORDER BY ts_from`)
      .all(run.id);
    let totalMl = 0;
    for (const seg of segments) {
      const from = Number(seg.ts_from);
      const to = seg.ts_to != null ? Math.min(Number(seg.ts_to), dischargeTs) : dischargeTs;
      if (to > from) {
        const mlPerHr = Number(seg.carrier_ml_per_hr) > 0
          ? Number(seg.carrier_ml_per_hr)
          : (rateToMlPerHour(Number(seg.rate_value), seg.rate_unit) ?? 0);
        totalMl += mlPerHr * (to - from) / 3_600_000;
      }
    }
    const stopAt = Math.max(Number(run.started_at) || dischargeTs, dischargeTs);
    db.prepare(`UPDATE case_io_run SET stopped_at = ?, updated_at = ? WHERE id = ?`).run(stopAt, now, run.id);
    stoppedDrips2.push({ name: run.item_name, delivered_ml: Math.round(totalMl) });
  }

  db.prepare(`UPDATE cases SET discharge_time = ?, updated_at = ? WHERE id = ?`).run(
    dischargeTs,
    now,
    caseId,
  );

  res.json({
    ok: true,
    case_id: caseId,
    discharge_time: dischargeTs,
    stopped_drips: stoppedDrips2,
  });
});

/* =======================
   SUGGESTED END TIME
======================= */
router.get("/:id/suggested-end", (req, res) => {
  const caseId = Number(req.params.id);
  if (!Number.isFinite(caseId) || caseId <= 0) {
    return res.status(400).json({ error: "invalid case id" });
  }

  const caseRow = db
    .prepare(`SELECT id, status, start_time, discharge_time FROM cases WHERE id = ?`)
    .get(caseId);
  if (!caseRow) return res.status(404).json({ error: "not found" });

  return res.json({
    ok: true,
    suggestion: buildSuggestedEndForCase(caseRow),
  });
});

/* =======================
   CASE STATUS
======================= */
router.get("/status", (req, res) => {
  const row = db
    .prepare(
      `SELECT *
       FROM cases
       WHERE status IN ('active','discharged')
       ORDER BY CASE WHEN status = 'active' THEN 0 ELSE 1 END,
                COALESCE(discharge_time, start_time) DESC,
                id DESC
       LIMIT 1`
     )
    .get();

  if (!row) return res.json({ status: "IDLE" });

  res.json({
    status: row.status.toUpperCase(),
    case_id: row.id,
    hn: row.hn,
    start_time: row.start_time,
    discharge_time: row.discharge_time,
  });
});

/* =======================
   CASE LIST (RECENT)
======================= */
router.get("/list", (req, res) => {
  const limitRaw = Number(req.query.limit);
  const limit = Number.isFinite(limitRaw)
    ? Math.max(1, Math.min(200, Math.floor(limitRaw)))
    : 30;
  const includeArchived =
    String(req.query.include_archived || "1").toLowerCase() !== "0";

  const where = includeArchived
    ? "status IN ('active','discharged','archived')"
    : "status IN ('active','discharged')";

  const rows = db
    .prepare(
      `SELECT id, case_code, hn, status, start_time, discharge_time, created_at
       FROM cases
       WHERE ${where}
       ORDER BY start_time DESC, id DESC
       LIMIT ?`,
    )
    .all(limit);

  res.json({
    rows: rows.map(row => ({
      case_id: row.id,
      case_code: row.case_code,
      hn: row.hn,
      status: String(row.status || "").toUpperCase(),
      start_time: row.start_time,
      discharge_time: row.discharge_time,
      created_at: row.created_at,
    })),
  });
});

/* =======================
   HIS SYNC + CACHE
======================= */
function parseJsonSafe(raw) {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function parsePreAdmitTs(raw) {
  if (raw === undefined || raw === null || raw === "") return null;

  const direct = Number(raw);
  if (Number.isFinite(direct)) return floorMinute(direct);

  const text = String(raw).trim();
  if (!text) return null;
  const parsed = parseIsoOrDmyToTs(text);
  if (!Number.isFinite(parsed)) return null;
  return floorMinute(parsed);
}

function getHisBufferSnapshot(hnRaw) {
  const hn = String(hnRaw || "").trim();
  if (!hn) return null;

  const row = db
    .prepare(
      `SELECT
         hn, an, is_patient, notype, id_card, patient_name,
         title_th, title_en, first_name, last_name, first_name_en, last_name_en,
         sex, dob, age_text, weight_kg, height_cm, blood_group_text,
         blood_group_abo, blood_group_rh, race, ethnicity, religion, marital_status,
         present_address, present_province, legal_address, legal_province,
         mobile, contact_name, contact_tel, relation_desc, nationality,
         source, raw_payload, pre_admit_at, pre_admit_note, his_updated_at, created_at, updated_at
       FROM his_patient_buffer
       WHERE hn = ?`,
    )
    .get(hn);
  if (!row) return null;

  const allergies = db
    .prepare(
      `SELECT
         id, allergen, reaction, severity, status, source, updated_at
       FROM his_allergy_buffer
       WHERE hn = ?
       ORDER BY id ASC`,
    )
    .all(hn);

  const labs = db
    .prepare(
      `SELECT
         id, test_name, test_group, value_text, unit,
         ref_range, flag, collected_at, source, updated_at
       FROM his_lab_buffer
       WHERE hn = ?
       ORDER BY COALESCE(collected_at, 0) DESC, id DESC`,
    )
    .all(hn);

  return {
    row,
    allergies,
    labs,
    hisPayload: parseJsonSafe(row.raw_payload),
  };
}

const upsertHisBufferPatientStmt = db.prepare(
  `INSERT INTO his_patient_buffer (
     hn, an, is_patient, notype, id_card, patient_name,
     title_th, title_en, first_name, last_name, first_name_en, last_name_en,
     sex, dob, age_text, weight_kg, height_cm, blood_group_text,
     blood_group_abo, blood_group_rh, race, ethnicity, religion, marital_status,
     present_address, present_province, legal_address, legal_province,
     mobile, contact_name, contact_tel, relation_desc, nationality,
     source, raw_payload, pre_admit_at, pre_admit_note, his_updated_at, created_at, updated_at
   )
   VALUES (
     @hn, @an, @is_patient, @notype, @id_card, @patient_name,
     @title_th, @title_en, @first_name, @last_name, @first_name_en, @last_name_en,
     @sex, @dob, @age_text, @weight_kg, @height_cm, @blood_group_text,
     @blood_group_abo, @blood_group_rh, @race, @ethnicity, @religion, @marital_status,
     @present_address, @present_province, @legal_address, @legal_province,
     @mobile, @contact_name, @contact_tel, @relation_desc, @nationality,
     @source, @raw_payload, @pre_admit_at, @pre_admit_note, @his_updated_at, @created_at, @updated_at
   )
   ON CONFLICT(hn) DO UPDATE SET
     an=excluded.an,
     is_patient=excluded.is_patient,
     notype=excluded.notype,
     id_card=excluded.id_card,
     patient_name=excluded.patient_name,
     title_th=excluded.title_th,
     title_en=excluded.title_en,
     first_name=excluded.first_name,
     last_name=excluded.last_name,
     first_name_en=excluded.first_name_en,
     last_name_en=excluded.last_name_en,
     sex=excluded.sex,
     dob=excluded.dob,
     age_text=excluded.age_text,
     weight_kg=excluded.weight_kg,
     height_cm=excluded.height_cm,
     blood_group_text=excluded.blood_group_text,
     blood_group_abo=excluded.blood_group_abo,
     blood_group_rh=excluded.blood_group_rh,
     race=excluded.race,
     ethnicity=excluded.ethnicity,
     religion=excluded.religion,
     marital_status=excluded.marital_status,
     present_address=excluded.present_address,
     present_province=excluded.present_province,
     legal_address=excluded.legal_address,
     legal_province=excluded.legal_province,
     mobile=excluded.mobile,
     contact_name=excluded.contact_name,
     contact_tel=excluded.contact_tel,
     relation_desc=excluded.relation_desc,
     nationality=excluded.nationality,
     source=excluded.source,
     raw_payload=excluded.raw_payload,
     pre_admit_at=excluded.pre_admit_at,
     pre_admit_note=excluded.pre_admit_note,
     his_updated_at=excluded.his_updated_at,
     updated_at=excluded.updated_at`,
);

const insertHisBufferAllergyStmt = db.prepare(
  `INSERT INTO his_allergy_buffer (
     hn, allergen, reaction, severity, status, source, raw_payload,
     his_updated_at, created_at, updated_at
   )
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
);

const insertHisBufferLabStmt = db.prepare(
  `INSERT INTO his_lab_buffer (
     hn, test_name, test_group, value_text, unit, ref_range, flag,
     collected_at, source, raw_payload, his_updated_at, created_at, updated_at
   )
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
);

const saveHisLookupToBufferTx = db.transaction(
  ({
    hn,
    mappedPatient,
    hisPayload,
    allergyRows,
    labRows,
    preAdmitAt,
    preAdmitNote,
    now,
  }) => {
    const existing = db
      .prepare(`SELECT pre_admit_at, pre_admit_note FROM his_patient_buffer WHERE hn = ?`)
      .get(hn);
    const resolvedPreAdmitAt =
      preAdmitAt === undefined ? existing?.pre_admit_at ?? null : preAdmitAt;
    const resolvedPreAdmitNote =
      preAdmitNote === undefined ? existing?.pre_admit_note ?? null : preAdmitNote;

    upsertHisBufferPatientStmt.run({
      ...mappedPatient,
      hn,
      raw_payload: JSON.stringify(hisPayload),
      pre_admit_at: resolvedPreAdmitAt,
      pre_admit_note: resolvedPreAdmitNote,
      his_updated_at: mappedPatient.his_updated_at || now,
      created_at: now,
      updated_at: now,
    });

    db.prepare(`DELETE FROM his_allergy_buffer WHERE hn = ?`).run(hn);
    for (const row of allergyRows) {
      insertHisBufferAllergyStmt.run(
        hn,
        row.allergen,
        row.reaction || null,
        row.severity || null,
        row.status || null,
        row.source || "HIS",
        JSON.stringify(row.raw || row),
        mappedPatient.his_updated_at || now,
        now,
        now,
      );
    }

    db.prepare(`DELETE FROM his_lab_buffer WHERE hn = ?`).run(hn);
    for (const row of labRows) {
      insertHisBufferLabStmt.run(
        hn,
        row.test_name,
        row.test_group || null,
        row.value_text || null,
        row.unit || null,
        row.ref_range || null,
        row.flag || null,
        row.collected_at || null,
        row.source || "HIS",
        JSON.stringify(row.raw || row),
        mappedPatient.his_updated_at || now,
        now,
        now,
      );
    }
  },
);

function mapAllergyRowsFromSoap(rawRows, now, idPrefix = "allergy") {
  return rawRows
    .map((raw, idx) => {
      const allergen = normalizeNullableText(
        raw.NAME || raw.ALLERGEN || raw.SUBSTANCE || raw.allergen_name,
      );
      if (!allergen) return null;
      return {
        id: `${idPrefix}-${idx + 1}`,
        allergen,
        reaction: normalizeNullableText(raw.RESULT_DIS || raw.REACTION || raw.reaction),
        severity: normalizeNullableText(raw.CADR || raw.SEVERITY || raw.severity),
        status: normalizeNullableText(raw.STATUS || raw.status),
        source: "HIS",
        updated_at: now,
        raw,
      };
    })
    .filter(row => row != null);
}

function mapLabRowsFromSoap(rawRows, idPrefix = "lab") {
  return rawRows
    .map((raw, idx) => {
      const test_name = normalizeNullableText(raw.LABNAME || raw.TEST_NAME || raw.NAME);
      if (!test_name) return null;
      return {
        id: `${idPrefix}-${idx + 1}`,
        test_name,
        test_group: normalizeNullableText(raw.LABGRPNAME || raw.TEST_GROUP || raw.GROUP_NAME),
        value_text: normalizeNullableText(raw.LABRESULT || raw.RESULT_VALUE || raw.VALUE),
        unit: normalizeNullableText(raw.LABUNIT || raw.UNIT),
        ref_range: normalizeNullableText(raw.LABMAXMIN || raw.REF_RANGE),
        flag: normalizeNullableText(raw.ABNORMALFLAG || raw.FLAG),
        collected_at:
          parseIsoOrDmyToTs(
            raw.LVSTDATE || raw.LABDATE || raw.COLLECTED_DATE,
            raw.LVSTTIME || raw.LABTIME || raw.COLLECTED_TIME,
          ) || null,
        source: "HIS",
        raw,
      };
    })
    .filter(row => row != null);
}
router.post("/his/lookup", async (req, res) => {
  const hn = String(req.body?.hn || "").trim();
  if (!hn) return res.status(400).json({ error: "hn is required" });
  const labgrp = String(req.body?.labgrp || "28").trim() || "28";

  let payload;
  try {
    payload = await postHisGateway("/api/patient-full", { hn, labgrp });
  } catch (err) {
    const buffered = getHisBufferSnapshot(hn);
    if (!buffered) {
      return res
        .status(502)
        .json({ error: "his gateway request failed", message: err.message || String(err) });
    }
    return res.json({
      ok: true,
      hn,
      source: "BUFFER",
      offline: true,
      row: {
        ...buffered.row,
        his_payload: buffered.hisPayload,
      },
      allergies: buffered.allergies,
      labs: buffered.labs,
      his_payload: buffered.hisPayload,
      his_errors: { gateway: err.message || String(err) },
    });
  }

  const infoRow = asRowsFromSoapResult(payload?.patientInfo)[0] || null;
  const anRow = asRowsFromSoapResult(payload?.inpatientAn)[0] || null;
  const rawAllergyRows = asRowsFromSoapResult(payload?.allergy);
  const rawLabRows = asRowsFromSoapResult(payload?.lab);
  const vitalRows = asRowsFromSoapResult(payload?.vital);

  const latestVital = vitalRows
    .map(row => ({
      row,
      ts:
        parseIsoOrDmyToTs(
          row.VSDATE || row.RECORD_DATE || row.DATE,
          row.VSTIME || row.RECORD_TIME || row.TIME,
        ) || 0,
    }))
    .sort((a, b) => a.ts - b.ts)
    .map(x => x.row)
    .pop() || null;

  const now = Date.now();
  const hisErrors =
    payload && typeof payload.errors === "object" && payload.errors ? payload.errors : {};
  const mappedPatient = mapHisPatientRecord({
    hn,
    infoRow,
    anRow,
    latestVital,
    hisUpdatedAt: now,
  });
  const hisPayload = {
    patientMapped: mappedPatient,
    patientInfo: payload?.patientInfo ?? null,
    inpatientAn: payload?.inpatientAn ?? null,
    patientAllergy: payload?.allergy ?? null,
    labResult: payload?.lab ?? null,
    patientVital: payload?.vital ?? null,
    errors: hisErrors,
  };

  const allergies = rawAllergyRows
    .map((raw, idx) => {
      const allergen = normalizeNullableText(
        raw.NAME || raw.ALLERGEN || raw.SUBSTANCE || raw.allergen_name,
      );
      if (!allergen) return null;
      return {
        id: `lookup-allergy-${idx + 1}`,
        allergen,
        reaction: normalizeNullableText(raw.RESULT_DIS || raw.REACTION || raw.reaction),
        severity: normalizeNullableText(raw.CADR || raw.SEVERITY || raw.severity),
        status: normalizeNullableText(raw.STATUS || raw.status),
        source: "HIS",
        updated_at: now,
        raw,
      };
    })
    .filter(row => row != null);

  const labs = rawLabRows
    .map((raw, idx) => {
      const test_name = normalizeNullableText(raw.LABNAME || raw.TEST_NAME || raw.NAME);
      if (!test_name) return null;
      return {
        id: `lookup-lab-${idx + 1}`,
        test_name,
        test_group: normalizeNullableText(raw.LABGRPNAME || raw.TEST_GROUP || raw.GROUP_NAME),
        value_text: normalizeNullableText(raw.LABRESULT || raw.RESULT_VALUE || raw.VALUE),
        unit: normalizeNullableText(raw.LABUNIT || raw.UNIT),
        ref_range: normalizeNullableText(raw.LABMAXMIN || raw.REF_RANGE),
        flag: normalizeNullableText(raw.ABNORMALFLAG || raw.FLAG),
        collected_at:
          parseIsoOrDmyToTs(
            raw.LVSTDATE || raw.LABDATE || raw.COLLECTED_DATE,
            raw.LVSTTIME || raw.LABTIME || raw.COLLECTED_TIME,
          ) || null,
        source: "HIS",
        raw,
      };
    })
    .filter(row => row != null);

  try {
    saveHisLookupToBufferTx({
      hn,
      mappedPatient,
      hisPayload,
      allergyRows: allergies,
      labRows: labs,
      preAdmitAt: undefined,
      preAdmitNote: undefined,
      now,
    });
  } catch {
    // Do not fail lookup if local cache write fails.
  }

  return res.json({
    ok: true,
    hn,
    source: "HIS",
    offline: false,
    row: { ...mappedPatient, his_payload: hisPayload },
    allergies: allergies.map(({ raw, ...rest }) => rest),
    labs: labs.map(({ raw, ...rest }) => rest),
    his_payload: hisPayload,
    his_errors: hisErrors,
  });
});

router.post("/his/preload", async (req, res) => {
  const hn = String(req.body?.hn || "").trim();
  if (!hn) return res.status(400).json({ error: "hn is required" });

  const labgrp = String(req.body?.labgrp || "28").trim() || "28";
  const preAdmitAt =
    req.body?.pre_admit_at === undefined
      ? undefined
      : parsePreAdmitTs(req.body?.pre_admit_at);
  const preAdmitNote =
    req.body?.pre_admit_note === undefined
      ? undefined
      : normalizeNullableText(req.body?.pre_admit_note);
  const allowBufferFallback = parseBooleanFlag(req.body?.allow_buffer_fallback, true);

  let payload;
  try {
    payload = await postHisGateway("/api/patient-full", { hn, labgrp });
  } catch (err) {
    if (!allowBufferFallback) {
      return res
        .status(502)
        .json({ error: "his gateway request failed", message: err.message || String(err) });
    }

    const buffered = getHisBufferSnapshot(hn);
    if (!buffered) {
      return res
        .status(502)
        .json({ error: "his gateway request failed", message: err.message || String(err) });
    }
    return res.json({
      ok: true,
      hn,
      source: "BUFFER",
      offline: true,
      row: {
        ...buffered.row,
        his_payload: buffered.hisPayload,
      },
      allergies: buffered.allergies,
      labs: buffered.labs,
      his_payload: buffered.hisPayload,
      his_errors: { gateway: err.message || String(err) },
    });
  }

  const infoRow = asRowsFromSoapResult(payload?.patientInfo)[0] || null;
  const anRow = asRowsFromSoapResult(payload?.inpatientAn)[0] || null;
  const rawAllergyRows = asRowsFromSoapResult(payload?.allergy);
  const rawLabRows = asRowsFromSoapResult(payload?.lab);
  const vitalRows = asRowsFromSoapResult(payload?.vital);

  const latestVital = vitalRows
    .map(row => ({
      row,
      ts:
        parseIsoOrDmyToTs(
          row.VSDATE || row.RECORD_DATE || row.DATE,
          row.VSTIME || row.RECORD_TIME || row.TIME,
        ) || 0,
    }))
    .sort((a, b) => a.ts - b.ts)
    .map(x => x.row)
    .pop() || null;

  const now = Date.now();
  const hisErrors =
    payload && typeof payload.errors === "object" && payload.errors ? payload.errors : {};
  const mappedPatient = mapHisPatientRecord({
    hn,
    infoRow,
    anRow,
    latestVital,
    hisUpdatedAt: now,
  });
  const hisPayload = {
    patientMapped: mappedPatient,
    patientInfo: payload?.patientInfo ?? null,
    inpatientAn: payload?.inpatientAn ?? null,
    patientAllergy: payload?.allergy ?? null,
    labResult: payload?.lab ?? null,
    patientVital: payload?.vital ?? null,
    errors: hisErrors,
  };

  const allergies = rawAllergyRows
    .map(raw => {
      const allergen = normalizeNullableText(
        raw.NAME || raw.ALLERGEN || raw.SUBSTANCE || raw.allergen_name,
      );
      if (!allergen) return null;
      return {
        allergen,
        reaction: normalizeNullableText(raw.RESULT_DIS || raw.REACTION || raw.reaction),
        severity: normalizeNullableText(raw.CADR || raw.SEVERITY || raw.severity),
        status: normalizeNullableText(raw.STATUS || raw.status),
        source: "HIS",
        updated_at: now,
        raw,
      };
    })
    .filter(row => row != null);

  const labs = rawLabRows
    .map(raw => {
      const test_name = normalizeNullableText(raw.LABNAME || raw.TEST_NAME || raw.NAME);
      if (!test_name) return null;
      return {
        test_name,
        test_group: normalizeNullableText(raw.LABGRPNAME || raw.TEST_GROUP || raw.GROUP_NAME),
        value_text: normalizeNullableText(raw.LABRESULT || raw.RESULT_VALUE || raw.VALUE),
        unit: normalizeNullableText(raw.LABUNIT || raw.UNIT),
        ref_range: normalizeNullableText(raw.LABMAXMIN || raw.REF_RANGE),
        flag: normalizeNullableText(raw.ABNORMALFLAG || raw.FLAG),
        collected_at:
          parseIsoOrDmyToTs(
            raw.LVSTDATE || raw.LABDATE || raw.COLLECTED_DATE,
            raw.LVSTTIME || raw.LABTIME || raw.COLLECTED_TIME,
          ) || null,
        source: "HIS",
        raw,
      };
    })
    .filter(row => row != null);

  try {
    saveHisLookupToBufferTx({
      hn,
      mappedPatient,
      hisPayload,
      allergyRows: allergies,
      labRows: labs,
      preAdmitAt,
      preAdmitNote,
      now,
    });
  } catch (err) {
    return res.status(500).json({ error: "failed to save preload buffer", message: err.message });
  }

  const buffered = getHisBufferSnapshot(hn);
  return res.json({
    ok: true,
    hn,
    source: "HIS",
    offline: false,
    row: {
      ...(buffered?.row || mappedPatient),
      his_payload: buffered?.hisPayload || hisPayload,
    },
    allergies: buffered?.allergies || [],
    labs: buffered?.labs || [],
    his_payload: buffered?.hisPayload || hisPayload,
    his_errors: hisErrors,
  });
});

router.get("/his/buffer", (req, res) => {
  const requestedLimit = Number(req.query.limit);
  const limit = Number.isFinite(requestedLimit)
    ? Math.max(1, Math.min(300, Math.trunc(requestedLimit)))
    : 80;
  const q = String(req.query.q || "").trim().toLowerCase();
  const qLike = `%${q}%`;

  const where = [];
  const params = { limit };
  if (q) {
    where.push(
      `(lower(COALESCE(hn, '')) LIKE @qLike
        OR lower(COALESCE(patient_name, '')) LIKE @qLike
        OR lower(COALESCE(first_name, '')) LIKE @qLike
        OR lower(COALESCE(last_name, '')) LIKE @qLike
        OR lower(COALESCE(first_name_en, '')) LIKE @qLike
        OR lower(COALESCE(last_name_en, '')) LIKE @qLike)`,
    );
    params.qLike = qLike;
  }

  const rows = db
    .prepare(
      `SELECT
         hn,
         patient_name,
         first_name,
         last_name,
         first_name_en,
         last_name_en,
         sex,
         dob,
         blood_group_text,
         pre_admit_at,
         pre_admit_note,
         his_updated_at,
         updated_at,
         (
           SELECT COUNT(1)
           FROM his_allergy_buffer a
           WHERE a.hn = p.hn
         ) AS allergy_count,
         (
           SELECT COUNT(1)
           FROM his_lab_buffer l
           WHERE l.hn = p.hn
         ) AS lab_count
       FROM his_patient_buffer p
       ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
       ORDER BY
         CASE WHEN pre_admit_at IS NULL THEN 1 ELSE 0 END ASC,
         COALESCE(pre_admit_at, 0) DESC,
         his_updated_at DESC,
         hn ASC
       LIMIT @limit`,
    )
    .all(params);

  return res.json({ rows });
});

router.get("/his/buffer/:hn", (req, res) => {
  const hn = String(req.params.hn || "").trim();
  if (!hn) return res.status(400).json({ error: "hn is required" });
  const buffered = getHisBufferSnapshot(hn);
  if (!buffered) return res.status(404).json({ error: "buffer patient not found" });

  return res.json({
    ok: true,
    hn,
    source: "BUFFER",
    row: {
      ...buffered.row,
      his_payload: buffered.hisPayload,
    },
    allergies: buffered.allergies,
    labs: buffered.labs,
    his_payload: buffered.hisPayload,
  });
});

router.delete("/his/buffer/:hn", (req, res) => {
  const hn = String(req.params.hn || "").trim();
  if (!hn) return res.status(400).json({ error: "hn is required" });

  const hasPatient = db
    .prepare(`SELECT hn FROM his_patient_buffer WHERE hn = ?`)
    .get(hn);
  if (!hasPatient) return res.status(404).json({ error: "buffer patient not found" });

  const tx = db.transaction(() => {
    db.prepare(`DELETE FROM his_allergy_buffer WHERE hn = ?`).run(hn);
    db.prepare(`DELETE FROM his_lab_buffer WHERE hn = ?`).run(hn);
    db.prepare(`DELETE FROM his_patient_buffer WHERE hn = ?`).run(hn);
  });

  try {
    tx();
  } catch (err) {
    return res.status(500).json({ error: "failed to delete buffer patient", message: err.message });
  }

  return res.json({ ok: true, hn });
});

router.post("/his/buffer/:hn/pre-admit", (req, res) => {
  const hn = String(req.params.hn || "").trim();
  if (!hn) return res.status(400).json({ error: "hn is required" });
  const current = db
    .prepare(
      `SELECT hn, pre_admit_at, pre_admit_note
       FROM his_patient_buffer
       WHERE hn = ?`,
    )
    .get(hn);
  if (!current) return res.status(404).json({ error: "buffer patient not found" });

  const preAdmitAt =
    req.body?.pre_admit_at === undefined
      ? current.pre_admit_at
      : parsePreAdmitTs(req.body?.pre_admit_at);
  const preAdmitNote =
    req.body?.pre_admit_note === undefined
      ? current.pre_admit_note
      : normalizeNullableText(req.body?.pre_admit_note);
  const now = Date.now();

  db.prepare(
    `UPDATE his_patient_buffer
     SET pre_admit_at = ?, pre_admit_note = ?, updated_at = ?
     WHERE hn = ?`,
  ).run(preAdmitAt, preAdmitNote, now, hn);

  return res.json({
    ok: true,
    hn,
    pre_admit_at: preAdmitAt,
    pre_admit_note: preAdmitNote,
  });
});

router.post("/his/patient-info-lookup", async (req, res) => {
  const hn = String(req.body?.hn || "").trim();
  if (!hn) return res.status(400).json({ error: "hn is required" });

  try {
    const { mappedPatient, hisPayload } = await fetchPatientInfoOnly(hn);
    return res.json({
      ok: true,
      hn,
      source: "HIS",
      offline: false,
      row: { ...mappedPatient, his_payload: hisPayload },
      allergies: [],
      labs: [],
      his_payload: hisPayload,
      his_errors: {},
    });
  } catch (err) {
    return res
      .status(502)
      .json({ error: "his gateway request failed", message: err.message || String(err) });
  }
});

router.post("/:id/his/blood-products", async (req, res) => {
  const caseId = Number(req.params.id);
  if (!Number.isFinite(caseId)) return res.status(400).json({ error: "invalid case id" });

  const caseRow = db
    .prepare(`SELECT id, hn FROM cases WHERE id = ?`)
    .get(caseId);
  if (!caseRow) return res.status(404).json({ error: "not found" });

  const hn = String(caseRow.hn || "").trim();
  const an = normalizeNullableText(req.body?.an);
  if (!hn) return res.status(400).json({ error: "hn is required" });

  let payload;
  let source = "HIS";
  try {
    const useLocalBloodProductList = !HIS_BLOOD_PRODUCT_LIST_REAL || HIS_BLOOD_PRODUCT_LIST_MOCK;
    if (useLocalBloodProductList) {
      source = "MOCK";
      payload = {
        rows: [
          {
            hn,
            an,
            patient_name: normalizeNullableText(req.body?.patient_name),
            reqno: "MOCK-REQ-12345",
            bdtype: "Packed red cell",
            dnrno: "12345",
            bloodgrp: "O",
            rh: "+",
            unitstas: "2",
          },
        ],
      };
    } else {
      payload = await postHisGateway(HIS_BLOOD_PRODUCT_LIST_PATH, { hn, an });
    }
  } catch (err) {
    return res
      .status(502)
      .json({ error: "his gateway request failed", message: err.message || String(err) });
  }

  return res.json({
    ok: true,
    case_id: caseId,
    hn,
    source,
    rows: normalizeBloodBagList(payload),
  });
});

router.post("/:id/his/blood-product/verify", async (req, res) => {
  const caseId = Number(req.params.id);
  if (!Number.isFinite(caseId)) return res.status(400).json({ error: "invalid case id" });

  const caseRow = db
    .prepare(`SELECT id, hn FROM cases WHERE id = ?`)
    .get(caseId);
  if (!caseRow) return res.status(404).json({ error: "not found" });

  const caseHn = String(caseRow.hn || "").trim();
  const hn = String(req.body?.hn || caseHn || "").trim();
  const qr = normalizeNullableText(req.body?.qr);
  const dnrno = normalizeNullableText(req.body?.dnrno || req.body?.blood_bag_no || req.body?.bloodBagNo);
  if (!hn) return res.status(400).json({ error: "hn is required" });
  if (!qr && !dnrno) return res.status(400).json({ error: "qr or dnrno is required" });

  let payload;
  try {
    const scanText = String(qr || dnrno || "").trim();
    const useLocalBloodProductVerifier =
      !HIS_BLOOD_PRODUCT_VERIFY_REAL || HIS_BLOOD_PRODUCT_VERIFY_MOCK;
    if (useLocalBloodProductVerifier) {
      const mockAn =
        hn === "123469"
          ? "111169"
          : normalizeNullableText(req.body?.an) || "3333";
      payload =
        scanText === "12345"
          ? {
              hn,
              an: mockAn,
              patient_name: hn === "123469" ? "Mungmee Srisuk" : normalizeNullableText(req.body?.patient_name),
              reqno: "MOCK-REQ-12345",
              bdtype: "Packed red cell",
              dnrno: "12345",
              bloodgrp: "O",
              rh: "+",
              unitstas: "2",
            }
          : {
              hn,
              an: mockAn,
              patient_name: hn === "123469" ? "Mungmee Srisuk" : normalizeNullableText(req.body?.patient_name),
              reqno: `MOCK-REQ-${scanText || "UNKNOWN"}`,
              bdtype: "Unknown",
              dnrno: scanText || dnrno || "",
              bloodgrp: "",
              rh: "",
              unitstas: "0",
            };
    } else {
      payload = await postHisGateway(HIS_BLOOD_PRODUCT_VERIFY_PATH, {
        hn,
        qr,
        dnrno,
      });
    }
  } catch (err) {
    return res
      .status(502)
      .json({ error: "his gateway request failed", message: err.message || String(err) });
  }

  const row = normalizeBloodBagVerification(payload);
  if (!row) {
    return res.status(502).json({ error: "his blood product response is empty" });
  }

  const returnedHn = String(row.hn || "").trim();
  const returnedBagNo = String(row.dnrno || "").trim();
  const returnedStatus = String(row.unitstas || "").trim();
  const hnMatches = Boolean(returnedHn) && returnedHn === caseHn && returnedHn === hn;
  const bagMatches = !dnrno || !returnedBagNo || returnedBagNo === dnrno;
  const statusOk = returnedStatus === "1" || returnedStatus === "2";
  const ok = hnMatches && bagMatches && statusOk;

  return res.json({
    ok,
    case_id: caseId,
    hn: caseHn,
    requested: { hn, qr, dnrno },
    result: row,
    checks: {
      hn_match: hnMatches,
      dnrno_match: bagMatches,
      unitstas_ok: statusOk,
    },
    message: ok
      ? "blood product verified"
      : !hnMatches
        ? "HN mismatch"
        : !bagMatches
          ? "blood bag number mismatch"
          : "blood bag status is not ready for use",
  });
});

router.post("/his/allergy", async (req, res) => {
  const hn = String(req.body?.hn || "").trim();
  if (!hn) return res.status(400).json({ error: "hn is required" });
  const allowBufferFallback = parseBooleanFlag(req.body?.allow_buffer_fallback, true);

  let payload;
  try {
    payload = await postHisGateway("/api/patient-allergy", { hn });
  } catch (err) {
    if (!allowBufferFallback) {
      return res
        .status(502)
        .json({ error: "his gateway request failed", message: err.message || String(err) });
    }
    const rows = db
      .prepare(
        `SELECT
           id, allergen, reaction, severity, status, source, updated_at
         FROM his_allergy_buffer
         WHERE hn = ?
         ORDER BY id ASC`,
      )
      .all(hn);
    return res.json({
      ok: true,
      hn,
      source: "BUFFER",
      offline: true,
      rows,
      his_errors: { gateway: err.message || String(err) },
    });
  }

  const rawRows = asRowsFromSoapResult(payload);
  const now = Date.now();
  const rows = mapAllergyRowsFromSoap(rawRows, now, "allergy");

  try {
    db.transaction(() => {
      db.prepare(`DELETE FROM his_allergy_buffer WHERE hn = ?`).run(hn);
      for (const row of rows) {
        insertHisBufferAllergyStmt.run(
          hn,
          row.allergen,
          row.reaction || null,
          row.severity || null,
          row.status || null,
          row.source || "HIS",
          JSON.stringify(row.raw || row),
          now,
          now,
          now,
        );
      }
    })();
  } catch {
    // Non-blocking cache failure.
  }

  return res.json({
    ok: true,
    hn,
    source: "HIS",
    offline: false,
    rows: rows.map(({ raw, ...rest }) => rest),
  });
});

router.post("/his/lab", async (req, res) => {
  const hn = String(req.body?.hn || "").trim();
  if (!hn) return res.status(400).json({ error: "hn is required" });
  const labgrp = String(req.body?.labgrp || "28").trim() || "28";
  const allowBufferFallback = parseBooleanFlag(req.body?.allow_buffer_fallback, true);

  let payload;
  try {
    payload = await postHisGateway("/api/lab-result", { hn, labgrp });
  } catch (err) {
    if (!allowBufferFallback) {
      return res
        .status(502)
        .json({ error: "his gateway request failed", message: err.message || String(err) });
    }
    const rows = db
      .prepare(
        `SELECT
           id, test_name, test_group, value_text, unit,
           ref_range, flag, collected_at, source, updated_at
         FROM his_lab_buffer
         WHERE hn = ?
         ORDER BY COALESCE(collected_at, 0) DESC, id DESC`,
      )
      .all(hn);
    return res.json({
      ok: true,
      hn,
      source: "BUFFER",
      offline: true,
      rows,
      his_errors: { gateway: err.message || String(err) },
    });
  }

  const rawRows = asRowsFromSoapResult(payload);
  const now = Date.now();
  const rows = mapLabRowsFromSoap(rawRows, "lab");

  try {
    db.transaction(() => {
      db.prepare(`DELETE FROM his_lab_buffer WHERE hn = ?`).run(hn);
      for (const row of rows) {
        insertHisBufferLabStmt.run(
          hn,
          row.test_name,
          row.test_group || null,
          row.value_text || null,
          row.unit || null,
          row.ref_range || null,
          row.flag || null,
          row.collected_at || null,
          row.source || "HIS",
          JSON.stringify(row.raw || row),
          now,
          now,
          now,
        );
      }
    })();
  } catch {
    // Non-blocking cache failure.
  }

  return res.json({
    ok: true,
    hn,
    source: "HIS",
    offline: false,
    rows: rows.map(({ raw, ...rest }) => rest),
  });
});

router.get("/:id/detail-draft", (req, res) => {
  const caseId = Number(req.params.id);
  if (!Number.isFinite(caseId) || caseId <= 0) {
    return res.status(400).json({ error: "invalid case id" });
  }

  const row = db
    .prepare(
      `SELECT form_draft_json, updated_at
       FROM case_detail
       WHERE case_id = ?`,
    )
    .get(caseId);

  return res.json({
    ok: true,
    case_id: caseId,
    draft: parseJsonSafeObject(row?.form_draft_json),
    updated_at: Number(row?.updated_at) || null,
  });
});

router.put("/:id/detail-draft", (req, res) => {
  const caseId = Number(req.params.id);
  if (!Number.isFinite(caseId) || caseId <= 0) {
    return res.status(400).json({ error: "invalid case id" });
  }

  const caseRow = db.prepare(`SELECT id FROM cases WHERE id = ?`).get(caseId);
  if (!caseRow) return res.status(404).json({ error: "case not found" });

  const draft = req.body?.draft;
  if (!draft || typeof draft !== "object" || Array.isArray(draft)) {
    return res.status(400).json({ error: "draft object required" });
  }

  const now = Date.now();
  db.prepare(
    `INSERT INTO case_detail (case_id, created_at, updated_at, form_draft_json)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(case_id) DO UPDATE SET
       form_draft_json = excluded.form_draft_json,
       updated_at = excluded.updated_at`,
  ).run(caseId, now, now, JSON.stringify(draft));

  return res.json({ ok: true, case_id: caseId, updated_at: now });
});

router.delete("/:id/detail-draft", (req, res) => {
  const caseId = Number(req.params.id);
  if (!Number.isFinite(caseId) || caseId <= 0) {
    return res.status(400).json({ error: "invalid case id" });
  }

  const now = Date.now();
  db.prepare(
    `INSERT INTO case_detail (case_id, created_at, updated_at, form_draft_json)
     VALUES (?, ?, ?, NULL)
     ON CONFLICT(case_id) DO UPDATE SET
       form_draft_json = NULL,
       updated_at = excluded.updated_at`,
  ).run(caseId, now, now);

  return res.json({ ok: true, case_id: caseId, updated_at: now });
});

router.post("/:id/his/sync", async (req, res) => {
  const caseId = Number(req.params.id);
  if (!Number.isFinite(caseId) || caseId <= 0) {
    return res.status(400).json({ error: "invalid case id" });
  }

  const caseRow = db
    .prepare(`SELECT id, hn FROM cases WHERE id = ?`)
    .get(caseId);
  if (!caseRow) return res.status(404).json({ error: "case not found" });

  const labgrp = String(req.body?.labgrp || "28").trim() || "28";
  const allowBufferFallback = parseBooleanFlag(req.body?.allow_buffer_fallback, true);

  let payload;
  try {
    payload = await postHisGateway("/api/patient-full", {
      hn: caseRow.hn,
      labgrp,
    });
  } catch (err) {
    if (allowBufferFallback) {
      const buffered = getHisBufferSnapshot(caseRow.hn);
      if (buffered) {
        const now = Date.now();
        try {
          db.transaction(() => {
            db.prepare(
              `INSERT INTO case_his_patient (
                 case_id, hn, an, first_name, last_name, sex, dob,
                 blood_group_text, blood_group_abo, blood_group_rh,
                 source, raw_payload, his_updated_at, created_at, updated_at
               )
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
               ON CONFLICT(case_id) DO UPDATE SET
                 hn=excluded.hn,
                 an=excluded.an,
                 first_name=excluded.first_name,
                 last_name=excluded.last_name,
                 sex=excluded.sex,
                 dob=excluded.dob,
                 blood_group_text=excluded.blood_group_text,
                 blood_group_abo=excluded.blood_group_abo,
                 blood_group_rh=excluded.blood_group_rh,
                 source=excluded.source,
                 raw_payload=excluded.raw_payload,
                 his_updated_at=excluded.his_updated_at,
                 updated_at=excluded.updated_at`,
            ).run(
              caseId,
              buffered.row.hn,
              buffered.row.an || null,
              buffered.row.first_name || null,
              buffered.row.last_name || null,
              buffered.row.sex || null,
              buffered.row.dob || null,
              buffered.row.blood_group_text || null,
              buffered.row.blood_group_abo || null,
              buffered.row.blood_group_rh || null,
              buffered.row.source || "BUFFER",
              buffered.row.raw_payload || null,
              buffered.row.his_updated_at || now,
              now,
              now,
            );

            db.prepare(`DELETE FROM case_his_allergy WHERE case_id = ?`).run(caseId);
            const insertAllergy = db.prepare(
              `INSERT INTO case_his_allergy (
                 case_id, allergen, reaction, severity, status, source,
                 raw_payload, his_updated_at, created_at, updated_at
               )
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            );
            for (const row of buffered.allergies) {
              insertAllergy.run(
                caseId,
                row.allergen,
                row.reaction || null,
                row.severity || null,
                row.status || null,
                row.source || "BUFFER",
                null,
                buffered.row.his_updated_at || now,
                now,
                now,
              );
            }

            db.prepare(`DELETE FROM case_his_lab WHERE case_id = ?`).run(caseId);
            const insertLab = db.prepare(
              `INSERT INTO case_his_lab (
                 case_id, test_name, test_group, value_text, unit, ref_range, flag,
                 collected_at, source, raw_payload, his_updated_at, created_at, updated_at
               )
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            );
            for (const row of buffered.labs) {
              insertLab.run(
                caseId,
                row.test_name,
                row.test_group || null,
                row.value_text || null,
                row.unit || null,
                row.ref_range || null,
                row.flag || null,
                row.collected_at || null,
                row.source || "BUFFER",
                null,
                buffered.row.his_updated_at || now,
                now,
                now,
              );
            }
          })();
        } catch (applyErr) {
          return res
            .status(500)
            .json({ error: "failed to apply his buffer", message: applyErr.message });
        }

        return res.json({
          ok: true,
          case_id: caseId,
          hn: caseRow.hn,
          source: "BUFFER",
          offline: true,
          saved: {
            patient: 1,
            allergies: buffered.allergies.length,
            labs: buffered.labs.length,
            vitals: 0,
          },
          his_errors: { gateway: err.message || String(err) },
        });
      }
    }
    return res
      .status(502)
      .json({ error: "his gateway request failed", message: err.message || String(err) });
  }

  const infoRow = asRowsFromSoapResult(payload?.patientInfo)[0] || null;
  const anRow = asRowsFromSoapResult(payload?.inpatientAn)[0] || null;
  const allergyRows = asRowsFromSoapResult(payload?.allergy);
  const labRows = asRowsFromSoapResult(payload?.lab);
  const vitalRows = asRowsFromSoapResult(payload?.vital);

  const latestVital = vitalRows
    .map(row => ({
      row,
      ts:
        parseIsoOrDmyToTs(row.VSDATE || row.RECORD_DATE || row.DATE, row.VSTIME || row.RECORD_TIME || row.TIME) ||
        0,
    }))
    .sort((a, b) => a.ts - b.ts)
    .map(x => x.row)
    .pop() || null;

  const hisErrors =
    payload && typeof payload.errors === "object" && payload.errors ? payload.errors : {};

  const now = Date.now();
  const mappedPatient = mapHisPatientRecord({
    hn: caseRow.hn,
    infoRow,
    anRow,
    latestVital,
    hisUpdatedAt: now,
  });
  const hisPayload = {
    patientMapped: mappedPatient,
    patientInfo: payload?.patientInfo ?? null,
    inpatientAn: payload?.inpatientAn ?? null,
    patientAllergy: payload?.allergy ?? null,
    labResult: payload?.lab ?? null,
    patientVital: payload?.vital ?? null,
    errors: hisErrors,
  };
  const patientRecord = {
    ...mappedPatient,
    raw_payload: JSON.stringify(hisPayload),
  };

  let savedAllergy = 0;
  let savedLab = 0;

  const syncTx = db.transaction(() => {
    db.prepare(
      `INSERT INTO case_his_patient (
         case_id, hn, an, is_patient, notype, id_card, patient_name,
         title_th, title_en, first_name, last_name, first_name_en, last_name_en,
         sex, dob, age_text, weight_kg, height_cm, blood_group_text,
         blood_group_abo, blood_group_rh, race, ethnicity, religion, marital_status,
         present_address, present_province, legal_address, legal_province,
         mobile, contact_name, contact_tel, relation_desc, nationality,
         source, raw_payload, his_updated_at, created_at, updated_at
       )
       VALUES (
         @case_id, @hn, @an, @is_patient, @notype, @id_card, @patient_name,
         @title_th, @title_en, @first_name, @last_name, @first_name_en, @last_name_en,
         @sex, @dob, @age_text, @weight_kg, @height_cm, @blood_group_text,
         @blood_group_abo, @blood_group_rh, @race, @ethnicity, @religion, @marital_status,
         @present_address, @present_province, @legal_address, @legal_province,
         @mobile, @contact_name, @contact_tel, @relation_desc, @nationality,
         @source, @raw_payload, @his_updated_at, @created_at, @updated_at
       )
       ON CONFLICT(case_id) DO UPDATE SET
         hn=excluded.hn,
         an=excluded.an,
         is_patient=excluded.is_patient,
         notype=excluded.notype,
         id_card=excluded.id_card,
         patient_name=excluded.patient_name,
         title_th=excluded.title_th,
         title_en=excluded.title_en,
         first_name=excluded.first_name,
         last_name=excluded.last_name,
         first_name_en=excluded.first_name_en,
         last_name_en=excluded.last_name_en,
         sex=excluded.sex,
         dob=excluded.dob,
         age_text=excluded.age_text,
         weight_kg=excluded.weight_kg,
         height_cm=excluded.height_cm,
         blood_group_text=excluded.blood_group_text,
         blood_group_abo=excluded.blood_group_abo,
         blood_group_rh=excluded.blood_group_rh,
         race=excluded.race,
         ethnicity=excluded.ethnicity,
         religion=excluded.religion,
         marital_status=excluded.marital_status,
         present_address=excluded.present_address,
         present_province=excluded.present_province,
         legal_address=excluded.legal_address,
         legal_province=excluded.legal_province,
         mobile=excluded.mobile,
         contact_name=excluded.contact_name,
         contact_tel=excluded.contact_tel,
         relation_desc=excluded.relation_desc,
         nationality=excluded.nationality,
         source=excluded.source,
         raw_payload=excluded.raw_payload,
         his_updated_at=excluded.his_updated_at,
         updated_at=excluded.updated_at`,
    ).run({
      case_id: caseId,
      ...patientRecord,
      created_at: now,
      updated_at: now,
    });

    db.prepare(`DELETE FROM case_his_allergy WHERE case_id = ?`).run(caseId);
    const insertAllergy = db.prepare(
      `INSERT INTO case_his_allergy (
         case_id, allergen, reaction, severity, status, source,
         raw_payload, his_updated_at, created_at, updated_at
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const row of allergyRows) {
      const allergen = normalizeNullableText(
        row.NAME || row.ALLERGEN || row.SUBSTANCE || row.allergen_name,
      );
      if (!allergen) continue;
      insertAllergy.run(
        caseId,
        allergen,
        normalizeNullableText(row.RESULT_DIS || row.REACTION || row.reaction),
        normalizeNullableText(row.CADR || row.SEVERITY || row.severity),
        normalizeNullableText(row.STATUS || row.status),
        "HIS",
        JSON.stringify(row),
        now,
        now,
        now,
      );
      savedAllergy += 1;
    }

    db.prepare(`DELETE FROM case_his_lab WHERE case_id = ?`).run(caseId);
    const insertLab = db.prepare(
      `INSERT INTO case_his_lab (
         case_id, test_name, test_group, value_text, unit, ref_range, flag,
         collected_at, source, raw_payload, his_updated_at, created_at, updated_at
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const row of labRows) {
      const testName = normalizeNullableText(row.LABNAME || row.TEST_NAME || row.NAME);
      if (!testName) continue;
      const collectedAt =
        parseIsoOrDmyToTs(
          row.LVSTDATE || row.LABDATE || row.COLLECTED_DATE,
          row.LVSTTIME || row.LABTIME || row.COLLECTED_TIME,
        ) || null;
      insertLab.run(
        caseId,
        testName,
        normalizeNullableText(row.LABGRPNAME || row.TEST_GROUP || row.GROUP_NAME),
        normalizeNullableText(row.LABRESULT || row.RESULT_VALUE || row.VALUE),
        normalizeNullableText(row.LABUNIT || row.UNIT),
        normalizeNullableText(row.LABMAXMIN || row.REF_RANGE),
        normalizeNullableText(row.ABNORMALFLAG || row.FLAG),
        collectedAt,
        "HIS",
        JSON.stringify(row),
        now,
        now,
        now,
      );
      savedLab += 1;
    }
  });

  try {
    syncTx();
  } catch (err) {
    return res.status(500).json({ error: "failed to cache his data", message: err.message });
  }

  try {
    const lookupAllergyRows = allergyRows
      .map(raw => {
        const allergen = normalizeNullableText(
          raw.NAME || raw.ALLERGEN || raw.SUBSTANCE || raw.allergen_name,
        );
        if (!allergen) return null;
        return {
          allergen,
          reaction: normalizeNullableText(raw.RESULT_DIS || raw.REACTION || raw.reaction),
          severity: normalizeNullableText(raw.CADR || raw.SEVERITY || raw.severity),
          status: normalizeNullableText(raw.STATUS || raw.status),
          source: "HIS",
          updated_at: now,
          raw,
        };
      })
      .filter(row => row != null);

    const lookupLabRows = labRows
      .map(raw => {
        const test_name = normalizeNullableText(raw.LABNAME || raw.TEST_NAME || raw.NAME);
        if (!test_name) return null;
        return {
          test_name,
          test_group: normalizeNullableText(raw.LABGRPNAME || raw.TEST_GROUP || raw.GROUP_NAME),
          value_text: normalizeNullableText(raw.LABRESULT || raw.RESULT_VALUE || raw.VALUE),
          unit: normalizeNullableText(raw.LABUNIT || raw.UNIT),
          ref_range: normalizeNullableText(raw.LABMAXMIN || raw.REF_RANGE),
          flag: normalizeNullableText(raw.ABNORMALFLAG || raw.FLAG),
          collected_at:
            parseIsoOrDmyToTs(
              raw.LVSTDATE || raw.LABDATE || raw.COLLECTED_DATE,
              raw.LVSTTIME || raw.LABTIME || raw.COLLECTED_TIME,
            ) || null,
          source: "HIS",
          raw,
        };
      })
      .filter(row => row != null);

    saveHisLookupToBufferTx({
      hn: caseRow.hn,
      mappedPatient,
      hisPayload,
      allergyRows: lookupAllergyRows,
      labRows: lookupLabRows,
      preAdmitAt: undefined,
      preAdmitNote: undefined,
      now,
    });
  } catch {
    // Keep case sync success even when background preload buffer write fails.
  }

  return res.json({
    ok: true,
    case_id: caseId,
    hn: caseRow.hn,
    source: "HIS",
    offline: false,
    saved: {
      patient: 1,
      allergies: savedAllergy,
      labs: savedLab,
      vitals: vitalRows.length,
    },
    his_errors: hisErrors,
  });
});

router.post("/:id/his/patient-info-sync", async (req, res) => {
  const caseId = Number(req.params.id);
  if (!Number.isFinite(caseId) || caseId <= 0) {
    return res.status(400).json({ error: "invalid case id" });
  }

  const caseRow = db.prepare(`SELECT id, hn FROM cases WHERE id = ?`).get(caseId);
  if (!caseRow) return res.status(404).json({ error: "case not found" });

  const hn = String(caseRow.hn || "").trim();
  if (!hn) return res.status(400).json({ error: "hn is required" });

  try {
    const { mappedPatient, hisPayload, now } = await fetchPatientInfoOnly(hn);
    upsertCaseHisPatientOnly(caseId, mappedPatient, hisPayload, now);
    return res.json({
      ok: true,
      case_id: caseId,
      hn,
      source: "HIS",
      offline: false,
      saved: { patient: 1 },
      his_errors: {},
    });
  } catch (err) {
    return res
      .status(502)
      .json({ error: "his gateway request failed", message: err.message || String(err) });
  }
});

router.post("/:id/his/allergy/sync", async (req, res) => {
  const caseId = Number(req.params.id);
  if (!Number.isFinite(caseId) || caseId <= 0) {
    return res.status(400).json({ error: "invalid case id" });
  }

  const caseRow = db
    .prepare(`SELECT id, hn FROM cases WHERE id = ?`)
    .get(caseId);
  if (!caseRow) return res.status(404).json({ error: "case not found" });

  const allowBufferFallback = parseBooleanFlag(req.body?.allow_buffer_fallback, true);
  let rows = [];
  let source = "HIS";
  let offline = false;
  const hisErrors = {};
  const now = Date.now();

  try {
    const payload = await postHisGateway("/api/patient-allergy", { hn: caseRow.hn });
    rows = mapAllergyRowsFromSoap(asRowsFromSoapResult(payload), now, "case-allergy");
  } catch (err) {
    if (!allowBufferFallback) {
      return res
        .status(502)
        .json({ error: "his gateway request failed", message: err.message || String(err) });
    }
    const buffered = db
      .prepare(
        `SELECT
           id, allergen, reaction, severity, status, source, updated_at
         FROM his_allergy_buffer
         WHERE hn = ?
         ORDER BY id ASC`,
      )
      .all(caseRow.hn);
    rows = buffered;
    source = "BUFFER";
    offline = true;
    hisErrors.gateway = err.message || String(err);
  }

  try {
    db.transaction(() => {
      db.prepare(`DELETE FROM case_his_allergy WHERE case_id = ?`).run(caseId);
      const insertAllergy = db.prepare(
        `INSERT INTO case_his_allergy (
           case_id, allergen, reaction, severity, status, source,
           raw_payload, his_updated_at, created_at, updated_at
         )
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const row of rows) {
        insertAllergy.run(
          caseId,
          row.allergen,
          row.reaction || null,
          row.severity || null,
          row.status || null,
          row.source || source,
          "raw" in row ? JSON.stringify(row.raw || row) : null,
          now,
          now,
          now,
        );
      }

      if (source === "HIS") {
        db.prepare(`DELETE FROM his_allergy_buffer WHERE hn = ?`).run(caseRow.hn);
        for (const row of rows) {
          insertHisBufferAllergyStmt.run(
            caseRow.hn,
            row.allergen,
            row.reaction || null,
            row.severity || null,
            row.status || null,
            row.source || "HIS",
            "raw" in row ? JSON.stringify(row.raw || row) : null,
            now,
            now,
            now,
          );
        }
      }
    })();
  } catch (err) {
    return res.status(500).json({ error: "failed to sync allergy", message: err.message });
  }

  return res.json({
    ok: true,
    case_id: caseId,
    hn: caseRow.hn,
    source,
    offline,
    saved: rows.length,
    rows: rows.map(row => {
      if ("raw" in row) {
        const { raw, ...rest } = row;
        return rest;
      }
      return row;
    }),
    his_errors: hisErrors,
  });
});

router.post("/:id/his/lab/sync", async (req, res) => {
  const caseId = Number(req.params.id);
  if (!Number.isFinite(caseId) || caseId <= 0) {
    return res.status(400).json({ error: "invalid case id" });
  }

  const caseRow = db
    .prepare(`SELECT id, hn FROM cases WHERE id = ?`)
    .get(caseId);
  if (!caseRow) return res.status(404).json({ error: "case not found" });

  const labgrp = String(req.body?.labgrp || "28").trim() || "28";
  const allowBufferFallback = parseBooleanFlag(req.body?.allow_buffer_fallback, true);
  let rows = [];
  let source = "HIS";
  let offline = false;
  const hisErrors = {};
  const now = Date.now();

  try {
    const payload = await postHisGateway("/api/lab-result", { hn: caseRow.hn, labgrp });
    rows = mapLabRowsFromSoap(asRowsFromSoapResult(payload), "case-lab");
  } catch (err) {
    if (!allowBufferFallback) {
      return res
        .status(502)
        .json({ error: "his gateway request failed", message: err.message || String(err) });
    }
    const buffered = db
      .prepare(
        `SELECT
           id, test_name, test_group, value_text, unit,
           ref_range, flag, collected_at, source, updated_at
         FROM his_lab_buffer
         WHERE hn = ?
         ORDER BY COALESCE(collected_at, 0) DESC, id DESC`,
      )
      .all(caseRow.hn);
    rows = buffered;
    source = "BUFFER";
    offline = true;
    hisErrors.gateway = err.message || String(err);
  }

  try {
    db.transaction(() => {
      db.prepare(`DELETE FROM case_his_lab WHERE case_id = ?`).run(caseId);
      const insertLab = db.prepare(
        `INSERT INTO case_his_lab (
           case_id, test_name, test_group, value_text, unit, ref_range, flag,
           collected_at, source, raw_payload, his_updated_at, created_at, updated_at
         )
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const row of rows) {
        insertLab.run(
          caseId,
          row.test_name,
          row.test_group || null,
          row.value_text || null,
          row.unit || null,
          row.ref_range || null,
          row.flag || null,
          row.collected_at || null,
          row.source || source,
          "raw" in row ? JSON.stringify(row.raw || row) : null,
          now,
          now,
          now,
        );
      }

      if (source === "HIS") {
        db.prepare(`DELETE FROM his_lab_buffer WHERE hn = ?`).run(caseRow.hn);
        for (const row of rows) {
          insertHisBufferLabStmt.run(
            caseRow.hn,
            row.test_name,
            row.test_group || null,
            row.value_text || null,
            row.unit || null,
            row.ref_range || null,
            row.flag || null,
            row.collected_at || null,
            row.source || "HIS",
            "raw" in row ? JSON.stringify(row.raw || row) : null,
            now,
            now,
            now,
          );
        }
      }
    })();
  } catch (err) {
    return res.status(500).json({ error: "failed to sync lab", message: err.message });
  }

  return res.json({
    ok: true,
    case_id: caseId,
    hn: caseRow.hn,
    source,
    offline,
    saved: rows.length,
    rows: rows.map(row => {
      if ("raw" in row) {
        const { raw, ...rest } = row;
        return rest;
      }
      return row;
    }),
    his_errors: hisErrors,
  });
});

router.get("/:id/patient", (req, res) => {
  const caseId = Number(req.params.id);
  if (!Number.isFinite(caseId) || caseId <= 0) {
    return res.status(400).json({ error: "invalid case id" });
  }

  const row = db
    .prepare(
      `SELECT
         case_id, hn, an, is_patient, notype, id_card, patient_name,
         title_th, title_en, first_name, last_name, first_name_en, last_name_en,
         sex, dob, age_text, weight_kg, height_cm, blood_group_text, blood_group_abo, blood_group_rh,
         race, ethnicity, religion, marital_status,
         present_address, present_province, legal_address, legal_province,
         mobile, contact_name, contact_tel, relation_desc, nationality,
         source, his_updated_at, updated_at, raw_payload
       FROM case_his_patient
       WHERE case_id = ?`,
    )
    .get(caseId);

  if (!row) {
    const caseRow = db.prepare(`SELECT hn FROM cases WHERE id = ?`).get(caseId);
    if (!caseRow) return res.status(404).json({ error: "case not found" });
    return res.json({ row: { hn: caseRow.hn } });
  }

  let hisPayload = null;
  try {
    hisPayload = row?.raw_payload ? JSON.parse(row.raw_payload) : null;
  } catch {
    hisPayload = null;
  }

  return res.json({
    row: {
      ...row,
      his_payload: hisPayload,
    },
  });
});

router.put("/:id/patient", (req, res) => {
  const caseId = Number(req.params.id);
  if (!Number.isFinite(caseId) || caseId <= 0) {
    return res.status(400).json({ error: "invalid case id" });
  }

  const nextHn = String(req.body?.hn || "").trim();
  if (!nextHn) {
    return res.status(400).json({ error: "hn is required" });
  }

  const caseRow = db.prepare(`SELECT id, hn FROM cases WHERE id = ?`).get(caseId);
  if (!caseRow) {
    return res.status(404).json({ error: "case not found" });
  }

  const now = Date.now();
  const tx = db.transaction(() => {
    db.prepare(`UPDATE cases SET hn = ?, updated_at = ? WHERE id = ?`).run(nextHn, now, caseId);
    db.prepare(`UPDATE case_his_patient SET hn = ?, updated_at = ? WHERE case_id = ?`).run(nextHn, now, caseId);
  });

  tx();

  return res.json({
    ok: true,
    row: {
      case_id: caseId,
      hn: nextHn,
      previous_hn: caseRow.hn,
      updated_at: now,
    },
  });
});

router.get("/:id/allergies", (req, res) => {
  const caseId = Number(req.params.id);
  if (!Number.isFinite(caseId) || caseId <= 0) {
    return res.status(400).json({ error: "invalid case id" });
  }

  const rows = db
    .prepare(
      `SELECT
         id, allergen, reaction, severity, status, source, updated_at
       FROM case_his_allergy
       WHERE case_id = ?
       ORDER BY id ASC`,
    )
    .all(caseId);

  return res.json({ rows });
});

router.post("/:id/allergies", (req, res) => {
  const caseId = Number(req.params.id);
  const { allergen, reaction, severity, status } = req.body;
  if (!Number.isFinite(caseId) || caseId <= 0 || !allergen) {
    return res.status(400).json({ error: "invalid case id or allergen" });
  }

  const now = Date.now();
  const info = db
    .prepare(
      `INSERT INTO case_his_allergy (
         case_id, allergen, reaction, severity, status, source,
         created_at, updated_at, his_updated_at
       ) VALUES (?, ?, ?, ?, ?, 'MANUAL', ?, ?, ?)`,
    )
    .run(
      caseId,
      allergen,
      reaction || null,
      severity || null,
      status || "active",
      now,
      now,
      now,
    );

  return res.json({ id: info.lastInsertRowid });
});

router.put("/:id/allergies/:allergyId", (req, res) => {
  const caseId = Number(req.params.id);
  const allergyId = Number(req.params.allergyId);
  const { allergen, reaction, severity, status } = req.body;

  if (
    !Number.isFinite(caseId) ||
    !Number.isFinite(allergyId) ||
    allergyId <= 0 ||
    !allergen
  ) {
    return res.status(400).json({ error: "invalid input or non-editable record" });
  }

  const now = Date.now();
  const info = db
    .prepare(
      `UPDATE case_his_allergy
       SET allergen = ?, reaction = ?, severity = ?, status = ?, updated_at = ?, his_updated_at = ?
       WHERE id = ? AND case_id = ?`,
    )
    .run(
      allergen,
      reaction || null,
      severity || null,
      status || "active",
      now,
      now,
      allergyId,
      caseId,
    );

  if (info.changes === 0) {
    return res.status(404).json({ error: "allergy not found" });
  }

  return res.json({ ok: true });
});

router.delete("/:id/allergies/:allergyId", (req, res) => {
  const caseId = Number(req.params.id);
  const allergyId = Number(req.params.allergyId);

  if (!Number.isFinite(caseId) || !Number.isFinite(allergyId) || allergyId <= 0) {
    return res.status(400).json({ error: "invalid input or non-deletable record" });
  }

  const info = db
    .prepare(`DELETE FROM case_his_allergy WHERE id = ? AND case_id = ?`)
    .run(allergyId, caseId);

  if (info.changes === 0) {
    return res.status(404).json({ error: "allergy not found" });
  }

  return res.json({ ok: true });
});

router.get("/:id/labs", (req, res) => {
  const caseId = Number(req.params.id);
  if (!Number.isFinite(caseId) || caseId <= 0) {
    return res.status(400).json({ error: "invalid case id" });
  }

  const fromTs = Number(req.query.from);
  const toTs = Number(req.query.to);
  const requestedLimit = Number(req.query.limit);
  const limit = Number.isFinite(requestedLimit)
    ? Math.max(1, Math.min(1000, Math.trunc(requestedLimit)))
    : 500;

  const filters = ["case_id = @caseId"];
  const params = { caseId, limit };
  if (Number.isFinite(fromTs)) {
    filters.push("COALESCE(collected_at, 0) >= @fromTs");
    params.fromTs = fromTs;
  }
  if (Number.isFinite(toTs)) {
    filters.push("COALESCE(collected_at, 0) <= @toTs");
    params.toTs = toTs;
  }

  const rows = db
    .prepare(
      `SELECT
         id, test_name, test_group, value_text, unit,
         ref_range, flag, collected_at, source, updated_at
       FROM case_his_lab
       WHERE ${filters.join(" AND ")}
       ORDER BY COALESCE(collected_at, 0) DESC, id DESC
       LIMIT @limit`,
    )
    .all(params);

  return res.json({ rows });
});

/* =======================
   ICD10 SEARCH (GLOBAL)
======================= */
router.get("/icd10/search", (req, res) => {
  const q = String(req.query.q || "").trim();
  const requestedLimit = Number(req.query.limit);
  const limit = Number.isFinite(requestedLimit)
    ? Math.max(1, Math.min(200, Math.trunc(requestedLimit)))
    : 40;

  if (!q) {
    return res.json({ query: "", rows: [] });
  }

  const normalizedText = q
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  const tokens = normalizedText
    .split(" ")
    .map(token => token.trim())
    .filter(token => token.length >= 2)
    .slice(0, 8);

  const codeQuery = q.toUpperCase().replace(/\s+/g, "");
  if (!normalizedText && !/[A-Z0-9]/.test(codeQuery)) {
    return res.json({ query: q, rows: [] });
  }
  const codePrefix = `${codeQuery}%`;
  const textPrefix = `${normalizedText}%`;
  const textLike = `%${normalizedText}%`;

  const params = {
    codeQuery,
    codePrefix,
    textPrefix,
    textLike,
    limit,
  };

  const tokenWhereParts = [];
  const tokenScoreParts = [];

  tokens.forEach((token, index) => {
    const likeKey = `tokLike${index}`;
    const startsKey = `tokStarts${index}`;
    params[likeKey] = `%${token}%`;
    params[startsKey] = `${token}%`;

    tokenWhereParts.push(
      `lower(COALESCE(name_en, '')) LIKE @${likeKey}
       OR lower(COALESCE(name_th, '')) LIKE @${likeKey}
       OR lower(icd10) LIKE @${likeKey}
       OR lower(icd10who) LIKE @${likeKey}`,
    );

    tokenScoreParts.push(
      `CASE
         WHEN lower(COALESCE(name_en, '')) LIKE @${startsKey}
           OR lower(COALESCE(name_th, '')) LIKE @${startsKey}
         THEN 6
         WHEN lower(COALESCE(name_en, '')) LIKE @${likeKey}
           OR lower(COALESCE(name_th, '')) LIKE @${likeKey}
         THEN 4
         WHEN lower(icd10) LIKE @${likeKey}
           OR lower(icd10who) LIKE @${likeKey}
         THEN 5
         ELSE 0
       END`,
    );

    // Acronym-friendly fallback for shorthand input (e.g., CRLM/PTD).
    if (/^[a-z]{3,8}$/.test(token)) {
      const acronymKey = `tokAcronym${index}`;
      params[acronymKey] = `%${token.split("").join("%")}%`;
      tokenWhereParts.push(`lower(COALESCE(name_en, '')) LIKE @${acronymKey}`);
      tokenScoreParts.push(
        `CASE
           WHEN lower(COALESCE(name_en, '')) LIKE @${acronymKey}
           THEN 2
           ELSE 0
         END`,
      );
    }
  });

  const whereTokens = tokenWhereParts.length
    ? ` OR (${tokenWhereParts.map(p => `(${p})`).join(" OR ")})`
    : "";
  const tokenScoreExpr = tokenScoreParts.length
    ? ` + (${tokenScoreParts.join(" + ")})`
    : "";

  const sql = `
    SELECT
      icd10,
      icd10who,
      diagseq,
      name_en,
      name_th,
      extcause,
      mcode,
      ca,
      (
        CASE
          WHEN icd10 = @codeQuery THEN 1000
          WHEN icd10who = @codeQuery THEN 980
          WHEN icd10 LIKE @codePrefix THEN 940
          WHEN icd10who LIKE @codePrefix THEN 920
          WHEN lower(COALESCE(name_en, '')) LIKE @textPrefix THEN 900
          WHEN lower(COALESCE(name_th, '')) LIKE @textPrefix THEN 880
          WHEN lower(COALESCE(name_en, '')) LIKE @textLike THEN 820
          WHEN lower(COALESCE(name_th, '')) LIKE @textLike THEN 800
          ELSE 0
        END
        ${tokenScoreExpr}
      ) AS score
    FROM icd10_master
    WHERE
      (
        upper(substr(trim(COALESCE(icd10, '')), 1, 1)) GLOB '[A-Z]'
        OR upper(substr(trim(COALESCE(icd10who, '')), 1, 1)) GLOB '[A-Z]'
      )
      AND (
        icd10 LIKE @codePrefix
        OR icd10who LIKE @codePrefix
        OR lower(COALESCE(name_en, '')) LIKE @textLike
        OR lower(COALESCE(name_th, '')) LIKE @textLike
        ${whereTokens}
      )
    ORDER BY
      score DESC,
      icd10 ASC
    LIMIT @limit
  `;

  const rows = db.prepare(sql).all(params);

  res.json({
    query: q,
    rows,
  });
});

router.get("/icd9/search", (req, res) => {
  const q = String(req.query.q || "").trim();
  if (!q) {
    return res.json({ query: q, rows: [] });
  }

  const requestedLimit = Number(req.query.limit);
  const limit = Number.isFinite(requestedLimit)
    ? Math.max(1, Math.min(50, Math.trunc(requestedLimit)))
    : 20;

  const codeQuery = q.replace(/[\s.]+/g, "");
  const textQuery = q.toLowerCase();
  const textLike = `%${textQuery}%`;
  const textPrefix = `${textQuery}%`;
  const codePrefix = `${codeQuery}%`;

  const rows = db.prepare(
    `SELECT
       icd9cm,
       short_name_en,
       name_en,
       (
         CASE
           WHEN icd9cm = @codeQuery THEN 1000
           WHEN icd9cm LIKE @codePrefix THEN 920
           WHEN lower(COALESCE(name_en, '')) LIKE @textPrefix THEN 900
           WHEN lower(COALESCE(short_name_en, '')) LIKE @textPrefix THEN 880
           WHEN lower(COALESCE(name_en, '')) LIKE @textLike THEN 820
           WHEN lower(COALESCE(short_name_en, '')) LIKE @textLike THEN 800
           ELSE 0
         END
       ) AS score
     FROM icd9cm_master
     WHERE
       icd9cm LIKE @codePrefix
       OR lower(COALESCE(name_en, '')) LIKE @textLike
       OR lower(COALESCE(short_name_en, '')) LIKE @textLike
     ORDER BY
       score DESC,
       icd9cm ASC
     LIMIT @limit`
  ).all({
    codeQuery,
    codePrefix,
    textLike,
    textPrefix,
    limit,
  });

  res.json({ query: q, rows });
});

/* =======================
   CASE DIAGNOSIS
======================= */
router.get("/:id/diagnosis", (req, res) => {
  const caseId = Number(req.params.id);
  if (!Number.isFinite(caseId)) {
    return res.status(400).json({ error: "invalid case id" });
  }

  const rows = db
    .prepare(
      `SELECT
         d.id,
         d.diagnosis_text,
         CASE
           WHEN upper(COALESCE(d.icd_version, '')) = 'ICD-10'
             THEN COALESCE(NULLIF(m.name_en, ''), NULLIF(m.name_th, ''), d.icd_text)
           ELSE d.icd_text
         END AS icd_text,
         d.icd_code,
         d.icd_version,
         d.seq,
         d.created_at
       FROM case_diagnosis d
       LEFT JOIN icd10_master m
         ON (m.icd10 = d.icd_code OR m.icd10who = d.icd_code)
       WHERE d.case_id = ?
       ORDER BY d.seq ASC, d.id ASC`
    )
    .all(caseId);

  res.json({ case_id: caseId, rows });
});

router.post("/:id/diagnosis", (req, res) => {
  const caseId = Number(req.params.id);
  if (!Number.isFinite(caseId)) {
    return res.status(400).json({ error: "invalid case id" });
  }

  const diagnosisText = String(req.body?.diagnosis_text || "").trim();
  if (!diagnosisText) {
    return res.status(400).json({ error: "diagnosis_text required" });
  }

  const seqRaw = Number(req.body?.seq);
  const seq = Number.isFinite(seqRaw) && seqRaw > 0 ? Math.trunc(seqRaw) : 1;
  const icdCode = normalizeIcdCode(req.body?.icd_code);
  const icdVersion = icdCode
    ? normalizeNullableText(req.body?.icd_version) || "ICD-10"
    : normalizeNullableText(req.body?.icd_version);
  const icdText =
    isLikelyIcd10Code(icdCode) && String(icdVersion || "").toUpperCase() === "ICD-10"
      ? resolveIcd10Text(icdCode, req.body?.icd_text)
      : normalizeNullableText(req.body?.icd_text);
  const now = Date.now();

  const info = db
    .prepare(
      `INSERT INTO case_diagnosis
        (case_id, diagnosis_text, icd_text, icd_code, icd_version, seq, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(caseId, diagnosisText, icdText, icdCode, icdVersion, seq, now);

  const row = db
    .prepare(
      `SELECT
         d.id,
         d.diagnosis_text,
         CASE
           WHEN upper(COALESCE(d.icd_version, '')) = 'ICD-10'
             THEN COALESCE(NULLIF(m.name_en, ''), NULLIF(m.name_th, ''), d.icd_text)
           ELSE d.icd_text
         END AS icd_text,
         d.icd_code,
         d.icd_version,
         d.seq,
         d.created_at
       FROM case_diagnosis d
       LEFT JOIN icd10_master m
         ON (m.icd10 = d.icd_code OR m.icd10who = d.icd_code)
       WHERE d.id = ?`
    )
    .get(info.lastInsertRowid);

  res.json({ ok: true, row });
});

router.put("/:id/diagnosis/:diagId", (req, res) => {
  const caseId = Number(req.params.id);
  const diagId = Number(req.params.diagId);
  if (!Number.isFinite(caseId) || !Number.isFinite(diagId)) {
    return res.status(400).json({ error: "invalid id" });
  }

  const current = db
    .prepare(
      `SELECT *
       FROM case_diagnosis
       WHERE id = ? AND case_id = ?`
    )
    .get(diagId, caseId);
  if (!current) {
    return res.status(404).json({ error: "diagnosis not found" });
  }

  const nextText =
    req.body?.diagnosis_text == null
      ? current.diagnosis_text
      : String(req.body.diagnosis_text).trim();
  if (!nextText) {
    return res.status(400).json({ error: "diagnosis_text required" });
  }

  const nextIcdCode =
    req.body?.icd_code == null
      ? current.icd_code
      : normalizeIcdCode(req.body.icd_code);
  const nextIcdVersion =
    req.body?.icd_version == null
      ? current.icd_version
      : normalizeNullableText(req.body.icd_version);
  const nextIcdText =
    isLikelyIcd10Code(nextIcdCode) && String(nextIcdVersion || "").toUpperCase() === "ICD-10"
      ? resolveIcd10Text(
          nextIcdCode,
          req.body?.icd_text == null ? current.icd_text : req.body.icd_text,
        )
      : (
          req.body?.icd_text == null
            ? current.icd_text
            : normalizeNullableText(req.body.icd_text)
        );
  const seqRaw = Number(req.body?.seq);
  const nextSeq =
    req.body?.seq == null
      ? current.seq
      : Number.isFinite(seqRaw) && seqRaw > 0
        ? Math.trunc(seqRaw)
        : current.seq;

  db.prepare(
    `UPDATE case_diagnosis
     SET diagnosis_text = ?,
         icd_text = ?,
         icd_code = ?,
         icd_version = ?,
         seq = ?
     WHERE id = ?`
  ).run(nextText, nextIcdText, nextIcdCode, nextIcdVersion, nextSeq, diagId);

  const row = db
    .prepare(
      `SELECT
         d.id,
         d.diagnosis_text,
         CASE
           WHEN upper(COALESCE(d.icd_version, '')) = 'ICD-10'
             THEN COALESCE(NULLIF(m.name_en, ''), NULLIF(m.name_th, ''), d.icd_text)
           ELSE d.icd_text
         END AS icd_text,
         d.icd_code,
         d.icd_version,
         d.seq,
         d.created_at
       FROM case_diagnosis d
       LEFT JOIN icd10_master m
         ON (m.icd10 = d.icd_code OR m.icd10who = d.icd_code)
       WHERE d.id = ?`
    )
    .get(diagId);

  res.json({ ok: true, row });
});

router.delete("/:id/diagnosis/:diagId", (req, res) => {
  const caseId = Number(req.params.id);
  const diagId = Number(req.params.diagId);
  if (!Number.isFinite(caseId) || !Number.isFinite(diagId)) {
    return res.status(400).json({ error: "invalid id" });
  }

  const result = db
    .prepare(`DELETE FROM case_diagnosis WHERE id = ? AND case_id = ?`)
    .run(diagId, caseId);
  if (!result.changes) {
    return res.status(404).json({ error: "diagnosis not found" });
  }

  res.json({ ok: true });
});

/* =======================
   CASE PROCEDURE (OPERATION)
======================= */
router.get("/:id/procedures", (req, res) => {
  const caseId = Number(req.params.id);
  if (!Number.isFinite(caseId)) {
    return res.status(400).json({ error: "invalid case id" });
  }

  const rows = db
    .prepare(
      `SELECT
         p.id,
         p.procedure_text,
         CASE
           WHEN upper(COALESCE(p.icd_version, '')) = 'ICD-9'
             THEN COALESCE(NULLIF(m.name_en, ''), p.icd_text)
           ELSE p.icd_text
         END AS icd_text,
         p.icd_code,
         p.icd_version,
         p.seq,
         p.created_at
       FROM case_procedure p
       LEFT JOIN icd9cm_master m
         ON m.icd9cm = replace(replace(COALESCE(p.icd_code, ''), '.', ''), ' ', '')
       WHERE p.case_id = ?
       ORDER BY seq ASC, id ASC`
    )
    .all(caseId);

  res.json({ case_id: caseId, rows });
});

router.post("/:id/procedures", (req, res) => {
  const caseId = Number(req.params.id);
  if (!Number.isFinite(caseId)) {
    return res.status(400).json({ error: "invalid case id" });
  }

  const procedureText = String(req.body?.procedure_text || "").trim();
  if (!procedureText) {
    return res.status(400).json({ error: "procedure_text required" });
  }

  const seqRaw = Number(req.body?.seq);
  const seq = Number.isFinite(seqRaw) && seqRaw > 0 ? Math.trunc(seqRaw) : 1;
  const icdCode = normalizeIcd9ProcedureCode(req.body?.icd_code);
  const icdVersion = icdCode
    ? normalizeNullableText(req.body?.icd_version) || "ICD-9"
    : normalizeNullableText(req.body?.icd_version);
  const icdText =
    isLikelyIcd9ProcedureCode(icdCode) && String(icdVersion || "").toUpperCase() === "ICD-9"
      ? resolveIcd9ProcedureText(icdCode, req.body?.icd_text)
      : normalizeNullableText(req.body?.icd_text);
  const now = Date.now();

  const info = db
    .prepare(
      `INSERT INTO case_procedure
        (case_id, procedure_text, icd_text, icd_code, icd_version, seq, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(caseId, procedureText, icdText, icdCode, icdVersion, seq, now);

  const row = db
    .prepare(
      `SELECT
         p.id,
         p.procedure_text,
         CASE
           WHEN upper(COALESCE(p.icd_version, '')) = 'ICD-9'
             THEN COALESCE(NULLIF(m.name_en, ''), p.icd_text)
           ELSE p.icd_text
         END AS icd_text,
         p.icd_code,
         p.icd_version,
         p.seq,
         p.created_at
       FROM case_procedure p
       LEFT JOIN icd9cm_master m
         ON m.icd9cm = replace(replace(COALESCE(p.icd_code, ''), '.', ''), ' ', '')
       WHERE p.id = ?`
    )
    .get(info.lastInsertRowid);

  res.json({ ok: true, row });
});

router.put("/:id/procedures/:procedureId", (req, res) => {
  const caseId = Number(req.params.id);
  const procedureId = Number(req.params.procedureId);
  if (!Number.isFinite(caseId) || !Number.isFinite(procedureId)) {
    return res.status(400).json({ error: "invalid id" });
  }

  const current = db
    .prepare(
      `SELECT *
       FROM case_procedure
       WHERE id = ? AND case_id = ?`
    )
    .get(procedureId, caseId);
  if (!current) {
    return res.status(404).json({ error: "procedure not found" });
  }

  const nextText =
    req.body?.procedure_text == null
      ? current.procedure_text
      : String(req.body.procedure_text).trim();
  if (!nextText) {
    return res.status(400).json({ error: "procedure_text required" });
  }

  const nextIcdText =
    isLikelyIcd9ProcedureCode(
      req.body?.icd_code == null ? current.icd_code : req.body.icd_code
    ) &&
    String(
      req.body?.icd_version == null ? current.icd_version : req.body.icd_version
    ).toUpperCase() === "ICD-9"
      ? resolveIcd9ProcedureText(
          req.body?.icd_code == null ? current.icd_code : req.body.icd_code,
          req.body?.icd_text == null ? current.icd_text : req.body.icd_text
        )
      : req.body?.icd_text == null
        ? current.icd_text
        : normalizeNullableText(req.body.icd_text);
  const nextIcdCode =
    req.body?.icd_code == null
      ? current.icd_code
      : normalizeIcd9ProcedureCode(req.body.icd_code);
  const nextIcdVersion =
    req.body?.icd_version == null
      ? current.icd_version
      : normalizeNullableText(req.body.icd_version);
  const seqRaw = Number(req.body?.seq);
  const nextSeq =
    req.body?.seq == null
      ? current.seq
      : Number.isFinite(seqRaw) && seqRaw > 0
        ? Math.trunc(seqRaw)
        : current.seq;

  db.prepare(
    `UPDATE case_procedure
     SET procedure_text = ?,
         icd_text = ?,
         icd_code = ?,
         icd_version = ?,
         seq = ?
     WHERE id = ?`
  ).run(nextText, nextIcdText, nextIcdCode, nextIcdVersion, nextSeq, procedureId);

  const row = db
    .prepare(
      `SELECT
         p.id,
         p.procedure_text,
         CASE
           WHEN upper(COALESCE(p.icd_version, '')) = 'ICD-9'
             THEN COALESCE(NULLIF(m.name_en, ''), p.icd_text)
           ELSE p.icd_text
         END AS icd_text,
         p.icd_code,
         p.icd_version,
         p.seq,
         p.created_at
       FROM case_procedure p
       LEFT JOIN icd9cm_master m
         ON m.icd9cm = replace(replace(COALESCE(p.icd_code, ''), '.', ''), ' ', '')
       WHERE p.id = ?`
    )
    .get(procedureId);

  res.json({ ok: true, row });
});

router.delete("/:id/procedures/:procedureId", (req, res) => {
  const caseId = Number(req.params.id);
  const procedureId = Number(req.params.procedureId);
  if (!Number.isFinite(caseId) || !Number.isFinite(procedureId)) {
    return res.status(400).json({ error: "invalid id" });
  }

  const result = db
    .prepare(`DELETE FROM case_procedure WHERE id = ? AND case_id = ?`)
    .run(procedureId, caseId);
  if (!result.changes) {
    return res.status(404).json({ error: "procedure not found" });
  }

  res.json({ ok: true });
});

/* =======================
   STAFF ROLE (GLOBAL)
======================= */
router.get("/staff/roles", (req, res) => {
  const rows = db
    .prepare(
      `SELECT
         id,
         display_name AS name,
         sort_order
       FROM staff_role
       ORDER BY sort_order ASC, id ASC`
    )
    .all();

  res.json({ rows });
});

/* =======================
   STAFF DIRECTORY LIST (GLOBAL)
======================= */
router.get("/staff/directory", (req, res) => {
  const requestedLimit = Number(req.query.limit);
  const limit = Number.isFinite(requestedLimit)
    ? Math.max(1, Math.min(500, requestedLimit))
    : 200;
  const includeInactive =
    String(req.query.include_inactive || "").toLowerCase() === "true";
  const roleIdFilter = String(req.query.role_id || "").trim();
  const keyword = String(req.query.q || "").trim().toLowerCase();
  const keywordLike = `%${keyword}%`;

  const rows = db
    .prepare(
      `SELECT
         id,
         hospital_id,
         personal_id,
         email,
         th_first_name,
         th_last_name,
         en_first_name,
         en_last_name,
         innovian_id,
         staff_role_id AS role_id,
         staff_name AS name,
         staff_role AS role,
         entry_year,
         is_active,
         used_count,
         last_used_at,
         created_at,
         updated_at
       FROM staff_directory
       WHERE (? = 1 OR is_active = 1)
         AND (? = '' OR staff_role_id = ?)
         AND (
           ? = ''
           OR lower(staff_name) LIKE ?
           OR lower(COALESCE(hospital_id, '')) LIKE ?
           OR lower(COALESCE(email, '')) LIKE ?
           OR lower(COALESCE(th_first_name, '')) LIKE ?
           OR lower(COALESCE(th_last_name, '')) LIKE ?
         )
       ORDER BY is_active DESC, last_used_at DESC, used_count DESC, staff_name ASC
       LIMIT ?`
    )
    .all(
      includeInactive ? 1 : 0,
      roleIdFilter,
      roleIdFilter,
      keyword,
      keywordLike,
      keywordLike,
      keywordLike,
      keywordLike,
      keywordLike,
      limit,
    );

  res.json({ rows });
});

/* =======================
   STAFF DIRECTORY UPSERT (GLOBAL)
======================= */
router.post("/staff/directory", (req, res) => {
  const normalized = normalizeStaffList([req.body?.staff || req.body]);
  if (normalized.length === 0) {
    return res.status(400).json({ error: "invalid staff payload" });
  }

  const input = normalized[0];
  const actorUsername =
    String(req.body?.actor?.username || "").trim() || "unknown";

  const findByHospitalId = db.prepare(
    `SELECT id FROM staff_directory
     WHERE hospital_id = ?
     LIMIT 1`
  );
  const findByEmail = db.prepare(
    `SELECT id FROM staff_directory
     WHERE lower(email) = lower(?)
     LIMIT 1`
  );
  const findByNameRole = db.prepare(
    `SELECT id FROM staff_directory
     WHERE staff_name = ? AND staff_role_id = ?
     LIMIT 1`
  );

  const insertRow = db.prepare(
    `INSERT INTO staff_directory
      (
        hospital_id, personal_id, email,
        th_first_name, th_last_name, en_first_name, en_last_name,
        innovian_id, staff_role_id, entry_year, staff_name, staff_role,
        is_active, used_count, last_used_at, created_at, updated_at
      )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 0, ?, ?, ?)`
  );

  const updateRow = db.prepare(
    `UPDATE staff_directory
      SET hospital_id = ?,
          personal_id = ?,
          email = ?,
          th_first_name = ?,
          th_last_name = ?,
          en_first_name = ?,
          en_last_name = ?,
          innovian_id = ?,
          staff_role_id = ?,
          entry_year = ?,
          staff_name = ?,
          staff_role = ?,
          is_active = 1,
          updated_at = ?
      WHERE id = ?`
  );

  const selectById = db.prepare(
    `SELECT
       id,
       hospital_id,
       personal_id,
       email,
       th_first_name,
       th_last_name,
       en_first_name,
       en_last_name,
       innovian_id,
       staff_role_id AS role_id,
       staff_name AS name,
       staff_role AS role,
       entry_year,
       is_active,
       used_count,
       last_used_at,
       created_at,
       updated_at
     FROM staff_directory
     WHERE id = ?`
  );

  const tx = db.transaction(() => {
    const now = Date.now();
    const normalizedHospitalId = String(input.hospitalId || input.personalId || "").trim();
    const normalizedPersonalId = String(input.personalId || input.hospitalId || "").trim();
    let existing =
      (normalizedHospitalId && findByHospitalId.get(normalizedHospitalId)) ||
      (input.email && findByEmail.get(input.email)) ||
      findByNameRole.get(input.name, input.roleId);

    if (!existing) {
      const info = insertRow.run(
        normalizedHospitalId,
        normalizedPersonalId,
        input.email,
        input.thFirstName,
        input.thLastName,
        input.enFirstName,
        input.enLastName,
        input.innovianId,
        input.roleId,
        input.entryYear,
        input.name,
        input.role,
        now,
        now,
        now,
      );
      return selectById.get(Number(info.lastInsertRowid));
    }

    const row = selectById.get(existing.id);
    updateRow.run(
      normalizedHospitalId || row.hospital_id || row.personal_id,
      normalizedPersonalId || row.personal_id || row.hospital_id,
      input.email || row.email,
      input.thFirstName || row.th_first_name,
      input.thLastName || row.th_last_name,
      input.enFirstName || row.en_first_name,
      input.enLastName || row.en_last_name,
      input.innovianId || row.innovian_id,
      input.roleId || row.role_id,
      input.entryYear || row.entry_year,
      input.name || row.name,
      input.role || row.role,
      now,
      existing.id,
    );

    return selectById.get(existing.id);
  });

  try {
    const row = tx();
    res.json({
      ok: true,
      actor: actorUsername,
      row,
    });
  } catch (err) {
    res.status(400).json({ error: err.message || "directory save failed" });
  }
});

/* =======================
   STAFF DIRECTORY UPDATE (GLOBAL)
======================= */
router.put("/staff/directory/:entryId", (req, res) => {
  const entryId = Number(req.params.entryId);
  if (!Number.isFinite(entryId)) {
    return res.status(400).json({ error: "invalid entry id" });
  }

  const current = db
    .prepare(`SELECT * FROM staff_directory WHERE id = ?`)
    .get(entryId);
  if (!current) return res.status(404).json({ error: "not found" });

  const normalized = normalizeStaffList([{ ...current, ...(req.body?.staff || req.body) }]);
  if (normalized.length === 0) {
    return res.status(400).json({ error: "invalid staff payload" });
  }
  const input = normalized[0];
  const now = Date.now();
  const normalizedHospitalId = String(input.hospitalId || input.personalId || current.hospital_id || current.personal_id || "").trim();
  const normalizedPersonalId = String(input.personalId || input.hospitalId || current.personal_id || current.hospital_id || "").trim();

  db.prepare(
    `UPDATE staff_directory
      SET hospital_id = ?,
          personal_id = ?,
          email = ?,
          th_first_name = ?,
          th_last_name = ?,
          en_first_name = ?,
          en_last_name = ?,
          innovian_id = ?,
          staff_role_id = ?,
          entry_year = ?,
          staff_name = ?,
          staff_role = ?,
          is_active = ?,
          updated_at = ?
      WHERE id = ?`
  ).run(
    normalizedHospitalId,
    normalizedPersonalId,
    input.email,
    input.thFirstName,
    input.thLastName,
    input.enFirstName,
    input.enLastName,
    input.innovianId,
    input.roleId,
    input.entryYear,
    input.name,
    input.role,
    req.body?.is_active === 0
      ? 0
      : req.body?.is_active === 1
        ? 1
        : current.is_active,
    now,
    entryId,
  );

  const row = db
    .prepare(
      `SELECT
         id,
         hospital_id,
         personal_id,
         email,
         th_first_name,
         th_last_name,
         en_first_name,
         en_last_name,
         innovian_id,
         staff_role_id AS role_id,
         staff_name AS name,
         staff_role AS role,
         entry_year,
         is_active,
         used_count,
         last_used_at,
         created_at,
         updated_at
       FROM staff_directory
       WHERE id = ?`
    )
    .get(entryId);

  res.json({ ok: true, row });
});

/* =======================
   STAFF DIRECTORY DEACTIVATE (GLOBAL)
======================= */
router.delete("/staff/directory/:entryId", (req, res) => {
  const entryId = Number(req.params.entryId);
  if (!Number.isFinite(entryId)) {
    return res.status(400).json({ error: "invalid entry id" });
  }

  const now = Date.now();
  const result = db
    .prepare(
      `UPDATE staff_directory
       SET is_active = 0, updated_at = ?
       WHERE id = ?`
    )
    .run(now, entryId);

  if (!result.changes) return res.status(404).json({ error: "not found" });
  res.json({ ok: true, deactivated: 1 });
});

/* =======================
   STAFF LIBRARY (ACTIVE)
======================= */
router.get("/staff/library", (req, res) => {
  const requestedLimit = Number(req.query.limit);
  const limit = Number.isFinite(requestedLimit)
    ? Math.max(1, Math.min(200, requestedLimit))
    : 50;

  const rows = db
    .prepare(
      `SELECT
         hospital_id,
         personal_id,
         email,
         th_first_name,
         th_last_name,
         en_first_name,
         en_last_name,
         innovian_id,
         staff_role_id AS role_id,
         staff_name AS name,
         staff_role AS role,
         entry_year,
         is_active,
         used_count,
         last_used_at
       FROM staff_directory
       WHERE is_active = 1
       ORDER BY last_used_at DESC, used_count DESC, staff_name ASC
       LIMIT ?`
    )
    .all(limit);

  res.json({ rows });
});

/* =======================
   MY CASES (by hospital_id)
======================= */
router.get("/staff/my-cases", (req, res) => {
  const hospitalId = String(req.query.hospital_id || "").trim();
  const personalId = String(req.query.personal_id || "").trim();
  const email = String(req.query.email || "").trim().toLowerCase();

  if (!hospitalId && !personalId && !email) {
    return res.status(400).json({ error: "at least one of hospital_id, personal_id, email required" });
  }

  const conditions = [];
  const params = [];
  if (hospitalId) { conditions.push("cs.hospital_id = ?"); params.push(hospitalId); }
  if (personalId) { conditions.push("cs.personal_id = ?"); params.push(personalId); }
  if (email)      { conditions.push("lower(cs.email) = ?"); params.push(email); }

  const rows = db
    .prepare(
      `SELECT DISTINCT
         c.id,
         c.case_code,
         c.hn,
         c.start_time,
         c.discharge_time,
         c.status,
         cs.staff_role,
         cs.staff_name
       FROM case_staff cs
       JOIN cases c ON c.id = cs.case_id
       WHERE ${conditions.join(" OR ")}
       ORDER BY c.start_time DESC
       LIMIT 200`
    )
    .all(...params);

  res.json({ rows });
});

/* =======================
   IO MASTER LIST (GLOBAL)
======================= */
router.get("/io/master", (req, res) => {
  const kind = parseIoKind(req.query.kind) || "med";
  const requestedLimit = Number(req.query.limit);
  const limit = Number.isFinite(requestedLimit)
    ? Math.max(1, Math.min(500, Math.floor(requestedLimit)))
    : 300;
  const includeInactive =
    String(req.query.include_inactive || "").toLowerCase() === "true";
  const keyword = String(req.query.q || "").trim().toLowerCase();
  const keywordLike = `%${keyword}%`;

  const rows = db
    .prepare(
      `SELECT
         id,
         kind,
         code,
         name,
         default_unit,
         category,
         usage_score,
         usage_rank,
         is_active,
         created_at,
         updated_at
       FROM io_item_master
       WHERE kind = ?
         AND (? = 1 OR is_active = 1)
         AND (
           ? = ''
           OR lower(code) LIKE ?
           OR lower(name) LIKE ?
           OR lower(COALESCE(category, '')) LIKE ?
           OR lower(COALESCE(default_unit, '')) LIKE ?
         )
       ORDER BY
         is_active DESC,
         COALESCE(usage_rank, 999999) ASC,
         usage_score DESC,
         name ASC,
         code ASC
       LIMIT ?`
    )
    .all(
      kind,
      includeInactive ? 1 : 0,
      keyword,
      keywordLike,
      keywordLike,
      keywordLike,
      keywordLike,
      limit,
    );

  res.json({ rows });
});

/* =======================
   IO MASTER CREATE (GLOBAL)
======================= */
router.post("/io/master", (req, res) => {
  const kind = parseIoKind(req.body?.kind) || "med";
  const name = String(req.body?.name || "").trim();
  if (!name) return res.status(400).json({ error: "name required" });

  const defaultUnit = String(req.body?.default_unit || "").trim() || "ml";
  const category = String(req.body?.category || "").trim() || null;
  const isActive = parseBooleanFlag(req.body?.is_active, true) ? 1 : 0;

  const codeCandidate = buildIoCodeCandidate(req.body?.code, name);
  if (!codeCandidate) {
    return res.status(400).json({ error: "code or valid name required" });
  }
  const code = ensureUniqueIoCode(codeCandidate, null);

  const now = Date.now();
  try {
    const info = db
      .prepare(
        `INSERT INTO io_item_master
          (kind, code, name, default_unit, category, is_active, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(kind, code, name, defaultUnit, category, isActive, now, now);

    const row = db
      .prepare(
        `SELECT
           id,
           kind,
           code,
           name,
           default_unit,
           category,
           usage_score,
           usage_rank,
           is_active,
           created_at,
           updated_at
         FROM io_item_master
         WHERE id = ?`
      )
      .get(Number(info.lastInsertRowid));

    res.json({ ok: true, row });
  } catch (err) {
    res.status(400).json({ error: err.message || "io master create failed" });
  }
});

/* =======================
   IO MASTER UPDATE (GLOBAL)
======================= */
router.put("/io/master/:itemId", (req, res) => {
  const itemId = Number(req.params.itemId);
  if (!Number.isFinite(itemId)) {
    return res.status(400).json({ error: "invalid item id" });
  }

  const current = db
    .prepare(`SELECT * FROM io_item_master WHERE id = ?`)
    .get(itemId);
  if (!current) return res.status(404).json({ error: "not found" });

  const kind = parseIoKind(req.body?.kind) || current.kind;
  const name =
    req.body?.name === undefined
      ? current.name
      : String(req.body?.name || "").trim();
  if (!name) return res.status(400).json({ error: "name required" });

  const defaultUnit =
    req.body?.default_unit === undefined
      ? current.default_unit
      : String(req.body?.default_unit || "").trim() || "ml";
  const category =
    req.body?.category === undefined
      ? current.category
      : String(req.body?.category || "").trim() || null;

  const codeInput =
    req.body?.code === undefined ? current.code : String(req.body?.code || "");
  const codeCandidate = buildIoCodeCandidate(codeInput, name);
  if (!codeCandidate) {
    return res.status(400).json({ error: "code or valid name required" });
  }
  const code = ensureUniqueIoCode(codeCandidate, itemId);

  const isActive =
    req.body?.is_active === undefined
      ? current.is_active
      : parseBooleanFlag(req.body?.is_active, true)
        ? 1
        : 0;
  const now = Date.now();

  try {
    db.prepare(
      `UPDATE io_item_master
       SET kind = ?,
           code = ?,
           name = ?,
           default_unit = ?,
           category = ?,
           is_active = ?,
           updated_at = ?
       WHERE id = ?`
    ).run(kind, code, name, defaultUnit, category, isActive, now, itemId);

    const row = db
      .prepare(
        `SELECT
           id,
           kind,
           code,
           name,
           default_unit,
           category,
           usage_score,
           usage_rank,
           is_active,
           created_at,
           updated_at
         FROM io_item_master
         WHERE id = ?`
      )
      .get(itemId);
    res.json({ ok: true, row });
  } catch (err) {
    res.status(400).json({ error: err.message || "io master update failed" });
  }
});

/* =======================
   IO MASTER DEACTIVATE (GLOBAL)
======================= */
router.delete("/io/master/:itemId", (req, res) => {
  const itemId = Number(req.params.itemId);
  if (!Number.isFinite(itemId)) {
    return res.status(400).json({ error: "invalid item id" });
  }

  const now = Date.now();
  const result = db
    .prepare(
      `UPDATE io_item_master
       SET is_active = 0, updated_at = ?
       WHERE id = ?`
    )
    .run(now, itemId);
  if (!result.changes) return res.status(404).json({ error: "not found" });

  res.json({ ok: true, deactivated: 1 });
});

/* =======================
   CASE STAFF LIST
======================= */
router.get("/:id/staff", (req, res) => {
  const caseId = Number(req.params.id);
  if (!Number.isFinite(caseId)) {
    return res.status(400).json({ error: "invalid case id" });
  }

  const caseRow = db.prepare(`SELECT id FROM cases WHERE id=?`).get(caseId);
  if (!caseRow) return res.status(404).json({ error: "not found" });

  const rows = db
    .prepare(
       `SELECT
         id,
         hospital_id,
         personal_id,
         email,
         th_first_name,
         th_last_name,
         en_first_name,
         en_last_name,
         innovian_id,
         staff_role_id AS role_id,
         staff_name AS name,
         staff_role AS role,
         entry_year,
         seq
       FROM case_staff
       WHERE case_id = ?
       ORDER BY seq ASC, id ASC`
    )
    .all(caseId);

  res.json({
    case_id: caseId,
    rows,
  });
});

/* =======================
   CASE STAFF REPLACE
======================= */
router.put("/:id/staff", (req, res) => {
  const caseId = Number(req.params.id);
  if (!Number.isFinite(caseId)) {
    return res.status(400).json({ error: "invalid case id" });
  }

  const caseRow = db.prepare(`SELECT id FROM cases WHERE id=?`).get(caseId);
  if (!caseRow) return res.status(404).json({ error: "not found" });

  const staff = normalizeStaffList(req.body?.staff);
  if (staff.length > 200) {
    return res.status(400).json({ error: "too many staff rows" });
  }

  const actorUsername =
    String(req.body?.actor?.username || "").trim() || "unknown";

  const clearCaseStaff = db.prepare(
    `DELETE FROM case_staff WHERE case_id = ?`
  );
  const insertCaseStaff = db.prepare(
    `INSERT INTO case_staff
      (
        case_id,
        hospital_id,
        personal_id,
        email,
        th_first_name,
        th_last_name,
        en_first_name,
        en_last_name,
        innovian_id,
        staff_role_id,
        staff_name,
        staff_role,
        entry_year,
        seq,
        created_by,
        created_at,
        updated_at
      )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const upsertStaffDirectory = db.prepare(
    `INSERT INTO staff_directory
      (
        hospital_id,
        personal_id,
        email,
        th_first_name,
        th_last_name,
        en_first_name,
        en_last_name,
        innovian_id,
        staff_role_id,
        staff_name,
        staff_role,
        entry_year,
        is_active,
        used_count,
        last_used_at,
        created_at,
        updated_at
      )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1, ?, ?, ?)
     ON CONFLICT(staff_name, staff_role)
     DO UPDATE SET
       hospital_id = CASE
         WHEN excluded.hospital_id IS NULL OR excluded.hospital_id = ''
           THEN staff_directory.hospital_id
         ELSE excluded.hospital_id
       END,
       personal_id = CASE
         WHEN excluded.personal_id IS NULL OR excluded.personal_id = ''
           THEN staff_directory.personal_id
         ELSE excluded.personal_id
       END,
       email = CASE
         WHEN excluded.email IS NULL OR excluded.email = ''
           THEN staff_directory.email
         ELSE excluded.email
       END,
       th_first_name = CASE
         WHEN excluded.th_first_name IS NULL OR excluded.th_first_name = ''
           THEN staff_directory.th_first_name
         ELSE excluded.th_first_name
       END,
       th_last_name = CASE
         WHEN excluded.th_last_name IS NULL OR excluded.th_last_name = ''
           THEN staff_directory.th_last_name
         ELSE excluded.th_last_name
       END,
       en_first_name = CASE
         WHEN excluded.en_first_name IS NULL OR excluded.en_first_name = ''
           THEN staff_directory.en_first_name
         ELSE excluded.en_first_name
       END,
       en_last_name = CASE
         WHEN excluded.en_last_name IS NULL OR excluded.en_last_name = ''
           THEN staff_directory.en_last_name
         ELSE excluded.en_last_name
       END,
       innovian_id = CASE
         WHEN excluded.innovian_id IS NULL OR excluded.innovian_id = ''
           THEN staff_directory.innovian_id
         ELSE excluded.innovian_id
       END,
       staff_role_id = CASE
         WHEN excluded.staff_role_id IS NULL OR excluded.staff_role_id = ''
           THEN staff_directory.staff_role_id
         ELSE excluded.staff_role_id
       END,
       entry_year = COALESCE(excluded.entry_year, staff_directory.entry_year),
       is_active = 1,
       used_count = staff_directory.used_count + 1,
       last_used_at = excluded.last_used_at,
       updated_at = excluded.updated_at`
  );

  const tx = db.transaction(() => {
    const now = Date.now();
    clearCaseStaff.run(caseId);

    for (let i = 0; i < staff.length; i += 1) {
      const row = staff[i];
      insertCaseStaff.run(
        caseId,
        row.hospitalId,
        row.personalId,
        row.email,
        row.thFirstName,
        row.thLastName,
        row.enFirstName,
        row.enLastName,
        row.innovianId,
        row.roleId,
        row.name,
        row.role,
        row.entryYear,
        i + 1,
        actorUsername,
        now,
        now,
      );

      upsertStaffDirectory.run(
        row.hospitalId,
        row.personalId,
        row.email,
        row.thFirstName,
        row.thLastName,
        row.enFirstName,
        row.enLastName,
        row.innovianId,
        row.roleId,
        row.name,
        row.role,
        row.entryYear,
        now,
        now,
        now,
      );
    }

    return {
      case_id: caseId,
      rows: staff.map((row, index) => ({
        id: index + 1,
        hospital_id: row.hospitalId,
        personal_id: row.personalId,
        email: row.email,
        th_first_name: row.thFirstName,
        th_last_name: row.thLastName,
        en_first_name: row.enFirstName,
        en_last_name: row.enLastName,
        innovian_id: row.innovianId,
        role_id: row.roleId,
        name: row.name,
        role: row.role,
        entry_year: row.entryYear,
        seq: index + 1,
      })),
    };
  });

  try {
    const result = tx();
    res.json({
      ok: true,
      ...result,
    });
  } catch (err) {
    res.status(400).json({ error: err.message || "staff save failed" });
  }
});

/* =======================
   IO ITEM MASTER (PER CASE VIEW)
======================= */
router.get("/:id/io/items", (req, res) => {
  const caseId = Number(req.params.id);
  if (!Number.isFinite(caseId)) {
    return res.status(400).json({ error: "invalid case id" });
  }

  const caseRow = db.prepare(`SELECT id FROM cases WHERE id=?`).get(caseId);
  if (!caseRow) return res.status(404).json({ error: "not found" });

  const kind = parseIoKind(req.query.kind);
  const rows = kind
    ? db
        .prepare(
          `SELECT
             id, kind, code, name, default_unit, category, usage_score, usage_rank, is_active
           FROM io_item_master
           WHERE is_active = 1 AND kind = ?
           ORDER BY COALESCE(usage_rank, 999999) ASC, usage_score DESC, name ASC`
        )
        .all(kind)
    : db
        .prepare(
          `SELECT
             id, kind, code, name, default_unit, category, usage_score, usage_rank, is_active
           FROM io_item_master
           WHERE is_active = 1
           ORDER BY kind ASC, COALESCE(usage_rank, 999999) ASC, usage_score DESC, name ASC`
        )
        .all();

  res.json({ case_id: caseId, rows });
});

/* =======================
   IO RUN LIST
======================= */
router.get("/:id/io/runs", (req, res) => {
  const caseId = Number(req.params.id);
  if (!Number.isFinite(caseId)) {
    return res.status(400).json({ error: "invalid case id" });
  }

  const caseRow = db
    .prepare(`SELECT start_time, discharge_time, status FROM cases WHERE id=?`)
    .get(caseId);
  if (!caseRow) return res.status(404).json({ error: "not found" });

  const range = resolveCaseRange(caseRow, req.query);
  if (!range) return res.status(400).json({ error: "invalid range" });
  const { fromTs, toTs } = range;

  const runs = db
    .prepare(
       `SELECT
         r.id,
         r.case_id,
         r.item_id,
         i.code AS item_code,
         i.name AS item_name,
         i.category AS item_category,
         i.default_unit AS item_unit,
         r.kind,
         r.route,
         r.started_at,
         r.stopped_at,
         r.entry_mode,
         r.note,
         r.include_in_balance,
         r.created_by,
         r.created_at,
         r.updated_at
       FROM case_io_run r
       JOIN io_item_master i ON i.id = r.item_id
       WHERE r.case_id = ?
         AND r.include_in_balance != 0
         AND r.started_at <= ?
         AND COALESCE(r.stopped_at, 9223372036854775807) >= ?
       ORDER BY r.started_at ASC, r.id ASC`
    )
    .all(caseId, toTs, fromTs);

  const runIds = runs.map(row => row.id);
  let segments = [];
  if (runIds.length > 0) {
    const placeholders = runIds.map(() => "?").join(", ");
    segments = db
      .prepare(
        `SELECT
           id,
           run_id,
           ts_from,
           ts_to,
           rate_value,
           rate_unit,
           dose_value,
           dose_unit,
           carrier_ml_per_hr,
           include_in_balance,
           note,
           created_by,
           created_at,
           updated_at
         FROM case_io_segment
         WHERE run_id IN (${placeholders})
           AND include_in_balance != 0
         ORDER BY ts_from ASC, id ASC`
      )
      .all(...runIds);
  }

  const segmentsByRunId = new Map();
  for (const row of segments) {
    const list = segmentsByRunId.get(row.run_id) || [];
    list.push(row);
    segmentsByRunId.set(row.run_id, list);
  }

  res.json({
    case_id: caseId,
    from: fromTs,
    to: toTs,
    rows: runs.map(run => ({
      ...run,
      segments: segmentsByRunId.get(run.id) || [],
    })),
  });
});

/* =======================
   IO RUN CREATE
======================= */
router.post("/:id/io/runs", (req, res) => {
  const caseId = Number(req.params.id);
  if (!Number.isFinite(caseId)) {
    return res.status(400).json({ error: "invalid case id" });
  }

  const caseRow = db.prepare(`SELECT id FROM cases WHERE id=?`).get(caseId);
  if (!caseRow) return res.status(404).json({ error: "not found" });

  const itemId = Number(req.body?.item_id);
  if (!Number.isFinite(itemId)) {
    return res.status(400).json({ error: "item_id required" });
  }

  const item = db
    .prepare(`SELECT id, kind, code, name, category FROM io_item_master WHERE id=?`)
    .get(itemId);
  if (!item) return res.status(400).json({ error: "invalid item_id" });

  const kind = parseIoKind(req.body?.kind) || item.kind;
  if (kind !== item.kind) {
    return res.status(400).json({ error: "kind does not match item" });
  }

  const startedAt = parseNullableTs(req.body?.started_at) || floorMinute(Date.now());
  const stoppedAt = parseNullableTs(req.body?.stopped_at);
  if (stoppedAt != null && stoppedAt < startedAt) {
    return res.status(400).json({ error: "stopped_at must be >= started_at" });
  }

  const route =
    typeof req.body?.route === "string" ? req.body.route.trim() || null : null;
  const note =
    typeof req.body?.note === "string" ? req.body.note.trim() || null : null;
  const includeInBalance = parseBooleanFlag(req.body?.include_in_balance, true)
    ? 1
    : 0;
  const entryMode = parseEntryMode(req.body?.entry_mode);
  const actor = getActor(req);
  const reason =
    typeof req.body?.reason === "string" ? req.body.reason.trim() : null;

  const insertRun = db.prepare(
    `INSERT INTO case_io_run
      (
        case_id, item_id, kind, route, started_at, stopped_at,
        entry_mode, note, include_in_balance, created_by, created_at, updated_at
      )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const selectRun = db.prepare(
    `SELECT
       r.id,
       r.case_id,
       r.item_id,
       i.code AS item_code,
       i.name AS item_name,
       i.category AS item_category,
       i.default_unit AS item_unit,
       r.kind,
       r.route,
       r.started_at,
       r.stopped_at,
       r.entry_mode,
       r.note,
       r.include_in_balance,
       r.created_by,
       r.created_at,
       r.updated_at
     FROM case_io_run r
     JOIN io_item_master i ON i.id = r.item_id
     WHERE r.id = ?`
  );

  const tx = db.transaction(() => {
    const now = Date.now();
    const info = insertRun.run(
      caseId,
      itemId,
      kind,
      route,
      startedAt,
      stoppedAt,
      entryMode,
      note,
      includeInBalance,
      actor.username,
      now,
      now,
    );
    const runId = Number(info.lastInsertRowid);
    const row = selectRun.get(runId);

    writeIoAudit({
      caseId,
      entityType: "run",
      entityId: runId,
      action: "insert",
      beforeJson: null,
      afterJson: row,
      reason,
      actor,
    });

    return row;
  });

  try {
    const row = tx();
    res.json({ ok: true, row });
  } catch (err) {
    res.status(400).json({ error: err.message || "io run create failed" });
  }
});

/* =======================
   IO DRIP CREATE (atomic run + first segment)
======================= */
router.post("/:id/io/drips", (req, res) => {
  const caseId = Number(req.params.id);
  if (!Number.isFinite(caseId)) {
    return res.status(400).json({ error: "invalid case id" });
  }

  const caseRow = db.prepare(`SELECT id FROM cases WHERE id=?`).get(caseId);
  if (!caseRow) return res.status(404).json({ error: "not found" });

  // --- RUN fields ---
  const runBody = req.body?.run;
  if (!runBody || typeof runBody !== "object") {
    return res.status(400).json({ error: "run object required" });
  }

  const itemId = Number(runBody.item_id);
  if (!Number.isFinite(itemId)) {
    return res.status(400).json({ error: "run.item_id required" });
  }

  const item = db
    .prepare(`SELECT id, kind, code, name, category FROM io_item_master WHERE id=?`)
    .get(itemId);
  if (!item) return res.status(400).json({ error: "invalid run.item_id" });

  const kind = parseIoKind(runBody.kind) || item.kind;
  if (kind !== item.kind) {
    return res.status(400).json({ error: "run.kind does not match item" });
  }

  const startedAt = parseNullableTs(runBody.started_at) || floorMinute(Date.now());
  const stoppedAt = parseNullableTs(runBody.stopped_at);
  if (stoppedAt != null && stoppedAt < startedAt) {
    return res.status(400).json({ error: "run.stopped_at must be >= started_at" });
  }

  const route =
    typeof runBody.route === "string" ? runBody.route.trim() || null : null;
  const runNote =
    typeof runBody.note === "string" ? runBody.note.trim() || null : null;
  const runIncludeInBalance = parseBooleanFlag(runBody.include_in_balance, true) ? 1 : 0;
  const entryMode = parseEntryMode(runBody.entry_mode);

  // --- SEGMENT fields ---
  const segBody = req.body?.segment;
  if (!segBody || typeof segBody !== "object") {
    return res.status(400).json({ error: "segment object required" });
  }

  const tsFrom = parseNullableTs(segBody.ts_from);
  if (tsFrom == null) return res.status(400).json({ error: "segment.ts_from required" });
  const tsTo = parseNullableTs(segBody.ts_to);
  if (tsTo != null && tsTo <= tsFrom) {
    return res.status(400).json({ error: "segment.ts_to must be > ts_from" });
  }

  const rateValue = parseNullableNumber(segBody.rate_value);
  if (rateValue != null && rateValue < 0) {
    return res.status(400).json({ error: "segment.rate_value must be >= 0" });
  }
  const rateUnit =
    segBody.rate_unit == null ? null : normalizeRateUnit(segBody.rate_unit);
  const doseValue = parseNullableNumber(segBody.dose_value);
  if (doseValue != null && doseValue < 0) {
    return res.status(400).json({ error: "segment.dose_value must be >= 0" });
  }
  const doseUnit =
    typeof segBody.dose_unit === "string" ? segBody.dose_unit.trim() || null : null;
  const carrierMlPerHr = parseNullableNumber(segBody.carrier_ml_per_hr);
  if (carrierMlPerHr != null && carrierMlPerHr < 0) {
    return res.status(400).json({ error: "segment.carrier_ml_per_hr must be >= 0" });
  }
  const segIncludeInBalance = parseBooleanFlag(segBody.include_in_balance, true) ? 1 : 0;
  const segNote =
    typeof segBody.note === "string" ? segBody.note.trim() || null : null;

  // --- shared ---
  const actor = getActor(req);
  const reason =
    typeof req.body?.reason === "string" ? req.body.reason.trim() : null;

  const insertRun = db.prepare(
    `INSERT INTO case_io_run
      (
        case_id, item_id, kind, route, started_at, stopped_at,
        entry_mode, note, include_in_balance, created_by, created_at, updated_at
      )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const selectRun = db.prepare(
    `SELECT
       r.id,
       r.case_id,
       r.item_id,
       i.code AS item_code,
       i.name AS item_name,
       i.category AS item_category,
       i.default_unit AS item_unit,
       r.kind,
       r.route,
       r.started_at,
       r.stopped_at,
       r.entry_mode,
       r.note,
       r.include_in_balance,
       r.created_by,
       r.created_at,
       r.updated_at
     FROM case_io_run r
     JOIN io_item_master i ON i.id = r.item_id
     WHERE r.id = ?`
  );
  const insertSegment = db.prepare(
    `INSERT INTO case_io_segment
      (
        run_id, ts_from, ts_to, rate_value, rate_unit,
        dose_value, dose_unit, carrier_ml_per_hr,
        include_in_balance, note, created_by, created_at, updated_at
      )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );

  const tx = db.transaction(() => {
    const now = Date.now();
    const runInfo = insertRun.run(
      caseId, itemId, kind, route, startedAt, stoppedAt,
      entryMode, runNote, runIncludeInBalance, actor.username, now, now,
    );
    const runId = Number(runInfo.lastInsertRowid);
    const runRow = selectRun.get(runId);

    writeIoAudit({
      caseId,
      entityType: "run",
      entityId: runId,
      action: "insert",
      beforeJson: null,
      afterJson: runRow,
      reason,
      actor,
    });

    const segInfo = insertSegment.run(
      runId, tsFrom, tsTo, rateValue, rateUnit,
      doseValue, doseUnit, carrierMlPerHr,
      segIncludeInBalance, segNote, actor.username, now, now,
    );
    const segmentId = Number(segInfo.lastInsertRowid);
    const segRow = db.prepare(`SELECT * FROM case_io_segment WHERE id = ?`).get(segmentId);

    writeIoAudit({
      caseId,
      entityType: "segment",
      entityId: segmentId,
      action: "insert",
      beforeJson: null,
      afterJson: segRow,
      reason,
      actor,
    });

    return { runRow, segRow };
  });

  try {
    const { runRow, segRow } = tx();

    let autoEvent = null;
    try {
      autoEvent = createAutoCaseEventIfNeeded({
        caseId,
        eventTs: tsFrom,
        itemCategory: item.category,
        actor,
        reason: `auto event from io drip (${String(item.category || "").trim() || "unknown"})`,
      });
    } catch (autoErr) {
      console.error("[caseRoutes] auto event from io drip failed", autoErr);
    }
    let bloodProductEvent = null;
    try {
      bloodProductEvent = createBloodProductEventIfNeeded({
        caseId,
        eventTs: tsFrom,
        itemCategory: item.category,
        itemCode: item.code,
        itemName: item.name,
        volumeMl: null,
        note: segNote,
        actor,
        reason: `blood product event from io drip (${String(item.category || "").trim() || "unknown"})`,
      });
    } catch (bloodErr) {
      console.error("[caseRoutes] blood product event from io drip failed", bloodErr);
    }

    res.json({ ok: true, run: runRow, segment: segRow, auto_event: autoEvent, blood_product_event: bloodProductEvent });
  } catch (err) {
    res.status(400).json({ error: err.message || "io drip create failed" });
  }
});

/* =======================
   IO DRIP REPLACE (edit: update run + delete all segments + create fresh single segment)
======================= */
router.put("/:id/io/runs/:runId/drip", (req, res) => {
  const caseId = Number(req.params.id);
  const runId  = Number(req.params.runId);
  if (!Number.isFinite(caseId) || !Number.isFinite(runId)) {
    return res.status(400).json({ error: "invalid id" });
  }

  const current = db
    .prepare(`SELECT r.*, i.kind AS item_kind, i.code AS item_code, i.name AS item_name, i.category AS item_category
              FROM case_io_run r JOIN io_item_master i ON i.id = r.item_id
              WHERE r.id = ? AND r.case_id = ?`)
    .get(runId, caseId);
  if (!current) return res.status(404).json({ error: "run not found" });

  // Run fields
  const runBody = req.body?.run;
  if (!runBody || typeof runBody !== "object") {
    return res.status(400).json({ error: "run object required" });
  }

  const itemId = runBody.item_id != null ? Number(runBody.item_id) : current.item_id;
  const item = db
    .prepare(`SELECT id, kind, code, name, category FROM io_item_master WHERE id=?`)
    .get(itemId);
  if (!item) return res.status(400).json({ error: "invalid run.item_id" });

  const startedAt = parseNullableTs(runBody.started_at) ?? current.started_at;
  const route = typeof runBody.route === "string" ? runBody.route.trim() || null : current.route;
  const runNote = typeof runBody.note === "string" ? runBody.note.trim() || null : current.note;

  // Segment fields
  const segBody = req.body?.segment;
  if (!segBody || typeof segBody !== "object") {
    return res.status(400).json({ error: "segment object required" });
  }

  const tsFrom = parseNullableTs(segBody.ts_from);
  if (tsFrom == null) return res.status(400).json({ error: "segment.ts_from required" });

  const rateValue    = parseNullableNumber(segBody.rate_value);
  const rateUnit     = segBody.rate_unit == null ? null : normalizeRateUnit(segBody.rate_unit);
  const doseValue    = parseNullableNumber(segBody.dose_value);
  const doseUnit     = typeof segBody.dose_unit === "string" ? segBody.dose_unit.trim() || null : null;
  const carrierMlHr  = parseNullableNumber(segBody.carrier_ml_per_hr);
  const segInclude   = parseBooleanFlag(segBody.include_in_balance, true) ? 1 : 0;
  const segNote      = typeof segBody.note === "string" ? segBody.note.trim() || null : null;

  const actor  = getActor(req);
  const reason = typeof req.body?.reason === "string" ? req.body.reason.trim() : null;

  const selectRun = db.prepare(
    `SELECT r.id, r.case_id, r.item_id,
            i.code AS item_code, i.name AS item_name, i.category AS item_category, i.default_unit AS item_unit,
            r.kind, r.route, r.started_at, r.stopped_at, r.entry_mode, r.note,
            r.include_in_balance, r.created_by, r.created_at, r.updated_at
     FROM case_io_run r JOIN io_item_master i ON i.id = r.item_id WHERE r.id = ?`
  );

  const tx = db.transaction(() => {
    const now = Date.now();
    db.prepare(
      `UPDATE case_io_run SET item_id=?, started_at=?, route=?, note=?, updated_at=? WHERE id=?`
    ).run(itemId, startedAt, route, runNote, now, runId);

    const oldSegs = db.prepare(`SELECT * FROM case_io_segment WHERE run_id=?`).all(runId);
    for (const seg of oldSegs) {
      writeIoAudit({ caseId, entityType: "segment", entityId: seg.id, action: "delete", beforeJson: seg, afterJson: null, reason, actor });
    }
    db.prepare(`DELETE FROM case_io_segment WHERE run_id=?`).run(runId);

    const runRow = selectRun.get(runId);
    writeIoAudit({ caseId, entityType: "run", entityId: runId, action: "update", beforeJson: current, afterJson: runRow, reason, actor });

    const segInfo = db.prepare(
      `INSERT INTO case_io_segment (run_id, ts_from, ts_to, rate_value, rate_unit, dose_value, dose_unit, carrier_ml_per_hr, include_in_balance, note, created_by, created_at, updated_at)
       VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(runId, tsFrom, rateValue, rateUnit, doseValue, doseUnit, carrierMlHr, segInclude, segNote, actor.username, now, now);
    const segRow = db.prepare(`SELECT * FROM case_io_segment WHERE id=?`).get(Number(segInfo.lastInsertRowid));
    writeIoAudit({ caseId, entityType: "segment", entityId: segRow.id, action: "insert", beforeJson: null, afterJson: segRow, reason, actor });

    return { runRow, segRow };
  });

  try {
    const { runRow, segRow } = tx();
    res.json({ ok: true, run: runRow, segment: segRow });
  } catch (err) {
    res.status(400).json({ error: err.message || "drip replace failed" });
  }
});

/* =======================
   IO BLOOD PRODUCT CREATE (atomic upsert-run + event)
======================= */
router.post("/:id/io/blood-products", (req, res) => {
  const caseId = Number(req.params.id);
  if (!Number.isFinite(caseId)) {
    return res.status(400).json({ error: "invalid case id" });
  }

  const caseRow = db.prepare(`SELECT id FROM cases WHERE id=?`).get(caseId);
  if (!caseRow) return res.status(404).json({ error: "not found" });

  // --- RUN fields ---
  const runBody = req.body?.run;
  if (!runBody || typeof runBody !== "object") {
    return res.status(400).json({ error: "run object required" });
  }

  const itemId = Number(runBody.item_id);
  if (!Number.isFinite(itemId)) {
    return res.status(400).json({ error: "run.item_id required" });
  }

  const item = db
    .prepare(`SELECT id, kind, code, name, category FROM io_item_master WHERE id=?`)
    .get(itemId);
  if (!item) return res.status(400).json({ error: "invalid run.item_id" });
  if (!isBloodProductCategory(item.category)) {
    return res.status(400).json({ error: "item is not a blood product" });
  }

  const kind = item.kind; // always use the item's kind (fluid)
  const route =
    typeof runBody.route === "string" ? runBody.route.trim() || "IV" : "IV";
  const runNote =
    typeof runBody.note === "string" ? runBody.note.trim() || null : null;
  const runIncludeInBalance = parseBooleanFlag(runBody.include_in_balance, true) ? 1 : 0;

  // --- EVENT fields ---
  const evBody = req.body?.event;
  if (!evBody || typeof evBody !== "object") {
    return res.status(400).json({ error: "event object required" });
  }

  const eventTs = parseNullableTs(evBody.event_ts);
  if (eventTs == null) return res.status(400).json({ error: "event.event_ts required" });

  const volumeMl = parseNullableNumber(evBody.volume_ml);
  if (volumeMl == null || volumeMl <= 0) {
    return res.status(400).json({ error: "event.volume_ml must be > 0" });
  }

  const note =
    typeof evBody.note === "string" ? evBody.note.trim() || null : null;
  const evIncludeInBalance = parseBooleanFlag(evBody.include_in_balance, true) ? 1 : 0;

  // --- shared ---
  const actor = getActor(req);
  const authorizationError = validateBloodGivingAuthorization(caseId, note, actor);
  if (authorizationError) {
    return res.status(400).json({ error: authorizationError });
  }
  const reason =
    typeof req.body?.reason === "string" ? req.body.reason.trim() : null;

  const selectExistingRun = db.prepare(
    `SELECT
       r.id,
       r.case_id,
       r.item_id,
       i.code AS item_code,
       i.name AS item_name,
       i.category AS item_category,
       i.default_unit AS item_unit,
       r.kind,
       r.route,
       r.started_at,
       r.stopped_at,
       r.entry_mode,
       r.note,
       r.include_in_balance,
       r.created_by,
       r.created_at,
       r.updated_at
     FROM case_io_run r
     JOIN io_item_master i ON i.id = r.item_id
     WHERE r.case_id = ? AND r.item_id = ? AND r.kind = ? AND r.entry_mode = 'bolus' AND r.include_in_balance != 0
     ORDER BY r.id ASC
     LIMIT 1`
  );
  const insertRun = db.prepare(
    `INSERT INTO case_io_run
      (
        case_id, item_id, kind, route, started_at, stopped_at,
        entry_mode, note, include_in_balance, created_by, created_at, updated_at
      )
     VALUES (?, ?, ?, ?, ?, NULL, 'bolus', ?, ?, ?, ?, ?)`
  );
  const updateRunNote = db.prepare(
    `UPDATE case_io_run SET note=?, updated_at=? WHERE id=?`
  );
  const selectRun = db.prepare(
    `SELECT
       r.id,
       r.case_id,
       r.item_id,
       i.code AS item_code,
       i.name AS item_name,
       i.category AS item_category,
       i.default_unit AS item_unit,
       r.kind,
       r.route,
       r.started_at,
       r.stopped_at,
       r.entry_mode,
       r.note,
       r.include_in_balance,
       r.created_by,
       r.created_at,
       r.updated_at
     FROM case_io_run r
     JOIN io_item_master i ON i.id = r.item_id
     WHERE r.id = ?`
  );
  const insertEvent = db.prepare(
    `INSERT INTO case_io_event
      (
        case_id, item_id, kind, event_ts, volume_ml,
        note, include_in_balance, created_by, created_at, updated_at
      )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const selectEvent = db.prepare(
    `SELECT
       e.*,
       i.code AS item_code,
       i.name AS item_name,
       i.category AS item_category
     FROM case_io_event e
     JOIN io_item_master i ON i.id = e.item_id
     WHERE e.id = ?`
  );

  const tx = db.transaction(() => {
    const now = Date.now();

    // Upsert run: reuse existing or create new
    let runRow = selectExistingRun.get(caseId, itemId, kind);
    if (!runRow) {
      const runInfo = insertRun.run(
        caseId, itemId, kind, route,
        eventTs, // started_at = first event time
        runNote || note,
        runIncludeInBalance, actor.username, now, now,
      );
      const runId = Number(runInfo.lastInsertRowid);
      runRow = selectRun.get(runId);
      writeIoAudit({
        caseId,
        entityType: "run",
        entityId: runId,
        action: "insert",
        beforeJson: null,
        afterJson: runRow,
        reason,
        actor,
      });
    } else if (runNote || note) {
      const beforeRun = runRow;
      updateRunNote.run(runNote || note, now, runRow.id);
      runRow = selectRun.get(runRow.id);
      writeIoAudit({
        caseId,
        entityType: "run",
        entityId: runRow.id,
        action: "update",
        beforeJson: beforeRun,
        afterJson: runRow,
        reason,
        actor,
      });
    }

    // Create event
    const evInfo = insertEvent.run(
      caseId, itemId, kind, eventTs, volumeMl,
      note, evIncludeInBalance, actor.username, now, now,
    );
    const eventId = Number(evInfo.lastInsertRowid);
    const eventRow = selectEvent.get(eventId);
    writeIoAudit({
      caseId,
      entityType: "event",
      entityId: eventId,
      action: "insert",
      beforeJson: null,
      afterJson: eventRow,
      reason,
      actor,
    });

    return { runRow, eventRow };
  });

  try {
    const { runRow, eventRow } = tx();

    let bloodProductEvent = null;
    try {
      bloodProductEvent = createBloodProductEventIfNeeded({
        caseId,
        eventTs,
        itemCategory: item.category,
        itemCode: item.code,
        itemName: item.name,
        volumeMl,
        note,
        actor,
        reason: `blood product event from io blood-product (${String(item.name || "").trim()})`,
      });
    } catch (bloodErr) {
      console.error("[caseRoutes] blood product event from io blood-products failed", bloodErr);
    }

    res.json({ ok: true, run: runRow, event: eventRow, blood_product_event: bloodProductEvent });
  } catch (err) {
    res.status(400).json({ error: err.message || "io blood product create failed" });
  }
});

/* =======================
   IO RUN UPDATE
======================= */
router.put("/:id/io/runs/:runId", (req, res) => {
  const caseId = Number(req.params.id);
  const runId = Number(req.params.runId);
  if (!Number.isFinite(caseId) || !Number.isFinite(runId)) {
    return res.status(400).json({ error: "invalid id" });
  }

  const current = db
    .prepare(
      `SELECT
         r.*,
         i.code AS item_code,
         i.name AS item_name,
         i.category AS item_category,
         i.default_unit AS item_unit
       FROM case_io_run r
       JOIN io_item_master i ON i.id = r.item_id
       WHERE r.id = ? AND r.case_id = ?`
    )
    .get(runId, caseId);
  if (!current) return res.status(404).json({ error: "run not found" });

  const startedAt =
    parseNullableTs(req.body?.started_at) ?? current.started_at;
  const stoppedAtRaw = parseNullableTs(req.body?.stopped_at);
  const stoppedAt =
    req.body?.stopped_at === null ? null : stoppedAtRaw ?? current.stopped_at;
  if (stoppedAt != null && stoppedAt < startedAt) {
    return res.status(400).json({ error: "stopped_at must be >= started_at" });
  }

  const route =
    req.body?.route === undefined
      ? current.route
      : typeof req.body?.route === "string"
        ? req.body.route.trim() || null
        : null;
  const note =
    req.body?.note === undefined
      ? current.note
      : typeof req.body?.note === "string"
        ? req.body.note.trim() || null
        : null;
  const includeInBalance =
    req.body?.include_in_balance === undefined
      ? current.include_in_balance
      : parseBooleanFlag(req.body?.include_in_balance, true)
        ? 1
        : 0;
  const entryMode =
    req.body?.entry_mode === undefined
      ? current.entry_mode ?? null
      : parseEntryMode(req.body?.entry_mode);

  const actor = getActor(req);
  const reason =
    typeof req.body?.reason === "string" ? req.body.reason.trim() : null;

  const updateRun = db.prepare(
    `UPDATE case_io_run
      SET route=?, started_at=?, stopped_at=?, entry_mode=?, note=?, include_in_balance=?, updated_at=?
      WHERE id=?`
  );

  try {
    const now = Date.now();
    updateRun.run(route, startedAt, stoppedAt, entryMode, note, includeInBalance, now, runId);
    const row = db
      .prepare(
        `SELECT
           r.*,
           i.code AS item_code,
           i.name AS item_name,
           i.category AS item_category,
           i.default_unit AS item_unit
         FROM case_io_run r
         JOIN io_item_master i ON i.id = r.item_id
         WHERE r.id = ?`
      )
      .get(runId);

    writeIoAudit({
      caseId,
      entityType: "run",
      entityId: runId,
      action: "update",
      beforeJson: current,
      afterJson: row,
      reason,
      actor,
    });

    res.json({ ok: true, row });
  } catch (err) {
    res.status(400).json({ error: err.message || "io run update failed" });
  }
});

/* =======================
   IO RUN DISCONTINUE
======================= */
router.post("/:id/io/runs/:runId/discontinue", (req, res) => {
  const caseId = Number(req.params.id);
  const runId = Number(req.params.runId);
  if (!Number.isFinite(caseId) || !Number.isFinite(runId)) {
    return res.status(400).json({ error: "invalid id" });
  }

  const current = db
    .prepare(
      `SELECT
         r.*,
         i.code AS item_code,
         i.name AS item_name,
         i.category AS item_category,
         i.default_unit AS item_unit
       FROM case_io_run r
       JOIN io_item_master i ON i.id = r.item_id
       WHERE r.id = ? AND r.case_id = ?`
    )
    .get(runId, caseId);
  if (!current) return res.status(404).json({ error: "run not found" });

  const requestedStoppedAt = parseNullableTs(req.body?.stopped_at);
  const stoppedAt = Math.max(
    current.started_at,
    requestedStoppedAt ?? Date.now(),
  );
  const actor = getActor(req);
  const reason =
    typeof req.body?.reason === "string" && req.body.reason.trim()
      ? req.body.reason.trim()
      : "io run discontinue";

  const selectRun = db.prepare(
    `SELECT
       r.*,
       i.code AS item_code,
       i.name AS item_name,
       i.category AS item_category,
       i.default_unit AS item_unit
     FROM case_io_run r
     JOIN io_item_master i ON i.id = r.item_id
     WHERE r.id = ?`
  );
  const selectRunsByItem = db.prepare(
    `SELECT
       r.*,
       i.code AS item_code,
       i.name AS item_name,
       i.category AS item_category,
       i.default_unit AS item_unit
     FROM case_io_run r
     JOIN io_item_master i ON i.id = r.item_id
     WHERE r.case_id = ?
       AND r.item_id = ?
       AND r.kind = ?
       AND COALESCE(r.entry_mode, '') = COALESCE(?, '')
       AND r.include_in_balance = 1
     ORDER BY r.started_at ASC, r.id ASC`
  );
  const selectEvents = db.prepare(
    `SELECT
       e.*,
       i.code AS item_code,
       i.name AS item_name,
       i.category AS item_category
     FROM case_io_event e
     JOIN io_item_master i ON i.id = e.item_id
     WHERE e.case_id = ?
       AND e.item_id = ?
       AND e.kind = ?
       AND e.include_in_balance = 1
     ORDER BY e.id ASC`
  );
  const updateRun = db.prepare(
    `UPDATE case_io_run
     SET stopped_at = ?, include_in_balance = 0, updated_at = ?
     WHERE id = ?`
  );
  const updateEvent = db.prepare(
    `UPDATE case_io_event
     SET include_in_balance = 0, updated_at = ?
     WHERE id = ?`
  );

  const tx = db.transaction(() => {
    const now = Date.now();
    const targetRuns = selectRunsByItem.all(
      caseId,
      current.item_id,
      current.kind,
      current.entry_mode ?? "",
    );
    for (const run of targetRuns) {
      const runStoppedAt = Math.max(Number(run.started_at) || stoppedAt, stoppedAt);
      updateRun.run(runStoppedAt, now, run.id);
      const runAfter = selectRun.get(run.id);
      writeIoAudit({
        caseId,
        entityType: "run",
        entityId: run.id,
        action: "update",
        beforeJson: run,
        afterJson: runAfter,
        reason,
        actor,
      });
    }

    const affectedEvents =
      current.entry_mode === "bolus"
        ? selectEvents.all(
            caseId,
            current.item_id,
            current.kind,
          )
        : [];

    for (const event of affectedEvents) {
      updateEvent.run(now, event.id);
      writeIoAudit({
        caseId,
        entityType: "event",
        entityId: event.id,
        action: "update",
        beforeJson: event,
        afterJson: {
          ...event,
          include_in_balance: 0,
          updated_at: now,
        },
        reason,
        actor,
      });
    }

    return {
      run: selectRun.get(runId),
      discontinued_at: stoppedAt,
      excluded_runs: targetRuns.length,
      excluded_events: affectedEvents.length,
    };
  });

  try {
    const result = tx();
    res.json({
      ok: true,
      ...result,
    });
  } catch (err) {
    res.status(400).json({ error: err.message || "io run discontinue failed" });
  }
});

/* =======================
   IO SEGMENT CREATE
======================= */
router.post("/:id/io/segments", (req, res) => {
  const caseId = Number(req.params.id);
  if (!Number.isFinite(caseId)) {
    return res.status(400).json({ error: "invalid case id" });
  }

  const runId = Number(req.body?.run_id);
  if (!Number.isFinite(runId)) {
    return res.status(400).json({ error: "run_id required" });
  }

  const run = db
    .prepare(
      `SELECT
         r.id,
         r.case_id,
         r.kind,
         r.started_at,
         r.stopped_at,
         r.include_in_balance,
         i.code AS item_code,
         i.name AS item_name,
         i.category AS item_category
       FROM case_io_run r
       JOIN io_item_master i ON i.id = r.item_id
       WHERE r.id = ? AND r.case_id = ?`
    )
    .get(runId, caseId);
  if (!run) return res.status(404).json({ error: "run not found" });

  const tsFrom = parseNullableTs(req.body?.ts_from);
  if (tsFrom == null) return res.status(400).json({ error: "ts_from required" });
  const tsTo = parseNullableTs(req.body?.ts_to);
  if (tsTo != null && tsTo <= tsFrom) {
    return res.status(400).json({ error: "ts_to must be > ts_from" });
  }

  const newEnd = tsTo ?? 9223372036854775807;
  const overlap = db
    .prepare(
      `SELECT id
       FROM case_io_segment
       WHERE run_id = ?
         AND NOT (
           COALESCE(ts_to, 9223372036854775807) <= ?
           OR ts_from >= ?
         )
       LIMIT 1`
    )
    .get(runId, tsFrom, newEnd);
  if (overlap) {
    return res.status(400).json({ error: "segment overlaps existing range" });
  }

  const rateValue = parseNullableNumber(req.body?.rate_value);
  if (rateValue != null && rateValue < 0) {
    return res.status(400).json({ error: "rate_value must be >= 0" });
  }
  const rateUnit =
    req.body?.rate_unit == null ? null : normalizeRateUnit(req.body.rate_unit);
  const doseValue = parseNullableNumber(req.body?.dose_value);
  if (doseValue != null && doseValue < 0) {
    return res.status(400).json({ error: "dose_value must be >= 0" });
  }
  const doseUnit =
    typeof req.body?.dose_unit === "string"
      ? req.body.dose_unit.trim() || null
      : null;
  const carrierMlPerHr = parseNullableNumber(req.body?.carrier_ml_per_hr);
  if (carrierMlPerHr != null && carrierMlPerHr < 0) {
    return res.status(400).json({ error: "carrier_ml_per_hr must be >= 0" });
  }
  const includeInBalance = parseBooleanFlag(req.body?.include_in_balance, true)
    ? 1
    : 0;
  const note =
    typeof req.body?.note === "string" ? req.body.note.trim() || null : null;
  const actor = getActor(req);
  const reason =
    typeof req.body?.reason === "string" ? req.body.reason.trim() : null;

  const insertSegment = db.prepare(
    `INSERT INTO case_io_segment
      (
        run_id, ts_from, ts_to, rate_value, rate_unit,
        dose_value, dose_unit, carrier_ml_per_hr,
        include_in_balance, note, created_by, created_at, updated_at
      )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );

  try {
    const now = Date.now();
    const info = insertSegment.run(
      runId,
      tsFrom,
      tsTo,
      rateValue,
      rateUnit,
      doseValue,
      doseUnit,
      carrierMlPerHr,
      includeInBalance,
      note,
      actor.username,
      now,
      now,
    );
    const segmentId = Number(info.lastInsertRowid);
    const row = db
      .prepare(`SELECT * FROM case_io_segment WHERE id = ?`)
      .get(segmentId);

    writeIoAudit({
      caseId,
      entityType: "segment",
      entityId: segmentId,
      action: "insert",
      beforeJson: null,
      afterJson: row,
      reason,
      actor,
    });

    let autoEvent = null;
    try {
      autoEvent = createAutoCaseEventIfNeeded({
        caseId,
        eventTs: tsFrom,
        itemCategory: run.item_category,
        actor,
        reason: `auto event from io segment (${String(run.item_category || "").trim() || "unknown"})`,
      });
    } catch (autoErr) {
      console.error("[caseRoutes] auto event from io segment failed", autoErr);
    }
    let bloodProductEvent = null;
    try {
      bloodProductEvent = createBloodProductEventIfNeeded({
        caseId,
        eventTs: tsFrom,
        itemCategory: run.item_category,
        itemCode: run.item_code,
        itemName: run.item_name,
        volumeMl: null,
        note,
        actor,
        reason: `blood product event from io segment (${String(run.item_category || "").trim() || "unknown"})`,
      });
    } catch (bloodErr) {
      console.error("[caseRoutes] blood product event from io segment failed", bloodErr);
    }

    res.json({ ok: true, row, auto_event: autoEvent, blood_product_event: bloodProductEvent });
  } catch (err) {
    res.status(400).json({ error: err.message || "io segment create failed" });
  }
});

/* =======================
   IO SEGMENT UPDATE
======================= */
router.put("/:id/io/segments/:segmentId", (req, res) => {
  const caseId = Number(req.params.id);
  const segmentId = Number(req.params.segmentId);
  if (!Number.isFinite(caseId) || !Number.isFinite(segmentId)) {
    return res.status(400).json({ error: "invalid id" });
  }

  const current = db
    .prepare(
      `SELECT
         s.*,
         r.case_id,
         r.kind,
         r.item_id,
         r.started_at,
         r.stopped_at,
         i.code AS item_code
       FROM case_io_segment s
       JOIN case_io_run r ON r.id = s.run_id
       JOIN io_item_master i ON i.id = r.item_id
       WHERE s.id = ? AND r.case_id = ?`
    )
    .get(segmentId, caseId);
  if (!current) return res.status(404).json({ error: "segment not found" });

  const body = req.body || {};
  const hasOwn = key => Object.prototype.hasOwnProperty.call(body, key);

  let tsFrom = current.ts_from;
  if (hasOwn("ts_from")) {
    const raw = body.ts_from;
    const parsed = parseNullableTs(raw);
    if (parsed == null && raw !== null && raw !== "" && raw !== undefined) {
      return res.status(400).json({ error: "ts_from invalid" });
    }
    if (parsed == null) return res.status(400).json({ error: "ts_from required" });
    tsFrom = parsed;
  }

  let tsTo = current.ts_to;
  if (hasOwn("ts_to")) {
    const raw = body.ts_to;
    const parsed = parseNullableTs(raw);
    if (parsed == null && raw !== null && raw !== "" && raw !== undefined) {
      return res.status(400).json({ error: "ts_to invalid" });
    }
    tsTo = parsed;
  }
  if (tsTo != null && tsTo <= tsFrom) {
    return res.status(400).json({ error: "ts_to must be > ts_from" });
  }

  const parseOptionalNumber = (raw, fieldName) => {
    if (raw === undefined) return undefined;
    const parsed = parseNullableNumber(raw);
    if (parsed == null && raw !== null && raw !== "") {
      throw new Error(`${fieldName} invalid`);
    }
    if (parsed != null && parsed < 0) {
      throw new Error(`${fieldName} must be >= 0`);
    }
    return parsed;
  };

  let rateValue = current.rate_value;
  let doseValue = current.dose_value;
  let carrierMlPerHr = current.carrier_ml_per_hr;
  try {
    const nextRate = parseOptionalNumber(body.rate_value, "rate_value");
    if (nextRate !== undefined) rateValue = nextRate;
    const nextDose = parseOptionalNumber(body.dose_value, "dose_value");
    if (nextDose !== undefined) doseValue = nextDose;
    const nextCarrier = parseOptionalNumber(
      body.carrier_ml_per_hr,
      "carrier_ml_per_hr",
    );
    if (nextCarrier !== undefined) carrierMlPerHr = nextCarrier;
  } catch (err) {
    return res.status(400).json({ error: err.message || "invalid number" });
  }

  let rateUnit = current.rate_unit;
  if (hasOwn("rate_unit")) {
    rateUnit = body.rate_unit == null ? null : normalizeRateUnit(body.rate_unit);
  }

  let doseUnit = current.dose_unit;
  if (hasOwn("dose_unit")) {
    doseUnit =
      typeof body.dose_unit === "string" ? body.dose_unit.trim() || null : null;
  }

  const includeInBalance = hasOwn("include_in_balance")
    ? parseBooleanFlag(body.include_in_balance, true)
      ? 1
      : 0
    : current.include_in_balance;
  const note = hasOwn("note")
    ? typeof body.note === "string"
      ? body.note.trim() || null
      : null
    : current.note;

  const newEnd = tsTo ?? 9223372036854775807;
  const overlap = db
    .prepare(
      `SELECT id
       FROM case_io_segment
       WHERE run_id = ?
         AND id <> ?
         AND NOT (
           COALESCE(ts_to, 9223372036854775807) <= ?
           OR ts_from >= ?
         )
       LIMIT 1`
    )
    .get(current.run_id, segmentId, tsFrom, newEnd);
  if (overlap) {
    return res.status(400).json({ error: "segment overlaps existing range" });
  }

  const actor = getActor(req);
  const reason =
    typeof body?.reason === "string" ? body.reason.trim() : "io segment update";
  const update = db.prepare(
    `UPDATE case_io_segment
     SET
       ts_from = ?,
       ts_to = ?,
       rate_value = ?,
       rate_unit = ?,
       dose_value = ?,
       dose_unit = ?,
       carrier_ml_per_hr = ?,
       include_in_balance = ?,
       note = ?,
       updated_at = ?
     WHERE id = ?`
  );

  try {
    const now = Date.now();
    update.run(
      tsFrom,
      tsTo,
      rateValue,
      rateUnit,
      doseValue,
      doseUnit,
      carrierMlPerHr,
      includeInBalance,
      note,
      now,
      segmentId,
    );
    const row = db
      .prepare(`SELECT * FROM case_io_segment WHERE id = ?`)
      .get(segmentId);
    writeIoAudit({
      caseId,
      entityType: "segment",
      entityId: segmentId,
      action: "update",
      beforeJson: current,
      afterJson: row,
      reason,
      actor,
    });
    res.json({ ok: true, row });
  } catch (err) {
    res.status(400).json({ error: err.message || "io segment update failed" });
  }
});

/* =======================
   IO EVENT LIST
======================= */
router.get("/:id/io/events", (req, res) => {
  const caseId = Number(req.params.id);
  if (!Number.isFinite(caseId)) {
    return res.status(400).json({ error: "invalid case id" });
  }

  const caseRow = db
    .prepare(`SELECT start_time, discharge_time, status FROM cases WHERE id=?`)
    .get(caseId);
  if (!caseRow) return res.status(404).json({ error: "not found" });

  const range = resolveCaseRange(caseRow, req.query);
  if (!range) return res.status(400).json({ error: "invalid range" });
  const { fromTs, toTs } = range;

  const rows = db
    .prepare(
      `SELECT
         e.*,
         i.code AS item_code,
         i.name AS item_name,
         i.category AS item_category
       FROM case_io_event e
       JOIN io_item_master i ON i.id = e.item_id
       WHERE e.case_id = ?
         AND e.include_in_balance != 0
         AND e.event_ts BETWEEN ? AND ?
       ORDER BY e.event_ts ASC, e.id ASC`
    )
    .all(caseId, fromTs, toTs);

  res.json({
    case_id: caseId,
    from: fromTs,
    to: toTs,
    rows,
  });
});

/* =======================
   IO EVENT CREATE
======================= */
router.post("/:id/io/events", (req, res) => {
  const caseId = Number(req.params.id);
  if (!Number.isFinite(caseId)) {
    return res.status(400).json({ error: "invalid case id" });
  }

  const caseRow = db.prepare(`SELECT id FROM cases WHERE id=?`).get(caseId);
  if (!caseRow) return res.status(404).json({ error: "not found" });

  const itemId = Number(req.body?.item_id);
  if (!Number.isFinite(itemId)) {
    return res.status(400).json({ error: "item_id required" });
  }
  const item = db
    .prepare(`SELECT id, kind, code, name, category FROM io_item_master WHERE id=?`)
    .get(itemId);
  if (!item) return res.status(400).json({ error: "invalid item_id" });

  const kind = parseIoKind(req.body?.kind) || item.kind;
  if (kind !== item.kind) {
    return res.status(400).json({ error: "kind does not match item" });
  }

  const eventTs = parseNullableTs(req.body?.event_ts) || floorMinute(Date.now());
  const volumeMl = parseNullableNumber(req.body?.volume_ml);
  const doseValue = parseNullableNumber(req.body?.dose_value);
  const doseUnit =
    typeof req.body?.dose_unit === "string"
      ? req.body.dose_unit.trim() || null
      : null;
  const note =
    typeof req.body?.note === "string" ? req.body.note.trim() || null : null;
  const includeInBalance = parseBooleanFlag(req.body?.include_in_balance, true)
    ? 1
    : 0;

  if (volumeMl != null && volumeMl < 0) {
    return res.status(400).json({ error: "volume_ml must be >= 0" });
  }
  if (doseValue != null && doseValue < 0) {
    return res.status(400).json({ error: "dose_value must be >= 0" });
  }
  if (
    includeInBalance &&
    (kind === "fluid" || kind === "output") &&
    (volumeMl == null || !Number.isFinite(volumeMl))
  ) {
    return res.status(400).json({ error: "volume_ml required for fluid/output balance" });
  }

  const actor = getActor(req);
  if (isBloodProductCategory(item.category) && volumeMl != null && volumeMl > 0) {
    const authorizationError = validateBloodGivingAuthorization(caseId, note, actor);
    if (authorizationError) {
      return res.status(400).json({ error: authorizationError });
    }
  }
  const reason =
    typeof req.body?.reason === "string" ? req.body.reason.trim() : null;

  const route =
    typeof req.body?.route === "string" ? req.body.route.trim() || "IV" : "IV";

  const selectExistingBolusRun = db.prepare(
    `SELECT id FROM case_io_run
     WHERE case_id = ? AND item_id = ? AND kind = ? AND entry_mode = 'bolus' AND include_in_balance != 0
     ORDER BY id ASC LIMIT 1`
  );
  const insertBolusRun = db.prepare(
    `INSERT INTO case_io_run
      (case_id, item_id, kind, route, started_at, stopped_at, entry_mode, note, include_in_balance, created_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, NULL, 'bolus', NULL, ?, ?, ?, ?)`
  );
  const insertEvent = db.prepare(
    `INSERT INTO case_io_event
      (
        case_id, item_id, kind, event_ts, volume_ml,
        dose_value, dose_unit, note, include_in_balance,
        created_by, created_at, updated_at
      )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );

  try {
    const now = Date.now();

    // Upsert a bolus run so the timegrid has a row for this item
    const existingRun = selectExistingBolusRun.get(caseId, itemId, kind);
    if (!existingRun) {
      insertBolusRun.run(caseId, itemId, kind, route, eventTs, includeInBalance, actor.username, now, now);
    }

    const info = insertEvent.run(
      caseId,
      itemId,
      kind,
      eventTs,
      volumeMl,
      doseValue,
      doseUnit,
      note,
      includeInBalance,
      actor.username,
      now,
      now,
    );
    const eventId = Number(info.lastInsertRowid);
    const row = db
      .prepare(
        `SELECT
           e.*,
           i.code AS item_code,
           i.name AS item_name,
           i.category AS item_category
         FROM case_io_event e
         JOIN io_item_master i ON i.id = e.item_id
         WHERE e.id = ?`
      )
      .get(eventId);

    writeIoAudit({
      caseId,
      entityType: "event",
      entityId: eventId,
      action: "insert",
      beforeJson: null,
      afterJson: row,
      reason,
      actor,
    });

    let autoEvent = null;
    try {
      autoEvent = createAutoCaseEventIfNeeded({
        caseId,
        eventTs,
        itemCategory: item.category,
        actor,
        reason: `auto event from io event (${String(item.category || "").trim() || "unknown"})`,
      });
    } catch (autoErr) {
      console.error("[caseRoutes] auto event from io event failed", autoErr);
    }
    let bloodProductEvent = null;
    try {
      bloodProductEvent = createBloodProductEventIfNeeded({
        caseId,
        eventTs,
        itemCategory: item.category,
        itemCode: item.code,
        itemName: item.name,
        volumeMl,
        note,
        actor,
        reason: `blood product event from io event (${String(item.category || "").trim() || "unknown"})`,
      });
    } catch (bloodErr) {
      console.error("[caseRoutes] blood product event from io event failed", bloodErr);
    }

    res.json({ ok: true, row, auto_event: autoEvent, blood_product_event: bloodProductEvent });
  } catch (err) {
    res.status(400).json({ error: err.message || "io event create failed" });
  }
});

/* =======================
   IO EVENT DELETE
======================= */
router.delete("/:id/io/events/:eventId", (req, res) => {
  const caseId = Number(req.params.id);
  const eventId = Number(req.params.eventId);
  if (!Number.isFinite(caseId) || !Number.isFinite(eventId)) {
    return res.status(400).json({ error: "invalid id" });
  }

  const current = db
    .prepare(
      `SELECT
         e.*,
         i.code AS item_code,
         i.name AS item_name,
         i.category AS item_category
       FROM case_io_event e
       JOIN io_item_master i ON i.id = e.item_id
       WHERE e.id = ? AND e.case_id = ?`
    )
    .get(eventId, caseId);
  if (!current) return res.status(404).json({ error: "event not found" });

  const actor = getActor(req);
  const reason =
    typeof req.body?.reason === "string" ? req.body.reason.trim() : null;

  try {
    db.prepare(`DELETE FROM case_io_event WHERE id = ?`).run(eventId);

    writeIoAudit({
      caseId,
      entityType: "event",
      entityId: eventId,
      action: "delete",
      beforeJson: current,
      afterJson: null,
      reason,
      actor,
    });

    res.json({ ok: true, deleted: 1 });
  } catch (err) {
    res.status(400).json({ error: err.message || "io event delete failed" });
  }
});

/* =======================
   IO SUMMARY (BALANCE)
======================= */
router.get("/:id/io/summary", (req, res) => {
  const caseId = Number(req.params.id);
  if (!Number.isFinite(caseId)) {
    return res.status(400).json({ error: "invalid case id" });
  }

  const caseRow = db
    .prepare(`SELECT start_time, discharge_time, status FROM cases WHERE id=?`)
    .get(caseId);
  if (!caseRow) return res.status(404).json({ error: "not found" });

  const range = resolveCaseRange(caseRow, req.query);
  if (!range) return res.status(400).json({ error: "invalid range" });
  const { fromTs, toTs } = range;

  const requestedBucketMin = Number(req.query.bucket);
  const bucketMin = Number.isFinite(requestedBucketMin)
    ? Math.max(1, Math.min(60, Math.floor(requestedBucketMin)))
    : 1;
  const bucketMs = bucketMin * 60_000;
  const rangeEndExclusive = toTs + bucketMs;
  const effectiveRangeEndExclusive = Math.min(rangeEndExclusive, Date.now());

  const bucketCount = Math.max(1, Math.floor((toTs - fromTs) / bucketMs) + 1);
  const buckets = Array.from({ length: bucketCount }, (_, i) => ({
    ts_bucket: fromTs + i * bucketMs,
    intake_ml: 0,
    output_ml: 0,
    net_ml: 0,
    cumulative_net_ml: 0,
  }));

  const addVolumeAtTs = (ts, intakeMl, outputMl) => {
    if (!Number.isFinite(ts)) return;
    if (ts < fromTs || ts > toTs) return;
    const idx = Math.floor((ts - fromTs) / bucketMs);
    if (idx < 0 || idx >= buckets.length) return;
    buckets[idx].intake_ml += intakeMl;
    buckets[idx].output_ml += outputMl;
  };

  let totalIntakeMl = 0;
  let totalOutputMl = 0;
  let urineOutputMl = 0;
  let bloodLossMl = 0;
  const itemTotalsMlMap = new Map();
  const normalizeItemToken = value =>
    String(value || "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "");
  const addItemTotalMl = (item, kind, rawAmountMl) => {
    const amountMl = Number(rawAmountMl);
    if (!Number.isFinite(amountMl) || amountMl <= 0) return;
    const rawItemId = Number(item.item_id);
    const hasItemId = Number.isFinite(rawItemId) && rawItemId > 0;
    const itemId = hasItemId ? Math.trunc(rawItemId) : null;
    const itemCode = String(item.item_code || "").trim();
    const itemName = String(item.item_name || "").trim() || itemCode || "Unknown";
    const itemUnit = String(item.item_unit || "").trim();
    const itemCategory = String(item.item_category || "").trim();
    const normalizedKind =
      kind === "fluid" || kind === "med" || kind === "output" ? kind : "med";
    const token = normalizeItemToken(itemCode || itemName) || "unknown";
    const key = itemId != null
      ? `${normalizedKind}|id:${itemId}`
      : `${normalizedKind}|token:${token}`;
    const existing = itemTotalsMlMap.get(key);
    if (existing) {
      existing.total_ml += amountMl;
      return;
    }
    itemTotalsMlMap.set(key, {
      kind: normalizedKind,
      item_id: itemId,
      item_code: itemCode,
      item_name: itemName,
      item_unit: itemUnit,
      item_category: itemCategory,
      total_ml: amountMl,
    });
  };
  const isUrineItem = item => {
    const code = normalizeItemToken(item.item_code);
    const name = normalizeItemToken(item.item_name);
    const category = normalizeItemToken(item.item_category);
    return code === "urine" || name.includes("urine") || category === "urine";
  };
  const isBloodLossItem = item => {
    const code = normalizeItemToken(item.item_code);
    const name = normalizeItemToken(item.item_name);
    const category = normalizeItemToken(item.item_category);
    return (
      code === "bloodloss" ||
      name.includes("bloodloss") ||
      category === "bloodloss"
    );
  };

  const events = db
    .prepare(
      `SELECT
         e.item_id,
         e.event_ts,
         e.kind,
         e.volume_ml,
         e.dose_value,
         e.dose_unit,
         e.include_in_balance,
         i.code AS item_code,
         i.name AS item_name,
         i.default_unit AS item_unit,
         i.category AS item_category
        FROM case_io_event e
       JOIN io_item_master i ON i.id = e.item_id
       WHERE e.case_id = ?
         AND e.event_ts BETWEEN ? AND ?`
    )
    .all(caseId, fromTs, toTs);

  for (const event of events) {
    if (!event.include_in_balance) continue;
    if (event.kind === "med") {
      // Medication administrations belong to drug totals, not fluid balance.
      continue;
    }
    let volumeMl = Number(event.volume_ml);
    if (!Number.isFinite(volumeMl) || volumeMl <= 0) {
      // Bolus rows may be saved via dose_value. If unit is volume (mL/L),
      // include it in fluid balance.
      volumeMl = valueWithUnitToMl(event.dose_value, event.dose_unit);
    }
    if (!Number.isFinite(volumeMl) || volumeMl <= 0) continue;

    if (event.kind === "output") {
      addVolumeAtTs(event.event_ts, 0, volumeMl);
      totalOutputMl += volumeMl;
      addItemTotalMl(event, "output", volumeMl);
      if (isUrineItem(event)) urineOutputMl += volumeMl;
      if (isBloodLossItem(event)) bloodLossMl += volumeMl;
    } else {
      addVolumeAtTs(event.event_ts, volumeMl, 0);
      totalIntakeMl += volumeMl;
      addItemTotalMl(event, event.kind, volumeMl);
    }
  }

  const segments = db
    .prepare(
      `SELECT
         i.id AS item_id,
         s.ts_from,
         s.ts_to,
         s.rate_value,
         s.rate_unit,
         s.carrier_ml_per_hr,
         s.include_in_balance AS seg_include,
         r.kind AS run_kind,
         r.include_in_balance AS run_include,
         r.stopped_at AS run_stopped_at,
         i.code AS item_code,
         i.name AS item_name,
         i.default_unit AS item_unit,
         i.category AS item_category
        FROM case_io_segment s
       JOIN case_io_run r ON r.id = s.run_id
       JOIN io_item_master i ON i.id = r.item_id
       WHERE r.case_id = ?
         AND s.ts_from <= ?
         AND COALESCE(s.ts_to, COALESCE(r.stopped_at, ?)) >= ?`
    )
    .all(caseId, effectiveRangeEndExclusive, effectiveRangeEndExclusive, fromTs);

  for (const segment of segments) {
    if (!segment.seg_include || !segment.run_include) continue;

    const segStart = Math.max(fromTs, Number(segment.ts_from));
    const segEndSource =
      parseNullableTs(segment.ts_to) ??
      parseNullableTs(segment.run_stopped_at) ??
      effectiveRangeEndExclusive;
    const segEnd = Math.min(segEndSource, effectiveRangeEndExclusive);
    if (!Number.isFinite(segStart) || !Number.isFinite(segEnd) || segEnd <= segStart) {
      continue;
    }

    const startIdx = Math.max(0, Math.floor((segStart - fromTs) / bucketMs));
    const endIdx = Math.min(
      buckets.length - 1,
      Math.floor((Math.max(segStart, segEnd - 1) - fromTs) / bucketMs),
    );

    const mlPerHour = rateToMlPerHour(Number(segment.rate_value), segment.rate_unit);
    const carrierMlPerHour = Number.isFinite(Number(segment.carrier_ml_per_hr))
      ? Number(segment.carrier_ml_per_hr)
      : 0;

    for (let idx = startIdx; idx <= endIdx; idx += 1) {
      const bucketStart = fromTs + idx * bucketMs;
      const bucketEnd = bucketStart + bucketMs;
      const overlapStart = Math.max(segStart, bucketStart);
      const overlapEnd = Math.min(segEnd, bucketEnd);
      if (overlapEnd <= overlapStart) continue;

      const hours = (overlapEnd - overlapStart) / 3_600_000;
      const baseMl = mlPerHour == null ? 0 : mlPerHour * hours;
      const carrierMl =
        segment.run_kind === "output" ? 0 : Math.max(0, carrierMlPerHour) * hours;

      if (segment.run_kind === "output") {
        buckets[idx].output_ml += baseMl;
        totalOutputMl += baseMl;
        addItemTotalMl(segment, "output", baseMl);
        if (isUrineItem(segment)) urineOutputMl += baseMl;
        if (isBloodLossItem(segment)) bloodLossMl += baseMl;
      } else {
        buckets[idx].intake_ml += baseMl + carrierMl;
        totalIntakeMl += baseMl + carrierMl;
        addItemTotalMl(segment, segment.run_kind, baseMl);
      }
    }
  }

  let cumulativeNet = 0;
  for (const bucket of buckets) {
    bucket.intake_ml = Number(bucket.intake_ml.toFixed(2));
    bucket.output_ml = Number(bucket.output_ml.toFixed(2));
    bucket.net_ml = Number((bucket.intake_ml - bucket.output_ml).toFixed(2));
    cumulativeNet += bucket.net_ml;
    bucket.cumulative_net_ml = Number(cumulativeNet.toFixed(2));
  }
  const itemTotalsMl = Array.from(itemTotalsMlMap.values())
    .map(row => ({
      kind: row.kind,
      item_id: row.item_id,
      item_code: row.item_code,
      item_name: row.item_name,
      item_unit: row.item_unit,
      item_category: row.item_category,
      total_ml: Number(row.total_ml.toFixed(2)),
    }))
    .sort((a, b) => b.total_ml - a.total_ml || a.item_name.localeCompare(b.item_name));

  res.json({
    case_id: caseId,
    from: fromTs,
    to: toTs,
    bucket_min: bucketMin,
    totals: {
      intake_ml: Number(totalIntakeMl.toFixed(2)),
      output_ml: Number(totalOutputMl.toFixed(2)),
      net_ml: Number((totalIntakeMl - totalOutputMl).toFixed(2)),
      urine_output_ml: Number(urineOutputMl.toFixed(2)),
      blood_loss_ml: Number(bloodLossMl.toFixed(2)),
      item_totals_ml: itemTotalsMl,
    },
    rows: buckets,
  });
});

/* =======================
   IO AUDIT LIST
======================= */
router.get("/:id/io/audit", (req, res) => {
  const caseId = Number(req.params.id);
  if (!Number.isFinite(caseId)) {
    return res.status(400).json({ error: "invalid case id" });
  }

  const caseRow = db
    .prepare(`SELECT start_time, discharge_time, status FROM cases WHERE id=?`)
    .get(caseId);
  if (!caseRow) return res.status(404).json({ error: "not found" });

  const range = resolveCaseRange(caseRow, req.query);
  if (!range) return res.status(400).json({ error: "invalid range" });
  const { fromTs, toTs } = range;

  const rows = db
    .prepare(
      `SELECT *
       FROM case_io_audit
       WHERE case_id = ?
         AND created_at BETWEEN ? AND ?
       ORDER BY created_at ASC, id ASC`
    )
    .all(caseId, fromTs, toTs);

  res.json({
    case_id: caseId,
    from: fromTs,
    to: toTs,
    rows,
  });
});

/* =======================
   VITAL MINUTES
======================= */
router.get("/:id/vitals", (req, res) => {
  const caseId = Number(req.params.id);
  if (!Number.isFinite(caseId)) {
    return res.status(400).json({ error: "invalid case id" });
  }

  const row = db
    .prepare(
      `SELECT start_time, discharge_time, status
       FROM cases WHERE id=?`
    )
    .get(caseId);

  if (!row) return res.status(404).json({ error: "not found" });

  const range = resolveCaseRange(row, req.query);
  if (!range) {
    return res.status(400).json({ error: "invalid range" });
  }
  const { fromTs, toTs } = range;

  const rows = db
    .prepare(
      `SELECT ts_minute, payload
       FROM vital_minutes
       WHERE case_id = ?
         AND ts_minute BETWEEN ? AND ?
       ORDER BY ts_minute ASC`
    )
    .all(caseId, fromTs, toTs);

  const vitals = rows.map(r => {
    let payload = {};
    try {
      payload = JSON.parse(r.payload);
    } catch (e) {
      payload = {};
    }

    return {
      ts_minute: r.ts_minute,
      payload,
    };
  });

  res.json({
    case_id: caseId,
    from: fromTs,
    to: toTs,
    rows: vitals,
  });
});

/* =======================
   CASE EVENT / NOTE LIST
======================= */
router.get("/:id/events", (req, res) => {
  const caseId = Number(req.params.id);
  if (!Number.isFinite(caseId)) {
    return res.status(400).json({ error: "invalid case id" });
  }

  const caseRow = db
    .prepare(
      `SELECT start_time, discharge_time, status
       FROM cases WHERE id=?`
    )
    .get(caseId);
  if (!caseRow) return res.status(404).json({ error: "not found" });

  const range = resolveCaseRange(caseRow, req.query);
  if (!range) {
    return res.status(400).json({ error: "invalid range" });
  }
  const { fromTs, toTs } = range;

  const requestedLimit = Number(req.query.limit);
  const limit = Number.isFinite(requestedLimit)
    ? Math.max(1, Math.min(1000, requestedLimit))
    : 300;

  const rows = db
    .prepare(
      `SELECT
         id,
         event_ts,
         event_type,
         title,
         detail,
         created_by,
         created_at,
         updated_by,
         updated_at
       FROM case_event_note
       WHERE case_id = ?
         AND is_deleted = 0
         AND event_ts BETWEEN ? AND ?
       ORDER BY event_ts DESC, id DESC
       LIMIT ?`
    )
    .all(caseId, fromTs, toTs, limit);

  res.json({
    case_id: caseId,
    from: fromTs,
    to: toTs,
    rows,
  });
});

/* =======================
   CASE EVENT / NOTE CREATE
======================= */
router.post("/:id/events", (req, res) => {
  const caseId = Number(req.params.id);
  if (!Number.isFinite(caseId)) {
    return res.status(400).json({ error: "invalid case id" });
  }

  const caseExists = db.prepare(`SELECT id FROM cases WHERE id=?`).get(caseId);
  if (!caseExists) return res.status(404).json({ error: "not found" });

  const title = String(req.body?.title || "").trim();
  if (!title) {
    return res.status(400).json({ error: "title required" });
  }

  const detail =
    typeof req.body?.detail === "string" ? req.body.detail.trim() || null : null;
  const eventTsRaw = Number(req.body?.event_ts);
  const eventTs = Number.isFinite(eventTsRaw) ? eventTsRaw : Date.now();
  const eventType = normalizeEventType(req.body?.event_type);
  const lifecycleError = validateLifecycleTransition({
    caseId,
    eventType,
    title,
    eventTs,
  });
  if (lifecycleError) {
    return res.status(400).json({ error: lifecycleError });
  }

  const actorUsername =
    String(req.body?.actor?.username || "").trim() || "unknown";
  const actorName =
    String(req.body?.actor?.name || "").trim() || null;
  const actorRole =
    String(req.body?.actor?.role || "").trim() || null;
  const reason =
    typeof req.body?.reason === "string" ? req.body.reason.trim() : null;

  const insertEvent = db.prepare(
    `INSERT INTO case_event_note
      (
        case_id, event_ts, event_type, title, detail,
        created_by, created_at, updated_by, updated_at, is_deleted
      )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`
  );
  const insertAudit = db.prepare(
    `INSERT INTO case_event_note_audit
      (
        case_id, event_note_id, action,
        old_event_ts, old_event_type, old_title, old_detail,
        new_event_ts, new_event_type, new_title, new_detail,
        reason, actor_username, actor_name, actor_role, created_at
      )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );

  const tx = db.transaction(() => {
    const now = Date.now();
    const info = insertEvent.run(
      caseId,
      eventTs,
      eventType,
      title,
      detail,
      actorUsername,
      now,
      actorUsername,
      now,
    );
    const eventId = Number(info.lastInsertRowid);

    insertAudit.run(
      caseId,
      eventId,
      "insert",
      null,
      null,
      null,
      null,
      eventTs,
      eventType,
      title,
      detail,
      reason,
      actorUsername,
      actorName,
      actorRole,
      now,
    );

    return { id: eventId, created_at: now };
  });

  try {
    const created = tx();
    res.json({
      ok: true,
      case_id: caseId,
      id: created.id,
      event_ts: eventTs,
      event_type: eventType,
      title,
      detail,
      created_by: actorUsername,
      created_at: created.created_at,
    });
  } catch (err) {
    res.status(400).json({ error: err.message || "event create failed" });
  }
});

/* =======================
   CASE EVENT / NOTE UPDATE
======================= */
router.put("/:id/events/:eventId", (req, res) => {
  const caseId = Number(req.params.id);
  const eventId = Number(req.params.eventId);
  if (!Number.isFinite(caseId) || !Number.isFinite(eventId)) {
    return res.status(400).json({ error: "invalid id" });
  }

  const current = db
    .prepare(
      `SELECT *
       FROM case_event_note
       WHERE id = ? AND case_id = ? AND is_deleted = 0`
    )
    .get(eventId, caseId);

  if (!current) return res.status(404).json({ error: "event not found" });

  const nextTitle =
    req.body?.title == null
      ? current.title
      : String(req.body.title).trim();
  if (!nextTitle) {
    return res.status(400).json({ error: "title required" });
  }

  const nextDetail =
    req.body?.detail == null
      ? current.detail
      : (String(req.body.detail).trim() || null);
  const eventTsRaw = Number(req.body?.event_ts);
  const nextEventTs = Number.isFinite(eventTsRaw) ? eventTsRaw : current.event_ts;
  const nextType =
    req.body?.event_type == null
      ? current.event_type
      : normalizeEventType(req.body.event_type);

  const same =
    current.title === nextTitle &&
    (current.detail || null) === (nextDetail || null) &&
    current.event_ts === nextEventTs &&
    current.event_type === nextType;
  if (same) {
    return res.json({ ok: true, updated: 0 });
  }

  const lifecycleError = validateLifecycleTransition({
    caseId,
    eventType: nextType,
    title: nextTitle,
    eventTs: nextEventTs,
    excludeEventId: eventId,
  });
  if (lifecycleError) {
    return res.status(400).json({ error: lifecycleError });
  }

  const actorUsername =
    String(req.body?.actor?.username || "").trim() || "unknown";
  const actorName =
    String(req.body?.actor?.name || "").trim() || null;
  const actorRole =
    String(req.body?.actor?.role || "").trim() || null;
  const reason =
    typeof req.body?.reason === "string" ? req.body.reason.trim() : null;

  const updateEvent = db.prepare(
    `UPDATE case_event_note
      SET event_ts=?, event_type=?, title=?, detail=?,
          updated_by=?, updated_at=?
      WHERE id=?`
  );
  const insertAudit = db.prepare(
    `INSERT INTO case_event_note_audit
      (
        case_id, event_note_id, action,
        old_event_ts, old_event_type, old_title, old_detail,
        new_event_ts, new_event_type, new_title, new_detail,
        reason, actor_username, actor_name, actor_role, created_at
      )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );

  const tx = db.transaction(() => {
    const now = Date.now();
    updateEvent.run(
      nextEventTs,
      nextType,
      nextTitle,
      nextDetail,
      actorUsername,
      now,
      eventId,
    );

    insertAudit.run(
      caseId,
      eventId,
      "update",
      current.event_ts,
      current.event_type,
      current.title,
      current.detail,
      nextEventTs,
      nextType,
      nextTitle,
      nextDetail,
      reason,
      actorUsername,
      actorName,
      actorRole,
      now,
    );
  });

  try {
    tx();
    res.json({ ok: true, updated: 1 });
  } catch (err) {
    res.status(400).json({ error: err.message || "event update failed" });
  }
});

/* =======================
   CASE EVENT / NOTE DELETE
======================= */
router.delete("/:id/events/:eventId", (req, res) => {
  const caseId = Number(req.params.id);
  const eventId = Number(req.params.eventId);
  if (!Number.isFinite(caseId) || !Number.isFinite(eventId)) {
    return res.status(400).json({ error: "invalid id" });
  }

  const current = db
    .prepare(
      `SELECT *
       FROM case_event_note
       WHERE id = ? AND case_id = ? AND is_deleted = 0`
    )
    .get(eventId, caseId);

  if (!current) return res.status(404).json({ error: "event not found" });

  const actorUsername =
    String(req.body?.actor?.username || "").trim() || "unknown";
  const actorName =
    String(req.body?.actor?.name || "").trim() || null;
  const actorRole =
    String(req.body?.actor?.role || "").trim() || null;
  const reason =
    typeof req.body?.reason === "string" ? req.body.reason.trim() : null;

  const deleteEvent = db.prepare(
    `UPDATE case_event_note
      SET is_deleted=1, updated_by=?, updated_at=?
      WHERE id=?`
  );
  const insertAudit = db.prepare(
    `INSERT INTO case_event_note_audit
      (
        case_id, event_note_id, action,
        old_event_ts, old_event_type, old_title, old_detail,
        new_event_ts, new_event_type, new_title, new_detail,
        reason, actor_username, actor_name, actor_role, created_at
      )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );

  const tx = db.transaction(() => {
    const now = Date.now();
    deleteEvent.run(actorUsername, now, eventId);
    insertAudit.run(
      caseId,
      eventId,
      "delete",
      current.event_ts,
      current.event_type,
      current.title,
      current.detail,
      null,
      null,
      null,
      null,
      reason,
      actorUsername,
      actorName,
      actorRole,
      now,
    );
  });

  try {
    tx();
    res.json({ ok: true, deleted: 1 });
  } catch (err) {
    res.status(400).json({ error: err.message || "event delete failed" });
  }
});

/* =======================
   TIMELINE (CURRENT MANUAL/OVERRIDE)
======================= */
router.get("/:id/timeline", (req, res) => {
  const caseId = Number(req.params.id);
  if (!Number.isFinite(caseId)) {
    return res.status(400).json({ error: "invalid case id" });
  }

  const caseRow = db
    .prepare(
      `SELECT start_time, discharge_time, status
       FROM cases WHERE id=?`
    )
    .get(caseId);

  if (!caseRow) return res.status(404).json({ error: "not found" });

  const range = resolveCaseRange(caseRow, req.query);
  if (!range) {
    return res.status(400).json({ error: "invalid range" });
  }
  const { fromTs, toTs } = range;

  const rows = db
    .prepare(
      `SELECT
         ts_minute,
         param_key,
         value_type,
         value_num,
         value_text,
         unit,
         source,
         note,
         updated_by,
         updated_at
       FROM case_timeline_value
       WHERE case_id = ?
         AND ts_minute BETWEEN ? AND ?
       ORDER BY ts_minute ASC, param_key ASC`
    )
    .all(caseId, fromTs, toTs)
    .map(r => ({
      ts_minute: r.ts_minute,
      param_key: r.param_key,
      value_type: r.value_type,
      value: r.value_type === "number" ? r.value_num : r.value_text,
      unit: r.unit,
      source: r.source,
      note: r.note,
      updated_by: r.updated_by,
      updated_at: r.updated_at,
    }));

  res.json({
    case_id: caseId,
    from: fromTs,
    to: toTs,
    rows,
  });
});

/* =======================
   TIMELINE EFFECTIVE (RAW + MANUAL OVERRIDE)
======================= */
router.get("/:id/timeline/effective", (req, res) => {
  const caseId = Number(req.params.id);
  if (!Number.isFinite(caseId)) {
    return res.status(400).json({ error: "invalid case id" });
  }

  const caseRow = db
    .prepare(
      `SELECT start_time, discharge_time, status
       FROM cases WHERE id=?`
    )
    .get(caseId);

  if (!caseRow) return res.status(404).json({ error: "not found" });

  const range = resolveCaseRange(caseRow, req.query);
  if (!range) {
    return res.status(400).json({ error: "invalid range" });
  }
  const { fromTs, toTs } = range;

  const rawRows = db
    .prepare(
      `SELECT ts_minute, payload
       FROM vital_minutes
       WHERE case_id = ?
         AND ts_minute BETWEEN ? AND ?
       ORDER BY ts_minute ASC`
    )
    .all(caseId, fromTs, toTs);

  const manualRows = db
    .prepare(
      `SELECT ts_minute, param_key, value_type, value_num, value_text
       FROM case_timeline_value
       WHERE case_id = ?
         AND ts_minute BETWEEN ? AND ?
       ORDER BY ts_minute ASC, param_key ASC`
    )
    .all(caseId, fromTs, toTs);

  const byMinute = new Map();

  for (const row of rawRows) {
    let payload = {};
    try {
      payload = JSON.parse(row.payload);
    } catch (e) {
      payload = {};
    }
    byMinute.set(row.ts_minute, payload);
  }

  for (const row of manualRows) {
    const payload = byMinute.get(row.ts_minute) || {};
    payload[row.param_key] =
      row.value_type === "number" ? row.value_num : row.value_text;
    byMinute.set(row.ts_minute, payload);
  }

  const rows = Array.from(byMinute.entries())
    .map(([ts_minute, payload]) => ({ ts_minute, payload }))
    .sort((a, b) => a.ts_minute - b.ts_minute);

  res.json({
    case_id: caseId,
    from: fromTs,
    to: toTs,
    rows,
  });
});

/* =======================
   TIMELINE AUDIT
======================= */
router.get("/:id/timeline/audit", (req, res) => {
  const caseId = Number(req.params.id);
  if (!Number.isFinite(caseId)) {
    return res.status(400).json({ error: "invalid case id" });
  }

  const caseRow = db
    .prepare(
      `SELECT start_time, discharge_time, status
       FROM cases WHERE id=?`
    )
    .get(caseId);

  if (!caseRow) return res.status(404).json({ error: "not found" });

  const range = resolveCaseRange(caseRow, req.query);
  if (!range) {
    return res.status(400).json({ error: "invalid range" });
  }
  const { fromTs, toTs } = range;

  const rows = db
    .prepare(
      `SELECT *
       FROM case_timeline_audit
       WHERE case_id = ?
         AND ts_minute BETWEEN ? AND ?
       ORDER BY created_at ASC, id ASC`
    )
    .all(caseId, fromTs, toTs);

  res.json({
    case_id: caseId,
    from: fromTs,
    to: toTs,
    rows,
  });
});

/* =======================
   TIMELINE UPSERT/DELETE (MANUAL)
======================= */
router.put("/:id/timeline", (req, res) => {
  const caseId = Number(req.params.id);
  if (!Number.isFinite(caseId)) {
    return res.status(400).json({ error: "invalid case id" });
  }

  const caseExists = db
    .prepare(`SELECT id FROM cases WHERE id=?`)
    .get(caseId);
  if (!caseExists) return res.status(404).json({ error: "not found" });

  const changes = Array.isArray(req.body?.changes) ? req.body.changes : [];
  if (changes.length === 0) {
    return res.status(400).json({ error: "changes required" });
  }

  const actorUsername =
    String(req.body?.actor?.username || "").trim() || "unknown";
  const actorName =
    String(req.body?.actor?.name || "").trim() || null;
  const actorRole =
    String(req.body?.actor?.role || "").trim() || null;
  const reason =
    typeof req.body?.reason === "string" ? req.body.reason.trim() : null;

  const selectCurrent = db.prepare(
    `SELECT *
     FROM case_timeline_value
     WHERE case_id=? AND ts_minute=? AND param_key=?`
  );
  const insertCurrent = db.prepare(
    `INSERT INTO case_timeline_value
      (
        case_id, ts_minute, param_key,
        value_type, value_num, value_text,
        unit, source, note,
        created_by, updated_by, created_at, updated_at
      )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const updateCurrent = db.prepare(
    `UPDATE case_timeline_value
      SET value_type=?, value_num=?, value_text=?,
          unit=?, source=?, note=?,
          updated_by=?, updated_at=?
      WHERE id=?`
  );
  const deleteCurrent = db.prepare(
    `DELETE FROM case_timeline_value
     WHERE id=?`
  );
  const insertAudit = db.prepare(
    `INSERT INTO case_timeline_audit
      (
        case_id, ts_minute, param_key, action,
        old_value_num, old_value_text, old_value_type,
        new_value_num, new_value_text, new_value_type,
        unit, source, note,
        reason, actor_username, actor_name, actor_role, created_at
      )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );

  const tx = db.transaction(items => {
    const now = Date.now();
    let inserted = 0;
    let updated = 0;
    let deleted = 0;
    let skipped = 0;

    for (const item of items) {
      const tsRaw = Number(item.ts_minute);
      if (!Number.isFinite(tsRaw)) {
        throw new Error("invalid ts_minute");
      }
      const tsMinute = floorMinute(tsRaw);

      const paramKey = normalizeParamKey(item.param_key);
      if (!paramKey) {
        throw new Error("param_key required");
      }

      const old = selectCurrent.get(caseId, tsMinute, paramKey);
      const action =
        item.action === "delete" ||
        item.value === undefined ||
        item.value === null ||
        item.value === ""
          ? "delete"
          : "upsert";

      if (action === "delete") {
        if (!old) {
          skipped += 1;
          continue;
        }

        deleteCurrent.run(old.id);
        insertAudit.run(
          caseId,
          tsMinute,
          paramKey,
          "delete",
          old.value_num,
          old.value_text,
          old.value_type,
          null,
          null,
          null,
          old.unit,
          old.source,
          old.note,
          reason,
          actorUsername,
          actorName,
          actorRole,
          now,
        );
        deleted += 1;
        continue;
      }

      const next = normalizeValueInput(paramKey, item.value, item.value_type);
      if (!next) {
        skipped += 1;
        continue;
      }

      const unit =
        typeof item.unit === "string" && item.unit.trim()
          ? item.unit.trim()
          : old?.unit || null;
      const note =
        typeof item.note === "string"
          ? item.note.trim() || null
          : old?.note || null;
      const source = normalizeSource(item.source || old?.source);

      if (!old) {
        insertCurrent.run(
          caseId,
          tsMinute,
          paramKey,
          next.valueType,
          next.valueNum,
          next.valueText,
          unit,
          source,
          note,
          actorUsername,
          actorUsername,
          now,
          now,
        );
        insertAudit.run(
          caseId,
          tsMinute,
          paramKey,
          "insert",
          null,
          null,
          null,
          next.valueNum,
          next.valueText,
          next.valueType,
          unit,
          source,
          note,
          reason,
          actorUsername,
          actorName,
          actorRole,
          now,
        );
        inserted += 1;
        continue;
      }

      const sameValue =
        old.value_type === next.valueType &&
        old.value_num === next.valueNum &&
        old.value_text === next.valueText &&
        (old.unit || null) === unit &&
        (old.source || null) === source &&
        (old.note || null) === note;

      if (sameValue) {
        skipped += 1;
        continue;
      }

      updateCurrent.run(
        next.valueType,
        next.valueNum,
        next.valueText,
        unit,
        source,
        note,
        actorUsername,
        now,
        old.id,
      );

      insertAudit.run(
        caseId,
        tsMinute,
        paramKey,
        "update",
        old.value_num,
        old.value_text,
        old.value_type,
        next.valueNum,
        next.valueText,
        next.valueType,
        unit,
        source,
        note,
        reason,
        actorUsername,
        actorName,
        actorRole,
        now,
      );
      updated += 1;
    }

    return { inserted, updated, deleted, skipped };
  });

  try {
    const summary = tx(changes);
    res.json({ ok: true, ...summary });
  } catch (err) {
    res.status(400).json({ error: err.message || "timeline update failed" });
  }
});

/* =======================
   TIME AXIS
======================= */
router.get("/:id/timeaxis", (req, res) => {
  const caseId = Number(req.params.id);
  const stepMin = Math.max(1, Number(req.query.step) || 1);
  const ADVANCE_MIN = 5;

  const row = db
    .prepare(
      `SELECT start_time, discharge_time, status
       FROM cases WHERE id=?`
    )
    .get(caseId);

  if (!row) return res.status(404).json({ error: "not found" });

  const startTs = floorMinute(row.start_time);
  const endTs =
    row.status === "active"
      ? floorMinute(Date.now() + ADVANCE_MIN * 60000)
      : floorMinute(row.discharge_time);

  const axis = [];
  const stepMs = stepMin * 60000;

  for (let ts = startTs; ts <= endTs; ts += stepMs) {
    axis.push(ts);
  }

  res.json({ case_id: caseId, axis });
});

/* =======================
   MINUTE WRITER STATUS / CONTROL
======================= */
router.get("/:id/writer-status", (req, res) => {
  const caseId = Number(req.params.id);
  if (!Number.isFinite(caseId)) return res.status(400).json({ error: "invalid id" });
  const all = getMinuteWriterStatus();
  const writer = all.find(w => w.caseId === caseId) || null;
  res.json({ caseId, writer });
});

router.post("/:id/writer-refetch", (req, res) => {
  const caseId = Number(req.params.id);
  if (!Number.isFinite(caseId)) return res.status(400).json({ error: "invalid id" });

  const row = db
    .prepare(`SELECT start_time FROM cases WHERE id = ? AND status = 'active'`)
    .get(caseId);
  if (!row) return res.status(404).json({ error: "case not found or not active" });

  const ok = rewindMinuteWriter(caseId, row.start_time);
  if (!ok) return res.status(500).json({ error: "rewind failed" });

  res.json({ ok: true, rewoundTo: row.start_time });
});

module.exports = router;
