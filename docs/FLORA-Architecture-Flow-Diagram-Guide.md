# FLORA Flow Diagram Guide

Diagram file:

- [FLORA-Architecture-Flow-Diagram.mmd](c:/Users/onlys/Flora/docs/FLORA-Architecture-Flow-Diagram.mmd)

## What this diagram is meant to show

This is a high-level FLORA architecture flow diagram for presentation use.

It is designed to answer one simple question:

How does information move through FLORA from clinical input and device input to local case record and final report?

## How to explain the diagram

### 1. User side

The anesthetist or OR staff can always enter and review data manually through the FLORA frontend.

This is important because FLORA is not designed under the assumption that every room has perfect automation.

### 2. FLORA Desktop

Inside FLORA desktop there are three practical layers:

- `React Frontend UI`
- `Electron Desktop Shell`
- `Node.js + Express Backend`

The frontend is where the user works.

The desktop shell makes FLORA run as a Windows application.

The backend handles case logic, APIs, local processing, and minute writer control.

### 3. Hidro Integration Layer

Hidro receives data from connected devices and normalizes observations before FLORA uses them.

This means FLORA does not need to directly manage every device-specific detail itself.

### 4. Local Data Layer

All core case information is stored in the local `SQLite flora.db` database.

The local database contains:

- cases
- vital minutes
- events
- medication / fluid / blood product data
- forms / staff / master data

This reflects the local-first design philosophy.

### 5. External Sources

The external sources are:

- patient monitor
- anesthesia machine
- infusion pump
- HIS / hospital integration

Device data mainly enters through Hidro.

Hospital integration can enter through the backend API side.

### 6. Outputs

The final outputs are:

- timeline and case review
- anesthesia report PDF
- clinical summary / print

This shows that FLORA is not only a data collector, but a documentation and reporting system.

## Suggested short speaking script

This diagram shows FLORA as a local-first anesthesia documentation platform. Manual clinical input and device data both enter the system. Device observations come through Hidro, while case logic is handled by the FLORA backend. All important information is stored in the local SQLite database as case-centered data. From there, FLORA supports timeline review, clinical documentation, and final anesthesia report generation.

