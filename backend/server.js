const express = require("express");
const cors = require("cors");
const { db, DB_PATH } = require("./floradb");
const caseRoutes = require("./caseRoutes");
const { startMinuteWriter, getMinuteWriterStatus } = require("./minuteWriter");

const app = express();
app.use(cors());
app.use(express.json());

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

/* ------------------ START SERVER ------------------ */
const PORT = Number(process.env.PORT || 3001);
app.listen(PORT, () => {
  console.log(`Flora backend running on http://localhost:${PORT}`);
  console.log(`[BOOT] FLORA_DB_PATH=${DB_PATH}`);
  console.log(
    `[BOOT] IVY_READ_URL=${process.env.IVY_READ_URL || "http://127.0.0.1:3000/api/observations"}`,
  );
  bootstrapActiveCases();
});

