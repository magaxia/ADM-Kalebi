

    function formatDate(ts) {
      return new Date(ts).toLocaleString("pt-BR", {
        day: "2-digit", month: "2-digit", year: "numeric",
        hour: "2-digit", minute: "2-digit"
      });
    }

    function fmtDateShort(v) {
      if (!v) return "—";
      const d = typeof v.toDate === "function" ? v.toDate() : (v instanceof Date ? v : new Date(v));
      return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
    }

    function pad(value) {
      return String(value).padStart(2, "0");
    }

    function showError(msg) {
      console.error("[VIP5-USUARIO] Erro:", msg);
      if (countdownTimer) { clearInterval(countdownTimer); countdownTimer = null; }
      document.getElementById("loading").style.display = "none";
      const errEl = document.getElementById("error-msg");
      errEl.textContent = msg;
      errEl.style.display = "block";
    }

    function startCountdown(expiresAt, activatedAt) {
      const totalMs = expiresAt - activatedAt;

      function tick() {
        const now         = Date.now();
        const remainingMs = expiresAt - now;

        if (remainingMs <= 0) {
          console.warn("[VIP5-USUARIO] Contagem chegou a zero. Verificando expiração...");
          clearInterval(countdownTimer);
          countdownTimer = null;

          document.getElementById("cd-days").textContent    = "00";
          document.getElementById("cd-hours").textContent   = "00";
          document.getElementById("cd-minutes").textContent = "00";
          document.getElementById("cd-seconds").textContent = "00";
          document.getElementById("progress-fill").style.width = "100%";
          document.getElementById("progress-pct").textContent  = "100% consumido";

          checkVipExpiration("vip5.html").catch((err) => {
            console.error("[VIP5-USUARIO] Erro ao re-verificar expiração:", err.code, err.message, err);
            window.location.href = "vip5.html";
          });
          return;
        }

        const days    = Math.floor(remainingMs / (1000 * 60 * 60 * 24));
        const hours   = Math.floor((remainingMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
        const minutes = Math.floor((remainingMs % (1000 * 60 * 60)) / (1000 * 60));
        const seconds = Math.floor((remainingMs % (1000 * 60)) / 1000);

        document.getElementById("cd-days").textContent    = pad(days);
        document.getElementById("cd-hours").textContent   = pad(hours);
        document.getElementById("cd-minutes").textContent = pad(minutes);
        document.getElementById("cd-seconds").textContent = pad(seconds);

        const consumed  = Math.max(0, Math.min(100, Math.round(((totalMs - remainingMs) / totalMs) * 100)));
        document.getElementById("progress-fill").style.width = consumed + "%";
        document.getElementById("progress-pct").textContent  = consumed + "% consumido";
      }

      tick();
      countdownTimer = setInterval(tick, 1000);
      console.log("[VIP5-USUARIO] Contagem regressiva iniciada. Timer ID:", countdownTimer);
    }

    function getCurrentProductContext() {
      const params = new URLSearchParams(window.location.search);
      const candidates = [
        params.get("productId"),
        params.get("produtoId"),
        window.__currentProductId,
        window.currentProductId,
        window.selectedProductId,
        document.querySelector("[data-product-id]")?.dataset?.productId,
      ].filter(Boolean);
      return candidates[0] || null;
    }

    // ── Renderiza lista de promoções disponíveis ─────────────────────────────
    function renderPromos(promos, uid, vipData) {
      const container = document.getElementById("promos-list");
      const card      = document.getElementById("promos-card");
      const countEl   = document.getElementById("promos-count");

      if (!promos || promos.length === 0) {
        card.style.display = "none";
        return;
      }

      card.style.display = "flex";

      if (countEl) {
        countEl.textContent = promos.length + (promos.length === 1 ? " disponível" : " disponíveis");
        countEl.style.display = "inline-flex";
      }

      const toDate = (v) => {
        if (!v) return null;
        if (typeof v.toDate === "function") return v.toDate();
        return v instanceof Date ? v : new Date(v);
      };

      const statusMap = {
        ativa:      { label: "ATIVA",      cls: "badge-ativa",      icon: "✅" },
        programada: { label: "PROGRAMADA", cls: "badge-programada", icon: "⏳" },
        pausada:    { label: "PAUSADA",    cls: "badge-pausada",    icon: "⏸" },
        encerrada:  { label: "ENCERRADA",  cls: "badge-encerrada",  icon: "❌" },
      };

      container.innerHTML = promos.map((p) => {
        const isVipEarly = p.dataVip && (!p.dataPublica || toDate(p.dataVip) <= new Date());
        const qty        = Number(p.quantidade) || 0;
        const parts      = Number(p.participacoes) || 0;
        const restantes  = qty === 0 ? null : qty - parts;
        const vagas      = qty === 0 ? "Ilimitadas" : `${Math.max(0, restantes)} restantes`;
        const vagasUrgente = qty > 0 && restantes !== null && restantes <= 5;
        const dataFim    = fmtDateShort(p.dataFinal);
        const limite     = Number(p.limitePorUsuario) || 1;

        const st = statusMap[p.status] || statusMap.ativa;
        const statusBadge = `<span class="promo-status-badge ${st.cls}">${st.icon} ${st.label}</span>`;

        const accessBadge = isVipEarly
          ? `<span class="promo-badge promo-badge-vip">⭐ Acesso VIP</span>`
          : `<span class="promo-badge promo-badge-publica">🌐 Pública</span>`;

        return `
          <div class="promo-card" id="promo-${p.id}">
            <div class="promo-card-header">
              <div class="promo-title-row">
                <span class="promo-icon-gift">🎁</span>
                <span class="promo-titulo">${p.titulo || "Promoção VIP"}</span>
              </div>
              <div class="promo-badges-row">
                ${statusBadge}
                ${accessBadge}
              </div>
            </div>

            <div class="promo-divider"></div>

            <div class="promo-info-grid">
              <div class="promo-info-item">
                <span class="promo-info-label">
                  <span class="promo-info-icon">👥</span> Vagas
                </span>
                <span class="promo-info-value${vagasUrgente ? " urgent" : ""}">${vagas}</span>
              </div>
              <div class="promo-info-item">
                <span class="promo-info-label">
                  <span class="promo-info-icon">🔁</span> Limite
                </span>
                <span class="promo-info-value">${limite}× por usuário</span>
              </div>
              <div class="promo-info-item">
                <span class="promo-info-label">
                  <span class="promo-info-icon">📅</span> Encerra
                </span>
                <span class="promo-info-value">${dataFim}</span>
              </div>
            </div>

            <button
              class="btn-participar"
              id="btn-part-${p.id}"
              onclick="participar('${p.id}', this)"
            >
              <span class="btn-label">Participar</span>
              <span class="btn-spinner"></span>
            </button>

            <p class="promo-feedback" id="feedback-${p.id}"></p>
          </div>`;
      }).join("");
    }

    // ── Carrega e exibe promoções disponíveis ────────────────────────────────
    async function loadPromos(uid, vipData) {
      const card = document.getElementById("promos-card");
      card.style.display = "flex";

      const isVipAtivo = vipData?.vip5Active === true
        && (!vipData.vip5ExpiresAt || vipData.vip5ExpiresAt > Date.now());

      const productId = getCurrentProductContext();
      console.log("[VIP5-USUARIO] Carregando promoções. isVip:", isVipAtivo, "productId:", productId);
      const result = await fetchVisiblePromotions({ isVip: isVipAtivo, limit: 10, productId });

      if (!result.success || result.data.items.length === 0) {
        document.getElementById("promos-list").innerHTML = `
          <div class="promos-empty">
            <span class="promos-empty-icon">🎁</span>
            Nenhuma promoção disponível no momento.
          </div>`;
        return;
      }

      renderPromos(result.data.items, uid, vipData);

      // Verifica elegibilidade de cada promoção em paralelo
      await Promise.all(result.data.items.map(async (p) => {
        const check = await canParticipate(p.id, uid, vipData, productId);
        const btn   = document.getElementById(`btn-part-${p.id}`);
        const fb    = document.getElementById(`feedback-${p.id}`);
        if (!btn) return;
        if (check.success && !check.data.canParticipate) {
          btn.disabled = true;
          const reason = check.data.reason || "";
          if (/limite|já partici/i.test(reason)) {
            btn.textContent  = "✔ Já participando";
            btn.classList.add("success");
            if (fb) { fb.className = "promo-feedback ok"; fb.textContent = "✔ Você já está participando deste sorteio."; }
          } else if (/vaga|esgot/i.test(reason)) {
            btn.textContent = "⚠ Vagas esgotadas";
            if (fb) { fb.className = "promo-feedback warn"; fb.textContent = "⚠ Todas as vagas foram preenchidas."; }
          } else {
            btn.textContent = "Indisponível";
            if (fb) { fb.className = "promo-feedback err"; fb.textContent = reason; }
          }
        }
      }));
    }

    // ── Handler de participação ───────────────────────────────────────────────
    window.participar = async function (promoId, btn) {
      if (!_currentUser) return;
      const fb      = document.getElementById(`feedback-${promoId}`);
      const label   = btn.querySelector(".btn-label");
      const spinner = btn.querySelector(".btn-spinner");

      btn.disabled = true;
      btn.classList.add("loading");
      if (label) label.textContent = "Registrando...";
      if (fb) { fb.className = "promo-feedback"; fb.textContent = ""; }

      const productId = getCurrentProductContext();
      const result = await registerParticipation(promoId, _currentUser.uid, { produtoId: productId || null }, _currentVip);

      btn.classList.remove("loading");

      if (result.success) {
        btn.classList.add("success");
        if (label) label.textContent = "✔ Participando!";
        if (fb) { fb.className = "promo-feedback ok"; fb.textContent = "✅ Sua participação foi registrada com sucesso!"; }
        console.log("[VIP5-USUARIO] Participação registrada:", promoId);
      } else {
        btn.disabled = false;
        if (label) label.textContent = "Participar";
        const errMsg = result.error || "Tente novamente.";
        let feedbackText = errMsg;
        let feedbackCls  = "promo-feedback err";
        if (/limite|já partici/i.test(errMsg)) {
          feedbackText = "✔ Você já está participando deste sorteio.";
          feedbackCls  = "promo-feedback ok";
          btn.disabled = true;
          btn.classList.add("success");
          if (label) label.textContent = "✔ Já participando";
        } else if (/vaga|esgot/i.test(errMsg)) {
          feedbackText = "⚠ Todas as vagas foram preenchidas.";
          feedbackCls  = "promo-feedback warn";
          btn.disabled = true;
          if (label) label.textContent = "⚠ Esgotado";
        }
        if (fb) { fb.className = feedbackCls; fb.textContent = feedbackText; }
        console.error("[VIP5-USUARIO] Erro na participação:", result.error);
      }
    };

    // ── Inicialização ─────────────────────────────────────────────────────────
    try {
      const { user, vipData } = await checkVipExpiration("vip5.html");

      _currentUser = user;
      _currentVip  = vipData;

      console.log("[VIP5-USUARIO] Acesso VIP válido. uid=" + user.uid);
      console.log("[VIP5-USUARIO] Dados VIP:", vipData);

      document.getElementById("uid-value").textContent       = user.uid;
      document.getElementById("code-value").textContent      = vipData.vip5Code || "—";
      document.getElementById("activated-value").textContent = formatDate(vipData.vip5ActivatedAt);
      document.getElementById("expires-value").textContent   = formatDate(vipData.vip5ExpiresAt);

      document.getElementById("loading").style.display = "none";
      document.getElementById("content").style.display = "flex";

      startCountdown(vipData.vip5ExpiresAt, vipData.vip5ActivatedAt);

      // Carrega promoções sem bloquear a exibição do conteúdo VIP
      loadPromos(user.uid, vipData).catch((err) => {
        console.error("[VIP5-USUARIO] Erro ao carregar promoções:", err.message, err);
      });

      document.getElementById("btn-logout").addEventListener("click", async () => {
        console.log("[VIP5-USUARIO] Fazendo logout...");
        if (countdownTimer) { clearInterval(countdownTimer); countdownTimer = null; }
        try {
          await signOut(auth);
          console.log("[VIP5-USUARIO] Logout realizado. Redirecionando para vip5.html");
          window.location.href = "vip5.html";
        } catch (err) {
          console.error("[VIP5-USUARIO] Erro no logout:", err.code, err.message, err);
          showError("Erro ao sair: " + err.message);
        }
      });

    } catch (err) {
      console.error("[VIP5-USUARIO] Erro ao verificar VIP:", err.code, err.message, err);
      showError("Erro ao verificar acesso VIP: " + (err.message || "Tente novamente."));
    }
  