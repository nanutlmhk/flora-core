# Hospital and Client Context Handoff

This document separates hospital-specific operational knowledge from product code.

## KCMH

KCMH is the most documented environment in the current material. Relevant topics include:

- Innovian legacy server, database, and gateway environment.
- FLORA and Hidro client-room deployment.
- hospital HIS gateway and approved network access.
- server and VM planning around `10.35.202.6`.
- Innovian-related `10.39.226.x` environment and VLAN discussions.
- real OR testing in rooms including `508`, `701`, and `901`.
- network printer and report-delivery requirements.
- staff synchronization and resident onboarding.

The exact current IP, firewall, VLAN, printer, server-owner, and credential records must be maintained in the hospital IT source of truth, not copied into this public-facing handoff.

## Vimut

The current FLORA repository does not contain enough verified Vimut-specific deployment evidence to write a reliable technical status. Before handoff, add:

- active products and versions
- rooms and workstation identifiers
- device models and connection paths
- server/API/network requirements
- support owner and escalation path
- known incidents and acceptance status

## BKI

The current FLORA repository does not contain enough verified BKI-specific deployment evidence to write a reliable technical status. Before handoff, add the same room, device, network, server, support, and acceptance fields used for Vimut.

## Shared Hospital Deployment Record

For every room, record:

| Field | Required information |
| --- | --- |
| Hospital | customer/site name |
| Room | OR or care unit |
| Product | Innovian, FLORA, Hidro, or combination |
| Version | installed application/service version |
| Workstation/server | asset name and owner |
| Device path | serial, TCP, HL7, gateway, or other |
| Network | IP, VLAN, Wi-Fi/Ethernet policy, firewall path |
| Printer | printer name/path and test result |
| Status | planned, testing, active, blocked, retired |
| Support owner | clinical, Porjai, hospital IT, or vendor |
| Evidence | test report, screenshot, log, or meeting decision |
