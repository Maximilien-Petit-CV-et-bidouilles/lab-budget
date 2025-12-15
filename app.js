// ==============================
// Budget labo — V1 complète + améliorations
// - Autosave (debounced)
// - Badges de statut
// - Totaux par projet
// ==============================

const API = "/api/data";

let state = {
  budgets: { Fonctionnement: 0, Investissement: 0 },
  expenses: []
};

let charts = {};
let editingId = null;

// Autosave (debounce)
let autosaveTimer = null;
const AUTOSAVE_DELAY_MS = 1500;

const $ = (sel) => document.querySelector(sel);

// -------------------- Helpers --------------------
function euro(n) {
  return (Number(n) || 0).toLocaleString("fr-FR", { style: "currency", currency: "EUR" });
}
function uid() {
  return crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2);
}
function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
}
function setSaveStatus(msg) {
  const el = $("#saveStatus");
  if (!el) return;
  el.textContent = msg || "";
  if (msg) setTimeout(() => (el.textContent = ""), 2500);
}
function sumAmount(arr) {
  return arr.reduce((acc, x) => acc + (Number(x.amount) || 0), 0);
}

// -------------------- Options (pour édition) --------------------
const TYPE_OPTIONS = [
  "Orga manifestation scientifique",
  "Aide à la publication",
  "Mission France",
  "Mission Europe",
  "Mission International",
  "Achat matériel informatique",
  "Achat logiciels",
  "Autre"
];
const ENVELOPE_OPTIONS = ["Fonctionnement", "Investissement"];
const STATUS_OPTIONS = ["Votée", "Engagée", "Service fait"];

function optionsHtml(list, current) {
  return list
    .map(v => `<option value="${escapeHtml(v)}" ${v === current ? "selected" : ""}>${escapeHtml(v)}</option>`)
    .join("");
}

// -------------------- Badges --------------------
function statusBadge(status) {
  const st = status || "";
  if (st === "Service fait") return `<span class="badge badge-sf">Service fait</span>`;
  if (st === "Engagée") return `<span class="badge badge-engagee">Engagée</span>`;
  return `<span class="badge badge-votee">Votée</span>`;
}

// -------------------- Identity --------------------
function idWidget() {
  return window.netlifyIdentity || null;
}
function currentUser() {
  const id = idWidget();
  return id && typeof id.currentUser === "function" ? id.currentUser() : null;
}
function updateAuthButtons() {
  const user = currentUser();
  $("#btnLogin").style.display = user ? "none" : "inline-flex";
  $("#btnLogout").style.display = user ? "inline-flex" : "none";
}
async function authHeaders() {
  const user = currentUser();
  if (!user) return {};
  const token = await user.jwt();
  return { Authorization: `Bearer ${token}` };
}

// -------------------- API --------------------
async function apiGet() {
  const headers = await authHeaders();
  const res = await fetch(API, { method: "GET", headers });
  const text = await res.text();
  if (res.status === 401) throw new Error("AUTH");
  if (!res.ok) throw new Error(`GET ${res.status}: ${text}`);
  return JSON.parse(text);
}

async function apiSave() {
  const headers = { ...(await authHeaders()), "content-type": "application/json" };
  const res = await fetch(API, { method: "PUT", headers, body: JSON.stringify(state) });
  const text = await res.text();
  if (res.status === 401) throw new Error("AUTH");
  if (!res.ok) throw new Error(`PUT ${res.status}: ${text}`);
  return JSON.parse(text);
}

function normalize(data) {
  return {
    budgets: data?.budgets || { Fonctionnement: 0, Investissement: 0 },
    expenses: Array.isArray(data?.expenses) ? data.expenses : []
  };
}

// -------------------- Autosave --------------------
function scheduleAutosave(reason = "") {
  // Si pas connecté, on ne peut pas sauvegarder serveur → on n’insiste pas
  if (!currentUser()) {
    setSaveStatus("Connecte-toi pour activer l’autosauvegarde.");
    return;
  }

  if (autosaveTimer) clearTimeout(autosaveTimer);

  setSaveStatus(reason ? `Autosave… (${reason})` : "Autosave…");

  autosaveTimer = setTimeout(async () => {
    autosaveTimer = null;
    try {
      await apiSave();
      setSaveStatus("Autosauvegardé ✅");
    } catch (e) {
      if (e.message === "AUTH") {
        setSaveStatus("Session expirée — reconnecte-toi.");
      } else {
        setSaveStatus("Autosave échoué.");
        console.warn("Autosave failed:", e);
      }
    }
  }, AUTOSAVE_DELAY_MS);
}

// -------------------- Budgets UI --------------------
function renderBudgets() {
  $("#budgetFonct").value = state.budgets.Fonctionnement ?? 0;
  $("#budgetInv").value = state.budgets.Investissement ?? 0;
}
function readBudgets() {
  state.budgets.Fonctionnement = Number($("#budgetFonct").value || 0);
  state.budgets.Investissement = Number($("#budgetInv").value || 0);
}

// -------------------- Filtering --------------------
function filteredExpenses() {
  const q = ($("#q").value || "").trim().toLowerCase();
  const s = $("#filterStatus").value || "";
  const e = $("#filterEnvelope").value || "";
  const t = $("#filterType").value || "";

  return state.expenses
    .filter(x => !q || ((x.label || "") + " " + (x.project || "")).toLowerCase().includes(q))
    .filter(x => !s || x.status === s)
    .filter(x => !e || x.envelope === e)
    .filter(x => !t || x.type === t)
    .sort((a, b) => (a.date || "").localeCompare(b.date || ""));
}

// -------------------- Totaux par projet --------------------
function totalsByProject(expenses) {
  const map = new Map();
  for (const x of expenses) {
    const p = (x.project || "").trim();
    if (!p) continue;
    map.set(p, (map.get(p) || 0) + (Number(x.amount) || 0));
  }
  return [...map.entries()].sort((a, b) => b[1] - a[1]);
}

// -------------------- Table + totals (avec édition) --------------------
function renderTable() {
  const tbody = $("#tbody");
  if (!tbody) return;

  const rows = filteredExpenses().map(x => {
    const isEditing = editingId === x.id;

    if (!isEditing) {
      return `
        <tr data-id="${x.id}">
          <td>${escapeHtml(x.date || "")}</td>
          <td>${escapeHtml(x.label || "")}</td>
          <td>${escapeHtml(x.type || "")}</td>
          <td>${escapeHtml(x.envelope || "")}</td>
          <td>${escapeHtml(x.project || "")}</td>
          <td>${statusBadge(x.status)}</td>
          <td class="right">${euro(x.amount)}</td>
          <td>
            <button class="btn btn-ghost btnEdit" type="button">✏️ Modifier</button>
            <button class="btn btn-ghost btnDel" type="button">🗑️</button>
          </td>
        </tr>
      `;
    }

    // Mode édition
    return `
      <tr data-id="${x.id}">
        <td><input class="editDate" type="date" value="${escapeHtml(x.date || "")}"></td>
        <td><input class="editLabel" type="text" value="${escapeHtml(x.label || "")}"></td>
        <td>
          <select class="editType">
            ${optionsHtml(TYPE_OPTIONS, x.type || "Autre")}
          </select>
        </td>
        <td>
          <select class="editEnvelope">
            ${optionsHtml(ENVELOPE_OPTIONS, x.envelope || "Fonctionnement")}
          </select>
        </td>
        <td><input class="editProject" type="text" value="${escapeHtml(x.project || "")}"></td>
        <td>
          <select class="editStatus">
            ${optionsHtml(STATUS_OPTIONS, x.status || "Votée")}
          </select>
        </td>
        <td class="right">
          <input class="editAmount" type="number" step="0.01" min="0" value="${escapeHtml(x.amount ?? 0)}" style="width:120px;">
        </td>
        <td>
          <button class="btn btn-primary btnRowSave" type="button">✅ OK</button>
          <button class="btn btn-ghost btnRowCancel" type="button">↩️ Annuler</button>
        </td>
      </tr>
    `;
  }).join("");

  tbody.innerHTML = rows || `<tr><td colspan="8" class="muted">Aucune dépense</td></tr>`;

  // Totaux
  const all = state.expenses;

  const byStatus = {
    "Votée": sumAmount(all.filter(x => x.status === "Votée")),
    "Engagée": sumAmount(all.filter(x => x.status === "Engagée")),
    "Service fait": sumAmount(all.filter(x => x.status === "Service fait"))
  };

  const byEnvelope = {
    "Fonctionnement": sumAmount(all.filter(x => x.envelope === "Fonctionnement")),
    "Investissement": sumAmount(all.filter(x => x.envelope === "Investissement"))
  };

  const resteFonct = (state.budgets.Fonctionnement || 0) - byEnvelope.Fonctionnement;
  const resteInv = (state.budgets.Investissement || 0) - byEnvelope.Investissement;

  const proj = totalsByProject(all);
  const topProj = proj.slice(0, 6); // top 6 projets pour ne pas encombrer

  $("#totals").innerHTML = `
    <div><b>Total</b> : ${euro(sumAmount(all))}</div>
    <div>Par statut — Votée: ${euro(byStatus["Votée"])} • Engagée: ${euro(byStatus["Engagée"])} • Service fait: ${euro(byStatus["Service fait"])}</div>
    <div>Reste budgets — Fonctionnement: ${euro(resteFonct)} • Investissement: ${euro(resteInv)}</div>
    ${
      topProj.length
        ? `<div style="margin-top:8px;"><b>Totaux par projet (top)</b> : ${
            topProj.map(([p, v]) => `${escapeHtml(p)} <span class="muted">(${euro(v)})</span>`).join(" • ")
          }</div>`
        : `<div style="margin-top:8px;" class="muted">Totaux par projet : aucun projet renseigné.</div>`
    }
  `;
}

// -------------------- Charts --------------------
function buildStats() {
  const all = state.expenses;

  const statusLabels = ["Votée", "Engagée", "Service fait"];
  const statusData = statusLabels.map(st => sumAmount(all.filter(x => x.status === st)));

  const envLabels = ["Fonctionnement", "Investissement"];
  const envData = envLabels.map(en => sumAmount(all.filter(x => x.envelope === en)));

  const typeMap = new Map();
  for (const x of all) {
    const k = x.type || "Autre";
    typeMap.set(k, (typeMap.get(k) || 0) + (Number(x.amount) || 0));
  }
  const typeEntries = [...typeMap.entries()].sort((a, b) => b[1] - a[1]);
  const typeLabels = typeEntries.map(([k]) => k);
  const typeData = typeEntries.map(([, v]) => v);

  const m = new Map();
  for (const x of all.filter(x => x.status === "Service fait")) {
    const ym = (x.date || "").slice(0, 7); // YYYY-MM
    if (!ym) continue;
    m.set(ym, (m.get(ym) || 0) + (Number(x.amount) || 0));
  }
  const months = [...m.keys()].sort();
  const monthlyData = months.map(k => m.get(k));

  return { statusLabels, statusData, envLabels, envData, typeLabels, typeData, months, monthlyData };
}

function renderCharts() {
  if (!window.Chart) return;

  for (const k of Object.keys(charts)) charts[k]?.destroy?.();
  charts = {};

  const s = buildStats();

  charts.status = new Chart($("#chartStatus"), {
    type: "doughnut",
    data: { labels: s.statusLabels, datasets: [{ data: s.statusData }] }
  });

  charts.env = new Chart($("#chartEnvelope"), {
    type: "doughnut",
    data: { labels: s.envLabels, datasets: [{ data: s.envData }] }
  });

  charts.type = new Chart($("#chartType"), {
    type: "bar",
    data: { labels: s.typeLabels, datasets: [{ data: s.typeData }] },
    options: { plugins: { legend: { display: false } } }
  });

  charts.month = new Chart($("#chartMonthly"), {
    type: "line",
    data: { labels: s.months, datasets: [{ data: s.monthlyData }] },
    options: { plugins: { legend: { display: false } } }
  });
}

// -------------------- CSV / JSON --------------------
function download(filename, content, mime) {
  const blob = new Blob([content], { type: mime || "text/plain" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function csvCell(v) {
  const s = (v ?? "").toString();
  if (/[,"\n;]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function exportCsv() {
  const headers = ["id", "date", "label", "type", "envelope", "project", "status", "amount"];
  const lines = [headers.join(",")];
  for (const x of state.expenses) lines.push(headers.map(h => csvCell(x[h])).join(","));
  download("budget-labo.csv", lines.join("\n"), "text/csv;charset=utf-8");
}

function exportJson() {
  download("budget-labo.json", JSON.stringify(state, null, 2), "application/json;charset=utf-8");
}

function parseCsv(text) {
  const rows = [];
  let i = 0, field = "", row = [], inQuotes = false;

  while (i < text.length) {
    const c = text[i];
    const next = text[i + 1];

    if (inQuotes) {
      if (c === '"' && next === '"') { field += '"'; i += 2; continue; }
      if (c === '"') { inQuotes = false; i++; continue; }
      field += c; i++; continue;
    } else {
      if (c === '"') { inQuotes = true; i++; continue; }
      if (c === ',') { row.push(field); field = ""; i++; continue; }
      if (c === '\n' || c === '\r') {
        if (c === '\r' && next === '\n') i++;
        row.push(field); field = "";
        if (row.some(x => x.length > 0)) rows.push(row);
        row = [];
        i++; continue;
      }
      field += c; i++; continue;
    }
  }
  row.push(field);
  if (row.some(x => x.length > 0)) rows.push(row);
  return rows;
}

function importCsv(file) {
  const reader = new FileReader();
  reader.onload = () => {
    const rows = parseCsv(String(reader.result || ""));
    if (!rows.length) return;

    const headers = rows[0].map(h => h.trim());
    const idx = (name) => headers.indexOf(name);

    const required = ["date", "label", "type", "envelope", "status", "amount"];
    for (const r of required) {
      if (idx(r) === -1) {
        alert(`CSV invalide : colonne manquante "${r}"`);
        return;
      }
    }

    const nextExpenses = [];
    for (const r of rows.slice(1)) {
      const obj = {
        id: r[idx("id")] || uid(),
        date: r[idx("date")] || "",
        label: r[idx("label")] || "",
        type: r[idx("type")] || "Autre",
        envelope: r[idx("envelope")] || "Fonctionnement",
        project: idx("project") !== -1 ? (r[idx("project")] || "") : "",
        status: r[idx("status")] || "Votée",
        amount: Number((r[idx("amount")] || "").replace(",", ".")) || 0
      };
      if (obj.label || obj.amount) nextExpenses.push(obj);
    }

    state.expenses = nextExpenses;
    editingId = null;
    renderAll();
    scheduleAutosave("import CSV");
  };
  reader.readAsText(file, "utf-8");
}

// -------------------- Render all --------------------
function renderAll() {
  renderBudgets();
  renderTable();
  renderCharts();
}

// -------------------- Events --------------------
function wireEvents() {
  // Login / Logout
  $("#btnLogin").addEventListener("click", () => {
    const id = idWidget();
    if (!id) return alert("Netlify Identity n’est pas chargé.");
    id.open();
  });

  $("#btnLogout").addEventListener("click", async () => {
    await idWidget()?.logout();
    updateAuthButtons();
  });

  // Add expense
  $("#expenseForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);

    state.expenses.push({
      id: uid(),
      date: fd.get("date"),
      label: fd.get("label"),
      type: fd.get("type"),
      envelope: fd.get("envelope"),
      project: fd.get("project"),
      status: fd.get("status"),
      amount: Number(fd.get("amount") || 0)
    });

    e.target.reset();
    renderAll();
    scheduleAutosave("ajout");
  });

  // Edit/Delete row (event delegation)
  $("#tbody").addEventListener("click", (e) => {
    const tr = e.target.closest("tr");
    const id = tr?.getAttribute("data-id");
    if (!id) return;

    // Delete
    if (e.target.closest(".btnDel")) {
      state.expenses = state.expenses.filter(x => x.id !== id);
      if (editingId === id) editingId = null;
      renderAll();
      scheduleAutosave("suppression");
      return;
    }

    // Enter edit mode
    if (e.target.closest(".btnEdit")) {
      editingId = id;
      renderTable(); // table only
      return;
    }

    // Cancel edit
    if (e.target.closest(".btnRowCancel")) {
      editingId = null;
      renderTable();
      return;
    }

    // Save edit
    if (e.target.closest(".btnRowSave")) {
      const get = (sel) => tr.querySelector(sel);

      const next = {
        id,
        date: get(".editDate")?.value || "",
        label: get(".editLabel")?.value || "",
        type: get(".editType")?.value || "Autre",
        envelope: get(".editEnvelope")?.value || "Fonctionnement",
        project: get(".editProject")?.value || "",
        status: get(".editStatus")?.value || "Votée",
        amount: Number(get(".editAmount")?.value || 0)
      };

      if (!next.label.trim()) {
        alert("Le libellé est obligatoire.");
        return;
      }
      if (Number.isNaN(next.amount) || next.amount < 0) {
        alert("Le montant doit être un nombre ≥ 0.");
        return;
      }

      state.expenses = state.expenses.map(x => (x.id === id ? next : x));
      editingId = null;
      renderAll();
      scheduleAutosave("modif");
      return;
    }
  });

  // Filters
  ["#q", "#filterStatus", "#filterEnvelope", "#filterType"].forEach(sel => {
    $(sel).addEventListener("input", renderTable);
    $(sel).addEventListener("change", renderTable);
  });

  // Save budgets (on garde le bouton + autosave aussi)
  $("#btnSaveBudgets").addEventListener("click", async () => {
    try {
      readBudgets();
      await apiSave();
      setSaveStatus("Budgets enregistrés ✅");
      renderAll();
    } catch (e) {
      if (e.message === "AUTH") idWidget()?.open();
      else alert("Erreur sauvegarde budgets:\n" + e.message);
    }
  });

  // Manual save
  $("#btnSave").addEventListener("click", async () => {
    try {
      await apiSave();
      setSaveStatus("Sauvegardé ✅");
    } catch (e) {
      if (e.message === "AUTH") idWidget()?.open();
      else alert("Erreur sauvegarde:\n" + e.message);
    }
  });

  // Export/Import
  $("#btnExportCsv").addEventListener("click", exportCsv);
  $("#btnExportJson").addEventListener("click", exportJson);

  $("#fileCsv").addEventListener("change", (e) => {
    const f = e.target.files?.[0];
    if (f) importCsv(f);
    e.target.value = "";
  });

  // Autosave sur changement budgets (sans cliquer)
  $("#budgetFonct").addEventListener("input", () => { readBudgets(); renderTable(); renderCharts(); scheduleAutosave("budget"); });
  $("#budgetInv").addEventListener("input", () => { readBudgets(); renderTable(); renderCharts(); scheduleAutosave("budget"); });
}

// -------------------- Boot --------------------
async function boot() {
  wireEvents();

  const id = idWidget();
  if (!id) {
    renderAll();
    return;
  }

  id.on("init", () => updateAuthButtons());

  id.on("login", async () => {
    updateAuthButtons();
    try {
      const data = await apiGet();
      state = normalize(data);
      editingId = null;
      renderAll();
      id.close();
    } catch (e) {
      alert("Connexion OK, mais chargement KO :\n" + e.message);
    }
  });

  id.on("logout", () => {
    updateAuthButtons();
  });

  // si déjà connecté (session), charger au démarrage
  updateAuthButtons();
  try {
    if (currentUser()) {
      const data = await apiGet();
      state = normalize(data);
    }
  } catch (e) {
    console.warn("Initial load failed:", e);
  }

  renderAll();
}

boot();
