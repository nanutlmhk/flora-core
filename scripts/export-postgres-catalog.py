"""Print a schema-only Markdown catalog. No patient rows or credentials are read.

Run with psycopg installed and FLORA_DATABASE_URL set. Redirect stdout when
regenerating the document, or capture it in the editing workflow.
"""
import os
from datetime import datetime, timezone
import psycopg
from psycopg.rows import dict_row

DESCRIPTIONS = {
    "auth_user": "User accounts, password hashes/salts, roles, activation and theme preferences. Passwords are not stored as plaintext.",
    "auth_session": "Opaque login sessions. Stores token hashes, user ownership, expiry, last-seen and revocation times.",
    "auth_audit": "Authentication and account-administration audit records, including actor, target, outcome and JSON details.",
    "cases": "Root clinical encounter: case code, HN, start/capture/discharge/archive times and lifecycle status. Most clinical tables reference this ID.",
    "vital_minutes": "Device observations grouped into a JSON-text payload per case, source and minute. This is device data, not manual chart overrides.",
    "case_device_ingest_audit": "Device import provenance: requested intervals, source endpoint, row counts, actor, outcome and diagnostic details.",
    "case_timeline_value": "Current manual chart values and device overrides, identified by case, minute and parameter. Stores typed numeric/text values, units, source and author.",
    "case_timeline_audit": "History of timeline insertions, corrections and deletions, with old/new values, reason and actor.",
    "case_event_note": "Timeline events and clinical notes with timestamps, titles, details, authors and a soft-deletion flag.",
    "case_event_note_audit": "Before/after history for event and note creation, editing and soft deletion.",
    "patient_snapshot": "Earlier patient snapshot model retained from the imported database. Current patient API reads case_his_patient; do not assume this table is the active demographic source.",
    "case_detail": "Per-case detail fields and saved clinical form draft JSON. The form renderer consumes the draft payload; this is not a separate table per form question.",
    "case_diagnosis": "Ordered case diagnoses with free text and optional ICD code/version/description.",
    "case_procedure": "Ordered operations/procedures with free text and optional ICD procedure coding.",
    "icd10_master": "Diagnosis coding lookup, including English/Thai descriptions and source coding attributes.",
    "icd9cm_master": "Procedure coding lookup used by the operation/procedure picker.",
    "legacy_med_drip_preset_analysis": "Retained analysis of legacy medication/drip presets. Supporting migration/reference data, not the primary administration ledger.",
    "case_allergy": "Earlier allergy model retained from import. Current allergy routes use case_his_allergy instead.",
    "case_his_patient": "Current case demographic/HIS snapshot, including identifiers, names, demographics, contacts, body measurements, provenance and raw source payload.",
    "case_his_allergy": "Allergy records consumed by the case API. Holds allergen, reaction, severity, status and source; also stores manually entered allergies.",
    "case_his_lab": "Case laboratory results with test/group labels, units, reference range, flags, dates and source provenance.",
    "ephis_daily_case": "Imported EPHIS daily admission/case list. Supports daily count/reconciliation views; does not itself upload a PDF to EPHIS.",
    "his_patient_buffer": "Preloaded HIS demographics before association with a case, keyed by HN.",
    "his_allergy_buffer": "Preloaded HIS allergies associated with the HN buffer rather than a case ID.",
    "his_lab_buffer": "Preloaded HIS laboratory results associated with the HN buffer rather than a case ID.",
    "case_staff": "Ordered staff assignments for a case with identity, role and authorship. Current schema has no explicit staff time-in/time-out columns.",
    "staff_directory": "Reusable staff directory: identifiers, names, role, activation, usage counts and last-use metadata.",
    "staff_role": "Staff role codes and display labels used by the directory and case assignments.",
    "io_item_master": "Medication, fluid and output item definitions with code, name, default unit, category, activation and usage ranking.",
    "case_io_run": "A case administration/output row for an item: route, bolus/drip mode, start/stop interval and balance inclusion.",
    "case_io_segment": "Rate/dose/carrier intervals within an I/O run. The summary calculates delivered volume over interval overlap.",
    "case_io_event": "Discrete I/O administrations or outputs with timestamp, volume/dose, units and balance inclusion. Links to case and item; there is no run_id column.",
    "case_io_audit": "Before/after JSON audit of run, segment and event mutations, with reason and actor.",
    "sync_leaf_node": "Registered Leaf identity, hospital, display name, heartbeat timestamps and metadata.",
    "sync_message": "Received synchronization envelopes. Unique (leaf_id, message_id) supports duplicate-delivery rejection.",
    "sync_case_index": "Canopy's per-Leaf case index and JSONB snapshot, using a global UUID plus the source Leaf case ID.",
    "case_clinical_audit": "Native Python clinical mutation audit for patient identity, diagnoses, procedures, staff and forms. Introduced by migration 0005.",
}


def cell(value):
    return str(value if value is not None else "—").replace("|", "\\|").replace("\n", " ")


with psycopg.connect(os.environ["FLORA_DATABASE_URL"], row_factory=dict_row) as db:
    db.execute("SET TRANSACTION READ ONLY")
    meta = db.execute("SELECT current_database() AS database, current_setting('server_version') AS version, current_setting('TimeZone') AS timezone").fetchone()
    tables = db.execute("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename").fetchall()
    columns = db.execute("""SELECT table_name,column_name,data_type,udt_name,is_nullable,column_default,
        character_maximum_length,is_identity,identity_generation,ordinal_position
        FROM information_schema.columns WHERE table_schema='public' ORDER BY table_name,ordinal_position""").fetchall()
    constraints = db.execute("""SELECT t.relname AS table_name,c.conname,c.contype,
        pg_get_constraintdef(c.oid,true) AS definition, c.convalidated
        FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid
        JOIN pg_namespace n ON n.oid=t.relnamespace WHERE n.nspname='public'
        ORDER BY t.relname,c.contype,c.conname""").fetchall()
    indexes = db.execute("SELECT tablename,indexname,indexdef FROM pg_indexes WHERE schemaname='public' ORDER BY tablename,indexname").fetchall()
    sequences = db.execute("SELECT sequencename,data_type,start_value,min_value,max_value,increment_by,cycle FROM pg_sequences WHERE schemaname='public' ORDER BY sequencename").fetchall()
    grants = db.execute("""SELECT table_name,grantee,string_agg(privilege_type,', ' ORDER BY privilege_type) AS privileges
        FROM information_schema.table_privileges WHERE table_schema='public' AND grantee IN ('flora_app','flora_view','flora_sync')
        GROUP BY table_name,grantee ORDER BY table_name,grantee""").fetchall()
    views = db.execute("SELECT viewname,definition FROM pg_views WHERE schemaname='public' ORDER BY viewname").fetchall()

lines=["# Flora PostgreSQL structure", "", f"Generated from PostgreSQL catalog metadata on {datetime.now(timezone.utc).isoformat(timespec='seconds')}.", "",
    f"Database: `{meta['database']}`. PostgreSQL: `{meta['version']}`. Server timezone: `{meta['timezone']}`.",
    f"Public schema: **{len(tables)} tables**, **{len(columns)} columns**, **{len(constraints)} constraints**, **{len(indexes)} indexes**, **{len(sequences)} sequences**, **{len(views)} views**.", "",
    "This describes the inspected database, not an idealized future schema. No patient rows, passwords, tokens, payload contents or connection credentials are included.", "",
    "See [backend responsibilities](BACKEND-ARCHITECTURE.md), [route inventory](BACKEND-API-INVENTORY.md), and [schema-only SQL](database/flora-schema.sql).",
    "", "## Storage conventions and important distinctions", "",
    "- Clinical timestamps such as `start_time`, `event_ts`, `ts_minute` and most `created_at` columns are bigint Unix epoch **milliseconds**. Display them in Asia/Bangkok; they are not PostgreSQL timestamp columns.",
    "- Sync heartbeat/envelope timestamps use `timestamp with time zone`. Check each column below instead of applying a single conversion to every timestamp.",
    "- Imported clinical JSON commonly uses `text` (`payload`, `raw_payload`, `form_draft_json`, audit JSON). Sync snapshots/envelopes use `jsonb`.",
    "- Imported boolean-like flags commonly use bigint `0`/`1`. Defaults, nullability and CHECK constraints below are authoritative.",
    "- A blank/null observation is not automatically zero. I/O inclusion flags affect calculation and must be retained.",
    "- `cases.id` is a local database identity. Multi-Leaf case identity uses `sync_case_index.global_case_id` and `(leaf_id, source_case_id)`.",
    "- Current patient/allergy reads use `case_his_patient` and `case_his_allergy`. Older snapshot/allergy tables are still retained.",
    "- Staff assignments currently lack explicit time-in/time-out columns. That future workflow needs a schema change.",
    "- `case_io_event` references the case and master item, not a run. Do not invent a run foreign key when joining administrations.",
    "- A schema-only SQL export is not a data backup and does not contain master lookup rows or populated sequence positions.",
    "", "## Deployed schema migrations", "",
    "Migration [0005-leaf-writes.sql](../infrastructure/postgres/0005-leaf-writes.sql) supplies PostgreSQL sequences and the clinical mutation audit used by the FastAPI Leaf service. Migration [0006-native-object-names.sql](../infrastructure/postgres/0006-native-object-names.sql) replaces legacy-derived database object names. The catalog below is generated from the deployed Leaf database.",
    "", "## Table purposes", "", "| Table | Responsibility |", "| --- | --- |"]
for table in tables:
    name=table["tablename"]
    lines.append(f"| [{name}](#{name.replace('_','-')}) | {DESCRIPTIONS.get(name,'Inspect application usage; no purpose annotation has been assigned.')} |")
lines.extend(["", "## Relationship overview", "", "```text", "auth_user ── auth_session / auth_audit", "cases ── patient snapshots / HIS patient, allergies, labs", "      ├─ diagnoses / procedures / staff / form detail", "      ├─ vital_minutes / timeline values + audit / events + audit", "      └─ I/O runs ── segments", "         I/O events ── io_item_master", "         I/O audits", "his_patient_buffer ── HIS allergy/lab buffers", "sync_leaf_node ── sync_message / sync_case_index (JSONB snapshots)", "```", "", "This is a conceptual ownership map. The per-table FOREIGN KEY definitions below identify the relationships actually enforced by PostgreSQL.", "", "## Table definitions"])
for table in tables:
    name=table["tablename"]
    lines.extend(["",f"<a id=\"{name.replace('_','-')}\"></a>",f"### `{name}`","",DESCRIPTIONS.get(name,""),"",
        "| Column | PostgreSQL type | Nullable | Default / identity |", "| --- | --- | --- | --- |"])
    for column in columns:
        if column["table_name"]!=name: continue
        typ=column["data_type"]
        if typ=="USER-DEFINED": typ=column["udt_name"]
        default=column["column_default"]
        if column["is_identity"]=="YES": default=f"GENERATED {column['identity_generation']} AS IDENTITY"
        lines.append(f"| `{column['column_name']}` | {cell(typ)} | {column['is_nullable']} | {cell(default)} |")
    lines.extend(["", "Constraints:", ""])
    found=[r for r in constraints if r["table_name"]==name]
    if not found: lines.append("None declared.")
    for row in found:
        suffix=" (not validated)" if not row["convalidated"] else ""
        lines.append(f"- `{row['conname']}`: `{row['definition']}`{suffix}")
    lines.extend(["", "Indexes:", "", "```sql"])
    lines.extend(row["indexdef"]+";" for row in indexes if row["tablename"]==name)
    lines.append("```")
lines.extend(["", "## Sequences", "", "| Sequence | Type | Start | Increment | Cycles |", "| --- | --- | ---: | ---: | --- |"])
for row in sequences:
    lines.append(f"| `{row['sequencename']}` | {row['data_type']} | {row['start_value']} | {row['increment_by']} | {row['cycle']} |")
lines.extend(["", "## Application table privileges", "", "These are catalog-reported table privileges, not a full audit of inherited role capabilities or endpoint authorization.", "",
    "| Table | Role | Granted privileges |", "| --- | --- | --- |"])
for row in grants:
    lines.append(f"| `{row['table_name']}` | `{row['grantee']}` | {row['privileges']} |")
lines.extend(["", "## Views", ""])
if not views: lines.append("No public views are declared.")
for row in views:
    lines.extend([f"### `{row['viewname']}`", "", "```sql",row["definition"],"```", ""])
lines.extend(["", "## Regeneration", "", "Run `scripts/export-postgres-catalog.py` with psycopg available and `FLORA_DATABASE_URL` pointing to the database being documented. The script prints Markdown to stdout and reads metadata only. Export SQL with `pg_dump --schema-only --no-owner --no-privileges`. Regenerate after applying schema migrations.", ""])
print("\n".join(lines))
