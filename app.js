const LEGACY_STORAGE_KEY = "todo-simple-v1";
const APP_STORAGE_KEY = "todo-app-v2";
const THEME_PREF_KEY = "todo-theme-pref";
const SORT_PREF_KEY = "todo-sort-mode";

/** @typedef {{ id: string, title: string, notes: string, done: boolean, date: string, dueDate: string, scheduledDate: string, completedDate: string, category: string, createdAt: number, repeat: string, manualOrder: number, deletedAt: number | null }} Task */

/** @typedef {{ id: string, name: string, category: string, dueOffsetDays: number | null }} QuickPreset */

/** @typedef {{ id: string, name: string, pinHash: string | null, tasks: Task[], projectDeadlines?: Record<string, string>, quickPresets?: QuickPreset[] }} Profile */
/** @typedef {{ v: 1, activeProfileId: string | null, profiles: Record<string, Profile> }} AppState */

/** @param {any[]} raw */
function hydrateTaskArray(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(
      (t) =>
        t &&
        typeof t.id === "string" &&
        typeof t.title === "string" &&
        typeof t.done === "boolean" &&
        typeof t.date === "string"
    )
    .map(normalizeLoadedTask);
}

function loadAppStateFromStorage() {
  const raw = localStorage.getItem(APP_STORAGE_KEY);
  if (raw) {
    try {
      const s = JSON.parse(raw);
      if (s && s.v === 1 && s.profiles && typeof s.profiles === "object") {
        return /** @type {AppState} */ (s);
      }
    } catch {
      /* ignore */
    }
  }
  const legacy = localStorage.getItem(LEGACY_STORAGE_KEY);
  if (legacy) {
    try {
      const data = JSON.parse(legacy);
      if (Array.isArray(data)) {
        const id = crypto.randomUUID();
        const migrated = hydrateTaskArray(data);
        return {
          v: 1,
          activeProfileId: id,
          profiles: {
            [id]: { id, name: "Default", pinHash: null, tasks: migrated, projectDeadlines: {}, quickPresets: [] },
          },
        };
      }
    } catch {
      /* ignore */
    }
  }
  return { v: 1, activeProfileId: null, profiles: {} };
}

function persistAppState() {
  localStorage.setItem(APP_STORAGE_KEY, JSON.stringify(appState));
}

/** @param {string} pin */
async function hashPin(pin) {
  const enc = new TextEncoder();
  const buf = await crypto.subtle.digest("SHA-256", enc.encode(`todo-app-pin:${pin}`));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** @param {string} profileId */
function sessionUnlockedKey(profileId) {
  return `todo-unlock:${profileId}`;
}

/** @param {string} profileId */
function isProfileSessionUnlocked(profileId) {
  const p = appState.profiles[profileId];
  if (!p || !p.pinHash) return true;
  return sessionStorage.getItem(sessionUnlockedKey(profileId)) === "1";
}

/** @param {string} profileId */
function unlockProfileSession(profileId) {
  sessionStorage.setItem(sessionUnlockedKey(profileId), "1");
}

/** @param {string} profileId */
function lockProfileSession(profileId) {
  sessionStorage.removeItem(sessionUnlockedKey(profileId));
}

let appState = loadAppStateFromStorage();
if (!localStorage.getItem(APP_STORAGE_KEY) && Object.keys(appState.profiles).length > 0) {
  persistAppState();
  if (localStorage.getItem(LEGACY_STORAGE_KEY)) {
    localStorage.removeItem(LEGACY_STORAGE_KEY);
  }
}

/** @param {Task[]} taskArray */
function saveTasks(taskArray) {
  tasks = taskArray;
  if (!appState.activeProfileId) return;
  const p = appState.profiles[appState.activeProfileId];
  if (p) {
    p.tasks = taskArray;
    persistAppState();
  }
}

function flushTasksToActiveProfile() {
  if (!appState.activeProfileId) return;
  const p = appState.profiles[appState.activeProfileId];
  if (p) {
    p.tasks = tasks;
    persistAppState();
  }
}

/** @param {Profile} p */
function ensureProfileProjectDeadlines(p) {
  if (!p.projectDeadlines || typeof p.projectDeadlines !== "object") {
    p.projectDeadlines = {};
  }
  return p.projectDeadlines;
}

/** @param {Profile} p */
function ensureQuickPresets(p) {
  if (!p.quickPresets || !Array.isArray(p.quickPresets)) {
    p.quickPresets = [];
  }
  return p.quickPresets;
}

/** @param {string} v */
function normalizeRepeat(v) {
  if (v === "daily" || v === "weekly" || v === "monthly") return v;
  return "none";
}

/** @returns {Task[]} */
function tasksVisible() {
  return tasks.filter((t) => !t.deletedAt);
}

/** @param {string} repeat */
function addRepeatFromIso(iso, repeat) {
  if (repeat === "daily") return addDaysISO(iso, 1);
  if (repeat === "weekly") return addDaysISO(iso, 7);
  if (repeat === "monthly") {
    const [y, m, d] = iso.split("-").map(Number);
    const dt = new Date(y, m - 1, d);
    dt.setMonth(dt.getMonth() + 1);
    return toLocalISODate(dt);
  }
  return iso;
}

/**
 * @param {Task} t open task about to be marked complete
 * @returns {Task | null}
 */
function makeRepeatFollowupTask(t) {
  const rep = normalizeRepeat(t.repeat);
  if (rep === "none") return null;
  const anchor = hasHardDueDate(t) ? t.dueDate : t.scheduledDate || t.date;
  const nextFloating = addRepeatFromIso(anchor, rep);
  const nextDue = hasHardDueDate(t) ? nextFloating : "";
  const nextSched = hasHardDueDate(t) ? nextDue : nextFloating;
  return {
    id: crypto.randomUUID(),
    title: t.title,
    notes: t.notes || "",
    date: todayISODate(),
    dueDate: nextDue,
    scheduledDate: nextSched || todayISODate(),
    completedDate: "",
    category: t.category || "",
    done: false,
    createdAt: Date.now(),
    repeat: rep,
    manualOrder: typeof t.manualOrder === "number" ? t.manualOrder : 0,
    deletedAt: null,
  };
}

function getActiveProjectDeadlines() {
  if (!appState.activeProfileId) return {};
  const p = appState.profiles[appState.activeProfileId];
  if (!p) return {};
  return ensureProfileProjectDeadlines(p);
}

/** @param {string} normalizedKey */
/** @param {string} iso */
function setProjectDeadlineForKey(normalizedKey, iso) {
  if (!appState.activeProfileId) return;
  const p = appState.profiles[appState.activeProfileId];
  if (!p) return;
  const d = ensureProfileProjectDeadlines(p);
  const v = normalizeProjectDeadlineIso(iso);
  if (!v) delete d[normalizedKey];
  else d[normalizedKey] = v;
  persistAppState();
}

/** @param {string} normalizedKey @param {string} displayName */
function deleteProjectTasksByKey(normalizedKey, displayName) {
  const n = tasks.filter((t) => normalizeCategory(t.category) === normalizedKey).length;
  if (
    !window.confirm(
      `Delete all ${n} task${n === 1 ? "" : "s"} in “${displayName}” and clear this project’s deadline? This cannot be undone.`
    )
  ) {
    return;
  }
  const d = getActiveProjectDeadlines();
  delete d[normalizedKey];
  const next = tasks.filter((t) => normalizeCategory(t.category) !== normalizedKey);
  saveTasks(next);
  render();
  setSelectedCountLabel();
  renderMergeBar();
}

function loadTasksForActiveProfile() {
  if (!appState.activeProfileId || !isProfileSessionUnlocked(appState.activeProfileId)) {
    tasks = [];
    return;
  }
  const p = appState.profiles[appState.activeProfileId];
  if (!p) {
    tasks = [];
    return;
  }
  tasks = hydrateTaskArray(p.tasks);
  migrateProjectDeadlinesInProfile(p);
}

function todayISODate() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** @param {Date} d */
function toLocalISODate(d) {
  const y = d.getFullYear();
  const mo = d.getMonth() + 1;
  const day = d.getDate();
  return `${y}-${String(mo).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

const PROJECT_DEADLINE_YEAR_MIN = 1970;
const PROJECT_DEADLINE_YEAR_MAX = 2100;

/**
 * Normalizes HTML date-control output and stored values. Some UIs emit 2-digit years
 * (shown as 0020, etc.); map year &lt; 100 to 2000–2099 and require a sane range.
 * @param {string} raw
 * @returns {string}
 */
function normalizeProjectDeadlineIso(raw) {
  const s = String(raw || "").trim();
  if (!s) return "";
  const m = /^(\d{1,4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  if (!m) return "";
  let y = Number(m[1]);
  let mo = Number(m[2]);
  let day = Number(m[3]);
  if (!Number.isFinite(y) || !Number.isFinite(mo) || !Number.isFinite(day)) return "";
  mo = Math.trunc(mo);
  day = Math.trunc(day);
  if (mo < 1 || mo > 12 || day < 1 || day > 31) return "";
  if (y < 100) y += 2000;
  if (y < PROJECT_DEADLINE_YEAR_MIN || y > PROJECT_DEADLINE_YEAR_MAX) return "";
  const dt = new Date(y, mo - 1, day);
  if (dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== day) return "";
  return toLocalISODate(dt);
}

/** @param {Profile} p */
function migrateProjectDeadlinesInProfile(p) {
  const d = ensureProfileProjectDeadlines(p);
  let changed = false;
  for (const k of Object.keys(d)) {
    const n = normalizeProjectDeadlineIso(d[k]);
    if (n && n !== d[k]) {
      d[k] = n;
      changed = true;
    } else if (!n && d[k]) {
      delete d[k];
      changed = true;
    }
  }
  if (changed) persistAppState();
}

/** @param {string} iso @param {number} deltaDays */
function addDaysISO(iso, deltaDays) {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(y, m - 1, d + deltaDays);
  return toLocalISODate(dt);
}

/** @param {number} y @param {number} m 0-11 */
function calendarMonthPrefix(y, m) {
  return `${y}-${String(m + 1).padStart(2, "0")}`;
}

/** @param {any} t */
function normalizeLoadedTask(t) {
  const date = typeof t.date === "string" && t.date ? t.date : todayISODate();
  const dueDate =
    typeof t.dueDate === "string" && t.dueDate.trim() ? t.dueDate.trim() : "";
  let scheduledDate =
    typeof t.scheduledDate === "string" && t.scheduledDate.trim()
      ? t.scheduledDate.trim()
      : "";
  if (!scheduledDate) {
    scheduledDate = dueDate || date;
  }
  const completedDate =
    typeof t.completedDate === "string" ? t.completedDate : "";
  const notes = typeof t.notes === "string" ? t.notes : "";
  const repeat = normalizeRepeat(t.repeat);
  const manualOrder =
    typeof t.manualOrder === "number" && Number.isFinite(t.manualOrder) ? t.manualOrder : 0;
  const deletedAt =
    typeof t.deletedAt === "number" && Number.isFinite(t.deletedAt) ? t.deletedAt : null;
  return {
    ...t,
    date,
    dueDate,
    scheduledDate,
    completedDate,
    notes,
    repeat,
    manualOrder,
    deletedAt,
  };
}

/** @param {Task} t */
function hasHardDueDate(t) {
  return Boolean(t.dueDate && String(t.dueDate).trim());
}

/** @param {Task} t */
function effectiveScheduleDate(t) {
  if (hasHardDueDate(t)) return t.dueDate;
  return t.scheduledDate || t.date;
}

/** Due if set, else schedule — for “today / tomorrow” open-task summary. */
/** @param {Task} t */
function openTaskAnchorDate(t) {
  if (t.done) return null;
  if (hasHardDueDate(t)) return t.dueDate;
  return t.scheduledDate || t.date;
}

function rollFloatingSchedules() {
  const today = todayISODate();
  let changed = false;
  for (const t of tasks) {
    if (t.deletedAt) continue;
    if (t.done) continue;
    if (hasHardDueDate(t)) continue;
    const sd = t.scheduledDate || t.date || today;
    if (sd < today) {
      t.scheduledDate = today;
      changed = true;
    }
  }
  if (changed) saveTasks(tasks);
}

/** @param {Task[]} taskArr */
function sortTasks(taskArr) {
  return [...taskArr].sort((a, b) => {
    const da = effectiveScheduleDate(a);
    const db = effectiveScheduleDate(b);
    if (da !== db) return da.localeCompare(db);
    return a.createdAt - b.createdAt;
  });
}

function getSortMode() {
  const raw = localStorage.getItem(SORT_PREF_KEY);
  if (
    raw === "due" ||
    raw === "created" ||
    raw === "project" ||
    raw === "title" ||
    raw === "manual"
  ) {
    return raw;
  }
  return "schedule";
}

/** @param {string} mode */
function setSortMode(mode) {
  localStorage.setItem(SORT_PREF_KEY, mode);
}

function normalizeManualOrdersForVisible() {
  const vis = tasksVisible();
  const sorted = sortTasks(vis);
  sorted.forEach((t, i) => {
    t.manualOrder = i;
  });
  flushTasksToActiveProfile();
  persistAppState();
}

/** @param {Task[]} list */
function applyListSort(list) {
  const mode = getSortMode();
  if (mode === "schedule") return sortTasks(list);
  if (mode === "due") {
    return [...list].sort((a, b) => {
      const da = effectiveScheduleDate(a);
      const db = effectiveScheduleDate(b);
      if (da !== db) return da.localeCompare(db);
      return a.createdAt - b.createdAt;
    });
  }
  if (mode === "created") {
    return [...list].sort((a, b) => {
      if (a.date !== b.date) return a.date.localeCompare(b.date);
      return a.createdAt - b.createdAt;
    });
  }
  if (mode === "project") {
    return [...list].sort((a, b) => {
      const ca = (a.category || "").trim().toLowerCase();
      const cb = (b.category || "").trim().toLowerCase();
      if (ca !== cb) {
        if (!ca) return 1;
        if (!cb) return -1;
        return ca.localeCompare(cb, "en");
      }
      const da = effectiveScheduleDate(a);
      const db = effectiveScheduleDate(b);
      if (da !== db) return da.localeCompare(db);
      return a.createdAt - b.createdAt;
    });
  }
  if (mode === "title") {
    return [...list].sort((a, b) =>
      a.title.trim().localeCompare(b.title.trim(), "en", { sensitivity: "base" })
    );
  }
  if (mode === "manual") {
    return [...list].sort((a, b) => {
      if (a.manualOrder !== b.manualOrder) return a.manualOrder - b.manualOrder;
      return a.createdAt - b.createdAt;
    });
  }
  return sortTasks(list);
}

/** @param {string} iso */
function isOverdue(iso) {
  return iso < todayISODate();
}

function normalizeCategory(c) {
  return String(c || "")
    .trim()
    .toLowerCase();
}

/** @param {string} text */
function parseTaskLines(text) {
  return String(text)
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function getSearchQuery() {
  const el = document.getElementById("task-search");
  return el ? el.value.trim().toLowerCase() : "";
}

/** @param {Task} t @param {string} q */
function taskMatchesSearch(t, q) {
  if (!q) return true;
  const title = String(t.title).toLowerCase();
  const cat = String(t.category || "").toLowerCase();
  const notes = String(t.notes || "").toLowerCase();
  return title.includes(q) || cat.includes(q) || notes.includes(q);
}

function getThemePref() {
  return localStorage.getItem(THEME_PREF_KEY) || "auto";
}

function applyThemePref() {
  const pref = getThemePref();
  if (pref === "auto") {
    document.documentElement.removeAttribute("data-theme");
  } else {
    document.documentElement.setAttribute("data-theme", pref);
  }
}

function updateThemeButtonLabel() {
  const btn = document.getElementById("theme-toggle");
  if (!btn) return;
  const pref = getThemePref();
  btn.textContent =
    pref === "auto" ? "Theme: Auto" : pref === "light" ? "Theme: Light" : "Theme: Dark";
}

function cycleThemePref() {
  const order = ["auto", "light", "dark"];
  const cur = getThemePref();
  const i = Math.max(0, order.indexOf(cur));
  const next = order[(i + 1) % order.length];
  localStorage.setItem(THEME_PREF_KEY, next);
  applyThemePref();
  updateThemeButtonLabel();
}

function syncProjectDatalist() {
  const dl = document.getElementById("project-datalist");
  if (!dl) return;
  const names = [
    ...new Set(tasksVisible().map((t) => String(t.category || "").trim()).filter(Boolean)),
  ].sort((a, b) => a.localeCompare(b, "en"));
  dl.innerHTML = "";
  names.forEach((name) => {
    const opt = document.createElement("option");
    opt.value = name;
    dl.appendChild(opt);
  });
}

/** @param {Task[]} selected */
function mergeTasksPayload(selected) {
  const sorted = sortTasks(selected);
  const title = sorted.map((t) => t.title.trim()).filter(Boolean).join("; ");
  const dates = sorted.map((t) => t.date).filter(Boolean).sort();
  const date = dates[0] || todayISODate();
  const hard = sorted.filter((t) => hasHardDueDate(t));
  let dueDate = "";
  let scheduledDate = todayISODate();
  if (hard.length > 0) {
    const dues = hard.map((t) => t.dueDate).sort();
    dueDate = dues[0];
    scheduledDate = dueDate;
  } else {
    const scheds = sorted
      .map((t) => t.scheduledDate || t.date)
      .filter(Boolean)
      .sort();
    scheduledDate = scheds[0] || todayISODate();
  }
  const cats = [...new Set(sorted.map((t) => String(t.category || "").trim()).filter(Boolean))];
  const category = cats.length === 1 ? cats[0] : cats.join(" / ");
  const done = sorted.length > 0 && sorted.every((t) => t.done);
  let completedDate = "";
  if (done && sorted.length > 0) {
    const cds = sorted.map((t) => t.completedDate).filter(Boolean).sort();
    completedDate = cds.length ? cds[cds.length - 1] : todayISODate();
  }
  return { title, date, dueDate, scheduledDate, category, done, completedDate };
}

const els = {
  addForm: /** @type {HTMLFormElement} */ (document.getElementById("add-form")),
  taskTitle: /** @type {HTMLTextAreaElement} */ (document.getElementById("task-title")),
  taskDate: /** @type {HTMLInputElement} */ (document.getElementById("task-date")),
  taskDueDate: /** @type {HTMLInputElement} */ (document.getElementById("task-due-date")),
  taskCategory: /** @type {HTMLInputElement} */ (document.getElementById("task-category")),
  taskList: /** @type {HTMLUListElement} */ (document.getElementById("task-list")),
  emptyState: /** @type {HTMLParagraphElement} */ (document.getElementById("empty-state")),
  filters: /** @type {NodeListOf<HTMLButtonElement>} */ (document.querySelectorAll(".filter")),
  toggleMerge: /** @type {HTMLButtonElement} */ (document.getElementById("toggle-merge")),
  toggleProjectView: /** @type {HTMLButtonElement} */ (document.getElementById("toggle-project-view")),
  mergeHint: /** @type {HTMLParagraphElement} */ (document.getElementById("merge-hint")),
  searchEmpty: /** @type {HTMLParagraphElement | null} */ (document.getElementById("search-empty")),
  mergeDialog: /** @type {HTMLDialogElement} */ (document.getElementById("merge-dialog")),
  mergeTitle: /** @type {HTMLTextAreaElement} */ (document.getElementById("merge-title")),
  mergeDate: /** @type {HTMLInputElement} */ (document.getElementById("merge-date")),
  mergeDueDate: /** @type {HTMLInputElement} */ (document.getElementById("merge-due-date")),
  mergeCategory: /** @type {HTMLInputElement} */ (document.getElementById("merge-category")),
  mergeCancel: /** @type {HTMLButtonElement} */ (document.getElementById("merge-cancel")),
  mergeConfirm: /** @type {HTMLButtonElement} */ (document.getElementById("merge-confirm")),
  calPrev: /** @type {HTMLButtonElement} */ (document.getElementById("cal-prev")),
  calNext: /** @type {HTMLButtonElement} */ (document.getElementById("cal-next")),
  calThisMonth: /** @type {HTMLButtonElement} */ (document.getElementById("cal-this-month")),
  calLabel: /** @type {HTMLSpanElement} */ (document.getElementById("cal-label")),
  calSummary: /** @type {HTMLParagraphElement} */ (document.getElementById("calendar-summary")),
  calGrid: /** @type {HTMLDivElement} */ (document.getElementById("calendar-grid")),
  calDetailTitle: /** @type {HTMLHeadingElement} */ (document.getElementById("cal-detail-title")),
  calDetailStat: /** @type {HTMLParagraphElement} */ (document.getElementById("cal-detail-stat")),
  calDetailDone: /** @type {HTMLUListElement} */ (document.getElementById("cal-detail-done")),
  calDetailDue: /** @type {HTMLUListElement} */ (document.getElementById("cal-detail-due")),
  calDetailDoneLabel: /** @type {HTMLParagraphElement} */ (document.getElementById("cal-detail-done-label")),
  calDetailDueLabel: /** @type {HTMLParagraphElement} */ (document.getElementById("cal-detail-due-label")),
  editDialog: /** @type {HTMLDialogElement} */ (document.getElementById("edit-dialog")),
  editTitle: /** @type {HTMLTextAreaElement} */ (document.getElementById("edit-title")),
  editDate: /** @type {HTMLInputElement} */ (document.getElementById("edit-date")),
  editDueDate: /** @type {HTMLInputElement} */ (document.getElementById("edit-due-date")),
  editCategory: /** @type {HTMLInputElement} */ (document.getElementById("edit-category")),
  editNotes: /** @type {HTMLTextAreaElement} */ (document.getElementById("edit-notes")),
  editRepeat: /** @type {HTMLSelectElement} */ (document.getElementById("edit-repeat")),
  editCancel: /** @type {HTMLButtonElement} */ (document.getElementById("edit-cancel")),
  editSave: /** @type {HTMLButtonElement} */ (document.getElementById("edit-save")),
  accountGate: /** @type {HTMLDialogElement} */ (document.getElementById("account-gate")),
  accountGateTitle: /** @type {HTMLHeadingElement} */ (document.getElementById("account-gate-title")),
  accountGateBody: /** @type {HTMLDivElement} */ (document.getElementById("account-gate-body")),
  accountPin: /** @type {HTMLDialogElement} */ (document.getElementById("account-pin")),
  accountPinFor: /** @type {HTMLParagraphElement} */ (document.getElementById("account-pin-for")),
  accountPinInput: /** @type {HTMLInputElement} */ (document.getElementById("account-pin-input")),
  accountPinCancel: /** @type {HTMLButtonElement} */ (document.getElementById("account-pin-cancel")),
  accountPinSubmit: /** @type {HTMLButtonElement} */ (document.getElementById("account-pin-submit")),
  accountSwitch: /** @type {HTMLButtonElement} */ (document.getElementById("account-switch")),
  accountLabel: /** @type {HTMLSpanElement} */ (document.getElementById("account-label")),
  taskSearch: /** @type {HTMLInputElement | null} */ (document.getElementById("task-search")),
  themeToggle: /** @type {HTMLButtonElement | null} */ (document.getElementById("theme-toggle")),
  splitDialog: /** @type {HTMLDialogElement} */ (document.getElementById("split-dialog")),
  splitLines: /** @type {HTMLTextAreaElement} */ (document.getElementById("split-lines")),
  splitByDelimiters: /** @type {HTMLButtonElement} */ (document.getElementById("split-by-delimiters")),
  splitCancel: /** @type {HTMLButtonElement} */ (document.getElementById("split-cancel")),
  splitConfirm: /** @type {HTMLButtonElement} */ (document.getElementById("split-confirm")),
  upcomingPanel: /** @type {HTMLElement | null} */ (document.getElementById("upcoming-panel")),
  upcomingBody: /** @type {HTMLDivElement | null} */ (document.getElementById("upcoming-body")),
  overduePanel: /** @type {HTMLElement | null} */ (document.getElementById("overdue-panel")),
  overdueBody: /** @type {HTMLDivElement | null} */ (document.getElementById("overdue-body")),
  trashPanel: /** @type {HTMLElement | null} */ (document.getElementById("trash-panel")),
  trashBody: /** @type {HTMLDivElement | null} */ (document.getElementById("trash-body")),
  trashEmpty: /** @type {HTMLButtonElement | null} */ (document.getElementById("trash-empty")),
  sortMode: /** @type {HTMLSelectElement | null} */ (document.getElementById("sort-mode")),
  toggleBulk: /** @type {HTMLButtonElement | null} */ (document.getElementById("toggle-bulk")),
  bulkHint: /** @type {HTMLParagraphElement | null} */ (document.getElementById("bulk-hint")),
  taskNotes: /** @type {HTMLTextAreaElement | null} */ (document.getElementById("task-notes")),
  taskRepeat: /** @type {HTMLSelectElement | null} */ (document.getElementById("task-repeat")),
  presetSelect: /** @type {HTMLSelectElement | null} */ (document.getElementById("preset-select")),
  presetSave: /** @type {HTMLButtonElement | null} */ (document.getElementById("preset-save")),
};

/** @type {Task[]} */
let tasks = [];
let filter = "all";
let mergeMode = false;
let bulkMode = false;
let projectViewMode = false;
/** @type {Set<string>} */
let mergeSelection = new Set();
/** @type {Set<string>} */
let bulkSelection = new Set();
/** @type {string | null} */
let keyboardFocusTaskId = null;
/** @type {Task[] | null} */
let pendingMergeTasks = null;
/** @type {string | null} */
let editingTaskId = null;
/** @type {string | null} */
let pendingSplitTaskId = null;

const _initialCal = new Date();
let viewCalendarYear = _initialCal.getFullYear();
let viewCalendarMonth = _initialCal.getMonth();
/** @type {string | null} */
let calendarSelectedIso = todayISODate();
/** @type {string | null} */
let pendingProfileIdForPin = null;
/** @type {string | null} */
let lastUnlockedProfileId = null;

function updateAccountLabel() {
  if (!appState.activeProfileId || !isProfileSessionUnlocked(appState.activeProfileId)) {
    els.accountLabel.classList.add("hidden");
    els.accountLabel.textContent = "";
    return;
  }
  const p = appState.profiles[appState.activeProfileId];
  if (!p) {
    els.accountLabel.classList.add("hidden");
    return;
  }
  els.accountLabel.textContent = p.name;
  els.accountLabel.classList.remove("hidden");
}

/**
 * @param {"create" | "pick"} mode
 */
function buildAccountGateBody(mode) {
  const body = els.accountGateBody;
  body.innerHTML = "";
  if (mode === "create") {
    els.accountGateTitle.textContent = "Create profile";
    const wrap = document.createElement("div");
    wrap.innerHTML = `<p class="dialog-desc">Each profile has its own tasks on this browser. You can host this app publicly—each visitor still uses their own device storage unless you add a backend.</p>`;
    body.appendChild(wrap);
    const nameLab = document.createElement("label");
    nameLab.className = "field block";
    nameLab.innerHTML = `<span class="field-label">Display name</span>`;
    const nameIn = document.createElement("input");
    nameIn.type = "text";
    nameIn.id = "account-new-name";
    nameIn.maxLength = 60;
    nameIn.autocomplete = "username";
    nameIn.required = true;
    nameLab.appendChild(nameIn);
    body.appendChild(nameLab);
    const pinLab = document.createElement("label");
    pinLab.className = "field block";
    pinLab.innerHTML = `<span class="field-label">PIN (optional)</span>`;
    const pinIn = document.createElement("input");
    pinIn.type = "password";
    pinIn.id = "account-new-pin";
    pinIn.autocomplete = "new-password";
    pinLab.appendChild(pinIn);
    body.appendChild(pinLab);
    const pin2Lab = document.createElement("label");
    pin2Lab.className = "field block";
    pin2Lab.innerHTML = `<span class="field-label">Confirm PIN</span>`;
    const pin2In = document.createElement("input");
    pin2In.type = "password";
    pin2In.id = "account-new-pin2";
    pin2In.autocomplete = "new-password";
    pin2Lab.appendChild(pin2In);
    body.appendChild(pin2Lab);
    const pinHint = document.createElement("p");
    pinHint.className = "dialog-hint";
    pinHint.textContent =
      "A PIN only separates profiles on this device; it is not strong protection if someone can use your computer or browser dev tools.";
    body.appendChild(pinHint);
    const actions = document.createElement("div");
    actions.className = "dialog-actions";
    const backBtn = document.createElement("button");
    backBtn.type = "button";
    backBtn.className = "btn ghost";
    backBtn.textContent = "Back";
    backBtn.hidden = !Object.keys(appState.profiles).length;
    backBtn.addEventListener("click", () => {
      buildAccountGateBody("pick");
    });
    const goBtn = document.createElement("button");
    goBtn.type = "button";
    goBtn.className = "btn primary";
    goBtn.textContent = "Create";
    goBtn.addEventListener("click", async () => {
      const name = nameIn.value.trim();
      if (!name) return;
      const p1 = pinIn.value;
      const p2 = pin2In.value;
      if (p1 !== p2) {
        window.alert("PIN fields do not match.");
        return;
      }
      const id = crypto.randomUUID();
      const pinHash = p1.trim() ? await hashPin(p1.trim()) : null;
      appState.profiles[id] = { id, name, pinHash, tasks: [], projectDeadlines: {}, quickPresets: [] };
      appState.activeProfileId = id;
      unlockProfileSession(id);
      persistAppState();
      flushTasksToActiveProfile();
      loadTasksForActiveProfile();
      updateAccountLabel();
      els.accountGate.close();
      bootstrapTaskFormAndRender();
    });
    actions.appendChild(backBtn);
    actions.appendChild(goBtn);
    body.appendChild(actions);
    queueMicrotask(() => nameIn.focus());
    return;
  }

  els.accountGateTitle.textContent = "Choose profile";
  const desc = document.createElement("p");
  desc.className = "dialog-desc";
  desc.textContent = "Select who is using the app on this device.";
  body.appendChild(desc);
  const list = document.createElement("div");
  list.className = "account-profile-list";
  const ids = Object.keys(appState.profiles).sort((a, b) =>
    appState.profiles[a].name.localeCompare(appState.profiles[b].name, "en")
  );
  for (const id of ids) {
    const p = appState.profiles[id];
    const btnp = document.createElement("button");
    btnp.type = "button";
    btnp.className = "account-profile-btn";
    btnp.textContent = p.pinHash ? `${p.name} (PIN)` : p.name;
    btnp.addEventListener("click", () => {
      selectProfile(id);
    });
    list.appendChild(btnp);
  }
  body.appendChild(list);
  const addBtn = document.createElement("button");
  addBtn.type = "button";
  addBtn.className = "btn ghost";
  addBtn.textContent = "+ New profile";
  addBtn.addEventListener("click", () => buildAccountGateBody("create"));
  body.appendChild(addBtn);
}

/** @param {string} profileId */
function selectProfile(profileId) {
  flushTasksToActiveProfile();
  appState.activeProfileId = profileId;
  persistAppState();
  if (!isProfileSessionUnlocked(profileId)) {
    tasks = [];
    pendingProfileIdForPin = profileId;
    const p = appState.profiles[profileId];
    els.accountPinFor.textContent = `Enter PIN for “${p.name}”.`;
    els.accountPinInput.value = "";
    els.accountGate.close();
    els.accountPin.showModal();
    queueMicrotask(() => els.accountPinInput.focus());
    return;
  }
  loadTasksForActiveProfile();
  updateAccountLabel();
  els.accountGate.close();
  bootstrapTaskFormAndRender();
}

function needsAccountGate() {
  if (!appState.activeProfileId) return true;
  if (!appState.profiles[appState.activeProfileId]) {
    appState.activeProfileId = null;
    persistAppState();
    return true;
  }
  return !isProfileSessionUnlocked(appState.activeProfileId);
}

function openAccountPicker() {
  flushTasksToActiveProfile();
  buildAccountGateBody(Object.keys(appState.profiles).length ? "pick" : "create");
  els.accountGate.showModal();
}

function bootstrapTaskFormAndRender() {
  lastUnlockedProfileId = appState.activeProfileId;
  const initDay = todayISODate();
  els.taskDate.value = initDay;
  els.taskDueDate.value = "";
  if (els.sortMode) els.sortMode.value = getSortMode();
  keyboardFocusTaskId = null;
  syncPresetSelect();
  render();
}

function getFilteredTasks() {
  const base = tasksVisible();
  if (filter === "active") return base.filter((t) => !t.done);
  if (filter === "done") return base.filter((t) => t.done);
  return base;
}

/** @param {Task} task @param {number} delta */
function moveTaskInManualOrder(task, delta) {
  const q = getSearchQuery();
  const list = applyListSort(getFilteredTasks().filter((t) => taskMatchesSearch(t, q)));
  const idx = list.findIndex((t) => t.id === task.id);
  const j = idx + delta;
  if (idx < 0 || j < 0 || j >= list.length) return;
  const a = list[idx];
  const b = list[j];
  const tmp = a.manualOrder;
  a.manualOrder = b.manualOrder;
  b.manualOrder = tmp;
  saveTasks(tasks);
  keyboardFocusTaskId = task.id;
  render();
}

/**
 * @param {Task} task
 * @returns {HTMLLIElement}
 */
function createTaskRow(task) {
  const li = document.createElement("li");
  const hardDue = hasHardDueDate(task);
  const overdue = !task.done && hardDue && isOverdue(task.dueDate);
  let cls = "task-item" + (task.done ? " done" : "") + (overdue ? " overdue" : "");
  if (keyboardFocusTaskId === task.id) cls += " task-keyboard-focus";
  li.className = cls;
  li.dataset.id = task.id;

  if (mergeMode) {
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.className = "task-merge-check";
    cb.checked = mergeSelection.has(task.id);
    cb.setAttribute("aria-label", "Select for merge");
    cb.addEventListener("change", () => {
      if (cb.checked) mergeSelection.add(task.id);
      else mergeSelection.delete(task.id);
      setSelectedCountLabel();
      renderMergeBar();
    });
    li.appendChild(cb);
  } else if (bulkMode) {
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.className = "task-merge-check";
    cb.checked = bulkSelection.has(task.id);
    cb.setAttribute("aria-label", "Select for bulk action");
    cb.addEventListener("change", () => {
      if (cb.checked) bulkSelection.add(task.id);
      else bulkSelection.delete(task.id);
      setBulkHint();
      renderBulkBar();
    });
    li.appendChild(cb);
  } else {
    const toggle = document.createElement("input");
    toggle.type = "checkbox";
    toggle.className = "task-merge-check";
    toggle.checked = task.done;
    toggle.setAttribute("aria-label", "Mark complete");
    toggle.addEventListener("change", () => {
      if (!task.done && toggle.checked && normalizeRepeat(task.repeat) !== "none") {
        const follow = makeRepeatFollowupTask(task);
        task.done = true;
        task.completedDate = todayISODate();
        if (follow) tasks.push(follow);
      } else {
        task.done = toggle.checked;
        task.completedDate = toggle.checked ? todayISODate() : "";
      }
      saveTasks(tasks);
      render();
    });
    li.appendChild(toggle);
  }

  const body = document.createElement("div");
  body.className = "task-body";
  const title = document.createElement("p");
  title.className = "task-title";
  title.textContent = task.title;
  body.appendChild(title);
  if (task.notes && task.notes.trim()) {
    const notesEl = document.createElement("p");
    notesEl.className = "task-notes-preview";
    notesEl.textContent = task.notes.trim();
    body.appendChild(notesEl);
  }
  const meta = document.createElement("p");
  meta.className = "task-meta";
  const created = document.createElement("span");
  created.textContent = "Created " + formatDateLabel(task.date);
  meta.appendChild(created);
  const dueSpan = document.createElement("span");
  if (hardDue) {
    dueSpan.className = overdue ? "due-em" : "";
    dueSpan.textContent = "Due " + formatDateLabel(task.dueDate);
  } else {
    dueSpan.className = "";
    dueSpan.textContent =
      "No fixed due · scheduled " + formatDateLabel(task.scheduledDate || task.date);
  }
  meta.appendChild(dueSpan);
  if (task.done) {
    const doneSpan = document.createElement("span");
    if (task.completedDate) {
      doneSpan.textContent = "Done " + formatDateLabel(task.completedDate);
    } else {
      doneSpan.textContent = "Done";
    }
    meta.appendChild(doneSpan);
  }
  if (task.category && task.category.trim()) {
    const cat = document.createElement("span");
    cat.textContent = "Project · " + task.category.trim();
    meta.appendChild(cat);
  }
  const rep = normalizeRepeat(task.repeat);
  if (rep !== "none") {
    const repEl = document.createElement("span");
    repEl.className = "task-repeat-badge";
    repEl.textContent =
      "Repeats · " + (rep === "daily" ? "daily" : rep === "weekly" ? "weekly" : "monthly");
    meta.appendChild(repEl);
  }
  body.appendChild(meta);
  li.appendChild(body);

  const actions = document.createElement("div");
  actions.className = "task-actions";
  if (
    !mergeMode &&
    !bulkMode &&
    getSortMode() === "manual" &&
    !projectViewMode &&
    taskMatchesSearch(task, getSearchQuery())
  ) {
    const up = document.createElement("button");
    up.type = "button";
    up.className = "btn small ghost";
    up.textContent = "↑";
    up.title = "Move up in manual order";
    up.addEventListener("click", () => moveTaskInManualOrder(task, -1));
    actions.appendChild(up);
    const down = document.createElement("button");
    down.type = "button";
    down.className = "btn small ghost";
    down.textContent = "↓";
    down.title = "Move down in manual order";
    down.addEventListener("click", () => moveTaskInManualOrder(task, 1));
    actions.appendChild(down);
  }
  if (!mergeMode && !bulkMode) {
    const splitBtn = document.createElement("button");
    splitBtn.type = "button";
    splitBtn.className = "btn small ghost";
    splitBtn.textContent = "Split";
    splitBtn.title = "Turn this into several smaller tasks";
    splitBtn.addEventListener("click", () => openSplitDialog(task));
    actions.appendChild(splitBtn);
    const editBtn = document.createElement("button");
    editBtn.type = "button";
    editBtn.className = "btn small ghost";
    editBtn.textContent = "Edit";
    editBtn.addEventListener("click", () => openEditDialog(task));
    actions.appendChild(editBtn);
  }
  const del = document.createElement("button");
  del.type = "button";
  del.className = "btn small danger";
  del.textContent = "Delete";
  del.addEventListener("click", () => {
    task.deletedAt = Date.now();
    mergeSelection.delete(task.id);
    bulkSelection.delete(task.id);
    if (pendingSplitTaskId === task.id) {
      pendingSplitTaskId = null;
      els.splitDialog.close();
    }
    if (editingTaskId === task.id) {
      editingTaskId = null;
      els.editDialog.close();
    }
    saveTasks(tasks);
    render();
    setSelectedCountLabel();
    renderMergeBar();
    setBulkHint();
    renderBulkBar();
  });
  actions.appendChild(del);
  li.appendChild(actions);

  return li;
}

function setSelectedCountLabel() {
  if (!mergeMode) {
    els.mergeHint.classList.add("hidden");
    els.mergeHint.textContent = "";
    return;
  }
  const n = mergeSelection.size;
  els.mergeHint.classList.remove("hidden");
  if (n === 0) {
    els.mergeHint.innerHTML =
      "Merge mode: select at least two tasks, then tap <strong>Merge selected</strong> below.";
    return;
  }
  if (n < 2) {
    els.mergeHint.innerHTML = "Select one more task to merge.";
    return;
  }
  els.mergeHint.innerHTML = `<strong>${n}</strong> selected—tap <strong>Merge selected</strong> below or keep selecting.`;
}

function renderUpcoming() {
  const panel = els.upcomingPanel;
  const body = els.upcomingBody;
  if (!panel || !body) return;
  if (!appState.activeProfileId || !isProfileSessionUnlocked(appState.activeProfileId)) {
    panel.hidden = true;
    return;
  }
  panel.hidden = false;
  const t0 = todayISODate();
  const t1 = addDaysISO(t0, 1);
  const todayTasks = tasksVisible().filter((x) => !x.done && openTaskAnchorDate(x) === t0);
  const tomTasks = tasksVisible().filter((x) => !x.done && openTaskAnchorDate(x) === t1);
  body.innerHTML = "";
  const makeBlock = (/** @type {string} */ label, /** @type {Task[]} */ arr) => {
    const div = document.createElement("div");
    div.className = "upcoming-block";
    const h = document.createElement("h3");
    h.className = "upcoming-subtitle";
    h.textContent = `${label} (${arr.length})`;
    div.appendChild(h);
    if (arr.length === 0) {
      const p = document.createElement("p");
      p.className = "upcoming-empty";
      p.textContent = "Nothing scheduled.";
      div.appendChild(p);
    } else {
      const ul = document.createElement("ul");
      ul.className = "upcoming-list";
      arr.slice(0, 8).forEach((t) => {
        const li = document.createElement("li");
        li.textContent = t.title;
        ul.appendChild(li);
      });
      div.appendChild(ul);
      if (arr.length > 8) {
        const more = document.createElement("p");
        more.className = "upcoming-more";
        more.textContent = `+${arr.length - 8} more in the list below`;
        div.appendChild(more);
      }
    }
    return div;
  };
  body.appendChild(makeBlock("Today", todayTasks));
  body.appendChild(makeBlock("Tomorrow", tomTasks));
}

function renderOverdue() {
  const panel = els.overduePanel;
  const body = els.overdueBody;
  if (!panel || !body) return;
  if (!appState.activeProfileId || !isProfileSessionUnlocked(appState.activeProfileId)) {
    panel.hidden = true;
    return;
  }
  const today = todayISODate();
  const overdueTasks = tasksVisible().filter(
    (t) => !t.done && hasHardDueDate(t) && t.dueDate < today
  );
  panel.hidden = false;
  body.innerHTML = "";
  if (overdueTasks.length === 0) {
    const p = document.createElement("p");
    p.className = "upcoming-empty";
    p.textContent = "Nothing overdue.";
    body.appendChild(p);
    return;
  }
  const ul = document.createElement("ul");
  ul.className = "upcoming-list";
  overdueTasks.slice(0, 12).forEach((t) => {
    const li = document.createElement("li");
    li.textContent = `${t.title} · due ${formatDateLabel(t.dueDate)}`;
    ul.appendChild(li);
  });
  body.appendChild(ul);
  if (overdueTasks.length > 12) {
    const more = document.createElement("p");
    more.className = "upcoming-more";
    more.textContent = `+${overdueTasks.length - 12} more in the list below`;
    body.appendChild(more);
  }
}

function renderTrash() {
  const panel = els.trashPanel;
  const body = els.trashBody;
  const emptyBtn = els.trashEmpty;
  if (!panel || !body) return;
  if (!appState.activeProfileId || !isProfileSessionUnlocked(appState.activeProfileId)) {
    panel.hidden = true;
    return;
  }
  const trashed = tasks
    .filter((t) => t.deletedAt)
    .sort((a, b) => (b.deletedAt || 0) - (a.deletedAt || 0));
  panel.hidden = false;
  body.innerHTML = "";
  if (trashed.length === 0) {
    const p = document.createElement("p");
    p.className = "upcoming-empty";
    p.textContent = "Trash is empty.";
    body.appendChild(p);
    if (emptyBtn) emptyBtn.classList.add("hidden");
    return;
  }
  if (emptyBtn) emptyBtn.classList.remove("hidden");
  const list = document.createElement("ul");
  list.className = "trash-list";
  trashed.forEach((t) => {
    const li = document.createElement("li");
    li.className = "trash-row";
    const label = document.createElement("span");
    label.className = "trash-row-label";
    label.textContent = t.title;
    li.appendChild(label);
    const tools = document.createElement("div");
    tools.className = "trash-row-tools";
    const restore = document.createElement("button");
    restore.type = "button";
    restore.className = "btn small ghost";
    restore.textContent = "Restore";
    restore.addEventListener("click", () => {
      t.deletedAt = null;
      saveTasks(tasks);
      render();
    });
    const forever = document.createElement("button");
    forever.type = "button";
    forever.className = "btn small danger";
    forever.textContent = "Delete forever";
    forever.addEventListener("click", () => {
      tasks = tasks.filter((x) => x.id !== t.id);
      mergeSelection.delete(t.id);
      bulkSelection.delete(t.id);
      saveTasks(tasks);
      render();
      setSelectedCountLabel();
      renderMergeBar();
      setBulkHint();
      renderBulkBar();
    });
    tools.appendChild(restore);
    tools.appendChild(forever);
    li.appendChild(tools);
    list.appendChild(li);
  });
  body.appendChild(list);
}

function syncPresetSelect() {
  const sel = els.presetSelect;
  if (!sel || !appState.activeProfileId) return;
  const p = appState.profiles[appState.activeProfileId];
  if (!p) return;
  const presets = ensureQuickPresets(p);
  const cur = sel.value;
  sel.innerHTML = '<option value="">— None —</option>';
  presets
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name, "en"))
    .forEach((pr) => {
      const opt = document.createElement("option");
      opt.value = pr.id;
      opt.textContent = pr.name;
      sel.appendChild(opt);
    });
  if ([...sel.options].some((o) => o.value === cur)) sel.value = cur;
}

function setBulkHint() {
  const el = els.bulkHint;
  if (!el) return;
  if (!bulkMode) {
    el.classList.add("hidden");
    el.textContent = "";
    return;
  }
  const n = bulkSelection.size;
  el.classList.remove("hidden");
  if (n === 0) {
    el.innerHTML =
      "Bulk select: choose tasks, then use the action bar or tap <strong>Clear selection</strong>.";
    return;
  }
  el.innerHTML = `<strong>${n}</strong> selected—use the bar below or keep selecting.`;
}

function renderBulkBar() {
  const existing = document.getElementById("bulk-action-bar");
  if (existing) existing.remove();
  if (!bulkMode || bulkSelection.size === 0) return;
  const bar = document.createElement("div");
  bar.id = "bulk-action-bar";
  bar.className = "bulk-action-bar";
  const mkBtn = (/** @type {string} */ label, /** @type {() => void} */ fn) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "btn ghost small";
    b.textContent = label;
    b.addEventListener("click", fn);
    return b;
  };
  bar.appendChild(mkBtn("Mark done", bulkMarkDone));
  bar.appendChild(mkBtn("Mark active", bulkMarkActive));
  bar.appendChild(mkBtn("Set project…", bulkSetProject));
  bar.appendChild(mkBtn("Set due…", bulkSetDue));
  bar.appendChild(mkBtn("Clear due", bulkClearDue));
  bar.appendChild(mkBtn("Remove", bulkMoveToTrash));
  const clear = document.createElement("button");
  clear.type = "button";
  clear.className = "btn ghost small";
  clear.textContent = "Clear selection";
  clear.addEventListener("click", () => {
    bulkSelection.clear();
    setBulkHint();
    renderBulkBar();
    render();
  });
  bar.appendChild(clear);
  document.querySelector(".app")?.appendChild(bar);
}

function bulkMarkDone() {
  const ids = bulkSelection;
  tasks.forEach((t) => {
    if (ids.has(t.id) && !t.deletedAt) {
      t.done = true;
      t.completedDate = todayISODate();
    }
  });
  saveTasks(tasks);
  bulkSelection.clear();
  setBulkHint();
  renderBulkBar();
  render();
}

function bulkMarkActive() {
  const ids = bulkSelection;
  tasks.forEach((t) => {
    if (ids.has(t.id) && !t.deletedAt) {
      t.done = false;
      t.completedDate = "";
    }
  });
  saveTasks(tasks);
  bulkSelection.clear();
  setBulkHint();
  renderBulkBar();
  render();
}

function bulkSetProject() {
  const v = window.prompt("Project name (empty clears)", "");
  if (v === null) return;
  const ids = bulkSelection;
  tasks.forEach((t) => {
    if (ids.has(t.id) && !t.deletedAt) t.category = v.trim();
  });
  saveTasks(tasks);
  bulkSelection.clear();
  setBulkHint();
  renderBulkBar();
  render();
}

function bulkSetDue() {
  const v = window.prompt("Due date (YYYY-MM-DD) or empty to clear", todayISODate());
  if (v === null) return;
  const raw = v.trim();
  const ids = bulkSelection;
  tasks.forEach((t) => {
    if (!ids.has(t.id) || t.deletedAt) return;
    if (!raw) {
      t.dueDate = "";
      t.scheduledDate = t.scheduledDate || t.date;
    } else {
      t.dueDate = raw;
      t.scheduledDate = raw;
    }
  });
  saveTasks(tasks);
  bulkSelection.clear();
  setBulkHint();
  renderBulkBar();
  render();
}

function bulkClearDue() {
  const ids = bulkSelection;
  tasks.forEach((t) => {
    if (ids.has(t.id) && !t.deletedAt) {
      t.dueDate = "";
      t.scheduledDate = t.scheduledDate || t.date;
    }
  });
  saveTasks(tasks);
  bulkSelection.clear();
  setBulkHint();
  renderBulkBar();
  render();
}

function bulkMoveToTrash() {
  const ids = bulkSelection;
  const now = Date.now();
  tasks.forEach((t) => {
    if (ids.has(t.id) && !t.deletedAt) t.deletedAt = now;
  });
  saveTasks(tasks);
  bulkSelection.clear();
  setBulkHint();
  renderBulkBar();
  render();
  setSelectedCountLabel();
  renderMergeBar();
}

function getNavigableTaskIds() {
  const q = getSearchQuery();
  return applyListSort(getFilteredTasks().filter((t) => taskMatchesSearch(t, q))).map((t) => t.id);
}

function focusTaskByKeyboard(taskId) {
  keyboardFocusTaskId = taskId;
  render();
  queueMicrotask(() => {
    const row = els.taskList.querySelector(`li.task-item[data-id="${taskId}"]`);
    row?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  });
}

function initKeyboardNav() {
  document.addEventListener("keydown", (e) => {
    if (mergeMode || bulkMode) return;
    const tEl = e.target;
    const tag =
      tEl && tEl instanceof HTMLElement ? tEl.tagName : "";
    if (
      tag === "INPUT" ||
      tag === "TEXTAREA" ||
      tag === "SELECT" ||
      tag === "BUTTON" ||
      (tEl instanceof HTMLElement && tEl.isContentEditable)
    ) {
      return;
    }
    if (document.querySelector("dialog[open]")) return;

    if (e.key === "/" && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      els.taskSearch?.focus();
      return;
    }

    const ids = getNavigableTaskIds();
    if (ids.length === 0) return;
    let idx = keyboardFocusTaskId ? ids.indexOf(keyboardFocusTaskId) : -1;

    if (e.key === "j" || e.key === "ArrowDown") {
      e.preventDefault();
      idx = Math.min(ids.length - 1, idx + 1);
      if (idx < 0) idx = 0;
      focusTaskByKeyboard(ids[idx]);
      return;
    }
    if (e.key === "k" || e.key === "ArrowUp") {
      e.preventDefault();
      idx = idx < 0 ? ids.length - 1 : Math.max(0, idx - 1);
      focusTaskByKeyboard(ids[idx]);
      return;
    }

    if (!keyboardFocusTaskId) return;
    const task = tasks.find((t) => t.id === keyboardFocusTaskId);
    if (!task || task.deletedAt) return;

    if (e.key === " " || e.key === "Enter") {
      e.preventDefault();
      if (!task.done && normalizeRepeat(task.repeat) !== "none") {
        const follow = makeRepeatFollowupTask(task);
        task.done = true;
        task.completedDate = todayISODate();
        if (follow) tasks.push(follow);
      } else {
        task.done = !task.done;
        task.completedDate = task.done ? todayISODate() : "";
      }
      saveTasks(tasks);
      render();
      return;
    }

    if (e.key === "e" || e.key === "E") {
      e.preventDefault();
      openEditDialog(task);
    }
  });
}

function render() {
  rollFloatingSchedules();
  syncProjectDatalist();
  const q = getSearchQuery();
  const list = getFilteredTasks().filter((t) => taskMatchesSearch(t, q));
  const sorted = applyListSort(list);
  els.taskList.innerHTML = "";

  if (projectViewMode && !mergeMode && !bulkMode) {
    /** @type {Map<string, { display: string, tasks: Task[] }>} */
    const groups = new Map();
    for (const task of sorted) {
      const key = normalizeCategory(task.category);
      if (!groups.has(key)) {
        groups.set(key, {
          display: key ? String(task.category).trim() : "No project",
          tasks: [],
        });
      }
      groups.get(key).tasks.push(task);
    }
    const keys = [...groups.keys()].sort((a, b) => {
      if (a === "" && b !== "") return 1;
      if (b === "" && a !== "") return -1;
      return groups.get(a).display.localeCompare(groups.get(b).display, "en");
    });
    const deadlines = getActiveProjectDeadlines();
    const today = todayISODate();
    for (const key of keys) {
      const g = groups.get(key);
      const head = document.createElement("li");
      head.className = "task-project-heading";
      const inner = document.createElement("div");
      inner.className = "task-project-heading-inner";

      const titleEl = document.createElement("div");
      titleEl.className = "task-project-heading-title";
      titleEl.textContent = `${g.display} (${g.tasks.length})`;
      inner.appendChild(titleEl);

      if (key) {
        const deadlineIso = normalizeProjectDeadlineIso(deadlines[key] || "");
        const tools = document.createElement("div");
        tools.className = "task-project-heading-tools";

        const dlWrap = document.createElement("label");
        dlWrap.className = "project-deadline-field";
        const dlLbl = document.createElement("span");
        dlLbl.className = "project-deadline-field-label";
        dlLbl.textContent = "Deadline";
        const dlInput = document.createElement("input");
        dlInput.type = "date";
        dlInput.className = "project-deadline-input";
        dlInput.min = `${PROJECT_DEADLINE_YEAR_MIN}-01-01`;
        dlInput.max = `${PROJECT_DEADLINE_YEAR_MAX}-12-31`;
        dlInput.value = deadlineIso;
        dlInput.title =
          "Pick a date (year 1970–2100). After this day, you can remove every task in this project at once.";
        dlInput.addEventListener("click", (e) => e.stopPropagation());
        dlInput.addEventListener("change", () => {
          setProjectDeadlineForKey(key, dlInput.value.trim());
          render();
        });
        dlWrap.appendChild(dlLbl);
        dlWrap.appendChild(dlInput);
        tools.appendChild(dlWrap);

        if (deadlineIso && deadlineIso < today) {
          const exp = document.createElement("div");
          exp.className = "project-deadline-expired";
          const msg = document.createElement("span");
          msg.className = "project-deadline-expired-msg";
          msg.textContent = "Deadline passed.";
          const delBtn = document.createElement("button");
          delBtn.type = "button";
          delBtn.className = "btn danger small project-delete-project-btn";
          delBtn.textContent = "Delete project tasks…";
          delBtn.title = "Remove every task with this project name";
          delBtn.addEventListener("click", () => deleteProjectTasksByKey(key, g.display));
          exp.appendChild(msg);
          exp.appendChild(delBtn);
          tools.appendChild(exp);
        }

        inner.appendChild(tools);
      }

      head.appendChild(inner);
      els.taskList.appendChild(head);
      for (const task of g.tasks) {
        els.taskList.appendChild(createTaskRow(task));
      }
    }
  } else {
    sorted.forEach((task) => els.taskList.appendChild(createTaskRow(task)));
  }

  const hasAny = tasksVisible().length > 0;
  const baseList = getFilteredTasks();
  const searchNoHits = Boolean(q && sorted.length === 0 && baseList.length > 0);
  if (els.searchEmpty) {
    els.searchEmpty.classList.toggle("hidden", !searchNoHits);
  }
  els.emptyState.classList.toggle("hidden", hasAny);
  els.taskList.classList.toggle("hidden", !hasAny || searchNoHits);
  renderUpcoming();
  renderOverdue();
  renderTrash();
  syncPresetSelect();
  renderCalendar();
}

/** @param {string} iso */
function tasksCompletedOnDay(iso) {
  return tasksVisible().filter((t) => t.done && t.completedDate === iso);
}

/** @param {string} iso */
function tasksDueNotDoneOnDay(iso) {
  return tasksVisible().filter((t) => {
    if (t.done) return false;
    if (hasHardDueDate(t)) return t.dueDate === iso;
    return (t.scheduledDate || t.date) === iso;
  });
}

function bumpCalendarMonth(delta) {
  viewCalendarMonth += delta;
  if (viewCalendarMonth > 11) {
    viewCalendarMonth = 0;
    viewCalendarYear += 1;
  } else if (viewCalendarMonth < 0) {
    viewCalendarMonth = 11;
    viewCalendarYear -= 1;
  }
  const t = todayISODate();
  const mp = calendarMonthPrefix(viewCalendarYear, viewCalendarMonth);
  calendarSelectedIso = t.startsWith(mp + "-") ? t : null;
}

function goCalendarThisMonth() {
  const n = new Date();
  viewCalendarYear = n.getFullYear();
  viewCalendarMonth = n.getMonth();
  calendarSelectedIso = todayISODate();
}

function renderCalendar() {
  const prefix = calendarMonthPrefix(viewCalendarYear, viewCalendarMonth);
  const activeCount = tasksVisible().filter((t) => !t.done).length;
  const monthDoneCount = tasksVisible().filter(
    (t) => t.done && typeof t.completedDate === "string" && t.completedDate.startsWith(prefix)
  ).length;

  els.calLabel.textContent = new Date(viewCalendarYear, viewCalendarMonth, 1).toLocaleString("en-US", {
    month: "long",
    year: "numeric",
  });
  els.calSummary.innerHTML = `<strong>${activeCount}</strong> open · <strong>${monthDoneCount}</strong> completed this month (by completion date).`;

  els.calGrid.innerHTML = "";
  const first = new Date(viewCalendarYear, viewCalendarMonth, 1);
  const startOffset = (first.getDay() + 6) % 7;
  const iter = new Date(viewCalendarYear, viewCalendarMonth, 1 - startOffset);
  const today = todayISODate();

  for (let i = 0; i < 42; i++) {
    const iso = toLocalISODate(iter);
    const inMonth =
      iter.getFullYear() === viewCalendarYear && iter.getMonth() === viewCalendarMonth;
    const dayNum = iter.getDate();
    const doneHere = tasksCompletedOnDay(iso).length;
    const openHere = tasksDueNotDoneOnDay(iso).length;

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "cal-cell";
    if (!inMonth) btn.classList.add("other-month");
    if (iso === today) btn.classList.add("today");
    if (calendarSelectedIso && iso === calendarSelectedIso) btn.classList.add("selected");
    if (openHere > 0) btn.classList.add("cal-cell-has-open");
    btn.setAttribute("role", "gridcell");
    const ariaBits = [];
    if (openHere) ariaBits.push(`${openHere} to do`);
    if (doneHere) ariaBits.push(`${doneHere} completed`);
    btn.setAttribute("aria-label", `${iso}${ariaBits.length ? ", " + ariaBits.join(", ") : ", nothing scheduled"}`);

    const num = document.createElement("span");
    num.className = "cal-cell-day";
    num.textContent = String(dayNum);
    btn.appendChild(num);

    const badges = document.createElement("span");
    badges.className = "cal-cell-badges";
    const badgeOpen = document.createElement("span");
    badgeOpen.className = "cal-cell-badge cal-cell-badge-open";
    if (openHere > 0) badgeOpen.textContent = String(openHere);
    const badgeDone = document.createElement("span");
    badgeDone.className = "cal-cell-badge cal-cell-badge-done";
    if (doneHere > 0) badgeDone.textContent = String(doneHere);
    badges.appendChild(badgeOpen);
    badges.appendChild(badgeDone);
    btn.appendChild(badges);

    btn.addEventListener("click", () => {
      if (!inMonth) {
        const [yy, mm] = iso.split("-").map(Number);
        viewCalendarYear = yy;
        viewCalendarMonth = mm - 1;
      }
      calendarSelectedIso = iso;
      renderCalendar();
    });

    els.calGrid.appendChild(btn);
    iter.setDate(iter.getDate() + 1);
  }

  if (!calendarSelectedIso) {
    els.calDetailTitle.textContent = "Pick a day";
    els.calDetailStat.textContent =
      "Tap a date to see what you finished that day and what was due or scheduled but still open.";
    els.calDetailDoneLabel.classList.add("hidden");
    els.calDetailDueLabel.classList.add("hidden");
    els.calDetailDone.innerHTML = "";
    els.calDetailDue.innerHTML = "";
    return;
  }

  els.calDetailDoneLabel.classList.remove("hidden");
  els.calDetailDueLabel.classList.remove("hidden");

  const doneList = tasksCompletedOnDay(calendarSelectedIso);
  const dueList = tasksDueNotDoneOnDay(calendarSelectedIso);

  els.calDetailTitle.textContent = formatDateLabel(calendarSelectedIso);
  els.calDetailStat.textContent = `${doneList.length} completed · ${dueList.length} due or scheduled, still open.`;

  const fillList = (ul, items) => {
    ul.innerHTML = "";
    if (items.length === 0) {
      const li = document.createElement("li");
      li.textContent = "(None)";
      li.style.opacity = "0.75";
      ul.appendChild(li);
      return;
    }
    items.forEach((t) => {
      const li = document.createElement("li");
      li.textContent = t.title;
      ul.appendChild(li);
    });
  };

  fillList(els.calDetailDone, doneList);
  fillList(els.calDetailDue, dueList);
}

function formatDateLabel(iso) {
  try {
    const [y, m, d] = iso.split("-").map(Number);
    return new Date(y, m - 1, d).toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  } catch {
    return iso;
  }
}

function renderMergeBar() {
  const existing = document.getElementById("merge-selected-bar");
  if (existing) existing.remove();
  if (!mergeMode || mergeSelection.size < 2) return;
  const bar = document.createElement("div");
  bar.id = "merge-selected-bar";
  bar.className = "merge-selected-bar";
  const label = document.createElement("span");
  label.textContent = `${mergeSelection.size} selected`;
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "btn primary";
  btn.textContent = "Merge selected";
  btn.addEventListener("click", openMergeDialogForSelection);
  bar.appendChild(label);
  bar.appendChild(btn);
  document.querySelector(".app")?.appendChild(bar);
}

/** @param {Task} task */
function openSplitDialog(task) {
  pendingSplitTaskId = task.id;
  const chunks = task.title.split(/\s*[;；]\s*/).map((s) => s.trim()).filter(Boolean);
  els.splitLines.value = chunks.length > 1 ? chunks.join("\n") : task.title;
  els.splitDialog.showModal();
  queueMicrotask(() => els.splitLines.focus());
}

function applySplitFromDialog() {
  const sid = pendingSplitTaskId;
  if (!sid) return;
  const source = tasks.find((t) => t.id === sid);
  if (!source) {
    pendingSplitTaskId = null;
    els.splitDialog.close();
    return;
  }
  const lines = parseTaskLines(els.splitLines.value);
  if (lines.length < 2) {
    window.alert("Add at least two non-empty lines to create subtasks.");
    return;
  }
  const creation = source.date;
  const dueRaw = source.dueDate || "";
  const sched = source.scheduledDate || source.date;
  const cat = (source.category || "").trim();
  const baseTime = Date.now();
  const newTasks = lines.map((title, i) => ({
    id: crypto.randomUUID(),
    title,
    notes: source.notes || "",
    date: creation,
    dueDate: dueRaw,
    scheduledDate: dueRaw || sched,
    completedDate: "",
    category: cat,
    done: false,
    createdAt: baseTime + i,
    repeat: normalizeRepeat(source.repeat),
    manualOrder: 0,
    deletedAt: null,
  }));
  tasks = tasks.filter((t) => t.id !== sid);
  mergeSelection.delete(sid);
  if (editingTaskId === sid) {
    editingTaskId = null;
    els.editDialog.close();
  }
  tasks.push(...newTasks);
  saveTasks(tasks);
  pendingSplitTaskId = null;
  els.splitDialog.close();
  render();
  setSelectedCountLabel();
  renderMergeBar();
}

/** @param {Task} task */
function openEditDialog(task) {
  syncProjectDatalist();
  editingTaskId = task.id;
  els.editTitle.value = task.title;
  els.editDate.value = task.date;
  els.editDueDate.value = task.dueDate || "";
  els.editCategory.value = task.category || "";
  els.editNotes.value = task.notes || "";
  els.editRepeat.value = normalizeRepeat(task.repeat);
  els.editDialog.showModal();
  queueMicrotask(() => els.editTitle.focus());
}

function openMergeDialogForSelection() {
  const selected = tasks.filter((t) => mergeSelection.has(t.id));
  if (selected.length < 2) return;
  pendingMergeTasks = selected;
  const payload = mergeTasksPayload(selected);
  syncProjectDatalist();
  els.mergeTitle.value = payload.title;
  els.mergeDate.value = payload.date;
  els.mergeDueDate.value = payload.dueDate || "";
  els.mergeCategory.value = payload.category || "";
  els.mergeDialog.showModal();
  queueMicrotask(() => els.mergeTitle.focus());
}

function applyMerge(replacement) {
  if (!pendingMergeTasks || pendingMergeTasks.length < 2) return;
  const removeIds = new Set(pendingMergeTasks.map((t) => t.id));
  tasks = tasks.filter((t) => !removeIds.has(t.id));
  tasks.push(replacement);
  saveTasks(tasks);
  mergeSelection.clear();
  pendingMergeTasks = null;
  els.mergeDialog.close();
  render();
  setSelectedCountLabel();
  renderMergeBar();
}

els.editDialog.addEventListener("close", () => {
  editingTaskId = null;
});

els.editCancel.addEventListener("click", () => {
  els.editDialog.close();
});

els.editSave.addEventListener("click", () => {
  if (!editingTaskId) return;
  const task = tasks.find((t) => t.id === editingTaskId);
  if (!task) {
    editingTaskId = null;
    els.editDialog.close();
    return;
  }
  const title = els.editTitle.value.trim();
  if (!title) return;
  const creation = els.editDate.value || task.date;
  const dueRaw = els.editDueDate.value.trim();
  task.title = title;
  task.date = creation;
  task.dueDate = dueRaw;
  task.scheduledDate = dueRaw || creation;
  task.category = els.editCategory.value.trim();
  task.notes = els.editNotes.value;
  task.repeat = normalizeRepeat(els.editRepeat.value);
  saveTasks(tasks);
  editingTaskId = null;
  els.editDialog.close();
  render();
});

els.mergeCancel.addEventListener("click", () => {
  pendingMergeTasks = null;
  els.mergeDialog.close();
});

els.mergeConfirm.addEventListener("click", () => {
  if (!pendingMergeTasks || pendingMergeTasks.length < 2) return;
  const title = els.mergeTitle.value.trim();
  if (!title) return;
  const prev = mergeTasksPayload(pendingMergeTasks);
  const dueVal = els.mergeDueDate.value.trim();
  const replacement = {
    id: crypto.randomUUID(),
    title,
    notes: pendingMergeTasks.map((t) => (t.notes || "").trim()).filter(Boolean).join("\n---\n"),
    date: els.mergeDate.value || prev.date,
    dueDate: dueVal,
    scheduledDate: dueVal || prev.scheduledDate || todayISODate(),
    category: els.mergeCategory.value.trim(),
    done: prev.done,
    completedDate: prev.completedDate || "",
    createdAt: Date.now(),
    repeat: "none",
    manualOrder: 0,
    deletedAt: null,
  };
  applyMerge(replacement);
});

els.addForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const lines = parseTaskLines(els.taskTitle.value);
  if (lines.length === 0) return;
  const creation = els.taskDate.value || todayISODate();
  const dueRaw = els.taskDueDate.value.trim();
  const cat = els.taskCategory.value.trim();
  const notesVal = (els.taskNotes?.value || "").trim();
  const repeatVal = normalizeRepeat(els.taskRepeat?.value || "none");
  const baseTime = Date.now();
  lines.forEach((title, i) => {
    tasks.push({
      id: crypto.randomUUID(),
      title,
      notes: notesVal,
      date: creation,
      dueDate: dueRaw,
      scheduledDate: dueRaw || creation,
      completedDate: "",
      category: cat,
      done: false,
      createdAt: baseTime + i,
      repeat: repeatVal,
      manualOrder: 0,
      deletedAt: null,
    });
  });
  saveTasks(tasks);
  els.taskTitle.value = "";
  els.taskCategory.value = "";
  if (els.taskNotes) els.taskNotes.value = "";
  if (els.taskRepeat) els.taskRepeat.value = "none";
  const t = todayISODate();
  els.taskDate.value = t;
  els.taskDueDate.value = "";
  render();
});

els.filters.forEach((btn) => {
  btn.addEventListener("click", () => {
    els.filters.forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    filter = btn.dataset.filter || "all";
    mergeSelection.clear();
    bulkSelection.clear();
    keyboardFocusTaskId = null;
    setSelectedCountLabel();
    renderMergeBar();
    setBulkHint();
    renderBulkBar();
    render();
  });
});

els.toggleMerge.addEventListener("click", () => {
  mergeMode = !mergeMode;
  if (mergeMode) {
    projectViewMode = false;
    bulkMode = false;
    bulkSelection.clear();
    els.toggleProjectView.setAttribute("aria-pressed", "false");
    els.toggleBulk?.setAttribute("aria-pressed", "false");
    document.getElementById("bulk-action-bar")?.remove();
    setBulkHint();
  }
  els.toggleMerge.setAttribute("aria-pressed", String(mergeMode));
  mergeSelection.clear();
  pendingMergeTasks = null;
  document.getElementById("merge-selected-bar")?.remove();
  keyboardFocusTaskId = null;
  setSelectedCountLabel();
  render();
});

els.toggleBulk?.addEventListener("click", () => {
  bulkMode = !bulkMode;
  if (bulkMode) {
    projectViewMode = false;
    mergeMode = false;
    mergeSelection.clear();
    pendingMergeTasks = null;
    els.toggleProjectView.setAttribute("aria-pressed", "false");
    els.toggleMerge.setAttribute("aria-pressed", "false");
    document.getElementById("merge-selected-bar")?.remove();
    setSelectedCountLabel();
  }
  els.toggleBulk.setAttribute("aria-pressed", String(bulkMode));
  bulkSelection.clear();
  document.getElementById("bulk-action-bar")?.remove();
  keyboardFocusTaskId = null;
  setBulkHint();
  render();
});

els.toggleProjectView.addEventListener("click", () => {
  projectViewMode = !projectViewMode;
  if (projectViewMode) {
    mergeMode = false;
    bulkMode = false;
    mergeSelection.clear();
    bulkSelection.clear();
    pendingMergeTasks = null;
    document.getElementById("merge-selected-bar")?.remove();
    document.getElementById("bulk-action-bar")?.remove();
    els.toggleMerge.setAttribute("aria-pressed", "false");
    els.toggleBulk?.setAttribute("aria-pressed", "false");
    setSelectedCountLabel();
    setBulkHint();
  }
  els.toggleProjectView.setAttribute("aria-pressed", String(projectViewMode));
  keyboardFocusTaskId = null;
  render();
});

els.sortMode?.addEventListener("change", () => {
  const v = els.sortMode?.value || "schedule";
  setSortMode(v);
  if (v === "manual") normalizeManualOrdersForVisible();
  keyboardFocusTaskId = null;
  render();
});

els.presetSelect?.addEventListener("change", () => {
  const id = els.presetSelect?.value;
  if (!id || !appState.activeProfileId) return;
  const p = appState.profiles[appState.activeProfileId];
  if (!p) return;
  const pr = ensureQuickPresets(p).find((x) => x.id === id);
  if (!pr) return;
  if (els.taskCategory) els.taskCategory.value = pr.category || "";
  if (els.taskDueDate) {
    if (pr.dueOffsetDays == null) els.taskDueDate.value = "";
    else els.taskDueDate.value = addDaysISO(todayISODate(), pr.dueOffsetDays);
  }
});

els.presetSave?.addEventListener("click", () => {
  if (!appState.activeProfileId) return;
  const p = appState.profiles[appState.activeProfileId];
  if (!p) return;
  const name = window.prompt("Name for this preset (e.g. Work errands)", "");
  if (!name || !name.trim()) return;
  const creation = els.taskDate.value || todayISODate();
  const dueRaw = els.taskDueDate.value.trim();
  let dueOffsetDays = null;
  if (dueRaw) {
    const t0 = new Date(creation + "T12:00:00");
    const t1 = new Date(dueRaw + "T12:00:00");
    dueOffsetDays = Math.round((t1 - t0) / 86400000);
  }
  const presetId = crypto.randomUUID();
  ensureQuickPresets(p).push({
    id: presetId,
    name: name.trim(),
    category: els.taskCategory.value.trim(),
    dueOffsetDays,
  });
  persistAppState();
  syncPresetSelect();
  if (els.presetSelect) els.presetSelect.value = presetId;
});

els.trashEmpty?.addEventListener("click", () => {
  const n = tasks.filter((t) => t.deletedAt).length;
  if (!n) return;
  if (!window.confirm(`Delete all ${n} task${n === 1 ? "" : "s"} in trash permanently?`)) return;
  tasks = tasks.filter((t) => !t.deletedAt);
  saveTasks(tasks);
  render();
});

els.calPrev.addEventListener("click", () => {
  bumpCalendarMonth(-1);
  renderCalendar();
});

els.calNext.addEventListener("click", () => {
  bumpCalendarMonth(1);
  renderCalendar();
});

els.calThisMonth.addEventListener("click", () => {
  goCalendarThisMonth();
  renderCalendar();
});

els.accountGate.addEventListener("cancel", (e) => {
  if (needsAccountGate()) e.preventDefault();
});

els.accountSwitch.addEventListener("click", () => {
  openAccountPicker();
});

els.accountPinCancel.addEventListener("click", () => {
  pendingProfileIdForPin = null;
  els.accountPin.close();
  const revert = lastUnlockedProfileId;
  if (revert && appState.profiles[revert]) {
    appState.activeProfileId = revert;
    persistAppState();
    loadTasksForActiveProfile();
    updateAccountLabel();
    bootstrapTaskFormAndRender();
  } else {
    appState.activeProfileId = null;
    tasks = [];
    persistAppState();
    updateAccountLabel();
    if (Object.keys(appState.profiles).length === 0) buildAccountGateBody("create");
    else buildAccountGateBody("pick");
    els.accountGate.showModal();
  }
});

els.themeToggle?.addEventListener("click", () => cycleThemePref());

els.taskSearch?.addEventListener("input", () => {
  render();
});

els.splitDialog.addEventListener("close", () => {
  pendingSplitTaskId = null;
});

els.splitCancel.addEventListener("click", () => {
  els.splitDialog.close();
});

els.splitConfirm.addEventListener("click", () => {
  applySplitFromDialog();
});

els.splitByDelimiters.addEventListener("click", () => {
  const parts = els.splitLines.value
    .split(/[;；]\s*/)
    .map((s) => s.trim())
    .filter(Boolean);
  els.splitLines.value = parts.join("\n");
});

els.accountPinSubmit.addEventListener("click", async () => {
  const pending = pendingProfileIdForPin;
  if (!pending || !appState.profiles[pending]) {
    els.accountPin.close();
    return;
  }
  const typed = els.accountPinInput.value;
  const got = await hashPin(typed);
  const p = appState.profiles[pending];
  if (got !== p.pinHash) {
    window.alert("Incorrect PIN.");
    return;
  }
  unlockProfileSession(pending);
  pendingProfileIdForPin = null;
  appState.activeProfileId = pending;
  persistAppState();
  loadTasksForActiveProfile();
  updateAccountLabel();
  els.accountPin.close();
  bootstrapTaskFormAndRender();
});

applyThemePref();
updateThemeButtonLabel();
initKeyboardNav();

if (needsAccountGate()) {
  const id = appState.activeProfileId;
  if (id && appState.profiles[id]?.pinHash && !isProfileSessionUnlocked(id)) {
    pendingProfileIdForPin = id;
    const p = appState.profiles[id];
    els.accountPinFor.textContent = `Enter PIN for “${p.name}”.`;
    els.accountPinInput.value = "";
    els.accountPin.showModal();
    queueMicrotask(() => els.accountPinInput.focus());
  } else if (Object.keys(appState.profiles).length === 0) {
    buildAccountGateBody("create");
    els.accountGate.showModal();
  } else {
    buildAccountGateBody("pick");
    els.accountGate.showModal();
  }
} else {
  loadTasksForActiveProfile();
  lastUnlockedProfileId = appState.activeProfileId;
  updateAccountLabel();
  bootstrapTaskFormAndRender();
}

els.accountPin.addEventListener("cancel", (e) => {
  e.preventDefault();
});
