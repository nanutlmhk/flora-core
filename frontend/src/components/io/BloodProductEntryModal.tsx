import { useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import type { CaseIoItem } from "../../api/caseIoApi";
import ClinicalReferenceTooltip from "../common/ClinicalReferenceTooltip";
import IoSpriteIcon from "./IoSpriteIcon";

const BLOOD_GROUP_OPTIONS = ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"] as const;
const ARCHIVE_POPULAR_PRODUCTS = ["LPRC", "FFP", "LPPC", "Platelet", "PRC", "Cryoprecipitate"];

type Props = {
  patientContext: ReactNode;
  items: CaseIoItem[];
  selectedItemId: number | null;
  search: string;
  date: string;
  time: string;
  volumeMl: string;
  bloodGroup: string;
  bagNumber: string;
  note: string;
  saving: boolean;
  error?: string;
  bloodGroupRequired?: boolean;
  onClose: () => void;
  onSave: () => void;
  onSelectItem: (item: CaseIoItem) => void;
  onSearchChange: (value: string) => void;
  onDateChange: (value: string) => void;
  onDateBlur: (value: string) => void;
  onTimeChange: (value: string) => void;
  onTimeBlur: (value: string) => void;
  onVolumeChange: (value: string) => void;
  onBloodGroupChange: (value: string) => void;
  onBagNumberChange: (value: string) => void;
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

export default function BloodProductEntryModal({
  patientContext,
  items,
  selectedItemId,
  search,
  date,
  time,
  volumeMl,
  bloodGroup,
  bagNumber,
  note,
  saving,
  error,
  bloodGroupRequired = false,
  onClose,
  onSave,
  onSelectItem,
  onSearchChange,
  onDateChange,
  onDateBlur,
  onTimeChange,
  onTimeBlur,
  onVolumeChange,
  onBloodGroupChange,
  onBagNumberChange,
  onNoteChange,
}: Props) {
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const volumeRef = useRef<HTMLInputElement | null>(null);
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
    for (const archivedName of ARCHIVE_POPULAR_PRODUCTS) {
      const archivedKey = normalize(archivedName);
      const match = sortedItems.find(item => {
        const itemKey = normalize(`${item.code} ${item.name}`);
        return !selected.includes(item) && itemKey.includes(archivedKey);
      });
      if (match) selected.push(match);
    }
    for (const item of sortedItems) {
      if (selected.length >= 6) break;
      if (!selected.includes(item)) selected.push(item);
    }
    return selected;
  }, [sortedItems]);
  const filteredItems = useMemo(
    () => query.length < 2
      ? []
      : sortedItems.filter(item => normalize(item.name).includes(query) || normalize(item.code).includes(query)).slice(0, 12),
    [query, sortedItems],
  );

  const selectItem = (item: CaseIoItem) => {
    setSearchOpen(false);
    onSelectItem(item);
    window.setTimeout(() => {
      volumeRef.current?.focus();
      volumeRef.current?.select();
    }, 0);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (saving) return;
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onClose();
      return;
    }
    if (event.key !== "Enter" || event.shiftKey || dropdownOpen) return;
    if ((event.target as HTMLElement | null)?.tagName === "BUTTON") return;
    event.preventDefault();
    event.stopPropagation();
    onSave();
  };

  return (
    <div className="app-theme-scope io-modal-backdrop" onMouseDown={onClose}>
      <div
        className="io-modal w-full max-w-2xl space-y-3 p-4"
        role="dialog"
        aria-modal="true"
        aria-labelledby="blood-product-entry-title"
        onMouseDown={event => event.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        <header className="flex items-start justify-between gap-4 border-b border-[var(--app-border)] pb-3">
          <div className="flex min-w-0 items-center gap-4">
            <span className="grid h-12 w-12 shrink-0 place-items-center overflow-hidden rounded-xl bg-[#E05252]/15">
              <IoSpriteIcon name="bloodProduct" size={42} />
            </span>
            <div className="min-w-0">
              <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-[var(--app-muted)]">Record blood product</div>
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <h2 id="blood-product-entry-title" className="break-words text-2xl font-bold leading-tight text-[var(--app-text)]">
                  {selectedItem?.name || "Select product"}
                </h2>
                <span className="rounded-md bg-[#E05252]/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.08em] text-[#C63F3F] dark:text-[#FF9A9A]">
                  Blood
                </span>
              </div>
              <div className="mt-0.5 text-xs text-[var(--app-muted)]">Manual administration record</div>
            </div>
          </div>
          <ClinicalReferenceTooltip text="Close" compact className="flex shrink-0">
            <button type="button" aria-label="Close blood product entry" onClick={onClose} disabled={saving} className="grid h-10 w-10 place-items-center rounded-xl border border-[var(--app-border)] text-xl leading-none text-[var(--app-muted)] hover:bg-[var(--app-hover-bg)] hover:text-[var(--app-text)] disabled:opacity-50">×</button>
          </ClinicalReferenceTooltip>
        </header>

        {patientContext}

        {!selectedItem && popularItems.length > 0 ? (
          <div className="grid grid-cols-[90px_1fr] items-start gap-2">
            <span className="pt-2 text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--app-muted)]">Popular</span>
            <div className="flex flex-wrap gap-2">
              {popularItems.map(item => (
                <button key={`popular-blood-${item.id}`} type="button" onClick={() => selectItem(item)} className="rounded-lg border border-[var(--app-border)] bg-[var(--app-panel-bg)] px-3 py-1.5 text-xs font-semibold text-[var(--app-text)] hover:bg-[var(--app-hover-bg)]">
                  {item.name}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        <div className="relative" onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setSearchOpen(false); }}>
          <input
            autoFocus={!selectedItem}
            className="w-full rounded border px-3 py-2 text-sm"
            placeholder="Search blood product..."
            value={search}
            onChange={event => { onSearchChange(event.target.value); setSearchOpen(true); }}
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
                  key={`blood-option-${item.id}`}
                  type="button"
                  ref={element => { optionRefs.current[index] = element; }}
                  className="w-full border-b border-[var(--app-border)] px-3 py-2 text-left hover:bg-[var(--app-hover-bg)] last:border-0"
                  onClick={() => selectItem(item)}
                  onKeyDown={event => {
                    if (event.key === "ArrowDown") { event.preventDefault(); optionRefs.current[Math.min(index + 1, filteredItems.length - 1)]?.focus(); }
                    else if (event.key === "ArrowUp") { event.preventDefault(); if (index === 0) (event.currentTarget.closest(".relative")?.querySelector("input") as HTMLInputElement | null)?.focus(); else optionRefs.current[index - 1]?.focus(); }
                    else if (event.key === "Enter" || (event.key === "Tab" && !event.shiftKey)) { event.preventDefault(); selectItem(item); }
                  }}
                >
                  <div className="text-sm font-semibold text-[var(--app-text)]">{item.name}</div>
                  <div className="text-xs text-[var(--app-muted)]">{item.code || "Blood product"} · mL</div>
                </button>
              )) : <div className="p-3 text-sm italic text-[var(--app-muted)]">No blood products found</div>}
            </div>
          ) : null}
        </div>

        <section className="space-y-3">
          <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--app-muted)]">Administration</div>
          <label className="block space-y-1 text-xs font-semibold text-[var(--app-muted)]">
            <span>Volume</span>
            <div className="grid grid-cols-[minmax(0,1fr)_100px] gap-2">
              <input ref={volumeRef} autoFocus={Boolean(selectedItem)} type="number" min="0" step="0.01" className="min-w-0 rounded border px-3 py-2 text-lg font-semibold tabular-nums text-[var(--app-text)]" value={volumeMl} onChange={event => onVolumeChange(event.target.value)} placeholder="0" />
              <div className="grid place-items-center rounded-lg border border-[var(--app-border)] bg-[var(--app-control-bg)] text-sm font-semibold text-[var(--app-text)]">mL</div>
            </div>
          </label>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="space-y-1 text-xs font-semibold text-[var(--app-muted)]">
              <span>Bag number</span>
              <input className="w-full rounded border px-3 py-2 text-sm" value={bagNumber} onChange={event => onBagNumberChange(event.target.value)} placeholder="Required" />
            </label>
            <label className="space-y-1 text-xs font-semibold text-[var(--app-muted)]">
              <span>Blood group{bloodGroupRequired ? " *" : ""}</span>
              <select className="w-full rounded border px-3 py-2 text-sm" value={bloodGroup} onChange={event => onBloodGroupChange(event.target.value)}>
                <option value="">{bloodGroupRequired ? "Select group" : "Optional"}</option>
                {BLOOD_GROUP_OPTIONS.map(group => <option key={group} value={group}>{group}</option>)}
              </select>
            </label>
          </div>
        </section>

        <section className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="space-y-1 text-xs font-semibold text-[var(--app-muted)]"><span>Date</span><input className="w-full rounded border px-3 py-2 text-sm" value={date} onChange={event => onDateChange(event.target.value)} onBlur={event => onDateBlur(event.target.value)} placeholder="dd/mm/yyyy" /></label>
          <label className="space-y-1 text-xs font-semibold text-[var(--app-muted)]"><span>Time</span><input className="w-full rounded border px-3 py-2 text-sm" value={time} onChange={event => onTimeChange(event.target.value)} onBlur={event => onTimeBlur(event.target.value)} placeholder="HH:mm" /></label>
        </section>

        <label className="block space-y-1 text-xs font-semibold text-[var(--app-muted)]"><span>Note</span><input className="w-full rounded border px-3 py-2 text-sm" value={note} onChange={event => onNoteChange(event.target.value)} placeholder="Optional note" /></label>

        {error ? <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-600 dark:text-red-300">{error}</div> : null}

        <footer className="flex flex-col gap-3 border-t border-[var(--app-border)] pt-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="text-xs text-[var(--app-muted)]">Enter to record · Esc to close</div>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={onClose} disabled={saving} className="rounded-lg border border-[var(--app-border)] px-4 py-2 text-sm font-semibold hover:bg-[var(--app-hover-bg)] disabled:opacity-50">Cancel</button>
            <button type="button" onClick={onSave} disabled={saving} className="rounded-lg bg-[#E05252] px-4 py-2 text-sm font-bold text-white hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-50">{saving ? "Saving..." : "Record product"}</button>
          </div>
        </footer>
      </div>
    </div>
  );
}
