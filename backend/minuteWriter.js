const { db, recordCaseDeviceIngestAudit } = require("./floradb");
const { toFloraParamKey } = require("../shared/floraParamMap");

// ─── Configuration ────────────────────────────────────────────────────────────

const IVY_URLS = Array.from(
  new Set(
    [
      process.env.IVY_READ_URL || "",
      "http://localhost:6789/api/observations",
      "http://127.0.0.1:6789/api/observations",
    ]
      .map((v) => String(v || "").trim())
      .filter(Boolean),
  ),
);

const IVY_BULK_URLS = Array.from(
  new Set(
    [
      process.env.IVY_BULK_READ_URL || "",
      "http://localhost:6789/api/observations/bulk",
      "http://127.0.0.1:6789/api/observations/bulk",
    ]
      .map((v) => String(v || "").trim())
      .filter(Boolean),
  ),
);

const POLL_INTERVAL_MS   = Math.max(500,  Number(process.env.MINUTE_WRITER_POLL_MS)            || 1000);
const FETCH_TIMEOUT_MS   = Math.max(1000, Number(process.env.MINUTE_WRITER_FETCH_TIMEOUT_MS)   || 5000);
const MAX_PER_TICK       = Math.max(1,    Number(process.env.MINUTE_WRITER_MAX_BACKFILL)        || 60);
// Bulk catchup fires when the writer is this many ms behind (default 5 minutes)
const BULK_THRESHOLD_MS  = Math.max(60000, Number(process.env.MINUTE_WRITER_BULK_THRESHOLD_MS) || 5 * 60000);

const MMHG_PER_KPA = 7.50062;
const DEFAULT_ATMOSPHERIC_PRESSURE_MMHG = 760;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function floorMinute(ts) {
  return Math.floor(ts / 60000) * 60000;
}

function pad2(v) {
  return String(v).padStart(2, "0");
}

function formatUtcOffset(date) {
  const off = -date.getTimezoneOffset();
  const sign = off >= 0 ? "+" : "-";
  const abs  = Math.abs(off);
  return `${sign}${pad2(Math.floor(abs / 60))}:${pad2(abs % 60)}`;
}

function formatLogTs(ts) {
  const d = new Date(Number(ts));
  if (!Number.isFinite(d.getTime())) return String(ts);
  return (
    `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ` +
    `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())} ` +
    `${formatUtcOffset(d)} [${d.toISOString()}]`
  );
}

// Normalise a raw Hidro observation row into { key, value, priority }.
// Returns null if the param is not recognised.
// For CO2 params, a higher priority value means a more trustworthy unit:
//   3 = mmHg (best), 2 = kPa (converted), 1 = % (converted from volume fraction)
function normalizeTimelineObservation(row) {
  const key = toFloraParamKey(row?.ivy_param);
  if (!key) return null;

  let value   = row?.value;
  let priority = 0;

  if (
    (key === "et_co2" || key === "fi_co2") &&
    typeof value === "number" &&
    Number.isFinite(value)
  ) {
    const unit = String(row?.unit || "").trim().toLowerCase();
    if (unit === "mmhg") {
      priority = 3;
    } else if (unit === "kpa") {
      value    = Number((value * MMHG_PER_KPA).toFixed(1));
      priority = 2;
    } else if (unit === "%") {
      value    = Number(((value * DEFAULT_ATMOSPHERIC_PRESSURE_MMHG) / 100).toFixed(1));
      priority = 1;
    }
  }

  return { key, value, priority };
}

// Select best observation for each key within a set of rows.
// On equal priority, the first observation wins (stable, not arbitrary).
function buildPayload(rows) {
  const selected = new Map();
  for (const r of rows) {
    const norm = normalizeTimelineObservation(r);
    if (!norm) continue;
    const existing = selected.get(norm.key);
    if (!existing || norm.priority > existing.priority) {
      selected.set(norm.key, norm);
    }
  }
  const payload = {};
  for (const [k, v] of selected) payload[k] = v.value;
  return payload;
}

function safeRecordIngestAudit(payload) {
  try {
    recordCaseDeviceIngestAudit(payload);
  } catch (err) {
    console.warn(`[MINUTE] ingest audit skipped: ${String(err?.message || err)}`);
  }
}

// ─── Writer state map ─────────────────────────────────────────────────────────
// key: caseId → writer state

const writers = new Map();

// ─── Fetch helpers ────────────────────────────────────────────────────────────

async function fetchJsonWithTimeout(url, timeoutMs) {
  const ctrl = new AbortController();
  const t    = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`HTTP ${res.status} ${body.slice(0, 200)}`);
    }
    return await res.json();
  } catch (err) {
    if (err?.name === "AbortError") throw new Error(`timeout after ${timeoutMs}ms`);
    throw err;
  } finally {
    clearTimeout(t);
  }
}

async function fetchJsonFromCandidates(urls, buildUrl, timeoutMs) {
  const triedUrls = [];
  let lastError   = null;

  for (const baseUrl of urls) {
    const url = buildUrl(baseUrl);
    triedUrls.push(url);
    try {
      const data = await fetchJsonWithTimeout(url, timeoutMs);
      return { data, url, triedUrls };
    } catch (err) {
      lastError = err;
    }
  }

  if (lastError) {
    lastError.triedUrls = triedUrls;
    throw lastError;
  }
  const err     = new Error("no ivy urls configured");
  err.triedUrls = triedUrls;
  throw err;
}

// ─── Core write functions ─────────────────────────────────────────────────────

// Fetch observations for one complete minute and write to vital_minutes.
// Returns { written, rowCount, empty }.
// Throws on network / HTTP error — caller must handle.
async function writeMinute(caseId, hn, minuteTs) {
  const from = minuteTs;
  const to   = minuteTs + 60000;

  let rows;
  let usedUrl    = "";
  let triedUrls  = [];

  try {
    const result = await fetchJsonFromCandidates(
      IVY_URLS,
      (base) => `${base}?from=${from}&to=${to}`,
      FETCH_TIMEOUT_MS,
    );
    rows      = result.data;
    usedUrl   = result.url;
    triedUrls = result.triedUrls;
  } catch (e) {
    safeRecordIngestAudit({
      caseId, hn,
      sourceService: "ivy", sourceEndpoint: IVY_URLS[0],
      fetchMode: "minute", minuteTs, fromTs: from, toTs: to,
      status: "failed",
      detail: { triedUrls: e?.triedUrls || triedUrls, message: String(e?.message || e) },
    });
    throw new Error(`ivy fetch failed: ${e.message}`);
  }

  if (!Array.isArray(rows)) {
    safeRecordIngestAudit({
      caseId, hn,
      sourceService: "ivy", sourceEndpoint: usedUrl,
      fetchMode: "minute", minuteTs, fromTs: from, toTs: to,
      status: "failed",
      detail: { triedUrls, message: "response is not an array" },
    });
    throw new Error("ivy response is not an array");
  }

  if (rows.length === 0) {
    safeRecordIngestAudit({
      caseId, hn,
      sourceService: "ivy", sourceEndpoint: usedUrl,
      fetchMode: "minute", minuteTs, fromTs: from, toTs: to,
      status: "empty",
      detail: { triedUrls },
    });
    return { written: false, rowCount: 0, empty: true };
  }

  const payload = buildPayload(rows);

  if (Object.keys(payload).length === 0) {
    safeRecordIngestAudit({
      caseId, hn,
      sourceService: "ivy", sourceEndpoint: usedUrl,
      fetchMode: "minute", minuteTs, fromTs: from, toTs: to,
      rawRowCount: rows.length, writtenRowCount: 0,
      status: "empty",
      detail: { triedUrls, reason: "no_supported_observations" },
    });
    return { written: false, rowCount: rows.length, empty: true };
  }

  db.prepare(
    `INSERT OR REPLACE INTO vital_minutes (case_id, ivy_source, ts_minute, payload, created_at)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(caseId, "liveagent", minuteTs, JSON.stringify(payload), Date.now());

  safeRecordIngestAudit({
    caseId, hn,
    sourceService: "ivy", sourceEndpoint: usedUrl,
    fetchMode: "minute", minuteTs, fromTs: from, toTs: to,
    rawRowCount: rows.length, writtenRowCount: Object.keys(payload).length,
    status: "ok",
    detail: { triedUrls, paramKeys: Object.keys(payload).sort() },
  });

  console.log(
    `[MINUTE] saved case=${caseId} minute=${formatLogTs(minuteTs)} rows=${rows.length}`,
  );
  return { written: true, rowCount: rows.length, empty: false };
}

// Fetch multiple minutes at once via the bulk endpoint and write them all.
// Returns { minutesProcessed, nextMinute }.
// Throws on network / HTTP error — caller must handle.
async function writeBulkMinutes(caseId, hn, fromTs, nowTs) {
  const rangeMinutes = Math.ceil((nowTs - fromTs) / 60000) + 1;
  const toTs = fromTs + rangeMinutes * 60000;

  console.log(`[MINUTE] bulk fetch case=${caseId} from=${formatLogTs(fromTs)} range=${rangeMinutes}min`);

  let data;
  let usedUrl   = "";
  let triedUrls = [];

  try {
    const result = await fetchJsonFromCandidates(
      IVY_BULK_URLS,
      (base) => `${base}?from=${fromTs}&to=${toTs}&limit_minutes=${rangeMinutes}`,
      FETCH_TIMEOUT_MS * 2,
    );
    data      = result.data;
    usedUrl   = result.url;
    triedUrls = result.triedUrls;
  } catch (e) {
    safeRecordIngestAudit({
      caseId, hn,
      sourceService: "ivy", sourceEndpoint: IVY_BULK_URLS[0],
      fetchMode: "bulk", fromTs, toTs,
      status: "failed",
      detail: { triedUrls: e?.triedUrls || triedUrls, message: String(e?.message || e) },
    });
    throw new Error(`ivy bulk fetch failed: ${e.message}`);
  }

  const minuteKeys = Object.keys(data).map(Number).sort((a, b) => a - b);

  if (minuteKeys.length === 0) {
    safeRecordIngestAudit({
      caseId, hn,
      sourceService: "ivy", sourceEndpoint: usedUrl,
      fetchMode: "bulk", fromTs, toTs,
      status: "empty",
      detail: { triedUrls, minutesRequested: rangeMinutes },
    });
    return { minutesProcessed: 0, nextMinute: fromTs };
  }

  let totalRows    = 0;
  let writtenRows  = 0;
  let writtenMinutes = 0;

  const insert = db.prepare(
    `INSERT OR REPLACE INTO vital_minutes (case_id, ivy_source, ts_minute, payload, created_at)
     VALUES (?, ?, ?, ?, ?)`,
  );

  db.transaction((minutesData) => {
    for (const [ts, rows] of Object.entries(minutesData)) {
      const minuteTs = Number(ts);
      totalRows += Array.isArray(rows) ? rows.length : 0;
      const payload = buildPayload(Array.isArray(rows) ? rows : []);
      if (Object.keys(payload).length === 0) continue;
      insert.run(caseId, "liveagent", minuteTs, JSON.stringify(payload), Date.now());
      writtenRows   += Object.keys(payload).length;
      writtenMinutes += 1;
    }
  })(data);

  const lastProcessed = minuteKeys[minuteKeys.length - 1];

  safeRecordIngestAudit({
    caseId, hn,
    sourceService: "ivy", sourceEndpoint: usedUrl,
    fetchMode: "bulk", fromTs, toTs,
    rawRowCount: totalRows, writtenRowCount: writtenRows,
    status: writtenMinutes > 0 ? "ok" : "empty",
    detail: { triedUrls, fetchedMinutes: minuteKeys.length, writtenMinutes },
  });

  console.log(
    `[MINUTE] bulk saved case=${caseId} minutes=${minuteKeys.length} total_rows=${totalRows}`,
  );

  return {
    minutesProcessed: minuteKeys.length,
    nextMinute: lastProcessed + 60000,
  };
}

// ─── Tick ─────────────────────────────────────────────────────────────────────

async function tickWriter(state) {
  if (state.running) return;

  // Honour backoff from previous errors
  if (Date.now() < Number(state.ivyRetryAfterTs || 0)) return;

  state.running    = true;
  state.lastTickTs = Date.now();

  try {
    const nowMinute = floorMinute(Date.now());

    // ── 1. One-time bulk catch-up when far behind ──────────────────────────
    // This fires once per writer lifetime (or after a rewind).
    // Set the flag BEFORE the attempt so any outcome — success, empty, or
    // network failure — counts as "done". This prevents an infinite bulk
    // retry loop when Hidro keeps returning empty for a stale time range.
    if (!state.didInitialBulk && nowMinute - state.currentMinute > BULK_THRESHOLD_MS) {
      state.didInitialBulk = true;
      try {
        const bulk = await writeBulkMinutes(
          state.caseId, state.hn, state.currentMinute, nowMinute,
        );
        if (bulk.minutesProcessed > 0) {
          state.currentMinute  = bulk.nextMinute;
          state.lastWrittenMinute = bulk.nextMinute - 60000;
          // Fall through to single-minute loop to cover any remaining gap
        }
        // bulk was empty — fall through to single-minute mode below
      } catch (bulkErr) {
        // Network or HTTP error — propagate so the outer catch sets backoff.
        // didInitialBulk is already true so we won't retry bulk next tick.
        throw bulkErr;
      }
    }

    // ── 2. Single-minute loop ──────────────────────────────────────────────
    // Process every completed minute (currentMinute < nowMinute).
    // A "completed" minute ended at least POLL_INTERVAL_MS ago, so Hidro
    // has had time to store any observations for it.
    //
    // Rules:
    //   • written  → advance (data captured)
    //   • empty    → advance (Hidro is reachable; that minute had no data)
    //   • throws   → propagate to outer catch (Hidro is unreachable; backoff)
    //
    // There is NO grace-period stall. A completed minute is either written
    // or skipped immediately — the writer never retries an empty past minute.
    // Real-time tolerance comes from the tick interval itself: the current
    // in-progress minute is excluded by the `< nowMinute` condition, so it
    // is only attempted after the clock advances to the next minute.
    let rounds = 0;
    while (state.currentMinute < nowMinute && rounds < MAX_PER_TICK) {
      const result = await writeMinute(state.caseId, state.hn, state.currentMinute);

      if (result.written) {
        state.lastWrittenMinute = state.currentMinute;
      }

      state.currentMinute += 60000;
      rounds++;
    }

    if (rounds === MAX_PER_TICK && state.currentMinute < nowMinute) {
      console.log(
        `[MINUTE] backlog remains case=${state.caseId} next=${formatLogTs(state.currentMinute)}`,
      );
    }

    // Success — clear error state
    state.lastError        = null;
    state.consecutiveErrors = 0;
    state.ivyRetryAfterTs  = 0;

  } catch (err) {
    const msg   = String(err?.message || err);
    const isNew = msg !== state.lastError;
    state.lastError         = msg;
    state.consecutiveErrors += 1;

    const retryMs         = Math.min(60_000, state.consecutiveErrors * 2_000);
    state.ivyRetryAfterTs = Date.now() + retryMs;

    const now = Date.now();
    if (isNew || !state.lastOfflineLogTs || now - state.lastOfflineLogTs >= 60_000) {
      console.warn(
        `[MINUTE] ivy error case=${state.caseId} errors=${state.consecutiveErrors}` +
        ` retry_in=${retryMs}ms msg=${msg}`,
      );
      state.lastOfflineLogTs = now;
    }
  } finally {
    state.running = false;
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

function startMinuteWriter(caseId) {
  if (writers.has(caseId)) return;

  const row = db
    .prepare(
      `SELECT start_time, device_capture_start_time, hn
       FROM cases
       WHERE id = ? AND status = 'active'`,
    )
    .get(caseId);
  if (!row) {
    console.error("[MINUTE] case not active", caseId);
    return;
  }

  const last = db
    .prepare(`SELECT MAX(ts_minute) AS last FROM vital_minutes WHERE case_id = ?`)
    .get(caseId);

  const captureStartTs = Number.isFinite(Number(row.device_capture_start_time))
    ? Number(row.device_capture_start_time)
    : Number(row.start_time);

  const state = {
    caseId,
    hn: String(row.hn || "").trim() || null,
    currentMinute:   last.last ? last.last + 60000 : floorMinute(captureStartTs),
    running:         false,
    timer:           null,
    startedAt:       Date.now(),
    lastTickTs:      null,
    lastWrittenMinute: null,
    lastError:       null,
    consecutiveErrors: 0,
    ivyRetryAfterTs: 0,
    lastOfflineLogTs: 0,
    didInitialBulk:  false,
  };

  console.log(`[MINUTE] start case=${caseId} at ${formatLogTs(state.currentMinute)}`);

  state.timer = setInterval(() => void tickWriter(state), POLL_INTERVAL_MS);
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

  if (!Number.isFinite(state.currentMinute) || targetMinute !== state.currentMinute) {
    state.currentMinute    = targetMinute;
    state.didInitialBulk   = false; // allow bulk re-evaluation after rewind
    state.ivyRetryAfterTs  = 0;
    state.consecutiveErrors = 0;
    state.lastWrittenMinute = null;
    console.log(`[MINUTE] rewind case=${caseId} to ${formatLogTs(targetMinute)}`);
  }

  if (!state.running) void tickWriter(state);
  return true;
}

function getMinuteWriterStatus() {
  return Array.from(writers.values()).map((s) => ({
    caseId:           s.caseId,
    currentMinute:    s.currentMinute,
    running:          s.running,
    startedAt:        s.startedAt,
    lastTickTs:       s.lastTickTs,
    lastWrittenMinute: s.lastWrittenMinute,
    lastError:        s.lastError,
    consecutiveErrors: s.consecutiveErrors,
    ivyRetryAfterTs:  s.ivyRetryAfterTs,
  }));
}

module.exports = {
  startMinuteWriter,
  stopMinuteWriter,
  rewindMinuteWriter,
  getMinuteWriterStatus,
};
