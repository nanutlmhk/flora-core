const Database = require("better-sqlite3");
const crypto = require("crypto");
const path = require("path");
const fs = require("fs");

const explicitDb = String(process.env.FLORA_DB_PATH || "").trim();
const porjaiRoot = String(process.env.PORJAI_ROOT || "").trim();

const DB_PATH = explicitDb
  ? path.resolve(explicitDb)
  : porjaiRoot
  ? path.resolve(porjaiRoot, "data", "flora.db")
  : path.resolve(__dirname, "..", "data", "flora.db");

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

if (!fs.existsSync(DB_PATH)) {
  console.log("Creating flora.db");
}

const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.pragma("busy_timeout = 15000");     // 15 s — matches ivy; prevents lock errors under load
db.pragma("foreign_keys = ON");
db.pragma("synchronous = NORMAL");
db.pragma("wal_autocheckpoint = 1000");
db.pragma("cache_size = -32000");      // 32 MB page cache for flora's larger dataset

/* ===========================
   CASES (UNCHANGED)
=========================== */

db.exec(`
CREATE TABLE IF NOT EXISTS cases (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,

  case_code       TEXT NOT NULL UNIQUE,
  hn              TEXT NOT NULL,

  start_time      INTEGER NOT NULL,
  device_capture_start_time INTEGER,
  discharge_time  INTEGER,
  archive_time    INTEGER,

  status          TEXT NOT NULL CHECK (
    status IN ('active','discharged','archived')
  ),

  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_cases_status
  ON cases(status);

CREATE INDEX IF NOT EXISTS idx_cases_hn_start
  ON cases(hn, start_time);
`);

/* ===========================
   AUTH USERS
=========================== */

db.exec(`
CREATE TABLE IF NOT EXISTS auth_user (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  username          TEXT NOT NULL UNIQUE,
  hospital_id       TEXT,
  auth_source       TEXT NOT NULL DEFAULT 'local',
  password_salt     TEXT NOT NULL,
  password_hash     TEXT NOT NULL,
  name              TEXT NOT NULL,
  role              TEXT,
  theme_mode        TEXT,
  theme_color       TEXT,
  is_active         INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  created_at        INTEGER NOT NULL,
  updated_at        INTEGER NOT NULL,
  last_login_at     INTEGER
);

CREATE INDEX IF NOT EXISTS idx_auth_user_username
  ON auth_user(username);

CREATE UNIQUE INDEX IF NOT EXISTS idx_auth_user_hospital_id
  ON auth_user(hospital_id);
`);

db.exec(`
CREATE TABLE IF NOT EXISTS auth_session (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id           INTEGER NOT NULL,
  token_hash        TEXT NOT NULL UNIQUE,
  client_label      TEXT,
  created_at        INTEGER NOT NULL,
  updated_at        INTEGER NOT NULL,
  last_seen_at      INTEGER NOT NULL,
  expires_at        INTEGER NOT NULL,
  revoked_at        INTEGER,

  FOREIGN KEY (user_id) REFERENCES auth_user(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_auth_session_user
  ON auth_session(user_id, revoked_at, expires_at);

CREATE TABLE IF NOT EXISTS auth_audit (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  action            TEXT NOT NULL,
  actor_user_id     INTEGER,
  actor_username    TEXT,
  actor_role        TEXT,
  target_user_id    INTEGER,
  target_username   TEXT,
  status            TEXT NOT NULL DEFAULT 'ok',
  detail_json       TEXT,
  created_at        INTEGER NOT NULL,

  FOREIGN KEY (actor_user_id) REFERENCES auth_user(id) ON DELETE SET NULL,
  FOREIGN KEY (target_user_id) REFERENCES auth_user(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_auth_audit_created
  ON auth_audit(created_at DESC, id DESC);
`);

/* ===========================
   VITAL MINUTES (UNCHANGED)
=========================== */

db.exec(`
CREATE TABLE IF NOT EXISTS vital_minutes (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  case_id       INTEGER NOT NULL,
  ivy_source    TEXT NOT NULL,
  ts_minute     INTEGER NOT NULL,
  payload       TEXT NOT NULL,
  created_at    INTEGER NOT NULL,

  UNIQUE(case_id, ivy_source, ts_minute),
  FOREIGN KEY (case_id) REFERENCES cases(id)
);

CREATE INDEX IF NOT EXISTS idx_vital_minutes_case
  ON vital_minutes(case_id, ts_minute);
`);

/* ===========================
   CASE DEVICE INGEST AUDIT
=========================== */

db.exec(`
CREATE TABLE IF NOT EXISTS case_device_ingest_audit (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  case_id           INTEGER NOT NULL,
  hn                TEXT,
  source_service    TEXT NOT NULL,
  source_endpoint   TEXT,
  fetch_mode        TEXT NOT NULL CHECK (
    fetch_mode IN ('minute','bulk')
  ),
  minute_ts         INTEGER,
  from_ts           INTEGER,
  to_ts             INTEGER,
  raw_row_count     INTEGER NOT NULL DEFAULT 0,
  written_row_count INTEGER NOT NULL DEFAULT 0,
  status            TEXT NOT NULL CHECK (
    status IN ('ok','empty','failed')
  ),
  actor_username    TEXT NOT NULL,
  actor_role        TEXT,
  detail_json       TEXT,
  created_at        INTEGER NOT NULL,

  FOREIGN KEY (case_id) REFERENCES cases(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_case_device_ingest_audit_case
  ON case_device_ingest_audit(case_id, created_at DESC, id DESC);
`);

/* ===========================
   CASE TIMELINE CURRENT VALUE
=========================== */

db.exec(`
CREATE TABLE IF NOT EXISTS case_timeline_value (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  case_id       INTEGER NOT NULL,
  ts_minute     INTEGER NOT NULL,
  param_key     TEXT NOT NULL,

  value_type    TEXT NOT NULL CHECK (
    value_type IN ('number','text','code')
  ),
  value_num     REAL,
  value_text    TEXT,
  unit          TEXT,
  source        TEXT NOT NULL CHECK (
    source IN ('manual','override')
  ),
  note          TEXT,

  created_by    TEXT NOT NULL,
  updated_by    TEXT NOT NULL,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL,

  UNIQUE(case_id, ts_minute, param_key),
  FOREIGN KEY (case_id) REFERENCES cases(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_case_timeline_value_case
  ON case_timeline_value(case_id, ts_minute, param_key);
`);

/* ===========================
   CASE TIMELINE AUDIT LOG
=========================== */

db.exec(`
CREATE TABLE IF NOT EXISTS case_timeline_audit (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  case_id         INTEGER NOT NULL,
  ts_minute       INTEGER NOT NULL,
  param_key       TEXT NOT NULL,

  action          TEXT NOT NULL CHECK (
    action IN ('insert','update','delete')
  ),

  old_value_num   REAL,
  old_value_text  TEXT,
  old_value_type  TEXT,
  new_value_num   REAL,
  new_value_text  TEXT,
  new_value_type  TEXT,
  unit            TEXT,
  source          TEXT,
  note            TEXT,

  reason          TEXT,
  actor_username  TEXT NOT NULL,
  actor_name      TEXT,
  actor_role      TEXT,
  created_at      INTEGER NOT NULL,

  FOREIGN KEY (case_id) REFERENCES cases(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_case_timeline_audit_case
  ON case_timeline_audit(case_id, created_at);
`);

/* ===========================
   CASE EVENT / NOTE
=========================== */

db.exec(`
CREATE TABLE IF NOT EXISTS case_event_note (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  case_id       INTEGER NOT NULL,
  event_ts      INTEGER NOT NULL,
  event_type    TEXT NOT NULL CHECK (
    event_type IN ('event','note')
  ),
  title         TEXT NOT NULL,
  detail        TEXT,

  created_by    TEXT NOT NULL,
  created_at    INTEGER NOT NULL,
  updated_by    TEXT NOT NULL,
  updated_at    INTEGER NOT NULL,
  is_deleted    INTEGER NOT NULL DEFAULT 0 CHECK (
    is_deleted IN (0,1)
  ),

  FOREIGN KEY (case_id) REFERENCES cases(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_case_event_note_case
  ON case_event_note(case_id, event_ts, id);

-- Compound index for lifecycle queries that filter event_type + is_deleted.
-- Used by getLifecycleOpenCount, hasLifecycleStartInCase, hasCaseEventTitle.
CREATE INDEX IF NOT EXISTS idx_case_event_note_lifecycle
  ON case_event_note(case_id, event_type, is_deleted, event_ts, id);
`);

/* ===========================
   CASE EVENT / NOTE AUDIT LOG
=========================== */

db.exec(`
CREATE TABLE IF NOT EXISTS case_event_note_audit (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  case_id         INTEGER NOT NULL,
  event_note_id   INTEGER,
  action          TEXT NOT NULL CHECK (
    action IN ('insert','update','delete')
  ),

  old_event_ts    INTEGER,
  old_event_type  TEXT,
  old_title       TEXT,
  old_detail      TEXT,

  new_event_ts    INTEGER,
  new_event_type  TEXT,
  new_title       TEXT,
  new_detail      TEXT,

  reason          TEXT,
  actor_username  TEXT NOT NULL,
  actor_name      TEXT,
  actor_role      TEXT,
  created_at      INTEGER NOT NULL,

  FOREIGN KEY (case_id) REFERENCES cases(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_case_event_note_audit_case
  ON case_event_note_audit(case_id, created_at);
`);

/* ===========================
   PATIENT SNAPSHOT (NEW)
=========================== */

db.exec(`
CREATE TABLE IF NOT EXISTS patient_snapshot (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  case_id       INTEGER NOT NULL UNIQUE,

  hn            TEXT NOT NULL,
  name          TEXT,
  gender        TEXT,
  id_number     TEXT,
  blood_group   TEXT,

  dob           INTEGER,
  age_at_start  INTEGER,
  weight        REAL,

  asa_status    TEXT,

  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL,

  FOREIGN KEY (case_id) REFERENCES cases(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_patient_snapshot_case
  ON patient_snapshot(case_id);
`);

/* ===========================
   CASE DETAIL (NEW)
=========================== */

db.exec(`
CREATE TABLE IF NOT EXISTS case_detail (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  case_id       INTEGER NOT NULL UNIQUE,

  surgeon       TEXT,
  or_room       TEXT,
  case_type     TEXT CHECK (case_type IN ('elective','emergency')),
  note          TEXT,
  form_draft_json TEXT,

  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL,

  FOREIGN KEY (case_id) REFERENCES cases(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_case_detail_case
  ON case_detail(case_id);
`);

try {
  db.exec(`ALTER TABLE case_detail ADD COLUMN form_draft_json TEXT`);
} catch {
  // ignore existing-column migration
}

/* ===========================
   CASE DIAGNOSIS (1–N)
=========================== */

db.exec(`
CREATE TABLE IF NOT EXISTS case_diagnosis (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  case_id         INTEGER NOT NULL,

  diagnosis_text TEXT NOT NULL,
  icd_text       TEXT,
  icd_code       TEXT,
  icd_version    TEXT,

  seq            INTEGER DEFAULT 1,
  created_at     INTEGER NOT NULL,

  FOREIGN KEY (case_id) REFERENCES cases(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_case_diagnosis_case
  ON case_diagnosis(case_id);
`);

/* ===========================
   CASE PROCEDURE (1–N)
=========================== */

db.exec(`
CREATE TABLE IF NOT EXISTS case_procedure (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  case_id         INTEGER NOT NULL,

  procedure_text TEXT NOT NULL,
  icd_text       TEXT,
  icd_code       TEXT,
  icd_version    TEXT,

  seq             INTEGER DEFAULT 1,
  created_at      INTEGER NOT NULL,

  FOREIGN KEY (case_id) REFERENCES cases(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_case_procedure_case
  ON case_procedure(case_id);
`);

/* ===========================
   ICD10 MASTER
=========================== */

db.exec(`
CREATE TABLE IF NOT EXISTS icd10_master (
  icd10         TEXT PRIMARY KEY,
  icd10who      TEXT NOT NULL,
  diagseq       INTEGER,
  name_en       TEXT,
  name_th       TEXT,
  extcause      INTEGER,
  mcode         INTEGER,
  ca            INTEGER,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_icd10_master_who
  ON icd10_master(icd10who);

CREATE INDEX IF NOT EXISTS idx_icd10_master_name_en
  ON icd10_master(name_en);

CREATE INDEX IF NOT EXISTS idx_icd10_master_name_th
  ON icd10_master(name_th);
`);

/* ===========================
   ICD9-CM PROCEDURE MASTER
=========================== */

db.exec(`
CREATE TABLE IF NOT EXISTS icd9cm_master (
  icd9cm         TEXT PRIMARY KEY,
  short_name_en  TEXT,
  name_en        TEXT,
  created_at     INTEGER NOT NULL,
  updated_at     INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_icd9cm_master_short_name_en
  ON icd9cm_master(short_name_en);

CREATE INDEX IF NOT EXISTS idx_icd9cm_master_name_en
  ON icd9cm_master(name_en);
`);

db.exec(`
CREATE TABLE IF NOT EXISTS legacy_med_drip_preset_analysis (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  source_system         TEXT NOT NULL,
  source_scope          TEXT NOT NULL,
  source_year_from      INTEGER,
  source_year_to        INTEGER,
  drug_name             TEXT NOT NULL,
  preset_rank           INTEGER,
  route                 TEXT,
  weight_based          INTEGER NOT NULL DEFAULT 0 CHECK (weight_based IN (0,1)),
  med_amount_value      REAL,
  med_amount_unit       TEXT,
  carrier_name          TEXT,
  carrier_volume_ml     REAL,
  concentration_value   REAL,
  concentration_unit    TEXT,
  source_count          INTEGER NOT NULL DEFAULT 0,
  avg_minutes           REAL,
  first_seen            TEXT,
  last_seen             TEXT,
  flora_kind            TEXT,
  flora_entry_mode      TEXT,
  display_label         TEXT,
  selection_note        TEXT,
  is_curated            INTEGER NOT NULL DEFAULT 0 CHECK (is_curated IN (0,1)),
  imported_at           INTEGER NOT NULL,
  updated_at            INTEGER NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_legacy_med_drip_preset_analysis_key
  ON legacy_med_drip_preset_analysis(
    source_system,
    source_scope,
    COALESCE(source_year_from, 0),
    COALESCE(source_year_to, 0),
    drug_name,
    COALESCE(route, ''),
    weight_based,
    COALESCE(med_amount_value, 0),
    COALESCE(med_amount_unit, ''),
    COALESCE(carrier_name, ''),
    COALESCE(carrier_volume_ml, 0),
    COALESCE(concentration_value, 0),
    COALESCE(concentration_unit, '')
  );

CREATE INDEX IF NOT EXISTS idx_legacy_med_drip_preset_analysis_drug
  ON legacy_med_drip_preset_analysis(drug_name, source_count DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_legacy_med_drip_preset_analysis_scope
  ON legacy_med_drip_preset_analysis(source_system, source_scope, source_year_from, source_year_to, is_curated);
`);

/* ===========================
   CASE ALLERGY (1–N)
=========================== */

db.exec(`
CREATE TABLE IF NOT EXISTS case_allergy (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  case_id         INTEGER NOT NULL,

  allergen        TEXT NOT NULL,
  reaction        TEXT,
  severity        TEXT,

  seq             INTEGER DEFAULT 1,
  created_at      INTEGER NOT NULL,

  FOREIGN KEY (case_id) REFERENCES cases(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_case_allergy_case
  ON case_allergy(case_id);
`);

/* ===========================
   CASE HIS PATIENT CACHE
=========================== */

db.exec(`
CREATE TABLE IF NOT EXISTS case_his_patient (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  case_id           INTEGER NOT NULL UNIQUE,
  hn                TEXT NOT NULL,
  an                TEXT,
  is_patient        TEXT,
  notype            TEXT,
  id_card           TEXT,
  patient_name      TEXT,
  title_th          TEXT,
  title_en          TEXT,
  first_name        TEXT,
  last_name         TEXT,
  first_name_en     TEXT,
  last_name_en      TEXT,
  sex               TEXT,
  dob               TEXT,
  age_text          TEXT,
  weight_kg         REAL,
  height_cm         REAL,
  blood_group_text  TEXT,
  blood_group_abo   TEXT,
  blood_group_rh    TEXT,
  race              TEXT,
  ethnicity         TEXT,
  religion          TEXT,
  marital_status    TEXT,
  present_address   TEXT,
  present_province  TEXT,
  legal_address     TEXT,
  legal_province    TEXT,
  mobile            TEXT,
  contact_name      TEXT,
  contact_tel       TEXT,
  relation_desc     TEXT,
  nationality       TEXT,
  source            TEXT,
  raw_payload       TEXT,
  his_updated_at    INTEGER NOT NULL,
  created_at        INTEGER NOT NULL,
  updated_at        INTEGER NOT NULL,

  FOREIGN KEY (case_id) REFERENCES cases(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_case_his_patient_case
  ON case_his_patient(case_id);
`);

function addColumnIfMissing(tableName, columnDef) {
  try {
    db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnDef}`);
  } catch (err) {
    const msg = String(err?.message || "");
    if (msg.includes("duplicate column name")) return;
    throw err;
  }
}

[
  "is_patient TEXT",
  "notype TEXT",
  "id_card TEXT",
  "patient_name TEXT",
  "title_th TEXT",
  "title_en TEXT",
  "first_name_en TEXT",
  "last_name_en TEXT",
  "blood_group_text TEXT",
  "present_address TEXT",
  "present_province TEXT",
  "legal_address TEXT",
  "legal_province TEXT",
  "mobile TEXT",
  "contact_name TEXT",
  "contact_tel TEXT",
  "relation_desc TEXT",
  "nationality TEXT",
].forEach(def => addColumnIfMissing("case_his_patient", def));

/* ===========================
   CASE HIS ALLERGY CACHE
=========================== */

db.exec(`
CREATE TABLE IF NOT EXISTS case_his_allergy (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  case_id         INTEGER NOT NULL,
  allergen        TEXT NOT NULL,
  reaction        TEXT,
  severity        TEXT,
  status          TEXT,
  source          TEXT,
  raw_payload     TEXT,
  his_updated_at  INTEGER NOT NULL,
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL,

  FOREIGN KEY (case_id) REFERENCES cases(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_case_his_allergy_case
  ON case_his_allergy(case_id, id);
`);

/* ===========================
   CASE HIS LAB CACHE
=========================== */

db.exec(`
CREATE TABLE IF NOT EXISTS case_his_lab (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  case_id         INTEGER NOT NULL,
  test_name       TEXT NOT NULL,
  test_group      TEXT,
  value_text      TEXT,
  unit            TEXT,
  ref_range       TEXT,
  flag            TEXT,
  collected_at    INTEGER,
  source          TEXT,
  raw_payload     TEXT,
  his_updated_at  INTEGER NOT NULL,
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL,

  FOREIGN KEY (case_id) REFERENCES cases(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_case_his_lab_case
  ON case_his_lab(case_id, collected_at DESC, id DESC);
`);

/* ===========================
   EPHIS DAILY CASE IMPORT
=========================== */

db.exec(`
CREATE TABLE IF NOT EXISTS ephis_daily_case (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  hn                TEXT NOT NULL,
  admit_date        TEXT NOT NULL,
  admit_datetime    TEXT,
  raw_admit_value   TEXT,
  source_payload    TEXT,
  imported_at       INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_ephis_daily_case_admit_date
  ON ephis_daily_case(admit_date, hn);

CREATE UNIQUE INDEX IF NOT EXISTS idx_ephis_daily_case_unique
  ON ephis_daily_case(hn, admit_date, IFNULL(admit_datetime, ''));
`);

/* ===========================
   HIS PATIENT BUFFER (NO CASE)
=========================== */

db.exec(`
CREATE TABLE IF NOT EXISTS his_patient_buffer (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  hn                TEXT NOT NULL UNIQUE,
  an                TEXT,
  is_patient        TEXT,
  notype            TEXT,
  id_card           TEXT,
  patient_name      TEXT,
  title_th          TEXT,
  title_en          TEXT,
  first_name        TEXT,
  last_name         TEXT,
  first_name_en     TEXT,
  last_name_en      TEXT,
  sex               TEXT,
  dob               TEXT,
  age_text          TEXT,
  weight_kg         REAL,
  height_cm         REAL,
  blood_group_text  TEXT,
  blood_group_abo   TEXT,
  blood_group_rh    TEXT,
  race              TEXT,
  ethnicity         TEXT,
  religion          TEXT,
  marital_status    TEXT,
  present_address   TEXT,
  present_province  TEXT,
  legal_address     TEXT,
  legal_province    TEXT,
  mobile            TEXT,
  contact_name      TEXT,
  contact_tel       TEXT,
  relation_desc     TEXT,
  nationality       TEXT,
  source            TEXT,
  raw_payload       TEXT,
  pre_admit_at      INTEGER,
  pre_admit_note    TEXT,
  his_updated_at    INTEGER NOT NULL,
  created_at        INTEGER NOT NULL,
  updated_at        INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_his_patient_buffer_updated
  ON his_patient_buffer(his_updated_at DESC, hn);
`);

/* ===========================
   HIS ALLERGY BUFFER (NO CASE)
=========================== */

db.exec(`
CREATE TABLE IF NOT EXISTS his_allergy_buffer (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  hn              TEXT NOT NULL,
  allergen        TEXT NOT NULL,
  reaction        TEXT,
  severity        TEXT,
  status          TEXT,
  source          TEXT,
  raw_payload     TEXT,
  his_updated_at  INTEGER NOT NULL,
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_his_allergy_buffer_hn
  ON his_allergy_buffer(hn, id);
`);

/* ===========================
   HIS LAB BUFFER (NO CASE)
=========================== */

db.exec(`
CREATE TABLE IF NOT EXISTS his_lab_buffer (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  hn              TEXT NOT NULL,
  test_name       TEXT NOT NULL,
  test_group      TEXT,
  value_text      TEXT,
  unit            TEXT,
  ref_range       TEXT,
  flag            TEXT,
  collected_at    INTEGER,
  source          TEXT,
  raw_payload     TEXT,
  his_updated_at  INTEGER NOT NULL,
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_his_lab_buffer_hn
  ON his_lab_buffer(hn, collected_at DESC, id DESC);
`);

/* ===========================
   CASE STAFF (PER CASE)
=========================== */

db.exec(`
CREATE TABLE IF NOT EXISTS case_staff (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  case_id       INTEGER NOT NULL,
  hospital_id   TEXT,
  personal_id   TEXT,
  email         TEXT,
  th_first_name TEXT,
  th_last_name  TEXT,
  en_first_name TEXT,
  en_last_name  TEXT,
  innovian_id   TEXT,
  staff_role_id TEXT,
  entry_year    INTEGER,
  staff_name    TEXT NOT NULL,
  staff_role    TEXT NOT NULL,
  seq           INTEGER NOT NULL DEFAULT 1,
  created_by    TEXT,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL,

  UNIQUE(case_id, staff_name, staff_role),
  FOREIGN KEY (case_id) REFERENCES cases(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_case_staff_case
  ON case_staff(case_id, seq, id);
`);

/* ===========================
   STAFF DIRECTORY (REUSABLE)
=========================== */

db.exec(`
CREATE TABLE IF NOT EXISTS staff_directory (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  hospital_id   TEXT,
  personal_id   TEXT,
  email         TEXT,
  th_first_name TEXT,
  th_last_name  TEXT,
  en_first_name TEXT,
  en_last_name  TEXT,
  innovian_id   TEXT,
  staff_role_id TEXT,
  entry_year    INTEGER,
  is_active     INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  staff_name    TEXT NOT NULL,
  staff_role    TEXT NOT NULL,
  used_count    INTEGER NOT NULL DEFAULT 0,
  last_used_at  INTEGER NOT NULL,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL,

  UNIQUE(staff_name, staff_role)
);

CREATE INDEX IF NOT EXISTS idx_staff_directory_last_used
  ON staff_directory(last_used_at DESC, used_count DESC);
`);

/* ===========================
   STAFF ROLE MASTER
=========================== */

db.exec(`
CREATE TABLE IF NOT EXISTS staff_role (
  id            TEXT PRIMARY KEY,
  display_name  TEXT NOT NULL UNIQUE,
  sort_order    INTEGER NOT NULL
);
`);

/* ===========================
   IO ITEM MASTER
=========================== */

db.exec(`
CREATE TABLE IF NOT EXISTS io_item_master (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  kind          TEXT NOT NULL CHECK (kind IN ('fluid','med','output')),
  code          TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL,
  default_unit  TEXT NOT NULL,
  category      TEXT,
  is_active     INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_io_item_master_kind
  ON io_item_master(kind, is_active, name);
`);

ensureColumn("io_item_master", "usage_score", "INTEGER NOT NULL DEFAULT 0");
ensureColumn("io_item_master", "usage_rank", "INTEGER");

/* ===========================
   CASE IO RUN (CONTINUOUS)
=========================== */

db.exec(`
CREATE TABLE IF NOT EXISTS case_io_run (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  case_id             INTEGER NOT NULL,
  item_id             INTEGER NOT NULL,
  kind                TEXT NOT NULL CHECK (kind IN ('fluid','med','output')),
  route               TEXT,
  started_at          INTEGER NOT NULL,
  stopped_at          INTEGER,
  note                TEXT,
  include_in_balance  INTEGER NOT NULL DEFAULT 1 CHECK (include_in_balance IN (0,1)),
  created_by          TEXT NOT NULL,
  created_at          INTEGER NOT NULL,
  updated_at          INTEGER NOT NULL,

  FOREIGN KEY (case_id) REFERENCES cases(id) ON DELETE CASCADE,
  FOREIGN KEY (item_id) REFERENCES io_item_master(id)
);

CREATE INDEX IF NOT EXISTS idx_case_io_run_case
  ON case_io_run(case_id, started_at, id);
`);

/* entry_mode migration — added per-run bolus/drip separation */
try {
  db.exec(`ALTER TABLE case_io_run ADD COLUMN entry_mode TEXT CHECK(entry_mode IN ('bolus','drip')) DEFAULT NULL`);
} catch (_) { /* column already exists */ }

/* ===========================
   CASE IO SEGMENT (RATE CHANGES)
=========================== */

db.exec(`
CREATE TABLE IF NOT EXISTS case_io_segment (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id              INTEGER NOT NULL,
  ts_from             INTEGER NOT NULL,
  ts_to               INTEGER,
  rate_value          REAL,
  rate_unit           TEXT,
  dose_value          REAL,
  dose_unit           TEXT,
  carrier_ml_per_hr   REAL,
  include_in_balance  INTEGER NOT NULL DEFAULT 1 CHECK (include_in_balance IN (0,1)),
  note                TEXT,
  created_by          TEXT NOT NULL,
  created_at          INTEGER NOT NULL,
  updated_at          INTEGER NOT NULL,

  FOREIGN KEY (run_id) REFERENCES case_io_run(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_case_io_segment_run
  ON case_io_segment(run_id, ts_from, id);
`);

/* ===========================
   CASE IO EVENT (BOLUS / POINT)
=========================== */

db.exec(`
CREATE TABLE IF NOT EXISTS case_io_event (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  case_id             INTEGER NOT NULL,
  item_id             INTEGER NOT NULL,
  kind                TEXT NOT NULL CHECK (kind IN ('fluid','med','output')),
  event_ts            INTEGER NOT NULL,
  volume_ml           REAL,
  dose_value          REAL,
  dose_unit           TEXT,
  note                TEXT,
  include_in_balance  INTEGER NOT NULL DEFAULT 1 CHECK (include_in_balance IN (0,1)),
  created_by          TEXT NOT NULL,
  created_at          INTEGER NOT NULL,
  updated_at          INTEGER NOT NULL,

  FOREIGN KEY (case_id) REFERENCES cases(id) ON DELETE CASCADE,
  FOREIGN KEY (item_id) REFERENCES io_item_master(id)
);

CREATE INDEX IF NOT EXISTS idx_case_io_event_case
  ON case_io_event(case_id, event_ts, id);
`);

/* ===========================
   CASE IO AUDIT
=========================== */

db.exec(`
CREATE TABLE IF NOT EXISTS case_io_audit (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  case_id         INTEGER NOT NULL,
  entity_type     TEXT NOT NULL CHECK (
    entity_type IN ('run','segment','event')
  ),
  entity_id       INTEGER NOT NULL,
  action          TEXT NOT NULL CHECK (
    action IN ('insert','update','delete')
  ),
  before_json     TEXT,
  after_json      TEXT,
  reason          TEXT,
  actor_username  TEXT NOT NULL,
  actor_name      TEXT,
  actor_role      TEXT,
  created_at      INTEGER NOT NULL,

  FOREIGN KEY (case_id) REFERENCES cases(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_case_io_audit_case
  ON case_io_audit(case_id, created_at, id);
`);

function ensureColumn(tableName, columnName, columnSqlType) {
  const columns = db.prepare(`PRAGMA table_info(${tableName})`).all();
  const exists = columns.some(col => col.name === columnName);
  if (!exists) {
    db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${columnSqlType}`);
  }
}

// Lightweight migrations for existing databases.
ensureColumn("case_staff", "hospital_id", "TEXT");
ensureColumn("case_staff", "personal_id", "TEXT");
ensureColumn("case_staff", "email", "TEXT");
ensureColumn("case_staff", "th_first_name", "TEXT");
ensureColumn("case_staff", "th_last_name", "TEXT");
ensureColumn("case_staff", "en_first_name", "TEXT");
ensureColumn("case_staff", "en_last_name", "TEXT");
ensureColumn("case_staff", "innovian_id", "TEXT");
ensureColumn("case_staff", "staff_role_id", "TEXT");
ensureColumn("case_staff", "entry_year", "INTEGER");
ensureColumn("staff_directory", "hospital_id", "TEXT");
ensureColumn("staff_directory", "personal_id", "TEXT");
ensureColumn("staff_directory", "email", "TEXT");
ensureColumn("staff_directory", "th_first_name", "TEXT");
ensureColumn("staff_directory", "th_last_name", "TEXT");
ensureColumn("staff_directory", "en_first_name", "TEXT");
ensureColumn("staff_directory", "en_last_name", "TEXT");
ensureColumn("staff_directory", "innovian_id", "TEXT");
ensureColumn("staff_directory", "staff_role_id", "TEXT");
ensureColumn("staff_directory", "entry_year", "INTEGER");
ensureColumn("staff_directory", "is_active", "INTEGER NOT NULL DEFAULT 1");
ensureColumn("auth_user", "hospital_id", "TEXT");
ensureColumn("auth_user", "auth_source", "TEXT NOT NULL DEFAULT 'local'");
ensureColumn("auth_user", "theme_mode", "TEXT");
ensureColumn("auth_user", "theme_color", "TEXT");
ensureColumn("case_diagnosis", "icd_text", "TEXT");
ensureColumn("case_procedure", "icd_text", "TEXT");
ensureColumn("cases", "device_capture_start_time", "INTEGER");

db.exec(`
CREATE UNIQUE INDEX IF NOT EXISTS idx_auth_user_hospital_id
  ON auth_user(hospital_id);
`);

const STAFF_ROLE_SEED = [
  { id: "anesthetist", displayName: "Anesthetist", sortOrder: 1 },
  { id: "assistant", displayName: "Assistant", sortOrder: 2 },
  { id: "circulatingNurse", displayName: "Circulating nurse", sortOrder: 3 },
  { id: "fellowAnesthetist", displayName: "Fellow Anesthetist", sortOrder: 4 },
  { id: "instrumentNurse", displayName: "Instrument nurse", sortOrder: 5 },
  { id: "medicalStudent", displayName: "Medical Student", sortOrder: 6 },
  { id: "nurseAnesthetist", displayName: "Nurse anesthetist", sortOrder: 7 },
  { id: "rotateResident", displayName: "Rotate resident", sortOrder: 8 },
  { id: "scrubNurse", displayName: "Scrub nurse", sortOrder: 9 },
  { id: "surgeon", displayName: "Surgeon", sortOrder: 10 },
  { id: "surgeryResident", displayName: "Surgery resident", sortOrder: 11 },
  {
    id: "anesthetistResident",
    displayName: "Anesthetist Resident",
    sortOrder: 12,
  },
];

function isSqliteReadonlyError(err) {
  const text = String(err?.message || err || "").toLowerCase();
  return text.includes("readonly") || String(err?.code || "").toUpperCase() === "SQLITE_READONLY";
}

function runBootstrapWrite(label, fn) {
  try {
    return fn();
  } catch (err) {
    if (isSqliteReadonlyError(err)) {
      console.warn(`[FLORA] skipped bootstrap write (${label}) because database is read-only`);
      return null;
    }
    throw err;
  }
}

const upsertRole = db.prepare(
  `INSERT INTO staff_role (id, display_name, sort_order)
   VALUES (?, ?, ?)
   ON CONFLICT(id)
   DO UPDATE SET
     display_name = excluded.display_name,
     sort_order = excluded.sort_order`
);

runBootstrapWrite("staff_role seed", () => {
  for (const role of STAFF_ROLE_SEED) {
    upsertRole.run(role.id, role.displayName, role.sortOrder);
  }
});

const IO_ITEM_SEED = [
  // Fluids (intake) - Fluid Type
  { kind: "fluid", code: "acetar", name: "Acetar", unit: "ml", category: "fluids" },
  { kind: "fluid", code: "nacl09", name: "0.9% NaCl", unit: "ml", category: "fluids" },
  { kind: "fluid", code: "dn2_5", name: "5% D/N/2", unit: "ml", category: "fluids" },
  { kind: "fluid", code: "dn3_5", name: "5% D/N/3", unit: "ml", category: "fluids" },
  { kind: "fluid", code: "dn4_5", name: "5% D/N/4", unit: "ml", category: "fluids" },
  { kind: "fluid", code: "dn5_5", name: "5% D/N/5", unit: "ml", category: "fluids" },
  { kind: "fluid", code: "dnss5", name: "5% D/NSS", unit: "ml", category: "fluids" },
  { kind: "fluid", code: "dw5", name: "5% D/W", unit: "ml", category: "fluids" },
  { kind: "fluid", code: "dn2_10", name: "10% D/N/2", unit: "ml", category: "fluids" },
  { kind: "fluid", code: "dnss10", name: "10% D/NSS", unit: "ml", category: "fluids" },
  { kind: "fluid", code: "dw10", name: "10% D/W", unit: "ml", category: "fluids" },
  { kind: "fluid", code: "volulyte", name: "Volulyte", unit: "ml", category: "fluids" },
  { kind: "fluid", code: "voluven", name: "Voluven", unit: "ml", category: "fluids" },
  { kind: "fluid", code: "albumin5", name: "5% Albumin", unit: "ml", category: "fluids" },
  { kind: "fluid", code: "albumin20", name: "20% Albumin", unit: "ml", category: "fluids" },
  { kind: "fluid", code: "dextran40", name: "40% Dextran", unit: "ml", category: "fluids" },
  { kind: "fluid", code: "hemohes6", name: "6% Hemohes", unit: "ml", category: "fluids" },
  { kind: "fluid", code: "nacl3", name: "3% NaCl", unit: "ml", category: "fluids" },
  { kind: "fluid", code: "gelofusine", name: "Gelofusine", unit: "ml", category: "fluids" },
  { kind: "fluid", code: "haemaccel", name: "Haemaccel", unit: "ml", category: "fluids" },
  { kind: "fluid", code: "lrs", name: "Ringer's lactate (LRS)", unit: "ml", category: "fluids" },
  { kind: "fluid", code: "sterofundin", name: "Sterofundin", unit: "ml", category: "fluids" },
  { kind: "fluid", code: "topBalance", name: "Top balance", unit: "ml", category: "fluids" },
  { kind: "fluid", code: "tetraspan", name: "Tetraspan", unit: "ml", category: "fluids" },

  // Fluids (intake) - Blood Product
  { kind: "fluid", code: "cryoprecipitate", name: "Cryoprecipitate", unit: "ml", category: "bloodProduct" },
  { kind: "fluid", code: "cellSaver", name: "Cell Saver", unit: "ml", category: "bloodProduct" },
  { kind: "fluid", code: "freshFrozenPlasma", name: "Fresh frozen plasma", unit: "ml", category: "bloodProduct" },
  { kind: "fluid", code: "packedRedCell", name: "Packed red cell", unit: "ml", category: "bloodProduct" },
  { kind: "fluid", code: "plateletsConc", name: "Platelets (Conc)", unit: "ml", category: "bloodProduct" },
  { kind: "fluid", code: "plateletsSd", name: "Platelets (SD)", unit: "ml", category: "bloodProduct" },
  { kind: "fluid", code: "wholeBlood", name: "Whole blood", unit: "ml", category: "bloodProduct" },

  // Medications - IV Anesth
  { kind: "med", code: "dexmedetomidine", name: "Dexmedetomidine", unit: "mcg", category: "ivAnesth" },
  { kind: "med", code: "diazepam", name: "Diazepam", unit: "mg", category: "ivAnesth" },
  { kind: "med", code: "etomidate", name: "Etomidate", unit: "mg", category: "ivAnesth" },
  { kind: "med", code: "ketamine", name: "Ketamine", unit: "mg", category: "ivAnesth" },
  { kind: "med", code: "midazolam", name: "Midazolam", unit: "mg", category: "ivAnesth" },
  { kind: "med", code: "propofol", name: "Propofol", unit: "mg", category: "ivAnesth" },
  { kind: "med", code: "thiopental", name: "Thiopental", unit: "mg", category: "ivAnesth" },

  // Medications - Muscle Relaxant
  { kind: "med", code: "rocuronium", name: "Rocuronium", unit: "mg", category: "muscleRelaxant" },
  { kind: "med", code: "cisatracurium", name: "Cisatracurium", unit: "mg", category: "muscleRelaxant" },
  { kind: "med", code: "atracurium", name: "Atracurium", unit: "mg", category: "muscleRelaxant" },
  { kind: "med", code: "vecuronium", name: "Vecuronium", unit: "mg", category: "muscleRelaxant" },
  { kind: "med", code: "succinylcholine", name: "Succinylcholine", unit: "mg", category: "muscleRelaxant" },
  { kind: "med", code: "pancuronium", name: "Pancuronium", unit: "mg", category: "muscleRelaxant" },

  // Medications - Opioid
  { kind: "med", code: "morphine", name: "Morphine", unit: "mg", category: "opioid" },
  { kind: "med", code: "fentanyl", name: "Fentanyl", unit: "mcg", category: "opioid" },
  { kind: "med", code: "pethidine", name: "Pethidine", unit: "mg", category: "opioid" },
  { kind: "med", code: "nalbuphine", name: "Nalbuphine", unit: "mg", category: "opioid" },
  { kind: "med", code: "tramadol", name: "Tramadol", unit: "mg", category: "opioid" },
  { kind: "med", code: "remifentanil", name: "Remifentanil", unit: "mcg", category: "opioid" },

  // Medications - Local Anesth
  { kind: "med", code: "bupivacaine", name: "Bupivacaine", unit: "ml", category: "localAnesth" },
  { kind: "med", code: "bupivacaineHyperbaric", name: "Bupivacaine Hyperbaric", unit: "ml", category: "localAnesth" },
  { kind: "med", code: "bupivacaineIsobaric", name: "Bupivacaine Isobaric", unit: "ml", category: "localAnesth" },
  { kind: "med", code: "levobupivacaine", name: "Levobupivacaine", unit: "ml", category: "localAnesth" },
  { kind: "med", code: "lidocaine", name: "Lidocaine", unit: "ml", category: "localAnesth" },
  { kind: "med", code: "lidocaineAdrenaline", name: "Lidocaine w Adrenaline", unit: "ml", category: "localAnesth" },
  { kind: "med", code: "ropivacaine", name: "Ropivacaine", unit: "ml", category: "localAnesth" },

  // Medications - Reversal
  { kind: "med", code: "atropine", name: "Atropine", unit: "mg", category: "reversal" },
  { kind: "med", code: "glycopyrrolate", name: "Glycopyrrolate", unit: "mg", category: "reversal" },
  { kind: "med", code: "neostigmine", name: "Neostigmine", unit: "mg", category: "reversal" },
  { kind: "med", code: "sugammadex", name: "Sugammadex", unit: "mg", category: "reversal" },

  // Medications - Antibiotics
  { kind: "med", code: "amikacin", name: "Amikacin", unit: "mg", category: "antibiotics" },
  { kind: "med", code: "ampicillin", name: "Ampicillin", unit: "mg", category: "antibiotics" },
  { kind: "med", code: "amoxicillinClavulanate", name: "Amoxicillin/Clavulanate", unit: "mg", category: "antibiotics" },
  { kind: "med", code: "cefazolin", name: "Cefazolin", unit: "mg", category: "antibiotics" },
  { kind: "med", code: "cefoperazoneSulbactam", name: "Cefoperazone-Sulbactam", unit: "mg", category: "antibiotics" },
  { kind: "med", code: "ceftazidime", name: "Ceftazidime", unit: "mg", category: "antibiotics" },
  { kind: "med", code: "ceftriaxone", name: "Ceftriaxone", unit: "mg", category: "antibiotics" },
  { kind: "med", code: "cefuroxime", name: "Cefuroxime", unit: "mg", category: "antibiotics" },
  { kind: "med", code: "ciprofloxacin", name: "Ciprofloxacin", unit: "mg", category: "antibiotics" },
  { kind: "med", code: "clindamycin", name: "Clindamycin", unit: "mg", category: "antibiotics" },
  { kind: "med", code: "cloxacillin", name: "Cloxacillin", unit: "mg", category: "antibiotics" },
  { kind: "med", code: "colistin", name: "Colistin", unit: "mg", category: "antibiotics" },
  { kind: "med", code: "ertapenemNa", name: "Ertapenem Na", unit: "mg", category: "antibiotics" },
  { kind: "med", code: "fosfomycin", name: "Fosfomycin", unit: "mg", category: "antibiotics" },
  { kind: "med", code: "gentamicin", name: "Gentamicin", unit: "mg", category: "antibiotics" },
  { kind: "med", code: "imipenem", name: "Imipenem", unit: "mg", category: "antibiotics" },
  { kind: "med", code: "levofloxacin", name: "Levofloxacin", unit: "mg", category: "antibiotics" },
  { kind: "med", code: "meropenem", name: "Meropenem", unit: "mg", category: "antibiotics" },
  { kind: "med", code: "metronidazole", name: "Metronidazole", unit: "mg", category: "antibiotics" },
  { kind: "med", code: "moxifloxacin", name: "Moxifloxacin", unit: "mg", category: "antibiotics" },
  { kind: "med", code: "penicillinGNa", name: "Penicillin G Na", unit: "units", category: "antibiotics" },
  { kind: "med", code: "piperacillinTazobactam", name: "Piperacillin/Tazobactam", unit: "mg", category: "antibiotics" },
  { kind: "med", code: "sulbactamAmpicillin", name: "Sulbactam/Ampicillin", unit: "mg", category: "antibiotics" },
  { kind: "med", code: "teicoplanin", name: "Teicoplanin", unit: "mg", category: "antibiotics" },
  { kind: "med", code: "vancomycin", name: "Vancomycin", unit: "mg", category: "antibiotics" },

  // Medications - Anti-emetic
  { kind: "med", code: "dexamethasone", name: "Dexamethasone", unit: "mg", category: "antiEmetic" },
  { kind: "med", code: "dimenhydrinate", name: "Dimenhydrinate", unit: "mg", category: "antiEmetic" },
  { kind: "med", code: "metoclopramide", name: "Metoclopramide", unit: "mg", category: "antiEmetic" },
  { kind: "med", code: "ondansetron", name: "Ondansetron", unit: "mg", category: "antiEmetic" },

  // Medications - Vasopressor
  { kind: "med", code: "ephedrine", name: "Ephedrine", unit: "mg", category: "vasopressor" },
  { kind: "med", code: "epinephrine", name: "Epinephrine", unit: "mcg", category: "vasopressor" },
  { kind: "med", code: "norepinephrine", name: "Norepinephrine", unit: "mcg", category: "vasopressor" },

  // Medications - Anti HT
  { kind: "med", code: "diltiazem", name: "Diltiazem", unit: "mg", category: "antiHt" },
  { kind: "med", code: "esmolol", name: "Esmolol", unit: "mg", category: "antiHt" },
  { kind: "med", code: "labetalol", name: "Labetalol", unit: "mg", category: "antiHt" },
  { kind: "med", code: "nicardipine", name: "Nicardipine", unit: "mg", category: "antiHt" },

  // Medications - Analgesic
  { kind: "med", code: "deksketoprofen", name: "Deksketoprofen", unit: "mg", category: "analgesic" },
  { kind: "med", code: "ketorolacAnalgesic", name: "Ketorolac", unit: "mg", category: "analgesic" },
  { kind: "med", code: "nefopam", name: "Nefopam", unit: "mg", category: "analgesic" },
  { kind: "med", code: "paracetamol", name: "Paracetamol", unit: "mg", category: "analgesic" },
  { kind: "med", code: "parecoxibAnalgesic", name: "Parecoxib", unit: "mg", category: "analgesic" },

  // Medications - Anti-arrhythmia
  { kind: "med", code: "adenosine", name: "Adenosine", unit: "mg", category: "antiArrhythmia" },
  { kind: "med", code: "amiodarone", name: "Amiodarone", unit: "mg", category: "antiArrhythmia" },
  { kind: "med", code: "atropineAntiArrhythmia", name: "Atropine", unit: "mg", category: "antiArrhythmia" },
  { kind: "med", code: "digoxin", name: "Digoxin", unit: "mg", category: "antiArrhythmia" },
  { kind: "med", code: "lidocaineAntiArrhythmia", name: "Lidocaine", unit: "mg", category: "antiArrhythmia" },
  { kind: "med", code: "verapamil", name: "Verapamil", unit: "mg", category: "antiArrhythmia" },

  // Medications - Bronchodilator
  { kind: "med", code: "beradual", name: "Beradual", unit: "ml", category: "bronchodilator" },
  { kind: "med", code: "inhalex", name: "Inhalex", unit: "ml", category: "bronchodilator" },
  { kind: "med", code: "ventolin", name: "Ventolin", unit: "ml", category: "bronchodilator" },

  // Medications - NSAID
  { kind: "med", code: "ketorolacNsaid", name: "Ketorolac", unit: "mg", category: "nsaid" },
  { kind: "med", code: "parecoxibNsaid", name: "Parecoxib", unit: "mg", category: "nsaid" },

  // Medications - Diuretic
  { kind: "med", code: "furosemide", name: "Furosemide", unit: "mg", category: "diuretic" },

  // Medications - Steroid
  { kind: "med", code: "dexamethasoneSteroid", name: "Dexamethasone", unit: "mg", category: "steroid" },
  { kind: "med", code: "hydrocortisone", name: "Hydrocortisone", unit: "mg", category: "steroid" },
  { kind: "med", code: "methylprednisolone", name: "Methylprednisolone", unit: "mg", category: "steroid" },
  { kind: "med", code: "simulectR", name: "Simulect (R)", unit: "mg", category: "steroid" },

  // Medications - Others
  { kind: "med", code: "calciumGluconate10", name: "10% Calcium gluconate", unit: "ml", category: "othersMed" },
  { kind: "med", code: "mgso410", name: "10% MgSO4", unit: "ml", category: "othersMed" },
  { kind: "med", code: "mannitol20Others", name: "20% Mannitol", unit: "ml", category: "othersMed" },
  { kind: "med", code: "glucose50", name: "50% Glucose", unit: "ml", category: "othersMed" },
  { kind: "med", code: "nahco3_75", name: "7.5% NaHCO3", unit: "ml", category: "othersMed" },
  { kind: "med", code: "chlopheniramine", name: "Chlopheniramine", unit: "mg", category: "othersMed" },
  { kind: "med", code: "dantrolene", name: "Dantrolene", unit: "mg", category: "othersMed" },
  { kind: "med", code: "ddavp", name: "DDAVP", unit: "mcg", category: "othersMed" },
  { kind: "med", code: "duratocin", name: "Duratocin", unit: "units", category: "othersMed" },
  { kind: "med", code: "esomeprazole", name: "Esomeprazole", unit: "mg", category: "othersMed" },
  { kind: "med", code: "factorVIIa", name: "Factor VIIa", unit: "mg", category: "othersMed" },
  { kind: "med", code: "flumazenil", name: "Flumazenil", unit: "mg", category: "othersMed" },
  { kind: "med", code: "fosphenytoin", name: "Fosphenytoin", unit: "mg", category: "othersMed" },
  { kind: "med", code: "haloperidol", name: "Haloperidol", unit: "mg", category: "othersMed" },
  { kind: "med", code: "heparin", name: "Heparin", unit: "units", category: "othersMed" },
  { kind: "med", code: "hyoscineNButylbromide", name: "Hyoscine-N-butylbromide", unit: "mg", category: "othersMed" },
  { kind: "med", code: "indocyanineGreen", name: "Indocyanine Green", unit: "mg", category: "othersMed" },
  { kind: "med", code: "insulin", name: "Insulin", unit: "units", category: "othersMed" },
  { kind: "med", code: "ivig", name: "IVIG", unit: "g", category: "othersMed" },
  { kind: "med", code: "levetiracetam", name: "Levetiracetam", unit: "mg", category: "othersMed" },
  { kind: "med", code: "methylergonovine", name: "Methylergonovine", unit: "mg", category: "othersMed" },
  { kind: "med", code: "naloxone", name: "Naloxone", unit: "mg", category: "othersMed" },
  { kind: "med", code: "nefopamOthers", name: "Nefopam", unit: "mg", category: "othersMed" },
  { kind: "med", code: "omeprazole", name: "Omeprazole", unit: "mg", category: "othersMed" },
  { kind: "med", code: "oxytocin", name: "Oxytocin", unit: "units", category: "othersMed" },
  { kind: "med", code: "paracetamolOthers", name: "Paracetamol", unit: "mg", category: "othersMed" },
  { kind: "med", code: "phenytoinOthers", name: "Phenytoin", unit: "mg", category: "othersMed" },
  { kind: "med", code: "protamine", name: "Protamine", unit: "mg", category: "othersMed" },
  { kind: "med", code: "ranitidine", name: "Ranitidine", unit: "mg", category: "othersMed" },
  { kind: "med", code: "tranexamicAcid", name: "Tranexamic acid", unit: "mg", category: "othersMed" },
  { kind: "med", code: "valproicAcid", name: "Valproic acid", unit: "mg", category: "othersMed" },
  { kind: "med", code: "vitaminK", name: "Vitamin K", unit: "mg", category: "othersMed" },

  // Medications - Airway anesth
  { kind: "med", code: "cocaine10Airway", name: "10% Cocaine", unit: "ml", category: "airwayAnesth" },
  { kind: "med", code: "lidocaine0025Spray", name: "0.025% Lidocaine spray", unit: "ml", category: "airwayAnesth" },
  { kind: "med", code: "lidocaine005Spray", name: "0.05% Lidocaine spray", unit: "ml", category: "airwayAnesth" },
  { kind: "med", code: "lidocaine1Airway", name: "1% Lidocaine", unit: "ml", category: "airwayAnesth" },
  { kind: "med", code: "lidocaine2Airway", name: "2% Lidocaine", unit: "ml", category: "airwayAnesth" },
  { kind: "med", code: "lidocaine4Airway", name: "4% Lidocaine", unit: "ml", category: "airwayAnesth" },
  { kind: "med", code: "lidocaine10SprayAirway", name: "10% Lidocaine spray", unit: "ml", category: "airwayAnesth" },
  { kind: "med", code: "kamillosanSpray", name: "Kamillosan spray", unit: "ml", category: "airwayAnesth" },

  // Medications - Oral drug
  { kind: "med", code: "celecoxib", name: "Celecoxib", unit: "mg", category: "oralDrug" },
  { kind: "med", code: "etoricoxib", name: "Etoricoxib", unit: "mg", category: "oralDrug" },
  { kind: "med", code: "gabapentin", name: "Gabapentin", unit: "mg", category: "oralDrug" },
  { kind: "med", code: "isordil", name: "Isordil", unit: "mg", category: "oralDrug" },
  { kind: "med", code: "lorazepam", name: "Lorazepam", unit: "mg", category: "oralDrug" },
  { kind: "med", code: "midazolamOral", name: "Midazolam", unit: "mg", category: "oralDrug" },
  { kind: "med", code: "nifedipine", name: "Nifedipine", unit: "mg", category: "oralDrug" },
  { kind: "med", code: "paracetamolOral", name: "Paracetamol", unit: "mg", category: "oralDrug" },
  { kind: "med", code: "pregabalin", name: "Pregabalin", unit: "mg", category: "oralDrug" },
  { kind: "med", code: "ultracet", name: "Ultracet", unit: "mg", category: "oralDrug" },

  // Medications - External drug
  { kind: "med", code: "emla5", name: "5% EMLA", unit: "g", category: "externalDrug" },
  { kind: "med", code: "paracetamolSupp", name: "Paracetamol supp.", unit: "mg", category: "externalDrug" },
  { kind: "med", code: "terramycin", name: "Terramycin", unit: "g", category: "externalDrug" },
  { kind: "med", code: "visidicEyeGel", name: "Visidic eye gel", unit: "g", category: "externalDrug" },

  // Output
  { kind: "output", code: "urine", name: "Urine", unit: "ml", category: "urineOutput" },
  { kind: "output", code: "bloodLoss", name: "Blood Loss", unit: "ml", category: "bloodLossOutput" },
];

const upsertIoItem = db.prepare(
  `INSERT INTO io_item_master
    (kind, code, name, default_unit, category, is_active, created_at, updated_at)
   VALUES (?, ?, ?, ?, ?, 1, ?, ?)
   ON CONFLICT(code)
   DO UPDATE SET
     kind = excluded.kind,
     name = excluded.name,
     default_unit = excluded.default_unit,
     category = excluded.category,
     is_active = 1,
     updated_at = excluded.updated_at`
);

runBootstrapWrite("io_item_master seed", () => {
  for (const item of IO_ITEM_SEED) {
    const now = Date.now();
    upsertIoItem.run(
      item.kind,
      item.code,
      item.name,
      item.unit,
      item.category,
      now,
      now,
    );
  }
});

const MED_NAME_OVERRIDES_BY_CODE = new Map([
  ["beradual", "Berodual"],
  ["cefoperazoneSulbactam", "Cefoperazone/Sulbactam"],
  ["chlopheniramine", "Chlorpheniramine"],
  ["deksketoprofen", "Dexketoprofen"],
  ["lidocaineAdrenaline", "Lidocaine + Adrenaline"],
  ["paracetamolSupp", "Paracetamol suppository"],
  ["penicillinGNa", "Penicillin G"],
  ["simulectR", "Simulect"],
]);

const MED_UNIT_OVERRIDES_BY_CODE = new Map([["penicillinGNa", "MUnits"]]);

const MED_CATEGORY_OVERRIDES_BY_CODE = new Map(
  Object.entries({
    ivAnesthetic: [
      "dexmedetomidine",
      "diazepam",
      "etomidate",
      "ketamine",
      "midazolam",
      "propofol",
      "thiopental",
    ],
    nmbd: [
      "rocuronium",
      "cisatracurium",
      "atracurium",
      "vecuronium",
      "succinylcholine",
      "pancuronium",
    ],
    opioid: [
      "morphine",
      "fentanyl",
      "pethidine",
      "nalbuphine",
      "tramadol",
      "remifentanil",
    ],
    localAnesthetic: [
      "bupivacaine",
      "bupivacaineHyperbaric",
      "bupivacaineIsobaric",
      "levobupivacaine",
      "lidocaine",
      "lidocaineAdrenaline",
      "ropivacaine",
      "cocaine10Airway",
      "emla5",
      "kamillosanSpray",
      "lidocaine0025Spray",
      "lidocaine005Spray",
      "lidocaine10SprayAirway",
      "lidocaine1Airway",
      "lidocaine2Airway",
      "lidocaine4Airway",
    ],
    reversal: ["flumazenil", "naloxone", "neostigmine", "protamine", "sugammadex"],
    anticholinergic: [
      "atropine",
      "atropineAntiArrhythmia",
      "glycopyrrolate",
      "hyoscineNButylbromide",
    ],
    antiEmetic: ["dexamethasone", "dimenhydrinate", "metoclopramide", "ondansetron"],
    antimicrobial: [
      "amikacin",
      "ampicillin",
      "amoxicillinClavulanate",
      "cefazolin",
      "cefoperazoneSulbactam",
      "ceftazidime",
      "ceftriaxone",
      "cefuroxime",
      "ciprofloxacin",
      "clindamycin",
      "cloxacillin",
      "colistin",
      "ertapenemNa",
      "fosfomycin",
      "gentamicin",
      "imipenem",
      "levofloxacin",
      "meropenem",
      "metronidazole",
      "moxifloxacin",
      "penicillinGNa",
      "piperacillinTazobactam",
      "sulbactamAmpicillin",
      "teicoplanin",
      "vancomycin",
    ],
    cvDrug: [
      "adenosine",
      "amiodarone",
      "digoxin",
      "diltiazem",
      "ephedrine",
      "epinephrine",
      "esmolol",
      "labetalol",
      "lidocaineAntiArrhythmia",
      "nicardipine",
      "norepinephrine",
      "verapamil",
    ],
    analgesic: [
      "deksketoprofen",
      "ketorolacAnalgesic",
      "ketorolacNsaid",
      "nefopam",
      "nefopamOthers",
      "paracetamol",
      "paracetamolOthers",
      "paracetamolOral",
      "paracetamolSupp",
      "parecoxibAnalgesic",
      "parecoxibNsaid",
    ],
  }).flatMap(([category, codes]) => codes.map(code => [code, category])),
);

const MED_USAGE_PENALTY_BY_CODE = new Map([
  ["atropineAntiArrhythmia", 0.15],
  ["dexamethasoneSteroid", 0.15],
  ["ketorolacNsaid", 0.2],
  ["lidocaineAntiArrhythmia", 0.15],
  ["midazolamOral", 0.1],
  ["nefopamOthers", 0.15],
  ["paracetamolOral", 0.1],
  ["paracetamolOthers", 0.15],
  ["paracetamolSupp", 0.1],
  ["parecoxibNsaid", 0.2],
]);

const LEGACY_MED_CATEGORY_UPDATES = [
  {
    target: "ivAnesthetic",
    legacy: ["anesthetic", "anaesthetic", "ivanesthdrip", "ivanesth"],
  },
  {
    target: "nmbd",
    legacy: ["musclerelaxant", "relaxantdrip", "relaxant", "nmba", "neuromuscular"],
  },
  { target: "opioid", legacy: ["opioiddrip", "opioid"] },
  { target: "localAnesthetic", legacy: ["localanesthdrip", "localanesth", "localplusopioid", "airwayanesth", "airway anesth", "airwayanes"] },
  { target: "reversal", legacy: ["reversaldrip", "reversal"] },
  { target: "antiEmetic", legacy: ["antiemetic", "anti-emetic"] },
  { target: "antimicrobial", legacy: ["antibioticsdrip", "antibiotics", "antimicrobial"] },
  { target: "cvDrug", legacy: ["vasopressor", "inotrope", "inotropedrip", "antiht", "antiarrhythmia", "antiarrhyth", "cvdrug"] },
  { target: "analgesic", legacy: ["analgesic", "nsaid", "nsaiddrip", "nsaids", "nonopioid"] },
  { target: "other", legacy: ["steroid", "steroiddrip", "bronchodilator", "diuretic", "antiepileptic", "mannitol", "oraldrug", "oral drug", "externaldrug", "external drug", "others", "othersmed"] },
];

const MED_CATEGORY_TOKEN_TO_CANONICAL = new Map(
  [
    "ivAnesthetic",
    "nmbd",
    "opioid",
    "localAnesthetic",
    "reversal",
    "antiEmetic",
    "anticholinergic",
    "antimicrobial",
    "cvDrug",
    "analgesic",
    "other",
  ].map(category => [String(category).toLowerCase().replace(/[^a-z0-9]+/g, ""), category]),
);

const MED_NAME_ALIASES = new Map([
  ["amoxicillinclavuronate", "amoxicillinclavulanate"],
  ["ampicilin", "ampicillin"],
  ["chlorpheniramine", "chlorpheniramine"],
  ["chlopheniramine", "chlorpheniramine"],
  ["deksketoprofen", "dexketoprofen"],
  ["dexsketoprofen", "dexketoprofen"],
  ["lidocainewadrenaline", "lidocaineadrenaline"],
  ["paraceta", "paracetamol"],
  ["scholine", "succinylcholine"],
]);

function normalizeMedLookupToken(value) {
  const raw = String(value || "")
    .replace(/&nbsp;/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .trim();
  const token = raw.toLowerCase().replace(/[^a-z0-9]+/g, "");
  return MED_NAME_ALIASES.get(token) || token;
}

function readTsvRows(fileName) {
  const fullPath = path.resolve(__dirname, "..", fileName);
  if (!fs.existsSync(fullPath)) return [];
  const content = String(fs.readFileSync(fullPath, "utf8") || "").trim();
  if (!content) return [];
  const lines = content.split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return [];
  const header = lines[0].split("\t");
  return lines.slice(1).map(line => {
    const values = line.split("\t");
    const row = {};
    for (let index = 0; index < header.length; index += 1) {
      row[header[index]] = values[index] || "";
    }
    return row;
  });
}

function loadLegacyBolusCounts() {
  const rows = readTsvRows("med_bolus_importance_2020-2025.tsv");
  const counts = new Map();
  for (const row of rows) {
    const token = normalizeMedLookupToken(row.drug_name);
    const count = Number(row.legacy_count);
    if (!token || !Number.isFinite(count) || count <= 0) continue;
    counts.set(token, Math.max(counts.get(token) || 0, count));
  }
  return counts;
}

function loadLegacyDripCounts() {
  const rows = readTsvRows("result.legacy_all.presets.tsv");
  const counts = new Map();
  for (const row of rows) {
    const token = normalizeMedLookupToken(row.drug_name);
    const count = Number(row.weighted_count);
    if (!token || !Number.isFinite(count) || count <= 0) continue;
    counts.set(token, (counts.get(token) || 0) + count);
  }
  return counts;
}

function preferredMedCategoryForCode(code, fallbackCategory) {
  const override = MED_CATEGORY_OVERRIDES_BY_CODE.get(code);
  if (override) return override;
  const token = String(fallbackCategory || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
  if (MED_CATEGORY_TOKEN_TO_CANONICAL.has(token)) {
    return MED_CATEGORY_TOKEN_TO_CANONICAL.get(token);
  }
  for (const entry of LEGACY_MED_CATEGORY_UPDATES) {
    if (entry.legacy.includes(token)) return entry.target;
  }
  return "other";
}

function applyMedicationMasterCleanup() {
  const now = Date.now();
  const rows = db
    .prepare(`SELECT id, code, name, default_unit, category FROM io_item_master WHERE kind = 'med'`)
    .all();
  const updateItem = db.prepare(
    `UPDATE io_item_master
       SET name = ?, default_unit = ?, category = ?, updated_at = ?
     WHERE id = ?`
  );

  for (const row of rows) {
    const code = String(row.code || "").trim();
    const nextName = MED_NAME_OVERRIDES_BY_CODE.get(code) || String(row.name || "").trim();
    const nextUnit = MED_UNIT_OVERRIDES_BY_CODE.get(code) || String(row.default_unit || "").trim() || "mg";
    const nextCategory = preferredMedCategoryForCode(code, row.category);
    updateItem.run(nextName, nextUnit, nextCategory, now, row.id);
  }
}

function applyMedicationUsageRanking() {
  const bolusCounts = loadLegacyBolusCounts();
  const dripCounts = loadLegacyDripCounts();
  const items = db
    .prepare(`SELECT id, code, name FROM io_item_master WHERE kind = 'med' AND is_active = 1`)
    .all();

  const maxBolus = Math.max(1, ...Array.from(bolusCounts.values()));
  const maxDrip = Math.max(1, ...Array.from(dripCounts.values()));

  const ranked = items
    .map(item => {
      const token = normalizeMedLookupToken(item.name) || normalizeMedLookupToken(item.code);
      const bolus = bolusCounts.get(token) || 0;
      const drip = dripCounts.get(token) || 0;
      const penalty = MED_USAGE_PENALTY_BY_CODE.get(String(item.code || "").trim()) || 1;
      const score = Math.round(
        ((bolus / maxBolus) * 7000 + (drip / maxDrip) * 3000) * penalty,
      );
      return {
        id: item.id,
        name: String(item.name || "").trim(),
        score,
      };
    })
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));

  const updateUsage = db.prepare(
    `UPDATE io_item_master
       SET usage_score = ?, usage_rank = ?, updated_at = ?
     WHERE id = ?`
  );
  const now = Date.now();
  ranked.forEach((item, index) => {
    updateUsage.run(item.score, index + 1, now, item.id);
  });
}

// Normalize legacy categories to current group keys, then rank meds from legacy usage files.
runBootstrapWrite("io_item_master normalization", () => {
  const normalizeCategoryNow = Date.now();
  db.prepare(
    `UPDATE io_item_master
     SET category = 'fluids', updated_at = ?
     WHERE kind = 'fluid'
       AND lower(COALESCE(category, '')) = 'fluid'`
  ).run(normalizeCategoryNow);
  db.prepare(
    `UPDATE io_item_master
     SET category = 'bloodProduct', updated_at = ?
     WHERE kind = 'fluid'
       AND lower(COALESCE(category, '')) = 'blood'`
  ).run(normalizeCategoryNow);
  db.prepare(
    `UPDATE io_item_master
     SET category = 'urineOutput', updated_at = ?
     WHERE kind = 'output'
       AND lower(COALESCE(category, '')) = 'output'
       AND lower(code) = 'urine'`
  ).run(normalizeCategoryNow);
  db.prepare(
    `UPDATE io_item_master
     SET category = 'bloodLossOutput', updated_at = ?
     WHERE kind = 'output'
       AND lower(COALESCE(category, '')) = 'output'
       AND lower(code) = 'bloodloss'`
  ).run(normalizeCategoryNow);

  db.prepare(
    `UPDATE io_item_master
     SET is_active = 0, updated_at = ?
     WHERE kind = 'output'
       AND code IN ('drain', 'suction', 'otherOutput')`
  ).run(Date.now());

  db.prepare(
    `UPDATE io_item_master
     SET is_active = 0, updated_at = ?
     WHERE kind = 'fluid'
       AND code IN ('crystalloid', 'colloid', 'albumin', 'prbc', 'ffp', 'platelet')`
  ).run(Date.now());

  applyMedicationMasterCleanup();
  applyMedicationUsageRanking();
});

function normalizeEntryYear(raw) {
  const text = String(raw || "").trim();
  if (!text) return null;
  const n = Number(text);
  if (!Number.isFinite(n)) return null;
  if (n >= 2500 && n <= 2700) return Math.trunc(n);
  if (n >= 1900 && n <= 2200) return Math.trunc(n);
  if (n >= 50 && n <= 99) return 2500 + Math.trunc(n);
  if (n >= 0 && n <= 49) return 2000 + Math.trunc(n);
  return null;
}

function canonicalRoleIdAndLabel(rawRole) {
  const roleText = String(rawRole || "").trim().replace(/\s+/g, " ");
  if (!roleText) return null;
  if (/^anes resident\b/i.test(roleText)) {
    return { roleId: "anesthetistResident", roleLabel: "Anesthetist Resident" };
  }

  const row = db
    .prepare(
      `SELECT id, display_name
       FROM staff_role
       WHERE lower(display_name) = lower(?)
       LIMIT 1`
    )
    .get(roleText);
  if (!row) return null;
  return { roleId: row.id, roleLabel: row.display_name };
}

const residentDirectoryRows = db
  .prepare(
    `SELECT id, staff_role, entry_year
     FROM staff_directory
     WHERE lower(staff_role) LIKE 'anes resident%'`
  )
  .all();
const updateDirectoryResident = db.prepare(
  `UPDATE staff_directory
   SET staff_role = 'Anesthetist Resident',
       staff_role_id = 'anesthetistResident',
       entry_year = COALESCE(entry_year, ?),
       updated_at = ?
   WHERE id = ?`
);
runBootstrapWrite("staff_directory resident normalization", () => {
  for (const row of residentDirectoryRows) {
    const m = /(\d{2,4})\s*$/.exec(String(row.staff_role || ""));
    const parsedYear = normalizeEntryYear(m ? m[1] : null);
    updateDirectoryResident.run(parsedYear, Date.now(), row.id);
  }
});

const residentCaseRows = db
  .prepare(
    `SELECT id, staff_role, entry_year
     FROM case_staff
     WHERE lower(staff_role) LIKE 'anes resident%'`
  )
  .all();
const updateCaseResident = db.prepare(
  `UPDATE case_staff
   SET staff_role = 'Anesthetist Resident',
       staff_role_id = 'anesthetistResident',
       entry_year = COALESCE(entry_year, ?),
       updated_at = ?
   WHERE id = ?`
);
runBootstrapWrite("case_staff resident normalization", () => {
  for (const row of residentCaseRows) {
    const m = /(\d{2,4})\s*$/.exec(String(row.staff_role || ""));
    const parsedYear = normalizeEntryYear(m ? m[1] : null);
    updateCaseResident.run(parsedYear, Date.now(), row.id);
  }
});

const allDirectoryRoles = db
  .prepare(
    `SELECT id, staff_role
     FROM staff_directory`
  )
  .all();
const updateDirectoryRole = db.prepare(
  `UPDATE staff_directory
   SET staff_role_id = ?,
       staff_role = ?,
       updated_at = ?
   WHERE id = ?`
);
runBootstrapWrite("staff_directory role normalization", () => {
  for (const row of allDirectoryRoles) {
    const canonical = canonicalRoleIdAndLabel(row.staff_role);
    if (!canonical) continue;
    updateDirectoryRole.run(canonical.roleId, canonical.roleLabel, Date.now(), row.id);
  }
});

runBootstrapWrite("staff_directory id normalization", () => {
  const now = Date.now();
  db.prepare(
    `UPDATE staff_directory
     SET hospital_id = trim(COALESCE(personal_id, '')),
         updated_at = ?
     WHERE trim(COALESCE(hospital_id, '')) = ''
       AND trim(COALESCE(personal_id, '')) <> ''`
  ).run(now);
  db.prepare(
    `UPDATE staff_directory
     SET personal_id = trim(COALESCE(hospital_id, '')),
         updated_at = ?
     WHERE trim(COALESCE(personal_id, '')) = ''
       AND trim(COALESCE(hospital_id, '')) <> ''`
  ).run(now);
});

const allCaseRoles = db
  .prepare(
    `SELECT id, staff_role
     FROM case_staff`
  )
  .all();
const updateCaseRole = db.prepare(
  `UPDATE case_staff
   SET staff_role_id = ?,
       staff_role = ?,
       updated_at = ?
   WHERE id = ?`
);
runBootstrapWrite("case_staff role normalization", () => {
  for (const row of allCaseRoles) {
    const canonical = canonicalRoleIdAndLabel(row.staff_role);
    if (!canonical) continue;
    updateCaseRole.run(canonical.roleId, canonical.roleLabel, Date.now(), row.id);
  }
});

// ── Vital-minutes retention / pruning ─────────────────────────────────────────
// FLORA_RETENTION_DAYS: how many days of vital_minutes to keep (default 360).
// Set to 0 to disable pruning entirely.
const FLORA_RETENTION_DAYS = Number(process.env.FLORA_RETENTION_DAYS ?? 360);

function pruneOldVitalMinutes() {
  if (!FLORA_RETENTION_DAYS || FLORA_RETENTION_DAYS <= 0) return 0;
  const cutoff = Date.now() - FLORA_RETENTION_DAYS * 24 * 60 * 60 * 1000;
  try {
    const result = db.prepare(
      `DELETE FROM vital_minutes WHERE ts_minute < ?`
    ).run(cutoff);
    if (result.changes > 0) {
      console.log(
        `[FLORA] pruned ${result.changes} vital_minute rows older than ${FLORA_RETENTION_DAYS} days`
      );
      // Reclaim freed pages without a full VACUUM lock
      try { db.pragma("incremental_vacuum(500)"); } catch { /* non-fatal */ }
    }
    return result.changes;
  } catch (err) {
    if (isSqliteReadonlyError(err)) {
      console.warn("[FLORA] skipped vital_minutes pruning because database is read-only");
      return 0;
    }
    console.error("[FLORA] pruneOldVitalMinutes error:", err.message);
    return 0;
  }
}

function closeDb() {
  try {
    db.pragma("wal_checkpoint(TRUNCATE)");
  } catch {
    // ignore checkpoint errors during shutdown
  }

  try {
    db.close();
  } catch {
    // ignore close errors during shutdown
  }
}

function hashPasswordWithSalt(password, saltHex) {
  return crypto.scryptSync(String(password), Buffer.from(saltHex, "hex"), 64).toString("hex");
}

function createPasswordRecord(password) {
  const saltHex = crypto.randomBytes(16).toString("hex");
  return {
    saltHex,
    hashHex: hashPasswordWithSalt(password, saltHex),
  };
}

const DEFAULT_STAFF_AUTH_PASSWORD = String(
  process.env.FLORA_DEFAULT_STAFF_PASSWORD || "flora",
).trim() || "flora";

const selectAuthUserByUsername = db.prepare(
  `SELECT id, username, hospital_id, auth_source, password_salt, password_hash, name, role, theme_mode, theme_color, is_active, created_at, updated_at, last_login_at
   FROM auth_user
   WHERE lower(username) = lower(?)
   LIMIT 1`
);

const selectAuthUserByHospitalId = db.prepare(
  `SELECT id, username, hospital_id, auth_source, password_salt, password_hash, name, role, theme_mode, theme_color, is_active, created_at, updated_at, last_login_at
   FROM auth_user
   WHERE hospital_id = ?
   LIMIT 1`
);

const selectAuthUserById = db.prepare(
  `SELECT id, username, hospital_id, auth_source, password_salt, password_hash, name, role, theme_mode, theme_color, is_active, created_at, updated_at, last_login_at
   FROM auth_user
   WHERE id = ?
   LIMIT 1`
);

const insertAuthUser = db.prepare(
  `INSERT INTO auth_user (
      username, hospital_id, auth_source, password_salt, password_hash, name, role, is_active, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
);

const updateAuthUserPassword = db.prepare(
  `UPDATE auth_user
   SET username = ?, hospital_id = ?, auth_source = ?, password_salt = ?, password_hash = ?, name = ?, role = ?, is_active = ?, updated_at = ?
   WHERE id = ?`
);

const updateAuthUserProfile = db.prepare(
  `UPDATE auth_user
   SET username = ?, hospital_id = ?, auth_source = ?, name = ?, role = ?, is_active = ?, updated_at = ?
   WHERE id = ?`
);

const touchAuthUserLogin = db.prepare(
  `UPDATE auth_user
   SET last_login_at = ?, updated_at = ?
   WHERE id = ?`
);

const updateAuthUserActiveState = db.prepare(
  `UPDATE auth_user
   SET is_active = ?, updated_at = ?
   WHERE id = ?`
);

const updateAuthUserThemePreferences = db.prepare(
  `UPDATE auth_user
   SET theme_mode = ?, theme_color = ?, updated_at = ?
   WHERE id = ?`
);

const AUTH_SESSION_TTL_MS = Number(process.env.FLORA_AUTH_SESSION_TTL_MS || 30 * 24 * 60 * 60 * 1000);

const selectAuthSessionByTokenHash = db.prepare(
  `SELECT
      s.id AS session_id,
      s.user_id,
      s.client_label,
      s.created_at AS session_created_at,
      s.updated_at AS session_updated_at,
      s.last_seen_at,
      s.expires_at,
      s.revoked_at,
      u.id,
      u.username,
      u.hospital_id,
      u.auth_source,
      u.name,
      u.role,
      u.theme_mode,
      u.theme_color,
      u.is_active,
      u.created_at,
      u.updated_at,
      u.last_login_at
   FROM auth_session s
   JOIN auth_user u ON u.id = s.user_id
   WHERE s.token_hash = ?
   LIMIT 1`
);

const insertAuthSession = db.prepare(
  `INSERT INTO auth_session (
      user_id, token_hash, client_label, created_at, updated_at, last_seen_at, expires_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)`
);

const touchAuthSession = db.prepare(
  `UPDATE auth_session
   SET updated_at = ?, last_seen_at = ?, expires_at = ?
   WHERE id = ?`
);

const revokeAuthSessionById = db.prepare(
  `UPDATE auth_session
   SET revoked_at = ?, updated_at = ?
   WHERE id = ?`
);

const revokeExpiredAuthSessionsStmt = db.prepare(
  `DELETE FROM auth_session
   WHERE revoked_at IS NOT NULL OR expires_at <= ?`
);

const insertAuthAudit = db.prepare(
  `INSERT INTO auth_audit (
      action, actor_user_id, actor_username, actor_role, target_user_id, target_username, status, detail_json, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
);

const insertCaseDeviceIngestAudit = db.prepare(
  `INSERT INTO case_device_ingest_audit (
      case_id, hn, source_service, source_endpoint, fetch_mode,
      minute_ts, from_ts, to_ts,
      raw_row_count, written_row_count, status,
      actor_username, actor_role, detail_json, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
);

function sanitizeAuthUserRow(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    username: String(row.username || ""),
    hospitalId: row.hospital_id == null ? undefined : String(row.hospital_id || ""),
    authSource: row.auth_source == null ? undefined : String(row.auth_source || ""),
    name: String(row.name || row.username || ""),
    role: row.role == null ? undefined : String(row.role || ""),
    themeMode: row.theme_mode == null ? undefined : String(row.theme_mode || ""),
    themeColor: row.theme_color == null ? undefined : String(row.theme_color || ""),
    isActive: Number(row.is_active || 0) === 1,
    createdAt: Number(row.created_at || 0),
    updatedAt: Number(row.updated_at || 0),
    lastLoginAt: row.last_login_at == null ? null : Number(row.last_login_at),
  };
}

function hashAuthSessionToken(token) {
  return crypto.createHash("sha256").update(String(token || "")).digest("hex");
}

function recordAuthAudit({
  action,
  actorUserId = null,
  actorUsername = null,
  actorRole = null,
  targetUserId = null,
  targetUsername = null,
  status = "ok",
  detail = null,
}) {
  const detailJson =
    detail == null ? null : JSON.stringify(detail);
  insertAuthAudit.run(
    String(action || "").trim() || "unknown",
    actorUserId == null ? null : Number(actorUserId),
    actorUsername == null ? null : String(actorUsername || "").trim() || null,
    actorRole == null ? null : String(actorRole || "").trim() || null,
    targetUserId == null ? null : Number(targetUserId),
    targetUsername == null ? null : String(targetUsername || "").trim() || null,
    String(status || "").trim() || "ok",
    detailJson,
    Date.now(),
  );
}

function getAuthUserByUsername(username) {
  const normalized = String(username || "").trim();
  if (!normalized) return null;
  const row = selectAuthUserByUsername.get(normalized);
  return row ? { ...sanitizeAuthUserRow(row), passwordSalt: row.password_salt, passwordHash: row.password_hash } : null;
}

function getAuthUserById(userId) {
  const id = Number(userId);
  if (!Number.isFinite(id) || id <= 0) return null;
  const row = selectAuthUserById.get(id);
  return row ? { ...sanitizeAuthUserRow(row), passwordSalt: row.password_salt, passwordHash: row.password_hash } : null;
}

function createAuthSessionForUser(user, clientLabel = "") {
  const userId = Number(user?.id || 0);
  if (!Number.isFinite(userId) || userId <= 0) {
    throw new Error("user required");
  }
  revokeExpiredAuthSessionsStmt.run(Date.now());
  const token = crypto.randomBytes(32).toString("hex");
  const tokenHash = hashAuthSessionToken(token);
  const now = Date.now();
  insertAuthSession.run(
    userId,
    tokenHash,
    String(clientLabel || "").trim() || null,
    now,
    now,
    now,
    now + AUTH_SESSION_TTL_MS,
  );
  return {
    token,
    expiresAt: now + AUTH_SESSION_TTL_MS,
  };
}

function getAuthSessionByToken(token) {
  const text = String(token || "").trim();
  if (!text) return null;
  revokeExpiredAuthSessionsStmt.run(Date.now());
  const row = selectAuthSessionByTokenHash.get(hashAuthSessionToken(text));
  if (!row) return null;
  if (row.revoked_at != null) return null;
  if (Number(row.expires_at || 0) <= Date.now()) return null;
  if (Number(row.is_active || 0) !== 1) return null;

  const now = Date.now();
  touchAuthSession.run(now, now, now + AUTH_SESSION_TTL_MS, row.session_id);
  return {
    sessionId: Number(row.session_id),
    user: sanitizeAuthUserRow(row),
  };
}

function revokeAuthSession(token) {
  const session = getAuthSessionByToken(token);
  if (!session) return false;
  revokeAuthSessionById.run(Date.now(), Date.now(), session.sessionId);
  return true;
}

function upsertAuthUser({
  username,
  password,
  name,
  role,
  isActive = true,
  hospitalId = null,
  authSource = "local",
  preserveExistingPassword = false,
}) {
  const normalizedUsername = String(username || "").trim();
  const normalizedName = String(name || username || "").trim();
  const normalizedRole = String(role || "").trim() || null;
  const normalizedHospitalId = String(hospitalId || "").trim() || null;
  const normalizedAuthSource = String(authSource || "").trim() || "local";
  if (!normalizedUsername) throw new Error("username required");
  if (!normalizedName) throw new Error("name required");

  const now = Date.now();
  const existing = normalizedHospitalId
    ? selectAuthUserByHospitalId.get(normalizedHospitalId) || selectAuthUserByUsername.get(normalizedUsername)
    : selectAuthUserByUsername.get(normalizedUsername);
  if (!existing) {
    const normalizedPassword = String(password || "");
    if (!normalizedPassword) throw new Error("password required");
    const passwordRecord = createPasswordRecord(normalizedPassword);
    insertAuthUser.run(
      normalizedUsername,
      normalizedHospitalId,
      normalizedAuthSource,
      passwordRecord.saltHex,
      passwordRecord.hashHex,
      normalizedName,
      normalizedRole,
      isActive ? 1 : 0,
      now,
      now,
    );
    return sanitizeAuthUserRow(selectAuthUserByUsername.get(normalizedUsername));
  }

  if (preserveExistingPassword) {
    updateAuthUserProfile.run(
      normalizedUsername,
      normalizedHospitalId,
      normalizedAuthSource,
      normalizedName,
      normalizedRole,
      isActive ? 1 : 0,
      now,
      existing.id,
    );
    return sanitizeAuthUserRow(selectAuthUserByUsername.get(normalizedUsername));
  }

  const normalizedPassword = String(password || "");
  if (!normalizedPassword) throw new Error("password required");
  const passwordRecord = createPasswordRecord(normalizedPassword);

  updateAuthUserPassword.run(
    normalizedUsername,
    normalizedHospitalId,
    normalizedAuthSource,
    passwordRecord.saltHex,
    passwordRecord.hashHex,
    normalizedName,
    normalizedRole,
    isActive ? 1 : 0,
    now,
    existing.id,
  );
  return sanitizeAuthUserRow(selectAuthUserByUsername.get(normalizedUsername));
}

function ensureAuthUserExists(user) {
  const normalizedUsername = String(user?.username || "").trim();
  if (!normalizedUsername) throw new Error("username required");
  const existing = selectAuthUserByUsername.get(normalizedUsername);
  if (existing) return sanitizeAuthUserRow(existing);
  return upsertAuthUser(user);
}

function listAuthUsers({ q = "", includeInactive = true } = {}) {
  const search = String(q || "").trim().toLowerCase();
  const like = `%${search}%`;
  const rows = db.prepare(
    `SELECT id, username, hospital_id, auth_source, name, role, theme_mode, theme_color, is_active, created_at, updated_at, last_login_at
     FROM auth_user
     WHERE (? = 1 OR is_active = 1)
       AND (
         ? = ''
         OR lower(username) LIKE ?
         OR lower(name) LIKE ?
         OR lower(COALESCE(hospital_id, '')) LIKE ?
         OR lower(COALESCE(role, '')) LIKE ?
         OR lower(COALESCE(auth_source, '')) LIKE ?
       )
     ORDER BY is_active DESC, lower(username) ASC`
  ).all(includeInactive ? 1 : 0, search, like, like, like, like, like);
  return rows.map(sanitizeAuthUserRow);
}

function setAuthUserActive(userId, isActive) {
  const existing = selectAuthUserById.get(Number(userId));
  if (!existing) throw new Error("user not found");
  updateAuthUserActiveState.run(isActive ? 1 : 0, Date.now(), existing.id);
  return sanitizeAuthUserRow(selectAuthUserById.get(existing.id));
}

function setAuthUserThemePreferences(userId, { themeMode, themeColor }) {
  const existing = selectAuthUserById.get(Number(userId));
  if (!existing) throw new Error("user not found");

  const mode = String(themeMode || "").trim().toLowerCase();
  const color = String(themeColor || "").trim().toLowerCase();
  const allowedModes = new Set(["light", "dark"]);
  const allowedColors = new Set(["esm", "nit", "default", "grey", "green", "blackpink", "oldrose", "pink", "rcat", "eforl"]);

  if (!allowedModes.has(mode)) throw new Error("invalid theme mode");
  if (!allowedColors.has(color)) throw new Error("invalid theme color");

  updateAuthUserThemePreferences.run(mode, color, Date.now(), existing.id);
  return sanitizeAuthUserRow(selectAuthUserById.get(existing.id));
}

function resetAuthUserPassword(userId, password) {
  const existing = selectAuthUserById.get(Number(userId));
  if (!existing) throw new Error("user not found");

  const nextPassword =
    String(password || "").trim() ||
    (String(existing.auth_source || "").trim().toLowerCase() === "staff"
      ? DEFAULT_STAFF_AUTH_PASSWORD
      : String(existing.hospital_id || "").trim());
  if (!nextPassword) {
    throw new Error("no default password available for this user");
  }

  const passwordRecord = createPasswordRecord(nextPassword);
  const now = Date.now();
  db.prepare(
    `UPDATE auth_user
     SET password_salt = ?, password_hash = ?, updated_at = ?
     WHERE id = ?`
  ).run(passwordRecord.saltHex, passwordRecord.hashHex, now, existing.id);

  return {
    user: sanitizeAuthUserRow(selectAuthUserById.get(existing.id)),
    appliedPassword: nextPassword,
  };
}

function changeAuthUserPasswordWithCurrentPassword(username, currentPassword, newPassword) {
  const existing = selectAuthUserByUsername.get(String(username || "").trim());
  if (!existing || Number(existing.is_active || 0) !== 1) {
    throw new Error("user not found");
  }

  const currentText = String(currentPassword || "");
  const nextText = String(newPassword || "").trim();
  if (!currentText) throw new Error("current password required");
  if (!nextText) throw new Error("new password required");
  if (nextText.length < 6) throw new Error("new password must be at least 6 characters");

  const expected = Buffer.from(String(existing.password_hash || ""), "hex");
  const actual = Buffer.from(
    hashPasswordWithSalt(currentText, String(existing.password_salt || "")),
    "hex",
  );
  if (expected.length === 0 || expected.length !== actual.length) {
    throw new Error("current password is incorrect");
  }
  if (!crypto.timingSafeEqual(expected, actual)) {
    throw new Error("current password is incorrect");
  }

  const passwordRecord = createPasswordRecord(nextText);
  const now = Date.now();
  db.prepare(
    `UPDATE auth_user
     SET password_salt = ?, password_hash = ?, updated_at = ?
     WHERE id = ?`
  ).run(passwordRecord.saltHex, passwordRecord.hashHex, now, existing.id);

  return sanitizeAuthUserRow(selectAuthUserById.get(existing.id));
}

function verifyAuthUserPassword(username, password) {
  const row = selectAuthUserByUsername.get(String(username || "").trim());
  if (!row || Number(row.is_active || 0) !== 1) return null;
  const expected = Buffer.from(String(row.password_hash || ""), "hex");
  const actual = Buffer.from(hashPasswordWithSalt(String(password || ""), String(row.password_salt || "")), "hex");
  if (expected.length === 0 || expected.length !== actual.length) return null;
  if (!crypto.timingSafeEqual(expected, actual)) return null;
  const now = Date.now();
  touchAuthUserLogin.run(now, now, row.id);
  return sanitizeAuthUserRow({ ...row, last_login_at: now, updated_at: now });
}

function normalizeAuthToken(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function deriveStaffAuthRole(staffRoleId, staffRoleLabel) {
  const roleId = String(staffRoleId || "").trim().toLowerCase();
  const roleLabel = String(staffRoleLabel || "").trim().toLowerCase();
  if (roleId === "nurseanesthetist" || roleId.includes("nurse") || roleLabel.includes("nurse")) {
    return "nurse";
  }
  if (roleId.includes("resident") || roleLabel.includes("resident")) {
    return "resident";
  }
  if (
    roleId.includes("anesthetist") ||
    roleLabel.includes("anesthetist")
  ) {
    return "anesthetist";
  }
  return roleId || roleLabel || null;
}

function buildStaffUsernameCandidates(firstName, lastName) {
  const first = normalizeAuthToken(firstName);
  const last = normalizeAuthToken(lastName);
  if (!first || !last) return [];

  const candidates = [];
  const maxLastChars = Math.min(last.length, 6);
  for (let count = 1; count <= maxLastChars; count += 1) {
    candidates.push(`${first}.${last.slice(0, count)}`);
  }
  return candidates;
}

function syncStaffDirectoryAuthUsers() {
  const staffRows = db.prepare(
    `SELECT
       hospital_id,
       personal_id,
       en_first_name,
       en_last_name,
       staff_name,
       staff_role_id,
       staff_role,
       is_active
     FROM staff_directory
     WHERE trim(COALESCE(hospital_id, personal_id, '')) <> ''
     ORDER BY is_active DESC, staff_name ASC, id ASC`
  ).all();

  if (staffRows.length === 0) return 0;

  const allAuthRows = db.prepare(
    `SELECT id, username, hospital_id, auth_source
     FROM auth_user`
  ).all();

  const usernameOwners = new Map();
  for (const row of allAuthRows) {
    const username = normalizeAuthToken(String(row.username || "").replace(/\./g, ""));
    if (!username) continue;
    usernameOwners.set(String(row.username || "").trim().toLowerCase(), {
      hospitalId: String(row.hospital_id || "").trim(),
      authSource: String(row.auth_source || "").trim(),
    });
  }

  let syncedCount = 0;

  for (const row of staffRows) {
    const hospitalId = String(row.hospital_id || row.personal_id || "").trim();
    if (!hospitalId) continue;

    const existing = selectAuthUserByHospitalId.get(hospitalId);
    const candidates = buildStaffUsernameCandidates(row.en_first_name, row.en_last_name);
    if (candidates.length === 0) continue;

    let selectedUsername = existing ? String(existing.username || "").trim() : "";
    if (!selectedUsername) {
      for (const candidate of candidates) {
        const owner = usernameOwners.get(candidate.toLowerCase());
        if (!owner || owner.hospitalId === hospitalId) {
          selectedUsername = candidate;
          break;
        }
      }
    }
    if (!selectedUsername) {
      const fallbackBase = candidates[candidates.length - 1];
      let suffix = 2;
      selectedUsername = `${fallbackBase}${suffix}`;
      while (usernameOwners.has(selectedUsername.toLowerCase())) {
        suffix += 1;
        selectedUsername = `${fallbackBase}${suffix}`;
      }
    }

    const preservedRole =
      String(existing?.role || "").trim().toLowerCase() === "admin"
        ? "admin"
        : deriveStaffAuthRole(row.staff_role_id, row.staff_role);

    upsertAuthUser({
      username: selectedUsername,
      password: DEFAULT_STAFF_AUTH_PASSWORD,
      hospitalId,
      authSource: "staff",
      name: String(row.staff_name || selectedUsername).trim() || selectedUsername,
      role: preservedRole,
      isActive: Number(row.is_active || 0) === 1,
      preserveExistingPassword: Boolean(existing),
    });
    usernameOwners.set(selectedUsername.toLowerCase(), { hospitalId, authSource: "staff" });
    syncedCount += 1;
  }

  return syncedCount;
}

function recordCaseDeviceIngestAudit({
  caseId,
  hn = null,
  sourceService,
  sourceEndpoint = null,
  fetchMode,
  minuteTs = null,
  fromTs = null,
  toTs = null,
  rawRowCount = 0,
  writtenRowCount = 0,
  status = "ok",
  actorUsername = "system:minute-writer",
  actorRole = "system",
  detail = null,
}) {
  insertCaseDeviceIngestAudit.run(
    caseId,
    hn ? String(hn).trim() : null,
    String(sourceService || "").trim() || "ivy",
    sourceEndpoint ? String(sourceEndpoint).trim() : null,
    String(fetchMode || "").trim() || "minute",
    Number.isFinite(Number(minuteTs)) ? Number(minuteTs) : null,
    Number.isFinite(Number(fromTs)) ? Number(fromTs) : null,
    Number.isFinite(Number(toTs)) ? Number(toTs) : null,
    Math.max(0, Number(rawRowCount) || 0),
    Math.max(0, Number(writtenRowCount) || 0),
    status === "failed" ? "failed" : status === "empty" ? "empty" : "ok",
    String(actorUsername || "").trim() || "system:minute-writer",
    actorRole ? String(actorRole).trim() : null,
    detail == null ? null : JSON.stringify(detail),
    Date.now(),
  );
}

function ensureBootstrapAdminUsers() {
  const adminUsers = [
    {
      username: "admin",
      password: "admin",
      name: "Administrator",
      role: "admin",
      authSource: "seed",
    },
  ];

  for (const user of adminUsers) {
    ensureAuthUserExists(user);
  }
}

runBootstrapWrite("auth_user admin seed", () => {
  ensureBootstrapAdminUsers();
});

module.exports = {
  db,
  DB_PATH,
  closeDb,
  pruneOldVitalMinutes,
  createAuthSessionForUser,
  getAuthSessionByToken,
  getAuthUserByUsername,
  getAuthUserById,
  listAuthUsers,
  recordAuthAudit,
  recordCaseDeviceIngestAudit,
  revokeAuthSession,
  setAuthUserActive,
  setAuthUserThemePreferences,
  resetAuthUserPassword,
  changeAuthUserPasswordWithCurrentPassword,
  verifyAuthUserPassword,
  upsertAuthUser,
  ensureAuthUserExists,
};
