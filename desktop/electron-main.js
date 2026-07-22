const { app, BrowserWindow, Tray, Menu, ipcMain, screen, nativeImage } = require("electron");
const path = require("path");

const WIN_WIDTH = 340;
const WIN_HEIGHT = 480;

// Where the packaged app pulls its UI from. Push updates to this URL (GitHub
// Pages) and users get them on the next open — no re-packaging needed.
// In dev (`npm start`) we always load the local files for fast iteration.
// Override with STICKER_URL=... when running.
const REMOTE_URL =
  process.env.STICKER_URL || "https://xiuqizzzz.github.io/Todo/desktop/renderer/sticker.html";
const USE_REMOTE = app.isPackaged && !!REMOTE_URL;

let tray = null;
let win = null;
let loadedRemoteOnce = false;

function loadLocal() {
  win.loadFile(path.join(__dirname, "renderer", "sticker.html"));
}
function loadUI() {
  if (USE_REMOTE) {
    loadedRemoteOnce = true;
    win.loadURL(REMOTE_URL).catch(() => {
      loadedRemoteOnce = false;
      loadLocal();
    });
  } else {
    loadLocal();
  }
}

function createWindow() {
  win = new BrowserWindow({
    width: WIN_WIDTH,
    height: WIN_HEIGHT,
    show: false,
    frame: false,
    resizable: false,
    fullscreenable: false,
    movable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  loadUI();

  // If the remote load fails (offline / Pages down), fall back to the copy
  // bundled inside the app so it always opens.
  win.webContents.on("did-fail-load", (e, code, desc, url, isMainFrame) => {
    if (isMainFrame && loadedRemoteOnce) {
      loadedRemoteOnce = false;
      loadLocal();
    }
  });

  // Hide (instead of quit) when it loses focus, so it behaves like a popover.
  win.on("blur", () => {
    if (win && win.isVisible() && !win.webContents.isDevToolsOpened()) {
      win.hide();
    }
  });
}

function getWindowPosition() {
  const winBounds = win.getBounds();
  const trayBounds = tray.getBounds();
  // Center the window horizontally under the tray icon.
  let x = Math.round(trayBounds.x + trayBounds.width / 2 - winBounds.width / 2);
  let y = Math.round(trayBounds.y + trayBounds.height + 4);

  // Keep it on-screen.
  const display = screen.getDisplayNearestPoint({ x: trayBounds.x, y: trayBounds.y });
  const area = display.workArea;
  x = Math.max(area.x + 4, Math.min(x, area.x + area.width - winBounds.width - 4));
  return { x, y };
}

function showWindow() {
  const pos = getWindowPosition();
  win.setPosition(pos.x, pos.y, false);
  // Pull the latest remote UI on open. Use a hard reload (ignore cache) so the
  // HTML and its scripts are always fetched as a consistent set — a normal
  // reload can serve a stale cached sticker.js against fresh HTML (GitHub Pages
  // caches assets ~10 min), which silently breaks event wiring. Local data in
  // localStorage is untouched by a reload.
  if (USE_REMOTE && loadedRemoteOnce) win.webContents.reloadIgnoringCache();
  win.show();
  win.focus();
}

function toggleWindow() {
  if (!win) return;
  if (win.isVisible()) {
    win.hide();
  } else {
    showWindow();
  }
}

function createTray() {
  const icon = nativeImage.createFromPath(path.join(__dirname, "build", "trayTemplate.png"));
  icon.setTemplateImage(true);
  tray = new Tray(icon);
  tray.setToolTip("Todo");

  tray.on("click", () => toggleWindow());
  tray.on("right-click", () => {
    const menu = Menu.buildFromTemplate([
      { label: "Open Todo", click: () => showWindow() },
      { type: "separator" },
      { label: "Quit Todo", click: () => app.quit() },
    ]);
    tray.popUpContextMenu(menu);
  });
}

// Menu-bar-only app: no Dock icon.
if (app.dock) app.dock.hide();

// Single instance
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.whenReady().then(() => {
    createWindow();
    createTray();
  });
}

app.on("second-instance", () => showWindow());

// Keep running with no windows (it's a tray app).
app.on("window-all-closed", (e) => {});

ipcMain.on("hide-window", () => win && win.hide());
ipcMain.on("quit-app", () => app.quit());

// Renderer requests a new window size when switching views (list vs board/calendar).
ipcMain.on("set-size", (e, size) => {
  if (!win || !size) return;
  const w = Math.max(300, Math.round(size.w));
  const h = Math.max(300, Math.round(size.h));
  win.setSize(w, h, false);
  const pos = getWindowPosition();
  win.setPosition(pos.x, pos.y, false);
});
