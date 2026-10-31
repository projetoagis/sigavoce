import { escapeHtml } from '../core/format.js';

const $ = id => document.getElementById(id);
const ESPERA_AVISO = 12000;
let tempo = null;
let partesPorUrl = new Map();

export function rotuloParte(arquivo, i) {
  const m = /[_\s-]parte?[_\s-]?0*(\d+)/i.exec(String(arquivo || ''));
  return `Parte ${m ? m[1] : i + 1}`;
}

export function registrarPartes(grupos) {
  partesPorUrl = new Map();
  for (const docs of grupos) {
    const comUrl = docs.filter(d => d.url);
    if (comUrl.length < 2) continue;
    const lista = comUrl.map((d, i) => ({ url: d.url, titulo: d.arquivo || `DOC ${d.n}`, rotulo: rotuloParte(d.arquivo, i) }));
    for (const p of lista) partesPorUrl.set(p.url, lista);
  }
}

export function linkDoc(d, texto, classe = '', dica = '') {
  if (!d || !d.url) return escapeHtml(texto);
  const titulo = d.arquivo || `DOC ${d.n}`;
  return `<a class="doc-link${classe ? ` ${classe}` : ''}" href="${escapeHtml(d.url)}" data-pdf="1" target="_blank" rel="noopener noreferrer"
    data-titulo="${escapeHtml(titulo)}" title="${escapeHtml(dica || titulo)}">${escapeHtml(texto)}</a>`;
}

const ICO = {
  confirmado: '<circle cx="8" cy="8" r="7"/><path class="doc-selo-traco" d="M4.6 8.2l2.3 2.3 4.5-4.7"/>',
  localizado: '<circle class="doc-selo-aro" cx="8" cy="8" r="6.2"/><circle cx="8" cy="8" r="3"/>',
  texto: '<path d="M3 1.5h6.5L13 5v9.5H3z"/><path class="doc-selo-traco" d="M5.3 7.5h5.4M5.3 10h5.4M5.3 12.4h3.4"/>',
  conferir: '<path d="M8 1.2l7 13.3H1z"/><path class="doc-selo-traco" d="M8 6v4.3M8 12.2v.3"/>',
};

export const SELOS = {
  confirmado: ['Confirmado', 'Arquivo de pagamento com o número do processo no nome, na competência do pagamento; o texto traz o CPF/CNPJ do credor e mais duas provas (número, valor ou data).'],
  localizado: ['Localizado', 'Arquivo de pagamento com o número do processo no nome, na competência do pagamento; o texto confirma pouco ou o PDF não tem texto.'],
  texto: ['Pelo texto', 'O nome do arquivo não traz o número; achado pelo texto do documento: número do processo + CPF/CNPJ do credor + valor ou data.'],
  conferir: ['Conferir', 'O número bate, mas o texto não traz o CPF/CNPJ, o valor nem a data. Pode ser o processo de outro credor.'],
};

export function seloHtml(status) {
  const s = SELOS[status];
  if (!s) return '';
  return `<span class="doc-selo doc-selo-${status}" title="${escapeHtml(`${s[0]}: ${s[1]}`)}" aria-label="${escapeHtml(s[0])}"><svg viewBox="0 0 16 16" aria-hidden="true">${ICO[status]}</svg></span>`;
}

const simNao = b => (b ? 'sim' : 'não');

export function dicaReconhecido(a) {
  const d = a.d;
  const s = SELOS[a.status];
  return [
    `DOC ${d.n} — ${d.arquivo || d.codigo || ''}`,
    [d.competencia ? `competência ${d.competencia}` : '', d.classificacao || ''].filter(Boolean).join(' · '),
    s ? `Selo: ${s[0]} · achado pelo ${a.por === 'texto' ? 'texto do documento' : 'nome do arquivo'}` : '',
    a.temTexto ? `no texto: nº ${simNao(a.conf.numero)} · CPF/CNPJ ${simNao(a.conf.cnpj)} · valor ${simNao(a.conf.valor)} · data ${simNao(a.conf.data)}`
      : 'PDF sem texto: só classificação, competência e nome',
    a.unidade === 'dif' ? 'a unidade do arquivo não é a do pagamento' : '',
  ].filter(Boolean).join('\n');
}

export function linkPP(numero, info) {
  const docs = (info && info.docs) || [];
  if (!docs.length) return escapeHtml(numero);
  const [a0] = docs;
  const principal = linkDoc(a0.d, numero, 'doc-pp', dicaReconhecido(a0)) + seloHtml(a0.status);
  if (docs.length === 1) return principal;
  return `${principal}<span class="doc-partes">${docs.map((a, i) =>
    linkDoc(a.d, rotuloParte(a.d.arquivo, i).replace('Parte ', 'P'), `doc-parte doc-parte-${a.status}`, dicaReconhecido(a))).join('')}</span>`;
}

export function legendaSelos() {
  return `<p class="dd-nota doc-legenda">Como o documento do processo de pagamento foi reconhecido:
    ${Object.entries(SELOS).map(([k, s]) => `<span class="doc-legenda-item" title="${escapeHtml(s[1])}">${seloHtml(k)} ${escapeHtml(s[0].toLowerCase())}</span>`).join('')}
    <span class="doc-legenda-item"><span class="doc-pp-falta">nº</span> sem documento</span>
    · passe o mouse no selo ou no número para ver o motivo.</p>`;
}

function desenharPartes(url) {
  const lista = partesPorUrl.get(url) || [];
  const el = $('doc-painel-partes');
  el.hidden = lista.length < 2;
  el.innerHTML = lista.map(p => `<button type="button" data-url="${escapeHtml(p.url)}" data-titulo="${escapeHtml(p.titulo)}"
    aria-pressed="${p.url === url}">${escapeHtml(p.rotulo)}</button>`).join('');
}

export function abrirDoc(url, titulo) {
  if (!url) return;
  const painel = $('doc-painel');
  const quadro = $('doc-painel-quadro');
  $('doc-painel-titulo').textContent = titulo || 'Documento';
  $('doc-painel-titulo').title = titulo || '';
  $('doc-painel-guia').href = url;
  $('doc-painel-aviso-link').href = url;
  desenharPartes(url);
  painel.hidden = false;
  requestAnimationFrame(() => requestAnimationFrame(() => painel.classList.add('aberto')));
  if (quadro.dataset.url === url) return;

  const aviso = $('doc-painel-aviso');
  $('doc-painel-aviso-texto').textContent = 'Carregando o documento no portal do TCM-BA…';
  aviso.hidden = false;
  clearTimeout(tempo);
  tempo = setTimeout(() => {
    $('doc-painel-aviso-texto').textContent = 'O documento não apareceu?';
  }, ESPERA_AVISO);
  quadro.onload = () => {
    if (quadro.dataset.url !== url) return;
    clearTimeout(tempo);
    aviso.hidden = true;
  };
  quadro.dataset.url = url;
  quadro.src = url;
}

export function fecharDoc() {
  const painel = $('doc-painel');
  if (painel.hidden) return;
  clearTimeout(tempo);
  painel.classList.remove('aberto');
  setTimeout(() => {
    painel.hidden = true;
    const quadro = $('doc-painel-quadro');
    quadro.onload = null;
    quadro.src = 'about:blank';
    delete quadro.dataset.url;
  }, 250);
}

function initAlca() {
  const alca = $('doc-painel-alca');
  const painel = $('doc-painel');
  const quadro = $('doc-painel-quadro');
  let x0 = 0, w0 = 0, arrastando = false;
  alca.addEventListener('pointerdown', e => {
    arrastando = true; x0 = e.clientX; w0 = painel.offsetWidth;
    quadro.style.pointerEvents = 'none';
    document.body.style.userSelect = 'none';
    alca.setPointerCapture(e.pointerId);
  });
  alca.addEventListener('pointermove', e => {
    if (!arrastando) return;
    painel.style.width = `${Math.max(300, Math.min(window.innerWidth * 0.95, w0 + (x0 - e.clientX)))}px`;
  });
  const soltar = () => {
    arrastando = false;
    quadro.style.pointerEvents = '';
    document.body.style.userSelect = '';
  };
  alca.addEventListener('pointerup', soltar);
  alca.addEventListener('pointercancel', soltar);
}

export function initPainelDoc() {
  $('doc-painel-fechar').addEventListener('click', fecharDoc);
  $('doc-painel-partes').addEventListener('click', e => {
    const b = e.target.closest('[data-url]');
    if (b) abrirDoc(b.dataset.url, b.dataset.titulo);
  });
  initAlca();
  document.addEventListener('click', e => {
    if (e.defaultPrevented || e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey) return;
    const a = e.target.closest('a[data-pdf]');
    if (!a) return;
    e.preventDefault();
    abrirDoc(a.href, a.dataset.titulo || a.title || a.textContent.trim());
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && !$('doc-painel').hidden) fecharDoc();
  });
}
