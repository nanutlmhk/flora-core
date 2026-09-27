import { PDFDocument } from "pdf-lib";
import { buildArchiveReportPdf } from "../src/views/canopy/archiveReportPdf";

type DataRow = Record<string, unknown>;

function record(value: unknown): DataRow {
  return value && typeof value === "object" && !Array.isArray(value) ? value as DataRow : {};
}

function rows(value: unknown): DataRow[] {
  const source = record(value).rows;
  return Array.isArray(source) ? source as DataRow[] : [];
}

async function inspect(label: string, bytes: Uint8Array) {
  if (new TextDecoder().decode(bytes.slice(0, 5)) !== "%PDF-") throw new Error(`${label}: invalid PDF header`);
  const pdf = await PDFDocument.load(bytes);
  if (bytes.length < 10_000) throw new Error(`${label}: PDF is unexpectedly small (${bytes.length} bytes)`);
  if (pdf.getPageCount() < 1) throw new Error(`${label}: PDF has no pages`);
  return { label, bytes: bytes.length, pages: pdf.getPageCount() };
}

let source = "";
const endpoint = process.argv[2];
let catalogSections: DataRow[] = [];
if (endpoint) {
  const response = await fetch(endpoint, { headers: { "X-FLORA-Session": process.env.FLORA_TEST_TOKEN || "" } });
  if (!response.ok) throw new Error(`Snapshot request failed (${response.status})`);
  source = await response.text();
  const catalogResponse = await fetch(endpoint.replace(/\/snapshot$/, "/report-options"), { headers: { "X-FLORA-Session": process.env.FLORA_TEST_TOKEN || "" } });
  if (!catalogResponse.ok) throw new Error(`Report catalog request failed (${catalogResponse.status})`);
  const catalog = await catalogResponse.json() as DataRow;
  catalogSections = Array.isArray(catalog.sections) ? catalog.sections as DataRow[] : [];
} else {
  for await (const chunk of process.stdin) source += String(chunk);
}
const input = JSON.parse(source) as DataRow;
const snapshot = record(input.snapshot || input);
const forms = rows(snapshot.forms);
const caseId = String(record(snapshot.source).case_id || record(snapshot.case).id || "case");
const formId = forms[0]?.id == null ? "" : String(forms[0].id);
const chartSection = catalogSections.find(section => section.kind === "chart");
const catalogSelection = catalogSections.map(section => String(section.id));
const chartSelection = chartSection ? [String(chartSection.id)] : [`anes:${caseId}`];
const results = [await inspect(String(chartSection?.report_type || "CHART").toUpperCase(), await buildArchiveReportPdf(snapshot, chartSelection))];
if (formId) results.push(await inspect("FORM", await buildArchiveReportPdf(snapshot, [`form:${formId}`])));
results.push(await inspect("ALL", await buildArchiveReportPdf(snapshot, catalogSelection.length ? catalogSelection : [
  `anes:${caseId}`, ...forms.map(form => `form:${String(form.id)}`),
])));
if (results.at(-1)!.pages <= results[0].pages) throw new Error("ALL: selected forms did not add report pages");
process.stdout.write(`${JSON.stringify({ ok: true, case_id: caseId, forms: forms.length, catalog_sections: catalogSections.map(section => section.report_type), results }, null, 2)}\n`);
