const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("sticker", {
  hide: () => ipcRenderer.send("hide-window"),
  quit: () => ipcRenderer.send("quit-app"),
  setSize: (w, h) => ipcRenderer.send("set-size", { w, h }),
});
