const path = require("path");
const fs = require("fs");
const http = require("http");
const { spawn } = require("child_process");
const os = require("os");
const { app, BrowserWindow, dialog, ipcMain, shell } = require("electron");

// Enable Chrome-style print preview
app.commandLine.appendSwitch("enable-print-browser");

const BACKEND_PORT = Number(process.env.AIDAS_BACKEND_PORT || 3001);
const BACKEND_HEALTH_URL = `http://127.0.0.1:${BACKEND_PORT}/health`;
const PORJAI_ROOT = String(process.env.PORJAI_ROOT || "C:\\porjai").trim();

// Resolve assets dir — when packaged (asar), assets are unpacked next to the
// asar archive so native image loading can read them from real disk.
const APP_ASSETS_DIR = path.join(
  __dirname.includes("app.asar")
    ? __dirname.replace("app.asar", "app.asar.unpacked")
    : __dirname,
  "assets"
);
const APP_ICON_ICO_PATH = path.join(APP_ASSETS_DIR, "aidas-app.ico");
const APP_ICON_PNG_PATH = path.join(APP_ASSETS_DIR, "aidas-app.png");
const APP_ICON_PATH = fs.existsSync(APP_ICON_ICO_PATH)
  ? APP_ICON_ICO_PATH
  : APP_ICON_PNG_PATH;

// Set AUMID synchronously before app is ready — required for correct Windows
// taskbar icon grouping and pinned-app display.
if (process.platform === "win32") {
  app.setAppUserModelId("com.aidas.desktop");
}
const REPORT_PDF_LIGHT_CSS = `
html, body {
  background: #ffffff !important;
  color: #111827 !important;
}

.report-root,
.report-page,
.report-page * {
  color: #111827 !important;
  background-image: none !important;
  text-shadow: none !important;
}

.report-root {
  background: #ffffff !important;
}

.report-toolbar,
.param-picker-panel {
  display: none !important;
}

.report-page,
.report-timeline-readonly,
.report-page header,
.report-page section,
.report-page article,
.report-page .rounded,
.report-page .border,
.report-page [class*="border-"] {
  background: #ffffff !important;
  border-color: #6b7280 !important;
  box-shadow: none !important;
}

.report-page .text-gray-400,
.report-page .text-gray-500,
.report-page .text-gray-600,
.report-page .dark\\:text-gray-400 {
  color: #374151 !important;
}

.report-page .bg-blue-100,
.report-page .dark\\:bg-blue-900\\/40 {
  background: #e5e7eb !important;
  color: #111827 !important;
}

.report-root input[type="checkbox"] {
  accent-color: #2563eb !important;
}

@page {
  margin: 6mm;
}
`;

let backendProcess = null;
let mainWindow = null;
const generatedPreviewFiles = new Set();

function sanitizeFileBaseName(value) {
  const raw = String(value || "").trim();
  if (!raw) return "aidas-report-preview";
  return raw.replace(/[^a-z0-9_\-\.]+/gi, "_").slice(0, 80) || "aidas-report-preview";
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

function resolveBackendRuntime() {
  const configured = String(process.env.AIDAS_NODE_BIN || "").trim();
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

function isBackendRunning() {
  return new Promise(resolve => {
    const req = http.get(BACKEND_HEALTH_URL, res => {
      const ok = res.statusCode && res.statusCode >= 200 && res.statusCode < 300;
      res.resume();
      resolve(Boolean(ok));
    });
    req.on("error", () => resolve(false));
    req.setTimeout(1500, () => {
      req.destroy();
      resolve(false);
    });
  });
}

async function waitForBackend(maxAttempts = 25, intervalMs = 300) {
  for (let i = 0; i < maxAttempts; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    const ok = await isBackendRunning();
    if (ok) return true;
    // eslint-disable-next-line no-await-in-loop
    await new Promise(resolve => setTimeout(resolve, intervalMs));
  }
  return false;
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
  return path.join(resolveProjectRoot(), "frontend-v2", "dist", "index.html");
}

function resolveDbPath() {
  if (process.env.FLORA_DB_PATH) return process.env.FLORA_DB_PATH;
  if (process.env.AIDAS_DB_PATH) return process.env.AIDAS_DB_PATH;
  if (!app.isPackaged) return path.join(resolveProjectRoot(), "data", "flora.db");
  return path.join(PORJAI_ROOT, "data", "flora.db");
}

function startBackend() {
  if (backendProcess) return;
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
    IVY_READ_URL: process.env.IVY_READ_URL || "http://127.0.0.1:3000/api/observations",
  };

  backendProcess = spawn(
    runtime.command,
    [...runtime.argsPrefix, backendEntry],
    {
    cwd: backendRoot,
    env: childEnv,
    stdio: "inherit",
    windowsHide: true,
  });

  console.log(
    `[AIDAS] backend spawn mode=${runtime.mode} command=${runtime.command}`,
  );

  backendProcess.on("exit", () => {
    backendProcess = null;
  });

  backendProcess.on("error", err => {
    backendProcess = null;
    dialog.showErrorBox(
      "AIDAS Backend Spawn Error",
      `${err.message}\n\nbackend=${backendEntry}\nmode=${runtime.mode}\ncommand=${runtime.command}`,
    );
  });
}

function stopBackend() {
  if (!backendProcess) return;
  try {
    backendProcess.kill();
  } catch {
    // ignore
  } finally {
    backendProcess = null;
  }
}

async function createMainWindow() {
  startBackend();
  const backendReady = await waitForBackend();
  if (!backendReady) {
    const message =
      `Backend did not become ready at ${BACKEND_HEALTH_URL}.\n` +
      "Check backend logs in terminal.";
    await dialog.showErrorBox("AIDAS Backend Error", message);
  }

  const win = new BrowserWindow({
    width: 1680,
    height: 980,
    minWidth: 1280,
    minHeight: 760,
    autoHideMenuBar: true,
    title: "Aidas",
    icon: fs.existsSync(APP_ICON_PATH) ? APP_ICON_PATH : undefined,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  mainWindow = win;

  const devUrl = process.env.AIDAS_FRONTEND_URL || process.env.VITE_DEV_SERVER_URL;
  if (devUrl) {
    await win.loadURL(devUrl);
  } else {
    const indexFile = resolveFrontendIndex();
    if (!fs.existsSync(indexFile)) {
      await dialog.showErrorBox(
        "AIDAS Frontend Not Built",
        `Cannot find frontend build:\n${indexFile}\n\nRun: npm run desktop:build:web`,
      );
    }
    await win.loadFile(indexFile);
  }

  win.on("closed", () => {
    if (mainWindow === win) mainWindow = null;
  });
}

app.whenReady().then(async () => {
  ipcMain.handle("aidas:report:print-dialog", async (event) => {
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
              marginType: "none",
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

  ipcMain.handle("aidas:report:generate-pdf", async (event, payload) => {
    const webContents = event.sender;
    const base = sanitizeFileBaseName(payload && payload.fileBaseName);
    let cssKey = null;
    try {
      cssKey = await webContents.insertCSS(REPORT_PDF_LIGHT_CSS);
      const pdfBuffer = await webContents.printToPDF({
        printBackground: true,
        preferCSSPageSize: true,
        margins: {
          top: 0,
          bottom: 0,
          left: 0,
          right: 0,
        },
      });
      return {
        ok: true,
        fileName: `${base}.pdf`,
        pdfBase64: pdfBuffer.toString("base64"),
      };
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

  ipcMain.handle("aidas:report:preview-pdf", async (event, payload) => {
    const webContents = event.sender;
    const base = sanitizeFileBaseName(payload && payload.fileBaseName);
    const outPath = path.join(
      os.tmpdir(),
      `${base}-${Date.now()}.pdf`,
    );
    let cssKey = null;
    let pdfBuffer = null;
    try {
      cssKey = await webContents.insertCSS(REPORT_PDF_LIGHT_CSS);
      pdfBuffer = await webContents.printToPDF({
        printBackground: true,
        preferCSSPageSize: true,
        margins: {
          top: 0,
          bottom: 0,
          left: 0,
          right: 0,
        },
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
    fs.writeFileSync(outPath, pdfBuffer);
    generatedPreviewFiles.add(outPath);
    const openError = await shell.openPath(outPath);
    if (openError) {
      throw new Error(openError);
    }
    return { ok: true, path: outPath };
  });

  await createMainWindow();

  app.on("activate", async () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      await createMainWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  cleanupGeneratedPreviewFiles();
  stopBackend();
});
