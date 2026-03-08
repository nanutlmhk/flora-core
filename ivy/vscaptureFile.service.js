const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const db = require("./db");
const { lookupAlias, normalizeRaw } = require("./aliasLookup");
const { auditUnknown } = require("./unknownAudit");

const ENABLED = String(process.env.IVY_VSCAPTURE_FILE_ENABLED || "0") === "1";
const FILE_PATH = String(
  process.env.IVY_VSCAPTURE_FILE_PATH || path.join(__dirname, "DataExportVSC.json")
).trim();
const POLL_MS = Math.max(1000, Number(process.env.IVY_VSCAPTURE_FILE_POLL_MS || 4000));
const DEVICE_ID = String(process.env.IVY_VSCAPTURE_DEVICE_ID || "VSCAPTURE_GE750").trim();
const SOURCE = "vscapture";
const PROTOCOL = String(process.env.IVY_VSCAPTURE_PROTOCOL || "vscapture_json").trim();

const state = {
  enabled: ENABLED,
  running: false,
  file_path: FILE_PATH,
  poll_ms: POLL_MS,
  device_id: DEVICE_ID,
  protocol: PROTOCOL,
  last_poll_ts: null,
  last_file_mtime_ms: null,
  last_file_size: null,
  last_batch_hash: null,
  last_batch_count: 0,
  last_ingest_ts: null,
  total_ingested: 0,
  last_error: null,
};

let pollTimer = null;
let tickLock = false;
let stableCandidate = null;

function toMillis(tsRaw) {
  if (!tsRaw) return null;
  const t = Date.parse(String(tsRaw).trim());
  if (!Number.isFinite(t)) return null;
  return t;
}

function parseNumericMaybe(valueRaw) {
  if (valueRaw == null) return null;
  const raw = String(valueRaw).trim();
  if (!raw) return null;
  if (/^-?\d+(\.\d+)?$/.test(raw)) {
    const n = Number(raw);
    if (Number.isFinite(n)) return n;
  }
  return raw;
}

function extractUnitFromPhysioId(physioId) {
  const src = String(physioId || "");
  const match = src.match(/:\s*\{[^}]*\}\s*(.+)$/);
  if (!match || !match[1]) return null;
  const cleaned = String(match[1]).replace(/\s+/g, " ").trim();
  return cleaned || null;
}

function hashBatch(rows) {
  const text = JSON.stringify(
    (rows || []).map((r) => ({
      t: r?.Timestamp ?? null,
      p: r?.PhysioID ?? null,
      v: r?.Value ?? null,
    }))
  );
  return crypto.createHash("sha1").update(text).digest("hex");
}

function extractLatestCompleteArray(text) {
  const lines = String(text || "")
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);

  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i];
    if (!line.startsWith("[") || !line.endsWith("]")) continue;
    try {
      const parsed = JSON.parse(line);
      if (Array.isArray(parsed)) return parsed;
    } catch {
      // keep scanning older lines
    }
  }

  return null;
}

function dbRun(sql, params) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, (err) => {
      if (err) reject(err);
      else resolve(true);
    });
  });
}

async function ingestRows(rows) {
  let ingested = 0;
  for (const row of rows) {
    const rawCode = String(row?.PhysioID || "").trim();
    if (!rawCode) continue;

    const alias = await lookupAlias(PROTOCOL, rawCode);
    const normalizedRaw = normalizeRaw(rawCode);

    const ivyParam = alias?.ivy_param || `unknown::${normalizedRaw}`;
    if (!alias) auditUnknown(PROTOCOL, normalizedRaw);

    const parsedUnit = extractUnitFromPhysioId(rawCode);
    const finalUnit = alias?.unit || parsedUnit || null;

    const deviceTs = toMillis(row?.Timestamp);
    const value = parseNumericMaybe(row?.Value);
    const now = Date.now();

    await dbRun(
      `
      INSERT INTO ivy_observations
      (device_id, source, protocol, ivy_param, raw_code, value, unit, device_ts, system_ts, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        DEVICE_ID,
        SOURCE,
        PROTOCOL,
        ivyParam,
        rawCode,
        value,
        finalUnit,
        deviceTs,
        now,
        now,
      ]
    );

    ingested += 1;
  }

  return ingested;
}

async function processStableFile(statInfo) {
  const fileText = fs.readFileSync(FILE_PATH, "utf8");
  const rows = extractLatestCompleteArray(fileText);
  if (!rows || !Array.isArray(rows) || rows.length === 0) {
    state.last_error = "no_complete_json_array";
    return;
  }

  const batchHash = hashBatch(rows);
  if (batchHash === state.last_batch_hash) return;

  const ingested = await ingestRows(rows);
  state.last_batch_hash = batchHash;
  state.last_batch_count = rows.length;
  state.total_ingested += ingested;
  state.last_ingest_ts = Date.now();
  state.last_error = null;

  state.last_file_mtime_ms = statInfo.mtimeMs;
  state.last_file_size = statInfo.size;
}

async function tick() {
  if (!state.running || tickLock) return;
  tickLock = true;
  state.last_poll_ts = Date.now();

  try {
    const st = fs.statSync(FILE_PATH);

    const currentSig = `${st.size}|${st.mtimeMs}`;
    const previousSig = state.last_file_size != null && state.last_file_mtime_ms != null
      ? `${state.last_file_size}|${state.last_file_mtime_ms}`
      : null;

    if (previousSig && currentSig === previousSig) {
      stableCandidate = null;
      return;
    }

    if (!stableCandidate || stableCandidate.sig !== currentSig) {
      stableCandidate = {
        sig: currentSig,
        firstSeenTs: Date.now(),
      };
      return;
    }

    if (Date.now() - stableCandidate.firstSeenTs < Math.min(POLL_MS, 1200)) {
      return;
    }

    await processStableFile(st);
    stableCandidate = null;
  } catch (err) {
    state.last_error = err.message;
  } finally {
    tickLock = false;
  }
}

function startVSCaptureFileService() {
  if (state.running) return;
  if (!state.enabled) {
    console.log("[VSCAPTURE] service disabled (set IVY_VSCAPTURE_FILE_ENABLED=1 to enable)");
    return;
  }

  state.running = true;
  console.log(`[VSCAPTURE] watcher started: ${FILE_PATH} (poll ${POLL_MS}ms)`);

  void tick();
  pollTimer = setInterval(() => {
    void tick();
  }, POLL_MS);
}

function stopVSCaptureFileService() {
  state.running = false;
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

function requestVSCaptureReconnect() {
  stopVSCaptureFileService();
  stableCandidate = null;
  tickLock = false;
  if (state.enabled) startVSCaptureFileService();
  return getVSCaptureStatus();
}

function getVSCaptureStatus() {
  return { ...state };
}

startVSCaptureFileService();

module.exports = {
  startVSCaptureFileService,
  stopVSCaptureFileService,
  requestVSCaptureReconnect,
  getVSCaptureStatus,
};
