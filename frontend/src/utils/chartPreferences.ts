export const CHART_PREFERENCES_CHANGED_EVENT = "flora:chart-preferences-changed";
export const DEFAULT_FUTURE_COLUMNS = 2;
export const MAX_FUTURE_COLUMNS = 12;

export const DRIP_GROUP_OPTIONS = [
  { key: "iv-anesthetic", label: "IV anesthetic", color: "#60A5FA" },
  { key: "nmbd", label: "NMBD", color: "#34D399" },
  { key: "opioid", label: "Opioid", color: "#C084FC" },
  { key: "cv-drug", label: "CV drug", color: "#FB7185" },
  { key: "antibiotic", label: "Antibiotic", color: "#FBBF24" },
  { key: "anti-emetic", label: "Anti-emetic", color: "#22C55E" },
  { key: "analgesic", label: "Analgesic", color: "#F97316" },
  { key: "anticholinergic", label: "Anticholinergic", color: "#F59E0B" },
  { key: "reversal", label: "Reversal", color: "#A78BFA" },
  { key: "local-anesthetic", label: "Local anesthetic", color: "#14B8A6" },
  { key: "fluid", label: "Fluid", color: "#22D3EE" },
  { key: "other", label: "Other", color: "#94A3B8" },
] as const;

export type DripGroupTone = (typeof DRIP_GROUP_OPTIONS)[number]["key"];
export type DripGroupColors = Record<DripGroupTone, string>;

export const DEFAULT_DRIP_GROUP_COLORS: DripGroupColors = Object.fromEntries(
  DRIP_GROUP_OPTIONS.map(option => [option.key, option.color]),
) as DripGroupColors;

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

function futureColumnsStorageKey(username: string): string {
  return `flora.timelineFutureColumns.${username || "guest"}`;
}

function dripGroupColorsStorageKey(username: string): string {
  return `flora.dripGroupColors.${username || "guest"}`;
}

function normalizeHexColor(value: unknown): string | null {
  const color = String(value || "").trim();
  return /^#[0-9a-f]{6}$/i.test(color) ? color.toUpperCase() : null;
}

export function normalizeDripGroupColors(value: unknown): DripGroupColors {
  const source = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return Object.fromEntries(
    DRIP_GROUP_OPTIONS.map(option => [
      option.key,
      normalizeHexColor(source[option.key]) || option.color,
    ]),
  ) as DripGroupColors;
}

export function readLocalDripGroupColors(username: string): DripGroupColors | null {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(dripGroupColorsStorageKey(username));
  if (raw == null) return null;
  try {
    return normalizeDripGroupColors(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function normalizeFutureColumns(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_FUTURE_COLUMNS;
  return Math.min(MAX_FUTURE_COLUMNS, Math.max(0, Math.round(parsed)));
}

export function readLocalFutureColumns(username: string): number | null {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(futureColumnsStorageKey(username));
  return raw == null ? null : normalizeFutureColumns(raw);
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
  futureColumns,
  visibleParameters,
  smartContrast,
  dripGroupColors,
}: {
  username: string;
  timeScaleMin: number;
  futureColumns: number;
  visibleParameters: unknown;
  smartContrast: boolean;
  dripGroupColors: unknown;
}) {
  if (typeof window === "undefined") return;
  const chartGroups = normalizeChartGroups(visibleParameters) || [];
  const storageKey = chartVisibilityStorageKey(username);
  window.localStorage.setItem(`flora.timelineScale.${username || "guest"}`, String(timeScaleMin));
  window.localStorage.setItem("flora.timelineScale", String(timeScaleMin));
  window.localStorage.setItem(futureColumnsStorageKey(username), String(normalizeFutureColumns(futureColumns)));
  window.localStorage.setItem(storageKey, JSON.stringify(chartGroups));
  window.localStorage.setItem(`${storageKey}.smartContrast`, smartContrast ? "1" : "0");
  const normalizedDripGroupColors = normalizeDripGroupColors(dripGroupColors);
  window.localStorage.setItem(dripGroupColorsStorageKey(username), JSON.stringify(normalizedDripGroupColors));
  window.dispatchEvent(new CustomEvent(CHART_PREFERENCES_CHANGED_EVENT, {
    detail: { username, timeScaleMin, futureColumns: normalizeFutureColumns(futureColumns), visibleGroups: chartGroups, smartContrast, dripGroupColors: normalizedDripGroupColors },
  }));
}
