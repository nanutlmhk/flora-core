const { SerialPort } = require("serialport");
const CFG = require("./config");
const { startGES5Service } = require("./index");
const Settings = require("../settings");

const RETRY_MS = Number(Settings.getSetting("GES5_RECONNECT_MS", "GES5_RECONNECT_MS") || 3000);
const AUTO_PICK_FIRST = String(Settings.getSetting("GES5_AUTO_PICK_FIRST", "GES5_AUTO_PICK_FIRST") || "1") !== "0";
const db = require("../db");
const { emitIvyPayload } = require("../emitter");

const FINGERPRINT = {
  vid:          String(Settings.getSetting("GES5_USB_VID",          "GES5_USB_VID")          || "").trim().toLowerCase(),
  pid:          String(Settings.getSetting("GES5_USB_PID",          "GES5_USB_PID")          || "").trim().toLowerCase(),
  serial:       String(Settings.getSetting("GES5_USB_SERIAL",       "GES5_USB_SERIAL")       || "").trim().toLowerCase(),
  manufacturer: String(Settings.getSetting("GES5_USB_MANUFACTURER", "GES5_USB_MANUFACTURER") || "").trim().toLowerCase(),
  pnpId:        String(Settings.getSetting("GES5_USB_PNPID",        "GES5_USB_PNPID")        || "").trim().toLowerCase(),
};

const PORT_HINT    = String(Settings.getSetting("GES5_PORT_HINT", "GES5_PORT_HINT") || "").trim().toLowerCase();
const STRONG_HINTS = ["ge", "b650", "aisys", "datex", "ohmeda", "s5", "s/5"];
const SERIAL_HINTS = ["usb serial", "ftdi", "prolific", "silabs", "cp210", "wch", "ch340"];

const SOURCE    = "ges5";
const PROTOCOL  = "ges5_serial";
const DEVICE_ID = String(Settings.getSetting("IVY_GES5_DEVICE_ID", "IVY_GES5_DEVICE_ID") || "GE_S5_MONITOR").trim();

// ─── Parameter map ────────────────────────────────────────────────────────────
// Maps parseBasicPhdb output keys → { ivy_param, raw_code, unit }
// All scaling is applied in parseBasicPhdb (index.js) per VSCaptureWave Class1.cs.
const GES5_PARAM_MAP = {
  // ECG
  HR:           { ivy_param: "hr",              raw_code: "GES5_HR",        unit: "bpm"       },
  RR_IMP:       { ivy_param: "rr_imp",          raw_code: "GES5_RR_IMP",    unit: "rpm"       },

  // Invasive pressures P1/P2 (×0.01 → mmHg)
  P1_SYS:       { ivy_param: "p1_sys",          raw_code: "GES5_P1_SYS",    unit: "mmHg"      },
  P1_DIA:       { ivy_param: "p1_dia",          raw_code: "GES5_P1_DIA",    unit: "mmHg"      },
  P1_MEAN:      { ivy_param: "p1_mean",         raw_code: "GES5_P1_MEAN",   unit: "mmHg"      },
  P1_HR:        { ivy_param: "p1_pr",           raw_code: "GES5_P1_HR",     unit: "bpm"       },
  P2_SYS:       { ivy_param: "p2_sys",          raw_code: "GES5_P2_SYS",    unit: "mmHg"      },
  P2_DIA:       { ivy_param: "p2_dia",          raw_code: "GES5_P2_DIA",    unit: "mmHg"      },
  P2_MEAN:      { ivy_param: "p2_mean",         raw_code: "GES5_P2_MEAN",   unit: "mmHg"      },
  P2_HR:        { ivy_param: "p2_pr",           raw_code: "GES5_P2_HR",     unit: "bpm"       },

  // NIBP (×0.01 → mmHg)
  NIBP_SYS:     { ivy_param: "nibp_sys",        raw_code: "GES5_NIBP_SYS",  unit: "mmHg"      },
  NIBP_DIA:     { ivy_param: "nibp_dia",        raw_code: "GES5_NIBP_DIA",  unit: "mmHg"      },
  NIBP_MEAN:    { ivy_param: "nibp_mean",       raw_code: "GES5_NIBP_MEAN", unit: "mmHg"      },

  // Temperatures (×0.01 → °C)
  T1:           { ivy_param: "temp1",           raw_code: "GES5_T1",        unit: "°C"        },
  T2:           { ivy_param: "temp2",           raw_code: "GES5_T2",        unit: "°C"        },
  T3:           { ivy_param: "temp3",           raw_code: "GES5_T3",        unit: "°C"        },
  T4:           { ivy_param: "temp4",           raw_code: "GES5_T4",        unit: "°C"        },

  // SpO2 (×0.01 → %)
  SpO2:         { ivy_param: "spo2",            raw_code: "GES5_SPO2",      unit: "%"         },
  SpO2_PR:      { ivy_param: "spo2_pr",         raw_code: "GES5_SPO2_PR",   unit: "bpm"       },

  // CO2 (amb_press formula → kPa)
  CO2_ET:       { ivy_param: "et_co2_kpa",      raw_code: "GES5_ETCO2",     unit: "kPa"       },
  CO2_FI:       { ivy_param: "fi_co2_kpa",      raw_code: "GES5_FICO2",     unit: "kPa"       },
  CO2_RR:       { ivy_param: "rr_co2",          raw_code: "GES5_CO2_RR",    unit: "rpm"       },

  // O2 / N2O (×0.01 → %)
  O2_ET:        { ivy_param: "et_o2",           raw_code: "GES5_ETO2",      unit: "%"         },
  O2_FI:        { ivy_param: "fi_o2",           raw_code: "GES5_FIO2",      unit: "%"         },
  N2O_ET:       { ivy_param: "et_n2o",          raw_code: "GES5_ETN2O",     unit: "%"         },
  N2O_FI:       { ivy_param: "fi_n2o",          raw_code: "GES5_FIN2O",     unit: "%"         },

  // Volatile agent (×0.01 → %)
  AA_ET:        { ivy_param: "et_agent",        raw_code: "GES5_ETAA",      unit: "%"         },
  AA_FI:        { ivy_param: "fi_agent",        raw_code: "GES5_FIAA",      unit: "%"         },
  AA_MAC:       { ivy_param: "mac",             raw_code: "GES5_MAC",       unit: "MAC"       },
  AA_AGENT:     { ivy_param: "agent_id",        raw_code: "GES5_AGENT",     unit: null        },

  // Aisys CS2 ventilator data from flow_vol group (offset 178)
  FV_RR:        { ivy_param: "rr_vent",         raw_code: "GES5_FV_RR",     unit: "rpm"       },
  FV_PPEAK:     { ivy_param: "airway_pressure_peak",   raw_code: "GES5_PPEAK",  unit: "cmH2O" },
  FV_PEEP:      { ivy_param: "peep",            raw_code: "GES5_PEEP",      unit: "cmH2O"     },
  FV_PPLAT:     { ivy_param: "airway_pressure_plateau", raw_code: "GES5_PPLAT", unit: "cmH2O" },
  FV_TV_INSP:   { ivy_param: "tidal_volume_insp",      raw_code: "GES5_TVINSP", unit: "L"    },
  FV_TV_EXP:    { ivy_param: "tidal_volume_exp",       raw_code: "GES5_TVEXP",  unit: "L"    },
  FV_COMPLIANCE:{ ivy_param: "compliance",      raw_code: "GES5_COMPLIANCE", unit: "mL/cmH2O" },
  FV_MV_EXP:    { ivy_param: "minute_volume_exp",      raw_code: "GES5_MVEXP",  unit: "L/min"},
};

// ─── DB insertion ─────────────────────────────────────────────────────────────
function insertObservation({ ivy_param, raw_code, value, unit, device_ts }) {
  if (!ivy_param || value == null) return;
  const v = typeof value === "string" ? parseFloat(value) : value;
  if (typeof v === "number" && !Number.isFinite(v)) return;
  const now = Date.now();

  db.run(
    `INSERT INTO ivy_observations
       (device_id, source, protocol, raw_code, ivy_param, value, unit, device_ts, system_ts, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [DEVICE_ID, SOURCE, PROTOCOL, raw_code, ivy_param, v, unit || null, device_ts || null, now, now],
    (err) => { if (err) console.error("[GES5] insert failed:", err.message); }
  );
}

// ─── Ingestion pipeline ───────────────────────────────────────────────────────
// parsed: result from parsePhdbPacket — { rNbr, rLen, rTime, results[] }
// Each result: { kind, sr_offset, vals }  where vals = parseBasicPhdb output
function ingestGES5Frame(parsed) {
  if (!parsed || parsed.skipped || !Array.isArray(parsed.results)) return;

  // Merge all subrecord vals (in practice only one DISPL subrecord is expected)
  const merged = {};
  for (const { vals } of parsed.results) {
    Object.assign(merged, vals);
  }
  if (Object.keys(merged).length === 0) return;

  // device_ts: r_time from DRI header (Unix seconds). Zero = not set by device.
  const device_ts = parsed.rTime > 0 ? parsed.rTime * 1000 : null;

  const ivyPayload = {};
  for (const [srcKey, cfg] of Object.entries(GES5_PARAM_MAP)) {
    const raw = merged[srcKey];
    if (raw == null) continue;
    const v = typeof raw === "string" ? parseFloat(raw) : raw;
    if (typeof v === "number" && !Number.isFinite(v)) continue;

    insertObservation({ ivy_param: cfg.ivy_param, raw_code: cfg.raw_code, value: v, unit: cfg.unit, device_ts });
    ivyPayload[cfg.ivy_param] = { value: v, unit: cfg.unit || null };
  }

  if (Object.keys(ivyPayload).length > 0) {
    emitIvyPayload({
      source:    DEVICE_ID,
      system_ts: Date.now(),
      device_ts: device_ts,
      params:    ivyPayload,
    });
  }

  // Readable console summary
  const ts    = new Date().toLocaleTimeString();
  const hr    = merged.HR         ?? "-";
  const spo2  = merged.SpO2       ?? "-";
  const ns    = merged.NIBP_SYS   ?? "-";
  const nd    = merged.NIBP_DIA   ?? "-";
  const t1    = merged.T1         ?? "-";
  const etco2 = merged.CO2_ET     ?? "-";
  const etaa  = merged.AA_ET      ?? "-";
  const agent = merged.AA_AGENT   ?? "";
  const rr    = merged.FV_RR      ?? "-";
  const ppeak = merged.FV_PPEAK   ?? "-";
  const tv    = merged.FV_TV_EXP  ?? "-";
  console.log(
    `[${ts}] [GES5] HR:${hr}  SpO2:${spo2}%  NIBP:${ns}/${nd}  T1:${t1}°C` +
    `  EtCO2:${etco2}kPa  ${agent}:${etaa}%  RR:${rr}  PPeak:${ppeak}cmH2O  TVe:${tv}L`
  );
}

// ─── State ────────────────────────────────────────────────────────────────────
const state = {
  running: false,
  connecting: false,
  connected: false,
  currentPort: null,
  lastBoundPort: null,
  lastConnectAt: null,
  lastPacketAt: null,
  lastVitalsPreview: null,
  lastError: null,
  nextReconnectAt: null,
  retryMs: RETRY_MS,
  reason: null,
  detectedPorts: [],
  detectedPortInfo: [],
  manualPreferredPort: null,
};

let controller = null;
let reconnectTimer = null;
let started = false;

// ─── Port selection ───────────────────────────────────────────────────────────
function normalizeHex(value) {
  return String(value || "").trim().toLowerCase().replace(/^0x/, "");
}

function containsIgnoreCase(haystack, needle) {
  if (!needle) return true;
  return String(haystack || "").toLowerCase().includes(String(needle).toLowerCase());
}

function hasFingerprint() {
  return Boolean(FINGERPRINT.vid || FINGERPRINT.pid || FINGERPRINT.serial ||
                 FINGERPRINT.manufacturer || FINGERPRINT.pnpId);
}

function matchesFingerprint(portInfo) {
  if (!hasFingerprint()) return false;
  const vid  = normalizeHex(portInfo.vendorId);
  const pid  = normalizeHex(portInfo.productId);
  const ser  = String(portInfo.serialNumber  || "").toLowerCase();
  const mfr  = String(portInfo.manufacturer  || "").toLowerCase();
  const pnp  = String(portInfo.pnpId         || "").toLowerCase();
  if (FINGERPRINT.vid          && vid !== normalizeHex(FINGERPRINT.vid))   return false;
  if (FINGERPRINT.pid          && pid !== normalizeHex(FINGERPRINT.pid))   return false;
  if (FINGERPRINT.serial       && !containsIgnoreCase(ser, FINGERPRINT.serial))       return false;
  if (FINGERPRINT.manufacturer && !containsIgnoreCase(mfr, FINGERPRINT.manufacturer)) return false;
  if (FINGERPRINT.pnpId        && !containsIgnoreCase(pnp, FINGERPRINT.pnpId))        return false;
  return true;
}

function normalizePortInfo(p) {
  return {
    path:         String(p?.path         || ""),
    manufacturer: String(p?.manufacturer || ""),
    friendlyName: String(p?.friendlyName || ""),
    serialNumber: String(p?.serialNumber || ""),
    vendorId:     String(p?.vendorId     || ""),
    productId:    String(p?.productId    || ""),
    pnpId:        String(p?.pnpId        || ""),
  };
}

function scorePort(portInfo) {
  const text = [portInfo.path, portInfo.manufacturer, portInfo.friendlyName,
                portInfo.pnpId, portInfo.serialNumber]
    .filter(Boolean).join(" ").toLowerCase();
  let score = 0;
  if (matchesFingerprint(portInfo)) score += 1000;
  for (const hint of STRONG_HINTS) if (text.includes(hint)) score += 120;
  for (const hint of SERIAL_HINTS) if (text.includes(hint)) score += 40;
  if (PORT_HINT && text.includes(PORT_HINT)) score += 80;
  if (String(portInfo.path || "").toUpperCase().startsWith("COM")) score += 12;
  return score;
}

async function pickPort() {
  const ports = await SerialPort.list();
  const normalizedPorts = (ports || []).map(normalizePortInfo).filter((p) => p.path);

  state.detectedPorts    = normalizedPorts.map((p) => p.path);
  state.detectedPortInfo = normalizedPorts.map((p) => ({
    path:             p.path,
    manufacturer:     p.manufacturer || null,
    friendlyName:     p.friendlyName || null,
    vendorId:         p.vendorId     || null,
    productId:        p.productId    || null,
    score:            scorePort(p),
    fingerprintMatch: matchesFingerprint(p),
  }));

  const configured = String(Settings.getSetting("GES5_PORT", "GES5_PORT") || CFG.PORT || "").trim();
  if (configured.toUpperCase() === "NONE" || configured.toUpperCase() === "OFF") {
    return { port: null, reason: "disabled_by_config" };
  }

  if (configured && state.detectedPorts.includes(configured)) {
    return { port: configured, reason: "configured" };
  }

  if (state.lastBoundPort && state.detectedPorts.includes(state.lastBoundPort)) {
    return { port: state.lastBoundPort, reason: "last_bound" };
  }

  const byFp = normalizedPorts.find(matchesFingerprint);
  if (byFp?.path) return { port: byFp.path, reason: "fingerprint" };

  if (AUTO_PICK_FIRST && normalizedPorts.length === 1) {
    return { port: normalizedPorts[0].path, reason: "single_port" };
  }

  if (AUTO_PICK_FIRST && normalizedPorts.length > 1) {
    const ranked = [...normalizedPorts].sort((a, b) => scorePort(b) - scorePort(a));
    const top = ranked[0];
    if (top?.path && scorePort(top) > 0) return { port: top.path, reason: "ranked_best_match" };
    const firstCom = ranked.find((p) => String(p.path || "").toUpperCase().startsWith("COM"));
    if (firstCom?.path) return { port: firstCom.path, reason: "first_com" };
  }

  return { port: null, reason: "not_found" };
}

// ─── Connection lifecycle ─────────────────────────────────────────────────────
function safeStopCurrent() {
  if (!controller) return;
  try { controller.stop(); } catch { /* ignore */ }
  controller = null;
}

function scheduleReconnect(reason, delayMs = RETRY_MS) {
  if (!state.running) return;
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
  state.connecting = false;
  state.connected  = false;
  state.reason     = reason || "reconnect";
  state.nextReconnectAt = Date.now() + delayMs;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    void connectOnce(`retry:${reason || "unknown"}`);
  }, Math.max(250, delayMs));
}

async function connectOnce(trigger) {
  if (!state.running || state.connecting) return;
  state.connecting = true;
  state.reason     = trigger;

  let picked;
  try {
    picked = await pickPort();
  } catch (err) {
    state.lastError = `[pickPort] ${err.message}`;
    scheduleReconnect("pick_port_error", RETRY_MS);
    return;
  }

  if (!picked.port) {
    state.lastError = `[GES5] serial port not found (${picked.reason})`;
    if (picked.reason !== "disabled_by_config") {
      console.warn(state.lastError);
      scheduleReconnect("port_not_found", RETRY_MS);
    } else {
      state.connecting = false;
      console.log("[GES5] service disabled via configuration.");
    }
    return;
  }

  safeStopCurrent();

  const selectedPort = picked.port;
  console.log(`[GES5] connecting on ${selectedPort} (${picked.reason})`);

  controller = startGES5Service({
    port: selectedPort,

    onOpen: () => {
      state.connecting    = false;
      state.connected     = true;
      state.currentPort   = selectedPort;
      state.lastBoundPort = selectedPort;
      state.lastConnectAt = Date.now();
      state.lastError     = null;
      state.nextReconnectAt = null;
      console.log(`[GES5] connected on ${selectedPort}`);
    },

    onPacket: (_payload, parsed) => {
      state.lastPacketAt = Date.now();
      if (parsed && !parsed.skipped) {
        // Collect top-level vals for status preview
        const merged = {};
        for (const { vals } of parsed.results) Object.assign(merged, vals);
        state.lastVitalsPreview = Object.keys(merged).length > 0 ? merged : null;
        ingestGES5Frame(parsed);
      }
    },

    onError: (err) => {
      state.lastError = err.message;
      console.error(`[GES5] error on ${selectedPort}:`, err.message);
      scheduleReconnect("serial_error", RETRY_MS);
    },

    onClose: () => {
      if (!state.running) return;
      console.warn(`[GES5] port closed (${selectedPort}), scheduling reconnect`);
      scheduleReconnect("serial_close", RETRY_MS);
    },
  });
}

// ─── Public API ───────────────────────────────────────────────────────────────
function startGES5Manager() {
  if (started) return;
  if (!Settings.isServiceEnabled("GES5")) {
    console.log("[GES5] Manager idle (not the active device type)");
    return;
  }
  started = true;
  state.running = true;
  void connectOnce("startup");
}

function stopGES5Manager() {
  state.running     = false;
  state.connecting  = false;
  state.connected   = false;
  state.nextReconnectAt = null;
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
  safeStopCurrent();
}

function normalizeManualPort(port) {
  const raw = String(port == null ? "" : port).trim();
  if (!raw || raw.toLowerCase() === "auto") return null;
  return raw.toUpperCase();
}

function requestGES5Reconnect(options = {}) {
  let requestedPort;
  if (typeof options === "string") {
    requestedPort = options;
  } else if (options && typeof options === "object") {
    requestedPort = options.port ?? options.ges5_port ?? options.selectedPort;
  }

  if (requestedPort !== undefined) {
    state.manualPreferredPort = normalizeManualPort(requestedPort);
  }

  state.reason = state.manualPreferredPort
    ? `manual_reconnect:${state.manualPreferredPort}`
    : "manual_reconnect";

  safeStopCurrent();
  scheduleReconnect("manual_reconnect", 200);
  return getGES5Status();
}

function getGES5Status() {
  return {
    ...state,
    fingerprint_configured: hasFingerprint(),
    fingerprint: {
      vid:          FINGERPRINT.vid          || null,
      pid:          FINGERPRINT.pid          || null,
      serial:       FINGERPRINT.serial       || null,
      manufacturer: FINGERPRINT.manufacturer || null,
      pnpId:        FINGERPRINT.pnpId        || null,
    },
  };
}

startGES5Manager();

module.exports = { startGES5Manager, stopGES5Manager, requestGES5Reconnect, getGES5Status };
