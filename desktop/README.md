# Todo — macOS menu-bar sticker

A tiny always-available Todo that lives in the macOS **menu bar**. Click the
menu-bar icon to pop up a compact sticker: add a task (type + Enter), check it
off, filter Active / All / Done. No Dock icon, no window chrome.

Data is stored locally per machine (Chromium `localStorage`, same
`todo-app-v2` schema as the web app). It is **not** synced between machines.

## For team members — install

1. Open **`Todo-<version>-universal.dmg`** and drag **Todo** into **Applications**.
2. Launch **Todo** once from Applications.

Because the app is **not signed with an Apple Developer certificate** (free
build), macOS Gatekeeper will block the first launch. Pick one:

- **Right-click** `Todo.app` → **Open** → **Open** (works on most versions), **or**
- **System Settings → Privacy & Security** → scroll down → **Open Anyway**, **or**
- If it says *"damaged / can't be opened"*, run once in Terminal:

  ```bash
  xattr -dr com.apple.quarantine /Applications/Todo.app
  ```

After the first successful open, it launches normally. The icon appears in the
**top menu bar** (not the Dock). Click it to toggle the sticker; right-click for
**Quit**.

> The universal DMG runs on both Apple Silicon and Intel Macs.

## For maintainers — build the DMG

Requires Node.js (any recent LTS or newer).

```bash
cd desktop
npm install
npm run dist          # universal DMG (arm64 + Intel) → release/
# or:
npm run dist:arm64    # Apple Silicon only (smaller, ~94 MB)
```

Output: `desktop/release/Todo-<version>-universal.dmg`.

Run locally without packaging:

```bash
cd desktop
npm start
```

### Regenerating icons

The app icon (`build/icon.icns`) and menu-bar template icons
(`build/trayTemplate*.png`) are generated from code:

```bash
python3 build/make_icons.py   # needs Pillow + macOS iconutil
```

## Files

| File | Role |
| --- | --- |
| `electron-main.js` | Menu-bar tray + popover window logic |
| `preload.js` | Small bridge (`hide`, `quit`) for the renderer |
| `renderer/sticker.html/.css/.js` | The compact sticker UI |
| `build/make_icons.py` | Generates app + tray icons |
| `package.json` | Electron + electron-builder config |

## Notes on distribution

- **Unsigned** builds trigger Gatekeeper on every fresh machine (see install
  steps). To remove that friction you'd need a paid Apple Developer account
  ($99/yr) to sign + notarize; the build config leaves `identity: null` so it
  never attempts signing.
- Each machine keeps its own tasks; there is no shared backend.
