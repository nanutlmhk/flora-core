# Third-party software inventory

This is the handover-level direct-dependency inventory. Versions must be regenerated from the lockfiles at the final handover tag. A complete transitive-license report remains a Day-10 action.

## Runtime and platform dependencies

| Component | Version/source | Purpose | License/status |
| --- | --- | --- | --- |
| PostgreSQL | `postgres:17.6-alpine` | Clinical system of record | Confirm image and included-component notices at final tag |
| Docker / Compose | ESM environment | Development/deployment orchestration | Environment prerequisite; not redistributed by Flora source |
| Python | Python 3 image in service Dockerfiles | Backend runtime | Confirm base-image notice at final tag |
| Node.js | Frontend/Electron build environment | Build runtime | Confirm base-image/build-host notice at final tag |

## Direct JavaScript dependencies

Versions below are taken from the current lockfiles, not the unfrozen package ranges.

| Package | Locked version | Use | Declared license |
| --- | ---: | --- | --- |
| React | 19.2.4 | UI framework | MIT |
| React DOM | 19.2.4 | Browser renderer | MIT |
| Vite | 7.3.6 | Frontend build tool | MIT |
| TypeScript | 5.9.3 | Type checking/compiler | Apache-2.0 |
| Tailwind CSS | 4.1.18 | Styling engine | MIT |
| `@tailwindcss/vite` | 4.1.18 | Vite integration | MIT |
| Inter variable font package | 5.3.0 | UI font asset | OFL-1.1 |
| Noto Sans Thai variable font package | 5.3.0 | Thai UI font asset | OFL-1.1 |
| Electron | 40.10.6 | Optional Windows desktop shell | MIT |
| electron-builder | 26.15.3 | Desktop packaging | MIT |
| pdf-lib | 1.17.1 | PDF handling | MIT |
| `@pdf-lib/fontkit` | 1.1.1 | PDF font embedding | MIT |

Sources of truth: root `package-lock.json` and `frontend/package-lock.json`.

## Direct Python dependencies

| Service | Package requirement | Use | License review |
| --- | --- | --- | --- |
| Flora API | `fastapi==0.116.1` | HTTP API framework | Include in final automated license report |
| Flora API | `psycopg[binary,pool]==3.2.10` | PostgreSQL client/pool | Include binary-package notices in final report |
| Flora API | `uvicorn[standard]==0.35.0` | ASGI server | Include in final automated license report |
| Flora API | `httpx==0.28.1` | HTTP client | BSD-3-Clause; verify from frozen environment |
| Sync worker | `httpx==0.28.1` | Leaf/Canopy sync client | BSD-3-Clause; verify from frozen environment |
| LiveAgent | `fastapi==0.116.1` | Synthetic demo API | Include in final automated license report |
| LiveAgent | `uvicorn[standard]==0.35.0` | ASGI server | Include in final automated license report |

Sources of truth: `services/*/requirements.txt`.

## Clinical terminology and data catalogs

Redistributable and customer-licensed terminology must remain distinguishable:

- WHO ICD-10 2019, CMS ICD-9-CM Volume 3, and UCUM baseline handling is documented in `docs/CLINICAL-TERMINOLOGY.md`.
- SNOMED CT and hospital-supplied ICD-10-TM content requires the applicable license/authority and must not be assumed redistributable.
- Customer data and terminology imports are not open-source dependencies.

## Final-tag license procedure

Before Day 10:

1. checkout the clean handover tag;
2. generate JavaScript production and development dependency/license reports from both lockfiles;
3. generate Python dependency/license reports from the resolved service images;
4. include notices for container base images, fonts, packaged binaries, and terminology datasets;
5. investigate missing, custom, copyleft, or dual-license entries;
6. save the reviewed report and its SHA-256 in the transfer archive.
