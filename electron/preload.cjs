const { contextBridge, webFrame, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("aidasDesktop", {
  isElectron: true,
  platform: process.platform,
  setZoomLevel: (level) => webFrame.setZoomLevel(level),
  getZoomLevel: () => webFrame.getZoomLevel(),
  printReport: () =>
    ipcRenderer.invoke("aidas:report:print-dialog"),
  generateReportPdf: (payload) =>
    ipcRenderer.invoke("aidas:report:generate-pdf", payload || {}),
  openReportPdfPreview: (payload) =>
    ipcRenderer.invoke("aidas:report:preview-pdf", payload || {}),
});
