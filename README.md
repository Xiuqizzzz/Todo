# Todo

A small, static web app for personal tasks: due dates, optional rolling “no deadline” scheduling, a calendar, merge mode, and project grouping.

There is **no build step**. Open `index.html` in a browser or serve the folder with any static host.

## Run locally

From the project root:

```bash
open index.html
```

Or use a static server (helps some browsers with `localStorage` and `file://`):

```bash
npx --yes serve .
```

Then open the URL it prints (often `http://localhost:3000`).

## Accounts (profiles)

The app stores data in **your browser** under `localStorage`, in **`todo-app-v2`**.

- **Profiles** let multiple people (or roles) use the same installation on one device, each with their own task list.
- An optional **PIN** is stored only as a **SHA-256 hash** in that storage. It is **not** sent to any server.
- After a successful PIN unlock, this **tab** remembers the unlock for the session via `sessionStorage`. Closing the tab or browser asks for the PIN again (if set).

If you had data from an older version (key `todo-simple-v1`), the first load **migrates** it into a profile named **Default** with no PIN.

### Hosting it “publicly”

You can deploy these files to **GitHub Pages**, **Netlify**, **Cloudflare Pages**, or any static host so anyone can open the URL.

Important:

- Each visitor’s data stays **in their own browser**. There is **no shared cloud database** in this repo.
- PINs and tasks are **not** secure against someone with access to the machine or dev tools; they’re for light separation only.
- For **real multi-user accounts** (login anywhere, shared backup), you’d add a backend or a service (e.g. Supabase, Firebase, or your own API) and sync tasks there. This README does not configure that for you.

## Deploy example (GitHub Pages)

1. Push this repo to GitHub.
2. Repository **Settings → Pages**.
3. **Build and deployment**: Source = **Deploy from a branch**, Branch = `main` (or `master`) and folder `/ (root)`.
4. Save; after a minute, the site URL appears on the same page.

## Files

| File          | Role                                      |
| ------------- | ----------------------------------------- |
| `index.html`  | Structure, dialogs, calendar shell        |
| `styles.css`  | Layout and theme                          |
| `app.js`      | Tasks, storage, accounts, calendar logic  |

## License

Use and change freely for personal use; add a license file if you publish as a project others should fork under clear terms.
