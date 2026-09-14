# Dancefloor Handoff

## Purpose

Dancefloor is the project-memory and operational workspace around the software portfolio. It is not a replacement for FLORA, Hidro, or Innovian. Its role is to connect delivery, support, governance, assets, decisions, incidents, and hospital context.

## Product Model

Dancefloor is organized around:

- `Timeline`: what happened and when.
- `Delivery`: implementation and release work.
- `Operations`: incidents, support, changes, and post-go-live work.
- `Governance`: risks, decisions, meetings, approvals, and stakeholders.
- `Assets & Context`: hardware, software, network, floor plans, and site knowledge.

## Repository Structure

- `app/`: Next.js application shell.
- `src/`: shared types and seed data.
- `docs/`: product, domain, network, CMDB, and hospital implementation material.

## Why It Matters To Handoff

The hardest handoff information is not only source code. It is the relationship between:

- the product and the hospital environment
- the room and its physical device path
- the server and its network access
- the deployment and its support owner
- the issue and the decision that resolved it

Dancefloor is the appropriate place to preserve that operational history.

## Current Relevant Material

The repository includes KCMH asset records, hospital network request material, CMDB drafts, technical workshop notes, Innovian delivery notes, and implementation documentation.

## Handoff Rules

- Link an incident to the affected project, room, asset, and release.
- Record observed facts separately from assumptions.
- Keep private credentials, patient data, and live tokens out of the project workspace.
- Record the next owner and next action for unresolved issues.
- Use one project timeline to connect Innovian maintenance, FLORA rollout, Hidro incidents, and hospital IT decisions.
