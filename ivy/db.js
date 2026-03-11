const sqlite3 = require("sqlite3").verbose();
const path = require("path");

console.log("[IVY] DB FILE =", require("path").join(__dirname, "ivy.db"));

const db = new sqlite3.Database(
  path.join(__dirname, "ivy.db")
);

db.serialize(() => {
  db.run(`PRAGMA journal_mode = WAL`);
  db.run(`PRAGMA synchronous = NORMAL`);
  db.run(`PRAGMA busy_timeout = 15000`);      // 15 s — gives room when GE750 + HL7 both write
  db.run(`PRAGMA wal_autocheckpoint = 1000`);
  db.run(`PRAGMA cache_size = -16000`);       // 16 MB page cache
  // Force WAL recovery from any unclean prior shutdown (crash / force-kill).
  // This is a no-op when the file is already clean.
  db.run(`PRAGMA wal_checkpoint(RESTART)`, (err) => {
    if (err) console.warn("[IVY] WAL checkpoint on open (non-fatal):", err.message);
    else     console.log("[IVY] WAL checkpoint on open: ok");
  });
});

const DEFAULT_HL7_ALIASES = [
  // ECG Heart Rate
  { raw_code: "149514",              ivy_param: "hr",         unit: "bpm" },
  { raw_code: "MDC_ECG_HEART_RATE", ivy_param: "hr",         unit: "bpm" },

  // SpO2 saturation
  { raw_code: "150456",                  ivy_param: "spo2",       unit: "%" },
  { raw_code: "MDC_PULS_OXIM_SAT_O2",   ivy_param: "spo2",       unit: "%" },

  // Pulse rate from SpO2 pleth
  { raw_code: "149530",                  ivy_param: "pulse_rate", unit: "bpm" },
  { raw_code: "MDC_PULS_OXIM_PULS_RATE",ivy_param: "pulse_rate", unit: "bpm" },

  // Respiratory rate
  { raw_code: "151578",          ivy_param: "rr",    unit: "rpm" },
  { raw_code: "MDC_RESP_RATE",   ivy_param: "rr",    unit: "rpm" },

  // End-tidal CO2 from patient monitor (mmHg — different from GE750 which stores %)
  { raw_code: "151872",            ivy_param: "et_co2", unit: "mmHg" },
  { raw_code: "MDC_AWAY_CO2_EXP", ivy_param: "et_co2", unit: "mmHg" },

  // Inspired CO2 from patient monitor (mmHg)
  { raw_code: "151876",             ivy_param: "fi_co2", unit: "mmHg" },
  { raw_code: "MDC_AWAY_CO2_INSP", ivy_param: "fi_co2", unit: "mmHg" },

  // Temperature
  { raw_code: "150344", ivy_param: "temperature", unit: "C" },
  { raw_code: "MDC_TEMP", ivy_param: "temperature", unit: "C" },
  { raw_code: "MDC_TEMP_BODY", ivy_param: "temperature", unit: "C" },

  // Invasive arterial blood pressure / pulse
  { raw_code: "150033", ivy_param: "art_sys", unit: "mmHg" },
  { raw_code: "150034", ivy_param: "art_dia", unit: "mmHg" },
  { raw_code: "150035", ivy_param: "art_mean", unit: "mmHg" },
  { raw_code: "149522", ivy_param: "art_pr", unit: "bpm" },
  { raw_code: "MDC_PRESS_BLD_ART_SYS", ivy_param: "art_sys", unit: "mmHg" },
  { raw_code: "MDC_PRESS_BLD_ART_DIA", ivy_param: "art_dia", unit: "mmHg" },
  { raw_code: "MDC_PRESS_BLD_ART_MEAN", ivy_param: "art_mean", unit: "mmHg" },
  { raw_code: "MDC_BLD_PULS_RATE_INV", ivy_param: "art_pr", unit: "bpm" },
  { raw_code: "150087", ivy_param: "cvp", unit: "mmHg" },
  { raw_code: "MDC_PRESS_BLD_VEN_CENT_MEAN", ivy_param: "cvp", unit: "mmHg" },

  // Non-invasive blood pressure (NIBP)
  { raw_code: "150021", ivy_param: "nibp_sys", unit: "mmHg" },
  { raw_code: "150022", ivy_param: "nibp_dia", unit: "mmHg" },
  { raw_code: "150023", ivy_param: "nibp_map", unit: "mmHg" },
  { raw_code: "MDC_PRESS_BLD_NONINV_SYS", ivy_param: "nibp_sys", unit: "mmHg" },
  { raw_code: "MDC_PRESS_BLD_NONINV_DIA", ivy_param: "nibp_dia", unit: "mmHg" },
  { raw_code: "MDC_PRESS_BLD_NONINV_MEAN", ivy_param: "nibp_map", unit: "mmHg" },

  // ST segments
  { raw_code: "131841", ivy_param: "st_i", unit: "uV" },
  { raw_code: "131842", ivy_param: "st_ii", unit: "uV" },
  { raw_code: "131901", ivy_param: "st_iii", unit: "uV" },
  { raw_code: "131843", ivy_param: "st_v1", unit: "uV" },
  { raw_code: "131902", ivy_param: "st_avr", unit: "uV" },
  { raw_code: "131903", ivy_param: "st_avl", unit: "uV" },
  { raw_code: "131904", ivy_param: "st_avf", unit: "uV" },
  // fallback in case some monitors send named MDC codes instead of numeric codes
  { raw_code: "MDC_ECG_AMPL_ST_I", ivy_param: "st_i", unit: "uV" },
  { raw_code: "MDC_ECG_AMPL_ST_II", ivy_param: "st_ii", unit: "uV" },
  { raw_code: "MDC_ECG_AMPL_ST_III", ivy_param: "st_iii", unit: "uV" },
  { raw_code: "MDC_ECG_AMPL_ST_V1", ivy_param: "st_v1", unit: "uV" },
  { raw_code: "MDC_ECG_AMPL_ST_AVR", ivy_param: "st_avr", unit: "uV" },
  { raw_code: "MDC_ECG_AMPL_ST_AVL", ivy_param: "st_avl", unit: "uV" },
  { raw_code: "MDC_ECG_AMPL_ST_AVF", ivy_param: "st_avf", unit: "uV" },
];

db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS ivy_observations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      device_id TEXT,
      source TEXT NOT NULL,
      protocol TEXT NOT NULL,
      raw_code TEXT NOT NULL,
      ivy_param TEXT NOT NULL,
      value REAL,
      unit TEXT,
      system_ts INTEGER NOT NULL,
      device_ts INTEGER,
      created_at INTEGER NOT NULL
    )
  `);

  // Backward compatibility for older DB files created before device_id existed.
  db.run(`ALTER TABLE ivy_observations ADD COLUMN device_id TEXT`, (err) => {
    if (err && !String(err.message || "").toLowerCase().includes("duplicate")) {
      console.error("[IVY] device_id migration error:", err.message);
    }
  });

  db.run(`
    CREATE INDEX IF NOT EXISTS idx_ivy_obs_ts
    ON ivy_observations(system_ts)
  `);

  // Compound index used by /api/devices/status (GROUP BY device_id, latest per device)
  // and by any "latest value for param X on device Y" query.
  db.run(`
    CREATE INDEX IF NOT EXISTS idx_ivy_obs_device_ts
    ON ivy_observations(device_id, system_ts DESC)
  `);

  // Covering index for "latest N values of a specific param on a device" — used by
  // minuteWriter and any trend query that filters on both device + param.
  db.run(`
    CREATE INDEX IF NOT EXISTS idx_ivy_obs_device_param_ts
    ON ivy_observations(device_id, ivy_param, system_ts DESC)
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS parameter_aliases (
      protocol TEXT NOT NULL,
      raw_code TEXT NOT NULL,
      ivy_param TEXT NOT NULL,
      unit TEXT,
      UNIQUE(protocol, raw_code)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS unknown_params (
      protocol    TEXT NOT NULL,
      raw_code    TEXT NOT NULL,
      first_seen  INTEGER NOT NULL,
      last_seen   INTEGER NOT NULL,
      seen_count  INTEGER NOT NULL DEFAULT 1,
      PRIMARY KEY (protocol, raw_code)
    )
  `);

  const seedStmt = db.prepare(`
    INSERT OR IGNORE INTO parameter_aliases
      (protocol, raw_code, ivy_param, unit)
    VALUES ('hl7', ?, ?, ?)
  `);
  for (const item of DEFAULT_HL7_ALIASES) {
    seedStmt.run(item.raw_code, item.ivy_param, item.unit);
  }
  seedStmt.finalize();

  // ── GE750 Carestation 750 serial protocol aliases ──────────────────────────
  const DEFAULT_GE750_ALIASES = [
    // ── Measured ventilator (VTd standard) ───────────────────────────────────
    { raw_code: "GE750_TIDAL_VOLUME_EXP",  ivy_param: "tidal_volume_exp",        unit: "mL" },
    { raw_code: "GE750_MINUTE_VOLUME_EXP", ivy_param: "minute_volume_exp",       unit: "L/min" },
    { raw_code: "GE750_RESP_RATE",         ivy_param: "rr",                      unit: "rpm" },
    { raw_code: "GE750_FIO2",              ivy_param: "fio2",                    unit: "%" },
    { raw_code: "GE750_PPEAK",             ivy_param: "airway_pressure_peak",    unit: "cmH2O" },
    { raw_code: "GE750_PPLAT",             ivy_param: "airway_pressure_plateau", unit: "cmH2O" },
    { raw_code: "GE750_PMEAN",             ivy_param: "airway_pressure_mean",    unit: "cmH2O" },
    { raw_code: "GE750_PMIN",              ivy_param: "airway_pressure_min",     unit: "cmH2O" },
    // ── Measured ventilator (VTd extended) ───────────────────────────────────
    { raw_code: "GE750_MV_SPONT",          ivy_param: "mv_spont",                unit: "L/min" },
    { raw_code: "GE750_RR_SPONT",          ivy_param: "rr_spont",                unit: "rpm" },
    { raw_code: "GE750_PEEPI",             ivy_param: "peep_intrinsic",          unit: "cmH2O" },
    { raw_code: "GE750_COMPLIANCE",        ivy_param: "compliance",              unit: "mL/cmH2O" },
    { raw_code: "GE750_RAW",               ivy_param: "airway_resistance",       unit: "cmH2O/L/s" },
    { raw_code: "GE750_TVEXP_SPONT",       ivy_param: "tidal_volume_exp_spont",  unit: "mL" },
    { raw_code: "GE750_TVINSP",            ivy_param: "tidal_volume_insp",       unit: "mL" },
    { raw_code: "GE750_MVINSP",            ivy_param: "minute_volume_insp",      unit: "L/min" },
    { raw_code: "GE750_PEEPE",             ivy_param: "peep_extrinsic",          unit: "cmH2O" },
    { raw_code: "GE750_PEEPEI",            ivy_param: "peep_total",              unit: "cmH2O" },
    // ── MGAS gas analysis (VTd MGAS section) ─────────────────────────────────
    { raw_code: "GE750_MGAS_FIO2",         ivy_param: "fio2_meas",               unit: "%" },
    { raw_code: "GE750_ETO2",              ivy_param: "et_o2",                   unit: "%" },
    { raw_code: "GE750_FICO2",             ivy_param: "fi_co2",                  unit: "%" },
    { raw_code: "GE750_ETCO2",             ivy_param: "et_co2",                  unit: "%" },
    { raw_code: "GE750_RRCO2",             ivy_param: "rr_co2",                  unit: "rpm" },
    { raw_code: "GE750_FIAA",              ivy_param: "fi_agent",                unit: "%" },
    { raw_code: "GE750_ETAA",              ivy_param: "et_agent",                unit: "%" },
    { raw_code: "GE750_AGENT_ID",          ivy_param: "agent_id",                unit: null },
    { raw_code: "GE750_FIAA_2ND",          ivy_param: "fi_agent_2nd",            unit: "%" },
    { raw_code: "GE750_ETAA_2ND",          ivy_param: "et_agent_2nd",            unit: "%" },
    { raw_code: "GE750_AGENT_ID_2ND",      ivy_param: "agent_id_2nd",            unit: null },
    { raw_code: "GE750_FIN2O",             ivy_param: "fi_n2o",                  unit: "%" },
    { raw_code: "GE750_ETN2O",             ivy_param: "et_n2o",                  unit: "%" },
    { raw_code: "GE750_MAC",               ivy_param: "mac",                     unit: "MAC" },
    // ── Gas supply pipeline pressures ────────────────────────────────────────
    { raw_code: "GE750_PRES_O2_SUPPLY",    ivy_param: "pressure_o2_supply",      unit: "kPa" },
    { raw_code: "GE750_PRES_N2O_SUPPLY",   ivy_param: "pressure_n2o_supply",     unit: "kPa" },
    { raw_code: "GE750_PRES_AIR_SUPPLY",   ivy_param: "pressure_air_supply",     unit: "kPa" },
    // ── Measured gas flows (flowmeter) ────────────────────────────────────────
    { raw_code: "GE750_FLOW_O2",           ivy_param: "flow_o2",                 unit: "L/min" },
    { raw_code: "GE750_FLOW_N2O",          ivy_param: "flow_n2o",                unit: "L/min" },
    { raw_code: "GE750_FLOW_AIR",          ivy_param: "flow_air",                unit: "L/min" },
    // ── Measured breath timing ────────────────────────────────────────────────
    { raw_code: "GE750_TINSP_MEAS",        ivy_param: "t_insp_meas",             unit: "s" },
    { raw_code: "GE750_TEXP_MEAS",         ivy_param: "t_exp_meas",              unit: "s" },
    // ── Settings (VTq) ────────────────────────────────────────────────────────
    { raw_code: "GE750_VENT_MODE",         ivy_param: "set_vent_mode",           unit: null },
    { raw_code: "GE750_SET_TV",            ivy_param: "set_tidal_volume",        unit: "mL" },
    { raw_code: "GE750_SET_RR",            ivy_param: "set_rr",                  unit: "rpm" },
    { raw_code: "GE750_SET_IE_RATIO",      ivy_param: "set_ie_ratio",            unit: "ratio" },
    { raw_code: "GE750_SET_TPAUSE",        ivy_param: "set_tpause",              unit: "%" },
    { raw_code: "GE750_SET_PEEP",          ivy_param: "set_peep",                unit: "cmH2O" },
    { raw_code: "GE750_SET_PEAK_LIMIT",    ivy_param: "set_peak_limit",          unit: "cmH2O" },
    { raw_code: "GE750_SET_INSP_PRESSURE", ivy_param: "set_insp_pressure",       unit: "cmH2O" },
    { raw_code: "GE750_SET_FIO2",          ivy_param: "set_fio2",                unit: "%" },
    { raw_code: "GE750_SET_FGF_TOTAL",     ivy_param: "set_fgf_total",           unit: "L/min" },
    { raw_code: "GE750_SET_PSUPP",         ivy_param: "set_psupp",               unit: "cmH2O" },
    { raw_code: "GE750_SET_FLOW_TRIGGER",  ivy_param: "set_flow_trigger",        unit: "L/min" },
    { raw_code: "GE750_SET_END_FLOW",      ivy_param: "set_end_flow",            unit: "%" },
    { raw_code: "GE750_SET_T_INSP",        ivy_param: "set_t_insp",              unit: "s" },
  ];

  const ge750Stmt = db.prepare(`
    INSERT OR IGNORE INTO parameter_aliases
      (protocol, raw_code, ivy_param, unit)
    VALUES ('ge750_serial', ?, ?, ?)
  `);
  for (const item of DEFAULT_GE750_ALIASES) {
    ge750Stmt.run(item.raw_code, item.ivy_param, item.unit ?? null);
  }
  ge750Stmt.finalize();

  // Correct CO2 unit on old DBs where it was mistakenly stored as "mmHg".
  // The values are already in % (protocol divides raw by 10), only the label was wrong.
  db.run(
    `UPDATE parameter_aliases
     SET unit = '%'
     WHERE protocol = 'ge750_serial'
       AND raw_code IN ('GE750_FICO2', 'GE750_ETCO2')
       AND unit = 'mmHg'`
  );
  // Fix the unit column in ivy_observations for any already-inserted rows.
  db.run(
    `UPDATE ivy_observations
     SET unit = '%'
     WHERE protocol = 'ge750_serial'
       AND raw_code IN ('GE750_FICO2', 'GE750_ETCO2')
       AND unit = 'mmHg'`
  );

  // Keep invasive pulse on dedicated ART PR stream even on old DBs
  // that were seeded with pulse_rate before this mapping existed.
  db.run(
    `
    UPDATE parameter_aliases
    SET ivy_param = 'art_pr', unit = 'bpm'
    WHERE protocol = 'hl7'
      AND raw_code IN ('149522', 'MDC_BLD_PULS_RATE_INV')
      AND ivy_param <> 'art_pr'
    `
  );

  // Keep central venous pressure on CVP stream on old DBs.
  db.run(
    `
    UPDATE parameter_aliases
    SET ivy_param = 'cvp', unit = 'mmHg'
    WHERE protocol = 'hl7'
      AND raw_code IN ('150087', 'MDC_PRESS_BLD_VEN_CENT_MEAN')
      AND ivy_param <> 'cvp'
    `,
  );

  // Keep NIBP values on SYS/MAP/DIA streams on old DBs.
  db.run(
    `
    UPDATE parameter_aliases
    SET ivy_param = CASE
      WHEN raw_code IN ('150021', 'MDC_PRESS_BLD_NONINV_SYS') THEN 'nibp_sys'
      WHEN raw_code IN ('150022', 'MDC_PRESS_BLD_NONINV_DIA') THEN 'nibp_dia'
      WHEN raw_code IN ('150023', 'MDC_PRESS_BLD_NONINV_MEAN') THEN 'nibp_map'
      ELSE ivy_param
    END,
    unit = 'mmHg'
    WHERE protocol = 'hl7'
      AND raw_code IN (
        '150021', '150022', '150023',
        'MDC_PRESS_BLD_NONINV_SYS',
        'MDC_PRESS_BLD_NONINV_DIA',
        'MDC_PRESS_BLD_NONINV_MEAN'
      )
      AND ivy_param <> CASE
        WHEN raw_code IN ('150021', 'MDC_PRESS_BLD_NONINV_SYS') THEN 'nibp_sys'
        WHEN raw_code IN ('150022', 'MDC_PRESS_BLD_NONINV_DIA') THEN 'nibp_dia'
        WHEN raw_code IN ('150023', 'MDC_PRESS_BLD_NONINV_MEAN') THEN 'nibp_map'
        ELSE ivy_param
      END
    `,
  );
});

// ── Observation retention / pruning ───────────────────────────────────────────
// IVY_RETENTION_DAYS: how many days of ivy_observations to keep (default 90).
// Set to 0 to disable pruning entirely.
const RETENTION_DAYS = Number(process.env.IVY_RETENTION_DAYS ?? 180);

db.pruneOldObservations = function pruneOldObservations(callback) {
  if (!RETENTION_DAYS || RETENTION_DAYS <= 0) {
    if (typeof callback === "function") callback(null, 0);
    return;
  }
  const cutoff = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000;
  db.run(
    `DELETE FROM ivy_observations WHERE system_ts < ?`,
    [cutoff],
    function (err) {
      if (err) {
        console.error("[IVY] pruneOldObservations error:", err.message);
      } else if (this.changes > 0) {
        console.log(
          `[IVY] pruned ${this.changes} observations older than ${RETENTION_DAYS} days`
        );
        // Reclaim disk space after a large delete
        db.run(`PRAGMA incremental_vacuum(500)`, () => {});
      }
      if (typeof callback === "function") callback(err || null, this?.changes ?? 0);
    }
  );
};

let _dbClosed = false;
db.closeDatabase = function closeDatabase(callback) {
  if (_dbClosed) {
    if (typeof callback === "function") callback(null);
    return;
  }
  _dbClosed = true;
  db.serialize(() => {
    db.run(`PRAGMA wal_checkpoint(TRUNCATE)`, (cpErr) => {
      if (cpErr) console.warn("[IVY] WAL checkpoint on close (non-fatal):", cpErr.message);
      db.close((err) => {
        if (err) console.warn("[IVY] db.close error (non-fatal):", err.message);
        if (typeof callback === "function") callback(err || null);
      });
    });
  });
};

module.exports = db;
