import { initDespesas, resetDespesas, redrawDespesasChart } from './views/despesas.js';
import { initFolha, resetFolha, redrawFolha } from './views/folha.js';
import { initInvestigacao, resetInvestigacao } from './views/investigacao.js';
import { initPainelDoc, fecharDoc } from './views/painel-doc.js';
import { FERRAMENTAS, ferramenta, porGrupo } from './ferramentas.js';

const THEME_KEY = 'sigavoce-theme';
const $ = id => document.getElementById(id);

function isLight() {
  return document.documentElement.classList.contains('theme-light');
}

function applyTheme(light) {
  document.documentElement.classList.toggle('theme-light', light);
  const btn = $('btn-theme');
  btn.textContent = light ? '☾ Escuro' : '☀ Claro';
  btn.setAttribute('aria-label', light ? 'Mudar para tema escuro' : 'Mudar para tema claro');
  redrawDespesasChart();
  redrawFolha();
}

function initTheme() {
  applyTheme(isLight());
  $('btn-theme').addEventListener('click', () => {
    const light = !isLight();
    try { localStorage.setItem(THEME_KEY, light ? 'light' : 'dark'); } catch (e) {}
    applyTheme(light);
  });
}

function initHeader() {
  const btnSobre   = $('btn-sobre');
  const aboutPanel = $('header-about');
  btnSobre.addEventListener('click', () => {
    const isOpen = btnSobre.getAttribute('aria-expanded') === 'true';
    btnSobre.setAttribute('aria-expanded', String(!isOpen));
    aboutPanel.classList.toggle('open', !isOpen);
    aboutPanel.setAttribute('aria-hidden', String(isOpen));
  });

  const sigaWrap = $('siga-wrap');
  let sigaTimer = null;
  sigaWrap.addEventListener('mouseenter', () => {
    if (sigaTimer) return;
    sigaWrap.classList.add('show-agis');
    sigaTimer = setTimeout(() => {
      sigaWrap.classList.remove('show-agis');
      sigaTimer = null;
    }, 2500);
  });

  document.querySelectorAll('.filter-help-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const help   = btn.closest('.filter-help');
      const isOpen = help.classList.contains('open');
      document.querySelectorAll('.filter-help.open').forEach(h => h.classList.remove('open'));
      if (!isOpen) help.classList.add('open');
    });
  });
  document.addEventListener('click', () => {
    document.querySelectorAll('.filter-help.open').forEach(h => h.classList.remove('open'));
  });
}

const SUBTITULO_INICIO = 'ANÁLISE DE DADOS PÚBLICOS';

const RESET = {
  despesas: resetDespesas,
  folha   : resetFolha,
  investigacao: resetInvestigacao,
};

let currentView = null;

function showView(view) {
  const atual = ferramenta(view);
  if (!atual) view = '';
  if (view === currentView) return;

  if (currentView && RESET[currentView]) RESET[currentView]();
  fecharDoc();
  currentView = view;

  $('chooser').hidden = view !== '';
  $('toolbar').hidden = !atual;
  for (const f of FERRAMENTAS) $('view-' + f.rota).hidden = f.rota !== view;
  $('header-subtitle').textContent = atual ? atual.subtitulo : SUBTITULO_INICIO;
  $('crumb-atual').textContent = atual ? atual.nome : '';
  window.scrollTo({ top: 0 });
}

function listaFerramentas() {
  return porGrupo().map(({ grupo, itens }) => `
    <div class="tools-grupo">
      <span class="tools-grupo-nome">${grupo.nome}</span>
      ${itens.map(f => `
        <a class="tools-item" href="#${f.rota}" data-rota="${f.rota}">
          <span class="tools-item-nome">${f.nome}</span>
          <span class="tools-item-resumo">${f.resumo}</span>
        </a>`).join('')}
    </div>`).join('');
}

function initInicio() {
  $('home-tools').innerHTML = listaFerramentas();
}

function initRouter() {
  const fromHash = () => showView(location.hash.replace(/^#\/?/, ''));
  window.addEventListener('hashchange', fromHash);
  $('crumb-home').addEventListener('click', e => {
    e.preventDefault();
    history.pushState(null, '', location.pathname + location.search);
    showView('');
  });
  fromHash();
}

initTheme();
initHeader();
initInicio();
initDespesas();
initFolha();
initInvestigacao();
initPainelDoc();
initRouter();
