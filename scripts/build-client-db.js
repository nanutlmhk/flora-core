const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const Database = require(path.resolve(__dirname, "..", "backend", "node_modules", "better-sqlite3"));

function readArg(name, fallback = "") {
  const prefix = `--${name}=`;
  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith(prefix)) return arg.slice(prefix.length).trim();
  }
  return fallback;
}

const defaultSource = path.resolve(__dirname, "..", "deploy-artifacts", "flora.db");
const defaultOut = path.resolve(
  __dirname,
  "..",
  "deploy-artifacts",
  "client-release-1.2.1",
  "flora.db",
);

const sourcePath = path.resolve(readArg("source", defaultSource));
const outPath = path.resolve(readArg("out", defaultOut));
const outDir = path.dirname(outPath);

const PRESERVE_TABLES = new Set([
  "icd10_master",
  "icd9cm_master",
  "io_item_master",
  "staff_role",
]);

const DEFAULT_ADMIN = {
  username: "admin",
  password: "admin",
  name: "Administrator",
  role: "admin",
  authSource: "seed",
};

function createPasswordRecord(password) {
  const saltHex = crypto.randomBytes(16).toString("hex");
  const hashHex = crypto
    .scryptSync(String(password), Buffer.from(saltHex, "hex"), 64)
    .toString("hex");
  return { saltHex, hashHex };
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

    const resetTables = tables.filter((name) => !PRESERVE_TABLES.has(name));
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

    const now = Date.now();
    const passwordRecord = createPasswordRecord(DEFAULT_ADMIN.password);
    db.prepare(
      `INSERT INTO auth_user (
          username, hospital_id, auth_source, password_salt, password_hash, name, role, is_active, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)` ,
    ).run(
      DEFAULT_ADMIN.username,
      null,
      DEFAULT_ADMIN.authSource,
      passwordRecord.saltHex,
      passwordRecord.hashHex,
      DEFAULT_ADMIN.name,
      DEFAULT_ADMIN.role,
      now,
      now,
    );

    db.exec("VACUUM");

    const totalDeleted = Array.from(beforeCounts.values()).reduce((a, b) => a + b, 0);
    console.log(`[CLIENT-DB] source : ${sourcePath}`);
    console.log(`[CLIENT-DB] output : ${outPath}`);
    console.log(`[CLIENT-DB] tables reset (${resetTables.length})`);
    for (const table of resetTables) {
      console.log(`  - ${table}: ${beforeCounts.get(table) || 0} -> 0`);
    }
    console.log(`[CLIENT-DB] total rows removed: ${totalDeleted}`);
    console.log(
      `[CLIENT-DB] master tables preserved: ${Array.from(PRESERVE_TABLES).join(", ")}`,
    );
    console.log(
      `[CLIENT-DB] admin available: ${DEFAULT_ADMIN.username} / ${DEFAULT_ADMIN.password}`,
    );
  } finally {
    db.close();
  }
}

main().catch((err) => {
  console.error(`[CLIENT-DB] failed: ${err.message}`);
  process.exit(1);
});
