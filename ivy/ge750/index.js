const GESerial = require("./serial");
const CFG = require("./config");
const { parseVTD, parseVTQ } = require("./protocol");
const { buildCmd } = require("./buildCommand");

const INIT_CMDS = [
  "VTE", // enable checksum
  "VTX", // extended dataset mode — device sends VTD + VTQ in response to VT? polls
];
const DEBUG_VTQ_RAW = String(process.env.GE750_DEBUG_VTQ_RAW || "0") === "1";
// Set GE750_DEBUG_FGF_RAW=1 to dump raw ASCII+hex around the fgf_total region
// (d[150:175] = line bytes 153-177) — use this when fgf_total returns null
const DEBUG_FGF_RAW = String(process.env.GE750_DEBUG_FGF_RAW || "0") === "1";
// How often to emit VTD/VTQ data to callbacks (ms). Device pushes every ~5 s
// (one breath cycle). Default 20 s. Set GE750_EMIT_MS=5000 to get every breath.
const EMIT_INTERVAL_MS = Math.max(1000, Number(process.env.GE750_EMIT_MS || 20000));

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function startGE750Service(options = {}) {
  const port = options.port || CFG.PORT;
  const onFields = typeof options.onFields === "function" ? options.onFields : null;
  const onSettings = typeof options.onSettings === "function" ? options.onSettings : null;
  const onOpen = typeof options.onOpen === "function" ? options.onOpen : null;
  const onError = typeof options.onError === "function" ? options.onError : null;
  const onClose = typeof options.onClose === "function" ? options.onClose : null;

  const ge = new GESerial({
    path: port,
    baudRate: CFG.BAUD_RATE,
    dataBits: CFG.DATA_BITS,
    stopBits: CFG.STOP_BITS,
    parity: CFG.PARITY,
  });

  let stopped = false;
  let lastEmitTs = 0; // timestamp of last onFields call (throttle)

  console.log(
    `[GE750] starting serial service on ${port} ` +
      `(baud=${CFG.BAUD_RATE}, dataBits=${CFG.DATA_BITS}, parity=${CFG.PARITY}, stopBits=${CFG.STOP_BITS})`
  );

  ge.on("open", async () => {
    if (stopped) return;
    console.log("[GE750] serial open");

    // Assert RTS + DTR so the GE750 detects a connected master
    ge.setSignals({ rts: true, dtr: true }, () => {
      console.log("[GE750] RTS + DTR set");
    });

    if (onOpen) onOpen({ port });

    await sleep(200);
    for (const cmd of INIT_CMDS) {
      if (stopped) return;
      console.log("[GE750] init >", cmd);
      ge.write(buildCmd(cmd));
      await sleep(200);
    }

    if (stopped) return;
    console.log("[GE750] init complete — VTX autonomous mode, listening for VTD/VTQ frames");
  });

  ge.on("line", (line) => {
    try {
      const ascii = line.toString("ascii");
      const tag = ascii.slice(0, 3).toUpperCase();

      if (tag === "VTY") {
        // ACK to a config/poll command — ignore
        return;
      }

      if (tag === "VTN") {
        // NACK — device not ready or unrecognized command
        console.warn("[GE750] NACK (VTN) — device not ready or unrecognized command");
        return;
      }

      if (tag === "VTM") {
        // Mode notification — device confirmed extended mode
        console.log("[GE750] mode:", ascii.slice(3));
        return;
      }

      if (tag === "VTT") {
        // Timestamp frame — e.g. VTt20260228131308---
        console.log("[GE750] timestamp:", ascii.slice(3));
        return;
      }

      if (tag === "VTD") {
        // Measured data frame — fixed-width format.
        // Throttle: only emit every EMIT_INTERVAL_MS (default 20 s).
        const measured = parseVTD(line);
        const now = Date.now();
        if (now - lastEmitTs >= EMIT_INTERVAL_MS) {
          lastEmitTs = now;
          console.log("[GE750] VTD <", JSON.stringify(measured));
          if (onFields) onFields(measured, { port, frame: "VTD" });
        }
        return;
      }

      if (tag === "VTQ") {
        if (DEBUG_VTQ_RAW) {
          const tailHex = line
            .slice(Math.max(0, line.length - 8))
            .toString("hex");
          console.log(
            `[GE750] VTQ raw bytes len=${line.length} tail=${tailHex}`,
          );
        }
        if (DEBUG_FGF_RAW) {
          // d[n] = line[n+3]  →  d[167:171] = line[170:174]
          // fgf_total: VSCaptureGEVent Substring(171,4) = bytes 171-174 = d[167:171], ÷100
          const region = line.slice(160, 178);
          console.log(
            `[GE750] VTQ fgf_total debug  len=${line.length}` +
            `  d[157..174]="${region.toString("ascii")}"` +
            `  hex=${region.toString("hex")}` +
            `  fgf_bytes="${line.slice(170, 174).toString("ascii")}"`
          );
        }
        // Emit VTQ whenever it arrives
        const settings = parseVTQ(line);
        console.log("[GE750] VTQ <", JSON.stringify(settings));
        if (onSettings) onSettings(settings, { port, frame: "VTQ" });
        return;
      }

      // unknown frame
      console.log("[GE750] unknown frame:", ascii.slice(0, 20));
    } catch (err) {
      console.error("[GE750] VT parse error:", err.message);
    }
  });

  ge.on("error", (err) => {
    if (onError) onError(err, { port });
    else console.error("[GE750] serial error:", err.message);
  });

  ge.on("close", () => {
    if (onClose) onClose({ port });
    else console.warn("[GE750] serial closed");
  });

  ge.open();

  return {
    serial: ge,
    port,
    stop() {
      stopped = true;
      ge.close();
    },
  };
}

if (require.main === module) {
  startGE750Service();
}

module.exports = { startGE750Service };
