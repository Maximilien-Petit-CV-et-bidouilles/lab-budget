const API = "/api/data";

let state = {
  budgets: { Fonctionnement: 0, Investissement: 0 },
  expenses: []
};

let charts = {};
let editingId = null;

// Autosave
let autosaveTimer = null;
const AUTOSAVE_DELAY_MS = 1500;

// Relances (jours)
const THRESHOLD_QUOTE_TO_PO = 10;
const THRESHOLD_PO_TO_SF = 30;
const THRESHOLD_SF_TO_INVOICE = 15;

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
function parseDateISO(s) {
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}
function daysSince(isoDate) {
  const d = parseDateISO(isoDate);
  if (!d) return null;
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  return Math.floor(diff / (1000 * 60 * 60 * 24));
}

// -------------------- Options --------------------
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

// -------------------- Badges statut --------------------
function statusBadge(status) {
  const st = status || "";
  if (st === "Service fait") return `<span class="badge badge-sf">Service fait</span>`;
  if (st === "Engagée") return `<span class="badge badge-engagee">Engagée</span>`;
  return `<span class="badge badge-votee">Votée</span>`;
}

// -------------------- Identity --------------------
function idWidget() { return window.netlifyIdentity || null; }
function currentUser() {
  const id = idWidget();
  return id && typeof id.currentUser === "function" ? id.currentUser() : null;
}
function updateAuthUI() {
  const authed = !!currentUser();
  document.body.classList.toggle("is-auth", authed);
}
function updateAuthButtons() {
  const user = currentUser();
  const btnLogin = $("#btnLogin");
  const btnLogout = $("#btnLogout");
  if (btnLogin) btnLogin.style.display = user ? "none" : "inline-flex";
  if (btnLogout) btnLogout.style.display = user ? "inline-flex" : "none";
  updateAuthUI();
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
  const budgets = data?.budgets || { Fonctionnement: 0, Investissement: 0 };
  const expenses = Array.isArray(data?.expenses) ? data.expenses : [];

  for (const x of expenses) {
    x.owner ||= "";
    x.supplier ||= "";
    x.quoteNumber ||= "";
    x.quoteDate ||= "";
    x.poNumber ||= "";
    x.poDate ||= "";
    x.invoiceNumber ||= "";
    x.invoiceDate ||= "";
  }
  return { budgets, expenses };
}

// -------------------- Autosave --------------------
function scheduleAutosave(reason = "") {
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
      if (e.message === "AUTH") setSaveStatus("Session expirée — reconnecte-toi.");
      else { setSaveStatus("Autosave échoué."); console.warn("Autosave failed:", e); }
    }
  }, AUTOSAVE_DELAY_MS);
}

// -------------------- Budgets UI --------------------
function renderBudgets() {
  const bf = $("#budgetFonct");
  const bi = $("#budgetInv");
  if (!bf || !bi) return;
  bf.value = state.budgets.Fonctionnement ?? 0;
  bi.value = state.budgets.Investissement ?? 0;
}
function readBudgets() {
  state.budgets.Fonctionnement = Number($("#budgetFonct").value || 0);
  state.budgets.Investissement = Number($("#budgetInv").value || 0);
}

// -------------------- Owner filter --------------------
function getOwners() {
  const set = new Set();
  for (const x of state.expenses) {
    const o = (x.owner || "").trim();
    if (o) set.add(o);
  }
  return [...set].sort((a, b) => a.localeCompare(b, "fr"));
}
function renderOwnerFilter() {
  const sel = $("#filterOwner");
  if (!sel) return;

  const current = sel.value || "";
  const owners = getOwners();

  sel.innerHTML =
    `<option value="">Tous porteurs</option>` +
    owners.map(o => `<option value="${escapeHtml(o)}">${escapeHtml(o)}</option>`).join("");

  if (owners.includes(current)) sel.value = current;
}

// -------------------- Filtering --------------------
function searchableText(x) {
  return (
    (x.label || "") + " " +
    (x.project || "") + " " +
    (x.owner || "") + " " +
    (x.supplier || "") + " " +
    (x.quoteNumber || "") + " " +
    (x.poNumber || "") + " " +
    (x.invoiceNumber || "")
  ).toLowerCase();
}

function filteredExpenses() {
  const q = ($("#q")?.value || "").trim().toLowerCase();
  const owner = ($("#filterOwner")?.value || "").trim();
  const s = $("#filterStatus")?.value || "";
  const e = $("#filterEnvelope")?.value || "";
  const t = $("#filterType")?.value || "";

  return state.expenses
    .filter(x => !q || searchableText(x).includes(q))
    .filter(x => !owner || (x.owner || "").trim() === owner)
    .filter(x => !s || x.status === s)
    .filter(x => !e || x.envelope === e)
    .filter(x => !t || x.type === t)
    .sort((a, b) => (a.date || "").localeCompare(b.date || ""));
}

// -------------------- Totaux par projet / porteur --------------------
function totalsByKey(expenses, key) {
  const map = new Map();
  for (const x of expenses) {
    const k = (x[key] || "").trim();
    if (!k) continue;
    map.set(k, (map.get(k) || 0) + (Number(x.amount) || 0));
  }
  return [...map.entries()].sort((a, b) => b[1] - a[1]);
}

// -------------------- Relances (workflow) --------------------
function computeReminders() {
  const items = [];

  for (const x of state.expenses) {
    const quote = x.quoteDate || "";
    const po = x.poDate || "";
    const inv = x.invoiceDate || "";

    if (x.quoteNumber && !x.poNumber) {
      const d = daysSince(quote) ?? daysSince(x.date);
      if (d != null && d >= THRESHOLD_QUOTE_TO_PO) items.push({ kind: "Devis sans BC", days: d, x });
    }

    if (x.poNumber && x.status !== "Service fait") {
      const d = daysSince(po) ?? daysSince(x.date);
      if (d != null && d >= THRESHOLD_PO_TO_SF) items.push({ kind: "BC sans service fait", days: d, x });
    }

    if (x.status === "Service fait" && !x.invoiceNumber) {
      const d = daysSince(x.date);
      if (d != null && d >= THRESHOLD_SF_TO_INVOICE) items.push({ kind: "Service fait sans facture", days: d, x });
    }

    if (x.invoiceNumber && !inv) items.push({ kind: "Facture sans date", days: null, x });
  }

  items.sort((a, b) => (b.days ?? -1) - (a.days ?? -1));
  return items.slice(0, 12);
}

function renderReminders() {
  const el = $("#reminders");
  if (!el) return;

  const items = computeReminders();
  if (!items.length) {
    el.innerHTML = `<div class="muted">Aucune relance détectée ✅</div>`;
    return;
  }

  el.innerHTML = `
    <ul class="reminders">
      ${items.map(it => `
        <li>
          <b>${escapeHtml(it.kind)}</b>
          ${it.days != null ? `<span class="muted">(${it.days}j)</span>` : ``}
          — ${escapeHtml(it.x.label || "")}
          ${it.x.owner ? `<span class="muted">• ${escapeHtml(it.x.owner)}</span>` : ``}
          ${it.x.supplier ? `<span class="muted">• ${escapeHtml(it.x.supplier)}</span>` : ``}
        </li>
      `).join("")}
    </ul>
  `;
}

// -------------------- Table --------------------
function refsCell(x) {
  const parts = [];
  if (x.quoteNumber) parts.push(`Devis: ${escapeHtml(x.quoteNumber)}`);
  if (x.poNumber) parts.push(`BC: ${escapeHtml(x.poNumber)}`);
  if (x.invoiceNumber) parts.push(`Fact: ${escapeHtml(x.invoiceNumber)}`);
  return parts.length ? parts.join(" • ") : `<span class="muted">—</span>`;
}

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
          <td>${escapeHtml(x.owner || "")}</td>
          <td>${escapeHtml(x.supplier || "")}</td>
          <td>${refsCell(x)}</td>
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

    return `
      <tr data-id="${x.id}">
        <td><input class="editDate" type="date" value="${escapeHtml(x.date || "")}"></td>
        <td>
          <input class="editLabel" type="text" value="${escapeHtml(x.label || "")}">
          <div style="margin-top:6px;">
            <details class="details">
              <summary>Détails devis / BC / facture</summary>
              <div class="grid2">
                <label>Porteur
                  <input class="editOwner" type="text" value="${escapeHtml(x.owner || "")}">
                </label>
                <label>Fournisseur
                  <input class="editSupplier" type="text" value="${escapeHtml(x.supplier || "")}">
                </label>

                <label>N° devis
                  <input class="editQuoteNumber" type="text" value="${escapeHtml(x.quoteNumber || "")}">
                </label>
                <label>Date devis
                  <input class="editQuoteDate" type="date" value="${escapeHtml(x.quoteDate || "")}">
                </label>

                <label>N° BC
                  <input class="editPoNumber" type="text" value="${escapeHtml(x.poNumber || "")}">
                </label>
                <label>Date BC
                  <input class="editPoDate" type="date" value="${escapeHtml(x.poDate || "")}">
                </label>

                <label>N° facture
                  <input class="editInvoiceNumber" type="text" value="${escapeHtml(x.invoiceNumber || "")}">
                </label>
                <label>Date facture
                  <input class="editInvoiceDate" type="date" value="${escapeHtml(x.invoiceDate || "")}">
                </label>
              </div>
            </details>
          </div>
        </td>
        <td><input class="editOwner2" type="text" value="${escapeHtml(x.owner || "")}" placeholder="(optionnel)"></td>
        <td><input class="editSupplier2" type="text" value="${escapeHtml(x.supplier || "")}" placeholder="(optionnel)"></td>
        <td>${refsCell(x)}</td>
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

  tbody.innerHTML = rows || `<tr><td colspan="11" class="muted">Aucune dépense</td></tr>`;

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

  const projTop = totalsByKey(all, "project").slice(0, 6);
  const ownerTop = totalsByKey(all, "owner").slice(0, 6);

  const totalsEl = $("#totals");
  if (totalsEl) {
    totalsEl.innerHTML = `
      <div><b>Total</b> : ${euro(sumAmount(all))}</div>
      <div>Par statut — Votée: ${euro(byStatus["Votée"])} • Engagée: ${euro(byStatus["Engagée"])} • Service fait: ${euro(byStatus["Service fait"])}</div>
      <div>Reste budgets — Fonctionnement: ${euro(resteFonct)} • Investissement: ${euro(resteInv)}</div>

      ${
        ownerTop.length
          ? `<div style="margin-top:8px;"><b>Totaux par porteur (top)</b> : ${ownerTop.map(([k, v]) => `${escapeHtml(k)} <span class="muted">(${euro(v)})</span>`).join(" • ")}</div>`
          : `<div style="margin-top:8px;" class="muted">Totaux par porteur : aucun porteur renseigné.</div>`
      }

      ${
        projTop.length
          ? `<div style="margin-top:6px;"><b>Totaux par projet (top)</b> : ${projTop.map(([k, v]) => `${escapeHtml(k)} <span class="muted">(${euro(v)})</span>`).join(" • ")}</div>`
          : `<div style="margin-top:6px;" class="muted">Totaux par projet : aucun projet renseigné.</div>`
      }
    `;
  }
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
    const ym = (x.date || "").slice(0, 7);
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

  const cs = $("#chartStatus");
  const ce = $("#chartEnvelope");
  const ct = $("#chartType");
  const cm = $("#chartMonthly");
  if (!cs || !ce || !ct || !cm) return;

  charts.status = new Chart(cs, {
    type: "doughnut",
    data: { labels: s.statusLabels, datasets: [{ data: s.statusData }] }
  });

  charts.env = new Chart(ce, {
    type: "doughnut",
    data: { labels: s.envLabels, datasets: [{ data: s.envData }] }
  });

  charts.type = new Chart(ct, {
    type: "bar",
    data: { labels: s.typeLabels, datasets: [{ data: s.typeData }] },
    options: { plugins: { legend: { display: false } } }
  });

  charts.month = new Chart(cm, {
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
  const headers = [
    "id","date","label","owner","supplier",
    "quoteNumber","quoteDate",
    "poNumber","poDate",
    "invoiceNumber","invoiceDate",
    "type","envelope","project","status","amount"
  ];
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

    const required = ["date","label","type","envelope","status","amount"];
    for (const r of required) {
      if (idx(r) === -1) { alert(`CSV invalide : colonne manquante "${r}"`); return; }
    }

    const get = (r, name, fallback = "") => (idx(name) !== -1 ? (r[idx(name)] || fallback) : fallback);

    const nextExpenses = [];
    for (const r of rows.slice(1)) {
      const obj = {
        id: get(r,"id",uid()),
        date: get(r,"date",""),
        label: get(r,"label",""),
        owner: get(r,"owner",""),
        supplier: get(r,"supplier",""),
        quoteNumber: get(r,"quoteNumber",""),
        quoteDate: get(r,"quoteDate",""),
        poNumber: get(r,"poNumber",""),
        poDate: get(r,"poDate",""),
        invoiceNumber: get(r,"invoiceNumber",""),
        invoiceDate: get(r,"invoiceDate",""),
        type: get(r,"type","Autre"),
        envelope: get(r,"envelope","Fonctionnement"),
        project: get(r,"project",""),
        status: get(r,"status","Votée"),
        amount: Number(get(r,"amount","0").replace(",", ".")) || 0
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
  // Hors connexion, on ne force pas des rendus inutiles
  if (!currentUser()) {
    updateAuthButtons();
    return;
  }

  renderBudgets();
  renderOwnerFilter();
  renderTable();
  renderCharts();
  renderReminders();
}

// -------------------- Events --------------------
function wireEvents() {
  $("#btnLogin")?.addEventListener("click", () => idWidget()?.open());
  $("#btnLogin2")?.addEventListener("click", () => idWidget()?.open());
  $("#btnLogout")?.addEventListener("click", async () => { await idWidget()?.logout(); updateAuthButtons(); });

  // Form add expense
  $("#expenseForm")?.addEventListener("submit", (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);

    state.expenses.push({
      id: uid(),
      date: fd.get("date"),
      label: fd.get("label"),
      owner: (fd.get("owner") || "").trim(),
      supplier: (fd.get("supplier") || "").trim(),
      quoteNumber: (fd.get("quoteNumber") || "").trim(),
      quoteDate: fd.get("quoteDate") || "",
      poNumber: (fd.get("poNumber") || "").trim(),
      poDate: fd.get("poDate") || "",
      invoiceNumber: (fd.get("invoiceNumber") || "").trim(),
      invoiceDate: fd.get("invoiceDate") || "",
      type: fd.get("type"),
      envelope: fd.get("envelope"),
      project: (fd.get("project") || "").trim(),
      status: fd.get("status"),
      amount: Number(fd.get("amount") || 0)
    });

    e.target.reset();
    renderAll();
    scheduleAutosave("ajout");
  });

  // Table edit/delete
  $("#tbody")?.addEventListener("click", (e) => {
    const tr = e.target.closest("tr");
    const id = tr?.getAttribute("data-id");
    if (!id) return;

    if (e.target.closest(".btnDel")) {
      state.expenses = state.expenses.filter(x => x.id !== id);
      if (editingId === id) editingId = null;
      renderAll();
      scheduleAutosave("suppression");
      return;
    }

    if (e.target.closest(".btnEdit")) {
      editingId = id;
      renderTable();
      return;
    }

    if (e.target.closest(".btnRowCancel")) {
      editingId = null;
      renderTable();
      return;
    }

    if (e.target.closest(".btnRowSave")) {
      const q = (sel) => tr.querySelector(sel);

      const next = {
        id,
        date: q(".editDate")?.value || "",
        label: q(".editLabel")?.value || "",
        owner: (q(".editOwner")?.value || q(".editOwner2")?.value || "").trim(),
        supplier: (q(".editSupplier")?.value || q(".editSupplier2")?.value || "").trim(),
        quoteNumber: (q(".editQuoteNumber")?.value || "").trim(),
        quoteDate: q(".editQuoteDate")?.value || "",
        poNumber: (q(".editPoNumber")?.value || "").trim(),
        poDate: q(".editPoDate")?.value || "",
        invoiceNumber: (q(".editInvoiceNumber")?.value || "").trim(),
        invoiceDate: q(".editInvoiceDate")?.value || "",
        type: q(".editType")?.value || "Autre",
        envelope: q(".editEnvelope")?.value || "Fonctionnement",
        project: (q(".editProject")?.value || "").trim(),
        status: q(".editStatus")?.value || "Votée",
        amount: Number(q(".editAmount")?.value || 0)
      };

      if (!next.label.trim()) { alert("Le libellé est obligatoire."); return; }
      if (Number.isNaN(next.amount) || next.amount < 0) { alert("Montant invalide (≥ 0)."); return; }

      state.expenses = state.expenses.map(x => (x.id === id ? next : x));
      editingId = null;
      renderAll();
      scheduleAutosave("modif");
    }
  });

  // Filters
  ["#q", "#filterOwner", "#filterStatus", "#filterEnvelope", "#filterType"].forEach(sel => {
    $(sel)?.addEventListener("input", renderTable);
    $(sel)?.addEventListener("change", renderTable);
  });

  // Budgets
  $("#btnSaveBudgets")?.addEventListener("click", async () => {
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

  $("#btnSave")?.addEventListener("click", async () => {
    try {
      await apiSave();
      setSaveStatus("Sauvegardé ✅");
    } catch (e) {
      if (e.message === "AUTH") idWidget()?.open();
      else alert("Erreur sauvegarde:\n" + e.message);
    }
  });

  $("#budgetFonct")?.addEventListener("input", () => { readBudgets(); renderAll(); scheduleAutosave("budget"); });
  $("#budgetInv")?.addEventListener("input", () => { readBudgets(); renderAll(); scheduleAutosave("budget"); });

  // Export/Import
  $("#btnExportCsv")?.addEventListener("click", exportCsv);
  $("#btnExportJson")?.addEventListener("click", exportJson);

  $("#fileCsv")?.addEventListener("change", (e) => {
    const f = e.target.files?.[0];
    if (f) importCsv(f);
    e.target.value = "";
  });
}

// -------------------- Boot --------------------
async function boot() {
  wireEvents();

  const id = idWidget();
  if (!id) {
    // sans identity, on rend juste l’UI
    updateAuthButtons();
    return;
  }

  // init
  updateAuthButtons();

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
    // on ne purge pas forcément state (mais l’UI est masquée)
  });

  // IMPORTANT : au démarrage, on charge SEULEMENT si déjà connecté
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
