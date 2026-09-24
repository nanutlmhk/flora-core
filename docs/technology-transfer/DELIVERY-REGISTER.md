# ESM Flora delivery register

This register maps the agreement's twenty technology-transfer items to the actual Flora repository. It tracks delivery only; it is not an acceptance certificate.

Status meanings:

- `Ready`: the referenced material already exists and needs only baseline freezing/export.
- `Prepare`: a transfer artifact must be generated or consolidated.
- `Joint`: completion depends on ESM access, environment, or confirmation.

| No. | Agreement deliverable | Repository evidence | Status | Day-10 action |
| ---: | --- | --- | --- | --- |
| 1 | Latest source code | Entire repository | Prepare | Freeze clean commit/tag; create source archive and checksum |
| 2 | Database schema and data model | `docs/database/flora-schema.sql`, `infrastructure/postgres/*.sql`, `docs/POSTGRESQL-STRUCTURE.md` | Ready | Export from the handover tag and verify migration order |
| 3 | Data flow | Root `README.md`, `docs/BACKEND-ARCHITECTURE.md` | Ready | Walk through Leaf → PostgreSQL → sync → Canopy |
| 4 | Workflow | `docs/FLORA-User-Training-Flow.md`, architecture documents | Ready | Confirm customer-specific workflow and record exceptions |
| 5 | System/software architecture | Root `README.md`, backend/frontend architecture documents | Ready | Export with the source baseline |
| 6 | API and integration documentation | `docs/BACKEND-API-INVENTORY.md`, FastAPI `/openapi.json`, HIS/device handoff documents | Prepare | Export OpenAPI from the handover build; identify external owners |
| 7 | Installation and deployment guide | Root `README.md`, Compose files, `electron/README.md` | Ready | Perform clean-machine rehearsal and retain logs |
| 8 | Configuration/environment information | `.env.example`, Compose files | Ready | Explain every production value; transfer real secrets separately |
| 9 | Technical documentation | `docs/` package indexed by `technology-transfer/README.md` | Ready | Review authoritative-document order |
| 10 | Developer/build instructions | Root and frontend `package.json`, root `README.md` | Ready | Run frontend, Python, container, and desktop build steps as applicable |
| 11 | User manual, if available | `docs/FLORA-User-Training-Flow.md`, troubleshooting guides | Ready | Confirm which material ESM wants in the final package |
| 12 | Library/framework/third-party list | Lockfiles, Python requirements, `THIRD-PARTY-SOFTWARE.md` | Prepare | Regenerate against final tag |
| 13 | Open-source license list | `THIRD-PARTY-SOFTWARE.md` plus generated dependency reports | Prepare | Complete transitive-license export and review exceptions |
| 14 | Repository/version control | Git history and remotes | Joint | Add ESM users or transfer repository ownership as agreed |
| 15 | Testing information | Service tests, validation commands, demo profile | Prepare | Record exact commands, results, fixtures, and safe test accounts |
| 16 | Module/function list | Root `README.md`, frontend/backend architecture and API inventory | Ready | Confirm scope against the handover tag |
| 17 | Usable system version in scope | Handover tag and resulting build | Prepare | Package release artifact or documented container build |
| 18 | Test results and fixed-bug list | Test output, `docs/RELEASE_NOTES.md`, issue export | Prepare | Run tests and export release/issue evidence |
| 19 | Demo flow and demo account | Training flow and synthetic demo profile | Joint | Transfer account through secure channel; rehearse demo |
| 20 | System ready for customer demo | Handover build plus validation evidence | Joint | Demonstrate only after environment and external dependencies are ready |

## Delivery evidence log

| Date/time | Item | Artifact or URL | Version/hash | Delivered by | Received by | Notes |
| --- | --- | --- | --- | --- | --- | --- |
|  |  |  |  |  |  |  |
|  |  |  |  |  |  |  |
|  |  |  |  |  |  |  |
|  |  |  |  |  |  |  |
|  |  |  |  |  |  |  |

## Open-item log

| ID | Gap or dependency | Owner | Due | Resolution/evidence |
| --- | --- | --- | --- | --- |
| TT-01 | Freeze a clean source baseline after current product work is complete | Flora |  |  |
| TT-02 | Confirm ESM repository users and destination organization | ESM |  |  |
| TT-03 | Confirm secure secret-transfer channel | Joint |  |  |
| TT-04 | Generate final OpenAPI export from the frozen build | Flora |  |  |
| TT-05 | Generate and review consolidated transitive-license report | Flora |  |  |
| TT-06 | Run clean-machine build/deploy rehearsal | Joint |  |  |
| TT-07 | Run database backup/restore rehearsal | Joint |  |  |
| TT-08 | Confirm production HIS/device test availability and owners | ESM/customer |  |  |
