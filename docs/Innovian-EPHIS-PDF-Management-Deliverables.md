# Innovian to EPHIS PDF Management Deliverables

Prepared as a pre-quotation scope and deliverables brief for Meditop.

This document is intended to explain what the client would receive from hiring me to develop a PDF management workflow between Innovian report exports and the hospital EPHIS document structure.

It is not yet a commercial quotation, contract, or final technical specification. Its purpose is to make the expected work, outputs, and boundaries clear before pricing is discussed.

## 1. Project objective

The objective of this work is to provide a reliable software workflow that:

- reads PDF reports exported from Innovian
- compares Innovian daily cases against the PDFs currently present in the hospital folder structure
- identifies the correct patient and case context from report content
- renames and organizes those PDFs into a standardized structure
- merges related PDFs when appropriate
- prepares or delivers the final PDF files into the destination folder structure used for EPHIS or hospital document workflow
- sends processed PDFs automatically on a daily schedule after midnight
- reduces manual file handling and lowers the risk of wrong-patient or wrong-encounter filing

In simple terms, the client would receive a custom PDF processing tool that converts raw Innovian report exports into organized, usable patient-case PDF documents for downstream hospital use.

## 2. Main problem being addressed

Innovian exports may use temporary or non-clinical filenames that are not suitable for direct filing into hospital document systems.

Typical operational problems include:

- filenames that do not clearly identify the patient or case
- multiple PDF report types for the same anesthesia encounter
- repeated admissions or repeated cases for the same patient on the same day
- replacement of an existing PDF when multiple operating room cases occur within the same day for the same HN
- inconsistent report metadata across document templates
- manual staff workload to inspect, rename, merge, and move PDFs
- dependence on staff to remember daily file sending or end-of-day processing
- risk of misfiling when patient ID alone is used as the document key

This project is intended to replace that manual handling with a repeatable and auditable software process.

## 3. Proposed implementation direction

The current working direction is a phased upgrade rather than an immediate full replacement of the existing naming model.

### 3.1 Phase 1: daily case comparison

The first phase is to produce a daily comparison list between:

- cases exported from Innovian
- PDFs currently present in the destination folder structure

The purpose of this phase is to show operational gaps clearly, such as:

- case exists in Innovian but no PDF is present yet
- PDF exists but does not match the expected current Innovian case
- more than one case exists for the same HN on the same day
- an existing PDF may have been overwritten or replaced by a later case

This phase helps validate the real workflow and quantify the mismatch problem before finalizing the full automation logic.

### 3.2 Phase 2: controlled filename upgrade

The second phase is to gradually move from the current naming style:

- `HN.pdf`

to a case-aware naming style such as:

- `HN_admitdate_time.pdf`

The purpose of this change is to stop one same-day case from replacing another when the patient has multiple operations or multiple admissions within the same day.

The exact date and time fields used in the filename must be confirmed from actual Innovian report metadata before final implementation.

### 3.3 Phase 3: scheduled automatic daily sending

After the comparison logic and safer filename structure are in place, the workflow will move to automated daily sending.

The current intended direction is:

- process the day’s Innovian PDF output automatically after midnight
- prepare and send the resulting PDFs to the configured destination folder without requiring routine manual action
- retain logs and archives so the previous day’s processing can be reviewed if needed

The exact schedule, retry behavior, and operational exception handling should be confirmed during implementation planning.

## 4. What the client would receive

The client would receive a working software package and related implementation materials for the agreed scope.

### 4.1 Custom PDF management software

A Windows-based utility or script-driven application that can:

- scan a configured source folder for Innovian-exported PDFs
- read report text from PDF content
- extract relevant metadata such as patient ID and case-related identifiers where available
- classify report types
- rename PDFs according to the approved naming convention
- group and merge PDFs that belong to the same encounter
- move or copy processed files into configured output folders
- preserve archive copies of original source PDFs
- prevent or flag risky ambiguous cases for manual review

### 4.2 Configured workflow for Innovian to EPHIS handoff

The delivered workflow would include the agreed folder handling process, for example:

- incoming raw Innovian PDF folder
- staged or prepared working folder
- archive folder for original PDFs
- final destination folder for EPHIS-ready PDFs
- optional uploaded or delivered-copy archive
- scheduled execution after midnight each day

The exact folder structure would be finalized during requirements confirmation.

### 4.3 Daily comparison reporting

The client would receive logic to generate a daily case comparison view or report between Innovian source cases and the currently available PDF outputs.

This comparison should help staff identify:

- missing PDFs
- duplicate same-day cases for the same HN
- potential overwrite risk
- unmatched or ambiguous records requiring review

### 4.4 Scheduled automation

The client would receive workflow automation for routine daily operation, including:

- automatic execution on a daily after-midnight schedule
- automatic processing of eligible Innovian PDFs
- automatic delivery of finalized PDFs to the configured destination
- logging of each run for operational traceability
- support for review of failures or blocked cases

### 4.5 Naming and grouping logic

The client would receive approved logic for:

- how patient identity is determined
- how one anesthesia case or encounter is distinguished from another
- how report types are labeled
- how final filenames are constructed
- when PDFs are merged automatically
- when files are blocked for manual review instead of being merged unsafely

This is especially important for cases where the same patient may have multiple admissions or multiple anesthesia events on the same day.

### 4.6 Technical documentation

The client would receive clear operational documentation covering:

- purpose of the software
- folder setup
- how to run the workflow
- preview mode and execution mode
- expected results
- common error cases
- recovery and troubleshooting guidance

### 4.7 Basic user handover

The client would receive a short handover suitable for the operational team, such as:

- how to place incoming PDFs
- how to review software output
- how to identify blocked or unmatched files
- how to confirm final files reached the intended destination

## 5. Expected functional scope

The functional scope is expected to include the following items.

### 5.1 PDF intake

- detect relevant PDF files from the source folder
- ignore unsupported or unrelated PDFs unless specifically included
- support repeated batch processing
- support unattended scheduled batch processing

### 5.2 Daily case comparison

- build a daily list of cases found in Innovian exports
- compare those cases with the PDFs currently stored under the existing folder structure
- identify missing, extra, replaced, or ambiguous PDF outputs
- support operational review before broader filename migration

### 5.3 Scheduled execution

- run automatically once per day after midnight
- process the intended batch window for the previous day or configured reporting window
- generate logs for each scheduled run
- support safe rerun behavior where possible

### 5.4 Metadata extraction

- extract patient ID from report content
- detect report type from filename, content, or both
- inspect available encounter metadata such as anesthesia number, admission date and time, case date and time, or other stable identifiers
- determine which metadata is reliable enough for filename generation and merge grouping

### 5.5 Safe encounter grouping

- group PDFs by patient plus encounter key, not by patient alone
- support same-day repeated admissions when metadata allows
- avoid unsafe auto-merge when multiple possible encounters cannot be distinguished confidently

### 5.6 File naming

- support migration from `HN.pdf` toward a case-aware filename format such as `HN_admitdate_time.pdf`
- generate a standardized filename format agreed with the client
- support separate report-level filenames and merged encounter-level filenames if needed
- avoid collisions where possible and preserve traceability

### 5.7 Merging and publishing

- merge related reports for the same encounter in the correct order
- produce final output PDF for the target hospital workflow
- send or copy final files into the designated EPHIS-facing folder
- preserve source and delivery archives where required

### 5.8 Error handling and auditability

- preview planned actions before execution
- log processed files and results
- identify failures or ambiguous cases clearly
- avoid destructive overwrite without backup or explicit approved behavior

## 6. Likely deliverable outputs

Depending on the final confirmed design, outputs may include:

- daily Innovian-versus-current-PDF comparison list
- raw report file renamed to a standardized case-aware format
- merged encounter PDF containing the relevant Innovian reports
- archived original copy of source PDFs
- scheduled after-midnight processing workflow
- processing log for traceability
- optional backup copies of replaced or republished PDFs

Example output concepts may include:

- `[patient_id]_[case_key]_ANE.pdf`
- `[patient_id]_[case_key]_FRM.pdf`
- `[patient_id]_[case_key].pdf`

The final naming format should be confirmed only after sample PDFs are reviewed and metadata availability is validated.

## 7. Items that still need confirmation before final specification

Before quotation or final development scope is locked, the following items should be confirmed:

- how many Innovian report templates are involved
- which metadata fields are consistently present across all report types
- whether anesthesia number or another encounter identifier is reliably available
- whether date and time fields are sufficiently stable for encounter grouping
- what exact folder structure EPHIS expects
- whether final delivery is a folder handoff only or requires additional integration behavior
- what time after midnight the automated run should begin
- what retry or alert behavior is expected if a scheduled run fails
- what should happen when the software cannot confidently determine the correct case

These points directly affect implementation complexity and project price.

## 8. Assumptions

This pre-quotation scope assumes:

- Innovian reports are available as readable PDFs
- PDF text extraction is possible for most target reports
- the client can provide representative sample PDFs for analysis
- the destination folder structure for EPHIS is known or can be defined
- the workflow will initially run in a controlled Windows environment
- a Windows machine or service context is available to run the scheduled after-midnight automation

If major parts of the PDFs are image-only or use inconsistent templates, additional OCR or exception-handling work may be needed.

## 9. Out of scope unless separately agreed

The following items should be treated as out of scope unless later added explicitly:

- direct API integration with EPHIS
- database integration with Innovian
- server hosting or enterprise deployment platform
- SMS, LINE, or email alerting unless specifically requested
- OCR pipeline for poor-quality scanned PDFs
- multi-site deployment with separate custom rules per hospital
- formal regulatory validation documentation
- long-term maintenance agreement
- 24/7 production support

## 10. Suggested next step

The next practical step is to review a sample set of real Innovian PDFs and answer three questions:

1. How many report types must be supported?
2. What metadata is consistently available in each type?
3. What is the safest encounter key for naming, merging, and EPHIS delivery?

Once those points are confirmed, this scope can be converted into:

- a final functional specification
- a development plan
- and a formal quotation for Meditop
