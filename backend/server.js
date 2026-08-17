const express = require("express");
const cors = require("cors");
const { db, DB_PATH, closeDb, pruneOldVitalMinutes } = require("./floradb");
const caseRoutes = require("./caseRoutes");
const authRoutes = require("./authRoutes");
const ephisRoutes = require("./ephisRoutes");
const {
  startMinuteWriter,
  stopMinuteWriter,
  getMinuteWriterStatus,
} = require("./minuteWriter");

const app = express();
app.use(cors());
app.use(express.json());

let reconcileTimer = null;
let server = null;
let shuttingDown = false;
const WRITER_STALL_RESTART_MS = Math.max(
  30_000,
  Number(process.env.MINUTE_WRITER_STALL_RESTART_MS) || 45_000,
);

/* ------------------ HEALTH ------------------ */
app.get("/health", (req, res) => {
  res.json({ status: "OK" });
});

app.get("/debug/minute-writer", (req, res) => {
  res.json({
    server_ts: Date.now(),
    ivy_urls: [
      process.env.IVY_READ_URL || "http://localhost:3000/api/observations",
      "http://127.0.0.1:3000/api/observations",
    ].filter((value, index, array) => array.indexOf(value) === index),
    poll_ms: Number(process.env.MINUTE_WRITER_POLL_MS) || 1000,
    fetch_timeout_ms: Number(process.env.MINUTE_WRITER_FETCH_TIMEOUT_MS) || 5000,
    max_per_tick: Number(process.env.MINUTE_WRITER_MAX_BACKFILL) || 60,
    bulk_threshold_min: (Number(process.env.MINUTE_WRITER_BULK_THRESHOLD_MS) || 5 * 60000) / 60000,
    writers: getMinuteWriterStatus(),
  });
});

// Real-time flow debug: minuteWriter state + last 3 vital_minutes rows for each active case
// Open http://localhost:3001/debug/flow and press F5
app.get("/debug/flow", (req, res) => {
  const writers = getMinuteWriterStatus();
  const now = Date.now();

  const caseIds = writers.map(w => w.caseId);
  const rows = [];

  for (const caseId of caseIds) {
    const recent = db.prepare(
      `SELECT ts_minute, payload FROM vital_minutes
       WHERE case_id = ?
       ORDER BY ts_minute DESC LIMIT 3`
    ).all(caseId);

    rows.push({
      caseId,
      recentMinutes: recent.map(r => {
        let payload = {};
        try { payload = JSON.parse(r.payload); } catch {}
        return {
          ts_minute: r.ts_minute,
          minute_ago: Math.round((now - r.ts_minute) / 60000),
          params: Object.keys(payload),
          sample: payload,
        };
      }),
    });
  }

  res.json({
    server_ts: now,
    writers: writers.map(w => ({
      caseId: w.caseId,
      currentMinute: w.currentMinute,
      minutesBehind: Math.round((now - w.currentMinute) / 60000),
      lastFetchedRows: w.lastFetchedRows,
      lastWrittenMinute: w.lastWrittenMinute,
      lastError: w.lastError,
      consecutiveErrors: w.consecutiveErrors,
    })),
    vitalMinutes: rows,
  });
});

/* ------------------ ROUTES ------------------ */
app.use("/api/auth", authRoutes);
app.use("/api/case", caseRoutes);
app.use("/api/ephis", ephisRoutes);

/* ------------------ BOOTSTRAP ACTIVE CASES ------------------ */
function bootstrapActiveCases() {
  const rows = db.prepare(`SELECT id FROM cases WHERE status = 'active'`).all();

  console.log(`[BOOT] active cases = ${rows.length}`);

  for (const r of rows) {
    try {
      startMinuteWriter(r.id);
    } catch (err) {
      console.error(
        `[BOOT] failed to start minute writer for case=${r.id}: ${err?.message || err}`,
      );
    }
  }
}

function reconcileActiveCaseWriters() {
  const rows = db.prepare(`SELECT id FROM cases WHERE status = 'active'`).all();
  const activeCaseIds = new Set(rows.map(r => Number(r.id)).filter(Number.isFinite));
  const writerStatuses = getMinuteWriterStatus();
  const writerCaseIds = writerStatuses
    .map(row => Number(row.caseId))
    .filter(Number.isFinite);
  const writerStatusByCaseId = new Map(
    writerStatuses
      .map(row => [Number(row.caseId), row])
      .filter(([caseId]) => Number.isFinite(caseId)),
  );
  const now = Date.now();

  for (const caseId of writerCaseIds) {
    if (activeCaseIds.has(caseId)) continue;
    try {
      stopMinuteWriter(caseId);
      console.log(`[BOOT] reconcile stopped stale minute writer for case=${caseId}`);
    } catch (err) {
      console.error(
        `[BOOT] failed to stop stale minute writer for case=${caseId}: ${err?.message || err}`,
      );
    }
  }

  for (const r of rows) {
    const caseId = Number(r.id);
    const existingWriter = writerStatusByCaseId.get(caseId);
    const lastTickTs = Number(existingWriter?.lastTickTs);
    const lastActivityTs = Number.isFinite(lastTickTs)
      ? lastTickTs
      : Number(existingWriter?.startedAt);
    const writerLooksStalled =
      existingWriter != null &&
      Number.isFinite(lastActivityTs) &&
      now - lastActivityTs > WRITER_STALL_RESTART_MS;

    if (writerLooksStalled) {
      try {
        stopMinuteWriter(caseId);
        console.warn(
          `[BOOT] reconcile restarting stalled minute writer for case=${caseId} idle_ms=${now - lastActivityTs}`,
        );
      } catch (err) {
        console.error(
          `[BOOT] failed to stop stalled minute writer for case=${caseId}: ${err?.message || err}`,
        );
      }
    }

    try {
      startMinuteWriter(caseId);
    } catch (err) {
      console.error(
        `[BOOT] reconcile failed for case=${caseId}: ${err?.message || err}`,
      );
    }
  }
}

/* ------------------ START SERVER ------------------ */
const PORT = Number(process.env.PORT || 3001);
server = app.listen(PORT, () => {
  console.log(`Flora backend running on http://localhost:${PORT}`);
  console.log(`[BOOT] FLORA_DB_PATH=${DB_PATH}`);
  console.log(
    `[BOOT] IVY_READ_URL=${process.env.IVY_READ_URL || "http://127.0.0.1:3000/api/observations"}`,
  );
  bootstrapActiveCases();
  if (reconcileTimer) clearInterval(reconcileTimer);
  reconcileTimer = setInterval(reconcileActiveCaseWriters, 15000);
});

function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[BOOT] shutdown requested (${signal})`);

  if (reconcileTimer) {
    clearInterval(reconcileTimer);
    reconcileTimer = null;
  }

  try {
    const rows = db.prepare(`SELECT id FROM cases WHERE status = 'active'`).all();
    for (const row of rows) {
      stopMinuteWriter(row.id);
    }
  } catch {
    // ignore shutdown query failures
  }

  const finish = () => {
    closeDb();
    process.exit(0);
  };

  if (!server) {
    finish();
    return;
  }

  server.close(() => {
    finish();
  });

  setTimeout(() => {
    finish();
  }, 3000).unref();
}

["SIGINT", "SIGTERM", "SIGHUP"].forEach(signal => {
  process.on(signal, () => shutdown(signal));
});

// ── Vital-minutes pruning schedule ────────────────────────────────────────────
// Run once 10 s after boot (so DB init and case bootstrap finish first),
// then every 24 h. Controlled by FLORA_RETENTION_DAYS (default 360, 0 = off).
setTimeout(() => {
  pruneOldVitalMinutes();
}, 10_000).unref();

setInterval(() => {
  if (!shuttingDown) pruneOldVitalMinutes();
}, 24 * 60 * 60 * 1000).unref();
