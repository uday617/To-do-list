/*Data Model*/
const uid = () => Math.random().toString(36).slice(2) + Date.now().toString(36);

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

const els = {
  themeToggle: $("#themeToggle"),
  installBtn: $("#installBtn"),
  micBtn: $("#micBtn"),
  addBtn: $("#addBtn"),
  taskInput: $("#taskInput"),
  notesInput: $("#notesInput"),
  prioritySelect: $("#prioritySelect"),
  dueDate: $("#dueDate"),
  recurringSelect: $("#recurringSelect"),
  categorySelect: $("#categorySelect"),
  reminderSelect: $("#reminderSelect"),
  taskList: $("#taskList"),
  searchInput: $("#searchInput"),
  sortSelect: $("#sortSelect"),
  progressBar: $("#progressBar"),
  statsText: $("#statsText"),
  clearCompleted: $("#clearCompleted"),
  exportJSON: $("#exportJSON"),
  exportCSV: $("#exportCSV"),
  importFile: $("#importFile"),
  filterButtons: $$(".filter")
};

let tasks = loadTasks();
let filterMode = "all"; 
let manualOrder = loadOrder(); 
let deferredPrompt = null;     
let recognition = null;        

/*Storage*/
function loadTasks() {
  try { return JSON.parse(localStorage.getItem("tasks_v2")) || []; }
  catch { return []; }
}
function saveTasks() {
  localStorage.setItem("tasks_v2", JSON.stringify(tasks));
  saveOrder();
}
function loadOrder() {
  try { return JSON.parse(localStorage.getItem("order_v2")) || []; }
  catch { return []; }
}
function saveOrder() {
  // Refresh manual order to include all existing ids in current visual order
  const ids = tasks.map(t => t.id);
  manualOrder = manualOrder.filter(id => ids.includes(id));
  for (const id of ids) if (!manualOrder.includes(id)) manualOrder.push(id);
  localStorage.setItem("order_v2", JSON.stringify(manualOrder));
}

/*Helpers*/
const PRIORITY_RANK = { high: 1, medium: 2, low: 3 };
const byPriority = (a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
const byStatus   = (a, b) => (a.completed === b.completed) ? 0 : (a.completed ? 1 : -1);
const byCreated  = (a, b) => a.createdAt - b.createdAt;
const byDate     = (a, b) => (new Date(a.dueDate || "9999-12-31")) - (new Date(b.dueDate || "9999-12-31"));

function isOverdue(t) {
  if (!t.dueDate || t.completed) return false;
  const end = new Date(t.dueDate);
  end.setHours(23,59,59,999);
  return end < new Date();
}
function fmtDate(d) { return d ? d : ""; }

function ensureManualOrder() {
  // Insert any missing ids at end
  const ids = tasks.map(t => t.id);
  ids.forEach(id => { if (!manualOrder.includes(id)) manualOrder.push(id); });
  // Remove non-existent ids
  manualOrder = manualOrder.filter(id => ids.includes(id));
}

/*Render */
function getVisibleTasks() {
  let result = [...tasks];

  // Filter
  if (filterMode === "completed") result = result.filter(t => t.completed);
  else if (filterMode === "pending") result = result.filter(t => !t.completed);

  // Search
  const q = els.searchInput.value.trim().toLowerCase();
  if (q) {
    result = result.filter(t =>
      t.text.toLowerCase().includes(q) ||
      (t.notes || "").toLowerCase().includes(q) ||
      (t.category || "").toLowerCase().includes(q) ||
      (t.subtasks || []).some(st => st.text.toLowerCase().includes(q))
    );
  }

  // Sort
  const mode = els.sortSelect.value;
  if (mode === "priority") result.sort(byPriority);
  else if (mode === "status") result.sort(byStatus);
  else if (mode === "created") result.sort(byCreated);
  else if (mode === "date") result.sort(byDate);
  else if (mode === "manual") {
    ensureManualOrder();
    const indexById = Object.fromEntries(manualOrder.map((id, i) => [id, i]));
    result.sort((a, b) => (indexById[a.id] ?? 9999) - (indexById[b.id] ?? 9999));
  }
  return result;
}

function render() {
  els.taskList.innerHTML = "";
  const visible = getVisibleTasks();

  for (const t of visible) {
    const li = document.createElement("li");
    li.className = "task-item";
    li.dataset.id = t.id;
    if (isOverdue(t)) li.classList.add("overdue-outline");

    // drag+drop only in manual sort
    if (els.sortSelect.value === "manual") {
      li.draggable = true;
      li.addEventListener("dragstart", onDragStart);
      li.addEventListener("dragover", e => e.preventDefault());
      li.addEventListener("drop", onDrop);
      li.addEventListener("dragend", () => li.classList.remove("dragging"));
    }

    // left part
    const main = document.createElement("div");
    main.className = "task-main";
    const chk = document.createElement("input");
    chk.type = "checkbox";
    chk.checked = !!t.completed;
    chk.addEventListener("change", () => toggleComplete(t.id));

    const textWrap = document.createElement("div");
    const title = document.createElement("div");
    title.className = "task-text";
    title.textContent = t.text;
    if (t.completed) title.style.textDecoration = "line-through";
    const notes = document.createElement("div");
    notes.className = "task-notes";
    notes.textContent = t.notes || "";
    if (!t.notes) notes.style.display = "none";
    textWrap.appendChild(title);
    textWrap.appendChild(notes);

    main.appendChild(chk);
    main.appendChild(textWrap);

    // middle badges
    const badges = document.createElement("div");
    badges.style.display = "flex";
    badges.style.gap = "6px";
    const pr = document.createElement("span");
    pr.className = `badge priority-${t.priority}`;
    pr.textContent = t.priority;
    const cat = document.createElement("span");
    cat.className = "badge category";
    cat.textContent = `#${t.category || "general"}`;
    badges.appendChild(pr);
    badges.appendChild(cat);
    if (t.recurring && t.recurring !== "none") {
      const rec = document.createElement("span");
      rec.className = "badge recurring";
      rec.textContent = t.recurring;
      badges.appendChild(rec);
    }
    if (isOverdue(t)) {
      const od = document.createElement("span");
      od.className = "badge overdue";
      od.textContent = "overdue";
      badges.appendChild(od);
    }

    // due date
    const due = document.createElement("div");
    due.textContent = t.dueDate ? `📅 ${fmtDate(t.dueDate)}` : "—";
    due.style.minWidth = "110px";

    // actions
    const actions = document.createElement("div");
    actions.className = "actions";
    actions.innerHTML = `
      <button class="subtask" title="Add subtask">➕ Subtask</button>
      <button class="edit" title="Edit">✏️</button>
      <button class="delete" title="Delete">🗑️</button>
    `;
    const [btnSub, btnEdit, btnDel] = actions.querySelectorAll("button");
    btnEdit.addEventListener("click", () => editTask(t.id));
    btnDel.addEventListener("click", () => deleteTask(t.id));
    btnSub.addEventListener("click", () => addSubtask(t.id));

    // subtasks
    const sub = document.createElement("ul");
    sub.className = "subtasks";
    (t.subtasks || []).forEach(st => {
      const li2 = document.createElement("li");
      const stc = document.createElement("input"); stc.type = "checkbox"; stc.checked = !!st.completed;
      stc.addEventListener("change", () => toggleSubtask(t.id, st.id));
      const stText = document.createElement("input"); stText.type = "text"; stText.value = st.text;
      stText.addEventListener("change", () => renameSubtask(t.id, st.id, stText.value.trim()));
      const rm = document.createElement("button"); rm.textContent = "✖"; rm.title = "Remove subtask";
      rm.addEventListener("click", () => removeSubtask(t.id, st.id));
      li2.append(stc, stText, rm);
      sub.appendChild(li2);
    });

    li.append(main, badges, due, actions);
    if ((t.subtasks || []).length) li.appendChild(sub);
    els.taskList.appendChild(li);
  }

  updateStats();
}

/*Core Actions */
function addTaskFromInputs() {
  const text = els.taskInput.value.trim();
  if (!text) return alert("Task cannot be empty.");
  const t = {
    id: uid(),
    text,
    notes: els.notesInput.value.trim() || "",
    completed: false,
    priority: els.prioritySelect.value,
    dueDate: els.dueDate.value || null,
    category: els.categorySelect.value || "general",
    recurring: els.recurringSelect.value || "none",
    reminder: els.reminderSelect.value, // 
    subtasks: [],
    createdAt: Date.now()
  };
  tasks.push(t);
  manualOrder.push(t.id);
  saveTasks();
  scheduleReminder(t);
  clearInputs();
  render();
}
function clearInputs() {
  els.taskInput.value = "";
  els.notesInput.value = "";
  els.dueDate.value = "";
  els.recurringSelect.value = "none";
  els.reminderSelect.value = "off";
  els.prioritySelect.value = "medium";
  els.categorySelect.value = "general";
}

function toggleComplete(id) {
  const t = tasks.find(x => x.id === id);
  if (!t) return;
  t.completed = !t.completed;

  if (t.completed && t.recurring && t.recurring !== "none" && t.dueDate) {
    const next = { ...t, id: uid(), completed: false, createdAt: Date.now() };
    const d = new Date(t.dueDate);
    if (t.recurring === "daily") d.setDate(d.getDate() + 1);
    if (t.recurring === "weekly") d.setDate(d.getDate() + 7);
    if (t.recurring === "monthly") d.setMonth(d.getMonth() + 1);
    next.dueDate = d.toISOString().slice(0,10);
    tasks.push(next);
    manualOrder.push(next.id);
    scheduleReminder(next);
  }

  saveTasks();
  render();
}
function editTask(id) {
  const t = tasks.find(x => x.id === id);
  if (!t) return;
  const newText = prompt("Edit task title:", t.text);
  if (newText !== null) t.text = newText.trim() || t.text;

  const newNotes = prompt("Edit notes (blank to clear):", t.notes || "");
  if (newNotes !== null) t.notes = newNotes.trim();

  const newDue = prompt("Edit due date (YYYY-MM-DD) or leave blank:", t.dueDate || "");
  t.dueDate = newDue && /^\d{4}-\d{2}-\d{2}$/.test(newDue) ? newDue : t.dueDate;

  const pr = prompt("Priority (low|medium|high):", t.priority);
  if (pr && ["low","medium","high"].includes(pr)) t.priority = pr;

  saveTasks();
  render();
}
function deleteTask(id) {
  if (!confirm("Delete this task?")) return;
  tasks = tasks.filter(x => x.id !== id);
  manualOrder = manualOrder.filter(x => x !== id);
  saveTasks();
  render();
}

/* Subtasks  */
function addSubtask(taskId) {
  const t = tasks.find(x => x.id === taskId);
  if (!t) return;
  const text = prompt("Subtask:");
  if (!text || !text.trim()) return;
  t.subtasks = t.subtasks || [];
  t.subtasks.push({ id: uid(), text: text.trim(), completed: false });
  saveTasks(); render();
}
function toggleSubtask(taskId, subId) {
  const t = tasks.find(x => x.id === taskId);
  if (!t) return;
  const st = (t.subtasks || []).find(s => s.id === subId);
  if (!st) return;
  st.completed = !st.completed;
  saveTasks(); render();
}
function renameSubtask(taskId, subId, text) {
  const t = tasks.find(x => x.id === taskId);
  if (!t) return;
  const st = (t.subtasks || []).find(s => s.id === subId);
  if (!st) return;
  st.text = text || st.text;
  saveTasks();
}
function removeSubtask(taskId, subId) {
  const t = tasks.find(x => x.id === taskId);
  if (!t) return;
  t.subtasks = (t.subtasks || []).filter(s => s.id !== subId);
  saveTasks(); render();
}

/*  Drag & Drop */
let dragId = null;
function onDragStart(e) {
  const li = e.currentTarget;
  dragId = li.dataset.id;
  li.classList.add("dragging");
}
function onDrop(e) {
  const targetId = e.currentTarget.dataset.id;
  if (!dragId || dragId === targetId) return;
  const from = manualOrder.indexOf(dragId);
  const to = manualOrder.indexOf(targetId);
  if (from === -1 || to === -1) return;
  manualOrder.splice(to, 0, manualOrder.splice(from, 1)[0]);
  saveOrder();
  render();
}

/* Progress / Stats */
function updateStats() {
  const total = tasks.length;
  const done = tasks.filter(t => t.completed).length;
  const percent = total ? Math.round((done / total) * 100) : 0;
  els.progressBar.style.width = percent + "%";
  els.statsText.textContent = `${done} of ${total} done (${percent}%)`;
}

/*Notifications */
function canNotify() {
  return "Notification" in window;
}
function requestNotificationPermission() {
  if (!canNotify()) return;
  if (Notification.permission === "default") Notification.requestPermission();
}
function scheduleReminder(t) {
  if (!canNotify() || !t.dueDate) return;
  if (t.reminder === "off") return;
  if (Notification.permission !== "granted") return;

  const mins = parseInt(t.reminder, 10);
  const trigger = new Date(t.dueDate);
  trigger.setHours(9, 0, 0, 0); // default morning of due date
  // subtract minutes
  const ms = trigger.getTime() - mins * 60 * 1000 - Date.now();
  if (ms <= 0) {
    // if time already passed, notify soon (but not repeatedly)
    setTimeout(() => notifyTask(t), 1500);
  } else {
    setTimeout(() => notifyTask(t), Math.min(ms, 2147483647)); // cap at max setTimeout
  }
}
function notifyTask(t) {
  if (!t || t.completed) return;
  new Notification("Task reminder", {
    body: `${t.text} (due ${t.dueDate || "soon"})`,
    icon: "assets/icon-192.png",
    tag: `task-${t.id}`
  });
}

/*Export / Import*/
function download(name, content, type) {
  const a = document.createElement("a");
  const blob = new Blob([content], { type });
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}

function exportJSON() {
  const payload = { version: 2, tasks, order: manualOrder };
  download(`todo-export-${new Date().toISOString().slice(0,10)}.json`, JSON.stringify(payload, null, 2), "application/json");
}

function exportCSV() {
  const esc = v => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const rows = [
    ["id","text","notes","completed","priority","dueDate","category","recurring","createdAt"].join(","),
    ...tasks.map(t => [t.id,t.text,t.notes,t.completed,t.priority,t.dueDate||"",t.category||"",t.recurring||"none",t.createdAt].map(esc).join(","))
  ];
  download(`todo-export-${new Date().toISOString().slice(0,10)}.csv`, rows.join("\n"), "text/csv");
}

function importJSONFile(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(reader.result);
      if (!data || !Array.isArray(data.tasks)) throw new Error("Invalid file.");
      tasks = data.tasks;
      manualOrder = Array.isArray(data.order) ? data.order : tasks.map(t => t.id);
      saveTasks();
      render();
      alert("Import successful!");
    } catch (e) {
      alert("Import failed: " + e.message);
    }
  };
  reader.readAsText(file);
}

/*Voice Input  */
function initVoice() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) return null;
  const rec = new SR();
  rec.lang = "en-US";
  rec.interimResults = false;
  rec.maxAlternatives = 1;
  rec.addEventListener("result", e => {
    const txt = e.results[0][0].transcript;

    els.taskInput.value = txt;
  });
  rec.addEventListener("end", () => els.micBtn.classList.remove("recording"));
  return rec;
}

/*Theme + PWA */
(function initTheme() {
  const saved = localStorage.getItem("theme");
  if (saved === "dark") document.body.classList.add("dark");
})();

els.themeToggle.addEventListener("click", () => {
  document.body.classList.toggle("dark");
  localStorage.setItem("theme", document.body.classList.contains("dark") ? "dark" : "light");
  els.themeToggle.textContent = document.body.classList.contains("dark") ? "☀️ Light Mode" : "🌙 Dark Mode";
});

// PWA install button
window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  deferredPrompt = e;
  els.installBtn.hidden = false;
});
els.installBtn.addEventListener("click", async () => {
  if (!deferredPrompt) return;
  deferredPrompt.prompt();
  await deferredPrompt.userChoice;
  deferredPrompt = null;
  els.installBtn.hidden = true;
});

// Register service worker
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("./sw.js").catch(() => {});
}

/* Cloud Sync with Firebase */
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.11.1/firebase-app.js";
import { 
  getFirestore, collection, setDoc, getDocs, doc 
} from "https://www.gstatic.com/firebasejs/10.11.1/firebase-firestore.js";
import { 
  getAuth, onAuthStateChanged 
} from "https://www.gstatic.com/firebasejs/10.11.1/firebase-auth.js";
import { signOut } from "https://www.gstatic.com/firebasejs/10.11.1/firebase-auth.js";

const firebaseConfig = {
  apiKey: "AIzaSyCqqHYUN33L7yeO02yIx6xm9WHif49dC4k",
  authDomain: "to-do-list-81a94.firebaseapp.com",
  projectId: "to-do-list-81a94",
  storageBucket: "to-do-list-81a94.appspot.com",
  messagingSenderId: "800632225970",
  appId: "1:800632225970:web:89d1c243e37d9fa29849ab",
  measurementId: "G-M09Z5V8G72"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);

let currentUser = null;

//  Wait until user is logged in
onAuthStateChanged(auth, (user) => {
  if (user) {
    currentUser = user;
    console.log("Logged in as:", user.uid);
  } else {
    alert("Please login first!");
    window.location.href = "home.html"; // redirect to login
  }
});
document.getElementById("logoutBtn").addEventListener("click", async () => {
  try {
    await signOut(auth);
    window.location.href = "home.html"; // Redirect to login page
  } catch (error) {
    console.error("Logout Error:", error);
    alert("❌ Logout failed: " + error.message);
  }
});

// ☁️ Push tasks for the logged-in user
async function pushToCloud() {
  if (!currentUser) return alert("Login required!");
  try {
    for (let t of tasks) {
      await setDoc(doc(db, "users", currentUser.uid, "tasks", t.id), t);
    }
    alert("✅ Your tasks pushed to Cloud!");
  } catch (err) {
    console.error("Push Error:", err);
    alert("❌ Error pushing tasks: " + err.message);
  }
}

// ☁️ Pull tasks for the logged-in user
async function pullFromCloud() {
  if (!currentUser) return alert("Login required!");
  try {
    const snap = await getDocs(collection(db, "users", currentUser.uid, "tasks"));
    tasks = [];
    snap.forEach(docu => tasks.push(docu.data()));
    manualOrder = tasks.map(t => t.id);
    saveTasks();
    render();
    alert("☁️ Your tasks pulled from Cloud!");
  } catch (err) {
    console.error("Pull Error:", err);
    alert("❌ Error pulling tasks: " + err.message);
  }
}

window.pushToCloud = pushToCloud;
window.pullFromCloud = pullFromCloud;

/* Event Listeners*/
els.addBtn.addEventListener("click", addTaskFromInputs);
els.taskInput.addEventListener("keydown", (e) => { if (e.key === "Enter") addTaskFromInputs(); });
els.notesInput.addEventListener("keydown", (e) => { if (e.key === "Enter") addTaskFromInputs(); });

els.filterButtons.forEach(btn => {
  btn.addEventListener("click", () => {
    els.filterButtons.forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    filterMode = btn.dataset.filter;
    render();
  });
});

els.searchInput.addEventListener("input", render);
els.sortSelect.addEventListener("change", render);
els.clearCompleted.addEventListener("click", () => {
  if (!confirm("Remove all completed tasks?")) return;
  const completedIds = tasks.filter(t => t.completed).map(t => t.id);
  tasks = tasks.filter(t => !t.completed);
  manualOrder = manualOrder.filter(id => !completedIds.includes(id));
  saveTasks(); render();
});

els.exportJSON.addEventListener("click", exportJSON);
els.exportCSV.addEventListener("click", exportCSV);
els.importFile.addEventListener("change", (e) => {
  const f = e.target.files?.[0];
  if (f) importJSONFile(f);
});

els.micBtn.addEventListener("click", () => {
  if (!recognition) recognition = initVoice();
  if (!recognition) return alert("Speech recognition not supported in this browser.");
  els.micBtn.classList.add("recording");
  recognition.start();
});

requestNotificationPermission();
render();
tasks.forEach(scheduleReminder);
