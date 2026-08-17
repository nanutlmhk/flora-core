import { AXIS_STEPS, DEFAULT_AXIS_STEP, type AxisStepMin } from "./constants";

function parseAxisStep(raw: string | null): AxisStepMin | null {
  const n = Number(raw);
  if (AXIS_STEPS.includes(n as AxisStepMin)) return n as AxisStepMin;
  return null;
}

export function readStoredUsername(): string {
  if (typeof window === "undefined") return "guest";

  const raw = localStorage.getItem("flora_user");
  if (!raw) return "guest";

  try {
    const parsed = JSON.parse(raw) as { username?: unknown };
    const username =
      typeof parsed.username === "string" ? parsed.username.trim() : "";
    return username || "guest";
  } catch {
    return "guest";
  }
}

export function getTimelineScaleStorageKey(username: string) {
  return `aidas.timelineScale.${username}`;
}

export function getHiddenRowsStorageKey(username: string) {
  return `aidas.hiddenRows.${username}`;
}

export function getVisibleRowsStorageKey(username: string) {
  return `aidas.visibleRows.${username}`;
}

export function getChartVisibilityStorageKey(username: string) {
  return `aidas.chartVisible.${username}`;
}

export function readTimelineScaleForUser(username: string): AxisStepMin {
  if (typeof window === "undefined") return DEFAULT_AXIS_STEP;

  const userStep = parseAxisStep(
    localStorage.getItem(getTimelineScaleStorageKey(username)),
  );
  if (userStep != null) return userStep;

  const legacyStep = parseAxisStep(localStorage.getItem("aidas.timelineScale"));
  return legacyStep ?? DEFAULT_AXIS_STEP;
}

export function readHiddenRowsForUser(username: string): string[] {
  if (typeof window === "undefined") return [];

  const keys = [
    getHiddenRowsStorageKey(username),
    "aidas.hiddenRows",
  ];

  for (const key of keys) {
    const raw = localStorage.getItem(key);
    if (!raw) continue;
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed)) continue;
      return parsed
        .map(item => (typeof item === "string" ? item.trim() : ""))
        .filter(Boolean);
    } catch {
      // ignore invalid localStorage payload
    }
  }

  return [];
}

export function readVisibleRowsForUser(username: string): string[] | null {
  if (typeof window === "undefined") return null;

  const keys = [
    getVisibleRowsStorageKey(username),
    "aidas.visibleRows",
  ];

  for (const key of keys) {
    const raw = localStorage.getItem(key);
    if (!raw) continue;
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed)) continue;
      return parsed
        .map(item => (typeof item === "string" ? item.trim() : ""))
        .filter(Boolean);
    } catch {
      // ignore invalid localStorage payload
    }
  }

  return null;
}
