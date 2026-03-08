const sqlite3 = require("sqlite3").verbose();
const path = require("path");

console.log("[IVY] DB FILE =", require("path").join(__dirname, "ivy.db"));

const db = new sqlite3.Database(
  path.join(__dirname, "ivy.db")
);

const DEFAULT_HL7_ALIASES = [
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

module.exports = db;
