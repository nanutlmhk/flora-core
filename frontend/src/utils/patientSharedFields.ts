export const PATIENT_DRAFT_FIELD_KEYS = new Set([
  "hn", "an", "idType", "idCard", "titleTh", "titleEn", "firstName", "lastName",
  "firstNameEn", "lastNameEn", "sex", "dob", "ageY", "ageM", "weightKg", "heightCm",
  "bloodGroupABO", "bloodGroupRh", "race", "ethnicity", "religion", "maritalStatus",
  "nationality", "preferredLanguage", "mobile", "email", "presentAddress", "presentProvince",
  "legalAddress", "legalProvince", "contactName", "contactRelation", "contactTel",
  "contactInstructions",
]);

export const SHARED_PATIENT_FORM_FIELD_KEYS = new Set([
  "hn", "an", "dob", "ageY", "ageM", "weightKg", "heightCm", "bloodGroupABO", "bloodGroupRh",
]);

export function pickDraftFields(
  source: Record<string, unknown>,
  keys: ReadonlySet<string>,
): Record<string, unknown> {
  return Object.fromEntries(Object.entries(source).filter(([key]) => keys.has(key)));
}
