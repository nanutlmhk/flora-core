const { SerialPort } = require("serialport");
const CFG = require("./config");
const { startGE750Service } = require("./index");
const Settings = require("../settings");

const RETRY_MS = Number(Settings.getSetting("GE750_RECONNECT_MS", "GE750_RECONNECT_MS") || 3000);
const AUTO_PICK_FIRST = String(Settings.getSetting("GE750_AUTO_PICK_FIRST", "GE750_AUTO_PICK_FIRST") || "1") !== "0";
const db = require("../db");
const { emitIvyPayload } = require("../emitter");

const FINGERPRINT = {
  vid: String(Settings.getSetting("GE750_USB_VID", "GE750_USB_VID") || "").trim().toLowerCase(),
  pid: String(Settings.getSetting("GE750_USB_PID", "GE750_USB_PID") || "").trim().toLowerCase(),
  serial: String(Settings.getSetting("GE750_USB_SERIAL", "GE750_USB_SERIAL") || "").trim().toLowerCase(),
  manufacturer: String(Settings.getSetting("GE750_USB_MANUFACTURER", "GE750_USB_MANUFACTURER") || "").trim().toLowerCase(),
  pnpId: String(Settings.getSetting("GE750_USB_PNPID", "GE750_USB_PNPID") || "").trim().toLowerCase(),
};

const PORT_HINT = String(Settings.getSetting("GE750_PORT_HINT", "GE750_PORT_HINT") || "").trim().toLowerCase();
const STRONG_HINTS = [
  "ge",
  "caresation",
  "carestation",
  "datex",
  "ohmeda",
];
const SERIAL_HINTS = [
  "usb serial",
  "ftdi",
  "prolific",
  "silabs",
  "cp210",
  "wch",
  "ch340",
];
const SOURCE = "ge750";
const PROTOCOL = "ge750_serial";
const DEVICE_ID = String(Settings.getSetting("IVY_GE750_DEVICE_ID", "IVY_GE750_DEVICE_ID") || "GE750_CARESTATION").trim();

const GE750_MEASURED_MAP = {
  tidal_volume_exp: {
    ivy_param: "tidal_volume_exp",
    raw_code: "GE750_TIDAL_VOLUME_EXP",
    unit: "mL",
  },
  minute_volume: {
    ivy_param: "minute_volume_exp",
    raw_code: "GE750_MINUTE_VOLUME_EXP",
    unit: "L/min",
  },
  resp_rate: { ivy_param: "rr", raw_code: "GE750_RESP_RATE", unit: "rpm" },
  fio2: { ivy_param: "fio2", raw_code: "GE750_FIO2", unit: "%" },
  airway_pressure_peak: {
    ivy_param: "airway_pressure_peak",
    raw_code: "GE750_PPEAK",
    unit: "cmH2O",
  },
  airway_pressure_plat: {
    ivy_param: "airway_pressure_plateau",
    raw_code: "GE750_PPLAT",
    unit: "cmH2O",
  },
  airway_pressure_mean: {
    ivy_param: "airway_pressure_mean",
    raw_code: "GE750_PMEAN",
    unit: "cmH2O",
  },
  airway_pressure_min: {
    ivy_param: "airway_pressure_min",
    raw_code: "GE750_PMIN",
    unit: "cmH2O",
  },
  // Extended ventilator fields
  mv_spont: { ivy_param: "mv_spont", raw_code: "GE750_MV_SPONT", unit: "L/min" },
  rr_spont: { ivy_param: "rr_spont", raw_code: "GE750_RR_SPONT", unit: "rpm" },
  peep_intrinsic: { ivy_param: "peep_intrinsic", raw_code: "GE750_PEEPI", unit: "cmH2O" },
  compliance: { ivy_param: "compliance", raw_code: "GE750_COMPLIANCE", unit: "mL/cmH2O" },
  peep_extrinsic: { ivy_param: "peep_extrinsic", raw_code: "GE750_PEEPE", unit: "cmH2O" },
  peep_total: { ivy_param: "peep_total", raw_code: "GE750_PEEPEI", unit: "cmH2O" },

  // MGAS fields
  fio2_meas: { ivy_param: "fio2_meas", raw_code: "GE750_MGAS_FIO2", unit: "%" },
  et_o2: { ivy_param: "et_o2", raw_code: "GE750_ETO2", unit: "%" },
  fi_co2: { ivy_param: "fi_co2", raw_code: "GE750_FICO2", unit: "mmHg" },
  et_co2: { ivy_param: "et_co2", raw_code: "GE750_ETCO2", unit: "mmHg" },
  fi_agent: { ivy_param: "fi_agent", raw_code: "GE750_FIAA", unit: "%" },
  et_agent: { ivy_param: "et_agent", raw_code: "GE750_ETAA", unit: "%" },
  agent_id: { ivy_param: "agent_id", raw_code: "GE750_AGENT_ID", unit: null },
  fi_n2o: { ivy_param: "fi_n2o", raw_code: "GE750_FIN2O", unit: "%" },
  et_n2o: { ivy_param: "et_n2o", raw_code: "GE750_ETN2O", unit: "%" },
  mac: { ivy_param: "mac", raw_code: "GE750_MAC", unit: "MAC" },

  // Gas flow fields
  flow_o2: { ivy_param: "flow_o2", raw_code: "GE750_FLOW_O2", unit: "L/min" },
  flow_n2o: { ivy_param: "flow_n2o", raw_code: "GE750_FLOW_N2O", unit: "L/min" },
  flow_air: { ivy_param: "flow_air", raw_code: "GE750_FLOW_AIR", unit: "L/min" },
};

const GE750_SETTINGS_MAP = {
  vent_mode: { ivy_param: "set_vent_mode", raw_code: "GE750_VENT_MODE", unit: null },
  tv_set: { ivy_param: "set_tidal_volume", raw_code: "GE750_SET_TV", unit: "mL" },
  rr_set: { ivy_param: "set_rr", raw_code: "GE750_SET_RR", unit: "rpm" },
  ie_ratio: { ivy_param: "set_ie_ratio", raw_code: "GE750_SET_IE_RATIO", unit: "ratio" },
  peep_set: { ivy_param: "set_peep", raw_code: "GE750_SET_PEEP", unit: "cmH2O" },
  peak_limit: {
    ivy_param: "set_peak_limit",
    raw_code: "GE750_SET_PEAK_LIMIT",
    unit: "cmH2O",
  },
  insp_pres_set: {
    ivy_param: "set_insp_pressure",
    raw_code: "GE750_SET_INSP_PRESSURE",
    unit: "cmH2O",
  },
  fio2_set: { ivy_param: "set_fio2", raw_code: "GE750_SET_FIO2", unit: "%" },
  fgf_total: { ivy_param: "set_fgf_total", raw_code: "GE750_SET_FGF_TOTAL", unit: "L/min" },
  psupp: { ivy_param: "set_psupp", raw_code: "GE750_SET_PSUPP", unit: "cmH2O" },
  flow_trigger: { ivy_param: "set_flow_trigger", raw_code: "GE750_SET_FLOW_TRIGGER", unit: "L/min" },
  end_flow: { ivy_param: "set_end_flow", raw_code: "GE750_SET_END_FLOW", unit: "%" },
  t_insp_set: { ivy_param: "set_t_insp", raw_code: "GE750_SET_T_INSP", unit: "s" },
};

function insertObservation({ ivy_param, raw_code, value, unit }) {
  if (!ivy_param || value == null) return;
  if (typeof value === "number" && !Number.isFinite(value)) return;
  const now = Date.now();

  db.run(
    `
    INSERT INTO ivy_observations
      (device_id, source, protocol, raw_code, ivy_param, value, unit, device_ts, system_ts, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    [
      DEVICE_ID,
      SOURCE,
      PROTOCOL,
      raw_code,
      ivy_param,
      value,
      unit || null,
      null,
      now,
      now,
    ],
    (err) => {
      if (err) {
        console.error("[GE750] insert failed:", err.message);
      }
    },
  );
}

function normalizeFramePayload(frame, map) {
  const payload = {};
  const observations = [];

  for (const [srcKey, cfg] of Object.entries(map)) {
    const raw = frame?.[srcKey];
    if (raw == null) continue;
    if (typeof raw === "number" && !Number.isFinite(raw)) continue;

    observations.push({
      ivy_param: cfg.ivy_param,
      raw_code: cfg.raw_code,
      value: raw,
      unit: cfg.unit,
    });
    payload[cfg.ivy_param] = {
      value: raw,
      unit: cfg.unit || null,
    };
  }

  return { observations, payload };
}

let lastSettingsFrame = null;
let lastDataFrame = null; // kept to derive fgf_total when VTq sends "----"

// VTq fgf_total is often "----" (not transmitted). Derive it from the measured
// individual gas flows in the most-recent VTd frame: O2 + N2O + Air.
function deriveFGFFromFlows(dataFrame) {
  if (!dataFrame) return null;
  const o2  = typeof dataFrame.flow_o2  === "number" ? dataFrame.flow_o2  : 0;
  const n2o = typeof dataFrame.flow_n2o === "number" ? dataFrame.flow_n2o : 0;
  const air = typeof dataFrame.flow_air === "number" ? dataFrame.flow_air : 0;
  const total = o2 + n2o + air;
  return total > 0 ? parseFloat(total.toFixed(2)) : null;
}

// Returns a (possibly augmented) copy of settingsFrame with fgf_total filled in
// from measured flows when the VTq field is absent ("----").
function resolveSettings(settingsFrame) {
  if (settingsFrame == null) return settingsFrame;
  if (settingsFrame.fgf_total != null) return settingsFrame; // already present
  const derived = deriveFGFFromFlows(lastDataFrame);
  if (derived == null) return settingsFrame;
  return { ...settingsFrame, fgf_total: derived };
}

function ingestGE750Frame(frame, map, frameType = "DATA") {
  if (frameType === "SETTINGS") {
    lastSettingsFrame = frame;
  }
  if (frameType === "DATA") {
    lastDataFrame = frame;
  }

  // For SETTINGS: fill fgf_total from measured flows if VTq sent "----"
  const effectiveFrame = frameType === "SETTINGS" ? resolveSettings(frame) : frame;

  const { observations, payload } = normalizeFramePayload(effectiveFrame, map);
  if (observations.length > 0) {
    for (const obs of observations) {
      insertObservation(obs);
    }

    emitIvyPayload({
      source: DEVICE_ID,
      system_ts: Date.now(),
      device_ts: null,
      params: payload,
    });
  }

  // If we just got DATA, and we have cached SETTINGS, inject them now
  // to ensure minuteWriter always finds the settings for every minute.
  // Also re-derive fgf_total using the fresh gas-flow data we just received.
  if (frameType === "DATA" && lastSettingsFrame) {
    const resolvedSettings = resolveSettings(lastSettingsFrame);
    const { observations: sObs } = normalizeFramePayload(
      resolvedSettings,
      GE750_SETTINGS_MAP,
    );
    for (const obs of sObs) {
      insertObservation(obs);
    }
    // We don't need to emitIvyPayload for settings every second,
    // the DB insertion is enough for the minuteWriter.
  }

  // Readable console output
  const ts = new Date().toLocaleTimeString();
  if (frameType === "DATA") {
    const tv = frame.tidal_volume_exp ?? "-";
    const mv = frame.minute_volume ?? "-";
    const rr = frame.resp_rate ?? "-";
    const etco2 = frame.et_co2 ?? "-";
    console.log(`[${ts}] [GE750-DATA] TV:${tv}mL MV:${mv}L/min RR:${rr} EtCO2:${etco2}`);
  } else if (frameType === "SETTINGS") {
    const mode = effectiveFrame.vent_mode ?? "UNKNOWN";
    const tvSet = effectiveFrame.tv_set ?? "-";
    const rrSet = effectiveFrame.rr_set ?? "-";
    const fgf  = effectiveFrame.fgf_total != null ? `${effectiveFrame.fgf_total}L/min` : "----";
    console.log(`[${ts}] [GE750-SETTINGS] Mode:${mode} SetTV:${tvSet}mL SetRR:${rrSet} FGF:${fgf}`);
  }
}

const state = {
  running: false,
  connecting: false,
  connected: false,
  currentPort: null,
  lastBoundPort: null,
  lastConnectAt: null,
  lastDataAt: null,
  lastFieldsPreview: null,
  lastSettingsPreview: null,
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

function hasFingerprint() {
  return Boolean(
    FINGERPRINT.vid ||
      FINGERPRINT.pid ||
      FINGERPRINT.serial ||
      FINGERPRINT.manufacturer ||
      FINGERPRINT.pnpId
  );
}

function normalizeHex(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/^0x/, "");
}

function containsIgnoreCase(haystack, needle) {
  if (!needle) return true;
  return String(haystack || "").toLowerCase().includes(String(needle).toLowerCase());
}

function matchesFingerprint(portInfo) {
  if (!hasFingerprint()) return false;

  const info = {
    vid: normalizeHex(portInfo.vendorId),
    pid: normalizeHex(portInfo.productId),
    serial: String(portInfo.serialNumber || "").toLowerCase(),
    manufacturer: String(portInfo.manufacturer || "").toLowerCase(),
    pnpId: String(portInfo.pnpId || "").toLowerCase(),
    path: String(portInfo.path || "").toLowerCase(),
    friendlyName: String(portInfo.friendlyName || "").toLowerCase(),
  };

  if (FINGERPRINT.vid && info.vid !== normalizeHex(FINGERPRINT.vid)) return false;
  if (FINGERPRINT.pid && info.pid !== normalizeHex(FINGERPRINT.pid)) return false;
  if (FINGERPRINT.serial && !containsIgnoreCase(info.serial, FINGERPRINT.serial)) return false;
  if (FINGERPRINT.manufacturer && !containsIgnoreCase(info.manufacturer, FINGERPRINT.manufacturer)) return false;
  if (FINGERPRINT.pnpId && !containsIgnoreCase(info.pnpId, FINGERPRINT.pnpId)) return false;

  return true;
}

function normalizePortInfo(portInfo) {
  return {
    path: String(portInfo?.path || ""),
    manufacturer: String(portInfo?.manufacturer || ""),
    friendlyName: String(portInfo?.friendlyName || ""),
    serialNumber: String(portInfo?.serialNumber || ""),
    vendorId: String(portInfo?.vendorId || ""),
    productId: String(portInfo?.productId || ""),
    pnpId: String(portInfo?.pnpId || ""),
  };
}

function scorePort(portInfo) {
  const text = [
    portInfo.path,
    portInfo.manufacturer,
    portInfo.friendlyName,
    portInfo.pnpId,
    portInfo.serialNumber,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  let score = 0;

  if (matchesFingerprint(portInfo)) score += 1000;

  for (const hint of STRONG_HINTS) {
    if (text.includes(hint)) score += 120;
  }
  for (const hint of SERIAL_HINTS) {
    if (text.includes(hint)) score += 40;
  }
  if (PORT_HINT && text.includes(PORT_HINT)) score += 80;
  if (String(portInfo.path || "").toUpperCase().startsWith("COM")) score += 12;

  return score;
}

async function pickPort() {
  const ports = await SerialPort.list();
  const normalizedPorts = (ports || []).map(normalizePortInfo).filter((p) => p.path);

  state.detectedPorts = normalizedPorts.map((p) => p.path);
  state.detectedPortInfo = normalizedPorts.map((p) => ({
    path: p.path,
    manufacturer: p.manufacturer || null,
    friendlyName: p.friendlyName || null,
    vendorId: p.vendorId || null,
    productId: p.productId || null,
    score: scorePort(p),
    fingerprintMatch: matchesFingerprint(p),
  }));

  const configured = String(Settings.getSetting("GE750_PORT", "GE750_PORT") || Settings.getSetting("GE750_COM_PORT", "GE750_COM_PORT") || CFG.PORT || "").trim();
  if (configured.toUpperCase() === "NONE" || configured.toUpperCase() === "OFF") {
    return { port: null, reason: "disabled_by_config" };
  }

  const manual = String(state.manualPreferredPort || "").trim();
  if (configured && state.detectedPorts.includes(configured)) {
    return { port: configured, reason: "configured" };
  }

  if (state.lastBoundPort && state.detectedPorts.includes(state.lastBoundPort)) {
    return { port: state.lastBoundPort, reason: "last_bound" };
  }

  const byFp = normalizedPorts.find(matchesFingerprint);
  if (byFp?.path) {
    return { port: byFp.path, reason: "fingerprint" };
  }

  if (configured) {
    const fuzzy = normalizedPorts.find((p) =>
      containsIgnoreCase(p.path, configured) || containsIgnoreCase(p.friendlyName, configured)
    );
    if (fuzzy?.path) return { port: fuzzy.path, reason: "configured_fuzzy" };
  }

  if (AUTO_PICK_FIRST && normalizedPorts.length === 1) {
    return { port: normalizedPorts[0].path, reason: "single_port" };
  }

  if (AUTO_PICK_FIRST && normalizedPorts.length > 1) {
    const ranked = [...normalizedPorts].sort((a, b) => scorePort(b) - scorePort(a));
    const top = ranked[0];
    if (top?.path) {
      const topScore = scorePort(top);
      if (topScore > 0) return { port: top.path, reason: "ranked_best_match" };

      const firstCom = ranked.find((p) => String(p.path || "").toUpperCase().startsWith("COM"));
      if (firstCom?.path) return { port: firstCom.path, reason: "first_com" };
    }
  }

  return { port: null, reason: "not_found" };
}

function safeStopCurrent() {
  if (!controller) return;
  try {
    controller.stop();
  } catch {
    // ignore
  }
  controller = null;
}

function scheduleReconnect(reason, delayMs = RETRY_MS) {
  if (!state.running) return;

  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }

  state.connecting = false;
  state.connected = false;
  state.reason = reason || "reconnect";
  state.nextReconnectAt = Date.now() + delayMs;

  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    void connectOnce(`retry:${reason || "unknown"}`);
  }, Math.max(250, delayMs));
}

async function connectOnce(trigger) {
  if (!state.running || state.connecting) return;

  state.connecting = true;
  state.reason = trigger;

  let picked;
  try {
    picked = await pickPort();
  } catch (err) {
    state.lastError = `[pickPort] ${err.message}`;
    scheduleReconnect("pick_port_error", RETRY_MS);
    return;
  }

  if (!picked.port) {
    state.lastError = `[GE750] serial port not found (${picked.reason})`;
    console.warn(state.lastError);
    scheduleReconnect("port_not_found", RETRY_MS);
    return;
  }

  safeStopCurrent();

  const selectedPort = picked.port;
  console.log(`[GE750] connecting on ${selectedPort} (${picked.reason})`);

  controller = startGE750Service({
    port: selectedPort,
    onOpen: () => {
      state.connecting = false;
      state.connected = true;
      state.currentPort = selectedPort;
      state.lastBoundPort = selectedPort;
      state.lastConnectAt = Date.now();
      state.lastError = null;
      state.nextReconnectAt = null;
      console.log(`[GE750] connected on ${selectedPort}`);
    },
    onFields: (fields) => {
      state.lastDataAt = Date.now();
      state.lastFieldsPreview = fields && typeof fields === "object" ? fields : null;
      if (fields && typeof fields === "object") {
        ingestGE750Frame(fields, GE750_MEASURED_MAP, "DATA");
      }
    },
    onSettings: (settings) => {
      state.lastDataAt = Date.now();
      state.lastSettingsPreview = settings && typeof settings === "object" ? settings : null;
      if (settings && typeof settings === "object") {
        ingestGE750Frame(settings, GE750_SETTINGS_MAP, "SETTINGS");
      }
    },
    onError: (err) => {
      state.lastError = err.message;
      console.error(`[GE750] error on ${selectedPort}:`, err.message);
      scheduleReconnect("serial_error", RETRY_MS);
    },
    onClose: () => {
      if (!state.running) return;
      console.warn(`[GE750] port closed (${selectedPort}), scheduling reconnect`);
      scheduleReconnect("serial_close", RETRY_MS);
    },
  });
}

function startGE750Manager() {
  if (started) return;
  if (!Settings.isServiceEnabled("GE750")) {
    console.log("[GE750] Manager idle (not the active device type)");
    return;
  }
  started = true;
  state.running = true;
  void connectOnce("startup");
}

function stopGE750Manager() {
  state.running = false;
  state.connecting = false;
  state.connected = false;
  state.nextReconnectAt = null;

  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }

  safeStopCurrent();
}

function normalizeManualPort(port) {
  const raw = String(port == null ? "" : port).trim();
  if (!raw || raw.toLowerCase() === "auto") return null;
  return raw.toUpperCase();
}

function requestGE750Reconnect(options = {}) {
  let requestedPort;
  if (typeof options === "string") {
    requestedPort = options;
  } else if (options && typeof options === "object") {
    requestedPort = options.port ?? options.ge750_port ?? options.selectedPort;
  }

  if (requestedPort !== undefined) {
    state.manualPreferredPort = normalizeManualPort(requestedPort);
  }

  state.reason = state.manualPreferredPort
    ? `manual_reconnect:${state.manualPreferredPort}`
    : "manual_reconnect";
  safeStopCurrent();
  scheduleReconnect("manual_reconnect", 200);
  return getGE750Status();
}

function getGE750Status() {
  return {
    ...state,
    fingerprint_configured: hasFingerprint(),
    fingerprint: {
      vid: FINGERPRINT.vid || null,
      pid: FINGERPRINT.pid || null,
      serial: FINGERPRINT.serial || null,
      manufacturer: FINGERPRINT.manufacturer || null,
      pnpId: FINGERPRINT.pnpId || null,
    },
  };
}

startGE750Manager();

module.exports = {
  startGE750Manager,
  stopGE750Manager,
  requestGE750Reconnect,
  getGE750Status,
};
