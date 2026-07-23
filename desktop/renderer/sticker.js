"use strict";

// Storage stays compatible with the web app: localStorage["todo-app-v2"]
// = { profiles: { [id]: { id, name, pinHash, tasks: Task[] } }, activeProfileId }.
// Tasks add an optional `startDate` (kept alongside dueDate). A single implicit
// "default" profile is used.
const STORAGE_KEY = "todo-app-v2";
const PROFILE_ID = "default";

const VIEW_SIZES = {
  list: { w: 340, h: 480 },
  board: { w: 460, h: 520 },
  calendar: { w: 460, h: 520 },
};

function pad(n) {
  return String(n).padStart(2, "0");
}
function toISO(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function todayISO() {
  return toISO(new Date());
}
function parseISO(iso) {
  if (!iso) return null;
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
}
function dayDiff(iso) {
  const a = parseISO(iso);
  if (!a) return null;
  const t = parseISO(todayISO());
  return Math.round((a - t) / 86400000);
}
function formatDue(iso) {
  const diff = dayDiff(iso);
  if (diff === null) return "";
  if (diff === 0) return "Today";
  if (diff === 1) return "Tomorrow";
  if (diff === -1) return "Yesterday";
  const d = parseISO(iso);
  const opts = { month: "short", day: "numeric" };
  return d.toLocaleDateString(undefined, opts);
}
// A curated, well-spread palette so auto-assigned group colors are distinct
// (the old name-hash could land many groups in the same hue, e.g. all purple).
const PALETTE = [
  "#0d9488", // teal
  "#2563eb", // blue
  "#7c3aed", // violet
  "#db2777", // pink
  "#dc2626", // red
  "#ea580c", // orange
  "#ca8a04", // amber
  "#16a34a", // green
  "#0891b2", // cyan
  "#4f46e5", // indigo
];
function hashStr(name) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return h;
}
function groupMeta() {
  const p = profile();
  if (!p.groupMeta) p.groupMeta = {};
  return p.groupMeta;
}
function getGroupColor(name) {
  const m = groupMeta()[name];
  if (m && m.color) return m.color;
  return PALETTE[hashStr(name) % PALETTE.length];
}
function getGroupEmoji(name) {
  const m = groupMeta()[name];
  return (m && m.emoji) || "";
}
function setGroupColor(name, color) {
  const meta = groupMeta();
  meta[name] = Object.assign({}, meta[name], { color });
  save();
}
function setGroupEmoji(name, emoji) {
  const meta = groupMeta();
  meta[name] = Object.assign({}, meta[name], { emoji });
  save();
}
// Pick the palette color that's currently used by the fewest groups, so new
// groups come out distinct (first 10 groups are guaranteed different colors).
function pickDistinctColor() {
  const meta = groupMeta();
  const counts = new Array(PALETTE.length).fill(0);
  for (const k in meta) {
    const idx = PALETTE.indexOf(meta[k] && meta[k].color);
    if (idx >= 0) counts[idx]++;
  }
  let best = 0;
  for (let i = 1; i < PALETTE.length; i++) if (counts[i] < counts[best]) best = i;
  return PALETTE[best];
}
// Give a group a stable color the first time it appears. Returns true if it
// assigned one (so the caller knows to save).
function ensureGroupColor(name) {
  name = (name || "").trim();
  if (!name) return false;
  const meta = groupMeta();
  if (meta[name] && meta[name].color) return false;
  meta[name] = Object.assign({}, meta[name], { color: pickDistinctColor() });
  return true;
}

// ---- state ----
function loadState() {
  let state = null;
  try {
    state = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
  } catch (_) {
    state = null;
  }
  if (!state || typeof state !== "object" || !state.profiles) {
    state = { profiles: {}, activeProfileId: PROFILE_ID };
  }
  if (!state.profiles[state.activeProfileId]) {
    const ids = Object.keys(state.profiles);
    if (ids.length) {
      state.activeProfileId = ids[0];
    } else {
      state.profiles[PROFILE_ID] = { id: PROFILE_ID, name: "Default", pinHash: null, tasks: [] };
      state.activeProfileId = PROFILE_ID;
    }
  }
  return state;
}

let state = loadState();
function profile() {
  return state.profiles[state.activeProfileId];
}
function save() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}
function activeTasks() {
  return profile().tasks.filter((t) => !t.deletedAt);
}
function newId() {
  if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
  return "t_" + Date.now() + "_" + Math.random().toString(36).slice(2, 9);
}

function addTask(title, opts) {
  const text = title.trim();
  if (!text) return;
  const today = todayISO();
  const now = Date.now();
  const due = (opts.dueDate || "").trim();
  const start = (opts.startDate || "").trim();
  const tasks = profile().tasks;
  const minOrder = tasks.reduce((m, t) => Math.min(m, t.manualOrder ?? 0), 0);
  tasks.push({
    id: newId(),
    title: text,
    kind: "personal",
    done: false,
    date: today, // creation date (auto)
    dueDate: due,
    startDate: start,
    scheduledDate: start || due || today,
    completedDate: "",
    category: (opts.category || "").trim(),
    createdAt: now,
    manualOrder: minOrder - 1,
    deletedAt: null,
    repeatDays: 0,
  });
  ensureGroupColor(opts.category);
  save();
}
// When a repeating task is completed, spawn its next occurrence (dates advanced
// by repeatDays), like a recurring calendar event.
function shiftISO(iso, days) {
  const d = parseISO(iso);
  if (!d) return iso;
  d.setDate(d.getDate() + days);
  return toISO(d);
}
function spawnNextOccurrence(t) {
  const n = t.repeatDays;
  if (!(n > 0)) return;
  let due = t.dueDate ? shiftISO(t.dueDate, n) : "";
  let start = t.startDate ? shiftISO(t.startDate, n) : "";
  if (!due && !start) due = shiftISO(todayISO(), n);
  const tasks = profile().tasks;
  const minOrder = tasks.reduce((m, x) => Math.min(m, x.manualOrder ?? 0), 0);
  tasks.push({
    id: newId(),
    title: t.title,
    kind: t.kind || "personal",
    done: false,
    date: todayISO(),
    dueDate: due,
    startDate: start,
    scheduledDate: start || due || todayISO(),
    completedDate: "",
    category: t.category || "",
    createdAt: Date.now(),
    manualOrder: minOrder - 1,
    deletedAt: null,
    repeatDays: n,
  });
}
function findTask(id) {
  return profile().tasks.find((t) => t.id === id);
}
function toggleDone(id) {
  const t = findTask(id);
  if (!t) return;
  t.done = !t.done;
  t.completedDate = t.done ? todayISO() : "";
  if (t.done && t.repeatDays > 0) spawnNextOccurrence(t);
  save();
}
function removeTask(id) {
  const p = profile();
  p.tasks = p.tasks.filter((t) => t.id !== id);
  save();
}
function updateTask(id, patch) {
  const t = findTask(id);
  if (!t) return;
  Object.assign(t, patch);
  t.scheduledDate = t.startDate || t.dueDate || t.date;
  ensureGroupColor(t.category);
  save();
}
// Give any pre-existing groups (from before this feature) a distinct color.
function migrateGroupColors() {
  let changed = false;
  for (const name of groups()) if (ensureGroupColor(name)) changed = true;
  if (changed) save();
}
function groups() {
  const set = new Set();
  for (const t of activeTasks()) if (t.category) set.add(t.category);
  return Array.from(set).sort((a, b) => a.localeCompare(b));
}

// ---- dom ----
const $ = (id) => document.getElementById(id);
const els = {
  form: $("add-form"),
  input: $("new-task"),
  group: $("new-group"),
  due: $("new-due"),
  dueToday: $("due-today"),
  start: $("new-start"),
  startWrap: $("start-wrap"),
  toggleStart: $("toggle-start"),
  groupList: $("group-list"),
  count: $("count"),
  close: $("close-btn"),
  tabs: Array.from(document.querySelectorAll(".view-tab")),
  panels: {
    list: $("view-list"),
    board: $("view-board"),
    calendar: $("view-calendar"),
  },
  chips: Array.from(document.querySelectorAll(".chip")),
  list: $("list"),
  empty: $("empty"),
  board: $("board"),
  calPrev: $("cal-prev"),
  calNext: $("cal-next"),
  calLabel: $("cal-label"),
  calGrid: $("cal-grid"),
  calPopover: $("cal-popover"),
  calPopoverTitle: $("cal-popover-title"),
  calPopoverList: $("cal-popover-list"),
  overlay: $("edit-overlay"),
  editTitle: $("edit-title"),
  editGroup: $("edit-group"),
  editStart: $("edit-start"),
  editDue: $("edit-due"),
  editSave: $("edit-save"),
  editCancel: $("edit-cancel"),
  editDelete: $("edit-delete"),
  editRepeat: $("edit-repeat"),
  toast: $("toast"),
  editGroupStyle: $("edit-group-style"),
  editGroupSwatch: $("edit-group-swatch"),
  editGroupEmoji: $("edit-group-emoji"),
  gpOverlay: $("group-picker"),
  gpName: $("gp-name"),
  gpSwatches: $("gp-swatches"),
  gpColorInput: $("gp-color-input"),
  gpColorHex: $("gp-color-hex"),
  gpEmojiQuick: $("gp-emoji-quick"),
  gpEmojiInput: $("gp-emoji-input"),
  gpEmojiClear: $("gp-emoji-clear"),
  gpDone: $("gp-done"),
};

const QUICK_EMOJI = ["📌", "🔥", "⭐️", "💼", "🏠", "🛒", "✏️", "💡", "❤️", "✅"];

let view = "list";
let filter = "active";
let calYear, calMonth;
{
  const now = new Date();
  calYear = now.getFullYear();
  calMonth = now.getMonth();
}

// ---- shared bits ----
function checkbox(task) {
  const el = document.createElement("span");
  el.className = "check";
  el.setAttribute("role", "checkbox");
  el.setAttribute("aria-checked", String(!!task.done));
  el.innerHTML = '<svg viewBox="0 0 24 24"><polyline points="4 12 10 18 20 6"/></svg>';
  el.addEventListener("click", (e) => {
    e.stopPropagation();
    toggleDone(task.id);
    render();
  });
  return el;
}
function dueEl(task) {
  if (!task.dueDate) return null;
  const span = document.createElement("span");
  span.className = "due";
  const diff = dayDiff(task.dueDate);
  if (!task.done && diff !== null && diff < 0) span.classList.add("overdue");
  else if (!task.done && diff !== null && diff <= 1) span.classList.add("soon");
  span.textContent = "◇ " + formatDue(task.dueDate);
  return span;
}
function tagEl(name) {
  const t = document.createElement("span");
  t.className = "tag";
  t.style.background = getGroupColor(name);
  const emoji = getGroupEmoji(name);
  t.textContent = (emoji ? emoji + " " : "") + name;
  return t;
}
function sortByDue(list) {
  return list.slice().sort((a, b) => {
    if (a.done !== b.done) return a.done ? 1 : -1;
    const ad = a.dueDate || "9999-99-99";
    const bd = b.dueDate || "9999-99-99";
    if (ad !== bd) return ad < bd ? -1 : 1;
    return (a.manualOrder ?? 0) - (b.manualOrder ?? 0);
  });
}

// ---- list view ----
function renderList() {
  const all = activeTasks();
  let shown = all;
  if (filter === "active") shown = all.filter((t) => !t.done);
  else if (filter === "done") shown = all.filter((t) => t.done);
  shown = sortByDue(shown);

  els.list.innerHTML = "";
  for (const t of shown) {
    const li = document.createElement("li");
    li.className = "row" + (t.done ? " done" : "");

    const main = document.createElement("div");
    main.className = "row-main";
    const label = document.createElement("div");
    label.className = "label";
    label.textContent = t.title;
    main.appendChild(label);

    const meta = document.createElement("div");
    meta.className = "meta";
    if (t.category) meta.appendChild(tagEl(t.category));
    const due = dueEl(t);
    if (due) meta.appendChild(due);
    if (meta.childNodes.length) main.appendChild(meta);
    main.addEventListener("click", () => openEdit(t.id));

    const del = document.createElement("button");
    del.className = "del";
    del.type = "button";
    del.textContent = "✕";
    del.title = "Delete";
    del.addEventListener("click", (e) => {
      e.stopPropagation();
      removeTask(t.id);
      render();
    });

    li.append(checkbox(t), main, del);
    els.list.appendChild(li);
  }
  els.empty.classList.toggle("hidden", shown.length > 0);
}

// ---- board view ----
function renderBoard() {
  const all = activeTasks();
  const cols = new Map(); // name -> tasks
  const NONE = " none";
  for (const t of all) {
    const key = t.category || NONE;
    if (!cols.has(key)) cols.set(key, []);
    cols.get(key).push(t);
  }
  // Stable order: named groups alphabetically, "No group" last.
  const names = Array.from(cols.keys())
    .filter((k) => k !== NONE)
    .sort((a, b) => a.localeCompare(b));
  if (cols.has(NONE)) names.push(NONE);

  els.board.innerHTML = "";
  if (names.length === 0) {
    const p = document.createElement("p");
    p.className = "empty";
    p.textContent = "No tasks yet.";
    els.board.appendChild(p);
    return;
  }
  for (const name of names) {
    const list = sortByDue(cols.get(name));
    const col = document.createElement("div");
    col.className = "column";

    const head = document.createElement("div");
    head.className = "column-head";
    const isNone = name === NONE;
    const dot = document.createElement("span");
    dot.className = "col-dot";
    dot.style.background = isNone ? "var(--muted)" : getGroupColor(name);
    const title = document.createElement("span");
    const emoji = isNone ? "" : getGroupEmoji(name);
    title.textContent = isNone ? "No group" : (emoji ? emoji + " " : "") + name;
    const cnt = document.createElement("span");
    cnt.className = "col-count";
    cnt.textContent = String(list.filter((t) => !t.done).length);
    head.append(dot, title, cnt);
    if (!isNone) {
      head.classList.add("clickable");
      head.title = "Click to set this group's color & emoji";
      head.addEventListener("click", () => openGroupPicker(name));
    }

    const body = document.createElement("div");
    body.className = "column-body";
    for (const t of list) {
      const card = document.createElement("div");
      card.className = "card" + (t.done ? " done" : "");
      const row = document.createElement("div");
      row.style.display = "flex";
      row.style.gap = "7px";
      row.style.alignItems = "flex-start";
      const ttl = document.createElement("div");
      ttl.className = "card-title";
      ttl.textContent = t.title;
      const wrap = document.createElement("div");
      wrap.style.flex = "1";
      wrap.style.minWidth = "0";
      wrap.appendChild(ttl);
      const due = dueEl(t);
      if (due) wrap.appendChild(due);
      row.append(checkbox(t), wrap);
      card.appendChild(row);
      card.addEventListener("click", (e) => {
        if (e.target.closest(".check")) return;
        openEdit(t.id);
      });
      body.appendChild(card);
    }
    col.append(head, body);
    els.board.appendChild(col);
  }
}

// ---- calendar view ----
// Hovering (or tapping) a day floats a popover with that day's tasks, instead
// of a fixed detail panel that got cramped and easy to miss in the small window.
let popoverHideTimer = null;
let popoverIso = null;

function cancelPopoverHide() {
  if (popoverHideTimer) {
    clearTimeout(popoverHideTimer);
    popoverHideTimer = null;
  }
}
function hideDayPopover() {
  popoverIso = null;
  els.calPopover.classList.remove("visible");
  els.calPopover.classList.add("hidden");
  els.calGrid.querySelectorAll(".cal-cell.selected").forEach((c) => c.classList.remove("selected"));
}
function scheduleHidePopover() {
  cancelPopoverHide();
  popoverHideTimer = setTimeout(hideDayPopover, 160);
}
function dayItems(iso, dueMap, startMap) {
  const seen = new Set();
  const items = [];
  for (const t of dueMap.get(iso) || []) {
    seen.add(t.id);
    items.push({ t, role: "due" });
  }
  for (const t of startMap.get(iso) || []) {
    if (seen.has(t.id)) continue;
    items.push({ t, role: "start" });
  }
  return items;
}
function showDayPopover(cell, iso, dueMap, startMap) {
  cancelPopoverHide();
  const items = dayItems(iso, dueMap, startMap);
  if (items.length === 0) {
    hideDayPopover();
    return;
  }
  popoverIso = iso;
  els.calGrid.querySelectorAll(".cal-cell.selected").forEach((c) => c.classList.remove("selected"));
  cell.classList.add("selected");

  const d = parseISO(iso);
  els.calPopoverTitle.textContent = d.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
  els.calPopoverList.innerHTML = "";
  for (const { t, role } of items) {
    const li = document.createElement("li");
    if (t.done) li.classList.add("done");
    const kind = document.createElement("span");
    kind.className = "kind";
    kind.style.background = role === "due" ? "var(--brand)" : "var(--muted)";
    kind.textContent = role === "due" ? "due" : "start";
    const txt = document.createElement("span");
    txt.className = "t";
    const catLabel = t.category
      ? "  ·  " + (getGroupEmoji(t.category) ? getGroupEmoji(t.category) + " " : "") + t.category
      : "";
    txt.textContent = t.title + catLabel;
    li.append(kind, txt);
    li.addEventListener("click", (e) => {
      e.stopPropagation();
      hideDayPopover();
      openEdit(t.id);
    });
    els.calPopoverList.appendChild(li);
  }

  // Position near the cell, clamped inside the sticker window.
  const stickerEl = document.querySelector(".sticker");
  const stickerRect = stickerEl.getBoundingClientRect();
  const cellRect = cell.getBoundingClientRect();
  els.calPopover.classList.remove("hidden");
  els.calPopover.classList.add("visible");
  const pw = els.calPopover.offsetWidth;
  const ph = els.calPopover.offsetHeight;
  let left = cellRect.left - stickerRect.left + cellRect.width / 2 - pw / 2;
  left = Math.max(8, Math.min(left, stickerRect.width - pw - 8));
  let top = cellRect.bottom - stickerRect.top + 6;
  if (top + ph > stickerRect.height - 8) {
    top = cellRect.top - stickerRect.top - ph - 6;
  }
  els.calPopover.style.left = left + "px";
  els.calPopover.style.top = top + "px";
}
els.calPopover.addEventListener("mouseenter", cancelPopoverHide);
els.calPopover.addEventListener("mouseleave", scheduleHidePopover);
document.addEventListener("click", (e) => {
  if (!els.calPopover.classList.contains("visible")) return;
  if (els.calPopover.contains(e.target) || e.target.closest(".cal-cell")) return;
  hideDayPopover();
});

function renderCalendar() {
  const all = activeTasks();
  const dueMap = new Map();
  const startMap = new Map();
  for (const t of all) {
    if (t.dueDate) {
      if (!dueMap.has(t.dueDate)) dueMap.set(t.dueDate, []);
      dueMap.get(t.dueDate).push(t);
    }
    if (t.startDate) {
      if (!startMap.has(t.startDate)) startMap.set(t.startDate, []);
      startMap.get(t.startDate).push(t);
    }
  }

  const first = new Date(calYear, calMonth, 1);
  els.calLabel.textContent = first.toLocaleDateString(undefined, { month: "long", year: "numeric" });

  // Monday-first offset
  let lead = (first.getDay() + 6) % 7;
  const daysInMonth = new Date(calYear, calMonth + 1, 0).getDate();
  const today = todayISO();

  els.calGrid.innerHTML = "";
  for (let i = 0; i < lead; i++) {
    const b = document.createElement("div");
    b.className = "cal-cell blank";
    els.calGrid.appendChild(b);
  }
  for (let d = 1; d <= daysInMonth; d++) {
    const iso = `${calYear}-${pad(calMonth + 1)}-${pad(d)}`;
    const cell = document.createElement("div");
    cell.className = "cal-cell";
    if (iso === today) cell.classList.add("today");

    const num = document.createElement("span");
    num.textContent = String(d);
    cell.appendChild(num);

    const dots = document.createElement("div");
    dots.className = "cal-dots";
    const dueHere = dueMap.get(iso) || [];
    const startHere = startMap.get(iso) || [];
    if (dueHere.length) {
      const openOverdue = dueHere.some((t) => !t.done && dayDiff(iso) < 0);
      const dot = document.createElement("span");
      dot.className = "cal-dot" + (openOverdue ? " overdue" : "");
      dots.appendChild(dot);
    }
    if (startHere.length) {
      const s = document.createElement("span");
      s.className = "cal-dot start";
      dots.appendChild(s);
    }
    cell.appendChild(dots);

    if (dueHere.length || startHere.length) {
      cell.addEventListener("mouseenter", () => showDayPopover(cell, iso, dueMap, startMap));
      cell.addEventListener("mouseleave", scheduleHidePopover);
      cell.addEventListener("click", (e) => {
        e.stopPropagation();
        if (popoverIso === iso && els.calPopover.classList.contains("visible")) {
          hideDayPopover();
        } else {
          showDayPopover(cell, iso, dueMap, startMap);
        }
      });
    }
    els.calGrid.appendChild(cell);
  }
}

// ---- edit overlay ----
let editingId = null;
function openEdit(id) {
  const t = findTask(id);
  if (!t) return;
  editingId = id;
  els.editTitle.value = t.title;
  els.editGroup.value = t.category || "";
  els.editStart.value = t.startDate || "";
  els.editDue.value = t.dueDate || "";
  els.editRepeat.value = t.repeatDays > 0 ? String(t.repeatDays) : "";
  refreshEditGroupStyle();
  els.overlay.classList.remove("hidden");
  els.editTitle.focus();
}
function closeEdit() {
  editingId = null;
  els.overlay.classList.add("hidden");
}
els.editSave.addEventListener("click", () => {
  if (!editingId) return;
  const title = els.editTitle.value.trim();
  if (!title) return;
  let repeatDays = parseInt(els.editRepeat.value, 10);
  if (!Number.isFinite(repeatDays) || repeatDays < 0) repeatDays = 0;
  updateTask(editingId, {
    title,
    category: els.editGroup.value.trim(),
    startDate: els.editStart.value,
    dueDate: els.editDue.value,
    repeatDays,
  });
  closeEdit();
  render();
});
els.editCancel.addEventListener("click", closeEdit);
els.editDelete.addEventListener("click", () => {
  if (!editingId) return;
  removeTask(editingId);
  closeEdit();
  render();
});
els.overlay.addEventListener("click", (e) => {
  if (e.target === els.overlay) closeEdit();
});

// ---- group color / emoji picker ----
let pickingGroup = null;

function refreshEditGroupStyle() {
  const name = els.editGroup.value.trim();
  if (!name) {
    els.editGroupStyle.style.visibility = "hidden";
    return;
  }
  els.editGroupStyle.style.visibility = "visible";
  els.editGroupSwatch.style.background = getGroupColor(name);
  els.editGroupEmoji.textContent = getGroupEmoji(name);
}
function normalizeEmoji(v) {
  return Array.from((v || "").trim()).slice(0, 3).join("");
}
function afterGroupStyleChange() {
  refreshEditGroupStyle();
  render(); // tags/columns update live behind the picker
}
// Update selection highlights + inputs to match the current stored style,
// without rebuilding the picker (so the native color dialog stays open).
function markGroupPickerState() {
  if (!pickingGroup) return;
  const cur = getGroupColor(pickingGroup).toLowerCase();
  els.gpSwatches
    .querySelectorAll(".swatch")
    .forEach((b) => b.classList.toggle("selected", b.dataset.color === cur));
  els.gpColorInput.value = cur;
  els.gpColorHex.textContent = cur;
  const curEmoji = getGroupEmoji(pickingGroup);
  els.gpEmojiQuick
    .querySelectorAll(".emoji-btn")
    .forEach((b) => b.classList.toggle("selected", b.textContent === curEmoji));
  els.gpEmojiInput.value = curEmoji;
}
function openGroupPicker(name) {
  name = (name || "").trim();
  if (!name) return;
  pickingGroup = name;
  els.gpName.textContent = name;

  els.gpSwatches.innerHTML = "";
  for (const c of PALETTE) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "swatch";
    b.dataset.color = c.toLowerCase();
    b.style.background = c;
    b.addEventListener("click", () => {
      setGroupColor(name, c);
      markGroupPickerState();
      afterGroupStyleChange();
    });
    els.gpSwatches.appendChild(b);
  }

  els.gpEmojiQuick.innerHTML = "";
  for (const e of QUICK_EMOJI) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "emoji-btn";
    b.textContent = e;
    b.addEventListener("click", () => {
      setGroupEmoji(name, e);
      markGroupPickerState();
      afterGroupStyleChange();
    });
    els.gpEmojiQuick.appendChild(b);
  }

  markGroupPickerState();
  els.gpOverlay.classList.remove("hidden");
}
function closeGroupPicker() {
  pickingGroup = null;
  els.gpOverlay.classList.add("hidden");
}
// Full color wheel (native picker) — any color, not just the presets.
els.gpColorInput.addEventListener("input", () => {
  if (!pickingGroup) return;
  setGroupColor(pickingGroup, els.gpColorInput.value.toLowerCase());
  markGroupPickerState();
  afterGroupStyleChange();
});
els.gpEmojiInput.addEventListener("input", () => {
  if (!pickingGroup) return;
  const v = normalizeEmoji(els.gpEmojiInput.value);
  setGroupEmoji(pickingGroup, v);
  els.gpEmojiQuick
    .querySelectorAll(".emoji-btn")
    .forEach((b) => b.classList.toggle("selected", b.textContent === v));
  afterGroupStyleChange();
});
els.gpEmojiClear.addEventListener("click", () => {
  if (!pickingGroup) return;
  setGroupEmoji(pickingGroup, "");
  els.gpEmojiInput.value = "";
  els.gpEmojiQuick.querySelectorAll(".emoji-btn").forEach((b) => b.classList.remove("selected"));
  afterGroupStyleChange();
});
els.gpDone.addEventListener("click", closeGroupPicker);
els.gpOverlay.addEventListener("click", (e) => {
  if (e.target === els.gpOverlay) closeGroupPicker();
});
els.editGroupStyle.addEventListener("click", () => openGroupPicker(els.editGroup.value));
els.editGroup.addEventListener("input", refreshEditGroupStyle);

// ---- add form ----
els.toggleStart.addEventListener("click", () => {
  els.toggleStart.setAttribute("aria-pressed", "true");
  els.startWrap.classList.remove("hidden");
  els.start.focus();
});

// Quick "Today" deadline toggle. When on, the due field is filled with today
// and it stays on for the next tasks too, so you don't set a ddl each time.
function dueTodayOn() {
  return els.dueToday.getAttribute("aria-pressed") === "true";
}
function setDueToday(on) {
  els.dueToday.setAttribute("aria-pressed", String(on));
  els.due.value = on ? todayISO() : "";
}
els.dueToday.addEventListener("click", () => setDueToday(!dueTodayOn()));
// Keep the toggle in sync if the user picks a date by hand.
els.due.addEventListener("change", () => {
  els.dueToday.setAttribute("aria-pressed", String(els.due.value === todayISO()));
});

function doAdd() {
  addTask(els.input.value, {
    category: els.group.value,
    dueDate: els.due.value,
    startDate: els.start.value,
  });
  els.input.value = "";
  els.due.value = "";
  els.start.value = "";
  els.group.value = "";
  els.toggleStart.setAttribute("aria-pressed", "false");
  els.startWrap.classList.add("hidden");
  // Re-apply the sticky "Today" default for the next task.
  if (dueTodayOn()) els.due.value = todayISO();
  render();
  els.input.focus();
}
els.form.addEventListener("submit", (e) => {
  e.preventDefault();
  doAdd();
});
// The form has two text fields and no submit button, so the browser's
// "Enter = submit" shortcut doesn't fire on its own. Wire it up explicitly,
// ignoring Enter used to confirm an IME (Chinese/Japanese) candidate.
function enterAdds(e) {
  if (e.key !== "Enter" || e.isComposing || e.keyCode === 229) return;
  e.preventDefault();
  doAdd();
}
els.input.addEventListener("keydown", enterAdds);
els.group.addEventListener("keydown", enterAdds);

// ---- filters & views ----
els.chips.forEach((chip) => {
  chip.addEventListener("click", () => {
    filter = chip.dataset.filter;
    els.chips.forEach((c) => c.classList.toggle("active", c === chip));
    renderList();
  });
});
els.tabs.forEach((tab) => {
  tab.addEventListener("click", () => setView(tab.dataset.view));
});
function setView(next) {
  view = next;
  hideDayPopover();
  els.tabs.forEach((t) => t.classList.toggle("active", t.dataset.view === next));
  for (const key of Object.keys(els.panels)) {
    els.panels[key].classList.toggle("hidden", key !== next);
  }
  const size = VIEW_SIZES[next] || VIEW_SIZES.list;
  if (window.sticker && window.sticker.setSize) window.sticker.setSize(size.w, size.h);
  render();
}

els.calPrev.addEventListener("click", () => {
  hideDayPopover();
  calMonth--;
  if (calMonth < 0) {
    calMonth = 11;
    calYear--;
  }
  renderCalendar();
});
els.calNext.addEventListener("click", () => {
  hideDayPopover();
  calMonth++;
  if (calMonth > 11) {
    calMonth = 0;
    calYear++;
  }
  renderCalendar();
});

// The ✕ just closes the popover; the app keeps running in the menu bar.
// Quitting for real is only via right-click on the tray icon → Quit.
els.close.addEventListener("click", () => {
  if (window.sticker) window.sticker.hide();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    if (!els.gpOverlay.classList.contains("hidden")) closeGroupPicker();
    else if (!els.overlay.classList.contains("hidden")) closeEdit();
    else if (els.calPopover.classList.contains("visible")) hideDayPopover();
    else if (window.sticker) window.sticker.hide();
  }
});
window.addEventListener("focus", () => {
  if (view === "list") els.input.focus();
});

// ---- menu-bar badge, notifications, celebration ----
// Tasks that "need attention today" = open tasks due today or overdue.
function attentionCounts() {
  const today = todayISO();
  let due = 0;
  let overdue = 0;
  for (const t of activeTasks()) {
    if (t.done || !t.dueDate) continue;
    if (t.dueDate < today) overdue++;
    else if (t.dueDate === today) due++;
  }
  return { due, overdue, total: due + overdue };
}
function pushBadge() {
  if (!(window.sticker && window.sticker.setBadge)) return;
  const c = attentionCounts();
  window.sticker.setBadge({ count: c.total, overdue: c.overdue });
}

let toastTimer = null;
function showToast(msg) {
  els.toast.textContent = msg;
  els.toast.classList.remove("hidden");
  // force reflow so the transition runs even on rapid re-shows
  void els.toast.offsetWidth;
  els.toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    els.toast.classList.remove("show");
    setTimeout(() => els.toast.classList.add("hidden"), 250);
  }, 2400);
}
let prevAttentionTotal = null;
function maybeCelebrate(total) {
  if (prevAttentionTotal !== null && prevAttentionTotal > 0 && total === 0) {
    showToast("All done for today 🎉");
  }
  prevAttentionTotal = total;
}

let notifyEnabled = true;
function checkNotifications() {
  if (!notifyEnabled) return;
  if (!(window.sticker && window.sticker.notify)) return;
  const today = todayISO();
  let notified = {};
  try {
    notified = JSON.parse(localStorage.getItem("todo-notified") || "{}");
  } catch (_) {}
  let changed = false;
  for (const t of activeTasks()) {
    if (t.done || t.dueDate !== today) continue;
    if (notified[t.id] === today) continue;
    window.sticker.notify("Due today", t.title + (t.category ? " · " + t.category : ""));
    notified[t.id] = today;
    changed = true;
  }
  // prune entries not from today to keep it small
  for (const id in notified) if (notified[id] !== today) delete notified[id];
  if (changed) localStorage.setItem("todo-notified", JSON.stringify(notified));
}

// ---- master render ----
function render() {
  // group suggestions
  els.groupList.innerHTML = "";
  for (const g of groups()) {
    const o = document.createElement("option");
    o.value = g;
    els.groupList.appendChild(o);
  }
  // header count (always active tasks)
  const activeCount = activeTasks().filter((t) => !t.done).length;
  els.count.textContent = activeCount ? `${activeCount} left` : "all clear";

  if (view === "list") renderList();
  else if (view === "board") renderBoard();
  else if (view === "calendar") renderCalendar();

  const att = attentionCounts();
  pushBadge();
  maybeCelebrate(att.total);
}

// Init: prefs, notifications, and a slow heartbeat (also handles midnight
// rollover of "due today" for the badge/notifications while the app stays open).
if (window.sticker && window.sticker.getPrefs) {
  window.sticker
    .getPrefs()
    .then((p) => {
      notifyEnabled = !!(p && p.notify);
      checkNotifications();
    })
    .catch(() => {});
}
if (window.sticker && window.sticker.onNotifyPref) {
  window.sticker.onNotifyPref((v) => {
    notifyEnabled = !!v;
  });
}
setInterval(() => {
  pushBadge();
  checkNotifications();
}, 60000);

migrateGroupColors();
render();
setTimeout(checkNotifications, 1500);
els.input.focus();
