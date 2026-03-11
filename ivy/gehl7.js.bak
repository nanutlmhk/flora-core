const net = require("net");
const { execFile } = require("child_process");
const { parseHL7 } = require("./hl7Parser");
const { handleOBX } = require("./obxMapper");

const PORT = Number(process.env.IVY_HL7_PORT || process.env.HL7_PORT || 6000);
const HOST = String(process.env.IVY_HL7_HOST || process.env.HL7_HOST || "0.0.0.0").trim();
const DEVICE_ID = process.env.IVY_HL7_DEVICE_ID || "ge-monitor-or1";
const MONITOR_IP = String(
  process.env.IVY_MONITOR_IP || process.env.GE_B105_IP || process.env.HL7_MONITOR_IP || ""
).trim();
const PING_INTERVAL_MS = Number(process.env.IVY_MONITOR_PING_MS || 10000);
const LOG_RAW_HL7 = String(process.env.IVY_HL7_LOG_RAW || "1") === "1";
const LOG_RAW_HL7_MAX_CHARS = Math.max(
  500,
  Number(process.env.IVY_HL7_LOG_MAX_CHARS || 20000),
);

const START_BLOCK = "\x0b";
const END_BLOCK = "\x1c\r";

let server = null;
let connectedCount = 0;
let lastMessageTs = null;
let lastError = null;
let startedAt = null;
let pingTimer = null;

const pingState = {
  enabled: Boolean(MONITOR_IP),
  monitor_ip: MONITOR_IP || null,
  online: null,
  last_probe_ts: null,
  rtt_ms: null,
  error: null,
};

function formatRawHl7ForLog(raw) {
  const message = String(raw || "").replace(/\r/g, "\n").trim();
  if (message.length <= LOG_RAW_HL7_MAX_CHARS) return message;
  return `${message.slice(0, LOG_RAW_HL7_MAX_CHARS)}\n... [truncated ${message.length - LOG_RAW_HL7_MAX_CHARS} chars]`;
}

function logRawHl7Message(raw, remoteAddress) {
  if (!LOG_RAW_HL7) return;
  const formatted = formatRawHl7ForLog(raw);
  const lineCount = formatted ? formatted.split("\n").length : 0;
  console.log(
    `[HL7] RAW message from ${remoteAddress || "unknown"} (${lineCount} lines)\n` +
      "----- HL7 START -----\n" +
      `${formatted}\n` +
      "----- HL7 END -----",
  );
}

function buildAck(controlId, accepted) {
  const ts = new Date().toISOString();
  const msaCode = accepted ? "AA" : "AE";
  const safeControlId = controlId || "1";

  return (
    `MSH|^~\\&|IVY|AIDAS|GE|OR1|${ts}||ACK|${safeControlId}|P|2.3\r` +
    `MSA|${msaCode}|${safeControlId}\r`
  );
}

function parsePingRtt(text) {
  const output = String(text || "");
  const direct = output.match(/time[=<]\s*(\d+)\s*ms/i);
  if (direct && direct[1]) return Number(direct[1]);
  const avg = output.match(/Average\s*=\s*(\d+)\s*ms/i);
  if (avg && avg[1]) return Number(avg[1]);
  return null;
}

function runPingOnce() {
  return new Promise((resolve) => {
    if (!MONITOR_IP) {
      resolve({ ok: null, rttMs: null, error: "monitor_ip_not_configured" });
      return;
    }

    const args =
      process.platform === "win32"
        ? ["-n", "1", "-w", "800", MONITOR_IP]
        : ["-c", "1", "-W", "1", MONITOR_IP];

    execFile("ping", args, { windowsHide: true, timeout: 1500 }, (err, stdout, stderr) => {
      const out = String(stdout || "");
      const errText = String(stderr || "");
      const joined = `${out}\n${errText}`;
      const rttMs = parsePingRtt(joined);

      if (err) {
        resolve({
          ok: false,
          rttMs,
          error: err.message || "ping_failed",
        });
        return;
      }

      resolve({ ok: true, rttMs, error: null });
    });
  });
}

async function refreshPingState() {
  const result = await runPingOnce();
  pingState.last_probe_ts = Date.now();
  pingState.online = result.ok;
  pingState.rtt_ms = result.rttMs;
  pingState.error = result.error;
}

function startPingLoop() {
  if (!MONITOR_IP || pingTimer) return;
  void refreshPingState();
  pingTimer = setInterval(() => {
    void refreshPingState();
  }, Math.max(2000, PING_INTERVAL_MS));
}

function stopPingLoop() {
  if (!pingTimer) return;
  clearInterval(pingTimer);
  pingTimer = null;
}

function startGEHL7Server() {
  if (server) return server;

  console.log(`[HL7] GE Patient Monitor listener starting on ${HOST}:${PORT}`);

  server = net.createServer((socket) => {
    connectedCount += 1;
    console.log(
      `[HL7] monitor connected: remote=${socket.remoteAddress}:${socket.remotePort} local=${socket.localAddress}:${socket.localPort}`,
    );

    let buffer = "";

    socket.on("data", (data) => {
      buffer += data.toString("ascii");

      while (true) {
        const start = buffer.indexOf(START_BLOCK);
        const end = buffer.indexOf(END_BLOCK);
        if (start === -1 || end === -1 || end < start) break;

        const raw = buffer.slice(start + 1, end);
        buffer = buffer.slice(end + END_BLOCK.length);

        let controlId = "1";

        try {
          lastMessageTs = Date.now();
          logRawHl7Message(raw, socket.remoteAddress);
          const parsed = parseHL7(raw);
          controlId = parsed?.msh?.controlId || "1";

          for (const obx of parsed.obx || []) {
            try {
              handleOBX(obx, DEVICE_ID);
            } catch (err) {
              console.error("[HL7] OBX handler error:", err.message);
            }
          }

          socket.write(START_BLOCK + buildAck(controlId, true) + END_BLOCK);
        } catch (err) {
          lastError = err.message;
          console.error("[HL7] parse error:", err.message);
          socket.write(START_BLOCK + buildAck(controlId, false) + END_BLOCK);
        }
      }
    });

    socket.on("close", () => {
      connectedCount = Math.max(0, connectedCount - 1);
      console.log(
        `[HL7] monitor disconnected: remote=${socket.remoteAddress}:${socket.remotePort} local=${socket.localAddress}:${socket.localPort}`,
      );
    });

    socket.on("error", (err) => {
      lastError = err.message;
      console.error("[HL7] socket error:", err.message);
    });
  });

  server.on("error", (err) => {
    lastError = err.message;
    console.error("[HL7] server error:", err.message);
  });

  server.listen(PORT, HOST, () => {
    startedAt = Date.now();
    console.log(`[HL7] listener running on ${HOST}:${PORT} (device_id=${DEVICE_ID})`);
  });

  startPingLoop();
  return server;
}

function stopGEHL7Server() {
  return new Promise((resolve) => {
    if (!server) {
      resolve(false);
      return;
    }

    const s = server;
    server = null;
    connectedCount = 0;

    s.close(() => {
      resolve(true);
    });
  });
}

async function restartGEHL7Server() {
  await stopGEHL7Server();
  startGEHL7Server();
  return getGEHL7Status();
}

function getGEHL7Status() {
  return {
    host: HOST,
    port: PORT,
    device_id: DEVICE_ID,
    listening: Boolean(server),
    connected_count: connectedCount,
    started_at: startedAt,
    last_message_ts: lastMessageTs,
    last_error: lastError,
    ping: { ...pingState },
  };
}

if (require.main === module) {
  startGEHL7Server();
} else {
  startGEHL7Server();
}

process.on("exit", () => {
  stopPingLoop();
});

module.exports = {
  startGEHL7Server,
  stopGEHL7Server,
  restartGEHL7Server,
  getGEHL7Status,
};
