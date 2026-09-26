# Innovian PDF report readiness for Flora Canopy

Audit date: 25 September 2026

## Decision

The Anora PostgreSQL archive contains enough retained source data for Flora to build an Innovian-equivalent clinical report for the migrated 2024-2026 scope. It is not yet safe to claim pixel or clinical parity from the current PDF generator.

The remaining work is primarily report composition and validated interpretation: phase boundaries, timestamp handling, report-specific parameter selection, duration pairing, infusion delivery and balance calculations, and hospital-approved print templates. The raw source evidence needed for the two documented reference encounters is present.

Cases before 2024 currently contain only searchable case-index/context data. Their empty chart is expected until those years are backfilled.

## Minimum acceptance - Innovian archive parity

The Innovian archive feature is not complete merely because a case opens or a PDF file is produced. The minimum releasable outcome is:

1. A user can open a migrated encounter in Flora Canopy and find the same clinical information available in Innovian, with the same distinction between recorded zero, blank, unavailable, unknown and NKA.
2. The case exposes its source report set rather than one generic export: anesthesia chart, PACU chart, anesthesia checklist and postoperative/PACU form where those source records exist.
3. Each generated report preserves the Innovian clinical reading pattern: patient header, time grid, trends, events, medication/fluid rows and totals, staff and durations, I/O summary, form geometry, choices and recorded answers.
4. Linked anesthesia and PACU phases from the same source encounter can be selected and printed together without mixing unrelated cases.
5. The PDF is previewed as the exact generated document before download or print; printing the current HTML screen is not an acceptable implementation.
6. The ten reference pages across the five supplied PDFs, plus at least one 2026 anesthesia/PACU encounter, pass value-by-value and rendered-layout review by KCMH clinical users.

Until all six conditions pass, the output remains a parity review draft. Improvements beyond Innovian begin only after this baseline is achieved.

## Source-backed individual case PDF eligibility

This section concerns only the individual PDF packet for one clinical case. It is completely separate from Minivia's monthly/statistical reporting suite (ASA summaries, case-type statistics, technique counts, timing reports and similar management/research outputs).

Minivia's individual case PDF workflow classified four packet families: anesthesia chart (`anes`), anesthesia form/checklist (`form`), Post-Anesthetic Record (`post`) and PACU chart (`pacu`). Flora/Anora retains this individual-case model but determines eligibility from database evidence rather than PDF text:

| Flora report family | Required evidence |
| --- | --- |
| Anesthesia chart | Innovian `Anesthesia Report` source report definition for the source POID/ANESTH phase |
| PACU chart | Innovian `Post Anesthetic Care Unit` source report definition for the source POID/PACU phase |
| Anesthesia form/checklist | Actual `Anesthesia Report` or `Anesthesia Check List` form instance linked to the archive case |
| Post-Anesthetic Record | Actual `PACU` or `PACU (Ambulatory)` form instance linked to the archive case |
| Nerve-block form | Actual `PAIN` form instance linked to the archive case |

When both ANESTH and PACU source report definitions exist for one source POID, the form family identifies the phase first. The imported care-unit label is only a fallback because paired legacy cases can carry the same care-unit label incorrectly. A report is not offered merely because a case exists or because a care-unit string resembles PACU.

## Verified archive inventory, 2024-2026

Counts were read directly from the running Anora PostgreSQL archive.

| Domain | Stored rows |
| --- | ---: |
| Innovian cases | 5,529 |
| Patient demographic snapshots | 5,529 |
| Allergy records | 5,728 |
| Staff assignments | 46,734 |
| Structured notes | 92,324 |
| Validated flowsheet observations | 2,472,314 |
| Compact trend segments | 464,162 |
| Events | 64,552 |
| Infusion/administration headers | 56,922 |
| Infusion measurements | 262,718 |
| Fluid/output records | 32,873 |
| Forms | 14,964 |
| Form fields and layout cells | 2,663,332 |
| Report balance configurations | 5,526 |

The archive also retains immutable source records, timestamp anchors, device parameter metadata, form positions/styles/choices and report configuration evidence.

## Reference-case reconciliation

The original Innovian comparison set contains anesthesia case 22601, its PACU sibling 22602, anesthesia case 23237 and PACU case 23240.

| Case | Trend segments | Device parameters | Flowsheet observations | Events | Notes | Staff | Infusions | Fluid/output | Forms | Form fields | Demographics | Allergies |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 22601 | 61 | 877 | 237 | 14 | 17 | 12 | 11 | 6 | 2 | 369 | 1 | 1 |
| 22602 | 61 | 877 | 46 | 14 | 2 | 2 | 11 | 6 | 2 | 317 | 1 | 1 |
| 23237 | 125 | 11,782 | 398 | 14 | 16 | 10 | 11 | 5 | 2 | 369 | 1 | 1 |
| 23240 | 125 | 11,782 | 50 | 14 | 2 | 4 | 11 | 5 | 2 | 317 | 1 | 1 |

This covers the information families visible in the ten reference pages across the five supplied PDFs: patient header, allergies, diagnosis/procedure, trends and ventilation, medication/infusion/fluid/output activity, staff, events/remarks, anesthesia/checklist forms, PACU scores and ambulatory PACU form.

The report definitions for source reports 22507 and 23146 are also retained. They include department/report names, hours per page, source care phases and wall-time boundaries, selected report sections, balance selections, calculation headers/details and matching I/O headers.

## What the current PDF generator already uses

- Demographics, encounter context, diagnosis, procedure and allergies.
- Minute trends, a limited trend graph and a fixed six-row ventilation table.
- Recorded administration/fluid/output actions.
- Staff assignments, chart events and structured notes.
- Selected forms with imported source ordering, positions, static labels, choices and answers.
- Repeated identity/footer, page numbering, preview and download.

## What is stored but not yet fully used by the PDF generator

1. Report-specific phase boundaries and parameter/section configuration.
2. Corrected timezone semantics. The legacy case index currently labels local source time as UTC on one path, while source timestamp anchors retain the evidence needed to correct it.
3. Named start/end event pairing and printed duration tables.
4. Infusion lifecycle, concentration, rate integration and delivered drug/carrier totals.
5. Innovian report balance definitions for fluids, blood and Total Steroid.
6. Report-specific fixed rows, including meaningful documented zero versus blank versus unavailable values.
7. A compact medication/drip timeline matching the clinical reading pattern of the Innovian print.
8. Purpose-built anesthesia, PACU and postoperative form layouts. The current generic grid is evidence-complete but visually verbose.
9. Signature/date areas and a future finalization/signing workflow. No signer should be invented from staff data.

## Clinical acceptance gates

The report should remain labelled review draft until all of these pass:

1. Phase and timezone reconciliation for cases 22601 and 23240.
2. The August anesthesia totals reproduce 19.33 mg hydrocortisone, 48.33 mL Total Steroid carrier volume, 291.64 mL fluid intake, 120 mL output, 171.64 mL fluid balance and -10 mL blood balance.
3. The November PACU report preserves the recorded 8.13 mg hydrocortisone, 100 mL NSS, 100 mL urine and documented 0 mL blood loss without inventing a blank balance summary.
4. All printed staff, events and three August narrative remarks match source clinical times and wording.
5. PACU MASS totals reproduce 9, 9, 8, 8, 10, 10, 10 and decoded choices match their displayed score meaning.
6. Blank, zero, `***`, unknown and NKA remain distinct.
7. Generated pages are compared against all ten reference pages across the five supplied PDFs, then reviewed by KCMH clinical users.
8. At least one 2026 anesthesia/PACU encounter passes the same reconciliation before general release.

## Implementation consequence for Flora

Flora Canopy can consume the Anora archive as the report data source; another legacy extraction schema is not required for the migrated years. The next report work should extend the report bundle/query and renderer to consume the already-imported phase, infusion and balance configuration data. It should not remigrate or flatten those facts into a new report-only table.
