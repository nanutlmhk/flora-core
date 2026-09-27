# Canopy development checkpoint — 2026-09-27

This is a work-in-progress checkpoint, not clinical report acceptance or a release.

Implemented work includes PostgreSQL-backed archive/report access, report library,
account appearance synchronization, central charting layout, and menu assets.
Archive PDF rendering now samples continuous vitals at five-minute print intervals,
preserves off-grid cuff observations, and appends staff assignments and full event
notes. The archive remains the source; historical PDFs are comparison references only.

## Outstanding report verification

- The July 17, 2024 reference case lacks vital observations and staff assignments
  in the current Canopy import. Its chart verification intentionally fails.
- I/O summary and infusion totals, chart axes/parameter fidelity, and form layout
  still require comparison with original reports. Do not describe these as complete.
- Local rendering and four renderer regression tests were checked. These are not
  substitutes for end-to-end clinical content validation.
- Continue one failing report at a time. Finish and obtain user verification of
  2026 before proceeding with yearly migration of 2025 and 2024.
- Keep Leaf containers off during archive work to preserve hardware capacity.

Patient reports, database exports, and temporary QA artifacts are not part of this
source checkpoint. Unrelated presentation materials remain local.
