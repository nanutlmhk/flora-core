import {
  generateLegacyArchiveReport,
  getLegacyArchiveReportOptions,
  type FleetCase,
  type LegacyReportCatalog,
} from "../api/fleetApi";
import { useEffect, useState, type ReactNode } from "react";
import PdfPreviewCanvas from "../components/report/PdfPreviewCanvas";
import { buildArchiveReportPdf } from "./canopy/archiveReportPdf";
import { groupLegacyReportFamilies } from "./canopy/legacyReportFamilies";

export type CanopyCasePanel = "chart" | "io" | "diagnosis" | "staff" | "patient" | "forms" | "report";

type Props = {
  panel: Exclude<CanopyCasePanel, "chart">;
  snapshot: Record<string, unknown>;
  entry: FleetCase;
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function rows(value: unknown): Record<string, unknown>[] {
  const source = record(value).rows;
  return Array.isArray(source) ? source.filter(item => item && typeof item === "object") as Record<string, unknown>[] : [];
}

function text(...values: unknown[]): string {
  for (const value of values) {
    if (value != null && String(value).trim()) return String(value).trim();
  }
  return "—";
}

function dateTime(value: unknown): string {
  if (value == null || value === "") return "—";
  const date = typeof value === "number" || /^\d+$/.test(String(value)) ? new Date(Number(value)) : new Date(String(value));
  return Number.isNaN(date.getTime()) ? "—" : new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function amount(value: unknown, unit: unknown): string {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? `${Math.round(numeric * 100) / 100}${unit ? ` ${unit}` : ""}` : "—";
}

function isNka(value: unknown): boolean {
  const normalized = String(value || "").replace(/[^a-z]/gi, "").toUpperCase();
  return ["NKA", "NKDA", "NOKNOWNALLERGY", "NOKNOWNALLERGIES", "NOKNOWNDRUGALLERGY"].includes(normalized);
}

function fieldValue(field: Record<string, unknown>): string {
  const value = record(field.value);
  const selected = Array.isArray(value.selected) ? value.selected.map(item => text(record(item).label, record(item).value)).filter(item => item !== "—") : [];
  if (selected.length) return selected.join(", ");
  return text(value.text, value.number, value.value, field.raw_value);
}

function fieldLabel(field: Record<string, unknown>, index: number): string {
  const position = record(field.position);
  const header = record(position.source_header);
  const choices = Array.isArray(field.choices) ? field.choices as Record<string, unknown>[] : [];
  return text(field.title, field.name, header.compTitle, header.compName, choices[0]?.label, `Field ${index + 1}`);
}

function fieldChoices(field: Record<string, unknown>) {
  const value = record(field.value);
  const choices = Array.isArray(field.choices) ? field.choices as Record<string, unknown>[] : [];
  const selected = Array.isArray(value.selected) ? value.selected as Record<string, unknown>[] : [];
  const selectedPositions = new Set(selected.map(item => Number(item.position)));
  return choices.map((choice, index) => ({
    label: text(choice.label, `Option ${index + 1}`),
    selected: selectedPositions.has(Number(choice.position)),
  }));
}

function duration(from: unknown, to: unknown): string {
  const start = new Date(String(from || "")).getTime();
  const end = new Date(String(to || "")).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return "—";
  const minutes = Math.round((end - start) / 60_000);
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

function flattenDraft(value: unknown, prefix = ""): Array<[string, string]> {
  if (value == null || value === "") return [];
  if (Array.isArray(value)) return value.flatMap((item, index) => flattenDraft(item, `${prefix}${prefix ? " · " : ""}${index + 1}`));
  if (typeof value !== "object") return [[prefix || "Value", String(value)]];
  return Object.entries(value as Record<string, unknown>).flatMap(([key, item]) => flattenDraft(item, `${prefix}${prefix ? " · " : ""}${key}`));
}

function Empty({ title, detail }: { title: string; detail: string }) {
  return <div className="rounded-2xl border border-dashed border-[var(--app-border)] px-6 py-16 text-center"><strong className="block text-lg text-[var(--app-text)]">{title}</strong><span className="mt-1 block text-sm text-[var(--app-muted)]">{detail}</span></div>;
}

function Card({ title, children }: { title: string; children: ReactNode }) {
  return <section className="rounded-2xl border border-[var(--app-border)] bg-[var(--app-panel-bg)] p-4"><h2 className="mb-3 text-xs font-extrabold uppercase tracking-[0.14em] text-[var(--app-muted)]">{title}</h2>{children}</section>;
}

export default function CanopyCaseDetailPanel({ panel, snapshot, entry }: Props) {
  const [reportBusy, setReportBusy] = useState(false);
  const [reportError, setReportError] = useState("");
  const [reportBytes, setReportBytes] = useState<Uint8Array | null>(null);
  const [reportUrl, setReportUrl] = useState("");
  const [reportFileName, setReportFileName] = useState("flora-report.pdf");
  const [reportDestinationPath, setReportDestinationPath] = useState("");
  const [reportCatalog, setReportCatalog] = useState<LegacyReportCatalog | null>(null);
  const [selectedReportSections, setSelectedReportSections] = useState<string[]>([]);
  const isInnovian = String(entry.source_system || entry.admission_source || "").toLowerCase().includes("innovian");
  const patient = record(record(snapshot.patient).row);
  const allergies = rows(snapshot.allergies);
  const diagnoses = rows(snapshot.diagnosis);
  const procedures = rows(snapshot.procedures);
  const staff = rows(snapshot.staff).filter(row => !row.source_deleted);
  const ioRuns = rows(snapshot.io_runs);
  const ioEvents = rows(snapshot.io_events);
  const forms = rows(snapshot.forms);
  const formDraft = record(snapshot.forms).draft;
  const reportFamilies = reportCatalog ? groupLegacyReportFamilies(reportCatalog) : [];

  useEffect(() => () => {
    if (reportUrl) URL.revokeObjectURL(reportUrl);
  }, [reportUrl]);

  useEffect(() => {
    if (panel !== "report" || !isInnovian) return;
    let cancelled = false;
    setReportError("");
    getLegacyArchiveReportOptions(entry.global_case_id)
      .then(catalog => {
        if (cancelled) return;
        setReportCatalog(catalog);
        setSelectedReportSections(catalog.sections.filter(section => section.default).map(section => section.id));
      })
      .catch(reason => {
        if (!cancelled) setReportError(reason instanceof Error ? reason.message : "Could not load Innovian report types.");
      });
    return () => { cancelled = true; };
  }, [entry.global_case_id, isInnovian, panel]);

  const openReportPreview = async () => {
    setReportBusy(true);
    setReportError("");
    try {
      if (isInnovian && selectedReportSections.length === 0) throw new Error("Select at least one Innovian report section.");
      const generated = isInnovian
        ? await generateLegacyArchiveReport(entry.global_case_id, selectedReportSections)
        : { bytes: await buildArchiveReportPdf(snapshot), fileName: `flora-archive-${entry.source_case_id || entry.case_code || "case"}.pdf`, destinationPath: "" };
      if (reportUrl) URL.revokeObjectURL(reportUrl);
      setReportBytes(generated.bytes);
      setReportFileName(generated.fileName);
      setReportDestinationPath(generated.destinationPath);
      setReportUrl(URL.createObjectURL(new Blob([generated.bytes.slice().buffer], { type: "application/pdf" })));
    } catch (reason) {
      setReportError(reason instanceof Error ? reason.message : "Could not generate the archive PDF.");
    } finally {
      setReportBusy(false);
    }
  };

  if (panel === "io") {
    if (!ioRuns.length) return <Empty title="No I/O records" detail="No medication, infusion, fluid, blood product, or output data is available for this case." />;
    return <div className="grid gap-4 lg:grid-cols-2">{ioRuns.map((run, index) => {
      const matching = ioEvents.filter(event => String(event.item_id) === String(run.item_id) && text(event.kind) === text(run.kind));
      const segments = Array.isArray(run.segments) ? run.segments as Record<string, unknown>[] : [];
      const total = matching.reduce((sum, event) => sum + Number(event.dose_value ?? event.volume_ml ?? 0), 0);
      return <Card key={text(run.id, index)} title={`${text(run.kind, "clinical input")} · ${text(run.entry_mode)}`}><div className="flex items-start justify-between gap-3"><div><h3 className="text-lg font-bold text-[var(--app-text)]">{text(run.item_name, run.item_code)}</h3><p className="text-sm text-[var(--app-muted)]">{text(run.item_category, run.route)}</p></div><strong className="text-right text-[var(--app-accent)]">{matching.length ? amount(total, run.item_unit) : segments.length ? `${segments.length} rate segment${segments.length === 1 ? "" : "s"}` : "Recorded"}</strong></div><div className="mt-4 grid gap-2 text-sm sm:grid-cols-2"><span className="rounded-xl bg-[var(--app-control-bg)] px-3 py-2"><b>Started</b><br />{dateTime(run.started_at)}</span><span className="rounded-xl bg-[var(--app-control-bg)] px-3 py-2"><b>Stopped</b><br />{dateTime(run.stopped_at)}</span></div>{segments.length ? <div className="mt-3 space-y-2">{segments.map((segment, segmentIndex) => <div key={segmentIndex} className="flex flex-wrap justify-between gap-2 rounded-xl border border-[var(--app-border)] px-3 py-2 text-sm"><span>{dateTime(segment.ts_from)} – {dateTime(segment.ts_to)}</span><b>{segment.dose_value != null ? amount(segment.dose_value, segment.dose_unit) : amount(segment.rate_value, segment.rate_unit)}</b></div>)}</div> : null}</Card>;
    })}</div>;
  }

  if (panel === "diagnosis") {
    return <div className="grid gap-4 lg:grid-cols-2"><Card title={`Diagnoses · ${diagnoses.length}`}>{diagnoses.length ? <div className="space-y-2">{diagnoses.map((row, index) => <article key={text(row.id, index)} className="rounded-xl border border-[var(--app-border)] px-4 py-3"><strong className="text-[var(--app-text)]">{text(row.diagnosis_text, row.name)}</strong><p className="mt-1 text-xs text-[var(--app-muted)]">{text(row.icd_code, row.code, "Local / unmapped")}</p></article>)}</div> : <Empty title="No diagnosis available" detail="The source case did not provide a migrated diagnosis." />}</Card><Card title={`Operations / procedures · ${procedures.length}`}>{procedures.length ? <div className="space-y-2">{procedures.map((row, index) => <article key={text(row.id, index)} className="rounded-xl border border-[var(--app-border)] px-4 py-3"><strong className="text-[var(--app-text)]">{text(row.procedure_text, row.name)}</strong><p className="mt-1 text-xs text-[var(--app-muted)]">{text(row.icd_code, row.code, "Local / unmapped")}</p></article>)}</div> : <Empty title="No operation available" detail="The source case did not provide a migrated procedure." />}</Card></div>;
  }

  if (panel === "staff") {
    if (!staff.length) return <Empty title="No care-team records" detail="No staff assignment was synchronized or migrated for this case." />;
    return <Card title={`Care team · ${staff.length}`}><div className="overflow-hidden rounded-xl border border-[var(--app-border)]"><div className="grid grid-cols-[minmax(180px,1.3fr)_minmax(150px,.8fr)_170px_170px_90px] gap-3 border-b border-[var(--app-border)] bg-[var(--app-control-bg)] px-4 py-2 text-[10px] font-extrabold uppercase tracking-[0.12em] text-[var(--app-muted)] max-lg:hidden"><span>Staff</span><span>Role</span><span>In</span><span>Out</span><span>Duration</span></div>{staff.map((row, index) => <article key={text(row.id, index)} className="grid gap-2 border-b border-[var(--app-border)] px-4 py-3 last:border-b-0 lg:grid-cols-[minmax(180px,1.3fr)_minmax(150px,.8fr)_170px_170px_90px] lg:items-center"><div><span className="mb-1 block text-[10px] font-bold uppercase text-[var(--app-muted)] lg:hidden">Staff</span><strong className="block text-[var(--app-text)]">{text(row.name, row.staff_name, row.display_name)}</strong><span className="text-xs text-[var(--app-muted)]">{text(row.staff_group, row.department, row.source, "Innovian")}</span></div><div><span className="mb-1 block text-[10px] font-bold uppercase text-[var(--app-muted)] lg:hidden">Role</span><span className="text-sm font-semibold text-[var(--app-accent)]">{text(row.role, row.staff_role, row.role_name)}</span></div><div><span className="mb-1 block text-[10px] font-bold uppercase text-[var(--app-muted)] lg:hidden">In</span><span className="text-sm text-[var(--app-text)]">{dateTime(row.entered_at)}</span></div><div><span className="mb-1 block text-[10px] font-bold uppercase text-[var(--app-muted)] lg:hidden">Out</span><span className="text-sm text-[var(--app-text)]">{dateTime(row.exited_at)}</span></div><div><span className="mb-1 block text-[10px] font-bold uppercase text-[var(--app-muted)] lg:hidden">Duration</span><span className="text-sm font-bold text-[var(--app-text)]">{duration(row.entered_at, row.exited_at)}</span></div></article>)}</div></Card>;
  }

  if (panel === "patient") {
    const address = [patient.address_line_1, patient.address_line_2, patient.present_address, patient.city, patient.state_or_province, patient.postal_code, patient.country_code].filter(value => value != null && String(value).trim()).join(", ");
    const groups: Array<{ title: string; fields: Array<[string, unknown]> }> = [
      { title: "Identity", fields: [
        ["HN", patient.hn ?? entry.hn], ["AN / encounter", patient.an], ["Patient name", patient.patient_name],
        ["National ID / passport", patient.national_id ?? patient.document_number], ["Patient code", patient.patient_code],
        ["Innovian patient ID", patient.source_patient_id],
      ] },
      { title: "Demographics", fields: [
        ["Date of birth", patient.date_of_birth ?? patient.dob], ["Age at procedure", patient.age_text], ["Sex", patient.sex],
        ["Nationality", patient.nationality], ["Race", patient.race], ["Ethnicity", patient.ethnicity],
        ["Language", patient.language], ["Religion", patient.religion], ["Marital status", patient.marital_status],
      ] },
      { title: "Clinical profile", fields: [
        ["ASA", patient.asa_status], ["Blood group", patient.blood_group_text],
        ["Admission weight", patient.weight_kg == null ? null : `${patient.weight_kg} ${text(patient.weight_unit, "kg")}`],
        ["Height", patient.height_cm == null ? null : `${patient.height_cm} ${text(patient.height_unit, "cm")}`],
        ["Patient status", patient.patient_status], ["Surgical specialty", patient.surgical_specialty],
      ] },
      { title: "Admission and location", fields: [
        ["Hospital admission", patient.hospital_admitted_at ? dateTime(patient.hospital_admitted_at) : null], ["Hospital code", patient.hospital_code],
        ["Ward / location", patient.ward_location], ["Booking number", patient.booking_number], ["Booking management", patient.booking_management],
        ["Procedure function type", patient.procedure_function_type], ["Admission source", patient.admission_source],
      ] },
      { title: "Contact and care coordination", fields: [
        ["Address", address || null], ["Mobile", patient.mobile], ["Emergency contact", patient.contact_name],
        ["Contact telephone", patient.contact_tel], ["Primary care physician", patient.primary_care_md], ["Primary care nurse", patient.primary_care_rn],
      ] },
    ];
    const nka = allergies.length > 0 && allergies.every(row => isNka(row.allergen));
    return <div className="space-y-4"><div className="grid gap-4 xl:grid-cols-[1.7fr_1fr]"><Card title="Patient record"><div className="space-y-5">{groups.map(group => <section key={group.title}><h3 className="mb-2 text-xs font-extrabold uppercase tracking-[0.12em] text-[var(--app-accent)]">{group.title}</h3><dl className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{group.fields.map(([label, value]) => <div key={label} className="min-h-16 rounded-xl border border-[var(--app-border)] bg-[var(--app-control-bg)] px-3 py-2"><dt className="text-[10px] font-bold uppercase tracking-wide text-[var(--app-muted)]">{label}</dt><dd className={`mt-1 break-words text-sm font-semibold ${value == null || String(value).trim() === "" ? "text-[var(--app-muted)]" : "text-[var(--app-text)]"}`}>{value == null || String(value).trim() === "" ? "Not recorded" : String(value)}</dd></div>)}</dl></section>)}</div></Card><Card title="Allergy status"><div className={`rounded-xl border px-4 py-4 ${nka ? "border-emerald-500/45 bg-emerald-500/10" : allergies.length ? "border-red-500/45 bg-red-500/10" : "border-amber-500/45 bg-amber-500/10"}`}><strong className={nka ? "text-emerald-600 dark:text-emerald-300" : allergies.length ? "text-red-600 dark:text-red-300" : "text-amber-700 dark:text-amber-300"}>{nka ? "No Known Allergies (NKA)" : allergies.length ? `${allergies.length} recorded allerg${allergies.length === 1 ? "y" : "ies"}` : "Allergy status unavailable"}</strong>{!nka && allergies.map((row, index) => <p key={index} className="mt-2 text-sm text-[var(--app-text)]">{text(row.allergen)}{row.reaction ? ` · ${row.reaction}` : ""}{row.severity ? ` · ${row.severity}` : ""}</p>)}</div></Card></div></div>;
  }

  if (panel === "forms") {
    const draftFields = flattenDraft(formDraft).filter(([, value]) => value && value !== "null");
    if (!forms.length && !draftFields.length) return <Empty title="No case forms available" detail="No structured form was synchronized or migrated for this case." />;
    if (forms.length) return <div className="space-y-4">{forms.map((form, index) => {
      const fields = Array.isArray(form.fields) ? form.fields as Record<string, unknown>[] : [];
      const answered = fields.filter(field => fieldValue(field) !== "—");
      return <details key={text(form.id, index)} open={index === 0} className="overflow-hidden rounded-2xl border border-[var(--app-border)] bg-[var(--app-panel-bg)]"><summary className="flex cursor-pointer list-none items-center justify-between gap-3 bg-[var(--app-control-bg)] px-4 py-3"><div><h2 className="font-bold text-[var(--app-text)]">{text(form.name, "Clinical form")}</h2><p className="text-xs text-[var(--app-muted)]">{fields.length} total fields · {answered.length} recorded · all choices retained</p></div><span className="text-xs font-bold text-[var(--app-accent)]">Open / close</span></summary><div className="grid gap-2 p-4 md:grid-cols-2 xl:grid-cols-3">{fields.map((field, fieldIndex) => {
        const choices = fieldChoices(field);
        const value = fieldValue(field);
        return <article key={text(field.id, fieldIndex)} className="rounded-xl border border-[var(--app-border)] bg-[var(--app-bg)] px-3 py-3"><span className="block text-[10px] font-bold uppercase tracking-wide text-[var(--app-muted)]">{fieldLabel(field, fieldIndex)}</span>{choices.length ? <div className="mt-2 flex flex-wrap gap-1.5">{choices.map((choice, choiceIndex) => <span key={`${choice.label}-${choiceIndex}`} className={`inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-xs font-semibold ${choice.selected ? "border-emerald-500/55 bg-emerald-500/12 text-emerald-600 dark:text-emerald-300" : "border-[var(--app-border)] bg-[var(--app-control-bg)] text-[var(--app-muted)]"}`}><span aria-hidden="true">{choice.selected ? "☑" : "☐"}</span>{choice.label}</span>)}</div> : <strong className={`mt-1 block whitespace-pre-wrap text-sm ${value === "—" ? "font-medium text-[var(--app-muted)]" : "text-[var(--app-text)]"}`}>{value === "—" ? "Not recorded" : value}</strong>}</article>;
      })}</div></details>;
    })}</div>;
    return <Card title={`Leaf clinical form · ${draftFields.length} populated fields`}><div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">{draftFields.map(([label, value]) => <article key={label} className="rounded-xl border border-[var(--app-border)] px-3 py-2"><span className="block text-[10px] font-bold uppercase tracking-wide text-[var(--app-muted)]">{label.replaceAll("_", " ")}</span><strong className="mt-1 block text-sm text-[var(--app-text)]">{value}</strong></article>)}</div></Card>;
  }

  return <div className="space-y-4"><div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[var(--app-border)] bg-[var(--app-panel-bg)] p-4"><div><div className="text-xs font-extrabold uppercase tracking-[0.14em] text-[var(--app-accent)]">{isInnovian ? "Innovian source reports" : "Clinical archive report · review draft"}</div><h2 className="mt-1 text-xl font-bold text-[var(--app-text)]">{text(patient.patient_name, `HN ${entry.hn || "—"}`)}</h2><p className="text-sm text-[var(--app-muted)]">{entry.case_code || entry.source_case_id} · {dateTime(record(snapshot.case).start_time)}</p></div><button type="button" onClick={() => void openReportPreview()} disabled={reportBusy || (isInnovian && (!reportCatalog || selectedReportSections.length === 0))} className="rounded-xl border border-[var(--app-accent)] bg-[var(--app-accent)] px-4 py-2.5 text-sm font-bold text-[var(--app-accent-contrast)] disabled:opacity-50">{reportBusy ? "Loading PDF…" : "Preview PDF"}</button></div>{isInnovian ? <Card title="Innovian PDF reports"><p className="mb-3 text-sm text-[var(--app-muted)]">Innovian has four case-report families: ANES, FORM, POST and PACU. Only families supported by this encounter's source evidence are offered.</p>{reportCatalog ? <div className="grid gap-2 md:grid-cols-2">{reportFamilies.map(family => { const sectionIds = family.sections.map(section => section.id); const checked = sectionIds.every(id => selectedReportSections.includes(id)); return <label key={family.id} className={`flex cursor-pointer items-start gap-3 rounded-xl border px-3 py-3 ${checked ? "border-[var(--app-accent)] bg-[var(--app-accent-soft)]" : "border-[var(--app-border)] bg-[var(--app-control-bg)]"}`}><input type="checkbox" className="mt-1" checked={checked} onChange={event => setSelectedReportSections(current => event.target.checked ? Array.from(new Set([...current, ...sectionIds])) : current.filter(id => !sectionIds.includes(id)))} /><span><strong className="block text-sm text-[var(--app-text)]"><span className="mr-2 rounded-md border border-sky-500/35 bg-sky-500/10 px-1.5 py-0.5 text-[10px] text-sky-700 dark:text-sky-300">{family.code}</span>{family.title}</strong><span className="mt-1 block text-xs text-[var(--app-muted)]">{family.description}</span></span></label>; })}</div> : <p className="text-sm text-[var(--app-muted)]">Loading Innovian report types…</p>}</Card> : null}{reportError ? <div className="rounded-xl border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-600 dark:text-rose-300">{reportError}</div> : null}<div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4"><Card title="Patient"><strong>{text(patient.patient_name)}</strong><p className="text-sm text-[var(--app-muted)]">HN {text(patient.hn, entry.hn)} · AN {text(patient.an)}</p></Card><Card title="Clinical"><strong>{text(diagnoses[0]?.diagnosis_text, "Diagnosis unavailable")}</strong><p className="text-sm text-[var(--app-muted)]">{text(procedures[0]?.procedure_text, "Procedure unavailable")}</p></Card><Card title="Care team"><strong>{staff.length} staff record{staff.length === 1 ? "" : "s"}</strong><p className="text-sm text-[var(--app-muted)]">Includes role and in/out time</p></Card><Card title="Clinical documentation"><strong>{forms.length || (formDraft ? 1 : 0)} form{forms.length === 1 ? "" : "s"}</strong><p className="text-sm text-[var(--app-muted)]">All fields and choice states included</p></Card></div><div className="rounded-xl border border-sky-500/30 bg-sky-500/8 px-4 py-3 text-sm text-[var(--app-muted)]"><strong className="text-[var(--app-text)]">Preview before download.</strong> {isInnovian ? "Flora returns the preserved original Innovian pages when available. A clearly labelled reconstructed draft is used only when the source PDF is missing." : "It is generated from the archive snapshot and previewed before download; it does not print the current HTML screen."}</div>{reportBytes && reportUrl ? <div className="fixed inset-0 z-[1200] bg-black/75 p-3"><div className="mx-auto flex h-full max-w-[1500px] flex-col overflow-hidden rounded-2xl border border-[var(--app-border)] bg-[var(--app-panel-bg)] shadow-2xl"><div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--app-border)] px-4 py-3"><div><strong className="text-[var(--app-text)]">PDF report preview</strong><p className="text-xs text-[var(--app-muted)]">EPHIS target: <span className="font-mono font-semibold text-[var(--app-text)]">{reportDestinationPath ? `emr\\${reportDestinationPath}` : reportFileName}</span> · Preview only - nothing saved yet.</p></div><div className="flex gap-2"><a href={reportUrl} download={reportFileName} className="rounded-xl border border-[var(--app-accent)] bg-[var(--app-accent)] px-4 py-2 text-sm font-bold text-[var(--app-accent-contrast)]">Download PDF</a><button type="button" onClick={() => { setReportBytes(null); setReportUrl(""); }} className="rounded-xl border border-[var(--app-border)] bg-[var(--app-control-bg)] px-4 py-2 text-sm font-bold text-[var(--app-text)]">Close</button></div></div><div className="min-h-0 flex-1 overflow-auto bg-slate-300 p-4 dark:bg-slate-950"><PdfPreviewCanvas pdfData={reportBytes} /></div></div></div> : null}</div>;
}
