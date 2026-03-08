import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import type { CaseStatus } from "../api/caseApi";
import TimeAxis from "../components/timeaxis/TimeAxis";
import TimeGrid, {
  type TimeGridEventMarker,
  type TimeGridPreparedMarker,
} from "../components/timegrid/TimeGrid";
import type { TimeGridRow, TimeGridValues } from "../components/timegrid/types";
import TimeChart from "../components/vitals/TimeChart";
import { useTimeAxis } from "../hooks/useTimeAxis";
import { useVitalMinutes } from "../hooks/useVitalMinutes";
import { useCaseEvents } from "../hooks/useCaseEvents";
import type { AuthUser } from "../auth/useAuth";
import type { TimelineChange } from "../api/vitalMinutesApi";
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
  discontinueCaseIoRun,
  deleteCaseIoEvent,
  getCaseIoItems,
  getCaseIoEvents,
  getCaseIoRuns,
  updateCaseIoSegment,
  type CaseIoItem,
  type CaseIoEvent,
  type CaseIoRun,
  type IoKind,
} from "../api/caseIoApi";
import {
  AXIS_STEPS,
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
} from "./caseview/constants";
import {
  getChartVisibilityStorageKey,
  getHiddenRowsStorageKey,
  getTimelineScaleStorageKey,
  getVisibleRowsStorageKey,
  readHiddenRowsForUser,
  readStoredUsername,
  readTimelineScaleForUser,
  readVisibleRowsForUser,
} from "./caseview/storage";
import {
  formatHHMM,
  mergeValues,
  normalizeHHMM,
  toTsOnSameDate,
} from "./caseview/utils";
import {
  formatDateInputDDMMYYYY,
  formatTimeInputHHMM,
  normalizeDateInputDDMMYYYY,
} from "../utils/clinicalInput";
import ConfirmDialog from "../components/common/ConfirmDialog";

type IoPreparedModalState = {
  runId: number;
  itemId: number;
  kind: IoKind;
  itemName: string;
  itemUnit: string;
  ts: number;
};

type IoDripModalState = {
  runId: number;
  segmentId: number;
  itemName: string;
  itemUnit: string;
  ts: number;
};

type IoDripPart = "start" | "mid" | "end" | "single";

type IoGridCellValue = {
  kind: "io_cell";
  amount?: number;
  dripPart?: IoDripPart;
  dripRateMlPerHr?: number;
  dripCarrierMlPerHr?: number;
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

const GE750_AUTOSHOW_ROW_IDS = [
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
  "Spinal",
  "Epidural",
  "PNB",
  "Local infiltration",
  "Caudal",
  "IM",
  "SC",
] as const;

const DEFAULT_CASEVIEW_ROUTE = "IV";

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
  return `aidas.visibleRows.migration.ge750.v2.${username}`;
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

function parsePositiveNumber(raw: string): number | null {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function round4(value: number): number {
  return Math.round(value * 10000) / 10000;
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
        !lower.startsWith("bloodbagno:")
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
  },
): string {
  const { includeBloodMeta, bloodType, bloodGroup, bloodBagNo } = options;
  const parts = [String(baseNote || "").trim()];
  if (includeBloodMeta) {
    if (bloodType) parts.push(`bloodProductType:${bloodType}`);
    if (bloodGroup) parts.push(`bloodGroup:${bloodGroup}`);
    if (bloodBagNo) parts.push(`bloodBagNo:${bloodBagNo}`);
  }
  return parts.filter(Boolean).join(" | ");
}

const BLOOD_GROUP_OPTIONS = ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"] as const;

function quickItemLabel(item: CaseIoItem): string {
  const kindLabel =
    item.kind === "fluid" ? "Fluid" : item.kind === "output" ? "Output" : "Med";
  return `${item.name} (${kindLabel})`;
}

export default function CaseView({
  caseStatus,
  sessionUser,
}: {
  caseStatus: CaseStatus;
  sessionUser: AuthUser | null;
}) {
  const caseId = caseStatus.status !== "IDLE" ? caseStatus.case_id : null;
  const notifyIoAndEventChanged = (targetCaseId: number) => {
    window.dispatchEvent(
      new CustomEvent("aidas:case-io-changed", { detail: { caseId: targetCaseId } }),
    );
    window.dispatchEvent(
      new CustomEvent("aidas:case-events-changed", { detail: { caseId: targetCaseId } }),
    );
  };
  const scopeUsername = sessionUser?.username || readStoredUsername();
  const [axisStepMin, setAxisStepMin] = useState<AxisStepMin>(() =>
    readTimelineScaleForUser(readStoredUsername()),
  );
  const [preferredVisibleRowIds, setPreferredVisibleRowIds] = useState<
    string[] | null
  >(() => readVisibleRowsForUser(readStoredUsername()));
  const [hiddenRowIds, setHiddenRowIds] = useState<string[]>(() =>
    readHiddenRowsForUser(readStoredUsername()),
  );
  const [isIoSectionCollapsed, setIsIoSectionCollapsed] = useState(false);
  const [isVitalSectionCollapsed, setIsVitalSectionCollapsed] = useState(false);
  const [isParamMenuOpen, setIsParamMenuOpen] = useState(false);
  const { axis, loading: axisLoading } = useTimeAxis(caseId, caseStatus.status, axisStepMin);
  const {
    values: liveValues,
    loading: vitalsLoading,
    fetchedAxis: vitalsAxis,
  } = useVitalMinutes(caseId, caseStatus.status, axis);
  const isAxisInSync = useMemo(() => {
    if (axis.length === 0 || vitalsAxis.length === 0) return false;
    if (axis.length !== vitalsAxis.length) return false;
    for (let i = 0; i < axis.length; i += 1) {
      if (axis[i] !== vitalsAxis[i]) return false;
    }
    return true;
  }, [axis, vitalsAxis]);
  const rawTimelineLoading = axisLoading || vitalsLoading || !isAxisInSync;
  const [isTimelineLoading, setIsTimelineLoading] = useState(true);

  useEffect(() => {
    if (rawTimelineLoading) {
      setIsTimelineLoading(true);
      return;
    }
    let rafId: number | null = null;
    const timerId = window.setTimeout(() => {
      rafId = window.requestAnimationFrame(() => {
        setIsTimelineLoading(false);
      });
    }, 120);
    return () => {
      window.clearTimeout(timerId);
      if (rafId != null) {
        window.cancelAnimationFrame(rafId);
      }
    };
  }, [rawTimelineLoading]);

  const caseEvents = useCaseEvents(caseId, caseStatus.status, axis);
  const [caseEventsAll, setCaseEventsAll] = useState<CaseEvent[]>([]);

  const [editValues, setEditValues] = useState<TimeGridValues>({});
  const values = useMemo(
    () => mergeValues(liveValues, editValues),
    [liveValues, editValues],
  );
  const ivyRows = useMemo(() => {
    const rows = new Map<string, TimeGridRow>();

    // 1. Start with the base rows defined in constants
    for (const row of BASE_IVY_ROWS) {
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

    // 3. Force sort the final list to maintain the grouping: Vitals -> Settings -> Measurements
    return Array.from(rows.values()).sort((a, b) => {
      const groupA = getRowGroup(a.id);
      const groupB = getRowGroup(b.id);
      
      const priority = { core: 1, set: 2, measured: 3 };
      if (priority[groupA] !== priority[groupB]) {
        return priority[groupA] - priority[groupB];
      }
      
      // Secondary sort: keep settings together and measurements together
      return 0; 
    });
  }, [values]);
  const hiddenRowIdSet = useMemo(() => new Set(hiddenRowIds), [hiddenRowIds]);
  const visibleIvyRows = useMemo(
    () => ivyRows.filter(row => !hiddenRowIdSet.has(row.id)),
    [ivyRows, hiddenRowIdSet],
  );

  const [nowTs, setNowTs] = useState(() => Date.now());
  const [scrollLeft, setScrollLeft] = useState(0);
  const [viewportWidth, setViewportWidth] = useState(0);
  const [ioRuns, setIoRuns] = useState<CaseIoRun[]>([]);
  const [ioEvents, setIoEvents] = useState<CaseIoEvent[]>([]);
  const [ioPreparedModal, setIoPreparedModal] = useState<IoPreparedModalState | null>(null);
  const [quickIoItems, setQuickIoItems] = useState<CaseIoItem[]>([]);
  const [quickIoSearch, setQuickIoSearch] = useState("");
  const [quickIoRoute, setQuickIoRoute] = useState(DEFAULT_CASEVIEW_ROUTE);
  const [quickIoUnit, setQuickIoUnit] = useState("ml");
  const [quickIoLoading, setQuickIoLoading] = useState(false);
  const [quickIoAdding, setQuickIoAdding] = useState(false);
  const [quickIoError, setQuickIoError] = useState("");
  const [pendingIoRemove, setPendingIoRemove] = useState<{
    runId: number;
    itemName: string;
  } | null>(null);
  const [removingIoRunId, setRemovingIoRunId] = useState<number | null>(null);

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
  const [ioEntryMode, setIoEntryMode] = useState<"basic" | "bulk">("basic");
  const [ioModalValue, setIoModalValue] = useState("");
  const [ioModalDate, setIoModalDate] = useState("");
  const [ioModalTime, setIoModalTime] = useState("");
  const [ioModalUnit, setIoModalUnit] = useState("");
  const [ioModalNote, setIoModalNote] = useState("");
  const [ioModalBloodGroup, setIoModalBloodGroup] = useState("");
  const [ioModalBloodBagNo, setIoModalBloodBagNo] = useState("");
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
  const pendingChangesRef = useRef<Map<string, TimelineChange>>(new Map());
  const saveTimerRef = useRef<number | null>(null);

  useEffect(() => {
    const timer = setInterval(() => {
      setNowTs(Date.now());
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!scrollRef.current || axis.length === 0) return;

    requestAnimationFrame(() => {
      const el = scrollRef.current;
      if (!el) return;
      el.scrollLeft = el.scrollWidth - el.clientWidth;
    });
  }, [axis.length, axisStepMin]);

  useEffect(() => {
    setEditValues({});
  }, [caseId]);

  useEffect(() => {
    pendingChangesRef.current.clear();
    if (saveTimerRef.current != null) {
      window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
  }, [caseId]);

  useEffect(() => {
    setAxisStepMin(prev => {
      const next = readTimelineScaleForUser(scopeUsername);
      return prev === next ? prev : next;
    });
  }, [scopeUsername]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    localStorage.setItem(
      getTimelineScaleStorageKey(scopeUsername),
      String(axisStepMin),
    );
  }, [scopeUsername, axisStepMin]);

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
    setPreferredVisibleRowIds(readVisibleRowsForUser(scopeUsername));
    setHiddenRowIds(prev => {
      const next = readHiddenRowsForUser(scopeUsername);
      if (next.length === prev.length && next.every((v, i) => v === prev[i])) {
        return prev;
      }
      return next;
    });
  }, [scopeUsername]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    localStorage.setItem(
      getHiddenRowsStorageKey(scopeUsername),
      JSON.stringify(hiddenRowIds),
    );
  }, [scopeUsername, hiddenRowIds]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!preferredVisibleRowIds) {
      localStorage.removeItem(getVisibleRowsStorageKey(scopeUsername));
      return;
    }
    localStorage.setItem(
      getVisibleRowsStorageKey(scopeUsername),
      JSON.stringify(preferredVisibleRowIds),
    );
  }, [preferredVisibleRowIds, scopeUsername]);

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
        console.error("[CaseView] case event list load failed", err);
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
    window.addEventListener("aidas:case-events-changed", onEventsChanged);

    return () => {
      alive = false;
      clearInterval(timer);
      window.removeEventListener("aidas:case-events-changed", onEventsChanged);
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
        console.error("[CaseView] io run load failed", err);
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
    window.addEventListener("aidas:case-io-changed", onIoChanged);

    return () => {
      alive = false;
      clearInterval(timer);
      window.removeEventListener("aidas:case-io-changed", onIoChanged);
    };
  }, [caseId, caseStatus]);

  useEffect(() => {
    if (caseId == null || caseStatus.status === "IDLE") {
      setQuickIoItems([]);
      setQuickIoSearch("");
      setQuickIoError("");
      return;
    }

    let alive = true;
    setQuickIoLoading(true);
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
        setQuickIoSearch("");
        setQuickIoError(
          err instanceof Error ? err.message : "Failed to load items",
        );
      })
      .finally(() => {
        if (!alive) return;
        setQuickIoLoading(false);
      });

    return () => {
      alive = false;
    };
  }, [caseId, caseStatus.status]);

  const preparedRuns = useMemo(
    () =>
      ioRuns.filter(run => {
        if (run.stopped_at == null) return true;
        return run.stopped_at > nowTs;
      }),
    [ioRuns, nowTs],
  );

  const sortedPreparedRuns = useMemo(() => {
    const runName = (run: CaseIoRun) =>
      String(run.item_name || run.item_code || `item ${run.item_id}`).trim();
    const byName = (a: CaseIoRun, b: CaseIoRun) => {
      const nameCmp = runName(a).localeCompare(runName(b), undefined, {
        sensitivity: "base",
      });
      if (nameCmp !== 0) return nameCmp;
      return a.id - b.id;
    };

    const intake = preparedRuns
      .filter(run => run.kind !== "output")
      .sort(byName);
    const output = preparedRuns
      .filter(run => run.kind === "output")
      .sort(byName);

    return [...intake, ...output];
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
      map.set(`io_run_${run.id}`, run);
    }
    return map;
  }, [sortedPreparedRuns]);

  const ioPreparedRows = useMemo<TimeGridRow[]>(
    () =>
      sortedPreparedRuns.map(run => ({
        id: `io_run_${run.id}`,
        label: run.item_name || run.item_code || `Item ${run.item_id}`,
        type: "io",
        unit: run.kind === "med" ? run.item_unit || "mg" : "mL",
      })),
    [sortedPreparedRuns],
  );

  const ioRowsWithHeader = useMemo<TimeGridRow[]>(
    () => [
      { id: "__io_header__", label: "Fluid&Med", type: "event" },
      ...ioPreparedRows,
      { id: "__vital_agent_header__", label: "Vital&Agent", type: "event" },
    ],
    [ioPreparedRows],
  );
  const rowsAfterEvent = useMemo(
    () => ioRowsWithHeader,
    [ioRowsWithHeader],
  );

  const ioPreparedMarkersByTs = useMemo<Record<number, TimeGridPreparedMarker[]>>(() => {
    if (axis.length === 0 || sortedPreparedRuns.length === 0) return {};
    const stepMs = axis.length > 1 ? Math.max(1, axis[1] - axis[0]) : 60_000;
    const next: Record<number, TimeGridPreparedMarker[]> = {};
    for (const ts of axis) next[ts] = [];

    const isDripRun = (run: CaseIoRun) => {
      const hasDripSegment =
        Array.isArray(run.segments) &&
        run.segments.some(segment => {
          const rate = Number(segment.rate_value);
          const dose = Number(segment.dose_value);
          return (Number.isFinite(rate) && rate > 0) || (Number.isFinite(dose) && dose > 0);
        });
      const byNote = /drip/i.test(String(run.note || ""));
      return hasDripSegment || byNote;
    };
    const isSegmentActiveInBucket = (
      run: CaseIoRun,
      bucketStart: number,
      bucketEnd: number,
    ) =>
      Array.isArray(run.segments) &&
      run.segments.some(segment => {
        if (segment.include_in_balance === 0) return false;
        const hasValue =
          (Number.isFinite(Number(segment.rate_value)) &&
            Number(segment.rate_value) > 0) ||
          (Number.isFinite(Number(segment.dose_value)) &&
            Number(segment.dose_value) > 0) ||
          (Number.isFinite(Number(segment.carrier_ml_per_hr)) &&
            Number(segment.carrier_ml_per_hr) > 0);
        if (!hasValue) return false;
        const segStart = Number(segment.ts_from);
        const segEnd = Number.isFinite(Number(segment.ts_to))
          ? Number(segment.ts_to)
          : run.stopped_at == null
            ? Infinity
            : Number(run.stopped_at);
        return segStart < bucketEnd && segEnd > bucketStart;
      });

    const runMap = new Map<string, CaseIoRun[]>();
    for (const run of sortedPreparedRuns) {
      const key = `${run.kind}:${run.item_id}`;
      const list = runMap.get(key) || [];
      list.push(run);
      runMap.set(key, list);
    }

    const findRunForEvent = (event: CaseIoEvent) => {
      const key = `${event.kind}:${event.item_id}`;
      const rows = runMap.get(key) || [];
      if (rows.length === 0) return null;
      const matched = rows.filter(run => {
        const start = Number(run.started_at);
        const end = run.stopped_at == null ? Infinity : Number(run.stopped_at);
        return event.event_ts >= start && event.event_ts <= end;
      });
      return (matched[0] || rows[0] || null);
    };

    for (const ts of axis) {
      const bucketStart = ts;
      const bucketEnd = ts + stepMs;
      const bucketEvents = ioEvents.filter(event => {
        if (event.event_ts < bucketStart || event.event_ts >= bucketEnd) return false;
        if (event.include_in_balance === 0) return false;
        const amount =
          event.kind === "med" ? Number(event.dose_value) : Number(event.volume_ml);
        if (!Number.isFinite(amount) || amount <= 0) return false;
        return findRunForEvent(event) != null;
      });
      const intakeEvent = bucketEvents.find(event => event.kind !== "output");
      const outputEvent = bucketEvents.find(event => event.kind === "output");
      const dripEvent = bucketEvents.find(event => {
        const run = findRunForEvent(event);
        return run ? isDripRun(run) : false;
      });
      const dripRunFromSegment = sortedPreparedRuns.find(run =>
        isSegmentActiveInBucket(run, bucketStart, bucketEnd),
      );

      if (intakeEvent) {
        const intakeRun = findRunForEvent(intakeEvent);
        if (intakeRun) {
          next[ts].push({
            run_id: intakeRun.id,
            item_id: intakeRun.item_id,
            kind: intakeRun.kind,
            item_name: "Intake",
            marker_code: "i",
            marker_label: "B",
          });
        }
      }

      if (outputEvent) {
        const outputRun = findRunForEvent(outputEvent);
        if (outputRun) {
          next[ts].push({
            run_id: outputRun.id,
            item_id: outputRun.item_id,
            kind: outputRun.kind,
            item_name: "Output",
            marker_code: "o",
            marker_label: "O",
          });
        }
      }

      if (dripEvent) {
        const dripRun = findRunForEvent(dripEvent);
        if (dripRun) {
          next[ts].push({
            run_id: dripRun.id,
            item_id: dripRun.item_id,
            kind: dripRun.kind,
            item_name: "Drip",
            marker_code: "d",
            marker_label: "D",
          });
        }
      } else if (dripRunFromSegment) {
        next[ts].push({
          run_id: dripRunFromSegment.id,
          item_id: dripRunFromSegment.item_id,
          kind: dripRunFromSegment.kind,
          item_name: "Drip",
          marker_code: "d",
          marker_label: "D",
        });
      }
    }

    return next;
  }, [axis, ioEvents, sortedPreparedRuns]);

  const ioGridValues = useMemo<TimeGridValues>(() => {
    if (axis.length === 0 || sortedPreparedRuns.length === 0) return {};
    const stepMs = axis.length > 1 ? Math.max(1, axis[1] - axis[0]) : 60_000;
    const startTs = axis[0];
    const endExclusiveTs = axis[axis.length - 1] + stepMs;
    const next: TimeGridValues = {};
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
      const rowId = `io_run_${run.id}`;
      next[rowId] = {};
    }

    for (const run of sortedPreparedRuns) {
      const rowId = `io_run_${run.id}`;
      const segments = Array.isArray(run.segments) ? run.segments : [];
      for (const segment of segments) {
        if (segment.include_in_balance === 0) continue;
        const segStartRaw = Number(segment.ts_from);
        if (!Number.isFinite(segStartRaw)) continue;
        const segEndRaw = Number.isFinite(Number(segment.ts_to))
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
          (rateMlPerHr != null && rateMlPerHr > 0) || normalizedCarrierMlPerHr > 0;

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
            if (rateMlPerHr != null && rateMlPerHr > 0) cell.dripRateMlPerHr = rateMlPerHr;
            if (normalizedCarrierMlPerHr > 0) cell.dripCarrierMlPerHr = normalizedCarrierMlPerHr;
            cell.segmentId = segment.id;
            cell.segmentTsFrom = Number(segment.ts_from);
            cell.segmentTsTo = segment.ts_to == null ? null : Number(segment.ts_to);
            cell.segmentDoseValue = segment.dose_value == null ? null : Number(segment.dose_value);
            cell.segmentDoseUnit = segment.dose_unit ?? null;
            cell.segmentRateUnit = segment.rate_unit ?? null;
            cell.segmentNote = segment.note ?? null;
            
            if (dripPart === "start" || dripPart === "single") {
              cell.amount = Number(((cell.amount ?? 0) + amount).toFixed(2));
            }
          } else {
            cell.amount = Number(((cell.amount ?? 0) + amount).toFixed(2));
          }

          // For drip segments, we don't necessarily show individual minutes unless they are discrete events
          // but we can add the bucket total if requested. For now focusing on event-based minute values below.
        }
      }
    }

    for (const event of ioEvents) {
      if (event.event_ts < startTs || event.event_ts >= endExclusiveTs) continue;
      const index = Math.floor((event.event_ts - startTs) / stepMs);
      if (index < 0 || index >= axis.length) continue;
      const bucketTs = axis[index];

      const matchingRuns = sortedPreparedRuns.filter(
        run => run.item_id === event.item_id && run.kind === event.kind,
      );
      if (matchingRuns.length === 0) continue;

      const amount = event.kind === "med" ? Number(event.dose_value) : Number(event.volume_ml);
      if (!Number.isFinite(amount) || amount <= 0) continue;

      const chosen = [...matchingRuns].sort((a, b) => b.id - a.id)[0];
      const rowId = `io_run_${chosen.id}`;
      const cell = ensureIoCell(rowId, bucketTs);
      
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
  }, [axis, ioEvents, sortedPreparedRuns]);
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
  const modalRequiresBloodGroup = isModalBloodProduct && (modalBloodType === "PRC" || modalBloodType === "FFP");

  const actor = {
    username: sessionUser?.username || "unknown",
    name: sessionUser?.name,
    role: sessionUser?.role,
  };

  const quickIoMatches = useMemo(() => {
    const keyword = quickIoSearch.trim().toLowerCase();
    if (!keyword) return quickIoItems.slice(0, 30);
    return quickIoItems
      .filter(item => quickItemLabel(item).toLowerCase().includes(keyword))
      .slice(0, 30);
  }, [quickIoItems, quickIoSearch]);

  const selectedQuickIoItem = useMemo(() => {
    const keyword = quickIoSearch.trim().toLowerCase();
    if (!keyword) return null;
    const byFullLabel = quickIoItems.find(
      item => quickItemLabel(item).toLowerCase() === keyword,
    );
    if (byFullLabel) return byFullLabel;
    const byName = quickIoItems.find(
      item => item.name.trim().toLowerCase() === keyword,
    );
    if (byName) return byName;
    return (
      quickIoItems.find(item => item.name.trim().toLowerCase().includes(keyword)) ||
      null
    );
  }, [quickIoItems, quickIoSearch]);

  const quickIoRouteEnabled = selectedQuickIoItem?.kind !== "output";

  useEffect(() => {
    if (!selectedQuickIoItem) return;
    const defaultUnit = String(selectedQuickIoItem.default_unit || "").trim();
    setQuickIoUnit(defaultUnit || (selectedQuickIoItem.kind === "med" ? "mg" : "ml"));
    if (selectedQuickIoItem.kind === "output") {
      setQuickIoRoute("");
      return;
    }
    setQuickIoRoute(prev => prev || DEFAULT_CASEVIEW_ROUTE);
  }, [selectedQuickIoItem?.id]);

  useEffect(() => {
    if (!isModalBloodProduct) return;
    if (ioEntryMode !== "basic") {
      setIoEntryMode("basic");
    }
  }, [isModalBloodProduct, ioEntryMode]);

  const quickIoCanAdd =
    caseId != null &&
    caseStatus.status !== "IDLE" &&
    !quickIoAdding &&
    !quickIoLoading &&
    selectedQuickIoItem != null;

  const addQuickIoRun = async () => {
    if (caseId == null || caseStatus.status === "IDLE") return;
    if (!selectedQuickIoItem) {
      setQuickIoError("Select item first");
      return;
    }

    setQuickIoAdding(true);
    setQuickIoError("");
    try {
      const defaultUnit = String(selectedQuickIoItem.default_unit || "").trim();
      const normalizedUnit = quickIoUnit.trim();
      const noteWithUom =
        normalizedUnit && normalizedUnit !== defaultUnit
          ? `uom:${normalizedUnit}`
          : undefined;
      await createCaseIoRun(caseId, {
        item_id: Number(selectedQuickIoItem.id),
        kind: selectedQuickIoItem.kind as IoKind,
        route: quickIoRouteEnabled
          ? quickIoRoute.trim() || DEFAULT_CASEVIEW_ROUTE
          : undefined,
        started_at: caseStatus.start_time,
        include_in_balance: true,
        note: noteWithUom,
        reason: "caseview quick add io item",
        actor,
      });
      setQuickIoSearch("");
      notifyIoAndEventChanged(caseId);
    } catch (err) {
      setQuickIoError(
        err instanceof Error ? err.message : "Failed to add item",
      );
    } finally {
      setQuickIoAdding(false);
    }
  };

  const confirmRemoveIoRun = async () => {
    if (!pendingIoRemove) return;
    if (caseId == null) return;
    const { runId } = pendingIoRemove;
    setRemovingIoRunId(runId);
    setQuickIoError("");
    try {
      await discontinueCaseIoRun(caseId, runId, {
        stopped_at: Date.now(),
        reason: "caseview remove io row",
        actor,
      });
      notifyIoAndEventChanged(caseId);
      setPendingIoRemove(null);
    } catch (err) {
      setQuickIoError(
        err instanceof Error ? err.message : "Failed to remove item",
      );
    } finally {
      setRemovingIoRunId(null);
    }
  };

  const valueTypeForRow = (rowId: string) =>
    rowId === "ecg" ? "code" : "number";

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
        "caseview manual edit",
      );
    } catch (err) {
      console.error("[CaseView] timeline save failed", err);
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
        value_type: valueTypeForRow(rowId),
        source: sourceForRow(rowId),
        action: "upsert",
      });
    }
    scheduleFlush();

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

  const toggleRowVisibility = (rowId: string) => {
    setHiddenRowIds(prev => {
      const next = prev.includes(rowId)
        ? prev.filter(id => id !== rowId)
        : [...prev, rowId];
      const nextSet = new Set(next);
      const visibleIds = ivyRows
        .filter(row => !nextSet.has(row.id))
        .map(row => row.id);
      setPreferredVisibleRowIds(visibleIds);
      return next;
    });
  };

  const applyVisibilityPreset = (group: "all" | RowGroup) => {
    if (group === "all") {
      setHiddenRowIds([]);
      setPreferredVisibleRowIds(ivyRows.map(row => row.id));
      return;
    }

    const nextHidden: string[] = [];
    const nextVisible: string[] = [];
    for (const row of ivyRows) {
      if (getRowGroup(row.id) !== group) {
        nextHidden.push(row.id);
      } else {
        nextVisible.push(row.id);
      }
    }
    setHiddenRowIds(nextHidden);
    setPreferredVisibleRowIds(nextVisible);
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

  const openEventModalForMarker = (marker: TimeGridEventMarker) => {
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
      if (eventModalEditingId != null) {
        await updateCaseEvent(caseId, eventModalEditingId, {
          event_ts: editedTs,
          event_type: eventModalMode,
          title,
          detail: eventModalDetail.trim() || undefined,
          actor,
          reason: "caseview timeline event edit modal",
        });
      } else {
        await createCaseEvent(caseId, {
          event_ts: editedTs,
          event_type: eventModalMode,
          title,
          detail: eventModalDetail.trim() || undefined,
          actor,
          reason: "caseview timeline event modal",
        });
      }
      window.dispatchEvent(
        new CustomEvent("aidas:case-events-changed", { detail: { caseId } }),
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
        "caseview timeline event clear modal",
      );
      window.dispatchEvent(
        new CustomEvent("aidas:case-events-changed", { detail: { caseId } }),
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
    const existingNote =
      [...existing]
        .reverse()
        .map(event => String(event.note || "").trim())
        .find(Boolean) || "";
    const parsedExistingNote = parseKeyValueFromNote(existingNote);
    const resolvedBloodType = resolveBloodProductEntryType(run);
    const runIsBloodProduct = isBloodProductRun(run);

    setIoPreparedModal({
      runId: run.id,
      itemId: run.item_id,
      kind: run.kind,
      itemName,
      itemUnit,
      ts,
    });
    setIoEntryMode("basic");
    setIoModalValue(existingValue > 0 ? String(existingValue) : "");
    setIoModalDate(formatDDMMYYYY(firstEventTs));
    setIoModalTime(formatHHMM(firstEventTs));
    setIoModalUnit(itemUnit);
    setIoModalNote(runIsBloodProduct ? sanitizeBloodProductNote(existingNote) : existingNote);
    setIoModalBloodGroup(
      runIsBloodProduct && (resolvedBloodType === "PRC" || resolvedBloodType === "FFP")
        ? String(parsedExistingNote.bloodGroup || "").toUpperCase()
        : "",
    );
    setIoModalBloodBagNo(
      runIsBloodProduct ? String(parsedExistingNote.bloodBagNo || "").trim() : "",
    );
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
    setIoDripError("");
  };

  const handlePreparedMarkerClick = (
    ts: number,
    marker: TimeGridPreparedMarker,
  ) => {
    const run = preparedRunById.get(marker.run_id);
    if (!run) return;
    if (marker.marker_code === "d") {
      const segment = findDripSegmentAtTs(run, ts);
      if (segment) {
        openIoDripModalForSegment(run, segment, ts);
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
      const segment = (Array.isArray(run.segments) ? run.segments : []).find(
        row => row.id === rawCell.segmentId,
      );
      if (segment) {
        openIoDripModalForSegment(run, segment, ts);
        return;
      }
    }
    setIoDripModal(null);
    openIoModalForRunAtTs(run, ts);
  };

  const closeIoModal = () => {
    if (ioModalSaving) return;
    setIoPreparedModal(null);
    setIoModalDate("");
    setIoModalTime("");
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
    setIoDripError("");
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

  const openBolusFromDripModal = () => {
    if (!ioDripModal) return;
    const run = ioRuns.find(row => row.id === ioDripModal.runId);
    if (!run) return;
    setIoDripModal(null);
    openIoModalForRunAtTs(run, ioDripModal.ts);
  };

  const saveIoDripModal = async () => {
    if (!caseId || !ioDripModal) return;

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
    const hasAnyValue =
      (rateValue != null && rateValue > 0) ||
      (doseValue != null && doseValue > 0) ||
      (carrierValue != null && carrierValue > 0);
    if (!hasAnyValue) {
      setIoDripError("Need at least one value: rate, dose, or carrier");
      return;
    }

    setIoDripSaving(true);
    setIoDripError("");
    try {
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
      await updateCaseIoSegment(caseId, ioDripModal.segmentId, {
        ts_from: startTs,
        ts_to: endTs,
        rate_value: rateValue,
        rate_unit: ioDripRateUnit.trim() || "ml/hr",
        dose_value: doseValue,
        dose_unit:
          doseValue != null ? ioDripDoseUnit.trim() || ioDripModal.itemUnit : null,
        carrier_ml_per_hr: carrierValue,
        note: noteParts.filter(Boolean).join(" | ") || null,
        include_in_balance: true,
        reason: "caseview edit drip segment",
        actor,
      });
      notifyIoAndEventChanged(caseId);
      setIoDripModal(null);
    } catch (err) {
      setIoDripError(err instanceof Error ? err.message : "Failed to save drip");
    } finally {
      setIoDripSaving(false);
    }
  };

  const bucketMinutes = useMemo(() => {
    if (!ioPreparedModal) return [];
    const mins: number[] = [];
    // We use a fixed step from the modal state if possible, or axisStepMin if not
    // But once open, it should ideally stay the same size.
    for (let i = 0; i < axisStepMin; i++) {
      mins.push(ioPreparedModal.ts + i * 60_000);
    }
    return mins;
  }, [ioPreparedModal?.ts, ioPreparedModal?.runId, axisStepMin]);

  const [bucketValues, setBucketValues] = useState<Record<number, string>>({});
  const [bucketNotes, setBucketNotes] = useState<Record<number, string>>({});
  const lastModalRef = useRef<string>("");

  useEffect(() => {
    if (!ioPreparedModal) {
      lastModalRef.current = "";
      return;
    }
    
    const modalKey = `${ioPreparedModal.runId}-${ioPreparedModal.ts}`;
    if (lastModalRef.current === modalKey) return;
    lastModalRef.current = modalKey;

    const vals: Record<number, string> = {};
    const notes: Record<number, string> = {};
    for (const event of modalExistingEvents) {
      const amount = ioPreparedModal.kind === "med" ? event.dose_value : event.volume_ml;
      vals[event.event_ts] = String(amount || "");
      notes[event.event_ts] = isModalBloodProduct
        ? sanitizeBloodProductNote(String(event.note || ""))
        : (event.note || "");
    }
    setBucketValues(vals);
    setBucketNotes(notes);
  }, [ioPreparedModal, modalExistingEvents, isModalBloodProduct]);

  const savePreparedValue = async () => {
    if (!caseId || !ioPreparedModal || !modalRun) return;

    const bloodGroup = ioModalBloodGroup.trim().toUpperCase();
    const bloodBagNo = ioModalBloodBagNo.trim();
    if (isModalBloodProduct) {
      if (!bloodBagNo) {
        setIoModalError("Blood bag no. is required for blood product");
        return;
      }
      if (modalRequiresBloodGroup && !bloodGroup) {
        setIoModalError("Blood group is required for PRC/FFP");
        return;
      }
    }

    setIoModalSaving(true);
    setIoModalError("");
    try {
      const promises: Promise<any>[] = [];

      if (ioEntryMode === "basic") {
        // Basic Mode: Single point in time (can be custom time)
        const editedTs = toTsFromDateAndTime(ioModalDate, ioModalTime);
        if (editedTs == null) {
          setIoModalError("Time must be HH:mm (24-hour) and Date must be dd/mm/yyyy");
          setIoModalSaving(false);
          return;
        }

        const newValue = parseFloat(ioModalValue);
        const newNote = ioModalNote.trim();
        const finalNote = buildIoEntryNote(newNote, {
          includeBloodMeta: isModalBloodProduct,
          bloodType: modalBloodType,
          bloodGroup,
          bloodBagNo,
        });

        // Find existing event at this exact time (or clear others in bucket?)
        // To keep it simple: Basic mode replaces/creates at the exact time entered.
        // We delete any existing events in this run at this exact timestamp if they exist.
        const existingExact = ioEvents.find(e => e.item_id === modalRun.item_id && e.kind === modalRun.kind && e.event_ts === editedTs);
        
        if (existingExact) {
          promises.push(deleteCaseIoEvent(caseId, existingExact.id, actor, "basic update clear"));
        }

        if (!Number.isNaN(newValue) && newValue > 0) {
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
        }
      } else {
        // Bulk Mode: Timeline-aligned buckets
        for (const ts of bucketMinutes) {
          const newValueStr = bucketValues[ts] || "";
          const newValue = parseFloat(newValueStr);
          const newNote = (bucketNotes[ts] || "").trim();
          const finalNote = buildIoEntryNote(newNote, {
            includeBloodMeta: isModalBloodProduct,
            bloodType: modalBloodType,
            bloodGroup,
            bloodBagNo,
          });
          
          const existing = modalExistingEvents.find(e => e.event_ts === ts);
          const existingValue = existing ? (ioPreparedModal.kind === "med" ? existing.dose_value : existing.volume_ml) : null;
          const existingNote = existing ? (existing.note || "") : "";

          const hasChanged = 
            (existingValue !== (Number.isNaN(newValue) || newValue <= 0 ? null : newValue)) ||
            (existingNote !== finalNote);

          if (!hasChanged) continue;

          // If it existed, we delete it first to replace or clear
          if (existing) {
            promises.push(deleteCaseIoEvent(caseId, existing.id, actor, "bucket update clear"));
          }

          // If new value is valid and > 0, create new event
          if (!Number.isNaN(newValue) && newValue > 0) {
            if (ioPreparedModal.kind === "med") {
              promises.push(createCaseIoEvent(caseId, {
                item_id: ioPreparedModal.itemId,
                kind: "med",
                event_ts: ts,
                dose_value: newValue,
                dose_unit: ioModalUnit.trim() || ioPreparedModal.itemUnit || "mg",
                note: finalNote || undefined,
                include_in_balance: true,
                reason: "timegrid bucket save",
                actor,
              }));
            } else {
              promises.push(createCaseIoEvent(caseId, {
                item_id: ioPreparedModal.itemId,
                kind: ioPreparedModal.kind,
                event_ts: ts,
                volume_ml: newValue,
                note: finalNote || undefined,
                include_in_balance: true,
                reason: "timegrid bucket save",
                actor,
              }));
            }
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
    if (e.key !== "Enter" || e.shiftKey || ioModalSaving) return;
    const target = e.target as HTMLElement | null;
    if (target?.tagName === "TEXTAREA") return;
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

  if (caseStatus.status === "IDLE") {
    return <div className="p-6 text-gray-400">No active case</div>;
  }

  return (
    <div className="relative h-full min-h-0 p-2 bg-gray-50 dark:bg-gray-900 flex flex-col">
      <div className="mb-2 flex items-center gap-2 text-xs text-gray-700 dark:text-gray-300">
        <span>Timeline scale:</span>
        <select
          className="rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-950 px-2 py-1"
          value={axisStepMin}
          onChange={e => setAxisStepMin(Number(e.target.value) as AxisStepMin)}
        >
          {AXIS_STEPS.map(step => (
            <option key={step} value={step}>
              {step} min
            </option>
          ))}
        </select>

        <div className="relative">
          <button
            type="button"
            onClick={() => setIsParamMenuOpen(prev => !prev)}
            className="rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-950 px-2 py-1 text-xs"
          >
            Parameters ({visibleIvyRows.length})
          </button>

          {isParamMenuOpen ? (
            <div className="absolute left-0 z-40 mt-1 w-72 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-950 p-2 shadow-lg">
              <div className="mb-2 flex flex-wrap gap-1">
                <button
                  type="button"
                  onClick={() => applyVisibilityPreset("all")}
                  className="rounded border border-gray-300 dark:border-gray-700 px-2 py-0.5 text-[10px]"
                >
                  All
                </button>
                <button
                  type="button"
                  onClick={() => applyVisibilityPreset("core")}
                  className="rounded border border-gray-300 dark:border-gray-700 px-2 py-0.5 text-[10px]"
                >
                  Vital
                </button>
                <button
                  type="button"
                  onClick={() => applyVisibilityPreset("measured")}
                  className="rounded border border-gray-300 dark:border-gray-700 px-2 py-0.5 text-[10px]"
                >
                  Measured
                </button>
                <button
                  type="button"
                  onClick={() => applyVisibilityPreset("set")}
                  className="rounded border border-gray-300 dark:border-gray-700 px-2 py-0.5 text-[10px]"
                >
                  Set
                </button>
              </div>

              <div className="max-h-60 overflow-y-auto space-y-1">
                {ivyRows.map(row => {
                  const checked = !hiddenRowIdSet.has(row.id);
                  const rowGroup = getRowGroup(row.id);
                  const rowBadgeClass =
                    rowGroup === "set"
                      ? "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300"
                      : "bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300";
                  return (
                    <label key={row.id} className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleRowVisibility(row.id)}
                      />
                      {rowGroup !== "core" ? (
                        <span
                          className={`inline-flex h-3 min-w-3 items-center justify-center rounded px-[2px] text-[8px] leading-none font-semibold ${rowBadgeClass}`}
                        >
                          {rowGroup === "set" ? "S" : "M"}
                        </span>
                      ) : null}
                      <span className="truncate">{row.label}</span>
                      {row.unit ? (
                        <span className="shrink-0 text-[10px] text-gray-500 dark:text-gray-400">
                          ({row.unit})
                        </span>
                      ) : null}
                    </label>
                  );
                })}
              </div>
            </div>
          ) : null}
        </div>

        <div className="ml-auto flex items-center gap-1.5 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-950 px-1.5 py-1">
          <span className="inline-flex items-center gap-1 text-[11px] font-medium">
            <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" aria-hidden="true">
              <path
                d="M6 3h8v3H6zM5 6h10l-1 8H6zM15 9h4v11h-4M8 10h4"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            <span>Fluid&Med</span>
          </span>
          <input
            list="caseview-io-item-options"
            className="caseview-io-item-input min-w-[220px] rounded border border-[var(--app-border)] bg-[var(--app-control-bg)] text-[var(--app-text)] placeholder:text-[var(--app-muted)] px-2 py-1"
            value={quickIoSearch}
            onChange={e => setQuickIoSearch(e.target.value)}
            placeholder={quickIoLoading ? "Loading items..." : "Search item"}
            disabled={quickIoLoading || quickIoItems.length === 0}
            autoComplete="off"
          />
          <datalist id="caseview-io-item-options">
            {quickIoMatches.map(item => (
              <option key={item.id} value={quickItemLabel(item)} />
            ))}
          </datalist>
          <select
            className="min-w-[96px] rounded border border-[var(--app-border)] bg-[var(--app-control-bg)] text-[var(--app-text)] px-1.5 py-1 disabled:opacity-60"
            value={quickIoRoute}
            onChange={e => setQuickIoRoute(e.target.value)}
            disabled={!quickIoRouteEnabled}
          >
            <option value="">-</option>
            {CASEVIEW_ROUTE_OPTIONS.map(route => (
              <option key={route} value={route}>
                {route}
              </option>
            ))}
          </select>
          <select
            className="min-w-[72px] rounded border border-[var(--app-border)] bg-[var(--app-control-bg)] text-[var(--app-text)] px-1.5 py-1"
            value={quickIoUnit}
            onChange={e => setQuickIoUnit(e.target.value)}
          >
            {CASEVIEW_UOM_OPTIONS.map(unit => (
              <option key={unit} value={unit}>
                {unit}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => void addQuickIoRun()}
            disabled={!quickIoCanAdd}
            className={`rounded px-2 py-1 text-[11px] text-white ${
              quickIoCanAdd ? "bg-blue-600 hover:bg-blue-700" : "bg-gray-400"
            }`}
          >
            {quickIoAdding ? "Adding..." : "Add"}
          </button>
        </div>

        {quickIoError ? (
          <div className="w-full text-xs text-red-600 dark:text-red-400">
            {quickIoError}
          </div>
        ) : null}
      </div>

      <div
        ref={scrollRef}
        onScroll={e => setScrollLeft(e.currentTarget.scrollLeft)}
        className="
          flex-1 min-h-0
          overflow-x-auto overflow-y-hidden
          scrollbar-thin
          scrollbar-thumb-gray-400/40
          scrollbar-track-transparent
        "
      >
        <div className="min-w-max h-full flex flex-col">
          <TimeAxis axis={axis} nowTs={nowTs} scrollLeft={scrollLeft} viewportWidth={viewportWidth} />
          <TimeChart
            axis={axis}
            values={values}
            nowTs={nowTs}
            storageKey={getChartVisibilityStorageKey(scopeUsername)}
            scrollLeft={scrollLeft}
            viewportWidth={viewportWidth}
          />
          <div className="flex-1 min-h-0 overflow-y-auto">
            <TimeGrid
              columns={axis}
              ivyRows={visibleIvyRows}
              rowsAfterEvent={rowsAfterEvent}
              values={combinedGridValues}
              eventMarkersByTs={eventMarkersByTs}
              preparedMarkersByTs={ioPreparedMarkersByTs}
              nowTs={nowTs}
              scrollLeft={scrollLeft}
              viewportWidth={viewportWidth}
              onChange={handleCellChange}
              onIoCellClick={handleIoCellClick}
              onPreparedMarkerClick={handlePreparedMarkerClick}
              onIoRowRemove={rowId => {
                const run = ioRunByRowId.get(rowId);
                if (!run) return;
                const runName = run.item_name || run.item_code || `Item ${run.item_id}`;
                setPendingIoRemove({ runId: run.id, itemName: runName });
              }}
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
          </div>
        </div>
      </div>

      {eventModalTs != null && typeof document !== "undefined"
        ? createPortal(
            <div
              className="app-theme-scope fixed inset-0 z-[1000] flex items-center justify-center bg-black/35 px-3"
              onMouseDown={closeEventModal}
            >
              <div
                className="w-full max-w-2xl rounded-lg border border-[var(--app-border)] bg-[var(--app-panel-bg)] text-[var(--app-text)] p-3 space-y-2 backdrop-blur"
                onMouseDown={e => e.stopPropagation()}
              >
                <div className="text-sm font-semibold">
                  {eventModalEditingId != null ? "Edit Event / Note" : "Event / Note"}
                </div>
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
                            ? "bg-blue-600 text-white"
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
                            ? "bg-blue-600 text-white"
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
                      <div className="grid grid-cols-5 gap-2">
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
                                  ? "border-blue-500 bg-blue-50 text-blue-700 dark:border-blue-400 dark:bg-blue-900/35 dark:text-blue-200"
                                  : "border-[var(--app-border)] bg-[var(--app-control-bg)] text-[var(--app-text)]"
                              } ${disabled ? "opacity-50 cursor-not-allowed" : "hover:bg-[var(--app-control-bg-hover)]"}`}
                              title={option.title}
                            >
                              <div className="mx-auto mb-1 flex h-5 w-5 items-center justify-center">
                                <OptionIcon className="h-5 w-5" />
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
                <div className="flex justify-end gap-2">
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
            </div>,
            document.body,
          )
        : null}

      {ioDripModal && typeof document !== "undefined"
        ? createPortal(
            <div
              className="app-theme-scope fixed inset-0 z-[1000] flex items-center justify-center bg-black/35 px-3"
              onMouseDown={closeIoDripModal}
            >
              <div
                className="w-full max-w-2xl rounded-xl border border-[var(--app-border)] bg-[var(--app-panel-bg)] text-[var(--app-text)] p-3 space-y-2 shadow-2xl backdrop-blur"
                onMouseDown={e => e.stopPropagation()}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="space-y-1">
                    <div className="text-sm font-semibold leading-none">Edit Drip</div>
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
                    />
                  </div>
                  <div className="grid grid-cols-[110px_1fr_120px] gap-2 items-center">
                    <label className="text-[var(--app-muted)]">End</label>
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
                    <input
                      value={ioDripEndTime}
                      onChange={e => setIoDripEndTime(formatTimeInputHHMM(e.target.value))}
                      onBlur={e => {
                        const normalized = normalizeHHMM(e.target.value);
                        if (normalized) setIoDripEndTime(normalized);
                      }}
                      className="rounded border px-2 py-1.5"
                      placeholder="HH:mm"
                      maxLength={5}
                    />
                  </div>
                  <div className="grid grid-cols-[110px_1fr_120px] gap-2 items-center">
                    <label className="text-[var(--app-muted)]">Rate</label>
                    <input
                      type="number"
                      min="0"
                      step="0.0001"
                      value={ioDripRateValue}
                      onChange={e => setIoDripRateValue(e.target.value)}
                      className="rounded border px-2 py-1.5"
                      placeholder="Rate"
                    />
                    <input
                      value={ioDripRateUnit}
                      onChange={e => setIoDripRateUnit(e.target.value)}
                      className="rounded border px-2 py-1.5"
                      placeholder="ml/hr"
                    />
                  </div>
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
                        <option key={`caseview-dose-unit-${unit}`} value={unit}>
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
                      className="rounded border px-2 py-1.5"
                      placeholder="Optional note"
                    />
                    <div className="rounded border border-[var(--app-border)] bg-[var(--app-control-bg)] px-2 py-1.5 text-[var(--app-muted)]">
                      Drip
                    </div>
                  </div>
                </div>

                {ioDripError ? (
                  <div className="text-xs text-red-600 dark:text-red-400">{ioDripError}</div>
                ) : null}

                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={openBolusFromDripModal}
                    className="rounded border px-3 py-1.5 text-sm border-cyan-300/50 text-cyan-100 hover:bg-cyan-500/10"
                    disabled={ioDripSaving}
                  >
                    Bolus At This Time
                  </button>
                  <button
                    type="button"
                    onClick={calculateIoDrip}
                    className="rounded border px-3 py-1.5 text-sm border-emerald-300/50 text-emerald-100 hover:bg-emerald-500/10"
                    disabled={ioDripSaving}
                  >
                    Calculate
                  </button>
                  <button
                    type="button"
                    onClick={closeIoDripModal}
                    className="rounded border px-3 py-1.5 text-sm"
                    disabled={ioDripSaving}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => void saveIoDripModal()}
                    className={`rounded px-3 py-1.5 text-sm text-white ${
                      ioDripSaving ? "bg-gray-400" : "bg-blue-600 hover:bg-blue-700"
                    }`}
                    disabled={ioDripSaving}
                  >
                    {ioDripSaving ? "Saving..." : "Save"}
                  </button>
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}

      {ioPreparedModal && typeof document !== "undefined"
        ? createPortal(
            <div
              className="app-theme-scope fixed inset-0 z-[1000] flex items-center justify-center bg-black/35 px-3"
              onMouseDown={closeIoModal}
            >
              <div
                className="w-full max-w-2xl rounded-xl border border-[var(--app-border)] bg-[var(--app-panel-bg)] text-[var(--app-text)] p-3 space-y-2 shadow-2xl backdrop-blur"
                onMouseDown={e => e.stopPropagation()}
                onKeyDown={handleIoModalKeyDown}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="space-y-1">
                    <div className="text-sm font-semibold leading-none">Entry</div>
                    <div className="text-base font-medium leading-none">
                      {ioPreparedModal.itemName}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 rounded-lg bg-black/5 dark:bg-white/5 p-1">
                    <button
                      type="button"
                      onClick={() => setIoEntryMode("basic")}
                      className={`rounded px-3 py-1 text-xs font-medium transition-colors ${
                        ioEntryMode === "basic"
                          ? "bg-white dark:bg-gray-800 shadow-sm text-blue-600 dark:text-blue-400"
                          : "text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
                      }`}
                    >
                      Basic
                    </button>
                    <button
                      type="button"
                      onClick={() => setIoEntryMode("bulk")}
                      disabled={isModalBloodProduct}
                      className={`rounded px-3 py-1 text-xs font-medium transition-colors ${
                        ioEntryMode === "bulk"
                          ? "bg-white dark:bg-gray-800 shadow-sm text-blue-600 dark:text-blue-400"
                          : "text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
                      } ${isModalBloodProduct ? "opacity-50 cursor-not-allowed" : ""}`}
                    >
                      Bulk
                    </button>
                  </div>
                </div>

                {ioEntryMode === "basic" ? (
                  <div className="space-y-3 py-2">
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
                        <label className="text-sm text-[var(--app-muted)] font-medium">
                          Bag No.
                        </label>
                        <input
                          type="text"
                          className="rounded border border-[var(--app-border)] bg-[var(--app-control-bg)] px-2 py-1.5 text-sm w-full"
                          placeholder="Blood bag number"
                          autoFocus
                          value={ioModalBloodBagNo}
                          onChange={e => setIoModalBloodBagNo(e.target.value)}
                        />
                      </div>
                    ) : null}
                    {modalRequiresBloodGroup ? (
                      <div className="grid grid-cols-[100px_1fr] gap-2 items-center">
                        <label className="text-sm text-[var(--app-muted)] font-medium">
                          Group
                        </label>
                        <input
                          type="text"
                          list="caseview-blood-groups"
                          className="rounded border border-[var(--app-border)] bg-[var(--app-control-bg)] px-2 py-1.5 text-sm w-full uppercase"
                          placeholder="A+, O-, ..."
                          value={ioModalBloodGroup}
                          onChange={e => setIoModalBloodGroup(e.target.value.toUpperCase())}
                          maxLength={4}
                        />
                      </div>
                    ) : null}
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
                          className="rounded border border-[var(--app-border)] bg-[var(--app-control-bg)] px-2 py-1.5 text-sm flex-1"
                          placeholder="0.00"
                          value={ioModalValue}
                          onChange={e => setIoModalValue(e.target.value)}
                        />
                        <div className="px-2 py-1.5 text-sm bg-black/5 dark:bg-white/5 rounded min-w-[60px] text-center border border-[var(--app-border)]">
                          {ioPreparedModal.kind === "med" ? ioPreparedModal.itemUnit || "mg" : "mL"}
                        </div>
                      </div>
                    </div>
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
                ) : (
                  <div className="max-h-[60vh] overflow-y-auto pr-1 space-y-3">
                    <div className="grid grid-cols-[80px_1fr_1fr] gap-2 items-center px-2 py-1 bg-black/5 dark:bg-white/5 rounded text-[10px] font-bold uppercase tracking-wider text-[var(--app-muted)] sticky top-0 z-10">
                      <div>Time</div>
                      <div>{ioPreparedModal.kind === "med" ? `Dose (${ioPreparedModal.itemUnit || "mg"})` : "Volume (mL)"}</div>
                      <div>Note</div>
                    </div>
                    
                    {bucketMinutes.map(ts => (
                      <div key={ts} className="grid grid-cols-[80px_1fr_1fr] gap-2 items-center">
                        <div className="text-sm font-mono font-medium">{formatTimeInputHHMM(formatHHMM(ts))}</div>
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          className="rounded border border-[var(--app-border)] bg-[var(--app-control-bg)] px-2 py-1.5 text-sm w-full"
                          placeholder="0.00"
                          value={bucketValues[ts] || ""}
                          onChange={e => setBucketValues(prev => ({ ...prev, [ts]: e.target.value }))}
                        />
                        <input
                          type="text"
                          className="rounded border border-[var(--app-border)] bg-[var(--app-control-bg)] px-2 py-1.5 text-sm w-full"
                          placeholder="Note"
                          value={bucketNotes[ts] || ""}
                          onChange={e => setBucketNotes(prev => ({ ...prev, [ts]: e.target.value }))}
                        />
                      </div>
                    ))}
                  </div>
                )}

                {ioModalError ? (
                  <div className="text-xs text-red-600 dark:text-red-400 px-1">{ioModalError}</div>
                ) : null}
                <datalist id="caseview-blood-groups">
                  {BLOOD_GROUP_OPTIONS.map(group => (
                    <option key={group} value={group} />
                  ))}
                </datalist>

                <div className="flex justify-end gap-2 pt-3 border-t border-[var(--app-border)]">
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
                  <button
                    type="button"
                    onClick={() => void savePreparedValue()}
                    className={`rounded px-4 py-2 text-sm font-medium text-white ${
                      ioModalSaving ? "bg-gray-400" : "bg-blue-600 hover:bg-blue-700"
                    }`}
                    disabled={ioModalSaving}
                  >
                    {ioModalSaving ? "Saving..." : "Save"}
                  </button>
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}

      <ConfirmDialog
        open={pendingIoRemove != null}
        title="Remove Item?"
        message={
          pendingIoRemove
            ? `Remove "${pendingIoRemove.itemName}" from current case?\n\nThis will exclude related entries from fluid balance totals.`
            : ""
        }
        confirmLabel="Remove"
        busy={pendingIoRemove != null && removingIoRunId === pendingIoRemove.runId}
        onCancel={() => setPendingIoRemove(null)}
        onConfirm={confirmRemoveIoRun}
      />

      {isTimelineLoading && (
        <div className="absolute inset-0 z-[60] flex items-center justify-center bg-white/50 dark:bg-black/50 backdrop-blur-[1px]">
          <div className="flex flex-col items-center gap-3 rounded-xl bg-white/90 dark:bg-gray-800/90 p-6 shadow-2xl border border-gray-200 dark:border-gray-700">
            <div className="h-10 w-10 animate-spin rounded-full border-4 border-blue-600 border-t-transparent" />
            <div className="text-sm font-medium text-gray-800 dark:text-gray-100">
              Updating Timeline...
            </div>
            <div className="text-[10px] text-gray-500 dark:text-gray-400">
              {axisStepMin} min scale
            </div>
          </div>
        </div>
      )}
    </div>
  );
}







