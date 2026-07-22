// firebase-helper.js
// Uso: incluir em todas as páginas após libs Firebase compat

const firebaseConfig = {
  apiKey: "AIzaSyAcVPgUHbL4N9U1-H68klmGKWQF-YGleyc",
  authDomain: "vastbitloud-2872a.firebaseapp.com",
  projectId: "vastbitloud-2872a",
  storageBucket: "vastbitloud-2872a.firebasestorage.app",
  messagingSenderId: "952931184412",
  appId: "1:952931184412:web:ee2a0e38826c30dd0cd4d9",
  measurementId: "G-KWVQ0CFHW2"
};

window.FirebaseHelper = window.FirebaseHelper || {};

window.FirebaseHelper.initializeFirebase = function() {
  const firebaseModule = window.__VIP5_FIREBASE__ || window.firebase;
  if (!firebaseModule?.db || !firebaseModule?.auth) {
    console.error('Firebase modular não encontrado.');
    return this;
  }

  this.db = firebaseModule.firestoreCompat || firebaseModule.db;
  this.auth = firebaseModule.auth;
  this.firebase = window.firebase || firebaseModule;
  return this;
};

window.FirebaseHelper.getDB = function() {
  if (!this.db) {
    this.initializeFirebase();
  }
  return this.db;
};

window.FirebaseHelper.getAuth = function() {
  if (!this.auth) {
    this.initializeFirebase();
  }
  return this.auth;
};

window.FirebaseHelper.getDeviceId = function() {
  let deviceId = localStorage.getItem('deviceId');
  if (!deviceId) {
    deviceId = `dev-${Math.random().toString(36).substr(2, 10)}-${Date.now()}`;
    localStorage.setItem('deviceId', deviceId);
  }
  return deviceId;
};

window.FirebaseHelper.normalizarEmail = function(email) {
  if (!email || typeof email !== 'string') return null;
  const normalized = email.trim().toLowerCase();
  if (normalized.endsWith('@noemail.local')) return null;
  return normalized;
};

window.FirebaseHelper.normalizarTelefone = function(telefone) {
  if (!telefone || typeof telefone !== 'string') return null;
  const numeros = telefone.replace(/\D/g, '').trim();
  return numeros ? numeros : null;
};

window.FirebaseHelper.formatarDataRobusta = function(value) {
  const date = this.normalizarData(value);
  if (!date) return 'Data não disponível';
  return date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' }) + ' ' + date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
};

window.FirebaseHelper.formatarDataCurta = function(value) {
  const date = this.normalizarData(value);
  if (!date) return '---';
  return date.toLocaleDateString('pt-BR');
};

window.FirebaseHelper.normalizarData = function(value) {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value.toDate === 'function') return value.toDate();
  if (typeof value === 'number') return new Date(value);
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? null : new Date(parsed);
  }
  return null;
};

window.FirebaseHelper.detectarTipoDispositivo = function() {
  if (typeof navigator === 'undefined' || !navigator.userAgent) return 'desktop';
  return /Mobi|Android|iPhone|iPad|iPod|Windows Phone/i.test(navigator.userAgent) ? 'mobile' : 'desktop';
};

window.FirebaseHelper.isPixKeySuspeita = function(tipoPix, chave) {
  if (!tipoPix || !chave) return true;
  const valor = String(chave).trim();
  if (!valor) return true;
  switch (tipoPix) {
    case 'cpf':
      return !/^\d{11}$/.test(valor);
    case 'telefone':
      return !/^\d{10,15}$/.test(valor);
    case 'email':
      return !/^\S+@\S+\.\S+$/.test(valor);
    case 'aleatoria':
      return valor.length < 20 || /\s/.test(valor);
    default:
      return true;
  }
};

window.FirebaseHelper.isEmailFake = function(email, telefone = null) {
  if (!email || typeof email !== 'string') {
    return !this.normalizarTelefone(telefone);
  }
  const normalized = email.trim().toLowerCase();
  if (!normalized) {
    return !this.normalizarTelefone(telefone);
  }
  if (normalized.endsWith('@noemail.local')) return false;
  const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailPattern.test(normalized)) return true;
  const parts = normalized.split('@');
  if (parts.length !== 2) return true;
  const [localPart, domain] = parts;
  if (!localPart || !domain) return true;
  const disposable = ['mailinator', '10minutemail', 'yopmail', 'trashmail', 'guerrillamail', 'dispostable', 'fakeinbox', 'maildrop', 'tempmail', 'mailnesia', 'sharklasers', 'mintemail', 'jetable', 'spamgourmet', 'temp-mail', 'trashmail', 'mailcatch'];
  if (disposable.some(token => domain.includes(token))) return true;
  if (/^[0-9]+$/.test(localPart)) return true;
  return false;
};

window.FirebaseHelper.getScorePorSubtipo = function(subtipo) {
  switch ((subtipo || '').toLowerCase()) {
    case 'saque_alto_fora_padrao': return 50;
    case 'saque_fora_padrao': return 40;
    case 'saque_alto_valor': return 40;
    case 'deposito_alto_valor': return 35;
    case 'deposito_repetido_curto_intervalo': return 35;
    case 'spam_recarga': return 30;
    case 'conta_incompleta_alto_valor': return 35;
    case 'troca_pix_frequente': return 25;
    case 'pix_chave_suspeita': return 30;
    case 'dois_dispositivos_simultaneos': return 30;
    case 'login_dispositivo_diferente': return 25;
    case 'login_pais_diferente': return 5;
    case 'mudanca_regiao_rapida': return 10;
    case 'novo_dispositivo': return 15;
    case 'novo_fingerprint': return 15;
    case 'mudanca_dispositivo': return 15;
    case 'proxy_vpn_detectado': return 8;
    case 'login_curto_intervalo': return 8;
    case 'excesso_logins_5min': return 20;
    case 'dois_dispositivos_simultaneos': return 15;
    case 'login_dispositivo_diferente': return 15;
    case 'multiplas_contas_mesmo_ip': return 30;
    case 'varias_contas_mesmo_aparelho': return 30;
    case 'contas_mesmo_email': return 30;
    case 'contas_mesmo_telefone': return 30;
    case 'comportamento_financeiro_anormal': return 30;
    case 'saque_sem_historico': return 35;
    case 'cadastro_usuario': return 5;
    case 'email_falso': return 25;
    case 'saldo_congelado': return 25;
    case 'bloqueio_temporario': return 45;
    case 'bloqueio_automatico': return 70;
    default: return 10;
  }
};

window.FirebaseHelper.getShortIp = function(ip) {
  if (!ip || typeof ip !== 'string') return 'desconhecido';
  if (ip.includes('.')) return ip.split('.').slice(0, 3).join('.') + '.*';
  if (ip.includes(':')) return ip.split(':').slice(0, 3).join(':') + ':*';
  return ip;
};

window.FirebaseHelper.isLocalIp = function(ip) {
  if (!ip || typeof ip !== 'string') return false;
  const normalized = ip.toString().trim().toLowerCase();
  if (['localhost', '127.0.0.1', '::1', '0.0.0.0'].includes(normalized)) return true;
  return /^127\.|^10\.|^192\.168\.|^172\.(1[6-9]|2\d|3[0-1])\.|^fc00:|^fe80:/.test(normalized);
};

window.FirebaseHelper.isUnknownGeo = function(value) {
  if (value === undefined || value === null) return true;
  const normalized = value.toString().trim().toLowerCase();
  return normalized === '' || ['desconhecido', 'unknown', 'null', 'undefined', '-', 'n/a'].includes(normalized);
};

window.FirebaseHelper.isModoTeste = function() {
  if (typeof window === 'undefined') return false;
  const hostname = (window.location.hostname || '').toString().trim().toLowerCase();
  if (['localhost', '127.0.0.1', '::1', '0.0.0.0'].includes(hostname)) return true;
  if (window.location.protocol === 'file:') return true;
  return this.isLocalIp(hostname);
};

window.FirebaseHelper.isUsuarioCompleto = function(usuario) {
  if (!usuario || typeof usuario !== 'object') return false;
  const nome = (usuario.nome || '').toString().trim();
  const documento = (usuario.cpf || usuario.documento || usuario.cnpj || usuario.rg || '').toString().trim();
  if (nome.length < 6) return false;
  if (!documento) return false;
  return true;
};

window.FirebaseHelper.getDeviceFingerprint = function() {
  const navigatorInfo = typeof navigator !== 'undefined' ? navigator : {};
  const screenInfo = typeof screen !== 'undefined' ? screen : {};
  const fingerprint = [
    navigatorInfo.userAgent || '',
    navigatorInfo.platform || '',
    navigatorInfo.vendor || '',
    navigatorInfo.language || '',
    Intl.DateTimeFormat().resolvedOptions().timeZone || '',
    screenInfo.width || '',
    screenInfo.height || '',
    screenInfo.colorDepth || '',
    navigatorInfo.hardwareConcurrency || '',
    navigatorInfo.deviceMemory || '',
    navigatorInfo.languages ? navigatorInfo.languages.join(',') : ''
  ].filter(Boolean).join('|');
  return fingerprint || 'desconhecido';
};

window.FirebaseHelper.isVPNorProxyIp = function(geo) {
  if (!geo || typeof geo !== 'object') return false;
  const provider = (geo.provider || '').toString().toLowerCase();
  const ip = (geo.ip || '').toString();
  if (this.isLocalIp(ip)) return false;
  const vpnTokens = ['vpn', 'proxy', 'amazon', 'google', 'cloudflare', 'digitalocean', 'ovh', 'akamai', 'microsoft', 'linode', 'fastly'];
  if (vpnTokens.some(token => provider.includes(token))) return true;
  return false;
};

window.FirebaseHelper.verificarNovoDispositivoOuFingerprint = async function(uidUsuario, deviceId, fingerprint, usuario = {}) {
  if (!uidUsuario || !deviceId || !fingerprint) return false;
  const usuarioAnterior = usuario || {};
  const fingerprintAntigo = usuarioAnterior.fingerprint || '';
  const deviceIdAntigo = usuarioAnterior.deviceId || '';
  const possivelNovoDevice = deviceIdAntigo && deviceId && deviceIdAntigo !== deviceId;
  const possivelNovoFingerprint = fingerprintAntigo && fingerprintAntigo !== fingerprint;
  if (possivelNovoDevice || possivelNovoFingerprint) {
    await this.criarNotificacaoSuspeita({
      uidUsuario,
      subtipo: 'mudanca_dispositivo',
      titulo: 'Mudança de dispositivo detectada',
      mensagem: 'Login realizado em dispositivo ou fingerprint diferente do histórico.',
      prioridade: 'média',
      score: this.getScorePorSubtipo('mudanca_dispositivo'),
      deviceId,
      contexto: `Anterior: ${deviceIdAntigo || 'desconhecido'} / Fingerprint anterior: ${fingerprintAntigo ? '[oculto]' : 'nenhum'}`
    });
    return true;
  }
  return false;
};

window.FirebaseHelper.verificarMudancaRegiaoRapida = async function(uidUsuario, paisAnterior, paisAtual, geo) {
  if (!uidUsuario || !paisAnterior || !paisAtual) return false;
  if (this.isUnknownGeo(paisAnterior) || this.isUnknownGeo(paisAtual)) return false;
  if (this.isLocalIp(geo?.ip)) return false;
  if (paisAnterior.toString().trim().toLowerCase() === paisAtual.toString().trim().toLowerCase()) return false;
  await this.criarNotificacaoSuspeita({
    uidUsuario,
    subtipo: 'mudanca_regiao_rapida',
    titulo: 'Mudança de região rápida detectada',
    mensagem: `Login de país/região diferente detectado: ${paisAtual}. Acesso permitido, alerta apenas informativo.`,
    prioridade: 'baixa',
    score: this.getScorePorSubtipo('mudanca_regiao_rapida'),
    pais: paisAtual,
    ip: geo.ip,
    contexto: `País anterior: ${paisAnterior}`
  });
  return true;
};

window.FirebaseHelper.verificarComportamentoFinanceiro = async function(uidUsuario, janelaHoras = 72) {
  if (!uidUsuario) return false;
  const db = this.getDB();
  try {
    const corte = window.__VIP5_FIREBASE__?.timestamp?.fromMillis(Date.now() - janelaHoras * 60 * 60 * 1000) || Date.now();
    const [depSnap, saqueSnap] = await Promise.all([
      db.collection('depositos').where('uid', '==', uidUsuario).where('data', '>=', corte).get(),
      db.collection('saques').where('uid', '==', uidUsuario).where('dataSaque', '>=', corte).get()
    ]);
    const depositos = depSnap.docs.map(doc => Number((doc.data() || {}).valor) || 0).filter(v => v > 0);
    const saques = saqueSnap.docs.map(doc => Number((doc.data() || {}).valorSolicitado) || 0).filter(v => v > 0);
    if (depositos.length >= 4 && depositos.reduce((a,b)=>a+b,0) >= 1000) {
      await this.criarNotificacaoSuspeita({
        uidUsuario,
        subtipo: 'deposito_repetido_curto_intervalo',
        titulo: 'Vários depósitos em curto período',
        mensagem: `Foram registrados ${depositos.length} depósitos em ${janelaHoras}h totalizando R$ ${depositos.reduce((a,b)=>a+b,0).toFixed(2)}.`,
        prioridade: 'alta',
        score: this.getScorePorSubtipo('deposito_repetido_curto_intervalo'),
        valor: depositos.reduce((a,b)=>a+b,0),
        contexto: `Depósitos: ${depositos.map(v => v.toFixed(2)).join(', ')}`
      });
    }
    if (saques.length >= 2 && saques.reduce((a,b)=>a+b,0) >= 3000) {
      await this.criarNotificacaoSuspeita({
        uidUsuario,
        subtipo: 'comportamento_financeiro_anormal',
        titulo: 'Padrão financeiro atípico',
        mensagem: `Foram solicitados ${saques.length} saques em ${janelaHoras}h totalizando R$ ${saques.reduce((a,b)=>a+b,0).toFixed(2)}.`,
        prioridade: 'alta',
        score: this.getScorePorSubtipo('comportamento_financeiro_anormal'),
        valor: saques.reduce((a,b)=>a+b,0),
        contexto: `Saques: ${saques.map(v => v.toFixed(2)).join(', ')}`
      });
    }
    return true;
  } catch (error) {
    console.warn('Erro ao verificar comportamento financeiro:', error);
    return false;
  }
};

window.FirebaseHelper.verificarSaqueSemHistorico = async function(uidUsuario, valorSolicitado) {
  if (!uidUsuario || !valorSolicitado || valorSolicitado <= 0) return false;
  const db = this.getDB();
  try {
    const snapshot = await db.collection('saques').where('uid', '==', uidUsuario).limit(3).get();
    if (snapshot.empty && valorSolicitado >= 500) {
      await this.criarNotificacaoSuspeita({
        uidUsuario,
        subtipo: 'saque_sem_historico',
        titulo: 'Primeiro saque alto detectado',
        mensagem: `Solicitação de saque R$ ${valorSolicitado.toFixed(2)} em conta com histórico de saques limitado.`,
        prioridade: 'alta',
        score: this.getScorePorSubtipo('saque_sem_historico'),
        valor: valorSolicitado,
        contexto: `Saques anteriores: ${snapshot.size}`
      });
      return true;
    }
    return false;
  } catch (error) {
    console.warn('Erro ao verificar saque sem histórico:', error);
    return false;
  }
};

window.FirebaseHelper.registrarAuditoriaAntifraude = async function(uidUsuario, acao, motivo, meta = {}) {
  const db = this.getDB();
  if (!db || !uidUsuario || !acao) return null;
  try {
    return await db.collection('auditoria_antifraude').add({
      uidUsuario,
      acao,
      motivo,
      meta,
      criadoEm: window.__VIP5_FIREBASE__?.fieldValue?.serverTimestamp()
    });
  } catch (error) {
    console.warn('Erro ao registrar auditoria antifraude:', error);
    return null;
  }
};

window.FirebaseHelper.atualizarStatusAntifraude = async function(uidUsuario, atualizacoes = {}) {
  const db = this.getDB();
  if (!db || !uidUsuario || typeof atualizacoes !== 'object') return null;
  try {
    await db.collection('users').doc(uidUsuario).set({
      ...atualizacoes,
      atualizadoEm: firebase.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
  } catch (error) {
    console.error('Erro ao atualizar status antifraude:', error);
  }
};

window.FirebaseHelper.marcarContaMonitorada = async function(uidUsuario, motivo, score = 0, extra = {}) {
  const db = this.getDB();
  if (!db || !uidUsuario) return null;
  try {
    await this.atualizarStatusAntifraude(uidUsuario, {
      monitorado: true,
      bloqueadoParaSaques: true,
      status: 'monitorado',
      motivoBloqueio: motivo,
      scoreBloqueio: score,
      ultimaAcaoAntifraude: window.__VIP5_FIREBASE__?.fieldValue?.serverTimestamp()
    });

    return await this.criarNotificacaoSuspeita({
      uidUsuario,
      subtipo: 'bloqueio_temporario',
      titulo: 'Bloqueio temporário para revisão',
      mensagem: `Conta marcada para revisão e saque temporariamente bloqueado. Motivo: ${motivo}`,
      prioridade: 'crítica',
      score,
      contexto: extra.contexto || '',
      extra: { ...extra, motivo, bloqueioTemporario: true }
    });
  } catch (error) {
    console.error('Erro ao marcar conta monitorada:', error);
    return null;
  }
};

window.FirebaseHelper.verificarMultiplasContasMesmoIp = async function(ip, uidUsuario, deviceId, fingerprint) {
  const db = this.getDB();
  if (!db || !ip || !uidUsuario) return 0;
  if (typeof ip === 'string' && ip.toLowerCase().includes('desconhecido')) return 0;
  if (this.isLocalIp(ip)) return 0;
  try {
    const snapshot = await db.collection('users').where('ip', '==', ip).get();
    const outros = snapshot.docs.filter(doc => doc.id !== uidUsuario);
    const outrosMesmoDevice = outros.filter(doc => {
      const dados = doc.data();
      return dados.deviceId === deviceId || (dados.fingerprint && fingerprint && dados.fingerprint === fingerprint);
    });
    if (outrosMesmoDevice.length > 0) {
      await this.criarNotificacaoSuspeita({
        uidUsuario,
        subtipo: 'multiplas_contas_mesmo_ip',
        titulo: 'Contas suspeitas no mesmo IP e dispositivo',
        mensagem: `Encontradas ${outrosMesmoDevice.length + 1} conta(s) com mesmo IP e dispositivo/fingerprint.`,
        prioridade: 'média',
        score: this.getScorePorSubtipo('multiplas_contas_mesmo_ip'),
        contexto: `IP completo: ${ip} / deviceId: ${deviceId || 'desconhecido'}`
      });
    }
    return outrosMesmoDevice.length;
  } catch (error) {
    console.warn('Erro ao verificar múltiplas contas no mesmo IP:', error);
    return 0;
  }
};

window.FirebaseHelper.verificarVariasContasMesmoAparelho = async function(deviceId, uidUsuario) {
  const db = this.getDB();
  if (!db || !deviceId || !uidUsuario) return 0;
  try {
    const snapshot = await db.collection('users').where('deviceId', '==', deviceId).limit(10).get();
    const outros = snapshot.docs.filter(doc => doc.id !== uidUsuario);
    if (outros.length > 0) {
      await this.criarNotificacaoSuspeita({
        uidUsuario,
        subtipo: 'varias_contas_mesmo_aparelho',
        titulo: 'Mesmo dispositivo usado em várias contas',
        mensagem: `Detectadas ${outros.length + 1} conta(s) usando o mesmo deviceId.`,
        prioridade: 'alta',
        score: this.getScorePorSubtipo('varias_contas_mesmo_aparelho'),
        contexto: `deviceId: ${deviceId}`
      });
    }
    return outros.length;
  } catch (error) {
    console.warn('Erro ao verificar várias contas no mesmo aparelho:', error);
    return 0;
  }
};

window.FirebaseHelper.verificarSpamRecarga = async function(uidUsuario, janelaMinutos = 30, limite = 3) {
  const db = this.getDB();
  if (!db || !uidUsuario) return 0;
  try {
    const corte = window.__VIP5_FIREBASE__?.timestamp?.fromMillis(Date.now() - janelaMinutos * 60 * 1000) || Date.now();
    const snapshot = await db.collection('depositos')
      .where('uid', '==', uidUsuario)
      .where('data', '>=', corte)
      .get();
    const quantidade = snapshot.docs.length;
    if (quantidade >= limite) {
      await this.criarNotificacaoSuspeita({
        uidUsuario,
        subtipo: 'spam_recarga',
        titulo: 'Recargas em curto espaço de tempo',
        mensagem: `Foram realizadas ${quantidade} recargas nos últimos ${janelaMinutos} minutos.`,
        prioridade: 'alta',
        score: this.getScorePorSubtipo('spam_recarga'),
        contexto: `Janela: ${janelaMinutos} minutos`
      });
    }
    return quantidade;
  } catch (error) {
    console.warn('Erro ao verificar spam de recarga:', error);
    return 0;
  }
};

window.FirebaseHelper.verificarSaqueForaPadrao = async function(uidUsuario, valorSolicitado, horas = 72) {
  const db = this.getDB();
  if (!db || !uidUsuario || !valorSolicitado || valorSolicitado <= 0) return false;
  try {
    const corte = firebase.firestore.Timestamp.fromMillis(Date.now() - horas * 60 * 60 * 1000);
    const snapshot = await db.collection('saques')
      .where('uid', '==', uidUsuario)
      .where('dataSaque', '>=', corte)
      .get();
    const valores = snapshot.docs
      .map(doc => Number((doc.data() || {}).valorSolicitado) || 0)
      .filter(v => v > 0);
    if (valores.length < 2) return false;
    const media = valores.reduce((a, b) => a + b, 0) / valores.length;
    if (media > 0 && valorSolicitado > Math.max(500, media * 3)) {
      await this.criarNotificacaoSuspeita({
        uidUsuario,
        subtipo: 'saque_fora_padrao',
        titulo: 'Saque fora do padrão histórico',
        mensagem: `Solicitação de saque de R$ ${valorSolicitado.toFixed(2)} está muito acima da média de R$ ${media.toFixed(2)}.`,
        prioridade: 'alta',
        score: this.getScorePorSubtipo('saque_fora_padrao'),
        valor: valorSolicitado,
        contexto: `Média últimos ${valores.length} saques: R$ ${media.toFixed(2)}`
      });
      return true;
    }
    return false;
  } catch (error) {
    console.warn('Erro ao verificar saque fora do padrão:', error);
    return false;
  }
};

window.FirebaseHelper.verificarTrocaPixFrequente = async function(uidUsuario, chaveAtual, horas = 24) {
  const db = this.getDB();
  if (!db || !uidUsuario || !chaveAtual) return false;
  try {
    const corte = firebase.firestore.Timestamp.fromMillis(Date.now() - horas * 60 * 60 * 1000);
    const snapshot = await db.collection('saques')
      .where('uid', '==', uidUsuario)
      .where('dataSaque', '>=', corte)
      .get();
    const chaves = snapshot.docs
      .map(doc => (doc.data() || {}).chave)
      .filter(chave => typeof chave === 'string' && chave.trim())
      .map(chave => chave.trim());
    const distintos = Array.from(new Set(chaves));
    const chaveAtualTrim = chaveAtual.trim();
    if (distintos.length >= 2 || (distintos.length === 1 && distintos[0] !== chaveAtualTrim)) {
      await this.criarNotificacaoSuspeita({
        uidUsuario,
        subtipo: 'troca_pix_frequente',
        titulo: 'Troca de chave Pix frequente',
        mensagem: `O usuário está usando chaves Pix diferentes nas últimas ${horas} horas.`,
        prioridade: 'alta',
        score: this.getScorePorSubtipo('troca_pix_frequente'),
        contexto: `Chaves recentes: ${distintos.concat(chaveAtualTrim).filter((v, i, arr) => arr.indexOf(v) === i).join(', ')}`
      });
      return true;
    }
    return false;
  } catch (error) {
    console.warn('Erro ao verificar troca de Pix frequente:', error);
    return false;
  }
};

window.FirebaseHelper.verificarContaIncompletaAltoValor = async function(uidUsuario, valor, usuario = {}) {
  if (!uidUsuario || !valor || valor <= 0) return false;
  const threshold = 500;
  const nome = (usuario.nome || '').toString().trim();
  const documento = (usuario.cpf || usuario.documento || usuario.cnpj || usuario.rg || '').toString().trim();
  const incompleto = nome.length < 6 || !documento;
  if (incompleto && valor >= threshold) {
    await this.criarNotificacaoSuspeita({
      uidUsuario,
      subtipo: 'conta_incompleta_alto_valor',
      titulo: 'Conta incompleta movendo alto valor',
      mensagem: `Transação de R$ ${valor.toFixed(2)} detectada em conta sem documentação ou nome completo.`,
      prioridade: 'alta',
      score: this.getScorePorSubtipo('conta_incompleta_alto_valor'),
      valor,
      contexto: `Nome válido: ${nome.length >= 6}; documento: ${documento ? 'sim' : 'não'}`
    });
    return true;
  }
  return false;
};

window.FirebaseHelper.calcularScoreSuspeita = async function(uidUsuario, dias = 1) {
  const db = this.getDB();
  if (!db || !uidUsuario) return 0;

    const corte = window.__VIP5_FIREBASE__?.timestamp?.fromMillis(Date.now() - dias * 24 * 60 * 60 * 1000) || Date.now();
  try {
    const snapshot = await db.collection('notificacoes')
      .where('uidUsuario', '==', uidUsuario)
      .limit(200)
      .get();

    return snapshot.docs.reduce((total, doc) => {
      const data = doc.data();
      const dataTimestamp = data.data && typeof data.data.toMillis === 'function'
        ? data.data.toMillis()
        : new Date(data.data).getTime();
      if (!dataTimestamp || dataTimestamp < corte.toMillis()) {
        return total;
      }
      return total + (Number(data.score) || 0);
    }, 0);
  } catch (error) {
    console.warn('Erro ao calcular score de suspeita:', error);
    return 0;
  }
};

window.FirebaseHelper.marcarBloqueioAutomatico = async function(uidUsuario, motivo, score = 0, extra = {}) {
  const db = this.getDB();
  if (!db || !uidUsuario) return null;
  try {
    await db.collection('users').doc(uidUsuario).set({
      status: 'bloqueado',
      bloqueado: true,
      motivoBloqueio: motivo,
      scoreBloqueio: score,
      atualizadoEm: firebase.firestore.FieldValue.serverTimestamp()
    }, { merge: true });

    return await this.criarNotificacaoSuspeita({
      uidUsuario,
      subtipo: 'bloqueio_automatico',
      titulo: 'Bloqueio automático por risco alto',
      mensagem: `Conta bloqueada automaticamente por risco ${score}. Motivo: ${motivo}`,
      prioridade: 'crítica',
      score,
      contexto: extra.contexto || '',
      extra: { ...extra, motivo }
    });
  } catch (error) {
    console.error('Erro ao marcar bloqueio automático:', error);
    return null;
  }
};

window.FirebaseHelper.getSeverityPorScore = function(score) {
  if (score >= 90) return { label: 'Crítico', color: '#c0392b', emoji: '🔴' };
  if (score >= 60) return { label: 'Suspeito', color: '#e67e22', emoji: '🟠' };
  if (score >= 30) return { label: 'Atenção', color: '#f1c40f', emoji: '🟡' };
  return { label: 'Normal', color: '#2ecc71', emoji: '🟢' };
};

window.FirebaseHelper.getGeoData = async function() {
  if (this._geoCache) return this._geoCache;
  const fallback = { ip: 'desconhecido', country_name: 'desconhecido', country: 'desconhecido', region: '', city: '' };
  const endpoints = [];
  try {
    const origin = window.location.origin;
    if (origin && origin !== 'null') endpoints.push(origin + '/api/geo');
  } catch (e) {}
  endpoints.push('https://ipapi.co/json/');

  for (const url of endpoints) {
    try {
      const response = await fetch(url, { cache: 'no-store' });
      if (!response.ok) continue;
      const data = await response.json();
      if (data && (data.ip || data.country_name || data.country)) {
        this._geoCache = {
          ip: data.ip || data.ip_address || fallback.ip,
          country_name: data.country_name || data.country || fallback.country_name,
          country: data.country || data.country_name || fallback.country,
          region: data.region || data.region_name || '',
          city: data.city || '',
          provider: data.org || data.org_name || ''
        };
        return this._geoCache;
      }
    } catch (error) {
      console.warn('Não foi possível obter geo via', url, error);
    }
  }
  this._geoCache = fallback;
  return fallback;
};

window.FirebaseHelper.notificacaoDuplicadaExiste = async function(tipo, uidUsuario, subtipo = '', mensagem = '', janelaMs = 600000) {
  const db = this.getDB();
  if (!db || !tipo || !uidUsuario) return false;
  try {
    const corte = firebase.firestore.Timestamp.fromMillis(Date.now() - janelaMs);
    const snapshot = await db.collection('notificacoes')
      .where('uidUsuario', '==', uidUsuario)
      .get();

    const notificacoes = snapshot.docs
      .map(doc => ({ id: doc.id, ...doc.data() }))
      .filter(data => (data.subtipo || '') === subtipo)
      .sort((a, b) => {
        const aTime = a.data && a.data.toMillis ? a.data.toMillis() : 0;
        const bTime = b.data && b.data.toMillis ? b.data.toMillis() : 0;
        return bTime - aTime;
      });

    return notificacoes.some(data => {
      if ((data.tipo || '') !== tipo) return false;
      const recente = data.data && data.data.toMillis && data.data.toMillis() >= corte.toMillis();
      return recente;
    });
  } catch (error) {
    console.warn('Falha ao verificar notificação duplicada:', error);
    return false;
  }
};

window.FirebaseHelper.criarNotificacaoSuspeita = async function(options = {}) {
  const db = this.getDB();
  if (!db) {
    console.error('Firestore não inicializado para criar notificação de suspeita');
    return null;
  }

  const {
    tipo = 'usuario_suspeito',
    subtipo = 'geral',
    titulo = 'Usuário suspeito',
    mensagem = 'Atividade suspeita detectada',
    uidUsuario = '',
    prioridade = 'alta',
    score = this.getScorePorSubtipo(subtipo),
    destinatario = 'admin',
    valor = 0,
    dispositivo = '',
    ip = '',
    pais = '',
    contexto = '',
    extra = {},
    antiSpamWindowMs = 600000
  } = options;

  const geo = await this.getGeoData();
  const agora = new Date();
  const scoreFinal = this.isModoTeste() ? Math.max(0, Math.round(score * 0.5)) : score;
  const expiresEm = new Date(agora.getTime() + ((prioridade === 'crítica' || score >= 50) ? 90 : 30) * 24 * 60 * 60 * 1000);
  const payload = {
    tipo,
    subtipo,
    titulo,
    mensagem,
    uidUsuario,
    prioridade,
    score: scoreFinal,
    destinatario,
    valor: Number(valor) || 0,
    dispositivo: dispositivo || this.detectarTipoDispositivo(),
    deviceId: options.deviceId || this.getDeviceId(),
    ip: ip || geo.ip || 'desconhecido',
    pais: pais || geo.country_name || geo.country || 'desconhecido',
    contexto,
    data: window.__VIP5_FIREBASE__?.fieldValue?.serverTimestamp(),
    expiresEm: window.__VIP5_FIREBASE__?.timestamp?.fromDate(expiresEm),
    lida: false,
    resolvido: false,
    extra: typeof extra === 'object' ? extra : { extra }
  };

  try {
    if (uidUsuario && await this.notificacaoDuplicadaExiste(tipo, uidUsuario, subtipo, mensagem, antiSpamWindowMs)) {
      console.log('Notificação de suspeita duplicada evitada:', tipo, uidUsuario, subtipo);
      return null;
    }

    const docRef = await db.collection('notificacoes').add(payload);
    console.log('Notificação de suspeita criada:', docRef.id, payload);
    if (uidUsuario) {
      await this.registrarAuditoriaAntifraude(uidUsuario, 'notificacao_suspeita', subtipo, {
        score,
        prioridade,
        contexto,
        tipo,
        ip: payload.ip,
        pais: payload.pais
      });
    }
    return docRef.id;
  } catch (error) {
    console.error('Erro ao criar notificação de suspeita:', error);
    return null;
  }
};

if (window.location.protocol === 'file:') {
  const warning = document.createElement('div');
  warning.style.position = 'fixed';
  warning.style.top = '0';
  warning.style.left = '0';
  warning.style.right = '0';
  warning.style.padding = '10px';
  warning.style.background = '#ffcc00';
  warning.style.color = '#000';
  warning.style.zIndex = '9999';
  warning.innerText = '⚠️ Rodando em file://. Use servidor local ou Node.js para /api/geo.';
  if (document.body) {
    document.body.appendChild(warning);
  } else {
    window.addEventListener('DOMContentLoaded', () => {
      if (document.body) {
        document.body.appendChild(warning);
      }
    });
  }
}
