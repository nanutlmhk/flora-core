const Database = require("better-sqlite3");
const path = require("path");
const fs = require("fs");

const explicitDb = String(process.env.FLORA_DB_PATH || process.env.AIDAS_DB_PATH || "").trim();
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

  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL,

  FOREIGN KEY (case_id) REFERENCES cases(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_case_detail_case
  ON case_detail(case_id);
`);

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
ensureColumn("case_diagnosis", "icd_text", "TEXT");
ensureColumn("case_procedure", "icd_text", "TEXT");

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

const upsertRole = db.prepare(
  `INSERT INTO staff_role (id, display_name, sort_order)
   VALUES (?, ?, ?)
   ON CONFLICT(id)
   DO UPDATE SET
     display_name = excluded.display_name,
     sort_order = excluded.sort_order`
);

for (const role of STAFF_ROLE_SEED) {
  upsertRole.run(role.id, role.displayName, role.sortOrder);
}

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
  { kind: "fluid", code: "lrs", name: "LRS", unit: "ml", category: "fluids" },
  { kind: "fluid", code: "sterofundin", name: "Sterofundin", unit: "ml", category: "fluids" },
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

// Normalize legacy categories to current group keys.
const normalizeCategoryNow = Date.now();
db.prepare(
  `UPDATE io_item_master
   SET category = 'ivAnesth', updated_at = ?
   WHERE kind = 'med'
     AND lower(COALESCE(category, '')) IN ('anesthetic','anaesthetic','ivanesthdrip')`
).run(normalizeCategoryNow);
db.prepare(
  `UPDATE io_item_master
   SET category = 'muscleRelaxant', updated_at = ?
   WHERE kind = 'med'
     AND lower(COALESCE(category, '')) IN ('relaxantdrip','relaxant')`
).run(normalizeCategoryNow);
db.prepare(
  `UPDATE io_item_master
   SET category = 'vasopressor', updated_at = ?
   WHERE kind = 'med'
     AND lower(COALESCE(category, '')) IN ('vasopressor','inotrope','inotropedrip')`
).run(normalizeCategoryNow);
db.prepare(
  `UPDATE io_item_master
   SET category = 'antibiotics', updated_at = ?
   WHERE kind = 'med'
     AND lower(COALESCE(category, '')) = 'antibioticsdrip'`
).run(normalizeCategoryNow);
db.prepare(
  `UPDATE io_item_master
   SET category = 'opioid', updated_at = ?
   WHERE kind = 'med'
     AND lower(COALESCE(category, '')) = 'opioiddrip'`
).run(normalizeCategoryNow);
db.prepare(
  `UPDATE io_item_master
   SET category = 'localAnesth', updated_at = ?
   WHERE kind = 'med'
     AND lower(COALESCE(category, '')) = 'localanesthdrip'`
).run(normalizeCategoryNow);
db.prepare(
  `UPDATE io_item_master
   SET category = 'reversal', updated_at = ?
   WHERE kind = 'med'
     AND lower(COALESCE(category, '')) = 'reversaldrip'`
).run(normalizeCategoryNow);
db.prepare(
  `UPDATE io_item_master
   SET category = 'steroid', updated_at = ?
   WHERE kind = 'med'
     AND lower(COALESCE(category, '')) = 'steroiddrip'`
).run(normalizeCategoryNow);
db.prepare(
  `UPDATE io_item_master
   SET category = 'antiEmetic', updated_at = ?
   WHERE kind = 'med'
     AND lower(COALESCE(category, '')) IN ('antiemetic','anti-emetic')`
).run(normalizeCategoryNow);
db.prepare(
  `UPDATE io_item_master
   SET category = 'nsaid', updated_at = ?
   WHERE kind = 'med'
     AND lower(COALESCE(category, '')) IN ('nsaid','nsaiddrip','nsaids')`
).run(normalizeCategoryNow);
db.prepare(
  `UPDATE io_item_master
   SET category = 'airwayAnesth', updated_at = ?
   WHERE kind = 'med'
     AND lower(COALESCE(category, '')) IN ('airwayanesth','airway anesth','airwayanes')`
).run(normalizeCategoryNow);
db.prepare(
  `UPDATE io_item_master
   SET category = 'oralDrug', updated_at = ?
   WHERE kind = 'med'
     AND lower(COALESCE(category, '')) IN ('oraldrug','oral drug')`
).run(normalizeCategoryNow);
db.prepare(
  `UPDATE io_item_master
   SET category = 'externalDrug', updated_at = ?
   WHERE kind = 'med'
     AND lower(COALESCE(category, '')) IN ('externaldrug','external drug')`
).run(normalizeCategoryNow);
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

// Keep default output list focused for OR workflow.
db.prepare(
  `UPDATE io_item_master
   SET is_active = 0, updated_at = ?
   WHERE kind = 'output'
     AND code IN ('drain', 'suction', 'otherOutput')`
).run(Date.now());

// Hide legacy generic fluid rows now that detailed fluids/blood products exist.
db.prepare(
  `UPDATE io_item_master
   SET is_active = 0, updated_at = ?
   WHERE kind = 'fluid'
     AND code IN ('crystalloid', 'colloid', 'albumin', 'prbc', 'ffp', 'platelet')`
).run(Date.now());

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
for (const row of residentDirectoryRows) {
  const m = /(\d{2,4})\s*$/.exec(String(row.staff_role || ""));
  const parsedYear = normalizeEntryYear(m ? m[1] : null);
  updateDirectoryResident.run(parsedYear, Date.now(), row.id);
}

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
for (const row of residentCaseRows) {
  const m = /(\d{2,4})\s*$/.exec(String(row.staff_role || ""));
  const parsedYear = normalizeEntryYear(m ? m[1] : null);
  updateCaseResident.run(parsedYear, Date.now(), row.id);
}

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
for (const row of allDirectoryRoles) {
  const canonical = canonicalRoleIdAndLabel(row.staff_role);
  if (!canonical) continue;
  updateDirectoryRole.run(canonical.roleId, canonical.roleLabel, Date.now(), row.id);
}

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
for (const row of allCaseRoles) {
  const canonical = canonicalRoleIdAndLabel(row.staff_role);
  if (!canonical) continue;
  updateCaseRole.run(canonical.roleId, canonical.roleLabel, Date.now(), row.id);
}

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

module.exports = { db, DB_PATH, closeDb, pruneOldVitalMinutes };
