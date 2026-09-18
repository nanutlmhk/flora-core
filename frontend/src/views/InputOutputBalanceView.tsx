import { useEffect, useMemo, useState } from "react";
import type { KeyboardEvent } from "react";
import { useRef } from "react";
import ioIconSetUrl from "../assets/ioiconset.png";
import inputIconSetUrl from "../assets/inputset.png";
import bloodLossIconUrl from "../assets/bloodloss.png";
import urineIconUrl from "../assets/urine.png";
import type { CaseStatus } from "../api/caseApi";
import {
  getCasePatientInfo,
  type CasePatientInfo,
} from "../api/caseHisApi";
import { useAuth } from "../auth/useAuth";
import ConfirmDialog from "../components/common/ConfirmDialog";
import ClinicalReferenceTooltip from "../components/common/ClinicalReferenceTooltip";
import {
  createCaseIoEvent,
  createCaseIoSegment,
  createCaseIoRun,
  createCaseIoDrip,
  replaceCaseIoDrip,
  createCaseIoBloodProduct,
  deleteCaseIoEvent,
  discontinueCaseIoRun,
  getCaseIoEvents,
  getCaseIoItems,
  getCaseIoRuns,
  getCaseIoSummary,
  updateCaseIoRun,
  updateCaseIoSegment,
  type CaseIoEvent,
  type CaseIoItem,
  type CaseIoRun,
  type CaseIoRunSegment,
  type CaseIoSummaryTotals,
} from "../api/caseIoApi";
import {
  createIoCatalogEntry,
  deactivateIoCatalogEntry,
  getIoCatalog,
  getIoGroups,
  type IoCatalogItem,
  type IoGroup,
  type IoKind,
  updateIoCatalogEntry,
} from "../api/ioCatalogApi";
import {
  formatDateInputDDMMYYYY,
  formatTimeInputHHMM,
  normalizeDateInputDDMMYYYY,
  normalizeTimeInputHHMM,
} from "../utils/clinicalInput";
import {
  formatPatientDisplayName,
  normalizePatientNameLanguage,
} from "../utils/patientName";

type Props = {
  caseStatus: CaseStatus;
  mode?: IoBalanceTab;
};

type IoBalanceTab = "current" | "master";
type EntryMode = "bolus" | "drip";
type DisplayMode = EntryMode | "output";
type MedicationSummaryView = "summary" | "detail";
const MEDICATION_SUMMARY_VIEW_STORAGE_KEY = "flora:io-medication-summary-view";
const FLUID_BALANCE_VIEW_STORAGE_KEY = "flora:io-fluid-balance-view";

function readMedicationSummaryView(): MedicationSummaryView {
  try {
    return window.localStorage.getItem(MEDICATION_SUMMARY_VIEW_STORAGE_KEY) === "detail"
      ? "detail"
      : "summary";
  } catch {
    return "summary";
  }
}

function readFluidBalanceView(): MedicationSummaryView {
  try {
    return window.localStorage.getItem(FLUID_BALANCE_VIEW_STORAGE_KEY) === "detail"
      ? "detail"
      : "summary";
  } catch {
    return "summary";
  }
}

type IoIconName =
  | "input"
  | "output"
  | "balance"
  | "activeDrips"
  | "medBolus"
  | "medDrip"
  | "fluid"
  | "bloodProduct"
  | "bloodLoss"
  | "urine";
type NonIdleCaseStatus = Exclude<CaseStatus, { status: "IDLE" }>;
type DetailedGroup = {
  id: string;
  label: string;
  kind: IoKind;
  category: string;
  isActive?: boolean;
};

const card =
  "rounded-2xl border border-[var(--app-border)] bg-[var(--app-panel-bg)] p-4 space-y-4 shadow-[0_14px_40px_rgba(0,0,0,0.08)]";
const primaryButton = "rounded px-3 py-1.5 text-sm text-white";
const primaryEnabled = "bg-blue-600 hover:bg-blue-700";
const primaryDisabled = "bg-gray-400 cursor-not-allowed";
const secondaryButton =
  "rounded border border-gray-300 dark:border-gray-700 px-3 py-1.5 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800";
const dangerButton =
  "rounded border border-red-400 text-red-600 dark:text-red-300 px-3 py-1.5 text-sm";
const accentButton =
  "rounded border border-blue-400 text-blue-600 dark:text-blue-300 px-3 py-1.5 text-sm";

const KIND_OPTIONS: Array<{ id: IoKind; label: string; defaultUnit: string }> = [
  { id: "med", label: "Medication", defaultUnit: "mg" },
  { id: "fluid", label: "Fluid", defaultUnit: "ml" },
  { id: "output", label: "Output", defaultUnit: "ml" },
];

const DETAILED_GROUPS: DetailedGroup[] = [
  { id: "fluids", label: "Fluids", kind: "fluid", category: "fluids" },
  { id: "bloodProduct", label: "Blood Product", kind: "fluid", category: "bloodProduct" },
  { id: "ivAnesthetic", label: "IV Anesthetic", kind: "med", category: "ivAnesthetic" },
  { id: "opioid", label: "Opioid", kind: "med", category: "opioid" },
  { id: "nmbd", label: "NMBD", kind: "med", category: "nmbd" },
  { id: "reversal", label: "Reversal", kind: "med", category: "reversal" },
  { id: "anticholinergic", label: "Anticholinergic", kind: "med", category: "anticholinergic" },
  { id: "antiEmetic", label: "Anti-emetic", kind: "med", category: "antiEmetic" },
  { id: "analgesic", label: "Analgesic", kind: "med", category: "analgesic" },
  { id: "cvDrug", label: "CV Drug", kind: "med", category: "cvDrug" },
  { id: "antimicrobial", label: "Antibiotics", kind: "med", category: "antimicrobial" },
  { id: "localAnesthetic", label: "Local Anesthetic", kind: "med", category: "localAnesthetic" },
  { id: "other", label: "Other", kind: "med", category: "other" },
  { id: "urineOutput", label: "Urine", kind: "output", category: "urineOutput" },
  { id: "bloodLossOutput", label: "Blood Loss", kind: "output", category: "bloodLossOutput" },
  { id: "otherOutput", label: "Other Output", kind: "output", category: "otherOutput" },
];

const DETAILED_GROUP_BY_ID = new Map(DETAILED_GROUPS.map(group => [group.id, group]));
const ROUTE_OPTIONS = [
  "IV",
  "Local",
  "Spinal",
  "Epidural",
  "PNB",
  "Local infiltration",
  "Caudal",
  "IM",
  "Intranasal",
  "Eye Drop",
  "SC",
  "Spray vocal cord",
  "PNB Catheter",
  "Nebulisation",
] as const;
const DEFAULT_ROUTE = "IV";
const ROUTE_DISABLED_GROUP_IDS = new Set(["urineOutput", "bloodLossOutput"]);
const UOM_OPTIONS = [
  "mg",
  "g",
  "mcg",
  "NB",
  "time",
  "ml",
  "units",
  "MUnits",
] as const;
const DOSE_PER_KG_RATE_UNITS = [
  "mcg/kg/min",
  "mg/kg/min",
  "mcg/kg/hr",
  "mg/kg/hr",
] as const;
const DOSE_RATE_UNITS = [
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
const BLOOD_GROUP_OPTIONS = ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"] as const;
const LOCAL_ANESTHETIC_GROUP_ID = "localAnesthetic";
const DEFAULT_LOCAL_ANESTHETIC_ROUTE = "Local";

type HistoricalBolusSuggestion = {
  unit: string;
  doses: number[];
};

// Common positive bolus records in the NIT Innovian archive, 2024–2026.
// These are optional entry shortcuts, not prescribing defaults.
const HISTORICAL_BOLUS_SUGGESTIONS: Record<string, HistoricalBolusSuggestion> = {
  fentanyl: { unit: "mcg", doses: [25, 50, 100] },
  propofol: { unit: "mg", doses: [20, 30, 50, 100] },
  midazolam: { unit: "mg", doses: [1, 2] },
  cisatracurium: { unit: "mg", doses: [2, 10] },
  atracurium: { unit: "mg", doses: [10, 40, 50] },
  rocuronium: { unit: "mg", doses: [10, 40, 50] },
  ephedrine: { unit: "mg", doses: [3, 6] },
  phenylephrine: { unit: "mcg", doses: [50, 100] },
  atropine: { unit: "mg", doses: [0.3, 0.6, 1.2] },
  cefazolin: { unit: "g", doses: [1, 2] },
};

const POPULAR_BOLUS_DRUGS = [
  "Fentanyl",
  "Propofol",
  "Midazolam",
  "Rocuronium",
  "Ephedrine",
  "Phenylephrine",
] as const;

const IO_ICON_CROPS: Record<IoIconName, { x: number; y: number }> = {
  input: { x: 111, y: 146 },
  output: { x: 456, y: 146 },
  balance: { x: 801, y: 146 },
  activeDrips: { x: 1159, y: 146 },
  medBolus: { x: 111, y: 532 },
  medDrip: { x: 456, y: 532 },
  fluid: { x: 801, y: 532 },
  bloodProduct: { x: 1159, y: 532 },
  bloodLoss: { x: 0, y: 0 },
  urine: { x: 0, y: 0 },
};

const INPUT_ICON_CROPS: Partial<Record<IoIconName, { x: number; y: number }>> = {
  medBolus: { x: 107, y: 124 },
  medDrip: { x: 636, y: 124 },
  fluid: { x: 1157, y: 124 },
  bloodProduct: { x: 1688, y: 124 },
};

function IoSpriteIcon({
  name,
  size = 40,
  className = "",
}: {
  name: IoIconName;
  size?: number;
  className?: string;
}) {
  const standaloneCrop =
    name === "bloodLoss"
      ? { x: 210, y: 70, size: 900, width: 1325, height: 1187, url: bloodLossIconUrl }
      : name === "urine"
        ? { x: 160, y: 115, size: 930, width: 1254, height: 1254, url: urineIconUrl }
        : null;
  const inputCrop = INPUT_ICON_CROPS[name];
  const cropSize = standaloneCrop?.size ?? (inputCrop ? 380 : 260);
  const scale = size / cropSize;
  const crop = standaloneCrop || inputCrop || IO_ICON_CROPS[name];
  const spriteWidth = standaloneCrop?.width ?? (inputCrop ? 2172 : 1536);
  const spriteHeight = standaloneCrop?.height ?? (inputCrop ? 724 : 1024);
  return (
    <span
      className={`inline-block shrink-0 ${className}`}
      aria-hidden="true"
      style={{
        width: size,
        height: size,
        backgroundImage: `url(${standaloneCrop?.url ?? (inputCrop ? inputIconSetUrl : ioIconSetUrl)})`,
        backgroundRepeat: "no-repeat",
        backgroundSize: `${spriteWidth * scale}px ${spriteHeight * scale}px`,
        backgroundPosition: `${-crop.x * scale}px ${-crop.y * scale}px`,
        imageRendering: "pixelated",
      }}
    />
  );
}

function fmt(ts?: number) {
  if (!Number.isFinite(ts) || !ts || ts <= 0) return "-";
  const d = new Date(ts);
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yy = d.getFullYear();
  const hh = String(d.getHours()).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");
  return `${dd}/${mm}/${yy} ${hh}:${min}`;
}

function fmtHHMM(ts?: number) {
  if (!Number.isFinite(ts) || !ts || ts <= 0) return "--:--";
  const d = new Date(ts);
  const hh = String(d.getHours()).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");
  return `${hh}:${min}`;
}

function toDateInput(ts: number) {
  const d = new Date(ts);
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

function toTimeInput(ts: number) {
  const d = new Date(ts);
  const hh = String(d.getHours()).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");
  return `${hh}:${min}`;
}

function combineDateAndTime(
  dateValue: string,
  timeValue: string,
  fallbackTs: number,
): number {
  const datePart = normalizeDateInputDDMMYYYY(dateValue);
  const timePart = normalizeTimeInputHHMM(timeValue);
  if (!datePart || !timePart) return fallbackTs;

  const dateMatch = datePart.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  const timeMatch = timePart.match(/^(\d{2}):(\d{2})$/);
  if (!dateMatch || !timeMatch) return fallbackTs;

  const dd = Number(dateMatch[1]);
  const mm = Number(dateMatch[2]);
  const yyyy = Number(dateMatch[3]);
  const hh = Number(timeMatch[1]);
  const min = Number(timeMatch[2]);

  if (
    !Number.isFinite(dd) ||
    !Number.isFinite(mm) ||
    !Number.isFinite(yyyy) ||
    !Number.isFinite(hh) ||
    !Number.isFinite(min) ||
    hh < 0 ||
    hh > 23 ||
    min < 0 ||
    min > 59
  ) {
    return fallbackTs;
  }

  const dt = new Date(yyyy, mm - 1, dd, hh, min, 0, 0);
  if (
    dt.getFullYear() !== yyyy ||
    dt.getMonth() !== mm - 1 ||
    dt.getDate() !== dd
  ) {
    return fallbackTs;
  }
  return dt.getTime();
}

function hasValidDateTimeInput(dateValue: string, timeValue: string): boolean {
  return Number.isFinite(combineDateAndTime(dateValue, timeValue, NaN));
}

function parsePositiveNumber(raw: string): number | null {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function round4(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

function concentrationPercentToMg(concentrationPercent: number, volumeMl: number): number {
  return concentrationPercent * 10 * volumeMl;
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

function asNumber(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function normalizeToken(value: unknown): string {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function scoreMedDripMatch(item: CaseIoItem, keyword: string): number {
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

function medDripPrefixDistance(item: CaseIoItem, keyword: string): number {
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

function scoreMedDripFuzzyMatch(item: CaseIoItem, keyword: string): number {
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
    const maxAllowed = keyword.length >= 8 ? 2 : keyword.length >= 5 ? 1 : 0;
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
  const categoryToken = normalizeToken(run.item_category);
  if (categoryToken !== "bloodproduct") return null;

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

function resolveBloodProductItemType(item: CaseIoItem | null): "PRC" | "FFP" | null {
  if (!item) return null;
  if (normalizeToken(item.category) !== "bloodproduct") return null;

  const combined = `${normalizeToken(item.code)} ${normalizeToken(item.name)}`.trim();
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
  return normalizeToken(run.item_category) === "bloodproduct";
}

function buildEntryNote(
  baseNote: string,
  bloodType: "PRC" | "FFP" | null,
  bloodGroup: string,
  bloodBagNo: string,
  includeBloodMeta: boolean,
): string {
  const parts = [String(baseNote || "").trim()];
  if (includeBloodMeta) {
    if (bloodType) parts.push(`bloodProductType:${bloodType}`);
    if (bloodGroup) parts.push(`bloodGroup:${bloodGroup}`);
    if (bloodBagNo) parts.push(`bloodBagNo:${bloodBagNo}`);
  }
  return parts.filter(Boolean).join(" | ");
}

function groupOptionLabel(group: DetailedGroup): string {
  return group.label;
}

function resolveGroupId(
  kind: IoKind,
  category: string | undefined,
  code?: string | undefined,
  groups: DetailedGroup[] = DETAILED_GROUPS,
): string {
  const categoryToken = normalizeToken(category);
  const codeToken = normalizeToken(code);

  const byCategory = groups.find(
    group => normalizeToken(group.category) === categoryToken && group.kind === kind,
  );
  if (byCategory) return byCategory.id;

  if (kind === "output") {
    if (codeToken.includes("urine")) return "urineOutput";
    if (codeToken.includes("bloodloss")) return "bloodLossOutput";
    return "otherOutput";
  }

  if (kind === "fluid") {
    if (categoryToken.includes("blood")) return "bloodProduct";
    return "fluids";
  }

  if (
    categoryToken.includes("musclerelaxant") ||
    categoryToken.includes("relaxantdrip") ||
    categoryToken.includes("relaxant") ||
    categoryToken.includes("nmba") ||
    categoryToken.includes("neuromuscular")
  ) {
    return "nmbd";
  }
  if (categoryToken.includes("opioid")) return "opioid";
  if (categoryToken.includes("anesthetic") || categoryToken.includes("anaesthetic")) {
    return "ivAnesthetic";
  }
  if (categoryToken.includes("ivanesth")) {
    return "ivAnesthetic";
  }
  if (
    categoryToken.includes("vasopressor") ||
    categoryToken.includes("inotrope") ||
    categoryToken.includes("inotropedrip") ||
    categoryToken.includes("cvdrug") ||
    categoryToken.includes("antiht") ||
    categoryToken.includes("antiarrhythmia") ||
    categoryToken.includes("antiarrhyth")
  ) {
    return "cvDrug";
  }
  if (categoryToken.includes("antiemetic")) return "antiEmetic";
  if (categoryToken.includes("anticholinergic")) return "anticholinergic";
  if (categoryToken.includes("antibiotic") || categoryToken.includes("antimicrobial"))
    return "antimicrobial";
  if (categoryToken.includes("localanesth") || categoryToken.includes("localplusopioid"))
    return "localAnesthetic";
  if (categoryToken.includes("reversal")) return "reversal";
  if (
    categoryToken.includes("analgesic") ||
    categoryToken.includes("nsaid") ||
    categoryToken.includes("nonopioid")
  )
    return "analgesic";
  if (
    categoryToken.includes("steroid") ||
    categoryToken.includes("bronchodilator") ||
    categoryToken.includes("antiepileptic") ||
    categoryToken.includes("diuretic") ||
    categoryToken.includes("airwayanesth") ||
    categoryToken.includes("oraldrug") ||
    categoryToken.includes("externaldrug") ||
    categoryToken.includes("mannitol") ||
    categoryToken.includes("other")
  )
    return "other";
  return "other";
}

function formatQuantity(value: number): string {
  if (!Number.isFinite(value)) return "0";
  const rounded = Math.round(value * 100) / 100;
  if (Number.isInteger(rounded)) return String(rounded);
  return String(rounded);
}

function normalizeDisplayUnit(kind: IoKind, rawUnit: string): string {
  const unit = String(rawUnit || "").trim();
  const token = unit.toLowerCase();
  if (token === "ml") return "mL";
  if (token === "units") return "Units";
  if (token === "munits") return "MUnits";
  if (token === "units/hr") return "Units/hr";
  if (token === "units/min") return "Units/min";
  if (token === "munits/hr") return "MUnits/hr";
  if (token === "munits/min") return "MUnits/min";
  if (token === "ml/hr") return "mL/hr";
  if (token) return unit;
  return kind === "med" ? "mg" : "mL";
}

function formatGroupEventTotal(
  kind: IoKind,
  itemUnit: string,
  events: CaseIoEvent[],
): string | null {
  if (events.length === 0) return null;
  if (kind === "med") {
    const byUnit = new Map<string, number>();
    for (const event of events) {
      const dose = asNumber(event.dose_value);
      if (dose <= 0) continue;
      const unit = normalizeDisplayUnit(kind, event.dose_unit || itemUnit);
      byUnit.set(unit, (byUnit.get(unit) || 0) + dose);
    }
    if (byUnit.size === 0) return null;
    return Array.from(byUnit.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([unit, total]) => `${formatQuantity(total)} ${unit}`)
      .join(" + ");
  }
  let totalMl = 0;
  for (const event of events) {
    totalMl += asNumber(event.volume_ml);
  }
  if (totalMl <= 0) return null;
  return `${formatQuantity(totalMl)} mL`;
}

function formatEventValue(event: CaseIoEvent): string {
  if (event.kind === "med") {
    const dose = asNumber(event.dose_value);
    const doseText = dose > 0 ? `${dose} ${event.dose_unit || "mg"}`.trim() : "";
    // Local anesthetic events also store concentration% + volumeMl in note —
    // show as supplemental context after the primary mg dose.
    const tokens = parseNoteTokens(event.note);
    const conc = tokens["concentration"]; // e.g. "0.5%"
    const vol = tokens["volumeMl"];       // e.g. "20"
    if (conc && vol && doseText) return `${doseText} · ${conc} / ${vol} mL`;
    if (doseText) return doseText;
  }
  const volume = asNumber(event.volume_ml);
  if (volume > 0) return `${volume} mL`;
  return "-";
}

function formatSegmentValue(run: CaseIoRun, segment: CaseIoRunSegment): string {
  const from = fmtHHMM(segment.ts_from);
  const to = segment.ts_to ? fmtHHMM(segment.ts_to) : "...";
  const rate = Number(segment.rate_value);
  const rateText =
    Number.isFinite(rate) && rate > 0
      ? `${rate} ${normalizeDisplayUnit(run.kind, segment.rate_unit || "ml/hr")}`
      : "";
  const dose = Number(segment.dose_value);
  const doseText =
    Number.isFinite(dose) && dose > 0
      ? `${dose} ${normalizeDisplayUnit(run.kind, segment.dose_unit || run.item_unit || "")}`.trim()
      : "";
  const carrier = Number(segment.carrier_ml_per_hr);
  const carrierText =
    Number.isFinite(carrier) && carrier > 0 ? `carrier ${carrier} mL/hr` : "";
  const parts = [rateText, doseText, carrierText].filter(Boolean);
  return `${from}-${to}${parts.length > 0 ? ` | ${parts.join(" | ")}` : ""}`;
}

function parseNoteTokens(note: string | null | undefined): Record<string, string> {
  const result: Record<string, string> = {};
  const raw = String(note || "").trim();
  if (!raw) return result;
  for (const part of raw.split("|")) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const [rawKey, ...rest] = trimmed.split(":");
    const key = String(rawKey || "").trim();
    const value = rest.join(":").trim();
    if (!key || !value) continue;
    result[key] = value;
  }
  return result;
}

function currentDripSegment(run: CaseIoRun, nowTs: number): CaseIoRunSegment | null {
  if (!Array.isArray(run.segments) || run.segments.length === 0) return null;
  const usable = [...run.segments]
    .filter(segment => (segment.include_in_balance ?? 1) !== 0)
    .sort((a, b) => a.ts_from - b.ts_from || a.id - b.id);
  const active =
    usable.find(segment => {
      const from = Number(segment.ts_from);
      const to = segment.ts_to == null ? Number.POSITIVE_INFINITY : Number(segment.ts_to);
      return Number.isFinite(from) && from <= nowTs && nowTs < to;
    }) || null;
  return active || usable[usable.length - 1] || null;
}

function activeDripSegment(run: CaseIoRun, nowTs: number): CaseIoRunSegment | null {
  if (!Array.isArray(run.segments) || run.segments.length === 0) return null;
  const usable = [...run.segments]
    .filter(segment => (segment.include_in_balance ?? 1) !== 0)
    .sort((a, b) => a.ts_from - b.ts_from || a.id - b.id);
  const openSegment =
    [...usable]
      .reverse()
      .find(segment => segment.ts_to == null) || null;
  if (openSegment) return openSegment;
  return (
    usable.find(segment => {
      const from = Number(segment.ts_from);
      const to = segment.ts_to == null ? Number.POSITIVE_INFINITY : Number(segment.ts_to);
      return Number.isFinite(from) && from <= nowTs && nowTs < to;
    }) ||
    usable[usable.length - 1] ||
    null
  );
}

function dripSnapshot(run: CaseIoRun, nowTs: number) {
  const segment = currentDripSegment(run, nowTs);
  if (!segment) return null;

  const runMeta = parseNoteTokens(run.note);
  const segmentMeta = parseNoteTokens(segment.note);
  const carrier = String(runMeta.carrier || "Undilute").trim() || "Undilute";
  const preparedVolumeMl =
    parsePositiveNumber(runMeta.totalVolumeMl) ??
    parsePositiveNumber(segmentMeta.dripVolumeMl) ??
    null;
  const medAmount = parsePositiveNumber(runMeta.medAmount);
  const medUnit = String(runMeta.medUnit || run.item_unit || "").trim() || "mg";

  const rateValue = Number(segment.rate_value);
  const rateUnit = String(segment.rate_unit || "ml/hr").trim() || "ml/hr";
  const doseValue = Number(segment.dose_value);
  const doseUnit = String(segment.dose_unit || run.item_unit || "").trim();
  const startedAt = Number(segment.ts_from || run.started_at || 0);
  const endedAt =
    segment.ts_to == null ? null : Number(segment.ts_to);
  const stoppedAt =
    run.stopped_at != null && Number.isFinite(Number(run.stopped_at))
      ? Number(run.stopped_at)
      : endedAt;
  const elapsedUntil =
    stoppedAt != null && Number.isFinite(stoppedAt) ? Math.min(nowTs, stoppedAt) : nowTs;
  const infusedMl =
    Number.isFinite(rateValue) && rateValue > 0 && Number.isFinite(startedAt)
      ? Math.max(0, (elapsedUntil - startedAt) / 3_600_000) * rateValue
      : 0;
  const exceedsPreparedVolume =
    preparedVolumeMl != null && preparedVolumeMl > 0 && infusedMl > preparedVolumeMl;
  const progressPct =
    preparedVolumeMl != null && preparedVolumeMl > 0
      ? Math.max(0, Math.min(100, (infusedMl / preparedVolumeMl) * 100))
      : 0;

  return {
    carrier,
    preparedVolumeMl,
    medAmount,
    medUnit,
    rateText:
      Number.isFinite(rateValue) && rateValue > 0
        ? `${formatQuantity(rateValue)} ${normalizeDisplayUnit(run.kind, rateUnit)}`
        : "--",
    doseText:
      Number.isFinite(doseValue) && doseValue > 0
        ? `${formatQuantity(doseValue)} ${normalizeDisplayUnit(run.kind, doseUnit)}`.trim()
        : "--",
    preparedText:
      medAmount != null && preparedVolumeMl != null
        ? `${formatQuantity(medAmount)} ${normalizeDisplayUnit(run.kind, medUnit)} in ${formatQuantity(preparedVolumeMl)} mL`
        : preparedVolumeMl != null
          ? `${formatQuantity(preparedVolumeMl)} mL prepared`
          : null,
    infusedText:
      preparedVolumeMl != null
        ? `${formatQuantity(infusedMl)} / ${formatQuantity(preparedVolumeMl)} mL`
        : `${formatQuantity(infusedMl)} mL`,
    exceedsPreparedVolume,
    progressPct,
    startedText: fmtHHMM(run.started_at || startedAt),
    stoppedText:
      stoppedAt != null && Number.isFinite(stoppedAt) && stoppedAt <= nowTs
        ? fmtHHMM(stoppedAt)
        : null,
    isStopped:
      stoppedAt != null && Number.isFinite(stoppedAt) && stoppedAt <= nowTs,
    isUndiluted: normalizeToken(carrier) === "undilute",
  };
}

function resolveTypeLabel(
  kind: IoKind,
  category: string | undefined,
  code: string | undefined,
  name: string | undefined,
  groups: DetailedGroup[] = DETAILED_GROUPS,
): string {
  const groupId = resolveGroupId(kind, category || "", code || name || "", groups);
  const group = groups.find(candidate => candidate.id === groupId);
  if (group) return groupOptionLabel(group);
  if (kind === "med") return "Medication";
  if (kind === "fluid") return "Fluid";
  return "Output";
}

function getItemVisual(kind: IoKind, displayMode: DisplayMode, category = ""): {
  iconLabel: string;
  iconClass: string;
  badgeClass: string;
} {
  if (kind === "output" && normalizeToken(category) === "urineoutput") {
    return {
      iconLabel: "Out",
      iconClass: "bg-[#D99A24]/18 text-[#D99A24] border border-[#D99A24]/45",
      badgeClass: "bg-[#D99A24]/18 text-[#D99A24] border border-[#D99A24]/45",
    };
  }
  if (kind === "output" && normalizeToken(category) === "bloodlossoutput") {
    return {
      iconLabel: "Out",
      iconClass: "bg-[#8B2635]/18 text-[#8B2635] dark:text-[#d9828e] border border-[#8B2635]/45",
      badgeClass: "bg-[#8B2635]/18 text-[#8B2635] dark:text-[#d9828e] border border-[#8B2635]/45",
    };
  }
  if (kind === "output" || displayMode === "output") {
    return {
      iconLabel: "Out",
      iconClass: "bg-amber-500/15 text-amber-600 dark:text-amber-300 border border-amber-500/30",
      badgeClass: "bg-amber-500/15 text-amber-600 dark:text-amber-300 border border-amber-500/30",
    };
  }
  if (displayMode === "drip") {
    return {
      iconLabel: "Drip",
      iconClass: "bg-[#9B6DFF]/15 text-[#9B6DFF] border border-[#9B6DFF]/35",
      badgeClass: "bg-[#9B6DFF]/15 text-[#9B6DFF] border border-[#9B6DFF]/35",
    };
  }
  if (kind === "fluid" && normalizeToken(category) === "bloodproduct") {
    return {
      iconLabel: "BP",
      iconClass: "bg-[#E05252]/15 text-[#E05252] border border-[#E05252]/35",
      badgeClass: "bg-[#E05252]/15 text-[#E05252] border border-[#E05252]/35",
    };
  }
  if (kind === "fluid") {
    return {
      iconLabel: "F",
      iconClass: "bg-[#39C6C8]/15 text-[#39C6C8] border border-[#39C6C8]/35",
      badgeClass: "bg-[#39C6C8]/15 text-[#39C6C8] border border-[#39C6C8]/35",
    };
  }
  return {
    iconLabel: "Bol",
    iconClass: "bg-[#5B8FF9]/15 text-[#5B8FF9] border border-[#5B8FF9]/35",
    badgeClass: "bg-[#5B8FF9]/15 text-[#5B8FF9] border border-[#5B8FF9]/35",
  };
}

function ItemTypeIcon({
  kind,
  displayMode,
  category,
}: {
  kind: IoKind;
  displayMode: DisplayMode;
  category: string;
}) {
  if (kind === "output" || displayMode === "output") {
    if (normalizeToken(category) === "urineoutput") {
      return <IoSpriteIcon name="urine" size={34} />;
    }
    if (normalizeToken(category) === "bloodlossoutput") {
      return <IoSpriteIcon name="bloodLoss" size={34} />;
    }
    return <IoSpriteIcon name="output" size={34} />;
  }
  if (displayMode === "drip") {
    return <IoSpriteIcon name="medDrip" size={34} />;
  }
  if (kind === "fluid" && normalizeToken(category) === "bloodproduct") {
    return <IoSpriteIcon name="bloodProduct" size={34} />;
  }
  if (kind === "fluid") {
    return <IoSpriteIcon name="fluid" size={34} />;
  }
  return <IoSpriteIcon name="medBolus" size={34} />;
}

function defaultForm(kind: IoKind, category = ""): IoCatalogItem {
  const fallback =
    KIND_OPTIONS.find(option => option.id === kind)?.defaultUnit || "mg";
  return {
    kind,
    code: "",
    name: "",
    default_unit: fallback,
    category,
  };
}

export default function InputOutputBalanceView({ caseStatus, mode = "current" }: Props) {
  const { user: sessionUser } = useAuth();
  const caseId = caseStatus.status === "IDLE" ? null : caseStatus.case_id;
  const actor = useMemo(
    () => ({
      username: sessionUser?.username || "unknown",
      name: sessionUser?.name || undefined,
      role: sessionUser?.role || undefined,
    }),
    [sessionUser],
  );
  const notifyIoAndEventChanged = (targetCaseId: number) => {
    window.dispatchEvent(
      new CustomEvent("flora:case-io-changed", { detail: { caseId: targetCaseId } }),
    );
    window.dispatchEvent(
      new CustomEvent("flora:case-events-changed", { detail: { caseId: targetCaseId } }),
    );
  };
  const tab = mode;

  const [activeGroupId, setActiveGroupId] = useState("fluids");
  const [currentGroupId, setCurrentGroupId] = useState("");
  const [search, setSearch] = useState("");
  const [includeInactive, setIncludeInactive] = useState(false);
  const [directory, setDirectory] = useState<IoCatalogItem[]>([]);
  const [groupRows, setGroupRows] = useState<IoGroup[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [editingId, setEditingId] = useState<number | null>(null);
  const initialGroup = DETAILED_GROUP_BY_ID.get("fluids");
  const [form, setForm] = useState<IoCatalogItem>(() =>
    defaultForm(initialGroup?.kind || "fluid", initialGroup?.category || ""),
  );

  const [prepareItemId, setPrepareItemId] = useState<number | null>(null);
  const [itemSearch, setItemSearch] = useState("");
  const [showItemDropdown, setShowItemDropdown] = useState(false);
  const [prepareRoute, setPrepareRoute] = useState("");
  const [prepareUom, setPrepareUom] = useState("");
  const [prepareDate, setPrepareDate] = useState(() => toDateInput(Date.now()));
  const [prepareTime, setPrepareTime] = useState(() => toTimeInput(Date.now()));
  const [prepareDoseValue, setPrepareDoseValue] = useState("");
  const [prepareLocalConcentration, setPrepareLocalConcentration] = useState("");
  const [prepareLocalVolumeMl, setPrepareLocalVolumeMl] = useState("");
  const [medBolusComposerOpen, setMedBolusComposerOpen] = useState(false);
  const [medicationSummaryView, setMedicationSummaryView] = useState<MedicationSummaryView>(readMedicationSummaryView);
  const [fluidBalanceView, setFluidBalanceView] = useState<MedicationSummaryView>(readFluidBalanceView);
  const [currentItems, setCurrentItems] = useState<CaseIoItem[]>([]);
  const [currentRuns, setCurrentRuns] = useState<CaseIoRun[]>([]);
  const [currentEvents, setCurrentEvents] = useState<CaseIoEvent[]>([]);
  const [currentSummary, setCurrentSummary] = useState<CaseIoSummaryTotals | null>(null);
  const [casePatient, setCasePatient] = useState<CasePatientInfo | null>(null);
  const [currentLoading, setCurrentLoading] = useState(false);
  const [currentSaving, setCurrentSaving] = useState(false);
  const [removingRunId, setRemovingRunId] = useState<number | null>(null);
  const [pendingRemove, setPendingRemove] = useState<{
    runId: number;
    itemName: string;
  } | null>(null);
  const [stopDripTarget, setStopDripTarget] = useState<{
    runId: number;
    segmentId: number;
    itemName: string;
    date: string;
    time: string;
  } | null>(null);
  const [stopDripSaving, setStopDripSaving] = useState(false);
  const [stopDripError, setStopDripError] = useState("");
  const [changeRateTarget, setChangeRateTarget] = useState<{
    runId: number;
    segmentId: number;
    itemName: string;
    kind: IoKind;
    date: string;
    time: string;
    rateValue: string;
    doseValue: string;
    doseUnit: string;
  } | null>(null);
  const [changeRateSaving, setChangeRateSaving] = useState(false);
  const [changeRateError, setChangeRateError] = useState("");
  const [deletingEventId, setDeletingEventId] = useState<number | null>(null);
  const [currentError, setCurrentError] = useState("");
  const [entryRunId, setEntryRunId] = useState<number | null>(null);
  const [entryMode, setEntryMode] = useState<EntryMode>("bolus");
  const [entryDate, setEntryDate] = useState(() => toDateInput(Date.now()));
  const [entryTime, setEntryTime] = useState(() => toTimeInput(Date.now()));
  const [entryEndDate, setEntryEndDate] = useState("");
  const [entryEndTime, setEntryEndTime] = useState("");
  const [entryBolusValue, setEntryBolusValue] = useState("");
  const [entryBolusUnit, setEntryBolusUnit] = useState("");
  const [entryLocalRoute, setEntryLocalRoute] = useState(DEFAULT_LOCAL_ANESTHETIC_ROUTE);
  const [entryLocalConcentration, setEntryLocalConcentration] = useState("");
  const [entryLocalVolumeMl, setEntryLocalVolumeMl] = useState("");
  const [entryWeightKg, setEntryWeightKg] = useState("");
  const [entryRateValue, setEntryRateValue] = useState("");
  const [entryVolumeMl, setEntryVolumeMl] = useState("");
  const [entryDoseValue, setEntryDoseValue] = useState("");
  const [entryDoseUnit, setEntryDoseUnit] = useState("mcg/kg/min");
  const [entryConcentrationValue, setEntryConcentrationValue] = useState("");
  const [entryCarrierFluidId, setEntryCarrierFluidId] = useState<number | null>(null);
  const [entryCarrierVolumeMl, setEntryCarrierVolumeMl] = useState("");
  const [entryBloodGroup, setEntryBloodGroup] = useState("");
  const [entryBloodBagNo, setEntryBloodBagNo] = useState("");
  const [entryNote, setEntryNote] = useState("");
  const [entrySaving, setEntrySaving] = useState(false);
  const [entryError, setEntryError] = useState("");
  const [bloodProductModalOpen, setBloodProductModalOpen] = useState(false);
  const [bloodProductSearch, setBloodProductSearch] = useState("");
  const [bloodProductItemId, setBloodProductItemId] = useState<number | null>(null);
  const [showBloodProductDropdown, setShowBloodProductDropdown] = useState(false);
  const [bloodProductDate, setBloodProductDate] = useState(() => toDateInput(Date.now()));
  const [bloodProductTime, setBloodProductTime] = useState(() => toTimeInput(Date.now()));
  const [bloodProductVolumeMl, setBloodProductVolumeMl] = useState("");
  const [bloodProductGroup, setBloodProductGroup] = useState("");
  const [bloodProductBagNo, setBloodProductBagNo] = useState("");
  const [bloodProductNote, setBloodProductNote] = useState("");
  const [bloodProductSaving, setBloodProductSaving] = useState(false);
  const [bloodProductError, setBloodProductError] = useState("");
  const [medDripModalOpen, setMedDripModalOpen] = useState(false);
  const [medDripSearch, setMedDripSearch] = useState("");
  const [medDripItemId, setMedDripItemId] = useState<number | null>(null);
  const [showMedDripDropdown, setShowMedDripDropdown] = useState(false);
  const [medDripDate, setMedDripDate] = useState(() => toDateInput(Date.now()));
  const [medDripTime, setMedDripTime] = useState(() => toTimeInput(Date.now()));
  const [medDripRoute, setMedDripRoute] = useState(DEFAULT_ROUTE);
  const [medDripAmountValue, setMedDripAmountValue] = useState("");
  const [medDripAmountUnit, setMedDripAmountUnit] = useState("mg");
  const [medDripCarrierFluidId, setMedDripCarrierFluidId] = useState<number | null>(null);
  const [medDripTotalVolumeMl, setMedDripTotalVolumeMl] = useState("");
  const [medDripDoseValue, setMedDripDoseValue] = useState("");
  const [medDripDoseUnit, setMedDripDoseUnit] = useState<(typeof DOSE_RATE_UNITS)[number]>("mg/hr");
  const [medDripWeightKg, setMedDripWeightKg] = useState("");
  const [medDripRateMlHr, setMedDripRateMlHr] = useState("");
  const [medDripLastEdited, setMedDripLastEdited] = useState<"dose" | "rate">("dose");
  const [medDripNote, setMedDripNote] = useState("");
  const [medDripManualMode, setMedDripManualMode] = useState(false);
  const [medDripManualCategory, setMedDripManualCategory] = useState("");
  const [medDripSaving, setMedDripSaving] = useState(false);
  const [medDripError, setMedDripError] = useState("");
  const [medDripEditRunId, setMedDripEditRunId] = useState<number | null>(null);
  const medDripOptionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const medDripAmountInputRef = useRef<HTMLInputElement | null>(null);
  const medicationSearchInputRef = useRef<HTMLInputElement | null>(null);
  const medicationBolusAmountInputRef = useRef<HTMLInputElement | null>(null);
  const medicationBolusOptionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const bloodProductOptionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const bloodProductVolumeRef = useRef<HTMLInputElement | null>(null);
  const [fluidModalOpen, setFluidModalOpen] = useState(false);
  const [fluidSearch, setFluidSearch] = useState("");
  const [fluidItemId, setFluidItemId] = useState<number | null>(null);
  const [showFluidDropdown, setShowFluidDropdown] = useState(false);
  const [fluidDate, setFluidDate] = useState(() => toDateInput(Date.now()));
  const [fluidTime, setFluidTime] = useState(() => toTimeInput(Date.now()));
  const [fluidEntryMode, setFluidEntryMode] = useState<"bolus" | "timed" | "running">("bolus");
  const [fluidVolumeMl, setFluidVolumeMl] = useState("");
  const [fluidOverMin, setFluidOverMin] = useState("");
  const [fluidRateMlHr, setFluidRateMlHr] = useState("");
  const [fluidNote, setFluidNote] = useState("");
  const [fluidSaving, setFluidSaving] = useState(false);
  const [fluidError, setFluidError] = useState("");
  const [fluidEditRunId, setFluidEditRunId] = useState<number | null>(null);
  const fluidOptionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const fluidFirstFieldRef = useRef<HTMLInputElement | null>(null);

  const detailedGroups = useMemo(() => groupRows.length ? groupRows.map(row => ({ id: row.code, label: row.display_name, kind: row.kind, category: row.code, isActive: row.is_active !== 0 })) : DETAILED_GROUPS, [groupRows]);
  const detailedGroupById = useMemo(() => new Map(detailedGroups.map(group => [group.id, group])), [detailedGroups]);
  const activeGroup =
    detailedGroupById.get(activeGroupId) || detailedGroups[0];
  const masterVisibleGroups = useMemo(
    () => detailedGroups.filter(group => group.isActive !== false && (group.kind === "med" || group.kind === "fluid")),
    [detailedGroups],
  );
  const visibleMasterGroupIds = useMemo(
    () => new Set(masterVisibleGroups.map(group => group.id)),
    [masterVisibleGroups],
  );
  const currentGroup = detailedGroupById.get(currentGroupId) || null;
  const isCurrentGroupRouteEnabled = currentGroup
    ? !ROUTE_DISABLED_GROUP_IDS.has(currentGroup.id)
    : false;
  const isCurrentGroupLocalAnesthetic = currentGroup?.id === LOCAL_ANESTHETIC_GROUP_ID;
  const formGroupId = resolveGroupId(form.kind, form.category || "", form.code, detailedGroups);

  const activeRuns = useMemo(
    () =>
      currentRuns
        .filter(run => run.stopped_at == null && run.include_in_balance !== 0)
        .sort((a, b) => b.started_at - a.started_at || b.id - a.id),
    [currentRuns],
  );
  const stopDripCurrentIntakeMl = useMemo(() => {
    if (!stopDripTarget) return null;
    const run = activeRuns.find(candidate => candidate.id === stopDripTarget.runId) || null;
    if (!run || !Array.isArray(run.segments)) return null;
    const stopTs = combineDateAndTime(stopDripTarget.date, stopDripTarget.time, Date.now());
    if (!Number.isFinite(stopTs)) return null;
    let infusedMl = 0;
    for (const segment of run.segments) {
      if ((segment.include_in_balance ?? 1) === 0) continue;
      const segStart = Number(segment.ts_from);
      if (!Number.isFinite(segStart) || segStart >= stopTs) continue;
      const segEnd =
        segment.ts_to != null && Number.isFinite(Number(segment.ts_to))
          ? Number(segment.ts_to)
          : stopTs;
      const effectiveEnd = Math.min(stopTs, segEnd);
      if (!Number.isFinite(effectiveEnd) || effectiveEnd <= segStart) continue;
      const rateValue = Number(segment.rate_value);
      const rateUnit = String(segment.rate_unit || "").toLowerCase().replace(/\s+/g, "");
      let rateMlHr = 0;
      if (Number.isFinite(rateValue) && rateValue > 0) {
        if (!rateUnit || rateUnit === "ml/hr" || rateUnit === "ml/h" || rateUnit === "mlhr") {
          rateMlHr = rateValue;
        } else if (rateUnit === "l/hr" || rateUnit === "l/h" || rateUnit === "lhr") {
          rateMlHr = rateValue * 1000;
        }
      }
      const carrierMlHr = Number.isFinite(Number(segment.carrier_ml_per_hr))
        ? Number(segment.carrier_ml_per_hr)
        : 0;
      const hours = (effectiveEnd - segStart) / 3_600_000;
      infusedMl += Math.max(0, rateMlHr) * hours + Math.max(0, carrierMlHr) * hours;
    }
    return round2(infusedMl);
  }, [activeRuns, stopDripTarget]);
  const stopDripSuggestedStopTs = useMemo(() => {
    if (!stopDripTarget) return null;
    const run = activeRuns.find(candidate => candidate.id === stopDripTarget.runId) || null;
    if (!run || !Array.isArray(run.segments)) return null;
    const runMeta = parseNoteTokens(String(run.note || ""));
    const totalVolumeMl = parsePositiveNumber(String(runMeta.totalVolumeMl || ""));
    if (totalVolumeMl == null) return null;
    const observedTs = Date.now();
    const segments = [...run.segments]
      .filter(segment => (segment.include_in_balance ?? 1) !== 0)
      .sort((a, b) => a.ts_from - b.ts_from || a.id - b.id);
    let cumulativeMl = 0;
    let activeRateMlHr: number | null = null;
    for (const segment of segments) {
      const segStart = Number(segment.ts_from);
      if (!Number.isFinite(segStart) || segStart > observedTs) continue;
      const rawSegEnd =
        segment.ts_to != null && Number.isFinite(Number(segment.ts_to))
          ? Number(segment.ts_to)
          : Number.POSITIVE_INFINITY;
      const effectiveEnd = Math.min(observedTs, rawSegEnd);
      const rateValue = Number(segment.rate_value);
      const rateUnit = String(segment.rate_unit || "").toLowerCase().replace(/\s+/g, "");
      let rateMlHr = 0;
      if (Number.isFinite(rateValue) && rateValue > 0) {
        if (!rateUnit || rateUnit === "ml/hr" || rateUnit === "ml/h" || rateUnit === "mlhr") {
          rateMlHr = rateValue;
        } else if (rateUnit === "l/hr" || rateUnit === "l/h" || rateUnit === "lhr") {
          rateMlHr = rateValue * 1000;
        }
      }
      rateMlHr += Number.isFinite(Number(segment.carrier_ml_per_hr))
        ? Number(segment.carrier_ml_per_hr)
        : 0;
      if (!(rateMlHr > 0)) continue;

      if (effectiveEnd > segStart) {
        const segmentMl = ((effectiveEnd - segStart) / 3_600_000) * rateMlHr;
        if (cumulativeMl + segmentMl >= totalVolumeMl) {
          const remainingMl = Math.max(0, totalVolumeMl - cumulativeMl);
          return segStart + (remainingMl / rateMlHr) * 3_600_000;
        }
        cumulativeMl += segmentMl;
      }

      if (rawSegEnd === Number.POSITIVE_INFINITY || observedTs < rawSegEnd) {
        activeRateMlHr = rateMlHr;
      }
    }
    if (activeRateMlHr != null && activeRateMlHr > 0 && cumulativeMl < totalVolumeMl) {
      return observedTs + ((totalVolumeMl - cumulativeMl) / activeRateMlHr) * 3_600_000;
    }
    return null;
  }, [activeRuns, stopDripTarget]);
  const selectedEntryRun = useMemo(
    () => currentRuns.find(run => run.id === entryRunId && run.include_in_balance !== 0) || null,
    [currentRuns, entryRunId],
  );
  const entryBloodProductType = useMemo(
    () => resolveBloodProductEntryType(selectedEntryRun),
    [selectedEntryRun],
  );
  const entryIsBloodProduct = useMemo(
    () => isBloodProductRun(selectedEntryRun),
    [selectedEntryRun],
  );
  const entryIsLocalAnesthetic = useMemo(
    () => normalizeToken(selectedEntryRun?.item_category) === normalizeToken(LOCAL_ANESTHETIC_GROUP_ID),
    [selectedEntryRun],
  );
  const carrierFluidOptions = useMemo(
    () =>
      currentItems
        .filter(
          item =>
            item.kind === "fluid" &&
            resolveGroupId(item.kind, item.category || "", item.code, detailedGroups) === "fluids",
        )
        .sort((a, b) => a.name.localeCompare(b.name)),
    [currentItems, detailedGroups],
  );
  const entryDurationMin = useMemo(() => {
    if (!entryDate || !entryTime || !entryEndDate || !entryEndTime) return null;
    const start = combineDateAndTime(entryDate, entryTime, NaN);
    const end = combineDateAndTime(entryEndDate, entryEndTime, NaN);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;
    return Math.round((end - start) / 60000);
  }, [entryDate, entryEndDate, entryEndTime, entryTime]);
  const itemGroups = useMemo(() => {
    type BaseGroup = {
      key: string;
      runId: number | null;
      kind: IoKind;
      category: string;
      itemId: number;
      itemName: string;
      itemUnit: string;
      typeLabel: string;
      route?: string | null;
      entryMode: "bolus" | "drip" | null;
      events: CaseIoEvent[];
      segments: string[];
      segmentTotalMl: number;
    };
    type DisplayGroup = BaseGroup & { displayMode: DisplayMode };

    const map = new Map<string, BaseGroup>();
    const preferredRunByKey = new Map<string, CaseIoRun>();

    const collectSegments = (run?: CaseIoRun): { labels: string[]; totalMl: number } => {
      if (!run || !Array.isArray(run.segments)) return { labels: [], totalMl: 0 };
      const nowTs = Date.now();
      let totalMl = 0;
      const labels = run.segments
        .filter(segment => {
          const include =
            segment.include_in_balance == null || segment.include_in_balance !== 0;
          const hasValue =
            (Number.isFinite(Number(segment.rate_value)) &&
              Number(segment.rate_value) > 0) ||
            (Number.isFinite(Number(segment.dose_value)) &&
              Number(segment.dose_value) > 0) ||
            (Number.isFinite(Number(segment.carrier_ml_per_hr)) &&
              Number(segment.carrier_ml_per_hr) > 0);
          return include && hasValue;
        })
        .map(segment => {
          const start = Number(segment.ts_from);
          const rawEnd =
            segment.ts_to != null && Number.isFinite(Number(segment.ts_to))
              ? Number(segment.ts_to)
              : nowTs;
          const end = Math.min(rawEnd, nowTs);
          if (Number.isFinite(start) && Number.isFinite(end) && end > start) {
            const hours = (end - start) / 3_600_000;
            const rate = Number(segment.rate_value);
            const carrier = Number(segment.carrier_ml_per_hr);
            totalMl +=
              (Number.isFinite(rate) && rate > 0 ? rate * hours : 0) +
              (Number.isFinite(carrier) && carrier > 0 ? carrier * hours : 0);
          }
          return formatSegmentValue(run, segment);
        });
      return { labels, totalMl: round2(totalMl) };
    };

    const visibleRuns = currentRuns.filter(
      run => Number(run.include_in_balance ?? 1) !== 0,
    );

    const sortedRuns = [...visibleRuns].sort((a, b) => {
      const aActive = a.stopped_at == null && a.include_in_balance !== 0 ? 1 : 0;
      const bActive = b.stopped_at == null && b.include_in_balance !== 0 ? 1 : 0;
      if (aActive !== bActive) return bActive - aActive;
      return b.started_at - a.started_at || b.id - a.id;
    });

    const runKey = (run: CaseIoRun) =>
      `${run.kind}:${run.item_id}:${run.entry_mode ?? "any"}`;

    for (const run of sortedRuns) {
      if (run.include_in_balance === 0) continue;
      const key = runKey(run);
      if (!preferredRunByKey.has(key)) preferredRunByKey.set(key, run);
    }

    for (const run of sortedRuns) {
      const key = runKey(run);
      const existing = map.get(key);
      const nextSegments = collectSegments(run);
      if (existing) {
        if (!existing.route && run.route) existing.route = run.route;
        if (existing.runId == null) existing.runId = run.id;
        existing.segmentTotalMl = round2(existing.segmentTotalMl + nextSegments.totalMl);
        if (nextSegments.labels.length > 0) {
          existing.segments = Array.from(new Set([...existing.segments, ...nextSegments.labels]));
        }
        continue;
      }
      map.set(key, {
        key,
        runId: run.id,
        kind: run.kind,
        category: run.item_category || "",
        itemId: run.item_id,
        itemName: run.item_name || run.item_code || `Item ${run.item_id}`,
        itemUnit: run.item_unit || (run.kind === "med" ? "mg" : "mL"),
        typeLabel: resolveTypeLabel(
          run.kind,
          run.item_category,
          run.item_code,
          run.item_name,
        ),
        route: run.route || null,
        entryMode: run.entry_mode ?? null,
        events: [],
        segments: nextSegments.labels,
        segmentTotalMl: nextSegments.totalMl,
      });
    }

    for (const event of currentEvents) {
      if (event.include_in_balance === 0) continue;
      // Events are always bolus — prefer the bolus-keyed group, fallback to 'any'
      const keyBolus = `${event.kind}:${event.item_id}:bolus`;
      const keyAny = `${event.kind}:${event.item_id}:any`;
      const key = map.has(keyBolus) ? keyBolus : keyAny;
      let group = map.get(key);
      if (!group) {
        const fallbackRun =
          preferredRunByKey.get(keyBolus) ?? preferredRunByKey.get(keyAny);
        const fallbackSegments = collectSegments(fallbackRun);
        group = {
          key,
          runId: fallbackRun?.id ?? null,
          kind: event.kind,
          category: event.item_category || fallbackRun?.item_category || "",
          itemId: event.item_id,
          itemName:
            event.item_name ||
            fallbackRun?.item_name ||
            fallbackRun?.item_code ||
            `Item ${event.item_id}`,
          itemUnit:
            fallbackRun?.item_unit ||
            (event.kind === "med" ? event.dose_unit || "mg" : "mL"),
          typeLabel: resolveTypeLabel(
            event.kind,
            event.item_category || fallbackRun?.item_category,
            event.item_code || fallbackRun?.item_code,
            event.item_name || fallbackRun?.item_name,
          ),
          route: fallbackRun?.route || null,
          entryMode: fallbackRun?.entry_mode ?? null,
          events: [],
          segments: fallbackSegments.labels,
          segmentTotalMl: fallbackSegments.totalMl,
        };
        map.set(key, group);
      }
      group.events.push(event);
    }

    const rows: DisplayGroup[] = [];
    for (const base of map.values()) {
      base.events.sort((a, b) => a.event_ts - b.event_ts || a.id - b.id);

      if (base.kind === "output") {
        rows.push({ ...base, key: `${base.key}:output`, displayMode: "output" });
        continue;
      }

      // If the run has an explicit entry_mode, use it directly
      if (base.entryMode === "drip") {
        rows.push({ ...base, displayMode: "drip", events: [] });
        continue;
      }
      if (base.entryMode === "bolus") {
        rows.push({ ...base, displayMode: "bolus", segments: [] });
        continue;
      }

      // Legacy runs (no entry_mode): infer from data
      const hasBolus = base.events.length > 0;
      const hasDrip = base.segments.length > 0;

      if (hasBolus || !hasDrip) {
        rows.push({
          ...base,
          key: `${base.key}:bolus`,
          displayMode: "bolus",
          segments: [],
        });
      }
      if (hasDrip) {
        rows.push({
          ...base,
          key: `${base.key}:drip`,
          displayMode: "drip",
          events: [],
        });
      }
    }

    const modeRank = (mode: DisplayMode) =>
      mode === "drip" ? 0 : mode === "bolus" ? 1 : 2;
    const groupRank = (row: DisplayGroup) => {
      const cat = row.category.toLowerCase();
      if (row.kind === "med") return 0;
      if (row.kind === "fluid" && row.displayMode === "drip") return 1;
      if (row.kind === "fluid" && cat !== "bloodproduct") return 2;
      if (row.kind === "fluid" && cat === "bloodproduct") return 3;
      if (row.kind === "output" && cat === "bloodlossoutput") return 4;
      if (row.kind === "output" && cat === "urineoutput") return 5;
      return 6;
    };

    rows.sort(
      (a, b) =>
        groupRank(a) - groupRank(b) ||
        a.itemName.localeCompare(b.itemName) ||
        modeRank(a.displayMode) - modeRank(b.displayMode),
    );

    return rows;
  }, [currentEvents, currentRuns]);
  const medicationItemGroups = useMemo(
    () =>
      itemGroups.filter(
        group => group.kind === "med" && group.displayMode !== "drip",
      ),
    [itemGroups],
  );
  const popularBolusItems = useMemo(
    () =>
      POPULAR_BOLUS_DRUGS.flatMap(drugName => {
        const drugToken = normalizeToken(drugName);
        const item = currentItems.find(candidate => {
          if (candidate.kind !== "med") return false;
          const itemToken = normalizeToken(candidate.name);
          return itemToken === drugToken || itemToken.startsWith(drugToken);
        });
        return item ? [item] : [];
      }),
    [currentItems],
  );
  const patientNameLanguage = normalizePatientNameLanguage(
    sessionUser?.parameterPreferences?.patientNameLanguage,
  );
  const administeredMedicationCount = useMemo(
    () => medicationItemGroups.filter(group =>
      group.events.some(event => {
        const dose = Number(event.dose_value);
        return Number.isFinite(dose) && dose > 0;
      }),
    ).length,
    [medicationItemGroups],
  );
  const preparedMedicationCount = medicationItemGroups.length - administeredMedicationCount;
  const fluidIntakeItemGroups = useMemo(
    () =>
      itemGroups.filter(
        group => group.kind === "fluid" || (group.kind === "med" && group.displayMode === "drip"),
      ),
    [itemGroups],
  );
  const outputItemGroups = useMemo(
    () => itemGroups.filter(group => group.kind === "output"),
    [itemGroups],
  );
  const summaryTotalsByItemKey = useMemo(() => {
    const map = new Map<string, { total: number; unit: string }>();
    for (const row of currentSummary?.item_totals_ml || []) {
      const itemId = Number(row.item_id);
      const total = asNumber(row.total_ml);
      if (!Number.isFinite(itemId) || itemId <= 0 || total <= 0) continue;
      map.set(`${row.kind}:${Math.trunc(itemId)}`, {
        total,
        unit: normalizeDisplayUnit(
          row.kind,
          row.item_unit || (row.kind === "med" ? "mg" : "mL"),
        ),
      });
    }
    return map;
  }, [currentSummary]);
  const getGroupTotalText = (group: {
    kind: IoKind;
    itemId: number;
    itemUnit: string;
    displayMode?: DisplayMode;
    events: CaseIoEvent[];
    segmentTotalMl?: number;
  }): string | null => {
    const eventTotal = formatGroupEventTotal(group.kind, group.itemUnit, group.events);
    if (eventTotal) return eventTotal;
    if (
      group.displayMode === "drip" &&
      group.segmentTotalMl != null &&
      Number.isFinite(Number(group.segmentTotalMl)) &&
      Number(group.segmentTotalMl) > 0
    ) {
      return `${formatQuantity(Number(group.segmentTotalMl))} mL`;
    }
    const fallback = summaryTotalsByItemKey.get(`${group.kind}:${group.itemId}`);
    if (!fallback) return null;
    const fallbackUnit =
      group.kind === "med"
        ? normalizeDisplayUnit(group.kind, group.itemUnit || fallback.unit)
        : fallback.unit;
    return `${formatQuantity(fallback.total)} ${fallbackUnit}`;
  };
  const filteredCurrentItems = useMemo(
    () => {
      if (!currentGroup) return [];
      return currentItems.filter(
        item =>
          resolveGroupId(item.kind, item.category || "", item.code, detailedGroups) === currentGroup.id,
      );
    },
    [currentItems, currentGroup, detailedGroups],
  );
  const selectedCurrentItem = useMemo(
    () => currentItems.find(item => item.id === prepareItemId) || null,
    [currentItems, prepareItemId],
  );
  const historicalBolusSuggestion = useMemo(() => {
    const token = normalizeToken(selectedCurrentItem?.name || "");
    if (!token) return null;
    const match = Object.entries(HISTORICAL_BOLUS_SUGGESTIONS).find(
      ([drug]) => token === drug || token.startsWith(drug),
    );
    return match?.[1] || null;
  }, [selectedCurrentItem?.name]);
  const patientWeightKg = useMemo(() => {
    const apiWeight = Number(casePatient?.weight_kg);
    if (Number.isFinite(apiWeight) && apiWeight > 0) return apiWeight;
    if (caseId == null) return null;
    const savedWeight = Number(readWeightFromSavedForm(caseId));
    return Number.isFinite(savedWeight) && savedWeight > 0 ? savedWeight : null;
  }, [caseId, casePatient?.weight_kg]);
  const patientAsaLabel = useMemo(() => {
    const raw = String(casePatient?.asa_status || "").trim();
    if (!raw) return "ASA —";
    const base = /^asa\b/i.test(raw) ? raw : `ASA ${raw}`;
    return casePatient?.asa_emergency && !/\bE$/i.test(base) ? `${base} E` : base;
  }, [casePatient?.asa_emergency, casePatient?.asa_status]);
  const selectedCurrentItemGroupId = useMemo(
    () =>
      selectedCurrentItem
        ? resolveGroupId(
            selectedCurrentItem.kind,
            selectedCurrentItem.category || "",
            selectedCurrentItem.code,
            detailedGroups,
          )
        : "",
    [selectedCurrentItem, detailedGroups],
  );
  const isPrepareGroupLocked = prepareItemId != null;
  const formUnitOptions = useMemo(() => {
    const next = [...UOM_OPTIONS];
    const currentUnit = String(form.default_unit || "").trim();
    if (currentUnit && !next.includes(currentUnit as (typeof UOM_OPTIONS)[number])) {
      next.push(currentUnit as (typeof UOM_OPTIONS)[number]);
    }
    return next;
  }, [form.default_unit]);
  const visibleDirectory = useMemo(
    () =>
      directory.filter(
        item =>
          resolveGroupId(item.kind, item.category || "", item.code, detailedGroups) === activeGroup.id,
      ),
    [directory, activeGroup.id, detailedGroups],
  );
  const medCategoryOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const item of currentItems) {
      if (item.kind !== "med") continue;
      const category = String(item.category || "").trim();
      if (!category) continue;
      if (!map.has(category)) {
        map.set(category, resolveTypeLabel(item.kind, item.category, item.code, item.name, detailedGroups));
      }
    }
    return Array.from(map.entries())
      .sort((a, b) => a[1].localeCompare(b[1], undefined, { sensitivity: "base" }))
      .map(([value, label]) => ({ value, label }));
  }, [currentItems, detailedGroups]);
  const filteredSearchItems = useMemo(() => {
    const q = normalizeToken(itemSearch);
    // If user typed something, require at least 2 characters to trigger search
    if (q && q.length < 2) return [];
    // If no search query and no group selected, don't show anything
    if (!q && !currentGroupId) return [];

    return currentItems
      .filter(item => {
        if (item.kind !== "med") return false;
        const matchesQuery =
          !q ||
          normalizeToken(item.name).includes(q) ||
          normalizeToken(item.code).includes(q);
        const matchesGroup =
          !currentGroupId ||
          resolveGroupId(item.kind, item.category, item.code || item.name, detailedGroups) ===
            currentGroupId;
        return matchesQuery && matchesGroup;
      })
      .slice(0, 15);
  }, [currentItems, itemSearch, currentGroupId, detailedGroups]);
  const bloodProductItems = useMemo(
    () =>
      currentItems.filter(
        item => resolveGroupId(item.kind, item.category || "", item.code, detailedGroups) === "bloodProduct",
      ),
    [currentItems, detailedGroups],
  );
  const medDripItems = useMemo(
    () =>
      currentItems.filter(
        item =>
          item.kind === "med" &&
          normalizeToken(item.category) !== normalizeToken(LOCAL_ANESTHETIC_GROUP_ID),
      ),
    [currentItems],
  );
  const filteredBloodProductItems = useMemo(() => {
    const q = normalizeToken(bloodProductSearch);
    if (!q) return bloodProductItems.slice(0, 12);
    if (q.length < 2) return [];
    return bloodProductItems
      .filter(item => {
        const name = normalizeToken(item.name);
        const code = normalizeToken(item.code);
        return name.includes(q) || code.includes(q);
      })
      .slice(0, 12);
  }, [bloodProductItems, bloodProductSearch]);
  const filteredMedDripItems = useMemo(() => {
    const keyword = normalizeToken(medDripSearch);
    const rankedBase = [...medDripItems].sort(
      (a, b) =>
        usageRankForItem(a) - usageRankForItem(b) ||
        usageScoreForItem(b) - usageScoreForItem(a) ||
        a.name.localeCompare(b.name),
    );
    if (!keyword) return rankedBase.slice(0, 12);
    if (keyword.length < 2) return [];
    return medDripItems
      .map(item => ({ item, score: scoreMedDripMatch(item, keyword) }))
      .filter(entry => entry.score !== Number.MAX_SAFE_INTEGER)
      .sort((a, b) => {
        const scoreDelta = a.score - b.score;
        if (scoreDelta !== 0) return scoreDelta;
        const prefixDelta =
          medDripPrefixDistance(a.item, keyword) - medDripPrefixDistance(b.item, keyword);
        if (prefixDelta !== 0) return prefixDelta;
        const rankDelta = usageRankForItem(a.item) - usageRankForItem(b.item);
        if (rankDelta !== 0) return rankDelta;
        const usageDelta = usageScoreForItem(b.item) - usageScoreForItem(a.item);
        if (usageDelta !== 0) return usageDelta;
        return a.item.name.localeCompare(b.item.name);
      })
      .map(entry => entry.item)
      .slice(0, 12);
  }, [medDripItems, medDripSearch]);
  const medDripFuzzyMatches = useMemo(() => {
    const keyword = normalizeToken(medDripSearch);
    if (!keyword || keyword.length < 4 || filteredMedDripItems.length > 0) return [];
    return medDripItems
      .map(item => ({ item, score: scoreMedDripFuzzyMatch(item, keyword) }))
      .filter(entry => entry.score !== Number.MAX_SAFE_INTEGER)
      .sort((a, b) => {
        if (a.score !== b.score) return a.score - b.score;
        const rankDelta = usageRankForItem(a.item) - usageRankForItem(b.item);
        if (rankDelta !== 0) return rankDelta;
        const usageDelta = usageScoreForItem(b.item) - usageScoreForItem(a.item);
        if (usageDelta !== 0) return usageDelta;
        return a.item.name.localeCompare(b.item.name, undefined, { sensitivity: "base" });
      })
      .slice(0, 3)
      .map(entry => entry.item);
  }, [filteredMedDripItems.length, medDripItems, medDripSearch]);
  const selectedBloodProductItem = useMemo(
    () => bloodProductItems.find(item => item.id === bloodProductItemId) || null,
    [bloodProductItems, bloodProductItemId],
  );
  const selectedMedDripItem = useMemo(
    () => medDripItems.find(item => item.id === medDripItemId) || null,
    [medDripItems, medDripItemId],
  );
  const selectedBloodProductType = useMemo(
    () => resolveBloodProductItemType(selectedBloodProductItem),
    [selectedBloodProductItem],
  );
  const fluidItems = useMemo(
    () =>
      currentItems.filter(
        item =>
          item.kind === "fluid" && normalizeToken(item.category) !== "bloodproduct",
      ),
    [currentItems],
  );
  const filteredFluidItems = useMemo(() => {
    const q = normalizeToken(fluidSearch);
    const sorted = [...fluidItems].sort((a, b) => a.name.localeCompare(b.name));
    if (!q) return sorted.slice(0, 12);
    if (q.length < 2) return [];
    return sorted
      .filter(
        item =>
          normalizeToken(item.name).includes(q) ||
          normalizeToken(item.code || "").includes(q),
      )
      .slice(0, 12);
  }, [fluidItems, fluidSearch]);
  const medSearchFluidMatches = useMemo(() => {
    const keyword = normalizeToken(itemSearch);
    if (!keyword || keyword.length < 2 || filteredSearchItems.length > 0) return [];
    return fluidItems
      .map(item => ({
        item,
        direct:
          normalizeToken(item.name).includes(keyword) ||
          normalizeToken(item.code || "").includes(keyword),
        fuzzy: scoreMedDripFuzzyMatch(item, keyword),
      }))
      .filter(entry => entry.direct || entry.fuzzy !== Number.MAX_SAFE_INTEGER)
      .sort((a, b) => {
        if (a.direct !== b.direct) return a.direct ? -1 : 1;
        if (a.fuzzy !== b.fuzzy) return a.fuzzy - b.fuzzy;
        return a.item.name.localeCompare(b.item.name, undefined, { sensitivity: "base" });
      })
      .slice(0, 3)
      .map(entry => entry.item);
  }, [filteredSearchItems.length, fluidItems, itemSearch]);
  const medDripFluidMatches = useMemo(() => {
    const keyword = normalizeToken(medDripSearch);
    if (!keyword || keyword.length < 2 || filteredMedDripItems.length > 0) return [];
    return fluidItems
      .map(item => ({
        item,
        direct:
          normalizeToken(item.name).includes(keyword) ||
          normalizeToken(item.code || "").includes(keyword),
        fuzzy: scoreMedDripFuzzyMatch(item, keyword),
      }))
      .filter(entry => entry.direct || entry.fuzzy !== Number.MAX_SAFE_INTEGER)
      .sort((a, b) => {
        if (a.direct !== b.direct) return a.direct ? -1 : 1;
        if (a.fuzzy !== b.fuzzy) return a.fuzzy - b.fuzzy;
        return a.item.name.localeCompare(b.item.name, undefined, { sensitivity: "base" });
      })
      .slice(0, 3)
      .map(entry => entry.item);
  }, [filteredMedDripItems.length, fluidItems, medDripSearch]);
  const medDripNeedsManualFallback =
    normalizeToken(medDripSearch).length >= 2 &&
    filteredMedDripItems.length === 0 &&
    medDripFuzzyMatches.length === 0 &&
    medDripFluidMatches.length === 0;
  const selectedFluidItem = useMemo(
    () => fluidItems.find(item => item.id === fluidItemId) || null,
    [fluidItems, fluidItemId],
  );
  const selectedMedDripGroupLabel = useMemo(() => {
    if (selectedMedDripItem) {
      return resolveTypeLabel(
        selectedMedDripItem.kind,
        selectedMedDripItem.category,
        selectedMedDripItem.code,
        selectedMedDripItem.name,
      );
    }
    if (medDripManualMode && medDripManualCategory) {
      return (
        medCategoryOptions.find(option => option.value === medDripManualCategory)?.label ||
        "Medication"
      );
    }
    return "Medication";
  }, [medCategoryOptions, medDripManualCategory, medDripManualMode, selectedMedDripItem]);
  const medDripIsWeightBased = useMemo(
    () =>
      DOSE_PER_KG_RATE_UNITS.includes(
        medDripDoseUnit as (typeof DOSE_PER_KG_RATE_UNITS)[number],
      ),
    [medDripDoseUnit],
  );
  const medDripDoseUnitOptions = useMemo(() => {
    const family = medDripUnitFamily(medDripAmountUnit);
    if (family === "units") {
      return ["units/min", "units/hr", "MUnits/min", "MUnits/hr"] as const;
    }
    return DOSE_RATE_UNITS.filter(
      unit =>
        unit === "mcg/min" ||
        unit === "mg/min" ||
        unit === "mcg/hr" ||
        unit === "mg/hr" ||
        DOSE_PER_KG_RATE_UNITS.includes(unit as (typeof DOSE_PER_KG_RATE_UNITS)[number]),
    );
  }, [medDripAmountUnit]);
  const medDripCalculatedRateMlHr = useMemo(() => {
    const amountValue = parsePositiveNumber(medDripAmountValue);
    const totalVolumeMl = parsePositiveNumber(medDripTotalVolumeMl);
    const doseValue = parsePositiveNumber(medDripDoseValue);
    if (amountValue == null || totalVolumeMl == null || doseValue == null) return null;

    const amountFamily = medDripUnitFamily(medDripAmountUnit);
    const baseAmount = amountToDripBase(amountValue, medDripAmountUnit);
    if (amountFamily == null || baseAmount == null || baseAmount <= 0) return null;
    const basePerMl = baseAmount / totalVolumeMl;
    if (!Number.isFinite(basePerMl) || basePerMl <= 0) return null;

    if (medDripIsWeightBased) {
      const weightKg = parsePositiveNumber(medDripWeightKg);
      const doseMcgPerKgMin = doseToMcgPerKgMin(doseValue, medDripDoseUnit);
      if (weightKg == null || doseMcgPerKgMin == null) return null;
      return amountFamily === "mass"
        ? round4((doseMcgPerKgMin * weightKg * 60) / basePerMl)
        : null;
    }

    const doseBasePerHour = doseRateToDripBasePerHour(doseValue, medDripDoseUnit);
    if (doseBasePerHour == null) return null;
    return round4(doseBasePerHour / basePerMl);
  }, [
    medDripAmountUnit,
    medDripAmountValue,
    medDripDoseUnit,
    medDripDoseValue,
    medDripIsWeightBased,
    medDripTotalVolumeMl,
    medDripWeightKg,
  ]);
  const medDripCalculatedDoseValue = useMemo(() => {
    const amountValue = parsePositiveNumber(medDripAmountValue);
    const totalVolumeMl = parsePositiveNumber(medDripTotalVolumeMl);
    const rateMlHr = parsePositiveNumber(medDripRateMlHr);
    if (amountValue == null || totalVolumeMl == null || rateMlHr == null) return null;

    const amountFamily = medDripUnitFamily(medDripAmountUnit);
    const baseAmount = amountToDripBase(amountValue, medDripAmountUnit);
    if (amountFamily == null || baseAmount == null || baseAmount <= 0) return null;
    const basePerMl = baseAmount / totalVolumeMl;
    if (!Number.isFinite(basePerMl) || basePerMl <= 0) return null;

    if (medDripIsWeightBased) {
      const weightKg = parsePositiveNumber(medDripWeightKg);
      if (amountFamily !== "mass" || weightKg == null || weightKg <= 0) return null;
      const mcgPerKgPerMin = (rateMlHr * basePerMl) / 60 / weightKg;
      const converted = mcgPerKgMinToUnit(mcgPerKgPerMin, medDripDoseUnit);
      return converted == null ? null : round4(converted);
    }

    const basePerHour = rateMlHr * basePerMl;
    const converted = dripBasePerHourToDoseRate(basePerHour, medDripDoseUnit);
    return converted == null ? null : round4(converted);
  }, [
    medDripAmountUnit,
    medDripAmountValue,
    medDripDoseUnit,
    medDripIsWeightBased,
    medDripRateMlHr,
    medDripTotalVolumeMl,
    medDripWeightKg,
  ]);

  useEffect(() => {
    if (caseId == null) {
      setCasePatient(null);
      return;
    }
    let active = true;
    void getCasePatientInfo(caseId)
      .then(patient => {
        if (active) setCasePatient(patient);
      })
      .catch(() => {
        if (active) setCasePatient(null);
      });
    return () => {
      active = false;
    };
  }, [caseId]);

  useEffect(() => {
    if (!medDripModalOpen || medDripLastEdited !== "dose") return;
    const nextRate = medDripCalculatedRateMlHr == null ? "" : String(medDripCalculatedRateMlHr);
    setMedDripRateMlHr(prev => (prev === nextRate ? prev : nextRate));
  }, [medDripCalculatedRateMlHr, medDripLastEdited, medDripModalOpen]);

  useEffect(() => {
    if (!medDripModalOpen || medDripLastEdited !== "rate") return;
    const nextDose = medDripCalculatedDoseValue == null ? "" : String(medDripCalculatedDoseValue);
    setMedDripDoseValue(prev => (prev === nextDose ? prev : nextDose));
  }, [medDripCalculatedDoseValue, medDripLastEdited, medDripModalOpen]);

  useEffect(() => {
    if ((medDripDoseUnitOptions as readonly string[]).includes(medDripDoseUnit)) return;
    const normalizedDefaultUnit = normalizeDisplayUnit(
      "med",
      selectedMedDripItem?.default_unit || medDripAmountUnit || "mg",
    ).toLowerCase();
    if (normalizedDefaultUnit === "mcg") {
      setMedDripDoseUnit("mcg/min");
      return;
    }
    if (normalizedDefaultUnit === "units") {
      setMedDripDoseUnit("units/hr");
      return;
    }
    if (normalizedDefaultUnit === "munits") {
      setMedDripDoseUnit("MUnits/hr");
      return;
    }
    setMedDripDoseUnit("mg/hr");
  }, [medDripAmountUnit, medDripDoseUnit, medDripDoseUnitOptions, selectedMedDripItem]);

  const loadDirectory = async () => {
    setLoading(true);
    setError("");
    try {
      const rows = await getIoCatalog({
        kind: activeGroup.kind,
        limit: 400,
        q: search.trim() || undefined,
        include_inactive: includeInactive,
      });
      setDirectory(rows);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load directory");
    } finally {
      setLoading(false);
    }
  };

  const loadGroups = async () => {
    try {
      setGroupRows(await getIoGroups({ includeInactive: true }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load medication groups");
    }
  };


  const loadCurrentCase = async (
    targetCaseId: number,
    targetCaseStatus: NonIdleCaseStatus,
  ) => {
    const fromTs = targetCaseStatus.start_time;
    const toTs =
      targetCaseStatus.status === "DISCHARGED" && targetCaseStatus.discharge_time
        ? targetCaseStatus.discharge_time
        : Date.now() + 24 * 60 * 60 * 1000;

    const [medItems, fluidItems, outputItems, runs, events, summary] = await Promise.all([
      getCaseIoItems(targetCaseId, "med"),
      getCaseIoItems(targetCaseId, "fluid"),
      getCaseIoItems(targetCaseId, "output"),
      getCaseIoRuns(targetCaseId, fromTs, toTs),
      getCaseIoEvents(targetCaseId, fromTs, toTs),
      getCaseIoSummary(targetCaseId, fromTs, toTs),
    ]);
    setCurrentItems([...medItems, ...fluidItems, ...outputItems]);
    setCurrentRuns(runs);
    setCurrentEvents(events);
    setCurrentSummary(summary);
  };

  useEffect(() => {
    try {
      window.localStorage.setItem(MEDICATION_SUMMARY_VIEW_STORAGE_KEY, medicationSummaryView);
    } catch {
      // Keep the in-memory preference when browser storage is unavailable.
    }
  }, [medicationSummaryView]);

  useEffect(() => {
    try {
      window.localStorage.setItem(FLUID_BALANCE_VIEW_STORAGE_KEY, fluidBalanceView);
    } catch {
      // Keep the in-memory preference when browser storage is unavailable.
    }
  }, [fluidBalanceView]);

  useEffect(() => {
    void loadGroups();
  }, []);

  useEffect(() => {
    if (tab !== "master") return;
    void loadDirectory();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, activeGroup.kind, search, includeInactive]);

  useEffect(() => {
    if (tab !== "master") return;
    if (visibleMasterGroupIds.has(activeGroupId)) return;
    setActiveGroupId("fluids");
  }, [activeGroupId, tab, visibleMasterGroupIds]);

  useEffect(() => {
    setForm(prev => {
      if (editingId != null) return prev;
      return {
        ...prev,
        kind: activeGroup.kind,
        category: activeGroup.category,
        default_unit:
          prev.default_unit || defaultForm(activeGroup.kind).default_unit,
      };
    });
  }, [activeGroup.kind, activeGroup.category, editingId]);

  useEffect(() => {
    if (tab !== "current") return;
    if (caseId == null || caseStatus.status === "IDLE") {
      setCurrentItems([]);
      setCurrentRuns([]);
      setCurrentEvents([]);
      setCurrentSummary(null);
      setCurrentError("");
      return;
    }

    let alive = true;
    const activeCaseId = caseId;
    const activeCaseStatus = caseStatus;

    async function load() {
      setCurrentLoading(true);
      setCurrentError("");
      try {
        await loadCurrentCase(activeCaseId, activeCaseStatus);
      } catch (err) {
        if (!alive) return;
        setCurrentError(
          err instanceof Error ? err.message : "Failed to load current case I/O",
        );
      } finally {
        if (alive) setCurrentLoading(false);
      }
    }

    void load();
    return () => {
      alive = false;
    };
  }, [tab, caseId, caseStatus]);

  useEffect(() => {
    setPrepareItemId(prev => {
      if (prev != null && filteredCurrentItems.some(item => item.id === prev)) return prev;
      if (filteredCurrentItems.length === 1) return filteredCurrentItems[0].id;
      return null;
    });
  }, [filteredCurrentItems]);

  useEffect(() => {
    if (!currentGroup) {
      setPrepareRoute("");
      return;
    }
    if (ROUTE_DISABLED_GROUP_IDS.has(currentGroup.id)) {
      setPrepareRoute("");
      return;
    }
    setPrepareRoute(
      currentGroup.id === LOCAL_ANESTHETIC_GROUP_ID
        ? DEFAULT_LOCAL_ANESTHETIC_ROUTE
        : DEFAULT_ROUTE,
    );
  }, [currentGroup]);

  useEffect(() => {
    setEntryRunId(prev => {
      if (prev == null) return null;
      if (activeRuns.some(run => run.id === prev)) return prev;
      return null;
    });
  }, [activeRuns]);

  useEffect(() => {
    if (!selectedCurrentItem) {
      setPrepareUom("");
      return;
    }
    setPrepareUom(String(selectedCurrentItem.default_unit || "").trim());
  }, [selectedCurrentItem]);

  useEffect(() => {
    if (caseId == null || caseStatus.status === "IDLE") {
      setEntryWeightKg("");
      return;
    }

    const applyWeight = () => {
      const saved = readWeightFromSavedForm(caseId);
      if (saved) setEntryWeightKg(saved);
    };

    applyWeight();
    const onFormStorageChanged = (event: Event) => {
      const custom = event as CustomEvent<{ caseId?: number }>;
      if (custom.detail?.caseId !== caseId) return;
      applyWeight();
    };
    window.addEventListener("flora:form-storage-changed", onFormStorageChanged);
    return () => {
      window.removeEventListener("flora:form-storage-changed", onFormStorageChanged);
    };
  }, [caseId, caseStatus.status]);

  useEffect(() => {
    if (!selectedEntryRun) {
      setEntryBolusUnit("");
      return;
    }
    const unit = String(
      selectedEntryRun.item_unit || (selectedEntryRun.kind === "med" ? "mg" : "ml"),
    ).trim();
    setEntryBolusUnit(unit);
    setEntryDoseUnit(prev =>
      DOSE_PER_KG_RATE_UNITS.includes(prev as (typeof DOSE_PER_KG_RATE_UNITS)[number])
        ? prev
        : "mcg/kg/min",
    );
  }, [selectedEntryRun]);

  const clearForm = () => {
    setEditingId(null);
    setForm(defaultForm(activeGroup.kind, activeGroup.category));
    setNote("");
    setError("");
  };

  const pickRow = (row: IoCatalogItem) => {
    setEditingId(row.id || null);
    setForm({
      ...row,
      category: row.category || "",
    });
    setNote(`${row.name} selected`);
  };

  const saveEntry = async () => {
    setSaving(true);
    setError("");
    setNote("");
    try {
      const payload = {
        kind: form.kind || activeGroup.kind,
        code: form.code || undefined,
        name: String(form.name || "").trim(),
        default_unit: String(form.default_unit || "").trim() || "ml",
        category: String(form.category || "").trim() || undefined,
      };
      if (!payload.name) throw new Error("Name is required");

      if (editingId != null) {
        await updateIoCatalogEntry(editingId, payload);
        setNote("Directory updated");
      } else {
        await createIoCatalogEntry(payload);
        setNote("Directory entry created");
      }

      await loadDirectory();
      clearForm();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save directory");
    } finally {
      setSaving(false);
    }
  };

  const deactivateEntry = async () => {
    if (editingId == null) return;
    setSaving(true);
    setError("");
    setNote("");
    try {
      await deactivateIoCatalogEntry(editingId);
      setNote("Directory entry deactivated");
      await loadDirectory();
      clearForm();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to deactivate entry");
    } finally {
      setSaving(false);
    }
  };

  const activateEntry = async () => {
    if (editingId == null) return;
    setSaving(true);
    setError("");
    setNote("");
    try {
      await updateIoCatalogEntry(editingId, { is_active: 1 });
      setNote("Directory entry activated");
      await loadDirectory();
      clearForm();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to activate entry");
    } finally {
      setSaving(false);
    }
  };

  const openEntryModal = (runId: number, mode: EntryMode = "bolus") => {
    const now = Date.now();
    setEntryRunId(runId);
    setEntryMode(mode);
    setEntryDate(toDateInput(now));
    setEntryTime(toTimeInput(now));
    setEntryEndDate("");
    setEntryEndTime("");
    setEntryBolusValue("");
    setEntryLocalRoute(
      selectedEntryRun?.route?.trim() || DEFAULT_LOCAL_ANESTHETIC_ROUTE,
    );
    setEntryLocalConcentration("");
    setEntryLocalVolumeMl("");
    setEntryRateValue("");
    setEntryVolumeMl("");
    setEntryDoseValue("");
    setEntryConcentrationValue("");
    setEntryCarrierFluidId(null);
    setEntryCarrierVolumeMl("");
    setEntryBloodGroup("");
    setEntryBloodBagNo("");
    setEntryNote("");
    setEntryError("");
  };

  const closeEntryModal = () => {
    if (entrySaving) return;
    setEntryRunId(null);
    setEntryError("");
  };

  const clearMedicationEntryModal = () => {
    setEntryBolusValue("");
    setEntryLocalRoute(
      selectedEntryRun?.route?.trim() || DEFAULT_LOCAL_ANESTHETIC_ROUTE,
    );
    setEntryLocalConcentration("");
    setEntryLocalVolumeMl("");
    setEntryNote("");
    setEntryError("");
  };

  const clearOutputEntryModal = () => {
    setEntryBolusValue("");
    setEntryNote("");
    setEntryError("");
  };

  const handleEntryModalKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (entrySaving) return;
    const target = e.target as HTMLElement | null;
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      closeEntryModal();
      return;
    }
    if (e.key !== "Enter" || e.shiftKey) return;
    if (target?.tagName === "TEXTAREA") return;
    e.preventDefault();
    e.stopPropagation();
    void saveEntryValue();
  };

  const openBloodProductModal = () => {
    const now = Date.now();
    setBloodProductModalOpen(true);
    setBloodProductSearch("");
    setBloodProductItemId(null);
    setShowBloodProductDropdown(false);
    setBloodProductDate(toDateInput(now));
    setBloodProductTime(toTimeInput(now));
    setBloodProductVolumeMl("");
    setBloodProductGroup("");
    setBloodProductBagNo("");
    setBloodProductNote("");
    setBloodProductError("");
  };

  const openMedDripModal = () => {
    const now = Date.now();
    setMedDripModalOpen(true);
    setMedDripSearch("");
    setMedDripItemId(null);
    setShowMedDripDropdown(false);
    setMedDripDate(toDateInput(now));
    setMedDripTime(toTimeInput(now));
    setMedDripRoute(DEFAULT_ROUTE);
    setMedDripAmountValue("");
    setMedDripAmountUnit("mg");
    setMedDripCarrierFluidId(null);
    setMedDripTotalVolumeMl("");
    setMedDripDoseValue("");
    setMedDripDoseUnit("mg/hr");
    setMedDripWeightKg(caseId != null ? readWeightFromSavedForm(caseId) : "");
    setMedDripRateMlHr("");
    setMedDripLastEdited("dose");
    setMedDripNote("");
    setMedDripManualMode(false);
    setMedDripManualCategory("");
    setMedDripError("");
  };

  const closeBloodProductModal = () => {
    if (bloodProductSaving) return;
    setBloodProductModalOpen(false);
    setShowBloodProductDropdown(false);
    setBloodProductError("");
  };

  const closeMedDripModal = () => {
    if (medDripSaving) return;
    setMedDripModalOpen(false);
    setShowMedDripDropdown(false);
    setMedDripManualMode(false);
    setMedDripManualCategory("");
    setMedDripError("");
    setMedDripEditRunId(null);
  };

  const openEditDripModal = (run: CaseIoRun) => {
    const meta = parseNoteTokens(run.note);
    const firstSeg = Array.isArray(run.segments)
      ? [...run.segments].sort((a, b) => Number(a.ts_from) - Number(b.ts_from))[0]
      : null;

    const startTs = Number(run.started_at);
    setMedDripEditRunId(run.id);
    setMedDripModalOpen(true);
    setMedDripSearch(run.item_name || run.item_code || "");
    setMedDripItemId(run.item_id);
    setMedDripManualMode(false);
    setMedDripManualCategory("");
    setShowMedDripDropdown(false);
    setMedDripDate(toDateInput(startTs));
    setMedDripTime(toTimeInput(startTs));
    setMedDripRoute(run.route || DEFAULT_ROUTE);
    const amountVal = meta.medAmount ? String(meta.medAmount) : "";
    const amountUnit = meta.medUnit || run.item_unit || "mg";
    setMedDripAmountValue(amountVal);
    setMedDripAmountUnit(amountUnit);
    const carrierName = meta.carrier || "Undilute";
    const carrierItem = carrierFluidOptions.find(
      item => item.name.toLowerCase() === carrierName.toLowerCase(),
    );
    setMedDripCarrierFluidId(carrierItem?.id ?? null);
    setMedDripTotalVolumeMl(meta.totalVolumeMl ? String(meta.totalVolumeMl) : "");
    const doseVal = firstSeg?.dose_value != null ? String(firstSeg.dose_value) : "";
    const doseUnit = (firstSeg?.dose_unit as typeof medDripDoseUnit) || "mg/hr";
    setMedDripDoseValue(doseVal);
    setMedDripDoseUnit(doseUnit);
    setMedDripWeightKg(caseId != null ? readWeightFromSavedForm(caseId) : "");
    const rateVal = firstSeg?.rate_value != null ? String(firstSeg.rate_value) : "";
    setMedDripRateMlHr(rateVal);
    setMedDripLastEdited("rate");
    setMedDripNote("");
    setMedDripError("");
  };

  const openFluidModal = () => {
    setFluidModalOpen(true);
    setFluidSearch("");
    setFluidItemId(null);
    setShowFluidDropdown(false);
    setFluidDate(toDateInput(Date.now()));
    setFluidTime(toTimeInput(Date.now()));
    setFluidEntryMode("bolus");
    setFluidVolumeMl("");
    setFluidOverMin("");
    setFluidRateMlHr("");
    setFluidNote("");
    setFluidError("");
    setFluidEditRunId(null);
  };

  const openFluidModalFromSuggestion = (item: CaseIoItem) => {
    closeMedDripModal();
    const now = Date.now();
    setFluidModalOpen(true);
    setFluidSearch(item.name);
    setFluidItemId(item.id);
    setShowFluidDropdown(false);
    setFluidDate(toDateInput(now));
    setFluidTime(toTimeInput(now));
    setFluidEntryMode("bolus");
    setFluidVolumeMl("");
    setFluidOverMin("");
    setFluidRateMlHr("");
    setFluidNote("");
    setFluidError("");
    setFluidEditRunId(null);
  };

  const openFluidEntryModal = (run: CaseIoRun) => {
    setFluidModalOpen(true);
    setFluidItemId(run.item_id);
    setFluidSearch(run.item_name || run.item_code || "");
    setShowFluidDropdown(false);
    setFluidDate(toDateInput(Date.now()));
    setFluidTime(toTimeInput(Date.now()));
    setFluidEntryMode("bolus");
    setFluidVolumeMl("");
    setFluidOverMin("");
    setFluidRateMlHr("");
    setFluidNote("");
    setFluidError("");
    setFluidEditRunId(null);
  };

  const openEditFluidDripModal = (run: CaseIoRun) => {
    const segment = activeDripSegment(run, Date.now());
    if (!segment) {
      setCurrentError("No running drip segment to edit");
      return;
    }
    const now = Date.now();
    setChangeRateError("");
    setChangeRateTarget({
      runId: run.id,
      segmentId: segment.id,
      itemName: run.item_name || run.item_code || `Item ${run.item_id}`,
      kind: "fluid",
      date: toDateInput(now),
      time: toTimeInput(now),
      rateValue: segment.rate_value != null ? String(segment.rate_value) : "",
      doseValue: "",
      doseUnit: "ml/hr",
    });
  };

  const closeFluidModal = () => {
    if (fluidSaving) return;
    setFluidModalOpen(false);
    setShowFluidDropdown(false);
    setFluidError("");
    setFluidEditRunId(null);
  };

  const selectFluidItem = (item: CaseIoItem) => {
    setFluidItemId(item.id);
    setFluidSearch(item.name);
    setShowFluidDropdown(false);
    window.setTimeout(() => {
      fluidFirstFieldRef.current?.focus();
      fluidFirstFieldRef.current?.select();
    }, 0);
  };

  const handleFluidModalKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (fluidSaving) return;
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      closeFluidModal();
      return;
    }
    if (e.key !== "Enter" || e.shiftKey) return;
    if ((e.target as HTMLElement)?.tagName === "TEXTAREA") return;
    if (showFluidDropdown) return;
    e.preventDefault();
    e.stopPropagation();
    void saveFluid();
  };

  const saveFluid = async () => {
    if (caseId == null || caseStatus.status === "IDLE") return;
    if (!selectedFluidItem) {
      setFluidError("Select fluid first");
      return;
    }
    if (!hasValidDateTimeInput(fluidDate, fluidTime)) {
      setFluidError("Date must be dd/mm/yyyy and time HH:mm");
      return;
    }
    const ts = combineDateAndTime(fluidDate, fluidTime, Date.now());
    // Edit existing drip: rate-based replace
    if (fluidEditRunId != null) {
      const rate = Number(fluidRateMlHr);
      if (!Number.isFinite(rate) || rate <= 0) {
        setFluidError("Rate must be > 0");
        return;
      }
      setFluidSaving(true);
      setFluidError("");
      try {
        await replaceCaseIoDrip(caseId, fluidEditRunId, {
          actor,
          reason: "io-balance fluid drip edit",
          run: {
            item_id: selectedFluidItem.id,
            started_at: ts,
            route: "IV",
            note: fluidNote.trim() || undefined,
          },
          segment: {
            ts_from: ts,
            rate_value: rate,
            rate_unit: "ml/hr",
            include_in_balance: true,
          },
        });
        await loadCurrentCase(caseId, caseStatus);
        notifyIoAndEventChanged(caseId);
        closeFluidModal();
      } catch (err) {
        setFluidError(err instanceof Error ? err.message : "Failed to save fluid drip");
      } finally {
        setFluidSaving(false);
      }
      return;
    }
    setFluidSaving(true);
    setFluidError("");
    try {
      if (fluidEntryMode === "running") {
        const rate = Number(fluidRateMlHr);
        if (!Number.isFinite(rate) || rate <= 0) {
          setFluidError("Rate must be > 0");
          setFluidSaving(false);
          return;
        }
        await createCaseIoDrip(caseId, {
          actor,
          reason: "io-balance fluid running drip entry",
          run: {
            item_id: selectedFluidItem.id,
            kind: "fluid",
            started_at: ts,
            route: "IV",
            entry_mode: "drip",
            include_in_balance: true,
            note: fluidNote.trim() || undefined,
          },
          segment: {
            ts_from: ts,
            rate_value: Math.round(rate * 10) / 10,
            rate_unit: "ml/hr",
            include_in_balance: true,
          },
        });
      } else if (fluidEntryMode === "timed") {
        const vol = Number(fluidVolumeMl);
        if (!Number.isFinite(vol) || vol <= 0) {
          setFluidError("Volume must be > 0");
          setFluidSaving(false);
          return;
        }
        const overMin = Number(fluidOverMin);
        if (!Number.isFinite(overMin) || overMin <= 0) {
          setFluidError("Over min must be > 0");
          setFluidSaving(false);
          return;
        }
        const endTs = ts + overMin * 60_000;
        const rateMlHr = vol / (overMin / 60);
        await createCaseIoDrip(caseId, {
          actor,
          reason: "io-balance fluid over-time entry",
          run: {
            item_id: selectedFluidItem.id,
            kind: "fluid",
            started_at: ts,
            route: "IV",
            entry_mode: "drip",
            include_in_balance: true,
            note: fluidNote.trim() || undefined,
          },
          segment: {
            ts_from: ts,
            ts_to: endTs,
            rate_value: Math.round(rateMlHr * 10) / 10,
            rate_unit: "ml/hr",
            include_in_balance: true,
          },
        });
      } else {
        const vol = Number(fluidVolumeMl);
        if (!Number.isFinite(vol) || vol <= 0) {
          setFluidError("Volume must be > 0");
          setFluidSaving(false);
          return;
        }
        await createCaseIoEvent(caseId, {
          item_id: selectedFluidItem.id,
          kind: "fluid",
          event_ts: ts,
          volume_ml: vol,
          note: fluidNote.trim() || undefined,
          include_in_balance: true,
          reason: "io-balance fluid bolus",
          actor,
        });
      }
      await loadCurrentCase(caseId, caseStatus);
      notifyIoAndEventChanged(caseId);
      closeFluidModal();
    } catch (err) {
      setFluidError(err instanceof Error ? err.message : "Failed to save fluid");
    } finally {
      setFluidSaving(false);
    }
  };

  const selectMedDripItem = (item: CaseIoItem) => {
    setMedDripItemId(item.id);
    setMedDripSearch(item.name);
    setMedDripManualMode(false);
    setMedDripManualCategory("");
    setMedDripAmountUnit(item.default_unit || "mg");
    setMedDripDoseUnit(
      normalizeDisplayUnit("med", item.default_unit || "mg").toLowerCase() === "mcg"
        ? "mcg/min"
        : normalizeDisplayUnit("med", item.default_unit || "mg").toLowerCase() === "units"
          ? "units/hr"
          : normalizeDisplayUnit("med", item.default_unit || "mg").toLowerCase() === "munits"
            ? "MUnits/hr"
        : "mg/hr",
    );
    setMedDripLastEdited("dose");
    setShowMedDripDropdown(false);
    window.setTimeout(() => {
      medDripAmountInputRef.current?.focus();
      medDripAmountInputRef.current?.select();
    }, 0);
  };

  const handleBloodProductModalKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (bloodProductSaving) return;
    const target = e.target as HTMLElement | null;
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      closeBloodProductModal();
      return;
    }
    if (e.key !== "Enter" || e.shiftKey) return;
    if (target?.tagName === "TEXTAREA") return;
    if (showBloodProductDropdown) return;
    e.preventDefault();
    e.stopPropagation();
    void saveBloodProduct();
  };

  const handleMedDripModalKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (medDripSaving) return;
    const target = e.target as HTMLElement | null;
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      closeMedDripModal();
      return;
    }
    if (e.key !== "Enter" || e.shiftKey) return;
    if (target?.tagName === "TEXTAREA") return;
    e.preventDefault();
    e.stopPropagation();
    void saveMedDrip();
  };

  const saveBloodProduct = async () => {
    if (caseId == null || caseStatus.status === "IDLE") return;
    if (!selectedBloodProductItem) {
      setBloodProductError("Select blood product first");
      return;
    }
    if (!hasValidDateTimeInput(bloodProductDate, bloodProductTime)) {
      setBloodProductError("Time must be dd/mm/yyyy and HH:mm");
      return;
    }

    const volumeMl = Number(bloodProductVolumeMl);
    if (!Number.isFinite(volumeMl) || volumeMl <= 0) {
      setBloodProductError("Volume must be > 0");
      return;
    }

    const normalizedBloodGroup = bloodProductGroup.trim().toUpperCase();
    const normalizedBagNo = bloodProductBagNo.trim();
    if (!normalizedBagNo) {
      setBloodProductError("Blood bag no. is required");
      return;
    }
    if (selectedBloodProductType && !normalizedBloodGroup) {
      setBloodProductError("Blood group is required for PRC/FFP");
      return;
    }

    setBloodProductSaving(true);
    setBloodProductError("");
    try {
      const eventTs = combineDateAndTime(bloodProductDate, bloodProductTime, Date.now());
      const note =
        buildEntryNote(
          bloodProductNote,
          selectedBloodProductType,
          normalizedBloodGroup,
          normalizedBagNo,
          true,
        ) || undefined;

      await createCaseIoBloodProduct(caseId, {
        actor,
        reason: "io-balance blood product entry",
        run: {
          item_id: selectedBloodProductItem.id,
          route: "IV",
          include_in_balance: true,
        },
        event: {
          event_ts: eventTs,
          volume_ml: volumeMl,
          note,
          include_in_balance: true,
        },
      });

      await loadCurrentCase(caseId, caseStatus);
      notifyIoAndEventChanged(caseId);
      setBloodProductModalOpen(false);
      setBloodProductSearch("");
      setBloodProductItemId(null);
      setShowBloodProductDropdown(false);
      setBloodProductVolumeMl("");
      setBloodProductGroup("");
      setBloodProductBagNo("");
      setBloodProductNote("");
    } catch (err) {
      setBloodProductError(
        err instanceof Error ? err.message : "Failed to save blood product",
      );
    } finally {
      setBloodProductSaving(false);
    }
  };

  const saveMedDrip = async () => {
    if (caseId == null || caseStatus.status === "IDLE") return;
    if (!selectedMedDripItem && !medDripManualMode) {
      setMedDripError("Select medication first");
      return;
    }
    if (!hasValidDateTimeInput(medDripDate, medDripTime)) {
      setMedDripError("Start must be dd/mm/yyyy and HH:mm");
      return;
    }

    const amountValue = Number(medDripAmountValue);
    if (!Number.isFinite(amountValue) || amountValue <= 0) {
      setMedDripError("Drug amount must be > 0");
      return;
    }

    const totalVolumeMl = Number(medDripTotalVolumeMl);
    if (!Number.isFinite(totalVolumeMl) || totalVolumeMl <= 0) {
      setMedDripError("Total volume must be > 0");
      return;
    }

    const doseValue = Number(medDripDoseValue);
    if (!Number.isFinite(doseValue) || doseValue <= 0) {
      setMedDripError("Dose must be > 0");
      return;
    }
    if (medDripIsWeightBased) {
      const weightKg = Number(medDripWeightKg);
      if (!Number.isFinite(weightKg) || weightKg <= 0) {
        setMedDripError("Weight must be > 0 for weight-based dose");
        return;
      }
    }
    const rateMlHr = Number(medDripRateMlHr);
    if (!Number.isFinite(rateMlHr) || rateMlHr <= 0) {
      setMedDripError("Unable to calculate rate");
      return;
    }

    const startTs = combineDateAndTime(medDripDate, medDripTime, Date.now());
    const activeItem = selectedMedDripItem;
    let effectiveItemId = activeItem?.id ?? null;
    let effectiveDefaultUnit = activeItem?.default_unit || "mg";
    if (!activeItem && medDripManualMode) {
      const manualName = medDripSearch.trim();
      const manualCategory = medDripManualCategory.trim();
      if (!manualName) {
        setMedDripError("Enter medication name");
        return;
      }
      if (!manualCategory) {
        setMedDripError("Select medication group");
        return;
      }
      try {
        const createdManualItem = await createIoCatalogEntry({
          kind: "med",
          name: manualName,
          default_unit: medDripAmountUnit.trim() || "mg",
          category: manualCategory,
          is_active: 0,
        });
        effectiveItemId = createdManualItem.id ?? null;
        effectiveDefaultUnit = createdManualItem.default_unit || medDripAmountUnit.trim() || "mg";
      } catch (err) {
        setMedDripError(
          err instanceof Error ? err.message : "Failed to create case-only medication",
        );
        return;
      }
    }
    if (effectiveItemId == null) {
      setMedDripError("Select medication first");
      return;
    }

    const amountUnit = medDripAmountUnit.trim() || effectiveDefaultUnit || "mg";
    const concentrationPerMl = totalVolumeMl > 0 ? round4(amountValue / totalVolumeMl) : null;
    const carrierName =
      medDripCarrierFluidId != null
        ? carrierFluidOptions.find(item => item.id === medDripCarrierFluidId)?.name || "Undilute"
        : "Undilute";

    setMedDripSaving(true);
    setMedDripError("");
    try {
      const segmentNote = [
        medDripNote.trim(),
        `dripVolumeMl:${round2(totalVolumeMl)}`,
        concentrationPerMl != null
          ? `concentration:${concentrationPerMl} ${amountUnit}/mL`
          : "",
        medDripManualMode ? "manualcase:1" : "",
      ]
        .filter(Boolean)
        .join(" | ");

      const runNote = [
        medDripNote.trim(),
        `medAmount:${round4(amountValue)}`,
        `medUnit:${amountUnit}`,
        `totalVolumeMl:${round2(totalVolumeMl)}`,
        `carrier:${carrierName}`,
        medDripManualMode ? "manualcase:1" : "",
      ]
        .filter(Boolean)
        .join(" | ");

      if (medDripEditRunId != null) {
        await replaceCaseIoDrip(caseId, medDripEditRunId, {
          actor,
          reason: "io-balance med drip edit",
          run: {
            item_id: effectiveItemId,
            started_at: startTs,
            route: medDripRoute.trim() || DEFAULT_ROUTE,
            note: runNote,
          },
          segment: {
            ts_from: startTs,
            rate_value: round4(rateMlHr),
            rate_unit: "ml/hr",
            dose_value: round4(doseValue),
            dose_unit: medDripDoseUnit,
            include_in_balance: true,
            note: segmentNote || undefined,
          },
        });
      } else {
        await createCaseIoDrip(caseId, {
          actor,
          reason: medDripManualMode ? "io-balance med drip manual start" : "io-balance med drip start",
          run: {
            item_id: effectiveItemId,
            kind: "med",
            started_at: startTs,
            route: medDripRoute.trim() || DEFAULT_ROUTE,
            entry_mode: "drip",
            include_in_balance: true,
            note: runNote,
          },
          segment: {
            ts_from: startTs,
            rate_value: round4(rateMlHr),
            rate_unit: "ml/hr",
            dose_value: round4(doseValue),
            dose_unit: medDripDoseUnit,
            include_in_balance: true,
            note: segmentNote || undefined,
          },
        });
      }

      await loadCurrentCase(caseId, caseStatus);
      notifyIoAndEventChanged(caseId);
      closeMedDripModal();
    } catch (err) {
      setMedDripError(err instanceof Error ? err.message : "Failed to start med drip");
    } finally {
      setMedDripSaving(false);
    }
  };

  const resetMedicationComposer = () => {
    setItemSearch("");
    setCurrentGroupId("");
    setPrepareItemId(null);
    setPrepareRoute("");
    setPrepareUom("");
    setPrepareDate(toDateInput(Date.now()));
    setPrepareTime(toTimeInput(Date.now()));
    setPrepareDoseValue("");
    setPrepareLocalConcentration("");
    setPrepareLocalVolumeMl("");
    setShowItemDropdown(false);
  };

  const selectMedicationBolusItem = (item: CaseIoItem) => {
    const groupId = resolveGroupId(
      item.kind,
      item.category,
      item.code || item.name,
      detailedGroups,
    );
    const group = detailedGroupById.get(groupId);
    setPrepareItemId(item.id);
    setItemSearch(item.name);
    setCurrentGroupId(groupId);
    setPrepareRoute(
      group && !ROUTE_DISABLED_GROUP_IDS.has(group.id)
        ? group.id === LOCAL_ANESTHETIC_GROUP_ID
          ? DEFAULT_LOCAL_ANESTHETIC_ROUTE
          : DEFAULT_ROUTE
        : "",
    );
    setPrepareUom(item.default_unit || "");
    setShowItemDropdown(false);
    window.requestAnimationFrame(() => medicationBolusAmountInputRef.current?.focus());
  };

  const openPopularMedicationBolus = (item: CaseIoItem) => {
    resetMedicationComposer();
    setCurrentError("");
    setMedBolusComposerOpen(true);
    selectMedicationBolusItem(item);
  };

  const handleMedicationPrepare = async () => {
    if (caseId == null || caseStatus.status === "IDLE") return;
    setCurrentError("");

    if (!currentGroup || currentGroup.kind !== "med") {
      setCurrentError("Select medication group first");
      return;
    }
    if (prepareItemId == null) {
      setCurrentError("Select item first");
      return;
    }

    const selectedUom = String(prepareUom || "").trim();
    const normalizedDefaultUnit = String(selectedCurrentItem?.default_unit || "").trim();
    const normalizedRoute = prepareRoute.trim();
    const noteParts: string[] = [];
    if (
      !isCurrentGroupLocalAnesthetic &&
      selectedUom &&
      selectedUom !== normalizedDefaultUnit
    ) {
      noteParts.push(`uom:${selectedUom}`);
    }

    setCurrentSaving(true);
    try {
      let run =
        activeRuns.find(
          candidate =>
            candidate.kind === "med" &&
            candidate.item_id === prepareItemId &&
            (candidate.entry_mode || "bolus") === "bolus",
        ) || null;

      if (!run) {
        run = await createCaseIoRun(caseId, {
          item_id: prepareItemId,
          kind: "med",
          route:
            normalizedRoute ||
            (isCurrentGroupLocalAnesthetic
              ? DEFAULT_LOCAL_ANESTHETIC_ROUTE
              : DEFAULT_ROUTE),
          entry_mode: "bolus",
          include_in_balance: true,
          note: noteParts.length > 0 ? noteParts.join(" | ") : undefined,
          reason: "io-balance medication save item",
          actor,
        });
      }

      const hasDose = String(prepareDoseValue || "").trim().length > 0;
      const hasLocalConcentration = String(prepareLocalConcentration || "").trim().length > 0;
      const hasLocalVolume = String(prepareLocalVolumeMl || "").trim().length > 0;
      const hasImmediateValue = isCurrentGroupLocalAnesthetic
        ? hasLocalConcentration || hasLocalVolume
        : hasDose;

      if (hasImmediateValue) {
        if (!hasValidDateTimeInput(prepareDate, prepareTime)) {
          throw new Error("Time must be HH:mm");
        }
        let numericDose = 0;
        let doseUnit = selectedUom || normalizedDefaultUnit || run.item_unit || "mg";
        let eventNote: string | undefined;

        if (isCurrentGroupLocalAnesthetic) {
          if (!hasLocalConcentration || !hasLocalVolume) {
            throw new Error("Concentration (%) and volume (mL) must both be filled");
          }
          const numericConcentration = Number(prepareLocalConcentration);
          const numericVolumeMl = Number(prepareLocalVolumeMl);
          if (!Number.isFinite(numericConcentration) || numericConcentration <= 0) {
            throw new Error("Concentration must be > 0");
          }
          if (!Number.isFinite(numericVolumeMl) || numericVolumeMl <= 0) {
            throw new Error("Volume must be > 0");
          }
          numericDose = round2(
            concentrationPercentToMg(numericConcentration, numericVolumeMl),
          );
          doseUnit = "mg";
          eventNote = [
            `concentration:${round4(numericConcentration)}%`,
            `volumeMl:${round2(numericVolumeMl)}`,
            normalizedRoute
              ? `route:${normalizedRoute}`
              : `route:${DEFAULT_LOCAL_ANESTHETIC_ROUTE}`,
          ].join(" | ");
        } else {
          numericDose = Number(prepareDoseValue);
          if (!Number.isFinite(numericDose) || numericDose <= 0) {
            throw new Error("Dose must be > 0");
          }
        }

        await createCaseIoEvent(caseId, {
          item_id: run.item_id,
          kind: "med",
          event_ts: combineDateAndTime(prepareDate, prepareTime, Date.now()),
          dose_value: numericDose,
          dose_unit: doseUnit,
          note: eventNote,
          include_in_balance: true,
          reason: "io-balance medication quick bolus",
          actor,
        });
      }

      await loadCurrentCase(caseId, caseStatus);
      notifyIoAndEventChanged(caseId);
      resetMedicationComposer();
      setMedBolusComposerOpen(false);
    } catch (err) {
      setCurrentError(err instanceof Error ? err.message : "Failed to save medication");
    } finally {
      setCurrentSaving(false);
    }
  };

  const handleRemoveRun = async (runId: number, itemName: string) => {
    if (caseId == null || caseStatus.status === "IDLE") return;
    setPendingRemove({ runId, itemName });
  };

  const openStopDripModal = (run: CaseIoRun) => {
    const segment = activeDripSegment(run, Date.now());
    if (!segment) {
      setCurrentError("No running drip segment to stop");
      return;
    }
    const now = Date.now();
    setStopDripError("");
    setStopDripTarget({
      runId: run.id,
      segmentId: segment.id,
      itemName: run.item_name || run.item_code || `Item ${run.item_id}`,
      date: toDateInput(now),
      time: toTimeInput(now),
    });
  };

  const closeStopDripModal = () => {
    if (stopDripSaving) return;
    setStopDripTarget(null);
    setStopDripError("");
  };

  const confirmStopDrip = async () => {
    if (!stopDripTarget) return;
    if (caseId == null || caseStatus.status === "IDLE") return;
    const run = activeRuns.find(candidate => candidate.id === stopDripTarget.runId) || null;
    const segment =
      run && Array.isArray(run.segments)
        ? run.segments.find(candidate => candidate.id === stopDripTarget.segmentId) || null
        : null;
    if (!run || !segment) {
      setStopDripError("Running drip segment not found");
      return;
    }
    if (!hasValidDateTimeInput(stopDripTarget.date, stopDripTarget.time)) {
      setStopDripError("Stop must be dd/mm/yyyy and HH:mm");
      return;
    }
    const stopTs = combineDateAndTime(stopDripTarget.date, stopDripTarget.time, Date.now());
    if (!Number.isFinite(stopTs) || stopTs <= Number(segment.ts_from)) {
      setStopDripError("Stop time must be after drip start");
      return;
    }

    setStopDripSaving(true);
    setStopDripError("");
    try {
      await updateCaseIoSegment(caseId, segment.id, {
        ts_to: stopTs,
        reason: "io-balance stop drip",
        actor,
      });
      await updateCaseIoRun(caseId, run.id, {
        stopped_at: stopTs,
        reason: "io-balance stop drip",
        actor,
      });
      await loadCurrentCase(caseId, caseStatus);
      notifyIoAndEventChanged(caseId);
      setStopDripTarget(null);
    } catch (err) {
      setStopDripError(err instanceof Error ? err.message : "Failed to stop drip");
    } finally {
      setStopDripSaving(false);
    }
  };


  const closeChangeRateModal = () => {
    if (changeRateSaving) return;
    setChangeRateTarget(null);
    setChangeRateError("");
  };

  const confirmChangeRate = async () => {
    if (!changeRateTarget) return;
    if (caseId == null || caseStatus.status === "IDLE") return;
    const run = activeRuns.find(r => r.id === changeRateTarget.runId) || null;
    const segment =
      run && Array.isArray(run.segments)
        ? run.segments.find(s => s.id === changeRateTarget.segmentId) || null
        : null;
    if (!run || !segment) {
      setChangeRateError("Running drip segment not found");
      return;
    }
    if (!hasValidDateTimeInput(changeRateTarget.date, changeRateTarget.time)) {
      setChangeRateError("Time must be dd/mm/yyyy and HH:mm");
      return;
    }
    const changeTs = combineDateAndTime(changeRateTarget.date, changeRateTarget.time, Date.now());
    if (!Number.isFinite(changeTs) || changeTs <= Number(segment.ts_from)) {
      setChangeRateError("Change time must be after drip start time");
      return;
    }
    const newRate = parsePositiveNumber(changeRateTarget.rateValue);
    if (!newRate) {
      setChangeRateError("New rate (mL/hr) must be > 0");
      return;
    }
    const newDose =
      changeRateTarget.kind === "fluid"
        ? null
        : parsePositiveNumber(changeRateTarget.doseValue);

    setChangeRateSaving(true);
    setChangeRateError("");
    try {
      await updateCaseIoSegment(caseId, segment.id, {
        ts_to: changeTs,
        reason: "io-balance change drip rate",
        actor,
      });
      await createCaseIoSegment(caseId, {
        run_id: run.id,
        ts_from: changeTs,
        rate_value: round4(newRate),
        rate_unit: "ml/hr",
        dose_value: newDose ? round4(newDose) : undefined,
        dose_unit: newDose ? changeRateTarget.doseUnit : undefined,
        include_in_balance: true,
        reason: "io-balance change drip rate",
        actor,
      });
      await loadCurrentCase(caseId, caseStatus);
      notifyIoAndEventChanged(caseId);
      setChangeRateTarget(null);
    } catch (err) {
      setChangeRateError(err instanceof Error ? err.message : "Failed to change rate");
    } finally {
      setChangeRateSaving(false);
    }
  };

  const handleDeleteEvent = async (eventId: number) => {
    if (caseId == null || caseStatus.status === "IDLE") return;
    setDeletingEventId(eventId);
    try {
      await deleteCaseIoEvent(caseId, eventId, actor, "io-balance delete entry");
      await loadCurrentCase(caseId, caseStatus);
      notifyIoAndEventChanged(caseId);
    } catch (err) {
      setCurrentError(err instanceof Error ? err.message : "Failed to delete entry");
    } finally {
      setDeletingEventId(null);
    }
  };

  const confirmRemoveRun = async () => {
    if (!pendingRemove) return;
    if (caseId == null || caseStatus.status === "IDLE") return;
    const { runId } = pendingRemove;
    setCurrentError("");
    setRemovingRunId(runId);
    try {
      await discontinueCaseIoRun(caseId, runId, {
        stopped_at: Date.now(),
        reason: "fluidmed discontinue item from current case",
        actor,
      });
      await loadCurrentCase(caseId, caseStatus);
      notifyIoAndEventChanged(caseId);
      setPendingRemove(null);
    } catch (err) {
      setCurrentError(err instanceof Error ? err.message : "Failed to remove item");
    } finally {
      setRemovingRunId(null);
    }
  };

  const calculateDripOneMissing = () => {
    if (!hasValidDateTimeInput(entryDate, entryTime)) {
      throw new Error("Start must be dd/mm/yyyy and HH:mm (24h)");
    }
    if ((entryEndDate && !entryEndTime) || (!entryEndDate && entryEndTime)) {
      throw new Error("End requires both date and time");
    }
    if (entryEndDate && entryEndTime && !hasValidDateTimeInput(entryEndDate, entryEndTime)) {
      throw new Error("End must be dd/mm/yyyy and HH:mm (24h)");
    }

    const startTs = combineDateAndTime(entryDate, entryTime, Date.now());
    let endTs =
      entryEndDate && entryEndTime
        ? combineDateAndTime(entryEndDate, entryEndTime, startTs)
        : null;
    if (endTs != null && endTs <= startTs) {
      throw new Error("End time must be after start time");
    }

    let rateMlHr = parsePositiveNumber(entryRateValue);
    let volumeMl = parsePositiveNumber(entryVolumeMl);
    let durationMin =
      endTs != null && Number.isFinite(endTs) && endTs > startTs
        ? (endTs - startTs) / 60000
        : null;

    const weightKg = parsePositiveNumber(entryWeightKg);
    const dosePerKg = parsePositiveNumber(entryDoseValue);
    const doseMcgPerKgMin =
      dosePerKg == null ? null : doseToMcgPerKgMin(dosePerKg, entryDoseUnit);
    const concentrationValue = parsePositiveNumber(entryConcentrationValue);
    const concentrationMcgPerMl =
      concentrationValue == null
        ? null
        : concentrationToMcgPerMl(concentrationValue, "mg/mL");

    if (
      rateMlHr == null &&
      doseMcgPerKgMin != null &&
      weightKg != null &&
      concentrationMcgPerMl != null
    ) {
      rateMlHr = (doseMcgPerKgMin * weightKg * 60) / concentrationMcgPerMl;
    }

    if (durationMin != null && durationMin > 0) {
      if (rateMlHr == null && volumeMl != null) {
        rateMlHr = (volumeMl * 60) / durationMin;
      } else if (volumeMl == null && rateMlHr != null) {
        volumeMl = (rateMlHr * durationMin) / 60;
      }
    } else if (rateMlHr != null && volumeMl != null) {
      durationMin = (volumeMl / rateMlHr) * 60;
      endTs = startTs + durationMin * 60_000;
    }

    let resolvedDosePerKg = dosePerKg;
    if (
      resolvedDosePerKg == null &&
      rateMlHr != null &&
      weightKg != null &&
      concentrationMcgPerMl != null
    ) {
      const mcgPerKgPerMin = (rateMlHr * concentrationMcgPerMl) / 60 / weightKg;
      resolvedDosePerKg = mcgPerKgMinToUnit(mcgPerKgPerMin, entryDoseUnit);
    }

    if (rateMlHr == null) {
      throw new Error("Need enough data to calculate rate (mL/hr)");
    }
    if (durationMin == null || !Number.isFinite(durationMin) || durationMin <= 0) {
      throw new Error("Need end time or volume to calculate drip duration");
    }
    if (volumeMl == null) {
      throw new Error("Need enough data to calculate volume (mL)");
    }

    return {
      startTs,
      endTs,
      rateMlHr: round4(rateMlHr),
      volumeMl: round2(volumeMl),
      durationMin: round2(durationMin),
      dosePerKg: resolvedDosePerKg == null ? null : round4(resolvedDosePerKg),
    };
  };

  const previewDripCalculation = () => {
    try {
      const calc = calculateDripOneMissing();
      setEntryRateValue(String(calc.rateMlHr));
      setEntryVolumeMl(String(calc.volumeMl));
      if (calc.endTs != null) {
        setEntryEndDate(toDateInput(calc.endTs));
        setEntryEndTime(toTimeInput(calc.endTs));
      }
      if (calc.dosePerKg != null) setEntryDoseValue(String(calc.dosePerKg));
      setEntryError("");
    } catch (err) {
      setEntryError(err instanceof Error ? err.message : "Unable to calculate drip");
    }
  };

  const saveEntryValue = async () => {
    if (caseId == null || caseStatus.status === "IDLE") return;
    if (!selectedEntryRun) {
      setEntryError("Select item first");
      return;
    }

    if (!hasValidDateTimeInput(entryDate, entryTime)) {
      setEntryError("Start must be dd/mm/yyyy and HH:mm (24h)");
      return;
    }
    const eventTs = combineDateAndTime(entryDate, entryTime, Date.now());
    const baseReason = "fluidmed entry from io-balance";
    setEntryError("");
    setEntrySaving(true);

    try {
      const normalizedBloodGroup = entryBloodGroup.trim().toUpperCase();
      const normalizedBloodBagNo = entryBloodBagNo.trim();
      if (entryIsBloodProduct && !normalizedBloodBagNo) {
        throw new Error("Blood bag no. is required for blood product");
      }
      if (entryBloodProductType && !normalizedBloodGroup) {
        throw new Error("Blood group is required for PRC/FFP");
      }

      if (entryMode === "bolus") {
        if (selectedEntryRun.kind === "med") {
          let numericDose = 0;
          let doseUnit = entryBolusUnit.trim() || selectedEntryRun.item_unit || "mg";
          let finalNote =
            buildEntryNote(
              entryNote,
              entryBloodProductType,
              normalizedBloodGroup,
              normalizedBloodBagNo,
              entryIsBloodProduct,
            ) || "";

          if (entryIsLocalAnesthetic) {
            const concentrationPercent = Number(entryLocalConcentration);
            const volumeMl = Number(entryLocalVolumeMl);
            if (!Number.isFinite(concentrationPercent) || concentrationPercent <= 0) {
              throw new Error("Concentration must be > 0");
            }
            if (!Number.isFinite(volumeMl) || volumeMl <= 0) {
              throw new Error("Volume must be > 0");
            }
            numericDose = round2(
              concentrationPercentToMg(concentrationPercent, volumeMl),
            );
            doseUnit = "mg";
            finalNote = [
              finalNote,
              `concentration:${round4(concentrationPercent)}%`,
              `volumeMl:${round2(volumeMl)}`,
              `route:${entryLocalRoute.trim() || DEFAULT_LOCAL_ANESTHETIC_ROUTE}`,
            ]
              .filter(Boolean)
              .join(" | ");
          } else {
            const numericValue = Number(entryBolusValue);
            if (!Number.isFinite(numericValue) || numericValue <= 0) {
              throw new Error("Dose must be > 0");
            }
            numericDose = numericValue;
          }

          await createCaseIoEvent(caseId, {
            item_id: selectedEntryRun.item_id,
            kind: selectedEntryRun.kind,
            event_ts: eventTs,
            dose_value: numericDose,
            dose_unit: doseUnit,
            note: finalNote || undefined,
            include_in_balance: true,
            reason: `${baseReason}: bolus`,
            actor,
          });
        } else {
          const numericValue = Number(entryBolusValue);
          if (!Number.isFinite(numericValue) || numericValue <= 0) {
            throw new Error("Volume must be > 0");
          }
          await createCaseIoEvent(caseId, {
            item_id: selectedEntryRun.item_id,
            kind: selectedEntryRun.kind,
            event_ts: eventTs,
            volume_ml: numericValue,
            note:
              buildEntryNote(
                entryNote,
                entryBloodProductType,
                normalizedBloodGroup,
                normalizedBloodBagNo,
                entryIsBloodProduct,
            ) || undefined,
            include_in_balance: true,
            reason: `${baseReason}: bolus`,
            actor,
          });
        }
      } else {
        const calc = calculateDripOneMissing();
        const carrierVolumeMl = Number(entryCarrierVolumeMl);
        const hasCarrierVolume = Number.isFinite(carrierVolumeMl) && carrierVolumeMl > 0;
        const carrierMlPerHr =
          hasCarrierVolume && calc.durationMin > 0
            ? (carrierVolumeMl * 60) / calc.durationMin
            : null;
        const carrier = carrierFluidOptions.find(item => item.id === entryCarrierFluidId);
        const noteParts = [
          buildEntryNote(
            entryNote,
            entryBloodProductType,
            normalizedBloodGroup,
            normalizedBloodBagNo,
            entryIsBloodProduct,
          ),
        ];
        if (carrier) noteParts.push(`carrier:${carrier.name}`);
        if (hasCarrierVolume) noteParts.push(`carrierVolumeMl:${round2(carrierVolumeMl)}`);
        noteParts.push(`dripVolumeMl:${calc.volumeMl}`);
        noteParts.push(`dripDurationMin:${calc.durationMin}`);
        const composedNote = noteParts.filter(Boolean).join(" | ");

        await createCaseIoSegment(caseId, {
          run_id: selectedEntryRun.id,
          ts_from: calc.startTs,
          ts_to: calc.endTs ?? undefined,
          rate_value: calc.rateMlHr,
          rate_unit: "ml/hr",
          dose_value: calc.dosePerKg ?? undefined,
          dose_unit: calc.dosePerKg != null
            ? entryDoseUnit.trim() || selectedEntryRun.item_unit || "mg"
            : undefined,
          carrier_ml_per_hr:
            selectedEntryRun.kind === "output" || carrierMlPerHr == null
              ? undefined
              : round4(carrierMlPerHr),
          note: composedNote || undefined,
          include_in_balance: true,
          reason: `${baseReason}: drip`,
          actor,
        });
      }

      await loadCurrentCase(caseId, caseStatus);
      notifyIoAndEventChanged(caseId);
      setEntryBolusValue("");
      setEntryLocalConcentration("");
      setEntryLocalVolumeMl("");
      setEntryRateValue("");
      setEntryVolumeMl("");
      setEntryDoseValue("");
      setEntryConcentrationValue("");
      setEntryEndDate("");
      setEntryEndTime("");
      setEntryCarrierVolumeMl("");
      setEntryCarrierFluidId(null);
      setEntryBloodGroup("");
      setEntryBloodBagNo("");
      setEntryNote("");
      const now = Date.now();
      setEntryDate(toDateInput(now));
      setEntryTime(toTimeInput(now));
      setEntryRunId(null);
    } catch (err) {
      setEntryError(err instanceof Error ? err.message : "Failed to save entry");
    } finally {
      setEntrySaving(false);
    }
  };

  const renderItemGroupCards = (
    groups: Array<(typeof itemGroups)[number]>,
    emptyText: string,
    prefix: string,
  ) => {
    if (groups.length === 0) {
      return <div className="text-xs text-gray-500 dark:text-gray-400">{emptyText}</div>;
    }

    return (
      <div className="space-y-2">
        {groups.map(group => {
          const visual = getItemVisual(group.kind, group.displayMode, group.category);
          const categoryToken = normalizeToken(group.category);
          const hasSelfContainedOutputIcon =
            group.kind === "output" &&
            (categoryToken === "bloodlossoutput" || categoryToken === "urineoutput");
          const run = group.runId != null
            ? currentRuns.find(candidate => candidate.id === group.runId) || null
            : null;
          const canStopDrip =
            run != null &&
            group.entryMode === "drip" &&
            run.stopped_at == null &&
            activeDripSegment(run, Date.now()) != null;
          const totalText = getGroupTotalText(group);
          return (
            <div
              key={`${prefix}-${group.key}`}
              className="overflow-hidden rounded-xl border border-[var(--app-border)] bg-[var(--app-control-bg)]/55 transition-colors hover:bg-[var(--app-hover-bg)]"
            >
              <div className="flex items-start justify-between gap-3 p-3">
                <div className="min-w-0 flex items-center gap-3">
                  <span
                    className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ${hasSelfContainedOutputIcon ? "bg-transparent" : visual.iconClass}`}
                  >
                    <ItemTypeIcon kind={group.kind} displayMode={group.displayMode} category={group.category} />
                  </span>
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold text-[var(--app-text)]">{group.itemName}</div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-[11px] text-[var(--app-muted)]">
                      <span>{group.typeLabel}</span>
                      {group.route ? <><span aria-hidden="true">•</span><span>{group.route}</span></> : null}
                      <span aria-hidden="true">•</span>
                      <span>{group.displayMode === "drip" ? "Infusion" : group.displayMode === "output" ? "Output" : "Bolus"}</span>
                    </div>
                  </div>
                </div>
                <div className="shrink-0 text-right">
                  <div className="text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--app-muted)]">Total</div>
                  <div className="text-lg font-semibold tabular-nums text-[var(--app-text)]">{totalText || `0 ${normalizeDisplayUnit(group.kind, group.itemUnit)}`}</div>
                  {group.runId != null ? (
                    <div className="mt-1 flex items-center justify-end gap-1">
                      {group.displayMode === "drip" ? (
                        <button
                          type="button"
                          onClick={() => {
                            if (!run) return;
                            if (group.kind === "fluid") openEditFluidDripModal(run);
                            else openEditDripModal(run);
                          }}
                          className="rounded px-1.5 py-0.5 text-[10px] font-medium text-blue-600 hover:bg-blue-500/10 dark:text-blue-300"
                        >
                          Edit
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => {
                            if (group.kind === "fluid" && run) openFluidEntryModal(run);
                            else openEntryModal(group.runId!, "bolus");
                          }}
                          className="rounded px-1.5 py-0.5 text-[10px] font-medium text-blue-600 hover:bg-blue-500/10 dark:text-blue-300"
                        >
                          {group.kind === "med" ? "Dose" : "Entry"}
                        </button>
                      )}
                      {canStopDrip ? (
                        <button
                          type="button"
                          onClick={() => openStopDripModal(run!)}
                          className="rounded px-1.5 py-0.5 text-[10px] font-medium text-amber-600 hover:bg-amber-500/10 dark:text-amber-300"
                        >
                          Stop
                        </button>
                      ) : null}
                      <button
                        type="button"
                        onClick={() => void handleRemoveRun(group.runId!, group.itemName)}
                        disabled={removingRunId === group.runId}
                        className="rounded px-1.5 py-0.5 text-[10px] font-medium text-red-600 hover:bg-red-500/10 disabled:text-gray-400 dark:text-red-300"
                      >
                        {removingRunId === group.runId ? "Removing..." : "Remove"}
                      </button>
                    </div>
                  ) : null}
                </div>
              </div>
              {group.events.length === 0 ? (
                group.segments.length === 0 ? (
                  <div className="border-t border-[var(--app-border)]/70 px-3 py-2 text-xs text-[var(--app-muted)]">
                    No records yet
                  </div>
                ) : (
                  (() => {
                    if (!(group.kind === "med" && group.displayMode === "drip" && group.runId != null)) {
                      return (
                        <div className="mt-0.5 space-y-0.5">
                          {group.segments.map((segmentText, idx) => (
                            <div
                              key={`${prefix}-segment-${group.key}-${idx}`}
                              className="text-[11px] text-cyan-300"
                            >
                              Drip {segmentText}
                            </div>
                          ))}
                        </div>
                      );
                    }
                    const snapshot = run ? dripSnapshot(run, Date.now()) : null;
                    if (!snapshot) {
                      return (
                        <div className="mt-0.5 space-y-0.5">
                          {group.segments.map((segmentText, idx) => (
                            <div
                              key={`${prefix}-segment-${group.key}-${idx}`}
                              className="text-[11px] text-cyan-300"
                            >
                              Drip {segmentText}
                            </div>
                          ))}
                        </div>
                      );
                    }
                    return (
                      <div className="mt-2 rounded-xl border border-[var(--app-border)] bg-[var(--app-control-bg)]/70 px-3 py-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]">
                        <div className="flex items-center gap-3">
                          <div className="shrink-0">
                            {snapshot.isUndiluted ? (
                              <div className="relative h-16 w-10 overflow-hidden rounded-md border border-cyan-400/45 bg-black/35 dark:bg-black/45">
                                <div
                                  className="absolute bottom-1 left-1 right-1 overflow-hidden rounded-sm bg-cyan-400/80 transition-all duration-700"
                                  style={{ height: `${Math.max(10, snapshot.progressPct * 0.52)}px` }}
                                >
                                  <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(255,255,255,0.28),rgba(255,255,255,0.02))]" />
                                  {!snapshot.isStopped ? (
                                    <div className="absolute inset-y-0 -left-6 w-4 rotate-12 bg-white/30 blur-[1px] animate-[flora-fluid-shift_1.8s_linear_infinite]" />
                                  ) : null}
                                </div>
                                <div className="absolute inset-x-2 top-1 h-1 rounded bg-cyan-100/70" />
                                <div className="absolute -bottom-2 left-1/2 h-4 w-1 -translate-x-1/2 rounded bg-cyan-300/90" />
                                {!snapshot.isStopped ? (
                                  <div className="absolute left-1/2 top-full h-1.5 w-1.5 -translate-x-1/2 rounded-full bg-cyan-200/90 animate-bounce" />
                                ) : null}
                              </div>
                            ) : (
                              <div className="relative h-16 w-12 overflow-hidden rounded-t-xl rounded-b-md border border-emerald-400/45 bg-black/35 dark:bg-black/45">
                                <div className="absolute left-1/2 top-0 h-3 w-4 -translate-x-1/2 -translate-y-1/2 rounded-t-md border border-emerald-400/45 bg-black/45 dark:bg-black/60" />
                                <div
                                  className="absolute bottom-1 left-1 right-1 overflow-hidden rounded-b-md bg-emerald-400/75 transition-all duration-700"
                                  style={{ height: `${Math.max(10, snapshot.progressPct * 0.5)}px` }}
                                >
                                  <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(255,255,255,0.26),rgba(255,255,255,0.02))]" />
                                  {!snapshot.isStopped ? (
                                    <div className="absolute inset-y-0 -left-6 w-4 rotate-12 bg-white/30 blur-[1px] animate-[flora-fluid-shift_2s_linear_infinite]" />
                                  ) : null}
                                </div>
                                {!snapshot.isStopped ? (
                                  <div className="absolute left-1/2 top-full h-1.5 w-1.5 -translate-x-1/2 rounded-full bg-emerald-200/90 animate-bounce" />
                                ) : null}
                              </div>
                            )}
                          </div>
                          <div className="min-w-0 flex-1 space-y-2">
                            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-[var(--app-muted)]">
                              <span className="font-medium text-[var(--app-text)]">Started {snapshot.startedText}</span>
                              {snapshot.stoppedText ? (
                                <span className="rounded-full border border-rose-400/40 bg-rose-500/12 px-2 py-0.5 text-[10px] font-medium text-rose-700 dark:text-rose-200">
                                  Stopped {snapshot.stoppedText}
                                </span>
                              ) : null}
                              <span className="text-[var(--app-text)]/85">{snapshot.carrier}</span>
                              {snapshot.preparedText ? <span className="text-[var(--app-text)]/85">{snapshot.preparedText}</span> : null}
                              {snapshot.exceedsPreparedVolume ? (
                                <span className="rounded-full border border-amber-400/40 bg-amber-500/12 px-2 py-0.5 text-[10px] font-medium text-amber-700 dark:text-amber-200">
                                  Prepared volume exhausted
                                </span>
                              ) : null}
                            </div>
                            <div className="grid grid-cols-2 gap-2">
                              <div className="rounded-lg border border-cyan-400/35 bg-cyan-500/10 px-3 py-2">
                                <div className="text-[10px] uppercase tracking-wide text-cyan-700 dark:text-cyan-200">Rate</div>
                                <div className="text-xl font-semibold text-[var(--app-text)]">{snapshot.rateText}</div>
                              </div>
                              <div className="rounded-lg border border-violet-400/35 bg-violet-500/10 px-3 py-2">
                                <div className="text-[10px] uppercase tracking-wide text-violet-700 dark:text-violet-200">Dose</div>
                                <div className="text-xl font-semibold text-[var(--app-text)]">{snapshot.doseText}</div>
                              </div>
                            </div>
                            <div className="space-y-1">
                              <div className="flex items-center justify-between text-[11px] text-[var(--app-muted)]">
                                <span className="font-medium text-[var(--app-text)]">Progress</span>
                                <span className="text-[var(--app-text)]">{snapshot.infusedText}</span>
                              </div>
                              <div className="h-2 rounded-full bg-black/10 dark:bg-white/10 overflow-hidden">
                                <div
                                  className={`h-full rounded-full ${snapshot.isUndiluted ? "bg-cyan-300" : "bg-emerald-300"} transition-all duration-700`}
                                  style={{ width: `${Math.max(4, snapshot.progressPct)}%` }}
                                />
                              </div>
                            </div>
                          </div>
                        </div>
                        <style>{`
                          @keyframes flora-fluid-shift {
                            0% { transform: translateX(0) rotate(12deg); opacity: 0.18; }
                            50% { opacity: 0.38; }
                            100% { transform: translateX(44px) rotate(12deg); opacity: 0.18; }
                          }
                        `}</style>
                      </div>
                    );
                  })()
                )
              ) : (
                <div className="divide-y divide-[var(--app-border)]/60 border-t border-[var(--app-border)]/70 px-3">
                  {group.events.map(event => (
                    <div
                      key={`${prefix}-event-${group.key}-${event.id}`}
                      className="grid grid-cols-[62px_1fr_auto] items-center gap-2 py-2 text-xs"
                    >
                      <span className="rounded-md bg-[var(--app-panel-bg)] px-2 py-1 text-center font-medium tabular-nums text-[var(--app-muted)]">{fmtHHMM(event.event_ts)}</span>
                      <span className="font-semibold tabular-nums text-[var(--app-text)]">{formatEventValue(event)}</span>
                      <ClinicalReferenceTooltip text={`Delete ${group.itemName} entry at ${fmtHHMM(event.event_ts)}`} compact disabled={deletingEventId === event.id} className="flex">
                        <button
                          type="button"
                          onClick={() => void handleDeleteEvent(event.id)}
                          disabled={deletingEventId === event.id}
                          className="grid h-7 w-7 place-items-center rounded-md text-red-500 hover:bg-red-500/10 dark:text-red-400 disabled:opacity-40"
                          aria-label={`Delete ${group.itemName} entry at ${fmtHHMM(event.event_ts)}`}
                        >
                          {deletingEventId === event.id ? "…" : "×"}
                        </button>
                      </ClinicalReferenceTooltip>
                    </div>
                  ))}
                  {group.segments.map((segmentText, idx) => (
                    <div
                      key={`${prefix}-segment-${group.key}-${idx}`}
                      className="text-[11px] text-cyan-300"
                    >
                      Drip {segmentText}
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    );
  };

  const ioModalPatientContext = caseStatus.status === "IDLE" ? null : (
    <div className="io-modal__patient-context" aria-label="Active patient clinical context">
      <strong>{formatPatientDisplayName(casePatient, patientNameLanguage) || "Patient name not recorded"}</strong>
      <span>HN {caseStatus.hn || "—"}</span>
      <span>{patientAsaLabel}</span>
      <span>Weight {patientWeightKg == null ? "—" : `${patientWeightKg} kg`}</span>
    </div>
  );

  return (
    <div className="app-theme-scope p-3 pb-24 space-y-3 text-[var(--app-text)]">
      {tab === "current" ? (
        <section className={card}>
          {caseStatus.status === "IDLE" ? (
            <div className="text-sm text-gray-500 dark:text-gray-400">
              Start case first to add item list and record entries.
            </div>
          ) : (
            <div className="space-y-3">
              <header className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--app-border)] pb-2">
                <h1 className="text-xl font-semibold tracking-tight">Input/Output Balance</h1>
                <div className="flex min-w-0 flex-wrap items-center justify-end gap-x-2 gap-y-1 rounded-lg border border-[var(--app-border)] bg-[var(--app-control-bg)]/65 px-3 py-1.5 text-xs">
                  <strong className="max-w-64 truncate">{formatPatientDisplayName(casePatient, patientNameLanguage) || "Patient name not recorded"}</strong>
                  <span className="text-[var(--app-muted)]">·</span>
                  <span className="font-semibold">HN {caseStatus.hn}</span>
                  <span className="text-[var(--app-muted)]">·</span>
                  <span>Case <b className="tabular-nums">#{caseStatus.case_id}</b></span>
                  <span className="text-[var(--app-muted)]">·</span>
                  <span className="tabular-nums">Started <b>{fmt(caseStatus.start_time)}</b></span>
                  <span className="rounded-full border border-emerald-500/35 bg-emerald-500/12 px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.1em] text-emerald-600 dark:text-emerald-300">{caseStatus.status}</span>
                </div>
              </header>

              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-8">
                {[
                  { label: "Intake", icon: "input" as IoIconName, value: currentSummary?.intake_ml ?? 0, suffix: "mL", tone: "#34d399" },
                  { label: "Output", icon: "output" as IoIconName, value: currentSummary?.output_ml ?? 0, suffix: "mL", tone: "#60a5fa" },
                  { label: "Balance", icon: "balance" as IoIconName, value: currentSummary?.net_ml ?? 0, suffix: "mL", tone: (currentSummary?.net_ml ?? 0) >= 0 ? "#a78bfa" : "#fb7185", signed: true },
                  { label: "Active drips", icon: "activeDrips" as IoIconName, value: currentRuns.filter(run => run.stopped_at == null && activeDripSegment(run, Date.now()) != null).length, suffix: "", tone: "#fbbf24" },
                ].map(metric => (
                  <div key={metric.label} className="app-tooltip flex min-h-12 items-center gap-2 rounded-xl border border-[var(--app-border)] bg-[var(--app-control-bg)]/70 px-2.5 py-1.5" data-tooltip={metric.label === "Balance" ? "Net balance: intake minus output" : metric.label === "Active drips" ? "Infusions currently running" : `${metric.label} included in fluid balance`} style={{ boxShadow: `inset 3px 0 0 ${metric.tone}` }}>
                    <IoSpriteIcon name={metric.icon} size={34} />
                    <div className="min-w-0">
                      <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--app-muted)]">{metric.label}</div>
                      <div className="mt-0.5 flex items-baseline gap-1">
                        <span className="text-xl font-semibold tabular-nums">{metric.signed && Number(metric.value) > 0 ? "+" : ""}{formatQuantity(Number(metric.value))}</span>
                        {metric.suffix ? <span className="text-xs text-[var(--app-muted)]">{metric.suffix}</span> : null}
                      </div>
                    </div>
                  </div>
                ))}
                <button
                  type="button"
                  onClick={() => {
                    setMedBolusComposerOpen(true);
                    window.setTimeout(() => {
                      medicationSearchInputRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
                      medicationSearchInputRef.current?.focus();
                    }, 50);
                  }}
                  disabled={currentLoading || currentSaving}
                  className="app-tooltip flex min-h-12 items-center justify-center gap-2 rounded-xl border border-[var(--app-border)] bg-[var(--app-control-bg)] px-2 py-1.5 text-sm font-semibold transition hover:-translate-y-0.5 hover:bg-[var(--app-hover-bg)] disabled:opacity-50"
                  data-tooltip="Record a one-time medication dose"
                >
                  <IoSpriteIcon name="medBolus" size={30} />
                  Med bolus
                </button>
                <button type="button" onClick={openMedDripModal} disabled={currentLoading || currentSaving} className="app-tooltip flex min-h-12 items-center justify-center gap-2 rounded-xl border border-[var(--app-border)] bg-[var(--app-control-bg)] px-2 py-1.5 text-sm font-semibold transition hover:-translate-y-0.5 hover:bg-[var(--app-hover-bg)] disabled:opacity-50" data-tooltip="Start a medication infusion">
                  <IoSpriteIcon name="medDrip" size={30} />
                  Med drip
                </button>
                <button type="button" onClick={() => openFluidModal()} disabled={currentLoading || currentSaving} className="app-tooltip flex min-h-12 items-center justify-center gap-2 rounded-xl border border-[var(--app-border)] bg-[var(--app-control-bg)] px-2 py-1.5 text-sm font-semibold transition hover:-translate-y-0.5 hover:bg-[var(--app-hover-bg)] disabled:opacity-50" data-tooltip="Record a fluid bolus or infusion">
                  <IoSpriteIcon name="fluid" size={30} />
                  Fluid
                </button>
                <button type="button" onClick={openBloodProductModal} disabled={currentLoading || currentSaving} className="app-tooltip flex min-h-12 items-center justify-center gap-2 rounded-xl border border-[var(--app-border)] bg-[var(--app-control-bg)] px-2 py-1.5 text-sm font-semibold transition hover:-translate-y-0.5 hover:bg-[var(--app-hover-bg)] disabled:opacity-50" data-tooltip="Record a blood product">
                  <IoSpriteIcon name="bloodProduct" size={30} />
                  Blood product
                </button>
              </div>

              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                <div className="order-2 flex min-w-0 flex-col gap-3 rounded-2xl border border-[var(--app-border)] bg-[var(--app-control-bg)]/25 p-3 lg:order-2">
                  <div className="flex items-start justify-between gap-3">
                    <div className="text-base font-semibold">Medication summary</div>
                    <div className="flex shrink-0 items-center gap-2">
                      <span className="rounded-full border border-[var(--app-border)] bg-[var(--app-control-bg)] px-2.5 py-1 text-xs font-semibold tabular-nums text-[var(--app-muted)]">{administeredMedicationCount} given{preparedMedicationCount > 0 ? ` · ${preparedMedicationCount} ready` : ""}</span>
                      <div className="inline-flex overflow-hidden rounded-lg border border-[var(--app-border)] bg-[var(--app-control-bg)] p-0.5" aria-label="Medication display mode">
                        {(["summary", "detail"] as MedicationSummaryView[]).map(view => (
                          <ClinicalReferenceTooltip key={view} text={`${view === "summary" ? "Summary" : "Detail"} view`} compact className="flex">
                            <button
                              type="button"
                              aria-label={`${view === "summary" ? "Summary" : "Detail"} view`}
                              aria-pressed={medicationSummaryView === view}
                              onClick={() => setMedicationSummaryView(view)}
                              className={`grid h-7 w-8 place-items-center rounded-md transition ${medicationSummaryView === view ? "bg-[var(--app-accent)] text-[var(--app-accent-contrast)]" : "text-[var(--app-muted)] hover:bg-[var(--app-hover-bg)] hover:text-[var(--app-text)]"}`}
                            >
                              {view === "summary" ? (
                                <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="M6 5h10M6 10h10M6 15h10" strokeLinecap="round" /><circle cx="3" cy="5" r=".8" fill="currentColor" stroke="none" /><circle cx="3" cy="10" r=".8" fill="currentColor" stroke="none" /><circle cx="3" cy="15" r=".8" fill="currentColor" stroke="none" /></svg>
                              ) : (
                                <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><rect x="2.5" y="2.5" width="15" height="6" rx="1.5" /><rect x="2.5" y="11.5" width="15" height="6" rx="1.5" /><path d="M5.5 5.5h5M5.5 14.5h5" strokeLinecap="round" /></svg>
                              )}
                            </button>
                          </ClinicalReferenceTooltip>
                        ))}
                      </div>
                    </div>
                  </div>
                  {popularBolusItems.length > 0 ? (
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="mr-1 text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--app-muted)]">Popular</span>
                      {popularBolusItems.map(item => (
                        <button
                          key={`popular-bolus-${item.id}`}
                          type="button"
                          onClick={() => openPopularMedicationBolus(item)}
                          disabled={currentLoading || currentSaving}
                          className="app-tooltip min-h-8 rounded-full border border-[var(--app-border)] bg-[var(--app-panel-bg)] px-3 py-1 text-xs font-semibold text-[var(--app-text)] transition hover:border-[var(--app-accent)] hover:bg-[var(--app-hover-bg)] disabled:opacity-50"
                          data-tooltip={`Record ${item.name} bolus`}
                        >
                          {item.name}
                        </button>
                      ))}
                    </div>
                  ) : null}
                  {medBolusComposerOpen ? (
                    <div
                      className="app-theme-scope io-modal-backdrop"
                      onMouseDown={() => {
                        setMedBolusComposerOpen(false);
                        resetMedicationComposer();
                        setCurrentError("");
                      }}
                    >
                      <section
                        className="io-modal w-full max-w-2xl p-4 space-y-3"
                        role="dialog"
                        aria-modal="true"
                        aria-labelledby="io-balance-med-bolus-title"
                        onMouseDown={event => event.stopPropagation()}
                        onKeyDown={event => {
                          if (event.key !== "Escape" || currentSaving) return;
                          event.preventDefault();
                          setMedBolusComposerOpen(false);
                          resetMedicationComposer();
                          setCurrentError("");
                        }}
                      >
                      <header className="flex items-start justify-between gap-4 border-b border-[var(--app-border)] pb-3">
                        <div className="flex min-w-0 items-center gap-5">
                          <span className="mr-2 grid h-12 w-12 shrink-0 place-items-center overflow-hidden rounded-xl bg-[var(--timegrid-focus-bg)]">
                            <IoSpriteIcon name="medBolus" size={42} />
                          </span>
                          <div className="min-w-0">
                            <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-[var(--app-muted)]">Record medication</div>
                            <div id="io-balance-med-bolus-title" className="text-xl font-semibold leading-tight">Med bolus</div>
                            <div className="mt-0.5 text-xs text-[var(--app-muted)]">One-time dose</div>
                          </div>
                        </div>
                      <ClinicalReferenceTooltip text="Close" compact className="flex shrink-0">
                        <button
                          type="button"
                          aria-label="Close medication bolus"
                          onClick={() => {
                            setMedBolusComposerOpen(false);
                            resetMedicationComposer();
                            setCurrentError("");
                          }}
                          className="grid h-10 w-10 place-items-center rounded-xl border border-[var(--app-border)] text-xl leading-none text-[var(--app-muted)] hover:bg-[var(--app-hover-bg)] hover:text-[var(--app-text)]"
                        >
                          ×
                        </button>
                      </ClinicalReferenceTooltip>
                      </header>
                      {ioModalPatientContext}
                      <div className="space-y-4">
                        <section className="space-y-2">
                          <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--app-muted)]">Medication</div>
                      <div className="relative">
                        <input
                          ref={medicationSearchInputRef}
                          className="w-full rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-950 px-2 py-1.5 text-sm"
                          placeholder="Search drug name..."
                          value={itemSearch}
                          onChange={e => {
                            setItemSearch(e.target.value);
                            setShowItemDropdown(normalizeToken(e.target.value).length >= 2);
                            setPrepareItemId(null);
                          }}
                          onFocus={() => setShowItemDropdown(prepareItemId == null && normalizeToken(itemSearch).length >= 2)}
                          onKeyDown={event => {
                            if (event.key === "ArrowDown" && showItemDropdown && filteredSearchItems.length > 0) {
                              event.preventDefault();
                              medicationBolusOptionRefs.current[0]?.focus();
                              return;
                            }
                            if (event.key !== "Enter" && event.key !== "Tab") return;
                            const query = normalizeToken(itemSearch);
                            const exact = filteredSearchItems.find(item =>
                              normalizeToken(item.name) === query || normalizeToken(item.code) === query,
                            );
                            const match = exact || (filteredSearchItems.length === 1 ? filteredSearchItems[0] : null);
                            if (!match) return;
                            event.preventDefault();
                            selectMedicationBolusItem(match);
                          }}
                        />
                        {showItemDropdown && normalizeToken(itemSearch).length >= 2 ? (
                            <div className="relative z-20 mt-2 max-h-60 w-full overflow-y-auto rounded-xl border border-[var(--app-border)] bg-[var(--app-panel-bg)] shadow-lg">
                              {filteredSearchItems.length > 0 ? (
                                filteredSearchItems.map((item, index) => {
                                  const groupId = resolveGroupId(
                                    item.kind,
                                    item.category,
                                    item.code || item.name,
                                    detailedGroups,
                                  );
                                  const group = detailedGroupById.get(groupId);
                                  return (
                                    <button
                                      key={`search-item-${item.id}`}
                                     type="button"
                                      ref={element => { medicationBolusOptionRefs.current[index] = element; }}
                                      className="w-full text-left px-3 py-2 text-sm hover:bg-gray-100 dark:hover:bg-gray-800 border-b border-gray-100 dark:border-gray-900 last:border-0"
                                      onClick={() => selectMedicationBolusItem(item)}
                                      onKeyDown={event => {
                                        if (event.key === "Enter" || event.key === "Tab") {
                                          event.preventDefault();
                                          selectMedicationBolusItem(item);
                                          return;
                                        }
                                        if (event.key === "ArrowDown") {
                                          event.preventDefault();
                                          medicationBolusOptionRefs.current[Math.min(index + 1, filteredSearchItems.length - 1)]?.focus();
                                        } else if (event.key === "ArrowUp") {
                                          event.preventDefault();
                                          if (index === 0) medicationSearchInputRef.current?.focus();
                                          else medicationBolusOptionRefs.current[index - 1]?.focus();
                                        }
                                      }}
                                    >
                                      <div className="font-medium">{item.name}</div>
                                      <div className="text-xs text-gray-500 dark:text-gray-400 flex justify-between">
                                        <span>{group?.label || item.kind}</span>
                                        <span>{item.default_unit}</span>
                                      </div>
                                    </button>
                                  );
                                })
                              ) : itemSearch.length > 0 && itemSearch.length < 2 ? (
                                <div className="p-3 text-sm text-gray-500 italic">
                                  Type at least 2 characters...
                                </div>
                              ) : itemSearch ? (
                                <div className="p-3 space-y-2">
                                  <div className="text-sm text-gray-500 italic">
                                    No medication matches found
                                  </div>
                                  {medSearchFluidMatches.length > 0 ? (
                                    <div className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-400/40 dark:bg-amber-500/10 dark:text-amber-100">
                                      <div className="font-medium">This looks more like a fluid</div>
                                      <div className="mt-1 text-xs text-amber-800 dark:text-amber-100/90">
                                        If you want to chart fluid instead of medication, jump to the fluid entry flow.
                                      </div>
                                      <div className="mt-2 flex flex-wrap gap-2">
                                        {medSearchFluidMatches.map(item => (
                                          <button
                                            key={`med-search-fluid-${item.id}`}
                                            type="button"
                                            className="rounded border border-amber-300 px-2 py-1 text-xs text-amber-900 hover:bg-amber-100 dark:border-amber-400/40 dark:text-amber-100 dark:hover:bg-amber-500/10"
                                            onClick={() => {
                                              setShowItemDropdown(false);
                                              openFluidModalFromSuggestion(item);
                                            }}
                                          >
                                            Use Fluid: {item.name}
                                          </button>
                                        ))}
                                      </div>
                                    </div>
                                  ) : null}
                                </div>
                              ) : (
                                <div className="p-3 text-sm text-gray-500 italic">
                                  {currentGroupId ? "Searching in group..." : "Start typing to search..."}
                                </div>
                              )}
                            </div>
                        ) : null}
                      </div>
                          <div className="grid gap-3 sm:grid-cols-3">
                            <label className="space-y-1">
                              <span className="text-xs font-semibold text-[var(--app-muted)]">Group</span>
                              <select
                                className="w-full px-3 py-2 text-sm"
                                value={currentGroupId}
                                onChange={e => {
                                  setCurrentGroupId(e.target.value);
                                  setPrepareItemId(null);
                                }}
                                disabled={isPrepareGroupLocked}
                              >
                                <option value="">Select group</option>
                                {detailedGroups.filter(group => group.kind === "med").map(group => (
                                  <option key={group.id} value={group.id}>{groupOptionLabel(group)}</option>
                                ))}
                              </select>
                            </label>
                            <label className="space-y-1">
                              <span className="text-xs font-semibold text-[var(--app-muted)]">Route</span>
                              <select
                                className="w-full px-3 py-2 text-sm"
                                value={isCurrentGroupRouteEnabled ? prepareRoute : ""}
                                onChange={e => setPrepareRoute(e.target.value)}
                                disabled={!currentGroup || !isCurrentGroupRouteEnabled}
                              >
                                {!currentGroup ? <option value="">Select drug first</option> : !isCurrentGroupRouteEnabled ? <option value="">Not required</option> : <><option value="">Select route</option>{ROUTE_OPTIONS.map(route => <option key={route} value={route}>{route}</option>)}</>}
                              </select>
                            </label>
                            {!isCurrentGroupLocalAnesthetic ? (
                              <label className="space-y-1">
                                <span className="text-xs font-semibold text-[var(--app-muted)]">Dose unit</span>
                                <select className="w-full px-3 py-2 text-sm" value={prepareUom} onChange={e => setPrepareUom(e.target.value)}>
                                  <option value="">Select unit</option>
                                  {UOM_OPTIONS.map(unit => <option key={unit} value={unit}>{unit}</option>)}
                                </select>
                              </label>
                            ) : null}
                          </div>
                          {isPrepareGroupLocked && selectedCurrentItem ? (
                            <div className="flex items-center justify-between gap-3 rounded-lg border border-[var(--app-border)] bg-[var(--app-control-bg)] px-3 py-2">
                              <div className="min-w-0">
                                <div className="truncate text-sm font-semibold">{selectedCurrentItem.name}</div>
                                <div className="text-xs text-[var(--app-muted)]">{detailedGroupById.get(selectedCurrentItemGroupId)?.label || "Medication"}</div>
                              </div>
                              <button type="button" onClick={resetMedicationComposer} className="shrink-0 rounded-lg border border-[var(--app-border)] px-3 py-1.5 text-xs font-semibold hover:bg-[var(--app-hover-bg)]">Change</button>
                            </div>
                          ) : null}
                        </section>

                        <section className="space-y-2 border-t border-[var(--app-border)] pt-4">
                          <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--app-muted)]">Administration</div>
                          <div className="grid gap-3 sm:grid-cols-2">
                            <label className="space-y-1">
                              <span className="text-xs font-semibold text-[var(--app-muted)]">Date</span>
                              <input
                                className="w-full px-3 py-2 text-sm tabular-nums"
                                value={prepareDate}
                                onChange={e => setPrepareDate(formatDateInputDDMMYYYY(e.target.value))}
                                onBlur={e => {
                                  const normalized = normalizeDateInputDDMMYYYY(e.target.value);
                                  if (normalized) setPrepareDate(normalized);
                                }}
                                placeholder="dd/mm/yyyy"
                              />
                            </label>
                            <label className="space-y-1">
                              <span className="text-xs font-semibold text-[var(--app-muted)]">Time</span>
                              <input className="w-full px-3 py-2 text-sm tabular-nums" placeholder="HH:mm" value={prepareTime} onChange={e => setPrepareTime(formatTimeInputHHMM(e.target.value))} />
                            </label>
                          </div>
                          {isCurrentGroupLocalAnesthetic ? (
                            <div className="grid gap-3 sm:grid-cols-2">
                              <label className="space-y-1"><span className="text-xs font-semibold text-[var(--app-muted)]">Concentration</span><div className="flex"><input ref={medicationBolusAmountInputRef} type="number" min="0" step="0.01" className="min-w-0 flex-1 rounded-r-none px-3 py-2 text-sm" value={prepareLocalConcentration} onChange={e => setPrepareLocalConcentration(e.target.value)} placeholder="0" /><span className="grid min-w-16 place-items-center rounded-r-lg border border-l-0 border-[var(--app-control-border)] bg-[var(--app-control-bg)] px-2 text-sm">%</span></div></label>
                              <label className="space-y-1"><span className="text-xs font-semibold text-[var(--app-muted)]">Volume</span><div className="flex"><input type="number" min="0" step="0.01" className="min-w-0 flex-1 rounded-r-none px-3 py-2 text-sm" value={prepareLocalVolumeMl} onChange={e => setPrepareLocalVolumeMl(e.target.value)} onKeyDown={e => { if (e.key !== "Enter" || e.shiftKey || currentSaving || currentLoading || prepareItemId == null || !currentGroup) return; e.preventDefault(); void handleMedicationPrepare(); }} placeholder="0" /><span className="grid min-w-16 place-items-center rounded-r-lg border border-l-0 border-[var(--app-control-border)] bg-[var(--app-control-bg)] px-2 text-sm">mL</span></div></label>
                            </div>
                          ) : (
                            <div className="space-y-2">
                              <label className="block space-y-1">
                                <span className="text-xs font-semibold text-[var(--app-muted)]">Dose</span>
                                <div className="flex">
                                  <input
                                    ref={medicationBolusAmountInputRef}
                                    type="number"
                                    min="0"
                                    step="0.01"
                                    className="min-w-0 flex-1 rounded-r-none px-3 py-2 text-lg font-semibold tabular-nums"
                                    value={prepareDoseValue}
                                    onChange={e => setPrepareDoseValue(e.target.value)}
                                    onKeyDown={e => {
                                      if (e.key !== "Enter" || e.shiftKey || currentSaving || currentLoading || prepareItemId == null || !currentGroup) return;
                                      e.preventDefault();
                                      void handleMedicationPrepare();
                                    }}
                                    placeholder="0"
                                  />
                                  <span className="grid min-w-20 place-items-center rounded-r-lg border border-l-0 border-[var(--app-control-border)] bg-[var(--app-control-bg)] px-3 text-sm font-semibold">{prepareUom || selectedCurrentItem?.default_unit || "unit"}</span>
                                </div>
                              </label>
                              {historicalBolusSuggestion ? (
                                <div className="rounded-xl border border-[var(--app-border)] bg-[var(--app-control-bg)]/55 px-3 py-2">
                                  <div className="flex flex-wrap items-center gap-2">
                                    <span className="mr-1 text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--app-muted)]">Suggestion</span>
                                    {historicalBolusSuggestion.doses.map(dose => {
                                      const selected = Number(prepareDoseValue) === dose && prepareUom === historicalBolusSuggestion.unit;
                                      return (
                                        <button
                                          key={`${selectedCurrentItem?.id || "med"}-${dose}-${historicalBolusSuggestion.unit}`}
                                          type="button"
                                          aria-pressed={selected}
                                          onClick={() => {
                                            setPrepareDoseValue(String(dose));
                                            setPrepareUom(historicalBolusSuggestion.unit);
                                            medicationBolusAmountInputRef.current?.focus();
                                          }}
                                          className={`min-h-8 rounded-lg border px-3 py-1 text-xs font-bold tabular-nums ${selected ? "border-[var(--app-accent)] bg-[var(--app-accent)] text-[var(--app-accent-contrast)]" : "border-[var(--app-border)] bg-[var(--app-panel-bg)] text-[var(--app-text)] hover:bg-[var(--app-hover-bg)]"}`}
                                        >
                                          {dose} {historicalBolusSuggestion.unit}
                                        </button>
                                      );
                                    })}
                                  </div>
                                </div>
                              ) : null}
                            </div>
                          )}
                        </section>
                      </div>
                      {currentError ? <div className="case-modal__error">{currentError}</div> : null}
                      <footer className="flex items-center justify-between gap-3 border-t border-[var(--app-border)] pt-3">
                        <div className="text-xs text-[var(--app-muted)]">Dose may be left empty to add the medication row only.</div>
                        <div className="flex shrink-0 gap-2">
                          <button type="button" onClick={() => { setMedBolusComposerOpen(false); resetMedicationComposer(); setCurrentError(""); }} disabled={currentSaving} className="rounded-lg border border-[var(--app-border)] px-4 py-2 text-sm font-semibold hover:bg-[var(--app-hover-bg)]">Cancel</button>
                          <button type="button" onClick={() => void handleMedicationPrepare()} disabled={currentSaving || currentLoading || prepareItemId == null || !currentGroup} className={`rounded-lg px-4 py-2 text-sm font-semibold ${currentSaving || currentLoading || prepareItemId == null || !currentGroup ? primaryDisabled : "bg-[var(--app-accent)] text-[var(--app-accent-contrast)] hover:brightness-105"}`}>
                            {currentSaving ? "Saving…" : (isCurrentGroupLocalAnesthetic ? prepareLocalVolumeMl || prepareLocalConcentration : prepareDoseValue) ? "Record bolus" : "Add medication"}
                          </button>
                        </div>
                      </footer>
                      </section>
                    </div>
                  ) : null}
                  <div className="order-1 rounded-xl border border-[var(--app-border)] bg-[var(--app-panel-bg)] p-3 space-y-2">
                    {medicationSummaryView === "detail" ? (
                      <>
                        <div className="text-xs font-bold uppercase tracking-[0.14em] text-[var(--app-muted)]">Administered medication & total dose</div>
                        {renderItemGroupCards(medicationItemGroups, "No medications added yet.", "medication")}
                      </>
                    ) : medicationItemGroups.length === 0 ? (
                      <div className="text-xs text-[var(--app-muted)]">No medications added yet.</div>
                    ) : (
                      <div className="divide-y divide-[var(--app-border)]">
                        {medicationItemGroups.map(group => (
                          <div key={`medication-summary-${group.key}`} className="flex min-h-10 items-center justify-between gap-4 px-1 py-2">
                            <span className="min-w-0 truncate text-sm font-semibold text-[var(--app-text)]">{group.itemName}</span>
                            <strong className="shrink-0 text-sm tabular-nums text-[var(--app-text)]">{getGroupTotalText(group) || `0 ${normalizeDisplayUnit(group.kind, group.itemUnit)}`}</strong>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                <div className="order-1 min-w-0 rounded-2xl border border-[var(--app-border)] bg-[var(--app-control-bg)]/25 p-3 space-y-3 lg:order-1">
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-base font-semibold">Fluids Balance</div>
                    <div className="inline-flex shrink-0 overflow-hidden rounded-lg border border-[var(--app-border)] bg-[var(--app-control-bg)] p-0.5" aria-label="Fluid balance display mode">
                      {(["summary", "detail"] as MedicationSummaryView[]).map(view => (
                        <ClinicalReferenceTooltip key={view} text={`${view === "summary" ? "Summary" : "Detail"} view`} compact className="flex">
                          <button
                            type="button"
                            aria-label={`${view === "summary" ? "Summary" : "Detail"} view`}
                            aria-pressed={fluidBalanceView === view}
                            onClick={() => setFluidBalanceView(view)}
                            className={`grid h-7 w-8 place-items-center rounded-md transition ${fluidBalanceView === view ? "bg-[var(--app-accent)] text-[var(--app-accent-contrast)]" : "text-[var(--app-muted)] hover:bg-[var(--app-hover-bg)] hover:text-[var(--app-text)]"}`}
                          >
                            {view === "summary" ? (
                              <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="M6 5h10M6 10h10M6 15h10" strokeLinecap="round" /><circle cx="3" cy="5" r=".8" fill="currentColor" stroke="none" /><circle cx="3" cy="10" r=".8" fill="currentColor" stroke="none" /><circle cx="3" cy="15" r=".8" fill="currentColor" stroke="none" /></svg>
                            ) : (
                              <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><rect x="2.5" y="2.5" width="15" height="6" rx="1.5" /><rect x="2.5" y="11.5" width="15" height="6" rx="1.5" /><path d="M5.5 5.5h5M5.5 14.5h5" strokeLinecap="round" /></svg>
                            )}
                          </button>
                        </ClinicalReferenceTooltip>
                      ))}
                    </div>
                  </div>
                  <div className="rounded-xl border border-[var(--app-border)] bg-[var(--app-panel-bg)] p-3 space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-xs font-bold uppercase tracking-[0.14em] text-[var(--app-muted)]">Intake</div>
                      <span className="text-sm font-semibold tabular-nums text-emerald-500">{formatQuantity(currentSummary?.intake_ml ?? 0)} mL</span>
                    </div>
                    {fluidBalanceView === "detail" ? (
                      renderItemGroupCards(fluidIntakeItemGroups, "No intake items.", "intake")
                    ) : fluidIntakeItemGroups.length === 0 ? (
                      <div className="text-xs text-[var(--app-muted)]">No intake items.</div>
                    ) : (
                      <div className="divide-y divide-[var(--app-border)]">
                        {fluidIntakeItemGroups.map(group => (
                          <div key={`intake-summary-${group.key}`} className="flex min-h-9 items-center justify-between gap-4 py-1.5">
                            <span className="min-w-0 truncate text-sm font-semibold text-[var(--app-text)]">{group.itemName}</span>
                            <strong className="shrink-0 text-sm tabular-nums text-[var(--app-text)]">{getGroupTotalText(group) || `0 ${normalizeDisplayUnit(group.kind, group.itemUnit)}`}</strong>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="rounded-xl border border-[var(--app-border)] bg-[var(--app-panel-bg)] p-3 space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-xs font-bold uppercase tracking-[0.14em] text-[var(--app-muted)]">Output</div>
                      <span className="text-sm font-semibold tabular-nums text-blue-500">{formatQuantity(currentSummary?.output_ml ?? 0)} mL</span>
                    </div>
                    {fluidBalanceView === "detail" ? (
                      renderItemGroupCards(outputItemGroups, "No output items.", "output")
                    ) : outputItemGroups.length === 0 ? (
                      <div className="text-xs text-[var(--app-muted)]">No output items.</div>
                    ) : (
                      <div className="divide-y divide-[var(--app-border)]">
                        {outputItemGroups.map(group => (
                          <div key={`output-summary-${group.key}`} className="flex min-h-9 items-center justify-between gap-4 py-1.5">
                            <span className="min-w-0 truncate text-sm font-semibold text-[var(--app-text)]">{group.itemName}</span>
                            <strong className="shrink-0 text-sm tabular-nums text-[var(--app-text)]">{getGroupTotalText(group) || `0 ${normalizeDisplayUnit(group.kind, group.itemUnit)}`}</strong>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {currentLoading ? (
                <div className="text-xs text-gray-500 dark:text-gray-400">Loading current case...</div>
              ) : null}
            </div>
          )}
        </section>
      ) : (
        <section className={card}>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="rounded border border-gray-200 dark:border-gray-800 p-2 space-y-2">
              <div className="text-sm font-semibold">
                {groupOptionLabel(activeGroup)} Directory
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <select
                  className="rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-950 px-2 py-1.5 text-sm"
                  value={activeGroupId}
                  onChange={e => setActiveGroupId(e.target.value)}
                >
                  {masterVisibleGroups.map(group => (
                    <option key={group.id} value={group.id}>
                      {groupOptionLabel(group)}
                    </option>
                  ))}
                </select>
                <input
                  className="rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-950 px-2 py-1.5 text-sm"
                  placeholder="Search name / code / unit"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                />
                <label className="flex items-center gap-2 rounded border border-gray-300 dark:border-gray-700 px-2 py-1.5 text-xs">
                  <input
                    type="checkbox"
                    checked={includeInactive}
                    onChange={e => setIncludeInactive(e.target.checked)}
                  />
                  Include inactive
                </label>
              </div>

              <div className="max-h-80 overflow-y-auto space-y-1">
                {loading ? (
                  <div className="text-xs text-gray-500 dark:text-gray-400">Loading...</div>
                ) : visibleDirectory.length === 0 ? (
                  <div className="text-xs text-gray-500 dark:text-gray-400">
                    No directory rows.
                  </div>
                ) : (
                  visibleDirectory.map(item => (
                    <button
                      key={`${item.id}-${item.kind}-${item.code}`}
                      type="button"
                      onClick={() => pickRow(item)}
                      className="w-full text-left rounded border border-gray-200 dark:border-gray-800 px-2 py-1.5 hover:bg-gray-50 dark:hover:bg-gray-900"
                    >
                      <div className="truncate">
                        {item.name}
                        <span className="text-xs text-gray-500 dark:text-gray-400">
                          {" "}
                          ({item.code})
                        </span>
                      </div>
                      <div className="truncate text-xs text-gray-500 dark:text-gray-400">
                        {item.default_unit}
                        {item.category
                          ? ` | ${resolveTypeLabel(item.kind, item.category, item.code, item.name, detailedGroups)}`
                          : ""}
                        {item.is_active === 0 ? " | Inactive" : ""}
                      </div>
                      <div className="text-[10px] text-gray-500 dark:text-gray-400">
                        updated {fmt(item.updated_at)}
                      </div>
                    </button>
                  ))
                )}
              </div>
            </div>

            <div className="rounded border border-gray-200 dark:border-gray-800 p-2 space-y-2">
              <div className="text-sm font-semibold">
                {editingId == null ? "Create Entry" : `Edit Entry #${editingId}`}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <select
                  className="rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-950 px-2 py-1.5 text-sm"
                  value={formGroupId}
                  onChange={e => {
                    const group =
                      detailedGroupById.get(e.target.value) || detailedGroups[0];
                    setForm(prev => ({
                      ...prev,
                      kind: group.kind,
                      category: group.category,
                    }));
                  }}
                >
                  {masterVisibleGroups.map(group => (
                    <option key={group.id} value={group.id}>
                      {groupOptionLabel(group)}
                    </option>
                  ))}
                </select>
                <input
                  className="rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-950 px-2 py-1.5 text-sm"
                  placeholder="Code (optional)"
                  value={form.code}
                  onChange={e => setForm(prev => ({ ...prev, code: e.target.value }))}
                />
                <input
                  className="rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-950 px-2 py-1.5 text-sm"
                  placeholder="Name"
                  value={form.name}
                  onChange={e => setForm(prev => ({ ...prev, name: e.target.value }))}
                />
                <select
                  className="rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-950 px-2 py-1.5 text-sm"
                  value={form.default_unit}
                  onChange={e =>
                    setForm(prev => ({ ...prev, default_unit: e.target.value }))
                  }
                >
                  {formUnitOptions.map(unit => (
                    <option key={unit} value={unit}>
                      {unit}
                    </option>
                  ))}
                </select>
                <div className="rounded border border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 px-2 py-1.5 text-sm sm:col-span-2 text-gray-600 dark:text-gray-300">
                  Group: {groupOptionLabel(detailedGroupById.get(formGroupId) || masterVisibleGroups[0])}
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => void saveEntry()}
                  disabled={saving}
                  className={`${primaryButton} ${
                    saving ? primaryDisabled : primaryEnabled
                  }`}
                >
                  {saving ? "Saving..." : "Save Directory"}
                </button>
                <button
                  type="button"
                  onClick={clearForm}
                  className={secondaryButton}
                >
                  Clear
                </button>
                {editingId != null ? (
                  form.is_active === 0 ? (
                    <button
                      type="button"
                      onClick={() => void activateEntry()}
                      disabled={saving}
                      className={accentButton}
                    >
                      Activate
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => void deactivateEntry()}
                      disabled={saving}
                      className={dangerButton}
                    >
                      Deactivate
                    </button>
                  )
                ) : null}
              </div>

              {error ? (
                <div className="text-xs text-red-600 dark:text-red-400">{error}</div>
              ) : null}
              {note ? (
                <div className="text-xs text-blue-600 dark:text-blue-300">{note}</div>
              ) : null}
            </div>
          </div>
        </section>
      )}

      {entryRunId != null && selectedEntryRun != null ? (
        <div
          className="app-theme-scope io-modal-backdrop"
          onMouseDown={closeEntryModal}
        >
          <div
            className={`io-modal w-full ${
              (selectedEntryRun.kind === "med" && entryMode === "bolus") ||
              selectedEntryRun.kind === "output"
                ? "max-w-2xl"
                : "max-w-4xl"
              } p-4 space-y-3`}
            role="dialog"
            aria-modal="true"
            onMouseDown={e => e.stopPropagation()}
            onKeyDown={handleEntryModalKeyDown}
          >
            {ioModalPatientContext}
            {selectedEntryRun.kind === "med" && entryMode === "bolus" ? (
              <>
                <div className="flex items-start justify-between gap-3">
                  <div className="space-y-1">
                    <div className="text-sm font-semibold leading-none">Medication bolus</div>
                    <div className="flex items-center gap-2">
                      <span className="text-base font-medium leading-none">
                        {selectedEntryRun.item_name || selectedEntryRun.item_code || `Item ${selectedEntryRun.item_id}`}
                      </span>
                      <span className="rounded px-1.5 py-0.5 text-[10px] font-bold bg-blue-600/20 text-blue-400 leading-none">
                        Bolus
                      </span>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={closeEntryModal}
                    className={secondaryButton}
                    disabled={entrySaving}
                  >
                    Close
                  </button>
                </div>

                <div className="rounded-xl border border-[var(--app-border)] bg-black/5 dark:bg-white/[0.03] p-3 space-y-3">
                  <div className="grid grid-cols-[100px_1fr_120px] gap-2 items-center">
                    <label className="text-sm text-[var(--app-muted)] font-medium">Time</label>
                    <input
                      value={entryDate}
                      onChange={e => setEntryDate(formatDateInputDDMMYYYY(e.target.value))}
                      onBlur={e => {
                        const normalized = normalizeDateInputDDMMYYYY(e.target.value);
                        if (normalized) setEntryDate(normalized);
                      }}
                      className="rounded border border-[var(--app-border)] bg-[var(--app-control-bg)] px-2 py-1.5 text-sm"
                      placeholder="dd/mm/yyyy"
                    />
                    <input
                      value={entryTime}
                      onChange={e => setEntryTime(formatTimeInputHHMM(e.target.value))}
                      onBlur={e => {
                        const normalized = normalizeTimeInputHHMM(e.target.value);
                        if (normalized) setEntryTime(normalized);
                      }}
                      className="rounded border border-[var(--app-border)] bg-[var(--app-control-bg)] px-2 py-1.5 text-sm"
                      placeholder="HH:mm"
                      maxLength={5}
                    />
                  </div>
                  {entryIsLocalAnesthetic ? (
                    <>
                      <div className="grid grid-cols-[100px_1fr] gap-2 items-center">
                        <label className="text-sm text-[var(--app-muted)] font-medium">Route</label>
                        <select
                          className="rounded border border-[var(--app-border)] bg-[var(--app-control-bg)] px-2 py-1.5 text-sm"
                          value={entryLocalRoute}
                          onChange={e => setEntryLocalRoute(e.target.value)}
                        >
                          {["Local", "PNB", "Spinal", "Epidural", "Caudal"].map(route => (
                            <option key={`entry-local-route-${route}`} value={route}>
                              {route}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="grid grid-cols-[100px_1fr_110px] gap-2 items-center">
                        <label className="text-sm text-[var(--app-muted)] font-medium">Conc. %</label>
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          className="rounded border border-[var(--app-border)] bg-[var(--app-control-bg)] px-2 py-1.5 text-sm"
                          value={entryLocalConcentration}
                          onChange={e => setEntryLocalConcentration(e.target.value)}
                          placeholder="%"
                          autoFocus
                        />
                        <div className="rounded border border-[var(--app-border)] bg-[var(--app-control-bg)] px-2 py-1.5 text-sm text-[var(--app-text)]">
                          mg/mL
                        </div>
                      </div>
                      <div className="grid grid-cols-[100px_1fr_110px] gap-2 items-center">
                        <label className="text-sm text-[var(--app-muted)] font-medium">Volume</label>
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          className="rounded border border-[var(--app-border)] bg-[var(--app-control-bg)] px-2 py-1.5 text-sm"
                          value={entryLocalVolumeMl}
                          onChange={e => setEntryLocalVolumeMl(e.target.value)}
                          placeholder="Volume"
                        />
                        <div className="rounded border border-[var(--app-border)] bg-[var(--app-control-bg)] px-2 py-1.5 text-sm text-[var(--app-text)]">
                          mL
                        </div>
                      </div>
                    </>
                  ) : (
                    <div className="grid grid-cols-[100px_1fr_110px] gap-2 items-center">
                      <label className="text-sm text-[var(--app-muted)] font-medium">Dose</label>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        className="rounded border border-[var(--app-border)] bg-[var(--app-control-bg)] px-2 py-1.5 text-sm"
                        value={entryBolusValue}
                        onChange={e => setEntryBolusValue(e.target.value)}
                        placeholder="Dose value"
                        autoFocus
                      />
                      <div className="rounded border border-[var(--app-border)] bg-[var(--app-control-bg)] px-2 py-1.5 text-sm text-[var(--app-text)]">
                        {entryBolusUnit || selectedEntryRun.item_unit || "mg"}
                      </div>
                    </div>
                  )}
                  <div className="grid grid-cols-[100px_1fr] gap-2 items-center">
                    <label className="text-sm text-[var(--app-muted)] font-medium">Note</label>
                    <input
                      className="rounded border border-[var(--app-border)] bg-[var(--app-control-bg)] px-2 py-1.5 text-sm"
                      value={entryNote}
                      onChange={e => setEntryNote(e.target.value)}
                      placeholder="Optional note"
                    />
                  </div>
                </div>

                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={closeEntryModal}
                    className={secondaryButton}
                    disabled={entrySaving}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={clearMedicationEntryModal}
                    className={secondaryButton}
                    disabled={entrySaving}
                  >
                    Clear
                  </button>
                  <button
                    type="button"
                    onClick={() => void saveEntryValue()}
                    disabled={entrySaving}
                    className={`${primaryButton} ${entrySaving ? primaryDisabled : primaryEnabled}`}
                  >
                    {entrySaving ? "Saving..." : "Save"}
                  </button>
                </div>
              </>
            ) : selectedEntryRun.kind === "output" ? (
              <>
                <div className="flex items-start justify-between gap-3">
                  <div className="space-y-1">
                    <div className="text-sm font-semibold leading-none">Output</div>
                    <div className="flex items-center gap-2">
                      <span className="text-base font-medium leading-none">
                        {selectedEntryRun.item_name || selectedEntryRun.item_code || `Item ${selectedEntryRun.item_id}`}
                      </span>
                      <span className="rounded px-1.5 py-0.5 text-[10px] font-bold bg-blue-600/20 text-blue-400 leading-none">
                        Record
                      </span>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={closeEntryModal}
                    className={secondaryButton}
                    disabled={entrySaving}
                  >
                    Close
                  </button>
                </div>

                <div className="rounded-xl border border-[var(--app-border)] bg-black/5 dark:bg-white/[0.03] p-3 space-y-3">
                  <div className="grid grid-cols-[100px_1fr_120px] gap-2 items-center">
                    <label className="text-sm text-[var(--app-muted)] font-medium">Time</label>
                    <input
                      value={entryDate}
                      onChange={e => setEntryDate(formatDateInputDDMMYYYY(e.target.value))}
                      onBlur={e => {
                        const normalized = normalizeDateInputDDMMYYYY(e.target.value);
                        if (normalized) setEntryDate(normalized);
                      }}
                      className="rounded border border-[var(--app-border)] bg-[var(--app-control-bg)] px-2 py-1.5 text-sm"
                      placeholder="dd/mm/yyyy"
                    />
                    <input
                      value={entryTime}
                      onChange={e => setEntryTime(formatTimeInputHHMM(e.target.value))}
                      onBlur={e => {
                        const normalized = normalizeTimeInputHHMM(e.target.value);
                        if (normalized) setEntryTime(normalized);
                      }}
                      className="rounded border border-[var(--app-border)] bg-[var(--app-control-bg)] px-2 py-1.5 text-sm"
                      placeholder="HH:mm"
                      maxLength={5}
                    />
                  </div>
                  <div className="grid grid-cols-[100px_1fr_110px] gap-2 items-center">
                    <label className="text-sm text-[var(--app-muted)] font-medium">Volume</label>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      className="rounded border border-[var(--app-border)] bg-[var(--app-control-bg)] px-2 py-1.5 text-sm"
                      value={entryBolusValue}
                      onChange={e => setEntryBolusValue(e.target.value)}
                      placeholder="Volume"
                      autoFocus
                    />
                    <div className="rounded border border-[var(--app-border)] bg-[var(--app-control-bg)] px-2 py-1.5 text-sm text-[var(--app-text)]">
                      mL
                    </div>
                  </div>
                  <div className="grid grid-cols-[100px_1fr] gap-2 items-center">
                    <label className="text-sm text-[var(--app-muted)] font-medium">Note</label>
                    <input
                      className="rounded border border-[var(--app-border)] bg-[var(--app-control-bg)] px-2 py-1.5 text-sm"
                      value={entryNote}
                      onChange={e => setEntryNote(e.target.value)}
                      placeholder="Optional note"
                    />
                  </div>
                </div>

                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={closeEntryModal}
                    className={secondaryButton}
                    disabled={entrySaving}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={clearOutputEntryModal}
                    className={secondaryButton}
                    disabled={entrySaving}
                  >
                    Clear
                  </button>
                  <button
                    type="button"
                    onClick={() => void saveEntryValue()}
                    disabled={entrySaving}
                    className={`${primaryButton} ${entrySaving ? primaryDisabled : primaryEnabled}`}
                  >
                    {entrySaving ? "Saving..." : "Save"}
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="flex items-start justify-between gap-3">
                  <div className="space-y-1">
                    <div className="text-sm font-semibold leading-none">
                      {selectedEntryRun.kind === "fluid" ? "Fluid entry" : "Medication entry"}
                    </div>
                    <div className="text-base font-medium leading-none">
                      {selectedEntryRun.item_name || selectedEntryRun.item_code || `Item ${selectedEntryRun.item_id}`}
                    </div>
                    {selectedEntryRun.entry_mode != null ? (
                      <div className="inline-flex rounded border border-[var(--app-border)] bg-[var(--app-control-bg)] px-2 py-1.5 text-sm font-medium">
                        {entryMode === "drip" ? "Drip" : "Bolus"}
                      </div>
                    ) : (
                      <div className="inline-flex rounded border border-[var(--app-border)] overflow-hidden text-sm font-medium">
                        <button
                          type="button"
                          onClick={() => setEntryMode("bolus")}
                          className={`px-2 py-1.5 ${entryMode === "bolus" ? "bg-blue-600 text-white" : "bg-[var(--app-control-bg)] hover:bg-[var(--app-hover-bg)]"}`}
                        >
                          Bolus
                        </button>
                        <button
                          type="button"
                          onClick={() => setEntryMode("drip")}
                          className={`px-2 py-1.5 border-l border-[var(--app-border)] ${entryMode === "drip" ? "bg-blue-600 text-white" : "bg-[var(--app-control-bg)] hover:bg-[var(--app-hover-bg)]"}`}
                        >
                          Drip
                        </button>
                      </div>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={closeEntryModal}
                    className={secondaryButton}
                    disabled={entrySaving}
                  >
                    Close
                  </button>
                </div>

                <div className="space-y-2 text-sm">
                  <div className="grid grid-cols-[110px_1fr_120px] gap-2 items-center">
                    <label className="text-[var(--app-muted)]">Start</label>
                    <input
                      className="rounded border px-2 py-1.5"
                      value={entryDate}
                      onChange={e => setEntryDate(formatDateInputDDMMYYYY(e.target.value))}
                      onBlur={e => {
                        const normalized = normalizeDateInputDDMMYYYY(e.target.value);
                        if (normalized) setEntryDate(normalized);
                      }}
                      placeholder="dd/mm/yyyy"
                    />
                    <input
                      className="rounded border px-2 py-1.5"
                      value={entryTime}
                      onChange={e => setEntryTime(formatTimeInputHHMM(e.target.value))}
                      onBlur={e => {
                        const normalized = normalizeTimeInputHHMM(e.target.value);
                        if (normalized) setEntryTime(normalized);
                      }}
                      placeholder="HH:mm"
                    />
                  </div>
                  <div className="grid grid-cols-[110px_1fr_120px] gap-2 items-center">
                    <label className="text-[var(--app-muted)]">End</label>
                    <input
                      className="rounded border px-2 py-1.5"
                      value={entryEndDate}
                      onChange={e => setEntryEndDate(formatDateInputDDMMYYYY(e.target.value))}
                      onBlur={e => {
                        const normalized = normalizeDateInputDDMMYYYY(e.target.value);
                        if (normalized) setEntryEndDate(normalized);
                      }}
                      placeholder="dd/mm/yyyy"
                    />
                    <input
                      className="rounded border px-2 py-1.5"
                      value={entryEndTime}
                      onChange={e => setEntryEndTime(formatTimeInputHHMM(e.target.value))}
                      onBlur={e => {
                        const normalized = normalizeTimeInputHHMM(e.target.value);
                        if (normalized) setEntryEndTime(normalized);
                      }}
                      placeholder="HH:mm"
                    />
                  </div>

                  {entryMode === "bolus" ? (
                <div className="grid grid-cols-[110px_1fr_120px] gap-2 items-center">
                  <label className="text-[var(--app-muted)]">
                    {selectedEntryRun.kind === "med" ? "Dose" : "Volume"}
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    className="rounded border px-2 py-1.5"
                    value={entryBolusValue}
                    onChange={e => setEntryBolusValue(e.target.value)}
                    placeholder={selectedEntryRun.kind === "med" ? "Dose value" : "Volume"}
                  />
                  {selectedEntryRun.kind === "med" ? (
                    <select
                      className="rounded border px-2 py-1.5"
                      value={entryBolusUnit}
                      onChange={e => setEntryBolusUnit(e.target.value)}
                    >
                      {UOM_OPTIONS.map(unit => (
                        <option key={`modal-bolus-unit-${unit}`} value={unit}>
                          {unit}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <div className="rounded border border-[var(--app-border)] bg-[var(--app-control-bg)] px-2 py-1.5 text-[var(--app-muted)]">
                      mL
                    </div>
                  )}
                </div>
                  ) : (
                <>
                  <div className="grid grid-cols-[110px_1fr_120px] gap-2 items-center">
                    <label className="text-[var(--app-muted)]">Concentration</label>
                    <input
                      type="number"
                      min="0"
                      step="0.0001"
                      className="rounded border px-2 py-1.5"
                      value={entryConcentrationValue}
                      onChange={e => setEntryConcentrationValue(e.target.value)}
                    />
                    <div className="rounded border border-[var(--app-border)] bg-[var(--app-control-bg)] px-2 py-1.5 text-[var(--app-muted)]">
                      mg/mL
                    </div>
                  </div>
                  <div className="grid grid-cols-[110px_1fr_120px] gap-2 items-center">
                    <label className="text-[var(--app-muted)]">Carrier fluid</label>
                    <select
                      className="rounded border px-2 py-1.5"
                      value={entryCarrierFluidId ?? ""}
                      onChange={e => setEntryCarrierFluidId(Number(e.target.value) || null)}
                    >
                      <option value="">Select carrier fluid</option>
                      {carrierFluidOptions.map(item => (
                        <option key={`modal-carrier-${item.id}`} value={item.id}>
                          {item.name}
                        </option>
                      ))}
                    </select>
                    <div />
                  </div>
                  <div className="grid grid-cols-[110px_1fr_120px] gap-2 items-center">
                    <label className="text-[var(--app-muted)]">Dose</label>
                    <input
                      type="number"
                      min="0"
                      step="0.0001"
                      className="rounded border px-2 py-1.5"
                      value={entryDoseValue}
                      onChange={e => setEntryDoseValue(e.target.value)}
                    />
                    <select
                      className="rounded border px-2 py-1.5"
                      value={entryDoseUnit}
                      onChange={e => setEntryDoseUnit(e.target.value)}
                    >
                      {DOSE_PER_KG_RATE_UNITS.map(unit => (
                        <option key={`modal-drip-dose-unit-${unit}`} value={unit}>
                          {unit}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="grid grid-cols-[110px_1fr_120px] gap-2 items-center">
                    <label className="text-[var(--app-muted)]">Rate</label>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      className="rounded border px-2 py-1.5"
                      value={entryRateValue}
                      onChange={e => setEntryRateValue(e.target.value)}
                    />
                    <div className="rounded border border-[var(--app-border)] bg-[var(--app-control-bg)] px-2 py-1.5 text-[var(--app-muted)]">
                      mL/hr
                    </div>
                  </div>
                  <div className="grid grid-cols-[110px_1fr_120px] gap-2 items-center">
                    <label className="text-[var(--app-muted)]">Med volume</label>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      className="rounded border px-2 py-1.5"
                      value={entryVolumeMl}
                      onChange={e => setEntryVolumeMl(e.target.value)}
                    />
                    <div className="rounded border border-[var(--app-border)] bg-[var(--app-control-bg)] px-2 py-1.5 text-[var(--app-muted)]">
                      mL
                    </div>
                  </div>
                  <div className="grid grid-cols-[110px_1fr_120px] gap-2 items-center">
                    <label className="text-[var(--app-muted)]">Carrier volume</label>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      className="rounded border px-2 py-1.5"
                      value={entryCarrierVolumeMl}
                      onChange={e => setEntryCarrierVolumeMl(e.target.value)}
                    />
                    <div className="rounded border border-[var(--app-border)] bg-[var(--app-control-bg)] px-2 py-1.5 text-[var(--app-muted)]">
                      mL
                    </div>
                  </div>
                  <div className="grid grid-cols-[110px_1fr_120px] gap-2 items-center">
                    <label className="text-[var(--app-muted)]">Weight</label>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      className="rounded border px-2 py-1.5"
                      value={entryWeightKg}
                      onChange={e => setEntryWeightKg(e.target.value)}
                    />
                    <div className="rounded border border-[var(--app-border)] bg-[var(--app-control-bg)] px-2 py-1.5 text-[var(--app-muted)]">
                      kg
                    </div>
                  </div>
                </>
                  )}

                  {entryIsBloodProduct ? (
                <>
                  {entryBloodProductType ? (
                    <div className="grid grid-cols-[110px_1fr_120px] gap-2 items-center">
                      <label className="text-[var(--app-muted)]">Blood group</label>
                      <select
                        className="rounded border px-2 py-1.5"
                        value={entryBloodGroup}
                        onChange={e => setEntryBloodGroup(e.target.value)}
                      >
                        <option value="">Select group</option>
                        {BLOOD_GROUP_OPTIONS.map(group => (
                          <option key={`modal-blood-group-${group}`} value={group}>
                            {group}
                          </option>
                        ))}
                      </select>
                      <div className="rounded border border-[var(--app-border)] bg-[var(--app-control-bg)] px-2 py-1.5 text-[var(--app-muted)] text-center">
                        {entryBloodProductType}
                      </div>
                    </div>
                  ) : null}
                  <div className="grid grid-cols-[110px_1fr_120px] gap-2 items-center">
                    <label className="text-[var(--app-muted)]">Blood bag no.</label>
                    <input
                      className="rounded border px-2 py-1.5"
                      value={entryBloodBagNo}
                      onChange={e => setEntryBloodBagNo(e.target.value)}
                      placeholder="Bag number"
                    />
                    <div />
                  </div>
                </>
                  ) : null}

                  <div className="grid grid-cols-[110px_1fr_120px] gap-2 items-center">
                    <label className="text-[var(--app-muted)]">Note</label>
                    <input
                      className="rounded border px-2 py-1.5"
                      value={entryNote}
                      onChange={e => setEntryNote(e.target.value)}
                      placeholder="Optional note"
                    />
                    <div className="rounded border border-[var(--app-border)] bg-[var(--app-control-bg)] px-2 py-1.5 text-[var(--app-muted)]">
                      {entryDurationMin == null ? "--" : `${entryDurationMin} min`}
                    </div>
                  </div>
                </div>

                <div className="flex justify-end gap-2">
                  {entryMode === "drip" ? (
                    <button
                      type="button"
                      onClick={previewDripCalculation}
                      className={secondaryButton}
                      disabled={entrySaving}
                    >
                      Calculate
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => void saveEntryValue()}
                    disabled={entrySaving}
                    className={`${primaryButton} ${entrySaving ? primaryDisabled : primaryEnabled}`}
                  >
                    {entrySaving ? "Saving..." : "Save"}
                  </button>
                </div>
              </>
            )}

            {entryError ? (
              <div className="text-xs text-red-600 dark:text-red-400">{entryError}</div>
            ) : null}
          </div>
        </div>
      ) : null}

      {medDripModalOpen ? (
        <div
          className="app-theme-scope io-modal-backdrop"
          onMouseDown={closeMedDripModal}
        >
          <div
            className="io-modal w-full max-w-3xl p-4 space-y-3"
            role="dialog"
            aria-modal="true"
            onMouseDown={e => e.stopPropagation()}
            onKeyDown={handleMedDripModalKeyDown}
          >
            {ioModalPatientContext}
            <div className="flex items-start justify-between gap-3">
              <div className="space-y-1">
                <div className="text-sm font-semibold leading-none">Medication drip</div>
                <div className="flex items-center gap-2">
                  <span className="text-base font-medium leading-none">Medication</span>
                  <span className="rounded px-1.5 py-0.5 text-[10px] font-bold leading-none bg-violet-500/20 text-violet-300">
                    Drip
                  </span>
                </div>
                <div className="text-xs text-[var(--app-muted)]">
                  {medDripEditRunId != null
                    ? "Adjust the medication drip. Existing rate changes will be replaced with the new settings."
                    : "Search medication, set start time, and begin the infusion now."}
                </div>
              </div>
              <button
                type="button"
                onClick={closeMedDripModal}
                className={secondaryButton}
                disabled={medDripSaving}
              >
                Close
              </button>
            </div>

            <div className="grid grid-cols-[110px_1fr_120px] gap-2 items-center text-sm">
              <label className="text-[var(--app-muted)]">Group</label>
              <div className="rounded border border-[var(--app-border)] bg-[var(--app-control-bg)] px-2 py-1.5">
                {selectedMedDripGroupLabel}
              </div>
              <div className="rounded border border-[var(--app-border)] bg-[var(--app-control-bg)] px-2 py-1.5 text-center">
                {medDripRoute}
              </div>
            </div>

            {medDripEditRunId == null ? (
              <div className="rounded border border-violet-400/30 bg-violet-500/10 px-3 py-2">
                <div className="text-xs font-semibold uppercase tracking-wide text-violet-200">
                  Quick Guide
                </div>
                <div className="mt-1 text-sm text-violet-50/95">
                  Search medication first. If this looks like a typo, pick the suggested drug. If it is really not in the library, use a case-only manual drug. If it is actually a fluid such as Acetar, move to the Fluid flow instead.
                </div>
              </div>
            ) : null}

            <div className="relative">
              <input
                autoFocus
                className="w-full rounded border px-3 py-2 text-sm"
                placeholder="Search drug name..."
                value={medDripSearch}
                onChange={e => {
                  setMedDripSearch(e.target.value);
                  setMedDripItemId(null);
                  setMedDripManualMode(false);
                  setMedDripManualCategory("");
                  setShowMedDripDropdown(true);
                }}
                onFocus={() => setShowMedDripDropdown(true)}
                onKeyDown={e => {
                  if (
                    showMedDripDropdown &&
                    filteredMedDripItems.length > 0 &&
                    (e.key === "Enter" || (e.key === "Tab" && !e.shiftKey))
                  ) {
                    e.preventDefault();
                    if (e.key === "Enter" || filteredMedDripItems.length === 1) {
                      selectMedDripItem(filteredMedDripItems[0]);
                    } else {
                      medDripOptionRefs.current[0]?.focus();
                    }
                  }
                }}
              />
              {showMedDripDropdown ? (
                <>
                  <div
                    className="fixed inset-0 z-0"
                    onMouseDown={() => setShowMedDripDropdown(false)}
                  />
                  <div className="absolute z-10 mt-1 max-h-56 w-full overflow-y-auto rounded border border-[var(--app-border)] bg-[var(--app-panel-bg)] shadow-lg">
                    {filteredMedDripItems.length > 0 ? (
                      filteredMedDripItems.map((item, index) => (
                        <button
                          key={`med-drip-item-${item.id}`}
                          type="button"
                          ref={element => {
                            medDripOptionRefs.current[index] = element;
                          }}
                          className="w-full border-b border-[var(--app-border)] px-3 py-2 text-left text-sm hover:bg-[var(--app-hover-bg)] last:border-0"
                          onClick={() => selectMedDripItem(item)}
                          onKeyDown={e => {
                            if (e.key === "ArrowDown") {
                              e.preventDefault();
                              e.stopPropagation();
                              medDripOptionRefs.current[
                                Math.min(index + 1, filteredMedDripItems.length - 1)
                              ]?.focus();
                              return;
                            }
                            if (e.key === "ArrowUp") {
                              e.preventDefault();
                              e.stopPropagation();
                              if (index === 0) {
                                const input = e.currentTarget
                                  .closest(".relative")
                                  ?.querySelector("input");
                                if (input instanceof HTMLInputElement) input.focus();
                              } else {
                                medDripOptionRefs.current[index - 1]?.focus();
                              }
                              return;
                            }
                            if (e.key === "Enter" || (e.key === "Tab" && !e.shiftKey)) {
                              e.preventDefault();
                              e.stopPropagation();
                              selectMedDripItem(item);
                            }
                          }}
                        >
                          <div className="font-medium">{item.name}</div>
                          <div className="flex justify-between text-xs text-[var(--app-muted)]">
                            <span>{resolveTypeLabel(item.kind, item.category, item.code, item.name)}</span>
                            <span>{item.default_unit || "mg"}</span>
                          </div>
                        </button>
                      ))
                    ) : medDripSearch.trim().length > 0 && medDripSearch.trim().length < 2 ? (
                      <div className="p-3 text-sm text-[var(--app-muted)] italic">
                        Type at least 2 characters...
                      </div>
                    ) : medDripSearch.trim() ? (
                      <div className="p-3 space-y-2">
                        <div className="text-sm text-[var(--app-muted)] italic">
                          No medication matches found
                        </div>
                        {medDripFluidMatches.length > 0 ? (
                          <div className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-400/40 dark:bg-amber-500/10 dark:text-amber-100">
                            <div className="font-medium">This looks more like a fluid</div>
                            <div className="mt-1 text-xs text-amber-800 dark:text-amber-100/90">
                              If this is a fluid drip, we can move you to the fluid entry flow instead.
                            </div>
                            <div className="mt-2 flex flex-wrap gap-2">
                              {medDripFluidMatches.map(item => (
                                <button
                                  key={`med-drip-fluid-${item.id}`}
                                  type="button"
                                  className="rounded border border-amber-300 px-2 py-1 text-xs text-amber-900 hover:bg-amber-100 dark:border-amber-400/40 dark:text-amber-100 dark:hover:bg-amber-500/10"
                                  onClick={() => openFluidModalFromSuggestion(item)}
                                >
                                  Use Fluid: {item.name}
                                </button>
                              ))}
                            </div>
                          </div>
                        ) : null}
                        {medDripFuzzyMatches.length > 0 ? (
                          <div className="rounded border border-sky-300 bg-sky-50 px-3 py-2 text-sm text-sky-900 dark:border-sky-400/40 dark:bg-sky-500/10 dark:text-sky-100">
                            <div className="font-medium">Did you mean one of these?</div>
                            <div className="mt-2 flex flex-wrap gap-2">
                              {medDripFuzzyMatches.map(item => (
                                <button
                                  key={`med-drip-fuzzy-${item.id}`}
                                  type="button"
                                  className="rounded border border-sky-300 px-2 py-1 text-xs text-sky-900 hover:bg-sky-100 dark:border-sky-400/40 dark:text-sky-100 dark:hover:bg-sky-500/10"
                                  onClick={() => selectMedDripItem(item)}
                                >
                                  {item.name}
                                </button>
                              ))}
                            </div>
                          </div>
                        ) : null}
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

            {medDripEditRunId == null && medDripNeedsManualFallback ? (
              <div className="space-y-3">
                <div className="rounded border border-[var(--app-border)] bg-[var(--app-control-bg)] px-3 py-2">
                  <div className="text-sm font-semibold">Can&apos;t find this drug in library</div>
                  <div className="mt-1 text-sm text-[var(--app-muted)]">
                    Use a temporary manual entry for this case only. It will not appear in the normal active library.
                  </div>
                </div>
                <div className="rounded border border-cyan-400/40 bg-cyan-500/10 px-3 py-3 space-y-3">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold">Case-only manual drug</span>
                    <span className="rounded px-1.5 py-0.5 text-[10px] font-bold leading-none bg-cyan-500/20 text-cyan-300">
                      Manual
                    </span>
                  </div>
                  <div className="text-xs text-[var(--app-muted)]">
                    We will save this medication for the current case only and keep it out of the active library.
                  </div>
                </div>
                <div className="grid grid-cols-[110px_1fr] gap-2 items-center text-sm">
                  <label className="text-[var(--app-muted)]">Name</label>
                  <input
                    className="rounded border px-2 py-1.5"
                    value={medDripSearch}
                    onChange={e => setMedDripSearch(e.target.value)}
                  />
                  <label className="text-[var(--app-muted)]">Group</label>
                  <select
                    className="rounded border px-2 py-1.5"
                    value={medDripManualCategory}
                    onChange={e => {
                      setMedDripManualMode(true);
                      setMedDripManualCategory(e.target.value);
                    }}
                  >
                    <option value="">Select group</option>
                    {medCategoryOptions.map(option => (
                      <option key={`med-drip-manual-category-${option.value}`} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              </div>
            ) : null}

            <div className="grid grid-cols-[110px_1fr_120px] gap-2 items-center text-sm">
              <label className="text-[var(--app-muted)]">Drug Amount</label>
              <input
                ref={medDripAmountInputRef}
                type="number"
                min="0"
                step="0.01"
                className="rounded border px-2 py-1.5"
                value={medDripAmountValue}
                onChange={e => setMedDripAmountValue(e.target.value)}
                placeholder="0.00"
              />
              <select
                className="rounded border px-2 py-1.5"
                value={medDripAmountUnit}
                onChange={e => setMedDripAmountUnit(e.target.value)}
              >
                {UOM_OPTIONS.map(unit => (
                  <option key={`med-drip-unit-${unit}`} value={unit}>
                    {normalizeDisplayUnit("med", unit)}
                  </option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-[110px_1fr_120px] gap-2 items-center text-sm">
              <label className="text-[var(--app-muted)]">Carrier Fluid</label>
              <select
                className="rounded border px-2 py-1.5"
                value={medDripCarrierFluidId ?? ""}
                onChange={e =>
                  setMedDripCarrierFluidId(
                    e.target.value ? Number(e.target.value) : null,
                  )
                }
              >
                <option value="">Undilute</option>
                {carrierFluidOptions.map(item => (
                  <option key={`med-drip-carrier-${item.id}`} value={item.id}>
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
                value={medDripTotalVolumeMl}
                onChange={e => setMedDripTotalVolumeMl(e.target.value)}
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
                value={medDripDoseValue}
                onChange={e => {
                  setMedDripLastEdited("dose");
                  setMedDripDoseValue(e.target.value);
                }}
                placeholder="0.00"
              />
              <select
                className="rounded border px-2 py-1.5"
                value={medDripDoseUnit}
                onChange={e => setMedDripDoseUnit(e.target.value as (typeof DOSE_RATE_UNITS)[number])}
              >
                {medDripDoseUnitOptions.map(unit => (
                  <option key={`med-drip-dose-unit-${unit}`} value={unit}>
                    {normalizeDisplayUnit("med", unit)}
                  </option>
                ))}
              </select>
            </div>

            {medDripIsWeightBased ? (
              <div className="grid grid-cols-[110px_1fr_120px] gap-2 items-center text-sm">
                <label className="text-[var(--app-muted)]">Weight</label>
                <input
                  type="number"
                  min="0"
                  step="0.1"
                  className="rounded border px-2 py-1.5"
                  value={medDripWeightKg}
                  onChange={e => setMedDripWeightKg(e.target.value)}
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
                value={medDripRateMlHr}
                onChange={e => {
                  setMedDripLastEdited("rate");
                  setMedDripRateMlHr(e.target.value);
                }}
                placeholder="0.00"
              />
              <div className="rounded border border-[var(--app-border)] bg-[var(--app-control-bg)] px-2 py-1.5 text-center">
                mL/hr
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-2 items-center text-sm">
              <label className="text-[var(--app-muted)]">Time</label>
              <input
                className="rounded border px-2 py-1.5"
                value={medDripDate}
                onChange={e => setMedDripDate(formatDateInputDDMMYYYY(e.target.value))}
                onBlur={e => {
                  const normalized = normalizeDateInputDDMMYYYY(e.target.value);
                  if (normalized) setMedDripDate(normalized);
                }}
                placeholder="dd/mm/yyyy"
                tabIndex={-1}
              />
              <input
                className="rounded border px-2 py-1.5"
                value={medDripTime}
                onChange={e => setMedDripTime(formatTimeInputHHMM(e.target.value))}
                onBlur={e => {
                  const normalized = normalizeTimeInputHHMM(e.target.value);
                  if (normalized) setMedDripTime(normalized);
                }}
                placeholder="HH:mm"
              />
            </div>

            <div className="grid grid-cols-[110px_1fr] gap-2 items-center text-sm">
              <label className="text-[var(--app-muted)]">Note</label>
              <input
                className="rounded border px-2 py-1.5"
                value={medDripNote}
                onChange={e => setMedDripNote(e.target.value)}
                placeholder="Optional note"
              />
            </div>

            {medDripError ? (
              <div className="text-xs text-red-600 dark:text-red-400">{medDripError}</div>
            ) : null}

            <div className="flex justify-end gap-2 pt-2 border-t border-[var(--app-border)]">
              <button
                type="button"
                onClick={closeMedDripModal}
                className={secondaryButton}
                disabled={medDripSaving}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void saveMedDrip()}
                disabled={medDripSaving}
                className={`${primaryButton} ${medDripSaving ? primaryDisabled : primaryEnabled}`}
              >
                {medDripSaving ? "Saving..." : medDripEditRunId != null ? "Save Changes" : "Start Drip"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {bloodProductModalOpen ? (
        <div
          className="app-theme-scope io-modal-backdrop"
          onMouseDown={closeBloodProductModal}
        >
          <div
            className="io-modal w-full max-w-3xl p-4 space-y-3"
            role="dialog"
            aria-modal="true"
            onMouseDown={e => e.stopPropagation()}
            onKeyDown={handleBloodProductModalKeyDown}
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
                <div className="text-xs text-[var(--app-muted)]">
                  Search product, set time, volume, and blood bag details.
                </div>
              </div>
              <button
                type="button"
                onClick={closeBloodProductModal}
                className={secondaryButton}
                disabled={bloodProductSaving}
              >
                Close
              </button>
            </div>

            <div className="relative">
              <input
                autoFocus
                className="w-full rounded border px-3 py-2 text-sm"
                placeholder="Search blood product..."
                value={bloodProductSearch}
                onChange={e => {
                  setBloodProductSearch(e.target.value);
                  setBloodProductItemId(null);
                  setShowBloodProductDropdown(true);
                }}
                onFocus={() => setShowBloodProductDropdown(true)}
                onKeyDown={e => {
                  const matches = filteredBloodProductItems;
                  if (!matches.length || !showBloodProductDropdown) return;
                  if ((e.key === "Tab" && !e.shiftKey) || e.key === "Enter") {
                    e.preventDefault();
                    if (e.key === "Enter" || matches.length === 1) {
                      setBloodProductItemId(matches[0].id);
                      setBloodProductSearch(matches[0].name);
                      setShowBloodProductDropdown(false);
                      window.requestAnimationFrame(() => bloodProductVolumeRef.current?.focus());
                    } else {
                      bloodProductOptionRefs.current[0]?.focus();
                    }
                  }
                }}
              />
              {showBloodProductDropdown ? (
                <>
                  <div
                    className="fixed inset-0 z-0"
                    onMouseDown={() => setShowBloodProductDropdown(false)}
                  />
                  <div className="absolute z-10 mt-1 max-h-56 w-full overflow-y-auto rounded border border-[var(--app-border)] bg-[var(--app-panel-bg)] shadow-lg">
                    {filteredBloodProductItems.length > 0 ? (
                      filteredBloodProductItems.map((item, index) => (
                        <button
                          key={`blood-product-item-${item.id}`}
                          type="button"
                          ref={el => { bloodProductOptionRefs.current[index] = el; }}
                          className="w-full border-b border-[var(--app-border)] px-3 py-2 text-left text-sm hover:bg-[var(--app-hover-bg)] last:border-0"
                          onClick={() => { setBloodProductItemId(item.id); setBloodProductSearch(item.name); setShowBloodProductDropdown(false); window.requestAnimationFrame(() => bloodProductVolumeRef.current?.focus()); }}
                          onKeyDown={e => {
                            if (e.key === "ArrowDown") { e.preventDefault(); e.stopPropagation(); bloodProductOptionRefs.current[Math.min(index + 1, filteredBloodProductItems.length - 1)]?.focus(); return; }
                            if (e.key === "ArrowUp") { e.preventDefault(); e.stopPropagation(); if (index === 0) { (e.currentTarget.closest(".relative")?.querySelector("input") as HTMLInputElement | null)?.focus(); } else { bloodProductOptionRefs.current[index - 1]?.focus(); } return; }
                            if (e.key === "Enter" || (e.key === "Tab" && !e.shiftKey)) { e.preventDefault(); e.stopPropagation(); setBloodProductItemId(item.id); setBloodProductSearch(item.name); setShowBloodProductDropdown(false); window.requestAnimationFrame(() => bloodProductVolumeRef.current?.focus()); }
                          }}
                        >
                          <div className="font-medium">{item.name}</div>
                          <div className="flex justify-between text-xs text-[var(--app-muted)]">
                            <span>Blood Product</span>
                            <span>{item.default_unit || "ml"}</span>
                          </div>
                        </button>
                      ))
                    ) : bloodProductSearch.trim().length > 0 &&
                      bloodProductSearch.trim().length < 2 ? (
                      <div className="p-3 text-sm text-[var(--app-muted)] italic">
                        Type at least 2 characters...
                      </div>
                    ) : bloodProductSearch.trim() ? (
                      <div className="p-3 text-sm text-[var(--app-muted)] italic">
                        No matches found
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

            <div className="grid grid-cols-[110px_1fr_120px] gap-2 items-center text-sm">
              <label className="text-[var(--app-muted)]">Route</label>
              <div className="rounded border border-[var(--app-border)] bg-[var(--app-control-bg)] px-2 py-1.5">
                IV
              </div>
              <div />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-2 items-center text-sm">
              <label className="text-[var(--app-muted)]">Date</label>
              <input
                className="rounded border px-2 py-1.5"
                value={bloodProductDate}
                onChange={e => setBloodProductDate(formatDateInputDDMMYYYY(e.target.value))}
                onBlur={e => {
                  const normalized = normalizeDateInputDDMMYYYY(e.target.value);
                  if (normalized) setBloodProductDate(normalized);
                }}
                placeholder="dd/mm/yyyy"
              />
              <input
                className="rounded border px-2 py-1.5"
                value={bloodProductTime}
                onChange={e => setBloodProductTime(formatTimeInputHHMM(e.target.value))}
                onBlur={e => {
                  const normalized = normalizeTimeInputHHMM(e.target.value);
                  if (normalized) setBloodProductTime(normalized);
                }}
                placeholder="HH:mm"
              />
            </div>

            <div className="grid grid-cols-[110px_1fr_120px] gap-2 items-center text-sm">
              <label className="text-[var(--app-muted)]">Blood Group</label>
              <select
                className="rounded border px-2 py-1.5"
                value={bloodProductGroup}
                onChange={e => setBloodProductGroup(e.target.value)}
              >
                <option value="">{selectedBloodProductType ? "Select group" : "Optional"}</option>
                {BLOOD_GROUP_OPTIONS.map(group => (
                  <option key={`quick-blood-group-${group}`} value={group}>
                    {group}
                  </option>
                ))}
              </select>
              <div className="text-xs text-[var(--app-muted)]">
                {selectedBloodProductType || ""}
              </div>
            </div>

            <div className="grid grid-cols-[110px_1fr_120px] gap-2 items-center text-sm">
              <label className="text-[var(--app-muted)]">Bag No.</label>
              <input
                className="rounded border px-2 py-1.5"
                value={bloodProductBagNo}
                onChange={e => setBloodProductBagNo(e.target.value)}
                placeholder="Required"
              />
              <div />
            </div>

            <div className="grid grid-cols-[110px_1fr_120px] gap-2 items-center text-sm">
              <label className="text-[var(--app-muted)]">Volume</label>
              <input
                ref={bloodProductVolumeRef}
                type="number"
                min="0"
                step="0.01"
                className="rounded border px-2 py-1.5"
                value={bloodProductVolumeMl}
                onChange={e => setBloodProductVolumeMl(e.target.value)}
                placeholder="Volume"
              />
              <div className="rounded border border-[var(--app-border)] bg-[var(--app-control-bg)] px-2 py-1.5 text-[var(--app-muted)]">
                mL
              </div>
            </div>

            <div className="grid grid-cols-[110px_1fr_120px] gap-2 items-center text-sm">
              <label className="text-[var(--app-muted)]">Note</label>
              <input
                className="rounded border px-2 py-1.5"
                value={bloodProductNote}
                onChange={e => setBloodProductNote(e.target.value)}
                placeholder="Optional note"
              />
              <div />
            </div>

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={closeBloodProductModal}
                className={secondaryButton}
                disabled={bloodProductSaving}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void saveBloodProduct()}
                disabled={bloodProductSaving}
                className={`${primaryButton} ${bloodProductSaving ? primaryDisabled : primaryEnabled}`}
              >
                {bloodProductSaving ? "Saving..." : "Save"}
              </button>
            </div>

            {bloodProductError ? (
              <div className="text-xs text-red-600 dark:text-red-400">{bloodProductError}</div>
            ) : null}
          </div>
        </div>
      ) : null}

      {fluidModalOpen ? (
        <div
          className="app-theme-scope io-modal-backdrop"
          onMouseDown={closeFluidModal}
        >
          <div
            className="io-modal w-full max-w-xl p-5 space-y-4"
            role="dialog"
            aria-modal="true"
            data-fluid-modal
            onMouseDown={e => e.stopPropagation()}
            onKeyDown={handleFluidModalKeyDown}
          >
            {ioModalPatientContext}
            <div className="flex items-start justify-between gap-3">
              <div className="space-y-1">
                <div className="text-sm font-semibold leading-none">Fluid</div>
                <div className="flex items-center gap-2">
                  <span className="text-base font-medium leading-none">Fluid</span>
                  <span className="rounded px-1.5 py-0.5 text-[10px] font-bold leading-none bg-cyan-500/20 text-cyan-300">
                    {fluidEditRunId != null
                      ? "Drip"
                      : fluidEntryMode === "running"
                        ? "Running Drip"
                        : fluidEntryMode === "timed"
                          ? "Timed Drip"
                          : "Bolus"}
                  </span>
                </div>
              </div>
              <button
                type="button"
                onClick={closeFluidModal}
                className={secondaryButton}
                disabled={fluidSaving}
              >
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
                value={fluidSearch}
                onChange={e => {
                  setFluidSearch(e.target.value);
                  setFluidItemId(null);
                  setShowFluidDropdown(true);
                }}
                onFocus={() => setShowFluidDropdown(true)}
                onKeyDown={e => {
                  if (
                    showFluidDropdown &&
                    filteredFluidItems.length > 0 &&
                    (e.key === "Enter" || (e.key === "Tab" && !e.shiftKey))
                  ) {
                    e.preventDefault();
                    e.stopPropagation();
                    if (e.key === "Enter" || filteredFluidItems.length === 1) {
                      selectFluidItem(filteredFluidItems[0]);
                    } else {
                      fluidOptionRefs.current[0]?.focus();
                    }
                  }
                }}
              />
              {showFluidDropdown ? (
                <>
                  <div
                    className="fixed inset-0 z-0"
                    onMouseDown={() => setShowFluidDropdown(false)}
                  />
                  <div className="absolute z-10 mt-1 max-h-56 w-full overflow-y-auto rounded border border-[var(--app-border)] bg-[var(--app-panel-bg)] shadow-lg">
                    {filteredFluidItems.length > 0 ? (
                      filteredFluidItems.map((item, index) => (
                        <button
                          key={`fluid-modal-item-${item.id}`}
                          type="button"
                          ref={element => {
                            fluidOptionRefs.current[index] = element;
                          }}
                          className="w-full border-b border-[var(--app-border)] px-3 py-2 text-left text-sm hover:bg-[var(--app-hover-bg)] last:border-0"
                          onClick={() => selectFluidItem(item)}
                          onKeyDown={e => {
                            if (e.key === "ArrowDown") {
                              e.preventDefault();
                              e.stopPropagation();
                              fluidOptionRefs.current[
                                Math.min(index + 1, filteredFluidItems.length - 1)
                              ]?.focus();
                              return;
                            }
                            if (e.key === "ArrowUp") {
                              e.preventDefault();
                              e.stopPropagation();
                              if (index === 0) {
                                const input = e.currentTarget
                                  .closest(".relative")
                                  ?.querySelector("input");
                                if (input instanceof HTMLInputElement) input.focus();
                              } else {
                                fluidOptionRefs.current[index - 1]?.focus();
                              }
                              return;
                            }
                            if (e.key === "Enter" || (e.key === "Tab" && !e.shiftKey)) {
                              e.preventDefault();
                              e.stopPropagation();
                              selectFluidItem(item);
                            }
                          }}
                        >
                          <div className="font-medium">{item.name}</div>
                          <div className="text-xs text-[var(--app-muted)]">mL</div>
                        </button>
                      ))
                    ) : fluidSearch.trim().length > 0 && fluidSearch.trim().length < 2 ? (
                      <div className="p-3 text-sm text-[var(--app-muted)] italic">
                        Type at least 2 characters...
                      </div>
                    ) : fluidSearch.trim() ? (
                      <div className="p-3 text-sm text-[var(--app-muted)] italic">
                        No matches found
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

              {fluidEditRunId == null ? (
                <>
                  <label className="pt-2 text-xs font-medium text-[var(--app-muted)] uppercase tracking-wide">Mode</label>
                  <div className="flex flex-wrap gap-2">
                    {[
                      { id: "bolus", label: "Bolus" },
                      { id: "timed", label: "Timed Drip" },
                      { id: "running", label: "Running Drip" },
                    ].map(mode => {
                      const active = fluidEntryMode === mode.id;
                      return (
                        <button
                          key={`fluid-mode-${mode.id}`}
                          type="button"
                          className={`rounded border px-3 py-1.5 text-sm ${
                            active
                              ? "border-cyan-400 bg-cyan-500/20 text-cyan-100 shadow-[0_0_0_1px_rgba(34,211,238,0.25)]"
                              : "border-[var(--app-border)] text-[var(--app-muted)] hover:bg-[var(--app-hover-bg)]"
                          }`}
                          onClick={() => setFluidEntryMode(mode.id as "bolus" | "timed" | "running")}
                          disabled={fluidSaving}
                        >
                          {mode.label}
                        </button>
                      );
                    })}
                  </div>
                </>
              ) : null}

              {fluidEditRunId != null ? (
                <>
                  <label className="pt-2 text-xs font-medium text-[var(--app-muted)] uppercase tracking-wide">Rate</label>
                  <div className="flex items-center gap-2">
                    <input
                      ref={fluidFirstFieldRef}
                      type="number"
                      min="0"
                      step="1"
                      className="flex-1 rounded border border-[var(--app-border)] bg-[var(--app-control-bg)] px-3 py-2"
                      value={fluidRateMlHr}
                      onChange={e => setFluidRateMlHr(e.target.value)}
                      placeholder="0"
                    />
                    <span className="text-[var(--app-muted)]">mL/hr</span>
                  </div>
                </>
              ) : fluidEntryMode === "running" ? (
                <>
                  <label className="pt-2 text-xs font-medium text-[var(--app-muted)] uppercase tracking-wide">Rate</label>
                  <div className="flex items-center gap-2">
                    <input
                      ref={fluidFirstFieldRef}
                      type="number"
                      min="0"
                      step="1"
                      className="flex-1 rounded border border-[var(--app-border)] bg-[var(--app-control-bg)] px-3 py-2"
                      value={fluidRateMlHr}
                      onChange={e => setFluidRateMlHr(e.target.value)}
                      placeholder="0"
                    />
                    <span className="text-[var(--app-muted)]">mL/hr</span>
                  </div>
                </>
              ) : (
                <>
                  <label className="pt-2 text-xs font-medium text-[var(--app-muted)] uppercase tracking-wide">
                    {fluidEntryMode === "timed" ? "Volume / Time" : "Volume"}
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      ref={fluidFirstFieldRef}
                      type="number"
                      min="0"
                      step="1"
                      className="flex-1 rounded border border-[var(--app-border)] bg-[var(--app-control-bg)] px-3 py-2"
                      value={fluidVolumeMl}
                      onChange={e => setFluidVolumeMl(e.target.value)}
                      placeholder="0"
                    />
                    <span className="text-[var(--app-muted)]">mL</span>
                    {fluidEntryMode === "timed" ? (
                      <>
                        <input
                          type="number"
                          min="0"
                          step="5"
                          className="w-24 rounded border border-[var(--app-border)] bg-[var(--app-control-bg)] px-3 py-2"
                          value={fluidOverMin}
                          onChange={e => setFluidOverMin(e.target.value)}
                          placeholder="over"
                          onKeyDown={e => {
                            if (e.key === "Tab" && !e.shiftKey) {
                              e.preventDefault();
                              const modal = e.currentTarget.closest("[data-fluid-modal]");
                              const timeInput = modal?.querySelector<HTMLInputElement>("[data-fluid-time]");
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

              <label className="pt-2 text-xs font-medium text-[var(--app-muted)] uppercase tracking-wide">
                {fluidEditRunId != null ? "Time" : "Start"}
              </label>
              <div className="flex gap-2">
                <input
                  className="flex-1 rounded border border-[var(--app-border)] bg-[var(--app-control-bg)] px-3 py-2"
                  value={fluidDate}
                  onChange={e => setFluidDate(formatDateInputDDMMYYYY(e.target.value))}
                  onBlur={e => {
                    const normalized = normalizeDateInputDDMMYYYY(e.target.value);
                    if (normalized) setFluidDate(normalized);
                  }}
                  placeholder="dd/mm/yyyy"
                  tabIndex={-1}
                />
                <input
                  data-fluid-time
                  className="flex-1 rounded border border-[var(--app-border)] bg-[var(--app-control-bg)] px-3 py-2"
                  value={fluidTime}
                  onChange={e => setFluidTime(formatTimeInputHHMM(e.target.value))}
                  onBlur={e => {
                    const normalized = normalizeTimeInputHHMM(e.target.value);
                    if (normalized) setFluidTime(normalized);
                  }}
                  placeholder="HH:mm"
                />
              </div>

              <label className="pt-2 text-xs font-medium text-[var(--app-muted)] uppercase tracking-wide">Note</label>
              <input
                className="rounded border border-[var(--app-border)] bg-[var(--app-control-bg)] px-3 py-2"
                value={fluidNote}
                onChange={e => setFluidNote(e.target.value)}
                placeholder="Optional"
              />
            </div>

            {fluidError ? (
              <div className="text-xs text-red-600 dark:text-red-400">{fluidError}</div>
            ) : null}

            <div className="flex justify-end gap-2 pt-2 border-t border-[var(--app-border)]">
              <button
                type="button"
                onClick={closeFluidModal}
                className={secondaryButton}
                disabled={fluidSaving}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void saveFluid()}
                disabled={fluidSaving}
                className={`${primaryButton} ${fluidSaving ? primaryDisabled : primaryEnabled}`}
              >
                {fluidSaving
                  ? "Saving..."
                  : fluidEditRunId != null
                    ? "Save Changes"
                    : fluidEntryMode === "running"
                      ? "Start Drip"
                      : "Save"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {changeRateTarget != null ? (
        <div
          className="app-theme-scope io-modal-backdrop"
          onMouseDown={closeChangeRateModal}
        >
          <div
            className="io-modal w-full max-w-lg p-4 space-y-3"
            role="dialog"
            aria-modal="true"
            onMouseDown={e => e.stopPropagation()}
            onKeyDown={e => {
              if (changeRateSaving) return;
              if (e.key === "Escape") { e.preventDefault(); closeChangeRateModal(); return; }
              if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void confirmChangeRate(); }
            }}
          >
            {ioModalPatientContext}
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-sm font-semibold leading-none">Change Rate</div>
                <div className="mt-1 text-sm">{changeRateTarget.itemName}</div>
              </div>
              <button type="button" onClick={closeChangeRateModal} className={secondaryButton} disabled={changeRateSaving}>
                Close
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-[100px_1fr_120px] gap-2 items-center text-sm">
              <label className="text-gray-500 dark:text-gray-400">Change Time</label>
              <input
                className="rounded border px-2 py-1.5"
                value={changeRateTarget.date}
                onChange={e => setChangeRateTarget(c => c ? { ...c, date: formatDateInputDDMMYYYY(e.target.value) } : c)}
                onBlur={e => {
                  const n = normalizeDateInputDDMMYYYY(e.target.value);
                  if (n) setChangeRateTarget(c => c ? { ...c, date: n } : c);
                }}
                placeholder="dd/mm/yyyy"
                tabIndex={-1}
              />
              <input
                className="rounded border px-2 py-1.5"
                value={changeRateTarget.time}
                onChange={e => setChangeRateTarget(c => c ? { ...c, time: formatTimeInputHHMM(e.target.value) } : c)}
                onBlur={e => {
                  const n = normalizeTimeInputHHMM(e.target.value);
                  if (n) setChangeRateTarget(c => c ? { ...c, time: n } : c);
                }}
                placeholder="HH:mm"
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-[100px_1fr] gap-2 items-center text-sm">
              <label className="text-gray-500 dark:text-gray-400">New Rate (mL/hr)</label>
              <input
                className="rounded border px-2 py-1.5"
                value={changeRateTarget.rateValue}
                onChange={e => setChangeRateTarget(c => c ? { ...c, rateValue: e.target.value } : c)}
                placeholder="mL/hr"
                type="number"
                min="0"
                step="any"
              />
            </div>

            {changeRateTarget.kind !== "fluid" ? (
              <div className="grid grid-cols-1 md:grid-cols-[100px_1fr_120px] gap-2 items-center text-sm">
                <label className="text-gray-500 dark:text-gray-400">New Dose</label>
                <input
                  className="rounded border px-2 py-1.5"
                  value={changeRateTarget.doseValue}
                  onChange={e => setChangeRateTarget(c => c ? { ...c, doseValue: e.target.value } : c)}
                  placeholder="optional"
                  type="number"
                  min="0"
                  step="any"
                />
                <select
                  className="rounded border px-2 py-1.5 text-sm"
                  value={changeRateTarget.doseUnit}
                  onChange={e => setChangeRateTarget(c => c ? { ...c, doseUnit: e.target.value } : c)}
                >
                  {DOSE_PER_KG_RATE_UNITS.map(u => <option key={u} value={u}>{u}</option>)}
                </select>
              </div>
            ) : null}

            {changeRateError ? (
              <div className="text-xs text-red-600 dark:text-red-400">{changeRateError}</div>
            ) : null}

            <div className="flex justify-end gap-2">
              <button type="button" onClick={closeChangeRateModal} className={secondaryButton} disabled={changeRateSaving}>
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void confirmChangeRate()}
                className={`${primaryButton} ${changeRateSaving ? primaryDisabled : primaryEnabled}`}
                disabled={changeRateSaving}
              >
                {changeRateSaving ? "Saving..." : "Change Rate"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {stopDripTarget != null ? (
        <div
          className="app-theme-scope io-modal-backdrop"
          onMouseDown={closeStopDripModal}
        >
          <div
            className="io-modal w-full max-w-lg p-4 space-y-3"
            role="dialog"
            aria-modal="true"
            onMouseDown={e => e.stopPropagation()}
            onKeyDown={e => {
              if (stopDripSaving) return;
              if (e.key === "Escape") {
                e.preventDefault();
                closeStopDripModal();
                return;
              }
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void confirmStopDrip();
              }
            }}
          >
            {ioModalPatientContext}
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-sm font-semibold leading-none">Stop Drip</div>
                <div className="mt-1 text-sm">{stopDripTarget.itemName}</div>
              </div>
              <button
                type="button"
                onClick={closeStopDripModal}
                className={secondaryButton}
                disabled={stopDripSaving}
              >
                Close
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-[100px_1fr_120px] gap-2 items-center text-sm">
              <label className="text-gray-500 dark:text-gray-400">Stop Time</label>
              <input
                className="rounded border px-2 py-1.5"
                value={stopDripTarget.date}
                onChange={e =>
                  setStopDripTarget(current =>
                    current
                      ? { ...current, date: formatDateInputDDMMYYYY(e.target.value) }
                      : current,
                  )
                }
                onBlur={e => {
                  const normalized = normalizeDateInputDDMMYYYY(e.target.value);
                  if (!normalized) return;
                  setStopDripTarget(current =>
                    current ? { ...current, date: normalized } : current,
                  );
                }}
                placeholder="dd/mm/yyyy"
                tabIndex={-1}
              />
              <input
                className="rounded border px-2 py-1.5"
                value={stopDripTarget.time}
                onChange={e =>
                  setStopDripTarget(current =>
                    current
                      ? { ...current, time: formatTimeInputHHMM(e.target.value) }
                      : current,
                  )
                }
                onBlur={e => {
                  const normalized = normalizeTimeInputHHMM(e.target.value);
                  if (!normalized) return;
                  setStopDripTarget(current =>
                    current ? { ...current, time: normalized } : current,
                  );
                }}
                placeholder="HH:mm"
              />
            </div>

            {stopDripCurrentIntakeMl != null ? (
              <div className="text-sm text-gray-600 dark:text-gray-300">
                Current intake so far: <span className="font-semibold">{formatQuantity(stopDripCurrentIntakeMl)} mL</span>
              </div>
            ) : null}
            {stopDripSuggestedStopTs != null ? (
              <div className="flex items-center justify-between gap-2 text-sm text-gray-600 dark:text-gray-300">
                <div>
                  Suggested stop when prepared volume is reached:{" "}
                  <span className="font-semibold">
                    {toDateInput(stopDripSuggestedStopTs)} {toTimeInput(stopDripSuggestedStopTs)}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() =>
                    setStopDripTarget(current =>
                      current
                        ? {
                            ...current,
                            date: toDateInput(stopDripSuggestedStopTs),
                            time: toTimeInput(stopDripSuggestedStopTs),
                          }
                        : current,
                    )
                  }
                  className="rounded border border-blue-400 px-2 py-1 text-xs text-blue-600 dark:text-blue-300"
                  disabled={stopDripSaving}
                >
                  Use Suggested Time
                </button>
              </div>
            ) : null}

            {stopDripError ? (
              <div className="text-xs text-red-600 dark:text-red-400">{stopDripError}</div>
            ) : null}

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={closeStopDripModal}
                className={secondaryButton}
                disabled={stopDripSaving}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void confirmStopDrip()}
                className={`${dangerButton} ${stopDripSaving ? "opacity-60 cursor-not-allowed" : ""}`}
                disabled={stopDripSaving}
              >
                {stopDripSaving ? "Stopping..." : "Stop Drip"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <ConfirmDialog
        open={pendingRemove != null}
        title="Remove Item?"
        message={
          pendingRemove
            ? `Remove "${pendingRemove.itemName}" from current case?\n\nThis will exclude related entries from fluid balance totals.`
            : ""
        }
        confirmLabel="Remove"
        busy={pendingRemove != null && removingRunId === pendingRemove.runId}
        onCancel={() => setPendingRemove(null)}
        onConfirm={confirmRemoveRun}
      />
    </div>
  );
}
