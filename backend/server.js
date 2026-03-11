const express = require("express");
const cors = require("cors");
const { db, DB_PATH, closeDb, pruneOldVitalMinutes } = require("./floradb");
const caseRoutes = require("./caseRoutes");
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

/* ------------------ HEALTH ------------------ */
app.get("/health", (req, res) => {
  res.json({ status: "OK" });
});

app.get("/debug/minute-writer", (req, res) => {
  res.json({
    server_ts: Date.now(),
    ivy_url: process.env.IVY_READ_URL || "http://127.0.0.1:3000/api/observations",
    poll_ms: Number(process.env.MINUTE_WRITER_POLL_MS) || 1000,
    fetch_timeout_ms: Number(process.env.MINUTE_WRITER_FETCH_TIMEOUT_MS) || 5000,
    max_backfill_per_tick: Number(process.env.MINUTE_WRITER_MAX_BACKFILL) || 5,
    empty_retry_grace_min: Number(process.env.MINUTE_WRITER_EMPTY_RETRY_GRACE_MIN) || 3,
    writers: getMinuteWriterStatus(),
  });
});

/* ------------------ ROUTES ------------------ */
app.use("/api/case", caseRoutes);

/* ------------------ BOOTSTRAP ACTIVE CASES ------------------ */
function bootstrapActiveCases() {
  const rows = db.prepare(`SELECT id FROM cases WHERE status = 'active'`).all();

  console.log(`[BOOT] active cases = ${rows.length}`);

  for (const r of rows) {
    startMinuteWriter(r.id);
  }
}

function reconcileActiveCaseWriters() {
  const rows = db.prepare(`SELECT id FROM cases WHERE status = 'active'`).all();
  for (const r of rows) {
    startMinuteWriter(r.id);
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
