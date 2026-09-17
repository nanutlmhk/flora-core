import {
  WORKSTATION_CONTEXT_STORAGE_KEY,
  type WorkstationContext,
} from "../api/workstationApi";

export type DateTimePreferences = Pick<
  WorkstationContext,
  "timezone" | "dateFormat" | "timeFormat"
>;

export const DEFAULT_DATE_TIME_PREFERENCES: DateTimePreferences = {
  timezone: "Asia/Bangkok",
  dateFormat: "DD/MM/YYYY",
  timeFormat: "24h",
};

export function getStoredDateTimePreferences(): DateTimePreferences {
  try {
    const stored = JSON.parse(window.localStorage.getItem(WORKSTATION_CONTEXT_STORAGE_KEY) || "null") as Partial<DateTimePreferences> | null;
    return {
      timezone: stored?.timezone || DEFAULT_DATE_TIME_PREFERENCES.timezone,
      dateFormat: stored?.dateFormat || DEFAULT_DATE_TIME_PREFERENCES.dateFormat,
      timeFormat: stored?.timeFormat || DEFAULT_DATE_TIME_PREFERENCES.timeFormat,
    };
  } catch {
    return DEFAULT_DATE_TIME_PREFERENCES;
  }
}

type WallClockParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
};

function wallClockParts(timestamp: number, timezone: string): WallClockParts | null {
  if (!Number.isFinite(timestamp)) return null;
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(timestamp);
    const read = (type: Intl.DateTimeFormatPartTypes) =>
      Number(parts.find(part => part.type === type)?.value);
    const result = {
      year: read("year"),
      month: read("month"),
      day: read("day"),
      hour: read("hour"),
      minute: read("minute"),
    };
    return Object.values(result).every(Number.isFinite) ? result : null;
  } catch {
    return wallClockParts(timestamp, DEFAULT_DATE_TIME_PREFERENCES.timezone);
  }
}

const pad2 = (value: number) => String(value).padStart(2, "0");

export function timestampToWallClockInput(timestamp: number, timezone: string): string {
  const parts = wallClockParts(timestamp, timezone);
  if (!parts) return "";
  return `${parts.year}-${pad2(parts.month)}-${pad2(parts.day)}T${pad2(parts.hour)}:${pad2(parts.minute)}`;
}

function timezoneOffsetAt(timestamp: number, timezone: string): number {
  const parts = wallClockParts(timestamp, timezone);
  if (!parts) return 0;
  const roundedTimestamp = Math.floor(timestamp / 60_000) * 60_000;
  return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute) - roundedTimestamp;
}

export function wallClockInputToTimestamp(value: string, timezone: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const [, year, month, day, hour, minute] = match.map(Number);
  const utcGuess = Date.UTC(year, month - 1, day, hour, minute);
  let timestamp = utcGuess - timezoneOffsetAt(utcGuess, timezone);
  timestamp = utcGuess - timezoneOffsetAt(timestamp, timezone);
  return timestampToWallClockInput(timestamp, timezone) === value ? timestamp : null;
}

export function formatConfiguredDate(timestamp: number, preferences: DateTimePreferences): string {
  const parts = wallClockParts(timestamp, preferences.timezone);
  if (!parts) return "—";
  const day = pad2(parts.day);
  const month = pad2(parts.month);
  if (preferences.dateFormat === "MM/DD/YYYY") return `${month}/${day}/${parts.year}`;
  if (preferences.dateFormat === "YYYY-MM-DD") return `${parts.year}-${month}-${day}`;
  return `${day}/${month}/${parts.year}`;
}

export function formatConfiguredTime(timestamp: number, preferences: DateTimePreferences): string {
  const parts = wallClockParts(timestamp, preferences.timezone);
  if (!parts) return "—";
  if (preferences.timeFormat === "24h") return `${pad2(parts.hour)}:${pad2(parts.minute)}`;
  const period = parts.hour >= 12 ? "PM" : "AM";
  return `${parts.hour % 12 || 12}:${pad2(parts.minute)} ${period}`;
}

export function formatConfiguredDateTime(timestamp: number, preferences: DateTimePreferences): string {
  return `${formatConfiguredDate(timestamp, preferences)} ${formatConfiguredTime(timestamp, preferences)}`;
}
