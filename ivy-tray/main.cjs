const http = require("http");
const { execFile, spawn } = require("child_process");
const path = require("path");
const fs = require("fs");
const {
  app,
  Tray,
  Menu,
  nativeImage,
  BrowserWindow,
  shell,
  Notification,
  screen,
  ipcMain,
} = require("electron");

const APP_NAME = "Hidro";
const PORJAI_ROOT = String(process.env.PORJAI_ROOT || "C:\\porjai").trim();

// Resolve assets dir — when packaged (asar), assets are unpacked next to the
// asar archive so native image loading can read them from real disk.
const APP_ASSETS_DIR = path.join(
  __dirname.includes("app.asar")
    ? __dirname.replace("app.asar", "app.asar.unpacked")
    : __dirname,
  "assets"
);
const APP_ICON_ICO_PATH = path.join(APP_ASSETS_DIR, "hidro-app.ico");
const APP_ICON_PNG_PATH = path.join(APP_ASSETS_DIR, "hidro-app.png");
const APP_ICON_PATH = fs.existsSync(APP_ICON_ICO_PATH)
  ? APP_ICON_ICO_PATH
  : APP_ICON_PNG_PATH;
const APP_DIR_BASENAME = "Hidro";

// Force Hidro to use its own writable profile/cache paths.
// This avoids cache lock/permission collisions with shared Electron defaults.
try {
  const localBase =
    process.env.LOCALAPPDATA || process.env.APPDATA || path.resolve(__dirname, "..");
  const forcedUserData = String(
    process.env.HIDRO_USER_DATA_DIR || path.join(localBase, APP_DIR_BASENAME),
  ).trim();
  const forcedSessionData = String(
    process.env.HIDRO_SESSION_DATA_DIR || path.join(forcedUserData, "Session"),
  ).trim();
  const forcedCacheDir = String(
    process.env.HIDRO_CACHE_DIR || path.join(forcedUserData, "Cache"),
  ).trim();

  fs.mkdirSync(forcedUserData, { recursive: true });
  fs.mkdirSync(forcedSessionData, { recursive: true });
  fs.mkdirSync(forcedCacheDir, { recursive: true });

  app.setPath("userData", forcedUserData);
  app.setPath("sessionData", forcedSessionData);
  app.commandLine.appendSwitch("disk-cache-dir", forcedCacheDir);
} catch (err) {
  console.warn(`[Hidro] failed to set dedicated cache/userData paths: ${err.message}`);
}

// Set AUMID synchronously before app is ready — required for correct Windows
// taskbar icon grouping and pinned-app display.
if (process.platform === "win32") {
  app.setAppUserModelId("com.aidas.hidrotray");
}

const IVY_BASE_URL = (process.env.IVY_BASE_URL || "http://127.0.0.1:3000").replace(/\/+$/, "");
const IVY_SERVICE_NAME = process.env.IVY_SERVICE_NAME || "IvyCaptureService";
const POLL_MS = Number(process.env.IVY_TRAY_POLL_MS || 5000);
const ENABLE_LOGIN_START =
  String(process.env.IVY_TRAY_AUTO_LOGIN || "").trim() === "1" || app.isPackaged;
const AUTO_START_NODE =
  String(process.env.IVY_TRAY_AUTOSTART_NODE || "1").trim() === "1";
const HIDRO_TEST_MODE =
  String(process.env.HIDRO_TEST_MODE || (app.isPackaged ? "0" : "1")).trim() === "1";

const PACKAGED_BUNDLED_NODE_SCRIPT = path.join(process.resourcesPath || "", "ivy", "server.js");
const PACKAGED_EXTERNAL_NODE_SCRIPT = path.join(PORJAI_ROOT, "ivy", "server.js");
const DEFAULT_NODE_SCRIPT = app.isPackaged
  ? (fs.existsSync(PACKAGED_BUNDLED_NODE_SCRIPT)
      ? PACKAGED_BUNDLED_NODE_SCRIPT
      : PACKAGED_EXTERNAL_NODE_SCRIPT)
  : path.resolve(__dirname, "..", "ivy", "server.js");
const IVY_NODE_EXE = String(process.env.IVY_NODE_EXE || "node").trim() || "node";
const IVY_NODE_SCRIPT = String(process.env.IVY_NODE_SCRIPT || DEFAULT_NODE_SCRIPT).trim();
const IVY_NODE_WORKDIR = String(
  process.env.IVY_NODE_WORKDIR || (IVY_NODE_SCRIPT ? path.dirname(IVY_NODE_SCRIPT) : ""),
).trim();
const IVY_NODE_PORT = String(process.env.IVY_NODE_PORT || "3000").trim() || "3000";
const IVY_NODE_PID_FILE = String(
  process.env.IVY_NODE_PID_FILE || path.join(app.getPath("userData"), "ivy-node.pid"),
).trim();
const IVY_NODE_LOG_DIR = String(
  process.env.IVY_NODE_LOG_DIR || path.join(app.getPath("userData"), "logs"),
).trim();

let tray = null;
let statusWindow = null;
let pollTimer = null;
const iconCache = new Map();

const EXPECTED_LOGICAL = [
  { id: "patient_monitor", label: "Patient Monitor" },
  { id: "anesthesia_machine", label: "Anesthesia Machine" },
  { id: "infusion_pump", label: "Infusion Pump" },
];

const state = {
  ivyReachable: false,
  lastObservationTs: null,
  logical: {
    patient_monitor: { online: false, lastSeenTs: null },
    anesthesia_machine: { online: false, lastSeenTs: null },
    infusion_pump: { online: false, lastSeenTs: null },
  },
  lastError: null,
  updatedAt: null,
};

function getTrayIconSize() {
  if (process.platform === "win32") return 16;
  try {
    const scale = Number(screen.getPrimaryDisplay()?.scaleFactor || 1);
    if (scale >= 1.5) return 24;
    if (scale >= 1.25) return 20;
    return 16;
  } catch {
    return 16;
  }
}

function createFallbackDotIcon(colorHex, size = 24) {
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 64 64">
      <circle cx="32" cy="32" r="18" fill="${colorHex}" />
      <circle cx="32" cy="32" r="8" fill="#ffffff66" />
    </svg>
  `;
  return nativeImage
    .createFromDataURL(`data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`)
    .resize({ width: size, height: size });
}

function loadIconAsset(filename, fallbackColor) {
  const size = getTrayIconSize();
  const cacheKey = `${filename}-${size}`;
  if (iconCache.has(cacheKey)) return iconCache.get(cacheKey);

  const iconPath = path.join(APP_ASSETS_DIR, filename);
  let img;
  if (fs.existsSync(iconPath)) {
    img = nativeImage.createFromPath(iconPath);
    if (img.isEmpty()) img = null;
  }
  
  if (!img) {
    img = createFallbackDotIcon(fallbackColor, size);
  } else {
    img = img.resize({ width: size, height: size });
  }

  iconCache.set(cacheKey, img);
  return img;
}

function currentIcon() {
  if (!state.ivyReachable) return loadIconAsset("hidro-red.png", "#ef4444");
  const anyOnline = EXPECTED_LOGICAL.some((d) => state.logical[d.id]?.online);
  if (anyOnline) return loadIconAsset("hidro-green.png", "#22c55e");
  return loadIconAsset("hidro-amber.png", "#f59e0b");
}

function relativeAgeMs(ts) {
  if (!ts) return null;
  return Date.now() - Number(ts);
}

function formatAge(ts) {
  const ageMs = relativeAgeMs(ts);
  if (ageMs == null || !Number.isFinite(ageMs)) return "n/a";
  const sec = Math.max(0, Math.floor(ageMs / 1000));
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  return `${hr}h ago`;
}

function httpGetJson(url, timeoutMs = 2000) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        const body = Buffer.concat(chunks).toString("utf8");
        if (res.statusCode < 200 || res.statusCode >= 300) {
          reject(new Error(`HTTP ${res.statusCode}: ${body.slice(0, 200)}`));
          return;
        }
        try {
          resolve(JSON.parse(body));
        } catch (err) {
          reject(new Error(`Invalid JSON from ${url}: ${err.message}`));
        }
      });
    });
    req.on("error", reject);
    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error(`timeout after ${timeoutMs}ms`));
    });
  });
}

function httpPostJson(url, body, timeoutMs = 2200) {
  return new Promise((resolve, reject) => {
    const payload = Buffer.from(JSON.stringify(body || {}), "utf8");
    const parsed = new URL(url);
    const req = http.request(
      {
        method: "POST",
        protocol: parsed.protocol,
        hostname: parsed.hostname,
        port: parsed.port,
        path: `${parsed.pathname}${parsed.search}`,
        headers: {
          "Content-Type": "application/json",
          "Content-Length": String(payload.length),
        },
      },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          if (res.statusCode < 200 || res.statusCode >= 300) {
            reject(new Error(`HTTP ${res.statusCode}: ${text.slice(0, 200)}`));
            return;
          }
          try {
            resolve(JSON.parse(text || "{}"));
          } catch (err) {
            reject(new Error(`Invalid JSON from ${url}: ${err.message}`));
          }
        });
      }
    );
    req.on("error", reject);
    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error(`timeout after ${timeoutMs}ms`));
    });
    req.write(payload);
    req.end();
  });
}

async function isIvyHealthReachable(timeoutMs = 1400) {
  try {
    await httpGetJson(`${IVY_BASE_URL}/health`, timeoutMs);
    return true;
  } catch {
    return false;
  }
}

function notify(title, body) {
  const n = new Notification({ title, body });
  n.show();
}

function runSc(args) {
  return new Promise((resolve, reject) => {
    execFile("sc.exe", args, { windowsHide: true }, (err, stdout, stderr) => {
      if (err) {
        reject(new Error((stderr || stdout || err.message || "").trim()));
        return;
      }
      resolve((stdout || "").trim());
    });
  });
}

function runTaskkill(pid) {
  return new Promise((resolve, reject) => {
    execFile(
      "taskkill.exe",
      ["/PID", String(pid), "/T", "/F"],
      { windowsHide: true },
      (err, stdout, stderr) => {
        if (err) {
          reject(new Error((stderr || stdout || err.message || "").trim()));
          return;
        }
        resolve((stdout || "").trim());
      },
    );
  });
}

function readNodePidMeta() {
  try {
    if (!fs.existsSync(IVY_NODE_PID_FILE)) return null;
    const raw = fs.readFileSync(IVY_NODE_PID_FILE, "utf8");
    const data = JSON.parse(raw);
    if (!data || typeof data !== "object") return null;
    if (!Number.isFinite(Number(data.pid))) return null;
    return {
      pid: Number(data.pid),
      startedAt: Number(data.startedAt) || null,
      exe: String(data.exe || ""),
      script: String(data.script || ""),
      workdir: String(data.workdir || ""),
    };
  } catch {
    return null;
  }
}

function writeNodePidMeta(meta) {
  try {
    fs.mkdirSync(path.dirname(IVY_NODE_PID_FILE), { recursive: true });
    fs.writeFileSync(IVY_NODE_PID_FILE, JSON.stringify(meta, null, 2), "utf8");
  } catch {
    // ignore
  }
}

function clearNodePidMeta() {
  try {
    if (fs.existsSync(IVY_NODE_PID_FILE)) {
      fs.unlinkSync(IVY_NODE_PID_FILE);
    }
  } catch {
    // ignore
  }
}

function isPidRunning(pid) {
  if (!Number.isFinite(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function getNodeModeStatus() {
  const configured = Boolean(IVY_NODE_SCRIPT);
  const scriptExists = configured && fs.existsSync(IVY_NODE_SCRIPT);
  const meta = readNodePidMeta();
  const running = Boolean(meta && isPidRunning(meta.pid));

  if (meta && !running) {
    clearNodePidMeta();
  }

  return {
    configured,
    scriptExists,
    running,
    pid: running ? meta.pid : null,
    script: IVY_NODE_SCRIPT || null,
    workdir: IVY_NODE_WORKDIR || null,
  };
}

async function controlNode(action) {
  const status = getNodeModeStatus();

  try {
    if (!status.configured) {
      throw new Error("Feed service script is not configured");
    }

    if (!status.scriptExists) {
      throw new Error(`Feed service script not found: ${IVY_NODE_SCRIPT}`);
    }

      if (action === "start") {
        if (status.running) {
        notify(`${APP_NAME} Feed Service`, `Already running (PID ${status.pid})`);
        return;
      }

      if (await isIvyHealthReachable()) {
        clearNodePidMeta();
        notify(`${APP_NAME} Feed Service`, `Already running on ${IVY_BASE_URL}`);
        return;
      }

      fs.mkdirSync(IVY_NODE_LOG_DIR, { recursive: true });
      const outLog = path.join(IVY_NODE_LOG_DIR, "ivy-node.out.log");
      const errLog = path.join(IVY_NODE_LOG_DIR, "ivy-node.err.log");
      const outFd = fs.openSync(outLog, "a");
      const errFd = fs.openSync(errLog, "a");

      const child = spawn(IVY_NODE_EXE, [IVY_NODE_SCRIPT], {
        cwd: IVY_NODE_WORKDIR || path.dirname(IVY_NODE_SCRIPT),
        env: {
          ...process.env,
          PORT: IVY_NODE_PORT,
        },
        detached: true,
        windowsHide: true,
        stdio: ["ignore", outFd, errFd],
      });

      child.unref();

      writeNodePidMeta({
        pid: child.pid,
        startedAt: Date.now(),
        exe: IVY_NODE_EXE,
        script: IVY_NODE_SCRIPT,
        workdir: IVY_NODE_WORKDIR || path.dirname(IVY_NODE_SCRIPT),
      });

      notify(`${APP_NAME} Feed Service`, `Start requested (PID ${child.pid})`);
      return;
    }

    if (action === "stop") {
      const meta = readNodePidMeta();
      if (!meta || !isPidRunning(meta.pid)) {
        clearNodePidMeta();
        notify(`${APP_NAME} Feed Service`, "Already stopped");
        return;
      }

      await runTaskkill(meta.pid).catch(() => null);
      clearNodePidMeta();
      notify(`${APP_NAME} Feed Service`, `Stopped (PID ${meta.pid})`);
      return;
    }

    if (action === "restart") {
      const meta = readNodePidMeta();
      if (meta && isPidRunning(meta.pid)) {
        await runTaskkill(meta.pid).catch(() => null);
        clearNodePidMeta();
        await new Promise((r) => setTimeout(r, 600));
      } else if (await isIvyHealthReachable()) {
        clearNodePidMeta();
        notify(
          `${APP_NAME} Feed Service`,
          `Already running on ${IVY_BASE_URL} (external process)`
        );
        return;
      }

      fs.mkdirSync(IVY_NODE_LOG_DIR, { recursive: true });
      const outLog = path.join(IVY_NODE_LOG_DIR, "ivy-node.out.log");
      const errLog = path.join(IVY_NODE_LOG_DIR, "ivy-node.err.log");
      const outFd = fs.openSync(outLog, "a");
      const errFd = fs.openSync(errLog, "a");

      const child = spawn(IVY_NODE_EXE, [IVY_NODE_SCRIPT], {
        cwd: IVY_NODE_WORKDIR || path.dirname(IVY_NODE_SCRIPT),
        env: {
          ...process.env,
          PORT: IVY_NODE_PORT,
        },
        detached: true,
        windowsHide: true,
        stdio: ["ignore", outFd, errFd],
      });

      child.unref();

      writeNodePidMeta({
        pid: child.pid,
        startedAt: Date.now(),
        exe: IVY_NODE_EXE,
        script: IVY_NODE_SCRIPT,
        workdir: IVY_NODE_WORKDIR || path.dirname(IVY_NODE_SCRIPT),
      });

      notify(`${APP_NAME} Feed Service`, `Restarted (PID ${child.pid})`);
    }
  } catch (err) {
    notify(`${APP_NAME} Feed Service Failed`, `${action} failed\n${err.message}`);
  } finally {
    setTimeout(() => {
      void refreshStatus();
    }, 500);
  }
}

async function controlService(action) {
  try {
    if (action === "restart") {
      await runSc(["stop", IVY_SERVICE_NAME]).catch(() => null);
      await new Promise((r) => setTimeout(r, 1500));
      await runSc(["start", IVY_SERVICE_NAME]);
      notify(`${APP_NAME} Service`, "Restart command sent");
      return;
    }
    if (action === "start") {
      await runSc(["start", IVY_SERVICE_NAME]);
      notify(`${APP_NAME} Service`, "Start command sent");
      return;
    }
    if (action === "stop") {
      await runSc(["stop", IVY_SERVICE_NAME]);
      notify(`${APP_NAME} Service`, "Stop command sent");
    }
  } catch (err) {
    notify(
      `${APP_NAME} Service Action Failed`,
      `${action} failed. Run tray as Administrator if service control is blocked.\n${err.message}`
    );
  } finally {
    void refreshStatus();
  }
}

async function reconnectDevices(target = "all") {
  try {
    await httpPostJson(`${IVY_BASE_URL}/api/admin/reconnect`, { target });
    notify(`${APP_NAME} Devices`, `Reconnect requested (${target})`);
  } catch (err) {
    notify(`${APP_NAME} Reconnect Failed`, err.message);
  } finally {
    void refreshStatus();
  }
}

function statusLine() {
  if (!state.ivyReachable) return `${APP_NAME}: Offline`;
  return `${APP_NAME}: Online`;
}

function tooltipText() {
  if (!state.ivyReachable) return `${APP_NAME} offline`;
  const pm = state.logical.patient_monitor?.online ? "On" : "Off";
  const am = state.logical.anesthesia_machine?.online ? "On" : "Off";
  const pump = state.logical.infusion_pump?.online ? "On" : "Off";
  const last = formatAge(state.lastObservationTs);
  return `${APP_NAME} | PM:${pm} AM:${am} Pump:${pump} | last ${last}`;
}

function labelStatus(id) {
  return state.logical[id]?.online ? "online" : "offline";
}

function applyLogicalFromStatus(dev) {
  const next = {
    patient_monitor: { online: false, lastSeenTs: null },
    anesthesia_machine: { online: false, lastSeenTs: null },
    infusion_pump: { online: false, lastSeenTs: null },
  };

  for (const item of dev?.logical_devices || []) {
    const id = String(item?.id || "");
    if (!Object.prototype.hasOwnProperty.call(next, id)) continue;
    next[id] = {
      online: Boolean(item?.is_online),
      lastSeenTs: item?.last_seen_ts || null,
    };
  }

  if (HIDRO_TEST_MODE && dev?.liveagent?.online) {
    next.patient_monitor.online = true;
    next.anesthesia_machine.online = true;
  }

  state.logical = next;
}

function getNodeLogPaths() {
  return {
    outLog: path.join(IVY_NODE_LOG_DIR, "ivy-node.out.log"),
    errLog: path.join(IVY_NODE_LOG_DIR, "ivy-node.err.log"),
  };
}

function readTailFromFile(filePath, maxLines = 150, maxBytes = 262144) {
  try {
    if (!fs.existsSync(filePath)) {
      return { exists: false, text: "", filePath };
    }

    const stat = fs.statSync(filePath);
    const start = Math.max(0, stat.size - Math.max(4096, maxBytes));
    const fd = fs.openSync(filePath, "r");
    try {
      const len = stat.size - start;
      const buf = Buffer.alloc(Math.max(0, len));
      if (len > 0) {
        fs.readSync(fd, buf, 0, len, start);
      }
      const text = buf
        .toString("utf8")
        .split(/\r?\n/)
        .slice(-Math.max(20, maxLines))
        .join("\n");
      return { exists: true, text, filePath };
    } finally {
      fs.closeSync(fd);
    }
  } catch (err) {
    return { exists: false, text: `log read failed: ${err.message}`, filePath };
  }
}

function registerIpcHandlers() {
  ipcMain.handle("hidro:node-status", async () => {
    const node = getNodeModeStatus();
    const logs = getNodeLogPaths();
    return {
      node,
      logs,
      baseUrl: IVY_BASE_URL,
      serviceName: IVY_SERVICE_NAME,
      appName: APP_NAME,
    };
  });

  ipcMain.handle("hidro:node-control", async (_evt, action) => {
    const act = String(action || "").toLowerCase();
    if (!["start", "stop", "restart"].includes(act)) {
      throw new Error("invalid action");
    }
    await controlNode(act);
    return {
      node: getNodeModeStatus(),
      logs: getNodeLogPaths(),
    };
  });

  ipcMain.handle("hidro:node-logs", async (_evt, kind = "out") => {
    const logs = getNodeLogPaths();
    const key = String(kind || "out").toLowerCase() === "err" ? "err" : "out";
    const filePath = key === "err" ? logs.errLog : logs.outLog;
    const tail = readTailFromFile(filePath, 180, 512000);
    return {
      kind: key,
      ...tail,
    };
  });
}
function createStatusWindow() {
  if (statusWindow && !statusWindow.isDestroyed()) {
    return statusWindow;
  }

  statusWindow = new BrowserWindow({
    width: 540,
    height: 620,
    minWidth: 520,
    minHeight: 560,
    title: APP_NAME,
    icon: fs.existsSync(APP_ICON_PATH) ? APP_ICON_PATH : undefined,
    autoHideMenuBar: true,
    resizable: true,
    show: false, // Start hidden
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      preload: path.join(__dirname, "preload.cjs"),
    },
  });

  statusWindow.loadFile(path.join(__dirname, "status.html"), {
    query: {
      base: IVY_BASE_URL,
      svc: IVY_SERVICE_NAME,
      app: APP_NAME,
      test: HIDRO_TEST_MODE ? "1" : "0",
    },
  });

  statusWindow.on("close", (e) => {
    if (!app.isQuitting) {
      e.preventDefault();
      statusWindow.hide();
    }
    return false;
  });

  return statusWindow;
}

function openStatusWindow() {
  if (!statusWindow || statusWindow.isDestroyed()) {
    createStatusWindow();
  }
  statusWindow.show();
  statusWindow.focus();
}

function updateTrayMenu() {
  if (!tray) return;

  const icon = currentIcon();
  tray.setImage(icon);
  tray.setToolTip(tooltipText());

  const nodeStatus = getNodeModeStatus();
  const nodeStateText =
    !nodeStatus.configured
      ? "not configured"
      : nodeStatus.running
      ? `running (PID ${nodeStatus.pid})`
      : nodeStatus.scriptExists
      ? "stopped"
      : "script missing";

  const template = [
    { label: statusLine(), enabled: false },
    { label: `Patient Monitor: ${labelStatus("patient_monitor")}`, enabled: false },
    { label: `Anesthesia Machine: ${labelStatus("anesthesia_machine")}`, enabled: false },
    { label: `Infusion Pump: ${labelStatus("infusion_pump")}`, enabled: false },
    {
      label: state.lastObservationTs ? `Last data: ${formatAge(state.lastObservationTs)}` : "Last data: n/a",
      enabled: false,
    },
    { label: `Feed Service: ${nodeStateText}`, enabled: false },
    { type: "separator" },
    { label: `Open ${APP_NAME} Monitor`, click: () => openStatusWindow() },
    { label: `Open ${APP_NAME} Health`, click: () => shell.openExternal(`${IVY_BASE_URL}/health`) },
    { label: `Open ${APP_NAME} Services`, click: () => shell.openExternal(`${IVY_BASE_URL}/api/admin/services`) },
    { type: "separator" },
    { label: "Start Feed Service", enabled: nodeStatus.configured && nodeStatus.scriptExists, click: () => controlNode("start") },
    { label: "Stop Feed Service", enabled: nodeStatus.configured, click: () => controlNode("stop") },
    { label: "Restart Feed Service", enabled: nodeStatus.configured && nodeStatus.scriptExists, click: () => controlNode("restart") },
    { type: "separator" },
    { label: "Quit Tray", click: () => app.quit() },
  ];

  tray.setContextMenu(Menu.buildFromTemplate(template));
}

async function refreshStatus() {
  try {
    await httpGetJson(`${IVY_BASE_URL}/health`, 1800);
    const dev = await httpGetJson(`${IVY_BASE_URL}/api/devices/status`, 2200);

    state.ivyReachable = true;
    state.lastObservationTs = dev?.summary?.last_observation_ts || null;
    applyLogicalFromStatus(dev);
    state.updatedAt = Date.now();
    state.lastError = null;
  } catch (err) {
    state.ivyReachable = false;
    state.logical = {
      patient_monitor: { online: false, lastSeenTs: null },
      anesthesia_machine: { online: false, lastSeenTs: null },
      infusion_pump: { online: false, lastSeenTs: null },
    };
    state.lastError = err.message;
    state.updatedAt = Date.now();
  }

  updateTrayMenu();
}

app.on("before-quit", () => {
  app.isQuitting = true;
  if (pollTimer) clearInterval(pollTimer);
});

app.whenReady().then(() => {
  registerIpcHandlers();

  if (ENABLE_LOGIN_START) {
    app.setLoginItemSettings({
      openAtLogin: true,
      openAsHidden: true,
    });
  }

  createStatusWindow();

  if (AUTO_START_NODE) {
    setTimeout(() => {
      void (async () => {
        const node = getNodeModeStatus();
        if (node.running) return;
        if (await isIvyHealthReachable()) {
          clearNodePidMeta();
          await refreshStatus();
          return;
        }
        await controlNode("start");
      })();
    }, 400);
  }

  tray = new Tray(currentIcon());
  tray.setToolTip(`${APP_NAME} monitor`);
  
  // On Windows, single click usually shows context menu. 
  // If we want it to open the window, we keep the click listener.
  // But we make it fast by using the pre-created window.
  tray.on("double-click", () => openStatusWindow());
  tray.on("click", () => openStatusWindow());

  // Non-blocking refresh
  void refreshStatus();
  pollTimer = setInterval(() => {
    void refreshStatus();
  }, Math.max(1500, POLL_MS));
});

app.on("window-all-closed", (e) => {
  e.preventDefault();
});



