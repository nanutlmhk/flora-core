import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CaseStatus } from "../api/caseApi";
import ConfirmDialog from "../components/common/ConfirmDialog";
import {
  deleteCaseDetailDraft,
  getCaseDetailDraft,
  saveCaseDetailDraft,
} from "../api/caseDetailApi";
import {
  formatDateInputDDMMYYYY,
  normalizeDateInputDDMMYYYY,
  normalizeTimeInputHHMM,
} from "../utils/clinicalInput";

type FormValue = string | boolean | string[];
type FormState = Record<string, FormValue>;
type FormTabId =
  | "caseInfo"
  | "ga_ett"
  | "ga_lma"
  | "ga_tubeless"
  | "neuraxial"
  | "pnb"
  | "line"
  | "invasive"
  | "comorbid"
  | "extubation";

const GA_TAB_IDS: FormTabId[] = ["ga_ett", "ga_lma", "ga_tubeless"];
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
  { id: "ga_ett", label: "GA ETT", removable: true },
  { id: "ga_lma", label: "GA LMA", removable: true },
  { id: "ga_tubeless", label: "GA Tubeless", removable: true },
  { id: "neuraxial", label: "Neuraxial Block", removable: true },
  { id: "pnb", label: "PNB", removable: true },
  { id: "line", label: "Line", removable: true },
  { id: "comorbid", label: "Comorbid", removable: true },
  { id: "extubation", label: "Extubation", removable: true },
];

const NON_GA_ADDABLE_TABS = FORM_TAB_DEFS.filter(t => t.removable && !GA_TAB_IDS.includes(t.id));

const FORM_REQUIRED_TAB: FormTabId = "caseInfo";
const AIRWAY_DETAIL_FIELDS_BY_DEVICE: Record<string, string[]> = {
  facemask: ["mask_adjunct", "opa_size", "npa_size"],
  oral_endotracheal_tube: [
    "oral_tube_type", "oral_tube_size", "oral_tube_mark_cm",
    "oral_cuff", "oral_cuff_volume_ml", "oral_cuff_pressure_cmh2o",
    "oral_tube_depth_cm", "oral_throat_pack", "oral_tube_in_situ",
  ],
  nasal_endotracheal_tube: [
    "nasal_tube_type", "nasal_tube_size", "nasal_tube_mark_cm",
    "nasal_cuff", "nasal_cuff_volume_ml", "nasal_cuff_pressure_cmh2o",
    "nasal_tube_depth_cm", "nasal_preparation", "nasal_nostril",
    "nasal_throat_pack", "nasal_tube_in_situ",
  ],
  tracheostomy_tube: [
    "trach_type", "trach_size", "trach_cuff",
    "trach_cuff_volume_ml", "trach_cuff_pressure_cmh2o", "trach_tube_in_situ",
  ],
  lma: ["lma_type", "lma_size", "lma_cuff_volume_ml", "lma_number_of_attempts", "lma_confirmation"],
  jet_ventilation: ["jet_type"],
  rigid_bronchoscope: [],
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
  "Spinal anesthesia":   "neuraxial",
  "Epidural anesthesia": "neuraxial",
  "Peripheral nerve block": "pnb",
  "Truncal block": "pnb",
  // "General anesthesia" now uses GA ETT/LMA/Tubeless tabs selected manually
  // "Conscious sedation/MAC" intentionally omitted — no dedicated tab
};

function normalizeEnabledForms(v: FormValue | undefined): FormTabId[] {
  const order = FORM_TAB_DEFS.map(tab => tab.id);
  const allowed = new Set(order);
  const raw = Array.isArray(v) ? v : [];
  const seen = new Set<FormTabId>();
  if (!seen.has(FORM_REQUIRED_TAB)) seen.add(FORM_REQUIRED_TAB);
  for (const item of raw) {
    if (typeof item !== "string") continue;
    if (item === "invasive") {
      seen.add("line");
      continue;
    }
    if (!allowed.has(item as FormTabId)) continue;
    seen.add(item as FormTabId);
  }
  return order.filter(id => seen.has(id));
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

function normalizeMonitoringList(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  const normalized: string[] = [];
  for (const raw of values) {
    if (typeof raw !== "string") continue;
    const value = raw.trim();
    if (!value) continue;
    if (value === "EEG") {
      normalized.push("EEG/BIS");
      continue;
    }
    if (value === "NIR") {
      normalized.push("NIR Left", "NIR Right");
      continue;
    }
    normalized.push(value);
  }
  return Array.from(new Set(normalized));
}

const options = {
  serviceProvider: split(
    "G1|G2|G3|G4|Colorectal surgery|Urosurgery|Plastic surgery|Cardiothoracic surgery|Neurosurgery|Pediatric surgery|Obs & Gyn surgery|Orthopedic surgery|Ophthalmology|ENT|Breast center|Bronchoscopy|GI endoscopy|Surgical endoscopy|Cath Lab|ECT|Interventional radiology|Diagnostic radiology|Radiation therapy|Nuclear medicine|Other",
  ),
  anesthesia: split(
    "General anesthesia|Spinal anesthesia|Epidural anesthesia|Peripheral nerve block|Truncal block|Conscious sedation/MAC",
  ),
  monitoring: split(
    "NIBP|ECG|Pulse oximetry|Capnography|Temperature|Urine output|Invasive blood pressure|Central venous pressure|Pulmonary arterial pressure|Cardiac output|EEG/BIS|NIR Left|NIR Right",
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
  ivSimpleInserted: split("Inserted in OR|In-situ|Inserted in ward|Inserted in ICU"),
  arterialSites: split(
    "Right radial artery|Left radial artery|Right femoral artery|Left femoral artery|Right brachial artery|Left brachial artery|Right dorsalis pedis|Left dorsalis pedis",
  ),
  cvcSites: split(
    "Right internal jugular vein|Left internal jugular vein|Right subclavian vein|Left subclavian vein|Right brachial vein|Left brachial vein|Right femoral vein|Left femoral vein|Right external jugular vein|Left external jugular vein",
  ),
  invasiveCvcSites: split(
    "Right internal jugular|Left internal jugular|Right subclavian|Left subclavian|Right femoral|Left femoral",
  ),
  invasiveLineCounts: split("0|1|2|3|4"),
  invasiveInserted: split("Inserted in OR|In-situ|Inserted in ICU|Inserted in ward"),
  invasiveSide: split("Left|Right"),
  invasiveArterialSites: split(
    "Radial artery|Femoral artery|Brachial artery|Dorsalis pedis|Axillary artery|Other",
  ),
  invasiveCvcSimpleSites: split(
    "Internal jugular vein|Subclavian vein|Femoral vein|External jugular vein|Brachial vein|Other",
  ),
  invasiveCvcTechnique: split("Landmark|Ultrasound guide|Ultrasound-guide landmark"),
  invasiveCvcTypes: split(
    "1 Lumen|2 Lumens|3 Lumens|4 Lumens|Introducer|Dialysis catheter|PICC|Other",
  ),
  invasiveCatheterSizes: split("4F|5F|6F|7F|8.5F|9F"),
  invasiveDifficulty: split("No|Yes"),
  invasiveYesNo: split("No|Yes"),
  invasiveSterilePrecautions: split(
    "Sterile/Drapes/Gown/Gloves/Glasses|Hand hygiene|Sterile gown|Sterile gloves|Sterile drape|Cap|Mask|Eye protection|Sterile probe cover",
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
  pnbTechniques: split(
    "FIPB|Femoral block|Adductor canal block|Sciatic block|Popliteal sciatic block|Interscalene block|Supraclavicular block|Infraclavicular block|Axillary block|TAP block|ESP block|PECS block|Paravertebral block|Other",
  ),
  pnbPerformedTechniques: split("Single shot|Continuous catheter"),
  pnbGuidance: split("Anatomical / PNS|USG-guided|USG + PNS|Other"),
  pnbSides: split("Left|Right|Bilateral|Midline"),
  pnbNeedles: split("Stimuplex|Echogenic block needle|Tuohy|Other"),
  pnbNeedleGauge: split("18 G|20 G|21 G|22 G|23 G"),
  pnbAsepticTechnique: split(
    "Sterile gloves|Sterile drape|Mask|Cap|Sterile probe cover",
  ),
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
  gaLmaType: split("first_generation|second_generation|flexible_lma"),
  gaLmaConfirmation: split("chest_rise|positive_capnography"),
  gaTrachType: split("portex|shiley|silver|other"),
  gaJetType: split("hfjv|manual"),
  gaTubelessTechnique: split("facemask|jet_ventilation|rigid_bronchoscope"),
  gaTechniqueType: split("direct_laryngoscopy|vdo_laryngoscopy|fiberoptic|fiberscope_bonfils"),
  gaBladeType: split("macintosh|miller"),
  gaVdoType: split("c-mac|mc_grath|glidescope|other"),
  gaVdoBlade: split("adult|pediatric|d-blade"),
  gaGuideStylet: split("yes|no"),
  gaLaryngoscopicView: split("1|2|3|4"),
  gaAttemptNumber: split("1|2|3|4|5|6"),
  extubationLocation: split("Extubated in OR|Extubated in PACU|Extubated in ICU|Remain Intubated"),
  extubationStatus: split("awake|deep|other"),
  extubationCondition: split("Awake, follow command|Deep anesthesia|Smooth extubation|Not assessed|Other"),
  extubationTof: split("No|Yes"),
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
    ivLineCount: "0",
    ivLine1Site: "",
    ivLine1Gauge: "",
    ivLine1Inserted: "",
    ivLine1Attempts: "",
    ivLine1Note: "",
    ivLine2Site: "",
    ivLine2Gauge: "",
    ivLine2Inserted: "",
    ivLine2Attempts: "",
    ivLine2Note: "",
    ivLine3Site: "",
    ivLine3Gauge: "",
    ivLine3Inserted: "",
    ivLine3Attempts: "",
    ivLine3Note: "",
    ivLine4Site: "",
    ivLine4Gauge: "",
    ivLine4Inserted: "",
    ivLine4Attempts: "",
    ivLine4Note: "",
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
    oral_tube_mark_cm: "",
    oral_cuff: "",
    oral_cuff_volume_ml: "",
    oral_cuff_pressure_cmh2o: "",
    oral_tube_depth_cm: "",
    oral_throat_pack: "",
    oral_tube_in_situ: "",
    nasal_tube_type: "",
    nasal_tube_size: "",
    nasal_tube_mark_cm: "",
    nasal_cuff: "",
    nasal_cuff_volume_ml: "",
    nasal_cuff_pressure_cmh2o: "",
    nasal_tube_depth_cm: "",
    nasal_preparation: "",
    nasal_nostril: "",
    nasal_throat_pack: "",
    nasal_tube_in_situ: "",
    lma_type: "",
    lma_size: "",
    lma_cuff_volume_ml: "",
    lma_number_of_attempts: "",
    lma_confirmation: [],
    trach_type: "",
    trach_size: "",
    trach_cuff: "",
    trach_cuff_volume_ml: "",
    trach_cuff_pressure_cmh2o: "",
    trach_tube_in_situ: "",
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
    pnbTechnique: "",
    pnbSecondTechnique: "",
    pnbSedation: "",
    pnbSide: "",
    pnbPerformedTechnique: "",
    pnbGuidance: "",
    pnbAsepticTechnique: [],
    pnbSkinPreparation: "",
    pnbNeedle: "",
    pnbGauge: "",
    pnbCatheter: "",
    pnbCatheterMarkSkinCm: "",
    pnbCatheterThreadedCm: "",
    pnbMedicationDose: "",
    pnbComplications: "",
    pnbEventNote: "",
    cvcInsertionSites: "",
    cvcInsertionCatheterSize: "",
    cvcInsertionLumens: "",
    cvcInsertionUltrasound: "",
    cvcInsertionAttempts: "",
    invasiveArterialCount: "0",
    invasiveArterial1Inserted: "",
    invasiveArterial1Gauge: "",
    invasiveArterial1Side: "",
    invasiveArterial1Site: "",
    invasiveArterial1Attempts: "",
    invasiveArterial1Comment: "",
    invasiveArterial2Inserted: "",
    invasiveArterial2Gauge: "",
    invasiveArterial2Side: "",
    invasiveArterial2Site: "",
    invasiveArterial2Attempts: "",
    invasiveArterial2Comment: "",
    invasiveArterial3Inserted: "",
    invasiveArterial3Gauge: "",
    invasiveArterial3Side: "",
    invasiveArterial3Site: "",
    invasiveArterial3Attempts: "",
    invasiveArterial3Comment: "",
    invasiveArterial4Inserted: "",
    invasiveArterial4Gauge: "",
    invasiveArterial4Side: "",
    invasiveArterial4Site: "",
    invasiveArterial4Attempts: "",
    invasiveArterial4Comment: "",
    invasiveCvcCount: "0",
    invasiveCvc1Inserted: "",
    invasiveCvc1Side: "",
    invasiveCvc1Site: "",
    invasiveCvc1Technique: "",
    invasiveCvc1Type: "",
    invasiveCvc1Size: "",
    invasiveCvc1Attempts: "",
    invasiveCvc1SkinPreparation: "",
    invasiveCvc1AsepticTechnique: "",
    invasiveCvc1AccidentalArteryPuncture: "",
    invasiveCvc1DepthCm: "",
    invasiveCvc1Difficulty: "",
    invasiveCvc1Note: "",
    invasiveCvc2Inserted: "",
    invasiveCvc2Side: "",
    invasiveCvc2Site: "",
    invasiveCvc2Technique: "",
    invasiveCvc2Type: "",
    invasiveCvc2Size: "",
    invasiveCvc2Attempts: "",
    invasiveCvc2SkinPreparation: "",
    invasiveCvc2AsepticTechnique: "",
    invasiveCvc2AccidentalArteryPuncture: "",
    invasiveCvc2DepthCm: "",
    invasiveCvc2Difficulty: "",
    invasiveCvc2Note: "",
    invasiveCvc3Inserted: "",
    invasiveCvc3Side: "",
    invasiveCvc3Site: "",
    invasiveCvc3Technique: "",
    invasiveCvc3Type: "",
    invasiveCvc3Size: "",
    invasiveCvc3Attempts: "",
    invasiveCvc3SkinPreparation: "",
    invasiveCvc3AsepticTechnique: "",
    invasiveCvc3AccidentalArteryPuncture: "",
    invasiveCvc3DepthCm: "",
    invasiveCvc3Difficulty: "",
    invasiveCvc3Note: "",
    invasiveCvc4Inserted: "",
    invasiveCvc4Side: "",
    invasiveCvc4Site: "",
    invasiveCvc4Technique: "",
    invasiveCvc4Type: "",
    invasiveCvc4Size: "",
    invasiveCvc4Attempts: "",
    invasiveCvc4SkinPreparation: "",
    invasiveCvc4AsepticTechnique: "",
    invasiveCvc4AccidentalArteryPuncture: "",
    invasiveCvc4DepthCm: "",
    invasiveCvc4Difficulty: "",
    invasiveCvc4Note: "",
    invasiveCvcFailedAttempt: "",
    invasiveCvcFailedAttemptSide: "",
    invasiveCvcFailedAttemptSite: "",
    cvcHandScrub: false,
    cvcSterileBarriers: [],
    cvcSkinPreparation: "",
    cvcLetSkinDry: false,
    cvcPreCannulation: [],
    cvcCannulationTechnique: "",
    cvcPlacementConfirmation: [],
    cvcPostCannulation: [],
    cvcInsertionComplications: "",
    cvcInsertionEventNote: "",
    comorbidDiseases: "",
    currentMedication: "",
    extubation_time: "",
    extubation_location: "",
    extubation_status: "",
    extubation_condition: "",
    extubation_tof: "",
    extubation_tof_ratio: "",
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
  pushList("Monitoring", normalizeMonitoringList(readList("monitoring")));
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
  push("PNB");
  pushField("Technique", readText("pnbTechnique"));
  pushField("Second block", readText("pnbSecondTechnique"));
  pushField("Sedation", readText("pnbSedation"));
  pushField("Side", readText("pnbSide"));
  pushField("Performed technique", readText("pnbPerformedTechnique"));
  pushField("Guidance", readText("pnbGuidance"));
  pushList("Aseptic technique", readList("pnbAsepticTechnique"));
  pushField("Skin preparation", readText("pnbSkinPreparation"));
  pushField("Block needle", readText("pnbNeedle"));
  pushField("Gauge", readText("pnbGauge"));
  pushField("Catheter", readText("pnbCatheter"));
  pushField("Catheter mark at skin (cm)", readText("pnbCatheterMarkSkinCm"));
  pushField("Catheter threaded beyond tip (cm)", readText("pnbCatheterThreadedCm"));
  pushField("Medication / agents & dose", readText("pnbMedicationDose"));
  pushField("Complications", readText("pnbComplications"));
  pushField("Event note", readText("pnbEventNote"));

  push("");
  push("Extubation");
  pushField("Extubation time", readText("extubation_time"));
  pushField("Extubation location", readText("extubation_location"));
  pushField("Extubation status", codeLabel(readText("extubation_status")));
  pushField("Extubation condition", readText("extubation_condition"));
  pushField("TOF", readText("extubation_tof"));
  pushField("TOF ratio", readText("extubation_tof_ratio"));
  pushField("Airway device removed", codeLabel(readText("airway_device_removed")));
  pushField("Suction performed", codeLabel(readText("suction_performed")));
  pushField("Extubation note", readText("extubation_note"));

  push("");
  push("Line");
  const ivLineCount = Number.parseInt(readText("ivLineCount"), 10) || 0;
  for (let i = 1; i <= Math.min(4, ivLineCount); i += 1) {
    const prefix = `ivLine${i}`;
    const detail = [
      readText(`${prefix}Site`),
      readText(`${prefix}Gauge`),
      readText(`${prefix}Inserted`),
      readText(`${prefix}Attempts`) ? `${readText(`${prefix}Attempts`)} attempt(s)` : "",
    ].filter(Boolean).join(" | ");
    pushField(`IV line (${i})`, detail);
    pushField(`  Note (${i})`, readText(`${prefix}Note`));
  }

  const arterialCount = Number.parseInt(readText("invasiveArterialCount"), 10) || 0;
  for (let i = 1; i <= Math.min(4, arterialCount); i += 1) {
    const prefix = `invasiveArterial${i}`;
    const detail = [
      readText(`${prefix}Inserted`),
      readText(`${prefix}Gauge`),
      readText(`${prefix}Side`),
      readText(`${prefix}Site`),
      readText(`${prefix}Attempts`) ? `${readText(`${prefix}Attempts`)} attempt(s)` : "",
    ].filter(Boolean).join(" | ");
    pushField(`Arterial catheter (${i})`, detail);
    pushField(`  Comment (${i})`, readText(`${prefix}Comment`));
  }
  const cvcCount = Number.parseInt(readText("invasiveCvcCount"), 10) || 0;
  for (let i = 1; i <= Math.min(4, cvcCount); i += 1) {
    const prefix = `invasiveCvc${i}`;
    const detail = [
      readText(`${prefix}Inserted`),
      readText(`${prefix}Technique`),
      readText(`${prefix}Side`),
      readText(`${prefix}Site`),
      readText(`${prefix}Type`),
      readText(`${prefix}Size`),
      readText(`${prefix}Attempts`) ? `${readText(`${prefix}Attempts`)} attempt(s)` : "",
      readText(`${prefix}DepthCm`) ? `${readText(`${prefix}DepthCm`)} cm depth` : "",
    ].filter(Boolean).join(" | ");
    pushField(`Central venous catheter (${i})`, detail);
    pushField(`  Skin prep (${i})`, readText(`${prefix}SkinPreparation`));
    pushField(`  Aseptic (${i})`, readText(`${prefix}AsepticTechnique`));
    pushField(`  Accidental artery puncture (${i})`, readText(`${prefix}AccidentalArteryPuncture`));
    pushField(`  Difficulty (${i})`, readText(`${prefix}Difficulty`));
    pushField(`  Note (${i})`, readText(`${prefix}Note`));
  }
  pushField("CVC failed attempt", readText("invasiveCvcFailedAttempt"));
  pushField(
    "CVC failed attempt site",
    [readText("invasiveCvcFailedAttemptSide"), readText("invasiveCvcFailedAttemptSite")].filter(Boolean).join(" | "),
  );
  pushField("Catheter size (Fr)", readText("cvcInsertionCatheterSize"));
  pushField("Ultrasound guidance", codeLabel(readText("cvcInsertionUltrasound")));
  pushField("Hand scrub", readBool("cvcHandScrub") ? "Yes" : "");
  pushList("Sterile precaution", readList("cvcSterileBarriers"));
  pushField("Skin preparation", readText("cvcSkinPreparation"));
  pushField("Let skin dry", readBool("cvcLetSkinDry") ? "Yes" : "");
  pushList("Pre-cannulation", readList("cvcPreCannulation"));
  pushField("Cannulation technique", readText("cvcCannulationTechnique"));
  pushList("Venous placement confirmation", readList("cvcPlacementConfirmation"));
  pushList("Post-cannulation", readList("cvcPostCannulation"));
  pushField("Complications", readText("cvcInsertionComplications"));
  pushField("Event note", readText("cvcInsertionEventNote"));

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
  const [isSaving, setIsSaving] = useState(false);
  const autoSaveReadyRef = useRef(false);
  const [showSavedPreview, setShowSavedPreview] = useState(false);
  const [savedPreview, setSavedPreview] = useState("");
  const [isResetConfirmOpen, setIsResetConfirmOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<FormTabId>(FORM_REQUIRED_TAB);

  const text = (name: string) => (typeof form[name] === "string" ? (form[name] as string) : "");
  const bool = (name: string) => form[name] === true;
  const multi = (name: string) => (Array.isArray(form[name]) ? (form[name] as string[]) : []);
  const enabledTabs = useMemo(
    () => normalizeEnabledForms(form.enabledForms),
    [form.enabledForms],
  );
  const activeGaTab = enabledTabs.find(id => GA_TAB_IDS.includes(id)) ?? null;

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
      autoSaveReadyRef.current = false;
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
      merged.monitoring = normalizeMonitoringList(parsed.monitoring);
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

      const hasLegacyIvLine =
        normalizeCodeText(merged.ivSites) ||
        normalizeCodeText(merged.ivCatheterSize) ||
        normalizeCodeText(merged.ivWhereInserted) ||
        normalizeCodeText(merged.ivAttempts);
      if (!normalizeCodeText(merged.ivLineCount) && hasLegacyIvLine) {
        merged.ivLineCount = "1";
        if (!normalizeCodeText(merged.ivLine1Site)) merged.ivLine1Site = normalizeCodeText(merged.ivSites);
        if (!normalizeCodeText(merged.ivLine1Gauge)) merged.ivLine1Gauge = normalizeCodeText(merged.ivCatheterSize);
        if (!normalizeCodeText(merged.ivLine1Attempts)) merged.ivLine1Attempts = normalizeCodeText(merged.ivAttempts);
        if (!normalizeCodeText(merged.ivLine1Inserted)) {
          const inserted = normalizeCodeText(merged.ivWhereInserted);
          merged.ivLine1Inserted = inserted === "In situ" ? "In-situ" : inserted === "OR" ? "Inserted in OR" : inserted;
        }
      }

      const hasLegacyArterial =
        normalizeCodeText(merged.arterialSites) ||
        normalizeCodeText(merged.arterialCatheterSize) ||
        normalizeCodeText(merged.arterialWhereInserted) ||
        normalizeCodeText(merged.arterialAttempts);
      if (!normalizeCodeText(merged.invasiveArterialCount) && hasLegacyArterial) {
        merged.invasiveArterialCount = "1";
        if (!normalizeCodeText(merged.invasiveArterial1Gauge)) merged.invasiveArterial1Gauge = normalizeCodeText(merged.arterialCatheterSize);
        if (!normalizeCodeText(merged.invasiveArterial1Attempts)) merged.invasiveArterial1Attempts = normalizeCodeText(merged.arterialAttempts);
        const arterialSite = normalizeCodeText(merged.arterialSites);
        if (!normalizeCodeText(merged.invasiveArterial1Site) && arterialSite) {
          const sideMatch = arterialSite.match(/^(Right|Left)\s+(.+)$/i);
          if (sideMatch) {
            merged.invasiveArterial1Side = sideMatch[1][0].toUpperCase() + sideMatch[1].slice(1).toLowerCase();
            merged.invasiveArterial1Site = sideMatch[2];
          } else {
            merged.invasiveArterial1Site = arterialSite;
          }
        }
        if (!normalizeCodeText(merged.invasiveArterial1Inserted)) {
          const inserted = normalizeCodeText(merged.arterialWhereInserted);
          merged.invasiveArterial1Inserted = inserted === "In situ" ? "In-situ" : inserted === "OR" ? "Inserted in OR" : inserted;
        }
      }

      const hasLegacyInvasiveCvc =
        normalizeCodeText(merged.cvcInsertionSites) ||
        normalizeCodeText(merged.cvcInsertionLumens) ||
        normalizeCodeText(merged.cvcInsertionCatheterSize) ||
        normalizeCodeText(merged.cvcInsertionAttempts) ||
        normalizeCodeText(merged.cvcInsertionEventNote);
      if (!normalizeCodeText(merged.invasiveCvcCount) && hasLegacyInvasiveCvc) {
        merged.invasiveCvcCount = "1";
        if (!normalizeCodeText(merged.invasiveCvc1Type)) {
          const lumens = normalizeLumensLabel(normalizeCodeText(merged.cvcInsertionLumens));
          merged.invasiveCvc1Type = lumens === "Single" ? "1 Lumen" : lumens === "Double" ? "2 Lumens" : lumens === "Triple" ? "3 Lumens" : lumens;
        }
        if (!normalizeCodeText(merged.invasiveCvc1Size)) {
          merged.invasiveCvc1Size = normalizeCodeText(merged.cvcInsertionCatheterSize).replace(/\s+Fr$/i, "F");
        }
        if (!normalizeCodeText(merged.invasiveCvc1Attempts)) {
          merged.invasiveCvc1Attempts = normalizeCodeText(merged.cvcInsertionAttempts);
        }
        if (!normalizeCodeText(merged.invasiveCvc1SkinPreparation)) {
          merged.invasiveCvc1SkinPreparation = normalizeCodeText(merged.cvcSkinPreparation);
        }
        const cvcSite = normalizeCodeText(merged.cvcInsertionSites);
        if (!normalizeCodeText(merged.invasiveCvc1Site) && cvcSite) {
          const sideMatch = cvcSite.match(/^(Right|Left)\s+(.+)$/i);
          if (sideMatch) {
            merged.invasiveCvc1Side = sideMatch[1][0].toUpperCase() + sideMatch[1].slice(1).toLowerCase();
            merged.invasiveCvc1Site = sideMatch[2].replace(/^internal jugular$/i, "Internal jugular vein");
          } else {
            merged.invasiveCvc1Site = cvcSite;
          }
        }
        if (!normalizeCodeText(merged.invasiveCvc1Note)) {
          merged.invasiveCvc1Note = normalizeCodeText(merged.cvcInsertionEventNote);
        }
      }

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
    let alive = true;
    async function loadDraftFromBackend() {
      if (caseStatus.status === "IDLE" || !storageKey) return;
      try {
        const backendDraft = await getCaseDetailDraft(caseStatus.case_id);
        if (!alive) return;
        if (backendDraft) {
          localStorage.setItem(storageKey, JSON.stringify(backendDraft));
          loadDraftFromStorage();
        }
      } catch {
        // keep local fallback behavior
      } finally {
        if (alive) autoSaveReadyRef.current = true;
      }
    }
    void loadDraftFromBackend();
    return () => {
      alive = false;
    };
  }, [caseStatus, storageKey, loadDraftFromStorage]);

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
    window.addEventListener("flora:form-storage-changed", onStorageChanged);
    return () => window.removeEventListener("flora:form-storage-changed", onStorageChanged);
  }, [caseStatus, loadDraftFromStorage]);

  useEffect(() => {
    if (activeTab === "invasive") {
      setActiveTab("line");
      return;
    }
    if (enabledTabs.length === 0) return;
    if (!enabledTabs.includes(activeTab)) {
      setActiveTab(enabledTabs[0]);
    }
  }, [activeTab, enabledTabs]);


  // Auto-save: debounced 2s after any form change, once initial load is done
  useEffect(() => {
    if (!autoSaveReadyRef.current || caseStatus.status === "IDLE") return;
    const timer = setTimeout(() => {
      if (!autoSaveReadyRef.current) return;
      setIsSaving(true);
      void save(true).finally(() => setIsSaving(false));
    }, 2000);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form]);

  if (caseStatus.status === "IDLE") {
    return <div className="p-6 text-gray-400">No active case</div>;
  }

  const reset = () => {
    setForm(defaults(caseStatus.hn));
    localStorage.removeItem(storageKey);
    void deleteCaseDetailDraft(caseStatus.case_id).catch(() => {
      // keep local reset behavior even if backend delete fails
    });
    window.dispatchEvent(
      new CustomEvent("flora:form-storage-changed", {
        detail: { caseId: caseStatus.case_id, source: "form" },
      }),
    );
    setSaveNote("Draft reset");
    setShowSavedPreview(false);
    setSavedPreview("");
  };

  const save = async (auto = false) => {
    if (!storageKey) return;
    const normalizedExtubationTime = normalizeTimeInputHHMM(text("extubation_time"));
    if (!auto) {
      const service = text("service");
      if (service && !isServiceOption(service)) {
        setSaveNote("Service must be selected from the list");
        return;
      }
      if (text("extubation_time").trim() !== "" && !normalizedExtubationTime) {
        setSaveNote("Extubation time must be HH:mm (24-hour)");
        return;
      }
    }
    try {
      const normalized: FormState = { ...form };
      normalized.monitoring = normalizeMonitoringList(normalized.monitoring);
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
      if (!auto && normalizedExtubationTime) {
        normalized.extubation_time = normalizedExtubationTime;
      }
      localStorage.setItem(storageKey, JSON.stringify(normalized));
      await saveCaseDetailDraft(caseStatus.case_id, normalized as Record<string, unknown>);
      if (!auto) {
        setForm(normalized);
      }
      window.dispatchEvent(
        new CustomEvent("flora:form-storage-changed", {
          detail: { caseId: caseStatus.case_id, source: "form" },
        }),
      );
      setSaveNote(auto ? `Auto-saved ${fmt(Date.now())}` : `Saved ${fmt(Date.now())}`);
    } catch {
      if (!auto) setSaveNote("Save failed");
    }
  };

  const viewSaved = async () => {
    if (!storageKey) return;
    let raw = localStorage.getItem(storageKey);
    if (!raw) {
      try {
        const backendDraft = await getCaseDetailDraft(caseStatus.case_id);
        if (backendDraft) {
          raw = JSON.stringify(backendDraft);
          localStorage.setItem(storageKey, raw);
        }
      } catch {
        // ignore and fall through
      }
    }
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

  const setGaType = (gaId: FormTabId | null) => {
    setForm(prev => {
      const current = normalizeEnabledForms(prev.enabledForms);
      const withoutGa = current.filter(id => !GA_TAB_IDS.includes(id));
      const next: FormState = {
        ...prev,
        enabledForms: gaId ? [...withoutGa, gaId] : withoutGa,
        primary_airway_device: gaId === "ga_lma" ? "lma" : "",
        primary_airway_techniques: "[]",
        primary_failed_intubation: false,
      };
      // Clear airway detail fields that don't belong to new GA type
      const keepFields = new Set(gaId === "ga_lma" ? AIRWAY_DETAIL_FIELDS_BY_DEVICE["lma"] : []);
      for (const base of AIRWAY_DETAIL_FIELDS) {
        if (keepFields.has(base)) continue;
        next[base] = Array.isArray(prev[base]) ? [] : "";
      }
      return next;
    });
    if (gaId) setActiveTab(gaId);
  };

  const addFormTab = (tabId: FormTabId) => {
    setForm(prev => {
      const current = normalizeEnabledForms(prev.enabledForms);
      if (current.includes(tabId)) return prev;
      return { ...prev, enabledForms: [...current, tabId] };
    });
    setActiveTab(tabId);
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

  const s = (key: string, title: string, vals: string[], placeholder = "Select...") => (
    <label key={key} className="space-y-1">
      <div className={label}>{title}</div>
      <select
        className={input}
        value={text(key)}
        onChange={(e) => setText(key, e.target.value)}
      >
        <option value="">{placeholder}</option>
        {vals.map((v) => (
          <option key={`${key}-${v}`} value={v}>
            {v}
          </option>
        ))}
      </select>
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

  const countValue = (key: string) => {
    const n = Number.parseInt(text(key), 10);
    return Number.isFinite(n) ? Math.max(0, Math.min(4, n)) : 0;
  };

  const smallCounterField = (key: string, title: string, max = 4) => {
    const parsed = Number.parseInt(text(key), 10);
    const value = Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, max) : 0;
    const setValue = (next: number) => {
      if (!Number.isFinite(next) || next <= 0) {
        setText(key, "0");
        return;
      }
      setText(key, String(Math.min(next, max)));
    };
    return (
      <div key={key} className="space-y-1">
        <div className={label}>{title}</div>
        <div className="inline-flex items-center gap-1.5">
          <button
            type="button"
            className="h-8 w-8 rounded border border-gray-300 dark:border-gray-700 text-sm leading-none hover:bg-gray-100 dark:hover:bg-gray-800"
            onClick={() => setValue(value - 1)}
            aria-label={`Decrease ${title}`}
          >
            -
          </button>
          <input
            className="h-8 w-14 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-950 px-1 text-center text-sm"
            inputMode="numeric"
            value={String(value)}
            onChange={(e) => {
              const digits = e.target.value.replace(/[^\d]/g, "");
              setValue(digits ? Number.parseInt(digits, 10) : 0);
            }}
          />
          <button
            type="button"
            className="h-8 w-8 rounded border border-gray-300 dark:border-gray-700 text-sm leading-none hover:bg-gray-100 dark:hover:bg-gray-800"
            onClick={() => setValue(value + 1)}
            aria-label={`Increase ${title}`}
          >
            +
          </button>
        </div>
      </div>
    );
  };

  const ivLineBlocks = Array.from({ length: countValue("ivLineCount") }, (_, i) => i + 1);
  const invasiveArterialBlocks = Array.from({ length: countValue("invasiveArterialCount") }, (_, i) => i + 1);
  const invasiveCvcBlocks = Array.from({ length: countValue("invasiveCvcCount") }, (_, i) => i + 1);

  const renderIvLine = (index: number) => {
    const prefix = `ivLine${index}`;
    return (
      <div key={prefix} className="rounded border border-gray-200 dark:border-gray-800 p-3 space-y-3">
        <div className="font-medium text-blue-700 dark:text-blue-300">IV line ({index})</div>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          {s(`${prefix}Site`, "Site", options.ivSites)}
          {s(`${prefix}Gauge`, "Gauge", options.ivGauge)}
          {s(`${prefix}Inserted`, "Inserted", options.ivSimpleInserted)}
          {attemptField(`${prefix}Attempts`, "Number of attempt")}
        </div>
        {a(`${prefix}Note`, "Note", 2)}
      </div>
    );
  };

  const renderInvasiveArterial = (index: number) => {
    const prefix = `invasiveArterial${index}`;
    return (
      <div key={prefix} className="rounded border border-gray-200 dark:border-gray-800 p-3 space-y-3">
        <div className="font-medium text-blue-700 dark:text-blue-300">Arterial catheter ({index})</div>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          {s(`${prefix}Inserted`, "Inserted", options.invasiveInserted)}
          {s(`${prefix}Gauge`, "Gauge", options.arterialGauge)}
          {s(`${prefix}Side`, "Side", options.invasiveSide)}
          {s(`${prefix}Site`, "Site", options.invasiveArterialSites)}
        </div>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          {attemptField(`${prefix}Attempts`, "Number of attempt")}
          <div className="md:col-span-3">{t(`${prefix}Comment`, "Comment")}</div>
        </div>
      </div>
    );
  };

  const renderInvasiveCvc = (index: number) => {
    const prefix = `invasiveCvc${index}`;
    return (
      <div key={prefix} className="rounded border border-gray-200 dark:border-gray-800 p-3 space-y-3">
        <div className="font-medium text-blue-700 dark:text-blue-300">Central venous catheter ({index})</div>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          {s(`${prefix}Inserted`, "Inserted", options.invasiveInserted)}
          {s(`${prefix}Technique`, "Technique", options.invasiveCvcTechnique)}
          {s(`${prefix}Side`, "Side", options.invasiveSide)}
          {s(`${prefix}Site`, "CVC site", options.invasiveCvcSimpleSites)}
          {s(`${prefix}Type`, "Catheter type", options.invasiveCvcTypes)}
        </div>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          {s(`${prefix}Size`, "Catheter size", options.invasiveCatheterSizes)}
          {attemptField(`${prefix}Attempts`, "Number of attempt")}
          {s(`${prefix}AccidentalArteryPuncture`, "Accidental artery puncture?", options.invasiveYesNo)}
          {t(`${prefix}DepthCm`, "Depth (cm)", "number")}
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {s(`${prefix}SkinPreparation`, "Skin preparation", options.skinPrep)}
          {s(`${prefix}AsepticTechnique`, "Aseptic technique", options.invasiveSterilePrecautions)}
          {s(`${prefix}Difficulty`, "Difficulty?", options.invasiveDifficulty)}
        </div>
        {a(`${prefix}Note`, "Note", 2)}
      </div>
    );
  };

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
          <div className="ml-auto flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-gray-100 dark:border-gray-800 pt-1 mt-1 w-full">
            {/* GA type — radio, mutually exclusive */}
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-400 dark:text-gray-500 shrink-0">GA:</span>
              {([null, "ga_ett", "ga_lma", "ga_tubeless"] as (FormTabId | null)[]).map(id => (
                <label key={id ?? "none"} className="inline-flex items-center gap-1 cursor-pointer text-xs">
                  <input
                    type="radio"
                    name="ga_type_selector"
                    checked={activeGaTab === id}
                    onChange={() => setGaType(id)}
                    className="accent-blue-500"
                  />
                  <span>{id === null ? "None" : id === "ga_ett" ? "ETT" : id === "ga_lma" ? "LMA" : "Tubeless"}</span>
                </label>
              ))}
            </div>
            {/* Separator */}
            <div className="w-px h-3 bg-gray-300 dark:bg-gray-700 shrink-0" />
            {/* Other sections — checkboxes */}
            {NON_GA_ADDABLE_TABS.map(tab => (
              <label key={tab.id} className="inline-flex items-center gap-1 cursor-pointer text-xs">
                <input
                  type="checkbox"
                  checked={enabledTabs.includes(tab.id)}
                  onChange={() => enabledTabs.includes(tab.id) ? removeFormTab(tab.id) : addFormTab(tab.id)}
                  className="accent-blue-500"
                />
                <span>{tab.label}</span>
              </label>
            ))}
          </div>
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
        <div className="space-y-4">
          <div className="rounded border border-gray-200 dark:border-gray-800 p-3 space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div className="font-medium">IV Line</div>
              {smallCounterField("ivLineCount", "Number of IV line")}
            </div>
            {ivLineBlocks.length > 0 ? (
              <div className="space-y-3">
                {ivLineBlocks.map(renderIvLine)}
              </div>
            ) : (
              <div className="rounded border border-gray-200 dark:border-gray-800 p-3 text-sm text-gray-500 dark:text-gray-400">
                No IV line selected.
              </div>
            )}
          </div>

          <div className="rounded border border-gray-200 dark:border-gray-800 p-3 space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div className="font-medium">Arterial Line</div>
              {smallCounterField("invasiveArterialCount", "Number of arterial line")}
            </div>
            {invasiveArterialBlocks.length > 0 ? (
              <div className="space-y-3">
                {invasiveArterialBlocks.map(renderInvasiveArterial)}
              </div>
            ) : (
              <div className="rounded border border-gray-200 dark:border-gray-800 p-3 text-sm text-gray-500 dark:text-gray-400">
                No arterial line selected.
              </div>
            )}
          </div>

          <div className="rounded border border-gray-200 dark:border-gray-800 p-3 space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div className="font-medium">Central Line</div>
              {smallCounterField("invasiveCvcCount", "Number of central line")}
            </div>
            {invasiveCvcBlocks.length > 0 ? (
              <div className="space-y-3">
                {invasiveCvcBlocks.map(renderInvasiveCvc)}
              </div>
            ) : (
              <div className="rounded border border-gray-200 dark:border-gray-800 p-3 text-sm text-gray-500 dark:text-gray-400">
                No central line selected.
              </div>
            )}
            <div className="rounded border border-gray-200 dark:border-gray-800 p-3 space-y-3">
              <div className="font-medium text-blue-700 dark:text-blue-300">Site of failed attempt?</div>
              {s("invasiveCvcFailedAttempt", "Failed attempt", options.invasiveYesNo)}
              {text("invasiveCvcFailedAttempt") === "Yes" ? (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {s("invasiveCvcFailedAttemptSide", "Side", options.invasiveSide)}
                  {s("invasiveCvcFailedAttemptSite", "Site", options.invasiveCvcSimpleSites)}
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </section>

      {/* ── GA ETT ── */}
      <section className={`${card} ${activeTab === "ga_ett" ? "" : "hidden"}`}>
        <h2 className="font-semibold">GA — Endotracheal Tube</h2>
        {c("pre_induction", "Pre-induction", options.gaPreInduction, "grid-cols-1 md:grid-cols-2")}
        {c("induction", "Induction", options.gaInduction, "grid-cols-1 md:grid-cols-3")}
        {rCode("mask_ventilation_difficulty", "Mask ventilation difficulty", options.gaMaskVentilationDifficulty, "grid-cols-3")}
        {cCode("eye_protection", "Eye protection", options.gaEyeProtection, "grid-cols-1 md:grid-cols-3")}
        <div className="rounded border border-gray-200 dark:border-gray-800 p-3 space-y-3">
          <div className="font-medium">Route</div>
          {rCode("primary_airway_device", "Route", ["oral_endotracheal_tube", "nasal_endotracheal_tube", "tracheostomy_tube"], "grid-cols-3", (value) => setAirwayDevice("primary", value))}
          {text("primary_airway_device") === "oral_endotracheal_tube" ? (
            <div className="space-y-3">
              {rCode("oral_tube_type", "Tube type", options.gaTubeType, "grid-cols-1 md:grid-cols-3")}
              {rCode("oral_cuff", "Cuff", options.gaCuff, "grid-cols-2")}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {t("oral_tube_size", "Size")}
                {t("oral_tube_mark_cm", "Mark (cm)", "number")}
                {t("oral_tube_depth_cm", "Depth at lip (cm)", "number")}
                {t("oral_cuff_volume_ml", "Cuff volume (mL)", "number")}
                {t("oral_cuff_pressure_cmh2o", "Cuff pressure (cmH₂O)", "number")}
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                {rCode("oral_throat_pack", "Throat pack", options.gaYesNo, "grid-cols-2")}
                {rCode("oral_tube_in_situ", "In situ", options.gaYesNo, "grid-cols-2")}
              </div>
            </div>
          ) : null}
          {text("primary_airway_device") === "nasal_endotracheal_tube" ? (
            <div className="space-y-3">
              {rCode("nasal_tube_type", "Tube type", options.gaTubeType, "grid-cols-1 md:grid-cols-3")}
              {rCode("nasal_cuff", "Cuff", options.gaCuff, "grid-cols-2")}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {t("nasal_tube_size", "Size")}
                {t("nasal_tube_mark_cm", "Mark (cm)", "number")}
                {t("nasal_tube_depth_cm", "Depth at nostril (cm)", "number")}
                {t("nasal_cuff_volume_ml", "Cuff volume (mL)", "number")}
                {t("nasal_cuff_pressure_cmh2o", "Cuff pressure (cmH₂O)", "number")}
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                {rCode("nasal_preparation", "Nasal preparation", options.gaNasalPreparation, "grid-cols-1 md:grid-cols-3")}
                {rCode("nasal_nostril", "Nostril", options.gaNostril, "grid-cols-3")}
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                {rCode("nasal_throat_pack", "Pack", options.gaYesNo, "grid-cols-2")}
                {rCode("nasal_tube_in_situ", "In situ", options.gaYesNo, "grid-cols-2")}
              </div>
            </div>
          ) : null}
          {text("primary_airway_device") === "tracheostomy_tube" ? (
            <div className="space-y-3">
              {rCode("trach_type", "Trach type", options.gaTrachType, "grid-cols-1 md:grid-cols-3")}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {t("trach_size", "Size")}
                {rCode("trach_cuff", "Cuff", options.gaCuff, "grid-cols-2")}
                {t("trach_cuff_volume_ml", "Cuff volume (mL)", "number")}
                {t("trach_cuff_pressure_cmh2o", "Cuff pressure (cmH₂O)", "number")}
              </div>
              {rCode("trach_tube_in_situ", "In situ", options.gaYesNo, "grid-cols-2")}
            </div>
          ) : null}
        </div>
        {(() => {
          const route = text("primary_airway_device");
          const inSitu = route === "oral_endotracheal_tube"
            ? text("oral_tube_in_situ")
            : route === "nasal_endotracheal_tube"
            ? text("nasal_tube_in_situ")
            : route === "tracheostomy_tube"
            ? text("trach_tube_in_situ")
            : "";
          return route && inSitu !== "yes" ? (
            <AirwayTechniquePanel
              title="Intubation technique"
              techniquesRaw={text("primary_airway_techniques")}
              failedIntubation={bool("primary_failed_intubation")}
              onTechniquesChange={(nextRaw) => setText("primary_airway_techniques", nextRaw)}
              onFailedIntubationChange={(next) => setBool("primary_failed_intubation", next)}
            />
          ) : null;
        })()}
      </section>

      {/* ── GA LMA ── */}
      <section className={`${card} ${activeTab === "ga_lma" ? "" : "hidden"}`}>
        <h2 className="font-semibold">GA — LMA</h2>
        {c("pre_induction", "Pre-induction", options.gaPreInduction, "grid-cols-1 md:grid-cols-2")}
        {c("induction", "Induction", options.gaInduction, "grid-cols-1 md:grid-cols-3")}
        {rCode("mask_ventilation_difficulty", "Mask ventilation difficulty", options.gaMaskVentilationDifficulty, "grid-cols-3")}
        {cCode("eye_protection", "Eye protection", options.gaEyeProtection, "grid-cols-1 md:grid-cols-3")}
        <div className="rounded border border-gray-200 dark:border-gray-800 p-3 space-y-3">
          <div className="font-medium">LMA detail</div>
          {rCode("lma_type", "LMA type", options.gaLmaType, "grid-cols-3")}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {t("lma_size", "Size")}
            {t("lma_number_of_attempts", "Number of attempts", "number")}
          </div>
          {cCode("lma_confirmation", "Confirmation", options.gaLmaConfirmation, "grid-cols-2")}
        </div>
      </section>

      {/* ── GA Tubeless ── */}
      <section className={`${card} ${activeTab === "ga_tubeless" ? "" : "hidden"}`}>
        <h2 className="font-semibold">GA — Tubeless</h2>
        {c("pre_induction", "Pre-induction", options.gaPreInduction, "grid-cols-1 md:grid-cols-2")}
        {c("induction", "Induction", options.gaInduction, "grid-cols-1 md:grid-cols-3")}
        {rCode("mask_ventilation_difficulty", "Mask ventilation difficulty", options.gaMaskVentilationDifficulty, "grid-cols-3")}
        {cCode("eye_protection", "Eye protection", options.gaEyeProtection, "grid-cols-1 md:grid-cols-3")}
        <div className="rounded border border-gray-200 dark:border-gray-800 p-3 space-y-3">
          <div className="font-medium">Technique</div>
          {rCode("primary_airway_device", "Technique", options.gaTubelessTechnique, "grid-cols-1 md:grid-cols-3", (value) => setAirwayDevice("primary", value))}
          {text("primary_airway_device") === "facemask" ? (
            <div className="space-y-3">
              {rCode("mask_adjunct", "Mask adjunct", options.gaMaskAdjunct, "grid-cols-1 md:grid-cols-3")}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {t("opa_size", "OPA size")}
                {t("npa_size", "NPA size")}
              </div>
            </div>
          ) : null}
          {text("primary_airway_device") === "jet_ventilation" ? (
            <div className="space-y-3">
              {rCode("jet_type", "Jet type", options.gaJetType, "grid-cols-2")}
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

      <section className={`${card} ${activeTab === "pnb" ? "" : "hidden"}`}>
        <h2 className="font-semibold">Peripheral Nerve Block</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {s("pnbTechnique", "Technique", options.pnbTechniques)}
          {t("pnbSedation", "Sedation")}
          {s("pnbSide", "Side", options.pnbSides)}
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {s("pnbPerformedTechnique", "Performed technique", options.pnbPerformedTechniques)}
          {s("pnbGuidance", "Guidance", options.pnbGuidance)}
          {s("pnbSkinPreparation", "Skin preparation", options.skinPrep)}
        </div>
        {c("pnbAsepticTechnique", "Aseptic technique", options.pnbAsepticTechnique, "grid-cols-1 md:grid-cols-3")}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          {s("pnbNeedle", "Block needle", options.pnbNeedles)}
          {s("pnbGauge", "Gauge", options.pnbNeedleGauge)}
          {t("pnbCatheter", "Catheter")}
          {t("pnbCatheterMarkSkinCm", "Catheter mark at skin (cm)", "number")}
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {t("pnbCatheterThreadedCm", "Catheter threaded beyond tip (cm)", "number")}
          {s("pnbSecondTechnique", "Second peripheral nerve block", options.pnbTechniques, "None")}
        </div>
        {a("pnbMedicationDose", "Medication / agents & dose", 2)}
        {a("pnbComplications", "Complications", 2)}
        {a("pnbEventNote", "Other note / event / technique", 3)}
      </section>

      <section className={`${card} ${activeTab === "invasive" ? "" : "hidden"}`}>
        <h2 className="font-semibold">Invasive Catheter</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {smallCounterField("invasiveArterialCount", "Number of arterial catheter")}
          {smallCounterField("invasiveCvcCount", "Number of CVC catheter")}
        </div>

        {invasiveArterialBlocks.length > 0 ? (
          <div className="space-y-3">
            {invasiveArterialBlocks.map(renderInvasiveArterial)}
          </div>
        ) : (
          <div className="rounded border border-gray-200 dark:border-gray-800 p-3 text-sm text-gray-500 dark:text-gray-400">
            No arterial catheter selected.
          </div>
        )}

        {invasiveCvcBlocks.length > 0 ? (
          <div className="space-y-3">
            {invasiveCvcBlocks.map(renderInvasiveCvc)}
          </div>
        ) : (
          <div className="rounded border border-gray-200 dark:border-gray-800 p-3 text-sm text-gray-500 dark:text-gray-400">
            No CVC catheter selected.
          </div>
        )}

        <div className="rounded border border-gray-200 dark:border-gray-800 p-3 space-y-3">
          <div className="font-medium text-blue-700 dark:text-blue-300">Site of failed attempt?</div>
          {s("invasiveCvcFailedAttempt", "Failed attempt", options.invasiveYesNo)}
          {text("invasiveCvcFailedAttempt") === "Yes" ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {s("invasiveCvcFailedAttemptSide", "Side", options.invasiveSide)}
              {s("invasiveCvcFailedAttemptSite", "Site", options.invasiveCvcSimpleSites)}
            </div>
          ) : null}
        </div>

        <div className="pt-1 border-t border-gray-200 dark:border-gray-800" />
        <h3 className="font-medium">CVC Sterile / Cannulation Detail</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {rCode("cvcInsertionUltrasound", "Ultrasound guidance", options.gaYesNo, "grid-cols-2")}
          {s("cvcInsertionCatheterSize", "Catheter size (Fr)", options.invasiveCatheterSizes)}
        </div>
        {c("cvcSterileBarriers", "Precaution", options.invasiveSterilePrecautions, "grid-cols-1 md:grid-cols-2")}
        <div className="pt-1" />
        {b("cvcHandScrub", "Hand scrub")}
        {r("cvcSkinPreparation", "Skin preparation", options.skinPrep.slice(0, 4), "grid-cols-1 md:grid-cols-2")}
        {b("cvcLetSkinDry", "Let skin dry")}
        {c("cvcPreCannulation", "Pre-cannulation", options.cvcPre, "grid-cols-1 md:grid-cols-2")}
        {r("cvcCannulationTechnique", "Cannulation technique", ["Landmark", "Real-time ultrasound guide", "Ultrasound-guide landmark"], "grid-cols-1 md:grid-cols-3")}
        {c("cvcPlacementConfirmation", "Venous placement confirmation", options.cvcPlacement, "grid-cols-1 md:grid-cols-3")}
        {c("cvcPostCannulation", "Post-cannulation", options.cvcPost, "grid-cols-1 md:grid-cols-2")}
        {a("cvcInsertionComplications", "Complications", 2)}
        {a("cvcInsertionEventNote", "Event note", 2)}
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
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {s("extubation_condition", "Condition", options.extubationCondition)}
          {s("extubation_tof", "TOF", options.extubationTof)}
          {t("extubation_tof_ratio", "TOF ratio")}
        </div>
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
          {(isSaving || saveNote) ? (
            <div className="text-xs text-gray-500 dark:text-gray-400 mr-1">
              {isSaving ? "Saving…" : saveNote}
            </div>
          ) : null}
          <button
            type="button"
            className={primaryButton}
            onClick={() => void save()}
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
