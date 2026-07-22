import { db } from "./vip5-firebase.js";
import {
  doc,
  getDoc,
  updateDoc,
  setDoc,
  serverTimestamp,
  writeBatch,
  runTransaction
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

let collectIntegrityIssues = (payload = {}) => ({ issues: [] });

const integrityModulePromise = import("./vip5-firestore-integrity.mjs")
  .then((module) => {
    if (typeof module.collectIntegrityIssues === "function") {
      collectIntegrityIssues = module.collectIntegrityIssues;
    }
  })
  .catch((error) => {
    console.warn("[VIP5-STORAGE] Não foi possível carregar vip5-firestore-integrity.mjs; usando fallback.", error);
  });

const CODE_COLLECTION = "vip5_codigos";
const USER_COLLECTION = "users";
const CODE_LENGTH = 16;
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function randomCodeSegment(len = 8) {
  const cryptoApi = globalThis.crypto;
  if (!cryptoApi?.getRandomValues) {
    throw new Error("Crypto API indisponível no navegador.");
  }

  const values = new Uint8Array(len);
  cryptoApi.getRandomValues(values);

  return Array.from(values, (value) => CODE_ALPHABET[value % CODE_ALPHABET.length]).join("");
}

function buildCodeCandidate(prefix = "", length = CODE_LENGTH) {
  const normalizedPrefix = String(prefix || "").trim().toUpperCase();
  const maxPrefixLength = Math.min(normalizedPrefix.length, Math.max(0, length - 8));
  const prefixPart = normalizedPrefix.slice(0, maxPrefixLength);
  const segmentLength = Math.max(1, length - prefixPart.length);
  return `${prefixPart}${randomCodeSegment(segmentLength)}`.toUpperCase();
}

export async function generateVipCodes({ prefix = "", qty = 1, days = 30, uid = null, sorteioId = null, existingCodes = [] } = {}) {
  try {
    const safeQty = Number.isFinite(Number(qty)) ? Math.max(1, Math.floor(Number(qty))) : 1;
    const safeDays = Number.isFinite(Number(days)) ? Math.max(1, Math.floor(Number(days))) : 30;
    const safeUid = uid ? String(uid).trim() : null;
    const safeSorteioId = sorteioId ? String(sorteioId).trim() : null;
    const existingSet = new Set(
      (existingCodes || [])
        .map((value) => String(value || "").trim().toUpperCase())
        .filter(Boolean)
    );

    const generatedCodes = [];
    let attempts = 0;
    const maxAttempts = Math.max(safeQty * 100, 1000);

    while (generatedCodes.length < safeQty && attempts < maxAttempts) {
      const candidate = buildCodeCandidate(prefix);
      if (existingSet.has(candidate) || generatedCodes.includes(candidate)) {
        attempts += 1;
        continue;
      }

      try {
        const candidateRef = doc(db, CODE_COLLECTION, candidate);
        const candidateSnap = await getDoc(candidateRef);

        if (!candidateSnap.exists()) {
          generatedCodes.push(candidate);
          existingSet.add(candidate);
        }
      } catch (checkError) {
        console.warn("[VIP5-STORAGE] Erro ao verificar existência de código:", checkError.message);
        attempts += 1;
        continue;
      }

      attempts += 1;
    }

    if (generatedCodes.length < safeQty) {
      throw new Error(`Não foi possível gerar ${safeQty} código(s) único(s). Tentativas esgotadas.`);
    }

    const batch = writeBatch(db);
    generatedCodes.forEach((code) => {
      const ref = doc(db, CODE_COLLECTION, code);
      batch.set(ref, {
        codigo: code,
        uid: safeUid,
        sorteioId: safeSorteioId,
        dataCriacao: serverTimestamp(),
        status: "ativo",
        usado: false,
        usadoPor: null,
        dataUso: null,
        days: safeDays,
        createdAt: serverTimestamp()
      });
    });

    await batch.commit();
    console.log("[VIP5-STORAGE] Códigos gerados e gravados com sucesso:", generatedCodes);
    return generatedCodes;
  } catch (err) {
    console.error("[VIP5-STORAGE] Erro ao gerar códigos:", err.message, err);
    throw new Error(`Erro ao gerar códigos: ${err.message}`);
  }
}

export async function saveGeneratorCodes({ generatedGames = [], days = 30, uid = null, sorteioId = null, existingCodes = [] } = {}) {
  try {
    const safeDays = Number.isFinite(Number(days)) ? Math.max(1, Math.floor(Number(days))) : 30;
    const safeUid = uid ? String(uid).trim() : null;
    const safeSorteioId = sorteioId ? String(sorteioId).trim() : null;
    const existingSet = new Set(
      (existingCodes || [])
        .map((value) => String(value || "").trim().toUpperCase())
        .filter(Boolean)
    );

    const codesToSave = [];
    const seen = new Set();
    const maxAttempts = Math.max((generatedGames || []).length * 100, 1000);

    for (const game of generatedGames) {
      let code = null;
      let attempts = 0;

      while (attempts < maxAttempts) {
        const candidate = buildCodeCandidate();
        if (existingSet.has(candidate) || seen.has(candidate)) {
          attempts += 1;
          continue;
        }

        const candidateRef = doc(db, CODE_COLLECTION, candidate);
        const candidateSnap = await getDoc(candidateRef);
        if (!candidateSnap.exists()) {
          code = candidate;
          break;
        }

        attempts += 1;
      }

      if (!code) {
        throw new Error("Não foi possível gerar código VIP único para um dos jogos do Gerador.");
      }

      codesToSave.push({ code });
      seen.add(code);
      existingSet.add(code);
    }

    if (!codesToSave.length) {
      throw new Error("Nenhum código gerado novo foi encontrado para salvar.");
    }

    const batch = writeBatch(db);
    codesToSave.forEach(({ code }) => {
      const ref = doc(db, CODE_COLLECTION, code);
      batch.set(ref, {
        codigo: code,
        uid: safeUid,
        sorteioId: safeSorteioId,
        dataCriacao: serverTimestamp(),
        status: "ativo",
        usado: false,
        usadoPor: null,
        dataUso: null,
        days: safeDays,
        createdAt: serverTimestamp()
      });
    });

    await batch.commit();
    console.log("[VIP5-STORAGE] Códigos do Gerador salvos com sucesso:", codesToSave.map((item) => item.code));
    return codesToSave.map((item) => item.code);
  } catch (err) {
    console.error("[VIP5-STORAGE] Erro ao salvar códigos do Gerador:", err.message, err);
    throw new Error(`Erro ao salvar códigos do Gerador: ${err.message}`);
  }
}

export async function getCode(code) {
  try {
    if (!code || !String(code).trim()) {
      throw new Error("Código inválido.");
    }
    const safeCode = String(code).trim().toUpperCase();
    console.log("[VIP5-STORAGE] Buscando código em " + CODE_COLLECTION + "/" + safeCode);
    
    const ref = doc(db, CODE_COLLECTION, safeCode);
    const snap = await getDoc(ref);
    
    if (!snap.exists()) {
      console.warn("[VIP5-STORAGE] Documento " + CODE_COLLECTION + "/" + safeCode + " NÃO encontrado.");
      return null;
    }
    
    const data = { id: snap.id, ...snap.data() };
    console.log("[VIP5-STORAGE] Documento encontrado:", data);
    return data;
  } catch (err) {
    console.error("[VIP5-STORAGE] Erro ao buscar código:", err.message, err);
    throw new Error(`Erro ao buscar código: ${err.message}`);
  }
}

export async function markCodeUsed(code, uid) {
  try {
    if (!code || !String(code).trim()) {
      throw new Error("Código inválido.");
    }
    if (!uid || !String(uid).trim()) {
      throw new Error("UID do usuário inválido.");
    }
    
    const safeCode = String(code).trim().toUpperCase();
    const safeUid = String(uid).trim();
    
    console.log("[VIP5-STORAGE] Marcando código como usado. code=" + safeCode + " uid=" + safeUid);
    
    const ref = doc(db, CODE_COLLECTION, safeCode);
    await updateDoc(ref, {
      usado: true,
      usadoPor: safeUid,
      dataUso: serverTimestamp(),
      status: "usado",
      activatedBy: safeUid,
      activatedAt: serverTimestamp()
    });
    
    console.log("[VIP5-STORAGE] Código marcado como usado com sucesso.");
  } catch (err) {
    console.error("[VIP5-STORAGE] Erro ao marcar código como usado:", err.message, err);
    throw new Error(`Erro ao marcar código como usado: ${err.message}`);
  }
}

export async function activateVipCode(code, uid, days) {
  try {
    if (!code || !String(code).trim()) {
      throw new Error("Código inválido.");
    }
    if (!uid || !String(uid).trim()) {
      throw new Error("UID do usuário inválido.");
    }
    if (!Number.isFinite(Number(days)) || Number(days) < 1) {
      throw new Error("Número de dias inválido.");
    }

    const safeCode = String(code).trim().toUpperCase();
    const safeUid = String(uid).trim();
    const safeDays = Math.floor(Number(days));
    const now = Date.now();
    const expiresAt = now + safeDays * 24 * 60 * 60 * 1000;

    const codeRef = doc(db, CODE_COLLECTION, safeCode);
    const userRef = doc(db, USER_COLLECTION, safeUid);
    const sorteioRef = code ? doc(db, "vip5_sorteios", String(code).trim().toUpperCase()) : null;

    await runTransaction(db, async (transaction) => {
      const codeSnap = await transaction.get(codeRef);
      if (!codeSnap.exists()) {
        throw new Error("Código não encontrado.");
      }

      const codeData = codeSnap.data();
      if (codeData?.usado === true || codeData?.used === true) {
        throw new Error("Este código já foi utilizado.");
      }
      if (codeData?.status && String(codeData.status).toLowerCase() !== "ativo") {
        throw new Error(`Código inativo (status: ${codeData.status}).`);
      }

      const userSnap = await transaction.get(userRef);
      const linkIssues = collectIntegrityIssues({
        codeDoc: codeData,
        userDoc: userSnap.exists() ? userSnap.data() : null,
      });

      if (codeData?.sorteioId) {
        const linkedSorteioRef = doc(db, "vip5_sorteios", String(codeData.sorteioId));
        const linkedSorteioSnap = await transaction.get(linkedSorteioRef);
        if (!linkedSorteioSnap.exists()) {
          transaction.update(codeRef, {
            sorteioId: null,
            sorteioLinkStatus: "orphaned",
            updatedAt: serverTimestamp(),
          });
        }
      }

      transaction.update(codeRef, {
        usado: true,
        usadoPor: safeUid,
        dataUso: serverTimestamp(),
        status: "usado",
        activatedBy: safeUid,
        activatedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      if (linkIssues.some((issue) => issue.type === "code_without_user")) {
        transaction.set(
          userRef,
          {
            createdAt: userSnap.exists() ? userSnap.data().createdAt : serverTimestamp(),
            vip5Active: true,
            vip5Code: safeCode,
            vip5ActivatedAt: now,
            vip5ExpiresAt: expiresAt,
            vip5Days: safeDays,
            vip5LastUpdatedAt: now,
            vip5CodeStatus: "usado",
            updatedAt: serverTimestamp(),
          },
          { merge: true }
        );
      } else {
        transaction.set(
          userRef,
          {
            vip5Active: true,
            vip5Code: safeCode,
            vip5ActivatedAt: now,
            vip5ExpiresAt: expiresAt,
            vip5Days: safeDays,
            vip5LastUpdatedAt: now,
            vip5CodeStatus: "usado",
            updatedAt: serverTimestamp(),
          },
          { merge: true }
        );
      }
    });

    console.log("[VIP5-STORAGE] Código ativado com sucesso. code=" + safeCode + " uid=" + safeUid + " expiresAt=" + expiresAt);
    return expiresAt;
  } catch (err) {
    console.error("[VIP5-STORAGE] Erro ao ativar código VIP:", err.message, err);
    throw new Error(`Erro ao ativar código: ${err.message}`);
  }
}

export async function saveUserVip(uid, code, days) {
  try {
    if (!uid || !String(uid).trim()) {
      throw new Error("UID do usuário inválido.");
    }
    if (!code || !String(code).trim()) {
      throw new Error("Código inválido.");
    }
    if (!Number.isFinite(Number(days)) || Number(days) < 1) {
      throw new Error("Número de dias inválido.");
    }
    
    const safeUid = String(uid).trim();
    const safeCode = String(code).trim().toUpperCase();
    const safeDays = Math.floor(Number(days));
    
    console.log("[VIP5-STORAGE] Gravando VIP em users/" + safeUid + " | code=" + safeCode + " | days=" + safeDays);
    
    const now = Date.now();
    const expiresAt = now + safeDays * 24 * 60 * 60 * 1000;
    const ref = doc(db, "users", safeUid);
    
    try {
      const beforeSnap = await getDoc(ref);
      console.log('[TRACE] saveUserVip before vip5Active:', beforeSnap.exists() ? beforeSnap.data().vip5Active : undefined);
    } catch (e) {
      console.warn('[TRACE] saveUserVip before read failed', e);
    }
    
    await setDoc(
      ref,
      {
        vip5Active: true,
        vip5Code: safeCode,
        vip5ActivatedAt: now,
        vip5ExpiresAt: expiresAt
      },
      { merge: true }
    );
    
    try {
      const afterSnap = await getDoc(ref);
      console.log('[TRACE] saveUserVip after vip5Active:', afterSnap.exists() ? afterSnap.data().vip5Active : undefined);
    } catch (e) {
      console.warn('[TRACE] saveUserVip after read failed', e);
    }
    
    console.log("[VIP5-STORAGE] VIP gravado com sucesso. vip5ExpiresAt=" + new Date(expiresAt).toISOString());
    return expiresAt;
  } catch (err) {
    console.error("[VIP5-STORAGE] Erro ao salvar VIP do usuário:", err.message, err);
    throw new Error(`Erro ao salvar VIP: ${err.message}`);
  }
}

export async function getUserVip(uid) {
  try {
    if (!uid || !String(uid).trim()) {
      throw new Error("UID do usuário inválido.");
    }
    
    const safeUid = String(uid).trim();
    console.log("[VIP5-STORAGE] Lendo dados VIP de users/" + safeUid);
    
    const ref = doc(db, "users", safeUid);
    const snap = await getDoc(ref);
    
    if (!snap.exists()) {
      console.warn("[VIP5-STORAGE] Documento users/" + safeUid + " NÃO existe.");
      return null;
    }
    
    const data = snap.data();
    console.log("[VIP5-STORAGE] Dados do usuário:", data);
    return data;
  } catch (err) {
    console.error("[VIP5-STORAGE] Erro ao ler dados VIP:", err.message, err);
    throw new Error(`Erro ao ler dados VIP: ${err.message}`);
  }
}

export async function deactivateUserVip(uid) {
  try {
    if (!uid || !String(uid).trim()) {
      throw new Error("UID do usuário inválido.");
    }
    
    const safeUid = String(uid).trim();
    console.log("[VIP5-STORAGE] Desativando VIP de users/" + safeUid);
    
    const ref = doc(db, "users", safeUid);
    
    try {
      const beforeSnap = await getDoc(ref);
      console.log('[TRACE] deactivateUserVip before vip5Active:', beforeSnap.exists() ? beforeSnap.data().vip5Active : undefined);
    } catch (e) {
      console.warn('[TRACE] deactivateUserVip before read failed', e);
    }
    
    await updateDoc(ref, { vip5Active: false });
    
    try {
      const afterSnap = await getDoc(ref);
      console.log('[TRACE] deactivateUserVip after vip5Active:', afterSnap.exists() ? afterSnap.data().vip5Active : undefined);
    } catch (e) {
      console.warn('[TRACE] deactivateUserVip after read failed', e);
    }
    
    console.log("[VIP5-STORAGE] VIP desativado.");
  } catch (err) {
    console.error("[VIP5-STORAGE] Erro ao desativar VIP:", err.message, err);
    throw new Error(`Erro ao desativar VIP: ${err.message}`);
  }
}
