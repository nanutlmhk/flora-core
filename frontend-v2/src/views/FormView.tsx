import { useCallback, useEffect, useMemo, useState } from "react";
import type { CaseStatus } from "../api/caseApi";
import ConfirmDialog from "../components/common/ConfirmDialog";
import {
  formatDateInputDDMMYYYY,
  normalizeDateInputDDMMYYYY,
  normalizeTimeInputHHMM,
} from "../utils/clinicalInput";

type FormValue = string | boolean | string[];
type FormState = Record<string, FormValue>;
type FormTabId =
  | "caseInfo"
  | "ga"
  | "neuraxial"
  | "line"
  | "invasive"
  | "comorbid"
  | "extubation";
type AirwayTechniqueOutcome = "success" | "failure";
type AirwayTechnique = {
  id: string;
  outcome: AirwayTechniqueOutcome;
  technique_type: string;
  blade_type: string;
  blade_size: string;
  guide_stylet: string;
  laryngoscopic_view: string;
  attempt_no: string;
  vdo_type: string;
  vdo_other_type: string;
  vdo_blade: string;
  size_mm: string;
};

const FORM_TAB_DEFS: Array<{ id: FormTabId; label: string; removable: boolean }> = [
  { id: "caseInfo", label: "Case Information", removable: false },
  { id: "ga", label: "GA", removable: true },
  { id: "neuraxial", label: "Neuraxial Block", removable: true },
  { id: "line", label: "Line", removable: true },
  { id: "invasive", label: "Invasive Catheter", removable: true },
  { id: "comorbid", label: "Comorbid", removable: true },
  { id: "extubation", label: "Extubation", removable: true },
];

const FORM_REQUIRED_TAB: FormTabId = "caseInfo";
const AIRWAY_DETAIL_FIELDS_BY_DEVICE: Record<string, string[]> = {
  mask: ["mask_adjunct", "opa_size", "npa_size"],
  oral_endotracheal_tube: [
    "oral_tube_type",
    "oral_tube_size",
    "oral_cuff",
    "oral_cuff_volume_ml",
    "oral_tube_depth_cm",
    "oral_throat_pack",
    "oral_tube_in_situ",
  ],
  nasal_endotracheal_tube: [
    "nasal_tube_type",
    "nasal_tube_size",
    "nasal_cuff",
    "nasal_cuff_volume_ml",
    "nasal_tube_depth_cm",
    "nasal_preparation",
    "nasal_nostril",
    "nasal_throat_pack",
    "nasal_tube_in_situ",
  ],
  lma: ["lma_type", "lma_size", "lma_cuff_volume_ml", "lma_number_of_attempts"],
  tracheostomy_tube: ["trach_type", "trach_size", "trach_cuff", "trach_cuff_volume_ml"],
  jet_ventilation: ["jet_type"],
  other: ["airway_description"],
};
const AIRWAY_DETAIL_FIELDS = Array.from(
  new Set(Object.values(AIRWAY_DETAIL_FIELDS_BY_DEVICE).flat()),
);

/**
 * Maps each anesthesia-type checkbox value to the form tab it populates.
 * Checking a type auto-opens that tab; unchecking removes it if no other
 * checked type still needs it.
 */
const ANESTHESIA_TAB_MAP: Partial<Record<string, FormTabId>> = {
  "General anesthesia":      "ga",
  "Spinal anesthesia":       "neuraxial",
  "Epidural anesthesia":     "neuraxial",
  // "Conscious sedation/MAC" intentionally omitted — no dedicated tab
};

function normalizeEnabledForms(v: FormValue | undefined): FormTabId[] {
  const allowed = new Set(FORM_TAB_DEFS.map(tab => tab.id));
  const raw = Array.isArray(v) ? v : [];
  const next: FormTabId[] = [];
  for (const item of raw) {
    if (typeof item !== "string") continue;
    if (!allowed.has(item as FormTabId)) continue;
    const id = item as FormTabId;
    if (next.includes(id)) continue;
    next.push(id);
  }
  if (!next.includes(FORM_REQUIRED_TAB)) next.unshift(FORM_REQUIRED_TAB);
  return next;
}

interface FormViewProps {
  caseStatus: CaseStatus;
}

const card =
  "rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-950 p-3 space-y-3";
const input =
  "w-full rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-950 px-2 py-1.5";
const inputNarrow =
  "w-[70%] min-w-[140px] rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-950 px-2 py-1.5";
const inputCompact =
  "w-[50%] min-w-[90px] rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-950 px-2 py-1.5";
const label = "text-gray-500 dark:text-gray-400";
const primaryButton = "rounded px-3 py-1.5 text-sm text-white bg-blue-600 hover:bg-blue-700";
const secondaryButton =
  "rounded border border-gray-300 dark:border-gray-700 px-3 py-1.5 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800";
const dangerButton =
  "rounded border border-red-400 text-red-600 dark:text-red-300 px-3 py-1.5 text-sm";
const tabButtonBase =
  "rounded border px-3 py-1.5 text-sm transition-colors";
const split = (v: string) => v.split("|");

const options = {
  serviceProvider: split(
    "G1|G2|G3|G4|Colorectal surgery|Urosurgery|Plastic surgery|Cardiothoracic surgery|Neurosurgery|Pediatric surgery|Obs & Gyn surgery|Orthopedic surgery|Ophthalmology|ENT|Breast center|Bronchoscopy|GI endoscopy|Surgical endoscopy|Cath Lab|ECT|Interventional radiology|Diagnostic radiology|Radiation therapy|Nuclear medicine|Other",
  ),
  anesthesia: split(
    "General anesthesia|Spinal anesthesia|Epidural anesthesia|Peripheral nerve block|Truncal block|Conscious sedation/MAC",
  ),
  monitoring: split(
    "NIBP|ECG|Pulse oximetry|Capnography|Temperature|Urine output|Invasive blood pressure|Central venous pressure|Pulmonary arterial pressure|Cardiac output|EEG|NIR",
  ),
  positioning: split(
    "Supine|Prone|Lithotomy|Trendelenburg|Reverse Trendelenburg|Lateral (right)|Lateral (left)|Sitting",
  ),
  patientSafety: split(
    "Close eyes|Support pressure points|Secured extremities|Check alignments",
  ),
  temperatureControl: split("Forced-air warmer|Fluid warmer|Water blanket"),
  ivSites: split(
    "Right hand|Left hand|Right forearm|Left forearm|Right arm|Left arm|Right leg|Left leg",
  ),
  arterialSites: split(
    "Right radial artery|Left radial artery|Right femoral artery|Left femoral artery|Right brachial artery|Left brachial artery|Right dorsalis pedis|Left dorsalis pedis",
  ),
  cvcSites: split(
    "Right internal jugular vein|Left internal jugular vein|Right subclavian vein|Left subclavian vein|Right brachial vein|Left brachial vein|Right femoral vein|Left femoral vein|Right external jugular vein|Left external jugular vein",
  ),
  invasiveCvcSites: split(
    "Right internal jugular|Left internal jugular|Right subclavian|Left subclavian|Right femoral|Left femoral",
  ),
  invasiveCatheterSizes: split("4 Fr|5 Fr|6 Fr|7 Fr|8.5 Fr|9 Fr"),
  invasiveSterilePrecautions: split(
    "Hand hygiene|Sterile gown|Sterile gloves|Sterile drape|Cap|Mask|Eye protection|Sterile probe cover",
  ),
  ivGauge: split("14 G|16 G|18 G|20 G|22 G|24 G"),
  arterialGauge: split("14 G|16 G|18 G|20 G|22 G|24 G"),
  cvcLumens: split("Single|Double|Triple"),
  cvcSizeFr: split("4 Fr|5 Fr|6 Fr|7 Fr|8.5 Fr|9 Fr"),
  levels: split(
    "T6-T7|T7-T8|T8-T9|T9-T10|T10-T11|T11-T12|T12-L1|L1-L2|L2-L3|L3-L4|L4-L5",
  ),
  sterileBarrier: split("Sterile gloves|Sterile drape|Mask|Cap"),
  cvcSterileBarrier: split(
    "Sterile gown|Sterile gloves|Sterile drape|Cap|Mask|Glasses|Sterile probe cover",
  ),
  skinPrep: split(
    "Alcoholic chlorhexidine|Povidone iodine|Chlorhexidine|Tincture iodine|Alcohol",
  ),
  neuraxialTechniques: split("Spinal|Epidural|Combined spinal-epidural|Caudal"),
  gaPreInduction: split(
    "IV line flush and test|Preoxygenate with 100% high flow oxygen",
  ),
  gaInduction: split("IV induction|Inhalation induction|Rapid sequence induction"),
  gaEyeProtection: split("taped|ointment|none"),
  gaPrimaryAirway: split(
    "oral_endotracheal_tube|nasal_endotracheal_tube|mask|lma|tracheostomy_tube|jet_ventilation|other",
  ),
  gaMaskAdjunct: split("none|oropharyngeal_airway|nasopharyngeal_airway"),
  gaMaskVentilationDifficulty: split("easy|difficult|impossible"),
  gaTubeType: split("standard_pvc|wire_reinforced|rae|double_lumen|laser_tube|mlt|other"),
  gaCuff: split("cuffed|uncuffed"),
  gaYesNo: split("yes|no"),
  gaNasalPreparation: split("cocaine|lidocaine|lidadin|oxymetazoline|other"),
  gaNostril: split("left|right|bilateral"),
  gaLmaType: split("classic|proseal|flexible|intubating_lma|disposable|other"),
  gaTrachType: split("portex|shiley|silver|other"),
  gaJetType: split("hfjv|manual"),
  gaTechniqueType: split("direct_laryngoscopy|vdo_laryngoscopy|fiberoptic|fiberscope_bonfils"),
  gaBladeType: split("macintosh|miller"),
  gaVdoType: split("c-mac|mc_grath|glidescope|other"),
  gaVdoBlade: split("adult|pediatric|d-blade"),
  gaGuideStylet: split("yes|no"),
  gaLaryngoscopicView: split("1|2|3|4"),
  gaAttemptNumber: split("1|2|3|4|5|6"),
  extubationLocation: split("Extubated in OR|Extubated in PACU|Extubated in ICU|Remain Intubated"),
  extubationStatus: split("awake|deep|other"),
  cvcPre: split(
    "All lumens are flushed and clamped|Patient is placed in Trendelenburg position",
  ),
  cvcPlacement: split(
    "Ultrasound visualization|Manometry|Venous waveform|Blood gas analysis|X-ray|ECG",
  ),
  cvcPost: split(
    "Guidewire is removed|Blood is aspirated from all lumens and flush|Apply sterile caps on all hubs|Apply sterile dressing",
  ),
};

function isServiceOption(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return false;
  return options.serviceProvider.includes(trimmed);
}

function defaults(hn: string): FormState {
  return {
    hn,
    an: "",
    dob: "",
    ageY: "",
    ageM: "",
    heightCm: "",
    weightKg: "",
    bloodGroupABO: "",
    bloodGroupRh: "",
    asa: "",
    emergency: false,
    service: "",
    serviceProviderOther: "",
    clinic: "IPD",
    postoperativeDestination: "PACU",
    diagnosis: [""],
    operation: [""],
    anesthesiaTypes: [],
    monitoring: ["NIBP", "ECG", "Pulse oximetry"],
    positioning: [],
    headSupport: "",
    rightArmPosition: "",
    leftArmPosition: "",
    patientSafetyChecks: [],
    temperatureControl: [],
    ivSites: "",
    ivCatheterSize: "",
    ivWhereInserted: "",
    ivAttempts: "",
    arterialSites: "",
    arterialCatheterSize: "",
    arterialWhereInserted: "",
    arterialAttempts: "",
    cvcSites: "",
    cvcCatheterSize: "",
    cvcLumens: "",
    cvcWhereInserted: "",
    cvcUltrasound: "",
    cvcAttempts: "",
    pre_induction: [],
    induction: [],
    mask_ventilation_difficulty: "",
    eye_protection: [],
    primary_airway_device: "",
    secondary_airway_enabled: false,
    secondary_airway_device: "",
    mask_adjunct: "",
    opa_size: "",
    npa_size: "",
    oral_tube_type: "",
    oral_tube_size: "",
    oral_cuff: "",
    oral_cuff_volume_ml: "",
    oral_tube_depth_cm: "",
    oral_throat_pack: "",
    oral_tube_in_situ: "",
    nasal_tube_type: "",
    nasal_tube_size: "",
    nasal_cuff: "",
    nasal_cuff_volume_ml: "",
    nasal_tube_depth_cm: "",
    nasal_preparation: "",
    nasal_nostril: "",
    nasal_throat_pack: "",
    nasal_tube_in_situ: "",
    lma_type: "",
    lma_size: "",
    lma_cuff_volume_ml: "",
    lma_number_of_attempts: "",
    trach_type: "",
    trach_size: "",
    trach_cuff: "",
    trach_cuff_volume_ml: "",
    jet_type: "",
    airway_description: "",
    primary_airway_techniques: "[]",
    primary_failed_intubation: false,
    secondary_mask_adjunct: "",
    secondary_opa_size: "",
    secondary_npa_size: "",
    secondary_oral_tube_type: "",
    secondary_oral_tube_size: "",
    secondary_oral_cuff: "",
    secondary_oral_cuff_volume_ml: "",
    secondary_oral_tube_depth_cm: "",
    secondary_oral_throat_pack: "",
    secondary_oral_tube_in_situ: "",
    secondary_nasal_tube_type: "",
    secondary_nasal_tube_size: "",
    secondary_nasal_cuff: "",
    secondary_nasal_cuff_volume_ml: "",
    secondary_nasal_tube_depth_cm: "",
    secondary_nasal_preparation: "",
    secondary_nasal_nostril: "",
    secondary_nasal_throat_pack: "",
    secondary_nasal_tube_in_situ: "",
    secondary_lma_type: "",
    secondary_lma_size: "",
    secondary_lma_cuff_volume_ml: "",
    secondary_lma_number_of_attempts: "",
    secondary_trach_type: "",
    secondary_trach_size: "",
    secondary_trach_cuff: "",
    secondary_trach_cuff_volume_ml: "",
    secondary_jet_type: "",
    secondary_airway_description: "",
    secondary_airway_techniques: "[]",
    secondary_failed_intubation: false,
    neuraxialTechniques: [],
    neuraxialBlockType: "",
    neuraxialSterilePrecautions: [],
    spinalSterileBarriers: [],
    spinalSkinPreparation: "",
    spinalLetAirDry: false,
    spinalApproachingLevel: "",
    spinalCaudalBlock: false,
    spinalNeedle: "",
    spinalBlockFailure: false,
    spinalEvent: "",
    epiduralSterileBarriers: [],
    epiduralSkinPreparation: "",
    epiduralLetAirDry: false,
    epiduralApproachingLevel: "",
    epiduralNeedleTuohy: false,
    epiduralLossResistance: "",
    epiduralDepthCm: "",
    epiduralCatheterMarkCm: "",
    epiduralBlockFailure: false,
    epiduralEvent: "",
    cvcInsertionSites: "",
    cvcInsertionCatheterSize: "",
    cvcInsertionLumens: "",
    cvcInsertionUltrasound: "",
    cvcInsertionAttempts: "",
    cvcHandScrub: false,
    cvcSterileBarriers: [],
    cvcSkinPreparation: "",
    cvcLetSkinDry: false,
    cvcPreCannulation: [],
    cvcCannulationTechnique: "",
    cvcPlacementConfirmation: [],
    cvcPostCannulation: [],
    comorbidDiseases: "",
    currentMedication: "",
    extubation_time: "",
    extubation_location: "",
    extubation_status: "",
    airway_device_removed: "",
    suction_performed: "",
    extubation_note: "",
    enabledForms: [FORM_REQUIRED_TAB],
  };
}

function fmt(ts: number) {
  const d = new Date(ts);
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yy = d.getFullYear();
  const hh = String(d.getHours()).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");
  return `${dd}/${mm}/${yy} ${hh}:${min}`;
}

function parseClinicalDate(raw: string): Date | null {
  const value = raw.trim();
  if (!value) return null;

  const normalized = normalizeDateInputDDMMYYYY(value);
  const dmy = normalized?.match(/^(\d{2})\/(\d{2})\/(\d{4})$/) || null;
  if (dmy) {
    const dd = Number(dmy[1]);
    const mm = Number(dmy[2]);
    const yyyy = Number(dmy[3]);
    const dt = new Date(yyyy, mm - 1, dd);
    if (
      dt.getFullYear() === yyyy &&
      dt.getMonth() === mm - 1 &&
      dt.getDate() === dd
    ) {
      return dt;
    }
    return null;
  }

  const iso = value.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (iso) {
    const yyyy = Number(iso[1]);
    const mm = Number(iso[2]);
    const dd = Number(iso[3]);
    const dt = new Date(yyyy, mm - 1, dd);
    if (
      dt.getFullYear() === yyyy &&
      dt.getMonth() === mm - 1 &&
      dt.getDate() === dd
    ) {
      return dt;
    }
  }

  return null;
}

function toClinicalDate(dt: Date): string {
  const dd = String(dt.getDate()).padStart(2, "0");
  const mm = String(dt.getMonth() + 1).padStart(2, "0");
  const yyyy = dt.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

function ageFromDob(dob: Date) {
  const now = new Date();
  if (dob.getTime() > now.getTime()) return null;

  let years = now.getFullYear() - dob.getFullYear();
  let months = now.getMonth() - dob.getMonth();

  if (now.getDate() < dob.getDate()) months -= 1;
  if (months < 0) {
    years -= 1;
    months += 12;
  }

  if (years < 0) return null;
  return { years, months };
}

function normalizeAgeText(raw: string, maxDigits: number): string {
  return raw.replace(/\D+/g, "").slice(0, maxDigits);
}

function dobFromAge(ageYRaw: string, ageMRaw: string): Date | null {
  const yText = ageYRaw.trim();
  const mText = ageMRaw.trim();
  if (!yText && !mText) return null;

  const years = yText ? Number(yText) : 0;
  const months = mText ? Number(mText) : 0;
  if (!Number.isFinite(years) || !Number.isFinite(months)) return null;
  if (years < 0 || months < 0) return null;

  const totalMonths = Math.trunc(years) * 12 + Math.trunc(months);
  const anchor = new Date();
  const dt = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  dt.setMonth(dt.getMonth() - totalMonths);
  return dt;
}

function clampNumeric(raw: string, min: number, max: number, decimals = 0): string {
  const value = raw.trim();
  if (!value) return "";
  const n = Number(value);
  if (!Number.isFinite(n)) return "";
  const clamped = Math.min(max, Math.max(min, n));
  if (decimals <= 0) return String(Math.round(clamped));
  return clamped
    .toFixed(decimals)
    .replace(/\.0+$/, "")
    .replace(/(\.\d*[1-9])0+$/, "$1");
}

function normalizeStringList(v: FormValue | undefined): string[] {
  if (Array.isArray(v)) return v.length > 0 ? v : [""];
  if (typeof v === "string") return v.trim() ? [v] : [""];
  return [""];
}

function normalizeCodeText(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function normalizeCodeList(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
}

function mapLegacyMaskDifficulty(value: string): string {
  const token = value.trim().toLowerCase();
  if (!token) return "";
  if (token === "n/a" || token === "na") return "";
  if (token === "easy" || token === "difficult" || token === "impossible") return token;
  return "";
}

function mapLegacyPrimaryAirway(airwayTypeRaw: string, routeRaw: string): string {
  const airwayType = airwayTypeRaw.trim().toLowerCase();
  const route = routeRaw.trim().toLowerCase();
  if (route === "nasotracheal") return "nasal_endotracheal_tube";
  if (route === "orotracheal") return "oral_endotracheal_tube";
  if (airwayType.includes("tracheostomy")) return "tracheostomy_tube";
  if (airwayType.includes("supraglottic")) return "lma";
  if (airwayType.includes("endotracheal")) return "oral_endotracheal_tube";
  return "";
}

function codeLabel(value: string): string {
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
  if (overrides[value]) return overrides[value];
  return value
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function createEmptyTechnique(): AirwayTechnique {
  return {
    id: "",
    outcome: "success",
    technique_type: "",
    blade_type: "",
    blade_size: "",
    guide_stylet: "",
    laryngoscopic_view: "",
    attempt_no: "1",
    vdo_type: "",
    vdo_other_type: "",
    vdo_blade: "",
    size_mm: "",
  };
}

function parseTechniqueList(raw: unknown): AirwayTechnique[] {
  if (typeof raw !== "string" || !raw.trim()) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
      .map((item) => {
        const base = createEmptyTechnique();
        return {
          ...base,
          id: normalizeCodeText(item.id) || String(Date.now()),
          outcome: item.outcome === "failure" ? "failure" : "success",
          technique_type: normalizeCodeText(item.technique_type),
          blade_type: normalizeCodeText(item.blade_type),
          blade_size: normalizeCodeText(item.blade_size),
          guide_stylet: normalizeCodeText(item.guide_stylet),
          laryngoscopic_view: normalizeCodeText(item.laryngoscopic_view),
          attempt_no: normalizeCodeText(item.attempt_no),
          vdo_type: normalizeCodeText(item.vdo_type),
          vdo_other_type: normalizeCodeText(item.vdo_other_type),
          vdo_blade: normalizeCodeText(item.vdo_blade),
          size_mm: normalizeCodeText(item.size_mm),
        };
      });
  } catch {
    return [];
  }
}

function buildReadableDraftText(raw: unknown): string {
  const payload =
    raw && typeof raw === "object" && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {};
  const lines: string[] = [];
  const readText = (key: string) =>
    typeof payload[key] === "string" ? payload[key].trim() : "";
  const readList = (key: string) =>
    Array.isArray(payload[key])
      ? (payload[key] as unknown[])
          .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
      : [];
  const readBool = (key: string) => payload[key] === true;
  const push = (text: string) => {
    if (text) lines.push(text);
  };
  const pushField = (label: string, value: string) => {
    if (value) lines.push(`${label}: ${value}`);
  };
  const pushList = (label: string, values: string[]) => {
    if (values.length > 0) lines.push(`${label}: ${values.join(", ")}`);
  };
  const appendAirway = (scopeLabel: "Primary" | "Secondary", prefix: string) => {
    const device = readText(`${prefix}airway_device`);
    if (!device) return;
    push(`${scopeLabel} Airway: ${codeLabel(device)}`);
    if (device === "oral_endotracheal_tube") {
      pushField("  Tube type", codeLabel(readText(`${prefix}oral_tube_type`)));
      pushField("  Tube size", readText(`${prefix}oral_tube_size`));
      pushField("  Tube depth (cm)", readText(`${prefix}oral_tube_depth_cm`));
    }
    if (device === "nasal_endotracheal_tube") {
      pushField("  Tube type", codeLabel(readText(`${prefix}nasal_tube_type`)));
      pushField("  Tube size", readText(`${prefix}nasal_tube_size`));
      pushField("  Tube depth (cm)", readText(`${prefix}nasal_tube_depth_cm`));
      pushField("  Nose preparation", codeLabel(readText(`${prefix}nasal_preparation`)));
      pushField("  Nostril", codeLabel(readText(`${prefix}nasal_nostril`)));
    }
    if (device === "mask") {
      pushField("  Mask adjunct", codeLabel(readText(`${prefix}mask_adjunct`)));
    }
    if (device === "lma") {
      pushField("  LMA type", codeLabel(readText(`${prefix}lma_type`)));
      pushField("  LMA size", readText(`${prefix}lma_size`));
    }

    const techniques = parseTechniqueList(readText(`${prefix}airway_techniques`));
    if (techniques.length > 0) {
      push(`  Technique attempts (${techniques.length})`);
      for (const item of techniques) {
        const outcome = item.outcome === "success" ? "Success" : "Failure";
        const parts = [`${outcome}: ${codeLabel(item.technique_type)}`];
        if (item.attempt_no) parts.push(`Attempt ${item.attempt_no}`);
        if (item.laryngoscopic_view) parts.push(`View ${item.laryngoscopic_view}`);
        if (item.blade_type) parts.push(`Blade ${codeLabel(item.blade_type)}`);
        if (item.blade_size) parts.push(`Blade size ${item.blade_size}`);
        if (item.vdo_type) parts.push(`VDO ${codeLabel(item.vdo_type)}`);
        if (item.vdo_other_type) parts.push(`VDO other ${item.vdo_other_type}`);
        if (item.vdo_blade) parts.push(`VDO blade ${codeLabel(item.vdo_blade)}`);
        if (item.guide_stylet) parts.push(`Guide/stylet ${codeLabel(item.guide_stylet)}`);
        if (item.size_mm) parts.push(`Size ${item.size_mm} mm`);
        push(`    - ${parts.join(" | ")}`);
      }
    }
    if (readBool(`${prefix}failed_intubation`)) {
      push("  Failed intubation: Yes");
    }
  };

  push("General");
  pushField("HN", readText("hn"));
  pushField("AN", readText("an"));
  pushField("DOB", readText("dob"));
  if (readText("ageY") || readText("ageM")) {
    push(`Age: ${readText("ageY") || "0"}y ${readText("ageM") || "0"}m`);
  }
  pushField("Service", readText("service"));
  pushField("Clinic", readText("clinic"));
  pushField("ASA", readText("asa"));
  pushField("Comorbid diseases", readText("comorbidDiseases"));
  pushField("Current medication", readText("currentMedication"));

  push("");
  push("Anesthesia");
  pushList("Types", readList("anesthesiaTypes"));
  pushList("Monitoring", readList("monitoring"));
  pushList("Pre-induction", readList("pre_induction"));
  pushList("Induction", readList("induction"));
  pushField("Mask ventilation difficulty", codeLabel(readText("mask_ventilation_difficulty")));
  pushList("Eye protection", readList("eye_protection").map(codeLabel));

  push("");
  appendAirway("Primary", "primary_");
  if (readBool("secondary_airway_enabled")) {
    push("");
    appendAirway("Secondary", "secondary_");
  }

  push("");
  push("Extubation");
  pushField("Extubation time", readText("extubation_time"));
  pushField("Extubation location", readText("extubation_location"));
  pushField("Extubation status", codeLabel(readText("extubation_status")));
  pushField("Airway device removed", codeLabel(readText("airway_device_removed")));
  pushField("Suction performed", codeLabel(readText("suction_performed")));
  pushField("Extubation note", readText("extubation_note"));

  push("");
  push("Line");
  pushField("IV site", readText("ivSites"));
  pushField("IV gauge", readText("ivCatheterSize"));
  pushField("IV inserted", readText("ivWhereInserted"));
  pushField("IV attempts", readText("ivAttempts"));
  pushField("Arterial site", readText("arterialSites"));
  pushField("Arterial gauge", readText("arterialCatheterSize"));
  pushField("Arterial inserted", readText("arterialWhereInserted"));
  pushField("Arterial attempts", readText("arterialAttempts"));
  pushField("CVC site", readText("cvcSites"));
  pushField("CVC lumens", readText("cvcLumens"));
  pushField("CVC catheter size", readText("cvcCatheterSize"));
  pushField("CVC inserted", readText("cvcWhereInserted"));
  pushField("CVC ultrasound", codeLabel(readText("cvcUltrasound")));
  pushField("CVC attempts", readText("cvcAttempts"));

  push("");
  push("Invasive Catheter");
  pushField("Site", readText("cvcInsertionSites"));
  pushField("Lumens", readText("cvcInsertionLumens"));
  pushField("Catheter size (Fr)", readText("cvcInsertionCatheterSize"));
  pushField("Ultrasound guidance", codeLabel(readText("cvcInsertionUltrasound")));
  pushField("Attempts", readText("cvcInsertionAttempts"));
  pushField("Hand scrub", readBool("cvcHandScrub") ? "Yes" : "");
  pushList("Sterile precaution", readList("cvcSterileBarriers"));
  pushField("Skin preparation", readText("cvcSkinPreparation"));
  pushField("Let skin dry", readBool("cvcLetSkinDry") ? "Yes" : "");
  pushList("Pre-cannulation", readList("cvcPreCannulation"));
  pushField("Cannulation technique", readText("cvcCannulationTechnique"));
  pushList("Venous placement confirmation", readList("cvcPlacementConfirmation"));
  pushList("Post-cannulation", readList("cvcPostCannulation"));

  return lines.join("\n");
}

interface AirwayTechniquePanelProps {
  title: string;
  techniquesRaw: string;
  failedIntubation: boolean;
  onTechniquesChange: (nextRaw: string) => void;
  onFailedIntubationChange: (next: boolean) => void;
}

function normalizeTechniqueByType(input: AirwayTechnique): AirwayTechnique {
  const next: AirwayTechnique = { ...input };
  const isDirect = next.technique_type === "direct_laryngoscopy";
  const isVdo = next.technique_type === "vdo_laryngoscopy";
  const isScope = next.technique_type === "fiberoptic" || next.technique_type === "fiberscope_bonfils";

  if (!isDirect && !isVdo) {
    next.blade_type = "";
    next.blade_size = "";
    next.guide_stylet = "";
    next.laryngoscopic_view = "";
  }
  if (!isVdo) {
    next.vdo_type = "";
    next.vdo_other_type = "";
    next.vdo_blade = "";
  }
  if (!isScope) {
    next.size_mm = "";
  }
  return next;
}

function AirwayTechniquePanel({
  title,
  techniquesRaw,
  failedIntubation,
  onTechniquesChange,
  onFailedIntubationChange,
}: AirwayTechniquePanelProps) {
  const techniques = useMemo(() => parseTechniqueList(techniquesRaw), [techniquesRaw]);
  const [editingId, setEditingId] = useState("");
  const [draft, setDraft] = useState<AirwayTechnique>(() => createEmptyTechnique());
  const [note, setNote] = useState("");

  const hasSuccess = techniques.some(item => item.outcome === "success");
  const isEditing = editingId !== "";
  const isDirect = draft.technique_type === "direct_laryngoscopy";
  const isVdo = draft.technique_type === "vdo_laryngoscopy";
  const isScope = draft.technique_type === "fiberoptic" || draft.technique_type === "fiberscope_bonfils";

  const openNew = () => {
    setEditingId("");
    setDraft(createEmptyTechnique());
    setNote("");
  };
  const openEdit = (item: AirwayTechnique) => {
    setEditingId(item.id);
    setDraft(item);
    setNote("");
  };
  const closeEditor = () => {
    setEditingId("");
    setDraft(createEmptyTechnique());
    setNote("");
  };

  const saveDraft = () => {
    if (!draft.technique_type) {
      setNote("Technique type is required");
      return;
    }
    if (draft.outcome === "success" && techniques.some(item => item.outcome === "success" && item.id !== editingId)) {
      setNote("A successful technique already exists. Edit it instead of adding another.");
      return;
    }

    const id = editingId || `tech_${Date.now()}`;
    const normalized = normalizeTechniqueByType({
      ...draft,
      id,
      attempt_no: normalizeCodeText(draft.attempt_no) || "1",
    });
    const next = isEditing
      ? techniques.map(item => (item.id === editingId ? normalized : item))
      : [...techniques, normalized];

    const sorted = [...next].sort((a, b) => Number(a.attempt_no || 0) - Number(b.attempt_no || 0));
    onTechniquesChange(JSON.stringify(sorted));
    closeEditor();
  };

  const deleteTechnique = (id: string) => {
    const next = techniques.filter(item => item.id !== id);
    onTechniquesChange(JSON.stringify(next));
    if (editingId === id) closeEditor();
  };

  return (
    <div className="rounded border border-gray-200 dark:border-gray-800 p-3 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="font-medium">{title}</div>
        <label className="inline-flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={failedIntubation}
            onChange={(e) => onFailedIntubationChange(e.target.checked)}
          />
          <span>Failed intubation</span>
        </label>
      </div>

      {techniques.length > 0 ? (
        <div className="space-y-2">
          {techniques.map(item => (
            <div
              key={item.id}
              className="flex flex-wrap items-center gap-2 rounded border border-gray-200 dark:border-gray-800 px-2 py-1.5 text-sm"
            >
              <span className={item.outcome === "success" ? "text-green-600 dark:text-green-400" : "text-amber-600 dark:text-amber-400"}>
                {item.outcome === "success" ? "Successful" : "Failure"}
              </span>
              <span>{codeLabel(item.technique_type)}</span>
              <span className="text-gray-500 dark:text-gray-400">Attempt {item.attempt_no || "1"}</span>
              <button type="button" className={secondaryButton} onClick={() => openEdit(item)}>Edit</button>
              <button type="button" className={dangerButton} onClick={() => deleteTechnique(item.id)}>Remove</button>
            </div>
          ))}
        </div>
      ) : (
        <div className="text-sm text-gray-500 dark:text-gray-400">No technique recorded</div>
      )}

      {!hasSuccess || isEditing ? (
        <div className="rounded border border-gray-200 dark:border-gray-800 p-3 space-y-3">
          <div className="flex items-center justify-between">
            <div className="font-medium">{isEditing ? "Edit technique" : "Add technique"}</div>
            {!isEditing ? (
              <button type="button" className={secondaryButton} onClick={openNew}>Clear</button>
            ) : null}
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="space-y-1">
              <div className={label}>Outcome</div>
              <div className="grid grid-cols-2 gap-2">
                <label className="inline-flex items-center gap-2 rounded border border-gray-200 dark:border-gray-800 px-2 py-1.5">
                  <input
                    type="radio"
                    checked={draft.outcome === "success"}
                    onChange={() => setDraft(prev => ({ ...prev, outcome: "success" }))}
                  />
                  <span>Success</span>
                </label>
                <label className="inline-flex items-center gap-2 rounded border border-gray-200 dark:border-gray-800 px-2 py-1.5">
                  <input
                    type="radio"
                    checked={draft.outcome === "failure"}
                    onChange={() => setDraft(prev => ({ ...prev, outcome: "failure" }))}
                  />
                  <span>Failure</span>
                </label>
              </div>
            </div>
            <label className="space-y-1">
              <div className={label}>Technique type</div>
              <select
                className={input}
                value={draft.technique_type}
                onChange={(e) => setDraft(prev => ({ ...prev, technique_type: e.target.value }))}
              >
                <option value="">Select technique</option>
                {options.gaTechniqueType.map(value => (
                  <option key={value} value={value}>{codeLabel(value)}</option>
                ))}
              </select>
            </label>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <label className="space-y-1">
              <div className={label}>No. of attempt</div>
              <select
                className={input}
                value={draft.attempt_no}
                onChange={(e) => setDraft(prev => ({ ...prev, attempt_no: e.target.value }))}
              >
                {options.gaAttemptNumber.map(value => (
                  <option key={value} value={value}>{value}</option>
                ))}
              </select>
            </label>
            {isScope ? (
              <label className="space-y-1">
                <div className={label}>Size (mm)</div>
                <input
                  className={input}
                  value={draft.size_mm}
                  onChange={(e) => setDraft(prev => ({ ...prev, size_mm: e.target.value }))}
                />
              </label>
            ) : null}
          </div>

          {isDirect || isVdo ? (
            <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
              <label className="space-y-1">
                <div className={label}>Blade type</div>
                <select
                  className={input}
                  value={draft.blade_type}
                  onChange={(e) => setDraft(prev => ({ ...prev, blade_type: e.target.value }))}
                >
                  <option value="">Select blade type</option>
                  {options.gaBladeType.map(value => (
                    <option key={value} value={value}>{codeLabel(value)}</option>
                  ))}
                </select>
              </label>
              <label className="space-y-1">
                <div className={label}>Blade size</div>
                <input
                  className={input}
                  value={draft.blade_size}
                  onChange={(e) => setDraft(prev => ({ ...prev, blade_size: e.target.value }))}
                />
              </label>
              <label className="space-y-1">
                <div className={label}>Guide/stylet</div>
                <select
                  className={input}
                  value={draft.guide_stylet}
                  onChange={(e) => setDraft(prev => ({ ...prev, guide_stylet: e.target.value }))}
                >
                  <option value="">Select</option>
                  {options.gaGuideStylet.map(value => (
                    <option key={value} value={value}>{codeLabel(value)}</option>
                  ))}
                </select>
              </label>
              <label className="space-y-1">
                <div className={label}>Laryngoscopic view</div>
                <select
                  className={input}
                  value={draft.laryngoscopic_view}
                  onChange={(e) => setDraft(prev => ({ ...prev, laryngoscopic_view: e.target.value }))}
                >
                  <option value="">Select view</option>
                  {options.gaLaryngoscopicView.map(value => (
                    <option key={value} value={value}>{value}</option>
                  ))}
                </select>
              </label>
            </div>
          ) : null}

          {isVdo ? (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <label className="space-y-1">
                <div className={label}>Type</div>
                <select
                  className={input}
                  value={draft.vdo_type}
                  onChange={(e) => setDraft(prev => ({ ...prev, vdo_type: e.target.value }))}
                >
                  <option value="">Select type</option>
                  {options.gaVdoType.map(value => (
                    <option key={value} value={value}>{codeLabel(value)}</option>
                  ))}
                </select>
              </label>
              {draft.vdo_type === "other" ? (
                <label className="space-y-1">
                  <div className={label}>Other type</div>
                  <input
                    className={input}
                    value={draft.vdo_other_type}
                    onChange={(e) => setDraft(prev => ({ ...prev, vdo_other_type: e.target.value }))}
                  />
                </label>
              ) : null}
              <label className="space-y-1">
                <div className={label}>VDO blade</div>
                <select
                  className={input}
                  value={draft.vdo_blade}
                  onChange={(e) => setDraft(prev => ({ ...prev, vdo_blade: e.target.value }))}
                >
                  <option value="">Select blade</option>
                  {options.gaVdoBlade.map(value => (
                    <option key={value} value={value}>{codeLabel(value)}</option>
                  ))}
                </select>
              </label>
            </div>
          ) : null}

          {note ? <div className="text-xs text-amber-600 dark:text-amber-400">{note}</div> : null}
          <div className="flex items-center justify-end gap-2">
            {isEditing ? (
              <button type="button" className={secondaryButton} onClick={closeEditor}>Cancel</button>
            ) : null}
            <button type="button" className={primaryButton} onClick={saveDraft}>Save Technique</button>
          </div>
        </div>
      ) : (
        <div className="text-sm text-gray-500 dark:text-gray-400">
          Successful technique recorded. Add another attempt only after editing/removing success.
        </div>
      )}
    </div>
  );
}

export default function FormView({ caseStatus }: FormViewProps) {
  const storageKey = useMemo(() => {
    if (caseStatus.status === "IDLE") return "";
    return `doctor_form_${caseStatus.case_id}`;
  }, [caseStatus]);

  const [form, setForm] = useState<FormState>(() =>
    caseStatus.status === "IDLE" ? defaults("") : defaults(caseStatus.hn),
  );
  const [saveNote, setSaveNote] = useState("");
  const [showSavedPreview, setShowSavedPreview] = useState(false);
  const [savedPreview, setSavedPreview] = useState("");
  const [isResetConfirmOpen, setIsResetConfirmOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<FormTabId>(FORM_REQUIRED_TAB);
  const [formPickerTab, setFormPickerTab] = useState<FormTabId>("ga");

  const text = (name: string) => (typeof form[name] === "string" ? (form[name] as string) : "");
  const bool = (name: string) => form[name] === true;
  const multi = (name: string) => (Array.isArray(form[name]) ? (form[name] as string[]) : []);
  const enabledTabs = useMemo(
    () => normalizeEnabledForms(form.enabledForms),
    [form.enabledForms],
  );
  const addableTabs = useMemo(
    () => FORM_TAB_DEFS.filter(tab => tab.removable && !enabledTabs.includes(tab.id)),
    [enabledTabs],
  );

  const setText = (name: string, value: string) => setForm((p) => ({ ...p, [name]: value }));
  const setBool = (name: string, value: boolean) => setForm((p) => ({ ...p, [name]: value }));
  const setAirwayDevice = (scope: "primary" | "secondary", device: string) => {
    const deviceKey = scope === "primary" ? "primary_airway_device" : "secondary_airway_device";
    const prefix = scope === "primary" ? "" : "secondary_";
    const techniquesKey = scope === "primary" ? "primary_airway_techniques" : "secondary_airway_techniques";
    const failedKey = scope === "primary" ? "primary_failed_intubation" : "secondary_failed_intubation";
    setForm((prev) => {
      const next: FormState = { ...prev, [deviceKey]: device };
      const keep = new Set((AIRWAY_DETAIL_FIELDS_BY_DEVICE[device] || []).map((base) => `${prefix}${base}`));
      for (const base of AIRWAY_DETAIL_FIELDS) {
        const key = `${prefix}${base}`;
        if (keep.has(key)) continue;
        next[key] = "";
      }
      next[techniquesKey] = "[]";
      next[failedKey] = false;
      if (scope === "primary" && !normalizeCodeText(prev.airway_device_removed)) {
        next.airway_device_removed = device;
      }
      return next;
    });
  };
  const toggle = (name: string, option: string) => {
    setForm((p) => {
      const arr = Array.isArray(p[name]) ? (p[name] as string[]) : [];
      const next = arr.includes(option) ? arr.filter((x) => x !== option) : [...arr, option];
      return { ...p, [name]: next };
    });
  };

  /**
   * Toggles an anesthesia type checkbox and automatically adds/removes the
   * corresponding form tab so the relevant detail section is always visible.
   */
  const toggleAnesthesiaType = (option: string) => {
    const currentTypes = Array.isArray(form.anesthesiaTypes)
      ? (form.anesthesiaTypes as string[])
      : [];
    const isAdding = !currentTypes.includes(option);
    const nextTypes = isAdding
      ? [...currentTypes, option]
      : currentTypes.filter(x => x !== option);

    const mappedTab = ANESTHESIA_TAB_MAP[option];

    setForm(p => {
      const enabled = normalizeEnabledForms(p.enabledForms);

      if (!mappedTab) {
        // No dedicated tab — just toggle the value
        return { ...p, anesthesiaTypes: nextTypes };
      }

      if (isAdding) {
        // Add the tab if it isn't already enabled
        const nextEnabled = enabled.includes(mappedTab)
          ? enabled
          : [...enabled, mappedTab];
        return { ...p, anesthesiaTypes: nextTypes, enabledForms: nextEnabled };
      } else {
        // Remove the tab only if no remaining checked type still needs it
        const tabStillNeeded = nextTypes.some(t => ANESTHESIA_TAB_MAP[t] === mappedTab);
        if (tabStillNeeded) return { ...p, anesthesiaTypes: nextTypes };
        return {
          ...p,
          anesthesiaTypes: nextTypes,
          enabledForms: enabled.filter(id => id !== mappedTab),
        };
      }
    });

  };
  const setDob = (value: string, normalize = false) => {
    setForm((p) => {
      const inputValue = formatDateInputDDMMYYYY(value);
      const parsed = parseClinicalDate(inputValue);
      const dob = parsed && normalize ? toClinicalDate(parsed) : inputValue;
      if (!parsed) return { ...p, dob, ageY: "", ageM: "" };

      const age = ageFromDob(parsed);
      if (!age) return { ...p, dob, ageY: "", ageM: "" };

      return {
        ...p,
        dob,
        ageY: String(age.years),
        ageM: String(age.months),
      };
    });
  };
  const setAgeText = (field: "ageY" | "ageM", value: string) => {
    const maxDigits = field === "ageY" ? 3 : 2;
    const next = normalizeAgeText(value, maxDigits);
    setForm((p) => ({ ...p, [field]: next }));
  };
  const applyAgeToDob = (ageYRaw: string, ageMRaw: string) => {
    setForm((p) => {
      const ageY = normalizeAgeText(ageYRaw, 3);
      const ageM = normalizeAgeText(ageMRaw, 2);
      const derivedDob = dobFromAge(ageY, ageM);
      if (!derivedDob) return { ...p, ageY, ageM };
      const age = ageFromDob(derivedDob);
      return {
        ...p,
        dob: toClinicalDate(derivedDob),
        ageY: age ? String(age.years) : ageY,
        ageM: age ? String(age.months) : ageM,
      };
    });
  };
  const loadDraftFromStorage = useCallback(() => {
    if (caseStatus.status === "IDLE") {
      setForm(defaults(""));
      setSaveNote("");
      return;
    }
    const base = defaults(caseStatus.hn);
    const raw = storageKey ? localStorage.getItem(storageKey) : null;
    if (!raw) {
      setForm(base);
      setSaveNote("");
      return;
    }
    try {
      const parsed = JSON.parse(raw) as FormState;
      const merged: FormState = {
        ...base,
        ...parsed,
        hn: caseStatus.hn,
      };

      if (!merged.clinic && typeof parsed.ipdClinic === "string") {
        merged.clinic = parsed.ipdClinic.toUpperCase() === "OPD" ? "OPD" : "IPD";
      }

      merged.diagnosis = normalizeStringList(parsed.diagnosis);
      merged.operation = normalizeStringList(parsed.operation);
      merged.enabledForms = normalizeEnabledForms(parsed.enabledForms);
      if (Array.isArray(merged.ivSites)) {
        merged.ivSites = normalizeCodeList(merged.ivSites)[0] || "";
      }
      if (Array.isArray(merged.arterialSites)) {
        merged.arterialSites = normalizeCodeList(merged.arterialSites)[0] || "";
      }
      if (Array.isArray(merged.cvcSites)) {
        merged.cvcSites = normalizeCodeList(merged.cvcSites)[0] || "";
      }
      if (Array.isArray(merged.cvcInsertionSites)) {
        merged.cvcInsertionSites = normalizeCodeList(merged.cvcInsertionSites)[0] || "";
      }
      if (!normalizeCodeText(merged.neuraxialBlockType)) {
        const legacyList = normalizeCodeList(merged.neuraxialTechniques);
        const first = String(legacyList[0] || "").trim();
        const map: Record<string, string> = {
          "Spinal anesthesia": "Spinal",
          "Epidural anesthesia": "Epidural",
          "Combined spinal-epidural anesthesia": "Combined spinal-epidural",
          "Caudal anesthesia": "Caudal",
        };
        if (first) {
          merged.neuraxialBlockType = map[first] || first;
        }
      }
      if (normalizeCodeList(merged.neuraxialSterilePrecautions).length === 0) {
        const mergedLegacy = [
          ...normalizeCodeList(merged.spinalSterileBarriers),
          ...normalizeCodeList(merged.epiduralSterileBarriers),
        ];
        merged.neuraxialSterilePrecautions = Array.from(new Set(mergedLegacy));
      }
      const normalizeLumensLabel = (value: string) => {
        const token = value.trim().toLowerCase();
        if (token === "1" || token === "single") return "Single";
        if (token === "2" || token === "double") return "Double";
        if (token === "3" || token === "triple") return "Triple";
        return value;
      };
      merged.cvcLumens = normalizeLumensLabel(normalizeCodeText(merged.cvcLumens));
      merged.cvcInsertionLumens = normalizeLumensLabel(normalizeCodeText(merged.cvcInsertionLumens));

      const parsedDob = parseClinicalDate(typeof merged.dob === "string" ? merged.dob : "");
      if (parsedDob) {
        merged.dob = toClinicalDate(parsedDob);
        const age = ageFromDob(parsedDob);
        merged.ageY = age ? String(age.years) : "";
        merged.ageM = age ? String(age.months) : "";
      } else {
        const derivedDob = dobFromAge(
          typeof merged.ageY === "string" ? merged.ageY : "",
          typeof merged.ageM === "string" ? merged.ageM : "",
        );
        if (derivedDob) {
          merged.dob = toClinicalDate(derivedDob);
          const age = ageFromDob(derivedDob);
          merged.ageY = age ? String(age.years) : normalizeAgeText(String(merged.ageY || ""), 3);
          merged.ageM = age ? String(age.months) : normalizeAgeText(String(merged.ageM || ""), 2);
        }
      }

      if (normalizeCodeList(merged.pre_induction).length === 0) {
        const legacy = normalizeCodeList(merged.preInductionChecks);
        if (legacy.length > 0) merged.pre_induction = legacy;
      }

      if (normalizeCodeList(merged.induction).length === 0) {
        const legacy = normalizeCodeList(merged.inductionMethods);
        if (legacy.length > 0) merged.induction = legacy;
      }

      if (!normalizeCodeText(merged.mask_ventilation_difficulty)) {
        const legacy = mapLegacyMaskDifficulty(normalizeCodeText(merged.maskVentilationDifficulty));
        if (legacy) merged.mask_ventilation_difficulty = legacy;
      }

      if (!normalizeCodeText(merged.primary_airway_device)) {
        const mapped = mapLegacyPrimaryAirway(
          normalizeCodeText(merged.airwayType),
          normalizeCodeText(merged.intubationRoute),
        );
        if (mapped) merged.primary_airway_device = mapped;
      }
      if (!normalizeCodeText(merged.extubation_time)) {
        const legacy = normalizeCodeText(merged.extubationTime);
        if (legacy) merged.extubation_time = legacy;
      }
      if (!normalizeCodeText(merged.extubation_location)) {
        const legacy = normalizeCodeText(merged.extubationDisposition);
        if (legacy === "Extubated in PACU/ICU") {
          merged.extubation_location = "Extubated in PACU";
        } else if (legacy) {
          merged.extubation_location = legacy;
        }
      }
      if (!normalizeCodeText(merged.airway_device_removed)) {
        const legacy = normalizeCodeText(merged.extubationAirway).toUpperCase();
        if (legacy === "ETT") merged.airway_device_removed = "oral_endotracheal_tube";
        else if (legacy === "LMA") merged.airway_device_removed = "lma";
        else if (legacy === "TRACHEOSTOMY") merged.airway_device_removed = "tracheostomy_tube";
      }
      if (!normalizeCodeText(merged.extubation_note)) {
        const legacy = normalizeCodeText(merged.extubationNote);
        if (legacy) merged.extubation_note = legacy;
      }
      if (!normalizeCodeText(merged.airway_device_removed) && normalizeCodeText(merged.primary_airway_device)) {
        merged.airway_device_removed = normalizeCodeText(merged.primary_airway_device);
      }

      merged.primary_airway_techniques = JSON.stringify(
        parseTechniqueList(merged.primary_airway_techniques),
      );
      merged.secondary_airway_techniques = JSON.stringify(
        parseTechniqueList(merged.secondary_airway_techniques),
      );

      setForm(merged);
      setSaveNote("Loaded saved draft");
    } catch {
      setForm(base);
      setSaveNote("");
    }
  }, [caseStatus, storageKey]);

  useEffect(() => {
    loadDraftFromStorage();
  }, [loadDraftFromStorage]);

  useEffect(() => {
    if (caseStatus.status === "IDLE") return;
    const onStorageChanged = (event: Event) => {
      const custom = event as CustomEvent<{ caseId?: unknown; source?: unknown }>;
      const changedCaseId = Number(custom.detail?.caseId);
      const source = String(custom.detail?.source || "");
      if (source === "form") return;
      if (!Number.isFinite(changedCaseId) || changedCaseId !== caseStatus.case_id) return;
      loadDraftFromStorage();
      setSaveNote("Synced from Patient/HIS");
    };
    window.addEventListener("aidas:form-storage-changed", onStorageChanged);
    return () => window.removeEventListener("aidas:form-storage-changed", onStorageChanged);
  }, [caseStatus, loadDraftFromStorage]);

  useEffect(() => {
    if (enabledTabs.length === 0) return;
    if (!enabledTabs.includes(activeTab)) {
      setActiveTab(enabledTabs[0]);
    }
  }, [activeTab, enabledTabs]);

  useEffect(() => {
    if (addableTabs.length === 0) return;
    if (!addableTabs.some(tab => tab.id === formPickerTab)) {
      setFormPickerTab(addableTabs[0].id);
    }
  }, [addableTabs, formPickerTab]);

  if (caseStatus.status === "IDLE") {
    return <div className="p-6 text-gray-400">No active case</div>;
  }

  const reset = () => {
    setForm(defaults(caseStatus.hn));
    localStorage.removeItem(storageKey);
    window.dispatchEvent(
      new CustomEvent("aidas:form-storage-changed", {
        detail: { caseId: caseStatus.case_id, source: "form" },
      }),
    );
    setSaveNote("Draft reset");
    setShowSavedPreview(false);
    setSavedPreview("");
  };

  const save = () => {
    if (!storageKey) return;
    const service = text("service");
    if (service && !isServiceOption(service)) {
      setSaveNote("Service must be selected from the list");
      return;
    }
    const normalizedExtubationTime = normalizeTimeInputHHMM(text("extubation_time"));
    if (text("extubation_time").trim() !== "" && !normalizedExtubationTime) {
      setSaveNote("Extubation time must be HH:mm (24-hour)");
      return;
    }
    try {
      const normalized: FormState = { ...form };
      const ageY = normalizeAgeText(text("ageY"), 3);
      const ageM = normalizeAgeText(text("ageM"), 2);
      const parsedDob = parseClinicalDate(text("dob"));
      const finalDob = parsedDob || dobFromAge(ageY, ageM);
      if (finalDob) {
        const age = ageFromDob(finalDob);
        normalized.dob = toClinicalDate(finalDob);
        normalized.ageY = age ? String(age.years) : ageY;
        normalized.ageM = age ? String(age.months) : ageM;
      } else {
        normalized.ageY = ageY;
        normalized.ageM = ageM;
      }
      normalized.primary_airway_techniques = JSON.stringify(
        parseTechniqueList(normalized.primary_airway_techniques),
      );
      normalized.secondary_airway_techniques = JSON.stringify(
        parseTechniqueList(normalized.secondary_airway_techniques),
      );
      if (
        !normalizeCodeText(normalized.airway_device_removed) &&
        normalizeCodeText(normalized.primary_airway_device)
      ) {
        normalized.airway_device_removed = normalizeCodeText(normalized.primary_airway_device);
      }
      if (normalizedExtubationTime) {
        normalized.extubation_time = normalizedExtubationTime;
      }
      localStorage.setItem(storageKey, JSON.stringify(normalized));
      setForm(normalized);
      window.dispatchEvent(
        new CustomEvent("aidas:form-storage-changed", {
          detail: { caseId: caseStatus.case_id, source: "form" },
        }),
      );
      setSaveNote(`Saved ${fmt(Date.now())}`);
    } catch {
      setSaveNote("Save failed");
    }
  };

  const viewSaved = () => {
    if (!storageKey) return;
    const raw = localStorage.getItem(storageKey);
    if (!raw) {
      setSavedPreview("No saved draft found for this case.");
      setShowSavedPreview(true);
      return;
    }

    try {
      const parsed = JSON.parse(raw);
      setSavedPreview(buildReadableDraftText(parsed));
    } catch {
      setSavedPreview(raw);
    }
    setShowSavedPreview(true);
  };

  const addFormTab = () => {
    setForm(prev => {
      const current = normalizeEnabledForms(prev.enabledForms);
      if (current.includes(formPickerTab)) return prev;
      return {
        ...prev,
        enabledForms: [...current, formPickerTab],
      };
    });
    setActiveTab(formPickerTab);
  };

  const removeFormTab = (tabId: FormTabId) => {
    if (tabId === FORM_REQUIRED_TAB) return;
    setForm(prev => {
      const current = normalizeEnabledForms(prev.enabledForms);
      return {
        ...prev,
        enabledForms: current.filter(id => id !== tabId),
      };
    });
  };

  const t = (key: string, title: string, type: "text" | "number" | "date" = "text") => (
    <label key={key} className="space-y-1">
      <div className={label}>{title}</div>
      <input className={input} type={type} value={text(key)} onChange={(e) => setText(key, e.target.value)} />
    </label>
  );

  const a = (key: string, title: string, rows = 3) => (
    <label key={key} className="space-y-1">
      <div className={label}>{title}</div>
      <textarea className={input} rows={rows} value={text(key)} onChange={(e) => setText(key, e.target.value)} />
    </label>
  );

  const r = (key: string, title: string, vals: string[], cols = "grid-cols-2 md:grid-cols-4") => (
    <div key={key} className="space-y-1">
      <div className={label}>{title}</div>
      <div className={`grid ${cols} gap-2`}>
        {vals.map((v) => (
          <label key={`${key}-${v}`} className="inline-flex items-center gap-2 rounded border border-gray-200 dark:border-gray-800 px-2 py-1.5">
            <input type="radio" checked={text(key) === v} onChange={() => setText(key, v)} />
            <span>{v}</span>
          </label>
        ))}
      </div>
    </div>
  );
  const rCompact = (key: string, title: string, vals: string[], cols = "grid-cols-3 md:grid-cols-6") => (
    <div key={key} className="space-y-1">
      <div className={label}>{title}</div>
      <div className={`grid ${cols} gap-1.5`}>
        {vals.map((v) => (
          <label key={`${key}-${v}`} className="inline-flex items-center justify-center gap-1 rounded border border-gray-200 dark:border-gray-800 px-2 py-1 text-xs whitespace-nowrap">
            <input type="radio" checked={text(key) === v} onChange={() => setText(key, v)} />
            <span>{v}</span>
          </label>
        ))}
      </div>
    </div>
  );

  const attemptField = (key: string, title: string) => {
    const parsed = Number.parseInt(text(key), 10);
    const value = Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
    const setValue = (next: number) => {
      if (!Number.isFinite(next) || next <= 0) {
        setText(key, "");
        return;
      }
      setText(key, String(Math.min(next, 99)));
    };
    return (
      <div key={key} className="space-y-1">
        <div className={label}>{title}</div>
        <div className="inline-flex items-center gap-1.5">
          <button
            type="button"
            className="h-7 w-7 rounded border border-gray-300 dark:border-gray-700 text-sm leading-none hover:bg-gray-100 dark:hover:bg-gray-800"
            onClick={() => setValue(value - 1)}
            aria-label={`Decrease ${title}`}
          >
            -
          </button>
          <input
            className="h-7 w-12 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-950 px-1 text-center text-sm"
            inputMode="numeric"
            value={value > 0 ? String(value) : ""}
            onChange={(e) => {
              const digits = e.target.value.replace(/[^\d]/g, "");
              if (!digits) {
                setText(key, "");
                return;
              }
              setValue(Number.parseInt(digits, 10));
            }}
            placeholder="0"
          />
          <button
            type="button"
            className="h-7 w-7 rounded border border-gray-300 dark:border-gray-700 text-sm leading-none hover:bg-gray-100 dark:hover:bg-gray-800"
            onClick={() => setValue((value || 0) + 1)}
            aria-label={`Increase ${title}`}
          >
            +
          </button>
        </div>
      </div>
    );
  };

  const c = (key: string, title: string, vals: string[], cols = "grid-cols-2 md:grid-cols-3") => (
    <div key={key} className="space-y-1">
      <div className={label}>{title}</div>
      <div className={`grid ${cols} gap-2`}>
        {vals.map((v) => (
          <label key={`${key}-${v}`} className="inline-flex items-center gap-2 rounded border border-gray-200 dark:border-gray-800 px-2 py-1.5">
            <input type="checkbox" checked={multi(key).includes(v)} onChange={() => toggle(key, v)} />
            <span>{v}</span>
          </label>
        ))}
      </div>
    </div>
  );

  const rCode = (
    key: string,
    title: string,
    vals: string[],
    cols = "grid-cols-2 md:grid-cols-4",
    onSelect?: (value: string) => void,
  ) => (
    <div key={key} className="space-y-1">
      <div className={label}>{title}</div>
      <div className={`grid ${cols} gap-2`}>
        {vals.map((v) => (
          <label key={`${key}-${v}`} className="inline-flex items-center gap-2 rounded border border-gray-200 dark:border-gray-800 px-2 py-1.5">
            <input type="radio" checked={text(key) === v} onChange={() => (onSelect ? onSelect(v) : setText(key, v))} />
            <span>{codeLabel(v)}</span>
          </label>
        ))}
      </div>
    </div>
  );

  const cCode = (key: string, title: string, vals: string[], cols = "grid-cols-2 md:grid-cols-3") => (
    <div key={key} className="space-y-1">
      <div className={label}>{title}</div>
      <div className={`grid ${cols} gap-2`}>
        {vals.map((v) => (
          <label key={`${key}-${v}`} className="inline-flex items-center gap-2 rounded border border-gray-200 dark:border-gray-800 px-2 py-1.5">
            <input type="checkbox" checked={multi(key).includes(v)} onChange={() => toggle(key, v)} />
            <span>{codeLabel(v)}</span>
          </label>
        ))}
      </div>
    </div>
  );

  const b = (key: string, title: string) => (
    <label key={key} className="inline-flex items-center gap-2 rounded border border-gray-200 dark:border-gray-800 px-2 py-1.5">
      <input type="checkbox" checked={bool(key)} onChange={(e) => setBool(key, e.target.checked)} />
      <span>{title}</span>
    </label>
  );
  const dobText = text("dob");
  const dobFormatError =
    dobText.trim() !== "" && normalizeDateInputDDMMYYYY(dobText) == null
      ? "Use dd/mm/yyyy"
      : "";
  const extubationTimeText = text("extubation_time");
  const extubationTimeError =
    extubationTimeText.trim() !== "" && normalizeTimeInputHHMM(extubationTimeText) == null
      ? "Use HH:mm (24-hour)"
      : "";

  const tabClass = (tabId: FormTabId) =>
    `${tabButtonBase} ${
      activeTab === tabId
        ? "border-blue-500 bg-blue-600 text-white"
        : "border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-950 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800"
    }`;

  return (
    <div className="app-theme-scope p-4 pb-24 space-y-4 text-gray-900 dark:text-gray-100">
      <div className="sticky top-3 z-20">
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white/95 dark:bg-gray-950/95 backdrop-blur px-3 py-2 shadow-sm">
          {enabledTabs.map(tabId => {
            const tab = FORM_TAB_DEFS.find(item => item.id === tabId);
            if (!tab) return null;
            return (
              <div key={tab.id} className="inline-flex items-center gap-1">
                <button
                  type="button"
                  className={tabClass(tab.id)}
                  onClick={() => setActiveTab(tab.id)}
                >
                  {tab.label}
                </button>
                {tab.removable ? (
                  <button
                    type="button"
                    className="rounded border border-gray-300 dark:border-gray-700 px-1.5 py-1 text-xs text-gray-500 hover:text-red-500"
                    onClick={() => removeFormTab(tab.id)}
                    aria-label={`Remove ${tab.label}`}
                  >
                    x
                  </button>
                ) : null}
              </div>
            );
          })}
          {addableTabs.length > 0 ? (
            <div className="ml-auto inline-flex items-center gap-2">
              <select
                className="rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-950 px-2 py-1.5 text-sm"
                value={formPickerTab}
                onChange={e => setFormPickerTab(e.target.value as FormTabId)}
              >
                {addableTabs.map(tab => (
                  <option key={tab.id} value={tab.id}>
                    {tab.label}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className={secondaryButton}
                onClick={addFormTab}
              >
                Add Form
              </button>
            </div>
          ) : null}
        </div>
      </div>

      <section className={`${card} ${activeTab === "caseInfo" ? "" : "hidden"}`}>
        <h2 className="font-semibold">General Information</h2>
        <div className="space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <label className="space-y-1">
              <div className={label}>HN</div>
              <input className={inputNarrow} value={text("hn")} readOnly />
            </label>
            <label className="space-y-1">
              <div className={label}>AN</div>
              <input className={inputNarrow} value={text("an")} onChange={(e) => setText("an", e.target.value)} />
            </label>
            <label className="space-y-1">
              <div className={label}>Date of Birth</div>
              <input
                className={inputNarrow}
                type="text"
                inputMode="numeric"
                placeholder="dd/mm/yyyy"
                value={dobText}
                onChange={(e) => setDob(e.target.value, false)}
                onBlur={(e) => setDob(e.target.value, true)}
              />
              {dobFormatError ? (
                <div className="text-xs text-red-600 dark:text-red-400">{dobFormatError}</div>
              ) : (
                <div className="text-xs text-gray-500 dark:text-gray-400">Format: dd/mm/yyyy</div>
              )}
            </label>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <label className="space-y-1">
              <div className={label}>Age (Y)</div>
              <input
                className={inputNarrow}
                inputMode="numeric"
                value={text("ageY")}
                onChange={(e) => setAgeText("ageY", e.target.value)}
                onBlur={(e) => applyAgeToDob(e.target.value, text("ageM"))}
              />
            </label>
            <label className="space-y-1">
              <div className={label}>Age (M)</div>
              <input
                className={inputNarrow}
                inputMode="numeric"
                value={text("ageM")}
                onChange={(e) => setAgeText("ageM", e.target.value)}
                onBlur={(e) => applyAgeToDob(text("ageY"), e.target.value)}
              />
            </label>
            <label className="space-y-1">
              <div className={label}>Blood group (ABO)</div>
              <select
                className={inputCompact}
                value={text("bloodGroupABO")}
                onChange={(e) => setText("bloodGroupABO", e.target.value)}
              >
                <option value="">Select ABO</option>
                <option value="A">A</option>
                <option value="B">B</option>
                <option value="O">O</option>
                <option value="AB">AB</option>
              </select>
            </label>
            <label className="space-y-1">
              <div className={label}>Blood group (Rh)</div>
              <select
                className={inputCompact}
                value={text("bloodGroupRh")}
                onChange={(e) => setText("bloodGroupRh", e.target.value)}
              >
                <option value="">Select Rh</option>
                <option value="+">+</option>
                <option value="-">-</option>
              </select>
            </label>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <label className="space-y-1">
              <div className={label}>Height (cm)</div>
              <input
                className={inputNarrow}
                type="number"
                inputMode="decimal"
                min={30}
                max={250}
                value={text("heightCm")}
                onChange={(e) => setText("heightCm", e.target.value)}
                onBlur={(e) => setText("heightCm", clampNumeric(e.target.value, 30, 250, 0))}
              />
            </label>
            <label className="space-y-1">
              <div className={label}>Weight (kg)</div>
              <input
                className={inputNarrow}
                type="number"
                inputMode="decimal"
                step="0.1"
                min={0.5}
                max={300}
                value={text("weightKg")}
                onChange={(e) => setText("weightKg", e.target.value)}
                onBlur={(e) => setText("weightKg", clampNumeric(e.target.value, 0.5, 300, 1))}
              />
            </label>
            <label className="space-y-1">
              <div className={label}>ASA</div>
              <select
                className={inputCompact}
                value={text("asa")}
                onChange={(e) => setText("asa", e.target.value)}
              >
                <option value="">Select ASA</option>
                <option value="1">1</option>
                <option value="2">2</option>
                <option value="3">3</option>
                <option value="4">4</option>
                <option value="5">5</option>
                <option value="6">6</option>
              </select>
            </label>
            <div className="space-y-1">
              <div className={label}>Emergency</div>
              <label className="inline-flex items-center gap-2 rounded border border-gray-200 dark:border-gray-800 px-2 py-1.5">
                <input
                  type="checkbox"
                  checked={bool("emergency")}
                  onChange={(e) => setBool("emergency", e.target.checked)}
                />
                <span>Yes</span>
              </label>
            </div>
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <label className="space-y-1">
            <div className={label}>Service</div>
            <input
              className={inputNarrow}
              list="service-options"
              placeholder="Select service"
              value={text("service")}
              onChange={(e) => setText("service", e.target.value)}
              onBlur={(e) => {
                const value = e.target.value.trim();
                if (!value) return;
                if (!isServiceOption(value)) {
                  setText("service", "");
                  setSaveNote("Service must be selected from the list");
                } else {
                  setText("service", value);
                }
              }}
            />
            <datalist id="service-options">
              {options.serviceProvider.map((v) => (
                <option key={v} value={v} />
              ))}
            </datalist>
          </label>
          {r("clinic", "Clinic", ["IPD", "OPD"], "grid-cols-2")}
        </div>
        {text("service") === "Other" ? (
          <label className="space-y-1">
            <div className={label}>Service - Other</div>
            <input
              className={inputNarrow}
              value={text("serviceProviderOther")}
              onChange={(e) => setText("serviceProviderOther", e.target.value)}
            />
          </label>
        ) : null}
        {r("postoperativeDestination", "Postoperative destination", ["PACU", "ICU", "Ward", "Death"])}
        <div className="rounded border border-gray-200 dark:border-gray-800 px-3 py-2 text-xs text-gray-500 dark:text-gray-400">
          Diagnosis and Operation are managed in the <span className="font-semibold">Diagnosis</span> tab.
        </div>
      </section>

      <section className={`${card} ${activeTab === "caseInfo" ? "" : "hidden"}`}>
        <h2 className="font-semibold">Anesthesia and Monitoring</h2>

        {/* Anesthesia type checkboxes — auto-open the matching detail tab */}
        <div className="space-y-1">
          <div className={label}>Anesthesia</div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {options.anesthesia.map(v => {
              const mappedTab = ANESTHESIA_TAB_MAP[v];
              const tabLabel = mappedTab
                ? FORM_TAB_DEFS.find(t => t.id === mappedTab)?.label
                : null;
              return (
                <label
                  key={`anesthesiaTypes-${v}`}
                  className="inline-flex items-center gap-2 rounded border border-gray-200 dark:border-gray-800 px-2 py-1.5 cursor-pointer"
                >
                  <input
                    type="checkbox"
                    checked={multi("anesthesiaTypes").includes(v)}
                    onChange={() => toggleAnesthesiaType(v)}
                  />
                  <span className="flex-1">{v}</span>
                  {tabLabel ? (
                    <span className="text-[10px] text-[var(--app-muted)] shrink-0">
                      → {tabLabel}
                    </span>
                  ) : null}
                </label>
              );
            })}
          </div>
        </div>

        {c("monitoring", "Monitoring", options.monitoring, "grid-cols-1 md:grid-cols-3")}
      </section>

      <section className={`${card} ${activeTab === "caseInfo" ? "" : "hidden"}`}>
        <h2 className="font-semibold">Patient Safety</h2>
        {c("positioning", "Positioning", options.positioning, "grid-cols-1 md:grid-cols-4")}
        {r("headSupport", "Head support", ["Headrest", "Head pin", "Horseshoe headrest"], "grid-cols-1 md:grid-cols-3")}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {r("rightArmPosition", "Right arm position", ["On armrest", "Tucked"], "grid-cols-2")}
          {r("leftArmPosition", "Left arm position", ["On armrest", "Tucked"], "grid-cols-2")}
        </div>
        {c("patientSafetyChecks", "Patient safety", options.patientSafety, "grid-cols-1 md:grid-cols-2")}
        {c("temperatureControl", "Temperature control", options.temperatureControl, "grid-cols-1 md:grid-cols-3")}
      </section>

      <section className={`${card} ${activeTab === "comorbid" ? "" : "hidden"}`}>
        <h2 className="font-semibold">Comorbid</h2>
        <label className="space-y-1">
          <div className={label}>Comorbid Diseases</div>
          <textarea
            className={input}
            rows={8}
            value={text("comorbidDiseases")}
            onChange={(e) => setText("comorbidDiseases", e.target.value)}
          />
        </label>
        <label className="space-y-1">
          <div className={label}>Current Medication</div>
          <textarea
            className={input}
            rows={8}
            value={text("currentMedication")}
            onChange={(e) => setText("currentMedication", e.target.value)}
          />
        </label>
      </section>

      <section className={`${card} ${activeTab === "line" ? "" : "hidden"}`}>
        <h2 className="font-semibold">Line</h2>
        <div className="rounded border border-gray-200 dark:border-gray-800 p-3 space-y-3">
          <div className="font-medium">IV Catheter</div>
          {r("ivSites", "Site", options.ivSites, "grid-cols-1 md:grid-cols-3")}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {rCompact("ivCatheterSize", "Gauge", options.ivGauge, "grid-cols-3 md:grid-cols-6")}
            {r("ivWhereInserted", "Inserted", ["OR", "In situ"], "grid-cols-2")}
            {attemptField("ivAttempts", "No. of attempts")}
          </div>
        </div>
        <div className="rounded border border-gray-200 dark:border-gray-800 p-3 space-y-3">
          <div className="font-medium">Arterial Line</div>
          {r("arterialSites", "Site", options.arterialSites, "grid-cols-1 md:grid-cols-3")}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {rCompact("arterialCatheterSize", "Gauge", options.arterialGauge, "grid-cols-3")}
            {r("arterialWhereInserted", "Inserted", ["OR", "In situ"], "grid-cols-2")}
            {attemptField("arterialAttempts", "No. of attempts")}
          </div>
        </div>
        <div className="rounded border border-gray-200 dark:border-gray-800 p-3 space-y-3">
          <div className="font-medium">Central Venous Catheter</div>
          {r("cvcSites", "Site", options.cvcSites, "grid-cols-1 md:grid-cols-2")}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {rCompact("cvcLumens", "Lumens", options.cvcLumens, "grid-cols-3")}
            {rCompact("cvcCatheterSize", "Catheter size", options.cvcSizeFr, "grid-cols-3")}
            {r("cvcWhereInserted", "Inserted", ["OR", "In situ"], "grid-cols-2")}
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {rCode("cvcUltrasound", "Ultrasound", options.gaYesNo, "grid-cols-2")}
            {attemptField("cvcAttempts", "No. of attempts")}
          </div>
        </div>
      </section>

      <section className={`${card} ${activeTab === "ga" ? "" : "hidden"}`}>
        <h2 className="font-semibold">General Anesthesia</h2>
        {c("pre_induction", "Pre-induction", options.gaPreInduction, "grid-cols-1 md:grid-cols-2")}
        {c("induction", "Induction", options.gaInduction, "grid-cols-1 md:grid-cols-3")}
        {rCode("mask_ventilation_difficulty", "Mask ventilation difficulty", options.gaMaskVentilationDifficulty, "grid-cols-3")}
        {cCode("eye_protection", "Eye protection", options.gaEyeProtection, "grid-cols-1 md:grid-cols-3")}
        <div className="rounded border border-gray-200 dark:border-gray-800 p-3 space-y-3">
          <div className="font-medium">Airway</div>
          {rCode("primary_airway_device", "Primary airway device", options.gaPrimaryAirway, "grid-cols-1 md:grid-cols-2", (value) => setAirwayDevice("primary", value))}

          {text("primary_airway_device") === "mask" ? (
            <div className="rounded border border-gray-200 dark:border-gray-800 p-3 space-y-3">
              <div className="font-medium">Primary: Mask</div>
              {rCode("mask_adjunct", "Mask adjunct", options.gaMaskAdjunct, "grid-cols-1 md:grid-cols-3")}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {t("opa_size", "OPA size")}
                {t("npa_size", "NPA size")}
              </div>
            </div>
          ) : null}

          {text("primary_airway_device") === "oral_endotracheal_tube" ? (
            <div className="rounded border border-gray-200 dark:border-gray-800 p-3 space-y-3">
              <div className="font-medium">Primary: Oral endotracheal tube</div>
              {rCode("oral_tube_type", "Tube type", options.gaTubeType, "grid-cols-1 md:grid-cols-3")}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                {t("oral_tube_size", "Tube size")}
                {rCode("oral_cuff", "Cuff", options.gaCuff, "grid-cols-2")}
                {t("oral_cuff_volume_ml", "Cuff volume (mL)", "number")}
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                {t("oral_tube_depth_cm", "Tube depth (cm)", "number")}
                {rCode("oral_throat_pack", "Throat pack", options.gaYesNo, "grid-cols-2")}
                {rCode("oral_tube_in_situ", "Tube in situ", options.gaYesNo, "grid-cols-2")}
              </div>
            </div>
          ) : null}

          {text("primary_airway_device") === "nasal_endotracheal_tube" ? (
            <div className="rounded border border-gray-200 dark:border-gray-800 p-3 space-y-3">
              <div className="font-medium">Primary: Nasal endotracheal tube</div>
              {rCode("nasal_tube_type", "Tube type", options.gaTubeType, "grid-cols-1 md:grid-cols-3")}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                {t("nasal_tube_size", "Tube size")}
                {rCode("nasal_cuff", "Cuff", options.gaCuff, "grid-cols-2")}
                {t("nasal_cuff_volume_ml", "Cuff volume (mL)", "number")}
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                {t("nasal_tube_depth_cm", "Tube depth (cm)", "number")}
                {rCode("nasal_preparation", "Nasal preparation", options.gaNasalPreparation, "grid-cols-1 md:grid-cols-3")}
                {rCode("nasal_nostril", "Nostril", options.gaNostril, "grid-cols-3")}
              </div>
              {rCode("nasal_throat_pack", "Pack", options.gaYesNo, "grid-cols-2")}
              {rCode("nasal_tube_in_situ", "Tube in situ", options.gaYesNo, "grid-cols-2")}
            </div>
          ) : null}

          {text("primary_airway_device") === "lma" ? (
            <div className="rounded border border-gray-200 dark:border-gray-800 p-3 space-y-3">
              <div className="font-medium">Primary: LMA</div>
              {rCode("lma_type", "LMA type", options.gaLmaType, "grid-cols-1 md:grid-cols-3")}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                {t("lma_size", "LMA size")}
                {t("lma_cuff_volume_ml", "Cuff volume (mL)", "number")}
                {t("lma_number_of_attempts", "Number of attempts", "number")}
              </div>
            </div>
          ) : null}

          {text("primary_airway_device") === "tracheostomy_tube" ? (
            <div className="rounded border border-gray-200 dark:border-gray-800 p-3 space-y-3">
              <div className="font-medium">Primary: Tracheostomy tube</div>
              {rCode("trach_type", "Trach type", options.gaTrachType, "grid-cols-1 md:grid-cols-3")}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                {t("trach_size", "Trach size")}
                {rCode("trach_cuff", "Cuff", options.gaCuff, "grid-cols-2")}
                {t("trach_cuff_volume_ml", "Cuff volume (mL)", "number")}
              </div>
            </div>
          ) : null}

          {text("primary_airway_device") === "jet_ventilation" ? (
            <div className="rounded border border-gray-200 dark:border-gray-800 p-3 space-y-3">
              <div className="font-medium">Primary: Jet ventilation</div>
              {rCode("jet_type", "Jet type", options.gaJetType, "grid-cols-2")}
            </div>
          ) : null}

          {text("primary_airway_device") === "other" ? (
            <div className="rounded border border-gray-200 dark:border-gray-800 p-3 space-y-3">
              <div className="font-medium">Primary: Other airway</div>
              {a("airway_description", "Airway description", 3)}
            </div>
          ) : null}

          {text("primary_airway_device") ? (
            <AirwayTechniquePanel
              title="Primary technique"
              techniquesRaw={text("primary_airway_techniques")}
              failedIntubation={bool("primary_failed_intubation")}
              onTechniquesChange={(nextRaw) => setText("primary_airway_techniques", nextRaw)}
              onFailedIntubationChange={(next) => setBool("primary_failed_intubation", next)}
            />
          ) : null}

          <label className="inline-flex items-center gap-2 rounded border border-gray-200 dark:border-gray-800 px-2 py-1.5">
            <input
              type="checkbox"
              checked={bool("secondary_airway_enabled")}
              onChange={(e) => {
                const checked = e.target.checked;
                setForm((prev) => {
                  if (!checked) {
                    const next: FormState = {
                      ...prev,
                      secondary_airway_enabled: false,
                      secondary_airway_device: "",
                      secondary_airway_techniques: "[]",
                      secondary_failed_intubation: false,
                    };
                    for (const base of AIRWAY_DETAIL_FIELDS) {
                      next[`secondary_${base}`] = "";
                    }
                    return next;
                  }
                  const next: FormState = {
                    ...prev,
                    secondary_airway_enabled: true,
                    secondary_airway_device: normalizeCodeText(prev.primary_airway_device),
                  };
                  for (const base of AIRWAY_DETAIL_FIELDS) {
                    next[`secondary_${base}`] = normalizeCodeText(prev[base]);
                  }
                  next.secondary_airway_techniques = normalizeCodeText(prev.primary_airway_techniques) || "[]";
                  next.secondary_failed_intubation = prev.primary_failed_intubation === true;
                  return next;
                });
              }}
            />
            <span>Secondary airway</span>
          </label>

          {bool("secondary_airway_enabled") ? (
            <div className="rounded border border-gray-200 dark:border-gray-800 p-3 space-y-3">
              {rCode("secondary_airway_device", "Secondary airway device", options.gaPrimaryAirway, "grid-cols-1 md:grid-cols-2", (value) => setAirwayDevice("secondary", value))}

              {text("secondary_airway_device") === "mask" ? (
                <div className="rounded border border-gray-200 dark:border-gray-800 p-3 space-y-3">
                  <div className="font-medium">Secondary: Mask</div>
                  {rCode("secondary_mask_adjunct", "Mask adjunct", options.gaMaskAdjunct, "grid-cols-1 md:grid-cols-3")}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {t("secondary_opa_size", "OPA size")}
                    {t("secondary_npa_size", "NPA size")}
                  </div>
                </div>
              ) : null}

              {text("secondary_airway_device") === "oral_endotracheal_tube" ? (
                <div className="rounded border border-gray-200 dark:border-gray-800 p-3 space-y-3">
                  <div className="font-medium">Secondary: Oral endotracheal tube</div>
                  {rCode("secondary_oral_tube_type", "Tube type", options.gaTubeType, "grid-cols-1 md:grid-cols-3")}
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    {t("secondary_oral_tube_size", "Tube size")}
                    {rCode("secondary_oral_cuff", "Cuff", options.gaCuff, "grid-cols-2")}
                    {t("secondary_oral_cuff_volume_ml", "Cuff volume (mL)", "number")}
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    {t("secondary_oral_tube_depth_cm", "Tube depth (cm)", "number")}
                    {rCode("secondary_oral_throat_pack", "Throat pack", options.gaYesNo, "grid-cols-2")}
                    {rCode("secondary_oral_tube_in_situ", "Tube in situ", options.gaYesNo, "grid-cols-2")}
                  </div>
                </div>
              ) : null}

              {text("secondary_airway_device") === "nasal_endotracheal_tube" ? (
                <div className="rounded border border-gray-200 dark:border-gray-800 p-3 space-y-3">
                  <div className="font-medium">Secondary: Nasal endotracheal tube</div>
                  {rCode("secondary_nasal_tube_type", "Tube type", options.gaTubeType, "grid-cols-1 md:grid-cols-3")}
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    {t("secondary_nasal_tube_size", "Tube size")}
                    {rCode("secondary_nasal_cuff", "Cuff", options.gaCuff, "grid-cols-2")}
                    {t("secondary_nasal_cuff_volume_ml", "Cuff volume (mL)", "number")}
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    {t("secondary_nasal_tube_depth_cm", "Tube depth (cm)", "number")}
                    {rCode("secondary_nasal_preparation", "Nasal preparation", options.gaNasalPreparation, "grid-cols-1 md:grid-cols-3")}
                    {rCode("secondary_nasal_nostril", "Nostril", options.gaNostril, "grid-cols-3")}
                  </div>
                  {rCode("secondary_nasal_throat_pack", "Pack", options.gaYesNo, "grid-cols-2")}
                  {rCode("secondary_nasal_tube_in_situ", "Tube in situ", options.gaYesNo, "grid-cols-2")}
                </div>
              ) : null}

              {text("secondary_airway_device") === "lma" ? (
                <div className="rounded border border-gray-200 dark:border-gray-800 p-3 space-y-3">
                  <div className="font-medium">Secondary: LMA</div>
                  {rCode("secondary_lma_type", "LMA type", options.gaLmaType, "grid-cols-1 md:grid-cols-3")}
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    {t("secondary_lma_size", "LMA size")}
                    {t("secondary_lma_cuff_volume_ml", "Cuff volume (mL)", "number")}
                    {t("secondary_lma_number_of_attempts", "Number of attempts", "number")}
                  </div>
                </div>
              ) : null}

              {text("secondary_airway_device") === "tracheostomy_tube" ? (
                <div className="rounded border border-gray-200 dark:border-gray-800 p-3 space-y-3">
                  <div className="font-medium">Secondary: Tracheostomy tube</div>
                  {rCode("secondary_trach_type", "Trach type", options.gaTrachType, "grid-cols-1 md:grid-cols-3")}
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    {t("secondary_trach_size", "Trach size")}
                    {rCode("secondary_trach_cuff", "Cuff", options.gaCuff, "grid-cols-2")}
                    {t("secondary_trach_cuff_volume_ml", "Cuff volume (mL)", "number")}
                  </div>
                </div>
              ) : null}

              {text("secondary_airway_device") === "jet_ventilation" ? (
                <div className="rounded border border-gray-200 dark:border-gray-800 p-3 space-y-3">
                  <div className="font-medium">Secondary: Jet ventilation</div>
                  {rCode("secondary_jet_type", "Jet type", options.gaJetType, "grid-cols-2")}
                </div>
              ) : null}

              {text("secondary_airway_device") === "other" ? (
                <div className="rounded border border-gray-200 dark:border-gray-800 p-3 space-y-3">
                  <div className="font-medium">Secondary: Other airway</div>
                  {a("secondary_airway_description", "Airway description", 3)}
                </div>
              ) : null}

              {text("secondary_airway_device") ? (
                <AirwayTechniquePanel
                  title="Secondary technique"
                  techniquesRaw={text("secondary_airway_techniques")}
                  failedIntubation={bool("secondary_failed_intubation")}
                  onTechniquesChange={(nextRaw) => setText("secondary_airway_techniques", nextRaw)}
                  onFailedIntubationChange={(next) => setBool("secondary_failed_intubation", next)}
                />
              ) : null}
            </div>
          ) : null}
        </div>
      </section>

      <section className={`${card} ${activeTab === "neuraxial" ? "" : "hidden"}`}>
        <h2 className="font-semibold">Neuraxial Anesthesia</h2>
        {r("neuraxialBlockType", "Neuraxial block type", options.neuraxialTechniques, "grid-cols-1 md:grid-cols-2")}
        {c("neuraxialSterilePrecautions", "Sterile precautions", options.sterileBarrier, "grid-cols-2 md:grid-cols-4")}
        <div className="rounded border border-gray-200 dark:border-gray-800 p-3 space-y-3">
          <div className="font-medium">Spinal Anesthesia</div>
          {r("spinalSkinPreparation", "Skin preparation", options.skinPrep, "grid-cols-1 md:grid-cols-3")}
          {b("spinalLetAirDry", "Let air dry")}
          {r("spinalApproachingLevel", "Approaching level", options.levels, "grid-cols-2 md:grid-cols-4")}
          {b("spinalCaudalBlock", "Caudal block")}
          {r("spinalNeedle", "Needle", ["Quincke", "Whitacre", "Sprotte", "Pencil point"], "grid-cols-2 md:grid-cols-4")}
          {b("spinalBlockFailure", "Block failure")}
          {a("spinalEvent", "Event", 2)}
        </div>
        <div className="rounded border border-gray-200 dark:border-gray-800 p-3 space-y-3">
          <div className="font-medium">Epidural Anesthesia</div>
          {r("epiduralSkinPreparation", "Skin preparation", options.skinPrep, "grid-cols-1 md:grid-cols-3")}
          {b("epiduralLetAirDry", "Let air dry")}
          {r("epiduralApproachingLevel", "Approaching level", options.levels, "grid-cols-2 md:grid-cols-4")}
          {b("epiduralNeedleTuohy", "Needle: Tuohy")}
          {r("epiduralLossResistance", "Loss of resistance technique", ["Air", "Normal saline"], "grid-cols-2")}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">{t("epiduralDepthCm", "Depth from skin to space (cm)", "number")}{t("epiduralCatheterMarkCm", "Catheter mark (cm)", "number")}</div>
          {b("epiduralBlockFailure", "Block failure")}
          {a("epiduralEvent", "Event", 2)}
        </div>
      </section>

      <section className={`${card} ${activeTab === "invasive" ? "" : "hidden"}`}>
        <h2 className="font-semibold">Invasive Catheter</h2>
        {r("cvcInsertionSites", "Site", options.invasiveCvcSites, "grid-cols-1 md:grid-cols-2")}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {rCompact("cvcInsertionLumens", "Lumens", options.cvcLumens, "grid-cols-3")}
          {rCompact("cvcInsertionCatheterSize", "Catheter size (Fr)", options.invasiveCatheterSizes, "grid-cols-3 md:grid-cols-6")}
        </div>
        {rCode("cvcInsertionUltrasound", "Ultrasound guidance", options.gaYesNo, "grid-cols-2")}
        {attemptField("cvcInsertionAttempts", "Attempts")}
        <div className="pt-1" />
        <h3 className="font-medium">Sterile Precaution</h3>
        {c("cvcSterileBarriers", "Precaution", options.invasiveSterilePrecautions, "grid-cols-1 md:grid-cols-2")}
        <div className="pt-1" />
        {b("cvcHandScrub", "Hand scrub")}
        {r("cvcSkinPreparation", "Skin preparation", options.skinPrep.slice(0, 4), "grid-cols-1 md:grid-cols-2")}
        {b("cvcLetSkinDry", "Let skin dry")}
        {c("cvcPreCannulation", "Pre-cannulation", options.cvcPre, "grid-cols-1 md:grid-cols-2")}
        {r("cvcCannulationTechnique", "Cannulation technique", ["Landmark", "Real-time ultrasound guide", "Ultrasound-guide landmark"], "grid-cols-1 md:grid-cols-3")}
        {c("cvcPlacementConfirmation", "Venous placement confirmation", options.cvcPlacement, "grid-cols-1 md:grid-cols-3")}
        {c("cvcPostCannulation", "Post-cannulation", options.cvcPost, "grid-cols-1 md:grid-cols-2")}
      </section>

      <section className={`${card} ${activeTab === "extubation" ? "" : "hidden"}`}>
        <h2 className="font-semibold">Extubation</h2>
        <label className="space-y-1">
          <div className={label}>Extubation time (HH:mm)</div>
          <input
            className={input}
            type="text"
            inputMode="numeric"
            autoComplete="off"
            placeholder="HH:mm"
            value={extubationTimeText}
            onChange={(e) => setText("extubation_time", e.target.value)}
            onBlur={(e) => {
              const normalized = normalizeTimeInputHHMM(e.target.value);
              if (normalized) setText("extubation_time", normalized);
            }}
          />
          {extubationTimeError ? (
            <div className="text-xs text-red-600 dark:text-red-400">{extubationTimeError}</div>
          ) : (
            <div className="text-xs text-gray-500 dark:text-gray-400">Format: HH:mm</div>
          )}
        </label>
        {r("extubation_location", "Extubation location", options.extubationLocation, "grid-cols-1 md:grid-cols-2")}
        {rCode("extubation_status", "Extubation status", options.extubationStatus, "grid-cols-3")}
        {rCode(
          "airway_device_removed",
          "Airway device removed",
          options.gaPrimaryAirway.filter((value) =>
            ["oral_endotracheal_tube", "nasal_endotracheal_tube", "lma", "tracheostomy_tube"].includes(value),
          ),
          "grid-cols-1 md:grid-cols-2",
        )}
        {!text("airway_device_removed") && text("primary_airway_device") ? (
          <div className="text-xs text-gray-500 dark:text-gray-400">
            Default from GA primary airway: {codeLabel(text("primary_airway_device"))}
          </div>
        ) : null}
        {rCode("suction_performed", "Suction performed", options.gaYesNo, "grid-cols-2")}
        {a("extubation_note", "Extubation note", 4)}
      </section>

      {showSavedPreview ? (
        <div className="fixed inset-0 z-30 bg-black/40 flex items-center justify-center p-4">
          <div className="w-full max-w-3xl max-h-[80vh] rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-950 shadow-lg flex flex-col">
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-800">
              <div className="font-medium">Saved Draft Preview</div>
              <button
                type="button"
                className={secondaryButton}
                onClick={() => setShowSavedPreview(false)}
              >
                Close
              </button>
            </div>
            <pre className="p-4 overflow-auto text-xs text-gray-800 dark:text-gray-100 whitespace-pre-wrap break-words">
              {savedPreview}
            </pre>
          </div>
        </div>
      ) : null}

      <div className="sticky bottom-3 z-20 flex justify-end">
        <div className="flex items-center gap-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white/95 dark:bg-gray-950/95 backdrop-blur px-3 py-2 shadow-sm">
          {saveNote ? <div className="text-xs text-gray-500 dark:text-gray-400 mr-1">{saveNote}</div> : null}
          <button
            type="button"
            className={primaryButton}
            onClick={save}
          >
            Save
          </button>
          <button
            type="button"
            className={secondaryButton}
            onClick={viewSaved}
          >
            View Saved
          </button>
          <button
            type="button"
            className={dangerButton}
            onClick={() => setIsResetConfirmOpen(true)}
          >
            Reset
          </button>
        </div>
      </div>

      <ConfirmDialog
        open={isResetConfirmOpen}
        title="Reset Form Draft?"
        message="This will clear unsaved and saved draft values for this case."
        confirmLabel="Reset"
        busy={false}
        onCancel={() => setIsResetConfirmOpen(false)}
        onConfirm={() => {
          reset();
          setIsResetConfirmOpen(false);
        }}
      />
    </div>
  );
}
