const path = require("path");
const fs = require("fs");
const Database = require(path.join(__dirname, "..", "backend", "node_modules", "better-sqlite3"));

const dbPath = String(
  process.env.FLORA_DB_PATH || path.resolve(__dirname, "..", "data", "flora.db"),
).trim();
const mode = String(process.argv[2] || "status").trim().toLowerCase();

if (!fs.existsSync(dbPath)) {
  console.error(`[FLORA-REPAIR] database not found: ${dbPath}`);
  process.exit(1);
}

const db = new Database(dbPath);

function listActiveCases() {
  const rows = db
    .prepare(
      `SELECT id, hn, status, start_time, discharge_time, archive_time, updated_at
       FROM cases
       WHERE status = 'active'
       ORDER BY start_time DESC, id DESC`,
    )
    .all();

  console.log(JSON.stringify({ dbPath, activeCases: rows }, null, 2));
}

function forceIdle() {
  const now = Date.now();
  const result = db
    .prepare(
      `UPDATE cases
       SET status = 'archived',
           discharge_time = COALESCE(discharge_time, ?),
           archive_time = COALESCE(archive_time, ?),
           updated_at = ?
       WHERE status = 'active'`,
    )
    .run(now, now, now);

  console.log(
    JSON.stringify(
      {
        dbPath,
        ok: true,
        action: "force-idle",
        archivedActiveCases: result.changes,
        repairedAt: now,
      },
      null,
      2,
    ),
  );
}

try {
  if (mode === "status") {
    listActiveCases();
  } else if (mode === "force-idle") {
    forceIdle();
  } else {
    console.error(`[FLORA-REPAIR] unsupported mode: ${mode}`);
    console.error("Usage: node scripts/repair-flora-db.js [status|force-idle]");
    process.exit(1);
  }
} finally {
  try {
    db.close();
  } catch {
    // ignore close failures
  }
}
