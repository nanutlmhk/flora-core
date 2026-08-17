const { contextBridge, webFrame, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("aidasDesktop", {
  isElectron: true,
  platform: process.platform,
  getEditionInfo: () => ({
    code: ipcRenderer.sendSync("aidas:app:get-edition-code"),
    productName: ipcRenderer.sendSync("aidas:app:get-product-name"),
    version: ipcRenderer.sendSync("aidas:app:get-version"),
  }),
  setZoomLevel: (level) => webFrame.setZoomLevel(level),
  getZoomLevel: () => webFrame.getZoomLevel(),
  getBootstrapStatus: () =>
    ipcRenderer.invoke("aidas:bootstrap:get-status"),
  retryBootstrapStart: () =>
    ipcRenderer.invoke("aidas:bootstrap:retry-start"),
  runBootstrapSafeRecovery: () =>
    ipcRenderer.invoke("aidas:bootstrap:safe-recovery"),
  stopBootstrapBackend: () =>
    ipcRenderer.invoke("aidas:bootstrap:stop-backend"),
  onShutdownRequested: (callback) => {
    if (typeof callback !== "function") return () => {};
    const listener = () => callback();
    ipcRenderer.on("aidas:app:shutdown-request", listener);
    return () => ipcRenderer.removeListener("aidas:app:shutdown-request", listener);
  },
  shutdownApp: () =>
    ipcRenderer.invoke("aidas:app:shutdown"),
  printReport: () =>
    ipcRenderer.invoke("aidas:report:print-dialog"),
  generateReportPdf: (payload) =>
    ipcRenderer.invoke("aidas:report:generate-pdf", payload || {}),
  openReportPdfPreview: (payload) =>
    ipcRenderer.invoke("aidas:report:preview-pdf", payload || {}),
});
