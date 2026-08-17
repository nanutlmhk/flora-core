# KCMH Technical Baseline Workshop
## Vendor Response Draft for Porjai Session (Aidas / Hidro / Anesthesia)

This draft answers the hospital workbook from the **Porjai / Anesthesia** scope only.

Important boundary:
- This response covers **Aidas**, **Hidro**, and the **device/data flow managed by Porjai**
- It does **not** claim ownership of hospital core infrastructure, enterprise network, VMware clusters, central backup platforms, PACS, LIS, or HIS internals unless explicitly noted
- For shared items, the best answer is often: **Porjai scope + KCMH IT to confirm hospital-side detail**

## Scope Summary

### Applications in Porjai scope

| Application | Purpose | Runtime model | Primary owner |
|---|---|---|---|
| Aidas | Anesthesia information and documentation system for OR case recording, charting, forms, and report generation | Electron desktop app on Windows workstation | Porjai |
| Hidro | Medical device middleware for bedside device capture and normalization | Windows local service + Electron tray UI | Porjai |

### Main functional flow

1. Medical devices send data to **Hidro**
2. Hidro normalizes and stores observations in local SQLite
3. **Aidas** reads Hidro local API for device observations
4. Aidas records perioperative documentation and stores case data in local SQLite
5. Aidas can also integrate with hospital-side HIS APIs or gateways for patient / blood / lab workflows where configured

## T-1 Infrastructure & Platform Capability

### 1. Application inventory

Suggested answer:

- **Aidas**
  - Function: anesthesia case documentation, medication/fluid charting, forms, report generation, selected HIS-assisted workflows
  - Client runtime: Windows desktop workstation
  - App stack: Electron + React frontend + Node backend
  - Database: local SQLite (`flora.db`)
  - External dependencies:
    - Hidro local API
    - HIS gateway / APIs where configured

- **Hidro**
  - Function: capture device data from anesthesia machine / patient monitor / infusion pump interfaces and expose them to downstream apps
  - Runtime: Windows background service / local Node service with Electron tray monitor
  - App stack: Node.js + Express + Electron tray
  - Database: local SQLite
  - External dependencies:
    - serial/TCP medical device connections
    - local workstation COM/USB stack

Status:
- Can answer now from vendor side

### 2. Server inventory

Suggested vendor answer:

- Porjai solution in current OR deployment is primarily **workstation-local**, not a central Porjai-hosted server cluster
- Typical local components:
  - Windows workstation hosting Aidas
  - Windows workstation or same station hosting Hidro
  - Local SQLite data stores
- Centralized hospital virtualization / enterprise server inventory is **KCMH IT scope**

Suggested status:
- **Partial**

### 3. VMware / virtualization cluster overview

Suggested answer:

- Not in Porjai operational ownership
- Aidas and Hidro typically run on Windows endpoint/workstation layer, not on Porjai-managed VMware infrastructure
- KCMH IT to confirm central virtualization landscape

Suggested status:
- **N/A from Porjai side**

### 4. Network topology diagram or overview

Suggested answer:

Porjai-side view:
- Medical device interfaces connect to Hidro through:
  - USB-to-serial adapters / COM ports
  - or TCP where applicable
- Aidas communicates to Hidro through local HTTP on `127.0.0.1:3000`
- Aidas may call hospital HIS gateway/API endpoints when configured

Hospital-side VLAN/firewall/network segmentation:
- KCMH IT to provide authoritative topology

Suggested status:
- **Partial**

### 5. Cloud services in use

Suggested answer:

- No AWS/Azure/cloud dependency is required for the standard local Aidas/Hidro runtime
- Current design is local workstation + local API + local SQLite
- If hospital uses cloud around surrounding systems, that is outside Porjai scope

Suggested status:
- **Available**

### 6. DR site overview

Suggested answer:

- No dedicated Porjai-managed secondary DR site for Aidas/Hidro application stack is currently bundled by default
- Recovery currently depends on:
  - application installer
  - workstation readiness
  - local database backup / restore process
- Any hospital-wide secondary site arrangement is KCMH IT scope

Suggested status:
- **Partial / to align with hospital DR policy**

### 7. Facilities / UPS / NOC / SOC / physical access

Suggested answer:

- Not under Porjai ownership
- Aidas/Hidro rely on the hospital workstation and facility environment provided at point of care
- KCMH IT / facilities team should answer UPS, generator, NOC, SOC, and physical data-center controls

Suggested status:
- **N/A from Porjai side**

### 8. Medical device inventory

Suggested answer:

Porjai-relevant device classes currently supported in product line include:
- Patient monitors
- Anesthesia machines
- Selected infusion pump integrations

For this anesthesia workshop, relevant live interfaces are:
- GE Bx50 / B650 family patient monitor integrations
- GE Aisys / Carestation family anesthesia machine integrations
- Selected infusion integration where deployed

Important note:
- Final per-room / per-device inventory and network segment assignment should be confirmed jointly with KCMH biomedical / IT

Suggested status:
- **Partial**

### 9. System lifecycle and renewal plans

Suggested answer:

- Aidas current package version in this repo lineage: `1.2.2`
- Hidro current package version in recent workstream: `1.2.2`
- Product maintenance is versioned and patch-based
- For workstation deployments, lifecycle risk is usually around:
  - Windows workstation health
  - USB-serial adapter stability
  - local database backup discipline
  - compatibility with device-side protocol variations

Hospital procurement / MA / renewal planning for non-Porjai systems:
- KCMH to confirm

Suggested status:
- **Partial**

### 10. Infrastructure operating model / support structure

Suggested answer:

Proposed support split:
- **L1**: hospital user / ward / OR super user reports issue
- **L2**: hospital IT / local technical coordinator checks workstation, network, login, printer, Windows environment
- **L3**: Porjai handles Aidas/Hidro application defects, integration logic, and device middleware issues
- Vendor/device escalation may be needed for:
  - medical device protocol behavior
  - USB-to-serial chipset/driver instability
  - third-party HIS interface issues

Suggested status:
- **Available as proposed model**

### 11. Server & infrastructure monitoring and alerting

Suggested answer:

- Hidro includes local diagnostics and service/device status monitoring in the tray UI
- It can expose local service health and device status through API
- It is **not** a full enterprise infrastructure monitoring platform
- Enterprise server/network monitoring should be answered by KCMH IT

Suggested status:
- **Partial**

### 12. Patching policy and procedure

Suggested answer:

- Aidas and Hidro are patched through controlled versioned releases
- Updates should be tested before production rollout
- Backup of local DB should be taken before upgrade
- Clinical rollout should avoid uncontrolled in-place updates without rollback path

Suggested status:
- **Available as vendor procedure**

### 13. Server-level backup

Suggested answer:

- Aidas and Hidro use local SQLite data stores
- Backup approach should at minimum include:
  - scheduled backup of local DB files
  - preservation of configuration files
  - ability to reinstall package and restore DB/config
- Enterprise backup tooling, offsite backup, and isolation policy are hospital-side decisions unless separately contracted

Suggested status:
- **Partial**

### 14. Infrastructure change management

Suggested answer:

- For Porjai-managed application changes, use controlled release versions and pre-upgrade backup
- Production changes should be logged by date, version, scope, and rollback plan
- Hospital infrastructure changes outside the application should be governed by KCMH IT

Suggested status:
- **Available as vendor-side procedure**

### 15. Vendor SLA — infrastructure vendors

Suggested answer:

- Porjai can answer only for Porjai application support scope
- Infrastructure SLAs for network/server/hypervisor/storage are KCMH IT / respective infrastructure vendor scope

Suggested status:
- **Not applicable from Porjai side**

## T-2 Database & Storage

### 1. Database inventory

Suggested answer:

| System | DB engine | Purpose | Host pattern | Notes |
|---|---|---|---|---|
| Aidas | SQLite | case records, local app data, master-data-assisted workflows | local Windows workstation | file-based local DB (`flora.db`) |
| Hidro | SQLite | device observations / middleware state | local Windows workstation | file-based local DB |

Suggested status:
- **Available**

### 2. EOL status per database engine

Suggested answer:

- Aidas and Hidro use SQLite, not Oracle / SQL Server / Informix for local runtime
- Hospital-side central databases for HIS/LIS/PACS are outside Porjai ownership

Suggested status:
- **Available for Porjai scope**

### 3. Backup policy overview

Suggested answer:

- For Porjai applications, the practical requirement is DB file backup plus config backup
- Recommended minimum:
  - daily backup of SQLite DB
  - backup before any application upgrade
  - retention policy to be agreed with hospital IT

Suggested status:
- **Partial**

### 4. Most recent DR test record

Suggested answer:

- No formal enterprise DR drill evidence is embedded in the product repository itself
- Porjai can support application reinstall + DB restore validation
- Full DR test history should be recorded jointly with KCMH if required operationally

Suggested status:
- **Gap / to define**

### 5. RTO / RPO targets vs actual

Suggested answer:

Proposed working targets for local workstation deployment:
- Aidas client reinstall / recovery: hours, not instant HA
- Hidro service restart: minutes if workstation and device links are healthy
- Data-loss tolerance depends on last successful local DB backup and runtime capture continuity

Important honesty note:
- Current architecture is not true HA / clustered / zero-loss DR architecture
- If the hospital needs formal RTO/RPO commitments, they should be agreed explicitly

Suggested status:
- **Needs formal agreement**

### 6. Storage hardware overview

Suggested answer:

- Porjai applications use local workstation storage by default
- No dedicated Porjai-managed SAN/NAS is assumed in base deployment
- Hospital enterprise storage should be answered by KCMH IT

Suggested status:
- **Partial**

### 7. In-progress database migration status

Suggested answer:

- No active DB engine migration is required for Aidas/Hidro local runtime in current scope
- HIS-side or laboratory-side migrations are hospital / other-vendor scope

Suggested status:
- **Available**

### 8. Database access control and privilege management

Suggested answer:

- Local workstation/database access is controlled primarily by workstation access and application/admin handling
- This is not equivalent to enterprise centralized DBA privilege separation
- If stricter DB governance is required, architecture would need enhancement beyond current local SQLite deployment

Suggested status:
- **Partial / architecture limitation**

### 9. Database performance monitoring

Suggested answer:

- No separate enterprise DB monitoring stack is bundled for local SQLite deployment
- Performance issues are usually surfaced at application behavior level

Suggested status:
- **Available with limitation**

### 10. Database major/minor upgrade plan

Suggested answer:

- SQLite engine is embedded at application runtime level
- Application release management matters more than classic enterprise DB version management in this scope

Suggested status:
- **Available**

## T-3 Integration & Interoperability

### 1. Interface / integration methods & confirmation

Suggested answer:

Porjai-side integration methods include:
- Hidro local REST API to Aidas
- Serial device integration via Hidro
- TCP/HL7 ingestion where configured
- HIS API / gateway calls from Aidas where configured

Examples visible in current source:
- Hidro local health/status API on port `3000`
- Aidas backend reads Hidro observations from local API
- Aidas backend supports HIS gateway integration for patient/blood/lab workflows

Suggested status:
- **Available**

## T-4 Data, Analytics & AI Capability

### 1. Data platform in use

Suggested answer:

- **Current state:** Aidas and Hidro operate on local workstation databases for operational clinical workflow support
- **Committed target state:** Porjai plans to implement a **central PostgreSQL database** hosted in KCMH IT infrastructure as the shared consolidation layer
- The central platform is intended to support:
  - enterprise reporting
  - cross-room / cross-case analytics
  - downstream integration
  - future ML / AI use cases
- The local workstation runtime will remain in place for bedside resilience, while the central PostgreSQL database becomes the institutional reporting and analytics layer

Suggested status:
- **Committed future-state architecture; pending KCMH IT infrastructure readiness**

### 2. BI or analytics tools

Suggested answer:

- **Current state:** Aidas focuses on clinical documentation and report generation rather than enterprise BI
- **Future direction:** once the central PostgreSQL layer is established, KCMH can connect BI/reporting tools such as Power BI, Tableau, or equivalent hospital analytics tools to the centralized dataset
- Porjai commitment is to structure the exported central data so it is usable for reporting and future analytics, rather than leaving data only in isolated workstation-local stores

Suggested status:
- **Planned via central data platform**

### 3. Known data quality issues

Suggested answer:

Known operational risks tend to be around:
- upstream device connectivity instability
- USB-to-serial adapter behavior
- incorrect mapping or missing upstream identifiers from external systems
- integration edge cases when HIS payload patterns change

Suggested status:
- **Available as operational notes**

### 4. Data governance ownership

Suggested answer:

- Clinical source-of-truth governance remains primarily with hospital systems and workflow owners
- During active-case operation, Aidas local runtime remains the operational source for perioperative capture
- Under the committed target architecture, centralized PostgreSQL will act as the governed institutional copy for analytics/integration purposes
- Formal enterprise data governance, access approval, and policy ownership should be established jointly with KCMH IT / data governance stakeholders

Suggested status:
- **Shared model; target architecture defined**

### 5. Unstructured data volume

Suggested answer:

- Not a core Aidas/Hidro capability in current base scope
- DICOM/PACS storage should be answered by hospital or imaging vendors

Suggested status:
- **N/A**

### 6. AI or ML tools deployed

Suggested answer:

- **Current state:** no AI/ML functionality is part of the current Aidas/Hidro base deployment
- **Committed direction:** the central PostgreSQL architecture is being proposed specifically so that future ML / AI work can be supported on a governed, consolidated dataset instead of fragmented workstation-local databases
- This means Porjai is not presenting AI as active today, but is committing to an architecture that is compatible with future model development, feature engineering, and retrospective analytics

Suggested status:
- **Future-ready architecture committed**

### 7. Data retention policy

Suggested answer:

- Local SQLite retention/archival should be aligned with hospital policy
- Hidro includes configurable retention behavior for observations
- Under the target architecture, central PostgreSQL retention, archival, and recovery policy should be governed centrally by KCMH IT / policy owners
- Porjai can align export/synchronization behavior with the approved hospital retention model once central policy is defined

Suggested status:
- **Partial; central policy pending**

### 8. Data access control and audit logging

Suggested answer:

- **Current state:** workstation-centric runtime control is available, but this is not yet the same as a hospital-wide enterprise IAM / audit platform
- **Target state:** once central PostgreSQL is deployed in KCMH IT infrastructure, access control, role separation, audit logging, and analytics access can be governed more centrally
- This is one of the main reasons Porjai is proposing the central data architecture as a core future-state commitment

Suggested status:
- **Committed improvement path**

## T-7 Clinical Continuity & Downtime Management

### 1. Downtime procedures per critical system

Suggested answer:

For Porjai scope, downtime handling today is practical rather than fully formalized enterprise DR:
- Hidro service can be restarted locally
- device communication can be reconnected/reset locally
- Aidas can continue with local workstation operation where data path is available
- manual fallback may still be needed if workstation or device middleware is unavailable

Suggested status:
- **Partial**

### 2. Paper-based or manual fallback workflows

Suggested answer:

- Clinical manual fallback should remain available at hospital level
- Porjai application should not be treated as the only continuity plan in a full outage

Suggested status:
- **Hospital clinical governance + vendor acknowledgement**

### 3. DR drill history

Suggested answer:

- No formal DR drill record is available from repo source alone
- Can propose application recovery simulation if KCMH wants one

Suggested status:
- **Gap / to define**

### 4. Recovery prioritisation sequence

Suggested answer:

Porjai-side operational sequence would usually be:
1. Workstation usable
2. Hidro service healthy
3. Device connectivity restored
4. Aidas local runtime healthy
5. HIS-facing integrations restored

Suggested status:
- **Available as vendor proposal**

### 5. Planned maintenance communication process

Suggested answer:

- Vendor application updates should be scheduled with prior notice
- DB backup should be taken before update
- rollback version should be identified before production rollout

Suggested status:
- **Available**

### 6. Clinical staff awareness of downtime procedures

Suggested answer:

- This should be jointly answered with KCMH operational leadership
- Vendor can support training material for Aidas/Hidro behavior, but hospital must own clinical downtime process adoption

Suggested status:
- **Shared**

## Recommended Positioning in the Workshop

To keep the meeting clean and credible, Porjai should answer in this pattern:

- `In vendor scope`: answer directly and concretely
- `Shared with hospital IT`: answer the Porjai part, then ask KCMH IT to complete the hospital-side controls
- `Outside vendor scope`: say so clearly instead of guessing

## Honest Gaps We Should Not Hide

- Current Aidas/Hidro architecture is **workstation-centric**, not enterprise HA
- USB-to-serial stability is a real operational risk in some deployments
- Backup/restore discipline matters a lot because runtime data is local
- Formal RTO/RPO, centralized monitoring, and enterprise-grade IAM/audit are not fully solved by the base deployment alone

## Suggested Next Output

From this draft, we can produce either:

1. a **hospital-facing answer sheet** mapped row-by-row to the Excel workbook, or
2. a **speaker note version** for your workshop call, with short verbal answers per question

## Core Target Architecture Proposal

Porjai proposes this as the **core future-state architecture** for Aidas/Hidro data management, subject to KCMH IT infrastructure readiness and policy approval.

### Architecture direction

- Keep **Aidas/Hidro local runtime** at point of care for bedside resilience
- Add a **central PostgreSQL database** hosted on KCMH IT VM infrastructure, proposed on `10.35.202.6`
- Use the central database as the **shared reporting / integration / analytics / ML-ready layer**
- Do **not** make bedside capture depend on central database availability

### Operating principle

- **Local runtime remains operational source** during the active case
- **Central PostgreSQL becomes the consolidated enterprise copy**
- HIS remains source of truth for its own domains
- Central sync is **eventually consistent**, not hard realtime

### Proposed sync model

1. **Near-real-time incremental sync**
   - Sync every 5 minutes when network is available
   - Push only new or changed case/device data

2. **End-of-case sync**
   - When user discharges, closes, or archives the case
   - Push the final case snapshot and timeline

3. **Nightly reconciliation**
   - After midnight, recheck recent cases
   - Re-sync anything incomplete, failed, or changed

4. **Manual re-sync**
   - Admin/support can force re-export for one case when needed

### Why this model is preferred

- OR workflow does not stop when network is unstable
- Temporary LAN/WAN outage does not block charting
- Central data still becomes available for reporting and future ML
- Reconciliation helps recover missed sync windows automatically
- Hospital IT can govern central storage, access, backup, and policy centrally

### Central database role

The central PostgreSQL database should be used for:

- cross-room and cross-period reporting
- enterprise integration
- analytics and dashboarding
- future ML / feature engineering
- audit-friendly consolidated storage

### Suggested schema direction

Use a **normalized clinical warehouse model** such as snowflake or equivalent, for example:

- Fact tables:
  - `fact_observation`
  - `fact_medication_event`
  - `fact_fluid_event`
  - `fact_case_timeline`
- Dimension tables:
  - `dim_patient`
  - `dim_case`
  - `dim_room`
  - `dim_device`
  - `dim_parameter`
  - `dim_provider`
  - `dim_drug`
  - `dim_fluid`
  - `dim_time`

Recommended supporting tables:

- raw sync batch log
- sync status / watermark per case
- retry / failure audit table
- export version or checksum table

### Dependency on KCMH IT

This architecture is ready in principle from the application side, but depends on KCMH IT to complete:

- network path and allowed connectivity
- VM/server provisioning
- PostgreSQL hosting standard
- security policy and access control model
- backup / retention / DR policy
- production change and operational ownership model

### Recommended wording for workshop

Porjai can position this as:

> The target architecture is to keep Aidas/Hidro operational locally for patient-care resilience, while synchronizing to a central PostgreSQL database in KCMH IT infrastructure for reporting, integration, governance, and future analytics/ML. The remaining dependency is hospital infrastructure readiness, network policy, and central platform approval.
