const { SerialPort } = require("serialport");
const CFG = require("./config");
const { startGES5Service } = require("./index");
const Settings = require("../settings");

const RETRY_MS = Number(Settings.getSetting("GES5_RECONNECT_MS", "GES5_RECONNECT_MS") || 3000);
const AUTO_PICK_FIRST = String(Settings.getSetting("GES5_AUTO_PICK_FIRST", "GES5_AUTO_PICK_FIRST") || "1") !== "0";
const db = require("../db");
const { emitIvyPayload } = require("../emitter");

const FINGERPRINT = {
  vid: String(Settings.getSetting("GES5_USB_VID", "GES5_USB_VID") || "").trim().toLowerCase(),
  pid: String(Settings.getSetting("GES5_USB_PID", "GES5_USB_PID") || "").trim().toLowerCase(),
  serial: String(Settings.getSetting("GES5_USB_SERIAL", "GES5_USB_SERIAL") || "").trim().toLowerCase(),
  manufacturer: String(Settings.getSetting("GES5_USB_MANUFACTURER", "GES5_USB_MANUFACTURER") || "").trim().toLowerCase(),
  pnpId: String(Settings.getSetting("GES5_USB_PNPID", "GES5_USB_PNPID") || "").trim().toLowerCase(),
};

const PORT_HINT = String(Settings.getSetting("GES5_PORT_HINT", "GES5_PORT_HINT") || "").trim().toLowerCase();
const STRONG_HINTS = ["ge", "b650", "aisys", "datex", "ohmeda", "s5", "s/5"];
const SERIAL_HINTS = ["usb serial", "ftdi", "prolific", "silabs", "cp210", "wch", "ch340"];

const SOURCE = "ges5";
const PROTOCOL = "ges5_serial";
const DEVICE_ID = String(Settings.getSetting("IVY_GES5_DEVICE_ID", "IVY_GES5_DEVICE_ID") || "GE_S5_MONITOR").trim();

const state = {
  running: false,
  connecting: false,
  connected: false,
  currentPort: null,
  lastBoundPort: null,
  lastConnectAt: null,
  lastPacketAt: null,
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

function normalizeHex(value) {
  return String(value || "").trim().toLowerCase().replace(/^0x/, "");
}

function hasFingerprint() {
  return Boolean(FINGERPRINT.vid || FINGERPRINT.pid || FINGERPRINT.serial);
}

function matchesFingerprint(portInfo) {
  if (!hasFingerprint()) return false;
  const vid = normalizeHex(portInfo.vendorId);
  const pid = normalizeHex(portInfo.productId);
  if (FINGERPRINT.vid && vid !== normalizeHex(FINGERPRINT.vid)) return false;
  if (FINGERPRINT.pid && pid !== normalizeHex(FINGERPRINT.pid)) return false;
  return true;
}

function scorePort(portInfo) {
  const text = [portInfo.path, portInfo.manufacturer, portInfo.friendlyName, portInfo.pnpId]
    .filter(Boolean).join(" ").toLowerCase();
  let score = 0;
  if (matchesFingerprint(portInfo)) score += 1000;
  for (const hint of STRONG_HINTS) if (text.includes(hint)) score += 120;
  for (const hint of SERIAL_HINTS) if (text.includes(hint)) score += 40;
  if (PORT_HINT && text.includes(PORT_HINT)) score += 80;
  return score;
}

async function pickPort() {
  const ports = await SerialPort.list();
  state.detectedPorts = ports.map(p => p.path);
  
  const configured = String(Settings.getSetting("GES5_PORT", "GES5_PORT") || "").trim();
  if (configured.toUpperCase() === "NONE" || configured.toUpperCase() === "OFF") {
    return { port: null, reason: "disabled_by_config" };
  }

  const manual = String(state.manualPreferredPort || "").trim();
  if (manual && state.detectedPorts.includes(manual)) return { port: manual, reason: "manual" };
  if (configured && state.detectedPorts.includes(configured)) return { port: configured, reason: "config" };

  const ranked = [...ports].sort((a, b) => scorePort(b) - scorePort(a));
  if (ranked.length > 0) {
    const top = ranked[0];
    if (scorePort(top) > 0 || AUTO_PICK_FIRST) {
        return { port: top.path, reason: "auto_detect" };
    }
  }
  return { port: null, reason: "not_found" };
}

function scheduleReconnect(reason) {
  if (!state.running) return;
  state.connecting = false;
  state.connected = false;
  state.nextReconnectAt = Date.now() + RETRY_MS;
  reconnectTimer = setTimeout(() => connectOnce(reason), RETRY_MS);
}

async function connectOnce(trigger) {
  if (!state.running || state.connecting) return;
  state.connecting = true;
  const picked = await pickPort();
  if (!picked.port) {
    if (picked.reason !== "disabled_by_config") {
        scheduleReconnect(picked.reason);
    } else {
        state.connecting = false;
        console.log("[GES5] service disabled via configuration.");
    }
    return;
  }

  controller = startGES5Service({
    port: picked.port,
    onOpen: () => {
      state.connecting = false;
      state.connected = true;
      state.currentPort = picked.port;
      console.log(`[GES5] connected on ${picked.port}`);
    },
    onPacket: (payload) => {
      state.lastPacketAt = Date.now();
    },
    onError: (err) => {
      state.lastError = err.message;
      scheduleReconnect("error");
    },
  });
}

function startGES5Manager() {
  if (started) return;
  if (!Settings.isServiceEnabled("GES5")) {
    console.log("[GES5] Manager idle (not the active device type)");
    return;
  }
  started = true;
  state.running = true;
  connectOnce("startup");
}

function getGES5Status() { return { ...state }; }

startGES5Manager();

module.exports = { startGES5Manager, getGES5Status };
