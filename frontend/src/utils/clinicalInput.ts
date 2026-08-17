/**
 * onChange handler — sanitize only, never auto-insert separators.
 * Handles ISO date strings from native date pickers (yyyy-mm-dd).
 */
export function formatDateInputDDMMYYYY(raw: string): string {
  const value = String(raw ?? "").trim();
  if (!value) return "";

  // ISO date from native date pickers → convert once to dd/mm/yyyy
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(value);
  if (iso) {
    const yyyy = iso[1];
    const mm = String(iso[2]).padStart(2, "0").slice(0, 2);
    const dd = String(iso[3]).padStart(2, "0").slice(0, 2);
    return `${dd}/${mm}/${yyyy}`;
  }

  // User typed slashes — re-format each part but don't add missing slashes
  if (value.includes("/")) {
    const parts = value.replace(/[^\d/]/g, "").split("/").slice(0, 3);
    const day   = (parts[0] ?? "").slice(0, 2);
    const month = (parts[1] ?? "").slice(0, 2);
    const year  = (parts[2] ?? "").slice(0, 4);
    // Preserve trailing slash so user can keep typing
    const joined = [day, month, year].filter((_, i) => i < parts.length).join("/");
    return joined;
  }

  // No slash yet — just strip non-digits, no auto-insert
  return value.replace(/\D/g, "").slice(0, 8);
}

/**
 * onBlur handler — parse digit-only or slash-separated input, validate, return
 * canonical dd/mm/yyyy or null.
 */
export function normalizeDateInputDDMMYYYY(raw: string): string | null {
  const trimmed = String(raw ?? "").trim();
  if (!trimmed) return null;

  let formatted: string;
  if (!trimmed.includes("/")) {
    const digits = trimmed.replace(/\D/g, "");
    if (digits.length === 8) {
      // DDMMYYYY
      formatted = `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
    } else if (digits.length === 6) {
      // DDMMYY → assume 2000s
      formatted = `${digits.slice(0, 2)}/${digits.slice(2, 4)}/20${digits.slice(4)}`;
    } else {
      return null;
    }
  } else {
    formatted = formatDateInputDDMMYYYY(trimmed);
  }

  const match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(formatted);
  if (!match) return null;

  const dd   = Number(match[1]);
  const mm   = Number(match[2]);
  const yyyy = Number(match[3]);

  if (
    !Number.isFinite(dd) ||
    !Number.isFinite(mm) ||
    !Number.isFinite(yyyy) ||
    yyyy < 1900 ||
    yyyy > 3000
  ) {
    return null;
  }

  const dt = new Date(yyyy, mm - 1, dd);
  if (
    dt.getFullYear() !== yyyy ||
    dt.getMonth() !== mm - 1 ||
    dt.getDate() !== dd
  ) {
    return null;
  }

  return `${String(dd).padStart(2, "0")}/${String(mm).padStart(2, "0")}/${yyyy}`;
}

/**
 * onChange handler — sanitize only, never auto-insert ":".
 */
export function formatTimeInputHHMM(raw: string): string {
  const value = String(raw ?? "").trim();
  if (!value) return "";

  if (value.includes(":")) {
    const parts = value.replace(/[^\d:]/g, "").split(":").slice(0, 2);
    const hh = (parts[0] ?? "").slice(0, 2);
    const mm = (parts[1] ?? "").slice(0, 2);
    // Preserve trailing colon so user can keep typing after it
    return hh + (parts.length > 1 ? ":" + mm : "");
  }

  // No colon typed yet — just strip non-digits, no auto-insert
  return value.replace(/\D/g, "").slice(0, 4);
}

/**
 * onBlur handler — parse digit-only or colon-separated input (24hr), validate,
 * return canonical HH:mm or null.
 *
 *   "1603"  → "16:03"
 *   "343"   → "03:43"
 *   "9"     → "09:00"
 *   "16:3"  → "16:03"
 */
export function normalizeTimeInputHHMM(raw: string): string | null {
  const trimmed = String(raw ?? "").trim();
  if (!trimmed) return null;

  let hh: number;
  let mm: number;

  if (trimmed.includes(":")) {
    const formatted = formatTimeInputHHMM(trimmed);
    const match = /^(\d{1,2}):(\d{0,2})$/.exec(formatted);
    if (!match) return null;
    hh = Number(match[1]);
    mm = match[2] ? Number(match[2]) : 0;
  } else {
    const digits = trimmed.replace(/\D/g, "");
    if (digits.length === 4) {
      hh = Number(digits.slice(0, 2));
      mm = Number(digits.slice(2));
    } else if (digits.length === 3) {
      hh = Number(digits.slice(0, 1));
      mm = Number(digits.slice(1));
    } else if (digits.length <= 2) {
      hh = Number(digits);
      mm = 0;
    } else {
      return null;
    }
  }

  if (
    !Number.isFinite(hh) ||
    !Number.isFinite(mm) ||
    hh < 0 || hh > 23 ||
    mm < 0 || mm > 59
  ) {
    return null;
  }

  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}
