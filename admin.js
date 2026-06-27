import { db } from "./vip5-firebase.js";
import { getApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  collection,
  doc,
  getDocs,
  setDoc,
  updateDoc,
  deleteDoc,
  serverTimestamp,
  onSnapshot,
  query,
  orderBy,
  limit,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import {
  getStorage,
  ref as storageRef,
  uploadBytes,
  getDownloadURL,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js";

const storage = getStorage(getApp());

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

import {
  createSorteio,
  editSorteio,
  deleteSorteio,
  duplicateSorteio,
  pauseSorteio,
  activateSorteio,
  endSorteio,
  fetchAllSorteios,
} from "./vip5-sorteios-storage.js";

console.log("[ADMIN] admin.js carregado.");

const VIP_CODES_COL = "vip5_codes";
const USERS_COL     = "users";
const VIP_SORTEIOS_COL = "vip5_sorteios";
const VIP_SORTEIO_PARTICIPANTS = "participantes";
const PAGE_SIZE     = 20;
const SORTEIOS_PAGE_SIZE = 12;
const PARTICIPANTS_PAGE_SIZE = 100;

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

// ── Estado: Sorteios VIP ──────────────────────────────────────────────────────
let allSorteios = [];
let sorteiosPage = 1;
let sorteioFilterStatus = "";
let sorteioFilterVip = "";
let sorteioSort = "createdAt_desc";
let sorteioSearch = "";
let selectedSorteioId = null;
let selectedSorteio = null;
let selectedSorteioUnsubscribe = null;
let participantsUnsubscribe = null;
let selectedImageFile = null;
let selectedImagePreviewUrl = null;
let currentParticipants = [];
let selectedSorteioWinner = null;

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

function _formatDateValue(value) {
  if (!value) return "—";
  const date = typeof value.toDate === "function"
    ? value.toDate()
    : (value instanceof Date ? value : new Date(value));
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    return "—";
  }
  return date.toLocaleString("pt-BR", {
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit"
  });
}

function _formatDateShort(value) {
  if (!value) return "—";
  const date = typeof value.toDate === "function"
    ? value.toDate()
    : (value instanceof Date ? value : new Date(value));
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    return "—";
  }
  return date.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function _filterSorteios(items) {
  return items.filter((item) => {
    if (!item) return false;
    if (sorteioSearch) {
      const needle = sorteioSearch.trim().toLowerCase();
      const title = String(item.titulo || "").toLowerCase();
      const id = String(item.id || "").toLowerCase();
      if (!title.includes(needle) && !id.includes(needle)) {
        return false;
      }
    }
    if (sorteioFilterStatus && item.status !== sorteioFilterStatus) {
      return false;
    }
    if (sorteioFilterVip) {
      const hasVip = Boolean(item.dataVip);
      if (sorteioFilterVip === "com-vip" && !hasVip) {
        return false;
      }
      if (sorteioFilterVip === "sem-vip" && hasVip) {
        return false;
      }
    }
    return true;
  });
}

function _sortSorteios(items) {
  return items.slice().sort((a, b) => {
    if (!a || !b) return 0;
    const aCreated = _timestampToMillis(a.createdAt);
    const bCreated = _timestampToMillis(b.createdAt);
    const aFinal = _timestampToMillis(a.dataFinal);
    const bFinal = _timestampToMillis(b.dataFinal);

    switch (sorteioSort) {
      case "createdAt_asc":
        return aCreated - bCreated;
      case "createdAt_desc":
        return bCreated - aCreated;
      case "dataFinal_asc":
        return aFinal - bFinal;
      case "dataFinal_desc":
        return bFinal - aFinal;
      default:
        return bCreated - aCreated;
    }
  });
}

function _toNonNegativeInteger(value, fallback = 0) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) {
    return fallback;
  }
  return Math.floor(number);
}

function _timestampToMillis(value) {
  if (!value) {
    return 0;
  }
  if (typeof value.toMillis === "function") {
    return value.toMillis();
  }
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date.getTime() : 0;
}

function renderSorteioStats() {
  const total = allSorteios.length;
  const active = allSorteios.filter(s => s?.status === "ativa").length;
  const participants = allSorteios.reduce((sum, s) => sum + _toNonNegativeInteger(s?.participacoesCount, 0), 0);
  const winners = allSorteios.filter(s => s?.status === "encerrada").length;

  document.getElementById("stat-sorteios-total").textContent = total;
  document.getElementById("stat-sorteios-active").textContent = active;
  document.getElementById("stat-sorteios-participants").textContent = participants;
  document.getElementById("stat-sorteios-winners").textContent = winners;
}

function showToast(message, type = "info", duration = 4000) {
  const container = document.getElementById("toast-container");
  if (!container) return;
  const toast = document.createElement("div");
  toast.textContent = message;
  toast.style.cssText = `
    margin: 8px 0;
    padding: 12px 16px;
    border-radius: 8px;
    color: #ffffff;
    font-size: 0.95rem;
    box-shadow: 0 8px 20px rgba(0,0,0,0.14);
    opacity: 0;
    transition: opacity 0.2s ease-in-out;
    max-width: 320px;
    word-break: break-word;
  `;
  if (type === "success") {
    toast.style.background = "#16a34a";
  } else if (type === "error") {
    toast.style.background = "#dc2626";
  } else if (type === "warn") {
    toast.style.background = "#d97706";
  } else {
    toast.style.background = "#0ea5e9";
  }
  container.appendChild(toast);
  requestAnimationFrame(() => {
    toast.style.opacity = "1";
  });
  setTimeout(() => {
    toast.style.opacity = "0";
    setTimeout(() => toast.remove(), 300);
  }, duration);
}

function _renderSorteioDates(sorteio) {
  const vip = sorteio?.dataVip ? _formatDateShort(sorteio.dataVip) : "—";
  const pub = sorteio?.dataPublica ? _formatDateShort(sorteio.dataPublica) : "—";
  const end = sorteio?.dataFinal ? _formatDateShort(sorteio.dataFinal) : "—";
  return `VIP: ${vip} · Pública: ${pub} · Fim: ${end}`;
}

function renderSorteios() {
  const filtered = _sortSorteios(_filterSorteios(allSorteios));
  const totalPages = Math.max(1, Math.ceil(filtered.length / SORTEIOS_PAGE_SIZE));
  if (sorteiosPage > totalPages) sorteiosPage = totalPages;
  const page = filtered.slice((sorteiosPage - 1) * SORTEIOS_PAGE_SIZE, sorteiosPage * SORTEIOS_PAGE_SIZE);
  const tbody = document.getElementById("sorteios-tbody");

  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;color:#555;padding:24px">Nenhum sorteio encontrado.</td></tr>`;
    document.getElementById("sorteios-pagination").textContent = "";
    renderSorteioStats();
    return;
  }

  tbody.innerHTML = page.map((sorteio) => {
    const created = _formatDateShort(sorteio.createdAt);
    const statusLabel = {
      ativa:      { cls: "badge-ativa",      txt: "Ativa"      },
      pausada:    { cls: "badge-pausada",    txt: "Pausada"    },
      encerrada:  { cls: "badge-encerrada",  txt: "Encerrada"  },
      programada: { cls: "badge-programada", txt: "Programada" },
    }[sorteio.status] || { cls: "", txt: sorteio.status || "—" };

    const participantsCount = _toNonNegativeInteger(sorteio.participacoesCount, 0);
    const winner = selectedSorteioId === sorteio.id && selectedSorteioWinner ? selectedSorteioWinner.uid || selectedSorteioWinner.id : "—";
    const btnActivate = sorteio.status !== "ativa" ? `<button class="btn-sm btn-reset" onclick="activateSorteioAdmin('${sorteio.id}')">Ativar</button>` : "";
    const btnPause = sorteio.status === "ativa" ? `<button class="btn-sm btn-blue" onclick="pauseSorteioAdmin('${sorteio.id}')">Pausar</button>` : "";
    const btnEnd = (sorteio.status === "ativa" || sorteio.status === "pausada") ? `<button class="btn-sm btn-delete" onclick="endSorteioAdmin('${sorteio.id}')">Encerrar</button>` : "";
    const btnEdit = `<button class="btn-sm btn-outline" onclick="loadSorteioForEdit('${sorteio.id}')">Editar</button>`;
    const btnDuplicate = `<button class="btn-sm btn-reset" onclick="duplicateSorteioAdmin('${sorteio.id}')">Duplicar</button>`;
    const btnDelete = `<button class="btn-sm btn-delete" onclick="deleteSorteioAdmin('${sorteio.id}')">Excluir</button>`;
    const btnSelect = `<button class="btn-sm btn-primary" onclick="selectSorteio('${sorteio.id}')">Visualizar</button>`;

    return `
      <tr${selectedSorteioId === sorteio.id ? " class=\"selected\"" : ""}>
        <td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${sorteio.titulo || "(Sem título)"}</td>
        <td><span class="badge ${statusLabel.cls}">${statusLabel.txt}</span></td>
        <td class="mono small">${participantsCount}</td>
        <td class="mono small">${winner}</td>
        <td class="small">${sorteio.dataVip ? _formatDateShort(sorteio.dataVip) : "—"}</td>
        <td class="small">${created}</td>
        <td class="actions">${btnSelect}${btnEdit}${btnActivate}${btnPause}${btnEnd}${btnDuplicate}${btnDelete}</td>
      </tr>`;
  }).join("");

  document.getElementById("sorteios-pagination").textContent =
    `Página ${sorteiosPage} de ${totalPages} — ${filtered.length} resultado(s)`;
  renderSorteioStats();
}

function renderSorteioDetails() {
  const titleEl = document.getElementById("sorteio-detail-title");
  const statusEl = document.getElementById("detail-status");
  const participantsEl = document.getElementById("detail-participants");
  const winnerEl = document.getElementById("detail-winner");
  const datesEl = document.getElementById("detail-dates");

  const detailGrid = document.getElementById("sorteio-detail-grid");
  if (!selectedSorteio) {
    if (titleEl) titleEl.textContent = "Selecione um sorteio para visualizar detalhes";
    if (statusEl) statusEl.textContent = "—";
    if (participantsEl) participantsEl.textContent = "—";
    if (winnerEl) winnerEl.textContent = "—";
    if (datesEl) datesEl.textContent = "—";
    if (detailGrid) detailGrid.style.display = "none";
    return;
  }

  if (detailGrid) detailGrid.style.display = "grid";
  if (titleEl) titleEl.textContent = selectedSorteio.titulo || "Sorteio selecionado";
  if (statusEl) statusEl.textContent = selectedSorteio.status || "—";
  if (participantsEl) participantsEl.textContent = _toNonNegativeInteger(selectedSorteio.participacoesCount, 0);
  if (winnerEl) winnerEl.textContent = selectedSorteioWinner ? (selectedSorteioWinner.uid || selectedSorteioWinner.id || "—") : "Ainda não sorteado";
  if (datesEl) datesEl.textContent = _renderSorteioDates(selectedSorteio);
}

function renderParticipants() {
  const tbody = document.getElementById("sorteio-participants-tbody");
  if (!selectedSorteio) {
    tbody.innerHTML = `<tr><td colspan="4" style="text-align:center;color:#555;padding:24px">Selecione um sorteio para ver participantes.</td></tr>`;
    return;
  }

  if (!currentParticipants || currentParticipants.length === 0) {
    tbody.innerHTML = `<tr><td colspan="4" style="text-align:center;color:#555;padding:24px">Nenhum participante encontrado para este sorteio.</td></tr>`;
    return;
  }

  tbody.innerHTML = currentParticipants.map((participant) => {
    const createdAt = participant.lastParticipationAt || participant.createdAt;
    return `
      <tr>
        <td class="mono small">${participant.uid || participant.id || "—"}</td>
        <td>${_toNonNegativeInteger(participant.count, 0)}</td>
        <td>${participant.status || "—"}</td>
        <td>${_formatDateValue(createdAt)}</td>
      </tr>`;
  }).join("");
}

function _unsubscribeSorteioListeners() {
  if (selectedSorteioUnsubscribe) {
    selectedSorteioUnsubscribe();
    selectedSorteioUnsubscribe = null;
  }
  if (participantsUnsubscribe) {
    participantsUnsubscribe();
    participantsUnsubscribe = null;
  }
}

function subscribeSorteioRealtime(id) {
  _unsubscribeSorteioListeners();
  const sorteioRef = doc(db, VIP_SORTEIOS_COL, id);
  selectedSorteioUnsubscribe = onSnapshot(sorteioRef, (snapshot) => {
    if (!snapshot.exists()) {
      selectedSorteio = null;
      currentParticipants = [];
      renderSorteioDetails();
      renderParticipants();
      return;
    }
    selectedSorteio = { id: snapshot.id, ...snapshot.data() };
    renderSorteioDetails();
  }, (error) => {
    console.error("[ADMIN] Erro no realtime do sorteio:", error);
    showToast("Erro ao ouvir atualizações do sorteio.", "error");
  });

  const participantsCollection = collection(doc(db, VIP_SORTEIOS_COL, id), VIP_SORTEIO_PARTICIPANTS);
  const participantsQuery = query(participantsCollection, orderBy("createdAt", "desc"), limit(PARTICIPANTS_PAGE_SIZE));
  participantsUnsubscribe = onSnapshot(participantsQuery, (snapshot) => {
    currentParticipants = snapshot.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }));
    renderParticipants();
  }, (error) => {
    console.error("[ADMIN] Erro no realtime de participantes:", error);
    showToast("Erro ao ouvir participantes em tempo real.", "error");
  });
}

function selectSorteio(id) {
  selectedSorteioId = id;
  selectedSorteioWinner = null;
  renderSorteios();
  subscribeSorteioRealtime(id);
}

function loadSorteioForm(sorteio = null) {
  selectedImageFile = null;
  selectedImagePreviewUrl = null;
  selectedSorteioWinner = null;
  if (sorteio) {
    selectedSorteioId = sorteio.id;
    selectedSorteio = sorteio;
    document.getElementById("sorteio-form-title").textContent = "Editar sorteio VIP";
    document.getElementById("sorteio-titulo").value = sorteio.titulo || "";
    document.getElementById("sorteio-qty").value = _toNonNegativeInteger(sorteio.quantidade, 0);
    document.getElementById("sorteio-limite").value = _toNonNegativeInteger(sorteio.limitePorUsuario, 1);
    document.getElementById("sorteio-status-sel").value = sorteio.status || "programada";
    document.getElementById("sorteio-data-vip").value = sorteio.dataVip ? new Date(sorteio.dataVip.toDate ? sorteio.dataVip.toDate() : sorteio.dataVip).toISOString().slice(0, 16) : "";
    document.getElementById("sorteio-data-publica").value = sorteio.dataPublica ? new Date(sorteio.dataPublica.toDate ? sorteio.dataPublica.toDate() : sorteio.dataPublica).toISOString().slice(0, 16) : "";
    document.getElementById("sorteio-data-final").value = sorteio.dataFinal ? new Date(sorteio.dataFinal.toDate ? sorteio.dataFinal.toDate() : sorteio.dataFinal).toISOString().slice(0, 16) : "";
    document.getElementById("sorteio-tipo").value = sorteio.tipoSorteio || "";
    document.getElementById("sorteio-descricao").value = sorteio.descricao || "";
    if (sorteio.imagem) {
      const preview = document.getElementById("sorteio-image-preview");
      preview.src = sorteio.imagem;
      preview.classList.remove("hidden");
      selectedImagePreviewUrl = sorteio.imagem;
    }
    document.getElementById("sorteio-submit-btn").textContent = "Salvar alterações";
  } else {
    selectedSorteioId = null;
    selectedSorteio = null;
    document.getElementById("sorteio-form-title").textContent = "Novo sorteio VIP";
    document.getElementById("sorteio-titulo").value = "";
    document.getElementById("sorteio-qty").value = "0";
    document.getElementById("sorteio-limite").value = "1";
    document.getElementById("sorteio-status-sel").value = "programada";
    document.getElementById("sorteio-data-vip").value = "";
    document.getElementById("sorteio-data-publica").value = "";
    document.getElementById("sorteio-data-final").value = "";
    document.getElementById("sorteio-tipo").value = "";
    document.getElementById("sorteio-descricao").value = "";
    const preview = document.getElementById("sorteio-image-preview");
    preview.src = "";
    preview.classList.add("hidden");
    document.getElementById("sorteio-form-status").textContent = "";
    document.getElementById("sorteio-submit-btn").textContent = "Salvar sorteio";
  }
}

function setSorteioImagePreview(file) {
  const preview = document.getElementById("sorteio-image-preview");
  if (!preview) return;
  if (!file) {
    preview.src = "";
    preview.classList.add("hidden");
    return;
  }
  selectedImagePreviewUrl = URL.createObjectURL(file);
  preview.src = selectedImagePreviewUrl;
  preview.classList.remove("hidden");
}

async function uploadSorteioImage(file) {
  if (!file) return null;
  try {
    const fileName = file.name.replace(/[^a-zA-Z0-9.-]/g, "_");
    const path = `vip5_sorteios/${Date.now()}_${fileName}`;
    const ref = storageRef(storage, path);
    await uploadBytes(ref, file);
    return await getDownloadURL(ref);
  } catch (error) {
    console.error("[ADMIN] Erro ao enviar imagem:", error);
    throw new Error("Falha ao enviar imagem. Tente novamente.");
  }
}

async function refreshSorteios() {
  const status = sorteioFilterStatus || null;
  try {
    const result = await fetchAllSorteios({ statusFilter: status, limit: 200 });
    if (!result.success) {
      throw new Error(result.error || "Erro ao buscar sorteios.");
    }
    allSorteios = result.data.items || [];
    renderSorteios();
  } catch (err) {
    console.error("[ADMIN] Erro ao atualizar sorteios:", err.message, err);
    showToast("Erro ao carregar sorteios: " + err.message, "error");
  }
}

window.sorteioFilterChange = function () {
  const statusSel = document.getElementById("sorteio-filter-status");
  const vipSel = document.getElementById("sorteio-filter-vip");
  const sortSel = document.getElementById("sorteio-sort");
  sorteioFilterStatus = statusSel ? statusSel.value : "";
  sorteioFilterVip = vipSel ? vipSel.value : "";
  sorteioSort = sortSel ? sortSel.value : "createdAt_desc";
  sorteiosPage = 1;
  renderSorteios();
};

window.sorteiosPagePrev = function () {
  if (sorteiosPage > 1) {
    sorteiosPage--;
    renderSorteios();
  }
};

window.sorteiosPageNext = function () {
  const filtered = _filterSorteios(allSorteios);
  const total = Math.ceil(filtered.length / SORTEIOS_PAGE_SIZE);
  if (sorteiosPage < total) {
    sorteiosPage++;
    renderSorteios();
  }
};

window.selectSorteio = function (id) {
  selectSorteio(id);
};

window.loadSorteioForEdit = function (id) {
  const sorteio = allSorteios.find(item => item.id === id);
  if (!sorteio) {
    showToast("Sorteio não encontrado para edição.", "error");
    return;
  }
  loadSorteioForm(sorteio);
  selectSorteio(id);
};

window.resetSorteioForm = function () {
  loadSorteioForm(null);
  selectedSorteioWinner = null;
  _unsubscribeSorteioListeners();
  currentParticipants = [];
  renderParticipants();
  renderSorteioDetails();
  renderSorteios();
};

window.activateSorteioAdmin = async function (id) {
  if (!confirm(`Ativar sorteio "${id}"?`)) return;
  try {
    const result = await activateSorteio(id, null);
    if (!result.success) throw new Error(result.error || "Falha ao ativar.");
    showToast("Sorteio ativado.", "success");
    await refreshSorteios();
    if (selectedSorteioId === id) selectSorteio(id);
  } catch (err) {
    console.error("[ADMIN] Erro ao ativar sorteio:", err);
    showToast(err.message || "Erro ao ativar sorteio.", "error");
  }
};

window.pauseSorteioAdmin = async function (id) {
  if (!confirm(`Pausar sorteio "${id}"?`)) return;
  try {
    const result = await pauseSorteio(id, null);
    if (!result.success) throw new Error(result.error || "Falha ao pausar.");
    showToast("Sorteio pausado.", "success");
    await refreshSorteios();
    if (selectedSorteioId === id) selectSorteio(id);
  } catch (err) {
    console.error("[ADMIN] Erro ao pausar sorteio:", err);
    showToast(err.message || "Erro ao pausar sorteio.", "error");
  }
};

window.endSorteioAdmin = async function (id) {
  if (!confirm(`Encerrar sorteio "${id}"? Esta ação não pode ser desfeita.`)) return;
  try {
    const result = await endSorteio(id, null);
    if (!result.success) throw new Error(result.error || "Falha ao encerrar.");
    showToast("Sorteio encerrado.", "success");
    await refreshSorteios();
    if (selectedSorteioId === id) selectSorteio(id);
  } catch (err) {
    console.error("[ADMIN] Erro ao encerrar sorteio:", err);
    showToast(err.message || "Erro ao encerrar sorteio.", "error");
  }
};

window.duplicateSorteioAdmin = async function (id) {
  if (!confirm(`Duplicar sorteio "${id}"?`)) return;
  try {
    const result = await duplicateSorteio(id, null);
    if (!result.success) throw new Error(result.error || "Falha ao duplicar.");
    showToast("Sorteio duplicado.", "success");
    await refreshSorteios();
  } catch (err) {
    console.error("[ADMIN] Erro ao duplicar sorteio:", err);
    showToast(err.message || "Erro ao duplicar sorteio.", "error");
  }
};

window.deleteSorteioAdmin = async function (id) {
  if (!confirm(`Excluir sorteio "${id}" permanentemente?`)) return;
  try {
    const result = await deleteSorteio(id, null);
    if (!result.success) throw new Error(result.error || "Falha ao excluir.");
    showToast("Sorteio excluído.", "success");
    if (selectedSorteioId === id) {
      selectedSorteioId = null;
      selectedSorteio = null;
      selectedSorteioWinner = null;
      currentParticipants = [];
      _unsubscribeSorteioListeners();
      renderSorteioDetails();
      renderParticipants();
    }
    await refreshSorteios();
  } catch (err) {
    console.error("[ADMIN] Erro ao excluir sorteio:", err);
    showToast(err.message || "Erro ao excluir sorteio.", "error");
  }
};

window.drawWinnerSelected = function () {
  if (!selectedSorteio) {
    showToast("Selecione um sorteio antes de sortear um vencedor.", "warn");
    return;
  }
  if (!currentParticipants.length) {
    showToast("Não há participantes disponíveis para este sorteio.", "warn");
    return;
  }
  const index = Math.floor(Math.random() * currentParticipants.length);
  selectedSorteioWinner = currentParticipants[index];
  renderSorteioDetails();
  showToast(`Vencedor sorteado: ${selectedSorteioWinner.uid || selectedSorteioWinner.id}`, "success");
};

window.rerollWinnerSelected = function () {
  if (!selectedSorteio) {
    showToast("Selecione um sorteio antes de refazer o sorteio.", "warn");
    return;
  }
  if (!currentParticipants.length) {
    showToast("Não há participantes disponíveis para refazer o sorteio.", "warn");
    return;
  }
  if (currentParticipants.length === 1) {
    selectedSorteioWinner = currentParticipants[0];
  } else {
    let index;
    do {
      index = Math.floor(Math.random() * currentParticipants.length);
    } while (currentParticipants[index] && selectedSorteioWinner && currentParticipants[index].id === selectedSorteioWinner.id);
    selectedSorteioWinner = currentParticipants[index];
  }
  renderSorteioDetails();
  showToast(`Novo vencedor: ${selectedSorteioWinner.uid || selectedSorteioWinner.id}`, "success");
};

async function handleSorteioFormSubmit(event) {
  event.preventDefault();
  const statusEl = document.getElementById("sorteio-form-status");
  const submitBtn = document.getElementById("sorteio-submit-btn");
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.textContent = selectedSorteioId ? "Salvando..." : "Criando...";
  }
  if (statusEl) {
    statusEl.textContent = "";
  }

  try {
    const titulo = document.getElementById("sorteio-titulo").value.trim();
    const quantidade = parseInt(document.getElementById("sorteio-qty").value, 10) || 0;
    const limitePorUsuario = parseInt(document.getElementById("sorteio-limite").value, 10) || 1;
    const status = document.getElementById("sorteio-status-sel").value;
    const dataVip = document.getElementById("sorteio-data-vip").value;
    const dataPublica = document.getElementById("sorteio-data-publica").value;
    const dataFinal = document.getElementById("sorteio-data-final").value;
    const tipoSorteio = document.getElementById("sorteio-tipo").value.trim();
    const descricao = document.getElementById("sorteio-descricao").value.trim();

    if (!titulo) {
      throw new Error("Título é obrigatório.");
    }

    let imagem = null;
    if (selectedImageFile) {
      imagem = await uploadSorteioImage(selectedImageFile);
    } else if (selectedImagePreviewUrl && selectedSorteio && selectedSorteio.imagem) {
      imagem = selectedSorteio.imagem;
    }

    const payload = {
      titulo,
      quantidade,
      limitePorUsuario,
      status,
      dataVip: dataVip ? new Date(dataVip) : null,
      dataPublica: dataPublica ? new Date(dataPublica) : null,
      dataFinal: dataFinal ? new Date(dataFinal) : null,
      tipoSorteio: tipoSorteio || undefined,
      descricao: descricao || undefined,
      imagem: imagem || undefined,
    };

    let result;
    if (selectedSorteioId) {
      result = await editSorteio(selectedSorteioId, payload, null);
      if (!result.success) {
        throw new Error(result.error || "Falha ao atualizar sorteio.");
      }
      showToast("Sorteio atualizado com sucesso.", "success");
    } else {
      result = await createSorteio(payload, null);
      if (!result.success) {
        throw new Error(result.error || "Falha ao criar sorteio.");
      }
      showToast("Sorteio criado com sucesso.", "success");
      selectedSorteioId = result.data.id;
      selectedSorteio = result.data;
    }

    await refreshSorteios();
    if (selectedSorteioId) {
      selectSorteio(selectedSorteioId);
    }
    loadSorteioForm(null);
  } catch (err) {
    console.error("[ADMIN] Erro ao salvar sorteio:", err);
    if (statusEl) {
      statusEl.textContent = err.message || "Erro ao salvar sorteio.";
      statusEl.style.color = "#e74c3c";
    }
    showToast(err.message || "Erro ao salvar sorteio.", "error");
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = selectedSorteioId ? "Salvar alterações" : "Salvar sorteio";
    }
  }
}

window.refreshSorteios = refreshSorteios;

window.sorteioImageInputChanged = function (event) {
  const file = event.target.files && event.target.files[0] ? event.target.files[0] : null;
  selectedImageFile = file;
  setSorteioImagePreview(file);
};

async function refresh() {
  try {
    await Promise.all([fetchCodes(), fetchUsers(), fetchPromotions()]);
    renderStats();
    renderCodes();
    renderUsers();
    renderPromotions();
    await refreshSorteios();
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

  const sorteioSearchInput = document.getElementById("sorteio-search");
  if (sorteioSearchInput) {
    sorteioSearchInput.addEventListener("input", (e) => {
      sorteioSearch = e.target.value.trim().toLowerCase();
      sorteiosPage = 1;
      renderSorteios();
    });
  }

  const sorteioImageInput = document.getElementById("sorteio-image-input");
  if (sorteioImageInput) {
    sorteioImageInput.addEventListener("change", window.sorteioImageInputChanged);
  }

  const sorteioResetBtn = document.getElementById("sorteio-reset-btn");
  if (sorteioResetBtn) {
    sorteioResetBtn.addEventListener("click", () => {
      window.resetSorteioForm();
    });
  }

  const sorteioForm = document.getElementById("sorteio-form");
  if (sorteioForm) {
    sorteioForm.addEventListener("submit", handleSorteioFormSubmit);
  }

  await refresh();
  console.log("[ADMIN] Dados carregados. Atualize manualmente conforme necessário.");
});
