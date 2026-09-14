# FLORA Architecture and Technical Brief

Prepared as speaker support material for RCAT committee discussion.

This document is written for clinicians and decision-makers who want to understand how FLORA works technically, without requiring a software engineering background.

## 1. What FLORA is

FLORA is a local anesthesia information and documentation system designed to support intraoperative anesthesia recording in real clinical workflow.

Its main purpose is to combine:

- anesthesia case identification
- vital sign capture
- anesthetic agent capture
- drug and fluid documentation
- blood product documentation
- clinical forms
- staff assignment
- printable anesthesia report generation

In simple terms, FLORA is a digital anesthesia record platform built around the anesthesia case itself.

## 2. Core design philosophy

The technical architecture of FLORA follows a few practical principles:

### 2.1 Local-first

FLORA is designed to run on the workstation in the operating room.

This means:

- the active case can continue even if hospital network integration is unavailable
- the anesthesia record is not dependent on a permanent internet connection
- bedside workflow is not blocked by central server problems

This is important in the operating room because documentation reliability is more important than architectural elegance.

### 2.2 Case-centered

Every important data element belongs to one anesthesia case:

- patient identifiers
- vital sign timeline
- agent timeline
- medication and fluid records
- blood product records
- events and notes
- forms
- staff
- final report

This makes FLORA easier to review clinically and easier to audit technically.

### 2.3 Manual and automatic documentation must coexist

FLORA is not based on the assumption that all data can be automated.

The system allows:

- direct manual entry
- device-assisted capture through Hidro
- mixed workflow in the same case

This is necessary because real operating room workflow is variable. Some rooms have monitor integration, some cases need manual correction, and some hospitals have partial integration only.

### 2.4 Fast clinical feedback loop

FLORA was built so that real-user feedback can quickly become a software improvement.

This is both a workflow principle and an architectural principle. The codebase is organized so that changes to forms, timeline behavior, report output, and local workflow can be adjusted without needing a large external vendor change cycle.

## 3. High-level architecture

FLORA desktop currently has four major layers:

### 3.1 User interface layer

The user interface is built with:

- React
- TypeScript
- Vite

This layer provides:

- chart view
- fluid and medication view
- diagnosis and procedure view
- form view
- staff view
- patient view
- report view
- management view
- history view

### 3.2 Desktop shell

The desktop container is built with:

- Electron

Electron is used to:

- run FLORA as a Windows desktop application
- open the frontend in a controlled desktop environment
- launch the backend together with the application
- support packaging as a Windows installer
- support PDF report generation workflow

### 3.3 Backend application layer

The backend is built with:

- Node.js
- Express

This layer provides:

- case APIs
- event APIs
- medication and fluid APIs
- form APIs
- HIS-related APIs
- report data assembly
- minute writer control
- authentication routes

### 3.4 Local database layer

The local database is:

- SQLite
- implemented with `better-sqlite3`

This database stores:

- cases
- users
- staff assignments
- allergies
- clinical forms
- timeline minutes
- events
- medication and fluid runs
- blood product records
- master data

## 4. External integration role of Hidro

Hidro is the device-integration companion service used by FLORA.

Its role is different from FLORA:

- Hidro receives and normalizes device data
- FLORA records the anesthesia case and presents the clinical workflow

In practical terms:

- monitor and machine data enter through Hidro
- FLORA reads the resulting observations
- the minute writer converts those observations into structured minute records for the active case

This separation is useful because:

- device integration changes more often than clinical documentation structure
- vendor-specific parameter mapping can stay in the integration layer
- FLORA can remain focused on the anesthesia record

## 5. Minute writer and timeline model

One of the most important technical components in FLORA is the minute writer.

Its role is to retrieve recent device observations and write structured minute-level case data into the local database.

### 5.1 Current behavior

From the current codebase:

- default poll interval is 1 second
- fetch timeout is 5 seconds
- bulk catch-up is triggered when the system is more than 5 minutes behind

This does not mean the system is intended as a real-time waveform monitor.

Instead, it means:

- FLORA continuously checks for available observation data
- it converts device observations into case minute records
- it backfills safely if the writer falls behind

### 5.2 Why this matters clinically

This design supports the clinical reality that:

- users may not look at the screen every second
- documentation still needs to stay current over the case
- temporary delay should recover automatically rather than permanently losing minutes

## 6. Data model overview

The main FLORA data model can be explained as several groups.

### 6.1 Case table

Each case stores:

- case identifier
- HN
- start time
- device capture start time
- discharge time
- archive time
- status

Case status can move through:

- active
- discharged
- archived

### 6.2 Timeline minute table

The timeline minute table stores structured vital and device-derived minute data for each case.

This is the main source for:

- time chart display
- report chart generation
- printed anesthesia timeline

### 6.3 Event table

Events are used for clinical moments such as:

- start anesthesia
- start surgery
- time out
- induction
- blood product workflow events
- notes

Events are important because many clinically meaningful moments are not just numeric vital signs.

### 6.4 Medication and fluid tables

FLORA separates:

- one-time entries such as bolus or output events
- running entries such as drips

This distinction allows:

- bolus documentation
- drip start and stop
- rate changes
- fluid balance calculation
- report rendering of continuous lines

### 6.5 Form data

Form data is stored in a structured key-value style that allows adaptation over time.

This has supported recent workflow changes such as:

- PNB restoration
- merged line workflow
- multiple IV lines
- arterial line details
- central line details
- expanded extubation information

## 7. Line workflow structure

The current direction of the line form reflects user feedback from real cases.

Instead of separating line concepts in a way that feels technical, FLORA now treats them clinically under one Line tab with three sections:

- IV line
- arterial line
- central line

This matches how clinicians think in practice:

- all are lines
- but they need different levels of detail

Technically, this structure still allows richer data for arterial and central lines while keeping IV line entry simpler.

## 8. Blood product architecture direction

Blood product workflow is technically different from ordinary fluid entry.

The reason is that blood documentation has two roles:

- intake documentation
- traceable safety workflow by bag

The current and proposed architecture discussions therefore separate:

- official blood bank or HIS information
- local FLORA case status and documentation

The architectural principle is:

- HIS owns official bag identity and availability
- FLORA owns intraoperative case-level status and documentation

This is particularly important in operating room workflow because:

- multiple bags may be used in one case
- additional bags may be requested during the case
- the system needs both overview and bag-level traceability

## 9. Report generation architecture

FLORA generates the anesthesia report from structured local case data.

Current report generation uses:

- frontend report preparation
- Electron desktop environment
- PDF generation through `pdf-lib`

The report is built from:

- minute timeline data
- events
- fluid and medication data
- blood product data
- staff
- form summaries

This architecture allows the report to be:

- reviewable before final use
- printable locally
- adjusted when form structure or timeline logic changes

Recent practical improvements have included:

- more space for events and notes
- improved line summary display
- correction of missing event output
- better handling of drip markers in timeline output

## 10. Authentication and user model

FLORA includes a local authentication layer.

The system stores:

- username
- password hash and salt
- name
- role
- theme preference
- activity status

This allows role-aware workflow without requiring a central identity system for basic operation.

This is useful for:

- operating room deployment
- offline-capable local use
- gradual rollout in hospitals that do not yet have full enterprise identity integration

## 11. Runtime and deployment model

Current packaged deployment works as a Windows desktop application.

Important practical notes from the current codebase:

- FLORA is packaged as an Electron installer
- the frontend is bundled into the desktop application
- the backend is started locally when FLORA runs
- the backend default port is `3001`
- the local database path in packaged mode is under the Porjai data folder, typically `C:\porjai\data\flora.db`

### Current Node.js expectation

At the current state of this repo, the packaged desktop shell expects Node.js to be available on the client workstation in order to start the backend process.

This is an important operational point and should be stated honestly in technical discussion.

In other words:

- the user experiences FLORA as one desktop app
- but internally, the Electron shell launches a local Node backend process

## 12. Why SQLite was chosen

SQLite is suitable for the current local-first FLORA model because:

- it is lightweight
- it is easy to deploy in a single-room workstation model
- it supports local reliability
- it avoids immediate dependence on central database availability

The current configuration uses:

- WAL mode
- busy timeout
- foreign keys
- normal synchronous mode
- enlarged local cache

This reflects a design choice toward practical workstation stability rather than centralized complexity.

## 13. Safety and reliability mechanisms

Several architecture decisions are clearly aimed at reliability:

- startup recovery behavior in Electron
- local database path control
- minute-writer restart and reconciliation logic
- active-case writer bootstrap on restart
- explicit health endpoints
- structured case status transitions

These are not glamorous features, but they are the kind of technical decisions that matter in real operating room deployment.

## 14. Current limitations

For committee discussion, it is helpful to state limitations clearly.

### 14.1 Windows desktop orientation

The present architecture is designed around Windows workstation deployment.

### 14.2 Local workstation model first

The current strength is local case recording. Central multi-room architecture is still a separate next-step discussion.

### 14.3 Node runtime dependency in packaged deployment

The present packaged model still depends on local Node runtime availability for backend launch.

### 14.4 Ongoing workflow refinement

Some workflows are still actively evolving based on real-world use, such as:

- blood product process
- line form detail structure
- report layout refinement
- device-specific integration differences

## 15. Why this architecture is strategically important

From a technical and national perspective, FLORA shows that a local anesthesia information platform can be designed with these characteristics:

- local-first reliability
- case-centered documentation
- flexible coexistence of manual and automatic entry
- separable integration layer through Hidro
- adaptable clinical form model
- printable structured report generation

This matters because it demonstrates that Thai anesthesia digital infrastructure does not need to begin only as a fully imported black-box system.

## 16. Suggested short talking points for speaker use

### Short version

FLORA is a local-first anesthesia information system built around the anesthesia case. It uses a desktop architecture with React, Electron, Node.js, and SQLite, while using Hidro as a separate device-integration layer. Its main technical goal is not luxury enterprise complexity, but reliable case-centered documentation that can adapt quickly to Thai clinical workflow.

### Slightly more technical version

FLORA separates the user interface, local backend, local case database, and device integration layer. The frontend is built in React and packaged with Electron. The backend is a local Node and Express service. The database is SQLite in WAL mode for workstation reliability. Hidro handles observation ingestion from devices, while FLORA transforms that into minute-level case documentation, events, fluids, medications, forms, and final report output.

## 17. Suggested committee message

If the committee asks why this architecture matters, the answer is:

This architecture is important not because it is technically fashionable, but because it is clinically practical. It is designed for the operating room reality of incomplete integration, mixed manual and automatic workflow, local reliability needs, and the need for rapid improvement from real clinical feedback.

