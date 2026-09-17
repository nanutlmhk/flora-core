import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import type { CaseStatus } from "../api/caseApi";

const LabView = lazy(() => import("./LabView"));
import ConfirmDialog from "../components/common/ConfirmDialog";
import {
  getCaseDetailDraft,
  saveCaseDetailDraft,
} from "../api/caseDetailApi";
import {
  createCaseAllergy,
  deleteCaseAllergy,
  fetchHisAllergyByHn,
  getCaseAllergies,
  getCasePatientInfo,
  lookupPatientInfoByHn,
  syncCaseHisAllergy,
  syncCasePatientInfo,
  updateCasePatientInfo,
  updateCaseAllergy,
  type CaseAllergyRow,
  type CasePatientInfo,
} from "../api/caseHisApi";
import {
  formatDateInputDDMMYYYY,
  normalizeDateInputDDMMYYYY,
} from "../utils/clinicalInput";
import HnBarcode from "../components/common/HnBarcode";
import HnQrCode from "../components/common/HnQrCode";

type Props = {
  caseStatus: CaseStatus;
};

type PatientFormState = {
  hn: string;
  an: string;
  titleTh: string;
  titleEn: string;
  firstName: string;
  lastName: string;
  firstNameEn: string;
  lastNameEn: string;
  sex: string;
  dob: string;
  ageY: string;
  ageM: string;
  weightKg: string;
  heightCm: string;
  bloodGroupABO: string;
  bloodGroupRh: string;
  race: string;
  ethnicity: string;
  religion: string;
  maritalStatus: string;
};

const card =
  "rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-950 p-3 space-y-3";
const input =
  "w-full rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-950 px-2 py-1.5 text-xs";
const label = "text-xs text-gray-500 dark:text-gray-400";
const primaryButton =
  "rounded px-3 py-1.5 text-xs text-white bg-blue-600 hover:bg-blue-700";
const secondaryButton =
  "rounded border border-gray-300 dark:border-gray-700 px-3 py-1.5 text-xs";
const TITLE_TH_OPTIONS = ["", "นาย", "นาง", "น.ส.", "ด.ช.", "ด.ญ."];
const TITLE_EN_OPTIONS = ["", "Mr.", "Mrs.", "Ms.", "Miss", "Master"];
const ALLERGY_SEVERITY_OPTIONS = ["Mild", "Moderate", "Severe", "Fatal", "Unknown", "None"];
const PRESTART_PATIENT_DRAFT_PREFIX = "flora.prestartPatientDraft.";
const PRESTART_HN_SYNC_EVENT = "flora:prestart-hn-sync";

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function numText(value: unknown): string {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "string") {
    const raw = value.trim();
    if (!raw) return "";
    const n = Number(raw);
    if (Number.isFinite(n)) return String(n);
  }
  return "";
}

function prettyJson(value: unknown): string {
  if (value == null) return "";
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function fmt(ts: number): string {
  const d = new Date(ts);
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();
  const hh = String(d.getHours()).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");
  return `${dd}/${mm}/${yyyy} ${hh}:${min}`;
}

function defaults(hn: string): PatientFormState {
  return {
    hn,
    an: "",
    titleTh: "",
    titleEn: "",
    firstName: "",
    lastName: "",
    firstNameEn: "",
    lastNameEn: "",
    sex: "",
    dob: "",
    ageY: "",
    ageM: "",
    weightKg: "",
    heightCm: "",
    bloodGroupABO: "",
    bloodGroupRh: "",
    race: "",
    ethnicity: "",
    religion: "",
    maritalStatus: "",
  };
}

function parseDob(value: string): Date | null {
  const normalized = normalizeDateInputDDMMYYYY(value);
  if (!normalized) return null;
  const [dd, mm, yyyy] = normalized.split("/").map(Number);
  const dt = new Date(yyyy, mm - 1, dd);
  if (Number.isNaN(dt.getTime())) return null;
  return dt;
}

function ageFromDob(dob: Date): { years: number; months: number } | null {
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

function formatDob(date: Date): string {
  const dd = String(date.getDate()).padStart(2, "0");
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const yyyy = date.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
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

function looksThai(textValue: string): boolean {
  return /[\u0E00-\u0E7F]/.test(textValue);
}

function normalizeSex(raw: string): string {
  const value = raw.trim().toUpperCase();
  if (!value) return "";
  if (value === "M" || value === "MALE" || value === "ชาย") return "M";
  if (value === "F" || value === "FEMALE" || value === "หญิง") return "F";
  return raw.trim();
}

function parseBloodText(raw: string): { abo: string; rh: string } {
  const value = raw.trim().toUpperCase();
  if (!value) return { abo: "", rh: "" };
  const aboMatch = value.match(/(AB|A|B|O)/);
  const rh =
    value.includes("RH+") || /\+/.test(value)
      ? "+"
      : value.includes("RH-") || /-/.test(value)
        ? "-"
        : "";
  return { abo: aboMatch ? aboMatch[1] : "", rh };
}

function readDraft(caseId: number): Record<string, unknown> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(`doctor_form_${caseId}`);
    if (!raw) return {};
    return asObject(JSON.parse(raw) as unknown);
  } catch {
    return {};
  }
}

function readPrestartPatientDraft(hn: string): Record<string, unknown> {
  if (typeof window === "undefined") return {};
  const targetHn = String(hn || "").trim();
  if (!targetHn) return {};
  try {
    const raw = window.localStorage.getItem(`${PRESTART_PATIENT_DRAFT_PREFIX}${targetHn}`);
    if (!raw) return {};
    return asObject(JSON.parse(raw) as unknown);
  } catch {
    return {};
  }
}

function writePrestartPatientDraft(hn: string, patch: Record<string, unknown>) {
  if (typeof window === "undefined") return;
  const targetHn = String(hn || "").trim();
  if (!targetHn) return;
  try {
    const key = `${PRESTART_PATIENT_DRAFT_PREFIX}${targetHn}`;
    const prev = readPrestartPatientDraft(targetHn);
    const next = { ...prev, ...patch, hn: targetHn };
    window.localStorage.setItem(key, JSON.stringify(next));
  } catch {
    // Ignore write failure in restricted environment.
  }
}

function writeDraft(caseId: number, patch: Record<string, unknown>) {
  if (typeof window === "undefined") return;
  try {
    const key = `doctor_form_${caseId}`;
    const prev = readDraft(caseId);
    const next = { ...prev, ...patch };
    window.localStorage.setItem(key, JSON.stringify(next));
  } catch {
    // Ignore write failure in restricted environment.
  }
}

function buildFormFromDraft(hn: string, draft: Record<string, unknown>): PatientFormState {
  return {
    ...defaults(hn),
    hn,
    an: text(draft.an),
    titleTh: text(draft.titleTh || draft.title_th),
    titleEn: text(draft.titleEn || draft.title_en),
    firstName: text(draft.firstName || draft.first_name),
    lastName: text(draft.lastName || draft.last_name),
    firstNameEn: text(draft.firstNameEn || draft.first_name_en),
    lastNameEn: text(draft.lastNameEn || draft.last_name_en),
    sex: normalizeSex(text(draft.sex)),
    dob: formatDateInputDDMMYYYY(text(draft.dob)),
    ageY: text(draft.ageY),
    ageM: text(draft.ageM),
    weightKg: numText(draft.weightKg),
    heightCm: numText(draft.heightCm),
    bloodGroupABO: text(draft.bloodGroupABO),
    bloodGroupRh: text(draft.bloodGroupRh),
    race: text(draft.race),
    ethnicity: text(draft.ethnicity),
    religion: text(draft.religion),
    maritalStatus: text(draft.maritalStatus),
  };
}

function applyHisToForm(prev: PatientFormState, info: CasePatientInfo): PatientFormState {
  const thFirst = (info.first_name || "").trim();
  const thLast = (info.last_name || "").trim();
  const enFirst = (info.first_name_en || "").trim();
  const enLast = (info.last_name_en || "").trim();
  const bloodFromText = parseBloodText(info.blood_group_text || "");
  const nameParts = (info.patient_name || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  const resolvedFirstName =
    thFirst && looksThai(thFirst)
      ? thFirst
      : enFirst && looksThai(enFirst)
        ? enFirst
        : thFirst || enFirst || nameParts[0] || prev.firstName;
  const resolvedLastName =
    thLast && looksThai(thLast)
      ? thLast
      : enLast && looksThai(enLast)
        ? enLast
        : thLast || enLast || nameParts.slice(1).join(" ") || prev.lastName;

  return {
    ...prev,
    hn: info.hn || prev.hn,
    an: info.an || "",
    titleTh: info.title_th || prev.titleTh,
    titleEn: info.title_en || prev.titleEn,
    firstName: resolvedFirstName,
    lastName: resolvedLastName,
    firstNameEn: enFirst || (looksThai(thFirst) ? prev.firstNameEn : thFirst),
    lastNameEn: enLast || (looksThai(thLast) ? prev.lastNameEn : thLast),
    sex: normalizeSex(info.sex || ""),
    dob: formatDateInputDDMMYYYY(info.dob || ""),
    weightKg: numText(info.weight_kg),
    heightCm: numText(info.height_cm),
    bloodGroupABO: (info.blood_group_abo || bloodFromText.abo || "").toUpperCase(),
    bloodGroupRh: (info.blood_group_rh || bloodFromText.rh || "").toUpperCase(),
    race: info.race || "",
    ethnicity: info.ethnicity || "",
    religion: info.religion || "",
    maritalStatus: info.marital_status || "",
  };
}

export default function PatientView({ caseStatus }: Props) {
  const activeCase = caseStatus.status === "IDLE" ? null : caseStatus;
  const caseId = activeCase?.case_id ?? null;
  const hasActiveCase = activeCase != null && caseId != null;
  const [form, setForm] = useState<PatientFormState>(defaults(""));

  const [allergies, setAllergies] = useState<CaseAllergyRow[]>([]);
  const [editingAllergyId, setEditingAllergyId] = useState<number | null>(null);
  const [newAllergen, setNewAllergen] = useState("");
  const [newReaction, setNewReaction] = useState("");
  const [newSeverity, setNewSeverity] = useState("");
  const [pendingDeleteAllergyId, setPendingDeleteAllergyId] = useState<number | string | null>(null);
  const [alertTitle, setAlertTitle] = useState("");
  const [alertMessage, setAlertMessage] = useState("");

  const loadAllergies = async () => {
    if (!caseId) return;
    try {
      const rows = await getCaseAllergies(caseId);
      setAllergies(rows);
    } catch (err) {
      setAlertTitle("Load Failed");
      setAlertMessage(err instanceof Error ? err.message : "failed to load allergies");
    }
  };

  const handleSaveAllergy = async () => {
    if (!newAllergen.trim() || !caseId) return;
    try {
      if (editingAllergyId) {
        await updateCaseAllergy(caseId, editingAllergyId, {
          allergen: newAllergen,
          reaction: newReaction,
          severity: newSeverity,
        });
      } else {
        await createCaseAllergy(caseId, {
          allergen: newAllergen,
          reaction: newReaction,
          severity: newSeverity,
        });
      }
      setNewAllergen("");
      setNewReaction("");
      setNewSeverity("");
      setEditingAllergyId(null);
      await loadAllergies();
      emitAllergyChanged();
    } catch (err) {
      setAlertTitle("Save Failed");
      setAlertMessage(err instanceof Error ? err.message : "failed to save allergy");
    }
  };

  const handleEditAllergy = (allergy: CaseAllergyRow) => {
    setEditingAllergyId(Number(allergy.id));
    setNewAllergen(allergy.allergen);
    setNewReaction(allergy.reaction || "");
    setNewSeverity(allergy.severity || "");
  };

  const confirmDeleteAllergy = async () => {
    if (!pendingDeleteAllergyId || !caseId) return;
    try {
      await deleteCaseAllergy(caseId, pendingDeleteAllergyId);
      setPendingDeleteAllergyId(null);
      await loadAllergies();
      emitAllergyChanged();
    } catch (err) {
      setAlertTitle("Delete Failed");
      setAlertMessage(err instanceof Error ? err.message : "failed to delete allergy");
    }
  };
  const [loadingHis, setLoadingHis] = useState(false);
  const [loadingSupport, setLoadingSupport] = useState(false);
  const [error, setError] = useState("");
  const [saveNote, setSaveNote] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [patientTab, setPatientTab] = useState<"info" | "allergy" | "lab">("info");
  const [dataSource, setDataSource] = useState<"HIS" | "BUFFER" | null>(null);
  const [notification, setNotification] = useState<{ type: "success" | "warning" | "error"; text: string } | null>(null);
  const [hisRawPayloadText, setHisRawPayloadText] = useState("");
  const [showHisRawPayload, setShowHisRawPayload] = useState(false);
  const autoSaveReadyRef = useRef(false);
  const hnInputRef = useRef<HTMLInputElement>(null);

  const emitAllergyChanged = () => {
    if (!caseId) return;
    window.dispatchEvent(
      new CustomEvent("flora:allergy-changed", {
        detail: { caseId },
      }),
    );
  };

  useEffect(() => {
    if (!activeCase || caseId == null) {
      autoSaveReadyRef.current = false;
      setForm(prev => {
        const draft = readPrestartPatientDraft(prev.hn);
        const targetHn = String(prev.hn || "").trim();
        return targetHn && Object.keys(draft).length > 0
          ? buildFormFromDraft(targetHn, draft)
          : defaults("");
      });
      setAllergies([]);
      setDataSource(null);
      setHisRawPayloadText("");
      setShowHisRawPayload(false);
      return;
    }
    const draft = readDraft(caseId);
    setForm(buildFormFromDraft(activeCase.hn, draft));
  }, [activeCase, caseId]);

  useEffect(() => {
    if (hasActiveCase) return;
    const onPrestartHnSync = (event: Event) => {
      const custom = event as CustomEvent<{ hn?: unknown; source?: unknown }>;
      if (String(custom.detail?.source || "") === "patient-view") return;
      const nextHn = String(custom.detail?.hn || "").trim();
      setForm(prev => {
        if (nextHn === String(prev.hn || "").trim()) return prev;
        if (!nextHn) return { ...prev, hn: "" };
        const draft = readPrestartPatientDraft(nextHn);
        return Object.keys(draft).length > 0
          ? buildFormFromDraft(nextHn, draft)
          : { ...prev, hn: nextHn };
      });
    };
    window.addEventListener(PRESTART_HN_SYNC_EVENT, onPrestartHnSync);
    return () => window.removeEventListener(PRESTART_HN_SYNC_EVENT, onPrestartHnSync);
  }, [hasActiveCase]);

  useEffect(() => {
    let alive = true;
    async function loadDraftFromBackend() {
      if (!activeCase || caseId == null) return;
      try {
        const backendDraft = await getCaseDetailDraft(caseId);
        if (!alive) return;
        if (backendDraft) {
          writeDraft(caseId, backendDraft);
          setForm(buildFormFromDraft(activeCase.hn, backendDraft));
        }
        autoSaveReadyRef.current = true;
      } catch {
        // still enable auto-save so user edits are not silently dropped
        autoSaveReadyRef.current = true;
      }
    }
    void loadDraftFromBackend();
    return () => {
      alive = false;
    };
  }, [activeCase, caseId]);

  useEffect(() => {
    if (!activeCase || caseId == null) return;
    const onDraftChanged = (event: Event) => {
      const custom = event as CustomEvent<{ caseId?: unknown; source?: unknown }>;
      const changedCaseId = Number(custom.detail?.caseId);
      const source = String(custom.detail?.source || "");
      if (!Number.isFinite(changedCaseId) || changedCaseId !== caseId) return;
      if (source === "patient") return;
      const draft = readDraft(caseId);
      setForm(buildFormFromDraft(activeCase.hn, draft));
      setSaveNote("Updated from Form");
    };
    window.addEventListener("flora:form-storage-changed", onDraftChanged);
    return () => window.removeEventListener("flora:form-storage-changed", onDraftChanged);
  }, [activeCase, caseId]);

  // Focus HN input on mount (or when case clears, so user can type HN immediately)
  useEffect(() => {
    if (!hasActiveCase) {
      const t = setTimeout(() => hnInputRef.current?.focus(), 80);
      return () => clearTimeout(t);
    }
  }, [hasActiveCase]);

  // Auto-save: debounced 1.5s after any form change, once initial load is done
  useEffect(() => {
    if (!autoSaveReadyRef.current || !hasActiveCase) return;
    const timer = setTimeout(() => {
      if (!autoSaveReadyRef.current || !hasActiveCase) return;
      setIsSaving(true);
      void save().finally(() => setIsSaving(false));
    }, 1500);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form]);

  useEffect(() => {
    if (hasActiveCase) return;
    const targetHn = String(form.hn || "").trim();
    if (!targetHn) return;
    const timer = setTimeout(() => {
      const normalizedDob = normalizeDateInputDDMMYYYY(form.dob) || "";
      const patch: Record<string, unknown> = {
        hn: targetHn,
        an: form.an.trim(),
        titleTh: form.titleTh.trim(),
        titleEn: form.titleEn.trim(),
        firstName: form.firstName.trim(),
        lastName: form.lastName.trim(),
        firstNameEn: form.firstNameEn.trim(),
        lastNameEn: form.lastNameEn.trim(),
        sex: normalizeSex(form.sex),
        dob: normalizedDob,
        ageY: normalizeAgeText(form.ageY, 3),
        ageM: normalizeAgeText(form.ageM, 2),
        weightKg: form.weightKg.trim(),
        heightCm: form.heightCm.trim(),
        bloodGroupABO: form.bloodGroupABO.trim(),
        bloodGroupRh: form.bloodGroupRh.trim(),
        race: form.race.trim(),
        ethnicity: form.ethnicity.trim(),
        religion: form.religion.trim(),
        maritalStatus: form.maritalStatus.trim(),
      };
      writePrestartPatientDraft(targetHn, patch);
      setSaveNote(`Saved pre-start patient draft ${fmt(Date.now())}`);
    }, 700);
    return () => clearTimeout(timer);
  }, [form, hasActiveCase]);

  useEffect(() => {
    if (hasActiveCase) return;
    window.dispatchEvent(
      new CustomEvent(PRESTART_HN_SYNC_EVENT, {
        detail: { hn: String(form.hn || ""), source: "patient-view" },
      }),
    );
  }, [form.hn, hasActiveCase]);

  const loadSupportData = useCallback(async () => {
    if (!caseId || !activeCase) return;
    setLoadingSupport(true);
    setError("");
    try {
      const rows = await getCaseAllergies(caseId);
      setAllergies(rows);
    } catch {
      setError("Some HIS data could not be loaded.");
    } finally {
      setLoadingSupport(false);
    }
  }, [activeCase, caseId]);

  const applyLookupResult = useCallback((lookup: {
    row: CasePatientInfo | null;
    allergies: CaseAllergyRow[];
    his_payload?: unknown;
    his_errors?: Record<string, string>;
    source?: "HIS" | "BUFFER" | "DEMO_HIS";
    offline?: boolean;
  }) => {
    if (!lookup.row) {
      setNotification({ type: "warning", text: "HIS returned no patient data for this HN. Check HN and try again." });
      return false;
    }

    setAllergies(lookup.allergies);
    const rawPayloadText = prettyJson(lookup.his_payload ?? lookup.row.his_payload ?? null);
    setHisRawPayloadText(rawPayloadText);
    setShowHisRawPayload(Boolean(rawPayloadText));
    let resolvedName = "";
    setForm(prev => {
      const next = applyHisToForm(prev, lookup.row as CasePatientInfo);
      const parsed = parseDob(next.dob);
      const age = parsed ? ageFromDob(parsed) : null;
      const finalNext = {
        ...next,
        ageY: age ? String(age.years) : "",
        ageM: age ? String(age.months) : "",
      };
      resolvedName = [next.firstName, next.lastName].filter(Boolean).join(" ");
      return finalNext;
    });

    const suffix =
      lookup.his_errors && Object.keys(lookup.his_errors).length > 0
        ? ` (${Object.keys(lookup.his_errors).join(", ")})`
        : "";
    setSaveNote(`Loaded patient info from HIS${suffix}.`);
    setDataSource("HIS");
    setNotification({
      type: lookup.his_errors && Object.keys(lookup.his_errors).length > 0 ? "warning" : "success",
      text: `${resolvedName || "Patient"} patient info loaded from HIS${suffix}.`,
    });
    return true;
  }, []);

  useEffect(() => {
    void loadSupportData();
  }, [loadSupportData]);

  const applyHisFromCache = useCallback(async () => {
    if (!caseId) return false;
    const info = await getCasePatientInfo(caseId);
    if (!info) return false;
    const rawPayloadText = prettyJson(info.his_payload ?? null);
    setHisRawPayloadText(rawPayloadText);
    setShowHisRawPayload(Boolean(rawPayloadText));
    setForm(prev => {
      const next = applyHisToForm(prev, info);
      const parsed = parseDob(next.dob);
      const age = parsed ? ageFromDob(parsed) : null;
      return {
        ...next,
        ageY: age ? String(age.years) : "",
        ageM: age ? String(age.months) : "",
      };
    });
    return true;
  }, [caseId]);

  useEffect(() => {
    if (!caseId || !activeCase) return;
    const onHisSynced = (event: Event) => {
      const custom = event as CustomEvent<{ caseId?: unknown }>;
      const changedCaseId = Number(custom.detail?.caseId);
      if (!Number.isFinite(changedCaseId) || changedCaseId !== caseId) return;
      void (async () => {
        setLoadingSupport(true);
        try {
          const loaded = await applyHisFromCache();
          await loadSupportData();
          if (loaded) { setSaveNote("Loaded HIS data."); setDataSource("HIS"); }
        } catch (err) {
          setError(err instanceof Error ? err.message : "GetHIS failed");
        } finally {
          setLoadingSupport(false);
        }
      })();
    };
    window.addEventListener("flora:his-synced", onHisSynced);
    return () => window.removeEventListener("flora:his-synced", onHisSynced);
  }, [activeCase, applyHisFromCache, caseId, loadSupportData]);

  const getHis = useCallback(async (forcedHn?: string) => {
    if (!hasActiveCase) {
      const hn = String(forcedHn ?? form.hn).trim();
      if (!hn) {
        setError("Enter HN before GetHIS.");
        return;
      }
      setLoadingHis(true);
      setError("");
      try {
        const lookup = await lookupPatientInfoByHn(hn);
        applyLookupResult(lookup);
      } catch (err) {
        setError(err instanceof Error ? err.message : "GetHIS failed");
      } finally {
        setLoadingHis(false);
      }
      return;
    }
    if (!caseId || !activeCase) return;
    const targetHn = String(forcedHn ?? form.hn ?? activeCase.hn).trim();
    if (!targetHn) {
      setError("Enter HN before GetHIS.");
      return;
    }
    setLoadingHis(true);
    setError("");
    try {
      if (targetHn !== String(activeCase.hn || "").trim()) {
        await updateCasePatientInfo(caseId, { hn: targetHn });
        window.dispatchEvent(
          new CustomEvent("flora:case-hn-updated", {
            detail: { caseId, hn: targetHn },
          }),
        );
        setForm(prev => ({ ...prev, hn: targetHn }));
      }
      const sync = await syncCasePatientInfo(caseId);
      const loaded = await applyHisFromCache();
      if (!loaded) {
        setNotification({ type: "warning", text: "HIS returned no patient data for this HN. Check HN and try again." });
        setLoadingHis(false);
        return;
      }
      const hisErrors =
        sync.his_errors && Object.keys(sync.his_errors).length > 0
          ? ` (${Object.keys(sync.his_errors).join(", ")})`
          : "";
      setSaveNote(`Loaded patient info from HIS${hisErrors}.`);
      setDataSource("HIS");
      setNotification({ type: hisErrors ? "warning" : "success", text: `Patient info loaded from HIS${hisErrors}.` });
      await loadSupportData();
    } catch (err) {
      setNotification({ type: "error", text: err instanceof Error ? err.message : "GetHIS failed" });
    } finally {
      setLoadingHis(false);
    }
  }, [activeCase, applyHisFromCache, applyLookupResult, caseId, form.hn, hasActiveCase, loadSupportData]);

  const getAllergy = async (forcedHn?: string) => {
    const hn = String(forcedHn ?? (hasActiveCase && activeCase ? activeCase.hn : form.hn)).trim();
    if (!hn) {
      setError("Enter HN before Get Allergy.");
      return;
    }
    setLoadingHis(true);
    setError("");
    try {
      if (hasActiveCase && caseId) {
        await syncCaseHisAllergy(caseId, { allow_buffer_fallback: true });
        const fresh = await getCaseAllergies(caseId);
        setAllergies(fresh);
        emitAllergyChanged();
        if (fresh.length === 0) {
          setNotification({ type: "warning", text: "No allergy records found in HIS for this patient." });
        } else {
          setNotification({ type: "success", text: `${fresh.length} allergy record${fresh.length !== 1 ? "s" : ""} loaded from HIS.` });
        }
      } else {
        const result = await fetchHisAllergyByHn(hn, { allow_buffer_fallback: true });
        setAllergies(result.rows);
        const suffix =
          result.his_errors && Object.keys(result.his_errors).length > 0
            ? ` (partial: ${Object.keys(result.his_errors).join(", ")})`
            : "";
        const src = (result.source || "HIS").toLowerCase();
        if (result.rows.length === 0) {
          setNotification({ type: "warning", text: `No allergy records found in ${src}${suffix}.` });
        } else {
          setNotification({ type: "success", text: `${result.rows.length} allergy record${result.rows.length !== 1 ? "s" : ""} loaded from ${src}${suffix}.` });
        }
      }
    } catch (err) {
      setNotification({ type: "error", text: err instanceof Error ? err.message : "Get allergy failed" });
    } finally {
      setLoadingHis(false);
    }
  };

  useEffect(() => {
    const onRequested = (event: Event) => {
      const custom = event as CustomEvent<{ hn?: unknown }>;
      const hn = String(custom.detail?.hn || "").trim();
      if (!hn) return;
      setForm(prev => ({ ...prev, hn }));
      void getHis(hn);
    };
    window.addEventListener("flora:patient-gethis-request", onRequested);
    return () => window.removeEventListener("flora:patient-gethis-request", onRequested);
  }, [getHis]);

  const save = async () => {
    const finalHn = String(form.hn || "").trim();
    if (!finalHn) {
      setError("HN is required");
      return;
    }
    const normalizedDob = normalizeDateInputDDMMYYYY(form.dob);
    if (form.dob.trim() && !normalizedDob) {
      setError("DOB must use dd/mm/yyyy");
      return;
    }

    const ageYInput = normalizeAgeText(form.ageY, 3);
    const ageMInput = normalizeAgeText(form.ageM, 2);
    const parsed =
      normalizedDob != null
        ? parseDob(normalizedDob)
        : dobFromAge(ageYInput, ageMInput);
    const age = parsed ? ageFromDob(parsed) : null;
    const finalDob = parsed ? formatDob(parsed) : "";
    const finalAgeY = age ? String(age.years) : ageYInput;
    const finalAgeM = age ? String(age.months) : ageMInput;
    const patch: Record<string, unknown> = {
      hn: finalHn,
      an: form.an.trim(),
      titleTh: form.titleTh.trim(),
      titleEn: form.titleEn.trim(),
      firstName: form.firstName.trim(),
      lastName: form.lastName.trim(),
      firstNameEn: form.firstNameEn.trim(),
      lastNameEn: form.lastNameEn.trim(),
      sex: normalizeSex(form.sex),
      dob: finalDob,
      ageY: finalAgeY,
      ageM: finalAgeM,
      weightKg: form.weightKg.trim(),
      heightCm: form.heightCm.trim(),
      bloodGroupABO: form.bloodGroupABO.trim(),
      bloodGroupRh: form.bloodGroupRh.trim(),
      race: form.race.trim(),
      ethnicity: form.ethnicity.trim(),
      religion: form.religion.trim(),
      maritalStatus: form.maritalStatus.trim(),
    };

    if (!hasActiveCase || !caseId || !activeCase) {
      writePrestartPatientDraft(finalHn, patch);
      setForm(prev => ({
        ...prev,
        hn: finalHn,
        dob: finalDob,
        ageY: finalAgeY,
        ageM: finalAgeM,
      }));
      setError("");
      setSaveNote(`Saved for case start ${fmt(Date.now())}`);
      return;
    }

    await updateCasePatientInfo(caseId, { hn: finalHn });
    writeDraft(caseId, patch);
    await saveCaseDetailDraft(caseId, {
      ...readDraft(caseId),
      ...patch,
    });
    window.dispatchEvent(
      new CustomEvent("flora:form-storage-changed", {
        detail: { caseId, source: "patient" },
      }),
    );
    window.dispatchEvent(
      new CustomEvent("flora:case-hn-updated", {
        detail: { caseId, hn: finalHn },
      }),
    );
    setForm(prev => ({
      ...prev,
      hn: finalHn,
      dob: finalDob,
      ageY: finalAgeY,
      ageM: finalAgeM,
    }));
    setError("");
    setSaveNote(`Saved ${fmt(Date.now())}`);
  };

  const applyAgeToDob = (ageYRaw: string, ageMRaw: string) => {
    setForm(prev => {
      const ageY = normalizeAgeText(ageYRaw, 3);
      const ageM = normalizeAgeText(ageMRaw, 2);
      const derivedDob = dobFromAge(ageY, ageM);
      if (!derivedDob) return { ...prev, ageY, ageM };
      const age = ageFromDob(derivedDob);
      return {
        ...prev,
        dob: formatDob(derivedDob),
        ageY: age ? String(age.years) : ageY,
        ageM: age ? String(age.months) : ageM,
      };
    });
  };

  return (
    <div className="app-theme-scope p-4 space-y-3">
      <div className="sticky top-3 z-20">
        <div className="flex items-center flex-wrap gap-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white/95 dark:bg-gray-950/95 backdrop-blur px-3 py-2 shadow-sm">
          <div className="inline-flex rounded border border-gray-300 dark:border-gray-700 overflow-hidden shrink-0">
            <button type="button" onClick={() => setPatientTab("info")}
              className={`px-2.5 py-1 text-xs ${patientTab === "info" ? "bg-blue-600 text-white" : "bg-white dark:bg-gray-900 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800"}`}>
              Patient
            </button>
            <button type="button" onClick={() => setPatientTab("allergy")}
              className={`px-2.5 py-1 text-xs border-l border-gray-300 dark:border-gray-700 ${patientTab === "allergy" ? "bg-blue-600 text-white" : "bg-white dark:bg-gray-900 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800"}`}>
              Allergy
            </button>
            <button type="button" onClick={() => setPatientTab("lab")}
              className={`px-2.5 py-1 text-xs border-l border-gray-300 dark:border-gray-700 ${patientTab === "lab" ? "bg-blue-600 text-white" : "bg-white dark:bg-gray-900 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800"}`}>
              Lab
            </button>
          </div>
          {patientTab === "info" && (
            <button type="button" className={secondaryButton} onClick={() => void getHis()} disabled={loadingHis}>
              {loadingHis ? "Loading..." : "GetHIS"}
            </button>
          )}
          {patientTab === "allergy" && (
            <button type="button" className={secondaryButton} onClick={() => void getAllergy()} disabled={loadingHis}>
              GetAllergy
            </button>
          )}
          <div className="ml-auto text-xs text-gray-400 dark:text-gray-500">
            {isSaving ? "Saving…" : saveNote || ""}
          </div>
        </div>
        {notification && (
          <div className={`mt-1 flex items-center justify-between gap-2 rounded-lg border px-3 py-2 text-xs shadow-sm ${
            notification.type === "success"
              ? "border-green-300 dark:border-green-700 bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-300"
              : notification.type === "warning"
                ? "border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-300"
                : "border-red-300 dark:border-red-700 bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300"
          }`}>
            <span>{notification.text}</span>
            <button
              type="button"
              className="ml-2 opacity-60 hover:opacity-100 text-base leading-none"
              onClick={() => setNotification(null)}
            >
              ✕
            </button>
          </div>
        )}
      </div>

      {patientTab === "lab" && (
        <Suspense fallback={<div className="p-4 text-sm text-gray-400">Loading…</div>}>
          <LabView caseStatus={caseStatus} />
        </Suspense>
      )}

      {patientTab === "info" && <>

      <section className={card}>
        <div className="flex items-center justify-between gap-2">
          <div>
            <div className="flex items-center gap-2">
              <div className="text-sm font-semibold">Patient Info</div>
              {dataSource && (
                <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider ${
                  dataSource === "HIS"
                    ? "bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400"
                    : "bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400"
                }`}>
                  {dataSource === "HIS" ? "From HIS" : "Loaded"}
                </span>
              )}
            </div>
            <div className="text-xs text-gray-500 dark:text-gray-400">
              Enter and verify demographic data
            </div>
          </div>
          {hisRawPayloadText ? (
            <div className="flex items-center gap-2">
              <button
                type="button"
                className={secondaryButton}
                onClick={() => setShowHisRawPayload(prev => !prev)}
              >
                {showHisRawPayload ? "Hide HIS Raw" : "Show HIS Raw"}
              </button>
              <button
                type="button"
                className={secondaryButton}
                onClick={() => {
                  if (typeof navigator !== "undefined" && navigator.clipboard) {
                    void navigator.clipboard.writeText(hisRawPayloadText);
                  }
                }}
              >
                Copy JSON
              </button>
            </div>
          ) : null}
        </div>

        {showHisRawPayload && hisRawPayloadText ? (
          <div className="rounded border border-amber-300 dark:border-amber-700 bg-amber-50/70 dark:bg-amber-950/20 p-2 space-y-2">
            <div className="text-xs font-semibold text-amber-800 dark:text-amber-300">
              HIS Raw JSON
            </div>
            <textarea
              className="w-full min-h-[220px] rounded border border-amber-200 dark:border-amber-800 bg-white/90 dark:bg-gray-950 px-2 py-1.5 text-[11px] font-mono"
              value={hisRawPayloadText}
              readOnly
            />
          </div>
        ) : null}

        <div className="grid grid-cols-1 md:grid-cols-12 gap-2">
          <div className="md:col-span-6 space-y-2">
            <label className="space-y-1 block">
              <div className={label}>HN</div>
              <div className="flex gap-1">
                <input
                  ref={hnInputRef}
                  className={input}
                  value={form.hn}
                  onChange={e => setForm(prev => ({ ...prev, hn: e.target.value }))}
                  onKeyDown={e => { if (e.key === "Enter" && form.hn.trim()) void getHis(); }}
                />
                <button
                  type="button"
                  className={primaryButton}
                  onClick={() => void getHis()}
                  disabled={loadingHis || !form.hn.trim()}
                >
                  {loadingHis ? "…" : "Get"}
                </button>
              </div>
            </label>
            <label className="space-y-1 block">
              <div className={label}>AN</div>
              <input
                className={input}
                value={form.an}
                onChange={e => setForm(prev => ({ ...prev, an: e.target.value }))}
              />
            </label>
          </div>

          <div className="md:col-span-6 md:row-span-2 space-y-1">
            <div className={label}>HN Barcode / QR</div>
            <div className="flex items-start gap-2 rounded border border-gray-200 dark:border-gray-700 p-2">
              <HnBarcode
                value={form.hn}
                height={42}
                className="flex-1 text-gray-900 dark:text-gray-100"
              />
              <HnQrCode
                value={form.hn}
                size={68}
                className="text-gray-900 dark:text-gray-100"
              />
            </div>
          </div>

          <div className="md:col-span-12 grid grid-cols-1 md:grid-cols-12 gap-2">
            <label className="space-y-1 md:col-span-2">
              <div className={label}>Title (TH)</div>
              <select
                className={input}
                value={form.titleTh}
                onChange={e => setForm(prev => ({ ...prev, titleTh: e.target.value }))}
              >
                {TITLE_TH_OPTIONS.map(opt => (
                  <option key={opt || "empty"} value={opt}>
                    {opt || "-"}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-1 md:col-span-5">
              <div className={label}>TH First Name</div>
              <input className={input} value={form.firstName} onChange={e => setForm(prev => ({ ...prev, firstName: e.target.value }))} />
            </label>
            <label className="space-y-1 md:col-span-5">
              <div className={label}>TH Last Name</div>
              <input className={input} value={form.lastName} onChange={e => setForm(prev => ({ ...prev, lastName: e.target.value }))} />
            </label>

            <label className="space-y-1 md:col-span-2">
              <div className={label}>Title (EN)</div>
              <select
                className={input}
                value={form.titleEn}
                onChange={e => setForm(prev => ({ ...prev, titleEn: e.target.value }))}
              >
                {TITLE_EN_OPTIONS.map(opt => (
                  <option key={opt || "empty"} value={opt}>
                    {opt || "-"}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-1 md:col-span-5">
              <div className={label}>EN First Name</div>
              <input className={input} value={form.firstNameEn} onChange={e => setForm(prev => ({ ...prev, firstNameEn: e.target.value }))} />
            </label>
            <label className="space-y-1 md:col-span-5">
              <div className={label}>EN Last Name</div>
              <input className={input} value={form.lastNameEn} onChange={e => setForm(prev => ({ ...prev, lastNameEn: e.target.value }))} />
            </label>

            <label className="space-y-1 md:col-span-2">
              <div className={label}>Blood Group (ABO)</div>
              <select
                className={input}
                value={(form.bloodGroupABO || "").toUpperCase()}
                onChange={e => setForm(prev => ({ ...prev, bloodGroupABO: e.target.value }))}
              >
                <option value="">Unknown</option>
                <option value="A">A</option>
                <option value="B">B</option>
                <option value="AB">AB</option>
                <option value="O">O</option>
              </select>
            </label>
            <label className="space-y-1 md:col-span-2">
              <div className={label}>Blood Group (Rh)</div>
              <select
                className={input}
                value={(form.bloodGroupRh || "").toUpperCase()}
                onChange={e => setForm(prev => ({ ...prev, bloodGroupRh: e.target.value }))}
              >
                <option value="">Unknown</option>
                <option value="+">Rh+</option>
                <option value="-">Rh-</option>
              </select>
            </label>
            <label className="space-y-1 md:col-span-3">
              <div className={label}>Date of Birth</div>
              <input
                className={input}
                placeholder="dd/mm/yyyy"
                value={form.dob}
                onChange={e => {
                  const dob = formatDateInputDDMMYYYY(e.target.value);
                  const parsed = parseDob(dob);
                  const age = parsed ? ageFromDob(parsed) : null;
                  setForm(prev => ({
                    ...prev,
                    dob,
                    ageY: age ? String(age.years) : "",
                    ageM: age ? String(age.months) : "",
                  }));
                }}
              />
            </label>
            <label className="space-y-1 md:col-span-2">
              <div className={label}>Age (Y)</div>
              <input
                className={input}
                inputMode="numeric"
                value={form.ageY}
                onChange={e => {
                  const ageY = normalizeAgeText(e.target.value, 3);
                  setForm(prev => ({ ...prev, ageY }));
                }}
                onBlur={e => applyAgeToDob(e.target.value, form.ageM)}
              />
            </label>
            <label className="space-y-1 md:col-span-3">
              <div className={label}>Age (M)</div>
              <input
                className={input}
                inputMode="numeric"
                value={form.ageM}
                onChange={e => {
                  const ageM = normalizeAgeText(e.target.value, 2);
                  setForm(prev => ({ ...prev, ageM }));
                }}
                onBlur={e => applyAgeToDob(form.ageY, e.target.value)}
              />
            </label>

            <div className="space-y-1 md:col-span-4">
              <div className={label}>Sex</div>
              <div className="grid grid-cols-3 gap-2">
                <label className="inline-flex items-center justify-center gap-1 rounded border border-gray-300 dark:border-gray-700 px-2 py-1.5 text-xs">
                  <input
                    type="radio"
                    name="patient-sex"
                    checked={normalizeSex(form.sex) === "M"}
                    onChange={() => setForm(prev => ({ ...prev, sex: "M" }))}
                  />
                  Male
                </label>
                <label className="inline-flex items-center justify-center gap-1 rounded border border-gray-300 dark:border-gray-700 px-2 py-1.5 text-xs">
                  <input
                    type="radio"
                    name="patient-sex"
                    checked={normalizeSex(form.sex) === "F"}
                    onChange={() => setForm(prev => ({ ...prev, sex: "F" }))}
                  />
                  Female
                </label>
                <label className="inline-flex items-center justify-center gap-1 rounded border border-gray-300 dark:border-gray-700 px-2 py-1.5 text-xs">
                  <input
                    type="radio"
                    name="patient-sex"
                    checked={normalizeSex(form.sex) === ""}
                    onChange={() => setForm(prev => ({ ...prev, sex: "" }))}
                  />
                  Unknown
                </label>
              </div>
            </div>
            <label className="space-y-1 md:col-span-4">
              <div className={label}>Weight (kg)</div>
              <input
                type="number"
                min="0"
                max="400"
                step="0.1"
                className={input}
                value={form.weightKg}
                onChange={e => setForm(prev => ({ ...prev, weightKg: e.target.value }))}
              />
            </label>
            <label className="space-y-1 md:col-span-4">
              <div className={label}>Height (cm)</div>
              <input
                type="number"
                min="0"
                max="260"
                step="0.1"
                className={input}
                value={form.heightCm}
                onChange={e => setForm(prev => ({ ...prev, heightCm: e.target.value }))}
              />
            </label>
          </div>
        </div>

        {error ? (
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs text-red-500">{error}</span>
          </div>
        ) : null}
      </section>

      </>}

      {patientTab === "allergy" && <section className={card}>
        <div className="flex items-center justify-between">
          <div className="text-sm font-semibold">Allergy</div>
          <div className="flex gap-2">
            <div className="text-xs text-gray-500 dark:text-gray-400 self-center">
              {loadingSupport ? "Loading..." : `${allergies.length} records`}
            </div>
            <button
              type="button"
              className={secondaryButton}
              onClick={() => void getAllergy()}
              disabled={loadingHis}
            >
              {loadingHis ? "Syncing..." : "Sync HIS"}
            </button>
          </div>
        </div>

        {allergies.length === 0 ? (
          <div className="text-xs text-gray-500 dark:text-gray-400">No allergy data recorded.</div>
        ) : (
          <div className="rounded border border-gray-200 dark:border-gray-800 overflow-hidden">
            <table className="w-full text-xs">
              <thead className="bg-gray-100 dark:bg-gray-900/50">
                <tr>
                  <th className="px-2 py-1 text-left">Allergen</th>
                  <th className="px-2 py-1 text-left">Reaction</th>
                  <th className="px-2 py-1 text-left">Severity</th>
                  <th className="px-2 py-1 text-left">Source</th>
                  <th className="px-2 py-1 text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {allergies.map(row => (
                  <tr key={row.id} className="border-t border-gray-200 dark:border-gray-800">
                    <td className="px-2 py-1 font-bold text-red-600 dark:text-red-400">{row.allergen}</td>
                    <td className="px-2 py-1">{row.reaction || "-"}</td>
                    <td className="px-2 py-1">
                      {row.severity ? (
                        <span className="rounded bg-red-100 dark:bg-red-900/30 px-1.5 py-0.5 text-[10px] font-bold text-red-700 dark:text-red-400">
                          {row.severity}
                        </span>
                      ) : "-"}
                    </td>
                    <td className="px-2 py-1 text-[10px] text-gray-400 uppercase">{row.source || "HIS"}</td>
                    <td className="px-2 py-1 text-right space-x-2">
                      <button
                        type="button"
                        onClick={() => handleEditAllergy(row)}
                        className="text-blue-600 dark:text-blue-400 hover:underline"
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => setPendingDeleteAllergyId(row.id)}
                        className="text-red-600 dark:text-red-400 hover:underline"
                      >
                        Remove
                      </button>

                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="mt-4 space-y-3 rounded-lg border border-gray-200 dark:border-gray-800 bg-gray-50/50 dark:bg-black/20 p-3">
          <div className="text-[10px] font-bold uppercase tracking-wider text-gray-400">
            {editingAllergyId ? "Edit Allergy Entry" : "Add Manual Allergy"}
          </div>
          <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
            <div className="space-y-1">
              <div className={label}>Allergen</div>
              <input
                className={input}
                placeholder="e.g. Penicillin"
                list="allergen-options"
                value={newAllergen}
                onChange={e => setNewAllergen(e.target.value)}
              />
              <datalist id="allergen-options">
                {/* Antibiotics */}
                <option value="Penicillin" />
                <option value="Amoxicillin" />
                <option value="Ampicillin" />
                <option value="Co-trimoxazole (TMP-SMX)" />
                <option value="Cefazolin" />
                <option value="Ceftriaxone" />
                <option value="Cephalexin" />
                <option value="Clindamycin" />
                <option value="Metronidazole" />
                <option value="Vancomycin" />
                <option value="Ciprofloxacin" />
                <option value="Tetracycline" />
                <option value="Erythromycin" />
                {/* NSAIDs / Analgesics */}
                <option value="Aspirin" />
                <option value="Ibuprofen" />
                <option value="Diclofenac" />
                <option value="Mefenamic acid (Ponstan)" />
                <option value="Naproxen" />
                <option value="Morphine" />
                <option value="Codeine" />
                <option value="Tramadol" />
                <option value="Paracetamol" />
                {/* Anesthesia */}
                <option value="Latex" />
                <option value="Succinylcholine" />
                <option value="Rocuronium" />
                <option value="Cisatracurium" />
                <option value="Propofol" />
                <option value="Thiopental" />
                <option value="Neostigmine" />
                <option value="Contrast media (Iodine)" />
                <option value="Chlorhexidine" />
                <option value="Protamine" />
                {/* High SJS risk in Thai/Asian (HLA-associated) */}
                <option value="Carbamazepine" />
                <option value="Phenytoin" />
                <option value="Allopurinol" />
                <option value="Oxcarbazepine" />
                {/* Food */}
                <option value="Shellfish" />
                <option value="Fish / Fish sauce" />
                <option value="Peanuts" />
                <option value="Tree nuts" />
                <option value="Sesame" />
                <option value="Soy" />
                <option value="Eggs" />
                <option value="Milk / Dairy" />
                {/* Environmental / Other */}
                <option value="House dust mite" />
                <option value="Bee / Wasp venom" />
                <option value="Andrographis (ฟ้าทะลายโจร)" />
              </datalist>
            </div>
            <div className="space-y-1">
              <div className={label}>Reaction</div>
              <input
                className={input}
                placeholder="e.g. Skin rash"
                value={newReaction}
                onChange={e => setNewReaction(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <div className={label}>Severity</div>
              <input
                className={input}
                placeholder="e.g. Severe"
                value={newSeverity}
                onChange={e => setNewSeverity(e.target.value)}
                list="patient-allergy-severity-options"
              />
              <datalist id="patient-allergy-severity-options">
                {ALLERGY_SEVERITY_OPTIONS.map(item => (
                  <option key={item} value={item} />
                ))}
              </datalist>
            </div>
          </div>
          <div className="flex justify-end gap-2">
            {editingAllergyId && (
              <button
                type="button"
                className="text-xs text-gray-500 hover:underline px-2"
                onClick={() => {
                  setEditingAllergyId(null);
                  setNewAllergen("");
                  setNewReaction("");
                  setNewSeverity("");
                }}
              >
                Cancel
              </button>
            )}
            <button
              type="button"
              className={primaryButton}
              disabled={!newAllergen.trim()}
              onClick={() => void handleSaveAllergy()}
            >
              {editingAllergyId ? "Update Entry" : "Add Entry"}
            </button>
          </div>
        </div>
      </section>}

      <ConfirmDialog
        open={pendingDeleteAllergyId !== null}
        title="Remove Allergy"
        message="Are you sure you want to remove this allergy record from the case?"
        confirmLabel="Remove"
        tone="danger"
        onConfirm={confirmDeleteAllergy}
        onCancel={() => setPendingDeleteAllergyId(null)}
      />

      <ConfirmDialog
        open={alertMessage !== ""}
        title={alertTitle || "Notice"}
        message={alertMessage}
        confirmLabel="OK"
        tone="primary"
        onConfirm={() => {
          setAlertMessage("");
          setAlertTitle("");
        }}
        onCancel={() => {
          setAlertMessage("");
          setAlertTitle("");
        }}
      />
    </div>
  );
}
