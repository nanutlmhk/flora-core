const fs = require("fs");
const path = require("path");

const CONFIG_PATH = path.join(__dirname, "config.local.json");

let localConfig = {};

function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      const raw = fs.readFileSync(CONFIG_PATH, "utf8");
      localConfig = JSON.parse(raw);
      console.log("[IVY] Local config loaded from config.local.json");
    }
  } catch (err) {
    console.error("[IVY] Failed to load config.local.json:", err.message);
  }
}

function getSetting(key, envFallback) {
  return localConfig[key] !== undefined ? localConfig[key] : process.env[envFallback];
}

function isServiceEnabled(serviceName) {
  // Production lock: Ivy supports only GE750 serial + HL7 monitor listeners.
  // Any other service type (e.g. GES5) is intentionally disabled.
  const normalized = String(serviceName || "").trim().toUpperCase();
  return normalized === "GE750" || normalized === "HL7";
}

loadConfig();

module.exports = {
  getSetting,
  isServiceEnabled,
  CONFIG_PATH,
  reload: loadConfig
};
