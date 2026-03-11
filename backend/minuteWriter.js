const { db } = require("./floradb");

const IVY_URL = process.env.IVY_READ_URL || "http://127.0.0.1:3000/api/observations";
const IVY_BULK_URL = process.env.IVY_BULK_READ_URL || "http://127.0.0.1:3000/api/observations/bulk";
const POLL_INTERVAL_MS = Math.max(500, Number(process.env.MINUTE_WRITER_POLL_MS) || 1000);
const FETCH_TIMEOUT_MS = Math.max(1000, Number(process.env.MINUTE_WRITER_FETCH_TIMEOUT_MS) || 5000);
const MAX_BACKFILL_PER_TICK = Math.max(1, Number(process.env.MINUTE_WRITER_MAX_BACKFILL) || 60);
const EMPTY_RETRY_GRACE_MIN = Math.max(
  0,
  Number(process.env.MINUTE_WRITER_EMPTY_RETRY_GRACE_MIN) || 3,
);
const EMPTY_RETRY_GRACE_MS = EMPTY_RETRY_GRACE_MIN * 60000;

const PARAM_KEY_MAP = {
  // --- Vital Signs ---
  heart_rate: "hr",
  pulse_rate: "hr",
  art_pr: "art_pr",
  spo2: "spo2",
  resp_rate: "rr",
  rr: "rr",
  etco2: "etco2",
  temperature: "temperature",

  // --- Blood Pressure ---
  nibp_sys: "nibp_sys",
  nibp_dia: "nibp_dia",
  nibp_mean: "nibp_map",
  nibp_map: "nibp_map",
  art_sys: "art_sys",
  art_dia: "art_dia",
  art_mean: "art_map",
  art_map: "art_map",
  cvp: "cvp",

  // --- Ventilator Measured ---
  vent_mode: "set_vent_mode",
  tidal_volume_exp: "tidal_volume_exp",
  minute_volume: "minute_volume_exp",
  minute_volume_exp: "minute_volume_exp",
  fio2: "fio2",
  airway_pressure_peak: "airway_pressure_peak",
  airway_pressure_plat: "airway_pressure_plateau",
  airway_pressure_plateau: "airway_pressure_plateau",
  airway_pressure_mean: "airway_pressure_mean",
  airway_pressure_min: "airway_pressure_min",
  
  // GE750 Extended Ventilator
  mv_spont: "mv_spont",
  rr_spont: "rr_spont",
  peep_intrinsic: "peep_intrinsic",
  compliance: "compliance",
  peep_extrinsic: "peep_extrinsic",
  peep_total: "peep_total",

  // --- Gas Analysis (MGAS) ---
  fio2_meas: "fio2_meas",
  et_o2: "et_o2",
  fi_co2: "fi_co2",
  et_co2: "et_co2",
  fi_agent: "fi_agent",
  et_agent: "et_agent",
  agent_id: "agent_id",
  fi_n2o: "fi_n2o",
  et_n2o: "et_n2o",
  mac: "mac",

  // --- Gas Flows ---
  flow_o2: "flow_o2",
  flow_n2o: "flow_n2o",
  flow_air: "flow_air",

  // --- Ventilator Settings (set_ prefix) ---
  set_vent_mode: "set_vent_mode",
  tv_set: "set_tidal_volume",
  set_tidal_volume: "set_tidal_volume",
  rr_set: "set_rr",
  set_rr: "set_rr",
  ie_ratio: "set_ie_ratio",
  set_ie_ratio: "set_ie_ratio",
  peep_set: "set_peep",
  set_peep: "set_peep",
  peak_limit: "set_peak_limit",
  set_peak_limit: "set_peak_limit",
  insp_pres_set: "set_insp_pressure",
  set_insp_pressure: "set_insp_pressure",
  fio2_set: "set_fio2",
  set_fio2: "set_fio2",
  fgf_total: "set_fgf_total",
  psupp: "set_psupp",
  set_psupp: "set_psupp",
  flow_trigger: "set_flow_trigger",
  set_flow_trigger: "set_flow_trigger",
  end_flow: "set_end_flow",
  set_end_flow: "set_end_flow",
  t_insp_set: "set_t_insp",
  set_t_insp: "set_t_insp",

  // fallbacks & legacy
  etaa: "et_agent",
  fiaa: "fi_agent",
  "unknown::147842": "hr",
  "unknown::149530": "hr",
  "unknown::149522": "art_pr",
  "unknown::150456": "spo2",
  "unknown::150021": "nibp_sys",
  "unknown::150022": "nibp_dia",
  "unknown::150023": "nibp_map",
  "unknown::mdc_press_bld_noninv_sys": "nibp_sys",
  "unknown::mdc_press_bld_noninv_dia": "nibp_dia",
  "unknown::mdc_press_bld_noninv_mean": "nibp_map",
  "unknown::150087": "cvp",
  "unknown::measured fi anesthetic agent conc fiaa": "fi_agent",
  "unknown::measured end tidal anesthetic agent conc etaa": "et_agent",
};

function toAidasParamKey(ivyParam) {
  const key = String(ivyParam ?? "").trim().toLowerCase();
  // Strict mode: only emit parameters explicitly mapped for AIDAS.
  // This prevents accidental new/unmapped keys from appearing in caseview.
  return PARAM_KEY_MAP[key] || null;
}

function floorMinute(ts) {
  return Math.floor(ts / 60000) * 60000;
}

// key: caseId -> writer state
// {
//   timer, caseId, currentMinute, running, startedAt, lastTickTs,
//   lastSuccessTs, lastError, consecutiveErrors, lastFetchedRows, lastWrittenMinute
// }
const writers = new Map();

function isIvyOfflineErrorMessage(message) {
  const text = String(message || "").toLowerCase();
  if (!text) return false;
  return (
    text.includes("ivy fetch failed") ||
    text.includes("fetch failed") ||
    text.includes("econnrefused") ||
    text.includes("enotfound") ||
    text.includes("etimedout") ||
    text.includes("aborted") ||
    text.includes("socket hang up") ||
    text.includes("network")
  );
}

function startMinuteWriter(caseId) {
  if (writers.has(caseId)) return;

  const row = db
    .prepare(`SELECT start_time FROM cases WHERE id = ? AND status = 'active'`)
    .get(caseId);
  if (!row) {
    console.error("[MINUTE] case not active", caseId);
    return;
  }

  const last = db
    .prepare(
      `SELECT MAX(ts_minute) AS last
       FROM vital_minutes
       WHERE case_id = ?`,
    )
    .get(caseId);

  const state = {
    caseId,
    currentMinute: last.last ? last.last + 60000 : floorMinute(row.start_time),
    running: false,
    timer: null,
    startedAt: Date.now(),
    lastTickTs: null,
    lastSuccessTs: null,
    lastError: null,
    consecutiveErrors: 0,
    lastFetchedRows: 0,
    lastWrittenMinute: null,
    lastOfflineLogTs: 0,
  };

  console.log(
    `[MINUTE] start case=${caseId} at ${new Date(state.currentMinute).toISOString()}`,
  );

  state.timer = setInterval(() => {
    void tickWriter(state);
  }, POLL_INTERVAL_MS);

  writers.set(caseId, state);
  void tickWriter(state);
}

function stopMinuteWriter(caseId) {
  const state = writers.get(caseId);
  if (state?.timer) clearInterval(state.timer);
  writers.delete(caseId);
}

function rewindMinuteWriter(caseId, startTs) {
  const targetMinute = floorMinute(Number(startTs));
  if (!Number.isFinite(targetMinute)) return false;

  let state = writers.get(caseId);
  if (!state) {
    startMinuteWriter(caseId);
    state = writers.get(caseId);
    if (!state) return false;
  }

  if (!Number.isFinite(state.currentMinute) || targetMinute < state.currentMinute) {
    state.currentMinute = targetMinute;
    console.log(
      `[MINUTE] rewind case=${caseId} to ${new Date(targetMinute).toISOString()}`,
    );
  }

  if (!state.running) {
    void tickWriter(state);
  }

  return true;
}

async function tickWriter(state) {
  if (state.running) return;
  state.running = true;
  state.lastTickTs = Date.now();

  try {
    const nowMinute = floorMinute(Date.now());
    
    // 1. Bulk catch-up if we are far behind (> 5 minutes)
    if (nowMinute - state.currentMinute > 5 * 60000) {
      const bulkResult = await writeBulkMinutes(state.caseId, state.currentMinute, nowMinute);
      if (bulkResult.minutesProcessed > 0) {
        state.currentMinute = bulkResult.nextMinute;
        state.lastFetchedRows = bulkResult.totalRows;
        state.lastWrittenMinute = state.currentMinute - 60000;
        return;
      }
    }

    // 2. Standard single-minute catch-up / real-time loop
    let rounds = 0;
    while (state.currentMinute < nowMinute && rounds < MAX_BACKFILL_PER_TICK) {
      const result = await writeMinute(state.caseId, state.currentMinute);
      state.lastFetchedRows = result.rowCount;

      if (result.written) {
        state.lastWrittenMinute = state.currentMinute;
        state.currentMinute += 60000;
        rounds += 1;
        continue;
      }

      const ageMs = nowMinute - state.currentMinute;
      if (ageMs <= EMPTY_RETRY_GRACE_MS) {
        break;
      }

      console.log(
        `[MINUTE] skip stale empty case=${state.caseId} minute=${new Date(
          state.currentMinute,
        ).toISOString()}`,
      );
      state.currentMinute += 60000;
      rounds += 1;
    }

    state.lastSuccessTs = Date.now();
    if (state.lastError) {
      console.log(`[MINUTE] recovered case=${state.caseId}`);
    }
    state.lastError = null;
    state.consecutiveErrors = 0;

    if (rounds === MAX_BACKFILL_PER_TICK && state.currentMinute < nowMinute) {
      console.log(
        `[MINUTE] backlog remains case=${state.caseId} next=${new Date(state.currentMinute).toISOString()}`,
      );
    }
  } catch (err) {
    const errorMsg = String(err?.message || err);
    const isNewError = errorMsg !== state.lastError;
    state.lastError = errorMsg;
    state.consecutiveErrors += 1;

    if (isIvyOfflineErrorMessage(errorMsg)) {
      const now = Date.now();
      if (isNewError || !state.lastOfflineLogTs || now - state.lastOfflineLogTs >= 60_000) {
        console.log(
          `[MINUTE] ivy offline case=${state.caseId} errors=${state.consecutiveErrors} error=${errorMsg}`,
        );
        state.lastOfflineLogTs = now;
      }
    } else {
      console.error(
        `[MINUTE] tick failed case=${state.caseId} errors=${state.consecutiveErrors} error=${errorMsg}`,
      );
    }
  } finally {
    state.running = false;
  }
}

async function writeBulkMinutes(caseId, fromTs, nowTs) {
  // Request up to MAX_BACKFILL_PER_TICK minutes in one go
  const toTs = fromTs + MAX_BACKFILL_PER_TICK * 60000;
  const url = `${IVY_BULK_URL}?from=${fromTs}&to=${toTs}&limit_minutes=${MAX_BACKFILL_PER_TICK}`;

  console.log(`[MINUTE] bulk fetch case=${caseId} from=${new Date(fromTs).toISOString()}`);
  
  let data;
  try {
    data = await fetchJsonWithTimeout(url, FETCH_TIMEOUT_MS * 2); // 2x timeout for bulk
  } catch (e) {
    throw new Error(`ivy bulk fetch failed: ${e.message}`);
  }

  const minuteKeys = Object.keys(data).map(Number).sort((a, b) => a - b);
  if (minuteKeys.length === 0) {
    return { minutesProcessed: 0, totalRows: 0 };
  }

  let totalRows = 0;
  const insert = db.prepare(
    `INSERT OR REPLACE INTO vital_minutes
      (case_id, ivy_source, ts_minute, payload, created_at)
     VALUES (?, ?, ?, ?, ?)`
  );

  const runInsert = db.transaction((minutesData) => {
    for (const [ts, rows] of Object.entries(minutesData)) {
      const minuteTs = Number(ts);
      const payload = {};
      for (const r of rows) {
        const key = toAidasParamKey(r.ivy_param);
        if (!key) continue;
        payload[key] = r.value;
      }
      if (Object.keys(payload).length === 0) continue;
      insert.run(caseId, "liveagent", minuteTs, JSON.stringify(payload), Date.now());
      totalRows += rows.length;
    }
  });

  runInsert(data);

  const lastProcessed = minuteKeys[minuteKeys.length - 1];
  console.log(`[MINUTE] bulk saved case=${caseId} minutes=${minuteKeys.length} total_rows=${totalRows}`);
  
  return {
    minutesProcessed: minuteKeys.length,
    totalRows,
    nextMinute: lastProcessed + 60000
  };
}

async function fetchJsonWithTimeout(url, timeoutMs) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`HTTP ${res.status} ${body.slice(0, 200)}`);
    }
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

async function writeMinute(caseId, minuteTs) {
  const from = minuteTs;
  const to = minuteTs + 60000;
  const url = `${IVY_URL}?from=${from}&to=${to}`;

  let rows;
  try {
    rows = await fetchJsonWithTimeout(url, FETCH_TIMEOUT_MS);
  } catch (e) {
    throw new Error(`ivy fetch failed: ${e.message}`);
  }

  if (!Array.isArray(rows)) {
    throw new Error("ivy response is not an array");
  }

  if (rows.length === 0) {
    return { written: false, rowCount: 0, empty: true };
  }

  const payload = {};
  for (const r of rows) {
    const key = toAidasParamKey(r.ivy_param);
    if (!key) continue;
    payload[key] = r.value;
  }
  if (Object.keys(payload).length === 0) {
    return { written: false, rowCount: rows.length, empty: true };
  }

  db.prepare(
    `INSERT OR REPLACE INTO vital_minutes
      (case_id, ivy_source, ts_minute, payload, created_at)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(
    caseId,
    "liveagent",
    minuteTs,
    JSON.stringify(payload),
    Date.now(),
  );

  console.log(`[MINUTE] saved case=${caseId} minute=${new Date(minuteTs).toISOString()} rows=${rows.length}`);
  return { written: true, rowCount: rows.length, empty: false };
}

function getMinuteWriterStatus() {
  return Array.from(writers.values()).map(state => ({
    caseId: state.caseId,
    currentMinute: state.currentMinute,
    running: state.running,
    startedAt: state.startedAt,
    lastTickTs: state.lastTickTs,
    lastSuccessTs: state.lastSuccessTs,
    lastError: state.lastError,
    consecutiveErrors: state.consecutiveErrors,
    lastFetchedRows: state.lastFetchedRows,
    lastWrittenMinute: state.lastWrittenMinute,
  }));
}

module.exports = {
  startMinuteWriter,
  stopMinuteWriter,
  rewindMinuteWriter,
  getMinuteWriterStatus,
};
