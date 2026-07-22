# Todo — macOS menu-bar sticker

A tiny Todo that lives in the macOS **menu bar**. Click the menu-bar icon to pop
up a compact sticker: add tasks (type + Enter), optionally group them and set
start / due dates, and switch between **List / Board / Calendar** views. No Dock
icon, no window chrome. Data stays local to each machine.

The app is an Electron shell that **loads its UI from GitHub Pages**, so content
updates ship without re-distributing the app — see below.

## Install (team members)

1. Open the DMG and drag **Todo** into **Applications**.
2. First launch: because the app is unsigned, right-click **Todo.app → Open →
   Open** (or System Settings → Privacy & Security → **Open Anyway**). If it says
   *"damaged"*, run once: `xattr -dr com.apple.quarantine /Applications/Todo.app`.

The icon appears in the top menu bar. Click to toggle; right-click for **Quit**.

## Develop & build

Everything lives in [`desktop/`](desktop/). See [desktop/README.md](desktop/README.md)
for details.

```bash
cd desktop
npm install
npm start        # run locally (loads the local renderer/ files)
npm run dist     # build the universal DMG → desktop/release/
```

## How updates work (no re-packaging)

The packaged app loads its UI from GitHub Pages:

```
https://xiuqizzzz.github.io/Todo/desktop/renderer/sticker.html
```

- Edit files in `desktop/renderer/`, push to `main` → users get the new UI the
  next time they open the sticker. No rebuild, no re-install.
- If the app can't reach the network, it falls back to the copy bundled inside
  the DMG, so it always opens offline.
- During local development (`npm start`) the app loads the local files instead,
  for fast iteration.

### One-time GitHub Pages setup

Repo **Settings → Pages → Build and deployment**: Source = **Deploy from a
branch**, Branch = `main`, folder = `/ (root)`. Save. After a minute the
`desktop/renderer/` files are served at the URL above.

## Data & privacy

Tasks are stored in the app's local storage on each machine. There is no shared
backend and nothing is uploaded. Each person keeps their own list.
