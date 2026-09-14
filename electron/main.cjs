const path = require("path");
const fs = require("fs");
const http = require("http");
const { spawn, spawnSync } = require("child_process");
const os = require("os");
const { app, BrowserWindow, dialog, ipcMain, shell } = require("electron");
const { buildReportPdfBuffer } = require("./reportPdf.cjs");
const packageJson = require("../package.json");

const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
}

// Enable Chrome-style print preview
app.commandLine.appendSwitch("enable-print-browser");

const BACKEND_PORT = Number(process.env.FLORA_BACKEND_PORT || 3001);
const BACKEND_HEALTH_URLS = [
  `http://127.0.0.1:${BACKEND_PORT}/health`,
  `http://localhost:${BACKEND_PORT}/health`,
];
const INSTALL_ROOT = app.isPackaged
  ? path.dirname(process.execPath)
  : path.resolve(__dirname, "..");
const PORJAI_ROOT = String(process.env.PORJAI_ROOT || INSTALL_ROOT).trim();

function resolveEditionCode() {
  const raw = String(process.env.FLORA_EDITION || packageJson.floraEdition || "full")
    .trim()
    .toLowerCase();
  if (raw === "rcat") return "rcat";
  if (raw === "eforl" || raw === "e-for-l" || raw === "e_for_l") return "eforl";
  return "full";
}

const EDITION_CODE = resolveEditionCode();
const EDITION_CONFIG = {
  full: {
    productName: "Flora",
    windowTitle: "Flora",
    appUserModelId: "com.flora.desktop",
    appDirBasename: "FloraDesktop",
  },
  rcat: {
    productName: "Flora RCAT",
    windowTitle: "Flora RCAT",
    appUserModelId: "com.flora.rcat.desktop",
    appDirBasename: "FloraDesktopRCAT",
  },
  eforl: {
    productName: "Flora EforL",
    windowTitle: "Flora EforL",
    appUserModelId: "com.flora.eforl.desktop",
    appDirBasename: "FloraDesktopEforL",
  },
}[EDITION_CODE];
const APP_DIR_BASENAME = EDITION_CONFIG.appDirBasename;

// Force FLORA to use dedicated writable profile/cache paths.
// This avoids cache lock/permission collisions with shared Electron defaults.
try {
  const localBase =
    process.env.LOCALAPPDATA || process.env.APPDATA || path.resolve(__dirname, "..");
  const forcedUserData = String(
    process.env.FLORA_USER_DATA_DIR || path.join(localBase, APP_DIR_BASENAME),
  ).trim();
  const forcedSessionData = String(
    process.env.FLORA_SESSION_DATA_DIR || path.join(forcedUserData, "Session"),
  ).trim();
  const forcedCacheDir = String(
    process.env.FLORA_CACHE_DIR || path.join(forcedUserData, "Cache"),
  ).trim();

  fs.mkdirSync(forcedUserData, { recursive: true });
  fs.mkdirSync(forcedSessionData, { recursive: true });
  fs.mkdirSync(forcedCacheDir, { recursive: true });

  app.setPath("userData", forcedUserData);
  app.setPath("sessionData", forcedSessionData);
  app.commandLine.appendSwitch("disk-cache-dir", forcedCacheDir);
} catch (err) {
  console.warn(`[FLORA] failed to set dedicated cache/userData paths: ${err.message}`);
}

// Resolve assets dir — when packaged (asar), assets are unpacked next to the
// asar archive so native image loading can read them from real disk.
const APP_ASSETS_DIR = path.join(
  __dirname.includes("app.asar")
    ? __dirname.replace("app.asar", "app.asar.unpacked")
    : __dirname,
  "assets"
);
const APP_ICON_ICO_PATH = path.join(APP_ASSETS_DIR, "flora-app.ico");
const APP_ICON_PNG_PATH = path.join(APP_ASSETS_DIR, "flora-app.png");
const APP_ICON_PATH = fs.existsSync(APP_ICON_ICO_PATH)
  ? APP_ICON_ICO_PATH
  : APP_ICON_PNG_PATH;

// Set AUMID synchronously before app is ready — required for correct Windows
// taskbar icon grouping and pinned-app display.
if (process.platform === "win32") {
  app.setAppUserModelId(EDITION_CONFIG.appUserModelId);
}
const REPORT_PDF_LIGHT_CSS = `
html, body {
  background: #ffffff !important;
  color: #0f172a !important;
  width: auto !important;
  height: auto !important;
  min-height: 0 !important;
  overflow: visible !important;
}

#root,
.app-shell,
.app-shell > *,
.app-main,
.report-root,
.report-document,
.report-pages {
  background: #ffffff !important;
  color: #0f172a !important;
  width: auto !important;
  max-width: none !important;
  min-height: 0 !important;
  height: auto !important;
  margin: 0 !important;
  padding: 0 !important;
  overflow: visible !important;
  box-shadow: none !important;
}

.report-root,
.report-document,
.report-page,
.report-sheet,
.report-page *,
.report-sheet * {
  color: #0f172a !important;
  background-image: none !important;
  text-shadow: none !important;
}

.report-root {
  background: #ffffff !important;
  width: 100% !important;
}

.report-document {
  background: #ffffff !important;
  width: 100% !important;
}

.app-topbar,
.app-rail,
.report-toolbar,
.param-picker-panel {
  display: none !important;
  width: 0 !important;
  min-width: 0 !important;
  max-width: 0 !important;
  border: 0 !important;
  box-shadow: none !important;
}

.report-pages {
  display: block !important;
  width: 100% !important;
}

.report-document {
  display: block !important;
  width: 100% !important;
}

.report-pages > .report-page + .report-page {
  margin-top: 0 !important;
}

.report-document > .report-sheet + .report-sheet {
  margin-top: 0 !important;
}

.report-page,
.report-sheet,
.report-timeline-readonly,
.report-page header,
.report-sheet header,
.report-page section,
.report-sheet section,
.report-page article,
.report-sheet article,
.report-page .rounded,
.report-sheet .rounded,
.report-page .border,
.report-sheet .border,
.report-page [class*="border-"],
.report-sheet [class*="border-"] {
  background: #ffffff !important;
  border-color: #1f2937 !important;
  box-shadow: none !important;
}

.report-page {
  display: flex !important;
  flex-direction: column !important;
  width: 100% !important;
  max-width: none !important;
  min-height: 281mm !important;
  margin: 0 !important;
  padding: 0 !important;
  break-after: page !important;
  page-break-after: always !important;
  overflow: visible !important;
}

.report-sheet {
  display: flex !important;
  flex-direction: column !important;
  width: 100% !important;
  max-width: none !important;
  min-height: 281mm !important;
  margin: 0 !important;
  padding: 0 !important;
  break-after: page !important;
  page-break-after: always !important;
  overflow: visible !important;
}

.report-page:last-child {
  break-after: auto !important;
  page-break-after: auto !important;
}

.report-sheet:last-child {
  break-after: auto !important;
  page-break-after: auto !important;
}

.report-page .text-gray-400,
.report-page .text-gray-500,
.report-page .text-gray-600,
.report-page .dark\\:text-gray-400 {
  color: #334155 !important;
}

.report-page .bg-blue-100,
.report-page .dark\\:bg-blue-900\\/40 {
  background: #d1d5db !important;
  color: #0f172a !important;
}

.report-root input[type="checkbox"] {
  accent-color: #2563eb !important;
}

@page {
  size: A4 portrait;
  margin: 8mm;
}
`;

let backendProcess = null;
let mainWindow = null;
let lastBackendHealthFailure = "";
let lastBackendExitDetail = "";
const generatedPreviewFiles = new Set();
const bootstrapLogLines = [];
let bootstrapBackendState = "idle";
let bootstrapLastError = "";
let bootstrapRecoveryApplied = false;
let bootstrapLastRecoveryAction = "";
let bootstrapPromise = null;
let caseLookupDb = undefined;
const caseHnCache = new Map();
let isAppQuitting = false;
let shutdownFlowInProgress = false;
const bangkokTimestampFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Bangkok",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});

function formatBangkokTimestamp(value = Date.now()) {
  const ts = typeof value === "number" ? value : Date.parse(String(value || ""));
  if (!Number.isFinite(ts)) return bangkokTimestampFormatter.format(Date.now()).replace(",", "");
  return bangkokTimestampFormatter.format(ts).replace(",", "");
}

function getCaseLookupDb() {
  if (caseLookupDb !== undefined) return caseLookupDb;
  try {
    // Reuse backend's bundled sqlite dependency so lookup works in both dev and packaged builds.
    // This is read-only and only used to translate case ids into HN for UI diagnostics.
    // eslint-disable-next-line global-require, import/no-dynamic-require
    const Database = require(path.join(resolveBackendRoot(), "node_modules", "better-sqlite3"));
    caseLookupDb = new Database(resolveDbPath(), { readonly: true, fileMustExist: false });
  } catch {
    caseLookupDb = null;
  }
  return caseLookupDb;
}

function lookupHnByCaseId(caseId) {
  const normalized = Number(caseId);
  if (!Number.isInteger(normalized) || normalized <= 0) return null;
  if (caseHnCache.has(normalized)) return caseHnCache.get(normalized) || null;
  try {
    const db = getCaseLookupDb();
    if (!db) return null;
    const row = db.prepare("SELECT hn FROM cases WHERE id = ? LIMIT 1").get(normalized);
    const hn = row && row.hn ? String(row.hn).trim() : "";
    caseHnCache.set(normalized, hn || null);
    return hn || null;
  } catch {
    return null;
  }
}

function formatCaseLabel(caseId) {
  const hn = lookupHnByCaseId(caseId);
  return hn ? `HN=${hn}` : `HN=?`;
}

function formatRetryDelay(ms) {
  const value = Number(ms);
  if (!Number.isFinite(value) || value <= 0) return "";
  const sec = Math.round(value / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  const remain = sec % 60;
  return remain > 0 ? `${min}m ${remain}s` : `${min}m`;
}

function normalizeBootstrapMessage(rawMessage) {
  let message = String(rawMessage || "").trim();
  if (!message) return "";

  const embeddedTsMatch = message.match(/^\[([0-9]{4}-[0-9]{2}-[0-9]{2}T[^\]]+)\]\s*(.*)$/);
  if (embeddedTsMatch) {
    message = embeddedTsMatch[2].trim();
  }

  message = message.replace(/^\[backend\]\s*/i, "");
  message = message.replace(/\bivy\b/gi, "Hidro");

  if (/^Flora backend running on /i.test(message)) {
    return "Backend running";
  }
  if (/^\[BOOT\]\s+FLORA_DB_PATH=/i.test(message)) {
    return "Database path ready";
  }
  if (/^\[BOOT\]\s+IVY_READ_URL=/i.test(message)) {
    return "Hidro feed path ready";
  }
  const activeCasesMatch = message.match(/^\[BOOT\]\s+active cases = (\d+)/i);
  if (activeCasesMatch) {
    return `Active cases: ${activeCasesMatch[1]}`;
  }

  const ivyOfflineMatch = message.match(/^\[MINUTE\]\s+ivy offline case=(\d+).*?retry_in_ms=(\d+)/i);
  if (ivyOfflineMatch) {
    return `Hidro offline | ${formatCaseLabel(ivyOfflineMatch[1])} | retry ${formatRetryDelay(ivyOfflineMatch[2])}`;
  }

  const minuteStartMatch = message.match(/^\[MINUTE\]\s+start case=(\d+)/i);
  if (minuteStartMatch) {
    return `Minute writer started | ${formatCaseLabel(minuteStartMatch[1])}`;
  }

  const bulkFetchMatch = message.match(/^\[MINUTE\]\s+bulk fetch case=(\d+)/i);
  if (bulkFetchMatch) {
    return `Backfill started | ${formatCaseLabel(bulkFetchMatch[1])}`;
  }

  const minuteSavedMatch = message.match(/^\[MINUTE\]\s+saved case=(\d+).*?rows=(\d+)/i);
  if (minuteSavedMatch) {
    return `Minute data saved | ${formatCaseLabel(minuteSavedMatch[1])} | rows ${minuteSavedMatch[2]}`;
  }

  const tickFailedMatch = message.match(/^\[MINUTE\]\s+tick failed case=(\d+)/i);
  if (tickFailedMatch) {
    return `Minute update delayed | ${formatCaseLabel(tickFailedMatch[1])}`;
  }

  message = message.replace(/\[MINUTE\]\s*/g, "");
  message = message.replace(/\bcase=(\d+)/gi, (_, caseId) => formatCaseLabel(caseId));
  message = message.replace(/\bfetch failed: fetch failed\b/gi, "Hidro offline");
  message = message.replace(/\berror=/gi, "");
  message = message.replace(/\s{2,}/g, " ").replace(/\s+\|/g, " |").trim();
  return message;
}

function appendBootstrapLog(line) {
  const text = String(line || "").trim();
  if (!text) return;
  let timestamp = formatBangkokTimestamp(Date.now());
  const embeddedTsMatch = text.match(/^\[([0-9]{4}-[0-9]{2}-[0-9]{2}T[^\]]+)\]/);
  if (embeddedTsMatch) {
    timestamp = formatBangkokTimestamp(embeddedTsMatch[1]);
  }
  const normalized = normalizeBootstrapMessage(text);
  if (!normalized) return;
  bootstrapLogLines.push(`[${timestamp}] ${normalized}`);
  if (bootstrapLogLines.length > 120) {
    bootstrapLogLines.splice(0, bootstrapLogLines.length - 120);
  }
}

function resolveIvyReadUrl() {
  return process.env.IVY_READ_URL || "http://127.0.0.1:6789/api/observations";
}

function resolveIvyHealthUrl() {
  try {
    const url = new URL(resolveIvyReadUrl());
    return `${url.protocol}//${url.host}/health`;
  } catch {
    return "";
  }
}

function readStreamLines(stream, prefix) {
  if (!stream) return;
  let buffered = "";
  stream.on("data", chunk => {
    buffered += String(chunk || "");
    const parts = buffered.split(/\r?\n/);
    buffered = parts.pop() || "";
    for (const part of parts) {
      appendBootstrapLog(`${prefix}${part}`);
    }
  });
  stream.on("end", () => {
    const text = buffered.trim();
    if (text) appendBootstrapLog(`${prefix}${text}`);
  });
}

async function getBootstrapStatus() {
  const dbPath = resolveDbPath();
  const ivyHealthUrl = resolveIvyHealthUrl();
  const ivyReadUrl = resolveIvyReadUrl();
  let ivyState = "unknown";
  if (ivyHealthUrl) {
    try {
      const ivyResult = await probeBackendHealth(ivyHealthUrl, 1200);
      if (ivyResult.ok) {
        ivyState = "connected";
      } else if (ivyReadUrl) {
        const ivyReadResult = await probeBackendHealth(ivyReadUrl, 1200);
        ivyState = ivyReadResult.ok ? "connected" : "disconnected";
      } else {
        ivyState = "disconnected";
      }
    } catch {
      if (ivyReadUrl) {
        try {
          const ivyReadResult = await probeBackendHealth(ivyReadUrl, 1200);
          ivyState = ivyReadResult.ok ? "connected" : "disconnected";
        } catch {
          ivyState = "disconnected";
        }
      } else {
        ivyState = "disconnected";
      }
    }
  }

  return {
    phase: bootstrapBackendState === "running" ? "ready" : "bootstrap",
    backendState: bootstrapBackendState,
    ready: bootstrapBackendState === "running",
    lastError: bootstrapLastError,
    lastHealthFailure: lastBackendHealthFailure,
    lastExitDetail: lastBackendExitDetail,
    dbPath,
    dbExists: fs.existsSync(dbPath),
    dbWalExists: fs.existsSync(`${dbPath}-wal`),
    dbShmExists: fs.existsSync(`${dbPath}-shm`),
    ivyReadUrl,
    ivyHealthUrl,
    ivyState,
    healthUrls: [...BACKEND_HEALTH_URLS],
    uncleanRecoveryApplied: bootstrapRecoveryApplied,
    lastRecoveryAction: bootstrapLastRecoveryAction,
    logs: [...bootstrapLogLines],
    updatedAt: Date.now(),
  };
}

function sanitizeFileBaseName(value) {
  const raw = String(value || "").trim();
  if (!raw) return "flora-report-preview";
  return raw.replace(/[^a-z0-9_\-\.]+/gi, "_").slice(0, 80) || "flora-report-preview";
}

function cleanupGeneratedPreviewFiles() {
  for (const filePath of generatedPreviewFiles) {
    try {
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    } catch {
      // ignore cleanup failures
    }
  }
  generatedPreviewFiles.clear();
}

function resolveBackendPidFile() {
  const explicit = String(process.env.FLORA_BACKEND_PID_FILE || "").trim();
  if (explicit) return explicit;
  return path.join(app.getPath("userData"), "flora-backend.pid");
}

function readRecordedBackendPid() {
  try {
    const raw = fs.readFileSync(resolveBackendPidFile(), "utf8").trim();
    const pid = Number(raw);
    return Number.isInteger(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

function writeRecordedBackendPid(pid) {
  try {
    fs.writeFileSync(resolveBackendPidFile(), String(pid));
  } catch (err) {
    console.warn(`[FLORA] failed to persist backend pid: ${err.message}`);
  }
}

function clearRecordedBackendPid() {
  try {
    fs.rmSync(resolveBackendPidFile(), { force: true });
  } catch {
    // ignore cleanup failures
  }
}

function resolveUncleanShutdownMarkerFile() {
  return path.join(app.getPath("userData"), "flora-unclean-shutdown.json");
}

function markUncleanStartup() {
  try {
    fs.writeFileSync(
      resolveUncleanShutdownMarkerFile(),
      JSON.stringify({ startedAt: Date.now(), pid: process.pid }, null, 2),
    );
  } catch (err) {
    console.warn(`[FLORA] failed to write unclean-shutdown marker: ${err.message}`);
  }
}

function clearUncleanStartupMarker() {
  try {
    fs.rmSync(resolveUncleanShutdownMarkerFile(), { force: true });
  } catch {
    // ignore cleanup failures
  }
}

function hadUncleanShutdown() {
  try {
    return fs.existsSync(resolveUncleanShutdownMarkerFile());
  } catch {
    return false;
  }
}

function clearDirectoryContentsSafe(dirPath) {
  try {
    if (fs.existsSync(dirPath)) {
      fs.rmSync(dirPath, { recursive: true, force: true });
    }
    fs.mkdirSync(dirPath, { recursive: true });
  } catch (err) {
    console.warn(`[FLORA] failed to clear directory ${dirPath}: ${err.message}`);
  }
}

async function runUncleanStartupRecovery() {
  if (!hadUncleanShutdown()) return false;
  console.warn("[FLORA] previous run ended unexpectedly; applying startup recovery");
  appendBootstrapLog("Detected previous unclean shutdown; applying startup recovery");
  bootstrapBackendState = "recovering";
  bootstrapRecoveryApplied = true;
  bootstrapLastRecoveryAction = "auto-recovery";
  clearRecordedBackendPid();
  terminatePortListeners(BACKEND_PORT);
  clearDirectoryContentsSafe(app.getPath("sessionData"));
  clearDirectoryContentsSafe(
    String(process.env.FLORA_CACHE_DIR || path.join(app.getPath("userData"), "Cache")),
  );
  await new Promise(resolve => setTimeout(resolve, 400));
  return true;
}

function isPidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function terminateRecordedBackendIfNeeded() {
  const pid = readRecordedBackendPid();
  if (!pid || pid === process.pid) return false;
  if (!isPidAlive(pid)) {
    clearRecordedBackendPid();
    return false;
  }

  try {
    process.kill(pid);
  } catch (err) {
    console.warn(`[FLORA] failed to stop recorded backend pid=${pid}: ${err.message}`);
    return false;
  }

  for (let i = 0; i < 20; i += 1) {
    if (!isPidAlive(pid)) {
      clearRecordedBackendPid();
      return true;
    }
    // eslint-disable-next-line no-await-in-loop
    await new Promise(resolve => setTimeout(resolve, 150));
  }

  return false;
}

function terminatePortListeners(port) {
  if (process.platform !== "win32") return false;

  const script = [
    "$ErrorActionPreference = 'SilentlyContinue'",
    `$listenerPids = @(Get-NetTCPConnection -State Listen -LocalPort ${Number(port) || 0} | Select-Object -ExpandProperty OwningProcess -Unique)`,
    "foreach ($listenerPid in $listenerPids) {",
    "  if ($listenerPid -gt 0 -and $listenerPid -ne $PID) {",
    "    try { Stop-Process -Id $listenerPid -Force -ErrorAction SilentlyContinue } catch {}",
    "  }",
    "}",
  ].join("; ");

  try {
    const result = spawnSync("powershell", ["-ExecutionPolicy", "Bypass", "-Command", script], {
      windowsHide: true,
      stdio: "ignore",
    });
    return result.status === 0;
  } catch {
    return false;
  }
}

function resolveBackendRuntime() {
  const configured = String(process.env.FLORA_NODE_BIN || "").trim();
  if (configured) {
    return {
      command: configured,
      argsPrefix: [],
      envPatch: {},
      mode: "configured",
    };
  }

  // Use system Node in both dev and packaged mode.
  // This deployment expects Node.js to be installed on client PCs.
  return {
    command: "node",
    argsPrefix: [],
    envPatch: {},
    mode: app.isPackaged ? "packaged-node" : "dev-node",
  };
}

function probeBackendHealth(url, timeoutMs = 4000) {
  return new Promise(resolve => {
    const req = http.get(url, res => {
      const ok = res.statusCode && res.statusCode >= 200 && res.statusCode < 300;
      const detail = ok
        ? `OK ${res.statusCode}`
        : `HTTP ${res.statusCode || "unknown"}`;
      res.resume();
      resolve({ ok: Boolean(ok), url, detail });
    });
    req.on("error", err => {
      resolve({ ok: false, url, detail: err?.message || "request unavailable" });
    });
    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error(`timeout after ${timeoutMs}ms`));
    });
  });
}

async function isBackendRunning() {
  const failures = [];
  const results = await Promise.all(BACKEND_HEALTH_URLS.map(url => probeBackendHealth(url, 2000)));
  for (const result of results) {
    if (result.ok) {
      lastBackendHealthFailure = "";
      return true;
    }
    failures.push(`${result.url} -> ${result.detail}`);
  }
  lastBackendHealthFailure = failures.join("\n");
  return false;
}

async function waitForBackend(maxAttempts = 40, intervalMs = 500) {
  for (let i = 0; i < maxAttempts; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    const ok = await isBackendRunning();
    if (ok) return true;
    // eslint-disable-next-line no-await-in-loop
    await new Promise(resolve => setTimeout(resolve, intervalMs));
  }
  return false;
}

async function recoverIfBackendAlreadyHealthy(reason) {
  const healthy = await isBackendRunning();
  if (!healthy) return false;
  bootstrapBackendState = "running";
  bootstrapLastError = "";
  lastBackendExitDetail = "";
  appendBootstrapLog(`Backend already healthy; reusing existing service (${reason})`);
  console.warn(`[FLORA] backend already healthy; reusing existing service (${reason})`);
  return true;
}

function resolveProjectRoot() {
  return path.resolve(__dirname, "..");
}

function resolveBackendRoot() {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, "backend");
  }
  return path.join(resolveProjectRoot(), "backend");
}

function resolveBackendEntry() {
  return path.join(resolveBackendRoot(), "server.js");
}

function resolveFrontendIndex() {
  return path.join(resolveProjectRoot(), "frontend", "dist", "index.html");
}

function resolveDbPath() {
  if (process.env.FLORA_DB_PATH) return process.env.FLORA_DB_PATH;
  if (!app.isPackaged) return path.join(resolveProjectRoot(), "data", "flora.db");
  return path.join(INSTALL_ROOT, "flora.db");
}

function ensurePackagedDb() {
  if (!app.isPackaged || process.env.FLORA_DB_PATH) return;

  const dbPath = resolveDbPath();
  if (fs.existsSync(dbPath)) return;

  const seedPath = path.join(process.resourcesPath, "seed", "flora.db");
  if (!fs.existsSync(seedPath)) {
    throw new Error(`Bundled database seed not found: ${seedPath}`);
  }

  fs.copyFileSync(seedPath, dbPath, fs.constants.COPYFILE_EXCL);
  console.log(`[FLORA] installed database seed: ${dbPath}`);
}

async function startBackend() {
  if (backendProcess) return;
  await terminateRecordedBackendIfNeeded();
  if (await isBackendRunning()) {
    bootstrapBackendState = "running";
    bootstrapLastError = "";
    appendBootstrapLog(`Backend already running on port ${BACKEND_PORT}; reusing existing process`);
    console.log(`[FLORA] backend already running on port ${BACKEND_PORT}; reusing existing process`);
    return;
  }
  if (false && await isBackendRunning()) {
    console.log(`[FLORA] backend already running on port ${BACKEND_PORT} — reusing orphaned process`);
    return;
  }
  const backendRoot = resolveBackendRoot();
  const backendEntry = resolveBackendEntry();
  if (!fs.existsSync(backendEntry)) {
    throw new Error(`Backend entry not found: ${backendEntry}`);
  }
  const runtime = resolveBackendRuntime();
  const childEnv = {
    ...process.env,
    ...runtime.envPatch,
    PORT: String(BACKEND_PORT),
    PORJAI_ROOT,
    FLORA_DB_PATH: resolveDbPath(),
    IVY_READ_URL: process.env.IVY_READ_URL || "http://127.0.0.1:6789/api/observations",
  };

  backendProcess = spawn(
    runtime.command,
    [...runtime.argsPrefix, backendEntry],
    {
      cwd: backendRoot,
      env: childEnv,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });

  console.log(
    `[FLORA] backend spawn mode=${runtime.mode} command=${runtime.command}`,
  );
  appendBootstrapLog(`Spawning backend (${runtime.mode}) using ${runtime.command}`);
  bootstrapBackendState = "starting";
  bootstrapLastError = "";
  lastBackendExitDetail = "";
  writeRecordedBackendPid(backendProcess.pid);
  readStreamLines(backendProcess.stdout, "[backend] ");
  readStreamLines(backendProcess.stderr, "[backend] ");

  backendProcess.on("exit", (code, signal) => {
    backendProcess = null;
    clearRecordedBackendPid();
    const detail = `backend exited before ready (code=${code == null ? "null" : code}, signal=${signal || "none"})`;
    void (async () => {
      if (await recoverIfBackendAlreadyHealthy(detail)) return;
      lastBackendExitDetail = detail;
      bootstrapBackendState = "error";
      bootstrapLastError = lastBackendExitDetail;
      appendBootstrapLog(lastBackendExitDetail);
    })();
  });

  backendProcess.on("error", err => {
    backendProcess = null;
    clearRecordedBackendPid();
    const detail = `backend start unavailable: ${err.message}`;
    void (async () => {
      if (await recoverIfBackendAlreadyHealthy(detail)) return;
      lastBackendExitDetail = detail;
      bootstrapBackendState = "error";
      bootstrapLastError = lastBackendExitDetail;
      appendBootstrapLog(lastBackendExitDetail);
    })();
  });
}

async function ensureBackendReady() {
  ensurePackagedDb();
  await startBackend();
  if (await waitForBackend()) {
    bootstrapBackendState = "running";
    bootstrapLastError = "";
    appendBootstrapLog("Backend health check passed");
    return true;
  }

  console.warn("[FLORA] backend did not become ready on first attempt; retrying once");
  appendBootstrapLog("Backend did not become ready on first attempt; retrying once");
  stopBackend();
  await terminateRecordedBackendIfNeeded();
  terminatePortListeners(BACKEND_PORT);
  await new Promise(resolve => setTimeout(resolve, 600));

  await startBackend();
  const ready = await waitForBackend();
  if (ready) {
    bootstrapBackendState = "running";
    bootstrapLastError = "";
    appendBootstrapLog("Backend health check passed after retry");
    return true;
  }
  bootstrapBackendState = "error";
  bootstrapLastError = lastBackendExitDetail || lastBackendHealthFailure || "Backend did not become ready";
  appendBootstrapLog(`Backend failed to become ready: ${bootstrapLastError}`);
  return false;
}

async function triggerBootstrap(reason = "manual") {
  if (bootstrapPromise) return bootstrapPromise;
  bootstrapPromise = (async () => {
    appendBootstrapLog(`Bootstrap requested (${reason})`);
    bootstrapBackendState = bootstrapBackendState === "recovering" ? "recovering" : "starting";
    bootstrapLastError = "";
    return ensureBackendReady();
  })();
  try {
    return await bootstrapPromise;
  } finally {
    bootstrapPromise = null;
  }
}

async function runSafeRecoveryAndBootstrap() {
  appendBootstrapLog("Running safe recovery");
  bootstrapBackendState = "recovering";
  bootstrapLastError = "";
  bootstrapRecoveryApplied = true;
  bootstrapLastRecoveryAction = "manual-safe-recovery";
  stopBackend();
  await terminateRecordedBackendIfNeeded();
  clearRecordedBackendPid();
  terminatePortListeners(BACKEND_PORT);
  clearDirectoryContentsSafe(app.getPath("sessionData"));
  clearDirectoryContentsSafe(
    String(process.env.FLORA_CACHE_DIR || path.join(app.getPath("userData"), "Cache")),
  );
  await new Promise(resolve => setTimeout(resolve, 500));
  return triggerBootstrap("safe-recovery");
}

function stopBackend() {
  if (!backendProcess) {
    terminatePortListeners(BACKEND_PORT);
    bootstrapBackendState = "stopped";
    bootstrapLastError = "";
    appendBootstrapLog("Backend stop requested");
    clearRecordedBackendPid();
    return;
  }
  try {
    backendProcess.kill();
  } catch {
    // ignore
  } finally {
    bootstrapBackendState = "stopped";
    bootstrapLastError = "";
    appendBootstrapLog("Backend process stopped");
    backendProcess = null;
    clearRecordedBackendPid();
  }
}

async function waitForBackendStopped(maxAttempts = 12, intervalMs = 150) {
  for (let i = 0; i < maxAttempts; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    const running = await isBackendRunning();
    if (!running) return true;
    // eslint-disable-next-line no-await-in-loop
    await new Promise(resolve => setTimeout(resolve, intervalMs));
  }
  return !(await isBackendRunning());
}

function showCloseConfirmWindow(parentWindow) {
  return new Promise(resolve => {
    if (!parentWindow || parentWindow.isDestroyed()) {
      resolve(false);
      return;
    }
    const script = `
      (() => {
        const existing = document.getElementById('__flora-close-overlay');
        if (existing) return Promise.resolve(false);
        return new Promise((resolve) => {
          const style = document.createElement('style');
          style.id = '__flora-close-overlay-style';
          style.textContent = \`
            #__flora-close-overlay {
              position: fixed;
              inset: 0;
              z-index: 999999;
              display: flex;
              align-items: center;
              justify-content: center;
              background: rgba(2, 10, 24, 0.56);
              backdrop-filter: blur(2px);
              font-family: "Segoe UI", "Noto Sans Thai", Tahoma, Arial, sans-serif;
            }
            #__flora-close-panel {
              width: min(520px, calc(100vw - 32px));
              border: 1px solid #335b89;
              border-radius: 18px;
              background: linear-gradient(180deg, rgba(19, 47, 82, 0.98), rgba(16, 40, 69, 0.98));
              color: #e8f1ff;
              box-shadow: 0 20px 48px rgba(0, 10, 24, 0.38);
              padding: 22px 22px 18px;
            }
            #__flora-close-panel * { box-sizing: border-box; }
            #__flora-close-head { display: flex; align-items: center; gap: 14px; margin-bottom: 14px; }
            #__flora-close-icon {
              width: 46px; height: 46px; border-radius: 14px;
              border: 1px solid rgba(105, 201, 255, 0.28);
              background: linear-gradient(180deg, rgba(34, 87, 141, 0.9), rgba(20, 56, 97, 0.9));
              display: inline-flex; align-items: center; justify-content: center;
              color: #69c9ff; font-size: 22px; flex: 0 0 auto;
            }
            #__flora-close-title { font-size: 26px; font-weight: 700; line-height: 1.05; }
            #__flora-close-subtitle { margin-top: 4px; color: #adc3e3; font-size: 14px; }
            #__flora-close-body {
              border: 1px solid rgba(51, 91, 137, 0.6);
              background: rgba(11, 31, 55, 0.64);
              border-radius: 14px;
              padding: 15px 16px;
            }
            #__flora-close-message { font-size: 18px; font-weight: 600; margin-bottom: 8px; }
            #__flora-close-detail { color: #adc3e3; font-size: 14px; line-height: 1.45; }
            #__flora-close-progress {
              display: none;
              margin-top: 18px;
              border: 1px solid rgba(51, 91, 137, 0.6);
              border-radius: 14px;
              background: rgba(11, 31, 55, 0.64);
              padding: 14px 16px;
            }
            #__flora-close-progress.is-visible { display: block; }
            .__flora-progress-title {
              font-size: 14px; font-weight: 700; color: #adc3e3; text-transform: uppercase; letter-spacing: .08em; margin-bottom: 10px;
            }
            .__flora-progress-row {
              display: flex; align-items: center; justify-content: space-between; gap: 12px;
              font-size: 15px; padding: 8px 0; border-top: 1px solid rgba(51, 91, 137, 0.36);
            }
            .__flora-progress-row:first-of-type { border-top: 0; padding-top: 0; }
            .__flora-progress-label { color: #e8f1ff; font-weight: 600; }
            .__flora-progress-value { color: #adc3e3; }
            .__flora-progress-value.is-done { color: #8ff3c3; }
            #__flora-close-actions {
              margin-top: 18px; display: flex; justify-content: flex-end; gap: 10px;
            }
            #__flora-close-actions button {
              appearance: none; border-radius: 12px; border: 1px solid #335b89; min-width: 122px;
              padding: 11px 16px; font: inherit; font-size: 15px; font-weight: 600; cursor: pointer;
              color: #e8f1ff; background: rgba(17, 43, 75, 0.92);
            }
            #__flora-close-confirm {
              border-color: rgba(255, 123, 123, 0.45) !important;
              color: #ffd0d0 !important;
            }
            #__flora-close-actions button:disabled { opacity: .6; cursor: not-allowed; }
          \`;
          document.head.appendChild(style);
          const overlay = document.createElement('div');
          overlay.id = '__flora-close-overlay';
          overlay.innerHTML = \`
            <div id="__flora-close-panel" role="dialog" aria-modal="true" aria-labelledby="__flora-close-title">
              <div id="__flora-close-head">
                <div id="__flora-close-icon">⚠</div>
                <div>
                  <div id="__flora-close-title">Close FLORA?</div>
                  <div id="__flora-close-subtitle">Protect the workstation from accidental close.</div>
                </div>
              </div>
              <div id="__flora-close-body">
                <div id="__flora-close-message">This will close FLORA on this workstation.</div>
                <div id="__flora-close-detail">Use Cancel to keep working. Choose Close FLORA only if you really want to exit.</div>
              </div>
              <div id="__flora-close-progress">
                <div class="__flora-progress-title">Closing FLORA</div>
                <div class="__flora-progress-row">
                  <div class="__flora-progress-label">Backend</div>
                  <div id="__flora-close-backend" class="__flora-progress-value">Waiting</div>
                </div>
                <div class="__flora-progress-row">
                  <div class="__flora-progress-label">Database</div>
                  <div id="__flora-close-database" class="__flora-progress-value">Waiting</div>
                </div>
              </div>
              <div id="__flora-close-actions">
                <button id="__flora-close-cancel" type="button">Cancel</button>
                <button id="__flora-close-confirm" type="button">Close FLORA</button>
              </div>
            </div>
          \`;
          const cleanup = (value) => {
            document.removeEventListener('keydown', onKeyDown, true);
            window.__floraUpdateCloseOverlay = undefined;
            overlay.remove();
            style.remove();
            resolve(value);
          };
          const onKeyDown = (event) => {
            if (event.key === 'Escape') {
              event.preventDefault();
              cleanup(false);
            }
            if (event.key === 'Enter') {
              event.preventDefault();
              startClosing();
            }
          };
          const startClosing = () => {
            const progress = overlay.querySelector('#__flora-close-progress');
            progress.classList.add('is-visible');
            overlay.querySelector('#__flora-close-cancel').disabled = true;
            overlay.querySelector('#__flora-close-confirm').disabled = true;
            cleanup(true);
          };
          overlay.querySelector('#__flora-close-cancel').addEventListener('click', () => cleanup(false));
          overlay.querySelector('#__flora-close-confirm').addEventListener('click', startClosing);
          document.addEventListener('keydown', onKeyDown, true);
          window.__floraUpdateCloseOverlay = (payload) => {
            const progress = overlay.querySelector('#__flora-close-progress');
            progress.classList.add('is-visible');
            overlay.querySelector('#__flora-close-cancel').disabled = true;
            overlay.querySelector('#__flora-close-confirm').disabled = true;
            const backend = overlay.querySelector('#__flora-close-backend');
            const database = overlay.querySelector('#__flora-close-database');
            if (payload && payload.backend) {
              backend.textContent = payload.backend;
              backend.classList.toggle('is-done', /stopped/i.test(payload.backend));
            }
            if (payload && payload.database) {
              database.textContent = payload.database;
              database.classList.toggle('is-done', /disconnected/i.test(payload.database));
            }
          };
        });
      })();
    `;
    parentWindow.webContents.executeJavaScript(script, true)
      .then(result => resolve(Boolean(result)))
      .catch(() => resolve(false));
  });
}

function sendCloseProgress(payload) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const script = `
    (() => {
      if (typeof window.__floraUpdateCloseOverlay === "function") {
        window.__floraUpdateCloseOverlay(${JSON.stringify(payload || {})});
      }
    })();
  `;
  void mainWindow.webContents.executeJavaScript(script, true).catch(() => {});
}

function requestRendererShutdownPrompt() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
  setTimeout(() => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    mainWindow.webContents.send("flora:app:shutdown-request");
  }, 0);
}

async function performGracefulAppShutdown({ confirm = true } = {}) {
  if (shutdownFlowInProgress) {
    return { ok: false, busy: true };
  }
  shutdownFlowInProgress = true;
  try {
    if (confirm) {
      const confirmed = await showCloseConfirmWindow(mainWindow);
      if (!confirmed) {
        return { ok: false, cancelled: true };
      }
    }
    sendCloseProgress({ backend: "Stopping...", database: "Waiting..." });
    stopBackend();
    const backendStopped = await waitForBackendStopped();
    sendCloseProgress({
      backend: backendStopped ? "Stopped" : "Stopping...",
      database: backendStopped ? "Disconnecting..." : "Waiting...",
    });
    await new Promise(resolve => setTimeout(resolve, 220));
    sendCloseProgress({
      backend: "Stopped",
      database: "Disconnected",
    });
    await new Promise(resolve => setTimeout(resolve, 320));
    isAppQuitting = true;
    clearUncleanStartupMarker();
    cleanupGeneratedPreviewFiles();
    app.quit();
    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown error";
    appendBootstrapLog(`Shutdown unavailable: ${message}`);
    return { ok: false, error: message };
  } finally {
    shutdownFlowInProgress = false;
  }
}

ipcMain.on("flora:app:get-edition-code", (event) => {
  event.returnValue = EDITION_CODE;
});

ipcMain.on("flora:app:get-product-name", (event) => {
  event.returnValue = EDITION_CONFIG.productName;
});

ipcMain.on("flora:app:get-version", (event) => {
  event.returnValue = app.getVersion();
});

ipcMain.on("flora:app:get-backend-base-url", (event) => {
  event.returnValue = `http://127.0.0.1:${BACKEND_PORT}`;
});

app.on("second-instance", () => {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
});

async function createMainWindow() {
  const win = new BrowserWindow({
    width: 1680,
    height: 980,
    minWidth: 1280,
    minHeight: 760,
    autoHideMenuBar: true,
    title: EDITION_CONFIG.windowTitle,
    show: false, // show explicitly via ready-to-show so the window is always
                 // visible even when launched with SW_HIDE (e.g. from a .vbs)
    icon: fs.existsSync(APP_ICON_PATH) ? APP_ICON_PATH : undefined,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  mainWindow = win;

  // Ensure the window always becomes visible regardless of how the process was
  // spawned or whether the page load succeeds.  Multiple triggers cover the
  // normal path (ready-to-show), load-error path (did-fail-load / dom-ready)
  // and a hard timeout fallback.
  const showWindowOnce = (() => {
    let shown = false;
    return () => {
      if (shown || win.isDestroyed()) return;
      shown = true;
      win.show();
      win.focus();
    };
  })();
  win.once("ready-to-show", showWindowOnce);
  win.webContents.once("dom-ready", showWindowOnce);
  win.webContents.once("did-fail-load", showWindowOnce);
  setTimeout(showWindowOnce, 8000);

  const devUrl = process.env.FLORA_FRONTEND_URL || process.env.VITE_DEV_SERVER_URL;
  if (devUrl) {
    await win.loadURL(devUrl);
  } else {
    const indexFile = resolveFrontendIndex();
    if (!fs.existsSync(indexFile)) {
      await dialog.showErrorBox(
        "FLORA Frontend Not Built",
        `Cannot find frontend build:\n${indexFile}\n\nRun: npm run desktop:build:web`,
      );
    }
    await win.loadFile(indexFile);
  }

  win.on("close", event => {
    if (isAppQuitting) return;
    event.preventDefault();
    requestRendererShutdownPrompt();
  });

  win.on("closed", () => {
    if (mainWindow === win) mainWindow = null;
  });
}

app.whenReady().then(async () => {
  const previousRunWasUnclean = hadUncleanShutdown();
  markUncleanStartup();
  if (previousRunWasUnclean) {
    await runUncleanStartupRecovery();
  }
  ipcMain.handle("flora:bootstrap:get-status", async () => getBootstrapStatus());
  ipcMain.handle("flora:bootstrap:retry-start", async () => {
    await triggerBootstrap("manual-retry");
    return getBootstrapStatus();
  });
  ipcMain.handle("flora:bootstrap:safe-recovery", async () => {
    await runSafeRecoveryAndBootstrap();
    return getBootstrapStatus();
  });
  ipcMain.handle("flora:bootstrap:stop-backend", async () => {
    stopBackend();
    return getBootstrapStatus();
  });
  ipcMain.handle("flora:app:shutdown", async () => performGracefulAppShutdown({ confirm: false }));
  ipcMain.handle("flora:report:print-dialog", async (event) => {
    const webContents = event.sender;
    let cssKey = null;
    try {
      cssKey = await webContents.insertCSS(REPORT_PDF_LIGHT_CSS);
      return await new Promise((resolve, reject) => {
        webContents.print(
          {
            silent: false,
            printBackground: true,
            margins: {
              marginType: "default",
            },
          },
          (success, failureReason) => {
            if (!success) {
              reject(new Error(failureReason || "Print cancelled or failed"));
              return;
            }
            resolve({ ok: true });
          },
        );
      });
    } finally {
      if (cssKey) {
        try {
          await webContents.removeInsertedCSS(cssKey);
        } catch {
          // ignore cleanup failures
        }
      }
    }
  });

  ipcMain.handle("flora:report:generate-pdf", async (event, payload) => {
    const base = sanitizeFileBaseName(payload && payload.fileBaseName);
    const pdfBuffer = await buildReportPdfBuffer(payload && payload.report);
    return {
      ok: true,
      fileName: `${base}.pdf`,
      pdfBase64: pdfBuffer.toString("base64"),
    };
  });

  ipcMain.handle("flora:report:preview-pdf", async (event, payload) => {
    const base = sanitizeFileBaseName(payload && payload.fileBaseName);
    const outPath = path.join(
      os.tmpdir(),
      `${base}-${Date.now()}.pdf`,
    );
    const pdfBuffer = await buildReportPdfBuffer(payload && payload.report);
    fs.writeFileSync(outPath, pdfBuffer);
    generatedPreviewFiles.add(outPath);
    const openError = await shell.openPath(outPath);
    if (openError) {
      throw new Error(openError);
    }
    return { ok: true, path: outPath };
  });

  void triggerBootstrap(bootstrapRecoveryApplied ? "startup-recovery" : "startup");
  await createMainWindow();

  app.on("activate", async () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      await createMainWindow();
    }
    void triggerBootstrap("activate");
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  isAppQuitting = true;
  clearUncleanStartupMarker();
  cleanupGeneratedPreviewFiles();
  stopBackend();
});
