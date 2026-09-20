export type HistoricalBolusSuggestion = {
  unit: string;
  doses: number[];
};

// Common positive bolus records in the NIT Innovian archive, 2024–2026.
// These are entry shortcuts, not prescribing defaults.
export const HISTORICAL_BOLUS_SUGGESTIONS: Record<string, HistoricalBolusSuggestion> = {
  fentanyl: { unit: "mcg", doses: [25, 50, 100] },
  propofol: { unit: "mg", doses: [20, 30, 50, 100] },
  midazolam: { unit: "mg", doses: [1, 2] },
  cisatracurium: { unit: "mg", doses: [2, 10] },
  atracurium: { unit: "mg", doses: [10, 40, 50] },
  rocuronium: { unit: "mg", doses: [10, 40, 50] },
  ephedrine: { unit: "mg", doses: [3, 6] },
  phenylephrine: { unit: "mcg", doses: [50, 100] },
  atropine: { unit: "mg", doses: [0.3, 0.6, 1.2] },
  cefazolin: { unit: "g", doses: [1, 2] },
};

export function getHistoricalBolusSuggestion(name: unknown): HistoricalBolusSuggestion | null {
  const token = String(name || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
  if (!token) return null;
  const match = Object.entries(HISTORICAL_BOLUS_SUGGESTIONS).find(
    ([medication]) => token === medication || token.startsWith(medication),
  );
  return match?.[1] || null;
}
