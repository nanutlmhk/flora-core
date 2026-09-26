import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";

type Snapshot = Record<string, unknown>;

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function rows(value: unknown): Record<string, unknown>[] {
  const source = record(value).rows;
  return Array.isArray(source) ? source.filter(item => item && typeof item === "object") as Record<string, unknown>[] : [];
}

function clean(value: unknown, fallback = "Not recorded") {
  const raw = value == null ? "" : String(value).trim();
  const output = raw.replace(/[^\u0020-\u007e\u00a0-\u00ff]/g, "?");
  return output || fallback;
}

function dateTime(value: unknown) {
  if (value == null || value === "") return "Not recorded";
  const date = typeof value === "number" || /^\d+$/.test(String(value)) ? new Date(Number(value)) : new Date(String(value));
  return Number.isNaN(date.getTime()) ? "Not recorded" : new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Bangkok", day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
  }).format(date);
}

function wrap(text: string, font: PDFFont, size: number, width: number) {
  const lines: string[] = [];
  for (const paragraph of clean(text, "").split(/\r?\n/)) {
    const words = paragraph.split(/\s+/).filter(Boolean);
    let line = "";
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(candidate, size) <= width) line = candidate;
      else {
        if (line) lines.push(line);
        line = word;
      }
    }
    if (line) lines.push(line);
  }
  return lines.length ? lines : ["Not recorded"];
}

function formFieldLabel(field: Record<string, unknown>, index: number) {
  const position = record(field.position);
  const header = record(position.source_header);
  const choices = Array.isArray(field.choices) ? field.choices as Record<string, unknown>[] : [];
  return clean(field.title || field.name || header.compTitle || header.compName || choices[0]?.label, `Field ${index + 1}`);
}

function formFieldValue(field: Record<string, unknown>) {
  const value = record(field.value);
  const choices = Array.isArray(field.choices) ? field.choices as Record<string, unknown>[] : [];
  const selected = Array.isArray(value.selected) ? value.selected as Record<string, unknown>[] : [];
  if (choices.length) {
    const selectedPositions = new Set(selected.map(item => Number(item.position)));
    return choices.map((choice, index) => `${selectedPositions.has(Number(choice.position)) ? "[x]" : "[ ]"} ${clean(choice.label, `Option ${index + 1}`)}`).join("   ");
  }
  return clean(value.text ?? value.number ?? value.value ?? field.raw_value);
}

export async function buildArchiveReportPdf(snapshot: Snapshot): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const pageSize: [number, number] = [841.89, 595.28];
  const margin = 34;
  const contentWidth = pageSize[0] - margin * 2;
  let page: PDFPage;
  let y = 0;

  const addPage = () => {
    page = pdf.addPage(pageSize);
    y = pageSize[1] - margin;
    page.drawText("FLORA CANOPY | CLINICAL ARCHIVE REPORT", { x: margin, y, size: 11, font: bold, color: rgb(0.08, 0.3, 0.35) });
    page.drawText("READ-ONLY REVIEW DRAFT", { x: pageSize[0] - margin - 128, y, size: 8, font: bold, color: rgb(0.65, 0.22, 0.12) });
    y -= 18;
    page.drawLine({ start: { x: margin, y }, end: { x: pageSize[0] - margin, y }, thickness: 0.8, color: rgb(0.72, 0.75, 0.78) });
    y -= 17;
  };
  const ensure = (height: number) => { if (y - height < margin + 18) addPage(); };
  const section = (title: string) => {
    ensure(28);
    page.drawRectangle({ x: margin, y: y - 4, width: contentWidth, height: 20, color: rgb(0.9, 0.95, 0.95) });
    page.drawText(clean(title), { x: margin + 7, y: y + 2, size: 9, font: bold, color: rgb(0.08, 0.28, 0.32) });
    y -= 25;
  };
  const row = (label: string, value: unknown, indent = 0) => {
    const labelWidth = 135;
    const lines = wrap(clean(value), regular, 8, contentWidth - labelWidth - indent - 12);
    const height = Math.max(18, lines.length * 10 + 6);
    ensure(height);
    page.drawText(clean(label), { x: margin + 5 + indent, y: y - 10, size: 7.5, font: bold, color: rgb(0.27, 0.31, 0.36) });
    lines.forEach((line, index) => page.drawText(line, { x: margin + labelWidth + indent, y: y - 10 - index * 10, size: 8, font: regular, color: rgb(0.08, 0.1, 0.13) }));
    page.drawLine({ start: { x: margin, y: y - height + 2 }, end: { x: pageSize[0] - margin, y: y - height + 2 }, thickness: 0.35, color: rgb(0.86, 0.87, 0.88) });
    y -= height;
  };

  addPage();
  const patient = record(record(snapshot.patient).row);
  const caseRow = record(snapshot.case);
  section("Patient and encounter");
  [
    ["Patient", patient.patient_name], ["HN", patient.hn], ["AN / encounter", patient.an],
    ["National ID", patient.national_id], ["Patient code", patient.patient_code], ["Innovian patient ID", patient.source_patient_id],
    ["Date of birth", patient.date_of_birth], ["Age", patient.age_text],
    ["Sex", patient.sex], ["ASA", patient.asa_status], ["Blood group", patient.blood_group_text],
    ["Admission weight", patient.weight_kg == null ? null : `${patient.weight_kg} ${clean(patient.weight_unit, "kg")}`],
    ["Height", patient.height_cm == null ? null : `${patient.height_cm} ${clean(patient.height_unit, "cm")}`],
    ["Hospital admission", dateTime(patient.hospital_admitted_at)], ["Case start", dateTime(caseRow.start_time)],
    ["Case end", dateTime(caseRow.discharge_time)], ["Nationality", patient.nationality], ["Language", patient.language],
    ["Religion", patient.religion], ["Race / ethnicity", [patient.race, patient.ethnicity].filter(Boolean).join(" / ")],
    ["Marital status", patient.marital_status], ["Ward / specialty", [patient.ward_location, patient.surgical_specialty].filter(Boolean).join(" / ")],
    ["Booking number", patient.booking_number], ["Booking management", patient.booking_management],
    ["Procedure function type", patient.procedure_function_type],
    ["Address", [patient.address_line_1, patient.address_line_2, patient.city, patient.state_or_province, patient.postal_code, patient.country_code].filter(Boolean).join(", ")],
  ].forEach(([label, value]) => row(String(label), value));

  section("Clinical context");
  row("Allergies", rows(snapshot.allergies).map(item => clean(item.allergen)).join("; ") || "No allergy information recorded");
  row("Diagnosis", rows(snapshot.diagnosis).map(item => clean(item.diagnosis_text || item.name)).join("; "));
  row("Operation / procedure", rows(snapshot.procedures).map(item => clean(item.procedure_text || item.name)).join("; "));

  section(`Care team (${rows(snapshot.staff).length})`);
  rows(snapshot.staff).filter(item => !item.source_deleted).forEach(item => {
    row(clean(item.role || item.staff_group, "Care team member"), `${clean(item.display_name || item.name)} | In ${dateTime(item.entered_at)} | Out ${dateTime(item.exited_at)}`);
  });

  section(`I/O and medication records (${rows(snapshot.io_runs).length})`);
  rows(snapshot.io_runs).forEach(item => row(clean(item.item_name || item.item_code), `${clean(item.kind)} / ${clean(item.entry_mode)} | ${dateTime(item.started_at)} - ${dateTime(item.stopped_at)}`));

  const forms = rows(snapshot.forms);
  forms.forEach(form => {
    const fields = Array.isArray(form.fields) ? form.fields as Record<string, unknown>[] : [];
    section(`${clean(form.name, "Clinical form")} (${fields.length} fields)`);
    fields.forEach((field, index) => row(formFieldLabel(field, index), formFieldValue(field)));
  });

  const pages = pdf.getPages();
  pages.forEach((item, index) => {
    const footer = `Generated ${dateTime(Date.now())} | Page ${index + 1} of ${pages.length}`;
    item.drawText(footer, { x: margin, y: 18, size: 7, font: regular, color: rgb(0.38, 0.42, 0.46) });
  });
  return pdf.save();
}
