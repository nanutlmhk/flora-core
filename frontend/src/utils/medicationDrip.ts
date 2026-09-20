export type HistoricalDripPreparation = {
  amount: number;
  amountUnit: string;
  carrier: string | null;
  totalVolumeMl: number;
};

export type HistoricalDripDose = {
  value: number;
  unit: string;
};

export type HistoricalDripSuggestion = {
  preparations: HistoricalDripPreparation[];
  doses: HistoricalDripDose[];
};

export const POPULAR_DRIP_MEDICATIONS = [
  "Propofol",
  "Cisatracurium",
  "Atracurium",
  "Hydrocortisone",
  "Norepinephrine",
  "Dexmedetomidine",
  "Nicardipine",
  "Rocuronium",
] as const;

// Observed NIT Innovian patterns from 2024-01-02 through 2026-06-26.
// These are optional entry shortcuts, never prescribing defaults.
const HISTORICAL_DRIP_SUGGESTIONS: Record<string, HistoricalDripSuggestion> = {
  propofol: {
    preparations: [
      { amount: 500, amountUnit: "mg", carrier: null, totalVolumeMl: 50 },
      { amount: 200, amountUnit: "mg", carrier: "0.9% NaCl", totalVolumeMl: 100 },
    ],
    doses: [
      { value: 50, unit: "mcg/kg/min" },
      { value: 100, unit: "mcg/kg/min" },
      { value: 30, unit: "mcg/kg/min" },
    ],
  },
  cisatracurium: {
    preparations: [
      { amount: 20, amountUnit: "mg", carrier: "0.9% NaCl", totalVolumeMl: 20 },
      { amount: 10, amountUnit: "mg", carrier: "0.9% NaCl", totalVolumeMl: 10 },
    ],
    doses: [{ value: 0.1, unit: "mg/kg/hr" }],
  },
  atracurium: {
    preparations: [
      { amount: 100, amountUnit: "mg", carrier: "0.9% NaCl", totalVolumeMl: 20 },
      { amount: 50, amountUnit: "mg", carrier: "0.9% NaCl", totalVolumeMl: 10 },
    ],
    doses: [{ value: 0.4, unit: "mg/kg/hr" }],
  },
  hydrocortisone: {
    preparations: [
      { amount: 200, amountUnit: "mg", carrier: "0.9% NaCl", totalVolumeMl: 500 },
      { amount: 200, amountUnit: "mg", carrier: "5% D/W", totalVolumeMl: 500 },
    ],
    doses: [{ value: 8, unit: "mg/hr" }],
  },
  norepinephrine: {
    preparations: [
      { amount: 4, amountUnit: "mg", carrier: "5% D/W", totalVolumeMl: 100 },
      { amount: 4, amountUnit: "mg", carrier: "0.9% NaCl", totalVolumeMl: 100 },
    ],
    doses: [
      { value: 0.05, unit: "mcg/kg/min" },
      { value: 0.1, unit: "mcg/kg/min" },
      { value: 0.02, unit: "mcg/kg/min" },
    ],
  },
  dexmedetomidine: {
    preparations: [
      { amount: 200, amountUnit: "mcg", carrier: "0.9% NaCl", totalVolumeMl: 100 },
      { amount: 200, amountUnit: "mcg", carrier: "0.9% NaCl", totalVolumeMl: 50 },
    ],
    doses: [
      { value: 0.5, unit: "mcg/kg/hr" },
      { value: 0.3, unit: "mcg/kg/hr" },
      { value: 0.2, unit: "mcg/kg/hr" },
    ],
  },
  nicardipine: {
    preparations: [
      { amount: 20, amountUnit: "mg", carrier: "0.9% NaCl", totalVolumeMl: 100 },
      { amount: 100, amountUnit: "mg", carrier: "0.9% NaCl", totalVolumeMl: 500 },
    ],
    doses: [
      { value: 1, unit: "mg/hr" },
      { value: 2, unit: "mg/hr" },
      { value: 3, unit: "mg/hr" },
    ],
  },
  rocuronium: {
    preparations: [
      { amount: 100, amountUnit: "mg", carrier: "0.9% NaCl", totalVolumeMl: 20 },
      { amount: 50, amountUnit: "mg", carrier: "0.9% NaCl", totalVolumeMl: 10 },
    ],
    doses: [{ value: 0.4, unit: "mg/kg/hr" }],
  },
};

function token(value: unknown): string {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

export function getHistoricalDripSuggestion(
  medicationName: unknown,
): HistoricalDripSuggestion | null {
  const medicationToken = token(medicationName);
  if (!medicationToken) return null;
  const match = Object.entries(HISTORICAL_DRIP_SUGGESTIONS).find(
    ([name]) => medicationToken === name || medicationToken.startsWith(name),
  );
  return match?.[1] || null;
}
