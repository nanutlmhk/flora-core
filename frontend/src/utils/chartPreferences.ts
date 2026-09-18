export const CHART_PREFERENCES_CHANGED_EVENT = "flora:chart-preferences-changed";

export type ChartPreferenceGroup =
  | "spo2"
  | "hr"
  | "pr"
  | "nibp"
  | "art"
  | "cvp"
  | "temp";

const AVAILABLE_GROUPS = new Set<ChartPreferenceGroup>([
  "spo2",
  "hr",
  "pr",
  "nibp",
  "art",
  "cvp",
  "temp",
]);

export function chartVisibilityStorageKey(username: string): string {
  return `flora.chartVisibility.${username || "guest"}`;
}

export function accountParameterToChartGroup(value: unknown): ChartPreferenceGroup | null {
  const key = String(value || "").trim().toLowerCase();
  if (key === "temperature") return "temp";
  return AVAILABLE_GROUPS.has(key as ChartPreferenceGroup) ? key as ChartPreferenceGroup : null;
}

export function chartGroupToAccountParameter(value: unknown): string | null {
  const group = accountParameterToChartGroup(value);
  return group === "temp" ? "temperature" : group;
}

export function normalizeChartGroups(value: unknown): ChartPreferenceGroup[] | null {
  if (!Array.isArray(value)) return null;
  return [...new Set(value.map(accountParameterToChartGroup).filter((item): item is ChartPreferenceGroup => item != null))];
}

export function readLocalChartGroups(username: string): ChartPreferenceGroup[] | null {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(chartVisibilityStorageKey(username));
  if (raw == null) return null;
  try {
    return normalizeChartGroups(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function readLocalSmartContrast(username: string): boolean | null {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(`${chartVisibilityStorageKey(username)}.smartContrast`);
  return raw == null ? null : raw !== "0";
}

export function applyChartPreferencesLocally({
  username,
  timeScaleMin,
  visibleParameters,
  smartContrast,
}: {
  username: string;
  timeScaleMin: number;
  visibleParameters: unknown;
  smartContrast: boolean;
}) {
  if (typeof window === "undefined") return;
  const chartGroups = normalizeChartGroups(visibleParameters) || [];
  const storageKey = chartVisibilityStorageKey(username);
  window.localStorage.setItem(`flora.timelineScale.${username || "guest"}`, String(timeScaleMin));
  window.localStorage.setItem("flora.timelineScale", String(timeScaleMin));
  window.localStorage.setItem(storageKey, JSON.stringify(chartGroups));
  window.localStorage.setItem(`${storageKey}.smartContrast`, smartContrast ? "1" : "0");
  window.dispatchEvent(new CustomEvent(CHART_PREFERENCES_CHANGED_EVENT, {
    detail: { username, timeScaleMin, visibleGroups: chartGroups, smartContrast },
  }));
}
