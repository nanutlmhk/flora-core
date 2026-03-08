const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("hidroNode", {
  getStatus: () => ipcRenderer.invoke("hidro:node-status"),
  control: (action) => ipcRenderer.invoke("hidro:node-control", action),
  getLogs: (kind) => ipcRenderer.invoke("hidro:node-logs", kind),
});
