import { db } from "./vip5-firebase.js";
import { getApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  collection,
  doc,
  getDocs,
  getDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  addDoc,
  serverTimestamp,
  onSnapshot,
  query,
  orderBy,
  limit,
  where,
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
  pickSorteioWinner,
  fetchSorteioResults,
} from "./vip5-sorteios-storage.js";

import { generateVipCodes } from "./vip5-storage.js";

console.log("[ADMIN] admin.js carregado.");

const VIP_CODES_COL = "vip5_codigos";
const GERADOR_CODES_COL = "vip5_gerador_codigos";
const RESULTADOS_SORTEIOS_COL = "vip5_resultados_sorteios";
const USERS_COL     = "users";
const VIP_SORTEIOS_COL = "vip5_sorteios";
const VIP_SORTEIO_PARTICIPANTS = "vip5_sorteios_participantes";
const PRODUTOS_ANTECIPADOS_COL = "produtos_antecipados";
const PAGE_SIZE     = 20;
const SORTEIOS_PAGE_SIZE = 12;
const PARTICIPANTS_PAGE_SIZE = 100;

// ── Estado: Códigos e Usuários (inalterado) ───────────────────────────────────
let allCodes  = [];
let allUsers  = [];
let allGeradorValidatedCodes = [];
let codesPage = 1;
let usersPage = 1;
let searchTerm = "";

// ── Estado: Promoções ─────────────────────────────────────────────────────────
let allPromos        = [];
let promosPage       = 1;
let promoStatusFilter = "";
let allProdutosAntecipados = [];
let produtosSearchTerm = "";
let selectedPromoProdutoIds = [];
let promoEditId = null;

// ── Estado: Sorteios VIP ──────────────────────────────────────────────────────
let allSorteios = [];
let sorteiosPage = 1;
let sorteioFilterStatus = "";
let sorteioFilterVip = "";
let sorteioSort = "createdAt_desc";
let sorteadorParticipantes = [];
let sorteadorVencedoresSessao = [];
let sorteadorUltimoVencedor = null;
let sorteadorHistorico = [];
let sorteioSearch = "";
let selectedSorteioId = null;
let selectedSorteio = null;
let selectedSorteioUnsubscribe = null;
let participantsUnsubscribe = null;
let selectedImageFile = null;
let selectedImagePreviewUrl = null;
let currentParticipants = [];
let selectedSorteioWinner = null;
let selectedSorteioResults = [];
let activeSorteioAdminTab = "resumo";
let sorteioParticipantsSearch = "";
const toastTimeouts = new Set();

function clearPendingToasts() {
  toastTimeouts.forEach((timerId) => clearTimeout(timerId));
  toastTimeouts.clear();
}

window.addEventListener("beforeunload", () => {
  clearPendingToasts();
  if (codesUnsubscribe) {
    codesUnsubscribe();
  }
  if (geradorCodesUnsubscribe) {
    geradorCodesUnsubscribe();
  }
  if (selectedSorteioUnsubscribe) {
    selectedSorteioUnsubscribe();
  }
  if (participantsUnsubscribe) {
    participantsUnsubscribe();
  }
});

// ─── Leitura dos dados: Códigos e Usuários ────────────────────────────────────
let codesUnsubscribe = null;
let geradorCodesUnsubscribe = null;

function subscribeToCodesRealtime() {
  console.log("[ADMIN] Inscrevendo em atualizações de códigos em tempo real...");
  if (codesUnsubscribe) {
    codesUnsubscribe();
  }
  codesUnsubscribe = onSnapshot(
    collection(db, VIP_CODES_COL),
    (snapshot) => {
      allCodes = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
      console.log("[ADMIN] Códigos atualizados (tempo real):", allCodes.length);
      renderCodes();
      updateCodesStats();
      updateLastRefresh();
    },
    (error) => {
      console.error("[ADMIN] Erro ao ouvir códigos em tempo real:", error);
      showToast("Erro ao atualizar códigos em tempo real.", "error");
    }
  );
}

function subscribeToGeradorCodesRealtime() {
  console.log("[ADMIN] Inscrevendo em atualizações de códigos do Gerador em tempo real...");
  if (geradorCodesUnsubscribe) {
    geradorCodesUnsubscribe();
  }
  geradorCodesUnsubscribe = onSnapshot(
    collection(db, GERADOR_CODES_COL),
    (snapshot) => {
      allGeradorValidatedCodes = snapshot.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .filter(isGeradorValidatedCode);
      renderGeradorValidatedCodes();
      updateLastRefresh();
    },
    (error) => {
      console.error("[ADMIN] Erro ao ouvir códigos do Gerador em tempo real:", error);
      showToast("Erro ao atualizar códigos do Gerador em tempo real.", "error");
    }
  );
}

async function fetchCodes() {
  try {
    console.log("[ADMIN] Buscando vip5_codigos...");
    const snap = await getDocs(collection(db, VIP_CODES_COL));
    allCodes = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    console.log("[ADMIN] Códigos carregados:", allCodes.length);
  } catch (error) {
    console.warn("[ADMIN] Não foi possível carregar vip5_codigos:", error);
    allCodes = [];
  }
  updateCodesStats();
  renderCodes();
}

function isGeradorValidatedCode(code) {
  if (code?.usado === true) return true;
  const status = String(code?.status || "").trim().toLowerCase();
  return status === "usado" || status === "validado";
}

async function fetchValidatedGeradorCodes() {
  try {
    console.log("[ADMIN] Buscando códigos validados do Gerador...");
    const snap = await getDocs(collection(db, GERADOR_CODES_COL));
    allGeradorValidatedCodes = snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .filter(isGeradorValidatedCode);
    console.log("[ADMIN] Códigos do Gerador validados carregados:", allGeradorValidatedCodes.length);
  } catch (error) {
    console.warn("[ADMIN] Não foi possível carregar códigos do Gerador:", error);
    allGeradorValidatedCodes = [];
  }
  renderGeradorValidatedCodes();
}

async function fetchUsers() {
  try {
    console.log("[ADMIN] Buscando users...");
    const snap = await getDocs(collection(db, USERS_COL));
    allUsers = snap.docs
      .map(d => ({ uid: d.id, ...d.data() }))
      .filter(u => u.vip5Code);
    console.log("[ADMIN] Usuários VIP carregados:", allUsers.length);
  } catch (error) {
    console.warn("[ADMIN] Não foi possível carregar usuários VIP:", error);
    allUsers = [];
  }
  renderUsers();
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

async function fetchProdutosAntecipadosForPromo() {
  try {
    const snap = await getDocs(collection(db, PRODUTOS_ANTECIPADOS_COL));
    allProdutosAntecipados = snap.docs
      .map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }))
      .sort((a, b) => String(a.nome || a.titulo || "").localeCompare(String(b.nome || b.titulo || "")));
    renderProdutosSelecionaveis();
  } catch (err) {
    console.error("[ADMIN] Erro ao buscar produtos para promoção:", err);
    allProdutosAntecipados = [];
    renderProdutosSelecionaveis();
  }
}

function renderProdutosSelecionaveis() {
  const container = document.getElementById("promo-produtos-list");
  if (!container) return;

  if (!allProdutosAntecipados.length) {
    container.innerHTML = '<div style="color:#777;font-size:13px">Nenhum produto disponível para seleção.</div>';
    return;
  }

  container.innerHTML = allProdutosAntecipados.map((produto) => {
    const id = produto.id;
    const nome = produto.nome || produto.titulo || id;
    const checked = selectedPromoProdutoIds.includes(id) ? "checked" : "";
    return `
      <label style="display:flex;align-items:center;gap:8px;padding:10px;border:1px solid var(--border2);border-radius:8px;background:var(--surface);cursor:pointer">
        <input type="checkbox" value="${id}" ${checked} onchange="togglePromoProdutoSelection('${id}', this.checked)" />
        <span>${nome}</span>
      </label>`;
  }).join("");
}

window.togglePromoProdutoSelection = function (produtoId, checked) {
  if (checked) {
    if (!selectedPromoProdutoIds.includes(produtoId)) selectedPromoProdutoIds.push(produtoId);
  } else {
    selectedPromoProdutoIds = selectedPromoProdutoIds.filter((id) => id !== produtoId);
  }
};

window.cancelPromoEdit = function () {
  promoEditId = null;
  selectedPromoProdutoIds = [];
  document.getElementById("promo-id-edit").value = "";
  document.getElementById("promo-form").reset();
  document.getElementById("promo-btn").textContent = "Criar promoção";
  document.getElementById("promo-cancel-edit").style.display = "none";
  document.getElementById("promo-status").textContent = "";
  document.getElementById("promo-qty").value = "0";
  document.getElementById("promo-limite").value = "1";
  document.getElementById("promo-valor-desconto").value = "0";
  document.getElementById("promo-limite-total").value = "0";
  document.getElementById("promo-vip-minimo").value = "0";
  document.getElementById("promo-tipo-desconto").value = "percentual";
  document.getElementById("promo-permitir-cupom").value = "true";
  document.getElementById("promo-status-sel").value = "programada";
  renderProdutosSelecionaveis();
};

window.editPromoAdmin = async function (promoId) {
  const promo = allPromos.find((item) => item.id === promoId);
  if (!promo) return;
  promoEditId = promoId;
  selectedPromoProdutoIds = Array.isArray(promo.produtosSelecionados) ? promo.produtosSelecionados.slice() : [];

  document.getElementById("promo-id-edit").value = promoId;
  document.getElementById("promo-titulo").value = promo.titulo || "";
  document.getElementById("promo-descricao").value = promo.descricao || "";
  document.getElementById("promo-qty").value = promo.quantidade || "0";
  document.getElementById("promo-limite").value = promo.limitePorUsuario || "1";
  document.getElementById("promo-limite-total").value = promo.limiteTotal || "0";
  document.getElementById("promo-valor-desconto").value = promo.valorDesconto || "0";
  document.getElementById("promo-tipo-desconto").value = promo.tipoDesconto || "percentual";
  document.getElementById("promo-inicio").value = promo.inicio ? toInputDatetime(promo.inicio) : "";
  document.getElementById("promo-fim").value = promo.fim ? toInputDatetime(promo.fim) : "";
  document.getElementById("promo-data-vip").value = promo.dataVip ? toInputDatetime(promo.dataVip) : "";
  document.getElementById("promo-data-publica").value = promo.dataPublica ? toInputDatetime(promo.dataPublica) : "";
  document.getElementById("promo-data-final").value = promo.dataFinal ? toInputDatetime(promo.dataFinal) : "";
  document.getElementById("promo-vip-minimo").value = promo.vipMinimo || "0";
  document.getElementById("promo-permitir-cupom").value = promo.permitirCupom === false ? "false" : "true";
  document.getElementById("promo-status-sel").value = promo.status || "programada";
  document.getElementById("promo-inicio").value = promo.inicio ? toInputDatetime(promo.inicio) : "";
  document.getElementById("promo-fim").value = promo.fim ? toInputDatetime(promo.fim) : "";
  document.getElementById("promo-data-vip").value = promo.dataVip ? toInputDatetime(promo.dataVip) : "";
  document.getElementById("promo-data-publica").value = promo.dataPublica ? toInputDatetime(promo.dataPublica) : "";
  document.getElementById("promo-data-final").value = promo.dataFinal ? toInputDatetime(promo.dataFinal) : "";
  document.getElementById("promo-btn").textContent = "Salvar edição";
  document.getElementById("promo-cancel-edit").style.display = "inline-block";
  renderProdutosSelecionaveis();
  window.scrollTo({ top: 0, behavior: "smooth" });
};

function toInputDatetime(value) {
  if (!value) return "";
  if (typeof value.toDate === "function") {
    const d = value.toDate();
    const pad = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// ─── Renderização: Estatísticas ───────────────────────────────────────────────
function renderStats() {
  updateCodesStats();
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderSorteadorSorteiosSelect() {
  const select = document.getElementById("sorteador-sorteio-select");
  if (!select) return;

  const currentValue = select.value || "";
  const options = [
    '<option value="">Selecione um sorteio</option>',
    ...allSorteios.map((sorteio) => {
      const id = String(sorteio.id || "");
      const title = sorteio.titulo || id || "Sem título";
      return `<option value="${id}" ${currentValue === id ? "selected" : ""}>${title}</option>`;
    })
  ];

  select.innerHTML = options.join("");
  if (!select.value && currentValue) {
    select.value = currentValue;
  }
}

function updateSorteadorSummary() {
  const totalEl = document.getElementById("sorteador-total-participantes");
  const qtyEl = document.getElementById("sorteador-quantidade-participantes");
  const statusEl = document.getElementById("sorteador-status");

  if (totalEl) {
    totalEl.textContent = String(sorteadorParticipantes.length);
  }
  if (qtyEl) {
    qtyEl.value = String(sorteadorParticipantes.length);
  }
  if (statusEl) {
    if (!sorteadorParticipantes.length) {
      statusEl.textContent = "Nenhum participante carregado.";
      statusEl.className = "sorteador-status";
    } else {
      statusEl.textContent = `Participantes carregados: ${sorteadorParticipantes.length}`;
      statusEl.className = "sorteador-status success";
    }
  }
}

function renderSorteadorResultado() {
  const winnerEl = document.getElementById("sorteador-vencedor");
  const winnerMetaEl = document.getElementById("sorteador-vencedor-meta");
  if (!winnerEl) return;

  if (!sorteadorUltimoVencedor) {
    winnerEl.innerHTML = '<div style="color:#94a3b8;">Ainda não houve sorteio.</div>';
    if (winnerMetaEl) winnerMetaEl.innerHTML = "";
    return;
  }

  winnerEl.innerHTML = `
    <div style="font-size:18px;font-weight:800;color:#fbbf24">🏆 ${escapeHtml(sorteadorUltimoVencedor.codigo || "—")}</div>
    <div style="margin-top:8px;color:#e2e8f0">UID: ${escapeHtml(sorteadorUltimoVencedor.uid || "—")}</div>
    <div style="margin-top:4px;color:#cbd5e1">Sorteio: ${escapeHtml(sorteadorUltimoVencedor.sorteioNome || "—")}</div>
    <div style="margin-top:4px;color:#cbd5e1">ID do sorteio: ${escapeHtml(sorteadorUltimoVencedor.sorteioId || "—")}</div>
    <div style="margin-top:4px;color:#cbd5e1">Data da validação: ${escapeHtml(sorteadorUltimoVencedor.dataValidacao || "—")}</div>
  `;

  if (winnerMetaEl) {
    winnerMetaEl.innerHTML = `<div style="color:#86efac;font-size:13px">Vencedor registrado nesta sessão.</div>`;
  }
}

function renderSorteadorVencedoresSessao() {
  const container = document.getElementById("sorteador-vencedores-sessao");
  if (!container) return;

  if (!sorteadorVencedoresSessao.length) {
    container.innerHTML = '<div style="color:#94a3b8">Nenhum vencedor sorteado ainda.</div>';
    return;
  }

  container.innerHTML = sorteadorVencedoresSessao.map((item, index) => `
    <div style="padding:10px 12px;border:1px solid rgba(255,255,255,0.12);border-radius:10px;background:rgba(255,255,255,0.04);margin-bottom:8px">
      <div style="font-weight:700;color:#fbbf24">#${index + 1} · ${escapeHtml(item.codigo || "—")}</div>
      <div style="margin-top:4px;color:#e2e8f0">UID: ${escapeHtml(item.uid || "—")}</div>
      <div style="margin-top:4px;color:#cbd5e1">Data/Hora: ${escapeHtml(item.dataSorteio || "—")}</div>
    </div>
  `).join("");
}

async function renderSorteadorHistorico() {
  const tbody = document.getElementById("sorteador-historico-tbody");
  if (!tbody) return;

  try {
    const snap = await getDocs(collection(db, RESULTADOS_SORTEIOS_COL));
    sorteadorHistorico = snap.docs
      .map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }))
      .sort((a, b) => {
        const aTime = a.dataSorteio?.toDate ? a.dataSorteio.toDate().getTime() : new Date(a.dataSorteio || 0).getTime();
        const bTime = b.dataSorteio?.toDate ? b.dataSorteio.toDate().getTime() : new Date(b.dataSorteio || 0).getTime();
        return bTime - aTime;
      });
  } catch (error) {
    console.warn("[ADMIN] Não foi possível carregar histórico do sorteador:", error);
    sorteadorHistorico = [];
  }

  if (!sorteadorHistorico.length) {
    tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;color:#555;padding:24px">Nenhum sorteio registrado ainda.</td></tr>';
    return;
  }

  tbody.innerHTML = sorteadorHistorico.map((item) => {
    const dataSorteio = item.dataSorteio?.toDate ? fmtDate(item.dataSorteio.toDate()) : "—";
    const sorteioLabel = item.sorteioNome || item.sorteioId || "—";
    return `
      <tr>
        <td class="mono">${escapeHtml(item.codigo || "—")}</td>
        <td class="mono small">${escapeHtml(item.uid || "—")}</td>
        <td>${escapeHtml(sorteioLabel)}</td>
        <td>${escapeHtml(dataSorteio)}</td>
      </tr>`;
  }).join("");
}

window.loadSorteadorParticipantes = async function () {
  const select = document.getElementById("sorteador-sorteio-select");
  const selectedSorteioId = select ? select.value : "";
  const selectedSorteio = allSorteios.find((item) => String(item.id) === String(selectedSorteioId)) || null;

  if (!selectedSorteioId) {
    sorteadorParticipantes = [];
    sorteadorVencedoresSessao = [];
    sorteadorUltimoVencedor = null;
    updateSorteadorSummary();
    renderSorteadorResultado();
    renderSorteadorVencedoresSessao();
    return;
  }

  try {
    const snap = await getDocs(query(collection(db, GERADOR_CODES_COL), where("sorteioId", "==", selectedSorteioId)));
    const filtered = snap.docs
      .map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }))
      .filter((item) => item.usado === true || String(item.status || "").toLowerCase() === "usado");

    sorteadorParticipantes = filtered;
    sorteadorVencedoresSessao = [];
    sorteadorUltimoVencedor = null;
    updateSorteadorSummary();
    renderSorteadorResultado();
    renderSorteadorVencedoresSessao();
    showToast(`Participantes carregados: ${filtered.length}`, "success");
  } catch (error) {
    console.error("[ADMIN] Erro ao carregar participantes do sorteador:", error);
    sorteadorParticipantes = [];
    updateSorteadorSummary();
    renderSorteadorResultado();
    renderSorteadorVencedoresSessao();
    showToast("Erro ao carregar participantes do sorteador.", "error");
  }
};

window.realizarSorteioGerador = async function () {
  if (!sorteadorParticipantes.length) {
    showToast("Carregue os participantes primeiro.", "error");
    return;
  }

  const available = sorteadorParticipantes.filter((participant) => !sorteadorVencedoresSessao.some((winner) => winner.codigo === participant.codigo));
  if (!available.length) {
    showToast("Todos os participantes já foram sorteados nesta sessão.", "error");
    return;
  }

  const winner = available[Math.floor(Math.random() * available.length)];
  const select = document.getElementById("sorteador-sorteio-select");
  const sorteioId = select ? select.value : "";
  const sorteioNome = allSorteios.find((item) => String(item.id) === String(sorteioId))?.titulo || "—";

  const payload = {
    codigo: winner.codigo || winner.id || null,
    uid: winner.usadoPor || null,
    sorteioId,
    sorteioNome,
    dataValidacao: winner.usadoEm?.toDate ? winner.usadoEm : null,
    dataSorteio: serverTimestamp(),
    adminUid: null,
  };

  try {
    await addDoc(collection(db, RESULTADOS_SORTEIOS_COL), payload);
    const formattedDate = winner.usadoEm?.toDate ? fmtDate(winner.usadoEm.toDate()) : "—";
    sorteadorUltimoVencedor = {
      ...payload,
      dataValidacao: formattedDate,
      dataSorteio: new Date().toLocaleString("pt-BR")
    };
    sorteadorVencedoresSessao = [
      ...sorteadorVencedoresSessao,
      {
        ...payload,
        dataSorteio: new Date().toLocaleString("pt-BR")
      }
    ];
    renderSorteadorResultado();
    renderSorteadorVencedoresSessao();
    await renderSorteadorHistorico();
    showToast("Vencedor registrado com sucesso.", "success");
  } catch (error) {
    console.error("[ADMIN] Erro ao salvar vencedor do sorteador:", error);
    showToast("Erro ao salvar resultado do sorteio.", "error");
  }
};

window.sortearNovamenteGerador = function () {
  sorteadorVencedoresSessao = [];
  sorteadorUltimoVencedor = null;
  renderSorteadorResultado();
  renderSorteadorVencedoresSessao();
};

window.exportarResultadoSorteador = function () {
  const rows = sorteadorVencedoresSessao.map((item) => ({
    codigo: item.codigo || "",
    uid: item.uid || "",
    sorteio: item.sorteioNome || "",
    dataSorteio: item.dataSorteio || ""
  }));

  const header = ["codigo", "uid", "sorteio", "dataSorteio"];
  const csv = [header.join(",")].concat(rows.map((row) => header.map((key) => `"${String(row[key] ?? "").replace(/"/g, '""')}"`).join(","))).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "sorteio-codigos-validados.csv";
  link.click();
  URL.revokeObjectURL(url);
};

// ─── Renderização: Tabela de Códigos ─────────────────────────────────────────
function updateCodesStats() {
  const total = allCodes.length;
  const used = allCodes.filter(c => c.usado === true || c.used === true).length;
  const available = total - used;
  
  const totalEl = document.getElementById("stat-total");
  const usedEl = document.getElementById("stat-used");
  const availEl = document.getElementById("stat-available");
  
  if (totalEl) totalEl.textContent = total;
  if (usedEl) usedEl.textContent = used;
  if (availEl) availEl.textContent = available;
  
  console.log(`[ADMIN] Stats: ${total} total, ${used} usado, ${available} disponível`);
}

function formatGeradorValidationDate(value) {
  if (!value) return "—";
  if (value?.toDate) {
    return fmtDate(value.toDate());
  }
  const dateValue = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(dateValue.getTime())) return "—";
  return fmtDate(dateValue);
}

function renderGeradorValidatedCodes() {
  const tbody = document.getElementById("gerador-validated-tbody");
  const totalEl = document.getElementById("gerador-validated-total");
  const filteredEl = document.getElementById("gerador-validated-filtered");
  const summaryEl = document.getElementById("gerador-validated-summary");

  if (!tbody) return;

  const selectedSorteioKey = selectedSorteioId ? String(selectedSorteioId) : "";
  const filtered = allGeradorValidatedCodes
    .filter((item) => {
      if (!selectedSorteioKey) return true;
      return String(item.sorteioId || "") === selectedSorteioKey;
    })
    .sort((a, b) => {
      const aTime = a.usadoEm?.toDate ? a.usadoEm.toDate().getTime() : (a.usadoEm ? new Date(a.usadoEm).getTime() : 0);
      const bTime = b.usadoEm?.toDate ? b.usadoEm.toDate().getTime() : (b.usadoEm ? new Date(b.usadoEm).getTime() : 0);
      return bTime - aTime;
    });

  if (totalEl) totalEl.textContent = String(allGeradorValidatedCodes.length);
  if (filteredEl) filteredEl.textContent = String(filtered.length);
  if (summaryEl) {
    summaryEl.textContent = selectedSorteioKey
      ? `Filtrando por sorteio selecionado (${selectedSorteio?.titulo || selectedSorteioId})`
      : "Mostrando todos os códigos validados";
  }

  if (!filtered.length) {
    tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;color:#555;padding:24px">Nenhum código do Gerador validado encontrado.</td></tr>`;
    return;
  }

  tbody.innerHTML = filtered.map((item) => {
    const codigoTexto = item.codigo || item.id || "—";
    const validadoPor = item.usadoPor || "—";
    const validadoEm = formatGeradorValidationDate(item.usadoEm);
    const sorteioIdTexto = item.sorteioId || "—";
    const sorteioNomeTexto = item.sorteioNome || "—";

    return `
      <tr>
        <td class="mono">${codigoTexto}</td>
        <td class="mono small">${validadoPor}</td>
        <td>${validadoEm}</td>
        <td class="mono small">${sorteioIdTexto}</td>
        <td>${sorteioNomeTexto}</td>
      </tr>`;
  }).join("");
}

function renderCodes() {
  const filtered = allCodes.filter(c => {
    const codigo = (c.codigo || c.code || c.id || "").toLowerCase();
    const search = (searchTerm || "").toLowerCase();
    return !search || codigo.includes(search);
  });
  
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
    const activatedAt = c.activatedAt || c.dataUso
      ? (c.activatedAt?.toDate ? fmtDate(c.activatedAt.toDate()) : (c.dataUso?.toDate ? fmtDate(c.dataUso.toDate()) : fmtDate(new Date(c.activatedAt || c.dataUso))))
      : "—";
    const isUsed = c.usado === true || c.used === true;
    const statusBadge = c.status === "inativo" 
      ? `<span class="badge badge-used">Inativo</span>`
      : (isUsed
        ? `<span class="badge badge-used">Usado</span>`
        : `<span class="badge badge-free">Livre</span>`);
    const codigoTexto = c.codigo || c.code || c.id;
    const usadoPor = c.usadoPor || c.activatedBy || "—";
    const btnCancel = c.status !== "inativo" && !isUsed
      ? `<button class="btn-sm btn-blue" onclick="cancelCode('${c.id}')">Cancelar</button>`
      : "";
    return `
      <tr>
        <td class="mono">${codigoTexto}</td>
        <td>${c.days ?? "—"}</td>
        <td>${statusBadge}</td>
        <td class="mono small">${usadoPor}</td>
        <td>${activatedAt}</td>
        <td class="actions">
          ${btnCancel}
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
    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;color:#555;padding:24px">Nenhuma promoção encontrada.</td></tr>`;
    document.getElementById("promos-pagination").textContent = "";
    return;
  }

  const statusLabel = {
    ativa:      { cls: "badge-ativa",      txt: "Ativa"      },
    pausada:    { cls: "badge-pausada",    txt: "Pausada"    },
    encerrada:  { cls: "badge-encerrada",  txt: "Encerrada"  },
    programada: { cls: "badge-programada", txt: "Programada" },
  };

  const descontoLabel = (p) => {
    if (p.tipoDesconto === "fixo") {
      return `R$ ${Number(p.valorDesconto || 0).toFixed(2)}`;
    }
    return `${Number(p.valorDesconto || 0).toFixed(0)}%`;
  };

  const toDate = (v) => {
    if (!v) return null;
    if (typeof v.toDate === "function") return v.toDate();
    return v instanceof Date ? v : new Date(v);
  };

  const usageSummary = (p) => {
    const totalLimit = Number(p.limiteTotal || 0);
    const qty = Number(p.quantidade || 0);
    const uses = Number(p.utilizacoes || p.participacoes || 0);
    const remaining = totalLimit > 0 ? Math.max(0, totalLimit - uses) : (qty === 0 ? "∞" : Math.max(0, qty - uses));
    const usedBy = Number(p.usuariosUsaram || 0);
    return {
      used: uses,
      remaining,
      usedBy,
      cap: totalLimit > 0 ? totalLimit : qty === 0 ? "∞" : qty,
    };
  };

  tbody.innerHTML = page.map(p => {
    const s = statusLabel[p.status] || { cls: "", txt: p.status };
    const summary = usageSummary(p);
    const dataFim = toDate(p.dataFinal || p.fim || p.dataFim);
    const dataStr = dataFim ? fmtDate(dataFim) : "—";
    const btnAtivar = p.status !== PROMO_STATUS.ATIVA
      ? `<button class="btn-sm btn-reset" onclick="activatePromo('${p.id}')">Ativar</button>`
      : "";
    const btnPausar = p.status === PROMO_STATUS.ATIVA
      ? `<button class="btn-sm btn-blue" onclick="pausePromo('${p.id}')">Pausar</button>`
      : "";
    const btnEncerrar = (p.status === PROMO_STATUS.ATIVA || p.status === PROMO_STATUS.PAUSADA)
      ? `<button class="btn-sm btn-delete" style="background:#2a1e3a;color:#9b59b6" onclick="endPromo('${p.id}')">Encerrar</button>`
      : "";
    const btnEditar = `<button class="btn-sm btn-reset" onclick="editPromoAdmin('${p.id}')">Editar</button>`;
    const btnExcluir = `<button class="btn-sm btn-delete" onclick="deletePromoAdmin('${p.id}')">Excluir</button>`;

    return `
      <tr>
        <td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${p.titulo || "—"}</td>
        <td><span class="badge ${s.cls}">${s.txt}</span></td>
        <td class="mono small">${summary.used}/${summary.cap}</td>
        <td class="mono small">${summary.remaining}</td>
        <td class="small">${summary.usedBy}</td>
        <td class="small">${dataStr}</td>
        <td class="small">${descontoLabel(p)}</td>
        <td class="actions">
          ${btnEditar}${btnAtivar}${btnPausar}${btnEncerrar}${btnExcluir}
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

function _toDate(value) {
  if (!value) return null;
  if (typeof value.toDate === "function") {
    return value.toDate();
  }
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

function _formatDateValue(value) {
  const date = _toDate(value);
  if (!date) return "—";
  return date.toLocaleString("pt-BR", {
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit"
  });
}

function _formatDateShort(value) {
  const date = _toDate(value);
  if (!date) return "—";
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

function _isString(value) {
  return typeof value === "string" && value.trim().length > 0;
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
  const active = allSorteios.filter((s) => s?.status === "ativa").length;
  const ended = allSorteios.filter((s) => s?.status === "encerrada").length;
  const now = Date.now();
  const future = allSorteios.filter((s) => {
    if (s?.status === "encerrada") {
      return false;
    }
    return [s?.dataVip, s?.dataPublica, s?.dataSorteio].some((value) => {
      const date = _toDate(value);
      return Boolean(date && date.getTime() > now);
    });
  }).length;
  const participants = allSorteios.reduce((sum, s) => sum + _toNonNegativeInteger(s?.participacoesCount, 0), 0);
  const winners = allSorteios.filter((s) => {
    if (Array.isArray(s?.winners) && s.winners.length) return true;
    return Boolean(s?.winner);
  }).length;
  const average = total > 0 ? (participants / total).toFixed(1) : "0.0";
  const lastExecuted = allSorteios
    .map((s) => ({
      id: s?.id,
      date: _toDate(s?.lastDraw?.drawDate) || _toDate(s?.dataSorteio) || _toDate(s?.createdAt),
    }))
    .filter((entry) => entry.date)
    .sort((a, b) => b.date - a.date)[0];

  document.getElementById("stat-sorteios-total").textContent = total;
  document.getElementById("stat-sorteios-active").textContent = active;
  document.getElementById("stat-sorteios-paused").textContent = allSorteios.filter((s) => s?.status === "pausada").length;
  document.getElementById("stat-sorteios-ended").textContent = ended;
  document.getElementById("stat-sorteios-future").textContent = future;
  document.getElementById("stat-sorteios-participants").textContent = participants;
  document.getElementById("stat-sorteios-winners").textContent = winners;
  document.getElementById("stat-sorteios-average").textContent = average;
  const lastExecutedEl = document.getElementById("stat-sorteios-last-executed");
  if (lastExecutedEl) {
    lastExecutedEl.textContent = lastExecuted ? _formatDateShort(lastExecuted.date) : "—";
  }
}

function getSorteioStatusMeta(sorteio) {
  const value = (sorteio?.status || "programada").toString().toLowerCase();
  const mapping = {
    ativa: { txt: "Ativa", cls: "status-ativa" },
    pausada: { txt: "Pausada", cls: "status-pausada" },
    encerrada: { txt: "Encerrada", cls: "status-encerrada" },
    programada: { txt: "Programada", cls: "status-programada" },
  };
  return mapping[value] || { txt: value || "Programada", cls: "status-programada" };
}

function renderSorteioAdminTabs() {
  const activeTab = activeSorteioAdminTab || "resumo";
  document.querySelectorAll(".sorteio-tab").forEach((button) => {
    button.classList.toggle("active", button.dataset.tab === activeTab);
  });
  document.querySelectorAll(".sorteio-tab-panel").forEach((panel) => {
    panel.classList.toggle("active", panel.id === `sorteio-tab-${activeTab}`);
  });
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
  const removeTimer = setTimeout(() => {
    toastTimeouts.delete(removeTimer);
    toast.style.opacity = "0";
    const cleanupTimer = setTimeout(() => toast.remove(), 300);
    toastTimeouts.add(cleanupTimer);
  }, duration);
  toastTimeouts.add(removeTimer);
}

function _renderSorteioDates(sorteio) {
  const vip = sorteio?.dataVip ? _formatDateShort(sorteio.dataVip) : "—";
  const pub = sorteio?.dataPublica ? _formatDateShort(sorteio.dataPublica) : "—";
  const draw = sorteio?.dataSorteio ? _formatDateShort(sorteio.dataSorteio) : "—";
  const end = sorteio?.dataFinal ? _formatDateShort(sorteio.dataFinal) : "—";
  return `VIP: ${vip} · Pública: ${pub} · Sorteio: ${draw} · Fim: ${end}`;
}

function getSorteioWinnerDisplay(sorteio, fallbackWinner = null) {
  if (sorteio && Array.isArray(sorteio.winners) && sorteio.winners.length) {
    return sorteio.winners.map((winner) => winner.uid || winner.id || "—").join(", ");
  }
  const winnerData = fallbackWinner || sorteio?.winner || null;
  if (winnerData) {
    return winnerData.uid || winnerData.id || "—";
  }
  return "Ainda não sorteado";
}

function buildSorteioPayloadFromForm() {
  const titulo = document.getElementById("sorteio-titulo").value.trim();
  const quantidade = parseInt(document.getElementById("sorteio-qty").value, 10) || 0;
  const limitePorUsuario = parseInt(document.getElementById("sorteio-limite").value, 10) || 1;
  const status = document.getElementById("sorteio-status-sel").value;
  const dataVip = document.getElementById("sorteio-data-vip").value;
  const dataPublica = document.getElementById("sorteio-data-publica").value;
  const dataSorteio = document.getElementById("sorteio-data-sorteio").value;
  const dataFinal = document.getElementById("sorteio-data-final").value;
  const tipoSorteio = document.getElementById("sorteio-tipo").value.trim();
  const descricao = document.getElementById("sorteio-descricao").value.trim();
  const banner = document.getElementById("sorteio-banner").value.trim() || null;
  const idInterno = document.getElementById("sorteio-id-interno").value.trim() || null;
  const destaque = document.getElementById("sorteio-destaque").checked;
  const ordem = parseInt(document.getElementById("sorteio-ordem").value, 10) || 0;
  const premio = (document.getElementById("sorteio-premio") && document.getElementById("sorteio-premio").value.trim()) || null;
  const regulamento = (document.getElementById("sorteio-regulamento") && document.getElementById("sorteio-regulamento").value.trim()) || null;
  const quantidadeGanhadores = parseInt(document.getElementById("sorteio-quantidade-ganhadores").value, 10) || 1;

  return {
    titulo,
    quantidade,
    limitePorUsuario,
    status,
    dataVip: dataVip ? new Date(dataVip) : null,
    dataPublica: dataPublica ? new Date(dataPublica) : null,
    dataSorteio: dataSorteio ? new Date(dataSorteio) : null,
    dataFinal: dataFinal ? new Date(dataFinal) : null,
    tipoSorteio: tipoSorteio || undefined,
    descricao: descricao || undefined,
    banner: banner || undefined,
    idInterno: idInterno || undefined,
    destaque,
    ordem,
    premio: premio || undefined,
    regulamento: regulamento || undefined,
    quantidadeGanhadores: quantidadeGanhadores || undefined,
  };
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
    const statusMeta = getSorteioStatusMeta(sorteio);
    const statusLabel = {
      cls: statusMeta.cls ? `${statusMeta.cls}` : "",
      txt: statusMeta.txt || sorteio.status || "—",
    };

    const participantsCount = _toNonNegativeInteger(sorteio.participacoesCount, 0);
    const winner = selectedSorteioId === sorteio.id && selectedSorteioWinner
      ? selectedSorteioWinner.uid || selectedSorteioWinner.id || "—"
      : getSorteioWinnerDisplay(sorteio, null);
    const btnActivate = sorteio.status !== "ativa" ? `<button class="btn-sm btn-reset" onclick="activateSorteioAdmin('${sorteio.id}')">Ativar</button>` : "";
    const btnPause = sorteio.status === "ativa" ? `<button class="btn-sm btn-blue" onclick="pauseSorteioAdmin('${sorteio.id}')">Pausar</button>` : "";
    const btnEnd = (sorteio.status === "ativa" || sorteio.status === "pausada") ? `<button class="btn-sm btn-delete" onclick="endSorteioAdmin('${sorteio.id}')">Encerrar</button>` : "";
    const btnEdit = `<button class="btn-sm btn-outline" onclick="loadSorteioForEdit('${sorteio.id}')">Editar</button>`;
    const btnDuplicate = `<button class="btn-sm btn-reset" onclick="duplicateSorteioAdmin('${sorteio.id}')">Duplicar</button>`;
    const btnReopen = sorteio.status === "encerrada" ? `<button class="btn-sm btn-blue" onclick="reopenSorteioAdmin('${sorteio.id}')">Reabrir</button>` : "";
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
        <td class="actions">${btnSelect}${btnEdit}${btnActivate}${btnPause}${btnEnd}${btnReopen}${btnDuplicate}${btnDelete}</td>
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
  const badgeEl = document.getElementById("sorteio-badge-status");
  const bannerEl = document.getElementById("detail-banner");
  const metadataEl = document.getElementById("detail-metadata");
  const idInternoEl = document.getElementById("detail-id-interno");
  const roundEl = document.getElementById("detail-round");
  const selectionModeEl = document.getElementById("detail-selection-mode");
  const historySummaryEl = document.getElementById("detail-summary-history");

  const detailGrid = document.getElementById("sorteio-detail-grid");
  if (!selectedSorteio) {
    if (titleEl) titleEl.textContent = "Selecione um sorteio para visualizar detalhes";
    if (statusEl) statusEl.textContent = "—";
    if (participantsEl) participantsEl.textContent = "—";
    if (winnerEl) winnerEl.textContent = "—";
    if (datesEl) datesEl.textContent = "—";
    if (bannerEl) bannerEl.textContent = "—";
    if (metadataEl) metadataEl.textContent = "—";
    if (idInternoEl) idInternoEl.textContent = "—";
    if (roundEl) roundEl.textContent = "—";
    if (selectionModeEl) selectionModeEl.textContent = "—";
    if (historySummaryEl) historySummaryEl.textContent = "—";
    if (badgeEl) {
      badgeEl.textContent = "Pronto para operação";
      badgeEl.className = "sorteio-summary-pill";
    }
    if (detailGrid) detailGrid.style.display = "none";
    renderSorteioAdminTabs();
    return;
  }

  const historySummary = selectedSorteioResults.length
    ? `${selectedSorteioResults.length} rodada${selectedSorteioResults.length === 1 ? "" : "s"} registrada${selectedSorteioResults.length === 1 ? "" : "s"} · última ${_formatDateValue(selectedSorteioResults[0]?.createdAt)}`
    : (selectedSorteio?.lastDraw?.drawDate ? `Última rodada em ${_formatDateValue(selectedSorteio.lastDraw.drawDate)}` : "Nenhuma rodada registrada");
  const roundLabel = selectedSorteio?.lastDraw?.drawNumber ? `#${selectedSorteio.lastDraw.drawNumber}` : "—";
  const selectionMode = selectedSorteio?.lastDraw?.selectionMode === "unique"
    ? "Única / sem repetição"
    : (selectedSorteio?.lastDraw?.selectionMode || "Padrão");

  if (detailGrid) detailGrid.style.display = "grid";
  if (titleEl) titleEl.textContent = selectedSorteio.titulo || "Sorteio selecionado";
  renderGeradorValidatedCodes();
  if (statusEl) statusEl.textContent = selectedSorteio.status || "—";
  if (participantsEl) participantsEl.textContent = _toNonNegativeInteger(selectedSorteio.participacoesCount, 0);
  const winnerDisplay = getSorteioWinnerDisplay(selectedSorteio, selectedSorteioWinner || selectedSorteio?.winner || null);
  if (winnerEl) winnerEl.textContent = winnerDisplay;
  const premioEl = document.getElementById("detail-premio");
  const regulamentoEl = document.getElementById("detail-regulamento");
  const qGanhEl = document.getElementById("detail-quantidade-ganhadores");
  const premioSummaryEl = document.getElementById("detail-premio-summary");
  const summaryWinnersEl = document.getElementById("detail-summary-winners");
  const summaryParticipantsEl = document.getElementById("detail-summary-participants");
  const summaryDatesEl = document.getElementById("detail-summary-dates");
  const summaryHistoryEl = document.getElementById("detail-summary-history");
  if (premioEl) premioEl.textContent = selectedSorteio.premio || "—";
  if (regulamentoEl) regulamentoEl.textContent = selectedSorteio.regulamento || "—";
  if (qGanhEl) qGanhEl.textContent = String(_toNonNegativeInteger(selectedSorteio.quantidadeGanhadores, 1));
  if (datesEl) datesEl.textContent = _renderSorteioDates(selectedSorteio);
  if (bannerEl) bannerEl.textContent = selectedSorteio.banner || selectedSorteio.imagem || "—";
  if (metadataEl) metadataEl.textContent = `${selectedSorteio.tipoSorteio || "—"} · ${selectedSorteio.destaque ? "Destaque" : "Normal"} · Ordem ${_toNonNegativeInteger(selectedSorteio.ordem, 0)}`;
  if (idInternoEl) idInternoEl.textContent = selectedSorteio.idInterno || selectedSorteio.id || "—";
  if (roundEl) roundEl.textContent = roundLabel;
  if (selectionModeEl) selectionModeEl.textContent = selectionMode;
  if (historySummaryEl) historySummaryEl.textContent = historySummary;
  if (premioSummaryEl) premioSummaryEl.textContent = selectedSorteio.premio || "—";
  if (summaryWinnersEl) summaryWinnersEl.textContent = winnerDisplay;
  if (summaryParticipantsEl) summaryParticipantsEl.textContent = _toNonNegativeInteger(selectedSorteio.participacoesCount, 0);
  if (summaryDatesEl) summaryDatesEl.textContent = _renderSorteioDates(selectedSorteio);
  if (summaryHistoryEl) summaryHistoryEl.textContent = historySummary;
  if (badgeEl) {
    const statusMeta = getSorteioStatusMeta(selectedSorteio);
    badgeEl.textContent = statusMeta.txt;
    badgeEl.className = `sorteio-summary-pill ${statusMeta.cls}`;
  }
  renderSorteioAdminTabs();
}

function renderParticipants() {
  const tbody = document.getElementById("sorteio-participants-tbody");
  if (!selectedSorteio) {
    tbody.innerHTML = `<tr><td colspan="4" style="text-align:center;color:#555;padding:24px">Selecione um sorteio para ver participantes.</td></tr>`;
    return;
  }

  const normalizedSearch = sorteioParticipantsSearch.trim().toLowerCase();
  const filteredParticipants = (currentParticipants || []).filter((participant) => {
    if (!normalizedSearch) return true;
    const haystack = [
      participant.uid,
      participant.id,
      participant.nome,
      participant.name,
      participant.email,
      participant.displayName,
      participant.userName,
      participant.userEmail,
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return haystack.includes(normalizedSearch);
  });

  if (!filteredParticipants.length) {
    tbody.innerHTML = `<tr><td colspan="4" style="text-align:center;color:#555;padding:24px">Nenhum participante encontrado para este sorteio.</td></tr>`;
    return;
  }

  tbody.innerHTML = filteredParticipants.map((participant) => {
    const createdAt = participant.lastParticipationAt || participant.createdAt;
    const userLabel = participant.nome || participant.name || participant.displayName || participant.userName || participant.email || "—";
    return `
      <tr>
        <td class="mono small">${participant.uid || participant.id || "—"}</td>
        <td>${_toNonNegativeInteger(participant.count, 0)}</td>
        <td>${participant.status || "—"}</td>
        <td>${userLabel}</td>
      </tr>`;
  }).join("");
}

function renderSorteioResults() {
  const tbody = document.getElementById("sorteio-results-tbody");
  if (!selectedSorteio) {
    tbody.innerHTML = `<tr><td colspan="3" style="text-align:center;color:#555;padding:24px">Selecione um sorteio para ver o histórico de resultados.</td></tr>`;
    return;
  }

  if (!selectedSorteioResults || selectedSorteioResults.length === 0) {
    tbody.innerHTML = `<tr><td colspan="3" style="text-align:center;color:#555;padding:24px">Nenhum resultado registrado para este sorteio.</td></tr>`;
    return;
  }

  tbody.innerHTML = selectedSorteioResults.map((result) => {
    const selectedBy = result.selectedBy?.email || result.selectedBy?.uid || "—";
    let winnerCell = "—";
    if (Array.isArray(result.winners) && result.winners.length) {
      winnerCell = result.winners.map((w) => w.uid || w.id || "—").join(", ");
    } else if (result.winner) {
      winnerCell = result.winner.uid || result.winner.id || "—";
    }
    const drawMeta = result.drawMeta || {};
    const drawVersion = drawMeta.drawVersion || "—";
    const roundLabel = result.roundNumber || drawMeta.drawNumber ? `#${result.roundNumber || drawMeta.drawNumber}` : "—";
    const selectionMode = drawMeta.selectionMode === "unique"
      ? "Única / sem repetição"
      : (drawMeta.selectionMode || "Padrão");
    return `
      <tr>
        <td>${_formatDateValue(result.createdAt)}</td>
        <td class="mono small">${roundLabel}</td>
        <td class="mono small">${winnerCell}</td>
        <td>${selectionMode}</td>
        <td>${selectedBy} <span style="color:#777">• ${drawVersion}</span></td>
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
  selectedSorteioResults = [];
  activeSorteioAdminTab = "resumo";
  renderSorteios();
  renderGeradorValidatedCodes();
  subscribeSorteioRealtime(id);
  fetchSelectedSorteioResults(id);
}

async function fetchSelectedSorteioResults(id) {
  if (!_isString(id)) {
    selectedSorteioResults = [];
    renderSorteioResults();
    return;
  }

  try {
    const result = await fetchSorteioResults(id, { limit: 20 });
    if (!result.success) {
      throw new Error(result.error || "Falha ao buscar histórico de resultados.");
    }
    selectedSorteioResults = result.data.items || [];
  } catch (error) {
    console.error("[ADMIN] Erro ao carregar histórico de resultados:", error);
    selectedSorteioResults = [];
  }
  renderSorteioResults();
  renderSorteioDetails();
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
    document.getElementById("sorteio-banner").value = sorteio.banner || sorteio.imagem || "";
    document.getElementById("sorteio-id-interno").value = sorteio.idInterno || "";
    document.getElementById("sorteio-destaque").checked = Boolean(sorteio.destaque);
    document.getElementById("sorteio-ordem").value = _toNonNegativeInteger(sorteio.ordem, 0);
    document.getElementById("sorteio-data-sorteio").value = sorteio.dataSorteio ? new Date(sorteio.dataSorteio.toDate ? sorteio.dataSorteio.toDate() : sorteio.dataSorteio).toISOString().slice(0, 16) : "";
    document.getElementById("sorteio-premio").value = sorteio.premio || "";
    document.getElementById("sorteio-regulamento").value = sorteio.regulamento || "";
    document.getElementById("sorteio-quantidade-ganhadores").value = _toNonNegativeInteger(sorteio.quantidadeGanhadores, 1);
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
    document.getElementById("sorteio-banner").value = "";
    document.getElementById("sorteio-id-interno").value = "";
    document.getElementById("sorteio-destaque").checked = false;
    document.getElementById("sorteio-ordem").value = "0";
    document.getElementById("sorteio-data-sorteio").value = "";
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
    renderSorteadorSorteiosSelect();
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
  selectedSorteioResults = [];
  activeSorteioAdminTab = "resumo";
  _unsubscribeSorteioListeners();
  currentParticipants = [];
  renderParticipants();
  renderSorteioDetails();
  renderSorteioResults();
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

window.reopenSorteioAdmin = async function (id) {
  if (!confirm(`Reabrir sorteio "${id}"?`)) return;
  try {
    const result = await editSorteio(id, { status: "programada" }, null);
    if (!result.success) throw new Error(result.error || "Falha ao reabrir.");
    showToast("Sorteio reaberto e colocado em programação.", "success");
    await refreshSorteios();
    if (selectedSorteioId === id) selectSorteio(id);
  } catch (err) {
    console.error("[ADMIN] Erro ao reabrir sorteio:", err);
    showToast(err.message || "Erro ao reabrir sorteio.", "error");
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
      selectedSorteioResults = [];
      currentParticipants = [];
      _unsubscribeSorteioListeners();
      renderSorteioDetails();
      renderParticipants();
      renderSorteioResults();
    }
    await refreshSorteios();
  } catch (err) {
    console.error("[ADMIN] Erro ao excluir sorteio:", err);
    showToast(err.message || "Erro ao excluir sorteio.", "error");
  }
};

window.drawWinnerSelected = async function () {
  if (!selectedSorteio) {
    showToast("Selecione um sorteio antes de sortear um vencedor.", "warn");
    return;
  }
  if (!currentParticipants.length) {
    showToast("Não há participantes disponíveis para este sorteio.", "warn");
    return;
  }

  try {
    const result = await pickSorteioWinner(selectedSorteio.id, null);
    if (!result.success) {
      throw new Error(result.error || "Falha ao sortear vencedor.");
    }
    selectedSorteioWinner = result.data?.winner || null;
    renderSorteioDetails();
    await fetchSelectedSorteioResults(selectedSorteio.id);
    showToast(`Vencedor oficial sorteado: ${selectedSorteioWinner?.uid || selectedSorteioWinner?.id}`, "success");
    await refreshSorteios();
    if (selectedSorteioId) selectSorteio(selectedSorteioId);
  } catch (err) {
    console.error("[ADMIN] Erro ao sortear vencedor:", err);
    showToast(err.message || "Erro ao sortear vencedor.", "error");
  }
};

window.rerollWinnerSelected = async function () {
  if (!selectedSorteio) {
    showToast("Selecione um sorteio antes de refazer o sorteio.", "warn");
    return;
  }
  if (!currentParticipants.length) {
    showToast("Não há participantes disponíveis para refazer o sorteio.", "warn");
    return;
  }

  try {
    const result = await pickSorteioWinner(selectedSorteio.id, null);
    if (!result.success) {
      throw new Error(result.error || "Falha ao refazer o sorteio.");
    }
    selectedSorteioWinner = result.data?.winner || null;
    renderSorteioDetails();
    await fetchSelectedSorteioResults(selectedSorteio.id);
    showToast(`Novo vencedor oficial: ${selectedSorteioWinner?.uid || selectedSorteioWinner?.id}`, "success");
    await refreshSorteios();
    if (selectedSorteioId) selectSorteio(selectedSorteioId);
  } catch (err) {
    console.error("[ADMIN] Erro ao refazer o sorteio:", err);
    showToast(err.message || "Erro ao refazer o sorteio.", "error");
  }
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
    const payloadFromForm = buildSorteioPayloadFromForm();
    if (!payloadFromForm.titulo) {
      throw new Error("Título é obrigatório.");
    }

    let imagem = null;
    if (selectedImageFile) {
      imagem = await uploadSorteioImage(selectedImageFile);
    } else if (selectedImagePreviewUrl && selectedSorteio && selectedSorteio.imagem) {
      imagem = selectedSorteio.imagem;
    }

    const payload = {
      ...payloadFromForm,
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

// ─── Operações: Códigos ──────────────────────────────────────────────────────
window.cancelCode = async function (codeId) {
  if (!confirm(`Cancelar código "${codeId}"? Isto marcará como inativo.`)) return;
  try {
    await updateDoc(doc(db, VIP_CODES_COL, codeId), {
      status: "inativo",
      updatedAt: serverTimestamp()
    });
    showToast(`Código "${codeId}" cancelado (inativo).`, "success");
  } catch (err) {
    console.error("[ADMIN] Erro ao cancelar código:", err);
    showToast(`Erro ao cancelar código: ${err.message}`, "error");
  }
};

window.deleteCode = async function (codeId) {
  if (!confirm(`Excluir código "${codeId}" permanentemente? Esta ação não pode ser desfeita.`)) return;
  try {
    await deleteDoc(doc(db, VIP_CODES_COL, codeId));
    showToast(`Código "${codeId}" excluído permanentemente.`, "success");
  } catch (err) {
    console.error("[ADMIN] Erro ao excluir código:", err);
    showToast(`Erro ao excluir código: ${err.message}`, "error");
  }
};

window.resetCode = async function (codeId) {
  if (!confirm(`Resetar código "${codeId}"? Marcará como livre novamente.`)) return;
  try {
    await updateDoc(doc(db, VIP_CODES_COL, codeId), {
      usado: false,
      used: false,
      usadoPor: null,
      activatedBy: null,
      dataUso: null,
      activatedAt: null,
      status: "ativo",
      updatedAt: serverTimestamp()
    });
    showToast(`Código "${codeId}" resetado para livre.`, "success");
  } catch (err) {
    console.error("[ADMIN] Erro ao resetar código:", err);
    showToast(`Erro ao resetar código: ${err.message}`, "error");
  }
};

window.refreshSorteios = refreshSorteios;

window.exportSorteioParticipantsCsv = function () {
  if (!selectedSorteio) {
    showToast("Selecione um sorteio antes de exportar.", "warn");
    return;
  }
  const rows = (currentParticipants || [])
    .filter((participant) => {
      if (!sorteioParticipantsSearch.trim()) return true;
      const haystack = [participant.uid, participant.id, participant.nome, participant.name, participant.email, participant.displayName, participant.userName, participant.userEmail]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(sorteioParticipantsSearch.trim().toLowerCase());
    })
    .map((participant) => ({
      uid: participant.uid || participant.id || "",
      nome: participant.nome || participant.name || participant.displayName || participant.userName || "",
      email: participant.email || participant.userEmail || "",
      count: _toNonNegativeInteger(participant.count, 0),
      status: participant.status || "",
      ultimaParticipacao: _formatDateValue(participant.lastParticipationAt || participant.createdAt),
    }));

  const header = ["uid", "nome", "email", "count", "status", "ultimaParticipacao"];
  const csv = [header.join(",")].concat(rows.map((row) => header.map((key) => `"${String(row[key] ?? "").replace(/"/g, '""')}"`).join(","))).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `participantes-${selectedSorteio.id || "sorteio"}.csv`;
  link.click();
  URL.revokeObjectURL(url);
};

window.switchSorteioAdminTab = function (tab) {
  activeSorteioAdminTab = tab;
  renderSorteioAdminTabs();
};

window.sorteioImageInputChanged = function (event) {
  const file = event.target.files && event.target.files[0] ? event.target.files[0] : null;
  selectedImageFile = file;
  setSorteioImagePreview(file);
};

async function refresh() {
  try {
    await Promise.all([
      fetchCodes(),
      fetchUsers(),
      fetchPromotions(),
      fetchProdutosAntecipados(),
      fetchValidatedGeradorCodes(),
    ]);
  } catch (err) {
    console.error("[ADMIN] Erro ao atualizar dados:", err?.code, err?.message, err);
  } finally {
    renderStats();
    renderCodes();
    renderUsers();
    renderPromotions();
    window.renderizarProdutosAntecipados();
    await refreshSorteios();
    renderSorteadorSorteiosSelect();
    renderGeradorValidatedCodes();
    updateLastRefresh();
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
    const userRef = doc(db, USERS_COL, uid);
    try {
      const before = await getDoc(userRef);
      console.trace('[TRACE] renewUser before write', { uid });
      console.log('[TRACE] renewUser before vip5Active:', before.exists() ? before.data().vip5Active : undefined);
    } catch (e) {
      console.warn('[TRACE] renewUser before read failed', e);
    }
    await updateDoc(userRef, {
      vip5Active:    true,
      vip5ExpiresAt: newExpires
    });
    try {
      const after = await getDoc(userRef);
      console.log('[TRACE] renewUser after vip5Active:', after.exists() ? after.data().vip5Active : undefined);
      console.trace('[TRACE] renewUser write stack');
    } catch (e) {
      console.warn('[TRACE] renewUser after read failed', e);
    }
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
    const userRef = doc(db, USERS_COL, uid);
    console.trace('[TRACE] removeUserVip entry', { uid });
    try {
      const before = await getDoc(userRef);
      console.log('[TRACE] removeUserVip before vip5Active:', before.exists() ? before.data().vip5Active : undefined);
    } catch (e) {
      console.warn('[TRACE] removeUserVip before read failed', e);
    }
    await updateDoc(userRef, { vip5Active: false });
    try {
      const after = await getDoc(userRef);
      console.log('[TRACE] removeUserVip after vip5Active:', after.exists() ? after.data().vip5Active : undefined);
      console.trace('[TRACE] removeUserVip write stack');
    } catch (e) {
      console.warn('[TRACE] removeUserVip after read failed', e);
    }
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

async function fetchProdutosAntecipados() {
  try {
    const snap = await getDocs(collection(db, PRODUTOS_ANTECIPADOS_COL));
    allProdutosAntecipados = snap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .sort((a, b) => {
        const ordemA = Number(a.ordem ?? 0);
        const ordemB = Number(b.ordem ?? 0);
        if (ordemB !== ordemA) return ordemB - ordemA;
        const criadoA = a.criadoEm ? a.criadoEm.toMillis ? a.criadoEm.toMillis() : new Date(a.criadoEm).getTime() : 0;
        const criadoB = b.criadoEm ? b.criadoEm.toMillis ? b.criadoEm.toMillis() : new Date(b.criadoEm).getTime() : 0;
        return criadoB - criadoA;
      });
  } catch (err) {
    console.error('[ADMIN] Erro ao carregar produtos antecipados:', err);
    allProdutosAntecipados = [];
  }
}

window.carregarProdutosAntecipados = async function () {
  console.log('[ADMIN] carregarProdutosAntecipados: inicializando produtos antecipados.');
  await fetchProdutosAntecipados();
  window.renderizarProdutosAntecipados();
};

window.renderizarProdutosAntecipados = function () {
  const tbody = document.getElementById('produtos-antecipados-tbody');
  if (!tbody) return;

  const filtered = allProdutosAntecipados.filter(p => {
    if (!produtosSearchTerm) return true;
    const needle = produtosSearchTerm.toLowerCase();
    return String(p.nome || '').toLowerCase().includes(needle)
      || String(p.codigo || '').toLowerCase().includes(needle);
  });

  if (!filtered.length) {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;color:#555;padding:24px">Nenhum produto antecipado disponível.</td></tr>`;
  } else {
    tbody.innerHTML = filtered.map(produto => {
      const status = produto.ativo ? 'Ativo' : 'Inativo';
      const preco = Number(produto.preco || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
      const dataPrevista = produto.dataPublicacao
        ? (produto.dataPublicacao.toDate ? produto.dataPublicacao.toDate() : new Date(produto.dataPublicacao)).toLocaleDateString('pt-BR')
        : '—';

      return `
        <tr>
          <td>${produto.codigo || '—'}</td>
          <td>${produto.nome || '—'}</td>
          <td>${status}</td>
          <td>${preco}</td>
          <td>${dataPrevista}</td>
          <td>
            <button class="btn btn-sm btn-outline" type="button" onclick="editarProdutoAntecipado('${produto.id}')">Editar</button>
            <button class="btn btn-sm btn-delete" type="button" onclick="excluirProdutoAntecipado('${produto.id}')">Excluir</button>
          </td>
        </tr>`;
    }).join('');
  }

  document.getElementById('produtos-stat-total').textContent = allProdutosAntecipados.length.toString();
  document.getElementById('produtos-stat-publicados').textContent = allProdutosAntecipados.filter(p => p.ativo).length.toString();
  document.getElementById('produtos-stat-pendentes').textContent = allProdutosAntecipados.filter(p => !p.ativo).length.toString();
  document.getElementById('produtos-stat-atualizados').textContent = allProdutosAntecipados.filter(p => p.atualizadoEm).length.toString();
};

function getProdutoAntecipadoFormValues() {
  const parseDate = (value) => value ? new Date(value) : null;
  const imagensRaw = document.getElementById('produto-antecipado-imagens')?.value || '';
  return {
    id: document.getElementById('produto-antecipado-id')?.value || '',
    codigo: document.getElementById('produto-antecipado-codigo')?.value.trim(),
    nome: document.getElementById('produto-antecipado-nome')?.value.trim(),
    descricao: document.getElementById('produto-antecipado-descricao')?.value.trim(),
    categoria: document.getElementById('produto-antecipado-categoria')?.value.trim(),
    marca: document.getElementById('produto-antecipado-marca')?.value.trim(),
    sku: document.getElementById('produto-antecipado-sku')?.value.trim(),
    imagemPrincipal: document.getElementById('produto-antecipado-imagem-principal')?.value.trim(),
    imagens: imagensRaw.split(',').map(x => x.trim()).filter(x => x),
    preco: parseFloat(document.getElementById('produto-antecipado-preco')?.value || 0),
    precoPromocional: parseFloat(document.getElementById('produto-antecipado-preco-promocional')?.value || 0),
    desconto: parseFloat(document.getElementById('produto-antecipado-desconto')?.value || 0),
    estoque: parseInt(document.getElementById('produto-antecipado-estoque')?.value || 0, 10),
    estoqueMinimo: parseInt(document.getElementById('produto-antecipado-estoque-minimo')?.value || 0, 10),
    ativo: document.getElementById('produto-antecipado-ativo')?.checked === true,
    destaque: document.getElementById('produto-antecipado-destaque')?.checked === true,
    exclusivoVip5: document.getElementById('produto-antecipado-exclusivo-vip5')?.checked === true,
    dataPublicacao: parseDate(document.getElementById('produto-antecipado-data-publicacao')?.value),
    dataExpiracao: parseDate(document.getElementById('produto-antecipado-data-expiracao')?.value),
    categoriaInfo: {
      nome: document.getElementById('produto-antecipado-categoria')?.value.trim(),
      cor: document.getElementById('produto-antecipado-categoria-cor')?.value.trim(),
      icone: document.getElementById('produto-antecipado-categoria-icone')?.value.trim(),
    },
    configuracao: {
      permitirCompra: true,
      permitirReserva: false,
      exibirEstoque: true,
      exibirPreco: true,
      exibirDesconto: true,
    },
    ordem: parseInt(document.getElementById('produto-antecipado-ordem')?.value || 0, 10),
  };
}

function validateProdutoAntecipado(data) {
  if (!data.codigo) return 'O campo Código é obrigatório.';
  if (!data.nome) return 'O campo Nome do produto é obrigatório.';
  if (!data.categoria) return 'O campo Categoria é obrigatório.';
  if (!data.marca) return 'O campo Marca é obrigatório.';
  if (!Number.isFinite(data.preco) || data.preco <= 0) return 'O campo Preço deve ser maior que zero.';
  if (!Number.isFinite(data.estoque) || data.estoque < 0) return 'O campo Estoque deve ser zero ou maior.';
  return null;
}

window.abrirModalProdutoAntecipado = function () {
  resetProdutoAntecipadoForm();
  const formCard = document.getElementById('produto-antecipado-form-card');
  if (formCard) {
    formCard.classList.remove('hidden');
    formCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
};

window.fecharModalProdutoAntecipado = function () {
  const formCard = document.getElementById('produto-antecipado-form-card');
  if (formCard) {
    formCard.classList.add('hidden');
  }
};

function resetProdutoAntecipadoForm() {
  document.getElementById('produto-antecipado-form-title').textContent = 'Novo Produto Antecipado';
  document.getElementById('produto-antecipado-id').value = '';
  document.getElementById('produto-antecipado-codigo').value = '';
  document.getElementById('produto-antecipado-nome').value = '';
  document.getElementById('produto-antecipado-descricao').value = '';
  document.getElementById('produto-antecipado-categoria').value = '';
  document.getElementById('produto-antecipado-marca').value = '';
  document.getElementById('produto-antecipado-sku').value = '';
  document.getElementById('produto-antecipado-imagem-principal').value = '';
  document.getElementById('produto-antecipado-imagens').value = '';
  document.getElementById('produto-antecipado-preco').value = '';
  document.getElementById('produto-antecipado-preco-promocional').value = '';
  document.getElementById('produto-antecipado-desconto').value = '';
  document.getElementById('produto-antecipado-ordem').value = '0';
  document.getElementById('produto-antecipado-estoque').value = '0';
  document.getElementById('produto-antecipado-estoque-minimo').value = '0';
  document.getElementById('produto-antecipado-data-publicacao').value = '';
  document.getElementById('produto-antecipado-data-expiracao').value = '';
  document.getElementById('produto-antecipado-categoria-cor').value = '';
  document.getElementById('produto-antecipado-categoria-icone').value = '';
  document.getElementById('produto-antecipado-ativo').checked = false;
  document.getElementById('produto-antecipado-destaque').checked = false;
  document.getElementById('produto-antecipado-exclusivo-vip5').checked = false;
}

window.editarProdutoAntecipado = function (id) {
  const produto = allProdutosAntecipados.find(p => p.id === id);
  if (!produto) return;

  document.getElementById('produto-antecipado-form-title').textContent = 'Editar Produto Antecipado';
  document.getElementById('produto-antecipado-id').value = produto.id || '';
  document.getElementById('produto-antecipado-codigo').value = produto.codigo || '';
  document.getElementById('produto-antecipado-nome').value = produto.nome || '';
  document.getElementById('produto-antecipado-descricao').value = produto.descricao || '';
  document.getElementById('produto-antecipado-categoria').value = produto.categoria || '';
  document.getElementById('produto-antecipado-marca').value = produto.marca || '';
  document.getElementById('produto-antecipado-sku').value = produto.sku || '';
  document.getElementById('produto-antecipado-imagem-principal').value = produto.imagemPrincipal || '';
  document.getElementById('produto-antecipado-imagens').value = (produto.imagens || []).join(', ');
  document.getElementById('produto-antecipado-preco').value = produto.preco || '';
  document.getElementById('produto-antecipado-preco-promocional').value = produto.precoPromocional || '';
  document.getElementById('produto-antecipado-desconto').value = produto.desconto || '';
  document.getElementById('produto-antecipado-ordem').value = produto.ordem || '0';
  document.getElementById('produto-antecipado-estoque').value = produto.estoque || '0';
  document.getElementById('produto-antecipado-estoque-minimo').value = produto.estoqueMinimo || '0';
  document.getElementById('produto-antecipado-data-publicacao').value = produto.dataPublicacao ? (produto.dataPublicacao.toDate ? produto.dataPublicacao.toDate().toISOString().slice(0,16) : new Date(produto.dataPublicacao).toISOString().slice(0,16)) : '';
  document.getElementById('produto-antecipado-data-expiracao').value = produto.dataExpiracao ? (produto.dataExpiracao.toDate ? produto.dataExpiracao.toDate().toISOString().slice(0,16) : new Date(produto.dataExpiracao).toISOString().slice(0,16)) : '';
  document.getElementById('produto-antecipado-categoria-cor').value = produto.categoriaInfo?.cor || '';
  document.getElementById('produto-antecipado-categoria-icone').value = produto.categoriaInfo?.icone || '';
  document.getElementById('produto-antecipado-ativo').checked = produto.ativo === true;
  document.getElementById('produto-antecipado-destaque').checked = produto.destaque === true;
  document.getElementById('produto-antecipado-exclusivo-vip5').checked = produto.exclusivoVip5 === true;

  const formCard = document.getElementById('produto-antecipado-form-card');
  if (formCard) {
    formCard.classList.remove('hidden');
    formCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
};

window.excluirProdutoAntecipado = async function (id) {
  if (!confirm('Excluir este produto antecipado?')) return;
  try {
    await deleteDoc(doc(db, PRODUTOS_ANTECIPADOS_COL, id));
    await window.carregarProdutosAntecipados();
  } catch (err) {
    console.error('[ADMIN] Erro ao excluir produto antecipado:', err);
    alert('Erro ao excluir produto antecipado. Veja console para detalhes.');
  }
};

window.pesquisarProdutosAntecipados = function () {
  const input = document.getElementById('produtos-search-input');
  produtosSearchTerm = input ? input.value.trim().toLowerCase() : '';
  console.log('[ADMIN] pesquisarProdutosAntecipados:', produtosSearchTerm);
  window.renderizarProdutosAntecipados();
};

window.atualizarProdutosAntecipados = function () {
  console.log('[ADMIN] atualizarProdutosAntecipados: atualizar dados de produtos antecipados.');
  window.carregarProdutosAntecipados();
};

window.salvarProdutoAntecipado = async function () {
  const data = getProdutoAntecipadoFormValues();
  const validationError = validateProdutoAntecipado(data);
  if (validationError) {
    alert(validationError);
    return;
  }

  const payload = {
    codigo: data.codigo,
    nome: data.nome,
    descricao: data.descricao,
    categoria: data.categoria,
    marca: data.marca,
    sku: data.sku || null,
    imagemPrincipal: data.imagemPrincipal || null,
    imagens: data.imagens,
    preco: data.preco,
    precoPromocional: data.precoPromocional || 0,
    desconto: data.desconto || 0,
    estoque: data.estoque,
    estoqueMinimo: data.estoqueMinimo || 0,
    ativo: data.ativo,
    destaque: data.destaque,
    exclusivoVip5: data.exclusivoVip5,
    dataPublicacao: data.dataPublicacao,
    dataExpiracao: data.dataExpiracao,
    atualizadoPor: null,
    ordem: data.ordem || 0,
    categoriaInfo: data.categoriaInfo,
    configuracao: data.configuracao,
  };

  const submitBtn = document.getElementById('produto-antecipado-submit-btn');
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.textContent = data.id ? 'Salvando...' : 'Cadastrando...';
  }

  try {
    if (data.id) {
      await updateDoc(doc(db, PRODUTOS_ANTECIPADOS_COL, data.id), {
        ...payload,
        atualizadoEm: serverTimestamp(),
      });
    } else {
      const produtoRef = doc(collection(db, PRODUTOS_ANTECIPADOS_COL));
      await setDoc(produtoRef, {
        ...payload,
        id: produtoRef.id,
        criadoEm: serverTimestamp(),
        atualizadoEm: serverTimestamp(),
      });
    }

    await window.carregarProdutosAntecipados();
    resetProdutoAntecipadoForm();
    window.fecharModalProdutoAntecipado();
  } catch (err) {
    console.error('[ADMIN] Erro ao salvar produto antecipado:', err);
    alert('Erro ao salvar produto antecipado. Veja console para detalhes.');
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Salvar';
    }
  }
}

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
  const lines = allCodes.map(c => c.codigo || c.code || c.id).join("\n");
  download("vip5_codigos.txt", lines);
};

window.exportJson = function () {
  const data = allCodes.map(c => ({
    codigo:      c.codigo || c.code || c.id,
    uid:         c.uid || null,
    sorteioId:   c.sorteioId || null,
    dias:        c.days || null,
    status:      c.status || "ativo",
    usado:       c.used || c.usado || false,
    usadoPor:    c.usadoPor || c.activatedBy || null,
    dataCriacao: c.dataCriacao || c.createdAt || null,
    dataUso:     c.dataUso || c.activatedAt || null
  }));
  download("vip5_codigos.json", JSON.stringify(data, null, 2));
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
  
  const days        = parseInt(document.getElementById("gen-days").value, 10);
  const qty         = parseInt(document.getElementById("gen-qty").value, 10);
  const prefix      = document.getElementById("gen-prefix").value.trim().toUpperCase();
  const uid         = document.getElementById("gen-uid").value.trim() || null;
  const sorteioId   = document.getElementById("gen-sorteio-id").value.trim() || null;
  const status      = document.getElementById("gen-status");

  if (!days || days < 1) { 
    alert("Informe a quantidade de dias."); 
    return; 
  }
  if (!qty || qty < 1 || qty > 500) { 
    alert("Quantidade deve ser entre 1 e 500."); 
    return; 
  }

  const btn = document.getElementById("gen-btn");
  btn.disabled = true;
  btn.textContent = "Gerando...";
  status.textContent = "";

  try {
    if (!prefix && !uid && !sorteioId) {
      throw new Error("Preencha ao menos um dos campos: Prefixo, UID ou ID do Sorteio.");
    }
    
    const existingSet = allCodes.map(c => c.codigo || c.code || c.id);
    
    console.log("[ADMIN] Gerando códigos com:", { qty, days, prefix, uid, sorteioId });
    
    const newCodes = await generateVipCodes({
      prefix,
      qty,
      days,
      uid: uid || null,
      sorteioId: sorteioId || null,
      existingCodes: existingSet
    });

    if (!Array.isArray(newCodes) || newCodes.length === 0) {
      throw new Error("Nenhum código foi gerado. Verifique os parâmetros.");
    }

    console.log("[ADMIN] Códigos gerados com sucesso:", newCodes);
    status.textContent = `✓ ${newCodes.length} código(s) gerado(s) com sucesso!`;
    status.style.color = "#27ae60";
    
    // Limpar campos
    document.getElementById("gen-days").value = "30";
    document.getElementById("gen-qty").value = "1";
    document.getElementById("gen-prefix").value = "";
    document.getElementById("gen-uid").value = "";
    document.getElementById("gen-sorteio-id").value = "";
    
    await refresh();
  } catch (err) {
    console.error("[ADMIN] Erro ao gerar códigos:", err.code, err.message, err);
    status.textContent = "Erro: " + (err.message || "Falha desconhecida. Verifique o console.");
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
  const limiteTotal = parseInt(document.getElementById("promo-limite-total").value, 10) || 0;
  const dataVip   = document.getElementById("promo-data-vip").value;
  const dataPub   = document.getElementById("promo-data-publica").value;
  const dataFim   = document.getElementById("promo-data-final").value;
  const inicio    = document.getElementById("promo-inicio").value;
  const fim       = document.getElementById("promo-fim").value;
  const statusSel = document.getElementById("promo-status-sel").value;
  const statusEl  = document.getElementById("promo-status");
  const descricao = document.getElementById("promo-descricao").value.trim();
  const tipoDesconto = document.getElementById("promo-tipo-desconto").value;
  const valorDesconto = parseFloat(document.getElementById("promo-valor-desconto").value) || 0;
  const vipMinimo = parseInt(document.getElementById("promo-vip-minimo").value, 10) || 0;
  const permitirCupom = document.getElementById("promo-permitir-cupom").value === "true";

  if (!titulo) { alert("Título é obrigatório."); return; }

  const btn = document.getElementById("promo-btn");
  btn.disabled    = true;
  btn.textContent = promoEditId ? "Salvando..." : "Criando...";
  statusEl.textContent = "";

  const payload = {
    titulo,
    descricao,
    quantidade:       qty,
    limitePorUsuario: limite,
    limiteTotal,
    tipoDesconto,
    valorDesconto,
    inicio:           inicio ? new Date(inicio) : null,
    fim:              fim ? new Date(fim) : null,
    status:           statusSel || "programada",
    dataVip:          dataVip   ? new Date(dataVip)   : null,
    dataPublica:      dataPub   ? new Date(dataPub)   : null,
    dataFinal:        dataFim   ? new Date(dataFim)   : null,
    vipMinimo,
    permitirCupom,
    produtosSelecionados: selectedPromoProdutoIds,
  };

  try {
    let result;
    if (promoEditId) {
      result = await editPromotion(promoEditId, payload, null);
      if (!result.success) throw new Error(result.error);
      statusEl.textContent = `✓ Promoção "${titulo}" atualizada!`;
    } else {
      result = await createPromotion(payload, null);
      if (!result.success) throw new Error(result.error);
      statusEl.textContent = `✓ Promoção "${titulo}" criada!`;
    }

    statusEl.style.color = "#27ae60";
    await refresh();
    cancelPromoEdit();
  } catch (err) {
    console.error("[ADMIN] Erro ao processar promoção:", err.message, err);
    statusEl.textContent = "Erro: " + err.message;
    statusEl.style.color = "#e74c3c";
  } finally {
    btn.disabled    = false;
    btn.textContent = promoEditId ? "Salvar edição" : "Criar promoção";
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

  const sorteioParticipantsSearchInput = document.getElementById("sorteio-participants-search");
  if (sorteioParticipantsSearchInput) {
    sorteioParticipantsSearchInput.addEventListener("input", (e) => {
      sorteioParticipantsSearch = e.target.value.trim().toLowerCase();
      renderParticipants();
    });
  }

  const sorteioForm = document.getElementById("sorteio-form");
  if (sorteioForm) {
    sorteioForm.addEventListener("submit", handleSorteioFormSubmit);
  }

  renderStats();
  renderCodes();
  renderUsers();
  renderPromotions();
  renderGeradorValidatedCodes();
  renderSorteios();
  renderSorteioDetails();
  renderParticipants();
  renderSorteioResults();
  window.renderizarProdutosAntecipados();

  renderSorteadorSorteiosSelect();
  updateSorteadorSummary();
  renderSorteadorResultado();
  renderSorteadorVencedoresSessao();
  await renderSorteadorHistorico();

  await refresh();
  
  // Ativar atualização em tempo real para códigos
  subscribeToCodesRealtime();
  subscribeToGeradorCodesRealtime();
  
  console.log("[ADMIN] Dados carregados. Códigos com atualização em tempo real ativa.");
});
