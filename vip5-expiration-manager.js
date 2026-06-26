import { auth } from "./vip5-firebase.js";
import { getUserVip, deactivateUserVip } from "./vip5-storage.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

export async function checkVipExpiration(redirectOnExpired = "vip5.html") {
  console.log("[VIP5-EXPIRATION] Iniciando verificação de expiração VIP...");
  return new Promise((resolve, reject) => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      unsubscribe();
      if (!user) {
        console.warn("[VIP5-EXPIRATION] Nenhum usuário autenticado. Redirecionando para login.html");
        window.location.href = "login.html";
        return;
      }

      console.log("[VIP5-EXPIRATION] Usuário autenticado: uid=" + user.uid);

      try {
        const data = await getUserVip(user.uid);

        if (!data || !data.vip5Active) {
          console.warn("[VIP5-EXPIRATION] VIP não ativo ou documento inexistente. Redirecionando para " + redirectOnExpired);
          window.location.href = redirectOnExpired;
          return;
        }

        const now = Date.now();
        console.log("[VIP5-EXPIRATION] now=" + now + " | vip5ExpiresAt=" + data.vip5ExpiresAt + " | expirado=" + (now >= data.vip5ExpiresAt));

        if (now >= data.vip5ExpiresAt) {
          console.warn("[VIP5-EXPIRATION] VIP expirado. Desativando e redirecionando para " + redirectOnExpired);
          await deactivateUserVip(user.uid);
          window.location.href = redirectOnExpired;
          return;
        }

        console.log("[VIP5-EXPIRATION] VIP válido. Acesso liberado.");
        resolve({ user, vipData: data });
      } catch (err) {
        console.error("[VIP5-EXPIRATION] Erro ao verificar expiração:", err.code, err.message, err);
        reject(err);
      }
    });
  });
}
