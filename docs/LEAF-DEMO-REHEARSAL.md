# Flora Leaf: ESM demo rehearsal

Audit date: 2026-09-16. Entry point: http://localhost:6890.

## Verified in this audit

- Docker Leaf and FastAPI are running; the same-origin `/health` proxy responds successfully.
- The current case reports ACTIVE through the browser URL.
- Patient, allergy, diagnosis, procedure, staff, detail-draft, suggested-end,
  events, vitals, and I/O items/runs/events/summary endpoints return HTTP 200.
  These are availability checks, not proof of clinical completeness.
- Browser Ctrl+wheel zoom is no longer intercepted by the Electron zoom handler.
- Shutdown is only offered when the Electron shutdown capability exists.
- ReportView has a browser print fallback and print-specific CSS.

## Rehearsal to complete in a connected browser

Use a clearly synthetic case in a dedicated demo environment. The existing active
case was inspected read-only during this audit; it was not discharged or edited.

| Step | Expected result |
| --- | --- |
| Sign in and choose theme | Login completes; selected theme persists after reload. |
| Admit synthetic patient | Correct identity and start time appear in the chart header. |
| Enter allergy, diagnosis and operation | Entries persist after reload; NKA requires explicit documentation. |
| Assign staff | Names, roles, time in and time out persist. |
| View device observations | Timestamps and source are clear; simulated data is explicitly identified. |
| Add event and correct its time | Timeline updates without jumping; correction is retained. |
| Add medication, fluid and output | Units, doses and fluid balance remain correct after reload. |
| Fill clinical form | Saved values reload in their clinical sections. |
| Review then discharge | Final time and case status agree in chart and history. |
| Print / save PDF | Patient identity, chart, forms and totals are legible across page breaks. |
| Repeat on tablet viewport | Navigation, dialogs and timeline remain usable without clipped controls. |

No connected browser was available to the automation session. Visual appearance,
write interactions, tablet behavior and PDF pagination remain unverified.

## Current demo boundaries

Clinical writes use FastAPI and PostgreSQL directly. A resettable synthetic
environment and externally accessible HTTPS deployment have not yet been
provisioned; use only synthetic data until those controls are in place.
