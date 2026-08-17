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

export function ecgValueToCode(value?: string) {
  if (!value) return "";
  const found = ECG_OPTIONS.find(o => o.value === value);
  return found ? found.code : "";
}
