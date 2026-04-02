const STORAGE_KEY = "todo-simple-v1";

/** @typedef {{ id: string, title: string, done: boolean, date: string, dueDate: string, scheduledDate: string, completedDate: string, category: string, createdAt: number }} Task */

function loadTasks() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const data = JSON.parse(raw);
    if (!Array.isArray(data)) return [];
    return data
      .filter(
        (t) =>
          t &&
          typeof t.id === "string" &&
          typeof t.title === "string" &&
          typeof t.done === "boolean" &&
          typeof t.date === "string"
      )
      .map(normalizeLoadedTask);
  } catch {
    return [];
  }
}

/** @param {Task[]} tasks */
function saveTasks(tasks) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks));
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
  return {
    ...t,
    date,
    dueDate,
    scheduledDate,
    completedDate,
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

function rollFloatingSchedules() {
  const today = todayISODate();
  let changed = false;
  for (const t of tasks) {
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

/** @param {Task[]} tasks */
function sortTasks(tasks) {
  return [...tasks].sort((a, b) => {
    const da = effectiveScheduleDate(a);
    const db = effectiveScheduleDate(b);
    if (da !== db) return da.localeCompare(db);
    return a.createdAt - b.createdAt;
  });
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

function syncProjectDatalist() {
  const dl = document.getElementById("project-datalist");
  if (!dl) return;
  const names = [
    ...new Set(tasks.map((t) => String(t.category || "").trim()).filter(Boolean)),
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
  taskTitle: /** @type {HTMLInputElement} */ (document.getElementById("task-title")),
  taskDate: /** @type {HTMLInputElement} */ (document.getElementById("task-date")),
  taskDueDate: /** @type {HTMLInputElement} */ (document.getElementById("task-due-date")),
  taskCategory: /** @type {HTMLInputElement} */ (document.getElementById("task-category")),
  taskList: /** @type {HTMLUListElement} */ (document.getElementById("task-list")),
  emptyState: /** @type {HTMLParagraphElement} */ (document.getElementById("empty-state")),
  filters: /** @type {NodeListOf<HTMLButtonElement>} */ (document.querySelectorAll(".filter")),
  toggleMerge: /** @type {HTMLButtonElement} */ (document.getElementById("toggle-merge")),
  toggleProjectView: /** @type {HTMLButtonElement} */ (document.getElementById("toggle-project-view")),
  mergeHint: /** @type {HTMLParagraphElement} */ (document.getElementById("merge-hint")),
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
  editCancel: /** @type {HTMLButtonElement} */ (document.getElementById("edit-cancel")),
  editSave: /** @type {HTMLButtonElement} */ (document.getElementById("edit-save")),
};

/** @type {Task[]} */
let tasks = loadTasks();
let filter = "all";
let mergeMode = false;
let projectViewMode = false;
/** @type {Set<string>} */
let mergeSelection = new Set();
/** @type {Task[] | null} */
let pendingMergeTasks = null;
/** @type {string | null} */
let editingTaskId = null;

const _initialCal = new Date();
let viewCalendarYear = _initialCal.getFullYear();
let viewCalendarMonth = _initialCal.getMonth();
/** @type {string | null} */
let calendarSelectedIso = todayISODate();

function getFilteredTasks() {
  if (filter === "active") return tasks.filter((t) => !t.done);
  if (filter === "done") return tasks.filter((t) => t.done);
  return tasks;
}

/**
 * @param {Task} task
 * @returns {HTMLLIElement}
 */
function createTaskRow(task) {
  const li = document.createElement("li");
  const hardDue = hasHardDueDate(task);
  const overdue = !task.done && hardDue && isOverdue(task.dueDate);
  li.className = "task-item" + (task.done ? " done" : "") + (overdue ? " overdue" : "");
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
  } else {
    const toggle = document.createElement("input");
    toggle.type = "checkbox";
    toggle.className = "task-merge-check";
    toggle.checked = task.done;
    toggle.setAttribute("aria-label", "Mark complete");
    toggle.addEventListener("change", () => {
      task.done = toggle.checked;
      task.completedDate = toggle.checked ? todayISODate() : "";
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
  body.appendChild(meta);
  li.appendChild(body);

  const actions = document.createElement("div");
  actions.className = "task-actions";
  if (!mergeMode) {
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
    tasks = tasks.filter((t) => t.id !== task.id);
    mergeSelection.delete(task.id);
    if (editingTaskId === task.id) {
      editingTaskId = null;
      els.editDialog.close();
    }
    saveTasks(tasks);
    render();
    setSelectedCountLabel();
    renderMergeBar();
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

function render() {
  rollFloatingSchedules();
  syncProjectDatalist();
  const list = getFilteredTasks();
  const sorted = sortTasks(list);
  els.taskList.innerHTML = "";

  if (projectViewMode && !mergeMode) {
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
    for (const key of keys) {
      const g = groups.get(key);
      const head = document.createElement("li");
      head.className = "task-project-heading";
      const inner = document.createElement("div");
      inner.className = "task-project-heading-inner";
      inner.textContent = `${g.display} (${g.tasks.length})`;
      head.appendChild(inner);
      els.taskList.appendChild(head);
      for (const task of g.tasks) {
        els.taskList.appendChild(createTaskRow(task));
      }
    }
  } else {
    sorted.forEach((task) => els.taskList.appendChild(createTaskRow(task)));
  }

  const hasAny = tasks.length > 0;
  els.emptyState.classList.toggle("hidden", hasAny);
  els.taskList.classList.toggle("hidden", !hasAny);
  renderCalendar();
}

/** @param {string} iso */
function tasksCompletedOnDay(iso) {
  return tasks.filter((t) => t.done && t.completedDate === iso);
}

/** @param {string} iso */
function tasksDueNotDoneOnDay(iso) {
  return tasks.filter((t) => {
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
  const activeCount = tasks.filter((t) => !t.done).length;
  const monthDoneCount = tasks.filter(
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

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "cal-cell";
    if (!inMonth) btn.classList.add("other-month");
    if (iso === today) btn.classList.add("today");
    if (calendarSelectedIso && iso === calendarSelectedIso) btn.classList.add("selected");
    btn.setAttribute("role", "gridcell");
    btn.setAttribute(
      "aria-label",
      `${iso}, ${doneHere ? doneHere + " completed" : "no completions"}`
    );

    const num = document.createElement("span");
    num.className = "cal-cell-day";
    num.textContent = String(dayNum);
    btn.appendChild(num);

    const badge = document.createElement("span");
    badge.className = "cal-cell-badge";
    if (doneHere > 0) badge.textContent = String(doneHere);
    btn.appendChild(badge);

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
function openEditDialog(task) {
  syncProjectDatalist();
  editingTaskId = task.id;
  els.editTitle.value = task.title;
  els.editDate.value = task.date;
  els.editDueDate.value = task.dueDate || "";
  els.editCategory.value = task.category || "";
  els.editDialog.showModal();
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
    date: els.mergeDate.value || prev.date,
    dueDate: dueVal,
    scheduledDate: dueVal || prev.scheduledDate || todayISODate(),
    category: els.mergeCategory.value.trim(),
    done: prev.done,
    completedDate: prev.completedDate || "",
    createdAt: Date.now(),
  };
  applyMerge(replacement);
});

els.addForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const title = els.taskTitle.value.trim();
  if (!title) return;
  const creation = els.taskDate.value || todayISODate();
  const dueRaw = els.taskDueDate.value.trim();
  const task = {
    id: crypto.randomUUID(),
    title,
    date: creation,
    dueDate: dueRaw,
    scheduledDate: dueRaw || creation,
    completedDate: "",
    category: els.taskCategory.value.trim(),
    done: false,
    createdAt: Date.now(),
  };
  tasks.push(task);
  saveTasks(tasks);
  els.taskTitle.value = "";
  els.taskCategory.value = "";
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
    setSelectedCountLabel();
    renderMergeBar();
    render();
  });
});

els.toggleMerge.addEventListener("click", () => {
  mergeMode = !mergeMode;
  if (mergeMode) {
    projectViewMode = false;
    els.toggleProjectView.setAttribute("aria-pressed", "false");
  }
  els.toggleMerge.setAttribute("aria-pressed", String(mergeMode));
  mergeSelection.clear();
  pendingMergeTasks = null;
  document.getElementById("merge-selected-bar")?.remove();
  setSelectedCountLabel();
  render();
});

els.toggleProjectView.addEventListener("click", () => {
  projectViewMode = !projectViewMode;
  if (projectViewMode) {
    mergeMode = false;
    mergeSelection.clear();
    pendingMergeTasks = null;
    document.getElementById("merge-selected-bar")?.remove();
    els.toggleMerge.setAttribute("aria-pressed", "false");
    setSelectedCountLabel();
  }
  els.toggleProjectView.setAttribute("aria-pressed", String(projectViewMode));
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

const initDay = todayISODate();
els.taskDate.value = initDay;
els.taskDueDate.value = "";
render();
