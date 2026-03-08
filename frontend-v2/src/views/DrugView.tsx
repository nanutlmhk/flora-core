import { useEffect, useMemo, useState } from "react";
import type { CaseStatus } from "../api/caseApi";
import ConfirmDialog from "../components/common/ConfirmDialog";
import {
  createCaseIoEvent,
  createCaseIoSegment,
  createCaseIoRun,
  discontinueCaseIoRun,
  getCaseIoEvents,
  getCaseIoItems,
  getCaseIoRuns,
  getCaseIoSummary,
  type CaseIoEvent,
  type CaseIoItem,
  type CaseIoRun,
  type CaseIoRunSegment,
  type CaseIoSummaryTotals,
} from "../api/caseIoApi";
import {
  createDrugDirectoryEntry,
  deactivateDrugDirectoryEntry,
  getDrugDirectory,
  type DrugDirectoryItem,
  type IoKind,
  updateDrugDirectoryEntry,
} from "../api/drugApi";
import {
  formatDateInputDDMMYYYY,
  formatTimeInputHHMM,
  normalizeDateInputDDMMYYYY,
  normalizeTimeInputHHMM,
} from "../utils/clinicalInput";

type Props = {
  caseStatus: CaseStatus;
};

type DrugTab = "current" | "master";
type EntryMode = "bolus" | "drip";
type DisplayMode = EntryMode | "output";
type NonIdleCaseStatus = Exclude<CaseStatus, { status: "IDLE" }>;
type DetailedGroup = {
  id: string;
  label: string;
  kind: IoKind;
  category: string;
};

const card =
  "rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-950 p-3 space-y-3";
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
  { id: "ivAnesth", label: "IV Anesth", kind: "med", category: "ivAnesth" },
  { id: "muscleRelaxant", label: "Muscle Relaxant", kind: "med", category: "muscleRelaxant" },
  { id: "opioid", label: "Opioid", kind: "med", category: "opioid" },
  { id: "localAnesth", label: "Local Anesth", kind: "med", category: "localAnesth" },
  { id: "reversal", label: "Reversal", kind: "med", category: "reversal" },
  { id: "antiEmetic", label: "Anti-emetic", kind: "med", category: "antiEmetic" },
  { id: "vasopressor", label: "Vasopressor", kind: "med", category: "vasopressor" },
  { id: "localPlusOpioid", label: "Local+Opioid", kind: "med", category: "localPlusOpioid" },
  { id: "antiHt", label: "Anti HT", kind: "med", category: "antiHt" },
  { id: "analgesic", label: "Analgesic", kind: "med", category: "analgesic" },
  { id: "mannitol", label: "Mannitol", kind: "med", category: "mannitol" },
  { id: "antibiotics", label: "Antibiotics", kind: "med", category: "antibiotics" },
  { id: "steroid", label: "Steroid", kind: "med", category: "steroid" },
  { id: "antiArrhythmia", label: "Anti arrhythmia", kind: "med", category: "antiArrhythmia" },
  { id: "bronchodilator", label: "Bronchodilator", kind: "med", category: "bronchodilator" },
  { id: "nsaid", label: "NSAID", kind: "med", category: "nsaid" },
  { id: "diuretic", label: "Diuretic", kind: "med", category: "diuretic" },
  { id: "airwayAnesth", label: "Airway anesth", kind: "med", category: "airwayAnesth" },
  { id: "oralDrug", label: "Oral drug", kind: "med", category: "oralDrug" },
  { id: "externalDrug", label: "External drug", kind: "med", category: "externalDrug" },
  { id: "antiEpileptic", label: "Anti epileptic", kind: "med", category: "antiEpileptic" },
  { id: "othersMed", label: "Others", kind: "med", category: "othersMed" },
  { id: "nonOpioid", label: "Non-Opioid", kind: "med", category: "nonOpioid" },
  { id: "urineOutput", label: "Urine", kind: "output", category: "urineOutput" },
  { id: "bloodLossOutput", label: "Blood Loss", kind: "output", category: "bloodLossOutput" },
  { id: "otherOutput", label: "Other Output", kind: "output", category: "otherOutput" },
];

const DETAILED_GROUP_BY_ID = new Map(DETAILED_GROUPS.map(group => [group.id, group]));
const ROUTE_OPTIONS = [
  "IV",
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
const BLOOD_GROUP_OPTIONS = ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"] as const;

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

function asNumber(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function normalizeToken(value: unknown): string {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
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
): string {
  const categoryToken = normalizeToken(category);
  const codeToken = normalizeToken(code);

  const byCategory = DETAILED_GROUPS.find(
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
    return "muscleRelaxant";
  }
  if (categoryToken.includes("opioid")) return "opioid";
  if (categoryToken.includes("anesthetic") || categoryToken.includes("anaesthetic")) {
    return "ivAnesth";
  }
  if (categoryToken.includes("ivanesth")) {
    return "ivAnesth";
  }
  if (
    categoryToken.includes("vasopressor") ||
    categoryToken.includes("inotrope") ||
    categoryToken.includes("inotropedrip")
  ) {
    return "vasopressor";
  }
  if (categoryToken.includes("antiemetic")) return "antiEmetic";
  if (categoryToken.includes("antibiotic")) return "antibiotics";
  if (categoryToken.includes("steroid")) return "steroid";
  if (categoryToken.includes("localanesth")) return "localAnesth";
  if (categoryToken.includes("reversal")) return "reversal";
  if (categoryToken.includes("antiht")) return "antiHt";
  if (categoryToken.includes("analgesic")) return "analgesic";
  if (categoryToken.includes("antiarrhythmia") || categoryToken.includes("antiarrhyth"))
    return "antiArrhythmia";
  if (categoryToken.includes("bronchodilator")) return "bronchodilator";
  if (categoryToken.includes("nsaid")) return "nsaid";
  if (categoryToken.includes("antiepileptic")) return "antiEpileptic";
  if (categoryToken.includes("diuretic")) return "diuretic";
  if (categoryToken.includes("airwayanesth")) return "airwayAnesth";
  if (categoryToken.includes("oraldrug")) return "oralDrug";
  if (categoryToken.includes("externaldrug")) return "externalDrug";
  if (categoryToken.includes("nonopioid")) return "nonOpioid";
  if (categoryToken.includes("others")) return "othersMed";
  return "othersMed";
}

function formatMl(value: unknown): string {
  const n = asNumber(value);
  return `${n.toFixed(2)} mL`;
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
    if (dose > 0) return `${dose} ${event.dose_unit || ""}`.trim();
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
      ? `${rate} ${segment.rate_unit || "ml/hr"}`
      : "";
  const dose = Number(segment.dose_value);
  const doseText =
    Number.isFinite(dose) && dose > 0
      ? `${dose} ${segment.dose_unit || run.item_unit || ""}`.trim()
      : "";
  const carrier = Number(segment.carrier_ml_per_hr);
  const carrierText =
    Number.isFinite(carrier) && carrier > 0 ? `carrier ${carrier} mL/hr` : "";
  const parts = [rateText, doseText, carrierText].filter(Boolean);
  return `${from}-${to}${parts.length > 0 ? ` | ${parts.join(" | ")}` : ""}`;
}

function resolveTypeLabel(
  kind: IoKind,
  category: string | undefined,
  code: string | undefined,
  name: string | undefined,
): string {
  const groupId = resolveGroupId(kind, category || "", code || name || "");
  const group = DETAILED_GROUP_BY_ID.get(groupId);
  if (group) return groupOptionLabel(group);
  if (kind === "med") return "Medication";
  if (kind === "fluid") return "Fluid";
  return "Output";
}

function getItemVisual(kind: IoKind, displayMode: DisplayMode): {
  iconLabel: string;
  iconClass: string;
  badgeClass: string;
} {
  if (kind === "output" || displayMode === "output") {
    return {
      iconLabel: "O",
      iconClass: "bg-amber-500/15 text-amber-300 border border-amber-500/30",
      badgeClass: "bg-amber-500/15 text-amber-300 border border-amber-500/30",
    };
  }
  if (displayMode === "drip") {
    return {
      iconLabel: "D",
      iconClass: "bg-violet-500/15 text-violet-300 border border-violet-500/30",
      badgeClass: "bg-violet-500/15 text-violet-300 border border-violet-500/30",
    };
  }
  return {
    iconLabel: "B",
    iconClass: "bg-blue-500/15 text-blue-300 border border-blue-500/30",
    badgeClass: "bg-blue-500/15 text-blue-300 border border-blue-500/30",
  };
}

function defaultForm(kind: IoKind, category = ""): DrugDirectoryItem {
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

export default function DrugView({ caseStatus }: Props) {
  const caseId = caseStatus.status === "IDLE" ? null : caseStatus.case_id;
  const notifyIoAndEventChanged = (targetCaseId: number) => {
    window.dispatchEvent(
      new CustomEvent("aidas:case-io-changed", { detail: { caseId: targetCaseId } }),
    );
    window.dispatchEvent(
      new CustomEvent("aidas:case-events-changed", { detail: { caseId: targetCaseId } }),
    );
  };
  const [tab, setTab] = useState<DrugTab>("current");

  const [activeGroupId, setActiveGroupId] = useState("fluids");
  const [currentGroupId, setCurrentGroupId] = useState("");
  const [search, setSearch] = useState("");
  const [includeInactive, setIncludeInactive] = useState(false);
  const [directory, setDirectory] = useState<DrugDirectoryItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [editingId, setEditingId] = useState<number | null>(null);
  const initialGroup = DETAILED_GROUP_BY_ID.get("fluids");
  const [form, setForm] = useState<DrugDirectoryItem>(() =>
    defaultForm(initialGroup?.kind || "fluid", initialGroup?.category || ""),
  );

  const [prepareItemId, setPrepareItemId] = useState<number | null>(null);
  const [itemSearch, setItemSearch] = useState("");
  const [showItemDropdown, setShowItemDropdown] = useState(false);
  const [prepareRoute, setPrepareRoute] = useState("");
  const [prepareUom, setPrepareUom] = useState("");
  const [currentItems, setCurrentItems] = useState<CaseIoItem[]>([]);
  const [currentRuns, setCurrentRuns] = useState<CaseIoRun[]>([]);
  const [currentEvents, setCurrentEvents] = useState<CaseIoEvent[]>([]);
  const [currentSummary, setCurrentSummary] = useState<CaseIoSummaryTotals | null>(null);
  const [currentLoading, setCurrentLoading] = useState(false);
  const [currentSaving, setCurrentSaving] = useState(false);
  const [removingRunId, setRemovingRunId] = useState<number | null>(null);
  const [pendingRemove, setPendingRemove] = useState<{
    runId: number;
    itemName: string;
  } | null>(null);
  const [currentError, setCurrentError] = useState("");
  const [entryRunId, setEntryRunId] = useState<number | null>(null);
  const [entryMode, setEntryMode] = useState<EntryMode>("bolus");
  const [entryDate, setEntryDate] = useState(() => toDateInput(Date.now()));
  const [entryTime, setEntryTime] = useState(() => toTimeInput(Date.now()));
  const [entryEndDate, setEntryEndDate] = useState("");
  const [entryEndTime, setEntryEndTime] = useState("");
  const [entryBolusValue, setEntryBolusValue] = useState("");
  const [entryBolusUnit, setEntryBolusUnit] = useState("");
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

  const activeGroup =
    DETAILED_GROUP_BY_ID.get(activeGroupId) || DETAILED_GROUPS[0];
  const currentGroup = DETAILED_GROUP_BY_ID.get(currentGroupId) || null;
  const isCurrentGroupRouteEnabled = currentGroup
    ? !ROUTE_DISABLED_GROUP_IDS.has(currentGroup.id)
    : false;
  const formGroupId = resolveGroupId(form.kind, form.category || "", form.code);

  const activeRuns = useMemo(
    () =>
      currentRuns
        .filter(run => run.stopped_at == null && run.include_in_balance !== 0)
        .sort((a, b) => b.started_at - a.started_at || b.id - a.id),
    [currentRuns],
  );
  const selectedEntryRun = useMemo(
    () => activeRuns.find(run => run.id === entryRunId) || null,
    [activeRuns, entryRunId],
  );
  const entryBloodProductType = useMemo(
    () => resolveBloodProductEntryType(selectedEntryRun),
    [selectedEntryRun],
  );
  const entryIsBloodProduct = useMemo(
    () => isBloodProductRun(selectedEntryRun),
    [selectedEntryRun],
  );
  const carrierFluidOptions = useMemo(
    () =>
      currentItems
        .filter(
          item =>
            item.kind === "fluid" &&
            resolveGroupId(item.kind, item.category || "", item.code) === "fluids",
        )
        .sort((a, b) => a.name.localeCompare(b.name)),
    [currentItems],
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
      itemId: number;
      itemName: string;
      itemUnit: string;
      typeLabel: string;
      route?: string | null;
      events: CaseIoEvent[];
      segments: string[];
    };
    type DisplayGroup = BaseGroup & { displayMode: DisplayMode };

    const map = new Map<string, BaseGroup>();
    const preferredRunByKey = new Map<string, CaseIoRun>();

    const collectSegments = (run?: CaseIoRun): string[] => {
      if (!run || !Array.isArray(run.segments)) return [];
      return run.segments
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
        .map(segment => formatSegmentValue(run, segment));
    };

    const sortedRuns = [...currentRuns].sort((a, b) => {
      const aActive = a.stopped_at == null && a.include_in_balance !== 0 ? 1 : 0;
      const bActive = b.stopped_at == null && b.include_in_balance !== 0 ? 1 : 0;
      if (aActive !== bActive) return bActive - aActive;
      return b.started_at - a.started_at || b.id - a.id;
    });

    for (const run of sortedRuns) {
      if (run.include_in_balance === 0) continue;
      const key = `${run.kind}:${run.item_id}`;
      if (!preferredRunByKey.has(key)) preferredRunByKey.set(key, run);
    }

    for (const run of activeRuns) {
      const key = `${run.kind}:${run.item_id}`;
      const existing = map.get(key);
      const nextSegments = collectSegments(run);
      if (existing) {
        if (!existing.route && run.route) existing.route = run.route;
        if (existing.runId == null) existing.runId = run.id;
        if (nextSegments.length > 0) {
          existing.segments = Array.from(new Set([...existing.segments, ...nextSegments]));
        }
        continue;
      }
      map.set(key, {
        key,
        runId: run.id,
        kind: run.kind,
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
        events: [],
        segments: nextSegments,
      });
    }

    for (const event of currentEvents) {
      if (event.include_in_balance === 0) continue;
      const key = `${event.kind}:${event.item_id}`;
      let group = map.get(key);
      if (!group) {
        const fallbackRun = preferredRunByKey.get(key);
        group = {
          key,
          runId: fallbackRun?.id ?? null,
          kind: event.kind,
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
          events: [],
          segments: collectSegments(fallbackRun),
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
      mode === "bolus" ? 0 : mode === "drip" ? 1 : 2;

    rows.sort(
      (a, b) =>
        a.itemName.localeCompare(b.itemName) ||
        modeRank(a.displayMode) - modeRank(b.displayMode),
    );

    return rows;
  }, [activeRuns, currentEvents, currentRuns]);
  const intakeItemGroups = useMemo(
    () => itemGroups.filter(group => group.kind !== "output"),
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
    events: CaseIoEvent[];
  }): string | null => {
    const eventTotal = formatGroupEventTotal(group.kind, group.itemUnit, group.events);
    if (eventTotal) return eventTotal;
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
          resolveGroupId(item.kind, item.category || "", item.code) === currentGroup.id,
      );
    },
    [currentItems, currentGroup],
  );
  const selectedCurrentItem = useMemo(
    () => filteredCurrentItems.find(item => item.id === prepareItemId) || null,
    [filteredCurrentItems, prepareItemId],
  );
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
          resolveGroupId(item.kind, item.category || "", item.code) === activeGroup.id,
      ),
    [directory, activeGroup.id],
  );
  const filteredSearchItems = useMemo(() => {
    const q = normalizeToken(itemSearch);
    // If user typed something, require at least 2 characters to trigger search
    if (q && q.length < 2) return [];
    // If no search query and no group selected, don't show anything
    if (!q && !currentGroupId) return [];

    return currentItems
      .filter(item => {
        const matchesQuery =
          !q ||
          normalizeToken(item.name).includes(q) ||
          normalizeToken(item.code).includes(q);
        const matchesGroup =
          !currentGroupId ||
          resolveGroupId(item.kind, item.category, item.code || item.name) ===
            currentGroupId;
        return matchesQuery && matchesGroup;
      })
      .slice(0, 15);
  }, [currentItems, itemSearch, currentGroupId]);

  const loadDirectory = async () => {
    setLoading(true);
    setError("");
    try {
      const rows = await getDrugDirectory({
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
    if (tab !== "master") return;
    void loadDirectory();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, activeGroup.kind, search, includeInactive]);

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
    setPrepareRoute(DEFAULT_ROUTE);
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
    window.addEventListener("aidas:form-storage-changed", onFormStorageChanged);
    return () => {
      window.removeEventListener("aidas:form-storage-changed", onFormStorageChanged);
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

  const pickRow = (row: DrugDirectoryItem) => {
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
        await updateDrugDirectoryEntry(editingId, payload);
        setNote("Directory updated");
      } else {
        await createDrugDirectoryEntry(payload);
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
      await deactivateDrugDirectoryEntry(editingId);
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
      await updateDrugDirectoryEntry(editingId, { is_active: 1 });
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

  const handlePrepare = async () => {
    if (caseId == null || caseStatus.status === "IDLE") return;
    setCurrentError("");
    if (!currentGroup) {
      setCurrentError("Select type first");
      return;
    }
    if (prepareItemId == null) {
      setCurrentError("Select item first");
      return;
    }

    const defaultUom = String(selectedCurrentItem?.default_unit || "").trim();
    const selectedUom = String(prepareUom || "").trim();
    const noteWithUom =
      selectedUom && selectedUom !== defaultUom ? `uom:${selectedUom}` : undefined;

    setCurrentSaving(true);
    try {
      const routeToSave = ROUTE_DISABLED_GROUP_IDS.has(currentGroup.id)
        ? undefined
        : prepareRoute.trim() || DEFAULT_ROUTE;
      await createCaseIoRun(caseId, {
        item_id: prepareItemId,
        kind: currentGroup.kind,
        route: routeToSave,
        started_at: caseStatus.start_time,
        include_in_balance: true,
        note: noteWithUom,
        reason: "fluidmed dashboard save item",
      });
      await loadCurrentCase(caseId, caseStatus);
      notifyIoAndEventChanged(caseId);
      setItemSearch("");
      setCurrentGroupId("");
    } catch (err) {
      setCurrentError(err instanceof Error ? err.message : "Failed to save item");
    } finally {
      setCurrentSaving(false);
    }
  };

  const handleRemoveRun = async (runId: number, itemName: string) => {
    if (caseId == null || caseStatus.status === "IDLE") return;
    setPendingRemove({ runId, itemName });
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
    const baseReason = "fluidmed entry from drugview";
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
        const numericValue = Number(entryBolusValue);
        if (!Number.isFinite(numericValue) || numericValue <= 0) {
          throw new Error(
            selectedEntryRun.kind === "med" ? "Dose must be > 0" : "Volume must be > 0",
          );
        }
        if (selectedEntryRun.kind === "med") {
          await createCaseIoEvent(caseId, {
            item_id: selectedEntryRun.item_id,
            kind: selectedEntryRun.kind,
            event_ts: eventTs,
            dose_value: numericValue,
            dose_unit: entryBolusUnit.trim() || selectedEntryRun.item_unit || "mg",
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
          });
        } else {
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
        });
      }

      await loadCurrentCase(caseId, caseStatus);
      notifyIoAndEventChanged(caseId);
      setEntryBolusValue("");
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

  return (
    <div className="p-4 pb-24 space-y-4 text-gray-900 dark:text-gray-100">
      <div className="inline-flex rounded-md border border-gray-300 dark:border-gray-700 overflow-hidden">
        <button
          type="button"
          onClick={() => setTab("current")}
          className={`px-3 py-1.5 text-sm ${
            tab === "current"
              ? "bg-blue-600 text-white"
              : "bg-white dark:bg-gray-900 hover:bg-gray-100 dark:hover:bg-gray-800"
          }`}
        >
          Current Case
        </button>
        <button
          type="button"
          onClick={() => setTab("master")}
          className={`px-3 py-1.5 text-sm border-l border-gray-300 dark:border-gray-700 ${
            tab === "master"
              ? "bg-blue-600 text-white"
              : "bg-white dark:bg-gray-900 hover:bg-gray-100 dark:hover:bg-gray-800"
          }`}
        >
          Master Data
        </button>
      </div>

      {tab === "current" ? (
        <section className={card}>
          {caseStatus.status === "IDLE" ? (
            <div className="text-sm text-gray-500 dark:text-gray-400">
              Start case first to add item list and record entries.
            </div>
          ) : (
            <div className="space-y-3">
              <div className="grid grid-cols-2 lg:grid-cols-5 gap-2">
                <div className="rounded border border-gray-200 dark:border-gray-800 px-2 py-2">
                  <div className="text-[11px] text-gray-500 dark:text-gray-400">Intake</div>
                  <div className="text-sm font-semibold">
                    {formatMl(currentSummary?.intake_ml)}
                  </div>
                </div>
                <div className="rounded border border-gray-200 dark:border-gray-800 px-2 py-2">
                  <div className="text-[11px] text-gray-500 dark:text-gray-400">Output</div>
                  <div className="text-sm font-semibold">
                    {formatMl(currentSummary?.output_ml)}
                  </div>
                </div>
                <div className="rounded border border-gray-200 dark:border-gray-800 px-2 py-2">
                  <div className="text-[11px] text-gray-500 dark:text-gray-400">Urine</div>
                  <div className="text-sm font-semibold">
                    {formatMl(currentSummary?.urine_output_ml)}
                  </div>
                </div>
                <div className="rounded border border-gray-200 dark:border-gray-800 px-2 py-2">
                  <div className="text-[11px] text-gray-500 dark:text-gray-400">Blood Loss</div>
                  <div className="text-sm font-semibold">
                    {formatMl(currentSummary?.blood_loss_ml)}
                  </div>
                </div>
                <div className="rounded border border-gray-200 dark:border-gray-800 px-2 py-2">
                  <div className="text-[11px] text-gray-500 dark:text-gray-400">Net</div>
                  <div
                    className={`text-sm font-semibold ${
                      asNumber(currentSummary?.net_ml) < 0
                        ? "text-red-600 dark:text-red-400"
                        : "text-green-700 dark:text-green-400"
                    }`}
                  >
                    {formatMl(currentSummary?.net_ml)}
                  </div>
                </div>
              </div>

              <div className="rounded border border-gray-200 dark:border-gray-800 p-3 space-y-2">
                <div className="text-sm font-semibold">Add Item</div>
                <div className="grid grid-cols-1 md:grid-cols-12 gap-2 items-center">
                  <select
                    className="md:col-span-3 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-950 px-2 py-1.5 text-sm"
                    value={currentGroupId}
                    onChange={e => setCurrentGroupId(e.target.value)}
                  >
                    <option value="">All Types</option>
                    {DETAILED_GROUPS.map(group => (
                      <option key={group.id} value={group.id}>
                        {groupOptionLabel(group)}
                      </option>
                    ))}
                  </select>
                  <div className="md:col-span-3 relative">
                    <input
                      className="w-full rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-950 px-2 py-1.5 text-sm"
                      placeholder="Search item name..."
                      value={itemSearch}
                      onChange={e => {
                        setItemSearch(e.target.value);
                        setShowItemDropdown(true);
                        setPrepareItemId(null);
                      }}
                      onFocus={() => setShowItemDropdown(true)}
                    />
                    {showItemDropdown && (
                      <>
                        <div
                          className="fixed inset-0 z-0"
                          onClick={() => setShowItemDropdown(false)}
                        />
                        <div className="absolute z-10 w-full mt-1 max-h-60 overflow-y-auto rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-950 shadow-lg">
                          {filteredSearchItems.length > 0 ? (
                            filteredSearchItems.map(item => {
                              const groupId = resolveGroupId(
                                item.kind,
                                item.category,
                                item.code || item.name,
                              );
                              const group = DETAILED_GROUP_BY_ID.get(groupId);
                              return (
                                <button
                                  key={`search-item-${item.id}`}
                                  type="button"
                                  className="w-full text-left px-3 py-2 text-sm hover:bg-gray-100 dark:hover:bg-gray-800 border-b border-gray-100 dark:border-gray-900 last:border-0"
                                  onClick={() => {
                                    setPrepareItemId(item.id);
                                    setItemSearch(item.name);
                                    setCurrentGroupId(groupId);
                                    setShowItemDropdown(false);
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
                            <div className="p-3 text-sm text-gray-500 italic">
                              No matches found
                            </div>
                          ) : (
                            <div className="p-3 text-sm text-gray-500 italic">
                              {currentGroupId ? "Searching in group..." : "Start typing to search..."}
                            </div>
                          )}
                        </div>
                      </>
                    )}
                  </div>
                  <select
                    className="md:col-span-3 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-950 px-2 py-1.5 text-sm"
                    value={isCurrentGroupRouteEnabled ? prepareRoute : ""}
                    onChange={e => setPrepareRoute(e.target.value)}
                    disabled={!currentGroup || !isCurrentGroupRouteEnabled}
                  >
                    {!currentGroup ? (
                      <option value="">Select item first</option>
                    ) : !isCurrentGroupRouteEnabled ? (
                      <option value="">No route</option>
                    ) : (
                      <>
                        <option value="">Route (default IV)</option>
                        {ROUTE_OPTIONS.map(route => (
                          <option key={route} value={route}>
                            {route}
                          </option>
                        ))}
                      </>
                    )}
                  </select>
                  <select
                    className="md:col-span-2 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-950 px-2 py-1.5 text-sm"
                    value={prepareUom}
                    onChange={e => setPrepareUom(e.target.value)}
                  >
                    <option value="">UOM</option>
                    {UOM_OPTIONS.map(unit => (
                      <option key={unit} value={unit}>
                        {unit}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => {
                      void handlePrepare();
                    }}
                    disabled={
                      currentSaving || currentLoading || prepareItemId == null || !currentGroup
                    }
                    className={`md:col-span-1 ${primaryButton} ${
                      currentSaving || currentLoading || prepareItemId == null || !currentGroup
                        ? primaryDisabled
                        : primaryEnabled
                    }`}
                  >
                    {currentSaving ? "Saving..." : "Add"}
                  </button>
                </div>
                {currentError ? (
                  <div className="text-xs text-red-600 dark:text-red-400">{currentError}</div>
                ) : null}
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                <div className="rounded border border-gray-200 dark:border-gray-800 p-2 space-y-2">
                  <div className="text-sm font-semibold">Intake</div>
                  {intakeItemGroups.length === 0 ? (
                    <div className="text-xs text-gray-500 dark:text-gray-400">No intake items.</div>
                  ) : (
                    <div className="max-h-56 overflow-y-auto space-y-1">
                      {intakeItemGroups.map(group => {
                        const visual = getItemVisual(group.kind, group.displayMode);
                        return (
                          <div
                            key={`intake-item-${group.key}`}
                            className="rounded border border-gray-200 dark:border-gray-800 px-2 py-1"
                          >
                            <div className="flex items-center justify-between gap-2">
                              <div className="min-w-0 flex items-center gap-1.5 text-sm">
                                <span
                                  className={`shrink-0 rounded px-1 py-0.5 text-[10px] leading-none font-semibold ${visual.iconClass}`}
                                  aria-hidden
                                >
                                  {visual.iconLabel}
                                </span>
                                <span className="truncate">{group.itemName}</span>
                                <span
                                  className={`app-tooltip shrink-0 rounded px-1 py-0.5 text-[10px] leading-none ${visual.badgeClass}`}
                                  data-tooltip={group.typeLabel}
                                >
                                  {group.typeLabel}
                                </span>
                                <span className="shrink-0 rounded bg-gray-100 dark:bg-gray-900 px-1 py-0.5 text-[10px] text-gray-500 dark:text-gray-400 leading-none">
                                  {group.itemUnit}
                                </span>
                                {group.route ? (
                                  <span className="shrink-0 rounded bg-gray-100 dark:bg-gray-900 px-1 py-0.5 text-[10px] text-gray-500 dark:text-gray-400 leading-none">
                                    {group.route}
                                  </span>
                                ) : null}
                              </div>
                              {group.runId != null ? (() => {
                                const runId = group.runId;
                                return (
                                  <div className="shrink-0 flex items-center gap-2">
                                    <button
                                      type="button"
                                      onClick={() =>
                                        openEntryModal(
                                          runId,
                                          group.displayMode === "drip" ? "drip" : "bolus",
                                        )
                                      }
                                      className="text-[10px] text-blue-600 dark:text-blue-300 hover:underline"
                                    >
                                      Entry
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => void handleRemoveRun(runId, group.itemName)}
                                      disabled={removingRunId === runId}
                                      className="text-[10px] text-red-600 dark:text-red-300 hover:underline disabled:text-gray-400 disabled:no-underline"
                                    >
                                      {removingRunId === runId ? "Removing..." : "Remove"}
                                    </button>
                                  </div>
                                );
                              })() : null}
                            </div>
                            {(() => {
                              const totalText = getGroupTotalText(group);
                              if (!totalText) return null;
                              return (
                                <div className="mt-0.5 text-[11px] font-semibold text-cyan-700 dark:text-cyan-300">
                                  Total {totalText}
                                </div>
                              );
                            })()}
                            {group.events.length === 0 ? (
                              group.segments.length === 0 ? (
                                <div className="mt-0.5 text-[11px] text-gray-500 dark:text-gray-400">
                                  No records yet
                                </div>
                              ) : (
                                <div className="mt-0.5 space-y-0.5">
                                  {group.segments.map((segmentText, idx) => (
                                    <div
                                      key={`intake-segment-${group.key}-${idx}`}
                                      className="text-[11px] text-cyan-300"
                                    >
                                      Drip {segmentText}
                                    </div>
                                  ))}
                                </div>
                              )
                            ) : (
                              <div className="mt-0.5 space-y-0.5">
                                {group.events.map(event => (
                                  <div
                                    key={`intake-event-${group.key}-${event.id}`}
                                    className="flex items-center justify-between text-[11px]"
                                  >
                                    <span>{fmtHHMM(event.event_ts)}</span>
                                    <span>{formatEventValue(event)}</span>
                                  </div>
                                ))}
                                {group.segments.map((segmentText, idx) => (
                                  <div
                                    key={`intake-segment-${group.key}-${idx}`}
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
                  )}
                </div>

                <div className="rounded border border-gray-200 dark:border-gray-800 p-2 space-y-2">
                  <div className="text-sm font-semibold">Output</div>
                  {outputItemGroups.length === 0 ? (
                    <div className="text-xs text-gray-500 dark:text-gray-400">No output items.</div>
                  ) : (
                    <div className="max-h-56 overflow-y-auto space-y-1">
                      {outputItemGroups.map(group => {
                        const visual = getItemVisual(group.kind, group.displayMode);
                        return (
                          <div
                            key={`output-item-${group.key}`}
                            className="rounded border border-gray-200 dark:border-gray-800 px-2 py-1"
                          >
                            <div className="flex items-center justify-between gap-2">
                              <div className="min-w-0 flex items-center gap-1.5 text-sm">
                                <span
                                  className={`shrink-0 rounded px-1 py-0.5 text-[10px] leading-none font-semibold ${visual.iconClass}`}
                                  aria-hidden
                                >
                                  {visual.iconLabel}
                                </span>
                                <span className="truncate">{group.itemName}</span>
                                <span
                                  className={`app-tooltip shrink-0 rounded px-1 py-0.5 text-[10px] leading-none ${visual.badgeClass}`}
                                  data-tooltip={group.typeLabel}
                                >
                                  {group.typeLabel}
                                </span>
                                <span className="shrink-0 rounded bg-gray-100 dark:bg-gray-900 px-1 py-0.5 text-[10px] text-gray-500 dark:text-gray-400 leading-none">
                                  {group.itemUnit}
                                </span>
                                {group.route ? (
                                  <span className="shrink-0 rounded bg-gray-100 dark:bg-gray-900 px-1 py-0.5 text-[10px] text-gray-500 dark:text-gray-400 leading-none">
                                    {group.route}
                                  </span>
                                ) : null}
                              </div>
                              {group.runId != null ? (() => {
                                const runId = group.runId;
                                return (
                                  <div className="shrink-0 flex items-center gap-2">
                                    <button
                                      type="button"
                                      onClick={() =>
                                        openEntryModal(
                                          runId,
                                          group.displayMode === "drip" ? "drip" : "bolus",
                                        )
                                      }
                                      className="text-[10px] text-blue-600 dark:text-blue-300 hover:underline"
                                    >
                                      Entry
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => void handleRemoveRun(runId, group.itemName)}
                                      disabled={removingRunId === runId}
                                      className="text-[10px] text-red-600 dark:text-red-300 hover:underline disabled:text-gray-400 disabled:no-underline"
                                    >
                                      {removingRunId === runId ? "Removing..." : "Remove"}
                                    </button>
                                  </div>
                                );
                              })() : null}
                            </div>
                            {(() => {
                              const totalText = getGroupTotalText(group);
                              if (!totalText) return null;
                              return (
                                <div className="mt-0.5 text-[11px] font-semibold text-cyan-700 dark:text-cyan-300">
                                  Total {totalText}
                                </div>
                              );
                            })()}
                            {group.events.length === 0 ? (
                              group.segments.length === 0 ? (
                                <div className="mt-0.5 text-[11px] text-gray-500 dark:text-gray-400">
                                  No records yet
                                </div>
                              ) : (
                                <div className="mt-0.5 space-y-0.5">
                                  {group.segments.map((segmentText, idx) => (
                                    <div
                                      key={`output-segment-${group.key}-${idx}`}
                                      className="text-[11px] text-cyan-300"
                                    >
                                      Drip {segmentText}
                                    </div>
                                  ))}
                                </div>
                              )
                            ) : (
                              <div className="mt-0.5 space-y-0.5">
                                {group.events.map(event => (
                                  <div
                                    key={`output-event-${group.key}-${event.id}`}
                                    className="flex items-center justify-between text-[11px]"
                                  >
                                    <span>{fmtHHMM(event.event_ts)}</span>
                                    <span>{formatEventValue(event)}</span>
                                  </div>
                                ))}
                                {group.segments.map((segmentText, idx) => (
                                  <div
                                    key={`output-segment-${group.key}-${idx}`}
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
                  )}
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
                  {DETAILED_GROUPS.map(group => (
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
                        {item.category ? ` | ${item.category}` : ""}
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
                      DETAILED_GROUP_BY_ID.get(e.target.value) || DETAILED_GROUPS[0];
                    setForm(prev => ({
                      ...prev,
                      kind: group.kind,
                      category: group.category,
                    }));
                  }}
                >
                  {DETAILED_GROUPS.map(group => (
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
                  Group: {groupOptionLabel(DETAILED_GROUP_BY_ID.get(formGroupId) || DETAILED_GROUPS[0])}
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
          className="app-theme-scope fixed inset-0 z-[140] bg-black/45 backdrop-blur-[1px] flex items-center justify-center p-3"
          onMouseDown={closeEntryModal}
        >
          <div
            className="w-full max-w-4xl rounded-xl border border-[var(--app-border)] bg-[var(--app-panel-bg)] text-[var(--app-text)] shadow-2xl p-4 space-y-3 backdrop-blur"
            onMouseDown={e => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="space-y-1">
                <div className="text-sm font-semibold leading-none">Entry</div>
                <div className="text-base font-medium leading-none">
                  {selectedEntryRun.item_name || selectedEntryRun.item_code || `Item ${selectedEntryRun.item_id}`}
                </div>
                <div className="inline-flex rounded border border-[var(--app-border)] bg-[var(--app-control-bg)] px-2 py-1.5 text-sm font-medium">
                  {entryMode === "drip" ? "Drip" : "Bolus"}
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
                      disabled={selectedEntryRun.kind === "output"}
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

            {entryError ? (
              <div className="text-xs text-red-600 dark:text-red-400">{entryError}</div>
            ) : null}
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

