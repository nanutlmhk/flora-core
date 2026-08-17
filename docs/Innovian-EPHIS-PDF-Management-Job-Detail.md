# Innovian to EPHIS PDF Management Job Detail

Prepared for hospital and Meditop discussion.

This document describes the planned job scope, responsibilities, workflow, and support model for the Innovian-to-EPHIS PDF management project.

It is intended to help align all parties before final quotation and implementation scheduling.

## 1. Job purpose

The purpose of this job is to improve how anesthesia-related PDFs exported from Innovian are reviewed, named, compared, organized, and sent to the hospital destination workflow used for EPHIS.

The work is intended to solve practical operational problems such as:

- temporary or unclear source filenames from Innovian
- same HN having multiple operating room cases within the same day
- accidental replacement of one PDF by another when only `HN.pdf` is used
- staff workload from manual checking, renaming, merging, and sending
- lack of a reliable daily comparison between Innovian cases and current PDF files
- dependence on manual end-of-day sending

## 2. Job objective

The objective is to provide a working software-assisted process that can:

- identify relevant Innovian PDF reports
- compare daily Innovian cases against the PDFs currently present in the target folder structure
- rename files using a safer case-aware naming method
- reduce wrong replacement when one patient has multiple cases on the same day
- merge related PDFs when appropriate
- send finalized PDFs automatically every day after midnight
- keep logs, archives, and exception records for review

## 3. Planned job scope

The current planned scope is divided into three practical parts.

### 3.1 Daily case comparison

Build a daily comparison process between:

- cases exported from Innovian
- PDFs currently available in the existing destination structure

This comparison should help reveal:

- missing PDFs
- unmatched PDFs
- duplicate same-day cases for the same HN
- possible overwritten or replaced PDFs
- cases that need manual review

### 3.2 Safer PDF naming upgrade

Upgrade the current naming approach gradually from:

- `HN.pdf`

to a safer format such as:

- `HN_admitdate_time.pdf`

or another approved case-aware format based on actual available report metadata.

The purpose of this change is to prevent same-day multi-case replacement problems.

### 3.3 Automated daily sending

Implement an automated workflow that runs after midnight each day to:

- process eligible Innovian PDFs
- apply comparison and naming rules
- prepare or merge final PDFs
- send finalized files to the target destination
- record processing results and exceptions

## 4. Main work items

The job is expected to include the following work items.

### 4.1 Requirement review

- review current hospital workflow
- review Meditop operational expectations
- confirm source and destination folder paths
- confirm the daily processing window
- confirm user roles involved in the workflow

### 4.2 Sample PDF analysis

- inspect real Innovian PDF samples
- identify report types involved
- determine what metadata is consistently available
- determine which fields can safely be used for filename generation and encounter grouping

### 4.3 Processing logic design

- define case comparison logic
- define naming rules
- define merge rules
- define blocked-case rules when confident auto-processing is not possible

### 4.4 Software implementation

- develop or adapt the PDF processing tool
- implement comparison reporting
- implement case-aware naming
- implement merge and archive behavior
- implement scheduled after-midnight automation
- implement logging and traceability

### 4.5 Testing and validation

- test with representative hospital sample files
- validate same-day multi-case handling
- validate that existing PDFs are not wrongly replaced
- validate automated daily sending behavior

### 4.6 Handover and support preparation

- prepare operational instructions
- explain daily use and exception handling
- align support contact flow with hospital and Meditop

## 5. Expected deliverables

The expected deliverables from this job are:

- working PDF processing software or utility for the agreed workflow
- daily Innovian-versus-current-PDF comparison output
- case-aware PDF naming logic
- merge and archive workflow for related reports
- scheduled after-midnight sending process
- processing logs for audit and troubleshooting
- operational documentation
- basic user handover

## 6. Operational workflow direction

The intended operational direction is as follows:

1. Innovian exports raw PDF reports into the designated source area.
2. The software reviews the eligible batch for the configured daily window.
3. The software compares Innovian case data against the currently available PDFs.
4. The software identifies missing, duplicate, replaced, or ambiguous cases.
5. The software applies approved naming and grouping rules.
6. The software prepares merged or finalized PDFs when conditions are met.
7. The software sends the results to the configured destination after midnight.
8. The software keeps logs and exception records for review.

## 7. Support and service model

The working support model is expected to include both technical delivery and operational support.

### 7.1 Level 1 coordination and user-facing support

The service is expected to include direct communication with:

- hospital users
- nursing staff involved in the workflow
- Meditop representatives
- hospital IT department when required

This means the role is not limited to software development only, but also includes first-line operational coordination for issues related to the agreed workflow.

### 7.2 Remote support

The normal first support approach is expected to be remote support, including:

- issue review
- log review
- workflow verification
- remote troubleshooting
- remote configuration adjustment within agreed scope

### 7.3 On-site support when necessary

If a problem cannot be resolved remotely, on-site support may be required for:

- workflow interruption
- environment-specific folder or permission problems
- coordination with hospital IT
- urgent investigation of failed processing or delivery

The detailed on-site conditions, response expectations, and service limits should be defined in the final quotation or service terms.

## 8. Key assumptions

This job detail currently assumes:

- Innovian reports are available as readable PDFs
- real sample PDFs can be provided for analysis
- the destination folder structure for EPHIS can be reviewed and confirmed
- the scheduled daily process will run on a Windows environment
- a machine or service context is available for the after-midnight automation

## 9. Key items to confirm before final quotation

The following points still need confirmation:

- exact report types involved
- exact metadata available in each report type
- whether admit date and time are consistently usable
- whether another encounter identifier is more reliable than admit date and time
- exact destination folder behavior expected by hospital and Meditop
- exact time for daily scheduled sending
- expected response time for support
- expected on-site support conditions

## 10. Out of scope unless separately agreed

The following items should be considered out of scope unless later added explicitly:

- direct API integration with EPHIS
- database integration with Innovian
- OCR for image-only PDFs
- unrelated hospital infrastructure work
- unlimited on-site support
- major workflow redesign outside the agreed PDF management scope

## 11. Next step

The next recommended step is to review sample PDFs together and confirm the safest case key for the filename and merge logic.

After that, this job detail can be used as the basis for:

- final scope confirmation
- project schedule
- quotation
- warranty and service terms
