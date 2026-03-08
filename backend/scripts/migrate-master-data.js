/* eslint-disable no-console */
const path = require("path");
const fs = require("fs");

function argValue(flag, fallback) {
  const idx = process.argv.indexOf(flag);
  if (idx >= 0 && idx + 1 < process.argv.length) {
    return process.argv[idx + 1];
  }
  return fallback;
}

function qIdent(name) {
  return `"${String(name).replace(/"/g, '""')}"`;
}

function normalizePath(p) {
  return path.resolve(p);
}

function ensureFileReadable(p, label) {
  if (!fs.existsSync(p)) {
    throw new Error(`${label} not found: ${p}`);
  }
}

const sourcePath = normalizePath(
  argValue("--from", path.resolve(__dirname, "..", "flora.db")),
);
const targetPath = normalizePath(
  argValue("--to", path.resolve(__dirname, "..", "..", "data", "flora.db")),
);

ensureFileReadable(sourcePath, "Source DB");
fs.mkdirSync(path.dirname(targetPath), { recursive: true });

// Ensure schema is initialized on target db with the standard app schema.
process.env.FLORA_DB_PATH = targetPath;
const { db } = require("../floradb");

const TABLES = [
  "staff_role",
  "staff_directory",
  "io_item_master",
  "icd10_master",
];

function tableCols(schemaName, tableName) {
  return db
    .prepare(`PRAGMA ${schemaName}.table_info(${qIdent(tableName)})`)
    .all()
    .map((r) => String(r.name));
}

function tableCount(schemaName, tableName) {
  return db.prepare(`SELECT COUNT(*) AS c FROM ${schemaName}.${qIdent(tableName)}`).get().c;
}

function migrateTable(tableName) {
  const srcCols = tableCols("src", tableName);
  const dstCols = tableCols("main", tableName);
  const common = dstCols.filter((c) => srcCols.includes(c));
  if (common.length === 0) {
    return { table: tableName, copied: 0, skipped: true, reason: "no common columns" };
  }

  const colsSql = common.map(qIdent).join(", ");
  const before = tableCount("main", tableName);
  db.exec(
    `INSERT OR REPLACE INTO main.${qIdent(tableName)} (${colsSql})
     SELECT ${colsSql}
     FROM src.${qIdent(tableName)}`,
  );
  const after = tableCount("main", tableName);
  return { table: tableName, copied: Math.max(0, after - before), skipped: false };
}

try {
  const attachPath = sourcePath.replace(/'/g, "''");
  db.exec(`ATTACH DATABASE '${attachPath}' AS src`);
  db.exec("PRAGMA foreign_keys = OFF");

  const results = [];
  for (const t of TABLES) {
    results.push(migrateTable(t));
  }

  db.exec("DETACH DATABASE src");
  db.exec("PRAGMA foreign_keys = ON");

  console.log(`[MIGRATE] source=${sourcePath}`);
  console.log(`[MIGRATE] target=${targetPath}`);
  for (const r of results) {
    if (r.skipped) {
      console.log(`[MIGRATE] ${r.table}: skipped (${r.reason})`);
    } else {
      console.log(`[MIGRATE] ${r.table}: ok`);
    }
  }
  console.log("[MIGRATE] done");
  process.exit(0);
} catch (err) {
  console.error("[MIGRATE] failed:", err.message);
  process.exit(1);
}

