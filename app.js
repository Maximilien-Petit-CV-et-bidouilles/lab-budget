// ---------------------------
// Config
// ---------------------------
const API = "/api/data";

// ---------------------------
// State
// ---------------------------
let state = {
  budgets: { Fonctionnement: 0, Investissement: 0 },
  expenses: []
};

let charts = {};
const $ = (sel) => document.querySelector(sel);

// ---------------------------
// Helpers
// ---------------------------
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

// ---------------------------
// Netlify Identity helpers
// ---------------------------
function getIdentity() {
  return window.netlifyIdentity || null;
}
function currentUser() {
  const id = getIdentity();
  return id && typeof id.currentUser === "function" ? id.currentUser() : null;
}
function requireAuthUI() {
  const user = currentUser();
  const btnLogin = $("#btnLogin");
  const btnLogout = $("#btnLogout");
  if (btnLogin) btnLogin.style.display = user ? "none" : "inline-flex";
  if (btnLogout) btnLogout.style.display = user ? "inline-flex" : "none";
}

/**
 * IMPORTANT: on envoie le JWT dans Authorization: Bearer <token>
 */
async function authHeaders() {
  const user = currentUser();
  if (!user) return {};
  const token = await user.jwt();
  return { Authorization: `Bearer ${token}` };
}

// ---------------------------
// API
// ---------------------------
async function apiGet() {
  const headers = await authHeaders();

  const res = await fetch(API, { method: "GET", headers });
  const text = await res.text();

  if (res.status === 401) throw new Error("AUTH");
  if (!res.ok) throw new Error(`API ${res.status}: ${text}`);

  return JSON.parse(text);
}

async function apiSave() {
  const headers = { ...(await authHeaders()), "content-type": "application/json" };

  const res = await fetch(API, {
    method: "PUT",
    headers,
    body: JSON.stringify(state)
  });

  const text = await res.text();

  if (res.status === 401) throw new Error("AUTH");
  if (!res.ok) throw new Error(`SAVE ${res.status}: ${text}`);

  return JSON.parse(text);
}

function normalize(data) {
  const budgets = data?.budgets || { Fonctionnement: 0, Investissement: 0 };
  const expenses = Array.isArray(data?.expenses) ? data.expenses : [];
  return { budgets, expenses };
}

// ---------------------------
// Budgets UI
// ---------------------------
function renderBudgets() {
  const bf = $("#budgetFonct");
  const bi = $("#budgetInv");
  if (bf) bf.value = state.budgets.Fonctionnement ?? 0;
  if (bi) bi.value = state.budgets.Investissement ?? 0;
}
function readBudgetsFromInputs() {
  const bf = $("#budgetFonct");
  const bi = $("#budgetInv");
  state.budgets.Fonctionnement = Number(bf?.value || 0);
  state.budgets.Investissement = Number(bi?.value || 0);
}

// ---------------------------
// Table + filters
// ---------------------------
function filteredExpenses() {
  const q = ($("#q")?.value || "").trim().toLowerCase();
  const s = $("#filterStatus")?.value || "";
  const e = $("#filterEnvelope")?.value || "";
  const t = $("#filterType")?.value || "";

  return state.expenses
    .filter(x => !q || ((x.label || "") + " " + (x.project || "")).toLowerCase().includes(q))
    .filter(x => !s || x.status === s)
    .filter(x => !e || x.envelope === e)
    .filter(x => !t || x.type === t)
    .sort((a, b) => (a.date || "").localeCompare(b.date || ""));
}

function renderTable() {
  const tbody = $("#tbody");
  if (!tbody) return;

  const rows = filteredExpenses().map(x => `
    <tr data-id="${x.id}">
      <td>${escapeHtml(x.date || "")}</td>
      <td>${escapeHtml(x.label || "")}</td>
      <td>${escapeHtml(x.type || "")}</td>
      <td>${escapeHtml(x.envelope || "")}</td>
      <td>${escapeHtml(x.project || "")}</td>
      <td>${escapeHtml(x.status || "")}</td>
      <td class="right">${euro(x.amount)}</td>
      <td><button class="btn btn-ghost btnDel" type="button">Suppr.</button></td>
    </tr>
  `).join("");

  tbody.innerHTML = rows || `<tr><td colspan="8" class="muted">Aucune dépense</td></tr>`;

  // Totaux
  const all = state.expenses;
  const sum = (arr) => arr.reduce((acc, x) => acc + (Number(x.amount) || 0), 0);

  const byStatus = {
    "Votée": sum(all.filter(x => x.status === "Votée")),
    "Engagée": sum(all.filter(x => x.status === "Engagée")),
    "Service fait": sum(all.filter(x => x.status === "Service fait"))
  };

  const byEnvelope = {
    "Fonctionnement": sum(all.filter(x => x.envelope === "Fonctionnement")),
    "Investissement": sum(all.filter(x => x.envelope === "Investissement"))
  };

  const resteFonct = (state.budgets.Fonctionnement || 0) - byEnvelope.Fonctionnement;
  const resteInv = (state.budgets.Investissement || 0) - byEnvelope.Investissement;

  const totals = $("#totals");
  if (totals) {
    totals.innerHTML = `
      <div><b>Total</b> : ${euro(sum(all))}</div>
      <div>Par statut — Votée: ${euro(byStatus["Votée"])} • Engagée: ${euro(byStatus["Engagée"])} • Service fait: ${euro(byStatus["Service fait"])}</div>
      <div>Reste budgets — Fonctionnement: ${euro(resteFonct)} • Investissement: ${euro(resteInv)}</div>
    `;
  }
}

// ---------------------------
// Charts
// ---------------------------
function buildStats() {
  const all = state.expenses;
  const sum = (arr) => arr.reduce((acc, x) => acc + (Number(x.amount) || 0), 0);

  const statusLabels = ["Votée", "Engagée", "Service fait"];
  const statusData = statusLabels.map(st => sum(all.filter(x => x.status === st)));

  const envLabels = ["Fonctionnement", "Investissement"];
  const envData = envLabels.map(en => sum(all.filter(x => x.envelope === en)));

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
  if (!window.Chart) return; // Chart.js pas chargé
  const s = buildStats();

  // destroy previous charts
  for (const k of Object.keys(charts)) charts[k]?.destroy?.();
  charts = {};

  const cStatus = $("#chartStatus");
  const cEnv = $("#chartEnvelope");
  const cType = $("#chartType");
  const cMonth = $("#chartMonthly");

  if (cStatus) {
    charts.status = new Chart(cStatus, {
      type: "doughnut",
      data: { labels: s.statusLabels, datasets: [{ data: s.statusData }] }
    });
  }
  if (cEnv) {
    charts.env = new Chart(cEnv, {
      type: "doughnut",
      data: { labels: s.envLabels, datasets: [{ data: s.envData }] }
    });
  }
  if (cType) {
    charts.type = new Chart(cType, {
      type: "bar",
      data: { labels: s.typeLabels, datasets: [{ data: s.typeData }] },
      options: { plugins: { legend: { display: false } } }
    });
  }
  if (cMonth) {
    charts.month = new Chart(cMonth, {
      type: "line",
      data: { labels: s.months, datasets: [{ data: s.monthlyData }] },
      options: { plugins: { legend: { display: false } } }
    });
  }
}

// ---------------------------
// CSV / JSON export-import
// ---------------------------
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
  for (const x of state.expenses) {
    lines.push(headers.map(h => csvCell(x[h])).join(","));
  }
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
    renderAll();
  };
  reader.readAsText(file, "utf-8");
}

// ---------------------------
// Render all
// ---------------------------
function renderAll() {
  renderBudgets();
  renderTable();
  renderCharts();
}

// ---------------------------
// Wire UI events
// ---------------------------
function wireEvents() {
  // Login/Logout
  $("#btnLogin")?.addEventListener("click", () => getIdentity()?.open());
  $("#btnLogout")?.addEventListener("click", async () => {
    await getIdentity()?.logout();
    requireAuthUI();
  });

  // Add expense
  $("#expenseForm")?.addEventListener("submit", (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const exp = {
      id: uid(),
      date: fd.get("date"),
      label: fd.get("label"),
      type: fd.get("type"),
      envelope: fd.get("envelope"),
      project: fd.get("project"),
      status: fd.get("status"),
      amount: Number(fd.get("amount") || 0)
    };
    state.expenses.push(exp);
    e.target.reset();
    renderAll();
  });

  // Delete row
  $("#tbody")?.addEventListener("click", (e) => {
    const btn = e.target.closest(".btnDel");
    if (!btn) return;
    const tr = e.target.closest("tr");
    const id = tr?.getAttribute("data-id");
    state.expenses = state.expenses.filter(x => x.id !== id);
    renderAll();
  });

  // Filters
  ["#q", "#filterStatus", "#filterEnvelope", "#filterType"].forEach(sel => {
    $(sel)?.addEventListener("input", () => renderTable());
    $(sel)?.addEventListener("change", () => renderTable());
  });

  // Save budgets
  $("#btnSaveBudgets")?.addEventListener("click", async () => {
    try {
      readBudgetsFromInputs();
      await apiSave();
      setSaveStatus("Budgets enregistrés ✅");
      renderAll();
    } catch (err) {
      if (String(err?.message) === "AUTH") getIdentity()?.open();
      else alert("Erreur : " + (err?.message || err));
    }
  });

  // Save all
  $("#btnSave")?.addEventListener("click", async () => {
    try {
      await apiSave();
      setSaveStatus("Sauvegardé ✅");
    } catch (err) {
      if (String(err?.message) === "AUTH") getIdentity()?.open();
      else alert("Erreur : " + (err?.message || err));
    }
  });

  // Export/Import
  $("#btnExportCsv")?.addEventListener("click", exportCsv);
  $("#btnExportJson")?.addEventListener("click", exportJson);

  $("#fileCsv")?.addEventListener("change", (e) => {
    const f = e.target.files?.[0];
    if (f) importCsv(f);
    e.target.value = "";
  });
}

// ---------------------------
// Bootstrap
// ---------------------------
async function bootstrap() {
  wireEvents();

  const id = getIdentity();
  if (!id) {
    // widget pas chargé
    renderAll();
    return;
  }

  id.on("init", () => {
    requireAuthUI();
  });

  id.on("login", async () => {
    requireAuthUI();
    try {
      const data = await apiGet();
      state = normalize(data);
      renderAll();
      id.close();
    } catch (e) {
      // message explicite
      alert("Connexion OK, mais chargement KO :\n" + (e?.message || e));
    }
  });

  id.on("logout", () => {
    requireAuthUI();
  });

  // Au chargement : si déjà connecté, on tente de charger
  requireAuthUI();
  try {
    if (currentUser()) {
      const data = await apiGet();
      state = normalize(data);
    }
  } catch (e) {
    // si erreur, on laisse l'UI vide mais fonctionnelle
    console.warn("Load failed:", e);
  }

  renderAll();
}

bootstrap();
