import { useEffect, useMemo, useState } from "react";
import type { CaseStatus } from "../api/caseApi";
import type { AuthUser } from "../auth/useAuth";
import { getCaseStaff, type StaffMember } from "../api/staffApi";
import ConfirmDialog from "../components/common/ConfirmDialog";
import {
  deleteCaseEvent,
  getCaseEvents,
  type CaseEvent,
} from "../api/caseEventApi";
import {
  getCaseIoEvents,
  getCaseIoRuns,
  getCaseIoSummary,
  type CaseIoEvent,
  type CaseIoRun,
  type CaseIoSummaryTotals,
} from "../api/caseIoApi";

type Props = {
  caseStatus: CaseStatus;
  sessionUser: AuthUser | null;
};

function readSectionPref(key: string, defaultValue: boolean) {
  if (typeof window === "undefined") return defaultValue;
  const raw = window.localStorage.getItem(key);
  if (raw == null) return defaultValue;
  return raw === "1";
}

function formatDateHeader(ts: number) {
  const d = new Date(ts);
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

function formatHHMM(ts: number) {
  const d = new Date(ts);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

function formatMl(value: unknown) {
  const n = Number(value);
  return `${Number.isFinite(n) ? n : 0} mL`;
}

function formatQuantityWithUnit(value: unknown, unit?: string | null) {
  const n = Number(value);
  const safe = Number.isFinite(n) ? n : 0;
  const rounded = Math.round(safe * 100) / 100;
  const unitText = String(unit || "").trim().toLowerCase() === "ml"
    ? "mL"
    : String(unit || "").trim();
  const display = Number.isInteger(rounded) ? String(rounded) : String(rounded);
  return `${display} ${unitText || "mL"}`;
}

function formatQuantity(value: number) {
  const rounded = Math.round(value * 100) / 100;
  return Number.isInteger(rounded) ? String(rounded) : String(rounded);
}

function asMl(value: unknown) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function asNumber(value: unknown) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function parsePositiveNumber(raw: unknown): number | null {
  const text = String(raw ?? "").trim();
  if (!text) return null;
  const numeric = Number(text);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : null;
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

function formatSignedMl(value: number) {
  const sign = value > 0 ? "+" : value < 0 ? "-" : "";
  return `${sign}${Math.abs(value)} mL`;
}

function eventTooltip(row: CaseEvent) {
  const lines = [`${formatHHMM(row.event_ts)} ${row.title}`];
  if (row.detail) lines.push(row.detail);
  return lines.join("\n");
}

function staffTooltip(row: StaffMember) {
  const parts: string[] = [];
  if (row.th_first_name || row.th_last_name) {
    parts.push(`TH: ${[row.th_first_name, row.th_last_name].filter(Boolean).join(" ")}`);
  }
  if (row.en_first_name || row.en_last_name) {
    parts.push(`EN: ${[row.en_first_name, row.en_last_name].filter(Boolean).join(" ")}`);
  }
  if (row.personal_id) parts.push(`Personal ID: ${row.personal_id}`);
  if (row.email) parts.push(`Email: ${row.email}`);
  if (row.entry_year) parts.push(`Entry Year: ${row.entry_year}`);
  return parts.join("\n");
}



export default function RightRail({ caseStatus, sessionUser }: Props) {
  const safeCaseStatus: CaseStatus =
    caseStatus && typeof caseStatus === "object" && "status" in caseStatus
      ? caseStatus
      : { status: "IDLE" };

  const prefScope = sessionUser?.username || "guest";
  const staffPrefKey = `aidas.rightRail.${prefScope}.staffMinimized`;
  const timelinePrefKey = `aidas.rightRail.${prefScope}.timelineMinimized`;
  const ioPrefKey = `aidas.rightRail.${prefScope}.ioMinimized`;
  const [isStaffMinimized, setIsStaffMinimized] = useState(() =>
    readSectionPref(staffPrefKey, false),
  );
  const [isTimelineMinimized, setIsTimelineMinimized] = useState(() =>
    readSectionPref(timelinePrefKey, false),
  );
  const [isIoMinimized, setIsIoMinimized] = useState(() =>
    readSectionPref(ioPrefKey, false),
  );
  const [staffRows, setStaffRows] = useState<StaffMember[]>([]);
  const [staffLoading, setStaffLoading] = useState(false);
  const [staffError, setStaffError] = useState("");
  const [events, setEvents] = useState<CaseEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [isDeletingEvent, setIsDeletingEvent] = useState(false);
  const [pendingDeleteEvent, setPendingDeleteEvent] = useState<CaseEvent | null>(null);
  const [ioLoading, setIoLoading] = useState(false);
  const [ioError, setIoError] = useState("");
  const [ioSummary, setIoSummary] = useState<CaseIoSummaryTotals | null>(null);
  const [ioEvents, setIoEvents] = useState<CaseIoEvent[]>([]);
  const [ioRuns, setIoRuns] = useState<CaseIoRun[]>([]);

  const actor = useMemo(
    () => ({
      username: sessionUser?.username || "unknown",
      name: sessionUser?.name,
      role: sessionUser?.role,
    }),
    [sessionUser],
  );

  const activeCase = safeCaseStatus.status === "IDLE" ? null : safeCaseStatus;
  const caseId = activeCase?.case_id ?? null;

  useEffect(() => {
    setIsStaffMinimized(readSectionPref(staffPrefKey, false));
    setIsTimelineMinimized(readSectionPref(timelinePrefKey, false));
    setIsIoMinimized(readSectionPref(ioPrefKey, false));
  }, [ioPrefKey, staffPrefKey, timelinePrefKey]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(staffPrefKey, isStaffMinimized ? "1" : "0");
  }, [isStaffMinimized, staffPrefKey]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(timelinePrefKey, isTimelineMinimized ? "1" : "0");
  }, [isTimelineMinimized, timelinePrefKey]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(ioPrefKey, isIoMinimized ? "1" : "0");
  }, [ioPrefKey, isIoMinimized]);

  useEffect(() => {
    if (caseId == null) {
      setStaffRows([]);
      setStaffError("");
      return;
    }
    const activeCaseId = caseId;

    let alive = true;

    async function loadStaff() {
      setStaffLoading(true);
      setStaffError("");
      try {
        const rows = await getCaseStaff(activeCaseId);
        if (!alive) return;
        setStaffRows(rows);
      } catch (err) {
        if (!alive) return;
        setStaffError(err instanceof Error ? err.message : "Failed to load staff");
      } finally {
        if (alive) setStaffLoading(false);
      }
    }

    const onStaffChanged = (event: Event) => {
      const custom = event as CustomEvent<{ caseId?: number }>;
      const changedCaseId = Number(custom.detail?.caseId);
      if (Number.isFinite(changedCaseId) && changedCaseId !== activeCaseId) return;
      void loadStaff();
    };

    void loadStaff();
    const timer = setInterval(() => {
      void loadStaff();
    }, 20_000);

    window.addEventListener("aidas:case-staff-changed", onStaffChanged);
    return () => {
      alive = false;
      clearInterval(timer);
      window.removeEventListener("aidas:case-staff-changed", onStaffChanged);
    };
  }, [caseId]);

  useEffect(() => {
    if (!activeCase) {
      setEvents([]);
      return;
    }

    const caseInfo = activeCase;
    const activeCaseId = caseInfo.case_id;
    let alive = true;
    const fromTs = caseInfo.start_time;
    const toTs =
      caseInfo.status === "DISCHARGED" && caseInfo.discharge_time
        ? caseInfo.discharge_time
        : Date.now() + 24 * 60 * 60 * 1000;

    async function load() {
      setLoading(true);
      setError("");
      try {
        const rows = await getCaseEvents(caseInfo.case_id, fromTs, toTs, 400);
        if (!alive) return;
        setEvents(rows);
      } catch (err) {
        if (!alive) return;
        setError(err instanceof Error ? err.message : "Failed to load events");
      } finally {
        if (alive) setLoading(false);
      }
    }

    void load();
    const timer = setInterval(() => {
      void load();
    }, 15_000);
    const onEventsChanged = (event: Event) => {
      const custom = event as CustomEvent<{ caseId?: number }>;
      const changedCaseId = Number(custom.detail?.caseId);
      if (Number.isFinite(changedCaseId) && changedCaseId !== activeCaseId) return;
      void load();
    };
    window.addEventListener("aidas:case-events-changed", onEventsChanged);

    return () => {
      alive = false;
      clearInterval(timer);
      window.removeEventListener("aidas:case-events-changed", onEventsChanged);
    };
  }, [activeCase]);

  useEffect(() => {
    if (!activeCase) {
      setIoSummary(null);
      setIoEvents([]);
      setIoRuns([]);
      setIoError("");
      return;
    }

    const caseInfo = activeCase;
    let alive = true;

    async function loadIo() {
      setIoLoading(true);
      setIoError("");
      try {
        const fromTs = caseInfo.start_time;
        const toTs =
          caseInfo.status === "DISCHARGED" && caseInfo.discharge_time
            ? caseInfo.discharge_time
            : Date.now();
        const [summary, runs, events] = await Promise.all([
          getCaseIoSummary(caseInfo.case_id, fromTs, toTs),
          getCaseIoRuns(caseInfo.case_id, fromTs, toTs),
          getCaseIoEvents(caseInfo.case_id, fromTs, toTs),
        ]);
        if (!alive) return;
        setIoSummary(summary);
        setIoRuns(runs);
        setIoEvents(events);
      } catch (err) {
        if (!alive) return;
        setIoError(err instanceof Error ? err.message : "Failed to load case IO");
      } finally {
        if (alive) setIoLoading(false);
      }
    }

    void loadIo();
    const timer = setInterval(() => {
      void loadIo();
    }, 15_000);
    const onIoChanged = (event: Event) => {
      const custom = event as CustomEvent<{ caseId?: number }>;
      const changedCaseId = Number(custom.detail?.caseId);
      if (Number.isFinite(changedCaseId) && changedCaseId !== caseInfo.case_id) return;
      void loadIo();
    };

    window.addEventListener("aidas:case-io-changed", onIoChanged);

    return () => {
      alive = false;
      clearInterval(timer);
      window.removeEventListener("aidas:case-io-changed", onIoChanged);
    };
  }, [activeCase]);

  const handleDelete = async () => {
    if (!caseId) return;
    if (!pendingDeleteEvent) return;
    try {
      setIsDeletingEvent(true);
      await deleteCaseEvent(
        caseId,
        pendingDeleteEvent.id,
        actor,
        "right rail delete event",
      );
      setEvents(prev => prev.filter(e => e.id !== pendingDeleteEvent.id));
      window.dispatchEvent(
        new CustomEvent("aidas:case-events-changed", {
          detail: { caseId },
        }),
      );
      setPendingDeleteEvent(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete event");
    } finally {
      setIsDeletingEvent(false);
    }
  };

  let lastDate = "";
  const intakeMl = asMl(ioSummary?.intake_ml);
  const outputMl = asMl(ioSummary?.output_ml);
  const netMl = asMl(ioSummary?.net_ml);
  const barMax = Math.max(intakeMl, outputMl, 1);
  const intakePct = intakeMl <= 0 ? 0 : Math.max(8, (intakeMl / barMax) * 100);
  const outputPct = outputMl <= 0 ? 0 : Math.max(8, (outputMl / barMax) * 100);
  const netClass =
    netMl > 0
      ? "text-emerald-500 dark:text-emerald-300"
      : netMl < 0
        ? "text-rose-500 dark:text-rose-300"
        : "text-gray-700 dark:text-gray-200";
  const intakeItemTotals = (ioSummary?.item_totals_ml || [])
    .filter(item => item.kind === "fluid" && asMl(item.total_ml) > 0)
    .sort((a, b) => asMl(b.total_ml) - asMl(a.total_ml) || a.item_name.localeCompare(b.item_name));
  const medicationTotals = useMemo(() => {
    const nowTs =
      activeCase?.status === "DISCHARGED" && activeCase.discharge_time
        ? activeCase.discharge_time
        : Date.now();
    const byItem = new Map<
      string,
      {
        label: string;
        unitTotals: Map<string, number>;
      }
    >();

    for (const event of ioEvents) {
      if (event.kind !== "med") continue;
      const dose = asNumber(event.dose_value);
      if (dose <= 0) continue;
      const label = String(event.item_name || event.item_code || "Medication").trim();
      const unit = String(event.dose_unit || "mg").trim() || "mg";
      const key = `${event.kind}:${event.item_id}`;
      const bucket = byItem.get(key) || { label, unitTotals: new Map<string, number>() };
      bucket.unitTotals.set(unit, (bucket.unitTotals.get(unit) || 0) + dose);
      byItem.set(key, bucket);
    }

    for (const run of ioRuns) {
      if (run.kind !== "med" || run.entry_mode !== "drip" || !Array.isArray(run.segments)) continue;
      const runMeta = parseNoteTokens(run.note);
      const medAmount = parsePositiveNumber(runMeta.medAmount);
      const totalVolumeMl = parsePositiveNumber(runMeta.totalVolumeMl);
      const medUnit = String(runMeta.medUnit || run.item_unit || "mg").trim() || "mg";
      if (medAmount == null || totalVolumeMl == null || totalVolumeMl <= 0) continue;

      let deliveredDose = 0;
      for (const segment of run.segments) {
        if ((segment.include_in_balance ?? 1) === 0) continue;
        const startTs = Number(segment.ts_from);
        const endTs =
          segment.ts_to != null && Number.isFinite(Number(segment.ts_to))
            ? Number(segment.ts_to)
            : run.stopped_at != null && Number.isFinite(Number(run.stopped_at))
              ? Number(run.stopped_at)
              : nowTs;
        const rateMlHr = Number(segment.rate_value);
        if (!Number.isFinite(startTs) || !Number.isFinite(endTs) || endTs <= startTs) continue;
        if (!Number.isFinite(rateMlHr) || rateMlHr <= 0) continue;
        const infusedMl = ((endTs - startTs) / 3_600_000) * rateMlHr;
        if (!Number.isFinite(infusedMl) || infusedMl <= 0) continue;
        deliveredDose += (medAmount / totalVolumeMl) * infusedMl;
      }

      if (deliveredDose <= 0) continue;
      const key = `${run.kind}:${run.item_id}`;
      const label = String(run.item_name || run.item_code || "Medication").trim();
      const bucket = byItem.get(key) || { label, unitTotals: new Map<string, number>() };
      bucket.unitTotals.set(medUnit, (bucket.unitTotals.get(medUnit) || 0) + deliveredDose);
      byItem.set(key, bucket);
    }

    return Array.from(byItem.values())
      .map(item => ({
        label: item.label,
        totalText: Array.from(item.unitTotals.entries())
          .sort((a, b) => a[0].localeCompare(b[0]))
          .map(([unit, total]) => `${formatQuantity(total)} ${unit}`)
          .join(" + "),
        sortValue: Array.from(item.unitTotals.values()).reduce((sum, value) => sum + value, 0),
      }))
      .sort((a, b) => b.sortValue - a.sortValue || a.label.localeCompare(b.label))
      .slice(0, 8);
  }, [activeCase, ioEvents, ioRuns]);

  if (safeCaseStatus.status === "IDLE") {
    return (
      <div className="h-full p-3 bg-gray-50 dark:bg-gray-900 text-gray-700 dark:text-gray-300">
        <div className="text-sm font-medium">Event / Timeline</div>
        <div className="mt-2 text-xs text-gray-500 dark:text-gray-400">
          Start case to add timeline events and I/O entries.
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-gray-50 dark:bg-gray-900 text-gray-800 dark:text-gray-100">
      <div className="border-t border-gray-200 dark:border-gray-800 px-2 py-1">
        <button
          type="button"
          onClick={() => setIsTimelineMinimized(prev => !prev)}
          className="w-full flex items-center justify-between rounded px-1 py-1 text-xs font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800/60"
        >
          <span>Case Timeline</span>
          <span className="text-[10px] text-gray-500 dark:text-gray-400">
            {isTimelineMinimized ? "Show" : "Hide"}
          </span>
        </button>
      </div>

      {!isTimelineMinimized ? (
        <div className="flex-1 overflow-y-auto p-2 text-xs">
          {error ? (
            <div className="mb-2 text-[10px] text-red-600 dark:text-red-400 break-words">
              {error}
            </div>
          ) : null}
          {loading ? (
            <div className="text-gray-500 dark:text-gray-400">Loading...</div>
          ) : events.length === 0 ? (
            <div className="text-gray-500 dark:text-gray-400">No events yet</div>
          ) : (
            <div className="space-y-1">
              {events.map(item => {
                const d = formatDateHeader(item.event_ts);
                const showHeader = d !== lastDate;
                if (showHeader) lastDate = d;

                return (
                  <div
                    key={item.id}
                    className="rounded border border-gray-200 dark:border-gray-800 bg-white/70 dark:bg-gray-950/60 px-2 py-1"
                  >
                    {showHeader ? (
                      <div className="mb-1 text-[10px] font-medium text-gray-500 dark:text-gray-400">
                        {d}
                      </div>
                    ) : null}

                    <div className="flex items-start gap-2">
                      <div className="w-9 shrink-0 text-[10px] text-gray-600 dark:text-gray-400">
                        {formatHHMM(item.event_ts)}
                      </div>
                      <div
                        className="app-tooltip min-w-0 flex-1"
                        data-tooltip={eventTooltip(item)}
                      >
                        <div className="truncate flex items-center gap-1">
                          <span
                            className={`inline-flex rounded px-1 py-[1px] text-[9px] uppercase tracking-wide ${
                              item.event_type === "note"
                                ? "badge-note"
                                : "badge-event"
                            }`}
                          >
                            {item.event_type}
                          </span>
                          <span className="truncate">{item.title}</span>
                        </div>
                        {item.detail ? (
                          <div className="text-[10px] text-gray-500 dark:text-gray-400 line-clamp-2">
                            {item.detail}
                          </div>
                        ) : null}
                      </div>
                      <button
                        onClick={() => setPendingDeleteEvent(item)}
                        className="app-tooltip text-[10px] text-red-500 hover:text-red-600"
                        data-tooltip="Remove"
                      >
                        x
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      ) : null}

      <div className="border-t border-gray-200 dark:border-gray-800 px-2 py-1">
        <div className="w-full rounded px-1 py-1 text-xs font-medium text-gray-700 dark:text-gray-200">
          Medication Summary
        </div>
      </div>

      <div className="px-2 py-2 border-t border-gray-200 dark:border-gray-800 space-y-2 text-xs">
        <div className="rounded border border-gray-200 dark:border-gray-800 bg-white/70 dark:bg-gray-950/60 px-2 py-2 space-y-2">
          <div className="flex items-center justify-between text-[10px]">
            <span className="text-gray-600 dark:text-gray-300">Medication</span>
            <span className="text-[10px] text-gray-500 dark:text-gray-400">
              {medicationTotals.length > 0 ? `${medicationTotals.length} item${medicationTotals.length > 1 ? "s" : ""}` : "No medication yet"}
            </span>
          </div>
          {medicationTotals.length > 0 ? (
            <div className="max-h-28 overflow-y-auto space-y-1">
              {medicationTotals.map(item => (
                <div
                  key={item.label}
                  className="flex items-center justify-between gap-2 rounded border border-gray-200 dark:border-gray-800 bg-gray-50/70 dark:bg-gray-900/50 px-2 py-1.5"
                >
                  <span className="truncate text-[10px] font-medium">
                    {item.label}
                  </span>
                  <span className="shrink-0 text-[10px] font-semibold text-cyan-600 dark:text-cyan-300">
                    {item.totalText}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-[10px] text-gray-500 dark:text-gray-400">
              No medication charted yet
            </div>
          )}
        </div>
      </div>

      <div className="border-t border-gray-200 dark:border-gray-800 px-2 py-1">
        <button
          type="button"
          onClick={() => setIsIoMinimized(prev => !prev)}
          className="w-full flex items-center justify-between rounded px-1 py-1 text-xs font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800/60"
        >
          <span>Fluid Balance</span>
          <span className="text-[10px] text-gray-500 dark:text-gray-400">
            {isIoMinimized ? "Show" : "Hide"}
          </span>
        </button>
      </div>

      {!isIoMinimized ? (
        <div className="px-2 py-2 border-t border-gray-200 dark:border-gray-800 space-y-2 text-xs">
          {ioError ? (
            <div className="text-[10px] text-red-600 dark:text-red-400 break-words">
              {ioError}
            </div>
          ) : null}

          <div className="rounded border border-gray-200 dark:border-gray-800 bg-white/70 dark:bg-gray-950/60 px-2 py-2 space-y-2">
            <div className="space-y-1">
              <div className="flex items-center justify-between text-[10px]">
                <span className="text-gray-600 dark:text-gray-300">Intake</span>
                <span className="font-semibold">{formatMl(intakeMl)}</span>
              </div>
              <div className="h-1.5 overflow-hidden rounded bg-gray-200 dark:bg-gray-800">
                <div
                  className="h-full rounded bg-cyan-500/80"
                  style={{ width: `${intakePct}%` }}
                />
              </div>
            </div>

            <div className="space-y-1">
              <div className="flex items-center justify-between text-[10px]">
                <span className="text-gray-600 dark:text-gray-300">Output</span>
                <span className="font-semibold">{formatMl(outputMl)}</span>
              </div>
              <div className="h-1.5 overflow-hidden rounded bg-gray-200 dark:bg-gray-800">
                <div
                  className="h-full rounded bg-amber-500/80"
                  style={{ width: `${outputPct}%` }}
                />
              </div>
            </div>

            <div className="rounded border border-gray-200 dark:border-gray-800 bg-gray-50/70 dark:bg-gray-900/50 px-2 py-1.5">
              <div className="flex items-center justify-between text-[10px]">
                <span className="text-gray-600 dark:text-gray-300">Net</span>
                <span className={`text-xs font-semibold ${netClass}`}>
                  {formatSignedMl(netMl)}
                </span>
              </div>
            </div>

            {intakeItemTotals.length > 0 ? (
              <div className="rounded border border-gray-200 dark:border-gray-800 bg-gray-50/70 dark:bg-gray-900/50 px-2 py-1.5">
                <div className="max-h-24 overflow-y-auto space-y-0.5">
                  {intakeItemTotals.map(item => (
                    <div key={`${item.kind}-${item.item_id}-${item.item_code}`} className="flex items-center justify-between text-[10px]">
                      <span className="truncate pr-2">{item.item_name || item.item_code || "Item"}</span>
                      <span className="font-semibold">{formatQuantityWithUnit(item.total_ml, item.item_unit)}</span>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </div>

          {ioLoading ? (
            <div className="text-[11px] text-gray-500 dark:text-gray-400">Loading...</div>
          ) : null}
        </div>
      ) : null}

      <div className="border-t border-gray-200 dark:border-gray-800 px-2 py-1">
        <button
          type="button"
          onClick={() => setIsStaffMinimized(prev => !prev)}
          className="w-full flex items-center justify-between rounded px-1 py-1 text-xs font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800/60"
        >
          <span>Staff</span>
          <span className="text-[10px] text-gray-500 dark:text-gray-400">
            {isStaffMinimized ? "Show" : "Hide"}
          </span>
        </button>
      </div>

      {!isStaffMinimized ? (
        <div className="px-2 py-2 border-t border-gray-200 dark:border-gray-800">
          {staffLoading ? (
            <div className="text-[11px] text-gray-500 dark:text-gray-400">Loading...</div>
          ) : staffError ? (
            <div className="text-[11px] text-red-600 dark:text-red-400 break-words">
              {staffError}
            </div>
          ) : staffRows.length === 0 ? (
            <div className="text-[11px] text-gray-500 dark:text-gray-400">
              No staff assigned yet
            </div>
          ) : (
            <div className="max-h-36 overflow-y-auto space-y-1">
              {staffRows.map((row, index) => (
                <div
                  key={`${row.name}-${row.role}-${row.hospital_id || "-"}-${index}`}
                  className="app-tooltip rounded border border-gray-200 dark:border-gray-800 bg-white/70 dark:bg-gray-950/60 px-2 py-1"
                  data-tooltip={staffTooltip(row)}
                >
                  <div className="truncate text-[11px]">{row.name}</div>
                  <div className="truncate text-[10px] text-gray-500 dark:text-gray-400">
                    {row.role}
                    {row.hospital_id ? ` | ID ${row.hospital_id}` : ""}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : null}

      <ConfirmDialog
        open={pendingDeleteEvent != null}
        title="Remove Timeline Entry?"
        message={
          pendingDeleteEvent
            ? `${pendingDeleteEvent.event_type.toUpperCase()} ${pendingDeleteEvent.title}\n${formatHHMM(
                pendingDeleteEvent.event_ts,
              )}`
            : ""
        }
        confirmLabel="Remove"
        busy={isDeletingEvent}
        onCancel={() => setPendingDeleteEvent(null)}
        onConfirm={handleDelete}
      />
    </div>
  );
}
