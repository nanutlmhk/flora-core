# FLORA Six-Month Lean Roadmap

**Authoritative plan for the current team**
**Target period:** 28 September 2026–26 March 2027
**Cadence:** Twelve two-week sprints with a year-end stabilization buffer

## Actual capacity

| Contributor | Available role |
|---|---|
| **Three core developers** | Full-time delivery. Each owns one stable workstream; one developer also acts as delivery lead. |
| **Nanut** | Part-time product, clinical and architecture authority—maximum 20 hours/month or approximately 4–5 hours/week. |
| **P'Sup / CEO** | Direction, commercial priority and four formal decision gates—not sprint-level management. |

Three developers provide roughly 360 raw developer-days across six months. After delivery leadership, support, defects, meetings, integration and testing, plan against approximately **230–260 effective developer-days**. If the developers must also support live customers, reduce sprint commitments by their actual support allocation.

Developers with three to five years of experience can own well-bounded capabilities, but the plan must give them stable contracts, clear acceptance criteria and fast decisions. It must not depend on daily intervention from Nanut or P'Sup.

## Honest six-month promise

At the end of six months, FLORA will demonstrate two dependable clinical slices at one pilot hospital: a complete OR journey and a focused ICU journey using the same clinical data platform.

> **OR:** Scheduled case → patient enters OR → priority devices → live chart and I/O/medication workflow → completed record → secure hospital/API exchange.

> **ICU:** ADT/admission → bed and device association → continuous observations → flowsheet/I&O/medication context → shift handover or transfer → central Canopy review.

Both journeys feed the same governed data-quality and learning loop.

This is a **foundation release**, not completion of all three pillars.

| Pillar | Six-month commitment |
|---|---|
| **1. Clinical Data as a Service** | Strongest investment. Deliver a supportable FLORA-ROOT v1 with three priority protocol lanes, heartbeat, logs, buffering and recovery. |
| **2. Configurable Clinical Workflow** | Deliver one complete OR workflow plus a focused ICU workflow, proving that both use shared services and versioned configuration rather than separate products or source-code forks. |
| **3. Clinical Intelligence and AI** | Deliver governed historical-data ingestion, case quality scoring and one data-quality/completeness insight in shadow mode. Clinical prediction is deferred. |
| **Enterprise foundation** | Deliver the minimum safe slice: identity, scoped APIs, audit/provenance, backup/restore, operational monitoring and a 40-hour performance test. |

## Six-month success measures

### Pillar 1

- Three priority protocol lanes selected from the devices actually accessible to the team.
- Eight to ten exact device models validated physically or through approved captured-data replay.
- Connection heartbeat and stale-data alert within five minutes.
- Accepted events survive a 60-minute central-network outage through store-and-forward.
- Support staff can see device, adapter, software/configuration version and recent actionable errors.
- Safe remote service restart is available; full remote OTA orchestration is a later release.

### Pillar 2

- One complete OR journey from case preparation through case completion.
- One focused ICU journey covering admission/transfer, bed and device association, continuous trends, flowsheet context, I/O, medication context and shift handover.
- Chart, medication bolus, medication drip, fluids, blood products, urine and blood loss function together.
- At least 70% of the agreed variation for a second site/profile is represented through configuration.
- Configuration is versioned, validated and reversible.
- No separate customer source-code fork.
- Leaf remains the clinical-write surface; Canopy remains a central read-only view of synchronized cases, ICU census, bed/device state, trends and data freshness.

### Pillar 3

- Historical cases are catalogued with permission, lineage and a data dictionary.
- A representative cohort is mapped to the canonical clinical model; scale to 100,000+ cases only if source quality and extraction permit it without delaying the pilot.
- Each processed case receives completeness, validity and temporal-alignment scores.
- One data-quality/completeness insight runs in shadow mode.
- No autonomous clinical recommendation or production predictive model is promised.

### Enterprise foundation

- One protected FHIR R4 API slice with OAuth 2.0/OIDC and scoped authorization.
- One SMART Backend Services proof for system-to-system access.
- HL7 v2 integration only for the messages required by the pilot.
- UDAP architecture and trust-registration plan documented; production UDAP federation is deferred.
- Audit and provenance for clinical changes and API access.
- A 40-hour case test remains responsive and bounded in browser memory.
- A seven-day ICU replay remains queryable through aggregation and does not attempt to render every raw sample simultaneously.
- Backup/restore and edge reconnection are exercised before pilot approval.

## OR, ICU, Leaf and Canopy boundary

| Surface | Six-month responsibility |
|---|---|
| **Flora Leaf — OR** | Clinical entry, live device data, anesthesia chart, medications, fluids/I&O, events, handoff and case completion. |
| **Flora Leaf — ICU** | Patient/bed/device association, continuous observation, flowsheet context, I/O and medication context, shift handover and transfer/discharge state. |
| **Flora Canopy** | Central read-only ICU/OR census, active cases, Leaf health, synchronization freshness, bed/device status, longitudinal trends and remote clinical review. |
| **Leaf-to-Canopy sync** | Idempotent incremental snapshots, source identity, freshness, retry, provenance and safe recovery. Canopy does not connect directly to Leaf databases and receives no clinical-write credentials. |

The six-month ICU slice is not a complete ICU information system. Care plans, nursing documentation breadth, order entry, eMAR replacement, advanced alarm management and every ICU report require later discovery and delivery.

## Team operating model

### Stable ownership

| Role | Primary ownership | Secondary ownership |
|---|---|---|
| **Developer A — delivery lead / edge** | FLORA-ROOT, device adapters, deployment and sprint coordination | Backend review and operations |
| **Developer B — clinical experience** | Shared React UI, OR workflow, focused ICU workflow, chart performance and configuration UX | End-to-end tests and Canopy viewer UX |
| **Developer C — platform/data** | Canonical model, APIs, database, Leaf-to-Canopy sync, HL7/FHIR, historical pipeline and automation | QA infrastructure and observability |
| **Nanut** | Product priority, clinical decisions, architecture boundaries and acceptance | High-risk design/code review and stakeholder alignment |
| **P'Sup** | Business priority, budget and pilot go/no-go | Executive escalation |

Use the strongest organizer as delivery lead; do not automatically choose by title or tenure. Allocate approximately 70% of that developer's time to engineering and 30% to integration, backlog readiness and unblocking.

### Nanut's 20-hour monthly budget

| Activity | Monthly maximum |
|---|---:|
| Two sprint planning/priority sessions | 3 hours |
| Two integrated demonstrations and acceptance decisions | 3 hours |
| Architecture and high-risk code/design review | 6 hours |
| Clinical/stakeholder clarification | 4 hours |
| Written decision memos and emergency buffer | 4 hours |
| **Total** | **20 hours** |

Questions must be batched into a written decision memo with context, recommendation, alternatives and decision deadline. Do not consume Nanut's time through continuous chat questions or routine implementation approval.

### CEO decision model

P'Sup participates in four short gates only:

1. **Sprint 1:** approve pilot, success measures and scope exclusions.
2. **Sprint 4:** approve device-service proof and continued investment.
3. **Sprint 8:** approve workflow/integration pilot scope.
4. **Sprint 12:** pilot go/no-go and next-stage investment.

## Scope discipline

Each sprint has:

- One integrated sprint outcome
- At most one primary deliverable per developer
- A maximum of three concurrent implementation stories
- **60% planned roadmap work**
- **20% integration, testing, support and defects**
- **10% protected P'Sup requirement capacity**
- **10% contingency for unknowns and recovery**
- No new story entering the sprint unless another story leaves

### P'Sup requirement capacity

- Reserve approximately 10% of total team capacity, equivalent to about one small developer story per sprint or 23–26 effective developer-days over six months.
- The slot may be used for commercial commitments, urgent customer discovery or a strategically important demonstration.
- P'Sup ranks requests at the monthly executive gate; the delivery lead converts the chosen request into acceptance criteria.
- An unused slot returns to the highest-priority roadmap item at the end of the sprint; it is not filled early with speculative work.
- A request larger than three developer-days must explicitly replace a roadmap deliverable. It cannot be hidden inside the reserve.
- Patient safety, data integrity and regulatory/security fixes take precedence over the executive reserve.

### P'Sup product input from 22 September 2026

The supplied PCM LIFE material is treated as product-discovery evidence, not as an instruction to duplicate another product. It identifies two requirement groups.

#### Medical-device acquisition patterns

FLORA should use one normalized adapter contract while supporting three deployment routes:

1. **Direct gateway** — a device or native interface pushes directly to FLORA-ROOT.
2. **Relay gateway** — FLORA receives from a vendor central monitor, CMS or gateway when direct device access is unavailable.
3. **Bridge/SDK client** — a local Linux/Android/Windows bridge or vendor SDK connects legacy/proprietary devices and forwards normalized events.

Month 2 must demonstrate the common health, buffering, provenance and recovery behavior across the selected routes. The team does not build three separate data platforms.

#### ICU/ward product capabilities

The supplied screens identify these candidate capabilities:

- Central patient monitoring and mobile/bedside view
- Flowsheet
- Nurse notes and medication context
- SOS/early-warning score
- ECG review and printout
- Patient/case summary report

The focused ICU roadmap already covers patient/bed/device context, continuous observations, flowsheet context, medication context, handover and Canopy visibility. P'Sup's protected requirement capacity selects an additional demonstrable vertical slice from the remaining capabilities.

**Recommended six-month strategic slice:** configurable SOS score + nurse note + patient summary surfaced in Leaf and read-only Canopy. ECG printout and a dedicated mobile client remain optional substitutions or later scope unless P'Sup explicitly trades out another roadmap outcome.

## Twelve-sprint lean plan

### Sprint 1 — Choose the OR and ICU proof

**Dates:** 28 September–9 October 2026

- Choose one pilot hospital, one OR journey, one focused ICU journey and the accessible device set.
- Select three protocol lanes and eight to ten exact device models.
- Select devices that maximize reuse across OR and ICU rather than creating separate protocol backlogs.
- Map the current code and preserve working adapter knowledge.
- Approve the canonical event envelope and six-month measures.
- Establish a single prioritized backlog, automated build and integration environment.

**Gate:** Nanut and P'Sup approve the pilot charter and explicit exclusions.

### Sprint 2 — Stabilize the common path

**Dates:** 12–23 October 2026

- Define the adapter-to-FLORA-ROOT contract.
- Add device identity, source/receive time, quality and provenance.
- Add structured logs, health endpoint and basic metrics.
- Create captured-data replay tests for the selected protocols.
- Pass one replayed stream end to end into the current FLORA UI/API.
- Confirm the Leaf write boundary, Leaf-to-Canopy snapshot contract and Canopy read-only enforcement.
- Define how direct, relay/CMS and bridge/SDK routes enter the same FLORA-ROOT adapter contract.

### Sprint 3 — Device lane one

**Dates:** 26 October–6 November 2026

- Productionize the most valuable and accessible protocol lane.
- Handle disconnect, reconnect, duplicates, malformed frames and timestamp drift.
- Expose connection/freshness status to support staff.
- Record exact device-validation evidence.

### Sprint 4 — Device lanes two and three

**Dates:** 9–20 November 2026

- Add the remaining two selected lanes using the common adapter contract.
- Implement local buffering and store-and-forward.
- Add safe service restart and diagnostic bundle retrieval.
- Test a 60-minute network outage and eight-hour multi-device run.
- Demonstrate at least two applicable acquisition routes—direct, relay/CMS or bridge/SDK—without changing the canonical downstream data contract.

**Gate:** Continue only if the three lanes are supportable and recoverable. Do not add more protocols merely to increase the compatibility number.

### Sprint 5 — Shared OR/ICU configuration boundary

**Dates:** 23 November–4 December 2026

- Identify shared and different OR/ICU requirements for chart parameters, observation frequency, medication/fluid catalogues, layout, terminology, rules and reports.
- Define a small versioned site-profile schema.
- Support department/workflow profiles so OR and ICU inherit the same hospital configuration with controlled differences.
- Move the highest-value hard-coded settings behind that schema.
- Add validation and a human-readable configuration diff.

### Sprint 6 — One complete OR workflow

**Dates:** 7–18 December 2026

- Integrate case lifecycle, chart, medication bolus/drip and fluid balance.
- Complete edit/remove audit behavior.
- Add missing/stale data states and record-completeness checks.
- Run the first 40-hour chart performance test and fix the largest bottleneck.

### Year-end stabilization buffer

**Dates:** 21 December 2026–1 January 2027

- Fix integration defects and test the combined journey.
- Improve runbooks and backlog readiness.
- Do not introduce a major new subsystem.

### Sprint 7 — Focused ICU workflow and Canopy

**Dates:** 4–15 January 2027

- Add ICU admission/transfer, patient-bed-device association and shift-handover state.
- Reuse shared observation, I/O and medication-domain services rather than copying OR components.
- Extend Canopy with central read-only census, active Leaf/bed/device state, synchronization freshness and longitudinal trend access.
- Add aggregated/downsampled queries suitable for multi-day ICU stays.
- Create a second department/site profile using the same application build.
- Add configuration version, promotion and rollback; measure what still requires code.
- Use the protected P'Sup slot for the selected strategic slice; default recommendation is configurable SOS score, nurse note and patient summary unless another requirement is explicitly chosen.

### Sprint 8 — Secure hospital integration slice

**Dates:** 18–29 January 2027

- Implement only the required HL7 v2 pilot messages.
- Include the ADT events needed for both OR case context and ICU admission/transfer/discharge/bed movement.
- Publish one useful FHIR R4 API slice.
- Add OAuth 2.0/OIDC identity and scoped API access.
- Demonstrate SMART Backend Services with asymmetric credentials.
- Produce API/clinical AuditEvent or equivalent audit evidence.
- Document the later UDAP deployment model.

**Gate:** Approve the pilot workflow only if OR and the focused ICU slice are integrated, auditable, visible through the correct Leaf/Canopy boundary and transferable without a customer code fork.

### Sprint 9 — Governed historical-data slice

**Dates:** 1–12 February 2027

- Inventory source datasets, permissions and identifiable fields.
- Define de-identification/pseudonymization boundaries.
- Map a representative cohort to the canonical model.
- Create a small versioned data dictionary and lineage report.
- Generate initial completeness, validity and temporal-alignment measurements.

### Sprint 10 — Useful intelligence without clinical risk

**Dates:** 15–26 February 2027

- Implement case data-quality/completeness scoring.
- Show why a case or field is flagged.
- Add a feedback mechanism for clinical review.
- Run against historical cases and record accuracy/coverage.
- Scale the pipeline only after correctness is established.

### Sprint 11 — Integrated rehearsal

**Dates:** 1–12 March 2027

- Rehearse the complete journey with devices or approved replay.
- Rehearse OR case completion and ICU admission-to-handover/transfer, including Canopy synchronization and stale/offline states.
- Exercise outage, reconnect, backup/restore and device replacement.
- Run the 40-hour load/soak test.
- Run a seven-day accelerated ICU replay and verify bounded queries, aggregation and UI memory.
- Resolve critical security, safety, data-loss and performance defects.
- Prepare operator, developer and hospital-user runbooks.

### Sprint 12 — Pilot package and transfer

**Dates:** 15–26 March 2027

- Demonstrate the full OR journey, focused ICU journey, Canopy central review and post-case learning flow.
- Deliver compatibility evidence for the validated devices.
- Deliver site profiles, API documentation, audit evidence and operational dashboards.
- Train the receiving team and first-line support.
- Produce a risk-based go/no-go recommendation and the next 12-month backlog.

**Gate:** P'Sup, Nanut and the hospital owner decide pilot release and next investment.

## Backlog priority order

When capacity is lost, cut from the bottom—not from safety or reliability:

1. Correct patient/device association and trustworthy clinical data
2. Recovery, observability and audit
3. Complete core OR journey
4. Focused ICU journey and trustworthy Leaf-to-Canopy visibility
5. Versioned configuration and second profile
6. Required hospital integration and protected API
7. Historical data quality and completeness insight
8. P'Sup's selected strategic requirement within the protected budget
9. Additional reports and UI polish
10. Additional device protocols
11. Predictive modeling

## Explicitly deferred

- Validation of every model in the 150+ compatibility catalogue
- More than three protocol lanes during the initial commitment
- Generic no-code workflow builder
- Full multi-hospital production tenancy
- Full ICU clinical information system scope, eMAR replacement and advanced alarm management
- Production UDAP federation
- Large FastAPI/MongoDB rewrite solely for technology consistency
- Remote autonomous hotfixing of hospital infrastructure
- Predictive bedside alerts or autonomous clinical agents
- Full regulatory certification unless separately funded and staffed

## Primary staffing risk

The greatest risk is not developer seniority; it is the absence of an available daily decision-maker. The delivery lead needs authority to make reversible implementation decisions inside approved architecture boundaries. Nanut should be interrupted only for clinical risk, irreversible architecture, external commitments or scope trade-offs.

If the team repeatedly remains blocked despite batched decisions, add a part-time senior technical lead for 8–12 hours/week before adding more features. That role would improve throughput more than a fourth junior developer.
