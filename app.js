const API = "/api/data";

function getUser() {
  return window.netlifyIdentity && window.netlifyIdentity.currentUser
    ? window.netlifyIdentity.currentUser()
    : null;
}

async function authHeaders() {
  const user = getUser();
  if (!user) return {};
  const token = await user.jwt(); // JWT Netlify Identity
  return { Authorization: `Bearer ${token}` };
}


async function authHeaders() {
  const user = window.netlifyIdentity?.currentUser();
  if (!user) return {};
  const token = await user.jwt(); // JWT Netlify Identity
  return { Authorization: `Bearer ${token}` };
}


let state = {
  budgets: { Fonctionnement: 0, Investissement: 0 },
  expenses: []
};

let charts = {};

const $ = (sel) => document.querySelector(sel);

function euro(n){ return (Number(n)||0).toLocaleString("fr-FR",{style:"currency",currency:"EUR"}); }
function uid(){ return crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2); }

function requireAuthUI(){
  const user = window.netlifyIdentity?.currentUser();
  $("#btnLogin").style.display = user ? "none" : "inline-flex";
  $("#btnLogout").style.display = user ? "inline-flex" : "none";
}

async function apiGet() {
  const headers = await authHeaders();

  const res = await fetch(API, {
    method: "GET",
    headers
  });

  const text = await res.text(); // on lit toujours la réponse pour debug
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


function setSaveStatus(msg){
  $("#saveStatus").textContent = msg || "";
  if (msg) setTimeout(()=>($("#saveStatus").textContent=""), 2500);
}

function readBudgetsFromInputs(){
  state.budgets.Fonctionnement = Number($("#budgetFonct").value || 0);
  state.budgets.Investissement = Number($("#budgetInv").value || 0);
}

function renderBudgets(){
  $("#budgetFonct").value = state.budgets.Fonctionnement ?? 0;
  $("#budgetInv").value = state.budgets.Investissement ?? 0;
}

function filteredExpenses(){
  const q = ($("#q").value || "").trim().toLowerCase();
  const s = $("#filterStatus").value;
  const e = $("#filterEnvelope").value;
  const t = $("#filterType").value;

  return state.expenses
    .filter(x => !q || (x.label+" "+(x.project||"")).toLowerCase().includes(q))
    .filter(x => !s || x.status === s)
    .filter(x => !e || x.envelope === e)
    .filter(x => !t || x.type === t)
    .sort((a,b)=> (a.date||"").localeCompare(b.date||""));
}

function renderTable(){
  const rows = filteredExpenses().map(x => `
    <tr data-id="${x.id}">
      <td>${x.date || ""}</td>
      <td>${escapeHtml(x.label || "")}</td>
      <td>${escapeHtml(x.type || "")}</td>
      <td>${escapeHtml(x.envelope || "")}</td>
      <td>${escapeHtml(x.project || "")}</td>
      <td>${escapeHtml(x.status || "")}</td>
      <td class="right">${euro(x.amount)}</td>
      <td><button class="btn btn-ghost btnDel">Suppr.</button></td>
    </tr>
  `).join("");

  $("#tbody").innerHTML = rows || `<tr><td colspan="8" class="muted">Aucune dépense</td></tr>`;

  // Totaux
  const all = state.expenses;
  const sum = (arr) => arr.reduce((acc,x)=>acc+(Number(x.amount)||0),0);

  const byStatus = {
    "Votée": sum(all.filter(x=>x.status==="Votée")),
    "Engagée": sum(all.filter(x=>x.status==="Engagée")),
    "Service fait": sum(all.filter(x=>x.status==="Service fait"))
  };

  const byEnvelope = {
    "Fonctionnement": sum(all.filter(x=>x.envelope==="Fonctionnement")),
    "Investissement": sum(all.filter(x=>x.envelope==="Investissement"))
  };

  const resteFonct = (state.budgets.Fonctionnement||0) - byEnvelope.Fonctionnement;
  const resteInv = (state.budgets.Investissement||0) - byEnvelope.Investissement;

  $("#totals").innerHTML = `
    <div><b>Total</b> : ${euro(sum(all))}</div>
    <div>Par statut — Votée: ${euro(byStatus["Votée"])} • Engagée: ${euro(byStatus["Engagée"])} • Service fait: ${euro(byStatus["Service fait"])}</div>
    <div>Reste budgets — Fonctionnement: ${euro(resteFonct)} • Investissement: ${euro(resteInv)}</div>
  `;
}

function escapeHtml(s){
  return String(s).replace(/[&<>"']/g, (c)=>({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c]));
}

function buildStats(){
  const all = state.expenses;
  const sum = (arr) => arr.reduce((acc,x)=>acc+(Number(x.amount)||0),0);

  const statusLabels = ["Votée","Engagée","Service fait"];
  const statusData = statusLabels.map(st => sum(all.filter(x=>x.status===st)));

  const envLabels = ["Fonctionnement","Investissement"];
  const envData = envLabels.map(en => sum(all.filter(x=>x.envelope===en)));

  // Type
  const typeMap = new Map();
  for (const x of all){
    const k = x.type || "Autre";
    typeMap.set(k, (typeMap.get(k)||0) + (Number(x.amount)||0));
  }
  const typeEntries = [...typeMap.entries()].sort((a,b)=>b[1]-a[1]);
  const typeLabels = typeEntries.map(([k])=>k);
  const typeData = typeEntries.map(([,v])=>v);

  // Mensuel (service fait)
  const m = new Map();
  for (const x of all.filter(x=>x.status==="Service fait")){
    const ym = (x.date||"").slice(0,7); // YYYY-MM
    if (!ym) continue;
    m.set(ym, (m.get(ym)||0) + (Number(x.amount)||0));
  }
  const months = [...m.keys()].sort();
  const monthlyData = months.map(k=>m.get(k));

  return { statusLabels, statusData, envLabels, envData, typeLabels, typeData, months, monthlyData };
}

function renderCharts(){
  const s = buildStats();

  // destroy previous
  for (const k of Object.keys(charts)){
    charts[k]?.destroy?.();
  }
  charts = {};

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
    options: { plugins: { legend: { display:false } } }
  });

  charts.month = new Chart($("#chartMonthly"), {
    type: "line",
    data: { labels: s.months, datasets: [{ data: s.monthlyData }] },
    options: { plugins: { legend: { display:false } } }
  });
}

function exportCsv(){
  const headers = ["id","date","label","type","envelope","project","status","amount"];
  const lines = [headers.join(",")];

  for (const x of state.expenses){
    const row = headers.map(h => csvCell(x[h]));
    lines.push(row.join(","));
  }
  download("budget-labo.csv", lines.join("\n"), "text/csv;charset=utf-8");
}

function csvCell(v){
  const s = (v ?? "").toString();
  if (/[,"\n;]/.test(s)) return `"${s.replace(/"/g,'""')}"`;
  return s;
}

function download(filename, content, mime){
  const blob = new Blob([content], { type: mime || "text/plain" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(()=>URL.revokeObjectURL(a.href), 1000);
}

function exportJson(){
  download("budget-labo.json", JSON.stringify(state, null, 2), "application/json;charset=utf-8");
}

function parseCsv(text){
  // Parser simple (CSV standard avec guillemets)
  const rows = [];
  let i = 0, field = "", row = [], inQuotes = false;

  while (i < text.length){
    const c = text[i];
    const next = text[i+1];

    if (inQuotes){
      if (c === '"' && next === '"'){ field += '"'; i += 2; continue; }
      if (c === '"'){ inQuotes = false; i++; continue; }
      field += c; i++; continue;
    } else {
      if (c === '"'){ inQuotes = true; i++; continue; }
      if (c === ','){ row.push(field); field=""; i++; continue; }
      if (c === '\n' || c === '\r'){
        if (c === '\r' && next === '\n') i++;
        row.push(field); field="";
        if (row.some(x=>x.length>0)) rows.push(row);
        row = [];
        i++; continue;
      }
      field += c; i++; continue;
    }
  }
  row.push(field);
  if (row.some(x=>x.length>0)) rows.push(row);
  return rows;
}

function importCsv(file){
  const reader = new FileReader();
  reader.onload = () => {
    const rows = parseCsv(String(reader.result || ""));
    if (!rows.length) return;

    const headers = rows[0].map(h=>h.trim());
    const idx = (name) => headers.indexOf(name);

    const required = ["date","label","type","envelope","status","amount"];
    for (const r of required){
      if (idx(r) === -1){
        alert(`CSV invalide : colonne manquante "${r}"`);
        return;
      }
    }

    const nextExpenses = [];
    for (const r of rows.slice(1)){
      const obj = {
        id: r[idx("id")] || uid(),
        date: r[idx("date")] || "",
        label: r[idx("label")] || "",
        type: r[idx("type")] || "Autre",
        envelope: r[idx("envelope")] || "Fonctionnement",
        project: idx("project") !== -1 ? (r[idx("project")] || "") : "",
        status: r[idx("status")] || "Votée",
        amount: Number((r[idx("amount")]||"").replace(",", ".")) || 0
      };
      // filtre lignes vides
      if (obj.label || obj.amount) nextExpenses.push(obj);
    }

    state.expenses = nextExpenses;
    renderAll();
  };
  reader.readAsText(file, "utf-8");
}

function wireEvents(){
  $("#btnLogin").addEventListener("click", () => window.netlifyIdentity?.open());
  $("#btnLogout").addEventListener("click", async () => {
    await window.netlifyIdentity?.logout();
    requireAuthUI();
  });

  $("#expenseForm").addEventListener("submit", (e) => {
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

  $("#tbody").addEventListener("click", (e) => {
    const btn = e.target.closest(".btnDel");
    if (!btn) return;
    const tr = e.target.closest("tr");
    const id = tr?.getAttribute("data-id");
    state.expenses = state.expenses.filter(x=>x.id !== id);
    renderAll();
  });

  ["#q","#filterStatus","#filterEnvelope","#filterType"].forEach(sel => {
    $(sel).addEventListener("input", () => renderTable());
    $(sel).addEventListener("change", () => renderTable());
  });

  $("#btnSaveBudgets").addEventListener("click", async () => {
    try{
      readBudgetsFromInputs();
      await apiSave();
      setSaveStatus("Budgets enregistrés ✅");
      renderAll();
    } catch(err){
      if (String(err.message) === "AUTH") window.netlifyIdentity?.open();
      else alert("Erreur : " + err.message);
    }
  });

  $("#btnSave").addEventListener("click", async () => {
    try{
      await apiSave();
      setSaveStatus("Sauvegardé ✅");
    } catch(err){
      if (String(err.message) === "AUTH") window.netlifyIdentity?.open();
      else alert("Erreur : " + err.message);
    }
  });

  $("#btnExportCsv").addEventListener("click", exportCsv);
  $("#btnExportJson").addEventListener("click", exportJson);

  $("#fileCsv").addEventListener("change", (e) => {
    const f = e.target.files?.[0];
    if (f) importCsv(f);
    e.target.value = "";
  });
}

function renderAll(){
  renderBudgets();
  renderTable();
  renderCharts();
}

async function bootstrap(){
  wireEvents();

  // Init Netlify Identity
  window.netlifyIdentity?.on("init", requireAuthUI);
  window.netlifyIdentity?.on("login", async () => {
    requireAuthUI();
    try{
      const data = await apiGet();
      state = normalize(data);
      renderAll();
      window.netlifyIdentity.close();
    } catch(e){
      alert("Connexion OK, mais impossible de charger les données.");
    }
  });
  window.netlifyIdentity?.on("logout", () => {
    requireAuthUI();
    // Option : on garde l’UI visible mais les sauvegardes échoueront sans login
  });

  requireAuthUI();

  // Si déjà connecté : charger
  try{
    const user = window.netlifyIdentity?.currentUser();
    if (user){
      const data = await apiGet();
      state = normalize(data);
      renderAll();
    } else {
      // UI vide par défaut
      renderAll();
    }
  } catch(e){
    // si pas connecté, on affiche quand même l’UI
    renderAll();
  }
}

function normalize(data){
  const budgets = data?.budgets || { Fonctionnement: 0, Investissement: 0 };
  const expenses = Array.isArray(data?.expenses) ? data.expenses : [];
  return { budgets, expenses };
}

bootstrap();
