// server.js (CommonJS)

const express = require("express");
const cors = require("cors");

// ================================
// START BACKGROUND DEVICE SERVICES
// ================================

function loadOptionalService(modulePath, label) {
  try {
    const svc = require(modulePath);
    console.log(`[IVY] service enabled: ${label}`);
    return svc;
  } catch (err) {
    const isMissingSelf =
      err &&
      err.code === "MODULE_NOT_FOUND" &&
      typeof err.message === "string" &&
      err.message.includes(`'${modulePath}'`);

    if (isMissingSelf) {
      console.warn(`[IVY] service skipped: ${label} (${modulePath} missing)`);
      return null;
    }

    console.error(`[IVY] service failed: ${label}`, err);
    return null;
  }
}

// GE Carestation 750 (ASCII over serial)
const ge750Service = loadOptionalService("./ge750/ge750.service", "GE Carestation 750");

// GE Patient Monitor (HL7 over TCP)
const gehl7Service = loadOptionalService("./gehl7", "GE Patient Monitor HL7");
// GE750 fallback from VSCapture JSON file
const vscaptureFileService = loadOptionalService(
  "./vscaptureFile.service",
  "VSCapture JSON Fallback",
);

// ================================
// IVY API SERVER
// ================================

const db = require("./db");
const { lookupAlias } = require("./aliasLookup");
const { auditUnknown } = require("./unknownAudit");

const app = express();
app.use(cors());
app.use(express.json());
let httpServer = null;
let shuttingDown = false;

// Simple request logger
app.use((req, res, next) => {
  const start = Date.now();
  res.on("finish", () => {
    const duration = Date.now() - start;
    // Skip logging for high-frequency polling endpoints to keep console clean
    const quietPaths = [
      "/health", 
      "/api/observations", 
      "/api/devices/status",
      "/api/admin/services"
    ];
    if (!quietPaths.includes(req.path)) {
      console.log(`[IVY] ${req.method} ${req.path} ${res.statusCode} (${duration}ms)`);
    }
  });
  next();
});

const SERVER_STARTED_AT = Date.now();
const ALLOW_REMOTE_ADMIN = String(process.env.IVY_ALLOW_REMOTE_ADMIN || "0") === "1";

function classifyLogicalDevice(row) {
  const raw = String(row?.raw_code || "").toUpperCase().trim();
  const ivyParam = String(row?.ivy_param || "").toLowerCase().trim();
  const source = String(row?.source || "").toLowerCase().trim();
  const protocol = String(row?.protocol || "").toLowerCase().trim();
  const deviceId = String(row?.device_id || "").toUpperCase().trim();

  if (
    protocol === "ge750_serial" ||
    source === "ge750" ||
    deviceId.includes("GE750")
  ) {
    return "anesthesia_machine";
  }

  if (protocol === "hl7" || source === "hl7") {
    return "patient_monitor";
  }

  // Patient monitor signals.
  if (
    raw === "HR" ||
    raw === "PR" ||
    raw === "SPO2" ||
    raw === "RR" ||
    raw === "ETCO2" ||
    raw.startsWith("NIBP ") ||
    raw.startsWith("ART ") ||
    raw === "CVP" ||
    ivyParam === "hr" ||
    ivyParam === "pr" ||
    ivyParam === "spo2" ||
    ivyParam === "rr" ||
    ivyParam === "etco2" ||
    ivyParam === "nibp_sys" ||
    ivyParam === "nibp_map" ||
    ivyParam === "nibp_dia" ||
    ivyParam === "art_sys" ||
    ivyParam === "art_map" ||
    ivyParam === "art_dia" ||
    ivyParam === "cvp"
  ) {
    return "patient_monitor";
  }

  // Anesthesia machine signals.
  if (
    raw === "VENTILATION MODE" ||
    raw.startsWith("SET ") ||
    raw.startsWith("MEASURED ") ||
    raw.includes("ANESTHETIC") ||
    raw === "FIO2" ||
    raw === "FIAA" ||
    raw === "ETAA" ||
    raw === "MAC" ||
    raw.endsWith(" FLOW") ||
    raw.endsWith(" FLOW RATE") ||
    raw.includes("PPEAK") ||
    raw.includes("PPLAT") ||
    raw.includes("PMEAN") ||
    raw.includes("PMIN") ||
    raw.includes("TIDAL VOLUME") ||
    raw.includes("MINUTE VOLUME") ||
    ivyParam.startsWith("set_") ||
    ivyParam === "vent_mode" ||
    ivyParam === "fio2" ||
    ivyParam === "fioa2" ||
    ivyParam === "fiam" ||
    ivyParam === "fiaa" ||
    ivyParam === "etaa" ||
    ivyParam === "mac" ||
    ivyParam === "tv_exp" ||
    ivyParam === "mv_exp" ||
    ivyParam === "ppeak" ||
    ivyParam === "pplat" ||
    ivyParam === "pmean" ||
    ivyParam === "pmin" ||
    ivyParam === "o2_flow" ||
    ivyParam === "n2o_flow" ||
    ivyParam === "air_flow" ||
    ivyParam === "sevo_flow"
  ) {
    return "anesthesia_machine";
  }

  return null;
}

/* =========================
   Health
========================= */
app.get("/health", (req, res) => {
  res.json({ status: "OK" });
});

function isLocalAdminRequest(req) {
  const remote = String(req.socket?.remoteAddress || "");
  return (
    remote === "127.0.0.1" ||
    remote === "::1" ||
    remote === "::ffff:127.0.0.1"
  );
}

function enforceAdminScope(req, res, next) {
  if (ALLOW_REMOTE_ADMIN || isLocalAdminRequest(req)) {
    next();
    return;
  }
  res.status(403).json({ error: "admin endpoints are localhost-only" });
}

app.get("/api/admin/services", enforceAdminScope, (req, res) => {
  const ge750 =
    ge750Service && typeof ge750Service.getGE750Status === "function"
      ? ge750Service.getGE750Status()
      : null;
  const hl7 =
    gehl7Service && typeof gehl7Service.getGEHL7Status === "function"
      ? gehl7Service.getGEHL7Status()
      : null;
  const vscapture =
    vscaptureFileService && typeof vscaptureFileService.getVSCaptureStatus === "function"
      ? vscaptureFileService.getVSCaptureStatus()
      : null;

  res.json({
    server_ts: Date.now(),
    ge750,
    hl7,
    vscapture,
  });
});

app.post("/api/admin/reconnect", enforceAdminScope, async (req, res) => {
  const target = String(req.body?.target || "all").toLowerCase();
  const ge750Port = req.body?.ge750_port ?? req.body?.port;
  const result = {
    target,
    actions: [],
    errors: [],
    server_ts: Date.now(),
  };

  if ((target === "all" || target === "ge750") && ge750Service) {
    if (typeof ge750Service.requestGE750Reconnect === "function") {
      try {
        const status = ge750Service.requestGE750Reconnect({ ge750_port: ge750Port });
        result.actions.push({ service: "ge750", ok: true, status });
      } catch (err) {
        result.errors.push({ service: "ge750", error: err.message });
      }
    }
  }

  if ((target === "all" || target === "hl7") && gehl7Service) {
    if (typeof gehl7Service.restartGEHL7Server === "function") {
      try {
        const status = await gehl7Service.restartGEHL7Server();
        result.actions.push({ service: "hl7", ok: true, status });
      } catch (err) {
        result.errors.push({ service: "hl7", error: err.message });
      }
    }
  }

  if ((target === "all" || target === "vscapture") && vscaptureFileService) {
    if (typeof vscaptureFileService.requestVSCaptureReconnect === "function") {
      try {
        const status = vscaptureFileService.requestVSCaptureReconnect();
        result.actions.push({ service: "vscapture", ok: true, status });
      } catch (err) {
        result.errors.push({ service: "vscapture", error: err.message });
      }
    }
  }

  const hasErrors = result.errors.length > 0;
  res.status(hasErrors ? 500 : 200).json(result);
});

/* =========================
   MOCK DEVICE INGEST
========================= */
app.post("/mock/device", async (req, res) => {
  try {
    const {
      deviceId,
      raw_code,
      value,
      unit,
      device_ts
    } = req.body;

    const source = "liveagent";
    // Allow caller to specify the real protocol so alias lookup works against
    // the actual ge750_serial / hl7 alias tables instead of the empty "mock" table.
    const protocol = String(req.body.protocol || "mock");
    const now = Date.now();

    const rawKey = String(raw_code).trim().toUpperCase();
    const alias = await lookupAlias(protocol, rawKey);

    let ivy_param;
    let finalUnit = unit || null;

    if (alias) {
      ivy_param = alias.ivy_param;
      finalUnit = alias.unit || finalUnit;
    } else {
      ivy_param = `unknown::${rawKey}`;
      auditUnknown(protocol, rawKey);
    }

    db.run(
      `
      INSERT INTO ivy_observations
        (
          device_id,
          source,
          protocol,
          ivy_param,
          raw_code,
          value,
          unit,
          device_ts,
          system_ts,
          created_at
        )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        deviceId || null,
        source,
        protocol,
        ivy_param,
        raw_code,
        value,
        finalUnit,
        device_ts || null,
        now,
        now
      ],
      (err) => {
        if (err) {
          console.error("[IVY] insert error:", err.message);
          return res.status(500).json({ ok: false });
        }
        res.json({ ok: true });
      }
    );
  } catch (e) {
    console.error("[IVY] ingest crash:", e);
    res.status(500).json({ ok: false });
  }
});

/* =========================
   DEBUG
========================= */
app.get("/debug/unknown", (req, res) => {
  db.all(
    `SELECT * FROM unknown_params ORDER BY seen_count DESC`,
    (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json(rows);
    }
  );
});

app.get("/debug/observations", (req, res) => {
  db.all(
    `
    SELECT
      device_id,
      source,
      protocol,
      ivy_param,
      raw_code,
      value,
      unit,
      device_ts,
      system_ts,
      created_at
    FROM ivy_observations
    ORDER BY created_at DESC
    LIMIT 50
    `,
    (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json(rows);
    }
  );
});

/* =========================
   READ: OBSERVATIONS (BULK)
========================= */
app.get("/api/observations/bulk", (req, res) => {
  const { from, to, limit_minutes } = req.query;

  if (!from || !to) {
    return res.status(400).json({ error: "from and to required" });
  }

  const fromTs = Number(from);
  const toTs = Number(to);
  const maxMinutes = Number(limit_minutes) || 60;

  // Use a subquery or rounding to group by minute.
  // We want to return an object/array where each entry is a minute's worth of data.
  // Note: system_ts / 60000 * 60000 gives the floor minute.
  db.all(
    `
    SELECT
      (system_ts / 60000) * 60000 AS minute_ts,
      ivy_param,
      value,
      unit,
      system_ts
    FROM ivy_observations
    WHERE system_ts BETWEEN ? AND ?
    ORDER BY system_ts ASC
    `,
    [fromTs, toTs],
    (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });

      // Group rows by minute_ts
      const groups = {};
      let minuteCount = 0;
      
      for (const row of rows) {
        const m = row.minute_ts;
        if (!groups[m]) {
          if (minuteCount >= maxMinutes) break;
          groups[m] = [];
          minuteCount++;
        }
        groups[m].push({
          ivy_param: row.ivy_param,
          value: row.value,
          unit: row.unit,
          system_ts: row.system_ts
        });
      }

      res.json(groups);
    }
  );
});

/* =========================
   READ: OBSERVATIONS
========================= */
app.get("/api/observations", (req, res) => {
  const { from, to } = req.query;

  if (!from || !to) {
    return res.status(400).json({ error: "from and to required" });
  }

  db.all(
    `
    SELECT
      ivy_param,
      value,
      unit,
      device_ts,
      system_ts
    FROM ivy_observations
    WHERE system_ts BETWEEN ? AND ?
    ORDER BY system_ts ASC
    `,
    [Number(from), Number(to)],
    (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json(rows);
    }
  );
});

/* =========================
   DEVICE STATUS
========================= */
app.get("/api/devices/status", (req, res) => {
  const now = Date.now();
  const onlineWindowSec = Number(req.query.online_window_sec);
  const windowSec =
    Number.isFinite(onlineWindowSec) && onlineWindowSec > 0
      ? Math.min(300, Math.max(5, Math.floor(onlineWindowSec)))
      : 30;
  const windowMs = windowSec * 1000;
  const windowStartTs = now - windowMs;

  db.get(
    `
    SELECT
      COUNT(*) AS total_observations,
      MAX(system_ts) AS last_observation_ts
    FROM ivy_observations
    `,
    (metaErr, metaRow) => {
      if (metaErr) return res.status(500).json({ error: metaErr.message });

      db.all(
        `
        SELECT
          COALESCE(device_id, '(unknown)') AS device_key,
          MAX(device_id) AS device_id,
          MAX(source) AS source,
          MAX(protocol) AS protocol,
          MAX(system_ts) AS last_seen_ts,
          COUNT(*) AS total_samples,
          SUM(CASE WHEN system_ts >= ? THEN 1 ELSE 0 END) AS samples_in_window
        FROM ivy_observations
        GROUP BY COALESCE(device_id, '(unknown)')
        ORDER BY last_seen_ts DESC
        `,
        [windowStartTs],
        (groupErr, groupedRows) => {
          if (groupErr) return res.status(500).json({ error: groupErr.message });

          db.all(
            `
            SELECT
              t.device_key,
              o.raw_code,
              o.ivy_param,
              o.value,
              o.unit,
              o.system_ts
            FROM (
              SELECT
                COALESCE(device_id, '(unknown)') AS device_key,
                MAX(system_ts) AS last_seen_ts
              FROM ivy_observations
              GROUP BY COALESCE(device_id, '(unknown)')
            ) t
            JOIN ivy_observations o
              ON COALESCE(o.device_id, '(unknown)') = t.device_key
             AND o.system_ts = t.last_seen_ts
            ORDER BY o.system_ts DESC
            `,
            (latestErr, latestRows) => {
              if (latestErr) return res.status(500).json({ error: latestErr.message });

              const latestByDevice = new Map();
              for (const row of latestRows || []) {
                if (!latestByDevice.has(row.device_key)) {
                  latestByDevice.set(row.device_key, row);
                }
              }

              const devices = (groupedRows || []).map(row => {
                const lastSeenTs = Number(row.last_seen_ts) || 0;
                const secondsSinceLast =
                  lastSeenTs > 0 ? Math.max(0, Math.floor((now - lastSeenTs) / 1000)) : null;
                const isOnline = Boolean(lastSeenTs > 0 && now - lastSeenTs <= windowMs);
                const latest = latestByDevice.get(row.device_key);
                return {
                  device_id: row.device_id || null,
                  device_key: row.device_key,
                  source: row.source || null,
                  protocol: row.protocol || null,
                  is_online: isOnline,
                  status: isOnline ? "online" : "offline",
                  last_seen_ts: lastSeenTs || null,
                  seconds_since_last: secondsSinceLast,
                  total_samples: Number(row.total_samples) || 0,
                  samples_in_window: Number(row.samples_in_window) || 0,
                  latest_observation: latest
                    ? {
                        raw_code: latest.raw_code || null,
                        ivy_param: latest.ivy_param || null,
                        value: latest.value ?? null,
                        unit: latest.unit || null,
                        system_ts: Number(latest.system_ts) || null,
                      }
                    : null,
                };
              });

              const onlineDevices = devices.filter(d => d.is_online);
              const liveagentDevices = devices.filter(
                d => String(d.source || "").toLowerCase() === "liveagent",
              );
              const liveagentLastSeenTs = liveagentDevices.reduce((max, d) => {
                const ts = Number(d.last_seen_ts) || 0;
                return ts > max ? ts : max;
              }, 0);

              // Build logical_devices from data already fetched in Queries 2 & 3.
              // No extra DB query needed — groupedRows has source/protocol for
              // classification and latestByDevice has the latest observation detail.
              const logicalMap = {
                patient_monitor: {
                  id: "patient_monitor",
                  label: "Patient Monitor",
                  last_seen_ts: null,
                  total_samples: 0,
                  samples_in_window: 0,
                  latest_observation: null,
                  device_ids: new Set(),
                },
                anesthesia_machine: {
                  id: "anesthesia_machine",
                  label: "Anesthesia Machine",
                  last_seen_ts: null,
                  total_samples: 0,
                  samples_in_window: 0,
                  latest_observation: null,
                  device_ids: new Set(),
                },
              };

              for (const row of groupedRows || []) {
                // Prefer the latest row (has raw_code/ivy_param for fallback patterns)
                const latest = latestByDevice.get(row.device_key);
                const category = classifyLogicalDevice(latest || row);
                if (!category) continue;
                const bucket = logicalMap[category];
                if (!bucket) continue;

                const rowTs = Number(row.last_seen_ts) || 0;
                bucket.total_samples  += Number(row.total_samples) || 0;
                bucket.samples_in_window += Number(row.samples_in_window) || 0;
                if (row.device_id) bucket.device_ids.add(String(row.device_id));

                if (!bucket.last_seen_ts || rowTs > bucket.last_seen_ts) {
                  bucket.last_seen_ts = rowTs;
                  bucket.latest_observation = latest
                    ? {
                        raw_code:   latest.raw_code   || null,
                        ivy_param:  latest.ivy_param  || null,
                        value:      latest.value      ?? null,
                        unit:       latest.unit       || null,
                        source:     row.source        || null,
                        protocol:   row.protocol      || null,
                        system_ts:  rowTs             || null,
                        device_id:  row.device_id     || null,
                      }
                    : null;
                }
              }

              const logicalDevices = Object.values(logicalMap).map(item => {
                const lastSeenTs = Number(item.last_seen_ts) || 0;
                const isOnline = Boolean(lastSeenTs > 0 && now - lastSeenTs <= windowMs);
                return {
                  id: item.id,
                  label: item.label,
                  is_online: isOnline,
                  status: isOnline ? "online" : "offline",
                  last_seen_ts: lastSeenTs || null,
                  seconds_since_last:
                    lastSeenTs > 0 ? Math.max(0, Math.floor((now - lastSeenTs) / 1000)) : null,
                  total_samples: item.total_samples,
                  samples_in_window: item.samples_in_window,
                  device_count: item.device_ids.size,
                  device_ids: Array.from(item.device_ids.values()),
                  latest_observation: item.latest_observation,
                };
              });

              res.json({
                server_ts: now,
                server_uptime_sec: Math.floor((now - SERVER_STARTED_AT) / 1000),
                online_window_sec: windowSec,
                summary: {
                  total_observations: Number(metaRow?.total_observations) || 0,
                  last_observation_ts: Number(metaRow?.last_observation_ts) || null,
                  total_devices: devices.length,
                  online_devices: onlineDevices.length,
                },
                liveagent: {
                  online: liveagentDevices.some(d => d.is_online),
                  device_count: liveagentDevices.length,
                  last_seen_ts: liveagentLastSeenTs || null,
                },
                logical_devices: logicalDevices,
                devices,
              });
            },
          );
        },
      );
    },
  );
});

/* =========================
   START HTTP SERVER
========================= */
const PORT = process.env.PORT || 3000;

httpServer = app.listen(PORT, () => {
  console.log("==========================================");
  console.log(`🚀 Ivy Server started on http://localhost:${PORT}`);
  console.log(`📅 Started at: ${new Date(SERVER_STARTED_AT).toLocaleString()}`);
  console.log("------------------------------------------");
  
  if (ge750Service) {
    const configuredPort = String(process.env.GE750_PORT || process.env.GE750_COM_PORT || "").trim();
    if (configuredPort) {
      console.log(`📡 GE750 Service: ACTIVE (Configured port: ${configuredPort})`);
    } else {
      console.log("📡 GE750 Service: ACTIVE (Auto-detect port)");
    }
  } else {
    console.log("📡 GE750 Service: UNAVAILABLE (module load failed)");
  }

  if (gehl7Service) {
    const hl7Port = Number(process.env.IVY_HL7_PORT || process.env.HL7_PORT || 6000);
    console.log(`📟 HL7 Monitor Listener: ACTIVE (Port: ${hl7Port})`);
  } else {
    console.log("📟 HL7 Monitor Listener: UNAVAILABLE (module load failed)");
  }

  console.log("==========================================");
});

// ── Observation pruning schedule ──────────────────────────────────────────────
// Run once on startup (after a short delay so DB init finishes), then every 24 h.
// Controlled by IVY_RETENTION_DAYS env var (default 90, 0 = disabled).
setTimeout(() => {
  if (typeof db.pruneOldObservations === "function") {
    db.pruneOldObservations();
  }
}, 10_000).unref(); // 10 s after boot — let services settle first

setInterval(() => {
  if (!shuttingDown && typeof db.pruneOldObservations === "function") {
    db.pruneOldObservations();
  }
}, 24 * 60 * 60 * 1000).unref(); // every 24 h

function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[IVY] shutdown requested (${signal})`);

  try {
    if (ge750Service && typeof ge750Service.stopGE750Manager === "function") {
      ge750Service.stopGE750Manager();
    }
  } catch {
    // ignore stop errors on shutdown
  }

  try {
    if (gehl7Service && typeof gehl7Service.stopGEHL7Server === "function") {
      void gehl7Service.stopGEHL7Server();
    }
  } catch {
    // ignore stop errors on shutdown
  }

  try {
    if (
      vscaptureFileService &&
      typeof vscaptureFileService.stopVSCaptureFileService === "function"
    ) {
      vscaptureFileService.stopVSCaptureFileService();
    }
  } catch {
    // ignore stop errors on shutdown
  }

  let finishCalled = false;
  const finish = () => {
    if (finishCalled) return;   // guard against double-close from timeout race
    finishCalled = true;
    if (typeof db.closeDatabase === "function") {
      db.closeDatabase(() => process.exit(0));
      return;
    }
    process.exit(0);
  };

  if (!httpServer) {
    finish();
    return;
  }

  httpServer.close(() => {
    finish();
  });

  // Hard-kill safety net — 8 s to give WAL checkpoint time to complete.
  // Uses the same finishCalled guard so db.closeDatabase is never called twice.
  setTimeout(() => {
    console.warn("[IVY] shutdown timeout — forcing exit");
    finish();
  }, 8000).unref();
}

["SIGINT", "SIGTERM", "SIGHUP"].forEach(signal => {
  process.on(signal, () => shutdown(signal));
});

// ── Crash / force-kill hardening ──────────────────────────────────────────────

// Catch any unhandled exception (bad serial frame, HL7 parse error, etc.) and
// attempt a clean WAL checkpoint before dying instead of crashing dirty.
process.on("uncaughtException", (err) => {
  console.error("[IVY] uncaughtException — attempting clean shutdown:", err);
  shutdown("uncaughtException");
});

// Log unhandled promise rejections without crashing (Node default is to crash
// since v15). Non-fatal: the reject could be a transient serial/DB timeout.
process.on("unhandledRejection", (reason) => {
  console.error("[IVY] unhandledRejection (non-fatal):", reason);
});

// Last-resort: fires synchronously even on SIGKILL / force-close from Electron.
// sqlite3 close is async so we can't checkpoint here, but we log so we know.
process.on("exit", (code) => {
  console.log(`[IVY] process exit (code=${code})`);
});
