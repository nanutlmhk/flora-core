# Handoff Risks and Open Questions

## High-Risk Areas

1. USB/serial stability differs by room and workstation.
2. Hidro transport status and actual data flow have not always agreed.
3. Existing client database migrations can contain duplicate or inconsistent staff identities.
4. HIS and gateway behavior is hospital-specific and may fail outside the application code.
5. Report correctness and printer delivery are operationally critical.
6. Public/community product boundaries must not expose private hospital integrations or secrets.
7. The ownership boundary between Porjai, anesthesia, hospital IT, and external device vendors must be explicit.

## Questions To Close Before Final Handoff

- Who owns each production server, VM, database, gateway, and printer?
- Which documents are authoritative for KCMH, Vimut, and BKI?
- Which rooms are active, testing, planned, or retired at each site?
- Which AIDAS/Hidro versions are installed in each room?
- What is the approved backup and restore procedure for each database?
- What is the supported rollback process after a failed installer update?
- Who receives a Hidro serial/device incident and what logs are required?
- Which hospital API integrations are active, planned, or retired?
- Which assets and source files belong in a private repository rather than a public repository?
- Who becomes the technical owner after the current developer leaves?

## Confidence Labels

Use these labels in future records:

- `Verified`: confirmed by code, log, test, or signed operational record.
- `Observed`: seen during a real deployment but not yet fully explained.
- `Planned`: agreed direction that is not implemented or accepted yet.
- `TBD`: information still required from the responsible owner.
