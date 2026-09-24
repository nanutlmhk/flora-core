# Innovian Form Coverage in FLORA

## Purpose

Innovian is the historical coverage baseline, not the visual template for FLORA. FLORA must retain clinically meaningful archive data while replacing the legacy collection of flat forms with a task-oriented workflow.

The archive currently contains seven form families:

- Anesthesia Check List
- Anesthesia Report
- PACU
- PACU (Ambulatory)
- Preanesthetic evaluation and medication record
- PreOp
- PAIN

Related archive data also exists outside those form definitions, including outcomes, structured notes, medical history, daily weight, laboratory results, pump information and clinical events.

## FLORA workflow mapping

| Innovian domain | FLORA section | Interaction model |
| --- | --- | --- |
| Patient, case and anesthesia plan | Case & Plan | Reuse known patient/case data; select only decisions that belong to this case |
| Preanesthetic evaluation / PreOp | Pre-anesthesia | Readiness cards, airway-risk choices, compact baseline observations and preparation notes |
| Anesthesia Check List | Safety Checklist | Phase-based confirmation with exceptions and team concerns revealed when needed |
| Anesthesia Report | Procedure-specific sections | Show only selected anesthesia, airway, regional, line and invasive workflows |
| PACU / ambulatory PACU | Recovery / PACU | Arrival-to-destination flow with readable recovery-score definitions and automatic total |
| PAIN | Pain | 0–10 score pickers, conditional catheter detail, adverse effects and treatment response |
| Outcome records | Outcome | Explicit normal, complication or pending state; complication detail appears conditionally |
| Structured notes and exceptional legacy fields | Imported record / clinical note | Preserve source value and context even before a native FLORA control is mapped |

## Data-retention contract

Migration must never discard an archive value merely because FLORA does not display it as a dedicated control.

For every imported field, retain:

- source system and form family;
- original form, component and attribute identifiers;
- original label and value;
- recorded date/time and author when available;
- encounter/case linkage;
- unit, coded value and free-text representation when present;
- mapping status: `native`, `derived`, `read_only_legacy` or `unmapped`.

Native FLORA fields should use stable clinical keys. Original Innovian payloads remain available as read-only provenance so future mappings can be added without repeating the migration.

## UX rules

1. Do not reproduce every Innovian field as an always-visible input.
2. Reuse demographics, diagnoses, allergies, observations, labs and case data already known by FLORA.
3. Reveal detail only after the clinician selects the relevant technique, risk or complication.
4. Prefer clear choices, score descriptions, counters and conditional cards over raw text boxes.
5. Show completion by clinical section, not one misleading whole-form percentage.
6. Allow discharged cases to remain editable until archive confirmation; archived records are read-only.
7. Preserve audit history for every change and retain the original imported value.

## Definition of archive-compatible

Archive compatibility is complete only when:

- every source component is catalogued;
- every value is imported or explicitly rejected with a documented reason;
- all clinically active fields have a native FLORA mapping;
- obsolete or institution-specific fields remain searchable as read-only legacy data;
- representative cases from all seven form families reconcile against Innovian;
- clinical users approve the workflow and printed/exported record.

This prevents two bad outcomes: silently losing historical data, or making clinicians operate a modern-looking copy of a legacy form.
