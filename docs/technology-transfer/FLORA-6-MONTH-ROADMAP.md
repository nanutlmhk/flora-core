# FLORA Six-Month Roadmap

> **Capacity notice — superseded:** This original scope assumed a larger cross-functional team. With three core developers, approximately 20 hours/month from Nanut and limited CEO availability, use [FLORA-6-MONTH-LEAN-ROADMAP.md](./FLORA-6-MONTH-LEAN-ROADMAP.md) as the authoritative delivery commitment. This file remains as the expanded product roadmap and future backlog.

**Target period:** 28 September 2026–26 March 2027
**Cadence:** Twelve two-week sprints, with a year-end integration and holiday buffer
**Purpose:** Establish a pilot-ready first version of FLORA's three strategic pillars on a clinical-grade enterprise foundation.

## Six-month outcome

At the end of six months, FLORA must be able to demonstrate one complete operating-room journey—from scheduled case to signed record—using live or replayed device data, configurable hospital workflows, secure hospital integration and a governed post-case learning pipeline.

The target is not to certify every one of the 150+ catalogued device models or deploy autonomous clinical AI. The target is to prove that the platform can scale those capabilities safely.

## Strategic pillars and measurable proof

| Pillar | Six-month proof | Target measures |
|---|---|---|
| **1. Clinical Data as a Service** | FLORA-ROOT operates as a remotely observable, recoverable hospital-edge service and sends normalized data to the platform. | At least 6 priority protocol lanes; at least 20 exact device models validated physically or through approved replay; heartbeat and fault alert within 5 minutes; store-and-forward survives a 60-minute network outage without losing accepted events. |
| **2. Configurable Clinical Workflow** | One full OR workflow can be adapted for a second hospital through governed configuration rather than source-code forks. | Pre-OR through case completion supported; at least 80% of agreed site variation handled by configuration; versioned site packages; configuration diff, approval and rollback; deployment to test in under 30 minutes. |
| **3. Clinical Intelligence and AI** | Historical and live cases enter one governed longitudinal dataset and support one clinically reviewed intelligence use case in shadow mode. | 100,000+ historical cases ingested or indexed; quality score for every case; at least 90% mapping coverage for agreed critical variables; one retrospectively validated use case; no autonomous clinical decision-making. |
| **Clinical-grade foundation** | The pilot operates safely and reliably under realistic hospital conditions. | 40-hour case soak test; p95 API response below 500 ms for agreed workflows; complete audit/provenance; central RPO of 5 minutes and RTO of 30 minutes; edge continues during central outage; no unresolved critical security findings. |

## Product principles

1. **No big-bang rewrite.** Keep working protocol knowledge and replace Hidro components behind stable contracts using a strangler migration.
2. **Canonical data before AI.** Every source must map to one versioned clinical event and terminology model.
3. **Configuration is governed software.** Every site configuration is versioned, tested, approved, deployable and reversible.
4. **Validate exact device combinations.** Compatibility is recorded by model, software version, interface option and tested transport—not only by protocol family.
5. **AI starts in shadow mode.** The first intelligence feature measures and advises; it does not automatically change care.
6. **Every sprint produces evidence.** Demonstrations, tests, logs, mappings, decisions and operational documentation are part of the deliverable.

## Roadmap by phase

| Phase | Sprints | Primary outcome |
|---|---:|---|
| **Align and establish contracts** | 1–2 | Pilot scope, canonical model, device registry, edge control plane and replayable test environment |
| **Prove managed device integration** | 3–4 | Priority protocol lanes, resilient data flow, fleet observability and remote recovery |
| **Prove configurable workflow** | 5–8 | Full OR journey, governed site packages, enterprise integration and API trust |
| **Establish the learning system** | 9–10 | Governed historical dataset, data quality, feature/label definitions and first use case |
| **Validate and pilot** | 11–12 | Shadow-mode intelligence, end-to-end hospital pilot, reliability/security evidence and handover |

## Twelve-sprint delivery plan

### Sprint 1 — Scope, baseline and clinical journey

**Dates:** 28 September–9 October 2026
**Goal:** Agree exactly what the six-month pilot must prove.

Deliverables:

- Select the pilot hospital, OR journey and clinical owners.
- Map pre-OR, patient entry, induction, maintenance, emergence, transfer and case completion.
- Select the first 20 exact device models and six protocol lanes based on installed base and access for testing.
- Inventory Hidro, Vector and FLORA services, data stores, interfaces and technical debt.
- Define the canonical event envelope: patient, encounter, device, source time, receive time, unit, value, quality and provenance.
- Establish baseline measurements for availability, ingestion delay, missing data, chart performance and manual work.
- Create the architecture decision record and risk register.

**Exit gate:** Pilot charter, journey map, device matrix, success metrics and canonical event v0.1 are approved.

### Sprint 2 — FLORA-ROOT and integration test foundation

**Dates:** 12–23 October 2026
**Goal:** Create the common edge runtime without rewriting proven adapters.

Deliverables:

- Define the adapter contract between protocol collectors and FLORA-ROOT.
- Containerize the edge runtime and introduce environment-safe configuration.
- Implement device registry, adapter identity, heartbeat, structured logs and basic health status.
- Implement local buffering, deduplication and idempotent delivery.
- Create protocol capture/replay tests using approved archived device sessions.
- Establish CI checks, artifact versioning and a signed deployment manifest.

**Exit gate:** A replayed device stream passes through FLORA-ROOT into the canonical ingestion API with traceable provenance.

### Sprint 3 — Priority device connectivity I

**Dates:** 26 October–6 November 2026
**Goal:** Prove reliable acquisition from the highest-value protocols.

Deliverables:

- Integrate the first priority lanes: GE Datex/CARESCAPE, Philips IntelliVue and native/gateway HL7.
- Normalize identifiers, units, timestamps, sample quality and connection state.
- Add clock-drift detection and source-versus-receive-time monitoring.
- Add automated tests for reconnect, duplicate messages, malformed data and late arrival.
- Display live connection and freshness status in an operations view.

**Exit gate:** Three protocol lanes run for eight hours with measured completeness, latency and recovery evidence.

### Sprint 4 — Priority device connectivity II and fleet operations

**Dates:** 9–20 November 2026
**Goal:** Turn adapters into a manageable service rather than a passive gateway.

Deliverables:

- Add Dräger MEDIBUS.X/IACS and the selected B. Braun or Fresenius pump lane.
- Implement centralized fleet inventory, heartbeat, log bundle and configuration version visibility.
- Add safe remote restart, staged update and rollback controls.
- Implement store-and-forward and recovery testing for a 60-minute hospital network interruption.
- Define device compatibility evidence: model, firmware/software, interface option, cable/network path and test result.
- Write first-line support runbooks and escalation rules.

**Decision gate 1:** Pillar 1 continues only if six protocol lanes demonstrate dependable recovery, traceability and supportability.

### Sprint 5 — Configuration platform and site packages

**Dates:** 23 November–4 December 2026
**Goal:** Separate reusable product behavior from hospital-specific configuration.

Deliverables:

- Define configuration schemas for parameters, chart layout, medication/fluid catalogues, terminology, forms, rules and reports.
- Create group, hospital, department and room inheritance with controlled local overrides.
- Create versioned site packages with validation, diff and rollback.
- Classify initial requirements as standard, configurable or isolated extension.
- Build a safe configuration preview and test-environment promotion workflow.

**Exit gate:** A controlled configuration change can be reviewed, promoted and rolled back without a frontend rebuild.

### Sprint 6 — Configurable OR workflow

**Dates:** 7–18 December 2026
**Goal:** Complete the core clinical journey on the configurable platform.

Deliverables:

- Configure case start, patient/device binding, induction, maintenance, emergence, transfer and case completion.
- Complete medication bolus, infusion, fluids, blood products, urine and blood-loss workflows.
- Implement role-aware actions, corrections, removal reasons and immutable audit history.
- Implement record completeness rules and missing-data indicators.
- Validate a 40-hour case with bounded chart rendering and aggregation at wider time scales.

**Exit gate:** Clinicians can complete a representative case with traceable device and manual data using the configured workflow.

### Integration and holiday buffer

**Dates:** 21 December 2026–1 January 2027

- Stabilize Sprints 1–6, resolve integration defects and improve documentation.
- Do not schedule a major new clinical capability in this period.

### Sprint 7 — Reports, forms and reusable discovery library

**Dates:** 4–15 January 2027
**Goal:** Convert discovery findings into reusable product assets.

Deliverables:

- Build the requirement library with source hospital, clinical rationale, classification and acceptance evidence.
- Add configurable clinical forms, report templates and rule packages.
- Implement a second-hospital configuration using the same product core.
- Measure how many differences require configuration, extension or core development.
- Add Thai/English terminology and presentation controls where required.

**Exit gate:** At least 80% of the agreed second-hospital differences are represented without a source-code fork.

### Sprint 8 — Hospital interoperability and digital trust

**Dates:** 18–29 January 2027
**Goal:** Connect FLORA to the enterprise hospital ecosystem securely.

Deliverables:

- Implement selected HL7 v2 ADT/order/result flows and reconciliation queues.
- Publish the first FHIR R4 capability statement and priority resources.
- Implement OIDC-based staff identity and role mapping.
- Implement SMART App Launch for user-context access where applicable.
- Implement a SMART Backend Services proof using asymmetric JWT authentication and scoped access.
- Establish the UDAP trust and registration design for future cross-organization exchange.
- Produce FHIR AuditEvent/Provenance and API access logs.

**Decision gate 2:** Pillar 2 is accepted when the complete OR journey is configurable, integrated, auditable and transferable to a second site.

### Sprint 9 — Historical data and governance foundation

**Dates:** 1–12 February 2027
**Goal:** Turn ten years of KCMH/NIT data into a governed learning asset.

Deliverables:

- Inventory datasets, permissions, retention limits and identifiable fields.
- Define de-identification/pseudonymization and approved research/quality use boundaries.
- Map historical data to the canonical longitudinal model.
- Create a versioned data dictionary and terminology mappings.
- Generate per-case quality scores for completeness, validity, temporal alignment and source confidence.
- Build lineage from source extract through curated dataset.

**Exit gate:** The first 100,000+ cases are ingested or indexed with lineage and measurable quality rather than treated as an unverified data dump.

### Sprint 10 — First intelligence use case

**Dates:** 15–26 February 2027
**Goal:** Build one useful, reviewable intelligence feature—not an AI showcase.

Recommended first use case:

- Start with **record completeness/data-quality intelligence** or an agreed retrospective clinical-risk use case with available outcome labels.

Deliverables:

- Document intended use, exclusions, users and clinical risk.
- Define cohort, outcome, labels, features and leakage controls.
- Establish training/validation splits by time and hospital.
- Record baseline performance and subgroup behavior.
- Create a model/version registry and reproducible evaluation report.
- Design the UI explanation and feedback mechanism.

**Decision gate 3:** No model proceeds unless clinical owners approve the intended use, data quality and evaluation plan.

### Sprint 11 — Shadow mode and operational validation

**Dates:** 1–12 March 2027
**Goal:** Evaluate intelligence and the complete platform without influencing patient care.

Deliverables:

- Run the approved intelligence feature in shadow mode.
- Compare outputs with actual outcomes and clinician review.
- Measure false positives, false negatives, subgroup behavior and calibration as appropriate.
- Implement performance and bias monitoring.
- Perform 40-hour chart, failover, restore, penetration and dependency-vulnerability tests.
- Exercise downtime, device replacement and edge recovery procedures.

**Exit gate:** The product has operational evidence, known limitations and a documented go/no-go recommendation.

### Sprint 12 — Pilot release, transfer and next roadmap

**Dates:** 15–26 March 2027
**Goal:** Deliver a supportable pilot release and prove the three-pillar story end to end.

Deliverables:

- Run the end-to-end demonstration: scheduled case → OR → live devices → complete record → hospital integration → governed learning pipeline.
- Finalize installation, operations, security, backup/restore and incident runbooks.
- Complete model cards, data dictionary, compatibility registry and configuration catalogue.
- Train hospital users, service/support staff and the receiving engineering team.
- Close or formally accept pilot risks and unresolved defects.
- Produce the next 12-month roadmap for broader device validation, additional hospitals and clinically deployed intelligence.

**Decision gate 4:** Pilot go-live requires joint clinical, product, engineering, security and hospital approval.

## Parallel workstreams

Each sprint should plan work across these lanes rather than handing the product sequentially from one team to another:

1. **Clinical product and discovery** — journey, requirements, terminology, acceptance and safety.
2. **Device and edge engineering** — adapters, FLORA-ROOT, fleet operations and physical validation.
3. **Platform and interoperability** — canonical model, APIs, HL7/FHIR, identity and audit.
4. **Clinical experience** — performant charting, workflows, configuration UI and reports.
5. **Data and intelligence** — historical mapping, quality, analytics and governed models.
6. **Quality, security and SRE** — automation, performance, HA/DR, vulnerabilities and operational evidence.

## Recommended team shape

For the full scope, plan approximately 10–13 dedicated people:

- 1 product lead and 1 clinical informatics lead
- 2–3 device/edge engineers
- 2 platform/interoperability engineers
- 2 frontend/workflow engineers
- 1–2 data/ML engineers
- 1 QA automation engineer
- 1 SRE/security engineer, shared if necessary

With a team of 5–7, reduce the pilot to one hospital, 3–4 protocol lanes, 10 exact device models and a data-quality intelligence use case. Do not remove safety, audit, testing or recovery work to preserve feature count.

## Sprint definition of done

A story is not complete until it has:

- Acceptance from its clinical or operational owner
- Automated tests and relevant device replay/physical evidence
- Audit, authorization and provenance behavior where applicable
- Metrics, logs and actionable failure states
- Performance evidence proportional to risk
- Upgrade and rollback behavior
- User, support and architecture documentation
- No unresolved critical security or patient-safety defect

## Weekly operating rhythm

- **Monday:** delivery planning and dependency review
- **Twice weekly:** clinical design/review session
- **Daily:** engineering coordination by workstream
- **Mid-sprint:** integrated build and device-lab checkpoint
- **End of sprint:** live demonstration using a clinical journey, not isolated tickets
- **Following morning:** retrospective, metrics review and roadmap adjustment

## Items deliberately outside the six-month commitment

- Physical certification of all 150+ catalogued device models
- Autonomous treatment recommendations or closed-loop device control
- Full replacement of every Hidro/Vector component
- Every hospital-specific report and workflow
- Production federation across the entire hospital group
- Formal regulatory certification unless separately scoped

These become credible next-stage investments only after the pilot demonstrates trustworthy acquisition, configurable delivery and governed learning.
