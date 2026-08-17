const path = require("path");
const { spawn } = require("child_process");
const Database = require("better-sqlite3");

async function sleep(ms) {
  await new Promise(resolve => setTimeout(resolve, ms));
}

async function waitForHealth(url, timeoutMs) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok) return true;
    } catch {
      // retry
    }
    await sleep(500);
  }
  return false;
}

async function main() {
  const repoRoot = path.resolve(__dirname, "..", "..");
  const srcDb = path.join(repoRoot, "data", "flora.db");
  const tmpDb = path.join(repoRoot, "data", "flora.api-test.db");
  const port = 3101;
  const base = `http://127.0.0.1:${port}/api/case`;

  try {
    const sourceDb = new Database(srcDb, { readonly: true });
    await sourceDb.backup(tmpDb);
    sourceDb.close();
  } catch (err) {
    throw new Error(`failed to prepare temp db: ${err instanceof Error ? err.message : String(err)}`);
  }

  const db = new Database(tmpDb);
  const now = Date.now();
  const caseInfo = db
    .prepare(
      `INSERT INTO cases (case_code, hn, start_time, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run("API-TEST", "HN-API-TEST", now, "active", now, now);
  const caseId = Number(caseInfo.lastInsertRowid);
  db.close();

  const server = spawn(process.execPath, [path.join(repoRoot, "backend", "server.js")], {
    cwd: repoRoot,
    env: {
      ...process.env,
      FLORA_DB_PATH: tmpDb,
      PORT: String(port),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  try {
    const healthy = await waitForHealth(`http://127.0.0.1:${port}/health`, 15000);
    if (!healthy) {
      throw new Error("temp server did not start");
    }

    const actor = { username: "codex", name: "Codex", role: "dev" };
    const eventTs = Math.floor(Date.now() / 60000) * 60000;

    const runCreateRes = await fetch(`${base}/${caseId}/io/runs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        item_id: 7,
        kind: "med",
        started_at: eventTs,
        route: "IV",
        entry_mode: "bolus",
        reason: "api test create run",
        actor,
      }),
    });
    const runCreate = await runCreateRes.json();
    if (!runCreateRes.ok) throw new Error(`run create failed: ${JSON.stringify(runCreate)}`);
    const runId = Number(runCreate.row.id);

    const runUpdateRes = await fetch(`${base}/${caseId}/io/runs/${runId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        route: "ET",
        note: "updated by api test",
        reason: "api test update run",
        actor,
      }),
    });
    const runUpdate = await runUpdateRes.json();
    if (!runUpdateRes.ok) throw new Error(`run update failed: ${JSON.stringify(runUpdate)}`);

    const eventCreateRes = await fetch(`${base}/${caseId}/io/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        item_id: 7,
        kind: "med",
        event_ts: eventTs,
        dose_value: 50,
        dose_unit: "mg",
        note: "api test event",
        reason: "api test create event",
        actor,
      }),
    });
    const eventCreate = await eventCreateRes.json();
    if (!eventCreateRes.ok) throw new Error(`event create failed: ${JSON.stringify(eventCreate)}`);
    const eventId = Number(eventCreate.row.id);

    const eventDeleteRes = await fetch(`${base}/${caseId}/io/events/${eventId}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        actor,
        reason: "api test delete event",
      }),
    });
    const eventDelete = await eventDeleteRes.json();
    if (!eventDeleteRes.ok) throw new Error(`event delete failed: ${JSON.stringify(eventDelete)}`);

    const runDiscontinueRes = await fetch(`${base}/${caseId}/io/runs/${runId}/discontinue`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        stopped_at: eventTs + 60000,
        actor,
        reason: "api test discontinue",
      }),
    });
    const runDiscontinue = await runDiscontinueRes.json();
    if (!runDiscontinueRes.ok) {
      throw new Error(`run discontinue failed: ${JSON.stringify(runDiscontinue)}`);
    }

    const verifyDb = new Database(tmpDb, { readonly: true });
    const runRow = verifyDb
      .prepare(
        `SELECT id, route, note, include_in_balance, started_at, stopped_at
         FROM case_io_run
         WHERE id = ?`
      )
      .get(runId);
    const eventRow = verifyDb
      .prepare(
        `SELECT id, dose_value, dose_unit, include_in_balance
         FROM case_io_event
         WHERE id = ?`
      )
      .get(eventId);
    const auditRows = verifyDb
      .prepare(
        `SELECT entity_type, action, actor_username, reason
         FROM case_io_audit
         WHERE case_id = ?
         ORDER BY id`
      )
      .all(caseId);
    verifyDb.close();

    console.log(
      JSON.stringify(
        {
          caseId,
          runId,
          eventId,
          runUpdate: runUpdate.row,
          eventDelete,
          runDiscontinue,
          verify: {
            runRow,
            eventRow,
            auditRows,
          },
        },
        null,
        2,
      ),
    );
  } finally {
    server.kill("SIGTERM");
    await sleep(1000);
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
