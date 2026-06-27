import { db } from "./vip5-firebase.js";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  where,
  limit,
  addDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  runTransaction,
  serverTimestamp,
  increment,
  Timestamp,
  orderBy,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const COL_SORTEIOS = "vip5_sorteios";
const COL_LOGS = "vip5_sorteios_logs";
const SUB_PARTICIPANTS = "participantes";
const MODULE = "vip5_sorteios";
const DEF_LIMIT = 20;
const MAX_LIMIT = 200;
const DEFAULT_USER_LIMIT = 1;

export const STATUS = Object.freeze({
  PROGRAMADA: "programada",
  ATIVA: "ativa",
  PAUSADA: "pausada",
  ENCERRADA: "encerrada",
});

function _ok(data) {
  return { success: true, data, error: null };
}

function _err(message, error) {
  const text = message || (error && error.message) || "Erro desconhecido.";
  console.error(`[Vip5SorteiosStorage] ${text}`, error || "");
  return { success: false, data: null, error: text };
}

function _isString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function _toSafeString(value) {
  return _isString(value) ? value.trim() : null;
}

function _toNonNegativeInteger(value, fallback = 0) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) {
    return fallback;
  }
  return Math.floor(number);
}

function _safeLimit(value) {
  const limitValue = Number(value);
  if (!Number.isFinite(limitValue) || limitValue < 1) {
    return DEF_LIMIT;
  }
  return Math.min(Math.max(1, Math.floor(limitValue)), MAX_LIMIT);
}

function _stripUndefined(object) {
  return Object.fromEntries(Object.entries(object).filter(([, value]) => value !== undefined));
}

function _serializeSnapshot(snapshot) {
  return snapshot.exists() ? { id: snapshot.id, ...snapshot.data() } : null;
}

function _timestampToMillis(value) {
  if (!value) {
    return 0;
  }
  if (typeof value.toMillis === "function") {
    return value.toMillis();
  }
  if (value instanceof Date) {
    return value.getTime();
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : 0;
  }
  return 0;
}

function _normalizeTimestamp(value) {
  if (!value) {
    return null;
  }
  if (value instanceof Timestamp) {
    return value;
  }
  if (value instanceof Date) {
    return Timestamp.fromDate(value);
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return Timestamp.fromMillis(Math.floor(value));
  }
  if (typeof value === "string") {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) {
      return Timestamp.fromDate(parsed);
    }
    return null;
  }
  if (typeof value === "object" && value !== null && typeof value.toDate === "function") {
    const date = value.toDate();
    if (date instanceof Date && !Number.isNaN(date.getTime())) {
      return Timestamp.fromDate(date);
    }
  }
  return null;
}

function _toDate(value) {
  if (!value) {
    return null;
  }
  if (value instanceof Date) {
    return value;
  }
  if (typeof value === "object" && typeof value.toDate === "function") {
    return value.toDate();
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return new Date(value);
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function _participantDocRef(sorteioId, uid) {
  return doc(db, COL_SORTEIOS, sorteioId, SUB_PARTICIPANTS, uid);
}

function _participantCollectionRef(sorteioId) {
  return collection(db, COL_SORTEIOS, sorteioId, SUB_PARTICIPANTS);
}

function _validateSorteioPayload(payload, isCreate = true) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("Payload inválido.");
  }

  const errors = [];
  const titulo = _toSafeString(payload.titulo);
  const descricao = payload.descricao === undefined ? null : _toSafeString(String(payload.descricao));
  const imagem = payload.imagem === undefined ? null : _toSafeString(String(payload.imagem));
  const tipoSorteio = payload.tipoSorteio === undefined ? null : _toSafeString(String(payload.tipoSorteio));
  const status = payload.status === undefined ? null : payload.status;
  const quantidade = payload.quantidade === undefined ? undefined : _toNonNegativeInteger(payload.quantidade);
  const limitePorUsuario = payload.limitePorUsuario === undefined ? undefined : _toNonNegativeInteger(payload.limitePorUsuario);
  const dataVip = payload.dataVip === undefined ? null : _normalizeTimestamp(payload.dataVip);
  const dataPublica = payload.dataPublica === undefined ? null : _normalizeTimestamp(payload.dataPublica);
  const dataFinal = payload.dataFinal === undefined ? null : _normalizeTimestamp(payload.dataFinal);

  if (isCreate && !titulo) {
    errors.push('Campo obrigatório: "titulo".');
  }
  if (titulo && titulo.length > 200) {
    errors.push('"titulo" não pode exceder 200 caracteres.');
  }
  if (descricao && descricao.length > 1000) {
    errors.push('"descricao" não pode exceder 1000 caracteres.');
  }
  if (imagem && imagem.length > 1024) {
    errors.push('"imagem" não pode exceder 1024 caracteres.');
  }
  if (tipoSorteio && tipoSorteio.length > 100) {
    errors.push('"tipoSorteio" não pode exceder 100 caracteres.');
  }
  if (status !== null && !Object.values(STATUS).includes(status)) {
    errors.push(`"status" inválido. Use: ${Object.values(STATUS).join(", ")}.`);
  }
  if (payload.quantidade !== undefined && quantidade === undefined) {
    errors.push('"quantidade" deve ser um número inteiro não-negativo.');
  }
  if (payload.limitePorUsuario !== undefined && limitePorUsuario === undefined) {
    errors.push('"limitePorUsuario" deve ser um número inteiro não-negativo.');
  }
  if (payload.dataVip !== undefined && payload.dataVip !== null && !dataVip) {
    errors.push('"dataVip" inválida.');
  }
  if (payload.dataPublica !== undefined && payload.dataPublica !== null && !dataPublica) {
    errors.push('"dataPublica" inválida.');
  }
  if (payload.dataFinal !== undefined && payload.dataFinal !== null && !dataFinal) {
    errors.push('"dataFinal" inválida.');
  }

  if (dataVip && dataPublica && _timestampToMillis(dataVip) > _timestampToMillis(dataPublica)) {
    errors.push('"dataVip" deve ser anterior ou igual a "dataPublica".');
  }
  if (dataPublica && dataFinal && _timestampToMillis(dataPublica) > _timestampToMillis(dataFinal)) {
    errors.push('"dataPublica" deve ser anterior ou igual a "dataFinal".');
  }
  if (dataVip && dataFinal && _timestampToMillis(dataVip) > _timestampToMillis(dataFinal)) {
    errors.push('"dataVip" deve ser anterior ou igual a "dataFinal".');
  }

  if (errors.length > 0) {
    throw new Error(errors.join(" ")); 
  }

  return {
    titulo,
    descricao,
    imagem,
    tipoSorteio,
    status,
    quantidade,
    limitePorUsuario,
    dataVip,
    dataPublica,
    dataFinal,
  };
}

function _validateParticipationMeta(extra) {
  if (extra === undefined || extra === null) {
    return {};
  }
  if (typeof extra !== "object" || Array.isArray(extra)) {
    throw new Error('"extra" deve ser um objeto simples.');
  }

  const safeExtra = {};
  for (const [key, value] of Object.entries(extra)) {
    if (!_isString(key) || value === undefined) {
      continue;
    }
    if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      safeExtra[key] = value;
    }
  }
  return safeExtra;
}

async function _writeLog(entry) {
  try {
    await addDoc(collection(db, COL_LOGS), _stripUndefined({
      module: MODULE,
      action: entry.action || "unknown",
      sorteioId: entry.sorteioId || null,
      before: entry.before || null,
      after: entry.after || null,
      uid: entry.uid || null,
      message: entry.message || null,
      createdAt: serverTimestamp(),
      timestamp: serverTimestamp(),
    }));
  } catch (error) {
    console.warn("[Vip5SorteiosStorage] Falha ao gravar log:", error.message || error);
  }
}

async function _changeStatus(id, newStatus, action, label, admin = {}) {
  try {
    if (!_isString(id)) {
      throw new Error("ID do sorteio é obrigatório.");
    }

    const sorteioRef = doc(db, COL_SORTEIOS, id);
    await runTransaction(db, async (transaction) => {
      const snapshot = await transaction.get(sorteioRef);
      if (!snapshot.exists()) {
        throw new Error(`Sorteio não encontrado: "${id}".`);
      }

      transaction.update(sorteioRef, {
        status: newStatus,
        updatedAt: serverTimestamp(),
      });
    });

    await _writeLog({
      action,
      sorteioId: id,
      after: { status: newStatus },
      uid: admin?.uid || null,
      message: `Sorteio ${label}: "${id}"`,
    });

    return _ok({ id, status: newStatus });
  } catch (error) {
    return _err(`Erro ao ${label} sorteio: ${error.message}`, error);
  }
}

export async function createSorteio(payload, admin = {}) {
  try {
    const {
      titulo,
      descricao,
      imagem,
      tipoSorteio,
      status,
      quantidade,
      limitePorUsuario,
      dataVip,
      dataPublica,
      dataFinal,
    } = _validateSorteioPayload(payload, true);

    const data = _stripUndefined({
      titulo,
      descricao,
      imagem,
      tipoSorteio: tipoSorteio || "geral",
      status: status || STATUS.PROGRAMADA,
      quantidade: quantidade ?? 0,
      limitePorUsuario: limitePorUsuario ?? DEFAULT_USER_LIMIT,
      participacoesCount: 0,
      dataVip,
      dataPublica,
      dataFinal,
      createdBy: {
        uid: admin?.uid || null,
        email: admin?.email || null,
      },
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    const reference = await addDoc(collection(db, COL_SORTEIOS), data);
    const result = { id: reference.id, ...data };

    await _writeLog({
      action: "sorteio_create",
      sorteioId: reference.id,
      after: result,
      uid: admin?.uid || null,
      message: `Sorteio criado: "${titulo}"`,
    });

    return _ok(result);
  } catch (error) {
    return _err("Erro ao criar sorteio: " + error.message, error);
  }
}

export async function editSorteio(id, changes, admin = {}) {
  try {
    if (!_isString(id)) {
      throw new Error("ID do sorteio é obrigatório.");
    }
    if (!changes || typeof changes !== "object" || Array.isArray(changes)) {
      throw new Error("Alterações inválidas.");
    }

    const {
      titulo,
      descricao,
      imagem,
      tipoSorteio,
      status,
      quantidade,
      limitePorUsuario,
      dataVip,
      dataPublica,
      dataFinal,
    } = _validateSorteioPayload(changes, false);

    const update = _stripUndefined({
      titulo,
      descricao,
      imagem,
      tipoSorteio,
      status,
      quantidade,
      limitePorUsuario,
      dataVip,
      dataPublica,
      dataFinal,
      updatedAt: serverTimestamp(),
    });

    if (Object.keys(update).length === 1 && update.updatedAt) {
      throw new Error("Nenhuma alteração válida fornecida.");
    }

    let before = null;
    await runTransaction(db, async (transaction) => {
      const sorteioRef = doc(db, COL_SORTEIOS, id);
      const snapshot = await transaction.get(sorteioRef);
      if (!snapshot.exists()) {
        throw new Error(`Sorteio não encontrado: "${id}".`);
      }
      before = snapshot.data();
      transaction.update(sorteioRef, update);
    });

    await _writeLog({
      action: "sorteio_edit",
      sorteioId: id,
      before,
      after: update,
      uid: admin?.uid || null,
      message: `Sorteio editado: "${id}"`,
    });

    return _ok({ id, ...before, ...update });
  } catch (error) {
    return _err("Erro ao editar sorteio: " + error.message, error);
  }
}

export async function deleteSorteio(id, admin = {}) {
  try {
    if (!_isString(id)) {
      throw new Error("ID do sorteio é obrigatório.");
    }

    let before = null;
    await runTransaction(db, async (transaction) => {
      const sorteioRef = doc(db, COL_SORTEIOS, id);
      const snapshot = await transaction.get(sorteioRef);
      if (!snapshot.exists()) {
        throw new Error(`Sorteio não encontrado: "${id}".`);
      }
      before = snapshot.data();
      transaction.delete(sorteioRef);
    });

    await _writeLog({
      action: "sorteio_delete",
      sorteioId: id,
      before,
      after: null,
      uid: admin?.uid || null,
      message: `Sorteio excluído: "${id}"`,
    });

    return _ok({ id });
  } catch (error) {
    return _err("Erro ao excluir sorteio: " + error.message, error);
  }
}

export async function duplicateSorteio(id, admin = {}) {
  try {
    if (!_isString(id)) {
      throw new Error("ID do sorteio é obrigatório.");
    }

    const originalRef = doc(db, COL_SORTEIOS, id);
    const originalSnap = await getDoc(originalRef);
    if (!originalSnap.exists()) {
      throw new Error(`Sorteio não encontrado: "${id}".`);
    }

    const original = originalSnap.data();
    const copy = _stripUndefined({
      ...original,
      titulo: `${original.titulo || "(Sem título)"} (Cópia)`,
      status: STATUS.PROGRAMADA,
      participacoesCount: 0,
      createdBy: {
        uid: admin?.uid || null,
        email: admin?.email || null,
      },
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    const reference = await addDoc(collection(db, COL_SORTEIOS), copy);

    await _writeLog({
      action: "sorteio_duplicate",
      sorteioId: reference.id,
      before: { sourceId: id, sourceTitulo: original.titulo || null },
      after: copy,
      uid: admin?.uid || null,
      message: `Sorteio duplicado de "${id}" para "${reference.id}"`,
    });

    return _ok({ id: reference.id, ...copy });
  } catch (error) {
    return _err("Erro ao duplicar sorteio: " + error.message, error);
  }
}

export async function pauseSorteio(id, admin = {}) {
  return _changeStatus(id, STATUS.PAUSADA, "sorteio_pause", "pausar", admin);
}

export async function activateSorteio(id, admin = {}) {
  return _changeStatus(id, STATUS.ATIVA, "sorteio_activate", "ativar", admin);
}

export async function endSorteio(id, admin = {}) {
  return _changeStatus(id, STATUS.ENCERRADA, "sorteio_end", "encerrar", admin);
}

export async function fetchAllSorteios({ statusFilter = null, limit: lim = DEF_LIMIT } = {}) {
  try {
    const safeLimit = _safeLimit(lim);
    const constraints = [];

    if (statusFilter && Object.values(STATUS).includes(statusFilter)) {
      constraints.push(where("status", "==", statusFilter));
    }

    constraints.push(limit(safeLimit + 1));
    const queryRef = query(collection(db, COL_SORTEIOS), ...constraints);
    const snapshot = await getDocs(queryRef);
    const docs = snapshot.docs;
    const hasMore = docs.length > safeLimit;
    const page = hasMore ? docs.slice(0, safeLimit) : docs;

    const items = page
      .map(_serializeSnapshot)
      .filter(Boolean)
      .sort((a, b) => _timestampToMillis(b.createdAt) - _timestampToMillis(a.createdAt));

    return _ok({ items, hasMore, lastDoc: page.length > 0 ? page[page.length - 1] : null });
  } catch (error) {
    return _err("Erro ao listar sorteios: " + error.message, error);
  }
}

export async function fetchVisibleSorteios({ isVip = false, limit: lim = DEF_LIMIT } = {}) {
  try {
    const safeLimit = _safeLimit(lim);
    const now = new Date();
    const activeQuery = query(
      collection(db, COL_SORTEIOS),
      where("status", "==", STATUS.ATIVA),
      limit(safeLimit + 3)
    );
    const snapshot = await getDocs(activeQuery);
    const docs = snapshot.docs;
    const candidates = docs.map(_serializeSnapshot).filter(Boolean);

    const items = candidates
      .filter((sorteio) => {
        if (!sorteio) {
          return false;
        }
        const endDate = _toDate(sorteio.dataFinal);
        if (endDate && endDate < now) {
          return false;
        }
        const vipDate = _toDate(sorteio.dataVip);
        const publicDate = _toDate(sorteio.dataPublica);

        if (vipDate && vipDate <= now) {
          return true;
        }
        if (publicDate && publicDate <= now) {
          return true;
        }
        if (!vipDate && !publicDate) {
          return true;
        }
        if (isVip && vipDate && vipDate <= now) {
          return true;
        }
        return false;
      })
      .sort((a, b) => _timestampToMillis(b.createdAt) - _timestampToMillis(a.createdAt))
      .slice(0, safeLimit);

    return _ok({ items, hasMore: items.length >= safeLimit && docs.length > safeLimit, lastDoc: docs.length > 0 ? docs[docs.length - 1] : null });
  } catch (error) {
    return _err("Erro ao listar sorteios visíveis: " + error.message, error);
  }
}

export async function fetchSorteioById(id) {
  try {
    if (!_isString(id)) {
      throw new Error("ID é obrigatório.");
    }
    const snapshot = await getDoc(doc(db, COL_SORTEIOS, id));
    if (!snapshot.exists()) {
      throw new Error(`Sorteio não encontrado: "${id}".`);
    }
    return _ok(_serializeSnapshot(snapshot));
  } catch (error) {
    return _err("Erro ao buscar sorteio: " + error.message, error);
  }
}

export async function canParticipate(sorteioId, uid, vipData = null) {
  try {
    if (!_isString(sorteioId)) {
      throw new Error("sorteioId é obrigatório.");
    }
    if (!_isString(uid)) {
      throw new Error("uid é obrigatório.");
    }

    const [sorteioSnap, participantSnap] = await Promise.all([
      getDoc(doc(db, COL_SORTEIOS, sorteioId)),
      getDoc(_participantDocRef(sorteioId, uid)),
    ]);

    if (!sorteioSnap.exists()) {
      return _ok({ canParticipate: false, reason: "Sorteio não encontrado." });
    }

    const sorteio = sorteioSnap.data();
    const now = new Date();

    if (sorteio.status !== STATUS.ATIVA) {
      return _ok({ canParticipate: false, reason: `Sorteio não está ativo (status: ${sorteio.status}).` });
    }

    const endDate = _toDate(sorteio.dataFinal);
    if (endDate && endDate < now) {
      return _ok({ canParticipate: false, reason: "Sorteio expirado." });
    }

    const vipDate = _toDate(sorteio.dataVip);
    const publicDate = _toDate(sorteio.dataPublica);
    const isVipActive = vipData?.vip5Active === true && (!vipData.vip5ExpiresAt || vipData.vip5ExpiresAt > Date.now());

    if (vipDate && vipDate > now) {
      if (!isVipActive) {
        return _ok({ canParticipate: false, reason: "Sorteio disponível apenas para membros VIP no momento." });
      }
      return _ok({ canParticipate: true, reason: null });
    }

    if (publicDate && publicDate > now && !isVipActive) {
      return _ok({ canParticipate: false, reason: "Sorteio ainda não liberado ao público." });
    }

    const quantidade = _toNonNegativeInteger(sorteio.quantidade, 0);
    const participacoesCount = _toNonNegativeInteger(sorteio.participacoesCount, 0);
    if (quantidade > 0 && participacoesCount >= quantidade) {
      return _ok({ canParticipate: false, reason: "Vagas esgotadas." });
    }

    const limitePorUsuario = _toNonNegativeInteger(sorteio.limitePorUsuario, DEFAULT_USER_LIMIT);
    const participantData = participantSnap.exists() ? participantSnap.data() : null;
    const count = participantData ? _toNonNegativeInteger(participantData.count, 0) : 0;
    if (limitePorUsuario > 0 && count >= limitePorUsuario) {
      return _ok({
        canParticipate: false,
        reason: `Limite atingido: você já participou ${count} vezes (máximo: ${limitePorUsuario}).`,
      });
    }

    return _ok({ canParticipate: true, reason: null });
  } catch (error) {
    return _err("Erro ao verificar elegibilidade: " + error.message, error);
  }
}

export async function registerParticipation(sorteioId, uid, extra = {}) {
  try {
    if (!_isString(sorteioId)) {
      throw new Error("sorteioId é obrigatório.");
    }
    if (!_isString(uid)) {
      throw new Error("uid é obrigatório.");
    }

    const meta = _validateParticipationMeta(extra);
    const sorteioRef = doc(db, COL_SORTEIOS, sorteioId);
    const participantRef = _participantDocRef(sorteioId, uid);
    const now = new Date();

    await runTransaction(db, async (transaction) => {
      const sorteioSnap = await transaction.get(sorteioRef);
      if (!sorteioSnap.exists()) {
        throw new Error("Sorteio não encontrado.");
      }

      const sorteio = sorteioSnap.data();
      if (sorteio.status !== STATUS.ATIVA) {
        throw new Error(`Sorteio não está ativo (status: ${sorteio.status}).`);
      }

      const endDate = _toDate(sorteio.dataFinal);
      if (endDate && endDate < now) {
        throw new Error("Sorteio expirado.");
      }

      const quantidade = _toNonNegativeInteger(sorteio.quantidade, 0);
      const participacoesCount = _toNonNegativeInteger(sorteio.participacoesCount, 0);
      if (quantidade > 0 && participacoesCount >= quantidade) {
        throw new Error("Vagas esgotadas.");
      }

      const participantSnap = await transaction.get(participantRef);
      const currentCount = participantSnap.exists() ? _toNonNegativeInteger(participantSnap.data().count, 0) : 0;
      const limitePorUsuario = _toNonNegativeInteger(sorteio.limitePorUsuario, DEFAULT_USER_LIMIT);
      if (limitePorUsuario > 0 && currentCount >= limitePorUsuario) {
        throw new Error(`Limite atingido: ${currentCount}/${limitePorUsuario}.`);
      }

      transaction.update(sorteioRef, {
        participacoesCount: increment(1),
        updatedAt: serverTimestamp(),
      });

      transaction.set(participantRef, _stripUndefined({
        sorteioId,
        uid,
        count: currentCount + 1,
        status: "confirmada",
        createdAt: participantSnap.exists() ? participantSnap.data().createdAt : serverTimestamp(),
        lastParticipationAt: serverTimestamp(),
        ...meta,
      }), { merge: true });
    });

    await _writeLog({
      action: "participacao_registrada",
      sorteioId,
      after: { uid, participantId: uid },
      uid,
      message: `Participação registrada para sorteio "${sorteioId}".`,
    });

    return _ok({ sorteioId, uid, participantId: uid });
  } catch (error) {
    return _err("Erro ao registrar participação: " + error.message, error);
  }
}

export async function fetchParticipations(sorteioId, { limit: lim = DEF_LIMIT } = {}) {
  try {
    if (!_isString(sorteioId)) {
      throw new Error("sorteioId é obrigatório.");
    }

    const safeLimit = _safeLimit(lim);
    const participantsCollection = _participantCollectionRef(sorteioId);
    const participantsQuery = query(participantsCollection, orderBy("createdAt", "desc"), limit(safeLimit + 1));
    const snapshot = await getDocs(participantsQuery);
    const docs = snapshot.docs;
    const hasMore = docs.length > safeLimit;
    const page = hasMore ? docs.slice(0, safeLimit) : docs;

    const items = page
      .map(_serializeSnapshot)
      .filter(Boolean)
      .sort((a, b) => _timestampToMillis(b.createdAt) - _timestampToMillis(a.createdAt));

    return _ok({ items, hasMore, lastDoc: page.length > 0 ? page[page.length - 1] : null });
  } catch (error) {
    return _err("Erro ao listar participações: " + error.message, error);
  }
}

export async function fetchLogs({ sorteioId = null, limit: lim = 50 } = {}) {
  try {
    const safeLimit = _safeLimit(lim);
    const constraints = [where("module", "==", MODULE)];
    if (_isString(sorteioId)) {
      constraints.push(where("sorteioId", "==", sorteioId));
    }
    constraints.push(limit(safeLimit + 1));

    const logsQuery = query(collection(db, COL_LOGS), ...constraints);
    const snapshot = await getDocs(logsQuery);
    const docs = snapshot.docs;
    const hasMore = docs.length > safeLimit;
    const page = hasMore ? docs.slice(0, safeLimit) : docs;

    const items = page
      .map(_serializeSnapshot)
      .filter(Boolean)
      .sort((a, b) => _timestampToMillis(b.timestamp) - _timestampToMillis(a.timestamp));

    return _ok({ items, hasMore, lastDoc: page.length > 0 ? page[page.length - 1] : null });
  } catch (error) {
    return _err("Erro ao listar logs: " + error.message, error);
  }
}

const Vip5SorteiosStorage = Object.freeze({
  STATUS,
  createSorteio,
  editSorteio,
  deleteSorteio,
  duplicateSorteio,
  pauseSorteio,
  activateSorteio,
  endSorteio,
  fetchAllSorteios,
  fetchVisibleSorteios,
  fetchSorteioById,
  canParticipate,
  registerParticipation,
  fetchParticipations,
  fetchLogs,
});

export default Vip5SorteiosStorage;
