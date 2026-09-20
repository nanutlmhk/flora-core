import type { KeyboardEventHandler, ReactNode } from "react";
import ClinicalReferenceTooltip from "../common/ClinicalReferenceTooltip";
import IoSpriteIcon from "./IoSpriteIcon";
import type { HistoricalBolusSuggestion } from "../../utils/medicationBolus";

type Props = {
  patientContext: ReactNode;
  medicationName: string;
  date: string;
  time: string;
  doseValue: string;
  doseUnit: string;
  note: string;
  suggestion?: HistoricalBolusSuggestion | null;
  localAnesthetic?: {
    route: string;
    routes: readonly string[];
    concentration: string;
    volumeMl: string;
    onRouteChange: (value: string) => void;
    onConcentrationChange: (value: string) => void;
    onVolumeChange: (value: string) => void;
  } | null;
  saving: boolean;
  clearDisabled?: boolean;
  error?: string;
  saveLabel: string;
  onDateChange: (value: string) => void;
  onDateBlur: (value: string) => void;
  onTimeChange: (value: string) => void;
  onTimeBlur: (value: string) => void;
  onDoseChange: (value: string) => void;
  onDoseUnitChange: (value: string) => void;
  onNoteChange: (value: string) => void;
  onClose: () => void;
  onClear: () => void;
  onSave: () => void;
  onKeyDown: KeyboardEventHandler<HTMLDivElement>;
};

export default function MedicationBolusEntryModal({
  patientContext,
  medicationName,
  date,
  time,
  doseValue,
  doseUnit,
  note,
  suggestion,
  localAnesthetic,
  saving,
  clearDisabled = false,
  error,
  saveLabel,
  onDateChange,
  onDateBlur,
  onTimeChange,
  onTimeBlur,
  onDoseChange,
  onDoseUnitChange,
  onNoteChange,
  onClose,
  onClear,
  onSave,
  onKeyDown,
}: Props) {
  return (
    <div className="app-theme-scope io-modal-backdrop" onMouseDown={onClose}>
      <section
        className="io-modal w-full max-w-2xl space-y-3 p-4"
        role="dialog"
        aria-modal="true"
        aria-label={`Record ${medicationName} bolus`}
        onMouseDown={event => event.stopPropagation()}
        onKeyDown={onKeyDown}
      >
        <header className="flex items-start justify-between gap-4 border-b border-[var(--app-border)] pb-3">
          <div className="flex min-w-0 items-center gap-5">
            <span className="mr-2 grid h-12 w-12 shrink-0 place-items-center overflow-hidden rounded-xl bg-[var(--timegrid-focus-bg)]">
              <IoSpriteIcon name="medBolus" size={42} />
            </span>
            <div className="min-w-0">
              <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-[var(--app-muted)]">Record medication</div>
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <h2 className="break-words text-2xl font-bold leading-tight text-[var(--app-text)]">{medicationName}</h2>
                <span className="rounded-md bg-[#5B8FF9]/20 px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.08em] text-[#77A5FF]">Bolus</span>
              </div>
              <div className="mt-0.5 text-xs text-[var(--app-muted)]">One-time dose</div>
            </div>
          </div>
          <ClinicalReferenceTooltip text="Close" compact className="flex shrink-0">
            <button
              type="button"
              aria-label="Close medication bolus"
              onClick={onClose}
              disabled={saving}
              className="grid h-10 w-10 place-items-center rounded-xl border border-[var(--app-border)] text-xl leading-none text-[var(--app-muted)] hover:bg-[var(--app-hover-bg)] hover:text-[var(--app-text)] disabled:opacity-50"
            >
              ×
            </button>
          </ClinicalReferenceTooltip>
        </header>

        {patientContext}

        <div className="space-y-3 py-2">
          <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--app-muted)]">Administration</div>
          <div className="grid grid-cols-[100px_1fr_120px] items-center gap-2">
            <label className="text-sm font-medium text-[var(--app-muted)]">Time</label>
            <input value={date} onChange={event => onDateChange(event.target.value)} onBlur={event => onDateBlur(event.target.value)} className="rounded border border-[var(--app-border)] bg-[var(--app-control-bg)] px-3 py-2 text-sm tabular-nums" placeholder="dd/mm/yyyy" />
            <input value={time} onChange={event => onTimeChange(event.target.value)} onBlur={event => onTimeBlur(event.target.value)} className="rounded border border-[var(--app-border)] bg-[var(--app-control-bg)] px-3 py-2 text-sm tabular-nums" placeholder="HH:mm" maxLength={5} />
          </div>

          {localAnesthetic ? (
            <>
              <div className="grid grid-cols-[100px_1fr] items-center gap-2">
                <label className="text-sm font-medium text-[var(--app-muted)]">Route</label>
                <select className="rounded border border-[var(--app-border)] bg-[var(--app-control-bg)] px-3 py-2 text-sm" value={localAnesthetic.route} onChange={event => localAnesthetic.onRouteChange(event.target.value)}>
                  {localAnesthetic.routes.map(route => <option key={route} value={route}>{route}</option>)}
                </select>
              </div>
              <div className="grid grid-cols-[100px_1fr_110px] items-center gap-2">
                <label className="text-sm font-medium text-[var(--app-muted)]">Conc. %</label>
                <input type="number" min="0" step="0.01" autoFocus className="rounded border border-[var(--app-border)] bg-[var(--app-control-bg)] px-3 py-2 text-lg font-semibold tabular-nums" value={localAnesthetic.concentration} onChange={event => localAnesthetic.onConcentrationChange(event.target.value)} placeholder="0" />
                <div className="grid self-stretch place-items-center rounded border border-[var(--app-border)] bg-[var(--app-control-bg)] px-2 text-sm font-semibold">mg/mL</div>
              </div>
              <div className="grid grid-cols-[100px_1fr_110px] items-center gap-2">
                <label className="text-sm font-medium text-[var(--app-muted)]">Volume</label>
                <input type="number" min="0" step="0.01" className="rounded border border-[var(--app-border)] bg-[var(--app-control-bg)] px-3 py-2 text-lg font-semibold tabular-nums" value={localAnesthetic.volumeMl} onChange={event => localAnesthetic.onVolumeChange(event.target.value)} placeholder="0" />
                <div className="grid self-stretch place-items-center rounded border border-[var(--app-border)] bg-[var(--app-control-bg)] px-2 text-sm font-semibold">mL</div>
              </div>
            </>
          ) : (
            <>
              <div className="grid grid-cols-[100px_1fr] items-center gap-2">
                <label className="text-sm font-medium text-[var(--app-muted)]">Dose</label>
                <div className="flex items-stretch gap-2">
                  <input type="number" min="0" step="0.01" autoFocus className="min-w-0 flex-1 rounded border border-[var(--app-border)] bg-[var(--app-control-bg)] px-3 py-2 text-lg font-semibold tabular-nums" value={doseValue} onChange={event => onDoseChange(event.target.value)} placeholder="0.00" />
                  <div className="grid min-w-[92px] place-items-center rounded border border-[var(--app-border)] bg-[var(--app-control-bg)] px-3 text-sm font-semibold">{doseUnit || "unit"}</div>
                </div>
              </div>
              {suggestion ? (
                <div className="grid grid-cols-[100px_1fr] items-center gap-2">
                  <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--app-muted)]">Suggestion</span>
                  <div className="flex flex-wrap gap-2">
                    {suggestion.doses.map(dose => {
                      const selected = Number(doseValue) === dose && doseUnit === suggestion.unit;
                      return (
                        <button
                          key={`${dose}-${suggestion.unit}`}
                          type="button"
                          aria-pressed={selected}
                          onClick={() => { onDoseChange(String(dose)); onDoseUnitChange(suggestion.unit); }}
                          className={`min-h-8 rounded-lg border px-3 py-1 text-xs font-bold tabular-nums ${selected ? "border-[var(--app-accent)] bg-[var(--app-accent)] text-[var(--app-accent-contrast)]" : "border-[var(--app-border)] bg-[var(--app-panel-bg)] text-[var(--app-text)] hover:bg-[var(--app-hover-bg)]"}`}
                        >
                          {dose} {suggestion.unit}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ) : null}
            </>
          )}

          <div className="grid grid-cols-[100px_1fr] items-center gap-2">
            <label className="text-sm font-medium text-[var(--app-muted)]">Note</label>
            <input className="rounded border border-[var(--app-border)] bg-[var(--app-control-bg)] px-3 py-2 text-sm" value={note} onChange={event => onNoteChange(event.target.value)} placeholder="Optional note" />
          </div>
        </div>

        {error ? <div className="case-modal__error">{error}</div> : null}

        <footer className="flex items-center justify-between gap-3 border-t border-[var(--app-border)] pt-3">
          <div className="text-xs text-[var(--app-muted)]">Enter to record · Esc to close</div>
          <div className="flex shrink-0 gap-2">
            <button type="button" onClick={onClose} disabled={saving} className="rounded-lg border border-[var(--app-border)] px-4 py-2 text-sm font-semibold hover:bg-[var(--app-hover-bg)] disabled:opacity-50">Cancel</button>
            <button type="button" onClick={onClear} disabled={saving || clearDisabled} className="rounded-lg border border-[var(--app-border)] px-4 py-2 text-sm font-semibold hover:bg-[var(--app-hover-bg)] disabled:opacity-50">Clear</button>
            <button type="button" onClick={onSave} disabled={saving} className="rounded-lg bg-[var(--app-accent)] px-4 py-2 text-sm font-semibold text-[var(--app-accent-contrast)] hover:brightness-105 disabled:opacity-50">{saving ? "Saving…" : saveLabel}</button>
          </div>
        </footer>
      </section>
    </div>
  );
}
