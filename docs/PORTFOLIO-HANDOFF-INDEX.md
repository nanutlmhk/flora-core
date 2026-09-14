# Porjai Software Portfolio Handoff Index

This index is the starting point for a future developer, support team, or software company taking over the Porjai project portfolio.

The portfolio should be understood as several related systems, not one codebase:

- `Innovian`: legacy anesthesia information system and current maintenance environment.
- `FLORA`: newer anesthesia documentation and reporting platform.
- `Hidro`: medical-device integration middleware used by FLORA and other downstream workflows.
- `Dancefloor`: project, asset, governance, and operational knowledge workspace.

## Reading Order

1. [FLORA and Hidro Successor Handbook](./FLORA-HIDRO-SUCCESSOR-HANDBOOK.md)
2. [Innovian Handoff](./HANDOFF-INNOVIAN.md)
3. [FLORA Handoff](./HANDOFF-FLORA.md)
4. [Hidro Handoff](./HANDOFF-HIDRO.md)
5. [Dancefloor Handoff](./HANDOFF-DANCEFLOOR.md)
6. [Hospital and Client Context](./HANDOFF-HOSPITAL-CONTEXT.md)
7. [Shared Assets and Operations](./HANDOFF-SHARED-ASSETS-AND-OPERATIONS.md)
8. [Risks and Open Questions](./HANDOFF-RISKS-AND-OPEN-QUESTIONS.md)

## System Relationship

```text
Medical devices -> Hidro -> FLORA case workflow -> Local database -> Report
                                      |
                                      +-> HIS / hospital services when available

Innovian remains a separate legacy AIMS and maintenance environment.
Dancefloor records the project, deployment, support, asset, and decision history.
```

## Handoff Rules

- Keep product ownership and operational ownership explicit.
- Keep hospital-specific configuration outside public repositories.
- Never place passwords, bearer tokens, private keys, or patient data in handoff documents.
- Treat `TBD`, `needs confirmation`, and `observed` as different states.
- Preserve the distinction between source code, deployment package, database, server, and physical device assets.

## Current Documentation Quality

The source folders contain substantial technical and operational evidence. The main remaining work is consolidation: identifying the authoritative document, owner, environment, and next action for each item.
