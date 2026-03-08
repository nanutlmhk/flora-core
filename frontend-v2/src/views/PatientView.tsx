import { useEffect, useState } from "react";
import type { CaseStatus } from "../api/caseApi";
import ConfirmDialog from "../components/common/ConfirmDialog";
import {
  createCaseAllergy,
  deleteCaseAllergy,
  deleteHisBufferByHn,
  fetchHisAllergyByHn,
  getHisBufferByHn,
  listHisBuffer,
  preloadHisByHn,
  getCaseAllergies,
  getCasePatientInfo,
  syncCaseHisAllergy,
  syncCaseHis,
  updateCaseAllergy,
  type CaseAllergyRow,
  type HisBufferListRow,
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
  const [hisPayload, setHisPayload] = useState<unknown>(null);
  const [showHisPayload, setShowHisPayload] = useState(false);
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
  const [loadingBuffer, setLoadingBuffer] = useState(false);
  const [bufferRows, setBufferRows] = useState<HisBufferListRow[]>([]);
  const [bufferQuery, setBufferQuery] = useState("");
  const [error, setError] = useState("");
  const [saveNote, setSaveNote] = useState("");

  const emitAllergyChanged = () => {
    if (!caseId) return;
    window.dispatchEvent(
      new CustomEvent("aidas:allergy-changed", {
        detail: { caseId },
      }),
    );
  };

  useEffect(() => {
    if (!activeCase || caseId == null) {
      setForm(defaults(""));
      setAllergies([]);
      setHisPayload(null);
      return;
    }
    const draft = readDraft(caseId);
    setForm(buildFormFromDraft(activeCase.hn, draft));
    void loadSupportData();
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
    window.addEventListener("aidas:form-storage-changed", onDraftChanged);
    return () => window.removeEventListener("aidas:form-storage-changed", onDraftChanged);
  }, [activeCase, caseId]);

  const loadSupportData = async () => {
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
  };

  const loadBufferList = async (query?: string) => {
    setLoadingBuffer(true);
    try {
      const rows = await listHisBuffer({
        q: (query ?? bufferQuery).trim(),
        limit: 120,
      });
      setBufferRows(rows);
    } catch {
      // Ignore list failures to avoid blocking patient entry.
    } finally {
      setLoadingBuffer(false);
    }
  };

  const applyLookupResult = (lookup: {
    row: CasePatientInfo | null;
    allergies: CaseAllergyRow[];
    his_payload?: unknown;
    his_errors?: Record<string, string>;
    source?: "HIS" | "BUFFER";
    offline?: boolean;
  }) => {
    if (!lookup.row) {
      setError("No patient demographic data from HIS.");
      return false;
    }

    setHisPayload(lookup.row.his_payload ?? lookup.his_payload ?? lookup.row);
    setAllergies(lookup.allergies);
    setForm(prev => {
      const next = applyHisToForm(prev, lookup.row as CasePatientInfo);
      const parsed = parseDob(next.dob);
      const age = parsed ? ageFromDob(parsed) : null;
      return {
        ...next,
        ageY: age ? String(age.years) : "",
        ageM: age ? String(age.months) : "",
      };
    });

    const suffix =
      lookup.his_errors && Object.keys(lookup.his_errors).length > 0
        ? ` (partial: ${Object.keys(lookup.his_errors).join(", ")})`
        : "";
    const source = lookup.source === "BUFFER" ? "buffer" : "HIS";
    const offline = lookup.offline ? " offline" : "";
    setSaveNote(`Loaded ${source}${offline} data${suffix}.`);
    return true;
  };

  useEffect(() => {
    void loadSupportData();
  }, [activeCase, caseId]);

  useEffect(() => {
    void loadBufferList("");
  }, []);

  const applyHisFromCache = async () => {
    if (!caseId) return false;
    const info = await getCasePatientInfo(caseId);
    if (!info) return false;
    setHisPayload(info.his_payload ?? info);
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
  };

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
          if (loaded) setSaveNote("Loaded HIS data. Review and press Save.");
        } catch (err) {
          setError(err instanceof Error ? err.message : "GetHIS failed");
        } finally {
          setLoadingSupport(false);
        }
      })();
    };
    window.addEventListener("aidas:his-synced", onHisSynced);
    return () => window.removeEventListener("aidas:his-synced", onHisSynced);
  }, [activeCase, caseId]);

  const getHis = async (forcedHn?: string) => {
    if (!hasActiveCase) {
      const hn = String(forcedHn ?? form.hn).trim();
      if (!hn) {
        setError("Enter HN before GetHIS.");
        return;
      }
      setLoadingHis(true);
      setError("");
      try {
        const lookup = await preloadHisByHn(hn, {
          allow_buffer_fallback: true,
        });
        applyLookupResult(lookup);
        await loadBufferList("");
      } catch (err) {
        setError(err instanceof Error ? err.message : "GetHIS failed");
      } finally {
        setLoadingHis(false);
      }
      return;
    }
    if (!caseId || !activeCase) return;
    setLoadingHis(true);
    setError("");
    try {
      const sync = await syncCaseHis(caseId);
      const loaded = await applyHisFromCache();
      if (!loaded) {
        setError("No patient demographic data from HIS.");
        setLoadingHis(false);
        return;
      }
      const hisErrors =
        sync.his_errors && Object.keys(sync.his_errors).length > 0
          ? ` (partial: ${Object.keys(sync.his_errors).join(", ")})`
          : "";
      setSaveNote(`Loaded HIS data${hisErrors}. Review and press Save.`);
      await loadSupportData();
      await loadBufferList("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "GetHIS failed");
    } finally {
      setLoadingHis(false);
    }
  };

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
        await loadAllergies();
        emitAllergyChanged();
        setSaveNote("Loaded allergy records from HIS.");
      } else {
        const result = await fetchHisAllergyByHn(hn, { allow_buffer_fallback: true });
        setAllergies(result.rows);
        const suffix =
          result.his_errors && Object.keys(result.his_errors).length > 0
            ? ` (partial: ${Object.keys(result.his_errors).join(", ")})`
            : "";
        setSaveNote(`Loaded allergy (${(result.source || "HIS").toLowerCase()})${suffix}.`);
        await loadBufferList("");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Get allergy failed");
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
    window.addEventListener("aidas:patient-gethis-request", onRequested);
    return () => window.removeEventListener("aidas:patient-gethis-request", onRequested);
  }, [hasActiveCase, caseId, form.hn]);

  const loadFromBuffer = async (hn: string) => {
    const target = String(hn || "").trim();
    if (!target) return;
    setLoadingHis(true);
    setError("");
    try {
      const detail = await getHisBufferByHn(target);
      applyLookupResult(detail);
      setForm(prev => ({ ...prev, hn: target }));
      window.dispatchEvent(
        new CustomEvent("aidas:patient-hn-selected", {
          detail: { hn: target },
        }),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Buffer load failed");
    } finally {
      setLoadingHis(false);
    }
  };

  const removeBufferPatient = async (hn: string) => {
    const target = String(hn || "").trim();
    if (!target) return;
    const ok = window.confirm(`Delete buffered patient ${target}?`);
    if (!ok) return;

    setLoadingBuffer(true);
    try {
      await deleteHisBufferByHn(target);
      setBufferRows(prev => prev.filter(row => row.hn !== target));
      if (form.hn.trim() === target) {
        setForm(defaults(hasActiveCase && activeCase ? activeCase.hn : ""));
        setAllergies([]);
        setHisPayload(null);
      }
      setSaveNote(`Deleted buffered patient ${target}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete buffer failed");
    } finally {
      setLoadingBuffer(false);
    }
  };

  const save = () => {
    if (!hasActiveCase || !caseId || !activeCase) {
      setSaveNote("Start case first to save patient data.");
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
      hn: activeCase.hn,
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

    writeDraft(caseId, patch);
    window.dispatchEvent(
      new CustomEvent("aidas:form-storage-changed", {
        detail: { caseId, source: "patient" },
      }),
    );
    setForm(prev => ({
      ...prev,
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
          {saveNote ? (
            <div className="text-xs text-gray-500 dark:text-gray-400 mr-1 max-w-[320px] truncate">
              {saveNote}
            </div>
          ) : null}
          <button
            type="button"
            className={secondaryButton}
            onClick={() => void getHis()}
            disabled={loadingHis}
          >
            {loadingHis ? "Loading..." : "GetHIS"}
          </button>
          <button
            type="button"
            className={secondaryButton}
            onClick={() => void getAllergy()}
            disabled={loadingHis}
          >
            GetAllergy
          </button>
          <button
            type="button"
            className={secondaryButton}
            onClick={() => setShowHisPayload(true)}
          >
            HIS Payload
          </button>
          <button type="button" className={primaryButton} onClick={save} disabled={!hasActiveCase}>
            Save
          </button>
        </div>
      </div>

      <section className={card}>
        <div className="flex items-center justify-between gap-2">
          <div>
            <div className="text-sm font-semibold">Pre-admit Buffer</div>
            <div className="text-xs text-gray-500 dark:text-gray-400">
              Preload before OR and reuse offline
            </div>
          </div>
          <button
            type="button"
            className={secondaryButton}
            onClick={() => void loadBufferList()}
            disabled={loadingBuffer}
          >
            {loadingBuffer ? "Loading..." : "Refresh"}
          </button>
        </div>

        <div className="flex gap-2">
          <input
            className={input}
            placeholder="Search HN / name"
            value={bufferQuery}
            onChange={e => setBufferQuery(e.target.value)}
            onKeyDown={e => {
              if (e.key === "Enter") void loadBufferList(e.currentTarget.value);
            }}
          />
          <button
            type="button"
            className={secondaryButton}
            onClick={() => void loadBufferList()}
            disabled={loadingBuffer}
          >
            Search
          </button>
        </div>

        {bufferRows.length === 0 ? (
          <div className="text-xs text-gray-500 dark:text-gray-400">No buffered patients yet.</div>
        ) : (
          <div className="max-h-56 overflow-auto space-y-1">
            {bufferRows.map(row => (
              <div
                key={`${row.hn}-${row.updated_at || 0}`}
                className="w-full rounded border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-900 px-2 py-1.5"
              >
                <div className="flex items-center justify-between gap-2 text-xs">
                  <div className="font-medium truncate">
                    {row.hn}{" "}
                    {row.patient_name || `${row.first_name || ""} ${row.last_name || ""}`.trim() || "-"}
                  </div>
                  <div className="text-gray-500 dark:text-gray-400 whitespace-nowrap">
                    {row.his_updated_at ? fmt(row.his_updated_at) : "-"} | A{row.allergy_count ?? 0}/L{row.lab_count ?? 0}
                    {row.pre_admit_at ? ` | S:${fmt(row.pre_admit_at)}` : ""}
                  </div>
                  <div className="flex items-center gap-1 whitespace-nowrap">
                  <button
                    type="button"
                    className="rounded border border-blue-400 text-blue-600 dark:text-blue-300 px-2 py-0.5 text-[11px]"
                    onClick={() => void loadFromBuffer(row.hn)}
                    disabled={loadingHis}
                  >
                    Select
                  </button>
                  <button
                    type="button"
                    className="rounded border border-red-400 text-red-600 dark:text-red-300 px-2 py-0.5 text-[11px]"
                    onClick={() => void removeBufferPatient(row.hn)}
                    disabled={loadingBuffer}
                  >
                    Delete
                  </button>
                </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className={card}>
        <div className="flex items-center justify-between gap-2">
          <div>
            <div className="text-sm font-semibold">Patient Info</div>
            <div className="text-xs text-gray-500 dark:text-gray-400">
              Enter and verify demographic data before save
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-12 gap-2">
          <div className="md:col-span-6 space-y-2">
            <label className="space-y-1 block">
              <div className={label}>HN</div>
              <input
                className={input}
                value={form.hn}
                readOnly={hasActiveCase}
                onChange={e => setForm(prev => ({ ...prev, hn: e.target.value }))}
              />
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
                value={hasActiveCase && activeCase ? activeCase.hn : form.hn}
                height={42}
                className="flex-1 text-gray-900 dark:text-gray-100"
              />
              <HnQrCode
                value={hasActiveCase && activeCase ? activeCase.hn : form.hn}
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

        {error ? <div className="text-xs text-red-500">{error}</div> : null}
      </section>

      <section className={card}>
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
      </section>

      {showHisPayload ? (
        <div className="fixed inset-0 z-30 bg-black/40 flex items-center justify-center p-4">
          <div className="w-full max-w-3xl max-h-[82vh] rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-950 shadow-lg flex flex-col">
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-800">
              <div className="font-medium text-sm">HIS Payload (Read only)</div>
              <button
                type="button"
                className={secondaryButton}
                onClick={() => setShowHisPayload(false)}
              >
                Close
              </button>
            </div>
            <div className="p-4 overflow-auto">
              {hisPayload ? (
                <pre className="rounded border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-900 p-3 text-xs whitespace-pre-wrap break-words">
                  {JSON.stringify(hisPayload, null, 2)}
                </pre>
              ) : (
                <div className="text-xs text-gray-500 dark:text-gray-400">
                  No HIS payload loaded. Press GetHIS first.
                </div>
              )}
            </div>
          </div>
        </div>
      ) : null}

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
