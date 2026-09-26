import type { LegacyReportCatalog, LegacyReportOption } from "../../api/fleetApi";

export type LegacyReportFamilyId = "anes" | "form" | "post" | "pacu";

export type LegacyReportFamily = {
  id: LegacyReportFamilyId;
  code: "ANES" | "FORM" | "POST" | "PACU";
  title: string;
  description: string;
  sections: LegacyReportOption[];
};

const FAMILY_COPY: Record<LegacyReportFamilyId, Omit<LegacyReportFamily, "id" | "sections">> = {
  anes: { code: "ANES", title: "Anesthesia Report", description: "Anesthesia trends, events, medication, fluid and case totals" },
  form: { code: "FORM", title: "Anesthesia Form", description: "Pre-, intra- and post-anesthetic form packet" },
  post: { code: "POST", title: "Post-Anesthetic Record", description: "Recovery assessment, MASS, pain, sedation and discharge status" },
  pacu: { code: "PACU", title: "PACU Report", description: "PACU trends, events, fluids and recovery staffing" },
};

const FAMILY_ORDER: LegacyReportFamilyId[] = ["anes", "form", "post", "pacu"];

function familyId(section: LegacyReportOption, anesthesiaPacketCases: Set<string>): LegacyReportFamilyId {
  if (section.report_type === "anesthesia_chart") return "anes";
  if (section.report_type === "pacu_chart") return "pacu";
  if (section.report_type === "post_anesthetic_record" || section.report_type === "post_anesthetic_ambulatory") {
    // Innovian's FORM PDF can contain the Post-Anesthetic Record as a page
    // in the same anesthesia packet. It is POST only when exported alone.
    return anesthesiaPacketCases.has(section.case_id) ? "form" : "post";
  }
  return "form";
}

export function groupLegacyReportFamilies(catalog: LegacyReportCatalog): LegacyReportFamily[] {
  const anesthesiaPacketCases = new Set(catalog.sections
    .filter(section => section.report_type === "anesthesia_form" || section.report_type === "anesthesia_checklist")
    .map(section => section.case_id));
  const groups = new Map<LegacyReportFamilyId, LegacyReportOption[]>();
  for (const section of catalog.sections) {
    const id = familyId(section, anesthesiaPacketCases);
    groups.set(id, [...(groups.get(id) || []), section]);
  }
  return FAMILY_ORDER.flatMap(id => {
    const sections = groups.get(id);
    return sections?.length ? [{ id, ...FAMILY_COPY[id], sections }] : [];
  });
}
