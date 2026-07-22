/**
 * vip5-promocoes-storage.js  — VERSÃO CORRIGIDA
 * Firebase Modular SDK — mesmo padrão de vip5.js, admin.js, vip5-storage.js
 *
 * CORREÇÃO APLICADA (FirebaseError: The query requires an index):
 *   As funções fetchVisiblePromotions, fetchAllPromotions, fetchParticipations
 *   e fetchLogs usavam combinações de where() + orderBy() em campos diferentes,
 *   o que exige índices compostos no Firestore.
 *
 *   Solução definitiva: o orderBy() foi removido das queries do Firestore.
 *   A ordenação agora é feita client-side (sort() em JS), mantendo 100%
 *   da funcionalidade sem necessidade de índices compostos.
 *
 *   Caso queira reativar a ordenação server-side com paginação por cursor,
 *   faça o deploy do arquivo firestore.indexes.json fornecido junto.
 *
 * Coleções Firestore:
 *   vip5_promocoes                  — documentos de promoção
 *   vip5_promocoes_participantes   — participações (ID: {promoId}_{uid})
 *   vip5_promocoes_logs            — auditoria de ações admin
 */

import { db } from "./vip5-firebase.js";
import {
  collection,
  doc,
  getDoc,
  addDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  limit,
  startAfter,
  getDocs,
  runTransaction,
  serverTimestamp,
  increment,
  Timestamp,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// ─── Constantes ───────────────────────────────────────────────────────────────
const COL_PROMOS  = "vip5_promocoes";
const COL_PARTS   = "vip5_promocoes_participantes";
const COL_USES    = "vip5_promocoes_usos";
const COL_LOGS    = "vip5_promocoes_logs";
const MODULE      = "vip5_promocoes";
const DEF_LIMIT   = 20;
const MAX_LIMIT   = 200;

export const STATUS = Object.freeze({
  PROGRAMADA: "programada",
  ATIVA:      "ativa",
  PAUSADA:    "pausada",
  ENCERRADA:  "encerrada",
});

// ─── Retorno padronizado ──────────────────────────────────────────────────────
function _ok(data)    { return { success: true,  data,  error: null }; }
function _err(msg, e) {
  const message = msg || (e && e.message) || "Erro desconhecido.";
  console.error("[Vip5PromocoesStorage]", message, e || "");
  return { success: false, data: null, error: message };
}

// ─── Utilitários ──────────────────────────────────────────────────────────────
function _toTimestamp(value) {
  if (!value) return null;
  if (value instanceof Timestamp) return value;
  if (value && typeof value.toDate === "function") return value;
  const d = value instanceof Date ? value : new Date(value);
  return isNaN(d.getTime()) ? null : Timestamp.fromDate(d);
}

function _toDate(value) {
  if (!value) return null;
  if (typeof value.toDate === "function") return value.toDate();
  if (value instanceof Date) return value;
  const d = new Date(value);
  return isNaN(d.getTime()) ? null : d;
}

function _serialize(snap) {
  if (!snap || !snap.exists()) return null;
  return { id: snap.id, ...snap.data() };
}

function _safeLimit(n) {
  return Math.min(Math.max(1, Number(n) || DEF_LIMIT), MAX_LIMIT);
}

function _stripUndef(obj) {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined));
}

function _getPromoCapacity(promo) {
  const limiteTotal = Number(promo?.limiteTotal) || 0;
  if (limiteTotal > 0) return limiteTotal;
  return Number(promo?.quantidade) || 0;
}

function _getPromoUsage(promo) {
  return Number(promo?.utilizacoes ?? promo?.participacoes ?? 0) || 0;
}

function _matchSelectedProducts(promo, productId) {
  const selected = Array.isArray(promo?.produtosSelecionados)
    ? promo.produtosSelecionados.filter(Boolean)
    : [];
  if (!selected.length) return true;
  if (!productId) return true;
  const target = String(productId);
  return selected.some((item) => String(item) === target);
}

function _getPromoDiscountAmount(promo, amount) {
  const baseAmount = Number(amount || 0);
  if (!promo || baseAmount <= 0) return 0;
  const value = Number(promo?.valorDesconto || 0);
  if (promo?.tipoDesconto === "fixo") {
    return Math.min(baseAmount, value);
  }
  return Math.min(baseAmount, (baseAmount * value) / 100);
}

function _getUserPromoUsageCount(partSnap, useSnap) {
  return Math.max(
    Number(partSnap?.exists?.() ? partSnap.data().count : 0) || 0,
    Number(useSnap?.exists?.() ? useSnap.data().count : 0) || 0,
  );
}

function _buildPromoEligibility(promo, { uid, vipData = null, productId = null, amount = 0, currentUsageCount = 0, now = new Date() } = {}) {
  if (!promo) return { eligible: false, reason: "Promoção inválida." };

  if (promo.status !== STATUS.ATIVA) {
    return { eligible: false, reason: `Promoção não está ativa (status: ${promo.status}).` };
  }

  if (promo.inicio) {
    const inicio = _toDate(promo.inicio);
    if (inicio && inicio > now) return { eligible: false, reason: "Promoção ainda não começou." };
  }

  const end = _toDate(promo.fim ?? promo.dataFinal);
  if (end && end < now) return { eligible: false, reason: "Promoção expirada." };

  if (promo.dataVip) {
    const vipDate = _toDate(promo.dataVip);
    if (vipDate && vipDate > now) {
      const pubDate = promo.dataPublica ? _toDate(promo.dataPublica) : null;
      if (!pubDate || pubDate > now) {
        return { eligible: false, reason: "Promoção ainda não foi liberada." };
      }
    }
  }

  if (!promo.dataVip && promo.dataPublica) {
    const pubDate = _toDate(promo.dataPublica);
    if (pubDate && pubDate > now) {
      if (!_isVipActive(vipData)) {
        return { eligible: false, reason: "Promoção ainda não liberada ao público." };
      }
    }
  }

  if (promo.vipMinimo > 0) {
    const vipLevel = _getVipLevel(vipData);
    if (!_isVipActive(vipData) || vipLevel < Number(promo.vipMinimo)) {
      return { eligible: false, reason: `Promoção exige VIP nível ${promo.vipMinimo}.` };
    }
  }

  if (productId && !_matchSelectedProducts(promo, productId)) {
    return { eligible: false, reason: "Esta promoção não é válida para este produto." };
  }

  const qty = _getPromoCapacity(promo);
  const parts = _getPromoUsage(promo);
  if (qty > 0 && parts >= qty) {
    return { eligible: false, reason: "Vagas esgotadas." };
  }

  const limite = Number(promo.limitePorUsuario) || 1;
  if (limite > 0 && currentUsageCount >= limite) {
    return { eligible: false, reason: `Limite atingido: você já utilizou esta promoção ${currentUsageCount}x (máximo: ${limite}x).` };
  }

  const discountAmount = _getPromoDiscountAmount(promo, amount);
  const finalAmount = Math.max(0, Number(amount || 0) - discountAmount);

  return {
    eligible: true,
    reason: null,
    discountAmount,
    finalAmount,
  };
}

function _isVipActive(vipData) {
  return vipData?.vip5Active === true && (!vipData?.vip5ExpiresAt || vipData.vip5ExpiresAt > Date.now());
}

function _getVipLevel(vipData) {
  if (!vipData) return 0;
  const value = Number(vipData.nivelVip ?? vipData.vipNivel ?? vipData.vipLevel ?? vipData.level ?? 0);
  return Number.isFinite(value) ? value : 0;
}

/**
 * Converte qualquer representação de timestamp para milissegundos (number).
 * Usado para ordenação client-side sem depender de Firestore Timestamps.
 */
function _toMs(value) {
  if (!value) return 0;
  if (typeof value.toMillis === "function") return value.toMillis();
  if (typeof value.toDate === "function") return value.toDate().getTime();
  if (typeof value === "number") return value;
  if (typeof value === "object" && typeof value.seconds === "number") {
    return value.seconds * 1000 + Math.floor((value.nanoseconds || 0) / 1e6);
  }
  const d = new Date(value);
  return isNaN(d.getTime()) ? 0 : d.getTime();
}

// ─── Validação ────────────────────────────────────────────────────────────────
function _validate(payload, isCreate = true) {
  const errors = [];

  if (isCreate && (!payload.titulo || String(payload.titulo).trim() === "")) {
    errors.push('Campo obrigatório: "titulo".');
  }
  if (payload.titulo && String(payload.titulo).trim().length > 200) {
    errors.push('"titulo" não pode exceder 200 caracteres.');
  }
  if (payload.quantidade !== undefined) {
    const q = Number(payload.quantidade);
    if (isNaN(q) || q < 0) errors.push('"quantidade" deve ser número não-negativo.');
  }
  if (payload.limitePorUsuario !== undefined) {
    const l = Number(payload.limitePorUsuario);
    if (isNaN(l) || l < 0) errors.push('"limitePorUsuario" deve ser número não-negativo.');
  }
  if (payload.limiteTotal !== undefined) {
    const l = Number(payload.limiteTotal);
    if (isNaN(l) || l < 0) errors.push('"limiteTotal" deve ser número não-negativo.');
  }
  if (payload.valorDesconto !== undefined) {
    const v = Number(payload.valorDesconto);
    if (isNaN(v) || v < 0) errors.push('"valorDesconto" deve ser número não-negativo.');
  }
  if (payload.vipMinimo !== undefined) {
    const v = Number(payload.vipMinimo);
    if (isNaN(v) || v < 0) errors.push('"vipMinimo" deve ser número não-negativo.');
  }
  if (payload.status !== undefined && !Object.values(STATUS).includes(payload.status)) {
    errors.push(`"status" inválido. Use: ${Object.values(STATUS).join(", ")}.`);
  }

  const vip = _toDate(payload.dataVip);
  const pub = _toDate(payload.dataPublica);
  const end = _toDate(payload.dataFinal);
  const start = _toDate(payload.inicio);
  const finish = _toDate(payload.fim);

  if (vip && pub && vip > pub)  errors.push('"dataVip" deve ser ≤ "dataPublica".');
  if (pub && end && pub > end)  errors.push('"dataPublica" deve ser ≤ "dataFinal".');
  if (vip && end && vip > end)  errors.push('"dataVip" deve ser ≤ "dataFinal".');
  if (start && finish && start > finish) errors.push('"inicio" deve ser ≤ "fim".');

  if (errors.length > 0) throw new Error(errors.join(" | "));
}

// ─── Logs de auditoria ────────────────────────────────────────────────────────
async function _log(entry) {
  try {
    await addDoc(collection(db, COL_LOGS), _stripUndef({
      module:     MODULE,
      action:     entry.action     || "unknown",
      promoId:    entry.promoId    || null,
      before:     entry.before     || null,
      after:      entry.after      || null,
      adminUid:   entry.adminUid   || null,
      adminEmail: entry.adminEmail || null,
      message:    entry.message    || null,
      timestamp:  serverTimestamp(),
      criadoEm:   serverTimestamp(),
    }));
  } catch (err) {
    console.warn("[Vip5PromocoesStorage] Falha no log:", err.message);
  }
}

// ─── Cursor de paginação ──────────────────────────────────────────────────────
async function _cursor(startAfterValue) {
  if (!startAfterValue) return null;
  if (typeof startAfterValue === "string") {
    const snap = await getDoc(doc(db, COL_PROMOS, startAfterValue));
    return snap.exists() ? snap : null;
  }
  return startAfterValue;
}

// ─── Mudança de status (helper interno) ──────────────────────────────────────
async function _changeStatus(id, newStatus, action, label, admin) {
  try {
    if (!id) throw new Error("ID da promoção é obrigatório.");

    const promoRef = doc(db, COL_PROMOS, id);
    const snap     = await getDoc(promoRef);
    if (!snap.exists()) throw new Error(`Promoção não encontrada: "${id}".`);

    const before = snap.data();

    await updateDoc(promoRef, {
      status:       newStatus,
      atualizadoEm: serverTimestamp(),
    });

    await _log({
      action,
      promoId:    id,
      before:     { status: before.status },
      after:      { status: newStatus },
      adminUid:   admin?.uid,
      adminEmail: admin?.email,
      message:    `Promoção ${label}: "${before.titulo}"`,
    });

    return _ok({ id, status: newStatus });
  } catch (e) {
    return _err(`Erro ao alterar status: ${e.message}`, e);
  }
}

// ════════════════════════════════════════════════════════════════════════════
// FUNÇÕES DE ADMIN
// ════════════════════════════════════════════════════════════════════════════

/**
 * Cria uma nova promoção.
 * @param {object} payload  — campos da promoção
 * @param {object} admin    — { uid, email }
 */
export async function createPromotion(payload, admin) {
  try {
    _validate(payload, true);

    const limiteTotal = Number(payload.limiteTotal ?? payload.quantidade ?? 0) || 0;
    const utilizacoes = Number(payload.utilizacoes) || 0;
    const restante = limiteTotal > 0 ? Math.max(0, limiteTotal - utilizacoes) : null;

    const data = _stripUndef({
      titulo:           String(payload.titulo).trim(),
      descricao:        payload.descricao        ? String(payload.descricao).trim() : "",
      imagem:           payload.imagem            || null,
      tipoPromocao:     payload.tipoPromocao      || "geral",
      status:           payload.status            || STATUS.PROGRAMADA,
      quantidade:       Number(payload.quantidade)       || 0,
      limitePorUsuario: Number(payload.limitePorUsuario) || 1,
      limiteTotal,
      tipoDesconto:     payload.tipoDesconto || "percentual",
      valorDesconto:    Number(payload.valorDesconto) || 0,
      inicio:           _toTimestamp(payload.inicio),
      fim:              _toTimestamp(payload.fim),
      vipMinimo:        Number(payload.vipMinimo) || 0,
      permitirCupom:    payload.permitirCupom !== undefined ? Boolean(payload.permitirCupom) : true,
      produtosSelecionados: Array.isArray(payload.produtosSelecionados) ? payload.produtosSelecionados.filter(Boolean) : [],
      participacoes:    0,
      utilizacoes,
      usuariosUsaram:   0,
      restante,
      dataVip:          _toTimestamp(payload.dataVip),
      dataPublica:      _toTimestamp(payload.dataPublica),
      dataFinal:        _toTimestamp(payload.dataFinal),
      criadoPor:        { uid: admin?.uid || null, email: admin?.email || null },
      criadoEm:         serverTimestamp(),
      atualizadoEm:     serverTimestamp(),
    });

    const ref     = await addDoc(collection(db, COL_PROMOS), data);
    const created = { id: ref.id, ...data };

    await _log({
      action:     "promocao_create",
      promoId:    ref.id,
      after:      data,
      adminUid:   admin?.uid,
      adminEmail: admin?.email,
      message:    `Promoção criada: "${data.titulo}"`,
    });

    console.log("[Vip5PromocoesStorage] Promoção criada:", ref.id);
    return _ok(created);
  } catch (e) {
    return _err("Erro ao criar promoção: " + e.message, e);
  }
}

/**
 * Edita campos de uma promoção. Atualiza somente os campos fornecidos.
 * @param {string} id
 * @param {object} changes
 * @param {object} admin   — { uid, email }
 */
export async function editPromotion(id, changes, admin) {
  try {
    if (!id) throw new Error("ID da promoção é obrigatório.");
    _validate(changes, false);

    const promoRef = doc(db, COL_PROMOS, id);
    const snap     = await getDoc(promoRef);
    if (!snap.exists()) throw new Error(`Promoção não encontrada: "${id}".`);

    const before = snap.data();
    const currentUses = Number(before?.utilizacoes ?? before?.participacoes ?? 0) || 0;
    const nextLimiteTotal = changes.limiteTotal !== undefined ? Number(changes.limiteTotal) || 0 : undefined;
    const nextUtilizacoes = changes.utilizacoes !== undefined ? Number(changes.utilizacoes) || 0 : undefined;
    const nextRemaining = (nextLimiteTotal !== undefined || nextUtilizacoes !== undefined)
      ? (nextLimiteTotal > 0 ? Math.max(0, nextLimiteTotal - (nextUtilizacoes ?? currentUses)) : null)
      : undefined;

    const update = _stripUndef({
      titulo:           changes.titulo           !== undefined ? String(changes.titulo).trim()    : undefined,
      descricao:        changes.descricao        !== undefined ? String(changes.descricao).trim() : undefined,
      imagem:           changes.imagem           !== undefined ? changes.imagem                   : undefined,
      tipoPromocao:     changes.tipoPromocao     !== undefined ? changes.tipoPromocao             : undefined,
      status:           changes.status           !== undefined ? changes.status                   : undefined,
      quantidade:       changes.quantidade       !== undefined ? Number(changes.quantidade)       : undefined,
      limitePorUsuario: changes.limitePorUsuario !== undefined ? Number(changes.limitePorUsuario) : undefined,
      limiteTotal:      nextLimiteTotal !== undefined ? nextLimiteTotal : undefined,
      tipoDesconto:     changes.tipoDesconto     !== undefined ? changes.tipoDesconto             : undefined,
      valorDesconto:    changes.valorDesconto    !== undefined ? Number(changes.valorDesconto)    : undefined,
      inicio:           changes.inicio           !== undefined ? _toTimestamp(changes.inicio)     : undefined,
      fim:              changes.fim              !== undefined ? _toTimestamp(changes.fim)        : undefined,
      vipMinimo:        changes.vipMinimo        !== undefined ? Number(changes.vipMinimo)        : undefined,
      permitirCupom:    changes.permitirCupom    !== undefined ? Boolean(changes.permitirCupom)  : undefined,
      produtosSelecionados: changes.produtosSelecionados !== undefined ? (Array.isArray(changes.produtosSelecionados) ? changes.produtosSelecionados.filter(Boolean) : []) : undefined,
      utilizacoes:      nextUtilizacoes !== undefined ? nextUtilizacoes : undefined,
      restante:         nextRemaining !== undefined ? nextRemaining : undefined,
      dataVip:          changes.dataVip          !== undefined ? _toTimestamp(changes.dataVip)    : undefined,
      dataPublica:      changes.dataPublica      !== undefined ? _toTimestamp(changes.dataPublica): undefined,
      dataFinal:        changes.dataFinal        !== undefined ? _toTimestamp(changes.dataFinal)  : undefined,
      atualizadoEm:     serverTimestamp(),
    });

    if (Object.keys(update).length <= 1) throw new Error("Nenhuma alteração válida fornecida.");

    await updateDoc(promoRef, update);

    await _log({
      action:     "promocao_edit",
      promoId:    id,
      before,
      after:      update,
      adminUid:   admin?.uid,
      adminEmail: admin?.email,
      message:    `Promoção editada: "${before.titulo}"`,
    });

    return _ok({ id, ...before, ...update });
  } catch (e) {
    return _err("Erro ao editar promoção: " + e.message, e);
  }
}

/**
 * Exclui permanentemente uma promoção.
 * @param {string} id
 * @param {object} admin
 */
export async function deletePromotion(id, admin) {
  try {
    if (!id) throw new Error("ID da promoção é obrigatório.");

    const promoRef = doc(db, COL_PROMOS, id);
    const snap     = await getDoc(promoRef);
    if (!snap.exists()) throw new Error(`Promoção não encontrada: "${id}".`);

    const before = snap.data();
    await deleteDoc(promoRef);

    await _log({
      action:     "promocao_delete",
      promoId:    id,
      before,
      after:      null,
      adminUid:   admin?.uid,
      adminEmail: admin?.email,
      message:    `Promoção excluída: "${before.titulo}"`,
    });

    return _ok({ id });
  } catch (e) {
    return _err("Erro ao excluir promoção: " + e.message, e);
  }
}

/**
 * Duplica uma promoção (cópia com status programada e participacoes = 0).
 * @param {string} id
 * @param {object} admin
 */
export async function duplicatePromotion(id, admin) {
  try {
    if (!id) throw new Error("ID da promoção é obrigatório.");

    const promoRef = doc(db, COL_PROMOS, id);
    const snap     = await getDoc(promoRef);
    if (!snap.exists()) throw new Error(`Promoção não encontrada: "${id}".`);

    const original = snap.data();

    const copy = _stripUndef({
      ...original,
      titulo:        `${original.titulo} (Cópia)`,
      status:        STATUS.PROGRAMADA,
      participacoes: 0,
      criadoPor:     { uid: admin?.uid || null, email: admin?.email || null },
      criadoEm:      serverTimestamp(),
      atualizadoEm:  serverTimestamp(),
    });

    const newRef = await addDoc(collection(db, COL_PROMOS), copy);

    await _log({
      action:     "promocao_duplicate",
      promoId:    newRef.id,
      before:     { sourceId: id, sourceTitulo: original.titulo },
      after:      copy,
      adminUid:   admin?.uid,
      adminEmail: admin?.email,
      message:    `Promoção duplicada de "${id}" → "${newRef.id}": "${copy.titulo}"`,
    });

    return _ok({ id: newRef.id, ...copy });
  } catch (e) {
    return _err("Erro ao duplicar promoção: " + e.message, e);
  }
}

/** Status → "pausada" */
export async function pausePromotion(id, admin) {
  return _changeStatus(id, STATUS.PAUSADA, "promocao_pause", "pausada", admin);
}

/** Status → "ativa" */
export async function activatePromotion(id, admin) {
  return _changeStatus(id, STATUS.ATIVA, "promocao_activate", "ativada", admin);
}

/** Status → "encerrada" */
export async function endPromotion(id, admin) {
  return _changeStatus(id, STATUS.ENCERRADA, "promocao_end", "encerrada", admin);
}

/**
 * Lista todas as promoções para o painel admin (com paginação client-side).
 *
 * CORREÇÃO: orderBy() removido do Firestore para evitar exigência de índice
 * composto quando statusFilter está ativo. Ordenação feita client-side por
 * criadoEm desc, mantendo comportamento idêntico ao original.
 *
 * @param {object} opts
 * @param {string}  [opts.statusFilter]   — filtra por status específico
 * @param {number}  [opts.limit=20]
 * @param {DocumentSnapshot|string|null} [opts.startAfter]  — ignorado nesta versão
 */
export async function fetchAllPromotions({ statusFilter = null, limit: lim = DEF_LIMIT } = {}) {
  try {
    const safeLimit = _safeLimit(lim);

    // CORREÇÃO: sem orderBy() — evita exigência de índice composto.
    // Quando statusFilter está presente: apenas where("status", "==", ...)
    // Quando não há filtro: busca todos (collection scan com limit)
    const constraints = [];
    if (statusFilter && Object.values(STATUS).includes(statusFilter)) {
      constraints.push(where("status", "==", statusFilter));
    }
    // Busca com margem para retornar mais itens e ordenar client-side
    constraints.push(limit(safeLimit + 1));

    const q        = query(collection(db, COL_PROMOS), ...constraints);
    const snapshot = await getDocs(q);
    const docs     = snapshot.docs;
    const hasMore  = docs.length > safeLimit;
    const page     = hasMore ? docs.slice(0, safeLimit) : docs;

    // Ordenação client-side: criadoEm desc (mais recente primeiro)
    const items = page
      .map(_serialize)
      .filter(Boolean)
      .sort((a, b) => _toMs(b.criadoEm) - _toMs(a.criadoEm));

    return _ok({
      items,
      hasMore,
      lastDoc: page.length > 0 ? page[page.length - 1] : null,
    });
  } catch (e) {
    return _err("Erro ao listar promoções: " + e.message, e);
  }
}

// ════════════════════════════════════════════════════════════════════════════
// FUNÇÕES DE USUÁRIO
// ════════════════════════════════════════════════════════════════════════════

/**
 * Lista promoções visíveis conforme o tipo de acesso do usuário.
 *
 * Lógica de visibilidade:
 *   isVip=true  → vê promoções onde dataVip <= agora  (acesso antecipado)
 *   isVip=false → vê somente onde dataPublica <= agora
 *   Promoções sem dataVip e sem dataPublica → visíveis para todos
 *   Promoções com dataFinal expirada → filtradas client-side
 *
 * CORREÇÃO: orderBy("criadoEm", "desc") removido do Firestore.
 * A combinação where("status", "==", ...) + orderBy() em campo diferente
 * exige índice composto e causava o FirebaseError. Agora a ordenação é
 * feita client-side, sem nenhuma mudança no comportamento para o usuário.
 *
 * @param {object} opts
 * @param {boolean} [opts.isVip=false]
 * @param {number}  [opts.limit=20]
 * @param {DocumentSnapshot|string|null} [opts.startAfter]  — ignorado nesta versão
 */
export async function fetchVisiblePromotions({ isVip = false, limit: lim = DEF_LIMIT, productId = null } = {}) {
  try {
    const safeLimit = _safeLimit(lim);
    const now       = new Date();

    // CORREÇÃO DEFINITIVA: apenas where("status", "==", "ativa") sem orderBy.
    // Um único filtro de igualdade é atendido pelo índice automático de campo
    // único do Firestore — sem necessidade de índice composto.
    const q        = query(
      collection(db, COL_PROMOS),
      where("status", "==", STATUS.ATIVA),
      limit(safeLimit + 1)
    );
    const snapshot = await getDocs(q);
    const docs     = snapshot.docs;
    const hasMore  = docs.length > safeLimit;
    const page     = hasMore ? docs.slice(0, safeLimit) : docs;

    const items = page
      .map(_serialize)
      .filter((p) => {
        if (!p) return false;

        if (p.inicio) {
          const inicio = _toDate(p.inicio);
          if (inicio && inicio > now) return false;
        }

        const end = _toDate(p.fim ?? p.dataFinal);
        if (end && end < now) return false;

        if (!_matchSelectedProducts(p, productId)) return false;

        if (isVip && p.dataVip) {
          const vipDate = _toDate(p.dataVip);
          if (vipDate && vipDate <= now) return true;
        }

        if (p.dataPublica) {
          const pubDate = _toDate(p.dataPublica);
          if (pubDate && pubDate <= now) return true;
        }

        if (!p.dataVip && !p.dataPublica) return true;
        return false;
      })
      // Ordenação client-side: criadoEm desc (mais recente primeiro)
      .sort((a, b) => _toMs(b.criadoEm) - _toMs(a.criadoEm));

    return _ok({
      items,
      hasMore,
      lastDoc: page.length > 0 ? page[page.length - 1] : null,
    });
  } catch (e) {
    return _err("Erro ao listar promoções visíveis: " + e.message, e);
  }
}

/**
 * Busca uma promoção pelo ID.
 * @param {string} id
 */
export async function fetchPromotionById(id) {
  try {
    if (!id) throw new Error("ID é obrigatório.");
    const snap = await getDoc(doc(db, COL_PROMOS, id));
    if (!snap.exists()) throw new Error(`Promoção não encontrada: "${id}".`);
    return _ok(_serialize(snap));
  } catch (e) {
    return _err("Erro ao buscar promoção: " + e.message, e);
  }
}

/**
 * Verifica se um usuário pode participar de uma promoção.
 * Pré-verificação de UX — a transação em registerParticipation é o controle definitivo.
 *
 * @param {string} promoId
 * @param {string} uid
 * @param {object} [vipData]  — { vip5Active: bool, vip5ExpiresAt: number (ms) }
 */
export async function canParticipate(promoId, uid, vipData = null, productId = null) {
  try {
    if (!promoId) throw new Error("promoId é obrigatório.");
    if (!uid)     throw new Error("uid é obrigatório.");

    const [promoSnap, partSnap, useSnap] = await Promise.all([
      getDoc(doc(db, COL_PROMOS, promoId)),
      getDoc(doc(db, COL_PARTS, `${promoId}_${uid}`)),
      getDoc(doc(db, COL_USES, `${promoId}_${uid}`)),
    ]);

    if (!promoSnap.exists()) {
      return _ok({ canParticipate: false, reason: "Promoção não encontrada." });
    }

    const p   = promoSnap.data();
    const now = new Date();
    const count = _getUserPromoUsageCount(partSnap, useSnap);

    const eligibility = _buildPromoEligibility(p, {
      uid,
      vipData,
      productId,
      amount: 0,
      currentUsageCount: count,
      now,
    });

    if (!eligibility.eligible) {
      return _ok({ canParticipate: false, reason: eligibility.reason });
    }

    return _ok({ canParticipate: true, reason: null });
  } catch (e) {
    return _err("Erro ao verificar elegibilidade: " + e.message, e);
  }
}

/**
 * Registra a participação de um usuário em uma promoção.
 *
 * Usa runTransaction para garantir atomicidade:
 *   1. Lê promoção (verifica status, datas, vagas)
 *   2. Lê doc de participação do usuário ({promoId}_{uid}) — verifica limite
 *   3. Incrementa promoção.participacoes
 *   4. Cria/atualiza doc de participação
 *
 * @param {string} promoId
 * @param {string} uid
 * @param {object} [extra]  — campos adicionais a salvar (ex: { nome, email })
 */
export async function registerParticipation(promoId, uid, extra = {}, vipData = null) {
  try {
    if (!promoId) throw new Error("promoId é obrigatório.");
    if (!uid)     throw new Error("uid é obrigatório.");

    // Detailed instrumentation: emit stack, caller function, source file:line, args, and inferred flow
    try {
      const err = new Error();
      const rawStack = err.stack || "";
      const stackLines = String(rawStack).split("\n").map((l) => l.trim()).filter(Boolean);

      // Find first stack line that is not this function itself
      let callerLine = null;
      for (let i = 1; i < stackLines.length; i++) {
        const line = stackLines[i];
        if (!/registerParticipation/.test(line)) { callerLine = line; break; }
      }

      // Parse caller function name and file:line
      let callerFn = null;
      let callerFileLine = null;
      const m = callerLine && callerLine.match(/at\s+(.*?)\s+\((.*?):(\d+):(\d+)\)$/);
      if (m) {
        callerFn = m[1];
        callerFileLine = `${m[2]}:${m[3]}`;
      } else if (callerLine) {
        // Try alternative format: at /path/to/file:line:col
        const m2 = callerLine.match(/at\s+(.*?):(\d+):(\d+)$/);
        if (m2) {
          callerFn = '<anonymous>';
          callerFileLine = `${m2[1]}:${m2[2]}`;
        } else {
          callerFn = callerLine;
          callerFileLine = '<unknown>';
        }
      }

      // Determine likely origin flow by scanning the full stack text for known function names
      const stackText = stackLines.join('\n');
      const flow = (/participar\(|participar\b/.test(stackText)) ? 'participar()' :
                   (/comprarProduto\b/.test(stackText)) ? 'comprarProduto()' :
                   (/applyPromotionToPurchase\b/.test(stackText)) ? 'applyPromotionToPurchase()' :
                   'unknown';

      // Extract productId from extra if present
      const productId = extra && (extra.produtoId || extra.productId || extra.produto || extra.productId) ? (extra.produtoId || extra.productId || extra.produto || extra.productId) : null;

      console.groupCollapsed('[Vip5PromocoesStorage] registerParticipation TRACE', promoId, uid);
      try { console.log('args:', { promoId, uid, productId, extra, vipData }); } catch(e){}
      try { console.log('inferredFlow:', flow); } catch(e){}
      try { console.log('callerFunction:', callerFn); } catch(e){}
      try { console.log('callerSource:', callerFileLine); } catch(e){}
      try { console.log('rawStack:\n', rawStack); } catch(e){}
      console.groupEnd();
    } catch (traceErr) {
      try { console.warn('[Vip5PromocoesStorage] trace fail', traceErr && traceErr.message); } catch(e){}
    }

    const promoRef = doc(db, COL_PROMOS, promoId);
    const partRef  = doc(db, COL_PARTS, `${promoId}_${uid}`);
    const useRef   = doc(db, COL_USES, `${promoId}_${uid}`);
    const now      = new Date();
    const productId = extra?.produtoId ?? extra?.productId ?? null;

    await runTransaction(db, async (tx) => {
      const promoSnap = await tx.get(promoRef);
      const partSnap  = await tx.get(partRef);
      const useSnap   = await tx.get(useRef);

      if (!promoSnap.exists()) throw new Error("Promoção não encontrada.");

      const p = promoSnap.data();
      const count = _getUserPromoUsageCount(partSnap, useSnap);
      const eligibility = _buildPromoEligibility(p, {
        uid,
        vipData,
        productId,
        amount: 0,
        currentUsageCount: count,
        now,
      });

      if (!eligibility.eligible) {
        throw new Error(eligibility.reason || "Promoção indisponível.");
      }

      const qty   = _getPromoCapacity(p);
      const parts = _getPromoUsage(p);
      const nextRemaining = qty > 0 ? Math.max(0, qty - (parts + 1)) : null;
      const nextStatus = (qty > 0 && nextRemaining === 0) ? STATUS.ENCERRADA : p.status;
      const firstUserUse = !useSnap.exists();
      tx.update(promoRef, {
        participacoes:  increment(1),
        utilizacoes:    increment(1),
        ...(qty > 0 ? { restante: nextRemaining } : {}),
        ...(firstUserUse ? { usuariosUsaram: increment(1) } : {}),
        ...(nextStatus !== p.status ? { status: nextStatus } : {}),
        atualizadoEm:   serverTimestamp(),
      });

      tx.set(partRef, {
        promoId,
        uid,
        count:                count + 1,
        status:               "confirmada",
        criadoEm:             partSnap.exists() ? partSnap.data().criadoEm : serverTimestamp(),
        ultimaParticipacaoEm: serverTimestamp(),
        ...extra,
      });

      tx.set(useRef, {
        promoId,
        uid,
        count:                count + 1,
        produtoId:            productId || null,
        status:               "confirmada",
        criadoEm:             useSnap.exists() ? useSnap.data().criadoEm : serverTimestamp(),
        ultimaParticipacaoEm: serverTimestamp(),
        ...extra,
      });
    });

    await _log({
      action:   "participacao_registrada",
      promoId,
      after:    { uid, partDocId: `${promoId}_${uid}` },
      adminUid: uid,
      message:  `Participação registrada. promoId="${promoId}" uid="${uid}"`,
    });

    console.trace("[Vip5PromocoesStorage] Participação registrada:", { promoId, uid });
    console.log("[Vip5PromocoesStorage] Participação registrada:", promoId, uid);
    return _ok({ promoId, uid, participacaoId: `${promoId}_${uid}` });
  } catch (e) {
    return _err("Erro ao registrar participação: " + e.message, e);
  }
}

/**
 * Aplica automaticamente uma promoção a uma compra, registrando uso e atualizando os contadores.
 *
 * @param {object} opts
 * @param {string} opts.uid
 * @param {string|null} opts.productId
 * @param {number} opts.amount
 * @param {object|null} [opts.vipData]
 * @param {object} [opts.extra]
 */
export async function applyPromotionToPurchase({ uid, productId = null, amount = 0, vipData = null, preferredPromoId = null, selectedPromo = null, expectedFinalAmount = null, extra = {}, transaction = null } = {}) {
  try {
    if (!uid) throw new Error("uid é obrigatório.");

    const baseAmount = Number(amount || 0);
    if (baseAmount <= 0) {
      return _ok({ applicable: false, promoId: null, discountAmount: 0, finalAmount: 0, reason: "Valor de compra inválido." });
    }

    const promoQuery = query(collection(db, COL_PROMOS), where("status", "==", STATUS.ATIVA));
    const promoSnapshot = await getDocs(promoQuery);
    const promos = promoSnapshot.docs.map((snap) => _serialize(snap)).filter(Boolean);

    const resolvePromotion = async (tx) => {
      if (selectedPromo && selectedPromo.id) {
        const selectedPromoId = String(selectedPromo.id);
        const promoRef = doc(db, COL_PROMOS, selectedPromoId);
        const promoSnap = await tx.get(promoRef);
        if (!promoSnap.exists()) {
          return _ok({
            applicable: false,
            promoId: selectedPromoId,
            discountAmount: 0,
            finalAmount: baseAmount,
            reason: "Promoção exibida não existe mais.",
          });
        }

        const promoData = _serialize(promoSnap);
        if (!promoData) {
          return _ok({
            applicable: false,
            promoId: selectedPromoId,
            discountAmount: 0,
            finalAmount: baseAmount,
            reason: "Promoção exibida não pôde ser lida.",
          });
        }

        const now = new Date();
        if (promoData.status !== STATUS.ATIVA) {
          return _ok({
            applicable: false,
            promoId: selectedPromoId,
            discountAmount: 0,
            finalAmount: baseAmount,
            reason: `Promoção exibida não está mais ativa (status: ${promoData.status}).`,
          });
        }

        const inicio = _toDate(promoData.inicio);
        if (inicio && inicio > now) {
          return _ok({
            applicable: false,
            promoId: selectedPromoId,
            discountAmount: 0,
            finalAmount: baseAmount,
            reason: "Promoção exibida ainda não começou.",
          });
        }

        const end = _toDate(promoData.fim ?? promoData.dataFinal);
        if (end && end < now) {
          return _ok({
            applicable: false,
            promoId: selectedPromoId,
            discountAmount: 0,
            finalAmount: baseAmount,
            reason: "Promoção exibida expirou.",
          });
        }

        if (productId && !_matchSelectedProducts(promoData, productId)) {
          return _ok({
            applicable: false,
            promoId: selectedPromoId,
            discountAmount: 0,
            finalAmount: baseAmount,
            reason: "Promoção exibida não é válida para este produto.",
          });
        }

        const useRef = doc(db, COL_USES, `${selectedPromoId}_${uid}`);
        const partRef = doc(db, COL_PARTS, `${selectedPromoId}_${uid}`);
        const useSnap = await tx.get(useRef);
        const partSnap = await tx.get(partRef);
        const count = _getUserPromoUsageCount(partSnap, useSnap);
        const limite = Number(promoData.limitePorUsuario) || 1;
        if (limite > 0 && count >= limite) {
          return _ok({
            applicable: false,
            promoId: selectedPromoId,
            discountAmount: 0,
            finalAmount: baseAmount,
            reason: `Promoção exibida já foi utilizada ${count}x e atingiu o limite por usuário (${limite}).`,
          });
        }

        const qty = _getPromoCapacity(promoData);
        const parts = _getPromoUsage(promoData);
        if (qty > 0 && parts >= qty) {
          return _ok({
            applicable: false,
            promoId: selectedPromoId,
            discountAmount: 0,
            finalAmount: baseAmount,
            reason: "Promoção exibida esgotou vagas antes da compra.",
          });
        }

        const discountedAmount = expectedFinalAmount !== null ? Number(expectedFinalAmount) : Number(selectedPromo.precoPromocional || 0);
        const finalAmount = Number.isFinite(discountedAmount) ? Math.min(baseAmount, discountedAmount) : baseAmount;
        const discountAmount = Math.max(0, baseAmount - finalAmount);

        console.log("[Vip5PromocoesStorage] Checkout usando promoção exibida", {
          selectedPromoId,
          baseAmount,
          precoPromocionalPreview: selectedPromo.precoPromocional,
          expectedFinalAmount,
          finalAmount,
          discountAmount,
        });

        const nextRemaining = qty > 0 ? Math.max(0, qty - (parts + 1)) : null;
        const nextStatus = (qty > 0 && nextRemaining === 0) ? STATUS.ENCERRADA : promoData.status;
        const firstUserUse = !useSnap.exists();

        tx.update(promoRef, {
          participacoes:  increment(1),
          utilizacoes:    increment(1),
          ...(qty > 0 ? { restante: nextRemaining } : {}),
          ...(firstUserUse ? { usuariosUsaram: increment(1) } : {}),
          ...(nextStatus !== promoData.status ? { status: nextStatus } : {}),
          atualizadoEm:   serverTimestamp(),
        });

        tx.set(partRef, {
          promoId: selectedPromoId,
          uid,
          count: count + 1,
          status: "confirmada",
          criadoEm: partSnap.exists() ? partSnap.data().criadoEm : serverTimestamp(),
          ultimaParticipacaoEm: serverTimestamp(),
          produtoId: productId || null,
          ...extra,
        });

        tx.set(useRef, {
          promoId: selectedPromoId,
          uid,
          count: count + 1,
          produtoId: productId || null,
          status: "confirmada",
          criadoEm: useSnap.exists() ? useSnap.data().criadoEm : serverTimestamp(),
          ultimaParticipacaoEm: serverTimestamp(),
          ...extra,
        });

        return _ok({
          applicable: true,
          promoId: selectedPromoId,
          discountAmount,
          finalAmount,
          reason: null,
        });
      }

      const candidates = [];
      const promoEvaluations = [];
      for (const promo of promos) {
        const useRef = doc(db, COL_USES, `${promo.id}_${uid}`);
        const partRef = doc(db, COL_PARTS, `${promo.id}_${uid}`);
        if (!useRef || typeof useRef.path !== 'string') {
          throw new Error(`useRef inválido para promoId=${promo.id}`);
        }
        if (!partRef || typeof partRef.path !== 'string') {
          throw new Error(`partRef inválido para promoId=${promo.id}`);
        }

        const useSnap = await tx.get(useRef);
        const partSnap = await tx.get(partRef);
        const count = _getUserPromoUsageCount(partSnap, useSnap);
        const eligibility = _buildPromoEligibility(promo, {
          uid,
          vipData,
          productId,
          amount: baseAmount,
          currentUsageCount: count,
          now: new Date(),
        });

        promoEvaluations.push({
          promoId: promo.id,
          title: promo.titulo || promo.title || null,
          eligible: eligibility.eligible,
          reason: eligibility.reason,
          discountAmount: eligibility.discountAmount,
          finalAmount: eligibility.finalAmount,
          currentUsageCount: count,
          restante: promo.restante,
          limitePorUsuario: promo.limitePorUsuario,
        });

        if (eligibility.eligible) {
          candidates.push({
            ...promo,
            ...eligibility,
          });
        }
      }

      console.log("[Vip5PromocoesStorage] Promoções avaliadas no checkout", {
        baseAmount,
        preferredPromoId,
        totalPromos: promos.length,
        candidates: candidates.length,
        promoEvaluations,
      });

      if (!candidates.length) {
        const preferredDetail = promoEvaluations.find((entry) => String(entry.promoId) === String(preferredPromoId));
        if (preferredPromoId && preferredDetail) {
          return _ok({
            applicable: false,
            promoId: preferredPromoId,
            discountAmount: 0,
            finalAmount: baseAmount,
            reason: `Promoção preferida não aplicável: ${preferredDetail.reason || "sem razão detalhada"}`,
          });
        }

        return _ok({ applicable: false, promoId: null, discountAmount: 0, finalAmount: baseAmount, reason: "Nenhuma promoção aplicável no momento." });
      }

      let selected = null;
      if (preferredPromoId) {
        selected = candidates.find((promo) => String(promo.id) === String(preferredPromoId));
        if (!selected) {
          const preferredDetail = promoEvaluations.find((entry) => String(entry.promoId) === String(preferredPromoId));
          return _ok({
            applicable: false,
            promoId: preferredPromoId,
            discountAmount: 0,
            finalAmount: baseAmount,
            reason: preferredDetail
              ? `Promoção preferida não aplicável: ${preferredDetail.reason || "sem razão detalhada"}`
              : "Promoção preferida não está entre as promoções elegíveis no momento.",
          });
        }
      }
      if (!selected) {
        selected = candidates
          .sort((a, b) => (b.discountAmount - a.discountAmount) || (_toMs(b.criadoEm) - _toMs(a.criadoEm)))[0];
      }

      if (!selected || !selected.id) {
        return _ok({ applicable: false, promoId: null, discountAmount: 0, finalAmount: baseAmount, reason: "Promoção selecionada inválida." });
      }

      const useRef = doc(db, COL_USES, `${selected.id}_${uid}`);
      const partRef = doc(db, COL_PARTS, `${selected.id}_${uid}`);
      if (!useRef || typeof useRef.path !== 'string') {
        throw new Error(`useRef inválido para selected.id=${selected.id}`);
      }
      if (!partRef || typeof partRef.path !== 'string') {
        throw new Error(`partRef inválido para selected.id=${selected.id}`);
      }

      const useSnap = await tx.get(useRef);
      const partSnap = await tx.get(partRef);
      const count = _getUserPromoUsageCount(partSnap, useSnap);
      const postEligibility = _buildPromoEligibility(selected, {
        uid,
        vipData,
        productId,
        amount: baseAmount,
        currentUsageCount: count,
        now: new Date(),
      });

      if (!postEligibility.eligible) {
        return _ok({ applicable: false, promoId: null, discountAmount: 0, finalAmount: baseAmount, reason: postEligibility.reason || "Promoção indisponível no momento." });
      }

      const promoRef = doc(db, COL_PROMOS, selected.id);
      if (!promoRef || typeof promoRef.path !== 'string') {
        throw new Error(`promoRef inválido para selected.id=${selected.id}`);
      }

      const promoSnap = await tx.get(promoRef);
      const promoData = promoSnap.data() || {};
      const qty = _getPromoCapacity(promoData);
      const parts = _getPromoUsage(promoData);
      const nextRemaining = qty > 0 ? Math.max(0, qty - (parts + 1)) : null;
      const nextStatus = (qty > 0 && nextRemaining === 0) ? STATUS.ENCERRADA : promoData.status;
      const firstUserUse = !useSnap.exists();

      tx.update(promoRef, {
        participacoes:  increment(1),
        utilizacoes:    increment(1),
        ...(qty > 0 ? { restante: nextRemaining } : {}),
        ...(firstUserUse ? { usuariosUsaram: increment(1) } : {}),
        ...(nextStatus !== promoData.status ? { status: nextStatus } : {}),
        atualizadoEm:   serverTimestamp(),
      });

      tx.set(partRef, {
        promoId: selected.id,
        uid,
        count: count + 1,
        status: "confirmada",
        criadoEm: partSnap.exists() ? partSnap.data().criadoEm : serverTimestamp(),
        ultimaParticipacaoEm: serverTimestamp(),
        produtoId: productId || null,
        ...extra,
      });

      tx.set(useRef, {
        promoId: selected.id,
        uid,
        count: count + 1,
        produtoId: productId || null,
        status: "confirmada",
        criadoEm: useSnap.exists() ? useSnap.data().criadoEm : serverTimestamp(),
        ultimaParticipacaoEm: serverTimestamp(),
        ...extra,
      });

      const result = _ok({
        applicable: true,
        promoId: selected.id,
        discountAmount: postEligibility.discountAmount,
        finalAmount: postEligibility.finalAmount,
        reason: null,
      });

      console.log("[Vip5PromocoesStorage] Promo selecionada", {
        promoId: selected.id,
        preferredPromoId,
        selectedTitle: selected.titulo || selected.title || selected.id,
        baseAmount,
        discountAmount: postEligibility.discountAmount,
        finalAmount: postEligibility.finalAmount,
        useCount: count,
        currentVIP: vipData,
      });

      return result;
    };

    if (transaction) {
      return await resolvePromotion(transaction);
    }

    return await runTransaction(db, async (tx) => resolvePromotion(tx));
  } catch (e) {
    return _err("Erro ao aplicar promoção na compra: " + e.message, e);
  }
}

// ════════════════════════════════════════════════════════════════════════════
// ADMIN — LEITURA DE PARTICIPAÇÕES E LOGS
// ════════════════════════════════════════════════════════════════════════════

/**
 * Lista participações de uma promoção com paginação.
 *
 * CORREÇÃO: orderBy("criadoEm", "desc") removido do Firestore.
 * where("promoId", "==", ...) + orderBy() exigia índice composto em
 * vip5_promocoes_participantes. Agora ordenação é feita client-side.
 *
 * @param {string} promoId
 * @param {object} opts — { limit, startAfter }
 */
export async function fetchParticipations(promoId, { limit: lim = DEF_LIMIT } = {}) {
  try {
    if (!promoId) throw new Error("promoId é obrigatório.");

    const safeLimit = _safeLimit(lim);

    // CORREÇÃO: apenas equality filter, sem orderBy — não exige índice composto
    const q        = query(
      collection(db, COL_PARTS),
      where("promoId", "==", promoId),
      limit(safeLimit + 1)
    );
    const snapshot = await getDocs(q);
    const docs     = snapshot.docs;
    const hasMore  = docs.length > safeLimit;
    const page     = hasMore ? docs.slice(0, safeLimit) : docs;

    // Ordenação client-side: criadoEm desc
    const items = page
      .map(_serialize)
      .filter(Boolean)
      .sort((a, b) => _toMs(b.criadoEm) - _toMs(a.criadoEm));

    return _ok({
      items,
      hasMore,
      lastDoc: page.length > 0 ? page[page.length - 1] : null,
    });
  } catch (e) {
    return _err("Erro ao listar participações: " + e.message, e);
  }
}

/**
 * Lista logs de auditoria com paginação.
 *
 * CORREÇÃO: orderBy("timestamp", "desc") removido do Firestore.
 * where("module", "==", ...) + orderBy() exigia índice composto em
 * vip5_promocoes_logs. Agora ordenação é feita client-side.
 *
 * @param {object} opts — { promoId, limit, startAfter }
 */
export async function fetchLogs({ promoId = null, limit: lim = 50 } = {}) {
  try {
    const safeLimit = _safeLimit(lim);

    // CORREÇÃO: apenas equality filters, sem orderBy — não exige índice composto.
    // Múltiplos filtros de igualdade em campos diferentes são atendidos pelos
    // índices automáticos de campo único do Firestore.
    const constraints = [where("module", "==", MODULE)];
    if (promoId) constraints.push(where("promoId", "==", promoId));
    constraints.push(limit(safeLimit + 1));

    const q        = query(collection(db, COL_LOGS), ...constraints);
    const snapshot = await getDocs(q);
    const docs     = snapshot.docs;
    const hasMore  = docs.length > safeLimit;
    const page     = hasMore ? docs.slice(0, safeLimit) : docs;

    // Ordenação client-side: timestamp desc (mais recente primeiro)
    const items = page
      .map(_serialize)
      .filter(Boolean)
      .sort((a, b) => _toMs(b.timestamp) - _toMs(a.timestamp));

    return _ok({
      items,
      hasMore,
      lastDoc: page.length > 0 ? page[page.length - 1] : null,
    });
  } catch (e) {
    return _err("Erro ao listar logs: " + e.message, e);
  }
}

// ─── Exposição global ─────────────────────────────────────────────────────────
const Vip5PromocoesStorage = Object.freeze({
  STATUS,
  createPromotion,
  editPromotion,
  deletePromotion,
  duplicatePromotion,
  pausePromotion,
  activatePromotion,
  endPromotion,
  fetchAllPromotions,
  fetchVisiblePromotions,
  fetchPromotionById,
  canParticipate,
  registerParticipation,
  fetchParticipations,
  fetchLogs,
});

window.Vip5PromocoesStorage = Vip5PromocoesStorage;
export default Vip5PromocoesStorage;
