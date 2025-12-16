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
  const budgets = data?.budgets || { Fonctionnement: 0, Investissement: 0 };
  const expenses = Array.isArray(data?.expenses) ? data.expenses : [];

  // compat V1/V2 -> garantir champs
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
  $("#budgetFonct").value = state.budgets.Fonctionnement ?? 0;
  $("#budgetInv").value = state.budgets.Investissement ?? 0;
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
  const q = ($("#q").value || "").trim().toLowerCase();
  const owner = ($("#filterOwner")?.value || "").trim();
  const s = $("#filterStatus").value || "";
  const e = $("#filterEnvelope").value || "";
  const t = $("#filterType").value || "";

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
          <b>${escapeHtml(it.kind)}<
