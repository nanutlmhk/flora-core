const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");

function readArg(name, fallback = "") {
  const prefix = `--${name}=`;
  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith(prefix)) return arg.slice(prefix.length).trim();
  }
  return fallback;
}

const defaultSource = path.resolve(__dirname, "..", "..", "data", "flora.db");
const defaultOut = path.resolve(__dirname, "..", "..", "deploy-artifacts", "flora.master.db");

const sourcePath = path.resolve(readArg("source", defaultSource));
const outPath = path.resolve(readArg("out", defaultOut));
const outDir = path.dirname(outPath);

const PRESERVE_TABLES = new Set([
  "icd10_master",
  "staff_directory",
  "staff_role",
  "io_item_master",
]);

const RESET_NON_CASE_TABLES = new Set([
  "cases",
  "vital_minutes",
  "patient_snapshot",
  "case_detail",
  "his_patient_buffer",
  "his_allergy_buffer",
  "his_lab_buffer",
]);

function shouldResetTable(name) {
  return name.startsWith("case_") || RESET_NON_CASE_TABLES.has(name);
}

async function main() {
  if (!fs.existsSync(sourcePath)) {
    throw new Error(`Source DB not found: ${sourcePath}`);
  }

  fs.mkdirSync(outDir, { recursive: true });
  if (fs.existsSync(outPath)) fs.unlinkSync(outPath);

  const sourceDb = new Database(sourcePath, { readonly: true });
  try {
    await sourceDb.backup(outPath);
  } finally {
    sourceDb.close();
  }

  const db = new Database(outPath);
  try {
    const tables = db
      .prepare(
        `SELECT name
           FROM sqlite_master
          WHERE type = 'table'
            AND name NOT LIKE 'sqlite_%'
          ORDER BY name`,
      )
      .all()
      .map((row) => String(row.name));

    const resetTables = tables.filter((name) => !PRESERVE_TABLES.has(name) && shouldResetTable(name));

    const beforeCounts = new Map();
    for (const table of resetTables) {
      const row = db.prepare(`SELECT COUNT(*) AS c FROM ${table}`).get();
      beforeCounts.set(table, Number(row?.c || 0));
    }

    db.pragma("foreign_keys = OFF");
    const tx = db.transaction(() => {
      for (const table of resetTables) {
        db.prepare(`DELETE FROM ${table}`).run();
      }
      for (const table of resetTables) {
        db.prepare(`DELETE FROM sqlite_sequence WHERE name = ?`).run(table);
      }
    });
    tx();
    db.pragma("foreign_keys = ON");

    db.exec("VACUUM");

    const totalDeleted = Array.from(beforeCounts.values()).reduce((a, b) => a + b, 0);
    console.log(`[MASTER-DB] source : ${sourcePath}`);
    console.log(`[MASTER-DB] output : ${outPath}`);
    console.log(`[MASTER-DB] tables reset (${resetTables.length})`);
    for (const table of resetTables) {
      console.log(`  - ${table}: ${beforeCounts.get(table) || 0} -> 0`);
    }
    console.log(`[MASTER-DB] total rows removed: ${totalDeleted}`);
    console.log(
      `[MASTER-DB] master tables preserved: ${Array.from(PRESERVE_TABLES).join(", ")}`,
    );
  } finally {
    db.close();
  }
}

main().catch((err) => {
  console.error(`[MASTER-DB] failed: ${err.message}`);
  process.exit(1);
});
