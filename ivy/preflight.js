const path = require("path");
const { SerialPort } = require("serialport");
const CFG = require("./ge750/config");
const db = require("./db");

async function listSerialPorts() {
  try {
    const ports = await SerialPort.list();
    return ports || [];
  } catch (err) {
    console.error("[PREFLIGHT] serial list error:", err.message);
    return [];
  }
}

function dbGet(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
}

async function main() {
  console.log("[PREFLIGHT] Ivy check started");
  console.log("[PREFLIGHT] cwd:", process.cwd());
  console.log("[PREFLIGHT] db:", path.join(__dirname, "ivy.db"));
  console.log("");

  console.log("[PREFLIGHT] GE750 serial config");
  console.log(`  port=${CFG.PORT}`);
  console.log(`  baud=${CFG.BAUD_RATE}`);
  console.log(`  dataBits=${CFG.DATA_BITS}`);
  console.log(`  stopBits=${CFG.STOP_BITS}`);
  console.log(`  parity=${CFG.PARITY}`);
  console.log(`  pollMs=${CFG.POLL_MS}`);
  console.log("");

  const ports = await listSerialPorts();
  const names = ports.map((p) => p.path);

  console.log("[PREFLIGHT] serial ports detected:", names.length);
  for (const p of ports) {
    const meta = [p.path, p.manufacturer, p.friendlyName].filter(Boolean).join(" | ");
    console.log(`  - ${meta}`);
  }
  if (!names.includes(CFG.PORT)) {
    console.warn(`[PREFLIGHT] WARNING: configured GE750 port ${CFG.PORT} not detected`);
  } else {
    console.log(`[PREFLIGHT] OK: configured GE750 port ${CFG.PORT} detected`);
  }
  console.log("");

  try {
    const obs = await dbGet(`SELECT COUNT(*) AS c FROM ivy_observations`);
    const allAliases = await dbGet(`SELECT COUNT(*) AS c FROM parameter_aliases`);
    const hl7Aliases = await dbGet(
      `SELECT COUNT(*) AS c FROM parameter_aliases WHERE protocol = 'hl7'`
    );
    const wildcardAliases = await dbGet(
      `SELECT COUNT(*) AS c FROM parameter_aliases WHERE protocol = '*'`
    );

    console.log("[PREFLIGHT] DB");
    console.log(`  observations=${Number(obs?.c) || 0}`);
    console.log(`  aliases_total=${Number(allAliases?.c) || 0}`);
    console.log(`  aliases_hl7=${Number(hl7Aliases?.c) || 0}`);
    console.log(`  aliases_wildcard=${Number(wildcardAliases?.c) || 0}`);
  } catch (err) {
    console.error("[PREFLIGHT] DB check failed:", err.message);
  }

  console.log("");
  console.log(
    `[PREFLIGHT] HL7 listener target port: ${Number(
      process.env.IVY_HL7_PORT || process.env.HL7_PORT || 6000
    )}`
  );
  console.log("[PREFLIGHT] done");
  process.exit(0);
}

main();

