import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { updateCaseStartTime, type CaseStatus } from "../api/caseApi";
import ClinicalTimelineAxis from "../components/clinical-timeline/ClinicalTimelineAxis";
import ClinicalTimelineGrid, {
  type ClinicalTimelineEventMarker,
  type ClinicalTimelineIoMarker,
} from "../components/clinical-timeline/ClinicalTimelineGrid";
import type { ClinicalTimelineRow, ClinicalTimelineValues } from "../components/clinical-timeline/types";
import VitalSignsTrendChart, { type VitalGroup } from "../components/vitals/VitalSignsTrendChart";
import { useClinicalTimelineAxis } from "../hooks/useClinicalTimelineAxis";
import { useVitalMinutes } from "../hooks/useVitalMinutes";
import { useWorkstationSettings } from "../hooks/useWorkstationSettings";
import { formatConfiguredDateTime, type DateTimePreferences } from "../utils/dateTime";
import {
  formatPatientDisplayName,
  normalizePatientNameLanguage,
} from "../utils/patientName";
import { useCaseEvents } from "../hooks/useCaseEvents";
import {
  getCaseDiagnosis,
  getCaseProcedures,
  type CaseDiagnosisRow,
  type CaseProcedureRow,
} from "../api/caseClinicalApi";
import type { AuthUser } from "../auth/useAuth";
import type { TimelineCellProvenance, TimelineChange, TimelineProvenance } from "../api/vitalMinutesApi";
import { putTimelineChanges } from "../api/vitalMinutesApi";
import {
  createCaseEvent,
  deleteCaseEvent,
  getCaseEvents,
  updateCaseEvent,
  type CaseEvent,
  type CaseEventType,
} from "../api/caseEventApi";
import {
  createCaseIoRun,
  createCaseIoEvent,
  createCaseIoDrip,
  createCaseIoBloodProduct,
  deleteCaseIoEvent,
  getCaseIoItems,
  getCaseIoEvents,
  getCaseIoRuns,
  updateCaseIoRun,
  updateCaseIoSegment,
  createCaseIoSegment,
  type CaseIoItem,
  type CaseIoEvent,
  type CaseIoRun,
  type IoKind,
} from "../api/caseIoApi";
import { createIoCatalogEntry } from "../api/ioCatalogApi";
import {
  createCaseAllergy,
  deleteCaseAllergy,
  getCaseBloodProducts,
  getCaseAllergies,
  getCasePatientInfo,
  updateCaseAllergy,
  verifyCaseBloodProduct,
  type CaseAllergyRow,
  type CasePatientInfo,
  type BloodProductVerificationResult,
} from "../api/caseHisApi";
import { getCaseStaff, type StaffMember } from "../api/staffApi";
import { getObservationParameters, type ObservationParameter } from "../api/terminologyApi";
import {
  BASE_IVY_ROWS,
  COMMON_EVENT_OPTIONS,
  getEventIconByTitle,
  getRowGroup,
  isAutoEventTitle,
  MANUAL_EVENT_BUTTON_LAYOUT,
  makeFallbackLabel,
  normalizeLifecycleTitle,
  parseLifecycleEventTitle,
  ROW_META,
  type AxisStepMin,
  type RowGroup,
} from "./clinical-chart/constants";
import {
  getHiddenRowsStorageKey,
  getSectionCollapseStorageKey,
  getTimelineScaleStorageKey,
  getVisibleRowsStorageKey,
  readHiddenRowsForUser,
  readSectionCollapseForUser,
  readStoredUsername,
  readTimelineScaleForUser,
  readVisibleRowsForUser,
} from "./clinical-chart/storage";
import {
  formatHHMM,
  mergeValues,
  normalizeHHMM,
  toTsOnSameDate,
} from "./clinical-chart/utils";
import {
  formatDateInputDDMMYYYY,
  formatTimeInputHHMM,
  normalizeDateInputDDMMYYYY,
  normalizeTimeInputHHMM,
} from "../utils/clinicalInput";
import HeaderCard from "../components/case/HeaderCard";
import ClinicalReferenceTooltip from "../components/common/ClinicalReferenceTooltip";
import IoSpriteIcon from "../components/io/IoSpriteIcon";
import MedicationBolusEntryModal from "../components/io/MedicationBolusEntryModal";
import {
  getHistoricalDripSuggestion,
  POPULAR_DRIP_MEDICATIONS,
} from "../utils/medicationDrip";
import allergyCardIcon from "../assets/card-allergy.png";
import patientCardIcon from "../assets/card-patient.png";
import timeCardIcon from "../assets/card-time.png";
import diagnosisCardIcon from "../assets/card-diagnosis.png";
import procedureCardIcon from "../assets/card-procedure.png";
import { clampEditionTimelineScale, getEditionInfo, isTimelineParamAllowed } from "../edition/config";
import {
  CHART_PREFERENCES_CHANGED_EVENT,
  chartVisibilityStorageKey,
  normalizeDripGroupColors,
  normalizeChartGroups,
  normalizeFutureColumns,
  readLocalDripGroupColors,
  readLocalFutureColumns,
  readLocalSmartContrast,
  type DripGroupColors,
} from "../utils/chartPreferences";
import { getHistoricalBolusSuggestion } from "../utils/medicationBolus";

type IoPreparedModalState = {
  runId: number;
  itemId: number;
  kind: IoKind;
  itemName: string;
  itemUnit: string;
  ts: number;
  entryMode?: "bolus" | "drip" | null;
};

type IoDripModalState = {
  runId: number;
  segmentId?: number;
  kind: IoKind;
  itemName: string;
  itemUnit: string;
  ts: number;
};

type IoDripPart = "start" | "mid" | "end" | "single";

type BloodBoardLocalStatus =
  | "Available"
  | "Received in OR"
  | "Warming"
  | "Giving recorded"
  | "Completed"
  | "Stopped / Reaction";

function parameterReferenceTooltip(parameter: ObservationParameter) {
  const lines = [
    parameter.display_name || parameter.local_name || parameter.short_name,
    `Local ID: ${parameter.local_id || parameter.param_key}`,
  ];
  if (parameter.unit) lines.push(`Unit: ${parameter.unit}`);
  const loinc = parameter.codings?.LOINC;
  const snomed = parameter.codings?.SNOMED_CT;
  lines.push(`LOINC: ${loinc?.code ? `${loinc.code}${loinc.display ? ` — ${loinc.display}` : ""}` : "Not mapped"}`);
  lines.push(`SNOMED CT: ${snomed?.code ? `${snomed.code}${snomed.display ? ` — ${snomed.display}` : ""}` : "Not mapped"}`);
  return lines.join("\n");
}

function parameterChartTooltip(parameter: ObservationParameter) {
  const lines = [parameter.display_name || parameter.local_name || parameter.short_name];
  const loinc = parameter.codings?.LOINC;
  const snomed = parameter.codings?.SNOMED_CT;
  const codes = [
    loinc?.code ? `LOINC ${loinc.code}` : "",
    snomed?.code ? `SNOMED CT ${snomed.code}` : "",
    parameter.unit ? `UCUM ${parameter.unit}` : "",
  ].filter(Boolean);
  if (codes.length > 0) lines.push(codes.join(" · "));
  return lines.join("\n");
}

type BloodGivingAuthorization = {
  mode: "self" | "supervised";
  name: string;
  username?: string;
};

function formatHHMMSS(ts: number) {
  const date = new Date(ts);
  return [date.getHours(), date.getMinutes(), date.getSeconds()]
    .map(value => String(value).padStart(2, "0"))
    .join(":");
}

type CaseHeaderCardId = "los" | "patient" | "allergy" | "diagnosis" | "operation";
type SummaryDock = "top" | "left" | "bottom" | "right";
const DEFAULT_CASE_HEADER_ORDER: CaseHeaderCardId[] = ["los", "patient", "allergy", "diagnosis", "operation"];

function SummaryDockIcon({ position }: { position: SummaryDock }) {
  const bar = {
    top: <path d="M5 6h14v3H5z" fill="currentColor" stroke="none" />,
    left: <path d="M5 5h3v14H5z" fill="currentColor" stroke="none" />,
    bottom: <path d="M5 15h14v3H5z" fill="currentColor" stroke="none" />,
    right: <path d="M16 5h3v14h-3z" fill="currentColor" stroke="none" />,
  }[position];
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
      <rect x="3.5" y="3.5" width="17" height="17" rx="2" />
      {bar}
    </svg>
  );
}

function caseHeaderOrderStorageKey(username: string) {
  return `flora.caseHeaderOrder.${username || "default"}`;
}

function readCaseHeaderOrder(username: string): CaseHeaderCardId[] {
  if (typeof window === "undefined") return DEFAULT_CASE_HEADER_ORDER;
  try {
    const parsed = JSON.parse(window.localStorage.getItem(caseHeaderOrderStorageKey(username)) || "[]") as unknown[];
    const allowed = new Set<CaseHeaderCardId>(DEFAULT_CASE_HEADER_ORDER);
    const valid = parsed.filter((value): value is CaseHeaderCardId => allowed.has(value as CaseHeaderCardId));
    return valid.length === DEFAULT_CASE_HEADER_ORDER.length && new Set(valid).size === valid.length
      ? valid
      : DEFAULT_CASE_HEADER_ORDER;
  } catch {
    return DEFAULT_CASE_HEADER_ORDER;
  }
}

type EforlBloodBoardCondition = "Frozen" | "Warmed";
type EforlBloodBoardStage = "Pending" | "Received in OR" | "Warmed" | "Given";

type EforlBloodBoardRow = BloodProductVerificationResult & {
  hisStatus: string;
  orStage: EforlBloodBoardStage;
  receiveCondition: EforlBloodBoardCondition | "";
  givenAmountMl: string;
};

const EFORL_BLOOD_BOARD_TEMPLATE: Array<{
  reqno: string;
  bdtype: string;
  dnrno: string;
  bloodgrp: string;
  rh: string;
  hisStatus: string;
}> = [
  { reqno: "REQ-260612-01", bdtype: "LPRC", dnrno: "BB-LPRC-470128", bloodgrp: "A", rh: "+", hisStatus: "Ready" },
  { reqno: "REQ-260612-02", bdtype: "LPRC", dnrno: "BB-LPRC-470129", bloodgrp: "A", rh: "+", hisStatus: "Ready" },
  { reqno: "REQ-260612-03", bdtype: "FFP", dnrno: "BB-FFP-882341", bloodgrp: "A", rh: "+", hisStatus: "Ready" },
  { reqno: "REQ-260612-04", bdtype: "Platelet", dnrno: "BB-PLT-130774", bloodgrp: "A", rh: "+", hisStatus: "Dispensed" },
  { reqno: "REQ-260612-05", bdtype: "Cryoprecipitate", dnrno: "BB-CRYO-510662", bloodgrp: "A", rh: "+", hisStatus: "Dispensed" },
];

type IoGridCellValue = {
  kind: "io_cell";
  amount?: number;
  dripPart?: IoDripPart;
  dripGroupTone?: string;
  dripRateMlPerHr?: number;
  dripCarrierMlPerHr?: number;
  dripBucketVolumeMl?: number;
  dripCumulativeVolumeMl?: number;
  segmentId?: number;
  segmentTsFrom?: number;
  segmentTsTo?: number | null;
  segmentDoseValue?: number | null;
  segmentDoseUnit?: string | null;
  segmentRateUnit?: string | null;
  segmentNote?: string | null;
  minuteValues?: Array<{ ts: number; amount: number }>;
};

const isIoGridCellValue = (value: unknown): value is IoGridCellValue =>
  Boolean(
    value &&
      typeof value === "object" &&
      "kind" in (value as Record<string, unknown>) &&
      (value as { kind?: unknown }).kind === "io_cell",
  );

const isVisibleIoSegment = (segment: { include_in_balance?: number; rate_value?: number | null; dose_value?: number | null; carrier_ml_per_hr?: number | null }) => {
  const include =
    segment.include_in_balance == null || Number(segment.include_in_balance) !== 0;
  if (!include) return false;
  return (
    (Number.isFinite(Number(segment.rate_value)) && Number(segment.rate_value) > 0) ||
    (Number.isFinite(Number(segment.dose_value)) && Number(segment.dose_value) > 0) ||
    (Number.isFinite(Number(segment.carrier_ml_per_hr)) && Number(segment.carrier_ml_per_hr) > 0)
  );
};

const formatDripMarkerDetail = (
  run: Pick<CaseIoRun, "kind" | "item_name" | "item_code" | "item_unit">,
  segment: {
    rate_value?: number | null;
    rate_unit?: string | null;
    dose_value?: number | null;
    dose_unit?: string | null;
    carrier_ml_per_hr?: number | null;
  },
) => {
  const name = String(run.item_name || run.item_code || "Drip").trim() || "Drip";
  const parts: string[] = [];
  const doseValue = Number(segment.dose_value);
  const rateValue = Number(segment.rate_value);
  const carrierValue = Number(segment.carrier_ml_per_hr);

  if (Number.isFinite(doseValue) && doseValue > 0) {
    const doseUnit = String(segment.dose_unit || run.item_unit || "").trim();
    parts.push(`${doseValue} ${doseUnit}`.trim());
  }
  if (Number.isFinite(rateValue) && rateValue > 0) {
    const rateUnit = String(segment.rate_unit || "mL/hr").trim() || "mL/hr";
    parts.push(`${rateValue} ${rateUnit}`.trim());
  }
  if (Number.isFinite(carrierValue) && carrierValue > 0) {
    parts.push(`carrier ${carrierValue} mL/hr`);
  }

  return parts.length > 0
    ? `Drip started: ${name} (${parts.join(" | ")})`
    : `Drip started: ${name}`;
};

const ioTimelineRowIdForRun = (
  run: Pick<CaseIoRun, "id" | "item_id" | "kind" | "entry_mode">,
) => {
  const mode = run.entry_mode === "drip" ? "drip" : "bolus";
  if (mode === "bolus") return `io_run_group_${run.kind}_${mode}_${run.item_id}`;
  if (run.kind === "fluid") return `io_run_group_${run.kind}_${mode}_${run.item_id}`;
  return `io_run_${run.id}`;
};

const GE750_AUTOSHOW_ROW_IDS = [
  "fio2",
  "fio2_meas",
  "fi_co2",
  "et_o2",
  "fi_agent",
  "et_agent",
  "mac",
  "tidal_volume_exp",
  "minute_volume_exp",
  "airway_pressure_peak",
  "airway_pressure_plateau",
  "airway_pressure_mean",
  "airway_pressure_min",
  "peep_total",
  "compliance",
  "set_tidal_volume",
  "set_rr",
  "set_ie_ratio",
  "set_insp_pause_pct",
  "set_vent_mode",
  "set_peep",
  "set_insp_pressure",
  "set_peak_limit",
  "set_psupp",
  "set_flow_trigger",
  "set_end_flow",
  "set_t_insp",
  "set_fio2",
  "set_fgf_total",
  "alarm_hi_vte",
  "alarm_lo_mv",
  "alarm_hi_mv",
  "alarm_lo_vte",
  "alarm_hi_fio2",
  "alarm_lo_fio2",
] as const;

const CASEVIEW_ROUTE_OPTIONS = [
  "IV",
  "Local",
  "Spinal",
  "Epidural",
  "PNB",
  "Local infiltration",
  "Caudal",
  "IM",
  "SC",
] as const;

const DEFAULT_CASEVIEW_ROUTE = "IV";
const DEFAULT_CASEVIEW_LOCAL_ROUTE = "Local";

const CASEVIEW_UOM_OPTIONS = [
  "mg",
  "g",
  "mcg",
  "NB",
  "time",
  "ml",
  "units",
  "MUnits",
] as const;

function getGe750VisibleRowsMigrationKey(username: string) {
  return `flora.visibleRows.migration.ge750.v2.${username}`;
}

function formatDDMMYYYY(ts: number): string {
  const d = new Date(ts);
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

function normalizeDDMMYYYY(value: string): string | null {
  return normalizeDateInputDDMMYYYY(value);
}

function toTsFromDateAndTime(dateText: string, timeText: string): number | null {
  const date = normalizeDDMMYYYY(dateText);
  const time = normalizeHHMM(timeText);
  if (!date || !time) return null;
  const [dd, mm, yyyy] = date.split("/").map(Number);
  const [hh, min] = time.split(":").map(Number);
  const dt = new Date(yyyy, mm - 1, dd, hh, min, 0, 0);
  return dt.getTime();
}

const DOSE_PER_KG_RATE_UNITS = [
  "mcg/kg/min",
  "mg/kg/min",
  "mcg/kg/hr",
  "mg/kg/hr",
] as const;
const CASEVIEW_DOSE_RATE_UNITS = [
  "mcg/min",
  "mg/min",
  "mcg/hr",
  "mg/hr",
  "units/min",
  "units/hr",
  "MUnits/min",
  "MUnits/hr",
  ...DOSE_PER_KG_RATE_UNITS,
] as const;

function parsePositiveNumber(raw: string): number | null {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

function concentrationPercentToMg(concentrationPercent: number, volumeMl: number): number {
  return concentrationPercent * 10 * volumeMl;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function round4(value: number): number {
  return Math.round(value * 10000) / 10000;
}

function formatCompactAmount(value: number): string {
  if (!Number.isFinite(value)) return "";
  if (Math.abs(value - Math.round(value)) < 0.0001) return String(Math.round(value));
  return value.toFixed(2).replace(/\.?0+$/, "");
}

function doseToMcgPerKgMin(value: number, unit: string): number | null {
  if (!Number.isFinite(value) || value <= 0) return null;
  const token = String(unit || "").trim().toLowerCase();
  if (token === "mcg/kg/min") return value;
  if (token === "mg/kg/min") return value * 1000;
  if (token === "mcg/kg/hr") return value / 60;
  if (token === "mg/kg/hr") return (value * 1000) / 60;
  return null;
}

function mcgPerKgMinToUnit(value: number, unit: string): number | null {
  if (!Number.isFinite(value) || value <= 0) return null;
  const token = String(unit || "").trim().toLowerCase();
  if (token === "mcg/kg/min") return value;
  if (token === "mg/kg/min") return value / 1000;
  if (token === "mcg/kg/hr") return value * 60;
  if (token === "mg/kg/hr") return (value * 60) / 1000;
  return null;
}

function concentrationToMcgPerMl(value: number, unit: string): number | null {
  if (!Number.isFinite(value) || value <= 0) return null;
  const token = String(unit || "").trim().toLowerCase();
  if (token === "mcg/ml") return value;
  if (token === "mg/ml") return value * 1000;
  return null;
}

function readWeightFromSavedForm(caseId: number): string {
  try {
    const raw = window.localStorage.getItem(`doctor_form_${caseId}`);
    if (!raw) return "";
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const weight = String(parsed.weightKg ?? "").trim();
    if (!weight) return "";
    const n = Number(weight);
    return Number.isFinite(n) && n > 0 ? String(n) : "";
  } catch {
    return "";
  }
}

function formatCaseClock(ts: number, preferences: DateTimePreferences): string {
  return formatConfiguredDateTime(ts, preferences);
}

function formatCaseElapsed(durationMs: number): string {
  const totalMinutes = Math.max(0, Math.floor(durationMs / 60_000));
  return `${Math.floor(totalMinutes / 60)} hr ${totalMinutes % 60} min`;
}

function formatPatientAge(patient: CasePatientInfo | null): string {
  const savedAge = String(patient?.age_text || "").trim();
  if (savedAge) return savedAge;
  const dobText = String(patient?.dob || "").trim();
  if (!dobText) return "Age not recorded";
  const dob = new Date(dobText.includes("T") ? dobText : `${dobText}T00:00:00`);
  if (!Number.isFinite(dob.getTime())) return "Age not recorded";
  const today = new Date();
  let years = today.getFullYear() - dob.getFullYear();
  let months = today.getMonth() - dob.getMonth();
  if (today.getDate() < dob.getDate()) months -= 1;
  if (months < 0) { years -= 1; months += 12; }
  if (years < 0) return "Age not recorded";
  return years > 0 ? `${years} y${months ? ` ${months} m` : ""}` : `${Math.max(0, months)} m`;
}

function pickSavedFormText(payload: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = String(payload[key] ?? "").trim();
    if (value) return value;
  }
  return "";
}

function joinNameWithoutPrefix(payload: Record<string, unknown>, keys: string[]): string {
  return keys.map(key => pickSavedFormText(payload, [key])).filter(Boolean).join(" ");
}

function readPatientDocumentSummary(caseId: number): { name: string; an: string } {
  try {
    const raw = window.localStorage.getItem(`doctor_form_${caseId}`);
    if (!raw) return { name: "", an: "" };
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const enName = joinNameWithoutPrefix(parsed, ["firstNameEn", "first_name_en", "lastNameEn", "last_name_en"]);
    const thName = joinNameWithoutPrefix(parsed, ["firstName", "first_name", "lastName", "last_name"]);
    return {
      name: enName || thName,
      an: pickSavedFormText(parsed, ["an", "AN", "caseAn", "case_an", "admissionNo", "admission_no"]),
    };
  } catch {
    return { name: "", an: "" };
  }
}

function normalizeDisplayUnit(kind: IoKind, rawUnit: string): string {
  const unit = String(rawUnit || "").trim();
  const token = unit.toLowerCase();
  if (token === "ml") return "mL";
  if (token === "ml/hr") return "mL/hr";
  if (token === "units") return "Units";
  if (token === "units/hr") return "Units/hr";
  if (token === "units/min") return "Units/min";
  if (token === "munits") return "MUnits";
  if (token === "munits/hr") return "MUnits/hr";
  if (token === "munits/min") return "MUnits/min";
  if (token) return unit;
  return kind === "med" ? "mg" : "mL";
}

function medDripUnitFamily(unit: string): "mass" | "units" | null {
  const token = String(unit || "").trim().toLowerCase();
  if (token === "mcg" || token === "mg" || token === "g") return "mass";
  if (token === "units" || token === "munits") return "units";
  return null;
}

function amountToDripBase(value: number, unit: string): number | null {
  if (!Number.isFinite(value) || value <= 0) return null;
  const token = String(unit || "").trim().toLowerCase();
  if (token === "mcg") return value;
  if (token === "mg") return value * 1000;
  if (token === "g") return value * 1_000_000;
  if (token === "units") return value;
  if (token === "munits") return value * 1_000_000;
  return null;
}

function doseRateToDripBasePerHour(value: number, unit: string): number | null {
  if (!Number.isFinite(value) || value <= 0) return null;
  const token = String(unit || "").trim().toLowerCase();
  if (token === "mcg/hr") return value;
  if (token === "mg/hr") return value * 1000;
  if (token === "mcg/min") return value * 60;
  if (token === "mg/min") return value * 60 * 1000;
  if (token === "units/hr") return value;
  if (token === "munits/hr") return value * 1_000_000;
  if (token === "units/min") return value * 60;
  if (token === "munits/min") return value * 60 * 1_000_000;
  return null;
}

function dripBasePerHourToDoseRate(value: number, unit: string): number | null {
  if (!Number.isFinite(value) || value <= 0) return null;
  const token = String(unit || "").trim().toLowerCase();
  if (token === "mcg/hr") return value;
  if (token === "mg/hr") return value / 1000;
  if (token === "mcg/min") return value / 60;
  if (token === "mg/min") return value / (60 * 1000);
  if (token === "units/hr") return value;
  if (token === "munits/hr") return value / 1_000_000;
  if (token === "units/min") return value / 60;
  if (token === "munits/min") return value / (60 * 1_000_000);
  return null;
}

function parseKeyValueFromNote(note: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const token of String(note || "").split("|")) {
    const [rawKey, ...rest] = token.split(":");
    const key = String(rawKey || "").trim();
    const value = rest.join(":").trim();
    if (!key || !value) continue;
    result[key] = value;
  }
  return result;
}

function normalizeToken(value: unknown): string {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function scoreQuickMedMatch(item: CaseIoItem, keyword: string): number {
  const name = String(item.name || "").trim().toLowerCase();
  const code = String(item.code || "").trim().toLowerCase();
  const nameToken = normalizeToken(name);
  const codeToken = normalizeToken(code);
  const words = name.split(/[^a-z0-9]+/).filter(Boolean);
  const allowLooseContains = keyword.length >= 3;

  if (!keyword) return Number.MAX_SAFE_INTEGER;
  if (nameToken === keyword) return 0;
  if (nameToken.startsWith(keyword)) return 1;
  if (words.some(word => word.startsWith(keyword))) return 2;
  if (codeToken === keyword) return 3;
  if (codeToken.startsWith(keyword)) return 4;
  if (allowLooseContains && nameToken.includes(keyword)) return 5;
  if (allowLooseContains && codeToken.includes(keyword)) return 6;
  return Number.MAX_SAFE_INTEGER;
}

function quickMedPrefixDistance(item: CaseIoItem, keyword: string): number {
  const nameToken = normalizeToken(item.name);
  if (nameToken.startsWith(keyword)) {
    return nameToken.length - keyword.length;
  }
  return Number.MAX_SAFE_INTEGER;
}

function editDistance(a: string, b: string): number {
  const rows = a.length + 1;
  const cols = b.length + 1;
  const dp = Array.from({ length: rows }, () => new Array<number>(cols).fill(0));
  for (let i = 0; i < rows; i += 1) dp[i][0] = i;
  for (let j = 0; j < cols; j += 1) dp[0][j] = j;
  for (let i = 1; i < rows; i += 1) {
    for (let j = 1; j < cols; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost,
      );
    }
  }
  return dp[a.length][b.length];
}

function scoreQuickMedFuzzyMatch(item: CaseIoItem, keyword: string): number {
  if (!keyword || keyword.length < 4) return Number.MAX_SAFE_INTEGER;
  const candidates = [
    normalizeToken(item.name),
    normalizeToken(item.code || ""),
    ...String(item.name || "")
      .split(/[^a-z0-9]+/i)
      .map(part => normalizeToken(part))
      .filter(Boolean),
  ].filter(Boolean);
  let best = Number.MAX_SAFE_INTEGER;
  for (const candidate of candidates) {
    if (!candidate) continue;
    const distance = editDistance(candidate, keyword);
    const maxAllowed =
      keyword.length >= 8 ? 2 : keyword.length >= 5 ? 1 : 0;
    if (distance <= maxAllowed && distance < best) {
      best = distance;
    }
  }
  return best;
}

function usageRankForItem(item: CaseIoItem): number {
  const rank = Number(item.usage_rank);
  return Number.isFinite(rank) && rank > 0 ? rank : Number.MAX_SAFE_INTEGER;
}

function usageScoreForItem(item: CaseIoItem): number {
  const score = Number(item.usage_score);
  return Number.isFinite(score) && score > 0 ? score : 0;
}

function resolveBloodProductEntryType(run: CaseIoRun | null): "PRC" | "FFP" | null {
  if (!run) return null;
  const combined = `${normalizeToken(run.item_code)} ${normalizeToken(run.item_name)}`.trim();
  if (
    combined.includes("ffp") ||
    combined.includes("freshfrozenplasma") ||
    combined.includes("freshfrozen")
  ) {
    return "FFP";
  }
  if (
    combined.includes("prc") ||
    combined.includes("lprc") ||
    combined.includes("packedredcell") ||
    combined.includes("packedcell") ||
    combined.includes("redcell")
  ) {
    return "PRC";
  }
  return null;
}

function isBloodProductRun(run: CaseIoRun | null): boolean {
  if (!run) return false;
  const categoryToken = normalizeToken(run.item_category);
  if (categoryToken === "bloodproduct") return true;
  if (resolveBloodProductEntryType(run)) return true;
  const combined = `${normalizeToken(run.item_code)} ${normalizeToken(run.item_name)}`;
  return (
    combined.includes("bloodproduct") ||
    combined.includes("platelet") ||
    combined.includes("cryo") ||
    combined.includes("cryoprecipitate")
  );
}

function sanitizeBloodProductNote(note: string): string {
  return String(note || "")
    .split("|")
    .map(token => token.trim())
    .filter(token => {
      const lower = token.toLowerCase();
      return (
        !lower.startsWith("bloodproducttype:") &&
        !lower.startsWith("bloodgroup:") &&
        !lower.startsWith("bloodbagno:") &&
        !lower.startsWith("reqno:") &&
        !lower.startsWith("an:") &&
        !lower.startsWith("unitstas:") &&
        !lower.startsWith("patientname:") &&
        !lower.startsWith("patient_name:") &&
        !lower.startsWith("verification:") &&
        !lower.startsWith("workflow:") &&
        !lower.startsWith("status:") &&
        !lower.startsWith("product:") &&
        !lower.startsWith("volumeml:")
      );
    })
    .join(" | ");
}

function sanitizeLocalAnestheticNote(note: string): string {
  return String(note || "")
    .split("|")
    .map(token => token.trim())
    .filter(token => {
      const lower = token.toLowerCase();
      return (
        !lower.startsWith("concentration:") &&
        !lower.startsWith("volumeml:") &&
        !lower.startsWith("route:")
      );
    })
    .join(" | ");
}

function buildIoEntryNote(
  baseNote: string,
  options: {
    includeBloodMeta: boolean;
    bloodType: "PRC" | "FFP" | null;
    bloodGroup: string;
    bloodBagNo: string;
    bloodVerification?: BloodProductVerificationResult | null;
    verificationMode?: "api" | "manual" | "registered" | null;
  },
): string {
  const {
    includeBloodMeta,
    bloodType,
    bloodGroup,
    bloodBagNo,
    bloodVerification,
    verificationMode,
  } = options;
  const parts = [String(baseNote || "").trim()];
  if (includeBloodMeta) {
    const verifiedType = String(bloodVerification?.bdtype || "").trim();
    const verifiedGroup = [
      String(bloodVerification?.bloodgrp || "").trim().toUpperCase(),
      String(bloodVerification?.rh || "").trim(),
    ].filter(Boolean).join("");
    const verifiedBagNo = String(bloodVerification?.dnrno || "").trim();
    if (verifiedType || bloodType) parts.push(`bloodProductType:${verifiedType || bloodType}`);
    if (verifiedGroup || bloodGroup) parts.push(`bloodGroup:${verifiedGroup || bloodGroup}`);
    if (verifiedBagNo || bloodBagNo) parts.push(`bloodBagNo:${verifiedBagNo || bloodBagNo}`);
    if (bloodVerification?.reqno) parts.push(`reqno:${bloodVerification.reqno}`);
    if (bloodVerification?.an) parts.push(`an:${bloodVerification.an}`);
    if (bloodVerification?.patient_name) parts.push(`patientName:${bloodVerification.patient_name}`);
    if (bloodVerification?.unitstas) parts.push(`unitstas:${bloodVerification.unitstas}`);
    if (verificationMode) parts.push(`verification:${verificationMode}`);
  }
  return parts.filter(Boolean).join(" | ");
}

const BLOOD_GROUP_OPTIONS = ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"] as const;

function formatVerifiedBloodGroup(verified: BloodProductVerificationResult | null): string {
  if (!verified) return "";
  return [
    String(verified.bloodgrp || "").trim().toUpperCase(),
    String(verified.rh || "").trim(),
  ].filter(Boolean).join("");
}

function parseStoredBloodGroup(raw: unknown): { bloodgrp: string | null; rh: string | null } {
  const text = String(raw || "").trim().toUpperCase().replace(/\s+/g, "");
  if (!text) return { bloodgrp: null, rh: null };
  const abo = text.match(/^(AB|A|B|O)/)?.[1] || null;
  const rh = text.includes("-") ? "-" : text.includes("+") ? "+" : null;
  return { bloodgrp: abo, rh };
}

function normalizeBloodProductCode(value: unknown): string {
  const token = normalizeToken(value);
  if (
    token.includes("ffp") ||
    token.includes("freshfrozenplasma") ||
    token.includes("freshfrozen")
  ) {
    return "ffp";
  }
  if (
    token.includes("prc") ||
    token.includes("lprc") ||
    token.includes("packedredcell") ||
    token.includes("packedcell") ||
    token.includes("redcell")
  ) {
    return "prc";
  }
  return token;
}

function normalizeBloodBagStatus(value: unknown): "refrigerated" | "warmed" | "" {
  const token = normalizeToken(value);
  if (token === "warmed" || token === "warm") return "warmed";
  if (token === "refrigerated" || token === "refigerated" || token === "cool" || token === "cold") {
    return "refrigerated";
  }
  return "";
}

function formatIoRunDetail(run: CaseIoRun): string {
  if (run.entry_mode !== "drip") return "";
  const meta = parseKeyValueFromNote(String(run.note || ""));
  const parts: string[] = [];

  if (run.kind === "med") {
    const totalVolumeMl = Number(meta.totalVolumeMl || meta.dripVolumeMl);
    const carrier = String(meta.carrier || "").trim();
    if (carrier && normalizeToken(carrier) !== "undilute") {
      const carrierParts = [carrier];
      if (Number.isFinite(totalVolumeMl) && totalVolumeMl > 0) {
        carrierParts.push(`${formatCompactAmount(totalVolumeMl)} mL`);
      }
      parts.push(carrierParts.join(" / "));
    }
  }

  return parts.filter(Boolean).join(" | ");
}

function buildBloodWorkflowDetail(
  baseNote: string,
  options: {
    workflow: "register_warming" | "give";
    productName: string;
    bloodType: "PRC" | "FFP" | null;
    bloodGroup: string;
    bloodBagNo: string;
    bloodVerification: BloodProductVerificationResult | null;
    verificationMode: "api" | "manual" | "registered";
    volumeMl?: number | null;
    status?: "refrigerated" | "warmed";
    givingAuthorization?: BloodGivingAuthorization | null;
  },
): string {
  const metaNote = buildIoEntryNote(baseNote, {
    includeBloodMeta: true,
    bloodType: options.bloodType,
    bloodGroup: options.bloodGroup,
    bloodBagNo: options.bloodBagNo,
    bloodVerification: options.bloodVerification,
    verificationMode: options.verificationMode,
  });
  const parts = [
    `workflow:${options.workflow}`,
    options.status ? `status:${options.status}` : "",
    options.productName ? `product:${options.productName}` : "",
    options.volumeMl != null && Number.isFinite(options.volumeMl) && options.volumeMl > 0
      ? `volumeMl:${options.volumeMl}`
      : "",
    options.givingAuthorization ? `givingAuthorization:${options.givingAuthorization.mode}` : "",
    options.givingAuthorization ? `givingAuthorizedBy:${options.givingAuthorization.name}` : "",
    options.givingAuthorization ? "givingAuthorizedRole:anesthetist" : "",
    options.givingAuthorization?.username
      ? `givingAuthorizedUsername:${options.givingAuthorization.username}`
      : "",
    metaNote,
  ];
  return parts.filter(Boolean).join(" | ");
}

function quickMedGroupLabel(item: CaseIoItem): string {
  const category = String(item.category || "").trim();
  if (!category) return "Medication";
  const labels: Record<string, string> = {
    ivAnesthetic: "IV Anesthetic",
    nmbd: "NMBD",
    opioid: "Opioid",
    localAnesthetic: "Local Anesthetic",
    reversal: "Reversal",
    antiEmetic: "Anti-emetic",
    anticholinergic: "Anticholinergic",
    analgesic: "Analgesic",
    cvDrug: "CV Drug",
    antimicrobial: "Antibiotics",
    other: "Other",
  };
  return labels[category] || category;
}

function medDripGroupTone(category: unknown): string {
  const token = normalizeToken(category);
  if (token === "ivanesthetic") return "iv-anesthetic";
  if (token === "nmbd") return "nmbd";
  if (token === "opioid") return "opioid";
  if (token === "cvdrug") return "cv-drug";
  if (token === "antimicrobial") return "antibiotic";
  if (token === "antiemetic") return "anti-emetic";
  if (token === "analgesic") return "analgesic";
  if (token === "anticholinergic") return "anticholinergic";
  if (token === "reversal") return "reversal";
  if (token === "localanesthetic") return "local-anesthetic";
  return "other";
}

export default function ClinicalChartView({
  caseStatus,
  sessionUser,
  onNavigate,
}: {
  caseStatus: CaseStatus;
  sessionUser: AuthUser | null;
  onNavigate?: (view: "patient" | "diagnosis" | "io") => void;
}) {
  const workstation = useWorkstationSettings();
  const edition = getEditionInfo();
  const availableAxisSteps = edition.allowedTimelineScales;
  const shouldUseBloodBoard = edition.code === "eforl";
  const caseId = caseStatus.status !== "IDLE" ? caseStatus.case_id : null;
  const notifyIoAndEventChanged = (targetCaseId: number) => {
    window.dispatchEvent(
      new CustomEvent("flora:case-io-changed", { detail: { caseId: targetCaseId } }),
    );
    window.dispatchEvent(
      new CustomEvent("flora:case-events-changed", { detail: { caseId: targetCaseId } }),
    );
  };
  const scopeUsername = sessionUser?.username || readStoredUsername();
  const accountChartGroups = useMemo(
    () => normalizeChartGroups(sessionUser?.parameterPreferences?.visibleParameters) as VitalGroup[] | null,
    [sessionUser?.parameterPreferences?.visibleParameters],
  );
  const accountSmartContrast = typeof sessionUser?.parameterPreferences?.smartContrast === "boolean"
    ? sessionUser.parameterPreferences.smartContrast
    : undefined;
  const accountTimelineScale = sessionUser?.parameterPreferences?.timeScaleMin;
  const accountFutureColumns = normalizeFutureColumns(sessionUser?.parameterPreferences?.futureColumns);
  const accountDripGroupColors = useMemo(
    () => normalizeDripGroupColors(sessionUser?.parameterPreferences?.dripGroupColors),
    [sessionUser?.parameterPreferences?.dripGroupColors],
  );
  const [loadedPrefsScope, setLoadedPrefsScope] = useState("");
  const [axisStepMin, setAxisStepMin] = useState<AxisStepMin>(() =>
    clampEditionTimelineScale(
      readTimelineScaleForUser(scopeUsername, accountTimelineScale),
      availableAxisSteps,
    ),
  );
  const [futureColumnCount, setFutureColumnCount] = useState(() =>
    readLocalFutureColumns(scopeUsername) ?? accountFutureColumns,
  );
  const [dripGroupColors, setDripGroupColors] = useState<DripGroupColors>(() =>
    readLocalDripGroupColors(scopeUsername) ?? accountDripGroupColors,
  );
  const [dripSmartContrast, setDripSmartContrast] = useState(
    () => readLocalSmartContrast(scopeUsername) ?? accountSmartContrast ?? true,
  );
  const [scaleDraft, setScaleDraft] = useState(String(axisStepMin));
  const minimumScale = Math.min(...availableAxisSteps);
  const maximumScale = Math.max(...availableAxisSteps);
  const changeScale = (value: number) => {
    const next = clampEditionTimelineScale(value, availableAxisSteps);
    setAxisStepMin(next);
    setScaleDraft(String(next));
  };
  const commitScaleDraft = () => {
    if (!scaleDraft.trim() || !Number.isFinite(Number(scaleDraft))) {
      setScaleDraft(String(axisStepMin));
      return;
    }
    changeScale(Number(scaleDraft));
  };
  useEffect(() => setScaleDraft(String(axisStepMin)), [axisStepMin]);
  const [preferredVisibleRowIds, setPreferredVisibleRowIds] = useState<
    string[] | null
  >(() => readVisibleRowsForUser(scopeUsername));
  const [hiddenRowIds, setHiddenRowIds] = useState<string[]>(() =>
    readHiddenRowsForUser(scopeUsername),
  );
  const [parameterMaster, setParameterMaster] = useState<ObservationParameter[]>([]);
  const [parameterMasterLoaded, setParameterMasterLoaded] = useState(false);
  useEffect(() => {
    let active = true;
    void getObservationParameters()
      .then(rows => { if (active) setParameterMaster(rows); })
      .catch(() => { if (active) setParameterMaster([]); })
      .finally(() => { if (active) setParameterMasterLoaded(true); });
    return () => { active = false; };
  }, []);
  const initialSectionCollapse = readSectionCollapseForUser(scopeUsername);
  const [isIoSectionCollapsed, setIsIoSectionCollapsed] = useState(initialSectionCollapse.ioCollapsed);
  const [isVitalSectionCollapsed, setIsVitalSectionCollapsed] = useState(initialSectionCollapse.vitalCollapsed);
  const [isParamMenuOpen, setIsParamMenuOpen] = useState(false);
  const [parameterSearch, setParameterSearch] = useState("");
  const [draftHiddenRowIds, setDraftHiddenRowIds] = useState<string[]>([]);
  const [summaryDock, setSummaryDock] = useState<SummaryDock>(() => {
    if (typeof window === "undefined") return "top";
    const saved = window.localStorage.getItem("flora.caseSummaryDock");
    return saved === "left" || saved === "right" || saved === "bottom" ? saved : "top";
  });
  useEffect(() => {
    window.localStorage.setItem("flora.caseSummaryDock", summaryDock);
  }, [summaryDock]);
  const [headerCardOrder, setHeaderCardOrder] = useState<CaseHeaderCardId[]>(() => readCaseHeaderOrder(scopeUsername));
  const [draggedHeaderCard, setDraggedHeaderCard] = useState<CaseHeaderCardId | null>(null);
  useEffect(() => {
    window.localStorage.setItem(caseHeaderOrderStorageKey(scopeUsername), JSON.stringify(headerCardOrder));
  }, [headerCardOrder, scopeUsername]);
  const moveHeaderCard = (source: CaseHeaderCardId, target: CaseHeaderCardId) => {
    if (source === target) return;
    setHeaderCardOrder(current => {
      const next = current.filter(id => id !== source);
      const targetIndex = next.indexOf(target);
      next.splice(targetIndex < 0 ? next.length : targetIndex, 0, source);
      return next;
    });
  };
  const moveHeaderCardByOffset = (cardId: CaseHeaderCardId, offset: -1 | 1) => {
    setHeaderCardOrder(current => {
      const index = current.indexOf(cardId);
      const targetIndex = index + offset;
      if (index < 0 || targetIndex < 0 || targetIndex >= current.length) return current;
      const next = [...current];
      [next[index], next[targetIndex]] = [next[targetIndex], next[index]];
      return next;
    });
  };
  const { axis, loading: axisLoading, serverOffsetMs, lastSyncedAt } = useClinicalTimelineAxis(caseId, caseStatus.status, axisStepMin, futureColumnCount);
  const {
    values: liveValues,
    provenance: storedCellProvenance,
    loading: vitalsLoading,
    fetchedAxis: vitalsAxis,
  } = useVitalMinutes(caseId, caseStatus.status, axis);
  const [optimisticCellProvenance, setOptimisticCellProvenance] = useState<TimelineProvenance>({});
  const cellProvenance = useMemo(() => {
    const merged: TimelineProvenance = {};
    for (const [rowId, entries] of Object.entries(storedCellProvenance)) merged[rowId] = { ...entries };
    for (const [rowId, entries] of Object.entries(optimisticCellProvenance)) merged[rowId] = { ...(merged[rowId] || {}), ...entries };
    return merged;
  }, [optimisticCellProvenance, storedCellProvenance]);
  const isAxisInSync = useMemo(() => {
    if (axis.length === 0 || vitalsAxis.length === 0) return false;
    if (axis.length !== vitalsAxis.length) return false;
    for (let i = 0; i < axis.length; i += 1) {
      if (axis[i] !== vitalsAxis[i]) return false;
    }
    return true;
  }, [axis, vitalsAxis]);
  const rawTimelineLoading = axisLoading || vitalsLoading || !isAxisInSync;

  const [clinicalContext, setClinicalContext] = useState<{
    caseId: number | null;
    diagnosis: CaseDiagnosisRow[];
    operations: CaseProcedureRow[];
  }>({ caseId: null, diagnosis: [], operations: [] });
  const [patientContext, setPatientContext] = useState<{
    caseId: number | null;
    patient: CasePatientInfo | null;
    allergies: CaseAllergyRow[];
  }>({ caseId: null, patient: null, allergies: [] });
  const [startTimeModalOpen, setStartTimeModalOpen] = useState(false);
  const [startDateDraft, setStartDateDraft] = useState("");
  const [startTimeDraft, setStartTimeDraft] = useState("");
  const [startTimeSaving, setStartTimeSaving] = useState(false);
  const [startTimeError, setStartTimeError] = useState("");
  const [allergyModalOpen, setAllergyModalOpen] = useState(false);
  const [allergyEditingId, setAllergyEditingId] = useState<string | null>(null);
  const [allergyDeleteId, setAllergyDeleteId] = useState<string | null>(null);
  const [allergyDraft, setAllergyDraft] = useState({ allergen: "", reaction: "", severity: "" });
  const [allergySaving, setAllergySaving] = useState(false);
  const [allergyError, setAllergyError] = useState("");
  useEffect(() => {
    if (caseId == null) return;
    const activeCaseId = caseId;
    let alive = true;
    const refresh = async () => {
      try {
        const [diagnosis, operations] = await Promise.all([
          getCaseDiagnosis(activeCaseId),
          getCaseProcedures(activeCaseId),
        ]);
        if (!alive) return;
        setClinicalContext({
          caseId: activeCaseId,
          diagnosis: [...diagnosis].sort((a, b) => (Number(a.seq) || 0) - (Number(b.seq) || 0) || (Number(a.event_ts) || 0) - (Number(b.event_ts) || 0)),
          operations: [...operations].sort((a, b) => (Number(a.seq) || 0) - (Number(b.seq) || 0) || (Number(a.event_ts) || 0) - (Number(b.event_ts) || 0)),
        });
      } catch {
        if (alive) setClinicalContext({ caseId: activeCaseId, diagnosis: [], operations: [] });
      }
    };
    const onClinicalChanged = (event: Event) => {
      if ((event as CustomEvent<{ caseId?: number }>).detail?.caseId === activeCaseId) void refresh();
    };
    void refresh();
    window.addEventListener("flora:clinical-changed", onClinicalChanged);
    return () => {
      alive = false;
      window.removeEventListener("flora:clinical-changed", onClinicalChanged);
    };
  }, [caseId]);

  useEffect(() => {
    if (caseId == null) return;
    const activeCaseId = caseId;
    let alive = true;
    const refresh = async () => {
      const [patientResult, allergyResult] = await Promise.allSettled([
        getCasePatientInfo(activeCaseId),
        getCaseAllergies(activeCaseId),
      ]);
      if (!alive) return;
      setPatientContext({
        caseId: activeCaseId,
        patient: patientResult.status === "fulfilled" ? patientResult.value : null,
        allergies: allergyResult.status === "fulfilled" ? allergyResult.value : [],
      });
    };
    const onPatientChanged = (event: Event) => {
      const changedCaseId = Number((event as CustomEvent<{ caseId?: number }>).detail?.caseId);
      if (!Number.isFinite(changedCaseId) || changedCaseId === activeCaseId) void refresh();
    };
    void refresh();
    window.addEventListener("flora:his-synced", onPatientChanged);
    window.addEventListener("flora:case-hn-updated", onPatientChanged);
    window.addEventListener("flora:allergy-changed", onPatientChanged);
    return () => {
      alive = false;
      window.removeEventListener("flora:his-synced", onPatientChanged);
      window.removeEventListener("flora:case-hn-updated", onPatientChanged);
      window.removeEventListener("flora:allergy-changed", onPatientChanged);
    };
  }, [caseId]);

  const caseEvents = useCaseEvents(caseId, caseStatus.status, axis);
  const [caseEventsAll, setCaseEventsAll] = useState<CaseEvent[]>([]);

  const [editValues, setEditValues] = useState<ClinicalTimelineValues>({});
  const values = useMemo(
    () => mergeValues(liveValues, editValues),
    [liveValues, editValues],
  );
  const ivyRows = useMemo(() => {
    const rows = new Map<string, ClinicalTimelineRow>();

    // The server master is authoritative. Constants remain an offline fallback.
    const configuredRows = parameterMaster
      .filter(parameter => parameter.is_active !== 0 && parameter.show_in_table !== 0)
      .map(parameter => ({
        id: parameter.param_key,
        label: parameter.short_name || parameter.display_name,
        unit: parameter.unit || undefined,
        referenceTooltip: parameterReferenceTooltip(parameter),
        type: "vital" as const,
      }));
    for (const row of parameterMasterLoaded ? configuredRows : BASE_IVY_ROWS) {
      rows.set(row.id, { ...row });
    }

    // 2. Add any other parameters received from data
    for (const rowId of Object.keys(values)) {
      if (rows.has(rowId)) continue;
      if (rowId === "ecg" || rowId === "event" || rowId === "vent_mode") continue;
      if (rowId.startsWith("unknown::")) continue;

      const meta = ROW_META[rowId];
      rows.set(rowId, {
        id: rowId,
        label: meta?.label ?? makeFallbackLabel(rowId),
        unit: meta?.unit,
        type: "vital",
      });
    }

    const configuredOrder = new Map(parameterMaster.map(parameter => [parameter.param_key, parameter.display_order]));
    const configuredGroup = new Map(parameterMaster.map(parameter => [parameter.param_key, parameter.table_group]));
    return Array.from(rows.values())
      .filter(row => isTimelineParamAllowed(edition, row.id))
      .sort((a, b) => {
      const groupA = configuredGroup.get(a.id) || getRowGroup(a.id);
      const groupB = configuredGroup.get(b.id) || getRowGroup(b.id);
      
      const priority = { core: 1, set: 2, measured: 3 };
      if (priority[groupA] !== priority[groupB]) {
        return priority[groupA] - priority[groupB];
      }
      
      return (configuredOrder.get(a.id) ?? 10000) - (configuredOrder.get(b.id) ?? 10000);
    });
  }, [edition, parameterMaster, parameterMasterLoaded, values]);
  const chartGroups = useMemo(() => {
    const groups = new Map<NonNullable<ObservationParameter["chart_group_key"]>, { key: NonNullable<ObservationParameter["chart_group_key"]>; label: string; defaultVisible: boolean; tooltip: string; color?: string; marker?: NonNullable<ObservationParameter["chart_marker"]> }>();
    for (const parameter of parameterMaster) {
      if (parameter.is_active === 0 || parameter.show_in_chart === 0 || !parameter.chart_group_key) continue;
      const existing = groups.get(parameter.chart_group_key);
      if (existing) {
        existing.defaultVisible ||= parameter.chart_default_visible !== 0;
        existing.tooltip += `\n${parameterChartTooltip(parameter)}`;
      } else {
        groups.set(parameter.chart_group_key, {
          key: parameter.chart_group_key,
          label: parameter.chart_label || parameter.short_name || parameter.display_name,
          defaultVisible: parameter.chart_default_visible !== 0,
          tooltip: parameterChartTooltip(parameter),
          color: parameter.chart_color || undefined,
          marker: parameter.chart_marker || undefined,
        });
      }
    }
    return Array.from(groups.values());
  }, [parameterMaster]);
  const hiddenRowIdSet = useMemo(() => new Set(hiddenRowIds), [hiddenRowIds]);
  const filteredParameterRows = useMemo(() => {
    const query = parameterSearch.trim().toLocaleLowerCase();
    if (!query) return ivyRows;
    return ivyRows.filter(row => `${row.label} ${row.id} ${row.unit || ""}`.toLocaleLowerCase().includes(query));
  }, [ivyRows, parameterSearch]);
  const visibleIvyRows = useMemo(
    () => ivyRows.filter(row => !hiddenRowIdSet.has(row.id)),
    [ivyRows, hiddenRowIdSet],
  );

  const [nowTs, setNowTs] = useState(() => Date.now());
  const [scrollLeft, setScrollLeft] = useState(0);
  const [viewportWidth, setViewportWidth] = useState(0);
  const [followLatest, setFollowLatest] = useState(true);
  const [ioRuns, setIoRuns] = useState<CaseIoRun[]>([]);
  const [ioEvents, setIoEvents] = useState<CaseIoEvent[]>([]);
  const [ioPreparedModal, setIoPreparedModal] = useState<IoPreparedModalState | null>(null);
  const [quickIoItems, setQuickIoItems] = useState<CaseIoItem[]>([]);
  const [quickIoError, setQuickIoError] = useState("");
  const [ioAddMenuTs, setIoAddMenuTs] = useState<number | null>(null);
  const [quickMedOpen, setQuickMedOpen] = useState(false);
  const [quickMedSearch, setQuickMedSearch] = useState("");
  const [quickMedItemId, setQuickMedItemId] = useState<number | null>(null);
  const [showQuickMedDropdown, setShowQuickMedDropdown] = useState(false);
  const [quickMedDate, setQuickMedDate] = useState(() => formatDDMMYYYY(Date.now()));
  const [quickMedTime, setQuickMedTime] = useState(() => formatHHMM(Date.now()));
  const [quickMedDose, setQuickMedDose] = useState("");
  const [quickMedLocalConcentration, setQuickMedLocalConcentration] = useState("");
  const [quickMedLocalVolumeMl, setQuickMedLocalVolumeMl] = useState("");
  const [quickMedRoute, setQuickMedRoute] = useState(DEFAULT_CASEVIEW_ROUTE);
  const [quickMedUnit, setQuickMedUnit] = useState("mg");
  const [quickMedNote, setQuickMedNote] = useState("");
  const [quickMedManualMode, setQuickMedManualMode] = useState(false);
  const [quickMedManualCategory, setQuickMedManualCategory] = useState("");
  const [quickMedSaving, setQuickMedSaving] = useState(false);
  const [quickMedError, setQuickMedError] = useState("");
  const [quickMedDripOpen, setQuickMedDripOpen] = useState(false);
  const [quickMedDripSearch, setQuickMedDripSearch] = useState("");
  const [quickMedDripItemId, setQuickMedDripItemId] = useState<number | null>(null);
  const [showQuickMedDripDropdown, setShowQuickMedDripDropdown] = useState(false);
  const [quickMedDripDate, setQuickMedDripDate] = useState(() => formatDDMMYYYY(Date.now()));
  const [quickMedDripTime, setQuickMedDripTime] = useState(() => formatHHMM(Date.now()));
  const [quickMedDripRoute, setQuickMedDripRoute] = useState(DEFAULT_CASEVIEW_ROUTE);
  const [quickMedDripAmountValue, setQuickMedDripAmountValue] = useState("");
  const [quickMedDripAmountUnit, setQuickMedDripAmountUnit] = useState("mg");
  const [quickMedDripManualMode, setQuickMedDripManualMode] = useState(false);
  const [quickMedDripManualCategory, setQuickMedDripManualCategory] = useState("");
  const [quickMedDripCarrierFluidId, setQuickMedDripCarrierFluidId] = useState<number | null>(null);
  const [quickMedDripTotalVolumeMl, setQuickMedDripTotalVolumeMl] = useState("");
  const [quickMedDripDoseValue, setQuickMedDripDoseValue] = useState("");
  const [quickMedDripDoseUnit, setQuickMedDripDoseUnit] =
    useState<(typeof CASEVIEW_DOSE_RATE_UNITS)[number]>("mg/hr");
  const [quickMedDripWeightKg, setQuickMedDripWeightKg] = useState("");
  const [quickMedDripRateMlHr, setQuickMedDripRateMlHr] = useState("");
  const [quickMedDripLastEdited, setQuickMedDripLastEdited] =
    useState<"dose" | "rate">("dose");
  const [quickMedDripNote, setQuickMedDripNote] = useState("");
  const [quickMedDripSaving, setQuickMedDripSaving] = useState(false);
  const [quickMedDripStopping, setQuickMedDripStopping] = useState(false);
  const [quickMedDripExactStopTs, setQuickMedDripExactStopTs] = useState<number | null>(null);
  const [quickMedDripError, setQuickMedDripError] = useState("");
  const [quickMedDripEditTarget, setQuickMedDripEditTarget] = useState<{
    runId: number;
    segmentId: number | null;
    clickedTs: number;
    segmentStartTs: number | null;
  } | null>(null);
  const [quickBloodProductOpen, setQuickBloodProductOpen] = useState(false);
  const [quickBloodProductSearch, setQuickBloodProductSearch] = useState("");
  const [quickBloodProductItemId, setQuickBloodProductItemId] = useState<number | null>(null);
  const [showQuickBloodProductDropdown, setShowQuickBloodProductDropdown] = useState(false);
  const [quickBloodProductDate, setQuickBloodProductDate] = useState(() => formatDDMMYYYY(Date.now()));
  const [quickBloodProductTime, setQuickBloodProductTime] = useState(() => formatHHMM(Date.now()));
  const [quickBloodProductVolumeMl, setQuickBloodProductVolumeMl] = useState("");
  const [quickBloodProductGroup, setQuickBloodProductGroup] = useState("");
  const [quickBloodProductBagNo, setQuickBloodProductBagNo] = useState("");
  const [quickBloodProductNote, setQuickBloodProductNote] = useState("");
  const [quickBloodProductVerified, setQuickBloodProductVerified] =
    useState<BloodProductVerificationResult | null>(null);
  const [quickBloodProductVerificationMode, setQuickBloodProductVerificationMode] =
    useState<"api" | "manual" | "registered" | null>(null);
  const [quickBloodProductManualAvailable, setQuickBloodProductManualAvailable] = useState(false);
  const [quickBloodProductChecking, setQuickBloodProductChecking] = useState(false);
  const [quickBloodProductSaving, setQuickBloodProductSaving] = useState(false);
  const [quickBloodProductError, setQuickBloodProductError] = useState("");
  const [quickBloodProductTypeLockedFromHis, setQuickBloodProductTypeLockedFromHis] = useState(false);
  const [bloodBoardOpen, setBloodBoardOpen] = useState(false);
  const [bloodBoardRowsFromHis, setBloodBoardRowsFromHis] = useState<BloodProductVerificationResult[]>([]);
  const [bloodBoardSource, setBloodBoardSource] = useState<"HIS" | "MOCK">("HIS");
  const [bloodBoardLoading, setBloodBoardLoading] = useState(false);
  const [bloodBoardSavingBagNo, setBloodBoardSavingBagNo] = useState<string | null>(null);
  const [bloodBoardError, setBloodBoardError] = useState("");
  const [bloodBoardOutcomeBag, setBloodBoardOutcomeBag] = useState<BloodProductVerificationResult | null>(null);
  const [bloodBoardOutcomeMode, setBloodBoardOutcomeMode] = useState<"completed" | "stop_reaction">("completed");
  const [bloodBoardOutcomeDetail, setBloodBoardOutcomeDetail] = useState("");
  const [bloodBoardAnesthetists, setBloodBoardAnesthetists] = useState<StaffMember[]>([]);
  const [bloodBoardAnesthetistsLoading, setBloodBoardAnesthetistsLoading] = useState(false);
  const [bloodBoardSelectedAnesthetist, setBloodBoardSelectedAnesthetist] = useState("");
  const [bloodBoardConfirmedAnesthetist, setBloodBoardConfirmedAnesthetist] = useState<StaffMember | null>(null);
  const [eforlBloodBoardRows, setEforlBloodBoardRows] = useState<EforlBloodBoardRow[]>([]);
  const [eforlReceiveBagNo, setEforlReceiveBagNo] = useState("");
  const [eforlReceiveCondition, setEforlReceiveCondition] = useState<EforlBloodBoardCondition>("Frozen");
  const [eforlGiveBagNo, setEforlGiveBagNo] = useState("");
  const [eforlGiveAmountMl, setEforlGiveAmountMl] = useState("");
  const [quickFluidOpen, setQuickFluidOpen] = useState(false);
  const [quickFluidSearch, setQuickFluidSearch] = useState("");
  const [quickFluidItemId, setQuickFluidItemId] = useState<number | null>(null);
  const [showQuickFluidDropdown, setShowQuickFluidDropdown] = useState(false);
  const [quickFluidDate, setQuickFluidDate] = useState(() => formatDDMMYYYY(Date.now()));
  const [quickFluidTime, setQuickFluidTime] = useState(() => formatHHMM(Date.now()));
  const [quickFluidEntryMode, setQuickFluidEntryMode] = useState<"bolus" | "timed" | "running">("bolus");
  const [quickFluidVolumeMl, setQuickFluidVolumeMl] = useState("");
  const [quickFluidOverMin, setQuickFluidOverMin] = useState("");
  const [quickFluidRateMlHr, setQuickFluidRateMlHr] = useState("");
  const [quickFluidNote, setQuickFluidNote] = useState("");
  const [quickFluidSaving, setQuickFluidSaving] = useState(false);
  const [quickFluidError, setQuickFluidError] = useState("");
  const eventModalRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!scrollRef.current) return;
    const observer = new ResizeObserver(entries => {
      for (const entry of entries) {
        setViewportWidth(entry.contentRect.width);
      }
    });
    observer.observe(scrollRef.current);
    return () => observer.disconnect();
  }, []);

  const [ioDripModal, setIoDripModal] = useState<IoDripModalState | null>(null);
  const [ioModalValue, setIoModalValue] = useState("");
  const [ioModalDate, setIoModalDate] = useState("");
  const [ioModalTime, setIoModalTime] = useState("");
  const [ioModalUnit, setIoModalUnit] = useState("");
  const [ioModalLocalRoute, setIoModalLocalRoute] = useState(DEFAULT_CASEVIEW_LOCAL_ROUTE);
  const [ioModalLocalConcentration, setIoModalLocalConcentration] = useState("");
  const [ioModalLocalVolumeMl, setIoModalLocalVolumeMl] = useState("");
  const [ioModalNote, setIoModalNote] = useState("");
  const [ioModalBloodGroup, setIoModalBloodGroup] = useState("");
  const [ioModalBloodBagNo, setIoModalBloodBagNo] = useState("");
  const [ioModalBloodVerified, setIoModalBloodVerified] =
    useState<BloodProductVerificationResult | null>(null);
  const [ioModalBloodVerificationMode, setIoModalBloodVerificationMode] =
    useState<"api" | "manual" | "registered" | null>(null);
  const [ioModalBloodManualAvailable, setIoModalBloodManualAvailable] = useState(false);
  const [ioModalBloodChecking, setIoModalBloodChecking] = useState(false);
  const [ioModalSaving, setIoModalSaving] = useState(false);
  const [ioModalError, setIoModalError] = useState("");
  const [ioDripStartDate, setIoDripStartDate] = useState("");
  const [ioDripStartTime, setIoDripStartTime] = useState("");
  const [ioDripEndDate, setIoDripEndDate] = useState("");
  const [ioDripEndTime, setIoDripEndTime] = useState("");
  const [ioDripRateValue, setIoDripRateValue] = useState("");
  const [ioDripRateUnit, setIoDripRateUnit] = useState("ml/hr");
  const [ioDripDoseValue, setIoDripDoseValue] = useState("");
  const [ioDripDoseUnit, setIoDripDoseUnit] = useState("");
  const [ioDripCarrierValue, setIoDripCarrierValue] = useState("");
  const [ioDripWeightKg, setIoDripWeightKg] = useState("");
  const [ioDripConcentration, setIoDripConcentration] = useState("");
  const [ioDripMedVolume, setIoDripMedVolume] = useState("");
  const [ioDripCarrierVolume, setIoDripCarrierVolume] = useState("");
  const [ioDripNote, setIoDripNote] = useState("");
  const [ioDripOngoing, setIoDripOngoing] = useState(true);
  const [ioDripAdvanced, setIoDripAdvanced] = useState(false);
  const [ioDripSaving, setIoDripSaving] = useState(false);
  const [ioDripError, setIoDripError] = useState("");
  const [eventModalTs, setEventModalTs] = useState<number | null>(null);
  const [eventModalMode, setEventModalMode] = useState<CaseEventType>("event");
  const [eventModalEventTitle, setEventModalEventTitle] = useState<string>(
    COMMON_EVENT_OPTIONS[0],
  );
  const [eventModalNoteTitle, setEventModalNoteTitle] = useState("");
  const [eventModalDetail, setEventModalDetail] = useState("");
  const [eventModalTime, setEventModalTime] = useState("");
  const [eventModalSaving, setEventModalSaving] = useState(false);
  const [eventModalDeleting, setEventModalDeleting] = useState(false);
  const [eventModalError, setEventModalError] = useState("");
  const [eventModalEditingId, setEventModalEditingId] = useState<number | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const quickMedSearchRef = useRef<HTMLInputElement>(null);
  const quickMedTimeRef = useRef<HTMLInputElement>(null);
  const quickMedSaveLockRef = useRef(false);
  const quickMedDripSearchRef = useRef<HTMLInputElement>(null);
  const quickMedDripTimeRef = useRef<HTMLInputElement>(null);
  const quickMedDripAmountInputRef = useRef<HTMLInputElement>(null);
  const quickMedDripOptionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const quickMedDripSaveLockRef = useRef(false);
  const quickBloodProductBagRef = useRef<HTMLInputElement | null>(null);
  const quickBloodProductOptionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const quickBloodProductVolumeRef = useRef<HTMLInputElement | null>(null);
  const quickFluidOptionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const quickFluidVolumeRef = useRef<HTMLInputElement | null>(null);
  const pendingChangesRef = useRef<Map<string, TimelineChange>>(new Map());
  const saveTimerRef = useRef<number | null>(null);

  useEffect(() => {
    const timer = setInterval(() => {
      setNowTs(Date.now() + serverOffsetMs);
    }, 5000);
    return () => clearInterval(timer);
  }, [serverOffsetMs]);

  useEffect(() => {
    if (!scrollRef.current || axis.length === 0 || !followLatest) return;

    requestAnimationFrame(() => {
      const el = scrollRef.current;
      if (!el) return;
      el.scrollLeft = el.scrollWidth - el.clientWidth;
    });
  }, [axis.length, axisStepMin, followLatest]);

  useEffect(() => {
    setEditValues({});
    setOptimisticCellProvenance({});
  }, [caseId]);

  useEffect(() => {
    pendingChangesRef.current.clear();
    if (saveTimerRef.current != null) {
      window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
  }, [caseId]);

  useEffect(() => {
    setLoadedPrefsScope("");
    setAxisStepMin(
      clampEditionTimelineScale(
        readTimelineScaleForUser(scopeUsername, accountTimelineScale),
        availableAxisSteps,
      ),
    );
    setFutureColumnCount(readLocalFutureColumns(scopeUsername) ?? accountFutureColumns);
    setDripGroupColors(readLocalDripGroupColors(scopeUsername) ?? accountDripGroupColors);
    setDripSmartContrast(readLocalSmartContrast(scopeUsername) ?? accountSmartContrast ?? true);
    setPreferredVisibleRowIds(readVisibleRowsForUser(scopeUsername));
    setHiddenRowIds(readHiddenRowsForUser(scopeUsername));
    const sectionCollapse = readSectionCollapseForUser(scopeUsername);
    setIsIoSectionCollapsed(sectionCollapse.ioCollapsed);
    setIsVitalSectionCollapsed(sectionCollapse.vitalCollapsed);
    setLoadedPrefsScope(scopeUsername);
  }, [accountDripGroupColors, accountFutureColumns, accountSmartContrast, accountTimelineScale, availableAxisSteps, scopeUsername]);

  useEffect(() => {
    const handleChartPreferencesChanged = (event: Event) => {
      const detail = (event as CustomEvent<{ username?: string; timeScaleMin?: number; futureColumns?: number; smartContrast?: boolean; dripGroupColors?: unknown }>).detail;
      if (detail?.username && detail.username !== scopeUsername) return;
      const next = clampEditionTimelineScale(
        detail?.timeScaleMin ?? readTimelineScaleForUser(scopeUsername, accountTimelineScale),
        availableAxisSteps,
      );
      setAxisStepMin(next);
      setScaleDraft(String(next));
      setFutureColumnCount(normalizeFutureColumns(detail?.futureColumns ?? readLocalFutureColumns(scopeUsername) ?? accountFutureColumns));
      setDripGroupColors(normalizeDripGroupColors(detail?.dripGroupColors ?? readLocalDripGroupColors(scopeUsername) ?? accountDripGroupColors));
      setDripSmartContrast(detail?.smartContrast ?? readLocalSmartContrast(scopeUsername) ?? accountSmartContrast ?? true);
    };
    window.addEventListener(CHART_PREFERENCES_CHANGED_EVENT, handleChartPreferencesChanged);
    return () => window.removeEventListener(CHART_PREFERENCES_CHANGED_EVENT, handleChartPreferencesChanged);
  }, [accountDripGroupColors, accountFutureColumns, accountSmartContrast, accountTimelineScale, availableAxisSteps, scopeUsername]);

  useEffect(() => {
    if (loadedPrefsScope !== scopeUsername) return;
    if (typeof window === "undefined") return;
    localStorage.setItem(
      getTimelineScaleStorageKey(scopeUsername),
      String(axisStepMin),
    );
    localStorage.setItem("flora.timelineScale", String(axisStepMin));
  }, [axisStepMin, loadedPrefsScope, scopeUsername]);

  useEffect(() => {
    if (loadedPrefsScope !== scopeUsername) return;
    if (typeof window === "undefined") return;
    localStorage.setItem(
      getSectionCollapseStorageKey(scopeUsername),
      JSON.stringify({
        ioCollapsed: isIoSectionCollapsed,
        vitalCollapsed: isVitalSectionCollapsed,
      }),
    );
  }, [isIoSectionCollapsed, isVitalSectionCollapsed, loadedPrefsScope, scopeUsername]);

  useEffect(() => {
    if (!preferredVisibleRowIds) return;
    const preferredSet = new Set(preferredVisibleRowIds);
    const nextHidden = ivyRows
      .filter(row => !preferredSet.has(row.id))
      .map(row => row.id);
    setHiddenRowIds(prev => {
      if (
        prev.length === nextHidden.length &&
        prev.every((value, idx) => value === nextHidden[idx])
      ) {
        return prev;
      }
      return nextHidden;
    });
  }, [ivyRows, preferredVisibleRowIds]);

  useEffect(() => {
    if (preferredVisibleRowIds != null) return;
    if (hiddenRowIds.length === 0) return;
    if (ivyRows.length === 0) return;
    const hiddenSet = new Set(hiddenRowIds);
    const visibleIds = ivyRows
      .filter(row => !hiddenSet.has(row.id))
      .map(row => row.id);
    setPreferredVisibleRowIds(visibleIds);
  }, [hiddenRowIds, ivyRows, preferredVisibleRowIds]);

  useEffect(() => {
    if (preferredVisibleRowIds) return;
    setHiddenRowIds(prev => {
      const allRowIds = new Set(ivyRows.map(row => row.id));
      const cleaned = prev.filter(rowId => allRowIds.has(rowId));
      return cleaned.length === prev.length ? prev : cleaned;
    });
  }, [ivyRows, preferredVisibleRowIds]);

  useEffect(() => {
    if (loadedPrefsScope !== scopeUsername) return;
    if (typeof window === "undefined") return;
    localStorage.setItem(
      getHiddenRowsStorageKey(scopeUsername),
      JSON.stringify(hiddenRowIds),
    );
  }, [hiddenRowIds, loadedPrefsScope, scopeUsername]);

  useEffect(() => {
    if (loadedPrefsScope !== scopeUsername) return;
    if (typeof window === "undefined") return;
    if (!preferredVisibleRowIds) {
      localStorage.removeItem(getVisibleRowsStorageKey(scopeUsername));
      return;
    }
    localStorage.setItem(
      getVisibleRowsStorageKey(scopeUsername),
      JSON.stringify(preferredVisibleRowIds),
    );
  }, [preferredVisibleRowIds, loadedPrefsScope, scopeUsername]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!preferredVisibleRowIds || ivyRows.length === 0) return;

    const migrationKey = getGe750VisibleRowsMigrationKey(scopeUsername);
    if (localStorage.getItem(migrationKey) === "1") return;

    const rowIds = new Set(ivyRows.map(row => row.id));
    const visibleSet = new Set(preferredVisibleRowIds);
    const missing = GE750_AUTOSHOW_ROW_IDS.filter(
      rowId => rowIds.has(rowId) && !visibleSet.has(rowId),
    );

    localStorage.setItem(migrationKey, "1");
    if (missing.length === 0) return;
    setPreferredVisibleRowIds([...preferredVisibleRowIds, ...missing]);
  }, [ivyRows, preferredVisibleRowIds, scopeUsername]);

  const eventMarkersByTs = useMemo(() => {
    if (axis.length === 0 || caseEvents.length === 0) return {};

    const stepMs = axis.length > 1 ? Math.max(1, axis[1] - axis[0]) : 60_000;
    const startTs = axis[0];
    const endExclusiveTs = axis[axis.length - 1] + stepMs;
    const next: Record<number, typeof caseEvents> = {};

    for (const event of caseEvents) {
      if (event.event_ts < startTs || event.event_ts >= endExclusiveTs) continue;
      const index = Math.floor((event.event_ts - startTs) / stepMs);
      if (index < 0 || index >= axis.length) continue;

      const bucketTs = axis[index];
      const list = next[bucketTs] ?? [];
      list.push(event);
      next[bucketTs] = list;
    }

    for (const tsKey of Object.keys(next)) {
      const ts = Number(tsKey);
      next[ts].sort((a, b) => a.event_ts - b.event_ts || a.id - b.id);
    }

    return next;
  }, [axis, caseEvents]);

  const caseEventById = useMemo(() => {
    const map = new Map<number, CaseEvent>();
    for (const row of caseEventsAll) map.set(row.id, row);
    for (const row of caseEvents) {
      if (!map.has(row.id)) map.set(row.id, row);
    }
    return map;
  }, [caseEvents, caseEventsAll]);

  const hasTimeOutBefore = (eventTs: number) =>
    caseEventsAll.some(
      row =>
        row.event_type === "event" &&
        normalizeLifecycleTitle(row.title) === "time out" &&
        row.event_ts <= eventTs,
    );

  useEffect(() => {
    if (caseId == null || caseStatus.status === "IDLE") {
      setCaseEventsAll([]);
      return;
    }

    let alive = true;
    const activeCaseId = caseId;
    const caseInfo = caseStatus;

    async function loadCaseEventsAll() {
      try {
        const fromTs = caseInfo.start_time;
        const toTs =
          caseInfo.status === "DISCHARGED" && caseInfo.discharge_time
            ? caseInfo.discharge_time
            : Date.now() + 24 * 60 * 60 * 1000;
        const rows = await getCaseEvents(activeCaseId, fromTs, toTs, 2000);
        if (!alive) return;
        setCaseEventsAll(rows);
      } catch (err) {
        if (!alive) return;
        console.error("[ClinicalChartView] case event list load failed", err);
      }
    }

    const onEventsChanged = (event: Event) => {
      const custom = event as CustomEvent<{ caseId?: number }>;
      const changedCaseId = Number(custom.detail?.caseId);
      if (Number.isFinite(changedCaseId) && changedCaseId !== activeCaseId) return;
      void loadCaseEventsAll();
    };

    void loadCaseEventsAll();
    const timer = setInterval(() => {
      void loadCaseEventsAll();
    }, 15_000);
    window.addEventListener("flora:case-events-changed", onEventsChanged);

    return () => {
      alive = false;
      clearInterval(timer);
      window.removeEventListener("flora:case-events-changed", onEventsChanged);
    };
  }, [caseId, caseStatus]);

  useEffect(() => {
    if (caseId == null || caseStatus.status === "IDLE") {
      setIoRuns([]);
      setIoEvents([]);
      return;
    }

    let alive = true;
    const caseInfo = caseStatus;
    const activeCaseId = caseId;

    async function loadIoData() {
      try {
        const fromTs = caseInfo.start_time;
        const toTs =
          caseInfo.status === "DISCHARGED" && caseInfo.discharge_time
            ? caseInfo.discharge_time
            : Date.now() + 24 * 60 * 60 * 1000;
        const [runs, events] = await Promise.all([
          getCaseIoRuns(activeCaseId, fromTs, toTs),
          getCaseIoEvents(activeCaseId, fromTs, toTs),
        ]);
        if (!alive) return;
        setIoRuns(runs);
        setIoEvents(events);
      } catch (err) {
        console.error("[ClinicalChartView] io run load failed", err);
      }
    }

    const onIoChanged = (event: Event) => {
      const custom = event as CustomEvent<{ caseId?: number }>;
      const changedCaseId = Number(custom.detail?.caseId);
      if (Number.isFinite(changedCaseId) && changedCaseId !== activeCaseId) return;
      void loadIoData();
    };

    void loadIoData();
    const timer = setInterval(() => {
      void loadIoData();
    }, 15000);
    window.addEventListener("flora:case-io-changed", onIoChanged);

    return () => {
      alive = false;
      clearInterval(timer);
      window.removeEventListener("flora:case-io-changed", onIoChanged);
    };
  }, [caseId, caseStatus]);

  useEffect(() => {
    if (caseId == null || caseStatus.status === "IDLE") {
      setQuickIoItems([]);
      setQuickIoError("");
      return;
    }

    let alive = true;
    setQuickIoError("");

    void Promise.all([
      getCaseIoItems(caseId, "med"),
      getCaseIoItems(caseId, "fluid"),
      getCaseIoItems(caseId, "output"),
    ])
      .then(([medRows, fluidRows, outputRows]) => {
        if (!alive) return;
        const merged = [...medRows, ...fluidRows, ...outputRows].sort((a, b) =>
          a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
        );
        setQuickIoItems(merged);
      })
      .catch(err => {
        if (!alive) return;
        setQuickIoItems([]);
        setQuickIoError(
          err instanceof Error ? err.message : "Failed to load items",
        );
      })
      .finally(() => {
        if (!alive) return;
      });

    return () => {
      alive = false;
    };
  }, [caseId, caseStatus.status]);

  const preparedRuns = useMemo(
    () => ioRuns.filter(run => Number(run.include_in_balance ?? 1) !== 0),
    [ioRuns],
  );

  const sortedPreparedRuns = useMemo(() => {
    const runName = (run: CaseIoRun) =>
      String(run.item_name || run.item_code || `item ${run.item_id}`).trim();
    const modeRank = (run: CaseIoRun) => {
      if (run.entry_mode === "drip") return 0;
      if (run.entry_mode === "bolus") return 1;
      return 2;
    };
    const groupRank = (run: CaseIoRun) => {
      const cat = (run.item_category || "").toLowerCase();
      if (run.kind === "med") return 0;
      if (run.kind === "fluid" && run.entry_mode === "drip") return 1;
      if (run.kind === "fluid" && cat !== "bloodproduct") return 2;
      if (run.kind === "fluid" && cat === "bloodproduct") return 3;
      if (run.kind === "output" && cat === "bloodlossoutput") return 4;
      if (run.kind === "output" && cat === "urineoutput") return 5;
      return 6;
    };
    return [...preparedRuns].sort((a, b) => {
      const grpCmp = groupRank(a) - groupRank(b);
      if (grpCmp !== 0) return grpCmp;
      const nameCmp = runName(a).localeCompare(runName(b), undefined, { sensitivity: "base" });
      if (nameCmp !== 0) return nameCmp;
      const modeCmp = modeRank(a) - modeRank(b);
      if (modeCmp !== 0) return modeCmp;
      const startCmp = Number(a.started_at || 0) - Number(b.started_at || 0);
      if (startCmp !== 0) return startCmp;
      return a.id - b.id;
    });
  }, [preparedRuns]);

  const preparedRunById = useMemo(() => {
    const map = new Map<number, CaseIoRun>();
    for (const run of sortedPreparedRuns) {
      map.set(run.id, run);
    }
    return map;
  }, [sortedPreparedRuns]);

  const ioRunByRowId = useMemo(() => {
    const map = new Map<string, CaseIoRun>();
    for (const run of sortedPreparedRuns) {
      map.set(ioTimelineRowIdForRun(run), run);
    }
    return map;
  }, [sortedPreparedRuns]);

  const ioPreparedRows = useMemo<ClinicalTimelineRow[]>(
    () => {
      const rows = new Map<string, ClinicalTimelineRow>();
      for (const run of sortedPreparedRuns) {
        const rowId = ioTimelineRowIdForRun(run);
        if (rows.has(rowId)) continue;
        const totals = new Map<string, number>();
        if (run.entry_mode !== "drip") {
          for (const event of ioEvents) {
            if (event.include_in_balance === 0 || event.kind !== run.kind || event.item_id !== run.item_id) continue;
            const amount = run.kind === "med" ? Number(event.dose_value) : Number(event.volume_ml);
            if (!Number.isFinite(amount) || amount <= 0) continue;
            const unit = run.kind === "med"
              ? String(event.dose_unit || run.item_unit || "mg").trim()
              : "mL";
            totals.set(unit, (totals.get(unit) || 0) + amount);
          }
        }
        const ioTotal = Array.from(totals.entries())
          .map(([unit, amount]) => `${formatCompactAmount(amount)} ${unit}`)
          .join(" + ");
        rows.set(rowId, {
          id: rowId,
          label: (() => {
            const baseLabel = run.item_name || run.item_code || `Item ${run.item_id}`;
            return baseLabel;
          })(),
          type: "io",
          unit: run.kind === "med" ? run.item_unit || "mg" : "mL",
          displayMode: run.entry_mode ?? undefined,
          ioKind: run.kind,
          ioCategory: run.item_category || "",
          ioStatus:
            normalizeToken(run.item_category) === "bloodproduct"
              ? normalizeBloodBagStatus(parseKeyValueFromNote(String(run.note || "")).status)
              : "",
          ioDetail: formatIoRunDetail(run),
          ioTotal,
        });
      }
      return Array.from(rows.values());
    },
    [ioEvents, sortedPreparedRuns],
  );

  const ioRowsWithHeader = useMemo<ClinicalTimelineRow[]>(
    () => [
      { id: "__io_header__", label: "I/O", type: "event" },
      ...ioPreparedRows,
      { id: "__vital_agent_header__", label: "Params", type: "event" },
    ],
    [ioPreparedRows],
  );
  const rowsAfterEvent = useMemo(
    () => ioRowsWithHeader,
    [ioRowsWithHeader],
  );

  const ioPreparedMarkersByTs = useMemo<Record<number, ClinicalTimelineIoMarker[]>>(() => {
    if (axis.length === 0 || sortedPreparedRuns.length === 0) return {};
    const stepMs = axis.length > 1 ? Math.max(1, axis[1] - axis[0]) : 60_000;
    const next: Record<number, ClinicalTimelineIoMarker[]> = {};
    for (const ts of axis) next[ts] = [];
    const runMap = new Map<string, CaseIoRun[]>();
    for (const run of sortedPreparedRuns) {
      const key = `${run.kind}:${run.item_id}`;
      const list = runMap.get(key) || [];
      list.push(run);
      runMap.set(key, list);
    }

    const selectRunForEvent = (event: CaseIoEvent, rows: CaseIoRun[]) => {
      if (rows.length === 0) return null;
      const bolusRowsAll = rows.filter(run => (run.entry_mode || "bolus") === "bolus");
      if (bolusRowsAll.length > 0) {
        const activeBolusRows = bolusRowsAll.filter(run => {
          const start = Number(run.started_at);
          const end = run.stopped_at == null ? Infinity : Number(run.stopped_at);
          return event.event_ts >= start && event.event_ts <= end;
        });
        const bolusCandidates = activeBolusRows.length > 0 ? activeBolusRows : bolusRowsAll;
        return (
          [...bolusCandidates].sort((a, b) => {
            const startA = Number(a.started_at) || 0;
            const startB = Number(b.started_at) || 0;
            const distA = Math.abs(event.event_ts - startA);
            const distB = Math.abs(event.event_ts - startB);
            if (distA !== distB) return distA - distB;
            if (startA !== startB) return startB - startA;
            return a.id - b.id;
          })[0] || null
        );
      }
      const matched = rows.filter(run => {
        const start = Number(run.started_at);
        const end = run.stopped_at == null ? Infinity : Number(run.stopped_at);
        return event.event_ts >= start && event.event_ts <= end;
      });
      const scoped = matched.length > 0 ? matched : rows;
      const candidates = scoped;
      return (
        [...candidates].sort((a, b) => {
          const startA = Number(a.started_at) || 0;
          const startB = Number(b.started_at) || 0;
          const distA = Math.abs(event.event_ts - startA);
          const distB = Math.abs(event.event_ts - startB);
          if (distA !== distB) return distA - distB;
          if (startA !== startB) return startB - startA;
          return a.id - b.id;
        })[0] || null
      );
    };

    const findRunForEvent = (event: CaseIoEvent) => {
      const key = `${event.kind}:${event.item_id}`;
      const rows = runMap.get(key) || [];
      return selectRunForEvent(event, rows);
    };

    const axisStart = axis[0];
    const axisEndExclusive = axis[axis.length - 1] + stepMs;
    const bucketTsFor = (rawTs: number) => {
      if (!Number.isFinite(rawTs) || rawTs < axisStart || rawTs >= axisEndExclusive) return null;
      const index = Math.floor((rawTs - axisStart) / stepMs);
      return axis[index] ?? null;
    };
    const eventsByBucket = new Map<number, CaseIoEvent[]>();
    for (const ioEvent of ioEvents) {
      if (ioEvent.include_in_balance === 0) continue;
      const amount = ioEvent.kind === "med" ? Number(ioEvent.dose_value) : Number(ioEvent.volume_ml);
      if (!Number.isFinite(amount) || amount <= 0 || findRunForEvent(ioEvent) == null) continue;
      const bucketTs = bucketTsFor(Number(ioEvent.event_ts));
      if (bucketTs == null) continue;
      const bucket = eventsByBucket.get(bucketTs) || [];
      bucket.push(ioEvent);
      eventsByBucket.set(bucketTs, bucket);
    }
    const dripStartsByBucket = new Map<
      number,
      Array<{ run: CaseIoRun; segment: NonNullable<CaseIoRun["segments"]>[number] }>
    >();
    for (const run of sortedPreparedRuns) {
      if (run.entry_mode !== "drip" || !Array.isArray(run.segments)) continue;
      const firstSegment = [...run.segments]
        .filter(segment => isVisibleIoSegment(segment))
        .sort((a, b) => Number(a.ts_from) - Number(b.ts_from))[0];
      if (!firstSegment) continue;
      const bucketTs = bucketTsFor(Number(firstSegment.ts_from));
      if (bucketTs == null) continue;
      const bucket = dripStartsByBucket.get(bucketTs) || [];
      bucket.push({ run, segment: firstSegment });
      dripStartsByBucket.set(bucketTs, bucket);
    }

    for (const ts of axis) {
      const bucketEvents = eventsByBucket.get(ts) || [];
      const markerTypeKey = (marker: ClinicalTimelineIoMarker) => {
        const category = String(marker.item_category || "").toLowerCase();
        if (marker.kind === "med") return marker.marker_code === "d" ? "medDrip" : "medBolus";
        if (marker.kind === "fluid") return category === "bloodproduct" ? "bloodProduct" : "fluid";
        if (category === "bloodlossoutput") return "bloodLoss";
        if (category === "urineoutput") return "urine";
        return "otherOutput";
      };
      const markerRank: Record<string, number> = {
        medBolus: 0,
        medDrip: 1,
        fluid: 2,
        bloodProduct: 3,
        bloodLoss: 4,
        urine: 5,
        otherOutput: 6,
      };
      const pushTypeMarker = (marker: ClinicalTimelineIoMarker) => {
        const typeKey = markerTypeKey(marker);
        const existing = next[ts].find(candidate => markerTypeKey(candidate) === typeKey);
        if (existing) {
          const names = new Set(
            `${existing.item_name}\n${marker.item_name}`
              .split("\n")
              .map(name => name.trim())
              .filter(Boolean),
          );
          existing.item_name = Array.from(names).join("\n");
          return;
        }
        next[ts].push(marker);
      };

      for (const ioEvent of bucketEvents) {
        const run = findRunForEvent(ioEvent);
        if (!run || run.entry_mode === "drip") continue;
        pushTypeMarker({
          run_id: run.id,
          item_id: run.item_id,
          kind: run.kind,
          item_name: run.item_name || run.item_code || (run.kind === "output" ? "Output" : "Intake"),
          item_category: run.item_category || "",
          marker_code: run.kind === "output" ? "o" : "i",
        });
      }

      for (const { run, segment: firstSegment } of dripStartsByBucket.get(ts) || []) {
        pushTypeMarker({
          run_id: run.id,
          item_id: run.item_id,
          kind: run.kind,
          item_name: formatDripMarkerDetail(run, firstSegment),
          item_category: run.item_category || "",
          marker_code: "d",
        });
      }

      next[ts].sort((a, b) => markerRank[markerTypeKey(a)] - markerRank[markerTypeKey(b)]);
    }

    return next;
  }, [axis, ioEvents, sortedPreparedRuns]);

  const ioGridValues = useMemo<ClinicalTimelineValues>(() => {
    if (axis.length === 0 || sortedPreparedRuns.length === 0) return {};
    const stepMs = axis.length > 1 ? Math.max(1, axis[1] - axis[0]) : 60_000;
    const startTs = axis[0];
    const endExclusiveTs = axis[axis.length - 1] + stepMs;
    const next: ClinicalTimelineValues = {};
    const isIoCellValue = (value: unknown): value is IoGridCellValue =>
      Boolean(
        value &&
          typeof value === "object" &&
          "kind" in (value as Record<string, unknown>) &&
          (value as { kind?: unknown }).kind === "io_cell",
      );
    const segmentRateToMlPerHour = (rateValue: number, rateUnit?: string | null) => {
      if (!Number.isFinite(rateValue) || rateValue <= 0) return null;
      const unit = String(rateUnit || "")
        .toLowerCase()
        .replace(/\s+/g, "");
      if (!unit || unit === "ml/hr" || unit === "ml/h" || unit === "mlhr")
        return rateValue;
      if (unit === "l/hr" || unit === "l/h" || unit === "lhr")
        return rateValue * 1000;
      return null;
    };
    const ensureIoCell = (rowId: string, bucketTs: number): IoGridCellValue => {
      const raw = next[rowId]?.[bucketTs];
      if (isIoCellValue(raw)) return raw;
      const parsed = Number(raw);
      const cell: IoGridCellValue = {
        kind: "io_cell",
      };
      if (Number.isFinite(parsed) && parsed > 0) {
        cell.amount = parsed;
      }
      next[rowId][bucketTs] = cell;
      return cell;
    };
    const mergeDripPart = (
      existing: IoDripPart | undefined,
      incoming: IoDripPart,
    ): IoDripPart => {
      if (!existing || existing === incoming) return incoming;
      if (existing === "single" || incoming === "single") return "single";
      if (
        (existing === "start" && incoming === "end") ||
        (existing === "end" && incoming === "start")
      ) {
        return "single";
      }
      if (incoming === "start" || existing === "start") return "start";
      if (incoming === "end" || existing === "end") return "end";
      return "mid";
    };

    for (const run of sortedPreparedRuns) {
      const rowId = ioTimelineRowIdForRun(run);
      next[rowId] ||= {};
    }

    const selectRunForEvent = (event: CaseIoEvent) => {
      const matchingRuns = sortedPreparedRuns.filter(
        run => run.item_id === event.item_id && run.kind === event.kind,
      );
      if (matchingRuns.length === 0) return null;
      const bolusRowsAll = matchingRuns.filter(run => (run.entry_mode || "bolus") === "bolus");
      if (bolusRowsAll.length > 0) {
        const activeBolusRows = bolusRowsAll.filter(run => {
          const start = Number(run.started_at);
          const end = run.stopped_at == null ? Infinity : Number(run.stopped_at);
          return event.event_ts >= start && event.event_ts <= end;
        });
        const bolusCandidates = activeBolusRows.length > 0 ? activeBolusRows : bolusRowsAll;
        return (
          [...bolusCandidates].sort((a, b) => {
            const startA = Number(a.started_at) || 0;
            const startB = Number(b.started_at) || 0;
            const distA = Math.abs(event.event_ts - startA);
            const distB = Math.abs(event.event_ts - startB);
            if (distA !== distB) return distA - distB;
            if (startA !== startB) return startB - startA;
            return a.id - b.id;
          })[0] || null
        );
      }
      const activeRuns = matchingRuns.filter(run => {
        const start = Number(run.started_at);
        const end = run.stopped_at == null ? Infinity : Number(run.stopped_at);
        return event.event_ts >= start && event.event_ts <= end;
      });
      const scoped = activeRuns.length > 0 ? activeRuns : matchingRuns;
      const candidates = scoped;
      return (
        [...candidates].sort((a, b) => {
          const startA = Number(a.started_at) || 0;
          const startB = Number(b.started_at) || 0;
          const distA = Math.abs(event.event_ts - startA);
          const distB = Math.abs(event.event_ts - startB);
          if (distA !== distB) return distA - distB;
          if (startA !== startB) return startB - startA;
          return a.id - b.id;
        })[0] || null
      );
    };

    for (const run of sortedPreparedRuns) {
      const rowId = ioTimelineRowIdForRun(run);
      const segments = Array.isArray(run.segments)
        ? [...run.segments].sort((a, b) => Number(a.ts_from) - Number(b.ts_from))
        : [];
      let runDeliveredBeforeSegmentMl = 0;
      const runGroupTone = run.kind === "fluid" ? "fluid" : medDripGroupTone(run.item_category);
      for (const segment of segments) {
        if (segment.include_in_balance === 0) continue;
        const segStartRaw = Number(segment.ts_from);
        if (!Number.isFinite(segStartRaw)) continue;
        const segEndRaw =
          segment.ts_to != null && Number.isFinite(Number(segment.ts_to))
            ? Number(segment.ts_to)
            : run.stopped_at == null
              ? endExclusiveTs
              : Number(run.stopped_at);
        const segStart = Math.max(startTs, segStartRaw);
        const segEnd = Math.min(endExclusiveTs, segEndRaw);
        if (!Number.isFinite(segEnd) || segEnd <= segStart) continue;

        const rateMlPerHr = segmentRateToMlPerHour(
          Number(segment.rate_value),
          segment.rate_unit,
        );
        const carrierMlPerHr = Number(segment.carrier_ml_per_hr);
        const normalizedCarrierMlPerHr =
          Number.isFinite(carrierMlPerHr) && carrierMlPerHr > 0
            ? carrierMlPerHr
            : 0;
        const isDripSegment =
          run.entry_mode === "drip" ||
          (rateMlPerHr != null && rateMlPerHr > 0) ||
          normalizedCarrierMlPerHr > 0;

        const startIdx = Math.max(0, Math.floor((segStart - startTs) / stepMs));
        const endIdx = Math.min(
          axis.length - 1,
          Math.floor((Math.max(segStart, segEnd - 1) - startTs) / stepMs),
        );
        for (let idx = startIdx; idx <= endIdx; idx += 1) {
          const bucketTs = axis[idx];
          const bucketStart = bucketTs;
          const bucketEnd = bucketStart + stepMs;
          const overlapStart = Math.max(segStart, bucketStart);
          const overlapEnd = Math.min(segEnd, bucketEnd);
          if (overlapEnd <= overlapStart) continue;
          
          const cell = ensureIoCell(rowId, bucketTs);
          const dripPart: IoDripPart =
            startIdx === endIdx
              ? "single"
              : idx === startIdx
                ? "start"
                : idx === endIdx
                  ? "end"
                  : "mid";
          
          const hours = (overlapEnd - overlapStart) / 3_600_000;
          const baseMl = rateMlPerHr == null ? 0 : Math.max(0, rateMlPerHr) * hours;
          const carrierMl = run.kind === "output" ? 0 : normalizedCarrierMlPerHr * hours;
          const amount = baseMl + carrierMl;

          if (isDripSegment) {
            cell.dripPart = mergeDripPart(cell.dripPart, dripPart);
            cell.dripGroupTone = runGroupTone;
            if (rateMlPerHr != null && rateMlPerHr > 0) cell.dripRateMlPerHr = rateMlPerHr;
            if (normalizedCarrierMlPerHr > 0) cell.dripCarrierMlPerHr = normalizedCarrierMlPerHr;
            cell.dripBucketVolumeMl = round2(
              Math.max(0, Number(cell.dripBucketVolumeMl ?? 0)) + amount,
            );
            const elapsedHoursFromSegmentStart = Math.max(0, overlapEnd - segStartRaw) / 3_600_000;
            const segmentDeliveredUntilBucketEnd =
              (rateMlPerHr == null ? 0 : Math.max(0, rateMlPerHr) * elapsedHoursFromSegmentStart) +
              normalizedCarrierMlPerHr * elapsedHoursFromSegmentStart;
            cell.dripCumulativeVolumeMl = round2(
              Math.max(
                Number(cell.dripCumulativeVolumeMl ?? 0),
                runDeliveredBeforeSegmentMl + segmentDeliveredUntilBucketEnd,
              ),
            );
            cell.segmentId = segment.id;
            cell.segmentTsFrom = Number(segment.ts_from);
            cell.segmentTsTo = segment.ts_to == null ? null : Number(segment.ts_to);
            cell.segmentDoseValue = segment.dose_value == null ? null : Number(segment.dose_value);
            cell.segmentDoseUnit = segment.dose_unit ?? null;
            cell.segmentRateUnit = segment.rate_unit ?? null;
            cell.segmentNote = segment.note ?? null;

            const displayRate =
              rateMlPerHr != null && rateMlPerHr > 0
                ? rateMlPerHr
                : normalizedCarrierMlPerHr > 0
                  ? normalizedCarrierMlPerHr
                  : null;
            if (displayRate != null) {
              cell.amount = round2(displayRate);
            }
          } else {
            cell.amount = Number(((cell.amount ?? 0) + amount).toFixed(2));
          }

          // For drip segments, we don't necessarily show individual minutes unless they are discrete events
          // but we can add the bucket total if requested. For now focusing on event-based minute values below.
        }
        if (isDripSegment) {
          const fullSegmentHours = Math.max(0, segEnd - segStartRaw) / 3_600_000;
          const fullSegmentDelivered =
            (rateMlPerHr == null ? 0 : Math.max(0, rateMlPerHr) * fullSegmentHours) +
            normalizedCarrierMlPerHr * fullSegmentHours;
          runDeliveredBeforeSegmentMl += fullSegmentDelivered;
        }
      }
    }

    for (const event of ioEvents) {
      if (event.event_ts < startTs || event.event_ts >= endExclusiveTs) continue;
      const index = Math.floor((event.event_ts - startTs) / stepMs);
      if (index < 0 || index >= axis.length) continue;
      const bucketTs = axis[index];

      const chosen = selectRunForEvent(event);
      if (!chosen) continue;

      const amount = event.kind === "med" ? Number(event.dose_value) : Number(event.volume_ml);
      if (!Number.isFinite(amount) || amount <= 0) continue;

      const groupedRowId = ioTimelineRowIdForRun(chosen);
      const cell = ensureIoCell(groupedRowId, bucketTs);
      
      cell.amount = Number(((cell.amount ?? 0) + amount).toFixed(2));
      
      // Populate minuteValues for individual minute display
      if (!cell.minuteValues) {
        cell.minuteValues = [];
        for (let m = 0; m < axisStepMin; m++) {
          cell.minuteValues.push({ ts: bucketTs + m * 60_000, amount: 0 });
        }
      }
      const mv = cell.minuteValues.find(v => v.ts === event.event_ts);
      if (mv) {
        mv.amount = Number((mv.amount + amount).toFixed(2));
      }
    }

    return next;
  }, [axis, axisStepMin, ioEvents, sortedPreparedRuns]);
  const ioDripRateByRowTs = useMemo<Record<string, Record<number, number>>>(() => {
    if (axis.length === 0 || sortedPreparedRuns.length === 0) return {};
    const stepMs = axis.length > 1 ? Math.max(1, axis[1] - axis[0]) : 60_000;
    const startTs = axis[0];
    const endExclusiveTs = axis[axis.length - 1] + stepMs;
    const next: Record<string, Record<number, number>> = {};

    const segmentRateToMlPerHour = (rateValue: number, rateUnit?: string | null) => {
      if (!Number.isFinite(rateValue) || rateValue <= 0) return null;
      const unit = String(rateUnit || "")
        .toLowerCase()
        .replace(/\s+/g, "");
      if (!unit || unit === "ml/hr" || unit === "ml/h" || unit === "mlhr") return rateValue;
      if (unit === "l/hr" || unit === "l/h" || unit === "lhr") return rateValue * 1000;
      return null;
    };

    for (const run of sortedPreparedRuns) {
      const rowId = ioTimelineRowIdForRun(run);
      const segments = Array.isArray(run.segments) ? run.segments : [];
      for (const segment of segments) {
        if (segment.include_in_balance === 0) continue;
        const segStartRaw = Number(segment.ts_from);
        if (!Number.isFinite(segStartRaw)) continue;
        const segEndRaw =
          segment.ts_to != null && Number.isFinite(Number(segment.ts_to))
            ? Number(segment.ts_to)
            : run.stopped_at == null
              ? endExclusiveTs
              : Number(run.stopped_at);
        const segStart = Math.max(startTs, segStartRaw);
        const segEnd = Math.min(endExclusiveTs, segEndRaw);
        if (!Number.isFinite(segEnd) || segEnd <= segStart) continue;

        const rateMlPerHr = segmentRateToMlPerHour(
          Number(segment.rate_value),
          segment.rate_unit,
        );
        if (rateMlPerHr == null || rateMlPerHr <= 0) continue;

        const startIdx = Math.max(0, Math.floor((segStart - startTs) / stepMs));
        const endIdx = Math.min(
          axis.length - 1,
          Math.floor((Math.max(segStart, segEnd - 1) - startTs) / stepMs),
        );
        for (let idx = startIdx; idx <= endIdx; idx += 1) {
          const bucketTs = axis[idx];
          (next[rowId] ||= {})[bucketTs] = round2(rateMlPerHr);
        }
      }
    }

    return next;
  }, [axis, sortedPreparedRuns]);
  const combinedGridValues = useMemo(
    () => mergeValues(values, ioGridValues),
    [values, ioGridValues],
  );

  const axisStepMs = useMemo(
    () => (axis.length > 1 ? Math.max(1, axis[1] - axis[0]) : 60_000),
    [axis],
  );
  const modalRun = useMemo(() => {
    if (!ioPreparedModal) return null;
    return ioRuns.find(run => run.id === ioPreparedModal.runId) || null;
  }, [ioPreparedModal, ioRuns]);
  const modalExistingEvents = useMemo(() => {
    if (!ioPreparedModal || !modalRun) return [];
    const bucketStart = ioPreparedModal.ts;
    const bucketEnd = bucketStart + axisStepMs;
    return ioEvents.filter(
      event =>
        event.item_id === modalRun.item_id &&
        event.kind === modalRun.kind &&
        event.event_ts >= bucketStart &&
        event.event_ts < bucketEnd,
    );
  }, [axisStepMs, ioEvents, ioPreparedModal, modalRun]);
  const modalBloodType = useMemo(
    () => resolveBloodProductEntryType(modalRun),
    [modalRun],
  );
  const isModalBloodProduct = useMemo(
    () => isBloodProductRun(modalRun),
    [modalRun],
  );
  const isModalLocalAnesthetic = useMemo(
    () => normalizeToken(modalRun?.item_category) === "localanesthetic",
    [modalRun],
  );
  const modalRequiresBloodGroup = isModalBloodProduct && (modalBloodType === "PRC" || modalBloodType === "FFP");

  const actor = {
    username: sessionUser?.username || "unknown",
    name: sessionUser?.name,
    role: sessionUser?.role,
  };
  const patientDocumentSummary = useMemo(
    () =>
      caseStatus.status === "IDLE"
        ? { name: "", an: "" }
        : readPatientDocumentSummary(caseStatus.case_id),
    [caseStatus],
  );
  const renderBloodIdentityComparison = (
    verified: BloodProductVerificationResult | null,
    mode: "api" | "manual" | "registered" | null,
  ) => {
    if (!verified && mode !== "manual") return null;
    const floraHn = caseStatus.status === "IDLE" ? "" : caseStatus.hn;
    const floraAn = patientDocumentSummary.an;
    const floraName = patientDocumentSummary.name;
    const hisHn = String(verified?.hn || "").trim();
    const hisAn = String(verified?.an || "").trim();
    const hisName = String(verified?.patient_name || "").trim();
    const hnOk = Boolean(floraHn && hisHn && floraHn === hisHn);
    const hasAnCompare = Boolean(floraAn || hisAn);
    const anOk = Boolean(floraAn && hisAn && floraAn === hisAn);
    const borderClass =
      mode === "manual"
        ? "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300"
        : hnOk && (!hasAnCompare || anOk)
          ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
          : "border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-300";
    return (
      <div className={`rounded border px-3 py-2 text-xs ${borderClass}`}>
        <div className="mb-1 font-semibold">
          {mode === "registered"
            ? "Registered bag check"
            : mode === "manual"
              ? "Manual bag check"
              : "HIS bag check"}
        </div>
        <div className="grid grid-cols-[80px_1fr_1fr_70px] gap-x-2 gap-y-1">
          <div />
          <div className="font-semibold">FLORA</div>
          <div className="font-semibold">HIS</div>
          <div className="font-semibold">Match</div>
          <div>HN</div>
          <div>{floraHn || "-"}</div>
          <div>{hisHn || "-"}</div>
          <div>{mode === "manual" ? "-" : hnOk ? "OK" : "No"}</div>
          <div>AN</div>
          <div>{floraAn || "-"}</div>
          <div>{hisAn || "-"}</div>
          <div>{mode === "manual" ? "-" : hasAnCompare ? anOk ? "OK" : "No" : "-"}</div>
          <div>Name</div>
          <div>{floraName || "-"}</div>
          <div>{hisName || "-"}</div>
          <div>-</div>
        </div>
        {verified ? (
          <div className="mt-1">
            Bag {verified.dnrno || "-"} | Req {verified.reqno || "-"} | {verified.bdtype || "Blood"} {[
              verified.bloodgrp,
              verified.rh,
            ].filter(Boolean).join("") || "-"} | Status {verified.unitstas || "-"}
          </div>
        ) : null}
      </div>
    );
  };

  const quickMedItems = useMemo(
    () => quickIoItems.filter(item => item.kind === "med"),
    [quickIoItems],
  );
  const quickMedCategoryOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const item of quickMedItems) {
      const category = String(item.category || "").trim();
      if (!category) continue;
      if (!map.has(category)) {
        map.set(category, quickMedGroupLabel(item));
      }
    }
    return Array.from(map.entries())
      .sort((a, b) => a[1].localeCompare(b[1], undefined, { sensitivity: "base" }))
      .map(([value, label]) => ({ value, label }));
  }, [quickMedItems]);
  const quickMedDripItems = useMemo(
    () =>
      quickIoItems.filter(
        item =>
          item.kind === "med" &&
          normalizeToken(item.category) !== "localanesthetic",
      ),
    [quickIoItems],
  );
  const carrierFluidOptions = useMemo(
    () =>
      quickIoItems
        .filter(
          item =>
            item.kind === "fluid" &&
            normalizeToken(item.category) !== "bloodproduct",
        )
        .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" })),
    [quickIoItems],
  );

  const quickMedMatches = useMemo(() => {
    const keyword = normalizeToken(quickMedSearch);
    if (!keyword || keyword.length < 2) return [];
    return quickMedItems
      .map(item => ({ item, score: scoreQuickMedMatch(item, keyword) }))
      .filter(entry => entry.score !== Number.MAX_SAFE_INTEGER)
      .sort((a, b) => {
        if (a.score !== b.score) return a.score - b.score;
        const prefixDistanceDelta =
          quickMedPrefixDistance(a.item, keyword) - quickMedPrefixDistance(b.item, keyword);
        if (prefixDistanceDelta !== 0) return prefixDistanceDelta;
        const rankDelta = usageRankForItem(a.item) - usageRankForItem(b.item);
        if (rankDelta !== 0) return rankDelta;
        const scoreDelta = usageScoreForItem(b.item) - usageScoreForItem(a.item);
        if (scoreDelta !== 0) return scoreDelta;
        return a.item.name.localeCompare(b.item.name, undefined, { sensitivity: "base" });
      })
      .slice(0, 20)
      .map(entry => entry.item);
  }, [quickMedItems, quickMedSearch]);
  const quickMedFuzzyMatches = useMemo(() => {
    const keyword = normalizeToken(quickMedSearch);
    if (!keyword || keyword.length < 4 || quickMedMatches.length > 0) return [];
    return quickMedItems
      .map(item => ({ item, score: scoreQuickMedFuzzyMatch(item, keyword) }))
      .filter(entry => entry.score !== Number.MAX_SAFE_INTEGER)
      .sort((a, b) => {
        if (a.score !== b.score) return a.score - b.score;
        const rankDelta = usageRankForItem(a.item) - usageRankForItem(b.item);
        if (rankDelta !== 0) return rankDelta;
        const scoreDelta = usageScoreForItem(b.item) - usageScoreForItem(a.item);
        if (scoreDelta !== 0) return scoreDelta;
        return a.item.name.localeCompare(b.item.name, undefined, { sensitivity: "base" });
      })
      .slice(0, 3)
      .map(entry => entry.item);
  }, [quickMedItems, quickMedMatches.length, quickMedSearch]);
  const quickMedNeedsManualFallback =
    normalizeToken(quickMedSearch).length >= 2 &&
    quickMedMatches.length === 0 &&
    quickMedFuzzyMatches.length === 0;

  const selectedQuickMedItem = useMemo(() => {
    if (quickMedItemId == null) return null;
    return quickMedItems.find(item => item.id === quickMedItemId) || null;
  }, [quickMedItems, quickMedItemId]);
  const quickMedDripMatches = useMemo(() => {
    const keyword = normalizeToken(quickMedDripSearch);
    if (!keyword || keyword.length < 2) return [];
    return quickMedDripItems
      .map(item => ({ item, score: scoreQuickMedMatch(item, keyword) }))
      .filter(entry => entry.score !== Number.MAX_SAFE_INTEGER)
      .sort((a, b) => {
        if (a.score !== b.score) return a.score - b.score;
        const prefixDistanceDelta =
          quickMedPrefixDistance(a.item, keyword) - quickMedPrefixDistance(b.item, keyword);
        if (prefixDistanceDelta !== 0) return prefixDistanceDelta;
        const rankDelta = usageRankForItem(a.item) - usageRankForItem(b.item);
        if (rankDelta !== 0) return rankDelta;
        const scoreDelta = usageScoreForItem(b.item) - usageScoreForItem(a.item);
        if (scoreDelta !== 0) return scoreDelta;
        return a.item.name.localeCompare(b.item.name, undefined, { sensitivity: "base" });
      })
      .slice(0, 20)
      .map(entry => entry.item);
  }, [quickMedDripItems, quickMedDripSearch]);
  const selectedQuickMedDripItem = useMemo(() => {
    if (quickMedDripItemId == null) return null;
    return quickMedDripItems.find(item => item.id === quickMedDripItemId) || null;
  }, [quickMedDripItemId, quickMedDripItems]);
  const drippedQuickMedicationItemIds = useMemo(
    () =>
      new Set(
        ioRuns
          .filter(
            run =>
              run.kind === "med" &&
              run.entry_mode === "drip" &&
              Number(run.include_in_balance ?? 1) !== 0,
          )
          .map(run => run.item_id),
      ),
    [ioRuns],
  );
  const popularQuickMedDripItems = useMemo(
    () =>
      POPULAR_DRIP_MEDICATIONS.flatMap(name => {
        const item = quickMedDripItems.find(candidate => normalizeToken(candidate.name) === normalizeToken(name));
        return item && !drippedQuickMedicationItemIds.has(item.id) ? [item] : [];
      }),
    [drippedQuickMedicationItemIds, quickMedDripItems],
  );
  const quickMedDripSuggestion = useMemo(
    () => getHistoricalDripSuggestion(selectedQuickMedDripItem?.name),
    [selectedQuickMedDripItem?.name],
  );
  const quickMedDripFuzzyMatches = useMemo(() => {
    const keyword = normalizeToken(quickMedDripSearch);
    if (!keyword || keyword.length < 4 || quickMedDripMatches.length > 0) return [];
    return quickMedDripItems
      .map(item => ({ item, score: scoreQuickMedFuzzyMatch(item, keyword) }))
      .filter(entry => entry.score !== Number.MAX_SAFE_INTEGER)
      .sort((a, b) => {
        if (a.score !== b.score) return a.score - b.score;
        const rankDelta = usageRankForItem(a.item) - usageRankForItem(b.item);
        if (rankDelta !== 0) return rankDelta;
        const scoreDelta = usageScoreForItem(b.item) - usageScoreForItem(a.item);
        if (scoreDelta !== 0) return scoreDelta;
        return a.item.name.localeCompare(b.item.name, undefined, { sensitivity: "base" });
      })
      .slice(0, 3)
      .map(entry => entry.item);
  }, [quickMedDripItems, quickMedDripMatches.length, quickMedDripSearch]);
  const quickMedIsLocalAnesthetic =
    normalizeToken(selectedQuickMedItem?.category) === "localanesthetic";

  useEffect(() => {
    if (!selectedQuickMedItem) return;
    const defaultUnit = String(selectedQuickMedItem.default_unit || "").trim();
    setQuickMedUnit(defaultUnit || "mg");
    setQuickMedRoute(prev => prev || DEFAULT_CASEVIEW_ROUTE);
  }, [selectedQuickMedItem]);

  useEffect(() => {
    if (!quickMedOpen) return;
    const frame = window.requestAnimationFrame(() => {
      quickMedSearchRef.current?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [quickMedOpen]);

  useEffect(() => {
    if (!quickMedDripOpen) return;
    const frame = window.requestAnimationFrame(() => {
      quickMedDripSearchRef.current?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [quickMedDripOpen]);

  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName;
      const editable =
        target?.isContentEditable ||
        tag === "INPUT" ||
        tag === "TEXTAREA" ||
        tag === "SELECT";
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
        if (editable) return;
        event.preventDefault();
        if (quickMedOpen) {
          closeQuickMed();
          return;
        }
        openQuickMed();
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "d") {
        if (editable) return;
        event.preventDefault();
        if (quickMedDripOpen) {
          closeQuickMedDrip();
          return;
        }
        openQuickMedDrip();
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "b") {
        if (editable) return;
        event.preventDefault();
        if (quickBloodProductOpen) {
          closeQuickBloodProduct();
          return;
        }
        if (bloodBoardOpen) {
          setBloodBoardOpen(false);
          return;
        }
        openBloodProductWorkflow();
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "f") {
        if (editable) return;
        event.preventDefault();
        if (quickFluidOpen) {
          closeQuickFluid();
          return;
        }
        openQuickFluid();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // The shortcut handler is intentionally rebound when its UI state changes;
    // action helpers below are render-local closures over that same state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quickMedOpen, quickMedDripOpen, quickBloodProductOpen, bloodBoardOpen, quickFluidOpen, quickMedSaving, quickMedDripSaving, quickBloodProductSaving, quickFluidSaving, caseId, caseStatus.status, shouldUseBloodBoard]);

  const quickMedCanSave =
    caseId != null &&
    caseStatus.status !== "IDLE" &&
    !quickMedSaving &&
    (selectedQuickMedItem != null ||
      (quickMedManualMode &&
        quickMedSearch.trim().length > 0 &&
        quickMedManualCategory.trim().length > 0));

  const selectedQuickMedDripGroupLabel = useMemo(
    () => {
      if (selectedQuickMedDripItem) return quickMedGroupLabel(selectedQuickMedDripItem);
      if (quickMedDripManualMode && quickMedDripManualCategory) {
        return (
          quickMedCategoryOptions.find(option => option.value === quickMedDripManualCategory)?.label ||
          "Medication"
        );
      }
      return "Medication";
    },
    [quickMedCategoryOptions, quickMedDripManualCategory, quickMedDripManualMode, selectedQuickMedDripItem],
  );
  const quickMedDripCanSave =
    caseId != null &&
    caseStatus.status !== "IDLE" &&
    !quickMedDripSaving &&
    !quickMedDripStopping &&
    (selectedQuickMedDripItem != null ||
      (quickMedDripManualMode &&
        quickMedDripSearch.trim().length > 0 &&
        quickMedDripManualCategory.trim().length > 0));
  const quickMedDripIsWeightBased = useMemo(
    () =>
      DOSE_PER_KG_RATE_UNITS.includes(
        quickMedDripDoseUnit as (typeof DOSE_PER_KG_RATE_UNITS)[number],
      ),
    [quickMedDripDoseUnit],
  );
  const quickMedDripDoseUnitOptions = useMemo(() => {
    const family = medDripUnitFamily(quickMedDripAmountUnit);
    if (family === "units") {
      return ["units/min", "units/hr", "MUnits/min", "MUnits/hr"] as const;
    }
    return CASEVIEW_DOSE_RATE_UNITS.filter(
      unit =>
        unit === "mcg/min" ||
        unit === "mg/min" ||
        unit === "mcg/hr" ||
        unit === "mg/hr" ||
        DOSE_PER_KG_RATE_UNITS.includes(unit as (typeof DOSE_PER_KG_RATE_UNITS)[number]),
    );
  }, [quickMedDripAmountUnit]);
  const quickMedDripCalculatedRateMlHr = useMemo(() => {
    const amountValue = parsePositiveNumber(quickMedDripAmountValue);
    const totalVolumeMl = parsePositiveNumber(quickMedDripTotalVolumeMl);
    const doseValue = parsePositiveNumber(quickMedDripDoseValue);
    if (amountValue == null || totalVolumeMl == null || doseValue == null) return null;

    const amountFamily = medDripUnitFamily(quickMedDripAmountUnit);
    const baseAmount = amountToDripBase(amountValue, quickMedDripAmountUnit);
    if (amountFamily == null || baseAmount == null || baseAmount <= 0) return null;
    const basePerMl = baseAmount / totalVolumeMl;
    if (!Number.isFinite(basePerMl) || basePerMl <= 0) return null;

    if (quickMedDripIsWeightBased) {
      const weightKg = parsePositiveNumber(quickMedDripWeightKg);
      const doseMcgPerKgMin = doseToMcgPerKgMin(doseValue, quickMedDripDoseUnit);
      if (amountFamily !== "mass" || weightKg == null || doseMcgPerKgMin == null) return null;
      return round4((doseMcgPerKgMin * weightKg * 60) / basePerMl);
    }

    const doseBasePerHour = doseRateToDripBasePerHour(doseValue, quickMedDripDoseUnit);
    if (doseBasePerHour == null) return null;
    return round4(doseBasePerHour / basePerMl);
  }, [
    quickMedDripAmountUnit,
    quickMedDripAmountValue,
    quickMedDripDoseUnit,
    quickMedDripDoseValue,
    quickMedDripIsWeightBased,
    quickMedDripTotalVolumeMl,
    quickMedDripWeightKg,
  ]);
  const quickMedDripCalculatedDoseValue = useMemo(() => {
    const amountValue = parsePositiveNumber(quickMedDripAmountValue);
    const totalVolumeMl = parsePositiveNumber(quickMedDripTotalVolumeMl);
    const rateMlHr = parsePositiveNumber(quickMedDripRateMlHr);
    if (amountValue == null || totalVolumeMl == null || rateMlHr == null) return null;

    const amountFamily = medDripUnitFamily(quickMedDripAmountUnit);
    const baseAmount = amountToDripBase(amountValue, quickMedDripAmountUnit);
    if (amountFamily == null || baseAmount == null || baseAmount <= 0) return null;
    const basePerMl = baseAmount / totalVolumeMl;
    if (!Number.isFinite(basePerMl) || basePerMl <= 0) return null;

    if (quickMedDripIsWeightBased) {
      const weightKg = parsePositiveNumber(quickMedDripWeightKg);
      if (amountFamily !== "mass" || weightKg == null || weightKg <= 0) return null;
      const mcgPerKgPerMin = (rateMlHr * basePerMl) / 60 / weightKg;
      const converted = mcgPerKgMinToUnit(mcgPerKgPerMin, quickMedDripDoseUnit);
      return converted == null ? null : round4(converted);
    }

    const basePerHour = rateMlHr * basePerMl;
    const converted = dripBasePerHourToDoseRate(basePerHour, quickMedDripDoseUnit);
    return converted == null ? null : round4(converted);
  }, [
    quickMedDripAmountUnit,
    quickMedDripAmountValue,
    quickMedDripDoseUnit,
    quickMedDripIsWeightBased,
    quickMedDripRateMlHr,
    quickMedDripTotalVolumeMl,
    quickMedDripWeightKg,
  ]);
  const quickMedDripSegmentRateToMlPerHour = (rateValue: number, rateUnit?: string | null) => {
    if (!Number.isFinite(rateValue) || rateValue <= 0) return null;
    const unit = String(rateUnit || "")
      .toLowerCase()
      .replace(/\s+/g, "");
    if (!unit || unit === "ml/hr" || unit === "ml/h" || unit === "mlhr") return rateValue;
    if (unit === "l/hr" || unit === "l/h" || unit === "lhr") return rateValue * 1000;
    return null;
  };
  const quickMedDripCurrentProgress = useMemo(() => {
    if (!quickMedDripEditTarget) return null;
    const run = preparedRunById.get(quickMedDripEditTarget.runId);
    if (!run) return null;
    const changeTs = toTsFromDateAndTime(quickMedDripDate, quickMedDripTime) ?? quickMedDripEditTarget.clickedTs;
    const totalVolumeMl = parsePositiveNumber(quickMedDripTotalVolumeMl);
    const amountValue = parsePositiveNumber(quickMedDripAmountValue);
    const baseAmount = amountValue == null ? null : amountToDripBase(amountValue, quickMedDripAmountUnit);
    let infusedMl = 0;
    for (const segment of Array.isArray(run.segments) ? run.segments : []) {
      if (segment.include_in_balance === 0) continue;
      const segStart = Number(segment.ts_from);
      if (!Number.isFinite(segStart) || segStart >= changeTs) continue;
      const segEnd =
        segment.ts_to != null && Number.isFinite(Number(segment.ts_to))
          ? Number(segment.ts_to)
          : changeTs;
      const effectiveEnd = Math.min(changeTs, segEnd);
      if (!Number.isFinite(effectiveEnd) || effectiveEnd <= segStart) continue;
      const rateMlPerHr = quickMedDripSegmentRateToMlPerHour(Number(segment.rate_value), segment.rate_unit);
      const carrierMlPerHr = Number.isFinite(Number(segment.carrier_ml_per_hr))
        ? Number(segment.carrier_ml_per_hr)
        : 0;
      const hours = (effectiveEnd - segStart) / 3_600_000;
      infusedMl += Math.max(0, rateMlPerHr ?? 0) * hours + Math.max(0, carrierMlPerHr) * hours;
    }
    const deliveredBase =
      baseAmount != null && totalVolumeMl != null && totalVolumeMl > 0
        ? (baseAmount / totalVolumeMl) * infusedMl
        : null;
    return {
      infusedMl: round2(infusedMl),
      totalVolumeMl: totalVolumeMl ?? null,
      deliveredBase,
      suggestedStopTs: (() => {
        if (totalVolumeMl == null || totalVolumeMl <= 0) return null;
        const segments = [...(Array.isArray(run.segments) ? run.segments : [])]
          .filter(segment => segment.include_in_balance !== 0)
          .sort((a, b) => a.ts_from - b.ts_from || a.id - b.id);
        let cumulativeMl = 0;
        let activeRateMlHr: number | null = null;
        for (const segment of segments) {
          const segStart = Number(segment.ts_from);
          if (!Number.isFinite(segStart) || segStart > changeTs) continue;
          const rawSegEnd =
            segment.ts_to != null && Number.isFinite(Number(segment.ts_to))
              ? Number(segment.ts_to)
              : Number.POSITIVE_INFINITY;
          const effectiveEnd = Math.min(changeTs, rawSegEnd);
          const rateMlPerHr = quickMedDripSegmentRateToMlPerHour(
            Number(segment.rate_value),
            segment.rate_unit,
          );
          const carrierMlPerHr = Number.isFinite(Number(segment.carrier_ml_per_hr))
            ? Number(segment.carrier_ml_per_hr)
            : 0;
          const totalRateMlHr = Math.max(0, rateMlPerHr ?? 0) + Math.max(0, carrierMlPerHr);
          if (!(totalRateMlHr > 0)) continue;
          if (effectiveEnd > segStart) {
            const segmentMl = ((effectiveEnd - segStart) / 3_600_000) * totalRateMlHr;
            if (cumulativeMl + segmentMl >= totalVolumeMl) {
              const remainingMl = Math.max(0, totalVolumeMl - cumulativeMl);
              return segStart + (remainingMl / totalRateMlHr) * 3_600_000;
            }
            cumulativeMl += segmentMl;
          }
          if (rawSegEnd === Number.POSITIVE_INFINITY || changeTs < rawSegEnd) {
            activeRateMlHr = totalRateMlHr;
          }
        }
        if (activeRateMlHr != null && activeRateMlHr > 0 && cumulativeMl < totalVolumeMl) {
          return changeTs + ((totalVolumeMl - cumulativeMl) / activeRateMlHr) * 3_600_000;
        }
        return null;
      })(),
      deliveredDisplay:
        deliveredBase == null
          ? null
          : `${formatCompactAmount(
              quickMedDripAmountUnit.toLowerCase() === "mg"
                ? deliveredBase / 1000
                : quickMedDripAmountUnit.toLowerCase() === "g"
                  ? deliveredBase / 1_000_000
                  : quickMedDripAmountUnit.toLowerCase() === "munits"
                    ? deliveredBase / 1_000_000
                    : deliveredBase,
            )} ${normalizeDisplayUnit("med", quickMedDripAmountUnit)}`,
    };
  }, [
    preparedRunById,
    quickMedDripAmountUnit,
    quickMedDripAmountValue,
    quickMedDripDate,
    quickMedDripEditTarget,
    quickMedDripTime,
    quickMedDripTotalVolumeMl,
  ]);
  const quickMedDripCanStop = useMemo(() => {
    if (!quickMedDripEditTarget || quickMedDripEditTarget.segmentId == null) return false;
    const run = preparedRunById.get(quickMedDripEditTarget.runId);
    const segment =
      run && Array.isArray(run.segments)
        ? run.segments.find(candidate => candidate.id === quickMedDripEditTarget.segmentId) || null
        : null;
    if (!segment) return false;
    const segStart = Number(segment.ts_from);
    const segEnd =
      segment.ts_to != null && Number.isFinite(Number(segment.ts_to))
        ? Number(segment.ts_to)
        : Number.POSITIVE_INFINITY;
    const selectedTs =
      toTsFromDateAndTime(quickMedDripDate, quickMedDripTime) ?? quickMedDripEditTarget.clickedTs;
    return Number.isFinite(segStart) && selectedTs > segStart && selectedTs < segEnd;
  }, [
    preparedRunById,
    quickMedDripDate,
    quickMedDripEditTarget,
    quickMedDripTime,
  ]);

  useEffect(() => {
    if (!quickMedDripOpen || quickMedDripLastEdited !== "dose") return;
    const nextRate =
      quickMedDripCalculatedRateMlHr == null ? "" : String(quickMedDripCalculatedRateMlHr);
    setQuickMedDripRateMlHr(prev => (prev === nextRate ? prev : nextRate));
  }, [quickMedDripCalculatedRateMlHr, quickMedDripLastEdited, quickMedDripOpen]);

  useEffect(() => {
    if (!quickMedDripOpen || quickMedDripLastEdited !== "rate") return;
    const nextDose =
      quickMedDripCalculatedDoseValue == null ? "" : String(quickMedDripCalculatedDoseValue);
    setQuickMedDripDoseValue(prev => (prev === nextDose ? prev : nextDose));
  }, [quickMedDripCalculatedDoseValue, quickMedDripLastEdited, quickMedDripOpen]);

  useEffect(() => {
    if ((quickMedDripDoseUnitOptions as readonly string[]).includes(quickMedDripDoseUnit)) return;
    const normalizedDefaultUnit = normalizeDisplayUnit(
      "med",
      selectedQuickMedDripItem?.default_unit || quickMedDripAmountUnit || "mg",
    ).toLowerCase();
    if (normalizedDefaultUnit === "mcg") {
      setQuickMedDripDoseUnit("mcg/min");
      return;
    }
    if (normalizedDefaultUnit === "units") {
      setQuickMedDripDoseUnit("units/hr");
      return;
    }
    if (normalizedDefaultUnit === "munits") {
      setQuickMedDripDoseUnit("MUnits/hr");
      return;
    }
    setQuickMedDripDoseUnit("mg/hr");
  }, [quickMedDripAmountUnit, quickMedDripDoseUnit, quickMedDripDoseUnitOptions, selectedQuickMedDripItem]);

  const applyQuickMedSelection = (item: CaseIoItem, focusTime = false) => {
    setQuickMedItemId(item.id);
    setQuickMedSearch(item.name);
    setQuickMedManualMode(false);
    setQuickMedManualCategory("");
    setQuickMedRoute(
      normalizeToken(item.category) === "localanesthetic"
        ? DEFAULT_CASEVIEW_LOCAL_ROUTE
        : DEFAULT_CASEVIEW_ROUTE,
    );
    setQuickMedUnit(String(item.default_unit || "").trim() || "mg");
    setShowQuickMedDropdown(false);
    if (focusTime) {
      window.requestAnimationFrame(() => {
        quickMedTimeRef.current?.focus();
        quickMedTimeRef.current?.select();
      });
    }
  };

  const quickBloodProductItems = useMemo(
    () => quickIoItems.filter(item => normalizeToken(item.category) === "bloodproduct"),
    [quickIoItems],
  );
  const filteredQuickBloodProductItems = useMemo(() => {
    const q = normalizeToken(quickBloodProductSearch);
    if (!q || q.length < 2) return quickBloodProductItems;
    return quickBloodProductItems.filter(
      item =>
        normalizeToken(item.name).includes(q) ||
        normalizeToken(item.code || "").includes(q),
    );
  }, [quickBloodProductItems, quickBloodProductSearch]);
  const selectedQuickBloodProductItem = useMemo(
    () => quickBloodProductItems.find(item => item.id === quickBloodProductItemId) || null,
    [quickBloodProductItems, quickBloodProductItemId],
  );
  const quickBloodProductType = useMemo(
    () => resolveBloodProductEntryType(
      selectedQuickBloodProductItem
        ? ({ item_code: selectedQuickBloodProductItem.code, item_name: selectedQuickBloodProductItem.name } as unknown as import("../api/caseIoApi").CaseIoRun)
        : null
    ),
    [selectedQuickBloodProductItem],
  );
  const quickBloodProductEventTs = useMemo(
    () => toTsFromDateAndTime(quickBloodProductDate, quickBloodProductTime),
    [quickBloodProductDate, quickBloodProductTime],
  );
  const quickBloodProductHasVolume = (() => {
    const value = Number(quickBloodProductVolumeMl);
    return Number.isFinite(value) && value > 0;
  })();
  const signedInUserIsAnesthetist = normalizeToken(sessionUser?.role) === "anesthetist";
  const signedInGivingAuthorization: BloodGivingAuthorization | null = signedInUserIsAnesthetist
    ? {
        mode: "self",
        name: String(sessionUser?.name || sessionUser?.username || "Anesthetist").trim(),
        username: sessionUser?.username || undefined,
      }
    : null;
  const quickBloodProductHasTimeOut =
    quickBloodProductEventTs != null && hasTimeOutBefore(quickBloodProductEventTs);
  const quickFluidItems = useMemo(
    () =>
      quickIoItems.filter(
        item =>
          item.kind === "fluid" && normalizeToken(item.category) !== "bloodproduct",
      ),
    [quickIoItems],
  );
  const quickMedFluidMatches = useMemo(() => {
    const keyword = normalizeToken(quickMedSearch);
    if (!keyword || keyword.length < 2 || selectedQuickMedItem != null) return [];
    return quickFluidItems
      .map(item => ({
        item,
        score: scoreQuickMedMatch(item, keyword),
        fuzzy: scoreQuickMedFuzzyMatch(item, keyword),
      }))
      .filter(entry => entry.score !== Number.MAX_SAFE_INTEGER || entry.fuzzy !== Number.MAX_SAFE_INTEGER)
      .sort((a, b) => {
        const aPrimary = a.score !== Number.MAX_SAFE_INTEGER ? a.score : 100 + a.fuzzy;
        const bPrimary = b.score !== Number.MAX_SAFE_INTEGER ? b.score : 100 + b.fuzzy;
        if (aPrimary !== bPrimary) return aPrimary - bPrimary;
        return a.item.name.localeCompare(b.item.name, undefined, { sensitivity: "base" });
      })
      .slice(0, 3)
      .map(entry => entry.item);
  }, [quickFluidItems, quickMedSearch, selectedQuickMedItem]);
  const quickMedDripFluidMatches = useMemo(() => {
    const keyword = normalizeToken(quickMedDripSearch);
    if (!keyword || keyword.length < 2 || selectedQuickMedDripItem != null) return [];
    return quickFluidItems
      .map(item => ({
        item,
        score: scoreQuickMedMatch(item, keyword),
        fuzzy: scoreQuickMedFuzzyMatch(item, keyword),
      }))
      .filter(entry => entry.score !== Number.MAX_SAFE_INTEGER || entry.fuzzy !== Number.MAX_SAFE_INTEGER)
      .sort((a, b) => {
        const aPrimary = a.score !== Number.MAX_SAFE_INTEGER ? a.score : 100 + a.fuzzy;
        const bPrimary = b.score !== Number.MAX_SAFE_INTEGER ? b.score : 100 + b.fuzzy;
        if (aPrimary !== bPrimary) return aPrimary - bPrimary;
        return a.item.name.localeCompare(b.item.name, undefined, { sensitivity: "base" });
      })
      .slice(0, 3)
      .map(entry => entry.item);
  }, [quickFluidItems, quickMedDripSearch, selectedQuickMedDripItem]);
  const quickMedDripNeedsManualFallback =
    normalizeToken(quickMedDripSearch).length >= 2 &&
    quickMedDripMatches.length === 0 &&
    quickMedDripFuzzyMatches.length === 0 &&
    quickMedDripFluidMatches.length === 0;
  const filteredQuickFluidItems = useMemo(() => {
    const q = normalizeToken(quickFluidSearch);
    const sorted = [...quickFluidItems].sort((a, b) => a.name.localeCompare(b.name));
    if (!q || q.length < 2) return sorted.slice(0, 12);
    return sorted
      .filter(
        item =>
          normalizeToken(item.name).includes(q) ||
          normalizeToken(item.code || "").includes(q),
      )
      .slice(0, 12);
  }, [quickFluidItems, quickFluidSearch]);
  const selectedQuickFluidItem = useMemo(
    () => quickFluidItems.find(item => item.id === quickFluidItemId) || null,
    [quickFluidItems, quickFluidItemId],
  );

  const closeQuickBloodProduct = () => {
    if (quickBloodProductSaving) return;
    setQuickBloodProductOpen(false);
    setQuickBloodProductError("");
  };

  const resetQuickBloodProductVerification = () => {
    setQuickBloodProductVerified(null);
    setQuickBloodProductVerificationMode(null);
    setQuickBloodProductManualAvailable(false);
    setQuickBloodProductTypeLockedFromHis(false);
    setBloodBoardConfirmedAnesthetist(null);
  };

  const applyQuickBloodProductHisResult = (result: BloodProductVerificationResult) => {
    const verifiedGroup = formatVerifiedBloodGroup(result);
    if (verifiedGroup) setQuickBloodProductGroup(verifiedGroup);

    const dnrno = String(result.dnrno || "").trim();
    if (dnrno) setQuickBloodProductBagNo(dnrno);

    const targetType = normalizeBloodProductCode(result.bdtype);
    if (!targetType) return;
    const matched = quickBloodProductItems.find(item => {
      const itemType = normalizeBloodProductCode(`${item.code || ""} ${item.name || ""}`);
      return itemType === targetType || normalizeToken(item.code) === targetType || normalizeToken(item.name) === targetType;
    });
    if (matched) {
      setQuickBloodProductItemId(matched.id);
      setQuickBloodProductSearch(matched.name);
      setShowQuickBloodProductDropdown(false);
      setQuickBloodProductTypeLockedFromHis(true);
    }
  };

  const quickMedEventTs = useMemo(
    () => toTsFromDateAndTime(quickMedDate, quickMedTime),
    [quickMedDate, quickMedTime],
  );
  const openQuickFluidFromSuggestion = (item: CaseIoItem) => {
    closeQuickMed();
    closeQuickMedDrip();
    setQuickFluidOpen(true);
    setQuickFluidSearch(item.name);
    setQuickFluidItemId(item.id);
    setShowQuickFluidDropdown(false);
    setQuickFluidDate(formatDDMMYYYY(Date.now()));
    setQuickFluidTime(formatHHMM(Date.now()));
    setQuickFluidEntryMode("bolus");
    setQuickFluidVolumeMl("");
    setQuickFluidOverMin("");
    setQuickFluidRateMlHr("");
    setQuickFluidNote("");
    setQuickFluidError("");
    window.requestAnimationFrame(() => {
      quickFluidVolumeRef.current?.focus();
      quickFluidVolumeRef.current?.select();
    });
  };

  const bloodBoardRows = useMemo(() => {
    const byBagNo = new Map<string, BloodProductVerificationResult>();
    for (const row of bloodBoardRowsFromHis) {
      const bagNo = String(row.dnrno || "").trim();
      if (bagNo) byBagNo.set(bagNo, row);
    }
    const localNotes = [
      ...caseEventsAll.map(row => String(row.detail || "")),
      ...ioRuns.map(row => String(row.note || "")),
      ...ioEvents.map(row => String(row.note || "")),
    ];
    for (const note of localNotes) {
      const meta = parseKeyValueFromNote(note);
      const bagNo = String(meta.bloodBagNo || "").trim();
      if (!bagNo || byBagNo.has(bagNo)) continue;
      const groupParts = parseStoredBloodGroup(meta.bloodGroup);
      byBagNo.set(bagNo, {
        hn: caseStatus.status === "IDLE" ? "" : caseStatus.hn,
        an: meta.an || null,
        patient_name: meta.patientName || meta.patient_name || null,
        reqno: meta.reqno || null,
        bdtype: meta.bloodProductType || meta.product || null,
        dnrno: bagNo,
        bloodgrp: groupParts.bloodgrp,
        rh: groupParts.rh,
        unitstas: meta.unitstas || null,
      });
    }
    return Array.from(byBagNo.values()).sort((a, b) =>
      String(a.dnrno || "").localeCompare(String(b.dnrno || "")),
    );
  }, [bloodBoardRowsFromHis, caseEventsAll, ioEvents, ioRuns, caseStatus]);

  const bloodBoardStatusForBag = (bagNoRaw: string): BloodBoardLocalStatus => {
    const bagNo = String(bagNoRaw || "").trim();
    let status: BloodBoardLocalStatus = "Available";
    const priority: Record<BloodBoardLocalStatus, number> = {
      Available: 0,
      "Received in OR": 1,
      Warming: 2,
      "Giving recorded": 3,
      Completed: 4,
      "Stopped / Reaction": 4,
    };
    const notes = [
      ...caseEventsAll.map(row => String(row.detail || "")),
      ...ioRuns.map(row => String(row.note || "")),
      ...ioEvents.map(row => String(row.note || "")),
    ];
    for (const note of notes) {
      const meta = parseKeyValueFromNote(note);
      if (String(meta.bloodBagNo || "").trim() !== bagNo) continue;
      const candidate: BloodBoardLocalStatus | null =
        meta.workflow === "completed"
          ? "Completed"
          : meta.workflow === "stop_reaction"
            ? "Stopped / Reaction"
            : meta.workflow === "give" || meta.status === "warmed"
              ? "Giving recorded"
              : meta.workflow === "register_warming"
                ? "Warming"
                : meta.workflow === "received"
                  ? "Received in OR"
                  : null;
      if (candidate && priority[candidate] > priority[status]) status = candidate;
    }
    return status;
  };

  const loadBloodBoard = async () => {
    if (caseId == null || caseStatus.status === "IDLE") return;
    setBloodBoardLoading(true);
    setBloodBoardError("");
    try {
      const response = await getCaseBloodProducts(caseId, {
        an: patientDocumentSummary.an,
        patient_name: patientDocumentSummary.name,
      });
      setBloodBoardRowsFromHis(response.rows);
      setBloodBoardSource(response.source);
    } catch (err) {
      setBloodBoardError(err instanceof Error ? err.message : "Failed to load blood product list");
    } finally {
      setBloodBoardLoading(false);
    }
  };

  const loadBloodBoardAnesthetists = async () => {
    if (caseId == null || caseStatus.status === "IDLE") return;
    setBloodBoardAnesthetistsLoading(true);
    try {
      const rows = await getCaseStaff(caseId);
      setBloodBoardAnesthetists(
        rows.filter(row => normalizeToken(row.role_id || row.role) === "anesthetist"),
      );
    } catch (err) {
      setBloodBoardError(
        err instanceof Error ? err.message : "Failed to load anesthetists for verification",
      );
    } finally {
      setBloodBoardAnesthetistsLoading(false);
    }
  };

  const openBloodBoard = () => {
    setBloodBoardOpen(true);
    setBloodBoardError("");
    setBloodBoardSelectedAnesthetist("");
    setBloodBoardConfirmedAnesthetist(null);
    setBloodBoardOutcomeBag(null);
    setBloodBoardOutcomeDetail("");
    if (shouldUseBloodBoard) {
      seedEforlBloodBoard();
      return;
    }
    void loadBloodBoard();
    void loadBloodBoardAnesthetists();
  };

  const openQuickBloodProduct = (entryTs?: number) => {
    const targetTs = Number.isFinite(entryTs) ? Number(entryTs) : Date.now();
    setQuickBloodProductOpen(true);
    setQuickBloodProductError("");
    setQuickBloodProductSearch("");
    setQuickBloodProductItemId(null);
    setShowQuickBloodProductDropdown(false);
    setQuickBloodProductDate(formatDDMMYYYY(targetTs));
    setQuickBloodProductTime(formatHHMM(targetTs));
    setQuickBloodProductVolumeMl("");
    setQuickBloodProductGroup("");
    setQuickBloodProductBagNo("");
    setQuickBloodProductNote("");
    setQuickBloodProductVerified(null);
    setQuickBloodProductVerificationMode(null);
    setQuickBloodProductManualAvailable(false);
    setQuickBloodProductChecking(false);
    setQuickBloodProductTypeLockedFromHis(false);
    setBloodBoardSelectedAnesthetist("");
    setBloodBoardConfirmedAnesthetist(null);
    void loadBloodBoard();
    void loadBloodBoardAnesthetists();
    window.requestAnimationFrame(() => quickBloodProductBagRef.current?.focus());
  };

  const openBloodProductWorkflow = (entryTs?: number) => {
    if (shouldUseBloodBoard) {
      openBloodBoard();
      return;
    }
    openQuickBloodProduct(entryTs);
  };

  const registerEforlBloodBag = () => {
    const bagNo = eforlReceiveBagNo.trim().toUpperCase();
    if (!bagNo) {
      setBloodBoardError("Enter or scan bag number to register in OR");
      return;
    }
    const matched = eforlBloodBoardRows.find(
      row => String(row.dnrno || "").trim().toUpperCase() === bagNo,
    );
    if (!matched) {
      setBloodBoardError("Bag number not found in current HIS bag list");
      return;
    }
    setEforlBloodBoardRows(previous =>
      previous.map(row =>
        String(row.dnrno || "").trim().toUpperCase() === bagNo
          ? {
              ...row,
              receiveCondition: eforlReceiveCondition,
              orStage: eforlReceiveCondition === "Warmed" ? "Warmed" : "Received in OR",
            }
          : row,
      ),
    );
    setEforlReceiveBagNo("");
    setEforlReceiveCondition("Frozen");
    setBloodBoardError("");
  };

  const recordEforlBloodGiving = () => {
    const bagNo = eforlGiveBagNo.trim().toUpperCase();
    if (!bagNo) {
      setBloodBoardError("Enter or scan bag number before recording giving");
      return;
    }
    const matched = eforlBloodBoardRows.find(
      row => String(row.dnrno || "").trim().toUpperCase() === bagNo,
    );
    if (!matched) {
      setBloodBoardError("Bag number not found in current HIS bag list");
      return;
    }
    if (matched.orStage === "Pending") {
      setBloodBoardError("Register this bag into OR first before giving to patient");
      return;
    }
    const amount = Number(eforlGiveAmountMl);
    if (!Number.isFinite(amount) || amount <= 0) {
      setBloodBoardError("Enter blood amount in mL before marking as given");
      return;
    }
    setEforlBloodBoardRows(previous =>
      previous.map(row =>
        String(row.dnrno || "").trim().toUpperCase() === bagNo
          ? {
              ...row,
              orStage: "Given",
              givenAmountMl: String(amount),
            }
          : row,
      ),
    );
    setEforlGiveBagNo("");
    setEforlGiveAmountMl("");
    setBloodBoardError("");
  };

  const recordBloodBagReceived = async (row: BloodProductVerificationResult) => {
    if (caseId == null || caseStatus.status === "IDLE") return;
    const bagNo = String(row.dnrno || "").trim();
    if (!bagNo) return;
    setBloodBoardSavingBagNo(bagNo);
    setBloodBoardError("");
    const group = formatVerifiedBloodGroup(row);
    const detail = [
      "workflow:received",
      "status:received",
      row.bdtype ? `product:${row.bdtype}` : "",
      `bloodBagNo:${bagNo}`,
      group ? `bloodGroup:${group}` : "",
      row.reqno ? `reqno:${row.reqno}` : "",
      row.an ? `an:${row.an}` : "",
      row.unitstas ? `unitstas:${row.unitstas}` : "",
    ].filter(Boolean).join(" | ");
    try {
      const created = await createCaseEvent(caseId, {
        event_ts: Date.now(),
        event_type: "event",
        title: "Blood Product",
        detail,
        actor,
        reason: "blood board received in OR",
      });
      setCaseEventsAll(previous => [created as CaseEvent, ...previous]);
      notifyIoAndEventChanged(caseId);
    } catch (err) {
      setBloodBoardError(err instanceof Error ? err.message : "Failed to record received blood bag");
    } finally {
      setBloodBoardSavingBagNo(null);
    }
  };

  const bloodBoardMatchedBag = useMemo(
    () =>
      bloodBoardRows.find(
        row => String(row.dnrno || "").trim() === quickBloodProductBagNo.trim(),
      ) || null,
    [bloodBoardRows, quickBloodProductBagNo],
  );

  const seedEforlBloodBoard = () => {
    if (caseStatus.status === "IDLE") return;
    const patientAn = patientDocumentSummary.an || null;
    const patientName = patientDocumentSummary.name || null;
    setEforlBloodBoardRows(
      EFORL_BLOOD_BOARD_TEMPLATE.map(row => ({
        hn: caseStatus.hn,
        an: patientAn,
        patient_name: patientName,
        reqno: row.reqno,
        bdtype: row.bdtype,
        dnrno: row.dnrno,
        bloodgrp: row.bloodgrp,
        rh: row.rh,
        unitstas: row.hisStatus,
        hisStatus: row.hisStatus,
        orStage: "Pending",
        receiveCondition: "",
        givenAmountMl: "",
      })),
    );
    setBloodBoardSource("MOCK");
    setEforlReceiveBagNo("");
    setEforlReceiveCondition("Frozen");
    setEforlGiveBagNo("");
    setEforlGiveAmountMl("");
    setBloodBoardError("");
  };

  const eforlReceiveMatchedBag = useMemo(
    () =>
      eforlBloodBoardRows.find(
        row => String(row.dnrno || "").trim().toUpperCase() === eforlReceiveBagNo.trim().toUpperCase(),
      ) || null,
    [eforlBloodBoardRows, eforlReceiveBagNo],
  );

  const eforlGiveMatchedBag = useMemo(
    () =>
      eforlBloodBoardRows.find(
        row => String(row.dnrno || "").trim().toUpperCase() === eforlGiveBagNo.trim().toUpperCase(),
      ) || null,
    [eforlBloodBoardRows, eforlGiveBagNo],
  );

  const openBloodBoardOutcome = (
    row: BloodProductVerificationResult,
    mode: "completed" | "stop_reaction",
  ) => {
    setBloodBoardOutcomeBag(row);
    setBloodBoardOutcomeMode(mode);
    setBloodBoardOutcomeDetail("");
    setBloodBoardError("");
  };

  const saveBloodBoardOutcome = async () => {
    if (caseId == null || caseStatus.status === "IDLE" || !bloodBoardOutcomeBag) return;
    const bagNo = String(bloodBoardOutcomeBag.dnrno || "").trim();
    if (!bagNo) return;
    setBloodBoardSavingBagNo(bagNo);
    setBloodBoardError("");
    const group = formatVerifiedBloodGroup(bloodBoardOutcomeBag);
    const detail = [
      `workflow:${bloodBoardOutcomeMode}`,
      `status:${bloodBoardOutcomeMode === "completed" ? "completed" : "stopped_reaction"}`,
      bloodBoardOutcomeBag.bdtype ? `product:${bloodBoardOutcomeBag.bdtype}` : "",
      `bloodBagNo:${bagNo}`,
      group ? `bloodGroup:${group}` : "",
      bloodBoardOutcomeBag.reqno ? `reqno:${bloodBoardOutcomeBag.reqno}` : "",
      bloodBoardOutcomeDetail.trim() ? `detail:${bloodBoardOutcomeDetail.trim()}` : "",
    ].filter(Boolean).join(" | ");
    try {
      const created = await createCaseEvent(caseId, {
        event_ts: Date.now(),
        event_type: "event",
        title: "Blood Product",
        detail,
        actor,
        reason:
          bloodBoardOutcomeMode === "completed"
            ? "blood board completed transfusion"
            : "blood board stopped or reaction",
      });
      setCaseEventsAll(previous => [created as CaseEvent, ...previous]);
      setBloodBoardOutcomeBag(null);
      setBloodBoardOutcomeDetail("");
      notifyIoAndEventChanged(caseId);
    } catch (err) {
      setBloodBoardError(err instanceof Error ? err.message : "Failed to record blood product outcome");
    } finally {
      setBloodBoardSavingBagNo(null);
    }
  };

  const findStoredBloodVerificationForBag = (bagNoRaw: string, options?: { includeWarming?: boolean; onlyWarming?: boolean }): {
    mode: "api" | "manual" | "registered";
    result: BloodProductVerificationResult | null;
  } | null => {
    const bagNo = String(bagNoRaw || "").trim();
    if (!bagNo) return null;
    const noteSources = [
      ...(options?.onlyWarming ? [] : ioEvents.map(row => String(row.note || ""))),
      ...(options?.includeWarming || options?.onlyWarming
        ? ioRuns.map(row => String(row.note || ""))
        : []),
      ...(options?.includeWarming && !options?.onlyWarming
        ? caseEventsAll.map(row => String(row.detail || ""))
        : []),
    ];
    for (const note of noteSources) {
      const meta = parseKeyValueFromNote(note);
      if (options?.onlyWarming && meta.workflow !== "register_warming") continue;
      const storedBagNo = String(meta.bloodBagNo || "").trim();
      if (!storedBagNo || storedBagNo !== bagNo) continue;
      const mode = meta.verification === "api" || meta.verification === "manual" || meta.verification === "registered"
        ? meta.verification
        : null;
      if (!mode) continue;
      const groupParts = parseStoredBloodGroup(meta.bloodGroup);
      return {
        mode: options?.onlyWarming ? "registered" : mode,
        result: mode === "api" || options?.onlyWarming
          ? {
              hn: caseStatus.status === "IDLE" ? "" : caseStatus.hn,
              an: meta.an || null,
              patient_name: meta.patientName || meta.patient_name || null,
              reqno: meta.reqno || null,
              bdtype: meta.bloodProductType || null,
              dnrno: storedBagNo,
              bloodgrp: groupParts.bloodgrp,
              rh: groupParts.rh,
              unitstas: meta.unitstas || null,
            }
          : null,
      };
    }
    return null;
  };

  useEffect(() => {
    if (!quickBloodProductOpen || quickBloodProductVerificationMode) return;
    const stored = findStoredBloodVerificationForBag(quickBloodProductBagNo, {
      includeWarming: !quickBloodProductHasVolume,
    });
    if (!stored) return;
    setQuickBloodProductVerificationMode(stored.mode);
    setQuickBloodProductVerified(stored.result);
    if (stored.result) {
      applyQuickBloodProductHisResult(stored.result);
    }
    // These helpers are render-local and consume the state already listed here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quickBloodProductBagNo, quickBloodProductHasVolume, quickBloodProductOpen, quickBloodProductVerificationMode, caseEventsAll, ioEvents, ioRuns]);

  const checkQuickBloodProductBag = async () => {
    if (caseId == null || caseStatus.status === "IDLE") return;
    const scannedBagNo = quickBloodProductBagNo.trim();
    if (!scannedBagNo) {
      setQuickBloodProductError("Scan or enter blood bag QR first");
      return;
    }
    const listedBag = bloodBoardRowsFromHis.find(
      row => String(row.dnrno || "").trim() === scannedBagNo,
    );
    if (!listedBag) {
      setQuickBloodProductError("Scanned bag is not in the HIS blood bag list for this patient. Refresh the list and check again.");
      setQuickBloodProductVerified(null);
      setQuickBloodProductVerificationMode(null);
      return;
    }
    setQuickBloodProductChecking(true);
    setQuickBloodProductError("");
    setQuickBloodProductVerified(null);
    setQuickBloodProductVerificationMode(null);
    setQuickBloodProductManualAvailable(false);
    try {
      if (quickBloodProductHasVolume) {
        const registered = findStoredBloodVerificationForBag(scannedBagNo, {
          includeWarming: true,
          onlyWarming: true,
        });
        if (registered) {
          setQuickBloodProductVerified(registered.result);
          setQuickBloodProductVerificationMode("registered");
          if (registered.result) applyQuickBloodProductHisResult(registered.result);
          return;
        }
      }
      const verification = await verifyCaseBloodProduct(caseId, {
        hn: caseStatus.hn,
        an: patientDocumentSummary.an,
        qr: scannedBagNo,
      });
      if (!verification.ok) {
        setQuickBloodProductManualAvailable(verification.checks.hn_match !== false);
        setQuickBloodProductError(
          verification.checks.hn_match === false
            ? `${verification.message || "HN mismatch"}. Blood product cannot be used for this patient.`
            : `${verification.message || "Blood product verification failed"}. API is primary; use manual check only after bedside document check.`,
        );
        return;
      }
      setQuickBloodProductVerified(verification.result);
      setQuickBloodProductVerificationMode("api");
      applyQuickBloodProductHisResult({ ...listedBag, ...verification.result });
    } catch (err) {
      setQuickBloodProductManualAvailable(true);
      setQuickBloodProductError(
        `${err instanceof Error ? err.message : "Blood product verification failed"}. API is primary; use manual check only after bedside document check.`,
      );
    } finally {
      setQuickBloodProductChecking(false);
    }
  };

  const confirmQuickBloodProductManualCheck = () => {
    const bagNo = quickBloodProductBagNo.trim();
    if (!bagNo) {
      setQuickBloodProductError("Select or enter a blood bag first");
      return;
    }
    const listedBag = bloodBoardRowsFromHis.find(
      row => String(row.dnrno || "").trim() === bagNo,
    );
    if (!listedBag) {
      setQuickBloodProductError("Select a bag from the HIS patient list before manual bedside confirmation");
      return;
    }
    setQuickBloodProductVerified(listedBag);
    setQuickBloodProductVerificationMode("manual");
    setQuickBloodProductManualAvailable(false);
    applyQuickBloodProductHisResult(listedBag);
    setQuickBloodProductError("");
  };

  const saveQuickBloodProduct = async () => {
    if (caseId == null || caseStatus.status === "IDLE") return;
    if (!selectedQuickBloodProductItem) {
      setQuickBloodProductError("Select blood product first");
      return;
    }
    if (!quickBloodProductBagNo.trim()) {
      setQuickBloodProductError("Blood bag no. is required");
      return;
    }
    let activeVerificationMode = quickBloodProductVerificationMode;
    let activeVerificationResult = quickBloodProductVerified;
    const parsedVolumeMl = Number(quickBloodProductVolumeMl);
    const volumeMl = Number.isFinite(parsedVolumeMl) ? parsedVolumeMl : null;
    const isGiving = volumeMl != null && volumeMl > 0;
    if (!activeVerificationMode) {
      const stored = findStoredBloodVerificationForBag(quickBloodProductBagNo, {
        includeWarming: !isGiving,
      });
      if (stored) {
        activeVerificationMode = stored.mode;
        activeVerificationResult = stored.result;
        setQuickBloodProductVerificationMode(stored.mode);
        setQuickBloodProductVerified(stored.result);
        if (stored.result) applyQuickBloodProductHisResult(stored.result);
      }
    }
    if (!activeVerificationMode) {
      setQuickBloodProductError("Check blood bag before saving");
      return;
    }
    const matchedBag = bloodBoardRowsFromHis.find(
      row => String(row.dnrno || "").trim() === quickBloodProductBagNo.trim(),
    );
    if (!matchedBag) {
      setQuickBloodProductError("Blood bag is not matched to the HIS list for this patient");
      return;
    }
    if (bloodBoardStatusForBag(quickBloodProductBagNo) === "Available") {
      setQuickBloodProductError("Record Received in OR before warming or giving this blood bag");
      return;
    }
    const givingAuthorization: BloodGivingAuthorization | null = isGiving
      ? signedInGivingAuthorization ||
        (bloodBoardConfirmedAnesthetist
          ? {
              mode: "supervised",
              name: bloodBoardConfirmedAnesthetist.name,
              username: bloodBoardConfirmedAnesthetist.hospital_id || undefined,
            }
          : null)
      : null;
    if (isGiving && !givingAuthorization) {
      setQuickBloodProductError("An anesthetist must verify actual giving before recording the amount");
      return;
    }
    const normalizedGroup = quickBloodProductGroup.trim().toUpperCase();
    const eventTs = toTsFromDateAndTime(quickBloodProductDate, quickBloodProductTime);
    if (eventTs == null) {
      setQuickBloodProductError("Date/time invalid — use dd/mm/yyyy and HH:mm");
      return;
    }
    if (!hasTimeOutBefore(eventTs)) {
      setQuickBloodProductError("Time Out must be completed before blood product workflow");
      return;
    }
    const workflowDetail = buildBloodWorkflowDetail(quickBloodProductNote, {
      workflow: isGiving ? "give" : "register_warming",
      productName: selectedQuickBloodProductItem.name,
      bloodType: quickBloodProductType,
      bloodGroup: formatVerifiedBloodGroup(activeVerificationResult) || normalizedGroup,
      bloodBagNo: String(activeVerificationResult?.dnrno || quickBloodProductBagNo).trim(),
      bloodVerification: activeVerificationResult,
      verificationMode: activeVerificationMode,
      volumeMl,
      status: isGiving ? "warmed" : "refrigerated",
      givingAuthorization,
    }) || undefined;

    setQuickBloodProductSaving(true);
    setQuickBloodProductError("");
    try {
      if (!isGiving) {
        await createCaseIoRun(caseId, {
          item_id: selectedQuickBloodProductItem.id,
          kind: selectedQuickBloodProductItem.kind,
          started_at: eventTs,
          route: "IV",
          entry_mode: "bolus",
          note: workflowDetail,
          include_in_balance: true,
          actor,
          reason:
            activeVerificationMode === "manual"
              ? "clinical-chart blood product manual register refrigerated"
              : "clinical-chart blood product api verified register refrigerated",
        });
        await createCaseEvent(caseId, {
          event_ts: eventTs,
          event_type: "event",
          title: "Blood Product",
          detail: workflowDetail
            ? `Add blood product to case as refrigerated | ${workflowDetail}`
            : "Add blood product to case as refrigerated",
          actor,
          reason: "clinical-chart blood product refrigerated status",
        });
        notifyIoAndEventChanged(caseId);
      } else {
        await createCaseIoBloodProduct(caseId, {
          actor,
          reason:
            activeVerificationMode === "manual"
              ? "clinical-chart blood product manual give"
              : activeVerificationMode === "registered"
                ? "clinical-chart blood product registered warmer give"
              : "clinical-chart blood product api verified give",
          run: { item_id: selectedQuickBloodProductItem.id, route: "IV", note: workflowDetail, include_in_balance: true },
          event: { event_ts: eventTs, volume_ml: volumeMl || 0, note: workflowDetail, include_in_balance: true },
        });
        notifyIoAndEventChanged(caseId);
      }
      closeQuickBloodProduct();
    } catch (err) {
      setQuickBloodProductError(err instanceof Error ? err.message : "Failed to save blood product");
    } finally {
      setQuickBloodProductSaving(false);
    }
  };

  const openQuickFluid = (entryTs?: number) => {
    const targetTs = Number.isFinite(entryTs) ? Number(entryTs) : Date.now();
    setQuickFluidOpen(true);
    setQuickFluidSearch("");
    setQuickFluidItemId(null);
    setShowQuickFluidDropdown(false);
    setQuickFluidDate(formatDDMMYYYY(targetTs));
    setQuickFluidTime(formatHHMM(targetTs));
    setQuickFluidEntryMode("bolus");
    setQuickFluidVolumeMl("");
    setQuickFluidOverMin("");
    setQuickFluidRateMlHr("");
    setQuickFluidNote("");
    setQuickFluidError("");
  };

  const closeQuickFluid = () => {
    if (quickFluidSaving) return;
    setQuickFluidOpen(false);
    setQuickFluidError("");
  };

  const saveQuickFluid = async () => {
    if (caseId == null || caseStatus.status === "IDLE") return;
    if (!selectedQuickFluidItem) {
      setQuickFluidError("Select fluid first");
      return;
    }
    const eventTs = toTsFromDateAndTime(quickFluidDate, quickFluidTime);
    if (eventTs == null) {
      setQuickFluidError("Date/time invalid — use dd/mm/yyyy and HH:mm");
      return;
    }
    setQuickFluidSaving(true);
    setQuickFluidError("");
    try {
      if (quickFluidEntryMode === "running") {
        const rate = Number(quickFluidRateMlHr);
        if (!Number.isFinite(rate) || rate <= 0) {
          setQuickFluidError("Rate must be > 0");
          setQuickFluidSaving(false);
          return;
        }
        await createCaseIoDrip(caseId, {
          actor,
          reason: "clinical-chart fluid running drip entry",
          run: {
            item_id: selectedQuickFluidItem.id,
            kind: "fluid",
            started_at: eventTs,
            route: "IV",
            entry_mode: "drip",
            include_in_balance: true,
            note: quickFluidNote.trim() || undefined,
          },
          segment: {
            ts_from: eventTs,
            rate_value: Math.round(rate * 10) / 10,
            rate_unit: "ml/hr",
            include_in_balance: true,
          },
        });
      } else if (quickFluidEntryMode === "timed") {
        const volumeMl = Number(quickFluidVolumeMl);
        if (!Number.isFinite(volumeMl) || volumeMl <= 0) {
          setQuickFluidError("Volume must be > 0");
          setQuickFluidSaving(false);
          return;
        }
        const overMin = Number(quickFluidOverMin);
        if (!Number.isFinite(overMin) || overMin <= 0) {
          setQuickFluidError("Over min must be > 0");
          setQuickFluidSaving(false);
          return;
        }
        const endTs = eventTs + overMin * 60_000;
        const rateMlHr = volumeMl / (overMin / 60);
        await createCaseIoDrip(caseId, {
          actor,
          reason: "clinical-chart fluid over-time entry",
          run: {
            item_id: selectedQuickFluidItem.id,
            kind: "fluid",
            started_at: eventTs,
            route: "IV",
            entry_mode: "drip",
            include_in_balance: true,
          },
          segment: {
            ts_from: eventTs,
            ts_to: endTs,
            rate_value: Math.round(rateMlHr * 10) / 10,
            rate_unit: "ml/hr",
            include_in_balance: true,
          },
        });
      } else {
        const volumeMl = Number(quickFluidVolumeMl);
        if (!Number.isFinite(volumeMl) || volumeMl <= 0) {
          setQuickFluidError("Volume must be > 0");
          setQuickFluidSaving(false);
          return;
        }
        await createCaseIoEvent(caseId, {
          actor,
          reason: "clinical-chart fluid bolus entry",
          item_id: selectedQuickFluidItem.id,
          kind: "fluid",
          event_ts: eventTs,
          volume_ml: volumeMl,
          note: quickFluidNote.trim() || undefined,
          include_in_balance: true,
        });
      }
      notifyIoAndEventChanged(caseId);
      closeQuickFluid();
    } catch (err) {
      setQuickFluidError(
        err instanceof Error ? err.message : "Failed to save fluid",
      );
    } finally {
      setQuickFluidSaving(false);
    }
  };

  const openQuickMed = (entryTs?: number) => {
    const targetTs = Number.isFinite(entryTs) ? Number(entryTs) : Date.now();
    quickMedSaveLockRef.current = false;
    setQuickMedOpen(true);
    setQuickMedSearch("");
    setQuickMedItemId(null);
    setShowQuickMedDropdown(false);
    setQuickMedDate(formatDDMMYYYY(targetTs));
    setQuickMedTime(formatHHMM(targetTs));
    setQuickMedDose("");
    setQuickMedLocalConcentration("");
    setQuickMedLocalVolumeMl("");
    setQuickMedRoute(DEFAULT_CASEVIEW_ROUTE);
    setQuickMedUnit("mg");
    setQuickMedNote("");
    setQuickMedManualMode(false);
    setQuickMedManualCategory("");
    setQuickMedError("");
  };

  const applyQuickMedDripSelection = (item: CaseIoItem, focusAmount = false) => {
    setQuickMedDripItemId(item.id);
    setQuickMedDripSearch(item.name);
    setQuickMedDripManualMode(false);
    setQuickMedDripManualCategory("");
    setQuickMedDripRoute(DEFAULT_CASEVIEW_ROUTE);
    setQuickMedDripAmountUnit(item.default_unit || "mg");
    const normalizedDefaultUnit = normalizeDisplayUnit("med", item.default_unit || "mg").toLowerCase();
    setQuickMedDripDoseUnit(
      normalizedDefaultUnit === "mcg"
        ? "mcg/min"
        : normalizedDefaultUnit === "units"
          ? "units/hr"
          : normalizedDefaultUnit === "munits"
            ? "MUnits/hr"
            : "mg/hr",
    );
    setQuickMedDripLastEdited("dose");
    setShowQuickMedDripDropdown(false);
    if (focusAmount) {
      window.requestAnimationFrame(() => {
        quickMedDripAmountInputRef.current?.focus();
        quickMedDripAmountInputRef.current?.select();
      });
    }
  };

  const openQuickMedDrip = (entryTs?: number) => {
    const targetTs = Number.isFinite(entryTs) ? Number(entryTs) : Date.now();
    quickMedDripSaveLockRef.current = false;
    setQuickMedDripEditTarget(null);
    setQuickMedDripExactStopTs(null);
    setQuickMedDripOpen(true);
    setQuickMedDripSearch("");
    setQuickMedDripItemId(null);
    setShowQuickMedDripDropdown(false);
    setQuickMedDripDate(formatDDMMYYYY(targetTs));
    setQuickMedDripTime(formatHHMM(targetTs));
    setQuickMedDripRoute(DEFAULT_CASEVIEW_ROUTE);
    setQuickMedDripAmountValue("");
    setQuickMedDripAmountUnit("mg");
    setQuickMedDripCarrierFluidId(null);
    setQuickMedDripTotalVolumeMl("");
    setQuickMedDripDoseValue("");
    setQuickMedDripDoseUnit("mg/hr");
    setQuickMedDripWeightKg(patientWeightKg == null ? "" : String(patientWeightKg));
    setQuickMedDripRateMlHr("");
    setQuickMedDripLastEdited("dose");
    setQuickMedDripNote("");
    setQuickMedDripManualMode(false);
    setQuickMedDripManualCategory("");
    setQuickMedDripError("");
  };

  const openQuickMedDripForExistingRun = (
    run: CaseIoRun,
    ts: number,
    segment?: NonNullable<CaseIoRun["segments"]>[number],
  ) => {
    const runMeta = parseKeyValueFromNote(String(run.note || ""));
    const segmentMeta = parseKeyValueFromNote(String(segment?.note || ""));
    const cleanNote = String(segment?.note || "")
      .split("|")
      .map(token => token.trim())
      .filter(token => {
        const lower = token.toLowerCase();
        return (
          !lower.startsWith("dripvolumeml:") &&
          !lower.startsWith("carriervolumeml:") &&
          !lower.startsWith("dripdurationmin:") &&
          !lower.startsWith("concentration:")
        );
      })
      .join(" | ");
    const carrierName = String(runMeta.carrier || "").trim();
    const carrierFluidId =
      carrierName && normalizeToken(carrierName) !== "undilute"
        ? carrierFluidOptions.find(item => normalizeToken(item.name) === normalizeToken(carrierName))?.id ?? null
        : null;
    const segmentStartTs = segment?.ts_from != null ? Number(segment.ts_from) : null;
    const changeTs = ts;

    quickMedDripSaveLockRef.current = false;
    setQuickMedDripEditTarget({
      runId: run.id,
      segmentId: segment?.id ?? null,
      clickedTs: changeTs,
      segmentStartTs,
    });
    setQuickMedDripOpen(true);
    setQuickMedDripItemId(run.item_id);
    setQuickMedDripSearch(run.item_name || run.item_code || "Unknown");
    setQuickMedDripManualMode(false);
    setQuickMedDripManualCategory("");
    setShowQuickMedDripDropdown(false);
    setQuickMedDripDate(formatDDMMYYYY(changeTs));
    setQuickMedDripTime(formatHHMM(changeTs));
    setQuickMedDripRoute(String(run.route || DEFAULT_CASEVIEW_ROUTE).trim() || DEFAULT_CASEVIEW_ROUTE);
    setQuickMedDripAmountValue(String(runMeta.medAmount || "").trim());
    setQuickMedDripAmountUnit(String(runMeta.medUnit || run.item_unit || "mg").trim() || "mg");
    setQuickMedDripCarrierFluidId(carrierFluidId);
    setQuickMedDripTotalVolumeMl(String(runMeta.totalVolumeMl || segmentMeta.dripVolumeMl || "").trim());
    setQuickMedDripDoseValue(
      segment?.dose_value == null ? "" : String(Number(segment.dose_value)),
    );
    const nextDoseUnit = String(segment?.dose_unit || run.item_unit || "mg/hr").trim() || "mg/hr";
    setQuickMedDripDoseUnit(
      ((quickMedDripDoseUnitOptions as readonly string[]).includes(nextDoseUnit)
        ? nextDoseUnit
        : "mg/hr") as (typeof CASEVIEW_DOSE_RATE_UNITS)[number],
    );
    setQuickMedDripWeightKg(patientWeightKg == null ? "" : String(patientWeightKg));
    setQuickMedDripRateMlHr(
      segment?.rate_value == null ? "" : String(Number(segment.rate_value)),
    );
    setQuickMedDripLastEdited("dose");
    setQuickMedDripNote(cleanNote);
    setQuickMedDripError("");

    window.requestAnimationFrame(() => {
      quickMedDripTimeRef.current?.focus();
      quickMedDripTimeRef.current?.select();
    });
  };

  const closeQuickMed = () => {
    if (quickMedSaving) return;
    quickMedSaveLockRef.current = false;
    setQuickMedOpen(false);
    setQuickMedError("");
  };

  const closeQuickMedDrip = () => {
    if (quickMedDripSaving || quickMedDripStopping) return;
    quickMedDripSaveLockRef.current = false;
    setQuickMedDripEditTarget(null);
    setQuickMedDripOpen(false);
    setQuickMedDripError("");
  };

  const clearQuickMed = () => {
    if (quickMedSaving) return;
    quickMedSaveLockRef.current = false;
    setQuickMedSearch("");
    setQuickMedItemId(null);
    setShowQuickMedDropdown(false);
    setQuickMedDate(formatDDMMYYYY(Date.now()));
    setQuickMedTime(formatHHMM(Date.now()));
    setQuickMedDose("");
    setQuickMedLocalConcentration("");
    setQuickMedLocalVolumeMl("");
    setQuickMedRoute(DEFAULT_CASEVIEW_ROUTE);
    setQuickMedUnit("mg");
    setQuickMedNote("");
    setQuickMedManualMode(false);
    setQuickMedManualCategory("");
    setQuickMedError("");
    window.requestAnimationFrame(() => {
      quickMedSearchRef.current?.focus();
      quickMedSearchRef.current?.select();
    });
    setQuickMedDripExactStopTs(null);
  };

  const saveQuickMed = async () => {
    if (!caseId || caseStatus.status === "IDLE") return;
    if (quickMedSaveLockRef.current) return;
    if (!selectedQuickMedItem && !quickMedManualMode) {
      setQuickMedError("Select medication first");
      return;
    }
    const eventTs = quickMedEventTs;
    if (eventTs == null) {
      setQuickMedError("Time must be HH:mm (24-hour) and Date must be dd/mm/yyyy");
      return;
    }

    quickMedSaveLockRef.current = true;
    setQuickMedSaving(true);
    setQuickMedError("");
    try {
      let activeItem: CaseIoItem | null = selectedQuickMedItem;
      if (!activeItem && quickMedManualMode) {
        const manualName = quickMedSearch.trim();
        const manualCategory = quickMedManualCategory.trim();
        if (!manualName) {
          throw new Error("Drug name required for manual entry");
        }
        if (!manualCategory) {
          throw new Error("Select group before saving manual entry");
        }
        const createdManualItem = await createIoCatalogEntry({
          kind: "med",
          code: `manual-med-${Date.now()}`,
          name: manualName,
          default_unit: quickMedUnit.trim() || "mg",
          category: manualCategory,
          is_active: 0,
        });
        if (!createdManualItem.id) {
          throw new Error("Manual medication item create failed");
        }
        activeItem = {
          id: createdManualItem.id,
          kind: "med",
          code: createdManualItem.code,
          name: createdManualItem.name,
          default_unit: createdManualItem.default_unit,
          category: createdManualItem.category,
          usage_score: createdManualItem.usage_score,
          usage_rank: createdManualItem.usage_rank,
          is_active: createdManualItem.is_active,
        };
      }
      if (!activeItem) {
        throw new Error("Select medication first");
      }
      const normalizedUnit = quickMedUnit.trim();
      const defaultUnit = String(activeItem.default_unit || "").trim();
      const activeIsLocalAnesthetic =
        normalizeToken(activeItem.category) === "localanesthetic";
      const noteWithUom =
        !activeIsLocalAnesthetic && normalizedUnit && normalizedUnit !== defaultUnit
          ? `uom:${normalizedUnit}`
          : undefined;
      const runNote =
        quickMedManualMode
          ? [noteWithUom, "manualcase:1"].filter(Boolean).join(" | ")
          : noteWithUom;

      let run =
        preparedRuns.find(
          candidate =>
            candidate.kind === "med" &&
            candidate.item_id === Number(activeItem.id) &&
            (candidate.entry_mode || "bolus") === "bolus",
        ) || null;

      if (!run) {
        run = await createCaseIoRun(caseId, {
          item_id: Number(activeItem.id),
          kind: "med",
          route: quickMedRoute.trim() || DEFAULT_CASEVIEW_ROUTE,
          entry_mode: "bolus",
          include_in_balance: true,
          note: runNote || undefined,
          reason: quickMedManualMode ? "clinical-chart quick med manual item" : "clinical-chart quick med save item",
          actor,
        });
      }

      const trimmedDose = quickMedDose.trim();
      const hasLocalConcentration = quickMedLocalConcentration.trim().length > 0;
      const hasLocalVolume = quickMedLocalVolumeMl.trim().length > 0;
      const hasImmediateValue = activeIsLocalAnesthetic
        ? hasLocalConcentration || hasLocalVolume
        : Boolean(trimmedDose);
      if (hasImmediateValue) {
        let numericDose = 0;
        let doseUnit = normalizedUnit || defaultUnit || run.item_unit || "mg";
        let eventNote = quickMedNote.trim() || undefined;

        if (activeIsLocalAnesthetic) {
          if (!hasLocalConcentration || !hasLocalVolume) {
            throw new Error("Concentration (%) and volume (mL) must both be filled");
          }
          const concentrationPercent = Number(quickMedLocalConcentration);
          const volumeMl = Number(quickMedLocalVolumeMl);
          if (!Number.isFinite(concentrationPercent) || concentrationPercent <= 0) {
            throw new Error("Concentration must be > 0");
          }
          if (!Number.isFinite(volumeMl) || volumeMl <= 0) {
            throw new Error("Volume must be > 0");
          }
          numericDose = concentrationPercentToMg(concentrationPercent, volumeMl);
          doseUnit = "mg";
          eventNote = [
            quickMedNote.trim(),
            `concentration:${concentrationPercent}%`,
            `volumeMl:${volumeMl}`,
            `route:${quickMedRoute.trim() || DEFAULT_CASEVIEW_LOCAL_ROUTE}`,
            quickMedManualMode ? "manualcase:1" : "",
          ]
            .filter(Boolean)
            .join(" | ");
        } else {
          numericDose = Number(trimmedDose);
          if (!Number.isFinite(numericDose) || numericDose <= 0) {
            throw new Error("Dose must be > 0");
          }
          if (quickMedManualMode) {
            eventNote = [quickMedNote.trim(), "manualcase:1"].filter(Boolean).join(" | ");
          }
        }

        await createCaseIoEvent(caseId, {
          item_id: run.item_id,
          kind: "med",
          event_ts: eventTs,
          dose_value: numericDose,
          dose_unit: doseUnit,
          note: eventNote,
          include_in_balance: true,
          reason: "clinical-chart quick med bolus",
          actor,
        });
      }

      notifyIoAndEventChanged(caseId);
      setQuickMedOpen(false);
      setQuickMedSearch("");
      setQuickMedItemId(null);
      setShowQuickMedDropdown(false);
      setQuickMedDate(formatDDMMYYYY(Date.now()));
      setQuickMedDose("");
      setQuickMedLocalConcentration("");
      setQuickMedLocalVolumeMl("");
      setQuickMedTime(formatHHMM(Date.now()));
      setQuickMedNote("");
      setQuickMedManualMode(false);
      setQuickMedManualCategory("");
      setQuickMedError("");
    } catch (err) {
      setQuickMedError(err instanceof Error ? err.message : "Failed to save medication");
    } finally {
      quickMedSaveLockRef.current = false;
      setQuickMedSaving(false);
    }
  };

  const handleQuickMedKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (quickMedSaving) return;
    if (e.repeat) return;
    const target = e.target as HTMLElement | null;
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      closeQuickMed();
      return;
    }
    if (e.key !== "Enter" || e.shiftKey) return;
    if (target?.tagName === "TEXTAREA") return;
    e.preventDefault();
    e.stopPropagation();
    void saveQuickMed();
  };

  const saveQuickMedDrip = async () => {
    if (!caseId || caseStatus.status === "IDLE") return;
    if (quickMedDripSaveLockRef.current) return;
    if (!selectedQuickMedDripItem && !quickMedDripManualMode) {
      setQuickMedDripError("Select medication first");
      return;
    }
    const startTs = toTsFromDateAndTime(quickMedDripDate, quickMedDripTime);
    if (startTs == null) {
      setQuickMedDripError("Start must be HH:mm (24-hour) and Date must be dd/mm/yyyy");
      return;
    }

    const amountValue = Number(quickMedDripAmountValue);
    if (!Number.isFinite(amountValue) || amountValue <= 0) {
      setQuickMedDripError("Drug amount must be > 0");
      return;
    }
    const totalVolumeMl = Number(quickMedDripTotalVolumeMl);
    if (!Number.isFinite(totalVolumeMl) || totalVolumeMl <= 0) {
      setQuickMedDripError("Total volume must be > 0");
      return;
    }
    const doseValue = Number(quickMedDripDoseValue);
    if (!Number.isFinite(doseValue) || doseValue <= 0) {
      setQuickMedDripError("Dose must be > 0");
      return;
    }
    if (quickMedDripIsWeightBased) {
      const weightKg = Number(quickMedDripWeightKg);
      if (!Number.isFinite(weightKg) || weightKg <= 0) {
        setQuickMedDripError("Weight must be > 0 for weight-based dose");
        return;
      }
    }
    const rateMlHr = Number(quickMedDripRateMlHr);
    if (!Number.isFinite(rateMlHr) || rateMlHr <= 0) {
      setQuickMedDripError("Rate must be > 0");
      return;
    }

    quickMedDripSaveLockRef.current = true;
    setQuickMedDripSaving(true);
    setQuickMedDripError("");
    try {
      let activeItem: CaseIoItem | null = selectedQuickMedDripItem;
      if (!activeItem && quickMedDripManualMode) {
        const manualName = quickMedDripSearch.trim();
        const manualCategory = quickMedDripManualCategory.trim();
        if (!manualName) throw new Error("Drug name required for manual entry");
        if (!manualCategory) throw new Error("Select group before saving manual entry");
        const createdManualItem = await createIoCatalogEntry({
          kind: "med",
          code: `manual-med-${Date.now()}`,
          name: manualName,
          default_unit: quickMedDripAmountUnit.trim() || "mg",
          category: manualCategory,
          is_active: 0,
        });
        if (!createdManualItem.id) {
          throw new Error("Manual medication item create failed");
        }
        activeItem = {
          id: createdManualItem.id,
          kind: "med",
          code: createdManualItem.code,
          name: createdManualItem.name,
          default_unit: createdManualItem.default_unit,
          category: createdManualItem.category,
          usage_score: createdManualItem.usage_score,
          usage_rank: createdManualItem.usage_rank,
          is_active: createdManualItem.is_active,
        };
      }
      if (!activeItem) {
        throw new Error("Select medication first");
      }
      const liveRun = quickMedDripEditTarget
        ? resolveLiveRunById(quickMedDripEditTarget.runId)
        : null;
      const liveSegment =
        quickMedDripEditTarget && quickMedDripEditTarget.segmentId != null
          ? resolveLiveSegmentForRun(
              liveRun,
              quickMedDripEditTarget.segmentId,
              quickMedDripEditTarget.clickedTs,
              quickMedDripEditTarget.segmentStartTs,
            )
          : null;
      const amountUnit =
        quickMedDripAmountUnit.trim() ||
        String(activeItem.default_unit || "").trim() ||
        "mg";
      const concentrationPerMl = totalVolumeMl > 0 ? round4(amountValue / totalVolumeMl) : null;
      const carrierName =
        quickMedDripCarrierFluidId != null
          ? carrierFluidOptions.find(item => item.id === quickMedDripCarrierFluidId)?.name || "Undilute"
          : "Undilute";

      const runNote = [
        quickMedDripNote.trim(),
        `medAmount:${round4(amountValue)}`,
        `medUnit:${amountUnit}`,
        `totalVolumeMl:${round2(totalVolumeMl)}`,
        `carrier:${carrierName}`,
        quickMedDripManualMode ? "manualcase:1" : "",
      ]
        .filter(Boolean)
        .join(" | ");
      const segmentNote =
        [
          quickMedDripNote.trim(),
          `dripVolumeMl:${round2(totalVolumeMl)}`,
          concentrationPerMl != null ? `concentration:${concentrationPerMl} ${amountUnit}/mL` : "",
          quickMedDripManualMode ? "manualcase:1" : "",
        ]
          .filter(Boolean)
          .join(" | ") || undefined;

      if (quickMedDripEditTarget) {
        if (!liveRun) {
          throw new Error("Drip run not found. Please reopen the drip and try again.");
        }
        await updateCaseIoRun(caseId, liveRun.id, {
          route: quickMedDripRoute.trim() || DEFAULT_CASEVIEW_ROUTE,
          entry_mode: "drip",
          include_in_balance: true,
          note: runNote,
          reason: "clinical-chart quick med drip edit run",
          actor,
        });

        if (quickMedDripEditTarget.segmentId != null) {
          if (!liveSegment) {
            throw new Error("Drip segment not found. Please reopen the drip and try again.");
          }
          if (
            quickMedDripEditTarget.segmentStartTs != null &&
            startTs > quickMedDripEditTarget.segmentStartTs
          ) {
            await updateCaseIoSegment(caseId, liveSegment.id, {
              ts_to: startTs,
              reason: "clinical-chart quick med drip split segment",
              actor,
            });
            await createCaseIoSegment(caseId, {
              run_id: liveRun.id,
              ts_from: startTs,
              rate_value: round4(rateMlHr),
              rate_unit: "ml/hr",
              dose_value: round4(doseValue),
              dose_unit: quickMedDripDoseUnit,
              include_in_balance: true,
              note: segmentNote,
              reason: "clinical-chart quick med drip split segment",
              actor,
            });
          } else {
            await updateCaseIoSegment(caseId, liveSegment.id, {
              ts_from: startTs,
              ts_to: null,
              rate_value: round4(rateMlHr),
              rate_unit: "ml/hr",
              dose_value: round4(doseValue),
              dose_unit: quickMedDripDoseUnit,
              include_in_balance: true,
              note: segmentNote,
              reason: "clinical-chart quick med drip edit segment",
              actor,
            });
          }
        } else {
          await createCaseIoSegment(caseId, {
            run_id: liveRun.id,
            ts_from: startTs,
            rate_value: round4(rateMlHr),
            rate_unit: "ml/hr",
            dose_value: round4(doseValue),
            dose_unit: quickMedDripDoseUnit,
            include_in_balance: true,
            note: segmentNote,
            reason: "clinical-chart quick med drip add segment",
            actor,
          });
        }
      } else {
        await createCaseIoDrip(caseId, {
          actor,
          reason: quickMedDripManualMode ? "clinical-chart quick med drip manual start" : "clinical-chart quick med drip start",
          run: {
            item_id: activeItem.id,
            kind: "med",
            started_at: startTs,
            route: quickMedDripRoute.trim() || DEFAULT_CASEVIEW_ROUTE,
            entry_mode: "drip",
            include_in_balance: true,
            note: runNote,
          },
          segment: {
            ts_from: startTs,
            rate_value: round4(rateMlHr),
            rate_unit: "ml/hr",
            dose_value: round4(doseValue),
            dose_unit: quickMedDripDoseUnit,
            include_in_balance: true,
            note: segmentNote,
          },
        });
      }

      notifyIoAndEventChanged(caseId);
      closeQuickMedDrip();
      setQuickMedDripManualMode(false);
      setQuickMedDripManualCategory("");
    } catch (err) {
      setQuickMedDripError(
        isNotFoundApiError(err)
          ? "Drip changed in the background. Please reopen it and try again."
          : err instanceof Error
            ? err.message
            : "Failed to start med drip",
      );
    } finally {
      quickMedDripSaveLockRef.current = false;
      setQuickMedDripSaving(false);
    }
  };

  const stopQuickMedDrip = async () => {
    if (!caseId || caseStatus.status === "IDLE" || !quickMedDripEditTarget) return;
    if (quickMedDripStopping) return;
    const run = resolveLiveRunById(quickMedDripEditTarget.runId);
    const segment = resolveLiveSegmentForRun(
      run,
      quickMedDripEditTarget.segmentId,
      quickMedDripEditTarget.clickedTs,
      quickMedDripEditTarget.segmentStartTs,
    );
    if (!run || !segment) {
      setQuickMedDripError("Running drip segment not found");
      return;
    }
    const stopTs = quickMedDripExactStopTs ??
      toTsFromDateAndTime(quickMedDripDate, quickMedDripTime);
    if (stopTs == null) {
      setQuickMedDripError("Stop must be HH:mm (24-hour) and Date must be dd/mm/yyyy");
      return;
    }
    if (stopTs <= Number(segment.ts_from)) {
      setQuickMedDripError("Stop time must be after drip start");
      return;
    }

    setQuickMedDripStopping(true);
    setQuickMedDripError("");
    try {
      await updateCaseIoSegment(caseId, segment.id, {
        ts_to: stopTs,
        reason: "clinical-chart quick med drip stop",
        actor,
      });
      await updateCaseIoRun(caseId, run.id, {
        stopped_at: stopTs,
        reason: "clinical-chart quick med drip stop",
        actor,
      });
      notifyIoAndEventChanged(caseId);
      closeQuickMedDrip();
    } catch (err) {
      setQuickMedDripError(
        isNotFoundApiError(err)
          ? "Drip changed in the background. Please reopen it and try again."
          : err instanceof Error
            ? err.message
            : "Failed to stop med drip",
      );
    } finally {
      setQuickMedDripStopping(false);
    }
  };

  const handleQuickMedDripKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (quickMedDripSaving || quickMedDripStopping) return;
    const target = e.target as HTMLElement | null;
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      closeQuickMedDrip();
      return;
    }
    if (e.key !== "Enter" || e.shiftKey) return;
    if (target?.tagName === "TEXTAREA") return;
    e.preventDefault();
    e.stopPropagation();
    void saveQuickMedDrip();
  };

  const valueTypeForRow = (rowId: string, value: unknown) =>
    rowId === "ecg" ? "code" : typeof value === "number" ? "number" : "text";

  const sourceForRow = (rowId: string) =>
    rowId === "ecg" ? "manual" : "override";

  const flushPendingChanges = async () => {
    if (!caseId) return;
    const changes = Array.from(pendingChangesRef.current.values());
    if (changes.length === 0) return;
    pendingChangesRef.current.clear();

    try {
      await putTimelineChanges(
        caseId,
        actor,
        changes,
        "Manual correction in clinical chart",
      );
    } catch (err) {
      console.error("[ClinicalChartView] timeline save failed", err);
      for (const change of changes) {
        pendingChangesRef.current.set(
          `${change.param_key}:${change.ts_minute}`,
          change,
        );
      }
      if (saveTimerRef.current == null) {
        saveTimerRef.current = window.setTimeout(() => {
          void flushPendingChanges();
          saveTimerRef.current = null;
        }, 2000);
      }
    }
  };

  const scheduleFlush = () => {
    if (saveTimerRef.current != null) {
      window.clearTimeout(saveTimerRef.current);
    }
    saveTimerRef.current = window.setTimeout(() => {
      void flushPendingChanges();
      saveTimerRef.current = null;
    }, 500);
  };

  const handleCellChange = (rowId: string, ts: number, value: unknown) => {
    const currentValue = values[rowId]?.[ts];
    const isSameValue = value !== undefined && value !== "" &&
      (currentValue === value || String(currentValue ?? "") === String(value));
    if (isSameValue) return;
    const key = `${rowId}:${ts}`;
    if (value === undefined || value === "") {
      pendingChangesRef.current.set(key, {
        ts_minute: ts,
        param_key: rowId,
        action: "delete",
      });
    } else {
      pendingChangesRef.current.set(key, {
        ts_minute: ts,
        param_key: rowId,
        value,
        value_type: valueTypeForRow(rowId, value),
        source: sourceForRow(rowId),
        action: "upsert",
      });
    }
    scheduleFlush();

    setOptimisticCellProvenance(previous => {
      const row = { ...(previous[rowId] || {}) };
      if (value === undefined || value === "") {
        delete row[ts];
      } else if (sourceForRow(rowId) === "override") {
        const stored = storedCellProvenance[rowId]?.[ts];
        const detail: TimelineCellProvenance = {
          source: "override",
          original_value: stored?.original_value ?? liveValues[rowId]?.[ts],
          original_source: stored?.original_source || "vector",
          updated_by: actor.username,
          actor_username: actor.username,
          actor_name: actor.name,
          actor_role: actor.role,
          edited_at: Date.now(),
          reason: "Manual correction in clinical chart",
          audit_count: (stored?.audit_count || 0) + 1,
        };
        row[ts] = detail;
      }
      const next = { ...previous };
      if (Object.keys(row).length) next[rowId] = row;
      else delete next[rowId];
      return next;
    });

    setEditValues(prev => {
      const row = { ...(prev[rowId] ?? {}) };
      if (value === undefined || value === "") {
        delete row[ts];
      } else {
        row[ts] = value;
      }

      if (Object.keys(row).length === 0) {
        const next = { ...prev };
        delete next[rowId];
        return next;
      }

      return {
        ...prev,
        [rowId]: row,
      };
    });
  };

  const openParameterConfig = () => {
    setDraftHiddenRowIds(hiddenRowIds);
    setParameterSearch("");
    setIsParamMenuOpen(true);
  };

  const toggleDraftRowVisibility = (rowId: string) => {
    setDraftHiddenRowIds(prev => {
      const next = prev.includes(rowId)
        ? prev.filter(id => id !== rowId)
        : [...prev, rowId];
      return next;
    });
  };

  const applyDraftVisibilityPreset = (group: "all" | RowGroup) => {
    if (group === "all") {
      setDraftHiddenRowIds([]);
      return;
    }

    const nextHidden: string[] = [];
    for (const row of ivyRows) {
      if (getRowGroup(row.id) !== group) {
        nextHidden.push(row.id);
      }
    }
    setDraftHiddenRowIds(nextHidden);
  };

  const saveParameterVisibility = () => {
    const hiddenSet = new Set(draftHiddenRowIds);
    setHiddenRowIds(draftHiddenRowIds);
    setPreferredVisibleRowIds(ivyRows.filter(row => !hiddenSet.has(row.id)).map(row => row.id));
    setIsParamMenuOpen(false);
  };

  const eventModalResolvedTs = useMemo(() => {
    if (eventModalTs == null) return null;
    return toTsOnSameDate(eventModalTs, eventModalTime) ?? eventModalTs;
  }, [eventModalTs, eventModalTime]);
  const manualEventOptions = useMemo(
    () => MANUAL_EVENT_BUTTON_LAYOUT.map(item => item.title),
    [],
  );

  const eventModalAvailability = useMemo(() => {
    const byTitle: Record<
      string,
      {
        disabled: boolean;
        reason?: string;
      }
    > = {};

    const selectedTs = eventModalResolvedTs ?? Date.now();
    const eventRows = caseEventsAll
      .filter(row => row.event_type === "event")
      .slice()
      .sort((a, b) => a.event_ts - b.event_ts || a.id - b.id);

    const hasStartInCase = { ane: false, surg: false };
    const openCount = { ane: 0, surg: 0 };
    let hasTimeOut = false;

    for (const row of eventRows) {
      const normalized = normalizeLifecycleTitle(row.title);
      if (normalized === "time out") hasTimeOut = true;

      const parsed = parseLifecycleEventTitle(row.title);
      if (!parsed) continue;

      if (parsed.phase === "start") {
        hasStartInCase[parsed.scope] = true;
      }

      if (row.event_ts <= selectedTs) {
        if (parsed.phase === "start") {
          openCount[parsed.scope] += 1;
        } else {
          openCount[parsed.scope] = Math.max(0, openCount[parsed.scope] - 1);
        }
      }
    }

    for (const title of COMMON_EVENT_OPTIONS) {
      const normalized = normalizeLifecycleTitle(title);

      if (normalized === "time out" && hasTimeOut) {
        byTitle[title] = {
          disabled: true,
          reason: "Time Out already recorded in this case",
        };
        continue;
      }

      const parsed = parseLifecycleEventTitle(title);
      if (!parsed) {
        byTitle[title] = { disabled: false };
        continue;
      }

      if (parsed.phase === "start" && hasStartInCase[parsed.scope]) {
        byTitle[title] = {
          disabled: true,
          reason: `Start ${parsed.scope === "ane" ? "ANE" : "Surgery"} already recorded in this case`,
        };
        continue;
      }

      if (parsed.phase === "end" && openCount[parsed.scope] <= 0) {
        byTitle[title] = {
          disabled: true,
          reason: `Need Start ${parsed.scope === "ane" ? "ANE" : "Surgery"} before End ${parsed.scope === "ane" ? "ANE" : "Surgery"}`,
        };
        continue;
      }

      byTitle[title] = { disabled: false };
    }

    return byTitle;
  }, [caseEventsAll, eventModalResolvedTs]);

  useEffect(() => {
    if (eventModalTs == null) return;
    if (eventModalEditingId != null) return;

    const current = eventModalAvailability[eventModalEventTitle];
    const firstEnabled = manualEventOptions.find(
      title => !eventModalAvailability[title]?.disabled,
    );
    if (!firstEnabled) {
      if (eventModalMode === "event") {
        setEventModalMode("note");
      }
      return;
    }
    if (eventModalMode !== "event") return;
    if (current && !current.disabled && !isAutoEventTitle(eventModalEventTitle)) return;
    if (firstEnabled) {
      setEventModalEventTitle(firstEnabled);
    }
  }, [
    eventModalAvailability,
    eventModalEditingId,
    eventModalEventTitle,
    eventModalMode,
    eventModalTs,
    manualEventOptions,
  ]);

  const openEventModalAtTs = (ts: number) => {
    setEventModalTs(ts);
    setEventModalEditingId(null);
    setEventModalMode("event");
    setEventModalEventTitle(manualEventOptions[0] || COMMON_EVENT_OPTIONS[0]);
    setEventModalNoteTitle("");
    setEventModalDetail("");
    setEventModalTime(formatHHMM(ts));
    setEventModalError("");
  };

  const openEventModalForMarker = (marker: ClinicalTimelineEventMarker) => {
    const row = caseEventById.get(marker.id);
    const eventTs = row?.event_ts ?? marker.event_ts;
    const eventType = row?.event_type ?? marker.event_type;
    const eventTitle = ((row?.title ?? marker.title) || "").trim();
    const eventDetail = row?.detail ?? "";
    const isCommonEventTitle = (value: string): value is (typeof COMMON_EVENT_OPTIONS)[number] =>
      COMMON_EVENT_OPTIONS.includes(value as (typeof COMMON_EVENT_OPTIONS)[number]);
    const resolveCommonTitle = (value: string) => {
      if (isCommonEventTitle(value)) return value;
      const lifecycle = parseLifecycleEventTitle(value);
      if (lifecycle?.scope === "ane" && lifecycle.phase === "start") return "Start ANE";
      if (lifecycle?.scope === "ane" && lifecycle.phase === "end") return "End ANE";
      if (lifecycle?.scope === "surg" && lifecycle.phase === "start") return "Start Surgery";
      if (lifecycle?.scope === "surg" && lifecycle.phase === "end") return "End Surgery";
      const normalized = normalizeLifecycleTitle(value);
      return (
        COMMON_EVENT_OPTIONS.find(
          option => normalizeLifecycleTitle(option) === normalized,
        ) || COMMON_EVENT_OPTIONS[0]
      );
    };
    setEventModalTs(eventTs);
    setEventModalEditingId(marker.id);
    setEventModalMode(eventType);
    setEventModalEventTitle(
      eventType === "event"
        ? resolveCommonTitle(eventTitle)
        : COMMON_EVENT_OPTIONS[0],
    );
    setEventModalNoteTitle(eventType === "note" ? eventTitle : "");
    setEventModalDetail(eventDetail || "");
    setEventModalTime(formatHHMM(eventTs));
    setEventModalError("");
  };

  const closeEventModal = () => {
    if (eventModalSaving || eventModalDeleting) return;
    setEventModalTs(null);
    setEventModalEditingId(null);
    setEventModalError("");
  };

  const handleEventModalKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (eventModalSaving || eventModalDeleting) return;
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      closeEventModal();
      return;
    }
    if (e.key !== "Enter" || e.shiftKey) return;
    const target = e.target as HTMLElement | null;
    if (target?.tagName === "TEXTAREA") return;
    e.preventDefault();
    e.stopPropagation();
    void saveEventModal();
  };

  useEffect(() => {
    if (eventModalTs == null) return;
    window.requestAnimationFrame(() => {
      eventModalRef.current?.focus();
    });
  }, [eventModalEditingId, eventModalMode, eventModalTs]);

  const saveEventModal = async () => {
    if (!caseId || eventModalTs == null) return;

    const editedTs = toTsOnSameDate(eventModalTs, eventModalTime);
    if (editedTs == null) {
      setEventModalError("Time must be HH:mm (24-hour)");
      return;
    }

    const title =
      eventModalMode === "event"
        ? eventModalEventTitle.trim()
        : eventModalNoteTitle.trim();
    if (!title) {
      setEventModalError(
        eventModalMode === "event" ? "Event title required" : "Note title required",
      );
      return;
    }

    if (eventModalMode === "event" && eventModalEditingId == null) {
      if (isAutoEventTitle(title)) {
        setEventModalError("This event is auto from Fluid&Med entries");
        return;
      }
      const availability = eventModalAvailability[title];
      if (availability?.disabled) {
        setEventModalError(availability.reason || "This event is not available");
        return;
      }
    }

    setEventModalSaving(true);
    setEventModalError("");
    try {
      const normalizedEventTitle = normalizeLifecycleTitle(title);
      const detailText =
        eventModalDetail.trim() ||
        (eventModalMode === "event" && normalizedEventTitle === "time out" && caseStatus.status !== "IDLE"
          ? (() => {
              const patientDoc = readPatientDocumentSummary(caseStatus.case_id);
              return [
                "Patient identity confirmed with patient document",
                `HN: ${caseStatus.hn}`,
                patientDoc.an ? `AN: ${patientDoc.an}` : "",
                patientDoc.name ? `Name: ${patientDoc.name}` : "",
              ].filter(Boolean).join(" | ");
            })()
          : "");
      if (eventModalEditingId != null) {
        await updateCaseEvent(caseId, eventModalEditingId, {
          event_ts: editedTs,
          event_type: eventModalMode,
          title,
          detail: detailText || undefined,
          actor,
          reason: "clinical-chart timeline event edit modal",
        });
      } else {
        await createCaseEvent(caseId, {
          event_ts: editedTs,
          event_type: eventModalMode,
          title,
          detail: detailText || undefined,
          actor,
          reason: "clinical-chart timeline event modal",
        });
      }
      window.dispatchEvent(
        new CustomEvent("flora:case-events-changed", { detail: { caseId } }),
      );
      setEventModalTs(null);
      setEventModalEditingId(null);
      setEventModalDetail("");
      setEventModalNoteTitle("");
      setEventModalError("");
    } catch (err) {
      setEventModalError(err instanceof Error ? err.message : "Failed to save event");
    } finally {
      setEventModalSaving(false);
    }
  };

  const clearEventModal = async () => {
    if (!caseId || eventModalEditingId == null) return;
    setEventModalDeleting(true);
    setEventModalError("");
    try {
      await deleteCaseEvent(
        caseId,
        eventModalEditingId,
        actor,
        "clinical-chart timeline event clear modal",
      );
      window.dispatchEvent(
        new CustomEvent("flora:case-events-changed", { detail: { caseId } }),
      );
      setEventModalTs(null);
      setEventModalEditingId(null);
      setEventModalDetail("");
      setEventModalNoteTitle("");
      setEventModalError("");
    } catch (err) {
      setEventModalError(err instanceof Error ? err.message : "Failed to clear event");
    } finally {
      setEventModalDeleting(false);
    }
  };

  const openIoModalForRunAtTs = (run: CaseIoRun, ts: number) => {
    const itemName = run.item_name || run.item_code || "Unknown";
    const itemUnit = run.item_unit || (run.kind === "med" ? "mg" : "mL");
    const bucketStart = ts;
    const bucketEnd = ts + axisStepMs;
    const existing = ioEvents.filter(
      event =>
        event.item_id === run.item_id &&
        event.kind === run.kind &&
        event.event_ts >= bucketStart &&
        event.event_ts < bucketEnd,
    );
    const existingValue = existing.reduce((sum, event) => {
      const amount =
        run.kind === "med" ? Number(event.dose_value) : Number(event.volume_ml);
      return Number.isFinite(amount) ? sum + amount : sum;
    }, 0);
    const firstEventTs = existing[0]?.event_ts ?? ts;
    const resolvedBloodType = resolveBloodProductEntryType(run);
    const runIsBloodProduct = isBloodProductRun(run);
    const existingNote =
      [...existing]
        .reverse()
        .map(event => String(event.note || "").trim())
        .find(Boolean) ||
      (runIsBloodProduct ? String(run.note || "").trim() : "");
    const parsedExistingNote = parseKeyValueFromNote(existingNote);
    const isRegisteredWarmingRun =
      runIsBloodProduct &&
      existing.length === 0 &&
      parsedExistingNote.workflow === "register_warming";
    const existingBloodVerificationMode =
      runIsBloodProduct &&
      !isRegisteredWarmingRun &&
      (parsedExistingNote.verification === "api" ||
        parsedExistingNote.verification === "manual" ||
        parsedExistingNote.verification === "registered")
        ? parsedExistingNote.verification
        : null;
    const existingBloodGroupParts = parseStoredBloodGroup(parsedExistingNote.bloodGroup);

    setIoPreparedModal({
      runId: run.id,
      itemId: run.item_id,
      kind: run.kind,
      itemName,
      itemUnit,
      ts,
      entryMode: run.entry_mode,
    });
    setIoModalValue(existingValue > 0 ? String(existingValue) : "");
    setIoModalDate(formatDDMMYYYY(firstEventTs));
    setIoModalTime(formatHHMM(firstEventTs));
    setIoModalUnit(itemUnit);
    setIoModalLocalRoute(
      String(parsedExistingNote.route || run.route || DEFAULT_CASEVIEW_LOCAL_ROUTE).trim() ||
        DEFAULT_CASEVIEW_LOCAL_ROUTE,
    );
    setIoModalLocalConcentration(String(parsedExistingNote.concentration || "").replace(/%$/i, "").trim());
    setIoModalLocalVolumeMl(String(parsedExistingNote.volumeMl || "").trim());
    setIoModalNote(
      runIsBloodProduct
        ? sanitizeBloodProductNote(existingNote)
        : normalizeToken(run.item_category) === "localanesthetic"
          ? sanitizeLocalAnestheticNote(existingNote)
          : existingNote,
    );
    setIoModalBloodGroup(
      runIsBloodProduct &&
        !isRegisteredWarmingRun &&
        (resolvedBloodType === "PRC" || resolvedBloodType === "FFP")
        ? String(parsedExistingNote.bloodGroup || "").toUpperCase()
        : "",
    );
    setIoModalBloodBagNo(
      runIsBloodProduct && !isRegisteredWarmingRun
        ? String(parsedExistingNote.bloodBagNo || "").trim()
        : "",
    );
    setIoModalBloodVerified(
      runIsBloodProduct && existingBloodVerificationMode === "api"
        ? {
            hn: caseStatus.status === "IDLE" ? "" : caseStatus.hn,
            an: parsedExistingNote.an || null,
            patient_name: parsedExistingNote.patientName || parsedExistingNote.patient_name || null,
            reqno: parsedExistingNote.reqno || null,
            bdtype: parsedExistingNote.bloodProductType || null,
            dnrno: parsedExistingNote.bloodBagNo || null,
            bloodgrp: existingBloodGroupParts.bloodgrp,
            rh: existingBloodGroupParts.rh,
            unitstas: parsedExistingNote.unitstas || null,
          }
        : null,
    );
    setIoModalBloodVerificationMode(existingBloodVerificationMode);
    setIoModalBloodManualAvailable(false);
    setIoModalBloodChecking(false);
    setIoModalError("");
  };

  const findDripSegmentAtTs = (run: CaseIoRun, ts: number) => {
    const bucketStart = ts;
    const bucketEnd = bucketStart + axisStepMs;
    const segments = Array.isArray(run.segments) ? run.segments : [];
    return segments.find(segment => {
      if (segment.include_in_balance === 0) return false;
      const segStart = Number(segment.ts_from);
      if (!Number.isFinite(segStart)) return false;
      const segEnd =
        segment.ts_to == null ? Infinity : Number(segment.ts_to);
      if (!Number.isFinite(segEnd) && segEnd !== Infinity) return false;
      const hasValue =
        (Number.isFinite(Number(segment.rate_value)) &&
          Number(segment.rate_value) > 0) ||
        (Number.isFinite(Number(segment.dose_value)) &&
          Number(segment.dose_value) > 0) ||
        (Number.isFinite(Number(segment.carrier_ml_per_hr)) &&
          Number(segment.carrier_ml_per_hr) > 0);
      if (!hasValue) return false;
      return segStart < bucketEnd && segEnd > bucketStart;
    });
  };

  const openIoDripModalForSegment = (
    run: CaseIoRun,
    segment: NonNullable<CaseIoRun["segments"]>[number],
    ts: number,
  ) => {
    const startTs = Number(segment.ts_from);
    const endTs = segment.ts_to == null ? null : Number(segment.ts_to);
    const parsedNote = parseKeyValueFromNote(String(segment.note || ""));
    const cleanNote = String(segment.note || "")
      .split("|")
      .map(token => token.trim())
      .filter(token => {
        const lower = token.toLowerCase();
        return (
          !lower.startsWith("dripvolumeml:") &&
          !lower.startsWith("carriervolumeml:") &&
          !lower.startsWith("dripdurationmin:")
        );
      })
      .join(" | ");
    setIoPreparedModal(null);
    setIoDripModal({
      runId: run.id,
      segmentId: segment.id,
      kind: run.kind,
      itemName: run.item_name || run.item_code || "Unknown",
      itemUnit: run.item_unit || (run.kind === "med" ? "mg" : "mL"),
      ts,
    });
    setIoDripStartDate(formatDDMMYYYY(startTs));
    setIoDripStartTime(formatHHMM(startTs));
    setIoDripEndDate(endTs == null ? "" : formatDDMMYYYY(endTs));
    setIoDripEndTime(endTs == null ? "" : formatHHMM(endTs));
    setIoDripRateValue(
      segment.rate_value == null ? "" : String(Number(segment.rate_value)),
    );
    setIoDripRateUnit(segment.rate_unit || "ml/hr");
    setIoDripDoseValue(
      segment.dose_value == null ? "" : String(Number(segment.dose_value)),
    );
    setIoDripDoseUnit(
      segment.dose_unit || run.item_unit || (run.kind === "med" ? "mg" : "mL"),
    );
    setIoDripCarrierValue(
      segment.carrier_ml_per_hr == null
        ? ""
        : String(Number(segment.carrier_ml_per_hr)),
    );
    setIoDripWeightKg(caseId ? readWeightFromSavedForm(caseId) : "");
    setIoDripConcentration("");
    setIoDripMedVolume(parsedNote.dripVolumeMl || "");
    setIoDripCarrierVolume(parsedNote.carrierVolumeMl || "");
    setIoDripNote(cleanNote);
    setIoDripOngoing(segment.ts_to == null);
    setIoDripAdvanced(
      segment.dose_value != null ||
      segment.carrier_ml_per_hr != null ||
      Boolean(parsedNote.dripVolumeMl) ||
      Boolean(parsedNote.carrierVolumeMl) ||
      Boolean(cleanNote),
    );
    setIoDripError("");
  };

  const handlePreparedMarkerClick = (
    ts: number,
    marker: ClinicalTimelineIoMarker,
  ) => {
    const run = preparedRunById.get(marker.run_id);
    if (!run) return;
    if (marker.marker_code === "d") {
      const segment = findDripSegmentAtTs(run, ts);
      if (segment) {
        if (run.kind === "fluid") {
          openIoDripModalForSegment(run, segment, ts);
        } else {
          openQuickMedDripForExistingRun(run, ts, segment);
        }
        return;
      }
    }
    openIoModalForRunAtTs(run, ts);
  };

  const handleIoCellClick = (rowId: string, ts: number) => {
    const run = ioRunByRowId.get(rowId);
    if (!run) return;
    const rawCell = ioGridValues[rowId]?.[ts];
    if (isIoGridCellValue(rawCell) && rawCell.dripPart && rawCell.segmentId) {
      const segmentRun =
        ioRuns.find(candidate =>
          Array.isArray(candidate.segments) &&
          candidate.segments.some(segment => segment.id === rawCell.segmentId),
        ) || run;
      const segment = (Array.isArray(segmentRun.segments) ? segmentRun.segments : []).find(
        row => row.id === rawCell.segmentId,
      );
      if (segment) {
        if (segmentRun.kind === "fluid") {
          openIoDripModalForSegment(segmentRun, segment, ts);
        } else {
          openQuickMedDripForExistingRun(segmentRun, ts, segment);
        }
        return;
      }
    }
    setIoDripModal(null);
    if (run.entry_mode === "drip") {
      if (run.kind === "fluid") {
        const segment = findDripSegmentAtTs(run, ts);
        if (segment) {
          openIoDripModalForSegment(run, segment, ts);
          return;
        }
      } else {
        openQuickMedDripForExistingRun(run, ts);
        return;
      }
    }
    openIoModalForRunAtTs(run, ts);
  };

  const closeIoModal = () => {
    if (ioModalSaving) return;
    setIoPreparedModal(null);
    setIoModalDate("");
    setIoModalTime("");
    setIoModalLocalRoute(DEFAULT_CASEVIEW_LOCAL_ROUTE);
    setIoModalLocalConcentration("");
    setIoModalLocalVolumeMl("");
    setIoModalBloodGroup("");
    setIoModalBloodBagNo("");
    setIoModalError("");
  };

  const closeIoDripModal = () => {
    if (ioDripSaving) return;
    setIoDripModal(null);
    setIoDripWeightKg("");
    setIoDripConcentration("");
    setIoDripMedVolume("");
    setIoDripCarrierVolume("");
    setIoDripAdvanced(false);
    setIoDripError("");
  };

  const isNotFoundApiError = (err: unknown) =>
    err instanceof Error && /\b404\b/.test(err.message);

  const resolveLiveRunById = (runId: number) =>
    preparedRunById.get(runId) || ioRuns.find(candidate => candidate.id === runId) || null;

  const resolveLiveSegmentForRun = (
    run: CaseIoRun | null,
    preferredSegmentId: number | null | undefined,
    atTs: number,
    preferredTsFrom?: number | null,
  ) => {
    if (!run || !Array.isArray(run.segments)) return null;
    if (preferredSegmentId != null) {
      const exact = run.segments.find(segment => segment.id === preferredSegmentId) || null;
      if (exact) return exact;
    }
    if (preferredTsFrom != null && Number.isFinite(preferredTsFrom)) {
      const byStart = run.segments.find(
        segment =>
          segment.include_in_balance !== 0 &&
          Number(segment.ts_from) === Number(preferredTsFrom),
      ) || null;
      if (byStart) return byStart;
    }
    const byTs = findDripSegmentAtTs(run, atTs);
    if (byTs) return byTs;
    return (
      [...run.segments]
        .filter(segment => isVisibleIoSegment(segment))
        .sort((a, b) => Number(b.ts_from) - Number(a.ts_from) || b.id - a.id)[0] || null
    );
  };

  const parseNullableNonNegative = (raw: string): number | null => {
    const trimmed = raw.trim();
    if (!trimmed) return null;
    const numeric = Number(trimmed);
    if (!Number.isFinite(numeric) || numeric < 0) return NaN;
    return numeric;
  };

  const calculateIoDrip = () => {
    if (!ioDripModal) return;
    const startTs = toTsFromDateAndTime(ioDripStartDate, ioDripStartTime);
    if (startTs == null) {
      setIoDripError("Start must be dd/mm/yyyy and HH:mm");
      return;
    }

    let endTs: number | null = null;
    if (ioDripEndDate.trim() || ioDripEndTime.trim()) {
      if (!ioDripEndDate.trim() || !ioDripEndTime.trim()) {
        setIoDripError("End requires both date and time");
        return;
      }
      const parsedEnd = toTsFromDateAndTime(ioDripEndDate, ioDripEndTime);
      if (parsedEnd == null) {
        setIoDripError("End must be dd/mm/yyyy and HH:mm");
        return;
      }
      if (parsedEnd <= startTs) {
        setIoDripError("End time must be after start time");
        return;
      }
      endTs = parsedEnd;
    }

    const rateMlHr = parsePositiveNumber(ioDripRateValue);
    const medVolumeMl = parsePositiveNumber(ioDripMedVolume);
    const carrierRateMlHr = parsePositiveNumber(ioDripCarrierValue);
    const carrierVolumeMl = parsePositiveNumber(ioDripCarrierVolume);
    const weightKg = parsePositiveNumber(ioDripWeightKg);
    const dosePerKg = parsePositiveNumber(ioDripDoseValue);
    const doseMcgPerKgMin =
      dosePerKg == null ? null : doseToMcgPerKgMin(dosePerKg, ioDripDoseUnit);
    const concentrationValue = parsePositiveNumber(ioDripConcentration);
    const concentrationMcgPerMl =
      concentrationValue == null
        ? null
        : concentrationToMcgPerMl(concentrationValue, "mg/mL");

    let nextRateMlHr = rateMlHr;
    let nextMedVolumeMl = medVolumeMl;
    let nextCarrierRateMlHr = carrierRateMlHr;
    let nextCarrierVolumeMl = carrierVolumeMl;
    let nextEndTs = endTs;
    let durationMin =
      endTs != null && endTs > startTs ? (endTs - startTs) / 60_000 : null;

    if (
      nextRateMlHr == null &&
      doseMcgPerKgMin != null &&
      weightKg != null &&
      concentrationMcgPerMl != null
    ) {
      nextRateMlHr = (doseMcgPerKgMin * weightKg * 60) / concentrationMcgPerMl;
    }

    if (durationMin != null && durationMin > 0) {
      if (nextRateMlHr == null && nextMedVolumeMl != null) {
        nextRateMlHr = (nextMedVolumeMl * 60) / durationMin;
      } else if (nextMedVolumeMl == null && nextRateMlHr != null) {
        nextMedVolumeMl = (nextRateMlHr * durationMin) / 60;
      }

      if (nextCarrierRateMlHr == null && nextCarrierVolumeMl != null) {
        nextCarrierRateMlHr = (nextCarrierVolumeMl * 60) / durationMin;
      } else if (nextCarrierVolumeMl == null && nextCarrierRateMlHr != null) {
        nextCarrierVolumeMl = (nextCarrierRateMlHr * durationMin) / 60;
      }
    } else if (nextRateMlHr != null && nextMedVolumeMl != null) {
      durationMin = (nextMedVolumeMl / nextRateMlHr) * 60;
      nextEndTs = startTs + durationMin * 60_000;
      if (nextCarrierRateMlHr != null && nextCarrierVolumeMl == null) {
        nextCarrierVolumeMl = (nextCarrierRateMlHr * durationMin) / 60;
      }
    } else {
      setIoDripError("Need more data to calculate (rate/volume/end or dose/weight/concentration)");
      return;
    }

    let resolvedDose = dosePerKg;
    if (
      resolvedDose == null &&
      nextRateMlHr != null &&
      weightKg != null &&
      concentrationMcgPerMl != null
    ) {
      const mcgPerKgPerMin =
        (nextRateMlHr * concentrationMcgPerMl) / 60 / weightKg;
      const converted = mcgPerKgMinToUnit(mcgPerKgPerMin, ioDripDoseUnit);
      if (converted != null) resolvedDose = converted;
    }

    if (nextRateMlHr != null) setIoDripRateValue(String(round4(nextRateMlHr)));
    if (nextMedVolumeMl != null) setIoDripMedVolume(String(round2(nextMedVolumeMl)));
    if (nextCarrierRateMlHr != null) {
      setIoDripCarrierValue(String(round4(nextCarrierRateMlHr)));
    }
    if (nextCarrierVolumeMl != null) {
      setIoDripCarrierVolume(String(round2(nextCarrierVolumeMl)));
    }
    if (resolvedDose != null) setIoDripDoseValue(String(round4(resolvedDose)));
    if (nextEndTs != null) {
      setIoDripEndDate(formatDDMMYYYY(nextEndTs));
      setIoDripEndTime(formatHHMM(nextEndTs));
    }
    setIoDripError("");
  };


  const saveIoDripModal = async (forcedEndTs?: number | null) => {
    if (!caseId || !ioDripModal) return;

    const startTs = toTsFromDateAndTime(ioDripStartDate, ioDripStartTime);
    if (startTs == null) {
      setIoDripError("Start must be dd/mm/yyyy and HH:mm");
      return;
    }

    let endTs: number | null = null;
    if (forcedEndTs != null) {
      if (!Number.isFinite(forcedEndTs)) {
        setIoDripError("End must be dd/mm/yyyy and HH:mm");
        return;
      }
      if (forcedEndTs <= startTs) {
        setIoDripError("End time must be after start time");
        return;
      }
      endTs = Number(forcedEndTs);
    } else if (!ioDripOngoing) {
      if (!ioDripEndDate.trim() || !ioDripEndTime.trim()) {
        setIoDripError("End requires both date and time, or mark as still running");
        return;
      }
      const parsedEnd = toTsFromDateAndTime(ioDripEndDate, ioDripEndTime);
      if (parsedEnd == null) {
        setIoDripError("End must be dd/mm/yyyy and HH:mm");
        return;
      }
      if (parsedEnd <= startTs) {
        setIoDripError("End time must be after start time");
        return;
      }
      endTs = parsedEnd;
    }

    const rateValue = parseNullableNonNegative(ioDripRateValue);
    const doseValue = parseNullableNonNegative(ioDripDoseValue);
    const carrierValue = parseNullableNonNegative(ioDripCarrierValue);
    const medVolumeValue = parseNullableNonNegative(ioDripMedVolume);
    const carrierVolumeValue = parseNullableNonNegative(ioDripCarrierVolume);
    if (
      Number.isNaN(rateValue) ||
      Number.isNaN(doseValue) ||
      Number.isNaN(carrierValue) ||
      Number.isNaN(medVolumeValue) ||
      Number.isNaN(carrierVolumeValue)
    ) {
      setIoDripError("Rate / Dose / Carrier / Volume must be >= 0");
      return;
    }
    setIoDripSaving(true);
    setIoDripError("");
    try {
      if (ioDripModal.kind === "fluid") {
        const liveRun = resolveLiveRunById(ioDripModal.runId);
        const liveSegment = resolveLiveSegmentForRun(
          liveRun,
          ioDripModal.segmentId ?? null,
          ioDripModal.ts,
          startTs,
        );
        if (rateValue == null || rateValue <= 0) {
          setIoDripError("Rate must be > 0");
          setIoDripSaving(false);
          return;
        }
        if (!liveRun || !liveSegment) {
          setIoDripError("Fluid drip segment not found");
          setIoDripSaving(false);
          return;
        }
        await updateCaseIoSegment(caseId, liveSegment.id, {
          ts_to: endTs,
          rate_value: rateValue,
          rate_unit: "ml/hr",
          reason: endTs != null ? "clinical-chart stop fluid drip" : "clinical-chart change fluid drip rate",
          actor,
        });
        await updateCaseIoRun(caseId, liveRun.id, {
          stopped_at: endTs,
          reason: endTs != null ? "clinical-chart stop fluid drip" : "clinical-chart change fluid drip rate",
          actor,
        });
        notifyIoAndEventChanged(caseId);
        setIoDripModal(null);
        return;
      }

      const durationMin =
        endTs != null && endTs > startTs ? (endTs - startTs) / 60_000 : null;
      const noteParts = [ioDripNote.trim()];
      if (medVolumeValue != null && medVolumeValue > 0) {
        noteParts.push(`dripVolumeMl:${round2(medVolumeValue)}`);
      }
      if (carrierVolumeValue != null && carrierVolumeValue > 0) {
        noteParts.push(`carrierVolumeMl:${round2(carrierVolumeValue)}`);
      }
      if (durationMin != null && durationMin > 0) {
        noteParts.push(`dripDurationMin:${round2(durationMin)}`);
      }
      const segmentPayload = {
        ts_from: startTs,
        ts_to: endTs,
        rate_value: rateValue ?? undefined,
        rate_unit: ioDripRateUnit.trim() || "ml/hr",
        dose_value: doseValue ?? undefined,
        dose_unit:
          doseValue != null ? ioDripDoseUnit.trim() || ioDripModal.itemUnit : undefined,
        carrier_ml_per_hr: carrierValue ?? undefined,
        note: noteParts.filter(Boolean).join(" | ") || undefined,
        include_in_balance: true,
        actor,
      };
      if (ioDripModal.segmentId != null) {
        await updateCaseIoSegment(caseId, ioDripModal.segmentId, {
          ...segmentPayload,
          reason: "clinical-chart edit drip segment",
        });
      } else {
        await createCaseIoSegment(caseId, {
          run_id: ioDripModal.runId,
          ...segmentPayload,
        });
      }
      notifyIoAndEventChanged(caseId);
      setIoDripModal(null);
    } catch (err) {
      setIoDripError(
        isNotFoundApiError(err)
          ? "Drip changed in the background. Please reopen it and try again."
          : err instanceof Error
            ? err.message
            : "Failed to save drip",
      );
    } finally {
      setIoDripSaving(false);
    }
  };

  const resetIoModalBloodVerification = () => {
    setIoModalBloodVerified(null);
    setIoModalBloodVerificationMode(null);
    setIoModalBloodManualAvailable(false);
  };

  const checkIoModalBloodProductBag = async () => {
    if (!caseId || caseStatus.status === "IDLE") return;
    const bloodBagNo = ioModalBloodBagNo.trim();
    if (!bloodBagNo) {
      setIoModalError("Blood bag no. is required for blood product");
      return;
    }
    setIoModalBloodChecking(true);
    setIoModalError("");
    resetIoModalBloodVerification();
    try {
      const registered = findStoredBloodVerificationForBag(bloodBagNo, {
        includeWarming: true,
        onlyWarming: true,
      });
      if (registered) {
        setIoModalBloodVerified(registered.result);
        setIoModalBloodVerificationMode("registered");
        const registeredGroup = formatVerifiedBloodGroup(registered.result);
        if (registeredGroup) setIoModalBloodGroup(registeredGroup);
        return;
      }
      const verification = await verifyCaseBloodProduct(caseId, {
        hn: caseStatus.hn,
        an: patientDocumentSummary.an,
        qr: bloodBagNo,
      });
      if (!verification.ok) {
        setIoModalBloodManualAvailable(verification.checks.hn_match !== false);
        setIoModalError(
          verification.checks.hn_match === false
            ? `${verification.message || "HN mismatch"}. Blood product cannot be used for this patient.`
            : `${verification.message || "Blood product verification failed"}. API is primary; use manual check only after bedside document check.`,
        );
        return;
      }
      setIoModalBloodVerified(verification.result);
      setIoModalBloodVerificationMode("api");
      const verifiedGroup = formatVerifiedBloodGroup(verification.result);
      if (verifiedGroup) setIoModalBloodGroup(verifiedGroup);
    } catch (err) {
      setIoModalBloodManualAvailable(true);
      setIoModalError(
        `${err instanceof Error ? err.message : "Blood product verification failed"}. API is primary; use manual check only after bedside document check.`,
      );
    } finally {
      setIoModalBloodChecking(false);
    }
  };

  const confirmIoModalBloodManualCheck = () => {
    if (!ioModalBloodBagNo.trim()) {
      setIoModalError("Blood bag no. is required for blood product");
      return;
    }
    setIoModalBloodVerified(null);
    setIoModalBloodVerificationMode("manual");
    setIoModalBloodManualAvailable(false);
    setIoModalError("");
  };

  const savePreparedValue = async () => {
    if (!caseId || !ioPreparedModal || !modalRun) return;

    const bloodGroup = ioModalBloodGroup.trim().toUpperCase();
    const bloodBagNo = ioModalBloodBagNo.trim();
    if (isModalMedicationBolus && !isModalLocalAnesthetic) {
      const dose = Number(ioModalValue);
      if (!Number.isFinite(dose) || dose <= 0) {
        setIoModalError("Dose must be > 0");
        return;
      }
    }
    if (isModalBloodProduct && !bloodBagNo) {
      setIoModalError("Blood bag no. is required for blood product");
      return;
    }

    setIoModalSaving(true);
    setIoModalError("");
    try {
      const promises: Promise<unknown>[] = [];

      {
        // A timeline-cell entry is always a single point in time.
        const editedTs = toTsFromDateAndTime(ioModalDate, ioModalTime);
        if (editedTs == null) {
          setIoModalError("Time must be HH:mm (24-hour) and Date must be dd/mm/yyyy");
          setIoModalSaving(false);
          return;
        }

        const newValue = parseFloat(ioModalValue);
        const newNote = ioModalNote.trim();
        const bloodVerification = isModalBloodProduct ? ioModalBloodVerified : null;
        if (isModalBloodProduct && !hasTimeOutBefore(editedTs)) {
          throw new Error("Time Out must be completed before giving blood product");
        }
        const resolvedBloodGroup = bloodVerification
          ? [
              String(bloodVerification.bloodgrp || "").trim().toUpperCase(),
              String(bloodVerification.rh || "").trim(),
            ].filter(Boolean).join("") || bloodGroup
          : bloodGroup;
        const resolvedBloodBagNo = String(bloodVerification?.dnrno || bloodBagNo).trim();
        const baseNote = isModalBloodProduct
          ? ioModalBloodVerificationMode
            ? buildBloodWorkflowDetail(newNote, {
                workflow: "give",
                productName: modalRun.item_name || modalRun.item_code || "Blood product",
                bloodType: modalBloodType,
                bloodGroup: resolvedBloodGroup,
                bloodBagNo: resolvedBloodBagNo,
                bloodVerification,
                verificationMode: ioModalBloodVerificationMode,
                volumeMl: Number.isNaN(newValue) ? null : newValue,
                status: "warmed",
              })
            : buildIoEntryNote(newNote, {
                includeBloodMeta: true,
                bloodType: modalBloodType,
                bloodGroup: resolvedBloodGroup,
                bloodBagNo: resolvedBloodBagNo,
              })
          : buildIoEntryNote(newNote, {
              includeBloodMeta: false,
              bloodType: modalBloodType,
              bloodGroup: resolvedBloodGroup,
              bloodBagNo: resolvedBloodBagNo,
            });

        // Basic mode shows the bucket aggregate, so save should replace the whole
        // bucket, not only an event at the exact edited timestamp.
        for (const existingEvent of modalExistingEvents) {
          promises.push(deleteCaseIoEvent(caseId, existingEvent.id, actor, "basic update clear"));
        }

        if (isModalLocalAnesthetic) {
          const concentrationPercent = Number(ioModalLocalConcentration);
          const volumeMl = Number(ioModalLocalVolumeMl);
          if (
            (String(ioModalLocalConcentration).trim() || String(ioModalLocalVolumeMl).trim()) &&
            (!Number.isFinite(concentrationPercent) ||
              concentrationPercent <= 0 ||
              !Number.isFinite(volumeMl) ||
              volumeMl <= 0)
          ) {
            throw new Error("Concentration and volume must both be > 0");
          }
          if (Number.isFinite(concentrationPercent) && concentrationPercent > 0 && Number.isFinite(volumeMl) && volumeMl > 0) {
            const finalNote = [
              baseNote,
              `concentration:${concentrationPercent}%`,
              `volumeMl:${volumeMl}`,
              `route:${ioModalLocalRoute.trim() || DEFAULT_CASEVIEW_LOCAL_ROUTE}`,
            ]
              .filter(Boolean)
              .join(" | ");
            promises.push(createCaseIoEvent(caseId, {
              item_id: ioPreparedModal.itemId,
              kind: "med",
              event_ts: editedTs,
              dose_value: concentrationPercentToMg(concentrationPercent, volumeMl),
              dose_unit: "mg",
              note: finalNote || undefined,
              include_in_balance: true,
              reason: "timegrid basic save",
              actor,
            }));
          }
        } else if (!Number.isNaN(newValue) && newValue > 0) {
          const finalNote = baseNote;
          if (ioPreparedModal.kind === "med") {
            promises.push(createCaseIoEvent(caseId, {
              item_id: ioPreparedModal.itemId,
              kind: "med",
              event_ts: editedTs,
              dose_value: newValue,
              dose_unit: ioModalUnit.trim() || ioPreparedModal.itemUnit || "mg",
              note: finalNote || undefined,
              include_in_balance: true,
              reason: "timegrid basic save",
              actor,
            }));
          } else {
            promises.push(createCaseIoEvent(caseId, {
              item_id: ioPreparedModal.itemId,
              kind: ioPreparedModal.kind,
              event_ts: editedTs,
              volume_ml: newValue,
              note: finalNote || undefined,
              include_in_balance: true,
              reason: "timegrid basic save",
              actor,
            }));
          }
          if (isModalBloodProduct) {
            promises.push(updateCaseIoRun(caseId, ioPreparedModal.runId, {
              note: finalNote || null,
              actor,
              reason: "clinical-chart blood product warmed status",
            }));
          }
        }
      }

      if (promises.length > 0) {
        await Promise.all(promises);
        notifyIoAndEventChanged(caseId);
      }
      setIoPreparedModal(null);
    } catch (err) {
      setIoModalError(err instanceof Error ? err.message : "Failed to save values");
    } finally {
      setIoModalSaving(false);
    }
  };

  const handleIoModalKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (ioModalSaving) return;
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      closeIoModal();
      return;
    }
    if (e.key !== "Enter" || e.shiftKey) return;
    const target = e.target as HTMLElement | null;
    if (target?.tagName === "TEXTAREA") return;
    if (target?.tagName === "BUTTON") return;
    e.preventDefault();
    e.stopPropagation();
    void savePreparedValue();
  };
  const clearPreparedValue = async () => {
    if (!caseId || !ioPreparedModal || modalExistingEvents.length === 0) {
      setIoPreparedModal(null);
      return;
    }

    setIoModalSaving(true);
    setIoModalError("");
    try {
      await Promise.all(
        modalExistingEvents.map(event =>
          deleteCaseIoEvent(caseId, event.id, actor, "timegrid bucket clear all"),
        ),
      );
      notifyIoAndEventChanged(caseId);
      setIoPreparedModal(null);
    } catch (err) {
      setIoModalError(err instanceof Error ? err.message : "Failed to clear values");
    } finally {
      setIoModalSaving(false);
    }
  };

  const openStartTimeModal = () => {
    if (caseStatus.status === "IDLE") return;
    setStartDateDraft(formatDDMMYYYY(caseStatus.start_time));
    setStartTimeDraft(formatHHMM(caseStatus.start_time));
    setStartTimeError("");
    setStartTimeModalOpen(true);
  };

  const saveStartTime = async () => {
    if (caseStatus.status === "IDLE") return;
    const nextTs = toTsFromDateAndTime(startDateDraft, startTimeDraft);
    if (nextTs == null) {
      setStartTimeError("Enter a valid date and time.");
      return;
    }
    if (nextTs > Date.now()) {
      setStartTimeError("Case start cannot be in the future.");
      return;
    }
    setStartTimeSaving(true);
    setStartTimeError("");
    try {
      await updateCaseStartTime(caseStatus.case_id, nextTs);
      window.dispatchEvent(new CustomEvent("flora:case-start-time-updated", {
        detail: { caseId: caseStatus.case_id, startTime: nextTs },
      }));
      window.dispatchEvent(new CustomEvent("flora:case-events-changed", { detail: { caseId: caseStatus.case_id } }));
      window.dispatchEvent(new CustomEvent("flora:case-io-changed", { detail: { caseId: caseStatus.case_id } }));
      setStartTimeModalOpen(false);
    } catch (error) {
      setStartTimeError(error instanceof Error ? error.message : "Failed to update case start.");
    } finally {
      setStartTimeSaving(false);
    }
  };

  const resetAllergyEditor = () => {
    setAllergyEditingId(null);
    setAllergyDeleteId(null);
    setAllergyDraft({ allergen: "", reaction: "", severity: "" });
    setAllergyError("");
  };

  const openAllergyModal = () => {
    resetAllergyEditor();
    setAllergyModalOpen(true);
  };

  const refreshAllergies = async () => {
    if (caseId == null) return;
    const next = await getCaseAllergies(caseId);
    setPatientContext(previous => ({ ...previous, caseId, allergies: next }));
    window.dispatchEvent(new CustomEvent("flora:allergy-changed", { detail: { caseId } }));
  };

  const editAllergy = (row: CaseAllergyRow) => {
    setAllergyEditingId(String(row.id));
    setAllergyDeleteId(null);
    setAllergyDraft({
      allergen: row.allergen || "",
      reaction: row.reaction || "",
      severity: row.severity || "",
    });
    setAllergyError("");
  };

  const saveAllergy = async () => {
    if (caseId == null || !allergyDraft.allergen.trim()) {
      setAllergyError("Allergen is required.");
      return;
    }
    setAllergySaving(true);
    setAllergyError("");
    try {
      const payload = {
        allergen: allergyDraft.allergen.trim(),
        reaction: allergyDraft.reaction.trim(),
        severity: allergyDraft.severity.trim(),
        status: "active",
      };
      if (allergyEditingId) await updateCaseAllergy(caseId, allergyEditingId, payload);
      else await createCaseAllergy(caseId, payload);
      await refreshAllergies();
      resetAllergyEditor();
    } catch (error) {
      setAllergyError(error instanceof Error ? error.message : "Failed to save allergy.");
    } finally {
      setAllergySaving(false);
    }
  };

  const removeAllergy = async () => {
    if (caseId == null || allergyDeleteId == null) return;
    setAllergySaving(true);
    setAllergyError("");
    try {
      await deleteCaseAllergy(caseId, allergyDeleteId);
      await refreshAllergies();
      resetAllergyEditor();
    } catch (error) {
      setAllergyError(error instanceof Error ? error.message : "Failed to remove allergy.");
    } finally {
      setAllergySaving(false);
    }
  };

  if (caseStatus.status === "IDLE") {
    return <div className="p-6 text-gray-400">No active case</div>;
  }

  const caseEndTs = caseStatus.status === "ACTIVE"
    ? nowTs
    : caseStatus.discharge_time || nowTs;
  const caseElapsed = Math.max(0, caseEndTs - caseStatus.start_time);
  const diagnosisPrimary = clinicalContext.caseId === caseId ? clinicalContext.diagnosis[0] : null;
  const operationPrimary = clinicalContext.caseId === caseId ? clinicalContext.operations[0] : null;
  const additionalDiagnoses = clinicalContext.caseId === caseId ? clinicalContext.diagnosis.slice(1) : [];
  const additionalOperations = clinicalContext.caseId === caseId ? clinicalContext.operations.slice(1) : [];
  const patientLoaded = patientContext.caseId === caseId;
  const patient = patientLoaded ? patientContext.patient : null;
  const allergies = patientLoaded ? patientContext.allergies : [];
  const patientName = patientLoaded
    ? formatPatientDisplayName(
        patient,
        normalizePatientNameLanguage(sessionUser?.parameterPreferences?.patientNameLanguage),
      ) || "Patient name not recorded"
    : "Loading…";
  const patientAge = patientLoaded ? formatPatientAge(patient) : "Loading…";
  const patientSex = patientLoaded ? String(patient?.sex || "Sex not recorded").trim() : "Loading…";
  const patientWeightKg = (() => {
    const apiWeight = Number(patient?.weight_kg);
    if (Number.isFinite(apiWeight) && apiWeight > 0) return apiWeight;
    if (caseId == null) return null;
    const savedWeight = Number(readWeightFromSavedForm(caseId));
    return Number.isFinite(savedWeight) && savedWeight > 0 ? savedWeight : null;
  })();
  useEffect(() => {
    if (!quickMedDripOpen || patientWeightKg == null) return;
    setQuickMedDripWeightKg(current => current.trim() || String(patientWeightKg));
  }, [patientWeightKg, quickMedDripOpen]);
  const patientAsaLabel = (() => {
    const raw = String(patient?.asa_status || "").trim();
    if (!raw) return "ASA —";
    const label = /^asa\b/i.test(raw) ? raw : `ASA ${raw}`;
    return patient?.asa_emergency && !/\be\b/i.test(label) ? `${label} E` : label;
  })();
  const allergySummary = !patientLoaded
    ? "Loading…"
    : allergies.length
      ? allergies.map(row => row.allergen).filter(Boolean).join(" · ")
      : "No allergy recorded";
  const diagnosisTooltip = clinicalContext.caseId !== caseId
    ? "DIAGNOSIS\nLoading…"
    : clinicalContext.diagnosis.length === 0
      ? "DIAGNOSIS\nNo diagnosis recorded\nClick to add a record"
      : [
          `DIAGNOSIS · ${clinicalContext.diagnosis.length} ${clinicalContext.diagnosis.length === 1 ? "RECORD" : "RECORDS"}`,
          ...clinicalContext.diagnosis.flatMap((row, index) => [
            `${index + 1}. ${row.diagnosis_text}`,
            `   ${row.entry_context === "preoperative" ? "Pre-op" : row.entry_context.replaceAll("_", " ")} · ${row.icd_code || "Local"} · ${formatCaseClock(row.event_ts, workstation)}`,
          ]),
          "Click to view or edit all records",
        ].join("\n");
  const operationTooltip = clinicalContext.caseId !== caseId
    ? "OPERATION / PROCEDURE\nLoading…"
    : clinicalContext.operations.length === 0
      ? "OPERATION / PROCEDURE\nNo procedure recorded\nClick to add a record"
      : [
          `OPERATION / PROCEDURE · ${clinicalContext.operations.length} ${clinicalContext.operations.length === 1 ? "RECORD" : "RECORDS"}`,
          ...clinicalContext.operations.flatMap((row, index) => [
            `${index + 1}. ${row.procedure_text}`,
            `   ${row.entry_context === "planned" ? "Planned" : "Performed"} · ${row.icd_code || "Local"} · ${formatCaseClock(row.event_ts, workstation)}`,
          ]),
          "Click to view or edit all records",
        ].join("\n");
  const allergyTooltip = !patientLoaded
    ? "ALLERGY\nLoading…"
    : allergies.length === 0
      ? "ALLERGY\nNo allergy recorded\nClick to review or add"
      : [
          `ALLERGY · ${allergies.length} ${allergies.length === 1 ? "RECORD" : "RECORDS"}`,
          ...allergies.map((row, index) => `${index + 1}. ${row.allergen}${row.reaction ? ` · ${row.reaction}` : ""}${row.severity ? ` · ${row.severity}` : ""}`),
          "Click to view or edit all records",
        ].join("\n");
  const compactTimeline = viewportWidth > 0 && viewportWidth < 720;
  const timelineColWidth = compactTimeline ? 68 : 51;
  const timelineLabelWidth = compactTimeline ? 108 : 124;
  const timelineNowIndex = axis.findIndex((ts, index) => {
    const next = axis[index + 1] ?? Infinity;
    return ts <= nowTs && next > nowTs;
  });
  const timelineNowLeft = (() => {
    if (timelineNowIndex < 0) return null;
    const bucketStart = axis[timelineNowIndex];
    const fallbackStep = axis.length > 1 ? Math.max(1, axis[1] - axis[0]) : 60_000;
    const bucketEnd = axis[timelineNowIndex + 1] ?? bucketStart + fallbackStep;
    const progress = Math.max(0, Math.min(1, (nowTs - bucketStart) / Math.max(1, bucketEnd - bucketStart)));
    return timelineLabelWidth + (timelineNowIndex + progress) * timelineColWidth;
  })();

  const isModalMedicationBolus = ioPreparedModal?.kind === "med" && ioPreparedModal.entryMode === "bolus";
  const preparedBolusSuggestion = isModalMedicationBolus
    ? getHistoricalBolusSuggestion(ioPreparedModal?.itemName)
    : null;
  const ioModalPatientContext = (
    <div className="io-modal__patient-context" aria-label="Active patient clinical context">
      <strong>{patientName}</strong>
      <span>HN {caseStatus.hn || "—"}</span>
      <span>{patientAsaLabel}</span>
      <span>Weight {patientWeightKg == null ? "—" : `${patientWeightKg} kg`}</span>
    </div>
  );
  const renderTimeGrid = (displaySection: "events-io" | "vitals") => (
    <ClinicalTimelineGrid
      displaySection={displaySection}
      columns={axis}
      ivyRows={visibleIvyRows}
      rowsAfterEvent={rowsAfterEvent}
      values={combinedGridValues}
      cellProvenance={cellProvenance}
      ioDripRateByRowTs={ioDripRateByRowTs}
      eventMarkersByTs={eventMarkersByTs}
      preparedMarkersByTs={ioPreparedMarkersByTs}
      nowTs={nowTs}
      scrollLeft={scrollLeft}
      viewportWidth={viewportWidth}
      colWidth={timelineColWidth}
      labelColWidth={timelineLabelWidth}
      dripGroupColors={dripGroupColors}
      smartContrast={dripSmartContrast}
      onChange={handleCellChange}
      onIoCellClick={handleIoCellClick}
      onIoHeaderClick={() => setIoAddMenuTs(Date.now())}
      onIoHeaderColumnClick={ts => setIoAddMenuTs(ts)}
      onPreparedMarkerClick={handlePreparedMarkerClick}
      sectionCollapseState={{
        ioCollapsed: isIoSectionCollapsed,
        vitalCollapsed: isVitalSectionCollapsed,
      }}
      onSectionCollapseToggle={section => {
        if (section === "io") {
          setIsIoSectionCollapsed(prev => !prev);
          return;
        }
        setIsVitalSectionCollapsed(prev => !prev);
      }}
      onEventCellClick={openEventModalAtTs}
      onEventMarkerClick={openEventModalForMarker}
    />
  );
  const headerCards = {
    los: (
      <HeaderCard
        group="Case LOS"
        icon={timeCardIcon}
        main={formatCaseElapsed(caseElapsed)}
        sub1={<><b>Started</b> {formatCaseClock(caseStatus.start_time, workstation)}</>}
        tooltip={`CASE LOS\n${formatCaseElapsed(caseElapsed)}\nStarted ${formatCaseClock(caseStatus.start_time, workstation)}\nClick to adjust case start time`}
        onClick={openStartTimeModal}
        ariaLabel="Adjust case start date and time"
        emphasis
      />
    ),
    patient: (
      <HeaderCard
        group="Patient"
        icon={patientCardIcon}
        main={patientName}
        sub1={<><b>HN {caseStatus.hn}</b> · {patientAge} · {patientSex}</>}
        sub2={patient?.an ? <>AN {patient.an}</> : undefined}
        tooltip={`PATIENT\n${patientName}\nHN ${caseStatus.hn}${patient?.an ? ` · AN ${patient.an}` : ""}\n${patientAge} · ${patientSex}\nClick to view or edit patient information`}
        onClick={() => onNavigate?.("patient")}
        ariaLabel="Edit patient information"
      />
    ),
    allergy: (
      <HeaderCard
        group="Allergy"
        count={allergies.length || undefined}
        icon={allergyCardIcon}
        main={allergySummary}
        sub1={allergies.length ? allergies.map(row => [row.reaction, row.severity].filter(Boolean).join(" · ")).filter(Boolean).join(" | ") || "Recorded allergy" : "Review patient allergy"}
        tooltip={allergyTooltip}
        onClick={openAllergyModal}
        ariaLabel="Edit allergy information"
        tone={allergies.length ? "alert" : "default"}
      />
    ),
    diagnosis: (
      <HeaderCard
        group="Diagnosis"
        count={clinicalContext.caseId === caseId ? clinicalContext.diagnosis.length : undefined}
        icon={diagnosisCardIcon}
        main={diagnosisPrimary?.diagnosis_text || (clinicalContext.caseId === caseId ? "Not recorded" : "Loading…")}
        sub1={diagnosisPrimary ? <>{diagnosisPrimary.entry_context === "preoperative" ? "Pre-op" : diagnosisPrimary.entry_context} · {formatCaseClock(diagnosisPrimary.event_ts, workstation)} · {diagnosisPrimary.icd_code || "Local"}</> : undefined}
        sub2={additionalDiagnoses.length ? <><b>2.</b> {additionalDiagnoses[0].diagnosis_text}{additionalDiagnoses.length > 1 ? ` · +${additionalDiagnoses.length - 1} more` : ""}</> : undefined}
        tooltip={diagnosisTooltip}
        onClick={() => onNavigate?.("diagnosis")}
        ariaLabel="Open diagnosis records"
      />
    ),
    operation: (
      <HeaderCard
        group="Operation"
        count={clinicalContext.caseId === caseId ? clinicalContext.operations.length : undefined}
        icon={procedureCardIcon}
        main={operationPrimary?.procedure_text || (clinicalContext.caseId === caseId ? "Not recorded" : "Loading…")}
        sub1={operationPrimary ? <>{operationPrimary.entry_context === "planned" ? "Planned" : "Performed"} · {formatCaseClock(operationPrimary.event_ts, workstation)} · {operationPrimary.icd_code || "Local"}</> : undefined}
        sub2={additionalOperations.length ? <><b>2.</b> {additionalOperations[0].procedure_text}{additionalOperations.length > 1 ? ` · +${additionalOperations.length - 1} more` : ""}</> : undefined}
        tooltip={operationTooltip}
        onClick={() => onNavigate?.("diagnosis")}
        ariaLabel="Open operation records"
      />
    ),
  };

  return (
    <div className={`case-workspace case-workspace--${summaryDock} relative h-full min-h-0 p-2 bg-gray-50 dark:bg-gray-900`}>
      <div className="case-kronos rounded-xl border px-3 py-2 text-xs">
        <div className="case-header-grid">
          {headerCardOrder.map(cardId => (
            <div
              key={cardId}
              className={`case-header-card-slot${draggedHeaderCard === cardId ? " case-header-card-slot--dragging" : ""}`}
              draggable
              tabIndex={0}
              aria-label={`${cardId} summary card. Drag to reorder; Alt plus arrow keys also move it.`}
              onDragStart={event => {
                setDraggedHeaderCard(cardId);
                event.dataTransfer.effectAllowed = "move";
                event.dataTransfer.setData("text/plain", cardId);
              }}
              onDragEnd={() => setDraggedHeaderCard(null)}
              onDragOver={event => {
                event.preventDefault();
                event.dataTransfer.dropEffect = "move";
              }}
              onDrop={event => {
                event.preventDefault();
                const source = (event.dataTransfer.getData("text/plain") || draggedHeaderCard) as CaseHeaderCardId | null;
                if (source && DEFAULT_CASE_HEADER_ORDER.includes(source)) moveHeaderCard(source, cardId);
                setDraggedHeaderCard(null);
              }}
              onKeyDown={event => {
                if (!event.altKey) return;
                if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
                  event.preventDefault();
                  moveHeaderCardByOffset(cardId, -1);
                } else if (event.key === "ArrowRight" || event.key === "ArrowDown") {
                  event.preventDefault();
                  moveHeaderCardByOffset(cardId, 1);
                }
              }}
            >
              {headerCards[cardId]}
            </div>
          ))}
        </div>
      </div>

        <div className="case-kronos__toolbar rounded-xl border px-3 py-2">
          <div className="case-kronos__controls">
          <label className="case-kronos__eyebrow" htmlFor="case-timeline-scale">MINUTE SCALE</label>
          <div className="case-kronos__stepper">
            <button type="button" aria-label="Decrease minute scale" disabled={axisStepMin <= minimumScale} onClick={() => changeScale(axisStepMin - 1)}>−</button>
            <input
              id="case-timeline-scale"
              type="number"
              min={minimumScale}
              max={maximumScale}
              step="1"
              value={scaleDraft}
              onChange={event => setScaleDraft(event.target.value)}
              onBlur={commitScaleDraft}
              onKeyDown={event => {
                if (event.key === "Enter") event.currentTarget.blur();
                if (event.key === "Escape") { setScaleDraft(String(axisStepMin)); event.currentTarget.blur(); }
              }}
            />
            <button type="button" aria-label="Increase minute scale" disabled={axisStepMin >= maximumScale} onClick={() => changeScale(axisStepMin + 1)}>+</button>
          </div>
          <span className="case-kronos__sync" role="status" aria-live="polite">
            {rawTimelineLoading ? "Updating…" : lastSyncedAt ? "Synced" : "Connecting…"}
          </span>
          {!followLatest && caseStatus.status === "ACTIVE" ? (
            <button type="button" className="case-kronos__latest" onClick={() => setFollowLatest(true)}>Back to now</button>
          ) : null}
          </div>

          <div className="case-summary-dock-control inline-flex items-center overflow-visible rounded border border-[var(--app-border)] bg-[var(--app-control-bg)]" aria-label="Case information position">
            <span className="px-2 text-[10px] font-extrabold uppercase tracking-wider text-[var(--app-muted)]">Case Info</span>
            {(["left", "top", "bottom", "right"] as const).map(position => (
              <button
                key={position}
                type="button"
                onClick={() => setSummaryDock(position)}
                aria-pressed={summaryDock === position}
                aria-label={`Place case information at ${position}`}
                data-tooltip={`Case information: ${position}`}
                className={`app-tooltip grid h-8 w-8 place-items-center border-l border-[var(--app-border)] transition-colors ${summaryDock === position ? "bg-[var(--app-accent)] text-[var(--app-accent-contrast)]" : "text-[var(--app-text)] hover:bg-[var(--app-panel-bg)]"}`}
              >
                <SummaryDockIcon position={position} />
              </button>
            ))}
          </div>

          <div className="case-kronos__parameters">
          <button
            type="button"
            onClick={openParameterConfig}
            className="inline-flex min-h-9 items-center gap-2 rounded-lg border border-[var(--app-border)] bg-[var(--app-control-bg)] px-3 py-1.5 text-xs font-semibold text-[var(--app-text)] hover:border-[var(--app-accent)] hover:bg-[var(--app-control-bg-hover)]"
          >
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="M4 7h10M18 7h2M4 17h2M10 17h10M14 4v6M6 14v6" strokeLinecap="round" /></svg>
            Parameters <span className="rounded-full bg-[var(--timegrid-focus-bg)] px-1.5 py-0.5 text-[10px]">{visibleIvyRows.length}</span>
          </button>

          </div>
        </div>

        {quickIoError ? (
          <div className="case-workspace__error w-full text-xs text-red-600 dark:text-red-400">
            {quickIoError}
          </div>
        ) : null}

      <div
        ref={scrollRef}
        onScroll={e => {
          const el = e.currentTarget;
          setScrollLeft(el.scrollLeft);
          setFollowLatest(el.scrollWidth - el.clientWidth - el.scrollLeft < 100);
        }}
        className="case-timeline-scroll
          flex-1 min-h-0
          overflow-auto
          scrollbar-thin
          scrollbar-thumb-gray-400/40
          scrollbar-track-transparent
        "
      >
        <div className="relative min-w-max min-h-full">
          {timelineNowLeft !== null ? (
            <div
              className="timeline-now-rule"
              style={{ left: timelineNowLeft }}
              aria-hidden="true"
            />
          ) : null}
          <ClinicalTimelineAxis axis={axis} nowTs={nowTs} scrollLeft={scrollLeft} viewportWidth={viewportWidth} colWidth={timelineColWidth} labelColWidth={timelineLabelWidth} />
          <div className="case-kronos__entries">
            {renderTimeGrid("events-io")}
          </div>
          <VitalSignsTrendChart
            key={`chart-${scopeUsername}-${parameterMasterLoaded ? "master" : "fallback"}`}
            axis={axis}
            values={values}
            nowTs={nowTs}
            configuredGroups={parameterMasterLoaded ? chartGroups : undefined}
            storageKey={chartVisibilityStorageKey(scopeUsername)}
            preferredVisibleGroups={accountChartGroups || undefined}
            preferredSmartContrast={accountSmartContrast}
            scrollLeft={scrollLeft}
            viewportWidth={viewportWidth}
            colWidth={timelineColWidth}
            labelColWidth={timelineLabelWidth}
            height={compactTimeline ? 170 : 150}
          />
          <div>
            {renderTimeGrid("vitals")}
          </div>
        </div>
      </div>

      {isParamMenuOpen && typeof document !== "undefined"
        ? createPortal(
            <div className="app-theme-scope case-modal-backdrop" onMouseDown={() => setIsParamMenuOpen(false)}>
              <section
                className="case-modal w-full max-w-3xl"
                role="dialog"
                aria-modal="true"
                aria-labelledby="case-parameter-config-title"
                onMouseDown={event => event.stopPropagation()}
              >
                <header className="case-modal__header">
                  <div className="case-modal__identity">
                    <span className="case-modal__icon" aria-hidden="true">
                      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M4 7h10M18 7h2M4 17h2M10 17h10M14 4v6M6 14v6" strokeLinecap="round" /></svg>
                    </span>
                    <div>
                      <div className="case-modal__eyebrow">Timeline table</div>
                      <h2 id="case-parameter-config-title" className="case-modal__title">Visible parameters</h2>
                      <p className="case-modal__context">{ivyRows.length - draftHiddenRowIds.length} of {ivyRows.length} selected</p>
                    </div>
                  </div>
                  <button type="button" className="case-modal__close" onClick={() => setIsParamMenuOpen(false)} aria-label="Close">×</button>
                </header>

                <div className="case-modal__body space-y-3">
                  <div className="flex flex-wrap items-center gap-2">
                    {([ ["all", "All"], ["core", "Vital"], ["measured", "Measured"], ["set", "Set"] ] as const).map(([group, label]) => (
                      <button
                        key={group}
                        type="button"
                        onClick={() => applyDraftVisibilityPreset(group)}
                        className="case-modal__button min-h-9"
                      >
                        {label}
                      </button>
                    ))}
                    <button type="button" onClick={() => setDraftHiddenRowIds(ivyRows.map(row => row.id))} className="case-modal__button min-h-9">None</button>
                    <label className="ml-auto min-w-52 flex-1 sm:max-w-xs">
                      <span className="sr-only">Search parameters</span>
                      <input
                        autoFocus
                        type="search"
                        value={parameterSearch}
                        onChange={event => setParameterSearch(event.target.value)}
                        placeholder="Search parameter, ID or unit"
                        className="h-10 w-full rounded-lg border border-[var(--app-border)] bg-[var(--app-control-bg)] px-3 text-sm text-[var(--app-text)] outline-none focus:border-[var(--app-accent)]"
                      />
                    </label>
                  </div>

                  <div className="grid max-h-[58vh] grid-cols-1 gap-2 overflow-y-auto pr-1 sm:grid-cols-2">
                    {filteredParameterRows.map(row => {
                      const selected = !draftHiddenRowIds.includes(row.id);
                      const rowGroup = getRowGroup(row.id);
                      return (
                        <button
                          key={row.id}
                          type="button"
                          aria-pressed={selected}
                          onClick={() => toggleDraftRowVisibility(row.id)}
                          className={`flex min-h-12 items-center gap-3 rounded-lg border px-3 py-2 text-left transition-colors ${selected ? "border-[var(--app-accent)] bg-[var(--timegrid-focus-bg)] text-[var(--app-text)]" : "border-[var(--app-border)] bg-[var(--app-control-bg)] text-[var(--app-muted)] hover:bg-[var(--app-control-bg-hover)]"}`}
                        >
                          <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded border text-xs font-black ${selected ? "border-[var(--app-accent)] bg-[var(--app-accent)] text-[var(--app-accent-contrast)]" : "border-[var(--app-border)]"}`}>{selected ? "✓" : ""}</span>
                          <span className="min-w-0 flex-1">
                            <strong className="block truncate text-sm">{row.label}</strong>
                            <span className="block truncate text-[10px] text-[var(--app-muted)]">{row.id}{row.unit ? ` · ${row.unit}` : ""}</span>
                          </span>
                          <span className="shrink-0 rounded-full border border-[var(--app-border)] px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-[var(--app-muted)]">{rowGroup}</span>
                        </button>
                      );
                    })}
                    {filteredParameterRows.length === 0 ? <div className="col-span-full rounded-lg border border-dashed border-[var(--app-border)] px-4 py-8 text-center text-sm text-[var(--app-muted)]">No matching parameters</div> : null}
                  </div>

                  <footer className="case-modal__actions">
                    <button type="button" className="case-modal__button" onClick={() => setIsParamMenuOpen(false)}>Cancel</button>
                    <button type="button" className="case-modal__button case-modal__button--primary" onClick={saveParameterVisibility}>Done</button>
                  </footer>
                </div>
              </section>
            </div>,
            document.body,
          )
        : null}

      {ioAddMenuTs != null && typeof document !== "undefined"
        ? createPortal(
            <div className="app-theme-scope io-modal-backdrop" onMouseDown={() => setIoAddMenuTs(null)}>
              <section
                className="case-modal io-modal w-full max-w-xl"
                role="dialog"
                aria-modal="true"
                aria-labelledby="case-add-io-title"
                onMouseDown={event => event.stopPropagation()}
              >
                <header className="case-modal__header">
                  <div className="case-modal__identity">
                    <span className="case-modal__icon" aria-hidden="true">
                      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.9"><path d="M8 3v15m0 0-3-3m3 3 3-3M16 21V6m0 0-3 3m3-3 3 3" strokeLinecap="round" strokeLinejoin="round" /></svg>
                    </span>
                    <div>
                      <div className="case-modal__eyebrow">Timeline entry</div>
                      <h2 id="case-add-io-title" className="case-modal__title">Add I/O</h2>
                      <p className="case-modal__context">{formatDDMMYYYY(ioAddMenuTs)} · {formatHHMM(ioAddMenuTs)} — choose what you want to record.</p>
                    </div>
                  </div>
                  <button type="button" className="case-modal__close" onClick={() => setIoAddMenuTs(null)} aria-label="Close">×</button>
                </header>

                <div className="case-modal__body">
                  {ioModalPatientContext}
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    {[
                      { key: "med", title: "Med bolus", detail: "One-time medication dose", icon: "✚", action: openQuickMed },
                      { key: "drip", title: "Med drip", detail: "Start a medication infusion", icon: "↝", action: openQuickMedDrip },
                      { key: "fluid", title: "Fluid", detail: "Bolus or infusion", icon: "◇", action: openQuickFluid },
                      { key: "blood", title: "Blood product", detail: "Verify and record a bag", icon: "◆", action: openBloodProductWorkflow },
                    ].map(option => (
                      <button
                        key={option.key}
                        type="button"
                        onClick={() => {
                          const selectedTs = ioAddMenuTs;
                          setIoAddMenuTs(null);
                          option.action(selectedTs);
                        }}
                        className="flex min-h-16 items-center gap-3 rounded-xl border border-[var(--app-border)] bg-[var(--app-control-bg)] px-3 py-3 text-left transition hover:border-[var(--app-accent)] hover:bg-[var(--app-control-bg-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--app-accent)]"
                      >
                        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-[var(--timegrid-focus-bg)] text-xl font-black text-[var(--app-accent)]" aria-hidden="true">{option.icon}</span>
                        <span className="min-w-0">
                          <strong className="block text-sm text-[var(--app-text)]">{option.title}</strong>
                          <span className="mt-0.5 block text-[10px] leading-4 text-[var(--app-muted)]">{option.detail}</span>
                        </span>
                      </button>
                    ))}
                    <button
                      type="button"
                      onClick={() => {
                        setIoAddMenuTs(null);
                        onNavigate?.("io");
                      }}
                      className="flex min-h-14 items-center gap-3 rounded-xl border border-[var(--app-border)] bg-[var(--app-control-bg)] px-3 py-3 text-left transition hover:border-[var(--app-accent)] hover:bg-[var(--app-control-bg-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--app-accent)] sm:col-span-2"
                    >
                      <span className="grid h-9 w-10 shrink-0 place-items-center rounded-lg bg-[var(--timegrid-focus-bg)] text-lg font-black text-[var(--app-accent)]" aria-hidden="true">↗</span>
                      <span className="min-w-0 flex-1">
                        <strong className="block text-sm text-[var(--app-text)]">Output or advanced I/O</strong>
                        <span className="mt-0.5 block text-[10px] leading-4 text-[var(--app-muted)]">Open the full I/O workspace for urine, blood loss, and detailed configuration.</span>
                      </span>
                      <span className="text-lg text-[var(--app-muted)]" aria-hidden="true">›</span>
                    </button>
                  </div>
                </div>
              </section>
            </div>,
            document.body,
          )
        : null}

      {allergyModalOpen && typeof document !== "undefined"
        ? createPortal(
            <div
              className="app-theme-scope case-modal-backdrop"
              onMouseDown={() => !allergySaving && setAllergyModalOpen(false)}
            >
              <section
                className="case-modal case-modal--allergy"
                role="dialog"
                aria-modal="true"
                aria-labelledby="case-allergy-title"
                onMouseDown={event => event.stopPropagation()}
              >
                <header className="case-modal__header">
                  <div className="case-modal__identity">
                    <span className="case-modal__icon case-modal__icon--danger" aria-hidden="true">!</span>
                    <div>
                      <div className="case-modal__eyebrow">Patient safety</div>
                      <h2 id="case-allergy-title" className="case-modal__title">Allergy</h2>
                      <p className="case-modal__context">{patientName} · HN {caseStatus.hn}</p>
                    </div>
                  </div>
                  <button type="button" className="case-modal__close" onClick={() => setAllergyModalOpen(false)} aria-label="Close">×</button>
                </header>

                <div className="case-modal__body">
                  <div className="allergy-record-list">
                    {allergies.length === 0 ? (
                      <div className="allergy-empty">
                        <span>No allergy recorded</span>
                        <small>Confirm the history or add an allergy below.</small>
                      </div>
                    ) : allergies.map(row => (
                      <article key={row.id} className={`allergy-record${allergyEditingId === String(row.id) ? " allergy-record--active" : ""}`}>
                        <button type="button" className="allergy-record__content" onClick={() => editAllergy(row)}>
                          <strong>{row.allergen}</strong>
                          <span>{[row.reaction, row.severity].filter(Boolean).join(" · ") || "Reaction not recorded"}</span>
                        </button>
                        <div className="allergy-record__meta">
                          <span>{row.source || "Manual"}</span>
                          {allergyDeleteId === String(row.id) ? (
                            <div className="allergy-record__confirm">
                              <button type="button" onClick={() => setAllergyDeleteId(null)}>Keep</button>
                              <button type="button" className="danger" onClick={() => void removeAllergy()} disabled={allergySaving}>Remove</button>
                            </div>
                          ) : (
                            <button type="button" className="allergy-record__remove" onClick={() => setAllergyDeleteId(String(row.id))}>Remove</button>
                          )}
                        </div>
                      </article>
                    ))}
                  </div>

                  <form className="allergy-editor" onSubmit={event => { event.preventDefault(); void saveAllergy(); }}>
                    <div className="allergy-editor__heading">
                      <strong>{allergyEditingId ? "Edit allergy" : "Add allergy"}</strong>
                      {allergyEditingId ? <button type="button" onClick={resetAllergyEditor}>New entry</button> : null}
                    </div>
                    <div className="allergy-editor__grid">
                      <label className="case-modal__field allergy-editor__allergen">
                        <span>Allergen</span>
                        <input autoFocus value={allergyDraft.allergen} onChange={event => setAllergyDraft(previous => ({ ...previous, allergen: event.target.value }))} placeholder="e.g. Penicillin" />
                      </label>
                      <label className="case-modal__field">
                        <span>Reaction</span>
                        <input value={allergyDraft.reaction} onChange={event => setAllergyDraft(previous => ({ ...previous, reaction: event.target.value }))} placeholder="e.g. Urticaria" />
                      </label>
                    </div>
                    <fieldset className="allergy-severity">
                      <legend>Severity</legend>
                      <div>
                        {["Mild", "Moderate", "Severe", "Unknown"].map(level => (
                          <button
                            key={level}
                            type="button"
                            aria-pressed={allergyDraft.severity === level}
                            onClick={() => setAllergyDraft(previous => ({ ...previous, severity: level }))}
                          >
                            {level}
                          </button>
                        ))}
                      </div>
                    </fieldset>
                    {allergyError ? <p className="case-modal__error">{allergyError}</p> : null}
                    <footer className="case-modal__actions">
                      <button type="button" className="case-modal__button" onClick={() => setAllergyModalOpen(false)}>Close</button>
                      <button type="submit" className="case-modal__button case-modal__button--primary" disabled={allergySaving || !allergyDraft.allergen.trim()}>
                        {allergySaving ? "Saving…" : allergyEditingId ? "Update allergy" : "Add allergy"}
                      </button>
                    </footer>
                  </form>
                </div>
              </section>
            </div>,
            document.body,
          )
        : null}

      {startTimeModalOpen && typeof document !== "undefined"
        ? createPortal(
            <div className="app-theme-scope case-modal-backdrop" onMouseDown={() => !startTimeSaving && setStartTimeModalOpen(false)}>
              <form
                className="case-modal max-w-md"
                onMouseDown={event => event.stopPropagation()}
                onSubmit={event => { event.preventDefault(); void saveStartTime(); }}
              >
                <header className="case-modal__header">
                  <div className="case-modal__identity"><span className="case-modal__icon" aria-hidden="true">↺</span><div><div className="case-modal__eyebrow">Case timeline</div><h2 className="case-modal__title">Adjust start time</h2><p className="case-modal__context">All timeline entries remain at their recorded time.</p></div></div>
                  <button type="button" className="case-modal__close" onClick={() => setStartTimeModalOpen(false)} aria-label="Close">×</button>
                </header>
                <div className="case-modal__body">
                <div className="grid grid-cols-[minmax(0,1fr)_8rem] gap-3 max-[520px]:grid-cols-1">
                  <label className="case-modal__field">Date
                    <input autoFocus value={startDateDraft} onChange={event => setStartDateDraft(formatDateInputDDMMYYYY(event.target.value))} placeholder="DD/MM/YYYY" maxLength={10} />
                  </label>
                  <label className="case-modal__field">Time
                    <input value={startTimeDraft} onChange={event => setStartTimeDraft(formatTimeInputHHMM(event.target.value))} placeholder="HH:mm" maxLength={5} />
                  </label>
                </div>
                {startTimeError ? <p className="case-modal__error">{startTimeError}</p> : null}
                <footer className="case-modal__actions">
                  <button type="button" className="case-modal__button" onClick={() => setStartTimeModalOpen(false)}>Cancel</button>
                  <button type="submit" disabled={startTimeSaving} className="case-modal__button case-modal__button--primary">{startTimeSaving ? "Saving…" : "Save change"}</button>
                </footer>
                </div>
              </form>
            </div>,
            document.body,
          )
        : null}

      {eventModalTs != null && typeof document !== "undefined"
        ? createPortal(
            <div
              className="app-theme-scope case-modal-backdrop"
              onMouseDown={closeEventModal}
            >
              <div
                ref={eventModalRef}
                tabIndex={-1}
                className="case-modal case-modal--event"
                onMouseDown={e => e.stopPropagation()}
                onKeyDown={handleEventModalKeyDown}
              >
                <header className="case-modal__header">
                  <div className="case-modal__identity"><span className="case-modal__icon" aria-hidden="true">+</span><div><div className="case-modal__eyebrow">Clinical timeline</div><h2 className="case-modal__title">{eventModalEditingId != null ? "Edit entry" : "Add entry"}</h2><p className="case-modal__context">Record an event or clinical note at {eventModalTime}</p></div></div>
                  <button type="button" className="case-modal__close" onClick={closeEventModal} aria-label="Close">×</button>
                </header>
                <div className="case-modal__body space-y-3">
                <div className="grid grid-cols-[90px_1fr] items-center gap-2">
                  <label className="text-xs text-[var(--app-muted)]">Time</label>
                  <input
                    value={eventModalTime}
                    onChange={e => setEventModalTime(formatTimeInputHHMM(e.target.value))}
                    onBlur={e => {
                      const normalized = normalizeHHMM(e.target.value);
                      if (normalized) setEventModalTime(normalized);
                    }}
                    className="rounded border px-2 py-1.5 text-sm"
                    placeholder="HH:mm"
                    maxLength={5}
                  />
                </div>
                <div className="grid grid-cols-[90px_1fr] items-center gap-2">
                  <label className="text-xs text-[var(--app-muted)]">Mode</label>
                  {eventModalEditingId != null ? (
                    <div className="rounded border border-[var(--app-border)] bg-[var(--app-control-bg)] px-3 py-2 text-sm">
                      {eventModalMode === "event" ? "Event" : "Note"}
                    </div>
                  ) : (
                    <div className="inline-flex overflow-hidden rounded border border-[var(--app-border)]">
                      <button
                        type="button"
                        onClick={() => setEventModalMode("event")}
                        className={`px-3 py-1.5 text-sm ${
                          eventModalMode === "event"
                            ? "bg-[var(--app-accent)] text-[var(--app-accent-contrast)]"
                            : "bg-[var(--app-control-bg)] text-[var(--app-text)] hover:bg-[var(--app-control-bg-hover)]"
                        }`}
                      >
                        Event
                      </button>
                      <button
                        type="button"
                        onClick={() => setEventModalMode("note")}
                        className={`px-3 py-1.5 text-sm ${
                          eventModalMode === "note"
                            ? "bg-[var(--app-accent)] text-[var(--app-accent-contrast)]"
                            : "bg-[var(--app-control-bg)] text-[var(--app-text)] hover:bg-[var(--app-control-bg-hover)]"
                        }`}
                      >
                        Note
                      </button>
                    </div>
                  )}
                </div>
                {eventModalMode === "event" ? (
                  <div className="grid grid-cols-[90px_1fr] items-start gap-2">
                    <label className="pt-1 text-xs text-[var(--app-muted)]">Event</label>
                    {eventModalEditingId != null ? (
                      <div className="rounded border border-[var(--app-border)] bg-[var(--app-control-bg)] px-3 py-2">
                        <div className="flex items-center gap-2 text-sm font-medium">
                          {(() => {
                            const EventIcon = getEventIconByTitle(eventModalEventTitle);
                            return EventIcon
                              ? <EventIcon className="h-5 w-5" />
                              : <span className="text-lg leading-none">*</span>;
                          })()}
                          <span>{eventModalEventTitle}</span>
                        </div>
                      </div>
                    ) : (
                      <div className="grid max-h-[46vh] grid-cols-2 gap-2 overflow-y-auto pr-1 sm:grid-cols-3 lg:grid-cols-4">
                        {MANUAL_EVENT_BUTTON_LAYOUT.map(option => {
                          const disabledByAvailability =
                            Boolean(eventModalAvailability[option.title]?.disabled);
                          const disabled = disabledByAvailability;
                          const selected = eventModalEventTitle === option.title;
                          const OptionIcon = option.icon;
                          return (
                            <button
                              key={option.title}
                              type="button"
                              onClick={() => setEventModalEventTitle(option.title)}
                              disabled={disabled}
                              className={`rounded border px-3 py-2 text-center text-sm leading-tight ${
                                selected
                                  ? "border-[var(--app-accent)] bg-[var(--timegrid-focus-bg)] text-[var(--app-text)]"
                                  : "border-[var(--app-border)] bg-[var(--app-control-bg)] text-[var(--app-text)]"
                              } ${disabled ? "opacity-50 cursor-not-allowed" : "hover:bg-[var(--app-control-bg-hover)]"}`}
                              title={option.title}
                            >
                              <div className="mx-auto mb-1 flex h-9 w-9 items-center justify-center">
                                <OptionIcon className="h-9 w-9" />
                              </div>
                              <div>{option.shortLabel}</div>
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="grid grid-cols-[90px_1fr] items-center gap-2">
                    <label className="text-xs text-gray-600 dark:text-gray-300">Title</label>
                    <input
                      autoFocus
                      value={eventModalNoteTitle}
                      onChange={e => setEventModalNoteTitle(e.target.value)}
                      className="rounded border px-2 py-1.5 text-sm"
                      placeholder="Event note title"
                    />
                  </div>
                )}
                {eventModalMode === "event" &&
                eventModalEditingId == null &&
                (isAutoEventTitle(eventModalEventTitle) ||
                  eventModalAvailability[eventModalEventTitle]?.disabled) ? (
                  <div className="text-xs text-amber-600 dark:text-amber-400">
                    {isAutoEventTitle(eventModalEventTitle)
                      ? "This event is auto from Fluid&Med entries"
                      : eventModalAvailability[eventModalEventTitle]?.reason}
                  </div>
                ) : null}
                <div className="grid grid-cols-[90px_1fr] items-start gap-2">
                  <label className="pt-1 text-xs text-[var(--app-muted)]">Detail</label>
                  <textarea
                    value={eventModalDetail}
                    onChange={e => setEventModalDetail(e.target.value)}
                    className="rounded border px-2 py-1.5 text-sm min-h-[72px]"
                    placeholder="Optional detail"
                  />
                </div>
                {eventModalError ? (
                  <div className="text-xs text-red-600 dark:text-red-400">{eventModalError}</div>
                ) : null}
                <div className="case-modal__actions">
                  <button
                    type="button"
                    onClick={closeEventModal}
                    className="rounded border px-3 py-1.5 text-sm"
                    disabled={eventModalSaving || eventModalDeleting}
                  >
                    Cancel
                  </button>
                  {eventModalEditingId != null ? (
                    <button
                      type="button"
                      onClick={() => void clearEventModal()}
                      className={`rounded px-3 py-1.5 text-sm text-white ${
                        eventModalSaving || eventModalDeleting
                          ? "bg-gray-400"
                          : "bg-red-600 hover:bg-red-700"
                      }`}
                      disabled={eventModalSaving || eventModalDeleting}
                    >
                      {eventModalDeleting ? "Clearing..." : "Clear"}
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => void saveEventModal()}
                    className={`rounded px-3 py-1.5 text-sm text-white ${
                      eventModalSaving ||
                      eventModalDeleting ||
                      (eventModalEditingId == null &&
                      (eventModalMode === "event" &&
                        (isAutoEventTitle(eventModalEventTitle) ||
                          eventModalAvailability[eventModalEventTitle]?.disabled)))
                        ? "bg-gray-400"
                        : "bg-blue-600 hover:bg-blue-700"
                    }`}
                    disabled={
                      eventModalSaving ||
                      eventModalDeleting ||
                      (eventModalEditingId == null &&
                      (eventModalMode === "event" &&
                        (isAutoEventTitle(eventModalEventTitle) ||
                          Boolean(eventModalAvailability[eventModalEventTitle]?.disabled))))
                    }
                    >
                      {eventModalSaving ? "Saving..." : "Save"}
                    </button>
                </div>
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}

      {quickMedOpen && typeof document !== "undefined"
        ? createPortal(
            <div
              className="app-theme-scope io-modal-backdrop"
              onMouseDown={closeQuickMed}
            >
              <div
                className="io-modal w-full max-w-2xl p-4 space-y-3"
                role="dialog"
                aria-modal="true"
                onMouseDown={e => e.stopPropagation()}
                onKeyDown={handleQuickMedKeyDown}
              >
                {ioModalPatientContext}

                <div className="flex items-start justify-between gap-3">
                  <div className="space-y-1">
                    <div className="text-sm font-semibold leading-none">Medication bolus</div>
                    <div className="flex items-center gap-2">
                      <span className="text-base font-medium leading-none">
                        {selectedQuickMedItem?.name || "Medication"}
                      </span>
                      <span className="rounded px-1.5 py-0.5 text-[10px] font-bold bg-blue-600/20 text-blue-400 leading-none">
                        Bolus
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={closeQuickMed}
                      className="rounded border px-3 py-1.5 text-sm"
                      disabled={quickMedSaving}
                    >
                      Close
                    </button>
                  </div>
                </div>

                <div className="space-y-3 py-2">
                  <div className="grid grid-cols-[100px_1fr] gap-2 items-center">
                    <label className="text-sm text-[var(--app-muted)] font-medium">Drug</label>
                    <div className="relative">
                      <input
                        ref={quickMedSearchRef}
                        className="rounded border border-[var(--app-border)] bg-[var(--app-control-bg)] px-2 py-1.5 text-sm w-full"
                        value={quickMedSearch}
                        onChange={e => {
                          const nextValue = e.target.value;
                          setQuickMedSearch(nextValue);
                          setQuickMedItemId(null);
                          setQuickMedManualMode(false);
                          setQuickMedManualCategory("");
                          setShowQuickMedDropdown(normalizeToken(nextValue).length >= 2);
                        }}
                        onFocus={() => {
                          if (normalizeToken(quickMedSearch).length >= 2) {
                            setShowQuickMedDropdown(true);
                          }
                        }}
                        onKeyDown={e => {
                          const firstMatch = quickMedMatches[0];
                          if (!firstMatch) return;
                          if (e.key === "Tab" && !e.shiftKey && showQuickMedDropdown) {
                            e.preventDefault();
                            applyQuickMedSelection(firstMatch, true);
                            return;
                          }
                          if (e.key === "Enter" && showQuickMedDropdown) {
                            e.preventDefault();
                            applyQuickMedSelection(firstMatch, true);
                          }
                        }}
                        placeholder="Search drug name..."
                        autoComplete="off"
                      />
                      {showQuickMedDropdown ? (
                        <>
                          <div
                            className="fixed inset-0 z-0"
                            onClick={() => setShowQuickMedDropdown(false)}
                          />
                          <div className="absolute z-10 w-full mt-1 max-h-60 overflow-y-auto rounded border border-[var(--app-border)] bg-[var(--app-panel-bg)] shadow-lg">
                            {quickMedMatches.length > 0 ? (
                              quickMedMatches.map(item => (
                                <button
                                  key={`quick-med-${item.id}`}
                                  type="button"
                                  className="w-full text-left px-3 py-2 text-sm hover:bg-white/[0.04] border-b border-[var(--app-border)] last:border-0"
                                  onClick={() => applyQuickMedSelection(item, true)}
                                >
                                  <div className="font-medium">{item.name}</div>
                                  <div className="flex justify-between text-xs text-[var(--app-muted)]">
                                    <span>{quickMedGroupLabel(item)}</span>
                                    <span>{item.default_unit || "mg"}</span>
                                  </div>
                                </button>
                              ))
                            ) : (
                              <div className="p-3 text-sm text-[var(--app-muted)] italic">
                                No exact matches found
                              </div>
                            )}
                          </div>
                        </>
                      ) : null}
                    </div>
                  </div>

                  {selectedQuickMedItem == null && quickMedFluidMatches.length > 0 ? (
                    <div className="ml-[108px] rounded border border-orange-500/40 bg-orange-500/10 px-3 py-2 text-sm space-y-2">
                      <div className="font-medium text-orange-100">This looks like a fluid</div>
                      <div className="text-xs text-[var(--app-muted)]">
                        If you are charting fluid like Acetar, it is better to use the Fluid entry form instead of Medication Bolus.
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {quickMedFluidMatches.map(item => (
                          <button
                            key={`quick-med-fluid-${item.id}`}
                            type="button"
                            onClick={() => openQuickFluidFromSuggestion(item)}
                            className="rounded border border-orange-400/50 px-3 py-1.5 text-sm text-orange-100 hover:bg-orange-400/10"
                          >
                            Use Fluid: {item.name}
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : null}

                  {selectedQuickMedItem == null && quickMedFuzzyMatches.length > 0 ? (
                    <div className="ml-[108px] rounded border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm space-y-2">
                      <div className="font-medium text-amber-200">Did you mean one of these?</div>
                      <div className="flex flex-wrap gap-2">
                        {quickMedFuzzyMatches.map(item => (
                          <button
                            key={`quick-med-fuzzy-${item.id}`}
                            type="button"
                            onClick={() => applyQuickMedSelection(item, true)}
                            className="rounded border border-amber-400/50 px-3 py-1.5 text-sm text-amber-100 hover:bg-amber-400/10"
                          >
                            Use {item.name}
                          </button>
                        ))}
                      </div>
                      <button
                        type="button"
                        onClick={() => setQuickMedManualMode(true)}
                        className="rounded border border-amber-400/50 bg-amber-500/15 px-3 py-1.5 text-xs font-medium text-amber-100 hover:bg-amber-500/25"
                      >
                        Use Manual Input
                      </button>
                    </div>
                  ) : null}

                  {selectedQuickMedItem == null && quickMedNeedsManualFallback ? (
                    <div className="ml-[108px] rounded border border-[var(--app-border)] bg-black/5 dark:bg-white/[0.03] px-3 py-2 text-sm space-y-2">
                      <div className="font-medium">Can&apos;t find this drug in library</div>
                      <div className="text-xs text-[var(--app-muted)]">
                        Use a temporary manual entry for this case only. It will not appear in the normal active library.
                      </div>
                      {!quickMedManualMode ? (
                        <button
                          type="button"
                          onClick={() => setQuickMedManualMode(true)}
                          className="rounded border border-amber-400/50 bg-amber-500/15 px-3 py-1.5 text-sm font-medium text-amber-100 hover:bg-amber-500/25"
                        >
                          Use Manual Input
                        </button>
                      ) : null}
                    </div>
                  ) : null}

                  {quickMedManualMode ? (
                    <div className="ml-[108px] rounded border border-cyan-500/35 bg-cyan-500/10 px-3 py-3 space-y-3">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium">Case-only manual drug</span>
                          <span className="rounded px-1.5 py-0.5 text-[10px] font-bold leading-none bg-cyan-500/20 text-cyan-200">
                            Manual
                          </span>
                        </div>
                        <div className="text-xs text-[var(--app-muted)]">
                          We will save this drug for the current case only and keep it out of the active library.
                        </div>
                      </div>
                      <div className="grid grid-cols-[100px_1fr] gap-2 items-center">
                        <label className="text-sm text-[var(--app-muted)] font-medium">Name</label>
                        <div className="rounded border border-[var(--app-border)] bg-[var(--app-control-bg)] px-2 py-1.5 text-sm">
                          {quickMedSearch.trim() || "-"}
                        </div>
                      </div>
                      <div className="grid grid-cols-[100px_1fr] gap-2 items-center">
                        <label className="text-sm text-[var(--app-muted)] font-medium">Group</label>
                        <select
                          className="rounded border border-[var(--app-border)] bg-[var(--app-control-bg)] px-2 py-1.5 text-sm"
                          value={quickMedManualCategory}
                          onChange={e => setQuickMedManualCategory(e.target.value)}
                        >
                          <option value="">Select group</option>
                          {quickMedCategoryOptions.map(option => (
                            <option key={`quick-med-manual-category-${option.value}`} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                  ) : null}

                  <div className="grid grid-cols-[100px_1fr_120px] gap-2 items-center">
                    <label className="text-sm text-[var(--app-muted)] font-medium">Time</label>
                      <input
                        value={quickMedDate}
                      onChange={e => setQuickMedDate(formatDateInputDDMMYYYY(e.target.value))}
                      onBlur={e => {
                        const normalized = normalizeDDMMYYYY(e.target.value);
                        if (normalized) setQuickMedDate(normalized);
                      }}
                      className="rounded border border-[var(--app-border)] bg-[var(--app-control-bg)] px-2 py-1.5 text-sm"
                      placeholder="dd/mm/yyyy"
                    />
                      <input
                        ref={quickMedTimeRef}
                        value={quickMedTime}
                      onChange={e => setQuickMedTime(formatTimeInputHHMM(e.target.value))}
                      onBlur={e => {
                        const normalized = normalizeHHMM(e.target.value);
                        if (normalized) setQuickMedTime(normalized);
                      }}
                      className="rounded border border-[var(--app-border)] bg-[var(--app-control-bg)] px-2 py-1.5 text-sm"
                      placeholder="HH:mm"
                      maxLength={5}
                    />
                  </div>

                  {quickMedIsLocalAnesthetic ? (
                    <>
                      <div className="grid grid-cols-[100px_1fr_100px] gap-2 items-center">
                        <label className="text-sm text-[var(--app-muted)] font-medium">Conc. %</label>
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          autoFocus
                          className="rounded border border-[var(--app-border)] bg-[var(--app-control-bg)] px-2 py-1.5 text-sm"
                          placeholder="%"
                          value={quickMedLocalConcentration}
                          onChange={e => setQuickMedLocalConcentration(e.target.value)}
                        />
                        <div className="rounded border border-[var(--app-border)] bg-[var(--app-control-bg)] px-2 py-1.5 text-sm text-center">
                          mg/mL
                        </div>
                      </div>

                      <div className="grid grid-cols-[100px_1fr_100px] gap-2 items-center">
                        <label className="text-sm text-[var(--app-muted)] font-medium">Volume</label>
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          className="rounded border border-[var(--app-border)] bg-[var(--app-control-bg)] px-2 py-1.5 text-sm"
                          placeholder="0.00"
                          value={quickMedLocalVolumeMl}
                          onChange={e => setQuickMedLocalVolumeMl(e.target.value)}
                        />
                        <div className="rounded border border-[var(--app-border)] bg-[var(--app-control-bg)] px-2 py-1.5 text-sm text-center">
                          mL
                        </div>
                      </div>
                    </>
                  ) : (
                    <div className="grid grid-cols-[100px_1fr] gap-2 items-center">
                      <label className="text-sm text-[var(--app-muted)] font-medium">Dose</label>
                      <div className="flex items-center gap-2">
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          autoFocus
                          className="rounded border border-[var(--app-border)] bg-[var(--app-control-bg)] px-2 py-1.5 text-sm flex-1"
                          placeholder="0.00"
                          value={quickMedDose}
                          onChange={e => setQuickMedDose(e.target.value)}
                        />
                        <select
                          className="px-2 py-1.5 text-sm bg-black/5 dark:bg-white/5 rounded min-w-[80px] text-center border border-[var(--app-border)]"
                          value={quickMedUnit}
                          onChange={e => setQuickMedUnit(e.target.value)}
                        >
                          {CASEVIEW_UOM_OPTIONS.map(unit => (
                            <option key={`quick-med-unit-${unit}`} value={unit}>
                              {unit}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                  )}

                  <div className="grid grid-cols-[100px_1fr] gap-2 items-center">
                    <label className="text-sm text-[var(--app-muted)] font-medium">Note</label>
                    <input
                      type="text"
                      className="rounded border border-[var(--app-border)] bg-[var(--app-control-bg)] px-2 py-1.5 text-sm w-full"
                      placeholder="Optional note"
                      value={quickMedNote}
                      onChange={e => setQuickMedNote(e.target.value)}
                    />
                  </div>

                  <div className="grid grid-cols-[100px_1fr] gap-2 items-center">
                    <label className="text-sm text-[var(--app-muted)] font-medium">Route</label>
                    <select
                      className="rounded border border-[var(--app-border)] bg-[var(--app-control-bg)] px-2 py-1.5 text-sm w-full"
                      value={quickMedRoute}
                      onChange={e => setQuickMedRoute(e.target.value)}
                    >
                      {CASEVIEW_ROUTE_OPTIONS.map(route => (
                        <option key={`quick-med-route-${route}`} value={route}>
                          {route}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="text-xs text-[var(--app-muted)] pl-[108px]">
                    {quickMedIsLocalAnesthetic
                      ? "Leave concentration and volume empty to add the medication row only"
                      : "Leave dose empty to add the medication row only"}
                  </div>
                </div>

                {quickMedError ? (
                  <div className="text-xs text-red-600 dark:text-red-400 px-1">{quickMedError}</div>
                ) : null}

                <div className="flex justify-end gap-2 pt-3 border-t border-[var(--app-border)]">
                  <button
                    type="button"
                    onClick={closeQuickMed}
                    className="rounded border px-3 py-1.5 text-sm"
                    disabled={quickMedSaving}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={clearQuickMed}
                    className="rounded border px-3 py-1.5 text-sm"
                    disabled={quickMedSaving}
                  >
                    Clear
                  </button>
                  <button
                    type="button"
                    onClick={() => void saveQuickMed()}
                    className={`rounded px-3 py-1.5 text-sm text-white ${
                      quickMedSaving ? "bg-gray-400" : "bg-blue-600 hover:bg-blue-700"
                    }`}
                    disabled={!quickMedCanSave}
                  >
                    {quickMedSaving ? "Saving..." : "Save"}
                  </button>
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}

      {quickMedDripOpen && typeof document !== "undefined"
        ? createPortal(
            <div
              className="app-theme-scope io-modal-backdrop"
              onMouseDown={closeQuickMedDrip}
            >
              <div
                className="io-modal w-full max-w-3xl p-4 space-y-3"
                role="dialog"
                aria-modal="true"
                onMouseDown={e => e.stopPropagation()}
                onKeyDown={handleQuickMedDripKeyDown}
              >
                {ioModalPatientContext}
                <div className="flex items-start justify-between gap-3">
                  <div className="space-y-1">
                    <div className="text-sm font-semibold leading-none">Medication drip</div>
                    <div className="flex items-center gap-2">
                      <span className="text-xl font-bold leading-none">
                        {selectedQuickMedDripItem?.name || quickMedDripSearch.trim() || "Select medication"}
                      </span>
                      <span className="rounded px-1.5 py-0.5 text-[10px] font-bold leading-none bg-violet-500/20 text-violet-300">
                        Drip
                      </span>
                    </div>
                    <div className="text-xs text-[var(--app-muted)]">
                      {quickMedDripEditTarget
                        ? "Adjust the running medication drip using the same workflow."
                        : "Search medication, set start time, and begin the infusion now."}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={closeQuickMedDrip}
                    className="rounded border px-3 py-1.5 text-sm"
                    disabled={quickMedDripSaving || quickMedDripStopping}
                  >
                    Close
                  </button>
                </div>

                {quickMedDripEditTarget == null && selectedQuickMedDripItem == null && !quickMedDripManualMode && popularQuickMedDripItems.length > 0 ? (
                  <div className="grid grid-cols-[110px_1fr] items-start gap-2">
                    <span className="pt-1.5 text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--app-muted)]">Popular</span>
                    <div className="flex flex-wrap gap-2">
                      {popularQuickMedDripItems.map(item => (
                        <button
                          key={`popular-quick-med-drip-${item.id}`}
                          type="button"
                          onClick={() => applyQuickMedDripSelection(item, true)}
                          className="rounded-lg border border-[var(--app-border)] bg-[var(--app-panel-bg)] px-3 py-1.5 text-xs font-semibold text-[var(--app-text)] hover:bg-[var(--app-hover-bg)]"
                        >
                          {item.name}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}

                {quickMedDripEditTarget == null && selectedQuickMedDripItem == null && quickMedDripFluidMatches.length > 0 ? (
                  <div className="rounded border border-orange-500/40 bg-orange-500/10 px-3 py-2 text-sm space-y-2">
                    <div className="font-medium text-orange-100">This looks like a fluid</div>
                    <div className="text-xs text-[var(--app-muted)]">
                      If you are charting fluid like Acetar, it is better to use the Fluid entry form instead of Medication Drip.
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {quickMedDripFluidMatches.map(item => (
                        <button
                          key={`quick-med-drip-fluid-${item.id}`}
                          type="button"
                          onClick={() => openQuickFluidFromSuggestion(item)}
                          className="rounded border border-orange-400/50 px-3 py-1.5 text-sm text-orange-100 hover:bg-orange-400/10"
                        >
                          Use Fluid: {item.name}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}

                {quickMedDripEditTarget == null && selectedQuickMedDripItem == null && quickMedDripFuzzyMatches.length > 0 ? (
                  <div className="rounded border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm space-y-2">
                    <div className="font-medium text-amber-200">Did you mean one of these?</div>
                    <div className="flex flex-wrap gap-2">
                      {quickMedDripFuzzyMatches.map(item => (
                        <button
                          key={`quick-med-drip-fuzzy-${item.id}`}
                          type="button"
                          onClick={() => applyQuickMedDripSelection(item, true)}
                          className="rounded border border-amber-400/50 px-3 py-1.5 text-sm text-amber-100 hover:bg-amber-400/10"
                        >
                          Use {item.name}
                        </button>
                      ))}
                    </div>
                    <button
                      type="button"
                      onClick={() => setQuickMedDripManualMode(true)}
                      className="rounded border border-amber-400/50 bg-amber-500/15 px-3 py-1.5 text-xs font-medium text-amber-100 hover:bg-amber-500/25"
                    >
                      Use Manual Input
                    </button>
                  </div>
                ) : null}

                {quickMedDripEditTarget == null && selectedQuickMedDripItem == null && quickMedDripNeedsManualFallback ? (
                  <div className="rounded border border-[var(--app-border)] bg-black/5 dark:bg-white/[0.03] px-3 py-2 text-sm space-y-2">
                    <div className="font-medium">Can&apos;t find this drug in library</div>
                    <div className="text-xs text-[var(--app-muted)]">
                      Use a temporary manual entry for this case only. It will not appear in the normal active library.
                    </div>
                    {!quickMedDripManualMode ? (
                      <button
                        type="button"
                        onClick={() => setQuickMedDripManualMode(true)}
                        className="rounded border border-amber-400/50 bg-amber-500/15 px-3 py-1.5 text-sm font-medium text-amber-100 hover:bg-amber-500/25"
                      >
                        Use Manual Input
                      </button>
                    ) : null}
                  </div>
                ) : null}

                {quickMedDripEditTarget == null && quickMedDripManualMode ? (
                  <div className="rounded border border-cyan-500/35 bg-cyan-500/10 px-3 py-3 space-y-3">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium">Case-only manual drug</span>
                        <span className="rounded px-1.5 py-0.5 text-[10px] font-bold leading-none bg-cyan-500/20 text-cyan-200">
                          Manual
                        </span>
                      </div>
                      <div className="text-xs text-[var(--app-muted)]">
                        We will save this drug for the current case only and keep it out of the active library.
                      </div>
                    </div>
                    <div className="grid grid-cols-[110px_1fr] gap-2 items-center text-sm">
                      <label className="text-[var(--app-muted)]">Name</label>
                      <div className="rounded border border-[var(--app-border)] bg-[var(--app-control-bg)] px-2 py-1.5">
                        {quickMedDripSearch.trim() || "-"}
                      </div>
                    </div>
                    <div className="grid grid-cols-[110px_1fr] gap-2 items-center text-sm">
                      <label className="text-[var(--app-muted)]">Group</label>
                      <select
                        className="rounded border border-[var(--app-border)] bg-[var(--app-control-bg)] px-2 py-1.5"
                        value={quickMedDripManualCategory}
                        onChange={e => setQuickMedDripManualCategory(e.target.value)}
                      >
                        <option value="">Select group</option>
                        {quickMedCategoryOptions.map(option => (
                          <option key={`quick-med-drip-manual-category-${option.value}`} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                ) : null}

                <div className="grid grid-cols-[110px_1fr_120px] gap-2 items-center text-sm">
                  <label className="text-[var(--app-muted)]">Group</label>
                  <div className="rounded border border-[var(--app-border)] bg-[var(--app-control-bg)] px-2 py-1.5">
                    {selectedQuickMedDripGroupLabel}
                  </div>
                  <div className="rounded border border-[var(--app-border)] bg-[var(--app-control-bg)] px-2 py-1.5 text-center">
                    {quickMedDripRoute}
                  </div>
                </div>

                <div className="relative">
                  <input
                    ref={quickMedDripSearchRef}
                    autoFocus
                    className="w-full rounded border px-3 py-2 text-sm"
                    placeholder="Search drug name..."
                    value={quickMedDripSearch}
                    readOnly={quickMedDripEditTarget != null}
                    onChange={e => {
                      setQuickMedDripSearch(e.target.value);
                      setQuickMedDripItemId(null);
                      setQuickMedDripManualMode(false);
                      setQuickMedDripManualCategory("");
                      setShowQuickMedDripDropdown(normalizeToken(e.target.value).length >= 2);
                    }}
                    onFocus={() => {
                      if (
                        quickMedDripEditTarget == null &&
                        quickMedDripItemId == null &&
                        normalizeToken(quickMedDripSearch).length >= 2
                      ) {
                        setShowQuickMedDripDropdown(true);
                      }
                    }}
                    onKeyDown={e => {
                      if (
                        quickMedDripEditTarget == null &&
                        showQuickMedDripDropdown &&
                        quickMedDripMatches.length > 0 &&
                        (e.key === "Enter" || (e.key === "Tab" && !e.shiftKey))
                      ) {
                        e.preventDefault();
                        if (e.key === "Enter" || quickMedDripMatches.length === 1) {
                          applyQuickMedDripSelection(quickMedDripMatches[0], true);
                        } else {
                          quickMedDripOptionRefs.current[0]?.focus();
                        }
                      }
                    }}
                  />
                  {showQuickMedDripDropdown && quickMedDripEditTarget == null && normalizeToken(quickMedDripSearch).length >= 2 ? (
                    <>
                      <div
                        className="fixed inset-0 z-0"
                        onMouseDown={() => setShowQuickMedDripDropdown(false)}
                      />
                      <div className="absolute z-10 mt-1 max-h-56 w-full overflow-y-auto rounded border border-[var(--app-border)] bg-[var(--app-panel-bg)] shadow-lg">
                        {quickMedDripMatches.length > 0 ? (
                          quickMedDripMatches.map((item, index) => (
                            <button
                              key={`quick-med-drip-${item.id}`}
                              type="button"
                              ref={element => {
                                quickMedDripOptionRefs.current[index] = element;
                              }}
                              className="w-full border-b border-[var(--app-border)] px-3 py-2 text-left text-sm hover:bg-white/[0.04] last:border-0"
                              onClick={() => applyQuickMedDripSelection(item, true)}
                              onKeyDown={e => {
                                if (e.key === "ArrowDown") {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  quickMedDripOptionRefs.current[
                                    Math.min(index + 1, quickMedDripMatches.length - 1)
                                  ]?.focus();
                                  return;
                                }
                                if (e.key === "ArrowUp") {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  if (index === 0) {
                                    quickMedDripSearchRef.current?.focus();
                                  } else {
                                    quickMedDripOptionRefs.current[index - 1]?.focus();
                                  }
                                  return;
                                }
                                if (e.key === "Enter" || (e.key === "Tab" && !e.shiftKey)) {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  applyQuickMedDripSelection(item, true);
                                }
                              }}
                            >
                              <div className="font-medium">{item.name}</div>
                              <div className="flex justify-between text-xs text-[var(--app-muted)]">
                                <span>{quickMedGroupLabel(item)}</span>
                                <span>{normalizeDisplayUnit("med", item.default_unit || "mg")}</span>
                              </div>
                            </button>
                          ))
                        ) : quickMedDripSearch.trim().length > 0 && quickMedDripSearch.trim().length < 2 ? (
                          <div className="p-3 text-sm text-[var(--app-muted)] italic">
                            Type at least 2 characters...
                          </div>
                        ) : quickMedDripSearch.trim() ? (
                          <div className="p-3 text-sm text-[var(--app-muted)] italic">
                            No exact matches found
                          </div>
                        ) : (
                          <div className="p-3 text-sm text-[var(--app-muted)] italic">
                            Start typing to search...
                          </div>
                        )}
                      </div>
                    </>
                  ) : null}
                </div>

                {quickMedDripEditTarget == null && quickMedDripSuggestion ? (
                  <div className="grid grid-cols-[110px_1fr] items-start gap-2">
                    <span className="pt-2 text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--app-muted)]">Suggestion</span>
                    <div className="flex flex-wrap gap-2">
                      {quickMedDripSuggestion.preparations.map(preparation => (
                        <button
                          key={`${preparation.amount}-${preparation.amountUnit}-${preparation.carrier || "undiluted"}-${preparation.totalVolumeMl}`}
                          type="button"
                          onClick={() => {
                            setQuickMedDripAmountValue(String(preparation.amount));
                            setQuickMedDripAmountUnit(preparation.amountUnit);
                            setQuickMedDripTotalVolumeMl(String(preparation.totalVolumeMl));
                            const carrier = preparation.carrier
                              ? carrierFluidOptions.find(item => normalizeToken(item.name) === normalizeToken(preparation.carrier))
                              : null;
                            setQuickMedDripCarrierFluidId(carrier?.id ?? null);
                          }}
                          className="rounded-lg border border-violet-400/35 bg-violet-500/10 px-3 py-1.5 text-xs font-semibold text-[var(--app-text)] hover:bg-violet-500/20"
                        >
                          {preparation.amount} {preparation.amountUnit} · {preparation.carrier || "Undiluted"} {preparation.totalVolumeMl} mL
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}

                <div className="grid grid-cols-[110px_1fr_120px] gap-2 items-center text-sm">
                  <label className="text-[var(--app-muted)]">Drug Amount</label>
                  <input
                    ref={quickMedDripAmountInputRef}
                    type="number"
                    min="0"
                    step="0.01"
                    className="rounded border px-2 py-1.5"
                    value={quickMedDripAmountValue}
                    onChange={e => setQuickMedDripAmountValue(e.target.value)}
                    placeholder="0.00"
                  />
                  <select
                    className="rounded border px-2 py-1.5"
                    value={quickMedDripAmountUnit}
                    onChange={e => setQuickMedDripAmountUnit(e.target.value)}
                  >
                    {CASEVIEW_UOM_OPTIONS.map(unit => (
                      <option key={`clinical-chart-med-drip-unit-${unit}`} value={unit}>
                        {normalizeDisplayUnit("med", unit)}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="grid grid-cols-[110px_1fr_120px] gap-2 items-center text-sm">
                  <label className="text-[var(--app-muted)]">Carrier Fluid</label>
                  <select
                    className="rounded border px-2 py-1.5"
                    value={quickMedDripCarrierFluidId ?? ""}
                    onChange={e =>
                      setQuickMedDripCarrierFluidId(e.target.value ? Number(e.target.value) : null)
                    }
                  >
                    <option value="">Undilute</option>
                    {carrierFluidOptions.map(item => (
                      <option key={`clinical-chart-med-drip-carrier-${item.id}`} value={item.id}>
                        {item.name}
                      </option>
                    ))}
                  </select>
                  <div />
                </div>

                <div className="grid grid-cols-[110px_1fr_120px] gap-2 items-center text-sm">
                  <label className="text-[var(--app-muted)]">Total Volume</label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    className="rounded border px-2 py-1.5"
                    value={quickMedDripTotalVolumeMl}
                    onChange={e => setQuickMedDripTotalVolumeMl(e.target.value)}
                    placeholder="0.00"
                  />
                  <div className="rounded border border-[var(--app-border)] bg-[var(--app-control-bg)] px-2 py-1.5 text-center">
                    mL
                  </div>
                </div>

                <div className="grid grid-cols-[110px_1fr_120px] gap-2 items-center text-sm">
                  <label className="text-[var(--app-muted)]">Dose</label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    className="rounded border px-2 py-1.5"
                    value={quickMedDripDoseValue}
                    onChange={e => {
                      setQuickMedDripLastEdited("dose");
                      setQuickMedDripDoseValue(e.target.value);
                    }}
                    placeholder="0.00"
                  />
                  <select
                    className="rounded border px-2 py-1.5"
                    value={quickMedDripDoseUnit}
                    onChange={e =>
                      setQuickMedDripDoseUnit(e.target.value as (typeof CASEVIEW_DOSE_RATE_UNITS)[number])
                    }
                  >
                    {quickMedDripDoseUnitOptions.map(unit => (
                      <option key={`clinical-chart-med-drip-dose-unit-${unit}`} value={unit}>
                        {normalizeDisplayUnit("med", unit)}
                      </option>
                    ))}
                  </select>
                </div>
                {quickMedDripEditTarget == null && quickMedDripSuggestion ? (
                  <div className="grid grid-cols-[110px_1fr] items-start gap-2">
                    <span className="pt-2 text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--app-muted)]">Suggestion</span>
                    <div className="flex flex-wrap gap-2">
                      {quickMedDripSuggestion.doses.map(dose => (
                        <button
                          key={`${dose.value}-${dose.unit}`}
                          type="button"
                          onClick={() => {
                            setQuickMedDripLastEdited("dose");
                            setQuickMedDripDoseUnit(dose.unit as (typeof CASEVIEW_DOSE_RATE_UNITS)[number]);
                            setQuickMedDripDoseValue(String(dose.value));
                          }}
                          className="rounded-lg border border-[var(--app-border)] bg-[var(--app-panel-bg)] px-3 py-1.5 text-xs font-bold tabular-nums text-[var(--app-text)] hover:bg-[var(--app-hover-bg)]"
                        >
                          {dose.value} {dose.unit}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}
                {quickMedDripEditTarget && quickMedDripCurrentProgress?.deliveredDisplay ? (
                  <div className="grid grid-cols-[110px_1fr_120px] gap-2 items-center -mt-1 text-[11px]">
                    <div />
                    <div className="text-[var(--app-muted)]">
                      Delivered so far: {quickMedDripCurrentProgress.deliveredDisplay}
                    </div>
                    <div />
                  </div>
                ) : null}

                {quickMedDripIsWeightBased ? (
                  <div className="grid grid-cols-[110px_1fr_120px] gap-2 items-center text-sm">
                    <label className="text-[var(--app-muted)]">Patient weight</label>
                    <input
                      type="number"
                      min="0"
                      step="0.1"
                      className="rounded border px-2 py-1.5"
                      value={quickMedDripWeightKg}
                      onChange={e => setQuickMedDripWeightKg(e.target.value)}
                      placeholder="kg"
                    />
                    <div className="rounded border border-[var(--app-border)] bg-[var(--app-control-bg)] px-2 py-1.5 text-center">
                      kg
                    </div>
                  </div>
                ) : null}

                <div className="grid grid-cols-[110px_1fr_120px] gap-2 items-center text-sm">
                  <label className="text-[var(--app-muted)]">Rate</label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    className="rounded border px-2 py-1.5"
                    value={quickMedDripRateMlHr}
                    onChange={e => {
                      setQuickMedDripLastEdited("rate");
                      setQuickMedDripRateMlHr(e.target.value);
                    }}
                    placeholder="0.00"
                  />
                  <div className="rounded border border-[var(--app-border)] bg-[var(--app-control-bg)] px-2 py-1.5 text-center">
                    mL/hr
                  </div>
                </div>
                {quickMedDripEditTarget && quickMedDripCurrentProgress ? (
                  <div className="grid grid-cols-[110px_1fr_120px] gap-2 items-center -mt-1 text-[11px]">
                    <div />
                    <div className="text-[var(--app-muted)]">
                      Current intake so far: {formatCompactAmount(quickMedDripCurrentProgress.infusedMl)} mL
                      {quickMedDripCurrentProgress.totalVolumeMl != null
                        ? ` / ${formatCompactAmount(quickMedDripCurrentProgress.totalVolumeMl)} mL`
                        : ""}
                    </div>
                    <div />
                  </div>
                ) : null}
                {quickMedDripEditTarget && quickMedDripCurrentProgress?.suggestedStopTs ? (
                  <div className="grid grid-cols-[110px_1fr_120px] gap-2 items-center -mt-1 text-[11px]">
                    <div />
                    <div className="text-[var(--app-muted)]">
                      Suggested stop at prepared volume:{" "}
                      <span className="font-medium text-[var(--app-text)]">
                        {formatDDMMYYYY(quickMedDripCurrentProgress.suggestedStopTs)}{" "}
                        {formatHHMMSS(quickMedDripCurrentProgress.suggestedStopTs)}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setQuickMedDripDate(formatDDMMYYYY(quickMedDripCurrentProgress.suggestedStopTs!));
                        setQuickMedDripTime(formatHHMM(quickMedDripCurrentProgress.suggestedStopTs!));
                        setQuickMedDripExactStopTs(quickMedDripCurrentProgress.suggestedStopTs!);
                      }}
                      className="rounded border border-blue-400 px-2 py-1 text-[11px] text-blue-600 dark:text-blue-300"
                      disabled={quickMedDripSaving || quickMedDripStopping}
                    >
                      Use Suggested Time
                    </button>
                  </div>
                ) : null}

                <div className="grid grid-cols-1 md:grid-cols-3 gap-2 items-center text-sm">
                  <label className="text-[var(--app-muted)]">Time</label>
                  <input
                    className="rounded border px-2 py-1.5"
                    value={quickMedDripDate}
                    onChange={e => {
                      setQuickMedDripExactStopTs(null);
                      setQuickMedDripDate(formatDateInputDDMMYYYY(e.target.value));
                    }}
                    onBlur={e => {
                      const normalized = normalizeDDMMYYYY(e.target.value);
                      if (normalized) {
                        setQuickMedDripExactStopTs(null);
                        setQuickMedDripDate(normalized);
                      }
                    }}
                    placeholder="dd/mm/yyyy"
                    tabIndex={-1}
                  />
                  <input
                    ref={quickMedDripTimeRef}
                    className="rounded border px-2 py-1.5"
                    value={quickMedDripTime}
                    onChange={e => {
                      setQuickMedDripExactStopTs(null);
                      setQuickMedDripTime(formatTimeInputHHMM(e.target.value));
                    }}
                    onBlur={e => {
                      const normalized = normalizeHHMM(e.target.value);
                      if (normalized) {
                        setQuickMedDripExactStopTs(null);
                        setQuickMedDripTime(normalized);
                      }
                    }}
                    placeholder="HH:mm"
                  />
                </div>

                <div className="grid grid-cols-[110px_1fr] gap-2 items-center text-sm">
                  <label className="text-[var(--app-muted)]">Note</label>
                  <input
                    className="rounded border px-2 py-1.5"
                    value={quickMedDripNote}
                    onChange={e => setQuickMedDripNote(e.target.value)}
                    placeholder="Optional note"
                  />
                </div>

                {quickMedDripError ? (
                  <div className="text-xs text-red-600 dark:text-red-400">{quickMedDripError}</div>
                ) : null}

                <div className="flex justify-end gap-2 pt-1">
                  {quickMedDripCanStop ? (
                    <button
                      type="button"
                      onClick={() => void stopQuickMedDrip()}
                      className="rounded border border-amber-500 px-3 py-1.5 text-sm text-amber-600 dark:text-amber-300"
                      disabled={quickMedDripSaving || quickMedDripStopping}
                    >
                      {quickMedDripStopping ? "Stopping..." : "Stop Drip"}
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={closeQuickMedDrip}
                    className="rounded border px-3 py-1.5 text-sm"
                    disabled={quickMedDripSaving || quickMedDripStopping}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => void saveQuickMedDrip()}
                    className={`rounded px-3 py-1.5 text-sm text-white ${
                      quickMedDripSaving ? "bg-gray-400" : "bg-blue-600 hover:bg-blue-700"
                    }`}
                    disabled={!quickMedDripCanSave}
                  >
                    {quickMedDripSaving ? "Saving..." : "Save"}
                  </button>
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}

      {bloodBoardOpen && typeof document !== "undefined"
        ? createPortal(
            <div
              className="app-theme-scope io-modal-backdrop"
              onMouseDown={() => setBloodBoardOpen(false)}
            >
              <div
                className="io-modal flex h-[min(90vh,820px)] w-[min(96vw,1440px)] flex-col p-5"
                role="dialog"
                aria-modal="true"
                onMouseDown={event => event.stopPropagation()}
              >
                {ioModalPatientContext}
                <div className="mb-4 flex items-start justify-between gap-3">
                  <div>
                    <div className="text-base font-semibold">Blood Board</div>
                    <div className="text-xs text-[var(--app-muted)]">
                      Available bags from {bloodBoardSource === "MOCK" ? "mock HIS data" : "HIS / Blood Bank"} with FLORA case status
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => void loadBloodBoard()}
                      disabled={bloodBoardLoading}
                      className="rounded border border-[var(--app-border)] px-3 py-1.5 text-sm hover:bg-[var(--app-hover-bg)] disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {bloodBoardLoading ? "Refreshing..." : "Refresh HIS List"}
                    </button>
                    <button
                      type="button"
                      onClick={() => setBloodBoardOpen(false)}
                      className="rounded border border-[var(--app-border)] px-3 py-1.5 text-sm text-[var(--app-muted)] hover:bg-[var(--app-hover-bg)]"
                    >
                      Close
                    </button>
                  </div>
                </div>

                {bloodBoardError ? (
                  <div className="rounded border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-700 dark:text-red-300">
                    {bloodBoardError}
                  </div>
                ) : null}

                {shouldUseBloodBoard ? (
                  <div className="mt-4 grid min-h-0 flex-1 grid-cols-1 gap-4 lg:grid-cols-[minmax(480px,1.45fr)_minmax(220px,0.72fr)_minmax(220px,0.72fr)]">
                    <section className="flex min-h-0 flex-col overflow-hidden rounded-lg border border-[var(--app-border)]">
                      <div className="border-b border-[var(--app-border)] bg-[var(--app-control-bg)] px-3 py-2">
                        <div className="text-xs font-semibold uppercase tracking-wide text-[var(--app-muted)]">1. HIS / Blood Bank Bag List</div>
                        <div className="mt-1 text-xs text-[var(--app-muted)]">
                          HN <b className="text-[var(--app-text)]">{caseStatus.hn}</b>
                          {" | "}Static mock list for EforL showcase
                        </div>
                      </div>
                      <div className="min-h-0 flex-1 overflow-auto">
                        <table className="w-full text-xs">
                          <thead className="bg-[var(--app-control-bg)] text-left uppercase tracking-wide text-[var(--app-muted)]">
                            <tr>
                              <th className="px-3 py-2">Bag No.</th>
                              <th className="px-3 py-2">Product</th>
                              <th className="px-3 py-2">Group</th>
                              <th className="px-3 py-2">HIS Status</th>
                              <th className="px-3 py-2">OR Status</th>
                              <th className="px-3 py-2">Given</th>
                            </tr>
                          </thead>
                          <tbody>
                            {eforlBloodBoardRows.map(row => (
                              <tr key={String(row.dnrno || "")} className="border-t border-[var(--app-border)]">
                                <td className="px-3 py-3 font-semibold">{row.dnrno || "-"}</td>
                                <td className="px-3 py-3">{row.bdtype || "-"}</td>
                                <td className="px-3 py-3">{[row.bloodgrp, row.rh].filter(Boolean).join("") || "-"}</td>
                                <td className="px-3 py-3">
                                  <span className="rounded-full bg-sky-500/15 px-2 py-1 font-semibold text-sky-700 dark:text-sky-300">
                                    {row.hisStatus}
                                  </span>
                                </td>
                                <td className="px-3 py-3">
                                  <span className={`rounded-full px-2 py-1 font-semibold ${
                                    row.orStage === "Pending"
                                      ? "bg-gray-500/10 text-[var(--app-muted)]"
                                      : row.orStage === "Given"
                                        ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
                                        : row.orStage === "Warmed"
                                          ? "bg-amber-500/15 text-amber-700 dark:text-amber-300"
                                          : "bg-blue-500/15 text-blue-700 dark:text-blue-300"
                                  }`}>
                                    {row.orStage}
                                  </span>
                                </td>
                                <td className="px-3 py-3">{row.givenAmountMl ? `${row.givenAmountMl} mL` : "-"}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </section>

                    <section className="rounded-lg border border-[var(--app-border)] p-4">
                      <div className="mb-3 text-xs font-semibold uppercase tracking-wide text-[var(--app-muted)]">
                        2. Register Bag into OR
                      </div>
                      <div className="space-y-3">
                        <input
                          className="w-full rounded border border-[var(--app-border)] bg-[var(--app-control-bg)] px-3 py-2 text-sm"
                          placeholder="Scan or enter bag number"
                          value={eforlReceiveBagNo}
                          onChange={event => {
                            setEforlReceiveBagNo(event.target.value);
                            setBloodBoardError("");
                          }}
                        />
                        <select
                          className="w-full rounded border border-[var(--app-border)] bg-[var(--app-control-bg)] px-3 py-2 text-sm"
                          value={eforlReceiveCondition}
                          onChange={event => setEforlReceiveCondition(event.target.value as EforlBloodBoardCondition)}
                        >
                          <option value="Frozen">Frozen</option>
                          <option value="Warmed">Warmed</option>
                        </select>
                        {eforlReceiveMatchedBag ? (
                          <div className="rounded border border-blue-500/35 bg-blue-500/10 p-3 text-xs">
                            <div className="mb-1 font-semibold text-blue-700 dark:text-blue-300">Matched bag</div>
                            <div>Bag: <b>{eforlReceiveMatchedBag.dnrno}</b></div>
                            <div>Product: <b>{eforlReceiveMatchedBag.bdtype || "-"}</b></div>
                            <div>Current OR status: <b>{eforlReceiveMatchedBag.orStage}</b></div>
                          </div>
                        ) : null}
                        <button
                          type="button"
                          onClick={registerEforlBloodBag}
                          className="w-full rounded bg-blue-600 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-700"
                        >
                          Register in OR
                        </button>
                      </div>
                    </section>

                    <section className="rounded-lg border border-[var(--app-border)] p-4">
                      <div className="mb-3 text-xs font-semibold uppercase tracking-wide text-[var(--app-muted)]">
                        3. Record Giving to Patient
                      </div>
                      <div className="space-y-3">
                        <input
                          className="w-full rounded border border-[var(--app-border)] bg-[var(--app-control-bg)] px-3 py-2 text-sm"
                          placeholder="Scan or enter bag number again"
                          value={eforlGiveBagNo}
                          onChange={event => {
                            setEforlGiveBagNo(event.target.value);
                            setBloodBoardError("");
                          }}
                        />
                        <input
                          type="number"
                          min="0"
                          step="any"
                          className="w-full rounded border border-[var(--app-border)] bg-[var(--app-control-bg)] px-3 py-2 text-sm"
                          placeholder="Amount (mL)"
                          value={eforlGiveAmountMl}
                          onChange={event => {
                            setEforlGiveAmountMl(event.target.value);
                            setBloodBoardError("");
                          }}
                        />
                        {eforlGiveMatchedBag ? (
                          <div className="rounded border border-emerald-500/35 bg-emerald-500/10 p-3 text-xs">
                            <div className="mb-1 font-semibold text-emerald-700 dark:text-emerald-300">Giving target</div>
                            <div>Bag: <b>{eforlGiveMatchedBag.dnrno}</b></div>
                            <div>Product: <b>{eforlGiveMatchedBag.bdtype || "-"}</b></div>
                            <div>Current OR status: <b>{eforlGiveMatchedBag.orStage}</b></div>
                          </div>
                        ) : null}
                        <button
                          type="button"
                          onClick={recordEforlBloodGiving}
                          className="w-full rounded bg-rose-600 px-3 py-2 text-sm font-semibold text-white hover:bg-rose-700"
                        >
                          Mark as Given
                        </button>
                      </div>
                    </section>
                  </div>
                ) : (
                <div className="mt-4 grid min-h-0 flex-1 grid-cols-[minmax(570px,1.18fr)_minmax(400px,0.82fr)] gap-4">
                  <section className="flex min-h-0 flex-col overflow-hidden rounded-lg border border-[var(--app-border)]">
                    <div className="border-b border-[var(--app-border)] bg-[var(--app-control-bg)] px-3 py-2 text-xs font-semibold uppercase tracking-wide text-[var(--app-muted)]">
                      1. Bags matched to current patient
                    </div>
                    <div className="min-h-0 flex-1 overflow-auto">
                  <table className="w-full text-xs">
                    <thead className="bg-[var(--app-control-bg)] text-left text-xs uppercase tracking-wide text-[var(--app-muted)]">
                      <tr>
                        <th className="px-3 py-2">Bag No.</th>
                        <th className="px-3 py-2">HN</th>
                        <th className="px-3 py-2">AN</th>
                        <th className="px-3 py-2">Product</th>
                        <th className="px-3 py-2">Group</th>
                        <th className="px-3 py-2">Rh</th>
                        <th className="px-3 py-2">FLORA Status</th>
                        <th className="px-3 py-2"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {bloodBoardRows.map(row => {
                        const bagNo = String(row.dnrno || "").trim();
                        const localStatus = bloodBoardStatusForBag(bagNo);
                        return (
                          <tr
                            key={bagNo}
                            className={`border-t border-[var(--app-border)] ${
                              quickBloodProductBagNo.trim() === bagNo ? "bg-rose-500/10" : ""
                            }`}
                          >
                            <td className="px-3 py-3 font-semibold">{bagNo}</td>
                            <td className="px-3 py-3">{row.hn || "-"}</td>
                            <td className="px-3 py-3">{row.an || "-"}</td>
                            <td className="px-3 py-3">{row.bdtype || "-"}</td>
                            <td className="px-3 py-3">{row.bloodgrp || "-"}</td>
                            <td className="px-3 py-3">{row.rh || "-"}</td>
                            <td className="px-3 py-3">
                              <span className={`rounded-full px-2 py-1 text-xs font-semibold ${
                                localStatus === "Available"
                                  ? "bg-gray-500/10 text-[var(--app-muted)]"
                                  : localStatus === "Received in OR"
                                    ? "bg-blue-500/15 text-blue-700 dark:text-blue-300"
                                    : localStatus === "Warming"
                                      ? "bg-amber-500/15 text-amber-700 dark:text-amber-300"
                                      : localStatus === "Stopped / Reaction"
                                        ? "bg-red-500/15 text-red-700 dark:text-red-300"
                                        : "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
                              }`}>
                                {localStatus}
                              </span>
                            </td>
                            <td className="px-3 py-3">
                              <button
                                type="button"
                                onClick={() => {
                                  setQuickBloodProductBagNo(bagNo);
                                  resetQuickBloodProductVerification();
                                  setQuickBloodProductManualAvailable(true);
                                  setQuickBloodProductError("");
                                }}
                                className="rounded border border-[var(--app-border)] px-2 py-1 text-xs font-semibold hover:bg-[var(--app-hover-bg)]"
                              >
                                Select
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                      {!bloodBoardLoading && bloodBoardRows.length === 0 ? (
                        <tr>
                          <td colSpan={8} className="px-3 py-8 text-center text-sm text-[var(--app-muted)]">
                            No blood bags returned for this patient. Refresh the HIS list.
                          </td>
                        </tr>
                      ) : null}
                    </tbody>
                  </table>
                    </div>
                  </section>
                  <section className="min-h-0 overflow-y-auto rounded-lg border border-[var(--app-border)] p-4">
                    <div className="mb-3 text-xs font-semibold uppercase tracking-wide text-[var(--app-muted)]">
                      2. Scan bag QR and verify bag in use
                    </div>
                    <div className="space-y-3">
                      <div className="flex gap-2">
                        <input
                          ref={quickBloodProductBagRef}
                          className="min-w-0 flex-1 rounded border border-[var(--app-border)] bg-[var(--app-control-bg)] px-3 py-2 text-sm"
                          placeholder="Scan blood bag QR / bag number"
                          value={quickBloodProductBagNo}
                          onChange={event => {
                            setQuickBloodProductBagNo(event.target.value);
                            resetQuickBloodProductVerification();
                            setQuickBloodProductError("");
                          }}
                        />
                        <button
                          type="button"
                          onClick={() => void checkQuickBloodProductBag()}
                          disabled={quickBloodProductChecking || quickBloodProductSaving}
                          className="rounded bg-blue-600 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:bg-gray-400"
                        >
                          {quickBloodProductChecking ? "Checking..." : "Match Bag"}
                        </button>
                      </div>
                      {bloodBoardMatchedBag ? (
                        <div className="rounded border border-emerald-500/40 bg-emerald-500/10 p-3 text-xs">
                          <div className="mb-2 font-semibold text-emerald-700 dark:text-emerald-300">Matched in HIS bag list</div>
                          <div className="grid grid-cols-2 gap-x-3 gap-y-1">
                            <div>HN: <b>{bloodBoardMatchedBag.hn || "-"}</b></div>
                            <div>AN: <b>{bloodBoardMatchedBag.an || "-"}</b></div>
                            <div>Type: <b>{bloodBoardMatchedBag.bdtype || "-"}</b></div>
                            <div>Bag: <b>{bloodBoardMatchedBag.dnrno || "-"}</b></div>
                            <div>Group: <b>{bloodBoardMatchedBag.bloodgrp || "-"}</b></div>
                            <div>Rh: <b>{bloodBoardMatchedBag.rh || "-"}</b></div>
                          </div>
                        </div>
                      ) : quickBloodProductBagNo.trim() ? (
                        <div className="rounded border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-300">
                          This scan has not matched a bag in the HIS list.
                        </div>
                      ) : null}
                      {renderBloodIdentityComparison(
                        quickBloodProductVerified,
                        quickBloodProductVerificationMode,
                      )}
                      {bloodBoardMatchedBag && !quickBloodProductVerificationMode ? (
                        <button
                          type="button"
                          onClick={confirmQuickBloodProductManualCheck}
                          className="w-full rounded border border-amber-500/50 bg-amber-500/10 px-3 py-2 text-sm font-semibold text-amber-700 dark:text-amber-300"
                        >
                          Confirm Manual Bedside Check
                        </button>
                      ) : null}
                      {quickBloodProductError ? (
                        <div className="rounded border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-700 dark:text-red-300">
                          {quickBloodProductError}
                        </div>
                      ) : null}
                      {bloodBoardMatchedBag && quickBloodProductVerificationMode ? (
                        <>
                          <div className="flex items-center justify-between rounded border border-[var(--app-border)] px-3 py-2 text-sm">
                            <span>Status: <b>{bloodBoardStatusForBag(String(bloodBoardMatchedBag.dnrno || ""))}</b></span>
                            {bloodBoardStatusForBag(String(bloodBoardMatchedBag.dnrno || "")) === "Available" ? (
                              <button
                                type="button"
                                onClick={() => void recordBloodBagReceived(bloodBoardMatchedBag)}
                                disabled={bloodBoardSavingBagNo === String(bloodBoardMatchedBag.dnrno || "").trim()}
                                className="rounded border border-blue-500/50 px-3 py-1.5 text-xs font-semibold text-blue-700 dark:text-blue-300"
                              >
                                Receive in OR
                              </button>
                            ) : null}
                          </div>
                          <div className="grid grid-cols-[80px_1fr_92px] items-center gap-2 text-sm">
                            <label className="text-[var(--app-muted)]">Time</label>
                            <input className="rounded border border-[var(--app-border)] bg-[var(--app-control-bg)] px-2 py-1.5"
                              value={quickBloodProductDate}
                              onChange={event => setQuickBloodProductDate(formatDateInputDDMMYYYY(event.target.value))} />
                            <input className="rounded border border-[var(--app-border)] bg-[var(--app-control-bg)] px-2 py-1.5"
                              value={quickBloodProductTime}
                              onChange={event => setQuickBloodProductTime(formatTimeInputHHMM(event.target.value))} />
                          </div>
                          {quickBloodProductEventTs != null ? (
                            <div className={`rounded border px-3 py-2 text-xs ${
                              quickBloodProductHasTimeOut
                                ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                                : "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300"
                            }`}>
                              Time Out: {quickBloodProductHasTimeOut ? "completed before selected time" : "required before blood product workflow"}
                            </div>
                          ) : null}
                          <div className="grid grid-cols-[80px_1fr] items-center gap-2 text-sm">
                            <label className="text-[var(--app-muted)]">Volume</label>
                            <input
                              ref={quickBloodProductVolumeRef}
                              type="number"
                              min="0"
                              step="any"
                              className="rounded border border-[var(--app-border)] bg-[var(--app-control-bg)] px-2 py-1.5"
                              placeholder="Empty = register warming; enter mL = giving"
                              value={quickBloodProductVolumeMl}
                              onChange={event => {
                                setQuickBloodProductVolumeMl(event.target.value);
                                setBloodBoardConfirmedAnesthetist(null);
                              }}
                            />
                          </div>
                          {quickBloodProductHasVolume ? (
                            <div className="space-y-2 rounded border border-rose-500/35 bg-rose-500/5 p-3 text-xs">
                              <div className="font-semibold text-rose-700 dark:text-rose-300">
                                Anesthetist verification required for actual giving
                              </div>
                              {signedInGivingAuthorization ? (
                                <div className="rounded border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-emerald-700 dark:text-emerald-300">
                                  Self-verified by anesthetist: <b>{signedInGivingAuthorization.name}</b>
                                </div>
                              ) : (
                                <>
                                  <div className="text-[var(--app-muted)]">
                                    Current user cannot self-verify. An anesthetist must confirm this giving action.
                                  </div>
                                  <div className="flex gap-2">
                                    <select
                                      className="min-w-0 flex-1 rounded border border-[var(--app-border)] bg-[var(--app-control-bg)] px-2 py-1.5"
                                      value={bloodBoardSelectedAnesthetist}
                                      onChange={event => {
                                        setBloodBoardSelectedAnesthetist(event.target.value);
                                        setBloodBoardConfirmedAnesthetist(null);
                                      }}
                                      disabled={bloodBoardAnesthetistsLoading}
                                    >
                                      <option value="">
                                        {bloodBoardAnesthetistsLoading ? "Loading anesthetists..." : "Select anesthetist"}
                                      </option>
                                      {bloodBoardAnesthetists.map((member, index) => (
                                        <option key={`${member.hospital_id || member.name}-${index}`} value={String(index)}>
                                          {member.name}
                                        </option>
                                      ))}
                                    </select>
                                    <button
                                      type="button"
                                      onClick={() => {
                                        const member = bloodBoardSelectedAnesthetist === ""
                                          ? undefined
                                          : bloodBoardAnesthetists[Number(bloodBoardSelectedAnesthetist)];
                                        if (!member) {
                                          setQuickBloodProductError("Select the anesthetist who verifies giving");
                                          return;
                                        }
                                        setBloodBoardConfirmedAnesthetist(member);
                                        setQuickBloodProductError("");
                                      }}
                                      className="rounded border border-rose-500/50 px-3 py-1.5 font-semibold text-rose-700 dark:text-rose-300"
                                    >
                                      Confirm
                                    </button>
                                  </div>
                                  {bloodBoardConfirmedAnesthetist ? (
                                    <div className="rounded border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-emerald-700 dark:text-emerald-300">
                                      Verified by anesthetist: <b>{bloodBoardConfirmedAnesthetist.name}</b>
                                    </div>
                                  ) : bloodBoardAnesthetists.length === 0 && !bloodBoardAnesthetistsLoading ? (
                                    <div className="text-amber-700 dark:text-amber-300">
                                      No anesthetist is assigned in case staff. Add the responsible anesthetist before recording giving.
                                    </div>
                                  ) : null}
                                </>
                              )}
                            </div>
                          ) : null}
                          <div className="grid grid-cols-[80px_1fr] items-center gap-2 text-sm">
                            <label className="text-[var(--app-muted)]">Note</label>
                            <input className="rounded border border-[var(--app-border)] bg-[var(--app-control-bg)] px-2 py-1.5"
                              value={quickBloodProductNote}
                              onChange={event => setQuickBloodProductNote(event.target.value)}
                              placeholder="Optional" />
                          </div>
                          <button
                            type="button"
                            onClick={() => void saveQuickBloodProduct()}
                            disabled={quickBloodProductSaving}
                            className="w-full rounded bg-rose-600 px-3 py-2 text-sm font-semibold text-white hover:bg-rose-700 disabled:bg-gray-400"
                          >
                            {quickBloodProductSaving
                              ? "Saving..."
                              : quickBloodProductHasVolume
                                ? "Record Start Giving"
                                : "Record Warming"}
                          </button>
                          {bloodBoardStatusForBag(String(bloodBoardMatchedBag.dnrno || "")) === "Giving recorded" ? (
                            <div className="flex gap-2">
                              <button type="button" onClick={() => openBloodBoardOutcome(bloodBoardMatchedBag, "completed")}
                                className="flex-1 rounded border border-emerald-500/50 px-3 py-2 text-sm font-semibold text-emerald-700 dark:text-emerald-300">
                                Complete
                              </button>
                              <button type="button" onClick={() => openBloodBoardOutcome(bloodBoardMatchedBag, "stop_reaction")}
                                className="flex-1 rounded border border-red-500/50 px-3 py-2 text-sm font-semibold text-red-700 dark:text-red-300">
                                Stop / Reaction
                              </button>
                            </div>
                          ) : null}
                        </>
                      ) : null}
                    </div>
                  </section>
                </div>
                )}
                {bloodBoardOutcomeBag ? (
                  <div className={`rounded-lg border p-3 space-y-3 ${
                    bloodBoardOutcomeMode === "completed"
                      ? "border-emerald-500/40 bg-emerald-500/10"
                      : "border-red-500/40 bg-red-500/10"
                  }`}>
                    <div className="text-sm font-semibold">
                      {bloodBoardOutcomeMode === "completed" ? "Complete transfusion" : "Stop transfusion / Record reaction"}
                      {" - "}Bag {bloodBoardOutcomeBag.dnrno}
                    </div>
                    <div className="grid grid-cols-[90px_1fr] items-center gap-2 text-sm">
                      <label className="text-[var(--app-muted)]">Detail</label>
                      <input
                        className="rounded border border-[var(--app-border)] bg-[var(--app-control-bg)] px-3 py-2"
                        placeholder={bloodBoardOutcomeMode === "completed" ? "Optional note" : "Reason or reaction detail"}
                        value={bloodBoardOutcomeDetail}
                        onChange={event => setBloodBoardOutcomeDetail(event.target.value)}
                      />
                    </div>
                    <div className="flex justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => setBloodBoardOutcomeBag(null)}
                        className="rounded border border-[var(--app-border)] px-3 py-1.5 text-sm text-[var(--app-muted)]"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        onClick={() => void saveBloodBoardOutcome()}
                        disabled={bloodBoardSavingBagNo === String(bloodBoardOutcomeBag.dnrno || "").trim()}
                        className={`rounded px-3 py-1.5 text-sm font-semibold text-white ${
                          bloodBoardOutcomeMode === "completed" ? "bg-emerald-600 hover:bg-emerald-700" : "bg-red-600 hover:bg-red-700"
                        } disabled:bg-gray-400`}
                      >
                        {bloodBoardSavingBagNo === String(bloodBoardOutcomeBag.dnrno || "").trim() ? "Saving..." : "Record Outcome"}
                      </button>
                    </div>
                  </div>
                ) : null}
                <div className="text-xs text-[var(--app-muted)]">
                  {shouldUseBloodBoard
                    ? "EforL showcase mode uses static mock blood-bank data to demonstrate the bag workflow."
                    : "Refresh adds new HIS bags while retaining locally recorded case status. Bedside checking is still required before giving blood."}
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}

      {quickBloodProductOpen && typeof document !== "undefined"
        ? createPortal(
            <div
              className="app-theme-scope io-modal-backdrop"
              onMouseDown={closeQuickBloodProduct}
            >
              <div
                className="io-modal w-full max-w-xl p-4 space-y-3"
                role="dialog"
                aria-modal="true"
                onMouseDown={e => e.stopPropagation()}
                onKeyDown={e => {
                  if (quickBloodProductSaving) return;
                  if (e.key === "Escape") { e.preventDefault(); closeQuickBloodProduct(); return; }
                  if (e.key === "Enter" && !e.shiftKey && !showQuickBloodProductDropdown) { e.preventDefault(); void saveQuickBloodProduct(); }
                }}
              >
                {ioModalPatientContext}
                <div className="flex items-start justify-between gap-3">
                  <div className="space-y-1">
                    <div className="text-sm font-semibold leading-none">Blood product</div>
                    <div className="flex items-center gap-2">
                      <span className="text-base font-medium leading-none">Blood Product</span>
                      <span className="rounded px-1.5 py-0.5 text-[10px] font-bold leading-none bg-rose-500/20 text-rose-300">
                        Blood
                      </span>
                    </div>
                    <div className="text-xs text-[var(--app-muted)]">Verify bag before register or giving</div>
                  </div>
                  <button type="button" onClick={closeQuickBloodProduct} disabled={quickBloodProductSaving}
                    className="rounded border border-[var(--app-border)] px-3 py-1.5 text-sm text-[var(--app-muted)] hover:bg-[var(--app-hover-bg)]">
                    Close
                  </button>
                </div>

                {/* Bag No */}
                <div className="grid grid-cols-[80px_1fr_auto] gap-2 items-center text-sm">
                  <label className="text-[var(--app-muted)]">Bag No.</label>
                  <input ref={quickBloodProductBagRef} className="rounded border border-[var(--app-border)] bg-[var(--app-control-bg)] px-2 py-1.5 text-sm"
                    placeholder="Scan QR or enter blood bag number"
                    value={quickBloodProductBagNo}
                    onChange={e => {
                      setQuickBloodProductBagNo(e.target.value);
                      resetQuickBloodProductVerification();
                    }} />
                  <button
                    type="button"
                    onClick={() => void checkQuickBloodProductBag()}
                    disabled={quickBloodProductChecking || quickBloodProductSaving}
                    className={`rounded px-3 py-1.5 text-sm text-white ${
                      quickBloodProductChecking || quickBloodProductSaving
                        ? "bg-gray-400 cursor-not-allowed"
                        : "bg-blue-600 hover:bg-blue-700"
                    }`}
                  >
                    {quickBloodProductChecking ? "Checking..." : "Check Bag"}
                  </button>
                </div>

                {renderBloodIdentityComparison(
                  quickBloodProductVerified,
                  quickBloodProductVerificationMode,
                )}

                {quickBloodProductVerificationMode === "manual" ? (
                  <div className="rounded border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
                    Manual check confirmed. This record will be marked verification:manual.
                  </div>
                ) : null}
                {quickBloodProductVerificationMode === "registered" ? (
                  <div className="rounded border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-700 dark:text-emerald-300">
                    Bag matched the registered warmer bag. This record will be marked verification:registered.
                  </div>
                ) : null}

                {/* Product search */}
                <div className="relative">
                  <input
                    className="w-full rounded border border-[var(--app-border)] bg-[var(--app-control-bg)] px-3 py-2 text-sm"
                    placeholder="Search blood product..."
                    value={quickBloodProductSearch}
                    onChange={e => { setQuickBloodProductSearch(e.target.value); setQuickBloodProductItemId(null); setShowQuickBloodProductDropdown(true); setQuickBloodProductTypeLockedFromHis(false); }}
                    onFocus={() => {
                      if (!quickBloodProductTypeLockedFromHis) setShowQuickBloodProductDropdown(true);
                    }}
                    readOnly={quickBloodProductTypeLockedFromHis}
                    onKeyDown={e => {
                      if (quickBloodProductTypeLockedFromHis) return;
                      const matches = filteredQuickBloodProductItems;
                      if (!matches.length || !showQuickBloodProductDropdown) return;
                      if ((e.key === "Tab" && !e.shiftKey) || e.key === "Enter") {
                        e.preventDefault();
                        if (e.key === "Enter" || matches.length === 1) {
                          setQuickBloodProductItemId(matches[0].id);
                          setQuickBloodProductSearch(matches[0].name);
                          resetQuickBloodProductVerification();
                          setShowQuickBloodProductDropdown(false);
                          window.requestAnimationFrame(() => quickBloodProductVolumeRef.current?.focus());
                        } else {
                          quickBloodProductOptionRefs.current[0]?.focus();
                        }
                      }
                    }}
                  />
                  {showQuickBloodProductDropdown && (
                    <>
                      <div className="fixed inset-0 z-0" onMouseDown={() => setShowQuickBloodProductDropdown(false)} />
                      <div className="absolute z-10 mt-1 max-h-48 w-full overflow-y-auto rounded border border-[var(--app-border)] bg-[var(--app-panel-bg)] shadow-lg">
                        {filteredQuickBloodProductItems.length > 0
                          ? filteredQuickBloodProductItems.map((item, index) => (
                              <button key={`qbp-${item.id}`} type="button"
                                ref={el => { quickBloodProductOptionRefs.current[index] = el; }}
                                className="w-full border-b border-[var(--app-border)] px-3 py-2 text-left text-sm hover:bg-[var(--app-hover-bg)] last:border-0"
                                onClick={() => { setQuickBloodProductItemId(item.id); setQuickBloodProductSearch(item.name); resetQuickBloodProductVerification(); setShowQuickBloodProductDropdown(false); window.requestAnimationFrame(() => quickBloodProductVolumeRef.current?.focus()); }}
                                onKeyDown={e => {
                                  if (e.key === "ArrowDown") { e.preventDefault(); e.stopPropagation(); quickBloodProductOptionRefs.current[Math.min(index + 1, filteredQuickBloodProductItems.length - 1)]?.focus(); return; }
                                  if (e.key === "ArrowUp") { e.preventDefault(); e.stopPropagation(); if (index === 0) { (e.currentTarget.closest(".relative")?.querySelector("input") as HTMLInputElement | null)?.focus(); } else { quickBloodProductOptionRefs.current[index - 1]?.focus(); } return; }
                                  if (e.key === "Enter" || (e.key === "Tab" && !e.shiftKey)) { e.preventDefault(); e.stopPropagation(); setQuickBloodProductItemId(item.id); setQuickBloodProductSearch(item.name); resetQuickBloodProductVerification(); setShowQuickBloodProductDropdown(false); window.requestAnimationFrame(() => quickBloodProductVolumeRef.current?.focus()); }
                                }}>
                                <div className="font-medium">{item.name}</div>
                                <div className="text-xs text-[var(--app-muted)]">{item.default_unit || "mL"}</div>
                              </button>
                            ))
                          : quickBloodProductSearch.length >= 2
                            ? <div className="p-3 text-sm text-[var(--app-muted)] italic">No matches</div>
                            : <div className="p-3 text-sm text-[var(--app-muted)] italic">Type to search...</div>
                        }
                      </div>
                    </>
                  )}
                </div>

                {/* Date / Time */}
                <div className="grid grid-cols-[80px_1fr_100px] gap-2 items-center text-sm">
                  <label className="text-[var(--app-muted)]">Time</label>
                  <input className="rounded border border-[var(--app-border)] bg-[var(--app-control-bg)] px-2 py-1.5 text-sm"
                    value={quickBloodProductDate}
                    onChange={e => setQuickBloodProductDate(formatDateInputDDMMYYYY(e.target.value))}
                    onBlur={e => { const n = normalizeDateInputDDMMYYYY(e.target.value); if (n) setQuickBloodProductDate(n); }}
                    placeholder="dd/mm/yyyy" />
                  <input className="rounded border border-[var(--app-border)] bg-[var(--app-control-bg)] px-2 py-1.5 text-sm"
                    value={quickBloodProductTime}
                    onChange={e => setQuickBloodProductTime(formatTimeInputHHMM(e.target.value))}
                    onBlur={e => { const n = normalizeTimeInputHHMM(e.target.value); if (n) setQuickBloodProductTime(n); }}
                    placeholder="HH:mm" />
                </div>

                {quickBloodProductEventTs != null ? (
                  <div className={`rounded border px-3 py-2 text-xs ${
                    quickBloodProductHasTimeOut
                      ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                      : "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300"
                  }`}>
                    Time Out: {quickBloodProductHasTimeOut ? "completed before selected time" : "required before blood product workflow"}
                  </div>
                ) : null}

                {/* Volume */}
                <div className="grid grid-cols-[80px_1fr] gap-2 items-center text-sm">
                  <label className="text-[var(--app-muted)]">Volume (mL)</label>
                  <input ref={quickBloodProductVolumeRef}
                    className="rounded border border-[var(--app-border)] bg-[var(--app-control-bg)] px-2 py-1.5 text-sm"
                    type="number" min="0" step="any" placeholder="empty = register to warmer"
                    value={quickBloodProductVolumeMl}
                    onChange={e => setQuickBloodProductVolumeMl(e.target.value)} />
                </div>

                {/* Blood group (only for PRC/FFP) */}
                {quickBloodProductType ? (
                  <div className="grid grid-cols-[80px_1fr] gap-2 items-center text-sm">
                    <label className="text-[var(--app-muted)]">Blood Group</label>
                    <select className="rounded border border-[var(--app-border)] bg-[var(--app-control-bg)] px-2 py-1.5 text-sm"
                      value={quickBloodProductGroup}
                      onChange={e => {
                        setQuickBloodProductGroup(e.target.value);
                        if (quickBloodProductVerificationMode === "api") {
                          resetQuickBloodProductVerification();
                        }
                      }}>
                      <option value="">Select group...</option>
                      {BLOOD_GROUP_OPTIONS.map(g => <option key={g} value={g}>{g}</option>)}
                    </select>
                  </div>
                ) : null}

                {/* Note */}
                <div className="grid grid-cols-[80px_1fr] gap-2 items-center text-sm">
                  <label className="text-[var(--app-muted)]">Note</label>
                  <input className="rounded border border-[var(--app-border)] bg-[var(--app-control-bg)] px-2 py-1.5 text-sm"
                    placeholder="Optional"
                    value={quickBloodProductNote}
                    onChange={e => setQuickBloodProductNote(e.target.value)} />
                </div>

                {quickBloodProductError ? (
                  <div className="text-xs text-red-500 dark:text-red-400">{quickBloodProductError}</div>
                ) : null}

                <div className="flex justify-end gap-2">
                  <button type="button" onClick={closeQuickBloodProduct} disabled={quickBloodProductSaving}
                    className="rounded border border-[var(--app-border)] px-3 py-1.5 text-sm text-[var(--app-muted)] hover:bg-[var(--app-hover-bg)]">
                    Cancel
                  </button>
                  {quickBloodProductManualAvailable ? (
                    <button type="button" onClick={confirmQuickBloodProductManualCheck} disabled={quickBloodProductSaving}
                      className={`rounded border border-amber-500/50 px-3 py-1.5 text-sm ${quickBloodProductSaving ? "text-gray-400 cursor-not-allowed" : "text-amber-700 hover:bg-amber-500/10 dark:text-amber-300"}`}>
                      Confirm Manual Check
                    </button>
                  ) : null}
                  <button type="button" onClick={() => void saveQuickBloodProduct()} disabled={quickBloodProductSaving}
                    className={`rounded px-3 py-1.5 text-sm text-white ${quickBloodProductSaving ? "bg-gray-400 cursor-not-allowed" : "bg-rose-600 hover:bg-rose-700"}`}>
                    {quickBloodProductSaving
                      ? "Saving..."
                      : quickBloodProductHasVolume
                        ? "Save Giving"
                        : "Register Bag"}
                  </button>
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}

      {quickFluidOpen && typeof document !== "undefined"
        ? createPortal(
            <div
              className="app-theme-scope io-modal-backdrop"
              onMouseDown={closeQuickFluid}
            >
              <div
                className="io-modal w-full max-w-xl p-5 space-y-4"
                role="dialog"
                aria-modal="true"
                data-qfluid-modal
                onMouseDown={e => e.stopPropagation()}
                onKeyDown={e => {
                  if (quickFluidSaving) return;
                  if (e.key === "Escape") { e.preventDefault(); closeQuickFluid(); return; }
                  if (e.key === "Enter" && !e.shiftKey && !showQuickFluidDropdown) { e.preventDefault(); void saveQuickFluid(); }
                }}
              >
                {ioModalPatientContext}
                <div className="flex items-start justify-between gap-3">
                  <div className="space-y-1">
                    <div className="text-sm font-semibold leading-none">Fluid</div>
                    <div className="flex items-center gap-2">
                      <span className="text-base font-medium leading-none">Fluid</span>
                      <span className="rounded px-1.5 py-0.5 text-[10px] font-bold leading-none bg-cyan-500/20 text-cyan-300">
                        {quickFluidEntryMode === "running"
                          ? "Running Drip"
                          : quickFluidEntryMode === "timed"
                            ? "Timed Drip"
                            : "Bolus"}
                      </span>
                    </div>
                  </div>
                  <button type="button" onClick={closeQuickFluid} disabled={quickFluidSaving}
                    className="rounded border border-[var(--app-border)] px-3 py-1.5 text-sm text-[var(--app-muted)] hover:bg-[var(--app-hover-bg)]">
                    Close
                  </button>
                </div>

                <div className="grid grid-cols-[72px_1fr] gap-x-3 gap-y-3 items-start text-sm">
                  <label className="pt-2 text-xs font-medium text-[var(--app-muted)] uppercase tracking-wide">Fluid</label>
                  <div className="relative">
                  <input
                    autoFocus
                    className="w-full rounded border border-[var(--app-border)] bg-[var(--app-control-bg)] px-3 py-2 text-sm"
                    placeholder="Search fluid..."
                    value={quickFluidSearch}
                    onChange={e => {
                      setQuickFluidSearch(e.target.value);
                      setQuickFluidItemId(null);
                      setShowQuickFluidDropdown(true);
                    }}
                    onFocus={() => setShowQuickFluidDropdown(true)}
                    onKeyDown={e => {
                      if (
                        showQuickFluidDropdown &&
                        filteredQuickFluidItems.length > 0 &&
                        (e.key === "Enter" || (e.key === "Tab" && !e.shiftKey))
                      ) {
                        e.preventDefault();
                        e.stopPropagation();
                        const item =
                          filteredQuickFluidItems.length === 1 || e.key === "Enter"
                            ? filteredQuickFluidItems[0]
                            : null;
                        if (item) {
                          setQuickFluidItemId(item.id);
                          setQuickFluidSearch(item.name);
                          setShowQuickFluidDropdown(false);
                          window.requestAnimationFrame(() => {
                            quickFluidVolumeRef.current?.focus();
                            quickFluidVolumeRef.current?.select();
                          });
                        } else {
                          quickFluidOptionRefs.current[0]?.focus();
                        }
                      }
                    }}
                  />
                  {showQuickFluidDropdown && filteredQuickFluidItems.length > 0 ? (
                    <>
                      <div
                        className="fixed inset-0 z-0"
                        onMouseDown={() => setShowQuickFluidDropdown(false)}
                      />
                      <div className="absolute z-10 mt-1 max-h-48 w-full overflow-y-auto rounded border border-[var(--app-border)] bg-[var(--app-panel-bg)] shadow-lg">
                        {filteredQuickFluidItems.map((item, index) => (
                          <button
                            key={`qfluid-${item.id}`}
                            type="button"
                            ref={el => { quickFluidOptionRefs.current[index] = el; }}
                            className="w-full border-b border-[var(--app-border)] px-3 py-2 text-left text-sm hover:bg-[var(--app-hover-bg)] last:border-0"
                            onClick={() => {
                              setQuickFluidItemId(item.id);
                              setQuickFluidSearch(item.name);
                              setShowQuickFluidDropdown(false);
                              window.requestAnimationFrame(() => {
                                quickFluidVolumeRef.current?.focus();
                                quickFluidVolumeRef.current?.select();
                              });
                            }}
                            onKeyDown={e => {
                              if (e.key === "ArrowDown") {
                                e.preventDefault();
                                e.stopPropagation();
                                quickFluidOptionRefs.current[Math.min(index + 1, filteredQuickFluidItems.length - 1)]?.focus();
                                return;
                              }
                              if (e.key === "ArrowUp") {
                                e.preventDefault();
                                e.stopPropagation();
                                if (index === 0) {
                                  const input = e.currentTarget.closest(".relative")?.querySelector("input");
                                  if (input instanceof HTMLInputElement) input.focus();
                                } else {
                                  quickFluidOptionRefs.current[index - 1]?.focus();
                                }
                                return;
                              }
                              if (e.key === "Enter" || (e.key === "Tab" && !e.shiftKey)) {
                                e.preventDefault();
                                e.stopPropagation();
                                setQuickFluidItemId(item.id);
                                setQuickFluidSearch(item.name);
                                setShowQuickFluidDropdown(false);
                                window.requestAnimationFrame(() => {
                                  quickFluidVolumeRef.current?.focus();
                                  quickFluidVolumeRef.current?.select();
                                });
                              }
                            }}
                          >
                            {item.name}
                          </button>
                        ))}
                      </div>
                    </>
                  ) : null}
                  </div>

                  <label className="pt-2 text-xs font-medium text-[var(--app-muted)] uppercase tracking-wide">Mode</label>
                  <div className="flex flex-wrap gap-2">
                    {[
                      { id: "bolus", label: "Bolus" },
                      { id: "timed", label: "Timed Drip" },
                      { id: "running", label: "Running Drip" },
                    ].map(mode => {
                      const active = quickFluidEntryMode === mode.id;
                      return (
                        <button
                          key={`qfluid-mode-${mode.id}`}
                          type="button"
                          className={`rounded border px-3 py-1.5 text-sm ${
                            active
                              ? "border-cyan-400 bg-cyan-500/20 text-cyan-100 shadow-[0_0_0_1px_rgba(34,211,238,0.25)]"
                              : "border-[var(--app-border)] text-[var(--app-muted)] hover:bg-[var(--app-hover-bg)]"
                          }`}
                          onClick={() => setQuickFluidEntryMode(mode.id as "bolus" | "timed" | "running")}
                          disabled={quickFluidSaving}
                        >
                          {mode.label}
                        </button>
                      );
                    })}
                  </div>

                  {quickFluidEntryMode === "running" ? (
                    <>
                      <label className="pt-2 text-xs font-medium text-[var(--app-muted)] uppercase tracking-wide">Rate</label>
                      <div className="flex items-center gap-2">
                        <input
                          ref={quickFluidVolumeRef}
                          type="number"
                          min="0"
                          step="1"
                          className="flex-1 rounded border border-[var(--app-border)] bg-[var(--app-control-bg)] px-3 py-2"
                          placeholder="0"
                          value={quickFluidRateMlHr}
                          onChange={e => setQuickFluidRateMlHr(e.target.value)}
                        />
                        <span className="text-[var(--app-muted)]">mL/hr</span>
                      </div>
                    </>
                  ) : (
                    <>
                      <label className="pt-2 text-xs font-medium text-[var(--app-muted)] uppercase tracking-wide">
                        {quickFluidEntryMode === "timed" ? "Volume / Time" : "Volume"}
                      </label>
                      <div className="flex items-center gap-2">
                        <input
                          ref={quickFluidVolumeRef}
                          type="number"
                          min="0"
                          step="1"
                          className="flex-1 rounded border border-[var(--app-border)] bg-[var(--app-control-bg)] px-3 py-2"
                          placeholder="0"
                          value={quickFluidVolumeMl}
                          onChange={e => setQuickFluidVolumeMl(e.target.value)}
                        />
                        <span className="text-[var(--app-muted)]">mL</span>
                        {quickFluidEntryMode === "timed" ? (
                          <>
                            <input
                              type="number"
                              min="0"
                              step="5"
                              className="w-24 rounded border border-[var(--app-border)] bg-[var(--app-control-bg)] px-3 py-2"
                              placeholder="over"
                              value={quickFluidOverMin}
                              onChange={e => setQuickFluidOverMin(e.target.value)}
                              onKeyDown={e => {
                                if (e.key === "Tab" && !e.shiftKey) {
                                  e.preventDefault();
                                  const modal = e.currentTarget.closest("[data-qfluid-modal]");
                                  const timeInput = modal?.querySelector<HTMLInputElement>("[data-qfluid-time]");
                                  timeInput?.focus();
                                  timeInput?.select();
                                }
                              }}
                            />
                            <span className="text-[var(--app-muted)]">min</span>
                          </>
                        ) : null}
                      </div>
                    </>
                  )}

                  <label className="pt-2 text-xs font-medium text-[var(--app-muted)] uppercase tracking-wide">Start</label>
                  <div className="flex gap-2">
                    <input
                      className="flex-1 rounded border border-[var(--app-border)] bg-[var(--app-control-bg)] px-3 py-2"
                      value={quickFluidDate}
                      onChange={e => setQuickFluidDate(formatDateInputDDMMYYYY(e.target.value))}
                      onBlur={e => { const n = normalizeDateInputDDMMYYYY(e.target.value); if (n) setQuickFluidDate(n); }}
                      placeholder="dd/mm/yyyy"
                      tabIndex={-1}
                    />
                    <input
                      data-qfluid-time
                      className="flex-1 rounded border border-[var(--app-border)] bg-[var(--app-control-bg)] px-3 py-2"
                      value={quickFluidTime}
                      onChange={e => setQuickFluidTime(formatTimeInputHHMM(e.target.value))}
                      onBlur={e => { const n = normalizeTimeInputHHMM(e.target.value); if (n) setQuickFluidTime(n); }}
                      placeholder="HH:mm"
                    />
                  </div>
                </div>

                {quickFluidError ? (
                  <div className="text-xs text-red-500 dark:text-red-400">{quickFluidError}</div>
                ) : null}

                <div className="flex justify-end gap-2 pt-1 border-t border-[var(--app-border)]">
                  <button type="button" onClick={closeQuickFluid} disabled={quickFluidSaving}
                    className="rounded border border-[var(--app-border)] px-3 py-1.5 text-sm text-[var(--app-muted)] hover:bg-[var(--app-hover-bg)]">
                    Cancel
                  </button>
                  <button type="button" onClick={() => void saveQuickFluid()} disabled={quickFluidSaving}
                    className={`rounded px-3 py-1.5 text-sm text-white ${quickFluidSaving ? "bg-gray-400 cursor-not-allowed" : "bg-teal-600 hover:bg-teal-700"}`}>
                    {quickFluidSaving ? "Saving..." : quickFluidEntryMode === "running" ? "Start Drip" : "Save"}
                  </button>
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}

      {ioDripModal && typeof document !== "undefined"
        ? createPortal(
            <div
              className="app-theme-scope io-modal-backdrop"
              onMouseDown={closeIoDripModal}
            >
              <div
                className="io-modal w-full max-w-2xl p-4 space-y-3"
                role="dialog"
                aria-modal="true"
                onMouseDown={e => e.stopPropagation()}
              >
                {ioModalPatientContext}
                <div className="flex items-start justify-between gap-3">
                  <div className="space-y-1">
                    <div className="text-sm font-semibold leading-none">
                      {ioDripModal.kind === "fluid"
                        ? "Edit Fluid Drip"
                        : ioDripModal.segmentId != null
                          ? "Edit Drip"
                          : "Add Drip"}
                    </div>
                    <div className="text-base font-medium leading-none">
                      {ioDripModal.itemName}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={closeIoDripModal}
                    className="rounded border px-3 py-1.5 text-sm"
                    disabled={ioDripSaving}
                  >
                    Close
                  </button>
                </div>

                <div className="space-y-2 text-sm">
                  {/* Start */}
                  <div className="grid grid-cols-[110px_1fr_120px] gap-2 items-center">
                    <label className="text-[var(--app-muted)]">Start</label>
                    <input
                      value={ioDripStartDate}
                      onChange={e => setIoDripStartDate(formatDateInputDDMMYYYY(e.target.value))}
                      onBlur={e => {
                        const normalized = normalizeDDMMYYYY(e.target.value);
                        if (normalized) setIoDripStartDate(normalized);
                      }}
                      className="rounded border px-2 py-1.5"
                      placeholder="dd/mm/yyyy"
                      readOnly={ioDripModal.kind === "fluid"}
                      disabled={ioDripModal.kind === "fluid"}
                    />
                    <input
                      value={ioDripStartTime}
                      onChange={e => setIoDripStartTime(formatTimeInputHHMM(e.target.value))}
                      onBlur={e => {
                        const normalized = normalizeHHMM(e.target.value);
                        if (normalized) setIoDripStartTime(normalized);
                      }}
                      className="rounded border px-2 py-1.5"
                      placeholder="HH:mm"
                      maxLength={5}
                      readOnly={ioDripModal.kind === "fluid"}
                      disabled={ioDripModal.kind === "fluid"}
                    />
                  </div>
                  {/* End — with ongoing toggle */}
                  <div className="grid grid-cols-[110px_1fr_120px] gap-2 items-center">
                    <label className="text-[var(--app-muted)]">End</label>
                    {ioDripOngoing ? (
                      <>
                        <div className="flex items-center gap-2">
                          <span className="rounded px-2 py-1 text-xs font-semibold bg-emerald-600/20 text-emerald-400">
                            Still running
                          </span>
                        </div>
                        <button
                          type="button"
                          onClick={() => setIoDripOngoing(false)}
                          className="rounded border px-2 py-1.5 text-xs text-[var(--app-muted)] hover:bg-white/5"
                        >
                          Set end time
                        </button>
                      </>
                    ) : (
                      <>
                        <input
                          value={ioDripEndDate}
                          onChange={e => setIoDripEndDate(formatDateInputDDMMYYYY(e.target.value))}
                          onBlur={e => {
                            const normalized = normalizeDDMMYYYY(e.target.value);
                            if (normalized) setIoDripEndDate(normalized);
                          }}
                          className="rounded border px-2 py-1.5"
                          placeholder="dd/mm/yyyy"
                        />
                        <div className="flex gap-1">
                          <input
                            value={ioDripEndTime}
                            onChange={e => setIoDripEndTime(formatTimeInputHHMM(e.target.value))}
                            onBlur={e => {
                              const normalized = normalizeHHMM(e.target.value);
                              if (normalized) setIoDripEndTime(normalized);
                            }}
                            className="rounded border px-2 py-1.5 flex-1 min-w-0"
                            placeholder="HH:mm"
                            maxLength={5}
                          />
                          <button
                            type="button"
                            onClick={() => { setIoDripOngoing(true); setIoDripEndDate(""); setIoDripEndTime(""); }}
                            className="rounded border px-2 py-1.5 text-xs text-[var(--app-muted)] hover:bg-white/5 shrink-0"
                            title="Clear end time"
                          >
                            ✕
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                  {/* Rate — primary field */}
                  <div className="grid grid-cols-[110px_1fr_120px] gap-2 items-center">
                    <label className="font-medium">Rate</label>
                    <input
                      type="number"
                      min="0"
                      step="0.0001"
                      value={ioDripRateValue}
                      onChange={e => setIoDripRateValue(e.target.value)}
                      className="rounded border px-2 py-1.5 font-medium"
                      placeholder="e.g. 5"
                      autoFocus
                    />
                    {ioDripModal.kind === "fluid" ? (
                      <div className="rounded border border-[var(--app-border)] bg-[var(--app-control-bg)] px-2 py-1.5 text-[var(--app-muted)]">
                        mL/hr
                      </div>
                    ) : (
                      <input
                        value={ioDripRateUnit}
                        onChange={e => setIoDripRateUnit(e.target.value)}
                        className="rounded border px-2 py-1.5"
                        placeholder="ml/hr"
                      />
                    )}
                  </div>
                  {/* Advanced toggle */}
                  <button
                    type="button"
                    onClick={() => setIoDripAdvanced(prev => !prev)}
                    className={`flex items-center gap-1 text-xs text-[var(--app-muted)] hover:text-[var(--app-text)] py-0.5 ${ioDripModal.kind === "fluid" ? "hidden" : ""}`}
                    hidden={ioDripModal.kind === "fluid"}
                    disabled={ioDripModal.kind === "fluid"}
                  >
                    <span>{ioDripAdvanced ? "▾" : "▸"}</span>
                    <span>Advanced (Dose / Carrier / Syringe / Note)</span>
                  </button>
                  {/* Advanced fields */}
                  {ioDripModal.kind !== "fluid" && ioDripAdvanced && (
                    <div className="space-y-2 pl-2 border-l-2 border-white/10">
                      <div className="grid grid-cols-[110px_1fr_120px] gap-2 items-center">
                        <label className="text-[var(--app-muted)]">Dose</label>
                        <input
                          type="number"
                          min="0"
                          step="0.0001"
                          value={ioDripDoseValue}
                          onChange={e => setIoDripDoseValue(e.target.value)}
                          className="rounded border px-2 py-1.5"
                          placeholder={`${ioDripModal.itemName} value`}
                        />
                        <select
                          value={ioDripDoseUnit}
                          onChange={e => setIoDripDoseUnit(e.target.value)}
                          className="rounded border px-2 py-1.5"
                        >
                          {DOSE_PER_KG_RATE_UNITS.map(unit => (
                            <option key={`clinical-chart-dose-unit-${unit}`} value={unit}>
                              {unit}
                            </option>
                          ))}
                          {!DOSE_PER_KG_RATE_UNITS.includes(ioDripDoseUnit as (typeof DOSE_PER_KG_RATE_UNITS)[number]) ? (
                            <option value={ioDripDoseUnit}>{ioDripDoseUnit}</option>
                          ) : null}
                        </select>
                      </div>
                      <div className="grid grid-cols-[110px_1fr_120px] gap-2 items-center">
                        <label className="text-[var(--app-muted)]">Carrier</label>
                        <input
                          type="number"
                          min="0"
                          step="0.0001"
                          value={ioDripCarrierValue}
                          onChange={e => setIoDripCarrierValue(e.target.value)}
                          className="rounded border px-2 py-1.5"
                          placeholder="Carrier mL/hr"
                        />
                        <div className="rounded border border-[var(--app-border)] bg-[var(--app-control-bg)] px-2 py-1.5 text-[var(--app-muted)]">
                          mL/hr
                        </div>
                      </div>
                      <div className="grid grid-cols-[110px_1fr_120px] gap-2 items-center">
                        <label className="text-[var(--app-muted)]">Weight</label>
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={ioDripWeightKg}
                          onChange={e => setIoDripWeightKg(e.target.value)}
                          className="rounded border px-2 py-1.5"
                          placeholder="Patient weight"
                        />
                        <div className="rounded border border-[var(--app-border)] bg-[var(--app-control-bg)] px-2 py-1.5 text-[var(--app-muted)]">
                          kg
                        </div>
                      </div>
                      <div className="grid grid-cols-[110px_1fr_120px] gap-2 items-center">
                        <label className="text-[var(--app-muted)]">Concentration</label>
                        <input
                          type="number"
                          min="0"
                          step="0.0001"
                          value={ioDripConcentration}
                          onChange={e => setIoDripConcentration(e.target.value)}
                          className="rounded border px-2 py-1.5"
                          placeholder="Concentration"
                        />
                        <div className="rounded border border-[var(--app-border)] bg-[var(--app-control-bg)] px-2 py-1.5 text-[var(--app-muted)]">
                          mg/mL
                        </div>
                      </div>
                      <div className="grid grid-cols-[110px_1fr_120px] gap-2 items-center">
                        <label className="text-[var(--app-muted)]">Med Volume</label>
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={ioDripMedVolume}
                          onChange={e => setIoDripMedVolume(e.target.value)}
                          className="rounded border px-2 py-1.5"
                          placeholder="Drug volume"
                        />
                        <div className="rounded border border-[var(--app-border)] bg-[var(--app-control-bg)] px-2 py-1.5 text-[var(--app-muted)]">
                          mL
                        </div>
                      </div>
                      <div className="grid grid-cols-[110px_1fr_120px] gap-2 items-center">
                        <label className="text-[var(--app-muted)]">Carrier Volume</label>
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={ioDripCarrierVolume}
                          onChange={e => setIoDripCarrierVolume(e.target.value)}
                          className="rounded border px-2 py-1.5"
                          placeholder="Carrier volume"
                        />
                        <div className="rounded border border-[var(--app-border)] bg-[var(--app-control-bg)] px-2 py-1.5 text-[var(--app-muted)]">
                          mL
                        </div>
                      </div>
                      <div className="grid grid-cols-[110px_1fr_120px] gap-2 items-center">
                        <label className="text-[var(--app-muted)]">Note</label>
                        <input
                          value={ioDripNote}
                          onChange={e => setIoDripNote(e.target.value)}
                          className="rounded border px-2 py-1.5 col-span-2"
                          placeholder="Optional note"
                        />
                      </div>
                    </div>
                  )}
                </div>

                {ioDripError ? (
                  <div className="text-xs text-red-600 dark:text-red-400">{ioDripError}</div>
                ) : null}

                <div className="flex justify-end gap-2">
                  {ioDripModal.kind !== "fluid" ? (
                    <button
                      type="button"
                      onClick={calculateIoDrip}
                      className="rounded border px-3 py-1.5 text-sm border-emerald-300/50 text-emerald-100 hover:bg-emerald-500/10"
                      disabled={ioDripSaving}
                    >
                      Calculate
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={closeIoDripModal}
                    className="rounded border px-3 py-1.5 text-sm"
                    disabled={ioDripSaving}
                  >
                    Cancel
                  </button>
                  {ioDripModal.kind === "fluid" && ioDripOngoing ? (
                    <button
                      type="button"
                      onClick={() => void saveIoDripModal(Date.now())}
                      className={`rounded px-3 py-1.5 text-sm text-white ${
                        ioDripSaving ? "bg-gray-400" : "bg-amber-600 hover:bg-amber-700"
                      }`}
                      disabled={ioDripSaving}
                    >
                      {ioDripSaving ? "Saving..." : "Stop Drip"}
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => void saveIoDripModal()}
                    className={`rounded px-3 py-1.5 text-sm text-white ${
                      ioDripSaving ? "bg-gray-400" : "bg-blue-600 hover:bg-blue-700"
                    }`}
                    disabled={ioDripSaving}
                  >
                    {ioDripSaving
                      ? "Saving..."
                      : ioDripModal.kind === "fluid"
                        ? (ioDripOngoing ? "Change Rate" : "Stop Drip")
                        : "Save"}
                  </button>
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}

      {ioPreparedModal && isModalMedicationBolus && typeof document !== "undefined"
        ? createPortal(
            <MedicationBolusEntryModal
              patientContext={ioModalPatientContext}
              medicationName={ioPreparedModal.itemName}
              date={ioModalDate}
              time={ioModalTime}
              doseValue={ioModalValue}
              doseUnit={ioModalUnit || ioPreparedModal.itemUnit || "mg"}
              note={ioModalNote}
              suggestion={preparedBolusSuggestion}
              localAnesthetic={isModalLocalAnesthetic ? {
                route: ioModalLocalRoute,
                routes: ["Local", "PNB", "Spinal", "Epidural", "Caudal"],
                concentration: ioModalLocalConcentration,
                volumeMl: ioModalLocalVolumeMl,
                onRouteChange: setIoModalLocalRoute,
                onConcentrationChange: setIoModalLocalConcentration,
                onVolumeChange: setIoModalLocalVolumeMl,
              } : null}
              saving={ioModalSaving}
              clearDisabled={modalExistingEvents.length === 0}
              error={ioModalError}
              saveLabel={modalExistingEvents.length > 0 ? "Update bolus" : "Record bolus"}
              onDateChange={value => setIoModalDate(formatDateInputDDMMYYYY(value))}
              onDateBlur={value => {
                const normalized = normalizeDDMMYYYY(value);
                if (normalized) setIoModalDate(normalized);
              }}
              onTimeChange={value => setIoModalTime(formatTimeInputHHMM(value))}
              onTimeBlur={value => {
                const normalized = normalizeHHMM(value);
                if (normalized) setIoModalTime(normalized);
              }}
              onDoseChange={setIoModalValue}
              onDoseUnitChange={setIoModalUnit}
              onNoteChange={setIoModalNote}
              onClose={closeIoModal}
              onClear={() => void clearPreparedValue()}
              onSave={() => void savePreparedValue()}
              onKeyDown={handleIoModalKeyDown}
            />,
            document.body,
          )
        : null}

      {ioPreparedModal && !isModalMedicationBolus && typeof document !== "undefined"
        ? createPortal(
            <div
              className="app-theme-scope io-modal-backdrop"
              onMouseDown={closeIoModal}
            >
              <div
                className="io-modal w-full max-w-2xl p-4 space-y-3"
                role="dialog"
                aria-modal="true"
                onMouseDown={e => e.stopPropagation()}
                onKeyDown={handleIoModalKeyDown}
              >
                <header className="flex items-start justify-between gap-4 border-b border-[var(--app-border)] pb-3">
                  <div className="flex min-w-0 items-center gap-5">
                    {isModalMedicationBolus ? (
                      <span className="mr-2 grid h-12 w-12 shrink-0 place-items-center overflow-hidden rounded-xl bg-[var(--timegrid-focus-bg)]">
                        <IoSpriteIcon name="medBolus" size={42} />
                      </span>
                    ) : null}
                    <div className="min-w-0">
                      <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-[var(--app-muted)]">
                        {isModalMedicationBolus
                          ? "Record medication"
                          : ioPreparedModal.kind === "output"
                            ? "Record output"
                            : ioPreparedModal.kind === "fluid"
                              ? "Record fluid"
                              : "Medication entry"}
                      </div>
                      {isModalMedicationBolus ? (
                        <>
                          <div className="flex min-w-0 flex-wrap items-center gap-2">
                            <h2 className="break-words text-2xl font-bold leading-tight text-[var(--app-text)]">
                              {ioPreparedModal.itemName}
                            </h2>
                            <span className="rounded-md bg-[#5B8FF9]/20 px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.08em] text-[#77A5FF]">
                              Bolus
                            </span>
                          </div>
                          <div className="mt-0.5 text-xs text-[var(--app-muted)]">One-time dose</div>
                        </>
                      ) : (
                        <>
                          <h2 className="truncate text-xl font-semibold leading-tight">{ioPreparedModal.itemName}</h2>
                          <div className="mt-0.5 truncate text-xs text-[var(--app-muted)]">
                            {ioPreparedModal.entryMode === "drip" ? "Drip" : "Entry"}
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <ClinicalReferenceTooltip text="Close" compact className="flex shrink-0">
                      <button
                        type="button"
                        aria-label="Close entry"
                        onClick={closeIoModal}
                        disabled={ioModalSaving}
                        className="grid h-10 w-10 place-items-center rounded-xl border border-[var(--app-border)] text-xl leading-none text-[var(--app-muted)] hover:bg-[var(--app-hover-bg)] hover:text-[var(--app-text)] disabled:opacity-50"
                      >
                        ×
                      </button>
                    </ClinicalReferenceTooltip>
                  </div>
                </header>
                {ioModalPatientContext}

                <div className="space-y-3 py-2">
                    {isModalMedicationBolus ? (
                      <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--app-muted)]">Administration</div>
                    ) : null}
                    <div className="grid grid-cols-[100px_1fr_120px] gap-2 items-center">
                      <label className="text-sm text-[var(--app-muted)] font-medium">Time</label>
                      <input
                        value={ioModalDate}
                        onChange={e => setIoModalDate(formatDateInputDDMMYYYY(e.target.value))}
                        onBlur={e => {
                          const normalized = normalizeDDMMYYYY(e.target.value);
                          if (normalized) setIoModalDate(normalized);
                        }}
                        className="rounded border border-[var(--app-border)] bg-[var(--app-control-bg)] px-2 py-1.5 text-sm"
                        placeholder="dd/mm/yyyy"
                      />
                      <input
                        value={ioModalTime}
                        onChange={e => setIoModalTime(formatTimeInputHHMM(e.target.value))}
                        onBlur={e => {
                          const normalized = normalizeHHMM(e.target.value);
                          if (normalized) setIoModalTime(normalized);
                        }}
                        className="rounded border border-[var(--app-border)] bg-[var(--app-control-bg)] px-2 py-1.5 text-sm"
                        placeholder="HH:mm"
                        maxLength={5}
                      />
                    </div>
                    {isModalBloodProduct ? (
                      <div className="grid grid-cols-[100px_1fr] gap-2 items-center">
                        <div />
                        {(() => {
                          const selectedTs = toTsFromDateAndTime(ioModalDate, ioModalTime);
                          const ok = selectedTs != null && hasTimeOutBefore(selectedTs);
                          return (
                            <div className={`rounded border px-3 py-2 text-xs ${
                              ok
                                ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                                : "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300"
                            }`}>
                              Time Out: {ok ? "completed before giving time" : "required before giving"}
                            </div>
                          );
                        })()}
                      </div>
                    ) : null}
                    {isModalBloodProduct ? (
                      <div className="grid grid-cols-[100px_1fr_auto] gap-2 items-center">
                        <label className="text-sm text-[var(--app-muted)] font-medium">
                          Bag No.
                        </label>
                        <input
                          type="text"
                          className="rounded border border-[var(--app-border)] bg-[var(--app-control-bg)] px-2 py-1.5 text-sm w-full"
                          placeholder="Blood bag number"
                          autoFocus
                          value={ioModalBloodBagNo}
                          onChange={e => {
                            setIoModalBloodBagNo(e.target.value);
                            resetIoModalBloodVerification();
                          }}
                        />
                        <button
                          type="button"
                          onClick={() => void checkIoModalBloodProductBag()}
                          disabled={ioModalBloodChecking || ioModalSaving}
                          className={`rounded px-3 py-1.5 text-sm text-white ${
                            ioModalBloodChecking || ioModalSaving
                              ? "bg-gray-400 cursor-not-allowed"
                              : "bg-blue-600 hover:bg-blue-700"
                          }`}
                        >
                          {ioModalBloodChecking ? "Checking..." : "Check Bag"}
                        </button>
                      </div>
                    ) : null}
                    {ioModalBloodVerified || ioModalBloodVerificationMode === "manual" ? (
                      <div className="grid grid-cols-[100px_1fr] gap-2 items-center">
                        <div />
                        {renderBloodIdentityComparison(
                          ioModalBloodVerified,
                          ioModalBloodVerificationMode,
                        )}
                      </div>
                    ) : null}
                    {ioModalBloodVerificationMode === "manual" ? (
                      <div className="grid grid-cols-[100px_1fr] gap-2 items-center">
                        <div />
                        <div className="rounded border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
                          Manual check confirmed. This record will be marked verification:manual.
                        </div>
                      </div>
                    ) : null}
                    {ioModalBloodVerificationMode === "registered" ? (
                      <div className="grid grid-cols-[100px_1fr] gap-2 items-center">
                        <div />
                        <div className="rounded border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-700 dark:text-emerald-300">
                          Bag matched the registered warmer bag. This record will be marked verification:registered.
                        </div>
                      </div>
                    ) : null}
                    {modalRequiresBloodGroup ? (
                      <div className="grid grid-cols-[100px_1fr] gap-2 items-center">
                        <label className="text-sm text-[var(--app-muted)] font-medium">
                          Group
                        </label>
                        <input
                          type="text"
                          list="clinical-chart-blood-groups"
                          className="rounded border border-[var(--app-border)] bg-[var(--app-control-bg)] px-2 py-1.5 text-sm w-full uppercase"
                          placeholder="A+, O-, ..."
                          value={ioModalBloodGroup}
                          onChange={e => setIoModalBloodGroup(e.target.value.toUpperCase())}
                          maxLength={4}
                        />
                      </div>
                    ) : null}
                    {isModalLocalAnesthetic ? (
                      <>
                        <div className="grid grid-cols-[100px_1fr] gap-2 items-center">
                          <label className="text-sm text-[var(--app-muted)] font-medium">Route</label>
                          <select
                            className="rounded border border-[var(--app-border)] bg-[var(--app-control-bg)] px-2 py-1.5 text-sm w-full"
                            value={ioModalLocalRoute}
                            onChange={e => setIoModalLocalRoute(e.target.value)}
                          >
                            {["Local", "PNB", "Spinal", "Epidural", "Caudal"].map(route => (
                              <option key={`io-local-route-${route}`} value={route}>
                                {route}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div className="grid grid-cols-[100px_1fr_90px] gap-2 items-center">
                          <label className="text-sm text-[var(--app-muted)] font-medium">Conc. %</label>
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            autoFocus
                            className="rounded border border-[var(--app-border)] bg-[var(--app-control-bg)] px-2 py-1.5 text-sm"
                            placeholder="%"
                            value={ioModalLocalConcentration}
                            onChange={e => setIoModalLocalConcentration(e.target.value)}
                          />
                          <div className="px-2 py-1.5 text-sm bg-black/5 dark:bg-white/5 rounded min-w-[60px] text-center border border-[var(--app-border)]">
                            mg/mL
                          </div>
                        </div>
                        <div className="grid grid-cols-[100px_1fr_90px] gap-2 items-center">
                          <label className="text-sm text-[var(--app-muted)] font-medium">Volume</label>
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            className="rounded border border-[var(--app-border)] bg-[var(--app-control-bg)] px-2 py-1.5 text-sm"
                            placeholder="0.00"
                            value={ioModalLocalVolumeMl}
                            onChange={e => setIoModalLocalVolumeMl(e.target.value)}
                          />
                          <div className="px-2 py-1.5 text-sm bg-black/5 dark:bg-white/5 rounded min-w-[60px] text-center border border-[var(--app-border)]">
                            mL
                          </div>
                        </div>
                      </>
                    ) : (
                      <div className="grid grid-cols-[100px_1fr] gap-2 items-center">
                        <label className="text-sm text-[var(--app-muted)] font-medium">
                          {ioPreparedModal.kind === "med" ? "Dose" : "Volume"}
                        </label>
                        <div className="flex items-center gap-2">
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            autoFocus={!isModalBloodProduct}
                            className={`flex-1 rounded border border-[var(--app-border)] bg-[var(--app-control-bg)] px-3 py-2 tabular-nums ${isModalMedicationBolus ? "text-lg font-semibold" : "text-sm"}`}
                            placeholder="0.00"
                            value={ioModalValue}
                            onChange={e => setIoModalValue(e.target.value)}
                          />
                          <div className="grid min-w-[72px] place-items-center self-stretch rounded border border-[var(--app-border)] bg-black/5 px-2 text-sm font-semibold dark:bg-white/5">
                            {ioPreparedModal.kind === "med" ? ioModalUnit || ioPreparedModal.itemUnit || "mg" : "mL"}
                          </div>
                        </div>
                      </div>
                    )}
                    {preparedBolusSuggestion && !isModalLocalAnesthetic ? (
                      <div className="grid grid-cols-[100px_1fr] gap-2 items-center">
                        <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--app-muted)]">Suggestion</span>
                        <div className="flex flex-wrap gap-2">
                          {preparedBolusSuggestion.doses.map(dose => {
                            const selected = Number(ioModalValue) === dose && ioModalUnit === preparedBolusSuggestion.unit;
                            return (
                              <button
                                key={`${ioPreparedModal.itemId}-${dose}-${preparedBolusSuggestion.unit}`}
                                type="button"
                                aria-pressed={selected}
                                onClick={() => {
                                  setIoModalValue(String(dose));
                                  setIoModalUnit(preparedBolusSuggestion.unit);
                                }}
                                className={`min-h-8 rounded-lg border px-3 py-1 text-xs font-bold tabular-nums ${selected ? "border-[var(--app-accent)] bg-[var(--app-accent)] text-[var(--app-accent-contrast)]" : "border-[var(--app-border)] bg-[var(--app-panel-bg)] text-[var(--app-text)] hover:bg-[var(--app-hover-bg)]"}`}
                              >
                                {dose} {preparedBolusSuggestion.unit}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    ) : null}
                    <div className="grid grid-cols-[100px_1fr] gap-2 items-center">
                      <label className="text-sm text-[var(--app-muted)] font-medium">Note</label>
                      <input
                        type="text"
                        className="rounded border border-[var(--app-border)] bg-[var(--app-control-bg)] px-2 py-1.5 text-sm w-full"
                        placeholder="Optional note"
                        value={ioModalNote}
                        onChange={e => setIoModalNote(e.target.value)}
                      />
                    </div>
                </div>

                {ioModalError ? (
                  <div className="text-xs text-red-600 dark:text-red-400 px-1">{ioModalError}</div>
                ) : null}
                <datalist id="clinical-chart-blood-groups">
                  {BLOOD_GROUP_OPTIONS.map(group => (
                    <option key={group} value={group} />
                  ))}
                </datalist>

                <div className="flex items-center justify-between gap-3 pt-3 border-t border-[var(--app-border)]">
                  <div className="text-xs text-[var(--app-muted)]">
                    {isModalMedicationBolus ? "Enter to record · Esc to close" : null}
                  </div>
                  <div className="flex shrink-0 gap-2">
                  <button
                    type="button"
                    onClick={closeIoModal}
                    className="rounded border px-4 py-2 text-sm font-medium hover:bg-black/5 dark:hover:bg-white/5"
                    disabled={ioModalSaving}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => void clearPreparedValue()}
                    className={`rounded px-4 py-2 text-sm font-medium text-white ${
                      ioModalSaving || modalExistingEvents.length === 0
                        ? "bg-gray-400"
                        : "bg-red-600 hover:bg-red-700"
                    }`}
                    disabled={ioModalSaving || modalExistingEvents.length === 0}
                  >
                    Clear
                  </button>
                  {isModalBloodProduct && ioModalBloodManualAvailable ? (
                    <button
                      type="button"
                      onClick={confirmIoModalBloodManualCheck}
                      className={`rounded border border-amber-500/50 px-4 py-2 text-sm font-medium ${
                        ioModalSaving
                          ? "text-gray-400"
                          : "text-amber-700 hover:bg-amber-500/10 dark:text-amber-300"
                      }`}
                      disabled={ioModalSaving}
                    >
                      Confirm Manual Check
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => void savePreparedValue()}
                    className={`rounded-lg px-4 py-2 text-sm font-semibold ${
                      ioModalSaving ? "bg-gray-400 text-white" : "bg-[var(--app-accent)] text-[var(--app-accent-contrast)] hover:brightness-105"
                    }`}
                    disabled={ioModalSaving}
                  >
                    {ioModalSaving
                      ? "Saving..."
                      : isModalMedicationBolus
                        ? modalExistingEvents.length > 0 ? "Update bolus" : "Record bolus"
                        : "Save"}
                  </button>
                  </div>
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}

    </div>
  );
}
