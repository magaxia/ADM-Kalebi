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

// ── Promoções: import do módulo novo (mesmo padrão modular SDK) ───────────────
import {
  createPromotion,
  editPromotion,
  deletePromotion  as deletePromo,
  pausePromotion,
  activatePromotion,
  endPromotion,
  fetchAllPromotions,
  STATUS as PROMO_STATUS,
} from "./vip5-promocoes-storage.js";

console.log("[ADMIN] admin.js carregado.");

const VIP_CODES_COL = "vip5_codes";
const USERS_COL     = "users";
const PAGE_SIZE     = 20;

// ── Estado: Códigos e Usuários (inalterado) ───────────────────────────────────
let allCodes  = [];
let allUsers  = [];
let codesPage = 1;
let usersPage = 1;
let searchTerm = "";

// ── Estado: Promoções ─────────────────────────────────────────────────────────
let allPromos        = [];
let promosPage       = 1;
let promoStatusFilter = "";

// ─── Geração de código aleatório ─────────────────────────────────────────────
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

// ─── Leitura dos dados: Códigos e Usuários ────────────────────────────────────
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

// ─── Leitura dos dados: Promoções ─────────────────────────────────────────────
async function fetchPromotions() {
  console.log("[ADMIN] Buscando vip5_promocoes...");
  const opts   = promoStatusFilter ? { statusFilter: promoStatusFilter, limit: 200 } : { limit: 200 };
  const result = await fetchAllPromotions(opts);
  if (result.success) {
    allPromos = result.data.items;
    console.log("[ADMIN] Promoções carregadas:", allPromos.length);
  } else {
    console.error("[ADMIN] Erro ao buscar promoções:", result.error);
    allPromos = [];
  }
}

// ─── Renderização: Estatísticas ───────────────────────────────────────────────
function renderStats() {
  const total     = allCodes.length;
  const used      = allCodes.filter(c => c.used).length;
  const available = total - used;
  document.getElementById("stat-total").textContent     = total;
  document.getElementById("stat-used").textContent      = used;
  document.getElementById("stat-available").textContent = available;
}

// ─── Renderização: Tabela de Códigos ─────────────────────────────────────────
function renderCodes() {
  const filtered = allCodes.filter(c =>
    !searchTerm || c.code?.toLowerCase().includes(searchTerm)
  );
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  if (codesPage > totalPages) codesPage = totalPages;

  const page  = filtered.slice((codesPage - 1) * PAGE_SIZE, codesPage * PAGE_SIZE);
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

// ─── Renderização: Tabela de Usuários VIP ────────────────────────────────────
function renderUsers() {
  const totalPages = Math.max(1, Math.ceil(allUsers.length / PAGE_SIZE));
  if (usersPage > totalPages) usersPage = totalPages;

  const page  = allUsers.slice((usersPage - 1) * PAGE_SIZE, usersPage * PAGE_SIZE);
  const tbody = document.getElementById("users-tbody");

  if (allUsers.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;color:#555;padding:24px">Nenhum usuário VIP encontrado.</td></tr>`;
    document.getElementById("users-pagination").textContent = "";
    return;
  }

  tbody.innerHTML = page.map(u => {
    const now      = Date.now();
    const expiresAt = u.vip5ExpiresAt;
    const daysLeft  = expiresAt
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

// ─── Renderização: Tabela de Promoções ───────────────────────────────────────
function renderPromotions() {
  const totalPages = Math.max(1, Math.ceil(allPromos.length / PAGE_SIZE));
  if (promosPage > totalPages) promosPage = totalPages;

  const page  = allPromos.slice((promosPage - 1) * PAGE_SIZE, promosPage * PAGE_SIZE);
  const tbody = document.getElementById("promos-tbody");

  if (allPromos.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;color:#555;padding:24px">Nenhuma promoção encontrada.</td></tr>`;
    document.getElementById("promos-pagination").textContent = "";
    return;
  }

  const statusLabel = {
    ativa:      { cls: "badge-ativa",      txt: "Ativa"      },
    pausada:    { cls: "badge-pausada",    txt: "Pausada"    },
    encerrada:  { cls: "badge-encerrada",  txt: "Encerrada"  },
    programada: { cls: "badge-programada", txt: "Programada" },
  };

  const toDate = (v) => {
    if (!v) return null;
    if (typeof v.toDate === "function") return v.toDate();
    return v instanceof Date ? v : new Date(v);
  };

  tbody.innerHTML = page.map(p => {
    const s       = statusLabel[p.status] || { cls: "", txt: p.status };
    const qty     = Number(p.quantidade) || 0;
    const parts   = Number(p.participacoes) || 0;
    const vagas   = qty === 0 ? `${parts} / ∞` : `${parts} / ${qty}`;
    const dataFim = toDate(p.dataFinal);
    const dataStr = dataFim ? fmtDate(dataFim) : "—";

    const btnAtivar  = p.status !== PROMO_STATUS.ATIVA
      ? `<button class="btn-sm btn-reset" onclick="activatePromo('${p.id}')">Ativar</button>`
      : "";
    const btnPausar  = p.status === PROMO_STATUS.ATIVA
      ? `<button class="btn-sm btn-blue" onclick="pausePromo('${p.id}')">Pausar</button>`
      : "";
    const btnEncerrar = (p.status === PROMO_STATUS.ATIVA || p.status === PROMO_STATUS.PAUSADA)
      ? `<button class="btn-sm btn-delete" style="background:#2a1e3a;color:#9b59b6" onclick="endPromo('${p.id}')">Encerrar</button>`
      : "";
    const btnExcluir = `<button class="btn-sm btn-delete" onclick="deletePromoAdmin('${p.id}')">Excluir</button>`;

    return `
      <tr>
        <td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${p.titulo || "—"}</td>
        <td><span class="badge ${s.cls}">${s.txt}</span></td>
        <td class="mono small">${vagas}</td>
        <td class="small">${dataStr}</td>
        <td class="small">${p.limitePorUsuario ?? 1}x/usuário</td>
        <td class="actions">
          ${btnAtivar}${btnPausar}${btnEncerrar}${btnExcluir}
        </td>
      </tr>`;
  }).join("");

  document.getElementById("promos-pagination").textContent =
    `Página ${promosPage} de ${totalPages} — ${allPromos.length} promoção(ões)`;
}

// ─── Timestamp da última atualização ──────────────────────────────────────────
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

// ─── Atualização completa ─────────────────────────────────────────────────────
async function refresh() {
  try {
    await Promise.all([fetchCodes(), fetchUsers(), fetchPromotions()]);
    renderStats();
    renderCodes();
    renderUsers();
    renderPromotions();
    updateLastRefresh();
  } catch (err) {
    console.error("[ADMIN] Erro ao atualizar dados:", err.code, err.message, err);
  }
}

// ─── Atualização manual via botão ─────────────────────────────────────────────
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

// ─── Ações: Códigos ───────────────────────────────────────────────────────────
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

// ─── Ações: Usuários ──────────────────────────────────────────────────────────
window.renewUser = async function (uid, days) {
  if (!confirm(`Renovar +${days} dias para ${uid}?`)) return;
  try {
    const u       = allUsers.find(x => x.uid === uid);
    const base    = (u?.vip5ExpiresAt && u.vip5ExpiresAt > Date.now())
      ? u.vip5ExpiresAt
      : Date.now();
    const newExpires = base + days * 24 * 60 * 60 * 1000;
    console.log("[ADMIN] Renovando VIP uid=" + uid + " +" + days + "d");
    await updateDoc(doc(db, USERS_COL, uid), {
      vip5Active:    true,
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
    await updateDoc(doc(db, USERS_COL, uid), { vip5Active: false });
    await refresh();
  } catch (err) {
    console.error("[ADMIN] Erro ao remover VIP:", err.code, err.message, err);
    alert("Erro ao remover VIP: " + err.message);
  }
};

// ─── Ações: Promoções ─────────────────────────────────────────────────────────
window.activatePromo = async function (id) {
  if (!confirm(`Ativar promoção "${id}"?`)) return;
  const result = await activatePromotion(id, null);
  if (!result.success) { alert("Erro: " + result.error); return; }
  await refresh();
};

window.pausePromo = async function (id) {
  if (!confirm(`Pausar promoção "${id}"?`)) return;
  const result = await pausePromotion(id, null);
  if (!result.success) { alert("Erro: " + result.error); return; }
  await refresh();
};

window.endPromo = async function (id) {
  if (!confirm(`Encerrar promoção "${id}"? Esta ação não pode ser desfeita.`)) return;
  const result = await endPromotion(id, null);
  if (!result.success) { alert("Erro: " + result.error); return; }
  await refresh();
};

window.deletePromoAdmin = async function (id) {
  if (!confirm(`Excluir permanentemente a promoção "${id}"?`)) return;
  const result = await deletePromo(id, null);
  if (!result.success) { alert("Erro: " + result.error); return; }
  await refresh();
};

window.promoFilterChange = function () {
  const sel = document.getElementById("promo-filter-status");
  promoStatusFilter = sel ? sel.value : "";
  promosPage = 1;
  fetchPromotions().then(renderPromotions);
};

// ─── Paginação ────────────────────────────────────────────────────────────────
window.codesPagePrev = () => { if (codesPage > 1) { codesPage--; renderCodes(); } };
window.codesPageNext = () => {
  const filtered = allCodes.filter(c => !searchTerm || c.code?.toLowerCase().includes(searchTerm));
  const total    = Math.ceil(filtered.length / PAGE_SIZE);
  if (codesPage < total) { codesPage++; renderCodes(); }
};
window.usersPagePrev = () => { if (usersPage > 1) { usersPage--; renderUsers(); } };
window.usersPageNext = () => {
  const total = Math.ceil(allUsers.length / PAGE_SIZE);
  if (usersPage < total) { usersPage++; renderUsers(); }
};
window.promosPagePrev = () => { if (promosPage > 1) { promosPage--; renderPromotions(); } };
window.promosPageNext = () => {
  const total = Math.ceil(allPromos.length / PAGE_SIZE);
  if (promosPage < total) { promosPage++; renderPromotions(); }
};

// ─── Exportação ───────────────────────────────────────────────────────────────
window.exportTxt = function () {
  const lines = allCodes.map(c => c.code || c.id).join("\n");
  download("vip5_codes.txt", lines);
};

window.exportJson = function () {
  const data = allCodes.map(c => ({
    code:        c.code || c.id,
    days:        c.days,
    used:        c.used,
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

// ─── Formulário: Gerar Códigos ────────────────────────────────────────────────
async function handleGenerate(e) {
  e.preventDefault();
  const days   = parseInt(document.getElementById("gen-days").value, 10);
  const qty    = parseInt(document.getElementById("gen-qty").value, 10);
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
    const newCodes    = generateUniqueCodes(prefix, qty, existingSet);

    console.log("[ADMIN] Gerando", newCodes.length, "códigos com", days, "dias...");
    await Promise.all(newCodes.map(code =>
      setDoc(doc(db, VIP_CODES_COL, code), {
        code,
        days,
        used:        false,
        activatedBy: null,
        activatedAt: null,
        createdAt:   serverTimestamp()
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
    btn.disabled    = false;
    btn.textContent = "Gerar códigos";
  }
}

// ─── Formulário: Criar Promoção ───────────────────────────────────────────────
async function handleCreatePromo(e) {
  e.preventDefault();

  const titulo    = document.getElementById("promo-titulo").value.trim();
  const qty       = parseInt(document.getElementById("promo-qty").value, 10) || 0;
  const limite    = parseInt(document.getElementById("promo-limite").value, 10) || 1;
  const dataVip   = document.getElementById("promo-data-vip").value;
  const dataPub   = document.getElementById("promo-data-publica").value;
  const dataFim   = document.getElementById("promo-data-final").value;
  const statusSel = document.getElementById("promo-status-sel").value;
  const statusEl  = document.getElementById("promo-status");

  if (!titulo) { alert("Título é obrigatório."); return; }

  const btn = document.getElementById("promo-btn");
  btn.disabled    = true;
  btn.textContent = "Criando...";
  statusEl.textContent = "";

  const payload = {
    titulo,
    quantidade:       qty,
    limitePorUsuario: limite,
    status:           statusSel || "programada",
    dataVip:          dataVip   ? new Date(dataVip)   : null,
    dataPublica:      dataPub   ? new Date(dataPub)   : null,
    dataFinal:        dataFim   ? new Date(dataFim)   : null,
  };

  try {
    const result = await createPromotion(payload, null);
    if (!result.success) throw new Error(result.error);

    console.log("[ADMIN] Promoção criada:", result.data.id);
    statusEl.textContent = `✓ Promoção "${titulo}" criada!`;
    statusEl.style.color = "#27ae60";

    document.getElementById("promo-titulo").value        = "";
    document.getElementById("promo-qty").value           = "0";
    document.getElementById("promo-limite").value        = "1";
    document.getElementById("promo-data-vip").value      = "";
    document.getElementById("promo-data-publica").value  = "";
    document.getElementById("promo-data-final").value    = "";
    document.getElementById("promo-status-sel").value    = "programada";

    await refresh();
  } catch (err) {
    console.error("[ADMIN] Erro ao criar promoção:", err.message, err);
    statusEl.textContent = "Erro: " + err.message;
    statusEl.style.color = "#e74c3c";
  } finally {
    btn.disabled    = false;
    btn.textContent = "Criar promoção";
  }
}

// ─── Utilitário de data ───────────────────────────────────────────────────────
function fmtDate(d) {
  return d.toLocaleString("pt-BR", {
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit"
  });
}

// ─── Inicialização ────────────────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", async () => {
  document.getElementById("gen-form").addEventListener("submit", handleGenerate);
  document.getElementById("promo-form").addEventListener("submit", handleCreatePromo);

  document.getElementById("search-input").addEventListener("input", e => {
    searchTerm = e.target.value.trim().toLowerCase();
    codesPage  = 1;
    renderCodes();
  });

  await refresh();
  console.log("[ADMIN] Dados carregados. Atualize manualmente conforme necessário.");
});
