# Flora PostgreSQL structure

Generated from PostgreSQL catalog metadata on 2026-09-16T03:27:14+00:00.

Database: `flora`. PostgreSQL: `17.6`. Server timezone: `UTC`.
Public schema: **37 tables**, **489 columns**, **91 constraints**, **97 indexes**, **32 sequences**, **0 views**.

This describes the inspected database, not an idealized future schema. No patient rows, passwords, tokens, payload contents or connection credentials are included.

See [backend responsibilities](BACKEND-ARCHITECTURE.md), [route inventory](BACKEND-API-INVENTORY.md), and [schema-only SQL](database/flora-schema.sql).

## Storage conventions and important distinctions

- Clinical timestamps such as `start_time`, `event_ts`, `ts_minute` and most `created_at` columns are bigint Unix epoch **milliseconds**. Display them in Asia/Bangkok; they are not PostgreSQL timestamp columns.
- Sync heartbeat/envelope timestamps use `timestamp with time zone`. Check each column below instead of applying a single conversion to every timestamp.
- Imported clinical JSON commonly uses `text` (`payload`, `raw_payload`, `form_draft_json`, audit JSON). Sync snapshots/envelopes use `jsonb`.
- Imported boolean-like flags commonly use bigint `0`/`1`. Defaults, nullability and CHECK constraints below are authoritative.
- A blank/null observation is not automatically zero. I/O inclusion flags affect calculation and must be retained.
- `cases.id` is a local database identity. Multi-Leaf case identity uses `sync_case_index.global_case_id` and `(leaf_id, source_case_id)`.
- Current patient/allergy reads use `case_his_patient` and `case_his_allergy`. Older snapshot/allergy tables are still retained.
- Staff assignments currently lack explicit time-in/time-out columns. That future workflow needs a schema change.
- `case_io_event` references the case and master item, not a run. Do not invent a run foreign key when joining administrations.
- A schema-only SQL export is not a data backup and does not contain master lookup rows or populated sequence positions.

## Deployed schema migrations

Migration [0005-leaf-writes.sql](../infrastructure/postgres/0005-leaf-writes.sql) supplies PostgreSQL sequences and the clinical mutation audit used by the FastAPI Leaf service. Migration [0006-native-object-names.sql](../infrastructure/postgres/0006-native-object-names.sql) replaces legacy-derived database object names. The catalog below is generated from the deployed Leaf database.

## Table purposes

| Table | Responsibility |
| --- | --- |
| [auth_audit](#auth-audit) | Authentication and account-administration audit records, including actor, target, outcome and JSON details. |
| [auth_session](#auth-session) | Opaque login sessions. Stores token hashes, user ownership, expiry, last-seen and revocation times. |
| [auth_user](#auth-user) | User accounts, password hashes/salts, roles, activation and theme preferences. Passwords are not stored as plaintext. |
| [case_allergy](#case-allergy) | Earlier allergy model retained from import. Current allergy routes use case_his_allergy instead. |
| [case_clinical_audit](#case-clinical-audit) | Native Python clinical mutation audit for patient identity, diagnoses, procedures, staff and forms. Introduced by migration 0005. |
| [case_detail](#case-detail) | Per-case detail fields and saved clinical form draft JSON. The form renderer consumes the draft payload; this is not a separate table per form question. |
| [case_device_ingest_audit](#case-device-ingest-audit) | Device import provenance: requested intervals, source endpoint, row counts, actor, outcome and diagnostic details. |
| [case_diagnosis](#case-diagnosis) | Ordered case diagnoses with free text and optional ICD code/version/description. |
| [case_event_note](#case-event-note) | Timeline events and clinical notes with timestamps, titles, details, authors and a soft-deletion flag. |
| [case_event_note_audit](#case-event-note-audit) | Before/after history for event and note creation, editing and soft deletion. |
| [case_his_allergy](#case-his-allergy) | Allergy records consumed by the case API. Holds allergen, reaction, severity, status and source; also stores manually entered allergies. |
| [case_his_lab](#case-his-lab) | Case laboratory results with test/group labels, units, reference range, flags, dates and source provenance. |
| [case_his_patient](#case-his-patient) | Current case demographic/HIS snapshot, including identifiers, names, demographics, contacts, body measurements, provenance and raw source payload. |
| [case_io_audit](#case-io-audit) | Before/after JSON audit of run, segment and event mutations, with reason and actor. |
| [case_io_event](#case-io-event) | Discrete I/O administrations or outputs with timestamp, volume/dose, units and balance inclusion. Links to case and item; there is no run_id column. |
| [case_io_run](#case-io-run) | A case administration/output row for an item: route, bolus/drip mode, start/stop interval and balance inclusion. |
| [case_io_segment](#case-io-segment) | Rate/dose/carrier intervals within an I/O run. The summary calculates delivered volume over interval overlap. |
| [case_procedure](#case-procedure) | Ordered operations/procedures with free text and optional ICD procedure coding. |
| [case_staff](#case-staff) | Ordered staff assignments for a case with identity, role and authorship. Current schema has no explicit staff time-in/time-out columns. |
| [case_timeline_audit](#case-timeline-audit) | History of timeline insertions, corrections and deletions, with old/new values, reason and actor. |
| [case_timeline_value](#case-timeline-value) | Current manual chart values and device overrides, identified by case, minute and parameter. Stores typed numeric/text values, units, source and author. |
| [cases](#cases) | Root clinical encounter: case code, HN, start/capture/discharge/archive times and lifecycle status. Most clinical tables reference this ID. |
| [ephis_daily_case](#ephis-daily-case) | Imported EPHIS daily admission/case list. Supports daily count/reconciliation views; does not itself upload a PDF to EPHIS. |
| [his_allergy_buffer](#his-allergy-buffer) | Preloaded HIS allergies associated with the HN buffer rather than a case ID. |
| [his_lab_buffer](#his-lab-buffer) | Preloaded HIS laboratory results associated with the HN buffer rather than a case ID. |
| [his_patient_buffer](#his-patient-buffer) | Preloaded HIS demographics before association with a case, keyed by HN. |
| [icd10_master](#icd10-master) | Diagnosis coding lookup, including English/Thai descriptions and source coding attributes. |
| [icd9cm_master](#icd9cm-master) | Procedure coding lookup used by the operation/procedure picker. |
| [io_item_master](#io-item-master) | Medication, fluid and output item definitions with code, name, default unit, category, activation and usage ranking. |
| [legacy_med_drip_preset_analysis](#legacy-med-drip-preset-analysis) | Retained analysis of legacy medication/drip presets. Supporting migration/reference data, not the primary administration ledger. |
| [patient_snapshot](#patient-snapshot) | Earlier patient snapshot model retained from the imported database. Current patient API reads case_his_patient; do not assume this table is the active demographic source. |
| [staff_directory](#staff-directory) | Reusable staff directory: identifiers, names, role, activation, usage counts and last-use metadata. |
| [staff_role](#staff-role) | Staff role codes and display labels used by the directory and case assignments. |
| [sync_case_index](#sync-case-index) | Canopy's per-Leaf case index and JSONB snapshot, using a global UUID plus the source Leaf case ID. |
| [sync_leaf_node](#sync-leaf-node) | Registered Leaf identity, hospital, display name, heartbeat timestamps and metadata. |
| [sync_message](#sync-message) | Received synchronization envelopes. Unique (leaf_id, message_id) supports duplicate-delivery rejection. |
| [vital_minutes](#vital-minutes) | Device observations grouped into a JSON-text payload per case, source and minute. This is device data, not manual chart overrides. |

## Relationship overview

```text
auth_user ── auth_session / auth_audit
cases ── patient snapshots / HIS patient, allergies, labs
      ├─ diagnoses / procedures / staff / form detail
      ├─ vital_minutes / timeline values + audit / events + audit
      └─ I/O runs ── segments
         I/O events ── io_item_master
         I/O audits
his_patient_buffer ── HIS allergy/lab buffers
sync_leaf_node ── sync_message / sync_case_index (JSONB snapshots)
```

This is a conceptual ownership map. The per-table FOREIGN KEY definitions below identify the relationships actually enforced by PostgreSQL.

## Table definitions

<a id="auth-audit"></a>
### `auth_audit`

Authentication and account-administration audit records, including actor, target, outcome and JSON details.

| Column | PostgreSQL type | Nullable | Default / identity |
| --- | --- | --- | --- |
| `id` | bigint | NO | nextval('auth_audit_id_seq'::regclass) |
| `action` | text | YES | — |
| `actor_user_id` | bigint | YES | — |
| `actor_username` | text | YES | — |
| `actor_role` | text | YES | — |
| `target_user_id` | bigint | YES | — |
| `target_username` | text | YES | — |
| `status` | text | YES | 'ok'::text |
| `detail_json` | text | YES | — |
| `created_at` | bigint | YES | — |

Constraints:

- `auth_audit_actor_user_id_fkey`: `FOREIGN KEY (actor_user_id) REFERENCES auth_user(id) ON DELETE SET NULL`
- `auth_audit_target_user_id_fkey`: `FOREIGN KEY (target_user_id) REFERENCES auth_user(id) ON DELETE SET NULL`
- `idx_16416_auth_audit_pkey`: `PRIMARY KEY (id)`

Indexes:

```sql
CREATE UNIQUE INDEX idx_16416_auth_audit_pkey ON public.auth_audit USING btree (id);
CREATE INDEX idx_16416_idx_auth_audit_created ON public.auth_audit USING btree (created_at, id);
```

<a id="auth-session"></a>
### `auth_session`

Opaque login sessions. Stores token hashes, user ownership, expiry, last-seen and revocation times.

| Column | PostgreSQL type | Nullable | Default / identity |
| --- | --- | --- | --- |
| `id` | bigint | NO | nextval('auth_session_id_seq'::regclass) |
| `user_id` | bigint | YES | — |
| `token_hash` | text | YES | — |
| `client_label` | text | YES | — |
| `created_at` | bigint | YES | — |
| `updated_at` | bigint | YES | — |
| `last_seen_at` | bigint | YES | — |
| `expires_at` | bigint | YES | — |
| `revoked_at` | bigint | YES | — |

Constraints:

- `auth_session_user_id_fkey`: `FOREIGN KEY (user_id) REFERENCES auth_user(id) ON DELETE CASCADE`
- `idx_16409_auth_session_pkey`: `PRIMARY KEY (id)`

Indexes:

```sql
CREATE UNIQUE INDEX auth_session_token_hash_key ON public.auth_session USING btree (token_hash);
CREATE UNIQUE INDEX idx_16409_auth_session_pkey ON public.auth_session USING btree (id);
CREATE INDEX idx_16409_idx_auth_session_user ON public.auth_session USING btree (user_id, revoked_at, expires_at);
```

<a id="auth-user"></a>
### `auth_user`

User accounts, password hashes/salts, roles, activation and theme preferences. Passwords are not stored as plaintext.

| Column | PostgreSQL type | Nullable | Default / identity |
| --- | --- | --- | --- |
| `id` | bigint | NO | nextval('auth_user_id_seq'::regclass) |
| `username` | text | YES | — |
| `hospital_id` | text | YES | — |
| `auth_source` | text | YES | 'local'::text |
| `password_salt` | text | YES | — |
| `password_hash` | text | YES | — |
| `name` | text | YES | — |
| `role` | text | YES | — |
| `theme_mode` | text | YES | — |
| `theme_color` | text | YES | — |
| `is_active` | bigint | YES | '1'::bigint |
| `created_at` | bigint | YES | — |
| `updated_at` | bigint | YES | — |
| `last_login_at` | bigint | YES | — |

Constraints:

- `auth_user_is_active_check`: `CHECK (is_active = ANY (ARRAY[0::bigint, 1::bigint]))`
- `idx_16400_auth_user_pkey`: `PRIMARY KEY (id)`

Indexes:

```sql
CREATE UNIQUE INDEX auth_user_username_key ON public.auth_user USING btree (username);
CREATE UNIQUE INDEX idx_16400_auth_user_pkey ON public.auth_user USING btree (id);
CREATE UNIQUE INDEX idx_16400_idx_auth_user_hospital_id ON public.auth_user USING btree (hospital_id);
CREATE INDEX idx_16400_idx_auth_user_username ON public.auth_user USING btree (username);
```

<a id="case-allergy"></a>
### `case_allergy`

Earlier allergy model retained from import. Current allergy routes use case_his_allergy instead.

| Column | PostgreSQL type | Nullable | Default / identity |
| --- | --- | --- | --- |
| `id` | bigint | NO | nextval('case_allergy_id_seq'::regclass) |
| `case_id` | bigint | YES | — |
| `allergen` | text | YES | — |
| `reaction` | text | YES | — |
| `severity` | text | YES | — |
| `seq` | bigint | YES | '1'::bigint |
| `created_at` | bigint | YES | — |

Constraints:

- `case_allergy_case_id_fkey`: `FOREIGN KEY (case_id) REFERENCES cases(id) ON DELETE CASCADE`
- `idx_16514_case_allergy_pkey`: `PRIMARY KEY (id)`

Indexes:

```sql
CREATE UNIQUE INDEX idx_16514_case_allergy_pkey ON public.case_allergy USING btree (id);
CREATE INDEX idx_16514_idx_case_allergy_case ON public.case_allergy USING btree (case_id);
```

<a id="case-clinical-audit"></a>
### `case_clinical_audit`

Native Python clinical mutation audit for patient identity, diagnoses, procedures, staff and forms. Introduced by migration 0005.

| Column | PostgreSQL type | Nullable | Default / identity |
| --- | --- | --- | --- |
| `id` | bigint | NO | nextval('case_clinical_audit_id_seq'::regclass) |
| `case_id` | bigint | NO | — |
| `action` | text | NO | — |
| `before_json` | text | YES | — |
| `after_json` | text | YES | — |
| `actor_username` | text | NO | — |
| `actor_role` | text | YES | — |
| `created_at` | bigint | NO | — |

Constraints:

- `case_clinical_audit_case_id_fkey`: `FOREIGN KEY (case_id) REFERENCES cases(id)`
- `case_clinical_audit_pkey`: `PRIMARY KEY (id)`

Indexes:

```sql
CREATE INDEX case_clinical_audit_case ON public.case_clinical_audit USING btree (case_id, created_at);
CREATE UNIQUE INDEX case_clinical_audit_pkey ON public.case_clinical_audit USING btree (id);
```

<a id="case-detail"></a>
### `case_detail`

Per-case detail fields and saved clinical form draft JSON. The form renderer consumes the draft payload; this is not a separate table per form question.

| Column | PostgreSQL type | Nullable | Default / identity |
| --- | --- | --- | --- |
| `id` | bigint | NO | nextval('case_detail_id_seq'::regclass) |
| `case_id` | bigint | YES | — |
| `surgeon` | text | YES | — |
| `or_room` | text | YES | — |
| `case_type` | text | YES | — |
| `note` | text | YES | — |
| `form_draft_json` | text | YES | — |
| `created_at` | bigint | YES | — |
| `updated_at` | bigint | YES | — |

Constraints:

- `case_detail_case_type_check`: `CHECK (case_type = ANY (ARRAY['elective'::text, 'emergency'::text]))`
- `case_detail_case_id_fkey`: `FOREIGN KEY (case_id) REFERENCES cases(id) ON DELETE CASCADE`
- `idx_16474_case_detail_pkey`: `PRIMARY KEY (id)`

Indexes:

```sql
CREATE UNIQUE INDEX case_detail_case_key ON public.case_detail USING btree (case_id);
CREATE UNIQUE INDEX idx_16474_case_detail_pkey ON public.case_detail USING btree (id);
CREATE INDEX idx_16474_idx_case_detail_case ON public.case_detail USING btree (case_id);
```

<a id="case-device-ingest-audit"></a>
### `case_device_ingest_audit`

Device import provenance: requested intervals, source endpoint, row counts, actor, outcome and diagnostic details.

| Column | PostgreSQL type | Nullable | Default / identity |
| --- | --- | --- | --- |
| `id` | bigint | NO | nextval('case_device_ingest_audit_id_seq'::regclass) |
| `case_id` | bigint | YES | — |
| `hn` | text | YES | — |
| `source_service` | text | YES | — |
| `source_endpoint` | text | YES | — |
| `fetch_mode` | text | YES | — |
| `minute_ts` | bigint | YES | — |
| `from_ts` | bigint | YES | — |
| `to_ts` | bigint | YES | — |
| `raw_row_count` | bigint | YES | '0'::bigint |
| `written_row_count` | bigint | YES | '0'::bigint |
| `status` | text | YES | — |
| `actor_username` | text | YES | — |
| `actor_role` | text | YES | — |
| `detail_json` | text | YES | — |
| `created_at` | bigint | YES | — |

Constraints:

- `case_device_ingest_audit_fetch_mode_check`: `CHECK (fetch_mode = ANY (ARRAY['minute'::text, 'bulk'::text]))`
- `case_device_ingest_audit_status_check`: `CHECK (status = ANY (ARRAY['ok'::text, 'empty'::text, 'failed'::text]))`
- `case_device_ingest_audit_case_id_fkey`: `FOREIGN KEY (case_id) REFERENCES cases(id) ON DELETE CASCADE`
- `idx_16431_case_device_ingest_audit_pkey`: `PRIMARY KEY (id)`

Indexes:

```sql
CREATE UNIQUE INDEX idx_16431_case_device_ingest_audit_pkey ON public.case_device_ingest_audit USING btree (id);
CREATE INDEX idx_16431_idx_case_device_ingest_audit_case ON public.case_device_ingest_audit USING btree (case_id, created_at, id);
```

<a id="case-diagnosis"></a>
### `case_diagnosis`

Ordered case diagnoses with free text and optional ICD code/version/description.

| Column | PostgreSQL type | Nullable | Default / identity |
| --- | --- | --- | --- |
| `id` | bigint | NO | nextval('case_diagnosis_id_seq'::regclass) |
| `case_id` | bigint | YES | — |
| `diagnosis_text` | text | YES | — |
| `icd_text` | text | YES | — |
| `icd_code` | text | YES | — |
| `icd_version` | text | YES | — |
| `seq` | bigint | YES | '1'::bigint |
| `created_at` | bigint | YES | — |

Constraints:

- `case_diagnosis_case_id_fkey`: `FOREIGN KEY (case_id) REFERENCES cases(id) ON DELETE CASCADE`
- `idx_16481_case_diagnosis_pkey`: `PRIMARY KEY (id)`

Indexes:

```sql
CREATE UNIQUE INDEX idx_16481_case_diagnosis_pkey ON public.case_diagnosis USING btree (id);
CREATE INDEX idx_16481_idx_case_diagnosis_case ON public.case_diagnosis USING btree (case_id);
```

<a id="case-event-note"></a>
### `case_event_note`

Timeline events and clinical notes with timestamps, titles, details, authors and a soft-deletion flag.

| Column | PostgreSQL type | Nullable | Default / identity |
| --- | --- | --- | --- |
| `id` | bigint | NO | nextval('case_event_note_id_seq'::regclass) |
| `case_id` | bigint | YES | — |
| `event_ts` | bigint | YES | — |
| `event_type` | text | YES | — |
| `title` | text | YES | — |
| `detail` | text | YES | — |
| `created_by` | text | YES | — |
| `created_at` | bigint | YES | — |
| `updated_by` | text | YES | — |
| `updated_at` | bigint | YES | — |
| `is_deleted` | bigint | YES | '0'::bigint |

Constraints:

- `case_event_note_event_type_check`: `CHECK (event_type = ANY (ARRAY['event'::text, 'note'::text]))`
- `case_event_note_is_deleted_check`: `CHECK (is_deleted = ANY (ARRAY[0::bigint, 1::bigint]))`
- `case_event_note_case_id_fkey`: `FOREIGN KEY (case_id) REFERENCES cases(id) ON DELETE CASCADE`
- `idx_16454_case_event_note_pkey`: `PRIMARY KEY (id)`

Indexes:

```sql
CREATE UNIQUE INDEX idx_16454_case_event_note_pkey ON public.case_event_note USING btree (id);
CREATE INDEX idx_16454_idx_case_event_note_case ON public.case_event_note USING btree (case_id, event_ts, id);
CREATE INDEX idx_16454_idx_case_event_note_lifecycle ON public.case_event_note USING btree (case_id, event_type, is_deleted, event_ts, id);
```

<a id="case-event-note-audit"></a>
### `case_event_note_audit`

Before/after history for event and note creation, editing and soft deletion.

| Column | PostgreSQL type | Nullable | Default / identity |
| --- | --- | --- | --- |
| `id` | bigint | NO | nextval('case_event_note_audit_id_seq'::regclass) |
| `case_id` | bigint | YES | — |
| `event_note_id` | bigint | YES | — |
| `action` | text | YES | — |
| `old_event_ts` | bigint | YES | — |
| `old_event_type` | text | YES | — |
| `old_title` | text | YES | — |
| `old_detail` | text | YES | — |
| `new_event_ts` | bigint | YES | — |
| `new_event_type` | text | YES | — |
| `new_title` | text | YES | — |
| `new_detail` | text | YES | — |
| `reason` | text | YES | — |
| `actor_username` | text | YES | — |
| `actor_name` | text | YES | — |
| `actor_role` | text | YES | — |
| `created_at` | bigint | YES | — |

Constraints:

- `case_event_note_audit_action_check`: `CHECK (action = ANY (ARRAY['insert'::text, 'update'::text, 'delete'::text]))`
- `case_event_note_audit_case_id_fkey`: `FOREIGN KEY (case_id) REFERENCES cases(id) ON DELETE CASCADE`
- `idx_16462_case_event_note_audit_pkey`: `PRIMARY KEY (id)`

Indexes:

```sql
CREATE UNIQUE INDEX idx_16462_case_event_note_audit_pkey ON public.case_event_note_audit USING btree (id);
CREATE INDEX idx_16462_idx_case_event_note_audit_case ON public.case_event_note_audit USING btree (case_id, created_at);
```

<a id="case-his-allergy"></a>
### `case_his_allergy`

Allergy records consumed by the case API. Holds allergen, reaction, severity, status and source; also stores manually entered allergies.

| Column | PostgreSQL type | Nullable | Default / identity |
| --- | --- | --- | --- |
| `id` | bigint | NO | nextval('case_his_allergy_id_seq'::regclass) |
| `case_id` | bigint | YES | — |
| `allergen` | text | YES | — |
| `reaction` | text | YES | — |
| `severity` | text | YES | — |
| `status` | text | YES | — |
| `source` | text | YES | — |
| `raw_payload` | text | YES | — |
| `his_updated_at` | bigint | YES | — |
| `created_at` | bigint | YES | — |
| `updated_at` | bigint | YES | — |

Constraints:

- `case_his_allergy_case_id_fkey`: `FOREIGN KEY (case_id) REFERENCES cases(id) ON DELETE CASCADE`
- `idx_16526_case_his_allergy_pkey`: `PRIMARY KEY (id)`

Indexes:

```sql
CREATE UNIQUE INDEX idx_16526_case_his_allergy_pkey ON public.case_his_allergy USING btree (id);
CREATE INDEX idx_16526_idx_case_his_allergy_case ON public.case_his_allergy USING btree (case_id, id);
```

<a id="case-his-lab"></a>
### `case_his_lab`

Case laboratory results with test/group labels, units, reference range, flags, dates and source provenance.

| Column | PostgreSQL type | Nullable | Default / identity |
| --- | --- | --- | --- |
| `id` | bigint | NO | nextval('case_his_lab_id_seq'::regclass) |
| `case_id` | bigint | YES | — |
| `test_name` | text | YES | — |
| `test_group` | text | YES | — |
| `value_text` | text | YES | — |
| `unit` | text | YES | — |
| `ref_range` | text | YES | — |
| `flag` | text | YES | — |
| `collected_at` | bigint | YES | — |
| `source` | text | YES | — |
| `raw_payload` | text | YES | — |
| `his_updated_at` | bigint | YES | — |
| `created_at` | bigint | YES | — |
| `updated_at` | bigint | YES | — |

Constraints:

- `case_his_lab_case_id_fkey`: `FOREIGN KEY (case_id) REFERENCES cases(id) ON DELETE CASCADE`
- `idx_16532_case_his_lab_pkey`: `PRIMARY KEY (id)`

Indexes:

```sql
CREATE UNIQUE INDEX idx_16532_case_his_lab_pkey ON public.case_his_lab USING btree (id);
CREATE INDEX idx_16532_idx_case_his_lab_case ON public.case_his_lab USING btree (case_id, collected_at, id);
```

<a id="case-his-patient"></a>
### `case_his_patient`

Current case demographic/HIS snapshot, including identifiers, names, demographics, contacts, body measurements, provenance and raw source payload.

| Column | PostgreSQL type | Nullable | Default / identity |
| --- | --- | --- | --- |
| `id` | bigint | NO | nextval('case_his_patient_id_seq'::regclass) |
| `case_id` | bigint | YES | — |
| `hn` | text | YES | — |
| `an` | text | YES | — |
| `is_patient` | text | YES | — |
| `notype` | text | YES | — |
| `id_card` | text | YES | — |
| `patient_name` | text | YES | — |
| `title_th` | text | YES | — |
| `title_en` | text | YES | — |
| `first_name` | text | YES | — |
| `last_name` | text | YES | — |
| `first_name_en` | text | YES | — |
| `last_name_en` | text | YES | — |
| `sex` | text | YES | — |
| `dob` | text | YES | — |
| `age_text` | text | YES | — |
| `weight_kg` | real | YES | — |
| `height_cm` | real | YES | — |
| `blood_group_text` | text | YES | — |
| `blood_group_abo` | text | YES | — |
| `blood_group_rh` | text | YES | — |
| `race` | text | YES | — |
| `ethnicity` | text | YES | — |
| `religion` | text | YES | — |
| `marital_status` | text | YES | — |
| `present_address` | text | YES | — |
| `present_province` | text | YES | — |
| `legal_address` | text | YES | — |
| `legal_province` | text | YES | — |
| `mobile` | text | YES | — |
| `contact_name` | text | YES | — |
| `contact_tel` | text | YES | — |
| `relation_desc` | text | YES | — |
| `nationality` | text | YES | — |
| `source` | text | YES | — |
| `raw_payload` | text | YES | — |
| `his_updated_at` | bigint | YES | — |
| `created_at` | bigint | YES | — |
| `updated_at` | bigint | YES | — |

Constraints:

- `case_his_patient_case_id_fkey`: `FOREIGN KEY (case_id) REFERENCES cases(id) ON DELETE CASCADE`
- `idx_16520_case_his_patient_pkey`: `PRIMARY KEY (id)`

Indexes:

```sql
CREATE UNIQUE INDEX case_his_patient_case_key ON public.case_his_patient USING btree (case_id);
CREATE UNIQUE INDEX idx_16520_case_his_patient_pkey ON public.case_his_patient USING btree (id);
CREATE INDEX idx_16520_idx_case_his_patient_case ON public.case_his_patient USING btree (case_id);
```

<a id="case-io-audit"></a>
### `case_io_audit`

Before/after JSON audit of run, segment and event mutations, with reason and actor.

| Column | PostgreSQL type | Nullable | Default / identity |
| --- | --- | --- | --- |
| `id` | bigint | NO | nextval('case_io_audit_id_seq'::regclass) |
| `case_id` | bigint | YES | — |
| `entity_type` | text | YES | — |
| `entity_id` | bigint | YES | — |
| `action` | text | YES | — |
| `before_json` | text | YES | — |
| `after_json` | text | YES | — |
| `reason` | text | YES | — |
| `actor_username` | text | YES | — |
| `actor_name` | text | YES | — |
| `actor_role` | text | YES | — |
| `created_at` | bigint | YES | — |

Constraints:

- `case_io_audit_action_check`: `CHECK (action = ANY (ARRAY['insert'::text, 'update'::text, 'delete'::text]))`
- `case_io_audit_entity_type_check`: `CHECK (entity_type = ANY (ARRAY['run'::text, 'segment'::text, 'event'::text]))`
- `case_io_audit_case_id_fkey`: `FOREIGN KEY (case_id) REFERENCES cases(id) ON DELETE CASCADE`
- `idx_16609_case_io_audit_pkey`: `PRIMARY KEY (id)`

Indexes:

```sql
CREATE UNIQUE INDEX idx_16609_case_io_audit_pkey ON public.case_io_audit USING btree (id);
CREATE INDEX idx_16609_idx_case_io_audit_case ON public.case_io_audit USING btree (case_id, created_at, id);
```

<a id="case-io-event"></a>
### `case_io_event`

Discrete I/O administrations or outputs with timestamp, volume/dose, units and balance inclusion. Links to case and item; there is no run_id column.

| Column | PostgreSQL type | Nullable | Default / identity |
| --- | --- | --- | --- |
| `id` | bigint | NO | nextval('case_io_event_id_seq'::regclass) |
| `case_id` | bigint | YES | — |
| `item_id` | bigint | YES | — |
| `kind` | text | YES | — |
| `event_ts` | bigint | YES | — |
| `volume_ml` | real | YES | — |
| `dose_value` | real | YES | — |
| `dose_unit` | text | YES | — |
| `note` | text | YES | — |
| `include_in_balance` | bigint | YES | '1'::bigint |
| `created_by` | text | YES | — |
| `created_at` | bigint | YES | — |
| `updated_at` | bigint | YES | — |

Constraints:

- `case_io_event_include_in_balance_check`: `CHECK (include_in_balance = ANY (ARRAY[0::bigint, 1::bigint]))`
- `case_io_event_kind_check`: `CHECK (kind = ANY (ARRAY['fluid'::text, 'med'::text, 'output'::text]))`
- `case_io_event_case_id_fkey`: `FOREIGN KEY (case_id) REFERENCES cases(id) ON DELETE CASCADE`
- `case_io_event_item_id_fkey`: `FOREIGN KEY (item_id) REFERENCES io_item_master(id)`
- `idx_16601_case_io_event_pkey`: `PRIMARY KEY (id)`

Indexes:

```sql
CREATE UNIQUE INDEX idx_16601_case_io_event_pkey ON public.case_io_event USING btree (id);
CREATE INDEX idx_16601_idx_case_io_event_case ON public.case_io_event USING btree (case_id, event_ts, id);
```

<a id="case-io-run"></a>
### `case_io_run`

A case administration/output row for an item: route, bolus/drip mode, start/stop interval and balance inclusion.

| Column | PostgreSQL type | Nullable | Default / identity |
| --- | --- | --- | --- |
| `id` | bigint | NO | nextval('case_io_run_id_seq'::regclass) |
| `case_id` | bigint | YES | — |
| `item_id` | bigint | YES | — |
| `kind` | text | YES | — |
| `route` | text | YES | — |
| `started_at` | bigint | YES | — |
| `stopped_at` | bigint | YES | — |
| `note` | text | YES | — |
| `include_in_balance` | bigint | YES | '1'::bigint |
| `created_by` | text | YES | — |
| `created_at` | bigint | YES | — |
| `updated_at` | bigint | YES | — |
| `entry_mode` | text | YES | — |

Constraints:

- `case_io_run_entry_mode_check`: `CHECK (entry_mode = ANY (ARRAY['bolus'::text, 'drip'::text]))`
- `case_io_run_include_in_balance_check`: `CHECK (include_in_balance = ANY (ARRAY[0::bigint, 1::bigint]))`
- `case_io_run_kind_check`: `CHECK (kind = ANY (ARRAY['fluid'::text, 'med'::text, 'output'::text]))`
- `case_io_run_case_id_fkey`: `FOREIGN KEY (case_id) REFERENCES cases(id) ON DELETE CASCADE`
- `case_io_run_item_id_fkey`: `FOREIGN KEY (item_id) REFERENCES io_item_master(id)`
- `idx_16585_case_io_run_pkey`: `PRIMARY KEY (id)`

Indexes:

```sql
CREATE UNIQUE INDEX idx_16585_case_io_run_pkey ON public.case_io_run USING btree (id);
CREATE INDEX idx_16585_idx_case_io_run_case ON public.case_io_run USING btree (case_id, started_at, id);
```

<a id="case-io-segment"></a>
### `case_io_segment`

Rate/dose/carrier intervals within an I/O run. The summary calculates delivered volume over interval overlap.

| Column | PostgreSQL type | Nullable | Default / identity |
| --- | --- | --- | --- |
| `id` | bigint | NO | nextval('case_io_segment_id_seq'::regclass) |
| `run_id` | bigint | YES | — |
| `ts_from` | bigint | YES | — |
| `ts_to` | bigint | YES | — |
| `rate_value` | real | YES | — |
| `rate_unit` | text | YES | — |
| `dose_value` | real | YES | — |
| `dose_unit` | text | YES | — |
| `carrier_ml_per_hr` | real | YES | — |
| `include_in_balance` | bigint | YES | '1'::bigint |
| `note` | text | YES | — |
| `created_by` | text | YES | — |
| `created_at` | bigint | YES | — |
| `updated_at` | bigint | YES | — |

Constraints:

- `case_io_segment_include_in_balance_check`: `CHECK (include_in_balance = ANY (ARRAY[0::bigint, 1::bigint]))`
- `case_io_segment_run_id_fkey`: `FOREIGN KEY (run_id) REFERENCES case_io_run(id) ON DELETE CASCADE`
- `idx_16593_case_io_segment_pkey`: `PRIMARY KEY (id)`

Indexes:

```sql
CREATE UNIQUE INDEX idx_16593_case_io_segment_pkey ON public.case_io_segment USING btree (id);
CREATE INDEX idx_16593_idx_case_io_segment_run ON public.case_io_segment USING btree (run_id, ts_from, id);
```

<a id="case-procedure"></a>
### `case_procedure`

Ordered operations/procedures with free text and optional ICD procedure coding.

| Column | PostgreSQL type | Nullable | Default / identity |
| --- | --- | --- | --- |
| `id` | bigint | NO | nextval('case_procedure_id_seq'::regclass) |
| `case_id` | bigint | YES | — |
| `procedure_text` | text | YES | — |
| `icd_text` | text | YES | — |
| `icd_code` | text | YES | — |
| `icd_version` | text | YES | — |
| `seq` | bigint | YES | '1'::bigint |
| `created_at` | bigint | YES | — |

Constraints:

- `case_procedure_case_id_fkey`: `FOREIGN KEY (case_id) REFERENCES cases(id) ON DELETE CASCADE`
- `idx_16489_case_procedure_pkey`: `PRIMARY KEY (id)`

Indexes:

```sql
CREATE UNIQUE INDEX idx_16489_case_procedure_pkey ON public.case_procedure USING btree (id);
CREATE INDEX idx_16489_idx_case_procedure_case ON public.case_procedure USING btree (case_id);
```

<a id="case-staff"></a>
### `case_staff`

Ordered staff assignments for a case with identity, role and authorship. Current schema has no explicit staff time-in/time-out columns.

| Column | PostgreSQL type | Nullable | Default / identity |
| --- | --- | --- | --- |
| `id` | bigint | NO | nextval('case_staff_id_seq'::regclass) |
| `case_id` | bigint | YES | — |
| `hospital_id` | text | YES | — |
| `personal_id` | text | YES | — |
| `email` | text | YES | — |
| `th_first_name` | text | YES | — |
| `th_last_name` | text | YES | — |
| `en_first_name` | text | YES | — |
| `en_last_name` | text | YES | — |
| `innovian_id` | text | YES | — |
| `staff_role_id` | text | YES | — |
| `entry_year` | bigint | YES | — |
| `staff_name` | text | YES | — |
| `staff_role` | text | YES | — |
| `seq` | bigint | YES | '1'::bigint |
| `created_by` | text | YES | — |
| `created_at` | bigint | YES | — |
| `updated_at` | bigint | YES | — |

Constraints:

- `case_staff_case_id_fkey`: `FOREIGN KEY (case_id) REFERENCES cases(id) ON DELETE CASCADE`
- `idx_16557_case_staff_pkey`: `PRIMARY KEY (id)`

Indexes:

```sql
CREATE UNIQUE INDEX case_staff_identity_key ON public.case_staff USING btree (case_id, staff_name, staff_role);
CREATE UNIQUE INDEX idx_16557_case_staff_pkey ON public.case_staff USING btree (id);
CREATE INDEX idx_16557_idx_case_staff_case ON public.case_staff USING btree (case_id, seq, id);
```

<a id="case-timeline-audit"></a>
### `case_timeline_audit`

History of timeline insertions, corrections and deletions, with old/new values, reason and actor.

| Column | PostgreSQL type | Nullable | Default / identity |
| --- | --- | --- | --- |
| `id` | bigint | NO | nextval('case_timeline_audit_id_seq'::regclass) |
| `case_id` | bigint | YES | — |
| `ts_minute` | bigint | YES | — |
| `param_key` | text | YES | — |
| `action` | text | YES | — |
| `old_value_num` | real | YES | — |
| `old_value_text` | text | YES | — |
| `old_value_type` | text | YES | — |
| `new_value_num` | real | YES | — |
| `new_value_text` | text | YES | — |
| `new_value_type` | text | YES | — |
| `unit` | text | YES | — |
| `source` | text | YES | — |
| `note` | text | YES | — |
| `reason` | text | YES | — |
| `actor_username` | text | YES | — |
| `actor_name` | text | YES | — |
| `actor_role` | text | YES | — |
| `created_at` | bigint | YES | — |

Constraints:

- `case_timeline_audit_action_check`: `CHECK (action = ANY (ARRAY['insert'::text, 'update'::text, 'delete'::text]))`
- `case_timeline_audit_case_id_fkey`: `FOREIGN KEY (case_id) REFERENCES cases(id) ON DELETE CASCADE`
- `idx_16447_case_timeline_audit_pkey`: `PRIMARY KEY (id)`

Indexes:

```sql
CREATE UNIQUE INDEX idx_16447_case_timeline_audit_pkey ON public.case_timeline_audit USING btree (id);
CREATE INDEX idx_16447_idx_case_timeline_audit_case ON public.case_timeline_audit USING btree (case_id, created_at);
```

<a id="case-timeline-value"></a>
### `case_timeline_value`

Current manual chart values and device overrides, identified by case, minute and parameter. Stores typed numeric/text values, units, source and author.

| Column | PostgreSQL type | Nullable | Default / identity |
| --- | --- | --- | --- |
| `id` | bigint | NO | nextval('case_timeline_value_id_seq'::regclass) |
| `case_id` | bigint | YES | — |
| `ts_minute` | bigint | YES | — |
| `param_key` | text | YES | — |
| `value_type` | text | YES | — |
| `value_num` | real | YES | — |
| `value_text` | text | YES | — |
| `unit` | text | YES | — |
| `source` | text | YES | — |
| `note` | text | YES | — |
| `created_by` | text | YES | — |
| `updated_by` | text | YES | — |
| `created_at` | bigint | YES | — |
| `updated_at` | bigint | YES | — |

Constraints:

- `case_timeline_value_source_check`: `CHECK (source = ANY (ARRAY['manual'::text, 'override'::text]))`
- `case_timeline_value_value_type_check`: `CHECK (value_type = ANY (ARRAY['number'::text, 'text'::text, 'code'::text]))`
- `case_timeline_value_case_id_fkey`: `FOREIGN KEY (case_id) REFERENCES cases(id) ON DELETE CASCADE`
- `idx_16440_case_timeline_value_pkey`: `PRIMARY KEY (id)`

Indexes:

```sql
CREATE UNIQUE INDEX case_timeline_value_minute_param_key ON public.case_timeline_value USING btree (case_id, ts_minute, param_key);
CREATE UNIQUE INDEX idx_16440_case_timeline_value_pkey ON public.case_timeline_value USING btree (id);
CREATE INDEX idx_16440_idx_case_timeline_value_case ON public.case_timeline_value USING btree (case_id, ts_minute, param_key);
```

<a id="cases"></a>
### `cases`

Root clinical encounter: case code, HN, start/capture/discharge/archive times and lifecycle status. Most clinical tables reference this ID.

| Column | PostgreSQL type | Nullable | Default / identity |
| --- | --- | --- | --- |
| `id` | bigint | NO | nextval('cases_id_seq'::regclass) |
| `case_code` | text | YES | — |
| `hn` | text | YES | — |
| `start_time` | bigint | YES | — |
| `device_capture_start_time` | bigint | YES | — |
| `discharge_time` | bigint | YES | — |
| `archive_time` | bigint | YES | — |
| `status` | text | YES | — |
| `created_at` | bigint | YES | — |
| `updated_at` | bigint | YES | — |

Constraints:

- `cases_status_check`: `CHECK (status = ANY (ARRAY['active'::text, 'discharged'::text, 'archived'::text]))`
- `idx_16393_cases_pkey`: `PRIMARY KEY (id)`

Indexes:

```sql
CREATE UNIQUE INDEX cases_case_code_key ON public.cases USING btree (case_code);
CREATE UNIQUE INDEX idx_16393_cases_pkey ON public.cases USING btree (id);
CREATE INDEX idx_16393_idx_cases_hn_start ON public.cases USING btree (hn, start_time);
CREATE INDEX idx_16393_idx_cases_status ON public.cases USING btree (status);
```

<a id="ephis-daily-case"></a>
### `ephis_daily_case`

Imported EPHIS daily admission/case list. Supports daily count/reconciliation views; does not itself upload a PDF to EPHIS.

| Column | PostgreSQL type | Nullable | Default / identity |
| --- | --- | --- | --- |
| `id` | bigint | NO | nextval('ephis_daily_case_id_seq'::regclass) |
| `hn` | text | YES | — |
| `admit_date` | text | YES | — |
| `admit_datetime` | text | YES | — |
| `raw_admit_value` | text | YES | — |
| `source_payload` | text | YES | — |
| `imported_at` | bigint | YES | — |

Constraints:

- `idx_16537_ephis_daily_case_pkey`: `PRIMARY KEY (id)`

Indexes:

```sql
CREATE UNIQUE INDEX idx_16537_ephis_daily_case_pkey ON public.ephis_daily_case USING btree (id);
CREATE INDEX idx_16537_idx_ephis_daily_case_admit_date ON public.ephis_daily_case USING btree (admit_date, hn);
CREATE UNIQUE INDEX idx_ephis_daily_case_unique ON public.ephis_daily_case USING btree (hn, admit_date, COALESCE(admit_datetime, ''::text));
```

<a id="his-allergy-buffer"></a>
### `his_allergy_buffer`

Preloaded HIS allergies associated with the HN buffer rather than a case ID.

| Column | PostgreSQL type | Nullable | Default / identity |
| --- | --- | --- | --- |
| `id` | bigint | NO | nextval('his_allergy_buffer_id_seq'::regclass) |
| `hn` | text | YES | — |
| `allergen` | text | YES | — |
| `reaction` | text | YES | — |
| `severity` | text | YES | — |
| `status` | text | YES | — |
| `source` | text | YES | — |
| `raw_payload` | text | YES | — |
| `his_updated_at` | bigint | YES | — |
| `created_at` | bigint | YES | — |
| `updated_at` | bigint | YES | — |

Constraints:

- `idx_16547_his_allergy_buffer_pkey`: `PRIMARY KEY (id)`

Indexes:

```sql
CREATE UNIQUE INDEX idx_16547_his_allergy_buffer_pkey ON public.his_allergy_buffer USING btree (id);
CREATE INDEX idx_16547_idx_his_allergy_buffer_hn ON public.his_allergy_buffer USING btree (hn, id);
```

<a id="his-lab-buffer"></a>
### `his_lab_buffer`

Preloaded HIS laboratory results associated with the HN buffer rather than a case ID.

| Column | PostgreSQL type | Nullable | Default / identity |
| --- | --- | --- | --- |
| `id` | bigint | NO | nextval('his_lab_buffer_id_seq'::regclass) |
| `hn` | text | YES | — |
| `test_name` | text | YES | — |
| `test_group` | text | YES | — |
| `value_text` | text | YES | — |
| `unit` | text | YES | — |
| `ref_range` | text | YES | — |
| `flag` | text | YES | — |
| `collected_at` | bigint | YES | — |
| `source` | text | YES | — |
| `raw_payload` | text | YES | — |
| `his_updated_at` | bigint | YES | — |
| `created_at` | bigint | YES | — |
| `updated_at` | bigint | YES | — |

Constraints:

- `idx_16552_his_lab_buffer_pkey`: `PRIMARY KEY (id)`

Indexes:

```sql
CREATE UNIQUE INDEX idx_16552_his_lab_buffer_pkey ON public.his_lab_buffer USING btree (id);
CREATE INDEX idx_16552_idx_his_lab_buffer_hn ON public.his_lab_buffer USING btree (hn, collected_at, id);
```

<a id="his-patient-buffer"></a>
### `his_patient_buffer`

Preloaded HIS demographics before association with a case, keyed by HN.

| Column | PostgreSQL type | Nullable | Default / identity |
| --- | --- | --- | --- |
| `id` | bigint | NO | nextval('his_patient_buffer_id_seq'::regclass) |
| `hn` | text | YES | — |
| `an` | text | YES | — |
| `is_patient` | text | YES | — |
| `notype` | text | YES | — |
| `id_card` | text | YES | — |
| `patient_name` | text | YES | — |
| `title_th` | text | YES | — |
| `title_en` | text | YES | — |
| `first_name` | text | YES | — |
| `last_name` | text | YES | — |
| `first_name_en` | text | YES | — |
| `last_name_en` | text | YES | — |
| `sex` | text | YES | — |
| `dob` | text | YES | — |
| `age_text` | text | YES | — |
| `weight_kg` | real | YES | — |
| `height_cm` | real | YES | — |
| `blood_group_text` | text | YES | — |
| `blood_group_abo` | text | YES | — |
| `blood_group_rh` | text | YES | — |
| `race` | text | YES | — |
| `ethnicity` | text | YES | — |
| `religion` | text | YES | — |
| `marital_status` | text | YES | — |
| `present_address` | text | YES | — |
| `present_province` | text | YES | — |
| `legal_address` | text | YES | — |
| `legal_province` | text | YES | — |
| `mobile` | text | YES | — |
| `contact_name` | text | YES | — |
| `contact_tel` | text | YES | — |
| `relation_desc` | text | YES | — |
| `nationality` | text | YES | — |
| `source` | text | YES | — |
| `raw_payload` | text | YES | — |
| `pre_admit_at` | bigint | YES | — |
| `pre_admit_note` | text | YES | — |
| `his_updated_at` | bigint | YES | — |
| `created_at` | bigint | YES | — |
| `updated_at` | bigint | YES | — |

Constraints:

- `idx_16542_his_patient_buffer_pkey`: `PRIMARY KEY (id)`

Indexes:

```sql
CREATE UNIQUE INDEX his_patient_buffer_hn_key ON public.his_patient_buffer USING btree (hn);
CREATE UNIQUE INDEX idx_16542_his_patient_buffer_pkey ON public.his_patient_buffer USING btree (id);
CREATE INDEX idx_16542_idx_his_patient_buffer_updated ON public.his_patient_buffer USING btree (his_updated_at, hn);
```

<a id="icd10-master"></a>
### `icd10_master`

Diagnosis coding lookup, including English/Thai descriptions and source coding attributes.

| Column | PostgreSQL type | Nullable | Default / identity |
| --- | --- | --- | --- |
| `icd10` | text | NO | — |
| `icd10who` | text | YES | — |
| `diagseq` | bigint | YES | — |
| `name_en` | text | YES | — |
| `name_th` | text | YES | — |
| `extcause` | bigint | YES | — |
| `mcode` | bigint | YES | — |
| `ca` | bigint | YES | — |
| `created_at` | bigint | YES | — |
| `updated_at` | bigint | YES | — |

Constraints:

- `icd10_master_pkey`: `PRIMARY KEY (icd10)`

Indexes:

```sql
CREATE UNIQUE INDEX icd10_master_pkey ON public.icd10_master USING btree (icd10);
CREATE INDEX idx_16496_idx_icd10_master_name_en ON public.icd10_master USING btree (name_en);
CREATE INDEX idx_16496_idx_icd10_master_name_th ON public.icd10_master USING btree (name_th);
CREATE INDEX idx_16496_idx_icd10_master_who ON public.icd10_master USING btree (icd10who);
```

<a id="icd9cm-master"></a>
### `icd9cm_master`

Procedure coding lookup used by the operation/procedure picker.

| Column | PostgreSQL type | Nullable | Default / identity |
| --- | --- | --- | --- |
| `icd9cm` | text | NO | — |
| `short_name_en` | text | YES | — |
| `name_en` | text | YES | — |
| `created_at` | bigint | YES | — |
| `updated_at` | bigint | YES | — |

Constraints:

- `icd9cm_master_pkey`: `PRIMARY KEY (icd9cm)`

Indexes:

```sql
CREATE UNIQUE INDEX icd9cm_master_pkey ON public.icd9cm_master USING btree (icd9cm);
CREATE INDEX idx_16501_idx_icd9cm_master_name_en ON public.icd9cm_master USING btree (name_en);
CREATE INDEX idx_16501_idx_icd9cm_master_short_name_en ON public.icd9cm_master USING btree (short_name_en);
```

<a id="io-item-master"></a>
### `io_item_master`

Medication, fluid and output item definitions with code, name, default unit, category, activation and usage ranking.

| Column | PostgreSQL type | Nullable | Default / identity |
| --- | --- | --- | --- |
| `id` | bigint | NO | nextval('io_item_master_id_seq'::regclass) |
| `kind` | text | YES | — |
| `code` | text | YES | — |
| `name` | text | YES | — |
| `default_unit` | text | YES | — |
| `category` | text | YES | — |
| `is_active` | bigint | YES | '1'::bigint |
| `created_at` | bigint | YES | — |
| `updated_at` | bigint | YES | — |
| `usage_score` | bigint | YES | '0'::bigint |
| `usage_rank` | bigint | YES | — |

Constraints:

- `io_item_master_is_active_check`: `CHECK (is_active = ANY (ARRAY[0::bigint, 1::bigint]))`
- `io_item_master_kind_check`: `CHECK (kind = ANY (ARRAY['fluid'::text, 'med'::text, 'output'::text]))`
- `idx_16576_io_item_master_pkey`: `PRIMARY KEY (id)`

Indexes:

```sql
CREATE INDEX idx_16576_idx_io_item_master_kind ON public.io_item_master USING btree (kind, is_active, name);
CREATE UNIQUE INDEX idx_16576_io_item_master_pkey ON public.io_item_master USING btree (id);
CREATE UNIQUE INDEX io_item_master_code_key ON public.io_item_master USING btree (code);
```

<a id="legacy-med-drip-preset-analysis"></a>
### `legacy_med_drip_preset_analysis`

Retained analysis of legacy medication/drip presets. Supporting migration/reference data, not the primary administration ledger.

| Column | PostgreSQL type | Nullable | Default / identity |
| --- | --- | --- | --- |
| `id` | bigint | NO | nextval('legacy_med_drip_preset_analysis_id_seq'::regclass) |
| `source_system` | text | YES | — |
| `source_scope` | text | YES | — |
| `source_year_from` | bigint | YES | — |
| `source_year_to` | bigint | YES | — |
| `drug_name` | text | YES | — |
| `preset_rank` | bigint | YES | — |
| `route` | text | YES | — |
| `weight_based` | bigint | YES | '0'::bigint |
| `med_amount_value` | real | YES | — |
| `med_amount_unit` | text | YES | — |
| `carrier_name` | text | YES | — |
| `carrier_volume_ml` | real | YES | — |
| `concentration_value` | real | YES | — |
| `concentration_unit` | text | YES | — |
| `source_count` | bigint | YES | '0'::bigint |
| `avg_minutes` | real | YES | — |
| `first_seen` | text | YES | — |
| `last_seen` | text | YES | — |
| `flora_kind` | text | YES | — |
| `flora_entry_mode` | text | YES | — |
| `display_label` | text | YES | — |
| `selection_note` | text | YES | — |
| `is_curated` | bigint | YES | '0'::bigint |
| `imported_at` | bigint | YES | — |
| `updated_at` | bigint | YES | — |

Constraints:

- `legacy_med_drip_is_curated_check`: `CHECK (is_curated = ANY (ARRAY[0::bigint, 1::bigint]))`
- `legacy_med_drip_weight_based_check`: `CHECK (weight_based = ANY (ARRAY[0::bigint, 1::bigint]))`
- `idx_16506_legacy_med_drip_preset_analysis_pkey`: `PRIMARY KEY (id)`

Indexes:

```sql
CREATE INDEX idx_16506_idx_legacy_med_drip_preset_analysis_drug ON public.legacy_med_drip_preset_analysis USING btree (drug_name, source_count, id);
CREATE INDEX idx_16506_idx_legacy_med_drip_preset_analysis_scope ON public.legacy_med_drip_preset_analysis USING btree (source_system, source_scope, source_year_from, source_year_to, is_curated);
CREATE UNIQUE INDEX idx_16506_legacy_med_drip_preset_analysis_pkey ON public.legacy_med_drip_preset_analysis USING btree (id);
CREATE UNIQUE INDEX idx_legacy_med_drip_preset_analysis_key ON public.legacy_med_drip_preset_analysis USING btree (source_system, source_scope, COALESCE(source_year_from, (0)::bigint), COALESCE(source_year_to, (0)::bigint), drug_name, COALESCE(route, ''::text), weight_based, COALESCE(med_amount_value, (0)::real), COALESCE(med_amount_unit, ''::text), COALESCE(carrier_name, ''::text), COALESCE(carrier_volume_ml, (0)::real), COALESCE(concentration_value, (0)::real), COALESCE(concentration_unit, ''::text));
```

<a id="patient-snapshot"></a>
### `patient_snapshot`

Earlier patient snapshot model retained from the imported database. Current patient API reads case_his_patient; do not assume this table is the active demographic source.

| Column | PostgreSQL type | Nullable | Default / identity |
| --- | --- | --- | --- |
| `id` | bigint | NO | nextval('patient_snapshot_id_seq'::regclass) |
| `case_id` | bigint | YES | — |
| `hn` | text | YES | — |
| `name` | text | YES | — |
| `gender` | text | YES | — |
| `id_number` | text | YES | — |
| `blood_group` | text | YES | — |
| `dob` | bigint | YES | — |
| `age_at_start` | bigint | YES | — |
| `weight` | real | YES | — |
| `asa_status` | text | YES | — |
| `created_at` | bigint | YES | — |
| `updated_at` | bigint | YES | — |

Constraints:

- `patient_snapshot_case_id_fkey`: `FOREIGN KEY (case_id) REFERENCES cases(id) ON DELETE CASCADE`
- `idx_16468_patient_snapshot_pkey`: `PRIMARY KEY (id)`

Indexes:

```sql
CREATE INDEX idx_16468_idx_patient_snapshot_case ON public.patient_snapshot USING btree (case_id);
CREATE UNIQUE INDEX idx_16468_patient_snapshot_pkey ON public.patient_snapshot USING btree (id);
CREATE UNIQUE INDEX patient_snapshot_case_key ON public.patient_snapshot USING btree (case_id);
```

<a id="staff-directory"></a>
### `staff_directory`

Reusable staff directory: identifiers, names, role, activation, usage counts and last-use metadata.

| Column | PostgreSQL type | Nullable | Default / identity |
| --- | --- | --- | --- |
| `id` | bigint | NO | nextval('staff_directory_id_seq'::regclass) |
| `hospital_id` | text | YES | — |
| `personal_id` | text | YES | — |
| `email` | text | YES | — |
| `th_first_name` | text | YES | — |
| `th_last_name` | text | YES | — |
| `en_first_name` | text | YES | — |
| `en_last_name` | text | YES | — |
| `innovian_id` | text | YES | — |
| `staff_role_id` | text | YES | — |
| `entry_year` | bigint | YES | — |
| `is_active` | bigint | YES | '1'::bigint |
| `staff_name` | text | YES | — |
| `staff_role` | text | YES | — |
| `used_count` | bigint | YES | '0'::bigint |
| `last_used_at` | bigint | YES | — |
| `created_at` | bigint | YES | — |
| `updated_at` | bigint | YES | — |

Constraints:

- `staff_directory_is_active_check`: `CHECK (is_active = ANY (ARRAY[0::bigint, 1::bigint]))`
- `idx_16563_staff_directory_pkey`: `PRIMARY KEY (id)`

Indexes:

```sql
CREATE INDEX idx_16563_idx_staff_directory_last_used ON public.staff_directory USING btree (last_used_at, used_count);
CREATE UNIQUE INDEX idx_16563_staff_directory_pkey ON public.staff_directory USING btree (id);
CREATE UNIQUE INDEX staff_directory_identity_key ON public.staff_directory USING btree (staff_name, staff_role);
```

<a id="staff-role"></a>
### `staff_role`

Staff role codes and display labels used by the directory and case assignments.

| Column | PostgreSQL type | Nullable | Default / identity |
| --- | --- | --- | --- |
| `id` | text | NO | — |
| `display_name` | text | YES | — |
| `sort_order` | bigint | YES | — |

Constraints:

- `staff_role_pkey`: `PRIMARY KEY (id)`

Indexes:

```sql
CREATE UNIQUE INDEX staff_role_display_name_key ON public.staff_role USING btree (display_name);
CREATE UNIQUE INDEX staff_role_pkey ON public.staff_role USING btree (id);
```

<a id="sync-case-index"></a>
### `sync_case_index`

Canopy's per-Leaf case index and JSONB snapshot, using a global UUID plus the source Leaf case ID.

| Column | PostgreSQL type | Nullable | Default / identity |
| --- | --- | --- | --- |
| `global_case_id` | uuid | NO | — |
| `hospital_id` | text | NO | — |
| `leaf_id` | text | NO | — |
| `source_case_id` | text | NO | — |
| `case_code` | text | YES | — |
| `hn` | text | YES | — |
| `status` | text | NO | — |
| `start_time` | bigint | YES | — |
| `discharge_time` | bigint | YES | — |
| `revision` | bigint | NO | — |
| `snapshot` | jsonb | NO | '{}'::jsonb |
| `last_synced_at` | timestamp with time zone | NO | now() |

Constraints:

- `sync_case_index_leaf_id_fkey`: `FOREIGN KEY (leaf_id) REFERENCES sync_leaf_node(leaf_id)`
- `sync_case_index_pkey`: `PRIMARY KEY (global_case_id)`
- `sync_case_index_leaf_id_source_case_id_key`: `UNIQUE (leaf_id, source_case_id)`

Indexes:

```sql
CREATE INDEX idx_sync_case_index_active ON public.sync_case_index USING btree (hospital_id, status, last_synced_at DESC);
CREATE UNIQUE INDEX sync_case_index_leaf_id_source_case_id_key ON public.sync_case_index USING btree (leaf_id, source_case_id);
CREATE UNIQUE INDEX sync_case_index_pkey ON public.sync_case_index USING btree (global_case_id);
```

<a id="sync-leaf-node"></a>
### `sync_leaf_node`

Registered Leaf identity, hospital, display name, heartbeat timestamps and metadata.

| Column | PostgreSQL type | Nullable | Default / identity |
| --- | --- | --- | --- |
| `leaf_id` | text | NO | — |
| `hospital_id` | text | NO | — |
| `display_name` | text | NO | — |
| `software_version` | text | YES | — |
| `last_seen_at` | timestamp with time zone | NO | now() |
| `registered_at` | timestamp with time zone | NO | now() |
| `metadata` | jsonb | NO | '{}'::jsonb |

Constraints:

- `sync_leaf_node_pkey`: `PRIMARY KEY (leaf_id)`

Indexes:

```sql
CREATE INDEX idx_sync_leaf_node_hospital_seen ON public.sync_leaf_node USING btree (hospital_id, last_seen_at DESC);
CREATE UNIQUE INDEX sync_leaf_node_pkey ON public.sync_leaf_node USING btree (leaf_id);
```

<a id="sync-message"></a>
### `sync_message`

Received synchronization envelopes. Unique (leaf_id, message_id) supports duplicate-delivery rejection.

| Column | PostgreSQL type | Nullable | Default / identity |
| --- | --- | --- | --- |
| `id` | bigint | NO | GENERATED ALWAYS AS IDENTITY |
| `leaf_id` | text | NO | — |
| `message_id` | uuid | NO | — |
| `entity_type` | text | NO | — |
| `entity_id` | text | NO | — |
| `operation` | text | NO | — |
| `revision` | bigint | NO | — |
| `occurred_at` | timestamp with time zone | NO | — |
| `payload` | jsonb | NO | '{}'::jsonb |
| `received_at` | timestamp with time zone | NO | now() |

Constraints:

- `sync_message_operation_check`: `CHECK (operation = ANY (ARRAY['upsert'::text, 'delete'::text]))`
- `sync_message_leaf_id_fkey`: `FOREIGN KEY (leaf_id) REFERENCES sync_leaf_node(leaf_id)`
- `sync_message_pkey`: `PRIMARY KEY (id)`
- `sync_message_leaf_id_message_id_key`: `UNIQUE (leaf_id, message_id)`

Indexes:

```sql
CREATE INDEX idx_sync_message_leaf_revision ON public.sync_message USING btree (leaf_id, revision DESC);
CREATE UNIQUE INDEX sync_message_leaf_id_message_id_key ON public.sync_message USING btree (leaf_id, message_id);
CREATE UNIQUE INDEX sync_message_pkey ON public.sync_message USING btree (id);
```

<a id="vital-minutes"></a>
### `vital_minutes`

Device observations grouped into a JSON-text payload per case, source and minute. This is device data, not manual chart overrides.

| Column | PostgreSQL type | Nullable | Default / identity |
| --- | --- | --- | --- |
| `id` | bigint | NO | nextval('vital_minutes_id_seq'::regclass) |
| `case_id` | bigint | YES | — |
| `ivy_source` | text | YES | — |
| `ts_minute` | bigint | YES | — |
| `payload` | text | YES | — |
| `created_at` | bigint | YES | — |

Constraints:

- `vital_minutes_case_id_fkey`: `FOREIGN KEY (case_id) REFERENCES cases(id)`
- `idx_16424_vital_minutes_pkey`: `PRIMARY KEY (id)`

Indexes:

```sql
CREATE INDEX idx_16424_idx_vital_minutes_case ON public.vital_minutes USING btree (case_id, ts_minute);
CREATE UNIQUE INDEX idx_16424_vital_minutes_pkey ON public.vital_minutes USING btree (id);
CREATE UNIQUE INDEX vital_minutes_source_minute_key ON public.vital_minutes USING btree (case_id, ivy_source, ts_minute);
```

## Sequences

| Sequence | Type | Start | Increment | Cycles |
| --- | --- | ---: | ---: | --- |
| `auth_audit_id_seq` | bigint | 1 | 1 | False |
| `auth_session_id_seq` | bigint | 1 | 1 | False |
| `auth_user_id_seq` | bigint | 1 | 1 | False |
| `case_allergy_id_seq` | bigint | 1 | 1 | False |
| `case_clinical_audit_id_seq` | bigint | 1 | 1 | False |
| `case_detail_id_seq` | bigint | 1 | 1 | False |
| `case_device_ingest_audit_id_seq` | bigint | 1 | 1 | False |
| `case_diagnosis_id_seq` | bigint | 1 | 1 | False |
| `case_event_note_audit_id_seq` | bigint | 1 | 1 | False |
| `case_event_note_id_seq` | bigint | 1 | 1 | False |
| `case_his_allergy_id_seq` | bigint | 1 | 1 | False |
| `case_his_lab_id_seq` | bigint | 1 | 1 | False |
| `case_his_patient_id_seq` | bigint | 1 | 1 | False |
| `case_io_audit_id_seq` | bigint | 1 | 1 | False |
| `case_io_event_id_seq` | bigint | 1 | 1 | False |
| `case_io_run_id_seq` | bigint | 1 | 1 | False |
| `case_io_segment_id_seq` | bigint | 1 | 1 | False |
| `case_procedure_id_seq` | bigint | 1 | 1 | False |
| `case_staff_id_seq` | bigint | 1 | 1 | False |
| `case_timeline_audit_id_seq` | bigint | 1 | 1 | False |
| `case_timeline_value_id_seq` | bigint | 1 | 1 | False |
| `cases_id_seq` | bigint | 1 | 1 | False |
| `ephis_daily_case_id_seq` | bigint | 1 | 1 | False |
| `his_allergy_buffer_id_seq` | bigint | 1 | 1 | False |
| `his_lab_buffer_id_seq` | bigint | 1 | 1 | False |
| `his_patient_buffer_id_seq` | bigint | 1 | 1 | False |
| `io_item_master_id_seq` | bigint | 1 | 1 | False |
| `legacy_med_drip_preset_analysis_id_seq` | bigint | 1 | 1 | False |
| `patient_snapshot_id_seq` | bigint | 1 | 1 | False |
| `staff_directory_id_seq` | bigint | 1 | 1 | False |
| `sync_message_id_seq` | bigint | 1 | 1 | False |
| `vital_minutes_id_seq` | bigint | 1 | 1 | False |

## Application table privileges

These are catalog-reported table privileges, not a full audit of inherited role capabilities or endpoint authorization.

| Table | Role | Granted privileges |
| --- | --- | --- |
| `auth_audit` | `flora_app` | DELETE, INSERT, SELECT, UPDATE |
| `auth_audit` | `flora_view` | SELECT |
| `auth_session` | `flora_app` | DELETE, INSERT, SELECT, UPDATE |
| `auth_session` | `flora_view` | SELECT |
| `auth_user` | `flora_app` | DELETE, INSERT, SELECT, UPDATE |
| `auth_user` | `flora_view` | SELECT |
| `case_allergy` | `flora_app` | DELETE, INSERT, SELECT, UPDATE |
| `case_allergy` | `flora_view` | SELECT |
| `case_clinical_audit` | `flora_app` | DELETE, INSERT, SELECT, UPDATE |
| `case_clinical_audit` | `flora_view` | SELECT |
| `case_detail` | `flora_app` | DELETE, INSERT, SELECT, UPDATE |
| `case_detail` | `flora_view` | SELECT |
| `case_device_ingest_audit` | `flora_app` | DELETE, INSERT, SELECT, UPDATE |
| `case_device_ingest_audit` | `flora_view` | SELECT |
| `case_diagnosis` | `flora_app` | DELETE, INSERT, SELECT, UPDATE |
| `case_diagnosis` | `flora_view` | SELECT |
| `case_event_note` | `flora_app` | DELETE, INSERT, SELECT, UPDATE |
| `case_event_note` | `flora_view` | SELECT |
| `case_event_note_audit` | `flora_app` | DELETE, INSERT, SELECT, UPDATE |
| `case_event_note_audit` | `flora_view` | SELECT |
| `case_his_allergy` | `flora_app` | DELETE, INSERT, SELECT, UPDATE |
| `case_his_allergy` | `flora_view` | SELECT |
| `case_his_lab` | `flora_app` | DELETE, INSERT, SELECT, UPDATE |
| `case_his_lab` | `flora_view` | SELECT |
| `case_his_patient` | `flora_app` | DELETE, INSERT, SELECT, UPDATE |
| `case_his_patient` | `flora_view` | SELECT |
| `case_io_audit` | `flora_app` | DELETE, INSERT, SELECT, UPDATE |
| `case_io_audit` | `flora_view` | SELECT |
| `case_io_event` | `flora_app` | DELETE, INSERT, SELECT, UPDATE |
| `case_io_event` | `flora_view` | SELECT |
| `case_io_run` | `flora_app` | DELETE, INSERT, SELECT, UPDATE |
| `case_io_run` | `flora_view` | SELECT |
| `case_io_segment` | `flora_app` | DELETE, INSERT, SELECT, UPDATE |
| `case_io_segment` | `flora_view` | SELECT |
| `case_procedure` | `flora_app` | DELETE, INSERT, SELECT, UPDATE |
| `case_procedure` | `flora_view` | SELECT |
| `case_staff` | `flora_app` | DELETE, INSERT, SELECT, UPDATE |
| `case_staff` | `flora_view` | SELECT |
| `case_timeline_audit` | `flora_app` | DELETE, INSERT, SELECT, UPDATE |
| `case_timeline_audit` | `flora_view` | SELECT |
| `case_timeline_value` | `flora_app` | DELETE, INSERT, SELECT, UPDATE |
| `case_timeline_value` | `flora_view` | SELECT |
| `cases` | `flora_app` | DELETE, INSERT, SELECT, UPDATE |
| `cases` | `flora_view` | SELECT |
| `ephis_daily_case` | `flora_app` | DELETE, INSERT, SELECT, UPDATE |
| `ephis_daily_case` | `flora_view` | SELECT |
| `his_allergy_buffer` | `flora_app` | DELETE, INSERT, SELECT, UPDATE |
| `his_allergy_buffer` | `flora_view` | SELECT |
| `his_lab_buffer` | `flora_app` | DELETE, INSERT, SELECT, UPDATE |
| `his_lab_buffer` | `flora_view` | SELECT |
| `his_patient_buffer` | `flora_app` | DELETE, INSERT, SELECT, UPDATE |
| `his_patient_buffer` | `flora_view` | SELECT |
| `icd10_master` | `flora_app` | DELETE, INSERT, SELECT, UPDATE |
| `icd10_master` | `flora_view` | SELECT |
| `icd9cm_master` | `flora_app` | DELETE, INSERT, SELECT, UPDATE |
| `icd9cm_master` | `flora_view` | SELECT |
| `io_item_master` | `flora_app` | DELETE, INSERT, SELECT, UPDATE |
| `io_item_master` | `flora_view` | SELECT |
| `legacy_med_drip_preset_analysis` | `flora_app` | DELETE, INSERT, SELECT, UPDATE |
| `legacy_med_drip_preset_analysis` | `flora_view` | SELECT |
| `patient_snapshot` | `flora_app` | DELETE, INSERT, SELECT, UPDATE |
| `patient_snapshot` | `flora_view` | SELECT |
| `staff_directory` | `flora_app` | DELETE, INSERT, SELECT, UPDATE |
| `staff_directory` | `flora_view` | SELECT |
| `staff_role` | `flora_app` | DELETE, INSERT, SELECT, UPDATE |
| `staff_role` | `flora_view` | SELECT |
| `sync_case_index` | `flora_app` | DELETE, INSERT, SELECT, UPDATE |
| `sync_case_index` | `flora_sync` | INSERT, SELECT, UPDATE |
| `sync_case_index` | `flora_view` | SELECT |
| `sync_leaf_node` | `flora_app` | DELETE, INSERT, SELECT, UPDATE |
| `sync_leaf_node` | `flora_sync` | INSERT, SELECT, UPDATE |
| `sync_leaf_node` | `flora_view` | SELECT |
| `sync_message` | `flora_app` | DELETE, INSERT, SELECT, UPDATE |
| `sync_message` | `flora_sync` | INSERT, SELECT, UPDATE |
| `sync_message` | `flora_view` | SELECT |
| `vital_minutes` | `flora_app` | DELETE, INSERT, SELECT, UPDATE |
| `vital_minutes` | `flora_view` | SELECT |

## Views

No public views are declared.

## Regeneration

Run `scripts/export-postgres-catalog.py` with psycopg available and `FLORA_DATABASE_URL` pointing to the database being documented. The script prints Markdown to stdout and reads metadata only. Export SQL with `pg_dump --schema-only --no-owner --no-privileges`. Regenerate after applying schema migrations.

