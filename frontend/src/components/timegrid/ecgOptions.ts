export const ECG_OPTIONS = [
  { value: "Normal sinus rhythm", code: "SR" },
  { value: "Sinus bradycardia", code: "SB" },
  { value: "Sinus tachycardia", code: "ST" },
  { value: "Atrial fibrillation", code: "AF" },
  { value: "Atrial flutter", code: "AFL" },
  { value: "PVC", code: "PVC" },
  { value: "PAC", code: "PAC" },
  { value: "ST depression", code: "STD" },
  { value: "ST elevation", code: "STE" },
];

// A persisted reset is different from deleting a cell: deletion would make the
// timeline inherit the previous rhythm again. This marker stops carry-forward
// until another rhythm is recorded.
export const ECG_CLEAR_VALUE = "__ECG_CLEAR__";

export function ecgValueToCode(value?: string) {
  if (!value || value === ECG_CLEAR_VALUE) return "";
  const found = ECG_OPTIONS.find(o => o.value === value);
  return found ? found.code : "";
}
