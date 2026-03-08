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
  getCaseIoSummary,
  type CaseIoSummaryTotals,
} from "../api/caseIoApi";
import {
  getDeviceStatus,
  type DeviceStatusSnapshot,
} from "../api/deviceStatusApi";

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

function asMl(value: unknown) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
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

function formatAgoFromSeconds(seconds: number | null) {
  if (seconds == null || !Number.isFinite(seconds)) return "-";
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function latestValueText(snapshot: DeviceStatusSnapshot["devices"][number]) {
  const latest = snapshot.latest_observation;
  if (!latest) return "-";
  const value = latest.value == null ? "-" : String(latest.value);
  const unit = latest.unit ? ` ${latest.unit}` : "";
  const label = latest.raw_code || latest.ivy_param || "";
  return label ? `${label}: ${value}${unit}` : `${value}${unit}`;
}

function latestLogicalValueText(
  snapshot: NonNullable<DeviceStatusSnapshot["logical_devices"]>[number],
) {
  const latest = snapshot.latest_observation;
  if (!latest) return "-";
  const value = latest.value == null ? "-" : String(latest.value);
  const unit = latest.unit ? ` ${latest.unit}` : "";
  const label = latest.raw_code || latest.ivy_param || "";
  return label ? `${label}: ${value}${unit}` : `${value}${unit}`;
}

function isNetworkFetchError(err: unknown) {
  const msg = err instanceof Error ? err.message : String(err || "");
  const text = msg.toLowerCase();
  return (
    text.includes("failed to fetch") ||
    text.includes("fetch failed") ||
    text.includes("networkerror") ||
    text.includes("econnrefused") ||
    text.includes("enotfound") ||
    text.includes("timeout")
  );
}

function makeOfflineDeviceSnapshot(
  previous: DeviceStatusSnapshot | null,
): DeviceStatusSnapshot {
  const now = Date.now();
  return {
    server_ts: now,
    server_uptime_sec: previous?.server_uptime_sec ?? 0,
    online_window_sec: previous?.online_window_sec ?? 30,
    summary: {
      total_observations: previous?.summary?.total_observations ?? 0,
      last_observation_ts: previous?.summary?.last_observation_ts ?? null,
      total_devices: previous?.summary?.total_devices ?? 2,
      online_devices: 0,
    },
    liveagent: {
      online: false,
      device_count: previous?.liveagent?.device_count ?? 0,
      last_seen_ts: previous?.liveagent?.last_seen_ts ?? null,
    },
    logical_devices: [
      {
        id: "patient_monitor",
        label: "Patient Monitor",
        is_online: false,
        status: "offline",
        last_seen_ts: null,
        seconds_since_last: null,
        total_samples: 0,
        samples_in_window: 0,
        device_count: 0,
        device_ids: [],
        latest_observation: null,
      },
      {
        id: "anesthesia_machine",
        label: "Anesthesia Machine",
        is_online: false,
        status: "offline",
        last_seen_ts: null,
        seconds_since_last: null,
        total_samples: 0,
        samples_in_window: 0,
        device_count: 0,
        device_ids: [],
        latest_observation: null,
      },
    ],
    devices: [],
  };
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
  const devicePrefKey = `aidas.rightRail.${prefScope}.deviceMinimized`;
  const [isStaffMinimized, setIsStaffMinimized] = useState(() =>
    readSectionPref(staffPrefKey, false),
  );
  const [isTimelineMinimized, setIsTimelineMinimized] = useState(() =>
    readSectionPref(timelinePrefKey, false),
  );
  const [isIoMinimized, setIsIoMinimized] = useState(() =>
    readSectionPref(ioPrefKey, false),
  );
  const [isDeviceMinimized, setIsDeviceMinimized] = useState(() =>
    readSectionPref(devicePrefKey, false),
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
  const [isIoItemTotalsDetailOpen, setIsIoItemTotalsDetailOpen] = useState(true);
  const [deviceLoading, setDeviceLoading] = useState(false);
  const [deviceError, setDeviceError] = useState("");
  const [deviceStatus, setDeviceStatus] = useState<DeviceStatusSnapshot | null>(null);

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
    setIsDeviceMinimized(readSectionPref(devicePrefKey, false));
  }, [devicePrefKey, ioPrefKey, staffPrefKey, timelinePrefKey]);

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
    if (typeof window === "undefined") return;
    window.localStorage.setItem(devicePrefKey, isDeviceMinimized ? "1" : "0");
  }, [devicePrefKey, isDeviceMinimized]);

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
            : Date.now() + 24 * 60 * 60 * 1000;
        const summary = await getCaseIoSummary(caseInfo.case_id, fromTs, toTs);
        if (!alive) return;
        setIoSummary(summary);
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

  useEffect(() => {
    if (!activeCase) {
      setDeviceStatus(null);
      setDeviceError("");
      return;
    }

    let alive = true;

    async function loadDeviceStatus(isInitial = false) {
      if (isInitial) setDeviceLoading(true);
      setDeviceError("");
      try {
        const snapshot = await getDeviceStatus(30);
        if (!alive) return;
        setDeviceError("");
        setDeviceStatus(snapshot);
      } catch (err) {
        if (!alive) return;
        // If IVY is simply down/unreachable, render device panel as offline
        // instead of surfacing noisy fetch errors to users.
        if (isNetworkFetchError(err)) {
          setDeviceError("");
          setDeviceStatus(prev => makeOfflineDeviceSnapshot(prev));
          return;
        }
        setDeviceError("");
        setDeviceStatus(prev => makeOfflineDeviceSnapshot(prev));
      } finally {
        if (alive && isInitial) setDeviceLoading(false);
      }
    }

    void loadDeviceStatus(true);
    const timer = setInterval(() => {
      void loadDeviceStatus(false);
    }, 10_000);

    return () => {
      alive = false;
      clearInterval(timer);
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
    .filter(item => item.kind !== "output" && asMl(item.total_ml) > 0)
    .sort((a, b) => asMl(b.total_ml) - asMl(a.total_ml) || a.item_name.localeCompare(b.item_name));

  return (
    <div className="h-full flex flex-col bg-gray-50 dark:bg-gray-900 text-gray-800 dark:text-gray-100">
      <div className="border-t border-gray-200 dark:border-gray-800 px-2 py-1">
        <button
          type="button"
          onClick={() => setIsDeviceMinimized(prev => !prev)}
          className="w-full flex items-center justify-between rounded px-1 py-1 text-xs font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800/60"
        >
          <span>Device(s)</span>
          <span className="text-[10px] text-gray-500 dark:text-gray-400">
            {isDeviceMinimized ? "Show" : "Hide"}
          </span>
        </button>
      </div>

      {!isDeviceMinimized ? (
        <div className="px-2 py-2 border-t border-gray-200 dark:border-gray-800 space-y-2 text-xs">
          {deviceError ? (
            <div className="text-[10px] text-red-600 dark:text-red-400 break-words">
              {deviceError}
            </div>
          ) : null}
          {deviceLoading && !deviceStatus ? (
            <div className="text-[11px] text-gray-500 dark:text-gray-400">Loading...</div>
          ) : null}
          {deviceStatus ? (
            <>
              <div className="max-h-40 overflow-y-auto space-y-1">
                {deviceStatus.logical_devices && deviceStatus.logical_devices.length > 0 ? (
                  deviceStatus.logical_devices
                    .filter(
                      device =>
                        device.id === "patient_monitor" ||
                        device.id === "anesthesia_machine",
                    )
                    .map(device => (
                      <div
                        key={device.id}
                        className="rounded border border-gray-200 dark:border-gray-800 bg-white/70 dark:bg-gray-950/60 px-2 py-1"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="truncate text-[11px]">{device.label}</div>
                          <div
                            className={`text-[10px] font-medium ${
                              device.is_online
                                ? "text-emerald-600 dark:text-emerald-300"
                                : "text-rose-600 dark:text-rose-300"
                            }`}
                          >
                            {device.is_online ? "Online" : "Offline"}
                          </div>
                        </div>
                        <div className="truncate text-[10px] text-gray-500 dark:text-gray-400">
                          {latestLogicalValueText(device)} | {formatAgoFromSeconds(device.seconds_since_last)}
                        </div>
                      </div>
                    ))
                ) : (
                  <>
                    {deviceStatus.devices.length === 0 ? (
                      <div className="text-[11px] text-gray-500 dark:text-gray-400">
                        No device data yet
                      </div>
                    ) : (
                      deviceStatus.devices.map(device => (
                        <div
                          key={device.device_key}
                          className="rounded border border-gray-200 dark:border-gray-800 bg-white/70 dark:bg-gray-950/60 px-2 py-1"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <div className="truncate text-[11px]">
                              {device.device_id || device.device_key}
                            </div>
                            <div
                              className={`text-[10px] font-medium ${
                                device.is_online
                                  ? "text-emerald-600 dark:text-emerald-300"
                                  : "text-rose-600 dark:text-rose-300"
                              }`}
                            >
                              {device.is_online ? "Online" : "Offline"}
                            </div>
                          </div>
                          <div className="truncate text-[10px] text-gray-500 dark:text-gray-400">
                            {latestValueText(device)} | {formatAgoFromSeconds(device.seconds_since_last)}
                          </div>
                        </div>
                      ))
                    )}
                  </>
                )}
              </div>
            </>
          ) : null}
        </div>
      ) : null}

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
              <div className="rounded border border-gray-200 dark:border-gray-800 bg-gray-50/70 dark:bg-gray-900/50 px-2 py-1.5 space-y-1">
                <div className="flex items-center justify-between">
                  <div className="text-[10px] text-gray-600 dark:text-gray-300">Detail</div>
                  <button
                    type="button"
                    onClick={() => setIsIoItemTotalsDetailOpen(prev => !prev)}
                    className="inline-flex items-center gap-1 rounded px-1 py-0.5 text-[10px] text-gray-600 dark:text-gray-300 hover:bg-gray-200/70 dark:hover:bg-gray-800/70"
                    aria-label={isIoItemTotalsDetailOpen ? "Hide detail" : "Show detail"}
                  >
                    <span className="w-3 text-center font-semibold">{isIoItemTotalsDetailOpen ? "-" : "+"}</span>
                  </button>
                </div>
                {isIoItemTotalsDetailOpen ? (
                  <div className="max-h-24 overflow-y-auto space-y-0.5">
                    {intakeItemTotals.map(item => (
                      <div key={`${item.kind}-${item.item_id}-${item.item_code}`} className="flex items-center justify-between text-[10px]">
                        <span className="truncate pr-2">{item.item_name || item.item_code || "Item"}</span>
                        <span className="font-semibold">{formatQuantityWithUnit(item.total_ml, item.item_unit)}</span>
                      </div>
                    ))}
                  </div>
                ) : null}
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
