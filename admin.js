import { db } from "./vip5-firebase.js";
import {
  collection,
  doc,
  getDocs,
  setDoc,
  updateDoc,
  deleteDoc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

console.log("[ADMIN] admin.js carregado.");

const VIP_CODES_COL = "vip5_codes";
const USERS_COL = "users";
const PAGE_SIZE = 20;

let allCodes = [];
let allUsers = [];
let codesPage = 1;
let usersPage = 1;
let searchTerm = "";

// ─── Geração de código aleatório ────────────────────────────────────────────
function randomSegment(len = 8) {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let s = "";
  for (let i = 0; i < len; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

function generateUniqueCodes(prefix, qty, existingSet) {
  const codes = [];
  let attempts = 0;
  while (codes.length < qty && attempts < qty * 10) {
    const code = (prefix + randomSegment(8)).toUpperCase();
    if (!existingSet.has(code) && !codes.includes(code)) codes.push(code);
    attempts++;
  }
  return codes;
}

// ─── Leitura dos dados ───────────────────────────────────────────────────────
async function fetchCodes() {
  console.log("[ADMIN] Buscando vip5_codes...");
  const snap = await getDocs(collection(db, VIP_CODES_COL));
  allCodes = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  console.log("[ADMIN] Códigos carregados:", allCodes.length);
}

async function fetchUsers() {
  console.log("[ADMIN] Buscando users...");
  const snap = await getDocs(collection(db, USERS_COL));
  allUsers = snap.docs
    .map(d => ({ uid: d.id, ...d.data() }))
    .filter(u => u.vip5Code);
  console.log("[ADMIN] Usuários VIP carregados:", allUsers.length);
}

// ─── Renderização: Estatísticas ──────────────────────────────────────────────
function renderStats() {
  const total = allCodes.length;
  const used = allCodes.filter(c => c.used).length;
  const available = total - used;
  document.getElementById("stat-total").textContent = total;
  document.getElementById("stat-used").textContent = used;
  document.getElementById("stat-available").textContent = available;
}

// ─── Renderização: Tabela de Códigos ────────────────────────────────────────
function renderCodes() {
  const filtered = allCodes.filter(c =>
    !searchTerm || c.code?.toLowerCase().includes(searchTerm)
  );
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  if (codesPage > totalPages) codesPage = totalPages;

  const page = filtered.slice((codesPage - 1) * PAGE_SIZE, codesPage * PAGE_SIZE);
  const tbody = document.getElementById("codes-tbody");

  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;color:#555;padding:24px">Nenhum código encontrado.</td></tr>`;
    document.getElementById("codes-pagination").textContent = "";
    return;
  }

  tbody.innerHTML = page.map(c => {
    const activatedAt = c.activatedAt
      ? (c.activatedAt.toDate ? fmtDate(c.activatedAt.toDate()) : fmtDate(new Date(c.activatedAt)))
      : "—";
    const usedBadge = c.used
      ? `<span class="badge badge-used">Usado</span>`
      : `<span class="badge badge-free">Livre</span>`;
    return `
      <tr>
        <td class="mono">${c.code || c.id}</td>
        <td>${c.days ?? "—"}</td>
        <td>${usedBadge}</td>
        <td class="mono small">${c.activatedBy || "—"}</td>
        <td>${activatedAt}</td>
        <td class="actions">
          <button class="btn-sm btn-reset" onclick="resetCode('${c.id}')">Resetar</button>
          <button class="btn-sm btn-delete" onclick="deleteCode('${c.id}')">Excluir</button>
        </td>
      </tr>`;
  }).join("");

  document.getElementById("codes-pagination").textContent =
    `Página ${codesPage} de ${totalPages} — ${filtered.length} código(s)`;
}

// ─── Renderização: Tabela de Usuários VIP ───────────────────────────────────
function renderUsers() {
  const totalPages = Math.max(1, Math.ceil(allUsers.length / PAGE_SIZE));
  if (usersPage > totalPages) usersPage = totalPages;

  const page = allUsers.slice((usersPage - 1) * PAGE_SIZE, usersPage * PAGE_SIZE);
  const tbody = document.getElementById("users-tbody");

  if (allUsers.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;color:#555;padding:24px">Nenhum usuário VIP encontrado.</td></tr>`;
    document.getElementById("users-pagination").textContent = "";
    return;
  }

  tbody.innerHTML = page.map(u => {
    const now = Date.now();
    const expiresAt = u.vip5ExpiresAt;
    const daysLeft = expiresAt
      ? Math.max(0, Math.ceil((expiresAt - now) / (1000 * 60 * 60 * 24)))
      : "—";
    const expiredBadge = expiresAt && now >= expiresAt
      ? `<span class="badge badge-used">Expirado</span>`
      : `<span class="badge badge-free">Ativo</span>`;
    return `
      <tr>
        <td class="mono small">${u.uid}</td>
        <td class="mono">${u.vip5Code || "—"}</td>
        <td>${u.vip5ActivatedAt ? fmtDate(new Date(u.vip5ActivatedAt)) : "—"}</td>
        <td>${expiresAt ? fmtDate(new Date(expiresAt)) : "—"}</td>
        <td>${expiredBadge} ${daysLeft !== "—" ? daysLeft + "d" : ""}</td>
        <td class="actions">
          <button class="btn-sm btn-reset" onclick="renewUser('${u.uid}', 30)">+30d</button>
          <button class="btn-sm btn-reset" onclick="renewUser('${u.uid}', 90)">+90d</button>
          <button class="btn-sm btn-reset" onclick="renewUser('${u.uid}', 365)">+365d</button>
          <button class="btn-sm btn-delete" onclick="removeUserVip('${u.uid}')">Remover</button>
        </td>
      </tr>`;
  }).join("");

  document.getElementById("users-pagination").textContent =
    `Página ${usersPage} de ${totalPages} — ${allUsers.length} usuário(s) VIP`;
}

// ─── Timestamp da última atualização ─────────────────────────────────────────
function updateLastRefresh() {
  const el = document.getElementById("last-update");
  if (!el) return;
  const now = new Date();
  el.textContent = "Atualizado: " + now.toLocaleTimeString("pt-BR", {
    hour: "2-digit", minute: "2-digit", second: "2-digit"
  }) + " — " + now.toLocaleDateString("pt-BR", {
    day: "2-digit", month: "2-digit", year: "numeric"
  });
}

// ─── Atualização completa ────────────────────────────────────────────────────
async function refresh() {
  try {
    await Promise.all([fetchCodes(), fetchUsers()]);
    renderStats();
    renderCodes();
    renderUsers();
    updateLastRefresh();
  } catch (err) {
    console.error("[ADMIN] Erro ao atualizar dados:", err.code, err.message, err);
  }
}

// ─── Atualização manual via botão ────────────────────────────────────────────
window.refreshAdmin = async function () {
  const btn = document.getElementById("btn-refresh");
  if (btn) {
    btn.disabled = true;
    btn.classList.add("loading");
  }
  try {
    await refresh();
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.classList.remove("loading");
    }
  }
};

// ─── Ações: Códigos ──────────────────────────────────────────────────────────
window.resetCode = async function (id) {
  if (!confirm(`Resetar código "${id}"?`)) return;
  try {
    console.log("[ADMIN] Resetando código:", id);
    await updateDoc(doc(db, VIP_CODES_COL, id), {
      used: false,
      activatedBy: null,
      activatedAt: null
    });
    await refresh();
  } catch (err) {
    console.error("[ADMIN] Erro ao resetar:", err.code, err.message, err);
    alert("Erro ao resetar: " + err.message);
  }
};

window.deleteCode = async function (id) {
  if (!confirm(`Excluir código "${id}" permanentemente?`)) return;
  try {
    console.log("[ADMIN] Excluindo código:", id);
    await deleteDoc(doc(db, VIP_CODES_COL, id));
    await refresh();
  } catch (err) {
    console.error("[ADMIN] Erro ao excluir:", err.code, err.message, err);
    alert("Erro ao excluir: " + err.message);
  }
};

// ─── Ações: Usuários ─────────────────────────────────────────────────────────
window.renewUser = async function (uid, days) {
  if (!confirm(`Renovar +${days} dias para ${uid}?`)) return;
  try {
    const u = allUsers.find(x => x.uid === uid);
    const base = (u?.vip5ExpiresAt && u.vip5ExpiresAt > Date.now())
      ? u.vip5ExpiresAt
      : Date.now();
    const newExpires = base + days * 24 * 60 * 60 * 1000;
    console.log("[ADMIN] Renovando VIP uid=" + uid + " +" + days + "d");
    await updateDoc(doc(db, USERS_COL, uid), {
      vip5Active: true,
      vip5ExpiresAt: newExpires
    });
    await refresh();
  } catch (err) {
    console.error("[ADMIN] Erro ao renovar:", err.code, err.message, err);
    alert("Erro ao renovar: " + err.message);
  }
};

window.removeUserVip = async function (uid) {
  if (!confirm(`Remover VIP do usuário ${uid}?`)) return;
  try {
    console.log("[ADMIN] Removendo VIP uid=" + uid);
    await updateDoc(doc(db, USERS_COL, uid), {
      vip5Active: false
    });
    await refresh();
  } catch (err) {
    console.error("[ADMIN] Erro ao remover VIP:", err.code, err.message, err);
    alert("Erro ao remover VIP: " + err.message);
  }
};

// ─── Paginação ───────────────────────────────────────────────────────────────
window.codesPagePrev = () => { if (codesPage > 1) { codesPage--; renderCodes(); } };
window.codesPageNext = () => {
  const filtered = allCodes.filter(c => !searchTerm || c.code?.toLowerCase().includes(searchTerm));
  const total = Math.ceil(filtered.length / PAGE_SIZE);
  if (codesPage < total) { codesPage++; renderCodes(); }
};
window.usersPagePrev = () => { if (usersPage > 1) { usersPage--; renderUsers(); } };
window.usersPageNext = () => {
  const total = Math.ceil(allUsers.length / PAGE_SIZE);
  if (usersPage < total) { usersPage++; renderUsers(); }
};

// ─── Exportação ──────────────────────────────────────────────────────────────
window.exportTxt = function () {
  const lines = allCodes.map(c => c.code || c.id).join("\n");
  download("vip5_codes.txt", lines);
};

window.exportJson = function () {
  const data = allCodes.map(c => ({
    code: c.code || c.id,
    days: c.days,
    used: c.used,
    activatedBy: c.activatedBy || null,
    activatedAt: c.activatedAt || null
  }));
  download("vip5_codes.json", JSON.stringify(data, null, 2));
};

function download(filename, content) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([content], { type: "text/plain" }));
  a.download = filename;
  a.click();
}

// ─── Formulário de geração ───────────────────────────────────────────────────
async function handleGenerate(e) {
  e.preventDefault();
  const days = parseInt(document.getElementById("gen-days").value, 10);
  const qty = parseInt(document.getElementById("gen-qty").value, 10);
  const prefix = document.getElementById("gen-prefix").value.trim().toUpperCase();
  const status = document.getElementById("gen-status");

  if (!days || days < 1) { alert("Informe a quantidade de dias."); return; }
  if (!qty || qty < 1 || qty > 500) { alert("Quantidade deve ser entre 1 e 500."); return; }

  const btn = document.getElementById("gen-btn");
  btn.disabled = true;
  btn.textContent = "Gerando...";
  status.textContent = "";

  try {
    const existingSet = new Set(allCodes.map(c => c.code || c.id));
    const newCodes = generateUniqueCodes(prefix, qty, existingSet);

    console.log("[ADMIN] Gerando", newCodes.length, "códigos com", days, "dias...");
    await Promise.all(newCodes.map(code =>
      setDoc(doc(db, VIP_CODES_COL, code), {
        code,
        days,
        used: false,
        activatedBy: null,
        activatedAt: null,
        createdAt: serverTimestamp()
      })
    ));

    console.log("[ADMIN] Códigos gerados com sucesso:", newCodes);
    status.textContent = `✓ ${newCodes.length} código(s) gerado(s)!`;
    status.style.color = "#27ae60";
    await refresh();
  } catch (err) {
    console.error("[ADMIN] Erro ao gerar códigos:", err.code, err.message, err);
    status.textContent = "Erro: " + err.message;
    status.style.color = "#e74c3c";
  } finally {
    btn.disabled = false;
    btn.textContent = "Gerar códigos";
  }
}

// ─── Inicialização ───────────────────────────────────────────────────────────
function fmtDate(d) {
  return d.toLocaleString("pt-BR", {
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit"
  });
}

document.addEventListener("DOMContentLoaded", async () => {
  document.getElementById("gen-form").addEventListener("submit", handleGenerate);

  document.getElementById("search-input").addEventListener("input", e => {
    searchTerm = e.target.value.trim().toLowerCase();
    codesPage = 1;
    renderCodes();
  });

  await refresh();
  console.log("[ADMIN] Dados carregados. Atualize manualmente conforme necessário.");
});
