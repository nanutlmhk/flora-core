# Medical Device Integration Handover Guide

## FLORA and Hidro

This document is a practical handover guide for the developer or software team taking over FLORA and Hidro. Its sections follow the structure of `Medical_Device_Integration_Handover_Checklist.pdf` so that the successor can use it as both an onboarding guide and a checklist while examining the code and real deployment assets.

Scope:

- `FLORA` anesthesia information and documentation system.
- `Hidro` medical-device integration middleware.
- Porjai-managed device and data-flow components.

The successor is expected to study the repositories, inspect the installed systems, and verify the live configuration with the relevant hospital and device contacts. This document gives the starting map; it is not a substitute for source-code review or access to the real assets.

## Status Labels

- `Verified`: supported by source code, repository documentation, or observed test evidence.
- `Observed`: seen during real deployment and useful when reproducing a problem.
- `Planned`: intended future capability.
- `To verify`: successor should confirm it in code, configuration, logs, or the live environment.

## How To Use This Guide

For each section, the successor should:

1. Read the referenced source files and existing project documents.
2. Run the relevant service or application in a safe test environment.
3. Inspect the actual workstation, device, adapter, server, printer, and network configuration where access is available.
4. Compare observed behavior with the description here.
5. Record corrections in the appropriate project or site document.
6. Ask the outgoing developer when historical context or an undocumented deployment decision is needed.

## 1. System Architecture and Data Flow

### 1.1 Overall architecture

```text
Medical device
    -> serial / TCP / HL7 / vendor protocol
Hidro service
    -> parser and parameter normalization
Hidro local SQLite and HTTP API
    -> local observation API
FLORA backend
    -> case association and minute writer
FLORA local SQLite: flora.db
    -> timeline, forms, medications, fluids, blood, events, reports
Hospital HIS gateway or API: optional integration layer
```

Status: `Verified` for the local FLORA/Hidro flow. The successor should verify the hospital-wide topology from the live network and current IT records.

### 1.2 Device data transport

| Device/data path | Transport | Current position |
| --- | --- | --- |
| GE monitor integrations | Serial / device-specific protocol | Supported code paths; room verification required |
| GE Carestation 750 | RS232 serial | Real integration and test evidence exists |
| GE Aisys CS2 | RS232 serial using GE750-family path | Supported code path; real-room verification required |
| GE Bx50/B650 family | Serial / S5-related path | Supported code path; deployment depends on model and wiring |
| B. Braun BCC | TCP/LAN | Integration path exists; deployment configuration required |
| HL7 device path | HL7 over network | Repository path exists; deployment profile may enable or disable it |
| Draeger devices | Vendor-specific integration paths and protocol research | Capability varies; must be verified per device and approved protocol |
| Future infusion integrations | Device-specific | Planned expansion for B. Braun and Fresenius coverage |

The system supports both continuous observation collection and local manual documentation. It is not limited to one transport method.

### 1.3 Central systems and endpoints

Known Porjai-side endpoints:

- Hidro local API: `http://127.0.0.1:3000`.
- FLORA local backend: typically local workstation service, commonly port `3001` in current documentation.
- KCMH hospital integration gateway: hospital-side service associated with `10.35.202.6`.

Live endpoint URLs, bearer tokens, certificates, firewall rules, and credentials must be provided through the hospital-approved secure channel and must not be stored in this document or a public repository.

Status: `Partial`.

### 1.4 Data flow

```text
Device -> physical interface / adapter -> Hidro driver
      -> raw frame / message -> parser -> normalized parameter key
      -> Hidro observation database -> Hidro API
      -> FLORA minute writer -> case timeline in flora.db
      -> FLORA chart, report, and downstream export
```

HIS patient, lab, allergy, and blood-bank information enters through a hospital gateway/API when configured. It is separate from the device-observation flow.

## 2. Supported Device Matrix

### 2.1 Manufacturers, models, and categories

| Manufacturer | Model/family | Category | Status |
| --- | --- | --- | --- |
| GE | B1x5 / Bx50 / B650 family | Patient monitor | Supported path; verify model and room |
| GE | Carestation 750 | Anesthesia machine | Real integration evidence |
| GE | Aisys CS2 / Avance family | Anesthesia machine | Supported path; verify model and room |
| B. Braun | Space / BCC integration path | Infusion pump | Supported integration path; verify deployment |
| Draeger | IACS, Vista, Primus, Perseus, Atlan paths | Monitor / anesthesia machine | Driver/research paths; production status varies |
| Philips | IntelliVue MX/MP integration path | Patient monitor | Repository path; deployment verification required |
| Fresenius | Planned integration scope | Infusion pump | Planned / not confirmed as production |

The Hidro repository README contains the broader supported-family list. A listed driver does not by itself prove production acceptance.

### 2.2 Firmware versions

No complete firmware compatibility matrix is maintained in the current repositories.

The successor should build this matrix from the real devices and manufacturer documentation before declaring a device production-ready.

Required future record:

- manufacturer and model
- firmware version
- protocol board/module version
- verified date
- test result

### 2.3 Actual deployed quantities

Known current FLORA KCMH rollout evidence includes OR rooms `508`, `701`, and `901`. Confirm exact device counts and active status against the current hospital asset list.

Status: `Partial`.

### 2.4 Device setup manuals

Available source material includes GE Carestation serial protocol documents, GE monitor protocol material, Hamilton documents, and Draeger integration research files. Device-specific setup instructions are not yet consolidated into one approved manual.

Status: `Partial`.

## 3. Communication Protocols

### 3.1 Protocol standards

Confirmed or present in repository:

- RS232 serial.
- Vendor-specific serial framing and checksums.
- TCP/LAN for selected integrations such as B. Braun BCC.
- HL7 listener/parser path.
- Local REST/HTTP APIs between Hidro and FLORA.

Not confirmed as active Porjai implementation for this scope:

- ASTM E1394/E1381.
- DICOM.
- FHIR.

### 3.2 Message format and specification

Message handling is driver-specific. The repository contains parser, framing, checksum, mapping, raw sample, and protocol files under Hidro `service/` and the FLORA `shared/` mapping paths.

The safe handover package should include, per driver:

- raw capture sample
- frame/message explanation
- parser entry point
- normalized output example
- unsupported message examples

### 3.3 ACK/NACK handling

ACK/NACK behavior is protocol-specific. It is not one global Hidro behavior. Each driver must document whether it sends acknowledgements, expects acknowledgements, or operates as a receive-only stream.

Status: `Partial`; complete per-driver matrix is `TBD`.

### 3.4 Retry and timeout

The service contains reconnect, serial reset, preflight, and service-lifecycle logic. Exact retry count and timeout vary by driver and configuration.

The main known operational issue is not only retry logic: some USB/serial environments can report a misleading status, continue sending data temporarily, or stop after long-running use.

Status: `Observed / Partial`.

## 4. Data Mapping and Transformation

### 4.1 Device to internal mapping

Hidro maps raw device values into normalized parameter keys. FLORA then maps normalized observations into case minute records.

Primary evidence:

- Hidro `shared/floraParamMap.js`.
- Hidro driver mapper/parser modules.
- FLORA `shared/floraParamMap.js`.
- FLORA `backend/minuteWriter.js`.

Examples include heart rate, SpO2, NIBP components, invasive pressure, CVP, temperature, respiratory values, gas values, agent values, and selected pump values.

### 4.2 Internal database to HIS mapping

FLORA/Hidro primarily consume hospital-side patient, lab, allergy, and blood information. A general write-back mapping from the local clinical database to HIS is not currently established as a universal capability.

The successor should confirm this per hospital interface and policy before implementing write-back behavior.

### 4.3 Unit and normal-range transformation

Parameter normalization and unit handling exist in driver/mapping code. A single clinical reference-range engine is not documented as a separate product component.

Status: `Partial`; per-parameter verification is required.

## 5. Hospital Device Configuration

### 5.1 Network and serial settings

The configuration model supports device-specific values such as:

- IP address
- TCP port
- COM port
- baud rate
- parity
- stop bits
- device identifier
- protocol/profile selection

The live room matrix is intentionally not included here because it is hospital-specific and may contain sensitive infrastructure details.

Status: `Partial`.

### 5.2 Device identification

Hidro uses configured logical device identifiers and source/protocol information to classify observations. Device identity must be recorded together with room, workstation, COM/IP path, and model.

### 5.3 Polling and queue settings

Hidro collects observations continuously where the driver supports it. FLORA minute writing is a separate process that polls Hidro and writes case-level minute records.

There is no RabbitMQ/Kafka-style external queue in the standard local profile. Local buffering is handled through service memory and SQLite observation storage.

### 5.4 SOP: add a new device

Minimum procedure:

1. Confirm device model, protocol, physical interface, and biomedical approval.
2. Confirm COM/IP path and workstation ownership.
3. Configure the matching Hidro driver/profile.
4. Start Hidro and check service health.
5. Check transport/port status separately from data status.
6. Confirm raw observations and normalized parameters.
7. Confirm FLORA receives and stores minutes.
8. Test chart and report output.
9. Record room, version, configuration, and acceptance evidence.

### 5.5 SOP: change IP, port, or COM

1. Stop or isolate the affected service according to hospital policy.
2. Record the old configuration.
3. Change one setting only.
4. Check port ownership and cable/adapter path.
5. Restart/reconnect the relevant driver.
6. Verify raw data, normalized data, FLORA data, and report output.
7. Record the change and rollback value.

## 6. Onsite Setup and Deployment

### 6.1 Installation

Hidro is installed as a Windows application/service with an Electron tray control path. FLORA is installed as a Windows Electron desktop application with local backend and database runtime.

The exact installer version must be recorded for every room.

### 6.2 Configuration import/export

Configuration is distributed through service settings and deployment-specific files. The successor should identify the authoritative configuration files and document the import/export procedure during onboarding.

Status: `Partial`.

### 6.3 Firewall and network rules

Known local requirements:

- Hidro local API on port `3000` by default.
- FLORA local backend commonly uses port `3001` in current documentation.
- Device-specific TCP ports where applicable.
- Hospital gateway/server access where HIS integration is enabled.

Confirm exact inbound/outbound rules with hospital IT for each site.

### 6.4 Connection and integration test

Recommended test sequence:

1. Physical cable and power check.
2. Windows Device Manager / COM check.
3. Port ownership and adapter check.
4. Network ping/TCP check where applicable.
5. Hidro `/health` check.
6. Hidro device and data-status check.
7. Raw observation check.
8. FLORA timeline check.
9. Report and printer check.

### 6.5 Go-live checklist

- correct installer version
- approved workstation and device path
- backup and rollback copy
- Hidro service starts automatically
- port and data status both verified
- FLORA backend and database ready
- sample data reaches FLORA
- report generated and printed
- support contact confirmed
- room acceptance recorded

## 7. Troubleshooting

### 7.1 Device does not send data

Check:

- device power and communication setting
- cable and USB/serial adapter
- COM port existence and ownership
- baud/parity/stop-bit settings
- Hidro driver/profile
- service process and logs
- device-side protocol output

### 7.2 Data is received but does not enter the database

Check:

- raw receiver output
- parser errors
- unmapped parameter names
- normalized observation rows
- SQLite write errors
- retention or timestamp filters
- FLORA minute-writer health
- active case and case start time

### 7.3 HIS does not receive data

The standard FLORA/Hidro workflow is primarily retrieval and local documentation. For any write-back or downstream delivery, check:

- gateway/API availability
- endpoint and firewall access
- authentication/token validity through secure configuration
- request payload and identifier format
- HTTP/SOAP response
- retry/reconciliation behavior
- hospital-side interface logs

## 8. Logging and Audit Trails

### 8.1 Log locations

Hidro supports runtime diagnostics logging with configurable runtime/log directories. Console output is also important during live diagnosis.

FLORA logs may be produced by the Electron shell, local backend, and deployment scripts. The exact packaged path depends on the installation profile.

The final room runbook must record the actual paths used at that site.

### 8.2 Rotation and retention

Hidro's README documents a default observation retention setting of `90` days. Log rotation and retention should be confirmed from the deployed configuration.

Status: `Partial`.

## 9. Windows/Linux Service Management

### 9.1 Service catalog

Main Porjai runtime components:

- Hidro Node.js service.
- Hidro Electron tray application.
- FLORA Electron desktop shell.
- FLORA local Node.js backend.
- Optional hospital-side gateway service, owned separately from FLORA/Hidro.

Linux deployment is not the standard current client model.

### 9.2 Start, stop, restart, and status

Hidro supports tray/service control and service-only launch for diagnosis. FLORA is normally started through its desktop launcher, which starts or checks the local backend.

The support runbook should use the installed package's approved launcher rather than copying source code into a client workstation.

### 9.3 Automatic recovery

Startup and recovery behavior exists in the application/service launch paths, but automatic recovery should be verified per installed version and room.

Status: `Partial`.

## 10. Message Queue and Buffer Management

### 10.1 Queue architecture

The standard local profile does not use RabbitMQ, Kafka, or Redis. Hidro uses service memory plus local SQLite observation storage. FLORA uses local case/database writes and minute-writer reconciliation.

### 10.2 Queue monitoring and dead letter

No separate DLQ product is currently part of the standard deployment. Failed parsing, transport, and database events are diagnosed through logs, raw captures, service state, and database inspection.

Status: `Verified with limitation`.

## 11. Database Schema and Archiving

### 11.1 ER diagram and schema

FLORA:

- `flora.db` SQLite database.
- schema source: `backend/floradb.js`.
- diagram: `docs/FLORA-Database-Diagram.mmd`.

Hidro:

- local SQLite observation database.
- schema and retention behavior are in Hidro `service/db.js` and settings/runtime code.

### 11.2 Archiving and retention

- Hidro observation retention has a documented default of 90 days.
- FLORA clinical case retention and archive policy must follow the hospital's approved clinical-record policy.
- No general statement should be made that local data is automatically deleted without confirming the deployed policy.

## 12. HIS/LIS Interface Details

### 12.1 HIS specifications

Current integration direction includes hospital gateway/API access for patient information and selected lab, allergy, and blood-bank workflows. Confirm the HIS vendor, service version, endpoint contract, and approved payload with the hospital HIS owner.

Known protocol forms in the current work include REST/HTTP gateway calls and SOAP hospital services. This is not a universal HL7/FHIR claim.

### 12.2 Handshake and response handling

For each hospital interface, document:

- request format
- identifier format
- authentication method
- timeout
- error response
- retry policy
- reconciliation behavior
- owner of the upstream service

These values are hospital-specific and must not be guessed from the FLORA client alone.

## 13. Security and Network Controls

### 13.1 Isolation and VPN

- Hidro local API defaults to localhost.
- Remote admin is disabled by default unless explicitly enabled.
- Hospital network access is required only for configured integrations, central services, printers, or remote workflows.
- VLAN, firewall, VPN, and routing design belong to hospital IT.

### 13.2 Access control and encryption

- FLORA has local application authentication and role-aware workflow.
- Local device/API traffic may be HTTP depending on deployment.
- TLS, certificates, SSH keys, IP allowlists, and encryption-at-rest policy must be confirmed per hospital service.
- No secrets should be included in this response document.

## 14. Monitoring and Alerting

### 14.1 Dashboard

Hidro provides local service, device, transport, and data-status views. The current direction intentionally separates:

- service reachability
- port/transport status
- data status
- last received time

FLORA can show integration-related status but is not an enterprise monitoring platform.

### 14.2 Alerting

No Line Notify, email, or SMS alerting service is part of the standard current deployment. If alerting is required, design it with the hospital monitoring/support owner.

## 15. Backup and Disaster Recovery

### 15.1 Backup and recovery plan

Minimum Porjai application backup set:

- FLORA `flora.db`.
- Hidro local database.
- deployment configuration.
- installer version.
- device/room configuration.
- approved certificates or license files where applicable.
- room acceptance and test evidence.

Before updating an existing client, back up the database and verify the backup can be opened. Full enterprise DR, offsite backup, and restore testing require hospital IT participation.

## 16. Version Control and Patch Management

### 16.1 Source code and repositories

- FLORA source is maintained in its Git repository with release notes and architecture documents.
- Hidro source is maintained in its own Git repository with README, CHANGELOG, service code, driver code, and packaging configuration.
- Dancefloor is maintained separately as the project/asset/operations workspace.

Version tags/releases must identify the product, version, date, and deployment target. Private hospital configuration must not be committed to public repositories.

### 16.2 Hospital patch history

Known FLORA milestones include `1.0.0`, `1.1.0`, `1.2.0`, `1.2.1`, and `1.2.2`. Hidro `1.2.2` includes diagnostics and separated port/data status. Room-specific deployment history must be completed from Dancefloor and hospital records.

## 17. Hospital-Specific Customizations

### 17.1 Hospital matrix

| Site | Evidence currently available | Status |
| --- | --- | --- |
| KCMH | Extensive FLORA/Hidro room, network, HIS gateway, Innovian, and deployment notes | Active / detailed |
| Vimut | Meeting and Hidro deployment notes exist, but a complete device/configuration matrix is not consolidated | Partial |
| BKI | A complete matrix was not available in the source material at handoff | To verify with site records |

For each site, maintain a private matrix containing room, workstation, device, COM/IP path, version, printer, server path, support owner, and acceptance status.

## 18. Outstanding Work and Known Issues

### 18.1 Known bugs and technical debt

- USB/serial instability varies by workstation and room.
- Transport status can disagree with actual data flow.
- Long-running Hidro stability requires continued evidence and diagnosis.
- Driver maturity differs by device family.
- Existing client database migration must handle dirty or duplicate staff data safely.
- HIS behavior is hospital-specific and can fail upstream of FLORA.
- Report and printer output require end-to-end verification.
- Configuration import/export and complete room matrices are not yet consolidated.

### 18.2 Pending features and direction

- stronger Hidro connectivity diagnostics and recovery
- broader Draeger integration library
- B. Braun and Fresenius infusion integration expansion
- stable full client-server architecture
- central database synchronization
- remote viewer and document-management workflow
- multi-room concurrent operation and central reporting
- complete hospital-specific deployment runbooks

## Successor Onboarding Outcome

FLORA and Hidro provide the local clinical and device-integration foundation. A complete takeover requires the successor to connect this guide to the actual repositories, installed versions, room assets, hospital services, and support contacts. Historical questions that cannot be answered from the code or records should be discussed with the outgoing developer and the relevant hospital owner.
