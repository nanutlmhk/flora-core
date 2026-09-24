import { useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import type { CaseIoItem } from "../../api/caseIoApi";
import ClinicalReferenceTooltip from "../common/ClinicalReferenceTooltip";
import IoSpriteIcon from "./IoSpriteIcon";

export type FluidEntryMode = "bolus" | "drip";

type Props = {
  patientContext: ReactNode;
  items: CaseIoItem[];
  selectedItemId: number | null;
  search: string;
  mode: FluidEntryMode;
  volumeMl: string;
  rateMlHr: string;
  date: string;
  time: string;
  note: string;
  saving: boolean;
  error?: string;
  editing?: boolean;
  onClose: () => void;
  onSave: () => void;
  onSelectItem: (item: CaseIoItem) => void;
  onSearchChange: (value: string) => void;
  onModeChange: (mode: FluidEntryMode) => void;
  onVolumeChange: (value: string) => void;
  onRateChange: (value: string) => void;
  onDateChange: (value: string) => void;
  onDateBlur: (value: string) => void;
  onTimeChange: (value: string) => void;
  onTimeBlur: (value: string) => void;
  onNoteChange: (value: string) => void;
};

function normalize(value: unknown) {
  return String(value || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function usageRank(item: CaseIoItem) {
  const value = Number(item.usage_rank);
  return Number.isFinite(value) && value > 0 ? value : Number.MAX_SAFE_INTEGER;
}

function usageScore(item: CaseIoItem) {
  const value = Number(item.usage_score);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

// Ranked from Innovian fluid records dated 2024-01-01 through 2026-12-31.
const ARCHIVE_POPULAR_FLUIDS: Record<FluidEntryMode, string[]> = {
  bolus: ["0.9% NSS", "5% D/N/2", "5% D/NSS", "5% D/N/3", "Acetar", "6% Volulyte"],
  drip: ["0.9% NSS", "Acetar", "Sterofundin", "20% Mannitol", "Voluven", "5% D/N/2"],
};

const ARCHIVE_BOLUS_VOLUMES: Array<[string, number[]]> = [
  ["09nss", [500, 700, 800, 600]],
  ["5dn2", [700, 800, 750, 600]],
  ["5dnss", [800, 700, 500, 400]],
  ["5dn3", [300, 350, 400, 250]],
  ["acetar", [900, 600, 100, 800]],
  ["6volulyte", [500, 250, 600, 50]],
  ["sterofundin", [800, 200, 900, 1000]],
  ["voluven", [500, 100]],
];

const ARCHIVE_DRIP_RATES: Array<[string, number[]]> = [
  ["09nss", [80, 60, 40, 100]],
  ["5dn2", [60, 80, 40, 20]],
  ["acetar", [80, 100, 20, 40]],
  ["sterofundin", [40, 60, 20, 50]],
  ["6volulyte", [20, 30, 45, 55]],
  ["voluven", [30, 200]],
];

function archivedValues(name: string | undefined, rows: Array<[string, number[]]>, fallback: number[]) {
  const key = normalize(name);
  return rows.find(([alias]) => key.includes(alias))?.[1] || fallback;
}

export default function FluidEntryModal({
  patientContext,
  items,
  selectedItemId,
  search,
  mode,
  volumeMl,
  rateMlHr,
  date,
  time,
  note,
  saving,
  error,
  editing = false,
  onClose,
  onSave,
  onSelectItem,
  onSearchChange,
  onModeChange,
  onVolumeChange,
  onRateChange,
  onDateChange,
  onDateBlur,
  onTimeChange,
  onTimeBlur,
  onNoteChange,
}: Props) {
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const firstValueRef = useRef<HTMLInputElement | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const selectedItem = items.find(item => item.id === selectedItemId) || null;
  const query = normalize(search);
  const dropdownOpen = searchOpen && !selectedItem && query.length >= 2;
  const sortedItems = useMemo(
    () => [...items].sort((a, b) => usageRank(a) - usageRank(b) || usageScore(b) - usageScore(a) || a.name.localeCompare(b.name)),
    [items],
  );
  const popularItems = useMemo(() => {
    const selected: CaseIoItem[] = [];
    for (const archivedName of ARCHIVE_POPULAR_FLUIDS[mode]) {
      const archivedKey = normalize(archivedName);
      const match = sortedItems.find(item => {
        const itemKey = normalize(item.name);
        return !selected.includes(item) && (itemKey === archivedKey || itemKey.includes(archivedKey) || archivedKey.includes(itemKey));
      });
      if (match) selected.push(match);
    }
    for (const item of sortedItems) {
      if (selected.length >= 6) break;
      if (!selected.includes(item)) selected.push(item);
    }
    return selected;
  }, [mode, sortedItems]);
  const filteredItems = useMemo(
    () => query.length < 2
      ? []
      : sortedItems
          .filter(item => normalize(item.name).includes(query) || normalize(item.code).includes(query))
          .slice(0, 12),
    [query, sortedItems],
  );
  const volumeSuggestions = archivedValues(selectedItem?.name, ARCHIVE_BOLUS_VOLUMES, [500, 1000, 250, 100]);
  const rateSuggestions = archivedValues(selectedItem?.name, ARCHIVE_DRIP_RATES, [80, 100, 40, 60]);

  const selectItem = (item: CaseIoItem) => {
    setSearchOpen(false);
    onSelectItem(item);
    window.setTimeout(() => {
      firstValueRef.current?.focus();
      firstValueRef.current?.select();
    }, 0);
  };

  const handleRootKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (saving) return;
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onClose();
      return;
    }
    if (event.key !== "Enter" || event.shiftKey || dropdownOpen) return;
    event.preventDefault();
    event.stopPropagation();
    onSave();
  };

  const modeLabel = editing ? "Edit drip" : mode === "drip" ? "Drip" : "Bolus";
  const actionLabel = editing ? "Save changes" : mode === "drip" ? "Start drip" : "Record bolus";

  return (
    <div className="app-theme-scope io-modal-backdrop" onMouseDown={onClose}>
      <div
        className="io-modal w-full max-w-2xl space-y-3 p-4"
        role="dialog"
        aria-modal="true"
        aria-labelledby="fluid-entry-title"
        onMouseDown={event => event.stopPropagation()}
        onKeyDown={handleRootKeyDown}
      >
        <header className="flex items-start justify-between gap-4 border-b border-[var(--app-border)] pb-3">
          <div className="flex min-w-0 items-center gap-4">
            <span className="grid h-12 w-12 shrink-0 place-items-center overflow-hidden rounded-xl bg-[#39C6C8]/15">
              <IoSpriteIcon name="fluid" size={42} />
            </span>
            <div className="min-w-0">
              <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-[var(--app-muted)]">Fluid administration</div>
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <h2 id="fluid-entry-title" className="break-words text-2xl font-bold leading-tight text-[var(--app-text)]">
                  {selectedItem?.name || "Select fluid"}
                </h2>
                <span className="rounded-md bg-[#39C6C8]/20 px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.08em] text-[#25AEB1] dark:text-[#72E5E7]">
                  {modeLabel}
                </span>
              </div>
              <div className="mt-0.5 text-xs text-[var(--app-muted)]">Crystalloid or other non-blood fluid</div>
            </div>
          </div>
          <ClinicalReferenceTooltip text="Close" compact className="flex shrink-0">
            <button
              type="button"
              aria-label="Close fluid entry"
              onClick={onClose}
              disabled={saving}
              className="grid h-10 w-10 place-items-center rounded-xl border border-[var(--app-border)] text-xl leading-none text-[var(--app-muted)] hover:bg-[var(--app-hover-bg)] hover:text-[var(--app-text)] disabled:opacity-50"
            >
              ×
            </button>
          </ClinicalReferenceTooltip>
        </header>

        {patientContext}

        {!selectedItem && popularItems.length > 0 ? (
          <div className="grid grid-cols-[90px_1fr] items-start gap-2">
            <span className="pt-2 text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--app-muted)]">Popular</span>
            <div className="flex flex-wrap gap-2">
              {popularItems.map(item => (
                <button
                  key={`popular-fluid-${item.id}`}
                  type="button"
                  onClick={() => selectItem(item)}
                  className="rounded-lg border border-[var(--app-border)] bg-[var(--app-panel-bg)] px-3 py-1.5 text-xs font-semibold text-[var(--app-text)] hover:bg-[var(--app-hover-bg)]"
                >
                  {item.name}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        <div
          className="relative"
          onBlur={event => {
            if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setSearchOpen(false);
          }}
        >
          <input
            autoFocus={!selectedItem}
            className="w-full rounded border px-3 py-2 text-sm"
            placeholder="Search fluid name..."
            value={search}
            onChange={event => {
              onSearchChange(event.target.value);
              setSearchOpen(true);
            }}
            onFocus={() => { if (query.length >= 2) setSearchOpen(true); }}
            onKeyDown={event => {
              if (!dropdownOpen || filteredItems.length === 0 || (event.key !== "Enter" && (event.key !== "Tab" || event.shiftKey))) return;
              event.preventDefault();
              event.stopPropagation();
              if (event.key === "Enter" || filteredItems.length === 1) selectItem(filteredItems[0]);
              else optionRefs.current[0]?.focus();
            }}
          />
          {dropdownOpen ? (
            <div className="absolute z-20 mt-1 max-h-56 w-full overflow-y-auto rounded border border-[var(--app-border)] bg-[var(--app-panel-bg)] shadow-lg">
              {filteredItems.length > 0 ? filteredItems.map((item, index) => (
                <button
                  key={`fluid-option-${item.id}`}
                  type="button"
                  ref={element => { optionRefs.current[index] = element; }}
                  className="w-full border-b border-[var(--app-border)] px-3 py-2 text-left hover:bg-[var(--app-hover-bg)] last:border-0"
                  onClick={() => selectItem(item)}
                  onKeyDown={event => {
                    if (event.key === "ArrowDown") {
                      event.preventDefault();
                      optionRefs.current[Math.min(index + 1, filteredItems.length - 1)]?.focus();
                    } else if (event.key === "ArrowUp") {
                      event.preventDefault();
                      if (index === 0) (event.currentTarget.closest(".relative")?.querySelector("input") as HTMLInputElement | null)?.focus();
                      else optionRefs.current[index - 1]?.focus();
                    } else if (event.key === "Enter" || (event.key === "Tab" && !event.shiftKey)) {
                      event.preventDefault();
                      selectItem(item);
                    }
                  }}
                >
                  <div className="text-sm font-semibold text-[var(--app-text)]">{item.name}</div>
                  <div className="text-xs text-[var(--app-muted)]">{item.code || "Fluid"} · mL</div>
                </button>
              )) : (
                <div className="p-3 text-sm italic text-[var(--app-muted)]">No fluid matches found</div>
              )}
            </div>
          ) : null}
        </div>

        <section className="space-y-3">
          <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--app-muted)]">Administration</div>
          {!editing ? (
            <div className="grid grid-cols-2 gap-2 rounded-xl bg-[var(--app-control-bg)] p-1">
              {([
                ["bolus", "Bolus"],
                ["drip", "Drip"],
              ] as const).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={mode === value}
                  onClick={() => onModeChange(value)}
                  disabled={saving}
                  className={`rounded-lg px-2 py-2 text-xs font-semibold transition ${mode === value ? "bg-[#39C6C8] text-[#062F30] shadow-sm" : "text-[var(--app-muted)] hover:bg-[var(--app-hover-bg)] hover:text-[var(--app-text)]"}`}
                >
                  {label}
                </button>
              ))}
            </div>
          ) : null}

          {mode === "drip" || editing ? (
            <div className="space-y-3">
              {!editing ? (
                <label className="block space-y-1 text-xs font-semibold text-[var(--app-muted)]">
                  <span>Prepared volume</span>
                  <div className="grid grid-cols-[minmax(0,1fr)_100px] gap-2">
                    <input ref={firstValueRef} autoFocus={Boolean(selectedItem)} type="number" min="0" step="1" className="min-w-0 rounded border px-3 py-2 text-lg font-semibold tabular-nums text-[var(--app-text)]" value={volumeMl} onChange={event => onVolumeChange(event.target.value)} placeholder="0" />
                    <div className="grid place-items-center rounded-lg border border-[var(--app-border)] bg-[var(--app-control-bg)] text-sm font-semibold text-[var(--app-text)]">mL</div>
                  </div>
                </label>
              ) : null}
              <label className="block space-y-1 text-xs font-semibold text-[var(--app-muted)]">
                <span>{editing ? "New rate" : "Rate"}</span>
                <div className="grid grid-cols-[minmax(0,1fr)_100px] gap-2">
                  <input ref={editing ? firstValueRef : undefined} autoFocus={editing && Boolean(selectedItem)} type="number" min="0" step="1" className="min-w-0 rounded border px-3 py-2 text-lg font-semibold tabular-nums text-[var(--app-text)]" value={rateMlHr} onChange={event => onRateChange(event.target.value)} placeholder="0" />
                  <div className="grid place-items-center rounded-lg border border-[var(--app-border)] bg-[var(--app-control-bg)] text-sm font-semibold text-[var(--app-text)]">mL/hr</div>
                </div>
              </label>
            </div>
          ) : (
            <div className="grid grid-cols-[minmax(0,1fr)_100px] gap-2">
              <input ref={firstValueRef} autoFocus={Boolean(selectedItem)} type="number" min="0" step="1" className="min-w-0 rounded border px-3 py-2 text-lg font-semibold tabular-nums" value={volumeMl} onChange={event => onVolumeChange(event.target.value)} placeholder="0" />
              <div className="grid place-items-center rounded-lg border border-[var(--app-border)] bg-[var(--app-control-bg)] text-sm font-semibold">mL</div>
            </div>
          )}

          <div className="grid grid-cols-[90px_1fr] items-start gap-2">
            <span className="pt-2 text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--app-muted)]">Suggestion</span>
            <div className="flex flex-wrap gap-2">
              {mode === "bolus" && !editing ? volumeSuggestions.map(value => (
                <button key={value} type="button" onClick={() => onVolumeChange(String(value))} className="rounded-lg border border-[var(--app-border)] px-3 py-1.5 text-xs font-bold tabular-nums hover:bg-[var(--app-hover-bg)]">
                  {value} mL
                </button>
              )) : null}
              {mode === "drip" && !editing ? volumeSuggestions.map(value => (
                <button key={`volume-${value}`} type="button" onClick={() => onVolumeChange(String(value))} className="rounded-lg border border-[var(--app-border)] px-3 py-1.5 text-xs font-bold tabular-nums hover:bg-[var(--app-hover-bg)]">
                  {value} mL bag
                </button>
              )) : null}
              {(mode === "drip" || editing) ? rateSuggestions.map(value => (
                <button key={`rate-${value}`} type="button" onClick={() => onRateChange(String(value))} className="rounded-lg border border-cyan-400/35 bg-cyan-500/10 px-3 py-1.5 text-xs font-bold tabular-nums hover:bg-cyan-500/20">
                  {value} mL/hr
                </button>
              )) : null}
            </div>
          </div>
        </section>

        <section className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="space-y-1 text-xs font-semibold text-[var(--app-muted)]"><span>{editing ? "Change date" : "Start date"}</span><input className="w-full rounded border px-3 py-2 text-sm" value={date} onChange={event => onDateChange(event.target.value)} onBlur={event => onDateBlur(event.target.value)} placeholder="dd/mm/yyyy" tabIndex={-1} /></label>
          <label className="space-y-1 text-xs font-semibold text-[var(--app-muted)]"><span>{editing ? "Change time" : "Start time"}</span><input className="w-full rounded border px-3 py-2 text-sm" value={time} onChange={event => onTimeChange(event.target.value)} onBlur={event => onTimeBlur(event.target.value)} placeholder="HH:mm" /></label>
        </section>

        <label className="block space-y-1 text-xs font-semibold text-[var(--app-muted)]"><span>Note</span><input className="w-full rounded border px-3 py-2 text-sm" value={note} onChange={event => onNoteChange(event.target.value)} placeholder="Optional note" /></label>

        {error ? <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-600 dark:text-red-300">{error}</div> : null}

        <footer className="flex flex-col gap-3 border-t border-[var(--app-border)] pt-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="text-xs text-[var(--app-muted)]">Enter to record · Esc to close</div>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={onClose} disabled={saving} className="rounded-lg border border-[var(--app-border)] px-4 py-2 text-sm font-semibold hover:bg-[var(--app-hover-bg)] disabled:opacity-50">Cancel</button>
            <button type="button" onClick={onSave} disabled={saving} className="rounded-lg bg-[#39C6C8] px-4 py-2 text-sm font-bold text-[#062F30] hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-50">
              {saving ? "Saving..." : actionLabel}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
