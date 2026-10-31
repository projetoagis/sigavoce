import { munChave, munDe } from './despesa-detalhes.js';

const ORDEM = { confirmado: 0, localizado: 1, conferir: 2 };
const PROVAS = ['numero', 'cnpj', 'valor', 'data'];

const TIRAR_DO_NOME = [
  /\d{2}\.\d{3}\.\d{3}[/\-_. ]?\d{4}[-_. ]?\d{2}/g,
  /\d{3}\.\d{3}\.\d{3}[-_. ]?\d{2}/g,
  /\d{1,2}[./-]\d{1,2}[./-]\d{2,4}/g,
  /\d{4}-\d{2}-\d{2}/g,
  /PARTE?[\s_-]*\d+/gi,
  /\b(?:VOL|VOLUME|ANEXO|FL|FLS|FOLHAS?)\.?[\s_-]*\d+\b/gi,
];
const PREFIXO = /(?:PP|PMS|PM|FMS|FME|FMAS|FMDCA|FUNDEB|PROC|PROCESSO|PROCESO|PROCESS|PAGTO|PGTO|PAG|OP|OB|N[º°O])[\s_.:-]*$/;
const ANTES_NO_TEXTO = '(?:PROCES|PROCESS|PP|PAGAMENTO|PAGTO|PGTO|ORDEM|N[º°O.]|NUMERO|OP|OB|PMS|FM[A-Z]{1,4})[^0-9\\n]{0,30}';

export const semAcento = s => String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
export const numeroProcesso = v => String(v == null ? '' : v).replace(/\D/g, '').replace(/^0+/, '');
const escRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const so = v => String(v == null ? '' : v).replace(/[^0-9A-Za-z]/g, '').toUpperCase();

export function numerosDoNome(arquivo) {
  let nome = String(arquivo || '').split(/[\\/]/).pop().replace(/\.[A-Za-z0-9]{2,4}$/, '');
  for (const r of TIRAR_DO_NOME) nome = nome.replace(r, ' ');
  const saida = new Map();
  for (const m of nome.matchAll(/(?<!\d)(\d{1,7})(?!\d)/g)) {
    const n = m[1].replace(/^0+/, '');
    if (!n) continue;
    const pref = PREFIXO.test(semAcento(nome.slice(Math.max(0, m.index - 20), m.index)));
    saida.set(n, saida.get(n) || pref);
  }
  return saida;
}

export const ehDocPagamento = d => (d.classificacao ? semAcento(d.classificacao).includes('PAGAMENTO') : d.papel === 'pagamento');

const competencia = c => {
  const m = /^(\d{2})\/(\d{4})$/.exec(String(c || ''));
  return m ? { ano: Number(m[2]), mes: Number(m[1]) } : null;
};

function valoresDe(lista) {
  const vs = new Set();
  let totL = 0, totB = 0;
  for (const p of lista) {
    const liq = Number(p.valor) || 0;
    const bru = liq + (Number(p.valor_retencoes) || 0);
    totL += liq;
    totB += bru;
    vs.add(liq).add(bru);
    if (p.valor_pagamento) vs.add(Number(p.valor_pagamento) || 0);
  }
  vs.add(totL).add(totB);
  const saida = new Set();
  for (const v of vs) {
    if (!(v > 0)) continue;
    const [inteiro, cent] = v.toFixed(2).split('.');
    saida.add(`${inteiro.replace(/\B(?=(\d{3})+(?!\d))/g, '.')},${cent}`).add(`${inteiro},${cent}`);
  }
  return [...saida].sort((a, b) => b.length - a.length);
}

function datasDe(lista) {
  const saida = new Set();
  for (const p of lista) {
    for (const d of [p.data, p.data_pagamento]) {
      const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(d || ''));
      if (!m || m[1] === '1969') continue;
      const [, a, me, di] = m;
      saida.add(`${di}/${me}/${a}`).add(`${di}.${me}.${a}`).add(`${di}-${me}-${a}`).add(`${di}/${me}/${a.slice(2)}`);
    }
  }
  return [...saida];
}

export function conferir(texto, compacto, num, doc, valores, datas) {
  const numero = !!num && new RegExp(`${ANTES_NO_TEXTO}0*${num}(?!\\d)`).test(texto);
  const cnpj = !!doc && compacto.includes(doc);
  const valor = valores.length > 0
    && new RegExp(`(?<![\\d.,])(?:${valores.map(escRe).join('|')})(?!\\d)`).test(texto.replace(/ /g, ''));
  const data = datas.some(d => texto.includes(d));
  return { numero, cnpj, valor, data };
}

export function selo(temTexto, c) {
  const outras = ['numero', 'valor', 'data'].filter(k => c[k]).length;
  if (temTexto && c.cnpj && outras >= 2) return 'confirmado';
  if (temTexto && !(c.cnpj || c.valor || c.data)) return 'conferir';
  return 'localizado';
}

export function docsDaEmpresa(credores) {
  const lista = credores || [];
  if (lista.some(c => 'empresa' in c)) return new Set(lista.filter(c => c.empresa).map(c => so(c.documento)));
  const papel = c => semAcento(c.papel);
  const titulo = lista.filter(c => papel(c).startsWith('TITULO'));
  return new Set((titulo.length ? titulo : lista.filter(c => papel(c) === 'CONTRATADA')).map(c => so(c.documento)));
}

const chaveBase = (doc, cuni, numero) => `${so(doc)}|${cuni == null ? '' : cuni}|${numeroProcesso(numero)}`;
const chaveDe = (doc, cuni, numero, data) => `${chaveBase(doc, cuni, numero)}|${String(data || '').slice(0, 7)}`;
const chaveAno = (doc, cuni, numero, data) => `${chaveBase(doc, cuni, numero)}|${String(data || '').slice(0, 4)}`;
const melhor = docs => docs.reduce((m, a) => (ORDEM[a.status] < ORDEM[m] ? a.status : m), 'conferir');

function doPacote(processos, docPorN, empresa) {
  const pp = new Map();
  const sobra = new Set();
  for (const [doc, r] of Object.entries(processos || {})) {
    if (!empresa.has(so(doc))) continue;
    for (const [k, g] of Object.entries((r && r.pp) || {})) {
      const docs = (g.docs || []).filter(a => a.por !== 'texto').map(a => ({
        d: docPorN.get(a.doc), status: a.status in ORDEM ? a.status : 'localizado', por: 'nome', temTexto: !!a.tem_texto,
        unidade: a.unidade || '', conf: Object.fromEntries(PROVAS.map(p => [p, !!(a.conf || {})[p]])),
      })).filter(a => a.d);
      pp.set(`${so(doc)}|${k}`, { status: docs.length ? melhor(docs) : 'nao', docs });
    }
    for (const n of (r && r.sobra) || []) if (docPorN.has(n)) sobra.add(n);
  }
  return { pp, sobra };
}

function calcular(d, docs, empresa) {
  const t = d.tcm_detalhes || {};
  const mun = munChave((d.cadeia || {}).municipio);
  const cand = [];
  for (const x of docs) {
    if (!x.codigo || /^manual-/i.test(x.codigo) || !ehDocPagamento(x)) continue;
    const comp = competencia(x.competencia);
    if (!comp) continue;
    const texto = semAcento((x.texto || []).map(p => p.texto || '').join('\n'));
    const compacto = texto.replace(/[\s./-]/g, '');
    cand.push({ d: x, comp, nums: numerosDoNome(x.arquivo || x.rotulo), texto, compacto, temTexto: compacto.length > 30 });
  }
  const grupos = new Map();
  for (const p of t.detalhes || []) {
    if (!empresa.has(so(p.documento))) continue;
    if (mun && munChave(munDe(p)) !== mun) continue;
    const num = numeroProcesso(p.numero_documento);
    const m = /^(\d{4})-(\d{2})/.exec(String(p.data || ''));
    if (!num || !m) continue;
    const k = chaveDe(p.documento, p.codigo_unidade || '', num, p.data);
    const g = grupos.get(k) || { num, doc: so(p.documento), ano: Number(m[1]), mes: Number(m[2]), lista: [] };
    g.lista.push(p);
    grupos.set(k, g);
  }
  const pp = new Map();
  const usados = new Set();
  for (const [k, g] of grupos) {
    const valores = valoresDe(g.lista);
    const datas = datasDe(g.lista);
    const achados = [];
    for (const c of cand) {
      if (c.comp.ano !== g.ano || c.comp.mes !== g.mes || !c.nums.has(g.num)) continue;
      const conf = c.temTexto ? conferir(c.texto, c.compacto, g.num, g.doc, valores, datas)
        : { numero: false, cnpj: false, valor: false, data: false };
      achados.push({ d: c.d, por: 'nome', prefixo: !!c.nums.get(g.num), temTexto: c.temTexto, unidade: '', conf, status: selo(c.temTexto, conf) });
    }
    for (const a of achados) usados.add(a.d.n);
    pp.set(k, { status: achados.length ? melhor(achados) : 'nao', docs: achados });
  }
  const sobra = new Set(cand.filter(c => !usados.has(c.d.n)).map(c => c.d.n));
  return { pp, sobra, candidatos: cand.length };
}

export function reconhecer(d, docs, docPorN) {
  const t = (d && d.tcm_detalhes) || null;
  const empresa = docsDaEmpresa(t && t.credores);
  const vazio = { origem: '', ativo: false, pp: new Map(), sobra: new Set(), empresa };
  if (!t) return montarIndices(vazio);
  if (t.processos && typeof t.processos === 'object') {
    const r = doPacote(t.processos, docPorN, empresa);
    return montarIndices({ origem: 'pacote', ativo: true, empresa, ...r });
  }
  const r = calcular(d, docs || [], empresa);
  return montarIndices({ origem: 'nome', ativo: r.candidatos > 0, pp: r.pp, sobra: r.sobra, empresa });
}

export function parteDe(arquivo) {
  const m = /[_\s-]parte?[_\s-]?0*(\d+)/i.exec(String(arquivo || ''));
  return m ? Number(m[1]) : 0;
}

export function conjuntoDe(arquivo) {
  const nome = semAcento(String(arquivo || '').split(/[\\/]/).pop().replace(/\.[A-Za-z0-9]{2,4}$/, ''))
    .replace(/[\s_.-]*PARTE?[\s_-]*0*\d+/g, ' ');
  return nome.replace(/[^A-Z0-9%]+/g, ' ').trim();
}

const notaDoc = a => [a.unidade === 'dif' ? 1 : 0, ORDEM[a.status] ?? 9, a.prefixo === false ? 1 : 0,
  -PROVAS.filter(p => (a.conf || {})[p]).length];
const compararNota = (x, y) => {
  for (let i = 0; i < x.length; i += 1) if (x[i] !== y[i]) return x[i] - y[i];
  return 0;
};

export function partesDoProcesso(docs) {
  const lista = (docs || []).filter(a => a.por !== 'texto');
  const conjuntos = new Map();
  for (const a of lista) {
    const c = conjuntoDe(a.d.arquivo);
    if (!conjuntos.has(c)) conjuntos.set(c, []);
    conjuntos.get(c).push(a);
  }
  const blocos = [...conjuntos.entries()].map(([c, l]) => ({
    c, l, nota: l.map(notaDoc).sort(compararNota)[0],
  }));
  blocos.sort((x, y) => compararNota(x.nota, y.nota) || x.c.localeCompare(y.c, 'pt-BR', { numeric: true }));
  return blocos.flatMap(b => [...b.l].sort((a, z) => parteDe(a.d.arquivo) - parteDe(z.d.arquivo)
    || String(a.d.arquivo || '').localeCompare(String(z.d.arquivo || ''), 'pt-BR', { numeric: true })
    || a.d.n - z.d.n));
}

function montarIndices(r) {
  const porDoc = new Map();
  const grupos = [];
  const vistos = new Set();
  for (const [k, g0] of r.pp) {
    const g = { ...g0, docs: partesDoProcesso(g0.docs) };
    r.pp.set(k, g);
    const num = k.split('|')[2];
    for (const a of g.docs) {
      if (!porDoc.has(a.d.n)) porDoc.set(a.d.n, new Set());
      porDoc.get(a.d.n).add(num);
    }
    const porConjunto = new Map();
    for (const a of g.docs) {
      const c = conjuntoDe(a.d.arquivo);
      if (!porConjunto.has(c)) porConjunto.set(c, []);
      porConjunto.get(c).push(a.d);
    }
    for (const l of porConjunto.values()) {
      const assinatura = l.map(d => d.n).join(',');
      if (l.length > 1 && !vistos.has(assinatura)) {
        vistos.add(assinatura);
        grupos.push(l);
      }
    }
  }
  return {
    ...r,
    porDoc,
    grupos,
    ehEmpresa: doc => r.empresa.has(so(doc)),
    info: (doc, cuni, numero, data) => r.pp.get(chaveDe(doc, cuni, numero, data))
      || r.pp.get(chaveAno(doc, cuni, numero, data)) || null,
  };
}
