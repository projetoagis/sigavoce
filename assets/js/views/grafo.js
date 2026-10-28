import { escapeHtml, normStr } from '../core/format.js';
import { mascaraDoc } from '../core/pacote-parser.js';

const SVG = 'http://www.w3.org/2000/svg';
const temNumero = v => v !== null && v !== undefined && v !== '' && Number.isFinite(Number(v));

export function normalizar(dados) {
  const nos = ((dados && dados.nos) || []).map(n => ({
    id: n.id, cor: n.cor || '#58a6ff', tipo: n.tipo || '',
    titulo: n.nome || n.id, doc: n.doc ? mascaraDoc(n.doc) : '',
    x: temNumero(n.x) ? Number(n.x) : NaN, y: temNumero(n.y) ? Number(n.y) : NaN,
    camada: Number(n.camada) || 0,
    ficha: (n.ficha || []).filter(l => Array.isArray(l) && l[1] !== '' && l[1] != null),
  }));
  const soltos = nos.filter(n => Number.isNaN(n.x) || Number.isNaN(n.y));
  const camadas = new Map();
  soltos.forEach(n => { if (!camadas.has(n.camada)) camadas.set(n.camada, []); camadas.get(n.camada).push(n); });
  for (const [c, lista] of camadas) {
    const r = 120 + c * 180;
    lista.forEach((n, i) => {
      const a = (2 * Math.PI * i) / lista.length;
      n.x = c === 0 && lista.length === 1 ? 0 : Math.cos(a) * r;
      n.y = c === 0 && lista.length === 1 ? 0 : Math.sin(a) * r;
    });
  }
  const arestas = ((dados && dados.arestas) || []).map(a => ({ de: a.de, para: a.para, rotulo: a.rotulo || '' }));
  return { nos, arestas };
}

function ficha(n) {
  return `<h4 class="gr-ficha-tit">${escapeHtml(n.titulo)}</h4>
    ${n.doc ? `<p class="gr-ficha-doc">${escapeHtml(n.doc)}</p>` : ''}
    <dl class="gr-ficha-dl">${n.ficha.map(([k, v]) => `<dt>${escapeHtml(k)}</dt><dd>${escapeHtml(String(v))}</dd>`).join('')}</dl>`;
}

export function desenharGrafo(el, dados) {
  const g = normalizar(dados || {});
  const porId = new Map(g.nos.map(n => [n.id, n]));
  el.innerHTML = `
    <div class="tb-barra">
      <input type="search" class="filter-input gr-busca" placeholder="Localizar nome ou documento..." autocomplete="off" />
      <span class="tb-info">${g.nos.length} nó(s) · ${g.arestas.length} ligação(ões)</span>
      <button type="button" class="btn-ghost gr-centro">Centralizar</button>
    </div>
    <div class="gr-area">
      <svg class="gr-svg" role="img" aria-label="Grafo de relacionamentos"></svg>
      <aside class="gr-ficha" hidden></aside>
    </div>`;
  const svg = el.querySelector('svg');
  const fichaEl = el.querySelector('.gr-ficha');
  const camada = document.createElementNS(SVG, 'g');
  svg.appendChild(camada);

  const vizinhos = new Map(g.nos.map(n => [n.id, new Set()]));
  const linhasArestas = [];
  for (const a of g.arestas) {
    const de = porId.get(a.de), para = porId.get(a.para);
    if (!de || !para) continue;
    vizinhos.get(de.id).add(para.id);
    vizinhos.get(para.id).add(de.id);
    const ln = document.createElementNS(SVG, 'line');
    ln.setAttribute('x1', de.x); ln.setAttribute('y1', de.y);
    ln.setAttribute('x2', para.x); ln.setAttribute('y2', para.y);
    ln.setAttribute('class', 'gr-aresta');
    if (a.rotulo) { const t = document.createElementNS(SVG, 'title'); t.textContent = a.rotulo; ln.appendChild(t); }
    ln.dataset.de = de.id; ln.dataset.para = para.id;
    camada.appendChild(ln);
    linhasArestas.push(ln);
  }
  const grupos = new Map();
  for (const n of g.nos) {
    const gr = document.createElementNS(SVG, 'g');
    gr.setAttribute('class', 'gr-no');
    gr.setAttribute('transform', `translate(${n.x},${n.y})`);
    const raio = n.tipo === 'empresa' ? 13 : 9;
    gr.innerHTML = `<circle r="${raio}" fill="${escapeHtml(n.cor)}"></circle>
      <text y="${raio + 13}" text-anchor="middle">${escapeHtml(String(n.titulo).slice(0, 34))}</text>`;
    gr.addEventListener('click', e => { e.stopPropagation(); selecionar(n.id); });
    camada.appendChild(gr);
    grupos.set(n.id, gr);
  }

  const xs = g.nos.map(n => n.x), ys = g.nos.map(n => n.y);
  const caixa = g.nos.length
    ? { x: Math.min(...xs) - 80, y: Math.min(...ys) - 60, w: Math.max(...xs) - Math.min(...xs) + 160, h: Math.max(...ys) - Math.min(...ys) + 120 }
    : { x: -200, y: -150, w: 400, h: 300 };
  let vb = { ...caixa };
  const aplicar = () => svg.setAttribute('viewBox', `${vb.x} ${vb.y} ${vb.w} ${vb.h}`);
  aplicar();

  svg.addEventListener('wheel', e => {
    e.preventDefault();
    const r = svg.getBoundingClientRect();
    const fx = (e.clientX - r.left) / r.width, fy = (e.clientY - r.top) / r.height;
    const k = e.deltaY > 0 ? 1.15 : 1 / 1.15;
    const nw = vb.w * k, nh = vb.h * k;
    vb = { x: vb.x + (vb.w - nw) * fx, y: vb.y + (vb.h - nh) * fy, w: nw, h: nh };
    aplicar();
  }, { passive: false });
  let arrasto = null;
  svg.addEventListener('pointerdown', e => {
    if (e.target.closest('.gr-no')) return;
    arrasto = { x: e.clientX, y: e.clientY, vb: { ...vb } };
    svg.setPointerCapture(e.pointerId);
  });
  svg.addEventListener('pointermove', e => {
    if (!arrasto) return;
    const r = svg.getBoundingClientRect();
    vb.x = arrasto.vb.x - (e.clientX - arrasto.x) * (vb.w / r.width);
    vb.y = arrasto.vb.y - (e.clientY - arrasto.y) * (vb.h / r.height);
    aplicar();
  });
  svg.addEventListener('pointerup', () => { arrasto = null; });
  svg.addEventListener('click', e => { if (!e.target.closest('.gr-no')) selecionar(null); });
  el.querySelector('.gr-centro').addEventListener('click', () => { vb = { ...caixa }; aplicar(); });

  function selecionar(id) {
    const viz = id ? vizinhos.get(id) : null;
    for (const [nid, gr] of grupos) {
      gr.classList.toggle('sel', nid === id);
      gr.classList.toggle('apagado', !!id && nid !== id && !viz.has(nid));
    }
    for (const ln of linhasArestas) {
      ln.classList.toggle('apagado', !!id && ln.dataset.de !== id && ln.dataset.para !== id);
    }
    fichaEl.hidden = !id;
    if (id) fichaEl.innerHTML = ficha(porId.get(id));
  }

  el.querySelector('.gr-busca').addEventListener('input', e => {
    const termo = normStr(e.target.value);
    for (const n of g.nos) {
      const bate = termo && normStr(`${n.titulo} ${n.doc} ${n.doc.replace(/\D/g, '')}`).includes(termo);
      grupos.get(n.id).classList.toggle('achado', !!bate);
    }
  });
}
