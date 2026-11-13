// Atualização automática pelas releases do GitHub (electron-updater).
//
// Só a versão INSTALADA se atualiza sozinha: a troca é feita rodando, em modo
// silencioso, o instalador da versão nova. A versão portátil não tem
// instalação para trocar — ela só avisa que existe uma versão nova e oferece a
// página de download.
//
// A parte delicada é QUANDO instalar. O ColorSense passa dias na bandeja sem
// ser fechado, então "instalar quando o usuário sair" quase nunca aconteceria.
// Por isso:
//   1. a versão nova é baixada em segundo plano assim que aparece;
//   2. se o usuário sair pelo menu da bandeja, ela é instalada na saída;
//   3. se não sair, é instalada na próxima abertura do programa, ANTES de
//      qualquer janela — para o app nunca abrir e sumir logo em seguida;
//   4. e a bandeja oferece "Reiniciar e atualizar" para quem não quer esperar.

const { app } = require('electron');
const Store = require('electron-store');
const fs = require('fs');
const path = require('path');

const PAGINA_DE_DOWNLOAD = 'https://github.com/MuriloJeronymo/Color-Sense/releases/latest';

const PRIMEIRA_VERIFICACAO = 15 * 1000;              // deixa a abertura terminar antes
const INTERVALO_DE_VERIFICACAO = 4 * 60 * 60 * 1000;
// Sem internet a verificação falha em instantes; o prazo cobre a rede lenta,
// para a abertura nunca ficar presa esperando o servidor.
const PRAZO_NA_ABERTURA = 20 * 1000;
// Um instalador que falha sempre não pode transformar cada abertura numa
// tentativa que fecha o app. Passado isto, só instala quando o app for fechado.
const MAXIMO_DE_TENTATIVAS = 2;
const TAMANHO_MAXIMO_DO_LOG = 256 * 1024;

let updater = null;
let store = null;
let ativo = false;
let portatil = false;

let estado = { tipo: 'nenhuma', versao: null };   // nenhuma | baixando | pronta | disponivel
const avisosDados = new Set();
let terminarAbertura = null;

let aoMudar = () => {};
let avisar = () => {};
let antesDeInstalar = () => {};

// ── Registro ─────────────────────────────────────────────────────────────────
// Vai para um arquivo porque é no computador de um participante, longe de
// qualquer terminal, que uma atualização vai falhar. Para diagnosticar, basta
// pedir o atualizacao.log da pasta de dados do app.

function registrar(nivel, ...partes) {
  try {
    const arquivo = path.join(app.getPath('userData'), 'atualizacao.log');
    try {
      if (fs.statSync(arquivo).size > TAMANHO_MAXIMO_DO_LOG) fs.renameSync(arquivo, arquivo + '.1');
    } catch (_) {}
    const texto = partes.map(p => (p && p.stack) ? p.stack : String(p)).join(' ');
    fs.appendFileSync(arquivo, `${new Date().toISOString()} ${nivel} ${texto}\n`);
  } catch (_) {}
}

const logger = {
  info:  (...m) => registrar('INFO', ...m),
  warn:  (...m) => registrar('AVISO', ...m),
  error: (...m) => registrar('ERRO', ...m),
  debug: () => {}
};

// "0.10.0" é mais nova que "0.9.9". Só números: o ColorSense não usa sufixos
// como "-beta" nas versões.
function maisNova(a, b) {
  const pa = String(a).split('.').map(n => parseInt(n, 10) || 0);
  const pb = String(b).split('.').map(n => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] || 0, y = pb[i] || 0;
    if (x !== y) return x > y;
  }
  return false;
}

function mudar(tipo, versao) {
  if (estado.tipo === tipo && estado.versao === versao) return;
  estado = { tipo, versao };
  aoMudar(estado);
}

// Um aviso por versão: a verificação periódica reencontra a mesma versão a
// cada quatro horas, e repetir o balão seria só incômodo.
function avisarUmaVez(chave, titulo, texto) {
  if (avisosDados.has(chave)) return;
  avisosDados.add(chave);
  avisar(titulo, texto);
}

// A falha já chega pelo evento 'error' e vai para o registro. Os catch aqui só
// impedem uma rejeição não tratada, que no processo principal do Electron pode
// virar uma caixa de erro na tela do usuário.
function verificar() {
  return updater.checkForUpdates()
    .then((r) => {
      if (r && r.downloadPromise) r.downloadPromise.catch(() => {});
      return r;
    })
    .catch(() => null);
}

function instalar(versao, motivo) {
  const tentativas = store.get('tentativas', {});
  tentativas[versao] = (tentativas[versao] || 0) + 1;
  store.set('tentativas', tentativas);
  registrar('INFO', `instalando ${versao} (${motivo}, tentativa ${tentativas[versao]})`);

  antesDeInstalar();
  // Instalador sem telas (true), e o programa abre sozinho no fim (true).
  updater.quitAndInstall(true, true);
}

function configurar(opcoes = {}) {
  if (opcoes.aoMudar) aoMudar = opcoes.aoMudar;
  if (opcoes.avisar) avisar = opcoes.avisar;
  if (opcoes.antesDeInstalar) antesDeInstalar = opcoes.antesDeInstalar;

  // Rodando pelo código-fonte (npm start) não há instalação para trocar.
  if (!app.isPackaged) return;
  ativo = true;

  store = new Store({ name: 'atualizacao' });
  portatil = !!process.env.PORTABLE_EXECUTABLE_DIR;

  updater = require('electron-updater').autoUpdater;
  updater.logger = logger;
  updater.autoDownload = !portatil;
  updater.autoInstallOnAppQuit = !portatil;

  registrar('INFO', `ColorSense ${app.getVersion()} ${portatil ? 'portátil' : 'instalado'}`);

  // Esta já é a versão que estava baixada: a instalação deu certo.
  const pendente = store.get('versaoBaixada');
  if (pendente && !maisNova(pendente, app.getVersion())) {
    registrar('INFO', `atualização para ${pendente} concluída`);
    store.delete('versaoBaixada');
    store.delete('tentativas');
  }

  updater.on('update-available', (info) => {
    if (portatil) {
      mudar('disponivel', info.version);
      avisarUmaVez('disponivel ' + info.version, 'Nova versão do ColorSense',
        `A versão ${info.version} está disponível. Baixe pelo menu do ícone do ColorSense na bandeja.`);
    } else if (!(estado.tipo === 'pronta' && estado.versao === info.version)) {
      mudar('baixando', info.version);
    }
  });

  updater.on('update-not-available', () => {
    // A versão que estava baixada não é mais a mais nova publicada (a release
    // foi apagada, por exemplo): não há mais o que instalar.
    if (store.get('versaoBaixada')) store.delete('versaoBaixada');
    if (terminarAbertura) terminarAbertura(false);
  });

  updater.on('update-downloaded', (info) => {
    store.set('versaoBaixada', info.version);

    if (terminarAbertura) {
      const terminar = terminarAbertura;
      avisar('Atualizando o ColorSense',
        `Instalando a versão ${info.version}. O programa abre sozinho em alguns segundos.`);
      // Se o instalador não puder nem começar, o 'error' chega aqui dentro,
      // antes do terminar(true), e a abertura segue normal em vez de o app
      // ficar parado sem janela.
      instalar(info.version, 'na abertura');
      terminar(true);
      return;
    }

    mudar('pronta', info.version);
    avisarUmaVez('pronta ' + info.version, 'Atualização pronta',
      `A versão ${info.version} será instalada na próxima vez que o ColorSense abrir.`);
  });

  updater.on('error', (erro) => {
    registrar('ERRO', erro);
    if (terminarAbertura) terminarAbertura(false);
    if (estado.tipo === 'baixando') mudar('nenhuma', null);
  });
}

// Chamada na abertura, antes de criar janelas. Resolve true quando uma versão
// baixada numa sessão anterior vai ser instalada agora: o app está fechando
// para isso, e quem chamou não deve abrir nada.
function instalarPendenteNaAbertura() {
  if (!ativo || portatil) return Promise.resolve(false);

  const pendente = store.get('versaoBaixada');
  if (!pendente || !maisNova(pendente, app.getVersion())) return Promise.resolve(false);

  const tentativas = store.get('tentativas', {})[pendente] || 0;
  if (tentativas >= MAXIMO_DE_TENTATIVAS) {
    registrar('AVISO', `a instalação de ${pendente} já foi tentada ${tentativas} vezes; ` +
      'abrindo normalmente, ela fica para quando o app for fechado');
    return Promise.resolve(false);
  }

  registrar('INFO', `versão ${pendente} já baixada: instalando antes de abrir`);

  return new Promise((resolver) => {
    let prazo = null;
    const terminar = (instalou) => {
      if (terminarAbertura !== terminar) return;
      terminarAbertura = null;
      clearTimeout(prazo);
      if (!instalou) registrar('INFO', 'abertura segue sem instalar');
      resolver(instalou);
    };
    terminarAbertura = terminar;
    prazo = setTimeout(() => {
      registrar('AVISO', `sem resposta em ${PRAZO_NA_ABERTURA / 1000}s; a atualização fica para depois`);
      terminar(false);
    }, PRAZO_NA_ABERTURA);
    verificar().then((r) => { if (r == null) terminar(false); });
  });
}

function iniciarVerificacoes() {
  if (!ativo) return;
  setTimeout(verificar, PRIMEIRA_VERIFICACAO);
  setInterval(verificar, INTERVALO_DE_VERIFICACAO);
}

function instalarAgora() {
  if (!ativo || estado.tipo !== 'pronta') return;
  instalar(estado.versao, 'pedido na bandeja');
}

function estadoAtual() {
  return { ...estado };
}

module.exports = {
  configurar,
  instalarPendenteNaAbertura,
  iniciarVerificacoes,
  instalarAgora,
  estadoAtual,
  PAGINA_DE_DOWNLOAD
};
