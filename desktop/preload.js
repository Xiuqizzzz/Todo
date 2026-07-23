const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("sticker", {
  hide: () => ipcRenderer.send("hide-window"),
  quit: () => ipcRenderer.send("quit-app"),
  setSize: (w, h) => ipcRenderer.send("set-size", { w, h }),
  // Menu-bar badge: { count, overdue } — count shown next to the icon,
  // overdue>0 swaps to the amber alert icon.
  setBadge: (info) => ipcRenderer.send("set-badge", info),
  // Ask the main process to show a native macOS notification.
  notify: (title, body) => ipcRenderer.send("notify", { title, body }),
  // Read persisted prefs (currently { notify: bool }).
  getPrefs: () => ipcRenderer.invoke("get-prefs"),
  // Fired when the user toggles notifications from the tray menu.
  onNotifyPref: (cb) => ipcRenderer.on("notif-pref", (e, v) => cb(v)),
});
