const { app, BrowserWindow, Tray, Menu, ipcMain, screen, nativeImage, Notification } = require("electron");
const path = require("path");
const fs = require("fs");

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
let baseTrayIcon = null;
let alertTrayIcon = null;

// ---- prefs (small JSON in userData) ----
const PREFS_PATH = path.join(app.getPath("userData"), "prefs.json");
let prefs = { notify: true, loginConfigured: false };
function loadPrefs() {
  try {
    prefs = Object.assign(prefs, JSON.parse(fs.readFileSync(PREFS_PATH, "utf-8")));
  } catch (_) {
    /* first run — keep defaults */
  }
}
function savePrefs() {
  try {
    fs.writeFileSync(PREFS_PATH, JSON.stringify(prefs));
  } catch (_) {}
}

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

  // Show on whichever Space/Desktop is currently active (and over full-screen
  // apps) instead of yanking the user back to the Space the window first
  // appeared on.
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

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

function buildTrayMenu() {
  const openAtLogin = app.getLoginItemSettings().openAtLogin;
  return Menu.buildFromTemplate([
    { label: "Open Todo", click: () => showWindow() },
    { type: "separator" },
    {
      label: "Open at Login",
      type: "checkbox",
      checked: openAtLogin,
      click: (item) => app.setLoginItemSettings({ openAtLogin: item.checked }),
    },
    {
      label: "Due-date Notifications",
      type: "checkbox",
      checked: prefs.notify,
      click: (item) => {
        prefs.notify = item.checked;
        savePrefs();
        if (win) win.webContents.send("notif-pref", prefs.notify);
      },
    },
    { type: "separator" },
    { label: "Quit Todo", click: () => app.quit() },
  ]);
}

function createTray() {
  baseTrayIcon = nativeImage.createFromPath(path.join(__dirname, "build", "trayTemplate.png"));
  baseTrayIcon.setTemplateImage(true);
  alertTrayIcon = nativeImage.createFromPath(path.join(__dirname, "build", "trayAlert.png"));
  tray = new Tray(baseTrayIcon);
  tray.setToolTip("Todo");

  tray.on("click", () => toggleWindow());
  tray.on("right-click", () => tray.popUpContextMenu(buildTrayMenu()));
}

// Show the count of tasks needing attention (due today + overdue) next to the
// menu-bar icon, and switch to the amber icon when something is overdue.
function updateTray(info) {
  if (!tray) return;
  const count = info && info.count ? info.count : 0;
  const overdue = info && info.overdue ? info.overdue : 0;
  tray.setTitle(count ? " " + count : "");
  tray.setImage(overdue > 0 ? alertTrayIcon : baseTrayIcon);
}

// Menu-bar-only app: no Dock icon.
if (app.dock) app.dock.hide();

// Single instance
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.whenReady().then(() => {
    loadPrefs();
    // On first run of the packaged app, make it open at login (it's a menu-bar
    // sticker — it should just be there). Skipped in dev so `npm start` never
    // registers a login item. The user can turn this off from the tray menu.
    if (app.isPackaged && !prefs.loginConfigured) {
      app.setLoginItemSettings({ openAtLogin: true });
      prefs.loginConfigured = true;
      savePrefs();
    }
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

// Menu-bar badge (count + overdue state), pushed by the renderer.
ipcMain.on("set-badge", (e, info) => updateTray(info));

// Native macOS notification for a due task (gated by the pref).
ipcMain.on("notify", (e, msg) => {
  if (!prefs.notify || !msg) return;
  if (!Notification.isSupported()) return;
  new Notification({ title: msg.title || "Todo", body: msg.body || "" }).show();
});

ipcMain.handle("get-prefs", () => ({ notify: prefs.notify }));
