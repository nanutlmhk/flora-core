import { useEffect, useMemo, useRef, useState } from "react";
import ClinicalTimelineAxis from "../components/clinical-timeline/ClinicalTimelineAxis";
import ClinicalTimelineGrid, {
  type ClinicalTimelineEventMarker,
  type ClinicalTimelineIoMarker,
} from "../components/clinical-timeline/ClinicalTimelineGrid";
import type { ClinicalTimelineRow, ClinicalTimelineValues } from "../components/clinical-timeline/types";
import VitalSignsTrendChart from "../components/vitals/VitalSignsTrendChart";
import HeaderCard from "../components/case/HeaderCard";
import { BASE_IVY_ROWS, makeFallbackLabel, ROW_META } from "./clinical-chart/constants";
import type { FleetCase } from "../api/fleetApi";
import type { CaseIoEvent, CaseIoRun, CaseIoRunSegment, IoKind } from "../api/caseIoApi";
import timeCardIcon from "../assets/card-time.png";
import patientCardIcon from "../assets/card-patient.png";
import allergyCardIcon from "../assets/card-allergy.png";
import diagnosisCardIcon from "../assets/card-diagnosis.png";
import procedureCardIcon from "../assets/card-procedure.png";

type SnapshotEnvelope = {
  snapshot: Record<string, unknown>;
  leaf_name: string;
  last_synced_at: string;
};

type Props = {
  entry: FleetCase;
  data: SnapshotEnvelope;
  onBack: () => void;
  onRefresh: () => void;
  refreshing: boolean;
};

const MINUTE = 60_000;

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function rows(value: unknown): Array<Record<string, unknown>> {
  const source = record(value).rows;
  return Array.isArray(source) ? source.filter(item => item && typeof item === "object") as Array<Record<string, unknown>> : [];
}

function number(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function text(value: unknown, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function formatDateTime(value: unknown) {
  const date = typeof value === "string" && !/^\d+$/.test(value.trim())
    ? new Date(value)
    : new Date(number(value));
  return Number.isNaN(date.getTime()) ? "—" : new Intl.DateTimeFormat(undefined, {
    day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
  }).format(date);
}

function elapsed(start: unknown, end: unknown) {
  const duration = Math.max(0, number(end, Date.now()) - number(start, Date.now()));
  const minutes = Math.floor(duration / MINUTE);
  const hours = Math.floor(minutes / 60);
  return hours ? `${hours}h ${minutes % 60}m` : `${minutes}m`;
}

function bucketFor(ts: number, axis: number[], stepMs: number) {
  if (!axis.length || ts < axis[0]) return null;
  const index = Math.floor((ts - axis[0]) / stepMs);
  return axis[index] ?? null;
}

function ioRowId(run: CaseIoRun) {
  return `canopy-io-${run.id}`;
}

function runKind(value: unknown): IoKind {
  return value === "fluid" || value === "output" ? value : "med";
}

function parseRun(row: Record<string, unknown>): CaseIoRun {
  return {
    ...row,
    id: number(row.id),
    case_id: number(row.case_id),
    item_id: number(row.item_id),
    kind: runKind(row.kind),
    started_at: number(row.started_at),
    stopped_at: row.stopped_at == null ? null : number(row.stopped_at),
    entry_mode: row.entry_mode === "drip" ? "drip" : "bolus",
    item_name: text(row.item_name),
    item_code: text(row.item_code),
    item_unit: text(row.item_unit),
    item_category: text(row.item_category),
    segments: Array.isArray(row.segments) ? row.segments as CaseIoRunSegment[] : [],
  };
}

function parseIoEvent(row: Record<string, unknown>): CaseIoEvent {
  return {
    ...row,
    id: number(row.id), case_id: number(row.case_id), item_id: number(row.item_id),
    kind: runKind(row.kind), event_ts: number(row.event_ts),
  } as CaseIoEvent;
}

function patientName(patient: Record<string, unknown>, hn: string | null | undefined) {
  return text(patient.patient_name)
    || [text(patient.title_th), text(patient.first_name), text(patient.last_name)].filter(Boolean).join(" ")
    || [text(patient.title_en), text(patient.first_name_en), text(patient.last_name_en)].filter(Boolean).join(" ")
    || `HN ${hn || "—"}`;
}

export default function CanopyCaseChartView({ entry, data, onBack, onRefresh, refreshing }: Props) {
  const [scale, setScale] = useState(5);
  const [scrollLeft, setScrollLeft] = useState(0);
  const [viewportWidth, setViewportWidth] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const snapshot = data.snapshot;
  const caseRow = record(snapshot.case);
  const patient = record(record(snapshot.patient).row);
  const timelineRows = rows(snapshot.timeline);
  const eventRows = rows(snapshot.events);
  const ioRuns = useMemo(() => rows(snapshot.io_runs).map(parseRun), [snapshot.io_runs]);
  const ioEvents = useMemo(() => rows(snapshot.io_events).map(parseIoEvent), [snapshot.io_events]);
  const windowRange = record(snapshot.window);
  const isActive = text(caseRow.status, entry.status).toUpperCase() === "ACTIVE";

  const stepMs = scale * MINUTE;
  const axis = useMemo(() => {
    const startRaw = number(windowRange.from, number(caseRow.start_time, entry.start_time || Date.now()));
    const timelineEnd = timelineRows.reduce((latest, row) => Math.max(latest, number(row.ts_minute)), 0);
    const endRaw = Math.max(startRaw, number(windowRange.to), timelineEnd, number(caseRow.discharge_time));
    const start = Math.floor(startRaw / stepMs) * stepMs;
    const finalDataBucket = Math.floor(endRaw / stepMs) * stepMs;
    const end = finalDataBucket + (isActive ? 2 : 0) * stepMs;
    const count = Math.min(2_000, Math.max(1, Math.floor((end - start) / stepMs) + 1));
    return Array.from({ length: count }, (_, index) => start + index * stepMs);
  }, [caseRow.discharge_time, caseRow.start_time, entry.start_time, isActive, stepMs, timelineRows, windowRange.from, windowRange.to]);

  const values = useMemo<ClinicalTimelineValues>(() => {
    const next: ClinicalTimelineValues = {};
    for (const row of timelineRows) {
      const bucket = bucketFor(number(row.ts_minute), axis, stepMs);
      if (bucket == null) continue;
      for (const [key, value] of Object.entries(record(row.payload))) {
        if (value == null || value === "") continue;
        next[key] ||= {};
        next[key][bucket] = value;
      }
    }
    return next;
  }, [axis, stepMs, timelineRows]);

  const vitalRows = useMemo<ClinicalTimelineRow[]>(() => {
    const known = new Map(BASE_IVY_ROWS.map(row => [row.id, row]));
    for (const key of Object.keys(values)) {
      if (known.has(key) || key === "event" || key === "ecg") continue;
      known.set(key, { id: key, label: ROW_META[key]?.label || makeFallbackLabel(key), unit: ROW_META[key]?.unit, type: "vital" });
    }
    return Array.from(known.values());
  }, [values]);

  const eventMarkers = useMemo<Record<number, ClinicalTimelineEventMarker[]>>(() => {
    const next: Record<number, ClinicalTimelineEventMarker[]> = {};
    for (const row of eventRows) {
      const bucket = bucketFor(number(row.event_ts), axis, stepMs);
      if (bucket == null) continue;
      (next[bucket] ||= []).push({
        id: number(row.id), event_ts: number(row.event_ts),
        event_type: row.event_type === "note" ? "note" : "event",
        title: text(row.title, "Clinical event"),
      });
    }
    return next;
  }, [axis, eventRows, stepMs]);

  const ioRows = useMemo<ClinicalTimelineRow[]>(() => ioRuns.map(run => ({
    id: ioRowId(run),
    label: run.item_name || run.item_code || (run.kind === "output" ? "Output" : "Intake"),
    unit: run.item_unit || undefined,
    type: "io",
    displayMode: run.entry_mode === "drip" ? "drip" : "bolus",
    ioKind: run.kind,
    ioCategory: run.item_category,
    ioDetail: run.entry_mode === "drip" ? [run.route, run.note].filter(Boolean).join(" · ") : undefined,
  })), [ioRuns]);

  const ioData = useMemo(() => {
    const grid: ClinicalTimelineValues = {};
    const markers: Record<number, ClinicalTimelineIoMarker[]> = {};
    const byKey = new Map<string, CaseIoRun[]>();
    for (const run of ioRuns) {
      grid[ioRowId(run)] = {};
      const key = `${run.kind}:${run.item_id}`;
      byKey.set(key, [...(byKey.get(key) || []), run]);
      for (const segment of run.segments || []) {
        const from = number(segment.ts_from);
        const to = number(segment.ts_to, number(run.stopped_at, number(windowRange.to, Date.now())));
        const first = axis.findIndex(ts => ts + stepMs > from);
        let last = -1;
        for (let index = axis.length - 1; index >= 0; index -= 1) {
          if (axis[index] < to) { last = index; break; }
        }
        if (first < 0 || last < first) continue;
        for (let index = first; index <= last; index += 1) {
          const ts = axis[index];
          grid[ioRowId(run)][ts] = {
            kind: "io_cell",
            amount: number(segment.dose_value, number(segment.rate_value)),
            dripPart: first === last ? "single" : index === first ? "start" : index === last ? "end" : "mid",
            dripGroupTone: run.kind === "fluid" ? "fluid" : "other",
            dripRateMlPerHr: number(segment.rate_value) || undefined,
            segmentDoseValue: segment.dose_value == null ? null : number(segment.dose_value),
            segmentDoseUnit: segment.dose_unit || null,
            segmentRateUnit: segment.rate_unit || null,
          };
        }
        const startBucket = bucketFor(from, axis, stepMs);
        if (startBucket != null) (markers[startBucket] ||= []).push({
          run_id: run.id, item_id: run.item_id, kind: run.kind,
          item_name: run.item_name || run.item_code || "Infusion",
          item_category: run.item_category, marker_code: "d",
        });
      }
    }
    for (const event of ioEvents) {
      const bucket = bucketFor(number(event.event_ts), axis, stepMs);
      const candidates = byKey.get(`${event.kind}:${event.item_id}`) || [];
      const run = candidates.find(candidate => candidate.entry_mode !== "drip") || candidates[0];
      if (bucket == null || !run) continue;
      const amount = event.kind === "med" ? number(event.dose_value) : number(event.volume_ml);
      grid[ioRowId(run)][bucket] = { kind: "io_cell", amount, minuteValues: [{ ts: event.event_ts, amount }] };
      (markers[bucket] ||= []).push({
        run_id: run.id, item_id: run.item_id, kind: run.kind,
        item_name: run.item_name || run.item_code || "Clinical input/output",
        item_category: run.item_category, marker_code: run.kind === "output" ? "o" : "i",
      });
    }
    return { grid, markers };
  }, [axis, ioEvents, ioRuns, stepMs, windowRange.to]);

  const combinedValues = useMemo(() => ({ ...values, ...ioData.grid }), [ioData.grid, values]);
  const rowsAfterEvent = useMemo<ClinicalTimelineRow[]>(() => [
    { id: "__io_header__", label: "I/O", type: "event" },
    ...ioRows,
    { id: "__vital_agent_header__", label: "Params", type: "event" },
  ], [ioRows]);
  const allergies = rows(snapshot.allergies);
  const diagnoses = rows(snapshot.diagnosis);
  const procedures = rows(snapshot.procedures);
  const displayName = patientName(patient, entry.hn);
  const nowTs = isActive ? Date.now() : number(caseRow.discharge_time, axis.at(-1));
  const colWidth = viewportWidth > 0 && viewportWidth < 720 ? 68 : 51;
  const labelWidth = viewportWidth > 0 && viewportWidth < 720 ? 108 : 124;

  useEffect(() => {
    if (!scrollRef.current || !axis.length) return;
    requestAnimationFrame(() => {
      const element = scrollRef.current;
      if (element) element.scrollLeft = element.scrollWidth - element.clientWidth;
    });
  }, [axis.length, entry.global_case_id, scale]);

  useEffect(() => {
    if (!scrollRef.current) return;
    const observer = new ResizeObserver(items => setViewportWidth(items[0]?.contentRect.width || 0));
    observer.observe(scrollRef.current);
    return () => observer.disconnect();
  }, []);

  return (
    <div className="case-workspace case-workspace--top relative h-full min-h-0 bg-gray-50 p-2 dark:bg-gray-900">
      <div className="mb-2 flex flex-wrap items-center gap-2 rounded-xl border border-[var(--app-border)] bg-[var(--app-panel-bg)] px-3 py-2">
        <button type="button" onClick={onBack} className="rounded-lg border border-[var(--app-border)] bg-[var(--app-control-bg)] px-3 py-2 text-xs font-bold text-[var(--app-text)]">← Cases</button>
        <div className="min-w-0 flex-1"><div className="text-[10px] font-extrabold uppercase tracking-[0.14em] text-[var(--app-accent)]">Flora Canopy · synchronized Leaf chart</div><div className="truncate text-sm font-semibold text-[var(--app-text)]">{data.leaf_name} · {entry.case_code || entry.source_case_id}</div></div>
        <span className="rounded-full border border-sky-400/40 bg-sky-500/10 px-3 py-1.5 text-xs font-bold text-sky-600 dark:text-sky-300">View only</span>
        <span className="text-xs text-[var(--app-muted)]">Synced {formatDateTime(data.last_synced_at)}</span>
        <button type="button" onClick={onRefresh} disabled={refreshing} className="rounded-lg border border-[var(--app-border)] bg-[var(--app-control-bg)] px-3 py-2 text-xs font-semibold text-[var(--app-text)] disabled:opacity-50">{refreshing ? "Refreshing…" : "Refresh"}</button>
      </div>

      <div className="case-kronos rounded-xl border px-3 py-2 text-xs">
        <div className="case-header-grid">
          <HeaderCard group="Case LOS" icon={timeCardIcon} main={elapsed(caseRow.start_time, isActive ? Date.now() : caseRow.discharge_time)} sub1={<><b>Started</b> {formatDateTime(caseRow.start_time)}</>} emphasis />
          <HeaderCard group="Patient" icon={patientCardIcon} main={displayName} sub1={<><b>HN {entry.hn || "—"}</b> · {text(patient.age_text, "Age —")} · {text(patient.sex, "Sex —")}</>} sub2={patient.an ? <>AN {String(patient.an)}</> : undefined} />
          <HeaderCard group="Allergy" icon={allergyCardIcon} count={allergies.length || undefined} main={allergies.length ? text(allergies[0].allergen, "Recorded allergy") : "No allergy recorded"} tone={allergies.length ? "alert" : "default"} />
          <HeaderCard group="Diagnosis" icon={diagnosisCardIcon} count={diagnoses.length || undefined} main={diagnoses.length ? text(diagnoses[0].diagnosis_text, "Recorded diagnosis") : "Not recorded"} />
          <HeaderCard group="Operation" icon={procedureCardIcon} count={procedures.length || undefined} main={procedures.length ? text(procedures[0].procedure_text, "Recorded procedure") : "Not recorded"} />
        </div>
      </div>

      <div className="case-kronos__toolbar rounded-xl border px-3 py-2">
        <div className="case-kronos__controls"><span className="case-kronos__eyebrow">MINUTE SCALE</span><div className="case-kronos__stepper"><button type="button" disabled={scale <= 1} onClick={() => setScale(current => current <= 5 ? 1 : current <= 15 ? 5 : 15)}>−</button><input aria-label="Minute scale" value={scale} readOnly /><button type="button" disabled={scale >= 30} onClick={() => setScale(current => current < 5 ? 5 : current < 15 ? 15 : 30)}>+</button></div><span className="case-kronos__sync">Synchronized</span></div>
        <div className="flex items-center gap-2"><span className={`rounded-full border px-3 py-1.5 text-xs font-bold ${isActive ? "border-emerald-500/45 bg-emerald-500/10 text-emerald-600 dark:text-emerald-300" : "border-[var(--app-border)] text-[var(--app-muted)]"}`}>{text(caseRow.status, entry.status)}</span><span className="text-xs text-[var(--app-muted)]">{vitalRows.length} parameters</span></div>
      </div>

      <div ref={scrollRef} onScroll={event => setScrollLeft(event.currentTarget.scrollLeft)} className="case-timeline-scroll min-h-0 flex-1 overflow-auto scrollbar-thin scrollbar-track-transparent scrollbar-thumb-gray-400/40">
        <div className="relative min-h-full min-w-max">
          <ClinicalTimelineAxis axis={axis} nowTs={nowTs} scrollLeft={scrollLeft} viewportWidth={viewportWidth} colWidth={colWidth} labelColWidth={labelWidth} />
          <div className="case-kronos__entries"><ClinicalTimelineGrid readOnly displaySection="events-io" columns={axis} ivyRows={vitalRows} rowsAfterEvent={rowsAfterEvent} values={combinedValues} eventMarkersByTs={eventMarkers} preparedMarkersByTs={ioData.markers} nowTs={nowTs} scrollLeft={scrollLeft} viewportWidth={viewportWidth} colWidth={colWidth} labelColWidth={labelWidth} /></div>
          <VitalSignsTrendChart axis={axis} values={values} nowTs={nowTs} scrollLeft={scrollLeft} viewportWidth={viewportWidth} colWidth={colWidth} labelColWidth={labelWidth} height={viewportWidth > 0 && viewportWidth < 720 ? 170 : 150} preferredVisibleGroups={["hr", "spo2", "nibp", "art", "cvp"]} />
          <ClinicalTimelineGrid readOnly displaySection="vitals" columns={axis} ivyRows={vitalRows} rowsAfterEvent={rowsAfterEvent} values={combinedValues} nowTs={nowTs} scrollLeft={scrollLeft} viewportWidth={viewportWidth} colWidth={colWidth} labelColWidth={labelWidth} />
        </div>
      </div>
    </div>
  );
}
