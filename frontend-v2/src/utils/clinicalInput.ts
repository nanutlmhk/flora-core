export function formatDateInputDDMMYYYY(raw: string): string {
  const value = String(raw ?? "").trim();
  if (!value) return "";

  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(value);
  if (iso) {
    const yyyy = iso[1];
    const mm = iso[2].padStart(2, "0").slice(0, 2);
    const dd = iso[3].padStart(2, "0").slice(0, 2);
    return `${dd}/${mm}/${yyyy}`;
  }

  if (value.includes("/")) {
    const parts = value
      .replace(/[^\d/]/g, "")
      .split("/")
      .slice(0, 3);
    const day = (parts[0] || "").slice(0, 2);
    const month = (parts[1] || "").slice(0, 2);
    const year = (parts[2] || "").slice(0, 4);
    return [day, month, year].join("/").replace(/\/+$/, match => (match.length > 1 ? "/" : match));
  }

  const digits = value.replace(/\D/g, "").slice(0, 8);
  if (digits.length <= 2) return digits;
  if (digits.length <= 4) return `${digits.slice(0, 2)}/${digits.slice(2)}`;
  return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
}

export function normalizeDateInputDDMMYYYY(raw: string): string | null {
  const formatted = formatDateInputDDMMYYYY(raw);
  const match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(formatted);
  if (!match) return null;

  const dd = Number(match[1]);
  const mm = Number(match[2]);
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

export function formatTimeInputHHMM(raw: string): string {
  const value = String(raw ?? "").trim();
  if (!value) return "";

  if (value.includes(":")) {
    const parts = value.replace(/[^\d:]/g, "").split(":").slice(0, 2);
    const hh = (parts[0] || "").slice(0, 2);
    const mm = (parts[1] || "").slice(0, 2);
    return [hh, mm].join(":");
  }

  const digits = value.replace(/\D/g, "").slice(0, 4);
  if (digits.length <= 2) return digits;
  if (digits.length === 3) return `${digits.slice(0, 1)}:${digits.slice(1)}`;
  return `${digits.slice(0, 2)}:${digits.slice(2)}`;
}

export function normalizeTimeInputHHMM(raw: string): string | null {
  const formatted = formatTimeInputHHMM(raw);
  const match = /^(\d{1,2}):(\d{1,2})$/.exec(formatted);
  if (!match) return null;

  const hh = Number(match[1]);
  const mm = Number(match[2]);
  if (!Number.isFinite(hh) || !Number.isFinite(mm) || hh < 0 || hh > 23 || mm < 0 || mm > 59) {
    return null;
  }

  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}
