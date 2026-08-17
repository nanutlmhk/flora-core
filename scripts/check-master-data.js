const path = require("path");
const fs = require("fs");
const Database = require(path.resolve(__dirname, "..", "backend", "node_modules", "better-sqlite3"));

const dbPath = path.resolve(process.argv[2] || process.env.FLORA_DB_PATH || "C:\\porjai\\data\\flora.db");

if (!fs.existsSync(dbPath)) {
  console.error(`[MASTER-CHECK] database not found: ${dbPath}`);
  process.exit(1);
}

const REQUIRED_TABLES = [
  "icd10_master",
  "icd9cm_master",
  "io_item_master",
  "staff_role",
];

const db = new Database(dbPath, { readonly: true });

try {
  const results = [];
  let ok = true;

  for (const table of REQUIRED_TABLES) {
    try {
      const row = db.prepare(`SELECT COUNT(*) AS c FROM ${table}`).get();
      const count = Number(row?.c || 0);
      if (count <= 0) ok = false;
      results.push({ table, count, ok: count > 0 });
    } catch (err) {
      ok = false;
      results.push({ table, count: null, ok: false, error: err.message });
    }
  }

  console.log(JSON.stringify({ dbPath, ok, results }, null, 2));
  process.exit(ok ? 0 : 2);
} finally {
  try {
    db.close();
  } catch {
    // ignore close failures
  }
}
