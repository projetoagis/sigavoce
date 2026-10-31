import { formatBRL, formatInt } from './format.js';

export const ORDEM_BASES = ['receita', 'socios', 'ceis', 'cnep', 'cepim', 'pgfn', 'tse'];

export const NOME_CURTO = {
  receita: 'Receita Federal',
  socios: 'Sócios',
  ceis: 'CEIS',
  cnep: 'CNEP',
  cepim: 'CEPIM',
  pgfn: 'PGFN',
  tse: 'Extratos TSE',
};

const so = v => String(v == null ? '' : v).replace(/[^0-9A-Za-z]/g, '').toUpperCase();
const rs = v => formatBRL(Number(v) || 0);
const plural = (n, um, varios) => `${formatInt(n)} ${n === 1 ? um : varios}`;

export function resumoBase(chave, v) {
  if (!v) return '';
  if (chave === 'receita') return [v.razao_social || v.fantasia, v.situacao].filter(Boolean).join(' · ');
  if (chave === 'socios') return plural((v.socios || []).length, 'sócio', 'sócios');
  if (chave === 'ceis') return `${plural(v.n || 0, 'sanção', 'sanções')}${v.n_vigentes ? `, ${formatInt(v.n_vigentes)} vigente(s)` : ''}`;
  if (chave === 'cnep' || chave === 'cepim') return plural(v.n || 0, 'registro', 'registros');
  if (chave === 'pgfn') return `${plural(v.n || 0, 'inscrição', 'inscrições')} · ${rs(v.total)}`;
  if (chave === 'tse') {
    const anos = (v.anos || []).join(', ');
    return `${plural(v.n || 0, 'lançamento', 'lançamentos')} · ${rs(v.total)}${v.campanhas ? ` · ${plural(v.campanhas, 'campanha', 'campanhas')}` : ''}${anos ? ` (${anos})` : ''}`;
  }
  return '';
}

export function lerBases(b, nomes = new Map(), envolvidos = []) {
  const bases = (b && b.bases) || {};
  const consultados = new Set((b && b.consultados) || []);
  const porDoc = new Map();
  const info = new Map();
  for (const e of envolvidos || []) {
    const d = so(e.documento);
    if (d) info.set(d, { nome: e.nome || '', papeis: e.papeis || [] });
  }
  for (const chave of ORDEM_BASES) {
    const base = bases[chave];
    if (!base) continue;
    for (const [doc, v] of Object.entries(base.docs || {})) {
      const d = so(doc);
      if (!porDoc.has(d)) porDoc.set(d, []);
      porDoc.get(d).push({ chave, rotulo: base.rotulo || NOME_CURTO[chave], v, resumo: resumoBase(chave, v) });
    }
  }
  const nomeDe = d => {
    const i = info.get(d);
    if (i && i.nome) return i.nome;
    if (nomes.has(d)) return nomes.get(d);
    for (const a of porDoc.get(d) || []) {
      const n = a.chave === 'receita' ? a.v.razao_social || a.v.fantasia
        : (a.v.sancoes || []).map(s => s.nome_do_sancionado || s.razao_social_cadastro_receita).find(Boolean);
      if (n) return n;
    }
    return '';
  };
  const linhas = [...porDoc.entries()].map(([documento, achados]) => ({
    documento,
    nome: nomeDe(documento),
    papeis: (info.get(documento) || {}).papeis || [],
    achados,
  }));
  return {
    tem: linhas.length > 0 || consultados.size > 0,
    consultados: ORDEM_BASES.filter(c => consultados.has(c)),
    bases,
    linhas,
  };
}
