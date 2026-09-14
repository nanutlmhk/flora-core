# Shared Assets and Operations Handoff

## Asset Categories

Track these separately from source code:

- application repositories and branches
- installer packages and release artifacts
- deployment databases and database backups
- Windows workstations and VM hosts
- medical devices and serial/TCP adapters
- USB hubs, cables, and physical connection paths
- printers and shared folders
- HIS gateways and hospital service accounts
- protocol documents, test captures, and sample data
- logos, report templates, and customer-specific assets

## Ownership Matrix

| Area | Primary owner to confirm | Supporting owner |
| --- | --- | --- |
| Innovian clinical workflow | Anesthesia / hospital | Porjai support |
| Innovian server and SQL | Hospital IT | Porjai / vendor |
| FLORA application | Porjai development | Anesthesia users |
| Hidro device middleware | Porjai development | Hospital IT / device vendor |
| Network, VLAN, firewall, VM | Hospital IT | Porjai |
| Device cable and adapter path | Hospital biomedical/OR support | Porjai |
| HIS API/gateway | Hospital IT / HIS owner | Porjai |
| Project decisions and incidents | Project governance owner | All parties |

## Release And Deployment Records

Every deployment record should contain:

- product and version
- date and room
- source installer or commit
- database handling
- configuration changes
- test performed
- observed result
- rollback or recovery path
- person who accepted the change

## Security Rules

- Do not put live tokens, passwords, private keys, or patient data into GitHub or ordinary handoff documents.
- Keep secrets in the hospital-approved secret store or controlled local configuration.
- Record who owns each account and how access is transferred.
- Revoke departing-person access after handoff.

## Minimum Recovery Evidence

- latest known-good installer
- latest verified database backup
- service startup instructions
- health-check commands
- room/device configuration record
- known-good report and printer test
- escalation contact
