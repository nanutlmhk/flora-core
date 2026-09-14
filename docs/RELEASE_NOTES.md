# Flora Release Notes

This file tracks official Flora release milestones, patch history, and user-facing changes.

## Format

For each release or patch, record:

- version
- release date
- status
- summary
- key changes
- validation / rollout note

Suggested status values:

- released
- in progress
- planned

## Milestones

### 1.0.0

- Release date: initial clinical release
- Status: released
- Summary: First real clinical release of Flora used in intervention OR.
- Key changes:
  - First live-case use of Flora in real clinical workflow.
  - Integrated with `GE B1x5` patient monitor.
  - Integrated with `GE Carestation 750` anesthesia machine.
  - Established the first production-ready anesthesia charting workflow in the OR.
- Validation / rollout note:
  - Used with real intervention OR cases.

### 1.1.0

- Release date: packaging milestone
- Status: released
- Summary: Flora and Hidro packaged into an installable deployment.
- Key changes:
  - Delivered Flora and Hidro as installation packages.
  - Removed the need to manually copy source code onto client PCs.
  - Simplified deployment and upgrade workflow at client sites.
  - Improved reproducibility of installation and setup.
- Validation / rollout note:
  - Marked the transition from developer-managed code copy to packaged client installation.

### 1.2.0

- Release date: Neuro OR integration milestone
- Status: released
- Summary: Expanded real-case device support in Neuro OR.
- Key changes:
  - Completed support for `GE B650/850` patient monitor workflow.
  - Completed support for `GE Aisys / Avance` anesthesia machine workflow.
  - Used in real Neuro OR clinical cases.
  - Expanded Flora from the first intervention OR setup into a broader real-case device environment.
- Validation / rollout note:
  - Confirmed in real-case Neuro OR use.

### 1.2.1

- Release date: 2026-04-27
- Status: released
- Summary: Catch-up stabilization patch after early Neuro OR beta use and first packaged client rollout.
- Key changes:
  - Improved report output:
    - added `ECG` row under the chart
    - fixed fluid drip plotting in report
    - improved printed parameter handling such as `FiO2` and `FiO2 (sensor)`
  - Improved fluid and medication workflow:
    - fixed several bolus/drip timeline issues
    - aligned drip editing toward `change rate` / `stop drip`
    - improved fluid drip handling in CaseView and report paths
  - Improved case lifecycle stability:
    - hardened `discharge -> new case` workflow
    - reduced risk of timeline freeze/slowdown after starting a new case
    - added overlap-handling flow for automatic data when a new case start overlaps the previous case
  - Improved form completeness from real-case feedback:
    - restored `PNB` fields
    - restored invasive catheter details
    - expanded extubation information
    - updated monitoring labels including `EEG/BIS`, `NIR Left`, and `NIR Right`
  - Improved UI readability and bedside usability:
    - increased overall light-mode contrast
    - fixed washed-out medication quick guide card
    - simplified right-rail device status into calmer bedside-style lines
    - added extra theme options including `RCAT` and `Black Pink`
  - Improved deployment and master-data checks:
    - fixed master-data migration to include both `ICD-10` and `ICD-9-CM`
    - added a quick master-data verification command for client database checks
- Validation / rollout note:
  - Built successfully as `Flora-Setup-1.2.1.exe`.
  - Verified in local development build and partial real-case feedback loop.
  - Intended as the main stabilization patch set after the early March 2026 Neuro OR beta phase.

### 1.2.2

- Release date: 2026-06-14
- Status: released
- Summary: Workflow refinement release for line documentation, report output, temporary medication fallback, and edition groundwork.
- Key changes:
  - Improved line and form workflow:
    - reworked the line tab toward clearer `IV line`, `arterial line`, and `central line` sections
    - expanded line-related data handling in form save/load and report output
    - updated left-rail/form summaries to reflect the newer line structure
  - Improved report output:
    - restored missing event printing in the PDF report
    - improved line summary/report rendering
    - added edition-aware report behavior and branding hooks
  - Improved fluid, drip, and medication workflow:
    - fixed drip rate/dose update paths that could fail during editing
    - improved drip timeline semantics and display handling
    - added case-only temporary manual drug entry when library search has no valid match
    - kept temporary manual drugs printable in the report
    - improved guidance when a user is likely entering a fluid or selecting the wrong workflow
  - Added edition architecture groundwork:
    - introduced `full`, `RCAT`, and `EforL` edition-aware desktop behavior
    - added edition-specific theme/report/timeline restrictions in the frontend
    - added EforL-specific branding support including logo handling in UI/report paths
    - added EforL-only manage mockups for database export and license activation flow
  - Improved blood product architecture groundwork:
    - added HIS blood-product list API support and normalization helpers
    - added stricter authorization checks for actual blood giving records
    - added EforL blood-board showcase workflow with mock data
  - Improved deployment support:
    - preserved existing `auth_user` rows when building client DBs
    - added edition-aware packaging script options for future installer variants
- Validation / rollout note:
  - Intended for Flora `1.2.2` packaging after the June 2026 workflow refinement pass.
  - Includes both full-edition stabilization work and edition architecture groundwork without changing the full-edition product identity.

## Upcoming Patch Entry Template

### x.y.z

- Release date: yyyy-mm-dd
- Status: in progress
- Summary: short user-facing summary
- Key changes:
  - item 1
  - item 2
  - item 3
- Validation / rollout note:
  - where/how it was tested

