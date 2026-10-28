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

export function linkDoc(d, texto, classe = '') {
  if (!d || !d.url) return escapeHtml(texto);
  const titulo = d.arquivo || `DOC ${d.n}`;
  return `<a class="doc-link${classe ? ` ${classe}` : ''}" href="${escapeHtml(d.url)}" data-pdf="1" target="_blank" rel="noopener noreferrer"
    title="${escapeHtml(titulo)}">${escapeHtml(texto)}</a>`;
}

export function linkPP(numero, docs) {
  if (!docs || !docs.length) return escapeHtml(numero);
  if (docs.length === 1) return linkDoc(docs[0], numero, 'doc-pp');
  return `${linkDoc(docs[0], numero, 'doc-pp')}<span class="doc-partes">${docs.map((d, i) =>
    linkDoc(d, rotuloParte(d.arquivo, i).replace('Parte ', 'P'), 'doc-parte')).join('')}</span>`;
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
    abrirDoc(a.href, a.title || a.textContent.trim());
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && !$('doc-painel').hidden) fecharDoc();
  });
}
