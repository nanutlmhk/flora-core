import { useCallback, useEffect, useMemo, useState } from "react";
import type { CaseStatus } from "../api/caseApi";
import { getEffectiveTimeline, type VitalMinuteRow } from "../api/vitalMinutesApi";
import { getCaseEvents, type CaseEvent } from "../api/caseEventApi";
import {
  getCaseIoEvents,
  getCaseIoRuns,
  getCaseIoSummary,
  type CaseIoEvent,
  type CaseIoRun,
  type CaseIoSummaryTotals,
} from "../api/caseIoApi";
import {
  getCaseDiagnosis,
  getCaseProcedures,
  type CaseDiagnosisRow,
  type CaseProcedureRow,
} from "../api/caseClinicalApi";
import {
  getCaseAllergies,
  getCaseLabs,
  type CaseAllergyRow,
  type CaseLabRow,
} from "../api/caseHisApi";
import HnBarcode from "../components/common/HnBarcode";
import type { TimeGridRow, TimeGridValues } from "../components/timegrid/types";
import { BASE_IVY_ROWS, ROW_META, makeFallbackLabel } from "./caseview/constants";
import ReportTimeAxis from "./report/ReportTimeAxis";
import ReportTimeChart from "./report/ReportTimeChart";
import ReportTimeGrid from "./report/ReportTimeGrid";
import type { ReportChartVisibility, ReportEventMarker, ReportPreparedMarker } from "./report/types";

type Props = {
  caseStatus: CaseStatus;
};

type ReportData = {
  generatedAt: number;
  fromTs: number;
  toTs: number;
  formDraft: Record<string, unknown>;
  timelineRows: VitalMinuteRow[];
  events: CaseEvent[];
  ioEvents: CaseIoEvent[];
  ioRuns: CaseIoRun[];
  diagnosis: CaseDiagnosisRow[];
  procedures: CaseProcedureRow[];
  allergies: CaseAllergyRow[];
  labs: CaseLabRow[];
  ioSummary: CaseIoSummaryTotals | null;
};

function ReportLogo() {
  return (
    <div className="inline-flex items-center gap-2">
      <svg viewBox="0 0 64 64" className="h-9 w-9 shrink-0" aria-hidden="true">
        <rect x="26" y="6" width="12" height="52" fill="#f71927" />
        <rect x="6" y="26" width="52" height="12" fill="#f71927" />
      </svg>
      <div className="report-thai-text text-[10px] font-semibold leading-tight text-gray-800 dark:text-gray-200">
        <div>โรงพยาบาลจุฬาลงกรณ์</div>
        <div>สภากาชาดไทย</div>
      </div>
    </div>
  );
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function getText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function getList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
}

function formatGaCodeValue(raw: string): string {
  const token = raw.trim().toLowerCase();
  if (!token) return "";
  const overrides: Record<string, string> = {
    lma: "LMA",
    mlt: "MLT",
    rae: "RAE",
    hfjv: "HFJV",
    standard_pvc: "Standard PVC",
    oral_endotracheal_tube: "Oral endotracheal tube",
    nasal_endotracheal_tube: "Nasal endotracheal tube",
    tracheostomy_tube: "Tracheostomy tube",
    jet_ventilation: "Jet ventilation",
    oropharyngeal_airway: "Oropharyngeal airway",
    nasopharyngeal_airway: "Nasopharyngeal airway",
    double_lumen: "Double lumen",
    laser_tube: "Laser tube",
    intubating_lma: "Intubating LMA",
    direct_laryngoscopy: "Direct laryngoscopy",
    vdo_laryngoscopy: "VDO laryngoscopy",
    fiberoptic: "Fiberoptic",
    fiberscope_bonfils: "Fiberscope Bonfils",
    macintosh: "Macintosh",
    miller: "Miller",
    "c-mac": "C-MAC",
    mc_grath: "Mc Grath",
    glidescope: "Glidescope",
    "d-blade": "D-blade",
  };
  const mapped = overrides[token];
  if (mapped) return mapped;
  return token
    .replace(/_/g, " ")
    .replace(/\b\w/g, ch => ch.toUpperCase());
}

function getGaCodeText(value: unknown): string {
  const text = getText(value);
  if (!text) return "";
  return formatGaCodeValue(text);
}

function getGaCodeList(value: unknown): string[] {
  return getList(value)
    .map(item => formatGaCodeValue(item))
    .filter(Boolean);
}

function isTruthyValue(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) && value > 0;
  if (typeof value !== "string") return false;
  const token = value.trim().toLowerCase();
  return token === "1" || token === "true" || token === "yes" || token === "y" || token === "on";
}

function parseTechniqueSummary(raw: unknown): Array<{
  outcome: string;
  techniqueType: string;
  attemptNo: string;
  view: string;
  bladeType: string;
  bladeSize: string;
  guideStylet: string;
  vdoType: string;
  vdoOtherType: string;
  vdoBlade: string;
  sizeMm: string;
}> {
  if (typeof raw !== "string" || !raw.trim()) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
      .map((item) => ({
        outcome: String(item.outcome || "").trim().toLowerCase(),
        techniqueType: String(item.technique_type || "").trim(),
        attemptNo: String(item.attempt_no || "").trim(),
        view: String(item.laryngoscopic_view || "").trim(),
        bladeType: String(item.blade_type || "").trim(),
        bladeSize: String(item.blade_size || "").trim(),
        guideStylet: String(item.guide_stylet || "").trim(),
        vdoType: String(item.vdo_type || "").trim(),
        vdoOtherType: String(item.vdo_other_type || "").trim(),
        vdoBlade: String(item.vdo_blade || "").trim(),
        sizeMm: String(item.size_mm || "").trim(),
      }))
      .filter(item => item.techniqueType);
  } catch {
    return [];
  }
}

function formatDateDDMMYYYY(ts: number): string {
  const d = new Date(ts);
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
}

function formatTimeHHMM(ts: number): string {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function formatDateTime(ts: number): string {
  return `${formatDateDDMMYYYY(ts)} ${formatTimeHHMM(ts)}`;
}

function formatDuration(fromTs: number, toTs: number): string {
  const totalMin = Math.max(0, Math.floor((toTs - fromTs) / 60000));
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

function formatAmount(value: number): string {
  if (!Number.isFinite(value)) return "0";
  if (Math.abs(value - Math.round(value)) < 0.0001) return String(Math.round(value));
  return value.toFixed(2).replace(/\.?0+$/, "");
}

function isNkaAllergyRow(row: CaseAllergyRow): boolean {
  const allergen = String(row?.allergen || "").trim().toUpperCase();
  const status = String(row?.status || "").trim().toLowerCase();
  return (
    allergen === "NKA" ||
    allergen === "NO KNOWN ALLERGY" ||
    status === "nka"
  );
}

function normalizeToken(value: unknown): string {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
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

function maxOf(values: number[]): number {
  if (values.length === 0) return 0;
  return Math.max(...values);
}

const VITAL_KEY_NORM: Record<string, string> = {
  heart_rate: "hr", pulse_rate: "hr", pr: "hr",
  spo2: "spo2",
  nibp_sys: "nibp_sys", nibp_dia: "nibp_dia", nibp_mean: "nibp_map", nibp_map: "nibp_map",
  art_sys: "art_sys", art_dia: "art_dia", art_mean: "art_map", art_map: "art_map",
  cvp: "cvp",
};

function readFormDraft(caseId: number): Record<string, unknown> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(`doctor_form_${caseId}`);
    if (!raw) return {};
    return asObject(JSON.parse(raw) as unknown);
  } catch {
    return {};
  }
}

const REPORT_BUCKET_MIN = 15;
const REPORT_BUCKET_MS = REPORT_BUCKET_MIN * 60_000;
const REPORT_TIMELINE_PAGE_MS = 4 * 60 * 60_000;

function floorToBucket(ts: number, bucketMs = REPORT_BUCKET_MS): number {
  return Math.floor(ts / bucketMs) * bucketMs;
}

function ceilToBucket(ts: number, bucketMs = REPORT_BUCKET_MS): number {
  return Math.ceil(ts / bucketMs) * bucketMs;
}

function buildAxis(startTs: number, endTs: number, stepMs = REPORT_BUCKET_MS): number[] {
  const out: number[] = [];
  for (let ts = startTs; ts < endTs; ts += stepMs) out.push(ts);
  return out;
}

function safeText(value: unknown, fallback = "-"): string {
  const text = getText(value);
  return text || fallback;
}

function formatAsaDisplay(form: Record<string, unknown>): string {
  const raw = getText(form.asa);
  if (!raw) return "-";
  const romanMap: Record<string, string> = {
    "1": "I",
    "2": "II",
    "3": "III",
    "4": "IV",
    "5": "V",
    "6": "VI",
    i: "I",
    ii: "II",
    iii: "III",
    iv: "IV",
    v: "V",
    vi: "VI",
  };
  const roman = romanMap[raw.trim().toLowerCase()] || raw.trim().toUpperCase();
  return isTruthyValue(form.emergency) ? `${roman} E` : roman;
}

export default function ReportView({ caseStatus }: Props) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [printError, setPrintError] = useState("");
  const [previewBusy, setPreviewBusy] = useState(false);
  const [previewBlobUrl, setPreviewBlobUrl] = useState("");
  const [previewFileName, setPreviewFileName] = useState("aidas-report.pdf");
  const [warnings, setWarnings] = useState<string[]>([]);
  const [reloadToken, setReloadToken] = useState(0);
  const [data, setData] = useState<ReportData | null>(null);
  const [isLayoutVisible, setIsLayoutVisible] = useState(false);
  const [selectedTimelineParamIds, setSelectedTimelineParamIds] = useState<string[]>([]);
  const [chartSeriesVisibility, setChartSeriesVisibility] = useState<ReportChartVisibility>(() => {
    try {
      const raw = window.localStorage.getItem("aidas.report.chartSeries");
      if (raw) {
        const parsed = JSON.parse(raw) as unknown;
        if (parsed && typeof parsed === "object") {
          const p = parsed as Record<string, unknown>;
          return {
            spo2: p.spo2 !== false,
            hr: p.hr !== false,
            nibp: p.nibp !== false,
            art: p.art !== false,
            cvp: p.cvp !== false,
          };
        }
      }
    } catch { /* ignore */ }
    return { spo2: true, hr: true, nibp: true, art: true, cvp: true };
  });

  useEffect(() => {
    let alive = true;
    async function load() {
      if (caseStatus.status === "IDLE") {
        if (!alive) return;
        setData(null);
        setError("");
        setWarnings([]);
        setLoading(false);
        return;
      }

      const caseId = caseStatus.case_id;
      const fromTs = caseStatus.start_time;
      const statusEndTs =
        caseStatus.status === "DISCHARGED" || caseStatus.status === "ARCHIVED"
          ? caseStatus.discharge_time || Date.now()
          : Date.now();

      setLoading(true);
      setError("");
      setWarnings([]);
      const settled = await Promise.allSettled([
        getEffectiveTimeline(caseId, fromTs, statusEndTs),
        getCaseEvents(caseId, fromTs, statusEndTs, 3000),
        getCaseIoEvents(caseId, fromTs, statusEndTs),
        getCaseIoRuns(caseId, fromTs, statusEndTs),
        getCaseDiagnosis(caseId),
        getCaseProcedures(caseId),
        getCaseAllergies(caseId),
        getCaseLabs(caseId, { fromTs, toTs: statusEndTs, limit: 300 }),
        getCaseIoSummary(caseId, fromTs, statusEndTs),
      ] as const);

      const nextWarnings: string[] = [];
      const timelineRows = settled[0].status === "fulfilled" ? settled[0].value : (nextWarnings.push("Vitals unavailable"), []);
      const events = settled[1].status === "fulfilled" ? settled[1].value : (nextWarnings.push("Events unavailable"), []);
      const ioEvents = settled[2].status === "fulfilled" ? settled[2].value : (nextWarnings.push("Fluid/Med events unavailable"), []);
      const ioRuns = settled[3].status === "fulfilled" ? settled[3].value : (nextWarnings.push("Fluid/Med runs unavailable"), []);
      const diagnosis = settled[4].status === "fulfilled" ? settled[4].value : (nextWarnings.push("Diagnosis unavailable"), []);
      const procedures = settled[5].status === "fulfilled" ? settled[5].value : (nextWarnings.push("Operation unavailable"), []);
      const allergies = settled[6].status === "fulfilled" ? settled[6].value : (nextWarnings.push("Allergy unavailable"), []);
      const labs = settled[7].status === "fulfilled" ? settled[7].value : (nextWarnings.push("Lab unavailable"), []);
      const ioSummary = settled[8].status === "fulfilled" ? settled[8].value : (nextWarnings.push("Fluid balance unavailable"), null);

      const maxVitalTs = maxOf(timelineRows.map(row => row.ts_minute));
      const maxEventTs = maxOf(events.map(row => row.event_ts));
      const maxIoEventTs = maxOf(ioEvents.map(row => row.event_ts));
      const maxIoRunTs = maxOf(
        ioRuns.flatMap(run => [run.started_at, run.stopped_at || 0, ...(run.segments || []).flatMap(segment => [segment.ts_from, segment.ts_to || 0])]),
      );
      const toTs = Math.max(fromTs + 60000, statusEndTs, maxVitalTs, maxEventTs, maxIoEventTs, maxIoRunTs);

      if (!alive) return;
      setData({
        generatedAt: Date.now(),
        fromTs,
        toTs,
        formDraft: readFormDraft(caseId),
        timelineRows: [...timelineRows].sort((a, b) => a.ts_minute - b.ts_minute),
        events: [...events].sort((a, b) => a.event_ts - b.event_ts || a.id - b.id),
        ioEvents: [...ioEvents].sort((a, b) => a.event_ts - b.event_ts || a.id - b.id),
        ioRuns,
        diagnosis,
        procedures,
        allergies,
        labs,
        ioSummary,
      });
      setWarnings(nextWarnings);
      setLoading(false);
    }

    load().catch(err => {
      if (!alive) return;
      setError(err instanceof Error ? err.message : "Report load failed");
      setWarnings([]);
      setData(null);
      setLoading(false);
    });
    return () => {
      alive = false;
    };
  }, [caseStatus, reloadToken]);

  const ensureReportLayoutVisible = async () => {
    setIsLayoutVisible(true);
    await new Promise<void>(resolve => {
      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => resolve());
      });
    });
  };

  const closePdfPreview = () => {
    setPrintError("");
    setPreviewFileName("aidas-report.pdf");
    setPreviewBlobUrl(prev => {
      if (prev) URL.revokeObjectURL(prev);
      return "";
    });
  };

  useEffect(() => {
    return () => {
      if (previewBlobUrl) URL.revokeObjectURL(previewBlobUrl);
    };
  }, [previewBlobUrl]);

  const base64ToArrayBuffer = (base64: string): ArrayBuffer => {
    const text = window.atob(base64);
    const out = new ArrayBuffer(text.length);
    const view = new Uint8Array(out);
    for (let i = 0; i < text.length; i += 1) view[i] = text.charCodeAt(i);
    return out;
  };

  const handleOpenPdfPreview = async () => {
    setPrintError("");
    const desktop = (
      window as unknown as {
        aidasDesktop?: {
          generateReportPdf?: (payload: { fileBaseName: string }) => Promise<{ ok: boolean; fileName?: string; pdfBase64?: string }>;
        };
      }
    ).aidasDesktop;
    await ensureReportLayoutVisible();
    if (!desktop?.generateReportPdf) {
      window.print();
      return;
    }
    try {
      setPreviewBusy(true);
      const caseIdForFileName = "case_id" in caseStatus ? caseStatus.case_id : undefined;
      const casePart = caseIdForFileName ? `case${caseIdForFileName}` : "case";
      const result = await desktop.generateReportPdf({
        fileBaseName: `aidas-report-${casePart}-${Date.now()}`,
      });
      const buffer = base64ToArrayBuffer(result?.pdfBase64 || "");
      if (buffer.byteLength === 0) throw new Error("Generated PDF is empty");
      const blob = new Blob([buffer], { type: "application/pdf" });
      setPreviewBlobUrl(prev => {
        if (prev) URL.revokeObjectURL(prev);
        return URL.createObjectURL(blob);
      });
      if (result?.fileName) setPreviewFileName(result.fileName);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Open PDF preview failed";
      setPrintError(message);
    } finally {
      setPreviewBusy(false);
    }
  };


  const form = data?.formDraft || {};
  const caseAllergyRows = useMemo(
    () => (data?.allergies || []).filter(row => !isNkaAllergyRow(row)),
    [data?.allergies],
  );
  const hasNka = useMemo(
    () => Boolean((data?.allergies || []).find(isNkaAllergyRow)),
    [data?.allergies],
  );
  const caseLabs = useMemo(
    () =>
      [...(data?.labs || [])]
        .sort((a, b) => (Number(b.collected_at || 0) - Number(a.collected_at || 0)))
        .slice(0, 8),
    [data?.labs],
  );
  const itemTotals = useMemo(
    () =>
      [...(data?.ioSummary?.item_totals_ml || [])]
        .map(item => ({
          ...item,
          total_ml: Number(item.total_ml || 0),
        }))
        .filter(item => item.total_ml > 0)
        .sort((a, b) => b.total_ml - a.total_ml),
    [data?.ioSummary?.item_totals_ml],
  );
  const caseEventsAll = useMemo(() => data?.events || [], [data?.events]);
  const caseMilestones = useMemo(() => {
    const rows = (data?.events || []).filter(row => row.event_type === "event");
    const firstByKey = new Map<string, number>();
    for (const row of rows) {
      const key = normalizeToken(row.title);
      if (!key || firstByKey.has(key)) continue;
      firstByKey.set(key, row.event_ts);
    }
    const pick = (...keys: string[]) => {
      for (const key of keys) {
        const found = firstByKey.get(key);
        if (found != null) return found;
      }
      return null;
    };
    const timeOut = pick("timeout");
    const startAne = pick("startane", "startanes", "startanesthesia", "startanaesthesia");
    const induction = pick("induction");
    const ssi = pick("ssiprophylaxis");
    const startSurg = pick("startsurg", "startsurgery");
    const endSurg = pick("endsurg", "endsurgery");
    const reversal = pick("reversal");
    const endAne = pick("endane", "endanes", "endanesthesia", "endanaesthesia");
    return {
      timeOut,
      startAne,
      induction,
      ssi,
      startSurg,
      endSurg,
      reversal,
      endAne,
      anesthesiaDuration:
        startAne != null && endAne != null && endAne >= startAne
          ? formatDuration(startAne, endAne)
          : null,
      surgeryDuration:
        startSurg != null && endSurg != null && endSurg >= startSurg
          ? formatDuration(startSurg, endSurg)
          : null,
    };
  }, [data?.events]);
  const bloodProductSummary = useMemo(() => {
    const rows = (data?.ioEvents || []).filter(row => {
      const categoryToken = normalizeToken((row as Record<string, unknown>).item_category);
      const note = String(row.note || "");
      return (
        categoryToken === "bloodproduct" ||
        note.toLowerCase().includes("bloodbagno:") ||
        note.toLowerCase().includes("bloodproducttype:")
      );
    });
    return rows.map(row => {
      const meta = parseKeyValueFromNote(String(row.note || ""));
      const amount = Number(row.volume_ml || row.dose_value || 0);
      return {
        id: row.id,
        ts: row.event_ts,
        type: String(meta.bloodProductType || "").trim() || String((row as Record<string, unknown>).item_name || "").trim() || "Blood Product",
        group: String(meta.bloodGroup || "").trim().toUpperCase(),
        bagNo: String(meta.bloodBagNo || "").trim(),
        amount: Number.isFinite(amount) ? amount : 0,
      };
    });
  }, [data?.ioEvents]);

  const timelineVitals = useMemo((): Array<{ ts: number; vals: Record<string, number> }> => {
    return (data?.timelineRows || []).map(row => {
      const vals: Record<string, number> = {};
      for (const [rawKey, rawVal] of Object.entries(row.payload || {})) {
        const normKey = VITAL_KEY_NORM[rawKey.trim().toLowerCase()] ?? rawKey.trim().toLowerCase();
        const n = Number(rawVal);
        if (Number.isFinite(n)) vals[normKey] = n;
      }
      return { ts: row.ts_minute, vals };
    });
  }, [data?.timelineRows]);

  const currentCase = caseStatus.status === "IDLE" ? null : caseStatus;

  const gaSummaryRows = useMemo(() => {
    const rows: Array<{ label: string; value: string }> = [];
    const pushText = (label: string, value: string) => {
      if (!value) return;
      rows.push({ label, value });
    };
    const pushList = (label: string, values: string[]) => {
      if (values.length === 0) return;
      rows.push({ label, value: values.join(", ") });
    };
    const readScopedText = (prefix: string, base: string) => getText(form[`${prefix}${base}`]);
    const readScopedCode = (prefix: string, base: string) => getGaCodeText(form[`${prefix}${base}`]);

    const appendAirwayRows = (scopeLabel: "Primary" | "Secondary", prefix: string, deviceCode: string) => {
      if (!deviceCode) return;
      pushText(`${scopeLabel} airway device`, formatGaCodeValue(deviceCode));

      if (deviceCode === "oral_endotracheal_tube") {
        pushText(`${scopeLabel} oral tube type`, readScopedCode(prefix, "oral_tube_type"));
        pushText(`${scopeLabel} oral tube size`, readScopedText(prefix, "oral_tube_size"));
        pushText(`${scopeLabel} oral cuff`, readScopedCode(prefix, "oral_cuff"));
        pushText(
          `${scopeLabel} oral cuff volume`,
          readScopedText(prefix, "oral_cuff_volume_ml") ? `${readScopedText(prefix, "oral_cuff_volume_ml")} mL` : "",
        );
        pushText(
          `${scopeLabel} oral tube depth`,
          readScopedText(prefix, "oral_tube_depth_cm") ? `${readScopedText(prefix, "oral_tube_depth_cm")} cm` : "",
        );
        pushText(`${scopeLabel} oral throat pack`, readScopedCode(prefix, "oral_throat_pack"));
        pushText(`${scopeLabel} oral tube in situ`, readScopedCode(prefix, "oral_tube_in_situ"));
      }
      if (deviceCode === "nasal_endotracheal_tube") {
        pushText(`${scopeLabel} nasal tube type`, readScopedCode(prefix, "nasal_tube_type"));
        pushText(`${scopeLabel} nasal tube size`, readScopedText(prefix, "nasal_tube_size"));
        pushText(`${scopeLabel} nasal cuff`, readScopedCode(prefix, "nasal_cuff"));
        pushText(
          `${scopeLabel} nasal cuff volume`,
          readScopedText(prefix, "nasal_cuff_volume_ml") ? `${readScopedText(prefix, "nasal_cuff_volume_ml")} mL` : "",
        );
        pushText(
          `${scopeLabel} nasal tube depth`,
          readScopedText(prefix, "nasal_tube_depth_cm") ? `${readScopedText(prefix, "nasal_tube_depth_cm")} cm` : "",
        );
        pushText(`${scopeLabel} nasal preparation`, readScopedCode(prefix, "nasal_preparation"));
        pushText(`${scopeLabel} nostril`, readScopedCode(prefix, "nasal_nostril"));
        pushText(`${scopeLabel} nasal pack`, readScopedCode(prefix, "nasal_throat_pack"));
        pushText(`${scopeLabel} nasal tube in situ`, readScopedCode(prefix, "nasal_tube_in_situ"));
      }
      if (deviceCode === "mask") {
        pushText(`${scopeLabel} mask adjunct`, readScopedCode(prefix, "mask_adjunct"));
        pushText(`${scopeLabel} OPA size`, readScopedText(prefix, "opa_size"));
        pushText(`${scopeLabel} NPA size`, readScopedText(prefix, "npa_size"));
      }
      if (deviceCode === "lma") {
        pushText(`${scopeLabel} LMA type`, readScopedCode(prefix, "lma_type"));
        pushText(`${scopeLabel} LMA size`, readScopedText(prefix, "lma_size"));
        pushText(
          `${scopeLabel} LMA cuff volume`,
          readScopedText(prefix, "lma_cuff_volume_ml") ? `${readScopedText(prefix, "lma_cuff_volume_ml")} mL` : "",
        );
        pushText(`${scopeLabel} LMA attempts`, readScopedText(prefix, "lma_number_of_attempts"));
      }
      if (deviceCode === "tracheostomy_tube") {
        pushText(`${scopeLabel} trach type`, readScopedCode(prefix, "trach_type"));
        pushText(`${scopeLabel} trach size`, readScopedText(prefix, "trach_size"));
        pushText(`${scopeLabel} trach cuff`, readScopedCode(prefix, "trach_cuff"));
        pushText(
          `${scopeLabel} trach cuff volume`,
          readScopedText(prefix, "trach_cuff_volume_ml") ? `${readScopedText(prefix, "trach_cuff_volume_ml")} mL` : "",
        );
      }
      if (deviceCode === "jet_ventilation") {
        pushText(`${scopeLabel} jet type`, readScopedCode(prefix, "jet_type"));
      }
      if (deviceCode === "other") {
        pushText(`${scopeLabel} airway description`, readScopedText(prefix, "airway_description"));
      }

      const techniqueRows = parseTechniqueSummary(form[`${prefix}airway_techniques`]);
      for (const item of techniqueRows) {
        const outcome = item.outcome === "failure" ? "Failure" : "Success";
        const parts = [`${outcome}: ${formatGaCodeValue(item.techniqueType)}`];
        if (item.attemptNo) parts.push(`Attempt ${item.attemptNo}`);
        if (item.view) parts.push(`View ${item.view}`);
        if (item.bladeType) parts.push(`Blade ${formatGaCodeValue(item.bladeType)}`);
        if (item.bladeSize) parts.push(`Blade size ${item.bladeSize}`);
        if (item.vdoType) parts.push(`VDO ${formatGaCodeValue(item.vdoType)}`);
        if (item.vdoOtherType) parts.push(`VDO other ${item.vdoOtherType}`);
        if (item.vdoBlade) parts.push(`VDO blade ${formatGaCodeValue(item.vdoBlade)}`);
        if (item.guideStylet) parts.push(`Guide/stylet ${formatGaCodeValue(item.guideStylet)}`);
        if (item.sizeMm) parts.push(`Size ${item.sizeMm} mm`);
        pushText(`${scopeLabel} technique`, parts.join(" | "));
      }
      if (isTruthyValue(form[`${prefix}failed_intubation`])) {
        pushText(`${scopeLabel} failed intubation`, "Yes");
      }
    };

    const preInduction = getList(form.pre_induction);
    const induction = getList(form.induction);
    const maskVentilation = getGaCodeText(form.mask_ventilation_difficulty);
    const eyeProtection = getGaCodeList(form.eye_protection);
    const primaryAirwayCode = getText(form.primary_airway_device);
    const secondaryEnabled = isTruthyValue(form.secondary_airway_enabled);
    const secondaryAirwayCode = secondaryEnabled ? getText(form.secondary_airway_device) : "";
    const hasNewGaData = Boolean(
      preInduction.length > 0 ||
      induction.length > 0 ||
      maskVentilation ||
      eyeProtection.length > 0 ||
      primaryAirwayCode ||
      parseTechniqueSummary(form.primary_airway_techniques).length > 0 ||
      isTruthyValue(form.primary_failed_intubation) ||
      secondaryEnabled ||
      secondaryAirwayCode ||
      parseTechniqueSummary(form.secondary_airway_techniques).length > 0 ||
      isTruthyValue(form.secondary_failed_intubation)
    );

    if (!hasNewGaData) {
      pushText("Airway Type", getText(form.airwayType));
      pushList("Pre-induction", getList(form.preInductionChecks));
      pushList("Induction", getList(form.inductionMethods));
      pushText("Mask Ventilation", getText(form.maskVentilationDifficulty));
      pushText("Intubating Tool", getText(form.intubatingTool));
      pushText("Route", getText(form.intubationRoute));
      pushText("Difficulty", getText(form.intubationDifficulty));
      pushText("Attempts", getText(form.intubationAttempt));
      pushText("Laryngoscopic View", getText(form.laryngoscopicView));
      pushList("Confirmation", getList(form.intubationConfirmation));
      pushList("Intub. Events", getList(form.intubationEvents));
      return rows;
    }

    pushList("Pre-induction", preInduction);
    pushList("Induction", induction);
    pushText("Mask ventilation difficulty", maskVentilation);
    pushList("Eye protection", eyeProtection);
    appendAirwayRows("Primary", "", primaryAirwayCode);
    if (secondaryEnabled) {
      appendAirwayRows("Secondary", "secondary_", secondaryAirwayCode);
    }
    return rows;
  }, [form]);
  const serviceText = useMemo(
    () => getText(form.serviceProviderOther) || getText(form.service) || "-",
    [form],
  );
  const summaryDetailSections = useMemo(() => {
    const sections: Array<{ title: string; entries: Array<{ label: string; value: string }> }> = [];
    const makeEntries = () => {
      const entries: Array<{ label: string; value: string }> = [];
      const push = (label: string, value: string) => {
        const clean = value.trim();
        if (!clean) return;
        entries.push({ label, value: clean });
      };
      return { entries, push };
    };

    {
      const { entries, push } = makeEntries();
      push("Comorbid", getText(form.comorbidDiseases));
      push("Medication", getText(form.currentMedication));
      if (entries.length > 0) sections.push({ title: "Comorbid", entries });
    }
    {
      const { entries, push } = makeEntries();
      push("IV", [getText(form.ivSites), getText(form.ivCatheterSize), getText(form.ivWhereInserted)].filter(Boolean).join(" | "));
      push("A-line", [getText(form.arterialSites), getText(form.arterialCatheterSize), getText(form.arterialWhereInserted)].filter(Boolean).join(" | "));
      push("CVC", [getText(form.cvcSites), getText(form.cvcLumens), getText(form.cvcCatheterSize)].filter(Boolean).join(" | "));
      push("CVC US", getGaCodeText(form.cvcUltrasound));
      push("Attempts", [getText(form.ivAttempts), getText(form.arterialAttempts), getText(form.cvcAttempts)].filter(Boolean).join(" / "));
      if (entries.length > 0) sections.push({ title: "Line", entries });
    }
    {
      const { entries, push } = makeEntries();
      push("Site", getText(form.cvcInsertionSites));
      push("Lumens", getText(form.cvcInsertionLumens));
      push("Size", getText(form.cvcInsertionCatheterSize));
      push("US", getGaCodeText(form.cvcInsertionUltrasound));
      push("Attempts", getText(form.cvcInsertionAttempts));
      push("Sterile", getGaCodeList(form.cvcSterileBarriers).join(", "));
      push("Skin prep", getText(form.cvcSkinPreparation));
      if (entries.length > 0) sections.push({ title: "Invasive Cath", entries });
    }
    {
      const { entries, push } = makeEntries();
      push("Time", getText(form.extubation_time));
      push("Location", getText(form.extubation_location));
      push("Status", getGaCodeText(form.extubation_status));
      push("Device", getGaCodeText(form.airway_device_removed));
      push("Suction", getGaCodeText(form.suction_performed));
      push("Note", getText(form.extubation_note));
      if (entries.length > 0) sections.push({ title: "Extubation", entries });
    }
    {
      const { entries, push } = makeEntries();
      push("Safety", getGaCodeList(form.patientSafetyChecks).join(", "));
      push("Problems", getText(form.patientSafetyProblems));
      if (entries.length > 0) sections.push({ title: "Patient Safety", entries });
    }
    return sections;
  }, [form]);

  const timelinePages = useMemo(() => {
    if (!data) {
      // Always guarantee at least 1 timeline page even before data loads
      const refTs = currentCase?.start_time ? Number(currentCase.start_time) : Date.now();
      const startTs = floorToBucket(refTs);
      const endTs = startTs + REPORT_TIMELINE_PAGE_MS;
      return [{ startTs, endTs, axis: buildAxis(startTs, endTs) }];
    }
    const firstTs = floorToBucket(data.fromTs);
    const finalTs = Math.max(data.toTs, data.fromTs + REPORT_BUCKET_MS);
    const endTs = ceilToBucket(finalTs);
    const pages: Array<{ startTs: number; endTs: number; axis: number[] }> = [];
    for (let startTs = firstTs; startTs < endTs; startTs += REPORT_TIMELINE_PAGE_MS) {
      const windowEnd = Math.min(startTs + REPORT_TIMELINE_PAGE_MS, endTs);
      const axis = buildAxis(startTs, windowEnd);
      pages.push({
        startTs,
        endTs: Math.max(windowEnd, startTs + REPORT_BUCKET_MS),
        axis,
      });
    }
    return pages.length > 0 ? pages : [{ startTs: firstTs, endTs: firstTs + REPORT_TIMELINE_PAGE_MS, axis: buildAxis(firstTs, firstTs + REPORT_TIMELINE_PAGE_MS) }];
  }, [data, currentCase]);

  const bucketedTimeline = useMemo(() => {
    const values: TimeGridValues = {};      // 15-min buckets for grid
    const chartValues: TimeGridValues = {}; // per-minute for chart
    const rowIds = new Set<string>();
    for (const row of data?.timelineRows || []) {
      const bucketTs = floorToBucket(row.ts_minute);
      for (const [rawKey, rawVal] of Object.entries(row.payload || {})) {
        const normKey = VITAL_KEY_NORM[rawKey.trim().toLowerCase()] ?? rawKey.trim().toLowerCase();
        const num = Number(rawVal);
        if (!Number.isFinite(num)) continue;
        rowIds.add(normKey);
        if (!values[normKey]) values[normKey] = {};
        if (values[normKey][bucketTs] == null) values[normKey][bucketTs] = num; // first value per bucket
        if (!chartValues[normKey]) chartValues[normKey] = {};
        const fiveMinTs = Math.floor(row.ts_minute / 300_000) * 300_000; // 5-min buckets
        chartValues[normKey][fiveMinTs] = num;
      }
    }
    const activeRows = BASE_IVY_ROWS.filter(row => rowIds.has(row.id));
    return { values, chartValues, activeRows };
  }, [data?.timelineRows]);

  const selectableTimelineOptions = useMemo(() => {
    const activeById = new Map(
      bucketedTimeline.activeRows.map(row => [
        row.id,
        {
          id: row.id,
          label: ROW_META[row.id]?.label || row.label || makeFallbackLabel(row.id),
          unit: ROW_META[row.id]?.unit || row.unit || "",
        },
      ]),
    );
    const ordered = bucketedTimeline.activeRows.map(row => row.id);
    const out: Array<{ id: string; label: string; unit: string; memberIds: string[] }> = [];
    const pushGroup = (id: string, label: string, memberIds: string[]) => {
      const present = memberIds.filter(memberId => activeById.has(memberId));
      if (present.length === 0) return;
      out.push({ id, label, unit: "", memberIds: present });
      present.forEach(memberId => activeById.delete(memberId));
    };
    pushGroup("group:nibp", "NIBP", ["nibp_sys", "nibp_map", "nibp_dia"]);
    pushGroup("group:art", "ART", ["art_sys", "art_map", "art_dia"]);
    for (const id of ordered) {
      const row = activeById.get(id);
      if (!row) continue;
      out.push({ ...row, memberIds: [id] });
    }
    return out;
  }, [bucketedTimeline.activeRows]);

  useEffect(() => {
    const storageKey = "aidas.report.timelineParams";
    const available = new Set(
      selectableTimelineOptions.flatMap(option => option.memberIds),
    );
    let stored: string[] = [];
    try {
      const raw = window.localStorage.getItem(storageKey);
      if (raw) {
        const parsed = JSON.parse(raw) as unknown;
        if (Array.isArray(parsed)) {
          stored = parsed.filter((item): item is string => typeof item === "string" && available.has(item));
        }
      }
    } catch {
      stored = [];
    }
    const next =
      stored.length > 0
        ? stored
        : selectableTimelineOptions.flatMap(option => option.memberIds);
    setSelectedTimelineParamIds(prev => {
      const filteredPrev = prev.filter(id => available.has(id));
      if (filteredPrev.length > 0) {
        const merged = filteredPrev.filter(id => available.has(id));
        return merged;
      }
      return next;
    });
  }, [selectableTimelineOptions]);

  useEffect(() => {
    try {
      window.localStorage.setItem("aidas.report.timelineParams", JSON.stringify(selectedTimelineParamIds));
    } catch {
      // ignore localStorage write failures
    }
  }, [selectedTimelineParamIds]);

  const selectedTimelineParamIdSet = useMemo(
    () => new Set(selectedTimelineParamIds),
    [selectedTimelineParamIds],
  );
  useEffect(() => {
    try {
      window.localStorage.setItem("aidas.report.chartSeries", JSON.stringify(chartSeriesVisibility));
    } catch { /* ignore */ }
  }, [chartSeriesVisibility]);

  const handleChartToggle = useCallback((series: keyof ReportChartVisibility) => {
    setChartSeriesVisibility(prev => ({ ...prev, [series]: !prev[series] }));
  }, []);

  const timelineEventMarkersByBucket = useMemo(() => {
    const map: Record<number, ReportEventMarker[]> = {};
    for (const item of caseEventsAll) {
      const bucketTs = floorToBucket(item.event_ts);
      if (!map[bucketTs]) map[bucketTs] = [];
      map[bucketTs].push({
        id: item.id,
        event_ts: item.event_ts,
        event_type: item.event_type,
        title: item.title,
      });
    }
    return map;
  }, [caseEventsAll]);

  const timelineIoPrepared = useMemo(() => {
    const markers: Record<number, ReportPreparedMarker[]> = {};
    const values: TimeGridValues = {};
    const rowMeta = new Map<string, { rowId: string; label: string; unit: string }>();
    for (const item of data?.ioEvents || []) {
      const bucketTs = floorToBucket(item.event_ts);
      if (!markers[bucketTs]) markers[bucketTs] = [];
      const label = item.item_name || item.item_code || `Item ${item.item_id}`;
      const rowKey = `${item.kind}:${item.item_id}:${label}`;
      let meta = rowMeta.get(rowKey);
      if (!meta) {
        meta = {
          rowId: `io_${item.kind}_${item.item_id}`,
          label,
          unit: String(item.dose_unit || "").trim() || (item.kind === "med" ? "mg" : "mL"),
        };
        rowMeta.set(rowKey, meta);
        values[meta.rowId] = {};
      }
      const amount = item.kind === "med" ? Number(item.dose_value) : Number(item.volume_ml);
      if (Number.isFinite(amount) && amount > 0) {
        const current = Number(values[meta.rowId][bucketTs] || 0);
        values[meta.rowId][bucketTs] = Number((current + amount).toFixed(2));
      }
      markers[bucketTs].push({
        run_id: item.id,
        item_id: item.item_id,
        kind: item.kind,
        item_name: label,
        marker_code: item.kind === "output" ? "o" : "i",
        marker_label: item.kind === "output" ? "O" : "B",
      });
    }
    const rows: TimeGridRow[] = [
      { id: "__io_header__", label: "Fluid&Med", type: "event" },
      ...Array.from(rowMeta.values()).map(meta => ({
        id: meta.rowId,
        label: meta.label,
        type: "io" as const,
        unit: meta.unit,
      })),
      { id: "__vital_agent_header__", label: "Vital&Agent", type: "event" },
      ...bucketedTimeline.activeRows.map(row => ({
        ...row,
        label: ROW_META[row.id]?.label || row.label || makeFallbackLabel(row.id),
      })),
    ];
    return { markers, values, rows };
  }, [bucketedTimeline.activeRows, data?.ioEvents]);

  const totalPageCount = 1 + Math.max(1, timelinePages.length);

  const renderPageHeader = (pageNum: number, subtitle: string) => (
    <header className="mb-2 flex items-start justify-between gap-2 border-b border-gray-500 pb-1.5">
      <div className="flex items-center gap-2 shrink-0">
        <ReportLogo />
        <div>
          <div className="text-[12px] font-bold tracking-wide">ANESTHESIA RECORD</div>
          <div className="text-[10px] text-gray-600">{subtitle}</div>
        </div>
      </div>
      <div className="flex items-start gap-2 text-right text-[9px]">
        {currentCase?.hn ? (
          <div className="report-header-barcode shrink-0">
            <HnBarcode
              value={currentCase.hn}
              height={28}
              showText={true}
              className="text-black"
            />
          </div>
        ) : null}
        <div>
          <div className="text-[10px] font-semibold">
            {[getText(form.titleTh), getText(form.firstName), getText(form.lastName)].filter(Boolean).join(" ") ||
            [getText(form.titleEn), getText(form.firstNameEn), getText(form.lastNameEn)].filter(Boolean).join(" ") || "-"}
          </div>
          <div>HN: {currentCase?.hn || "-"} | AN: {getText(form.an) || "-"}</div>
          <div>ASA: {formatAsaDisplay(form)} | Blood: {[getText(form.bloodGroupABO), getText(form.bloodGroupRh)].filter(Boolean).join(" ") || "-"}</div>
          <div>Age: {getText(form.ageY) ? `${getText(form.ageY)}y ${getText(form.ageM) || "0"}m` : "-"} | Wt: {getText(form.weightKg) ? `${getText(form.weightKg)} kg` : "-"} | Ht: {getText(form.heightCm) ? `${getText(form.heightCm)} cm` : "-"}</div>
          <div className="text-gray-500">Page {pageNum} / {totalPageCount}</div>
        </div>
      </div>
    </header>
  );

  const renderPageFooter = (pageNum: number) => (
    <footer className="mt-2 flex items-center justify-between border-t border-gray-400 pt-1 text-[8px] text-gray-500">
      <span>ANESTHESIA RECORD — CONFIDENTIAL MEDICAL DOCUMENT</span>
      <span>HN: {currentCase?.hn || "-"} | AN: {safeText(form.an)} | {currentCase ? formatDateDDMMYYYY(currentCase.start_time) : "-"}</span>
      <span>Page {pageNum} / {totalPageCount}</span>
    </footer>
  );

  const th = "border border-gray-500 bg-gray-100 px-1 py-0.5 text-[9px] font-semibold text-left align-top";
  const td = "border border-gray-500 px-1 py-0.5 text-[9px] align-top leading-4";

  return (
    <div className="report-root p-4 pb-8 text-gray-900 dark:text-gray-100">
      <div className="report-toolbar mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-sm font-semibold">Anesthesia Record Report</div>
          <div className="text-xs text-gray-500 dark:text-gray-400">Configuration and preview</div>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" className="rounded border border-gray-300 px-3 py-1.5 text-xs dark:border-gray-700" onClick={() => setReloadToken(prev => prev + 1)}>Refresh</button>
          <button
            type="button"
            className="rounded border border-gray-300 px-3 py-1.5 text-xs dark:border-gray-700"
            onClick={() => setIsLayoutVisible(prev => !prev)}
            disabled={caseStatus.status === "IDLE"}
          >
            {isLayoutVisible ? "Hide Layout" : "Open Layout"}
          </button>
          <button
            type="button"
            className="rounded border border-gray-300 px-3 py-1.5 text-xs dark:border-gray-700"
            onClick={handleOpenPdfPreview}
            disabled={previewBusy}
          >
            {previewBusy ? "Opening PDF..." : "Preview PDF"}
          </button>
        </div>
      </div>

      {loading ?<div className="mb-2 text-xs text-gray-500 dark:text-gray-400">Loading report...</div> : null}
      {error ? <div className="mb-2 text-xs text-red-500">{error}</div> : null}
      {printError ? <div className="mb-2 text-xs text-red-500">Preview failed: {printError}</div> : null}
      {warnings.length > 0 ? (
        <div className="mb-2 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200">
          {warnings.join(" | ")}
        </div>
      ) : null}

      {caseStatus.status === "IDLE" ? (
        <div className="rounded border border-gray-300 bg-white p-4 text-sm text-gray-500">No active case</div>
      ) : (
      <>
      <section className="report-setup mb-4 rounded-xl border border-[var(--app-border)] bg-[var(--app-panel-bg)] p-4 shadow-sm">
          <div className="mb-3 flex items-baseline justify-between">
            <div className="text-sm font-semibold">Report Setup</div>
            <div className="text-xs text-[var(--app-muted)]">Review before opening the final paper layout.</div>
          </div>
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div className="space-y-3">
              <div className="rounded-lg border border-[var(--app-border)] bg-[var(--app-control-bg)] px-3 py-2">
                <div className="text-xs uppercase tracking-wide text-[var(--app-muted)]">Case</div>
                <div className="mt-1 font-medium">HN {currentCase?.hn || "-"} | AN {getText(form.an) || "-"}</div>
                <div className="text-xs text-[var(--app-muted)]">
                  Start {currentCase ? formatDateTime(currentCase.start_time) : "-"}
                </div>
              </div>
              <div className="rounded-lg border border-[var(--app-border)] bg-[var(--app-control-bg)] px-3 py-2">
                <div className="text-xs uppercase tracking-wide text-[var(--app-muted)]">Pages</div>
                <div className="mt-1">Page 1: Summary</div>
                <div>Page 2+: Timeline sheet</div>
                <div className="text-[11px] text-[var(--app-muted)]">4 hours per page, 15-minute columns</div>
              </div>
              <div className="rounded-lg border border-[var(--app-border)] bg-[var(--app-control-bg)] px-3 py-2">
                <div className="text-xs uppercase tracking-wide text-[var(--app-muted)]">Data Check</div>
                <div className="mt-1">Vitals: {timelineVitals.length} rows</div>
                <div>Events: {caseEventsAll.length}</div>
                <div>Fluid/Med: {data?.ioEvents.length || 0}</div>
                <div>Labs: {caseLabs.length}</div>
              </div>
              <div className="rounded-lg border border-[var(--app-border)] bg-[var(--app-control-bg)] px-3 py-2">
                <div className="text-xs uppercase tracking-wide text-[var(--app-muted)]">Chart Series</div>
                <div className="mt-2 grid grid-cols-2 gap-1.5 text-xs">
                  {(["spo2", "hr", "nibp", "art", "cvp"] as const).map(series => {
                    const labels: Record<typeof series, string> = { spo2: "SpO2", hr: "HR / Pulse", nibp: "NIBP", art: "ART", cvp: "CVP" };
                    return (
                      <label key={series} className="flex items-center gap-2 rounded border border-[var(--app-border)] px-2 py-1">
                        <input type="checkbox" checked={chartSeriesVisibility[series]} onChange={() => handleChartToggle(series)} />
                        <span>{labels[series]}</span>
                      </label>
                    );
                  })}
                </div>
              </div>
            </div>
            <div className="rounded-lg border border-[var(--app-border)] bg-[var(--app-control-bg)] px-3 py-2">
              <div className="text-xs uppercase tracking-wide text-[var(--app-muted)]">Timeline Parameters</div>
              <div className="mt-1 text-[11px] text-[var(--app-muted)]">
                Fluid&amp;Med always prints all rows. Select Vital&amp;Agent rows for paper report.
              </div>
              <div className="mt-2 grid grid-cols-2 gap-2 overflow-y-auto text-xs" style={{ maxHeight: "220px" }}>
                {selectableTimelineOptions.map(option => {
                  const checked = option.memberIds.every(id => selectedTimelineParamIdSet.has(id));
                  return (
                    <label
                      key={option.id}
                      className="flex items-center gap-2 rounded border border-[var(--app-border)] px-2 py-1"
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => {
                          setSelectedTimelineParamIds(prev => {
                            const next = new Set(prev);
                            if (checked) {
                              option.memberIds.forEach(id => next.delete(id));
                            } else {
                              option.memberIds.forEach(id => next.add(id));
                            }
                            return Array.from(next);
                          });
                        }}
                      />
                      <span>
                        {option.label}
                        {option.unit ? <span className="ml-1 text-[10px] text-[var(--app-muted)]">({option.unit})</span> : null}
                      </span>
                    </label>
                  );
                })}
              </div>
            </div>
          </div>
      </section>

      {isLayoutVisible ? (
      <div className="report-pages space-y-4">
        <article className="report-page rounded-lg border border-gray-300 bg-white p-3 shadow-sm">
          {renderPageHeader(1, "Patient Summary")}
          <section className="mb-2">
            <div className="mb-1 border-b border-gray-400 text-[9px] font-bold uppercase tracking-widest text-gray-600">Case Information</div>
            <table className="w-full border-collapse">
              <tbody>
                <tr>
                  <td className={th}>Clinic</td>
                  <td className={td}>{safeText(form.clinic)}</td>
                  <td className={th}>Service</td>
                  <td className={td}>{serviceText}</td>
                  <td className={th}>Post-op</td>
                  <td className={td}>{safeText(form.postoperativeDestination)}</td>
                  <td className={th}>Case Start</td>
                  <td className={td}>{currentCase ? formatDateTime(currentCase.start_time) : "-"}</td>
                </tr>
                <tr>
                  <td className={th}>Anesthesia</td>
                  <td className={td} colSpan={3}>{getList(form.anesthesiaTypes).join(" | ") || "-"}</td>
                  <td className={th}>Anes. Duration</td>
                  <td className={td}>{caseMilestones.anesthesiaDuration || "-"}</td>
                  <td className={th}>Surg. Duration</td>
                  <td className={td}>{caseMilestones.surgeryDuration || "-"}</td>
                </tr>
              </tbody>
            </table>
          </section>

          <section className="mb-2 grid grid-cols-2 gap-3">
            <div>
              <div className="mb-1 border-b border-gray-400 text-[9px] font-bold uppercase tracking-widest text-gray-600">Diagnosis</div>
              {data && data.diagnosis.length > 0 ? (
                <ol className="list-decimal pl-4 text-[9px] leading-4">
                  {data.diagnosis.slice(0, 5).map(item => (
                    <li key={item.id}>{item.diagnosis_text}{item.icd_code ? <span className="text-gray-500"> ({item.icd_code})</span> : null}</li>
                  ))}
                </ol>
              ) : <div className="text-[9px] text-gray-400">-</div>}
            </div>
            <div>
              <div className="mb-1 border-b border-gray-400 text-[9px] font-bold uppercase tracking-widest text-gray-600">Operation / Technique</div>
              <div className="text-[9px] leading-4">
                <div><span className="font-semibold">Op:</span> {data && data.procedures.length > 0 ? data.procedures.slice(0, 3).map(item => item.procedure_text).join(" | ") : "-"}</div>
                <div><span className="font-semibold">Anes:</span> {getList(form.anesthesiaTypes).join(" | ") || "-"}</div>
              </div>
              <table className="mt-1 w-full border-collapse">
                <tbody>
                  {([
                    { label: "Start Anes", ts: caseMilestones.startAne, dur: "" },
                    { label: "Time Out", ts: caseMilestones.timeOut, dur: "" },
                    { label: "Induction", ts: caseMilestones.induction, dur: "" },
                    { label: "SSI", ts: caseMilestones.ssi, dur: "" },
                    { label: "Start Surg", ts: caseMilestones.startSurg, dur: "" },
                    { label: "End Surg", ts: caseMilestones.endSurg, dur: caseMilestones.surgeryDuration || "" },
                    { label: "Reversal", ts: caseMilestones.reversal, dur: "" },
                    { label: "End Anes", ts: caseMilestones.endAne, dur: caseMilestones.anesthesiaDuration || "" },
                  ] as Array<{ label: string; ts: number | null; dur: string }>).filter(row => row.ts != null).map(row => (
                    <tr key={row.label}>
                      <td className={th} style={{ width: "30%" }}>{row.label}</td>
                      <td className={td}>{row.ts != null ? formatDateTime(row.ts) : "-"}</td>
                      <td className={`${td} whitespace-nowrap`}>{row.dur || "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="mb-2 grid grid-cols-3 gap-2">
            <div>
              <div className="mb-1 border-b border-gray-400 text-[9px] font-bold uppercase tracking-widest text-gray-600">GA / Airway</div>
              {gaSummaryRows.length > 0 ? (
                <table className="w-full border-collapse">
                  <tbody>
                    {gaSummaryRows.slice(0, 12).map(row => (
                      <tr key={`ga-mini-${row.label}`}>
                        <td className={th} style={{ width: "42%" }}>{row.label}</td>
                        <td className={td}>{row.value || "-"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : <div className="text-[9px] text-gray-400">-</div>}
            </div>
            {summaryDetailSections.slice(0, 2).map(section => (
              <div key={section.title}>
                <div className="mb-1 border-b border-gray-400 text-[9px] font-bold uppercase tracking-widest text-gray-600">{section.title}</div>
                <table className="w-full border-collapse">
                  <tbody>
                    {section.entries.slice(0, 6).map(entry => (
                      <tr key={`${section.title}-${entry.label}`}>
                        <td className={th} style={{ width: "36%" }}>{entry.label}</td>
                        <td className={td}>{entry.value}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
          </section>

          <section className="mb-2 grid grid-cols-2 gap-3">
            <div>
              <div className="mb-1 border-b border-gray-400 text-[9px] font-bold uppercase tracking-widest text-gray-600">Fluid / Blood Summary</div>
              <table className="w-full border-collapse">
                <tbody>
                  <tr>
                    <td className={th}>Intake</td>
                    <td className={td}>{formatAmount(data?.ioSummary?.intake_ml || 0)} mL</td>
                    <td className={th}>Output</td>
                    <td className={td}>{formatAmount(data?.ioSummary?.output_ml || 0)} mL</td>
                  </tr>
                  <tr>
                    <td className={th}>Net</td>
                    <td className={td}>{formatAmount(data?.ioSummary?.net_ml || 0)} mL</td>
                    <td className={th}>Urine</td>
                    <td className={td}>{formatAmount(data?.ioSummary?.urine_output_ml || 0)} mL</td>
                  </tr>
                  <tr>
                    <td className={th}>Blood Loss</td>
                    <td className={td}>{formatAmount(data?.ioSummary?.blood_loss_ml || 0)} mL</td>
                    <td className={th}>Totals</td>
                    <td className={td}>{itemTotals.slice(0, 2).map(item => `${item.item_name || item.item_code} ${formatAmount(item.total_ml)} ${item.item_unit || "mL"}`).join(" | ") || "-"}</td>
                  </tr>
                </tbody>
              </table>
              <table className="mt-1 w-full border-collapse">
                <thead>
                  <tr>
                    <th className={th}>Time</th>
                    <th className={th}>Product</th>
                    <th className={th}>Group</th>
                    <th className={th}>Bag</th>
                    <th className={th}>Amt</th>
                  </tr>
                </thead>
                <tbody>
                  {bloodProductSummary.slice(0, 4).map(row => (
                    <tr key={`bp-p1-${row.id}`}>
                      <td className={td}>{formatTimeHHMM(row.ts)}</td>
                      <td className={td}>{row.type || "-"}</td>
                      <td className={td}>{row.group || "-"}</td>
                      <td className={td}>{row.bagNo || "-"}</td>
                      <td className={td}>{row.amount > 0 ? formatAmount(row.amount) : "-"}</td>
                    </tr>
                  ))}
                  {bloodProductSummary.length === 0 ? (
                    <tr><td className={td} colSpan={5}>No blood product recorded</td></tr>
                  ) : null}
                </tbody>
              </table>
            </div>
            <div>
              <div className="mb-1 border-b border-gray-400 text-[9px] font-bold uppercase tracking-widest text-gray-600">Allergy / Labs / Other Form</div>
              <table className="w-full border-collapse">
                <tbody>
                  <tr>
                    <td className={th}>Allergy</td>
                    <td className={td}>{caseAllergyRows.length > 0 ? caseAllergyRows.slice(0, 3).map(row => [row.allergen, row.reaction, row.severity].filter(Boolean).join(" | ")).join(" ; ") : hasNka ? "NKA confirmed" : "No allergy recorded"}</td>
                  </tr>
                  <tr>
                    <td className={th}>Labs</td>
                    <td className={td}>{caseLabs.slice(0, 4).map(row => `${row.test_name} ${row.value_text || "-"} ${row.unit || ""}`.trim()).join(" | ") || "-"}</td>
                  </tr>
                </tbody>
              </table>
              {summaryDetailSections.slice(2).map(section => (
                <table key={section.title} className="mt-1 w-full border-collapse">
                  <tbody>
                    <tr>
                      <td className={th} style={{ width: "24%" }}>{section.title}</td>
                      <td className={td}>{section.entries.slice(0, 5).map(entry => `${entry.label}: ${entry.value}`).join(" | ") || "-"}</td>
                    </tr>
                  </tbody>
                </table>
              ))}
            </div>
          </section>

          <section>
            <div className="mb-1 border-b border-gray-400 text-[9px] font-bold uppercase tracking-widest text-gray-600">
              Events / Notes <span className="ml-1 font-normal text-gray-500">({caseEventsAll.length} total)</span>
            </div>
            {caseEventsAll.length > 0 ? (
              <table className="w-full border-collapse">
                <thead>
                  <tr>
                    <th className={th} style={{ width: "10%" }}>Time</th>
                    <th className={th} style={{ width: "10%" }}>Type</th>
                    <th className={th}>Event / Note</th>
                  </tr>
                </thead>
                <tbody>
                  {caseEventsAll.slice(0, 16).map(item => (
                    <tr key={item.id}>
                      <td className={td}>{formatTimeHHMM(item.event_ts)}</td>
                      <td className={td}>{item.event_type === "event" ? "EVENT" : "NOTE"}</td>
                      <td className={td}>{item.title}{item.detail ? <span className="text-gray-500"> | {item.detail}</span> : null}</td>
                    </tr>
                  ))}
                  {caseEventsAll.length > 16 ? (
                    <tr>
                      <td className={td} colSpan={3} style={{ color: "#6b7280" }}>+{caseEventsAll.length - 16} more events</td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            ) : (
              <div className="text-[9px] text-gray-400">No events recorded</div>
            )}
          </section>
          {renderPageFooter(1)}
        </article>

        {timelinePages.map((page, index) => {
          const pageNum = index + 2;
          const valuesMerged: TimeGridValues = {
            ...bucketedTimeline.values,
            ...timelineIoPrepared.values,
          };
          const hasPageData = (rowId: string) =>
            page.axis.some(ts => valuesMerged[rowId] && Object.prototype.hasOwnProperty.call(valuesMerged[rowId], ts));
          const pageRows = timelineIoPrepared.rows.filter(row => {
            if (row.type === "event") return true;
            if (row.type === "vital") return selectedTimelineParamIdSet.has(row.id) && hasPageData(row.id);
            return hasPageData(row.id);
          });
          const eventCount = page.axis.reduce((sum, ts) => sum + (timelineEventMarkersByBucket[ts]?.length || 0), 0);
          return (
            <article key={page.startTs} className="report-page rounded-lg border border-gray-300 bg-white p-3 shadow-sm">
              {renderPageHeader(pageNum, `Timeline ${formatDateTime(page.startTs)} - ${formatDateTime(page.endTs)}`)}
              <section>
                <div className="mb-1 border-b border-gray-400 text-[9px] font-bold uppercase tracking-widest text-gray-600">
                  Classic Timeline Sheet
                  <span className="ml-2 font-normal normal-case text-gray-500">{REPORT_BUCKET_MIN}-minute columns | 4-hour page | events {eventCount}</span>
                </div>
                <div className="overflow-hidden">
                  <ReportTimeAxis axis={page.axis} colWidth={50} labelColWidth={120} />
                  <ReportTimeChart axis={page.axis} values={bucketedTimeline.chartValues} colWidth={50} labelColWidth={120} height={118} visible={chartSeriesVisibility} onToggle={handleChartToggle} />
                  <ReportTimeGrid
                    axis={page.axis}
                    rows={pageRows}
                    values={valuesMerged}
                    eventMarkersByTs={timelineEventMarkersByBucket}
                    preparedMarkersByTs={timelineIoPrepared.markers}
                    colWidth={50}
                    labelColWidth={120}
                  />
                </div>
              </section>
              {renderPageFooter(pageNum)}
            </article>
          );
        })}
      </div>
      ) : null}
      </>
      )}

      {previewBlobUrl ? (
        <div className="fixed inset-0 z-[1000] bg-black/50 p-3">
          <div className="mx-auto flex h-full max-w-[1400px] flex-col rounded-lg border border-[var(--app-border)] bg-[var(--app-panel-bg)]">
            <div className="flex items-center justify-between gap-2 border-b border-[var(--app-border)] px-3 py-2">
              <div className="text-sm font-semibold">PDF Preview</div>
              <div className="flex items-center gap-2">
                <a
                  href={previewBlobUrl}
                  download={previewFileName}
                  className="rounded bg-blue-600 px-3 py-1.5 text-xs text-white hover:bg-blue-700"
                >
                  Save PDF
                </a>
                <button
                  type="button"
                  className="rounded border border-gray-300 px-3 py-1.5 text-xs dark:border-gray-700"
                  onClick={closePdfPreview}
                >
                  Close
                </button>
              </div>
            </div>
            <div className="min-h-0 flex-1 bg-gray-100 dark:bg-gray-900">
              <iframe
                title="AIDAS PDF Preview"
                src={previewBlobUrl}
                className="h-full w-full"
              />
            </div>
          </div>
        </div>
      ) : null}

    </div>
  );
}




