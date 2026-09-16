# Python/PostgreSQL Leaf cutover

Status: **complete on 16 September 2026**.

- The Leaf web UI proxies only to `flora-leaf-api`.
- The Electron shell connects to `FLORA_API_BASE_URL` and does not start an
  application server or own clinical storage.
- All authentication, lifecycle, charting, staff, diagnosis, procedure, allergy,
  medication/I/O, HIS, EPHIS, timeline and writer contracts are served by FastAPI.
- Vector minute observations are written directly to PostgreSQL.
- PostgreSQL is the sole running clinical database.
- The transitional compatibility API and database bridge are removed from the
  Compose graph and repository.
- The final pre-cutover state was preserved outside the repository under
  `C:\Users\JK\Flora-backups\final-cutover-20260916` for disaster recovery only.

## Verification completed

- Final source rows were merged into PostgreSQL before the compatibility services
  were stopped.
- The PostgreSQL and former local-state backups were captured before removal.
- Leaf health, login, history/chart reads, catalog reads, EPHIS reads, writer
  status, TypeScript production build, Python compilation, and isolated clinical
  write tests passed with the compatibility containers absent.
