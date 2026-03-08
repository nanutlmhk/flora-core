import type { TimeGridRow } from "../../components/timegrid/types";
import type { ComponentType, SVGProps } from "react";
import {
  AntibioticIcon,
  BloodIcon,
  EndAnesthesiaIcon,
  EndSurgeryIcon,
  InductionIcon,
  ReversalIcon,
  StartAnesthesiaIcon,
  StartSurgeryIcon,
  TimeoutIcon,
} from "../../assets/icons";

type SvgIcon = ComponentType<SVGProps<SVGSVGElement>>;

export const AXIS_STEPS = [1, 3, 5, 15] as const;
export type AxisStepMin = (typeof AXIS_STEPS)[number];
export const DEFAULT_AXIS_STEP: AxisStepMin = 1;
export type RowGroup = "core" | "measured" | "set";

export const BASE_IVY_ROWS: TimeGridRow[] = [
  // --- 1. Vital Signs (Core - No Badge) ---
  { id: "hr", label: "HR", type: "vital", unit: "bpm" },
  { id: "spo2", label: "SpO2", type: "vital", unit: "%" },
  { id: "nibp_sys", label: "NIBP Sys", type: "vital", unit: "mmHg" },
  { id: "nibp_map", label: "NIBP Map", type: "vital", unit: "mmHg" },
  { id: "nibp_dia", label: "NIBP Dia", type: "vital", unit: "mmHg" },
  { id: "art_sys", label: "ART Sys", type: "vital", unit: "mmHg" },
  { id: "art_map", label: "ART Map", type: "vital", unit: "mmHg" },
  { id: "art_dia", label: "ART Dia", type: "vital", unit: "mmHg" },
  { id: "cvp", label: "CVP", type: "vital", unit: "mmHg" },
  { id: "temperature", label: "Temp", type: "vital", unit: "C" },

  // --- 2. Set Ventilator Parameters ([S] Badge) ---
  { id: "set_vent_mode", label: "Vent Mode", type: "vital" },
  { id: "set_tidal_volume", label: "Tidal Volume", type: "vital", unit: "mL" },
  { id: "set_rr", label: "RR", type: "vital", unit: "rpm" },
  { id: "set_peep", label: "PEEP", type: "vital", unit: "cmH2O" },
  { id: "set_psupp", label: "Pressure Support", type: "vital", unit: "cmH2O" },
  { id: "set_fio2", label: "FiO2", type: "vital", unit: "%" },
  { id: "set_fgf_total", label: "Fresh Gas Flow", type: "vital", unit: "L/min" },

  // --- 3. Measured Ventilator Parameters ([M] Badge) ---
  { id: "rr", label: "RR", type: "vital", unit: "rpm" },
  { id: "etco2", label: "EtCO2", type: "vital", unit: "mmHg" },
  { id: "fio2", label: "FiO2", type: "vital", unit: "%" },
  { id: "fi_co2", label: "FiCO2", type: "vital", unit: "mmHg" },
  { id: "et_o2", label: "EtO2", type: "vital", unit: "%" },
  { id: "fi_agent", label: "FiAgent", type: "vital", unit: "%" },
  { id: "tidal_volume_exp", label: "TV Exp", type: "vital", unit: "mL" },
  { id: "minute_volume_exp", label: "MV Exp", type: "vital", unit: "L/min" },
  { id: "airway_pressure_peak", label: "Ppeak", type: "vital", unit: "cmH2O" },
  { id: "airway_pressure_plateau", label: "Pplat", type: "vital", unit: "cmH2O" },
  { id: "airway_pressure_mean", label: "Pmean", type: "vital", unit: "cmH2O" },
  { id: "airway_pressure_min", label: "Pmin", type: "vital", unit: "cmH2O" },
  { id: "peep_total", label: "Total PEEP", type: "vital", unit: "cmH2O" },
  { id: "compliance", label: "Compliance", type: "vital", unit: "mL/cmH2O" },
  { id: "mac", label: "MAC", type: "vital", unit: "ratio" },
  { id: "et_agent", label: "EtAgent", type: "vital", unit: "%" },
];

const CORE_ROW_IDS = new Set([
  "hr",
  "spo2",
  "nibp_sys",
  "nibp_map",
  "nibp_dia",
  "art_sys",
  "art_map",
  "art_dia",
  "art_pr",
  "cvp",
  "temperature",
]);

export const ROW_META: Record<string, { label: string; unit?: string }> = {
  // Measured
  fio2: { label: "FiO2", unit: "%" },
  etco2: { label: "EtCO2", unit: "mmHg" },
  rr: { label: "RR", unit: "rpm" },
  et_o2: { label: "EtO2", unit: "%" },
  eto2: { label: "EtO2", unit: "%" },
  fi_co2: { label: "FiCO2", unit: "mmHg" },
  fico2: { label: "FiCO2", unit: "mmHg" },
  fi_agent: { label: "FiAgent", unit: "%" },
  fiaa: { label: "FiAgent", unit: "%" },
  et_agent: { label: "EtAgent", unit: "%" },
  etaa: { label: "EtAgent", unit: "%" },
  mac: { label: "MAC", unit: "ratio" },
  tidal_volume_exp: { label: "TV Exp", unit: "mL" },
  minute_volume_exp: { label: "MV Exp", unit: "L/min" },
  airway_pressure_peak: { label: "Ppeak", unit: "cmH2O" },
  airway_pressure_plateau: { label: "Pplat", unit: "cmH2O" },
  airway_pressure_mean: { label: "Pmean", unit: "cmH2O" },
  airway_pressure_min: { label: "Pmin", unit: "cmH2O" },
  peep_total: { label: "Total PEEP", unit: "cmH2O" },
  compliance: { label: "Compliance", unit: "mL/cmH2O" },

  // Settings
  set_vent_mode: { label: "Vent Mode" },
  set_tidal_volume: { label: "Tidal Volume", unit: "mL" },
  set_rr: { label: "RR", unit: "rpm" },
  set_peep: { label: "PEEP", unit: "cmH2O" },
  set_psupp: { label: "Pressure Support", unit: "cmH2O" },
  set_fio2: { label: "FiO2", unit: "%" },
  set_fgf_total: { label: "Fresh Gas Flow", unit: "L/min" },
  set_total_fg_flow: { label: "Fresh Gas Flow", unit: "L/min" },
};

export function makeFallbackLabel(rowId: string) {
  return rowId
    .replace(/set_/g, "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (l) => l.toUpperCase());
}

export function getRowGroup(rowId: string): RowGroup {
  if (rowId.startsWith("set_")) return "set";
  if (CORE_ROW_IDS.has(rowId)) return "core";
  return "measured";
}

export const COMMON_EVENT_OPTIONS = [
  "Start ANE",
  "Induction",
  "SSI Prophylaxis",
  "Blood Product",
  "Time Out",
  "Start Surgery",
  "End Surgery",
  "Reversal",
  "End ANE",
] as const;

export type CommonEventOption = (typeof COMMON_EVENT_OPTIONS)[number];

export const MANUAL_EVENT_BUTTON_LAYOUT: Array<{
  title: CommonEventOption;
  icon: SvgIcon;
  shortLabel: string;
}> = [
  { title: "Time Out", icon: TimeoutIcon, shortLabel: "TimeOut" },
  { title: "Start ANE", icon: StartAnesthesiaIcon, shortLabel: "Start Anes" },
  { title: "Start Surgery", icon: StartSurgeryIcon, shortLabel: "Start Surg" },
  { title: "End Surgery", icon: EndSurgeryIcon, shortLabel: "End Surg" },
  { title: "End ANE", icon: EndAnesthesiaIcon, shortLabel: "End Anes" },
];

const AUTO_EVENT_TITLES = new Set<CommonEventOption>([
  "Induction",
  "SSI Prophylaxis",
  "Blood Product",
  "Reversal",
]);

export function isAutoEventTitle(title: string): boolean {
  return AUTO_EVENT_TITLES.has(title as CommonEventOption);
}

export function getEventIconByTitle(title: string): SvgIcon | null {
  const normalized = normalizeLifecycleTitle(title);
  if (
    normalized === "start ane" ||
    normalized === "start anes" ||
    normalized === "start anesthesia" ||
    normalized === "start anaesthesia"
  ) {
    return StartAnesthesiaIcon;
  }
  if (
    normalized === "end ane" ||
    normalized === "end anes" ||
    normalized === "end anesthesia" ||
    normalized === "end anaesthesia"
  ) {
    return EndAnesthesiaIcon;
  }
  if (normalized === "start surg" || normalized === "start surgery") return StartSurgeryIcon;
  if (normalized === "end surg" || normalized === "end surgery") return EndSurgeryIcon;
  if (normalized === "induction") return InductionIcon;
  if (normalized === "ssi prophylaxis") return AntibioticIcon;
  if (normalized === "blood product") return BloodIcon;
  if (normalized === "reversal") return ReversalIcon;
  if (normalized === "time out") return TimeoutIcon;
  return null;
}

const LIFECYCLE_EVENT_ALIASES = {
  ane: {
    start: new Set([
      "start ane",
      "start anes",
      "start anesthesia",
      "start anaesthesia",
    ]),
    end: new Set(["end ane", "end anes", "end anesthesia", "end anaesthesia"]),
  },
  surg: {
    start: new Set(["start surg", "start surgery"]),
    end: new Set(["end surg", "end surgery"]),
  },
} as const;

export function normalizeLifecycleTitle(value: string) {
  return String(value || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

export function parseLifecycleEventTitle(title: string) {
  const normalized = normalizeLifecycleTitle(title);
  for (const scope of Object.keys(LIFECYCLE_EVENT_ALIASES) as Array<"ane" | "surg">) {
    const aliases = LIFECYCLE_EVENT_ALIASES[scope];
    if (aliases.start.has(normalized)) return { scope, phase: "start" as const };
    if (aliases.end.has(normalized)) return { scope, phase: "end" as const };
  }
  return null;
}
