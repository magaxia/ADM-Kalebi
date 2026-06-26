/**
 * vip5-promocoes-storage.js
 * Firebase Modular SDK — mesmo padrão de vip5.js, admin.js, vip5-storage.js
 *
 * Uso como módulo ES:
 *   import { createPromotion, fetchAllPromotions, ... } from "./vip5-promocoes-storage.js";
 *
 * Uso como script global (após <script type="module" src="vip5-promocoes-storage.js">):
 *   const result = await Vip5PromocoesStorage.createPromotion(payload, admin);
 *
 * Coleções Firestore:
 *   vip5_promocoes                — documentos de promoção
 *   vip5_promocoes_participacoes  — participações (ID: {promoId}_{uid})
 *   vip5_logs                     — auditoria de ações admin
 *
 * Estratégia antifraude (sem coleção extra):
 *   Doc ID fixo "{promoId}_{uid}" em vip5_promocoes_participacoes.
 *   Leitura e escrita dentro de runTransaction() → atomicamente seguro.
 *   Elimina vip5_participacoes_index completamente.
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
  orderBy,
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
const COL_PARTS   = "vip5_promocoes_participacoes";
const COL_LOGS    = "vip5_logs";
const MODULE      = "vip5_promocoes";
const DEF_LIMIT   = 20;
const MAX_LIMIT   = 100;

export const STATUS = Object.freeze({
  PROGRAMADA: "programada",
  ATIVA:      "ativa",
  PAUSADA:    "pausada",
  ENCERRADA:  "encerrada",
});

// ─── Retorno padronizado ──────────────────────────────────────────────────────
function _ok(data)       { return { success: true,  data,  error: null }; }
function _err(msg, e)    {
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
  if (payload.status !== undefined && !Object.values(STATUS).includes(payload.status)) {
    errors.push(`"status" inválido. Use: ${Object.values(STATUS).join(", ")}.`);
  }

  // Coerência de datas
  const toDate = (v) => {
    if (!v) return null;
    if (typeof v.toDate === "function") return v.toDate();
    return v instanceof Date ? v : new Date(v);
  };
  const vip = toDate(payload.dataVip);
  const pub = toDate(payload.dataPublica);
  const end = toDate(payload.dataFinal);

  if (vip && pub && vip > pub)  errors.push('"dataVip" deve ser ≤ "dataPublica".');
  if (pub && end && pub > end)  errors.push('"dataPublica" deve ser ≤ "dataFinal".');
  if (vip && end && vip > end)  errors.push('"dataVip" deve ser ≤ "dataFinal".');

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

// ─── Cursor de paginação ─────────────────────────────────────────────────────
async function _cursor(startAfterValue) {
  if (!startAfterValue) return null;
  // Aceita DocumentSnapshot ou ID de string
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

    const data = _stripUndef({
      titulo:           String(payload.titulo).trim(),
      descricao:        payload.descricao        ? String(payload.descricao).trim() : "",
      imagem:           payload.imagem            || null,
      tipoPromocao:     payload.tipoPromocao      || "geral",
      status:           payload.status            || STATUS.PROGRAMADA,
      quantidade:       Number(payload.quantidade)       || 0,
      limitePorUsuario: Number(payload.limitePorUsuario) || 1,
      participacoes:    0,
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

    const update = _stripUndef({
      titulo:           changes.titulo           !== undefined ? String(changes.titulo).trim()    : undefined,
      descricao:        changes.descricao        !== undefined ? String(changes.descricao).trim() : undefined,
      imagem:           changes.imagem           !== undefined ? changes.imagem                   : undefined,
      tipoPromocao:     changes.tipoPromocao     !== undefined ? changes.tipoPromocao             : undefined,
      status:           changes.status           !== undefined ? changes.status                   : undefined,
      quantidade:       changes.quantidade       !== undefined ? Number(changes.quantidade)       : undefined,
      limitePorUsuario: changes.limitePorUsuario !== undefined ? Number(changes.limitePorUsuario) : undefined,
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
 * Lista todas as promoções para o painel admin (com paginação).
 * @param {object} opts
 * @param {string}  [opts.statusFilter]   — filtra por status específico
 * @param {number}  [opts.limit=20]
 * @param {DocumentSnapshot|string|null} [opts.startAfter]
 */
export async function fetchAllPromotions({ statusFilter = null, limit: lim = DEF_LIMIT, startAfter: sa = null } = {}) {
  try {
    const safeLimit = _safeLimit(lim);
    const cursor    = await _cursor(sa);

    const constraints = [orderBy("criadoEm", "desc")];
    if (statusFilter && Object.values(STATUS).includes(statusFilter)) {
      constraints.unshift(where("status", "==", statusFilter));
    }
    if (cursor) constraints.push(startAfter(cursor));
    constraints.push(limit(safeLimit + 1));

    const q        = query(collection(db, COL_PROMOS), ...constraints);
    const snapshot = await getDocs(q);
    const docs     = snapshot.docs;
    const hasMore  = docs.length > safeLimit;
    const page     = hasMore ? docs.slice(0, safeLimit) : docs;

    return _ok({
      items:   page.map(_serialize).filter(Boolean),
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
 * @param {object} opts
 * @param {boolean} [opts.isVip=false]
 * @param {number}  [opts.limit=20]
 * @param {DocumentSnapshot|string|null} [opts.startAfter]
 */
export async function fetchVisiblePromotions({ isVip = false, limit: lim = DEF_LIMIT, startAfter: sa = null } = {}) {
  try {
    const safeLimit = _safeLimit(lim);
    const cursor    = await _cursor(sa);
    const now       = new Date();
    const nowTs     = Timestamp.fromDate(now);

    // Query base: apenas promoções ativas, ordenadas por data de criação
    // O filtro de data de liberação é feito client-side para suportar a lógica
    // de "VIP vê antes, público vê depois" sem índices complexos.
    const constraints = [
      where("status", "==", STATUS.ATIVA),
      orderBy("criadoEm", "desc"),
    ];
    if (cursor) constraints.push(startAfter(cursor));
    constraints.push(limit(safeLimit + 1));

    const q        = query(collection(db, COL_PROMOS), ...constraints);
    const snapshot = await getDocs(q);
    const docs     = snapshot.docs;
    const hasMore  = docs.length > safeLimit;
    const page     = hasMore ? docs.slice(0, safeLimit) : docs;

    const toDate = (v) => {
      if (!v) return null;
      if (typeof v.toDate === "function") return v.toDate();
      return v instanceof Date ? v : new Date(v);
    };

    const items = page
      .map(_serialize)
      .filter((p) => {
        if (!p) return false;
        // Filtra expiradas
        const end = toDate(p.dataFinal);
        if (end && end < now) return false;
        // Verifica acesso antecipado VIP
        if (isVip && p.dataVip) {
          const vipDate = toDate(p.dataVip);
          if (vipDate && vipDate <= now) return true;
        }
        // Verifica data pública
        if (p.dataPublica) {
          const pubDate = toDate(p.dataPublica);
          if (pubDate && pubDate <= now) return true;
        }
        // Sem datas configuradas → visível para todos
        if (!p.dataVip && !p.dataPublica) return true;
        return false;
      });

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
 *   Mesmo formato retornado por vip5-storage.js → getUserVip()
 */
export async function canParticipate(promoId, uid, vipData = null) {
  try {
    if (!promoId) throw new Error("promoId é obrigatório.");
    if (!uid)     throw new Error("uid é obrigatório.");

    // Lê promoção e participação do usuário em paralelo (2 leituras, sem query)
    const [promoSnap, partSnap] = await Promise.all([
      getDoc(doc(db, COL_PROMOS, promoId)),
      getDoc(doc(db, COL_PARTS, `${promoId}_${uid}`)),
    ]);

    if (!promoSnap.exists()) {
      return _ok({ canParticipate: false, reason: "Promoção não encontrada." });
    }

    const p   = promoSnap.data();
    const now = new Date();

    // Status
    if (p.status !== STATUS.ATIVA) {
      return _ok({ canParticipate: false, reason: `Promoção não está ativa (status: ${p.status}).` });
    }

    // Expiração
    if (p.dataFinal) {
      const end = typeof p.dataFinal.toDate === "function" ? p.dataFinal.toDate() : new Date(p.dataFinal);
      if (end < now) return _ok({ canParticipate: false, reason: "Promoção expirada." });
    }

    // Data de acesso VIP antecipado
    if (p.dataVip) {
      const vipDate = typeof p.dataVip.toDate === "function" ? p.dataVip.toDate() : new Date(p.dataVip);
      if (vipDate > now) {
        // Ainda não liberou VIP — verifica se a data pública também não liberou
        const pubDate = p.dataPublica
          ? (typeof p.dataPublica.toDate === "function" ? p.dataPublica.toDate() : new Date(p.dataPublica))
          : null;
        if (!pubDate || pubDate > now) {
          return _ok({ canParticipate: false, reason: "Promoção ainda não foi liberada." });
        }
      }
    }

    // Data pública (sem dataVip configurado)
    if (!p.dataVip && p.dataPublica) {
      const pubDate = typeof p.dataPublica.toDate === "function" ? p.dataPublica.toDate() : new Date(p.dataPublica);
      if (pubDate > now) {
        // Verifica se usuário é VIP com acesso antecipado (campo vip5Active + vip5ExpiresAt)
        const isVipAtivo = vipData?.vip5Active === true && (!vipData.vip5ExpiresAt || vipData.vip5ExpiresAt > Date.now());
        if (!isVipAtivo) {
          return _ok({ canParticipate: false, reason: "Promoção ainda não liberada ao público." });
        }
      }
    }

    // Vagas disponíveis
    const qty   = Number(p.quantidade) || 0;
    const parts = Number(p.participacoes) || 0;
    if (qty > 0 && parts >= qty) {
      return _ok({ canParticipate: false, reason: "Vagas esgotadas." });
    }

    // Limite por usuário — leitura direta por doc ID (sem query, sem índice)
    const limite = Number(p.limitePorUsuario) || 1;
    if (limite > 0 && partSnap.exists()) {
      const count = Number(partSnap.data().count) || 0;
      if (count >= limite) {
        return _ok({
          canParticipate: false,
          reason: `Limite atingido: você já participou ${count}x (máximo: ${limite}x).`,
        });
      }
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
 * Antifraude sem coleção extra:
 *   O doc "{promoId}_{uid}" é o único identificador por usuário/promoção.
 *   O campo `count` controla quantas vezes o usuário participou.
 *   A transação impede condições de corrida.
 *
 * @param {string} promoId
 * @param {string} uid
 * @param {object} [extra]  — campos adicionais a salvar (ex: { nome, email })
 */
export async function registerParticipation(promoId, uid, extra = {}) {
  try {
    if (!promoId) throw new Error("promoId é obrigatório.");
    if (!uid)     throw new Error("uid é obrigatório.");

    const promoRef = doc(db, COL_PROMOS, promoId);
    const partRef  = doc(db, COL_PARTS, `${promoId}_${uid}`);
    const now      = new Date();

    await runTransaction(db, async (tx) => {
      const promoSnap = await tx.get(promoRef);
      const partSnap  = await tx.get(partRef);

      if (!promoSnap.exists()) throw new Error("Promoção não encontrada.");

      const p = promoSnap.data();

      // ── Validações dentro da transação ────────────────────────────────────
      if (p.status !== STATUS.ATIVA) {
        throw new Error(`Promoção não está ativa (status: ${p.status}).`);
      }

      if (p.dataFinal) {
        const end = typeof p.dataFinal.toDate === "function" ? p.dataFinal.toDate() : new Date(p.dataFinal);
        if (end < now) throw new Error("Promoção expirada.");
      }

      const qty   = Number(p.quantidade) || 0;
      const parts = Number(p.participacoes) || 0;
      if (qty > 0 && parts >= qty) throw new Error("Vagas esgotadas.");

      const limite = Number(p.limitePorUsuario) || 1;
      const count  = partSnap.exists() ? (Number(partSnap.data().count) || 0) : 0;
      if (limite > 0 && count >= limite) {
        throw new Error(`Limite atingido: ${count}/${limite} participações por usuário.`);
      }

      // ── Escritas atômicas ─────────────────────────────────────────────────
      tx.update(promoRef, {
        participacoes: increment(1),
        atualizadoEm:  serverTimestamp(),
      });

      // setDoc com merge=false + merge:true para campos existentes:
      // Se o doc não existe → cria com count=1
      // Se existe → atualiza count e ultimaParticipacaoEm
      tx.set(partRef, {
        promoId,
        uid,
        count:                count + 1,
        status:               "confirmada",
        criadoEm:             partSnap.exists() ? partSnap.data().criadoEm : serverTimestamp(),
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

    console.log("[Vip5PromocoesStorage] Participação registrada:", promoId, uid);
    return _ok({ promoId, uid, participacaoId: `${promoId}_${uid}` });
  } catch (e) {
    return _err("Erro ao registrar participação: " + e.message, e);
  }
}

// ════════════════════════════════════════════════════════════════════════════
// ADMIN — LEITURA DE PARTICIPAÇÕES E LOGS
// ════════════════════════════════════════════════════════════════════════════

/**
 * Lista participações de uma promoção com paginação.
 * Retorna um doc por usuário (com campo `count` indicando quantas vezes participou).
 * @param {string} promoId
 * @param {object} opts — { limit, startAfter }
 */
export async function fetchParticipations(promoId, { limit: lim = DEF_LIMIT, startAfter: sa = null } = {}) {
  try {
    if (!promoId) throw new Error("promoId é obrigatório.");

    const safeLimit = _safeLimit(lim);

    const constraints = [
      where("promoId", "==", promoId),
      orderBy("criadoEm", "desc"),
    ];
    if (sa) constraints.push(startAfter(sa));
    constraints.push(limit(safeLimit + 1));

    const q        = query(collection(db, COL_PARTS), ...constraints);
    const snapshot = await getDocs(q);
    const docs     = snapshot.docs;
    const hasMore  = docs.length > safeLimit;
    const page     = hasMore ? docs.slice(0, safeLimit) : docs;

    return _ok({
      items:   page.map(_serialize).filter(Boolean),
      hasMore,
      lastDoc: page.length > 0 ? page[page.length - 1] : null,
    });
  } catch (e) {
    return _err("Erro ao listar participações: " + e.message, e);
  }
}

/**
 * Lista logs de auditoria com paginação.
 * @param {object} opts — { promoId, limit, startAfter }
 */
export async function fetchLogs({ promoId = null, limit: lim = 50, startAfter: sa = null } = {}) {
  try {
    const safeLimit = _safeLimit(lim);

    const constraints = [
      where("module", "==", MODULE),
      orderBy("timestamp", "desc"),
    ];
    if (promoId) constraints.unshift(where("promoId", "==", promoId));
    if (sa) constraints.push(startAfter(sa));
    constraints.push(limit(safeLimit + 1));

    const q        = query(collection(db, COL_LOGS), ...constraints);
    const snapshot = await getDocs(q);
    const docs     = snapshot.docs;
    const hasMore  = docs.length > safeLimit;
    const page     = hasMore ? docs.slice(0, safeLimit) : docs;

    return _ok({
      items:   page.map(_serialize).filter(Boolean),
      hasMore,
      lastDoc: page.length > 0 ? page[page.length - 1] : null,
    });
  } catch (e) {
    return _err("Erro ao listar logs: " + e.message, e);
  }
}

// ─── Exposição global (para páginas que carregam como <script type="module">) ─
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
