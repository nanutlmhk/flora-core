# Innovian Handoff

## Purpose

Innovian is the legacy anesthesia information management system currently maintained or supported in hospital environments. It should be handed off as a legacy production system, not treated as a branch of FLORA.

## Responsibilities

- Maintain the existing Innovian clinical workflow.
- Support existing server, client, database, gateway, and report operations.
- Preserve current hospital procedures while changes are evaluated.
- Coordinate with hospital IT before changing server, database, network, or gateway configuration.

## Known Integration Environment

The current KCMH material references:

- Innovian Web Application and Innovian Server VM.
- Microsoft SQL Server legacy databases, including production and backup databases.
- Draeger Infinity Gateway.
- Capsule / Xnet DataCaptor Gateway.
- HIS and downstream PDF/file-share workflows.

Exact IP ownership, VM details, credentials, backup policy, and vendor responsibility must be confirmed from the hospital IT source of truth.

## Related Work

- Innovian-to-EPHIS PDF management.
- Daily case report handling.
- PDF naming, staging, queue, and delivery workflow.
- Existing Innovian client/server and expected-equipment documents.

Relevant source material includes the Innovian documents under the FLORA and Dancefloor `docs/` folders.

## Change Safety

- Do not modify the production Innovian server during clinical operation.
- Do not automate PDF delivery until the effect on the existing server and EPHIS workflow is accepted.
- Test against copied/exported files first.
- Record every server, database, gateway, and report-path change.

## Incoming Team Checklist

- Obtain the current Innovian architecture and network diagram from hospital IT.
- Identify production, backup, and test servers.
- Confirm SQL Server backup and restore procedure.
- Confirm gateway ownership and restart procedure.
- Confirm report export, file-share, and EPHIS responsibilities.
- Obtain a non-production test case and safe test window.
