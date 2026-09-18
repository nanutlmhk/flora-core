export type PatientNameLanguage = "auto" | "thai" | "english";

export type PatientNameFields = {
  patient_name?: string | null;
  title_th?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  title_en?: string | null;
  first_name_en?: string | null;
  last_name_en?: string | null;
};

function joinName(values: Array<string | null | undefined>): string {
  return values.map(value => String(value || "").trim()).filter(Boolean).join(" ");
}

export function normalizePatientNameLanguage(value: unknown): PatientNameLanguage {
  return value === "thai" || value === "english" ? value : "auto";
}

export function formatPatientDisplayName(
  patient: PatientNameFields | null | undefined,
  preference: PatientNameLanguage = "auto",
): string {
  const explicit = String(patient?.patient_name || "").trim();
  const thai = joinName([patient?.title_th, patient?.first_name, patient?.last_name]);
  const english = joinName([patient?.title_en, patient?.first_name_en, patient?.last_name_en]);

  if (preference === "thai") return thai || explicit || english;
  if (preference === "english") return english || explicit || thai;
  return explicit || thai || english;
}
