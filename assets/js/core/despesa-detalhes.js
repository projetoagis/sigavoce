import { normStr } from './format.js';

export const num = v => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

export const bruto = p => num(p.valor) + num(p.valor_retencoes);

export const soma = (lista, f) => lista.reduce((s, x) => s + f(x), 0);

export const dia = s => (/^\d{4}-\d{2}-\d{2}/.test(s || '') ? `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}` : (s || ''));

export const ano = p => (p.data || '').slice(0, 4) || String(p.ano || '');

export function retUnicas(lista) {
  const vistos = new Set();
  return (lista || []).filter(r => {
    const k = [r.documento, r.codigo_unidade, r.pp, r.data_retencao, r.conta_contabil_numero, r.valor].join('|');
    if (vistos.has(k)) return false;
    vistos.add(k);
    return true;
  });
}

export const munChave = m => normStr(m).toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();

export function munDe(p) {
  if (p.municipio) return p.municipio;
  const m = /\bde\s+(.+)$/i.exec(p.entidade || p.unidade || '');
  return m ? m[1].trim() : '(município não informado)';
}

export const entDe = p => p.entidade || p.unidade || `unidade ${p.codigo_unidade}`;

export const ehPrefeitura = p => /^PREFEITURA\b/.test(munChave(p.entidade || p.unidade || ''));

export const daCadeia = (p, municipio) => !!munChave(municipio) && munChave(munDe(p)) === munChave(municipio) && ehPrefeitura(p);

export function orgao(p, multi) {
  const o = p.orgao || p.cd_orgao || '';
  return multi && o ? `${o} · ${entDe(p)}` : o;
}

export const multiUnidade = lista => new Set(lista.map(p => String(p.codigo_unidade || ''))).size > 1;

export const chavePP = (codUnidade, pp, data) => `${codUnidade}|${pp}|${String(data || '').slice(0, 4)}`;

export function doCredor(t, doc, mun = '*', uni = '') {
  const todos = (t.detalhes || []).filter(p => p.documento === doc);
  const unidades = new Map();
  for (const p of todos) {
    const cod = String(p.codigo_unidade || '');
    const u = unidades.get(cod) || { cod, mun: munDe(p), chave: munChave(munDe(p)), ent: entDe(p), n: 0, v: 0, ini: '', fim: '' };
    u.n += 1;
    u.v += num(p.valor);
    if (p.data) {
      if (!u.ini || p.data < u.ini) u.ini = p.data;
      if (p.data > u.fim) u.fim = p.data;
    }
    unidades.set(cod, u);
  }
  const filtra = mun !== '*' || !!uni;
  const ok = cod => {
    const u = unidades.get(String(cod || ''));
    if (!u) return !filtra;
    return (mun === '*' || u.chave === mun) && (!uni || u.cod === uni);
  };
  const pag = todos.filter(p => ok(p.codigo_unidade));
  const ret = (t.retencoes || []).filter(x => x.documento === doc && ok(x.codigo_unidade));
  const nfs = (t.notas || []).filter(x => x.documento === doc && ok(x.codigo_unidade));
  return { todos, pag, ret, retUnicas: retUnicas(ret), nfs, unidades };
}

export function municipios(unidades) {
  const muns = new Map();
  for (const u of unidades.values()) {
    const m = muns.get(u.chave) || { chave: u.chave, nome: u.mun, n: 0, v: 0, unis: 0 };
    m.n += u.n;
    m.v += u.v;
    m.unis += 1;
    muns.set(u.chave, m);
  }
  return [...muns.values()].sort((a, b) => b.v - a.v);
}

export const outroEmitente = n => !!n.emitente && String(n.emitente).replace(/\W/g, '').toUpperCase() !== n.documento;

export function resumo(pag, retU, nfs) {
  const liq = soma(pag, p => num(p.valor));
  const retido = soma(pag, p => num(p.valor_retencoes));
  const datas = pag.map(p => p.data).filter(Boolean).sort();
  const empenhos = new Map();
  for (const p of pag) {
    const k = [p.codigo_unidade, (p.data_empenho || '').slice(0, 4), p.empenho].join('|');
    if (!empenhos.has(k)) empenhos.set(k, num(p.valor_empenho));
  }
  return {
    n: pag.length,
    ini: datas[0] || '',
    fim: datas[datas.length - 1] || '',
    liquido: liq,
    retido,
    bruto: liq + retido,
    lancamentosRetencao: retU.length,
    empenhado: soma([...empenhos.values()], v => v),
    nEmpenhos: empenhos.size,
    contratos: new Set(pag.map(p => p.contrato).filter(Boolean)).size,
    unidades: [...new Set(pag.map(p => p.entidade || p.unidade).filter(Boolean))],
    semFicha: pag.filter(p => String(p.status || '').toLowerCase() !== 'ok').length,
    notas: (nfs || []).length,
    outroEmitente: (nfs || []).filter(outroEmitente).length,
  };
}

export const CAMPO_CLASSIF = {
  nat: p => p.natureza_tcm,
  nat_gestor: p => p.natureza_gestor,
  fonte: p => p.classif_fonte_tcm || p.fonte_tcm,
  fonte_gestor: p => p.classif_fonte_gestor || p.fonte_gestor,
};

export const codigo = v => ((/^\s*([\d.]+)/.exec(String(v || '')) || [])[1] || '').replace(/\D/g, '');
export const semCodigo = v => String(v || '').replace(/^\s*[\d.]+\s*[-–—:]?\s*/, '');

export function ementario(p, qual) {
  const r = (p.ementario || {})[qual];
  return r && typeof r === 'object' ? r : null;
}

export function classifTexto(p, qual) {
  const r = ementario(p, qual);
  if (!r || !r.encontrado) return '';
  return `${qual.startsWith('nat') ? (r.fmt || r.codigo) : r.codigo} - ${r.descricao}`;
}

export function difereDoEmentario(p, qual) {
  const r = ementario(p, qual);
  const txt = CAMPO_CLASSIF[qual](p);
  if (!r || !r.encontrado || !txt) return false;
  const limpo = s => normStr(s).replace(/[^a-z0-9]+/g, ' ').trim();
  return limpo(semCodigo(txt)) !== limpo(r.descricao);
}

export function contratos(pag) {
  const grupos = new Map();
  for (const p of pag) {
    const k = `${p.codigo_unidade || ''}|${p.contrato || ''}`;
    if (!grupos.has(k)) grupos.set(k, []);
    grupos.get(k).push(p);
  }
  const primeira = l => l.map(p => p.data).filter(Boolean).sort()[0] || '';
  return [...grupos.entries()]
    .sort((x, y) => {
      const cx = x[1][0].contrato, cy = y[1][0].contrato;
      if (!cx && cy) return 1;
      if (cx && !cy) return -1;
      return primeira(x[1]).localeCompare(primeira(y[1]));
    })
    .map(([chave, lista]) => {
      const anos = new Map();
      const emps = new Map();
      for (const p of lista) {
        const a = ano(p) || '—';
        const o = anos.get(a) || { ano: a, n: 0, liquido: 0, retido: 0 };
        o.n += 1; o.liquido += num(p.valor); o.retido += num(p.valor_retencoes);
        anos.set(a, o);
        const k = [p.codigo_unidade, (p.data_empenho || '').slice(0, 4), p.empenho].join('|');
        const e = emps.get(k) || { empenho: p.empenho, data: p.data_empenho, tipo: p.tipo_empenho,
          valor: num(p.valor_empenho), orgao: p.orgao || p.cd_orgao, n: 0, bruto: 0, liquido: 0 };
        e.n += 1; e.bruto += bruto(p); e.liquido += num(p.valor);
        emps.set(k, e);
      }
      const datas = lista.map(p => p.data).filter(Boolean).sort();
      const unicos = f => [...new Set(lista.map(f).filter(Boolean))];
      return {
        chave,
        contrato: lista[0].contrato || '',
        codUnidade: String(lista[0].codigo_unidade || ''),
        lista,
        liquido: soma(lista, p => num(p.valor)),
        retido: soma(lista, p => num(p.valor_retencoes)),
        ini: datas[0] || '',
        fim: datas[datas.length - 1] || '',
        dispensas: unicos(p => p.dispensa_inexigibilidade),
        licitacoes: unicos(p => p.licitacao),
        orgaos: unicos(p => p.orgao || p.cd_orgao),
        anos: [...anos.values()].sort((a, b) => a.ano.localeCompare(b.ano)),
        empenhos: [...emps.values()].sort((a, b) => (a.data || '').localeCompare(b.data || '')),
      };
    });
}

export function porCodigo(lista, qual, comEmentario) {
  const m = new Map();
  for (const p of lista) {
    const txt = CAMPO_CLASSIF[qual](p);
    if (!txt) continue;
    const r = ementario(p, qual);
    const k = comEmentario && r && r.encontrado ? `${r.codigo}|${r.descricao}` : (codigo(txt) || txt);
    if (!m.has(k)) m.set(k, p);
  }
  return [...m.values()];
}

export function filtrar(pag, f) {
  const b = normStr(f.busca || '');
  return pag.filter(p => (!f.ano || ano(p) === f.ano)
    && (!f.contrato || (p.contrato || '(sem)') === f.contrato)
    && (!f.orgao || orgao(p, f.multi) === f.orgao)
    && (!f.cuni || String(p.codigo_unidade || '') === f.cuni)
    && (!b || normStr([p.numero_documento, p.empenho, p.orgao, p.natureza_tcm, p.acao, p.contrato,
      p.classif_fonte_tcm, p.fonte_tcm, classifTexto(p, 'nat'), classifTexto(p, 'fonte'),
      p.dispensa_inexigibilidade, p.tipo_documento, p.conta_bancaria, p.favorecido].join(' ')).includes(b)));
}

export const ordemPagamento = (x, y) => (x.data || '').localeCompare(y.data || '') || num(x.numero_documento) - num(y.numero_documento);

export function retencoesPorConta(retU) {
  const contas = new Map();
  for (const x of retU) {
    const k = `${x.conta_contabil_numero}|${x.conta_contabil}`;
    const o = contas.get(k) || { numero: x.conta_contabil_numero, nome: x.conta_contabil, n: 0, v: 0, anos: new Set() };
    o.n += 1;
    o.v += num(x.valor);
    o.anos.add((x.data_retencao || x.data || '').slice(0, 4));
    contas.set(k, o);
  }
  return [...contas.values()]
    .map(o => ({ ...o, anos: [...o.anos].filter(Boolean).sort() }))
    .sort((a, b) => b.v - a.v);
}

export function quadro(pag, campo) {
  const m = new Map();
  for (const p of pag) {
    const k = (typeof campo === 'function' ? campo(p) : p[campo]) || '(não informado)';
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(p);
  }
  return [...m.entries()]
    .map(([rotulo, lista]) => ({ rotulo, lista, v: soma(lista, p => num(p.valor)) }))
    .sort((a, b) => b.v - a.v);
}

export const textoNormal = v => String(v || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();

export const CODIGO_DE = {
  orgao: p => codigo(p.orgao || p.cd_orgao),
  acao: p => codigo(p.acao),
  funcao: p => (codigo(p.funcao) && codigo(p.subfuncao) ? `${codigo(p.funcao)}.${codigo(p.subfuncao)}` : ''),
};

export function quadroUnidade(pag, campo, cod, porUnidade = true) {
  const m = new Map();
  for (const p of pag) {
    const texto = (typeof campo === 'function' ? campo(p) : p[campo]) || '';
    const k = `${porUnidade ? p.codigo_unidade || '' : ''}|${cod(p) || textoNormal(texto) || '(não informado)'}`;
    const o = m.get(k) || { k, lista: [], v: 0, escritas: new Map(), ent: entDe(p), mun: munDe(p) };
    o.lista.push(p);
    o.v += num(p.valor);
    o.escritas.set(texto, (o.escritas.get(texto) || 0) + 1);
    m.set(k, o);
  }
  return [...m.values()].sort((a, b) => b.v - a.v).map(o => ({
    ...o,
    rotulo: [...o.escritas.entries()].sort((a, b) => b[1] - a[1])[0][0] || '(não informado)',
    nEscritas: o.escritas.size,
    variantes: [...o.escritas.keys()],
  }));
}

export function quadroCodigo(pag, qual, comEmentario) {
  const m = new Map();
  for (const p of pag) {
    const txt = CAMPO_CLASSIF[qual](p) || '';
    const cod = codigo(txt);
    const r = ementario(p, qual);
    const k = comEmentario && r && r.encontrado ? `${r.codigo}|${r.descricao}` : (cod || txt || '(não informado)');
    const o = m.get(k) || { k, cod, ex: p, lista: [], v: 0, escritas: new Map(), anos: new Set() };
    o.lista.push(p);
    o.v += num(p.valor);
    o.escritas.set(txt, (o.escritas.get(txt) || 0) + 1);
    o.anos.add(ano(p));
    m.set(k, o);
  }
  const sentidos = new Map();
  for (const o of m.values()) sentidos.set(o.cod, (sentidos.get(o.cod) || 0) + 1);
  return [...m.values()].sort((a, b) => b.v - a.v).map(o => {
    const maisUsada = [...o.escritas.entries()].sort((a, b) => b[1] - a[1])[0][0];
    return {
      ...o,
      maisUsada,
      rotulo: comEmentario ? (classifTexto(o.ex, qual) || o.k) : (maisUsada || o.k),
      nEscritas: o.escritas.size,
      variantes: [...o.escritas.keys()],
      anos: [...o.anos].filter(Boolean).sort(),
      mudouSentido: comEmentario && sentidos.get(o.cod) > 1,
    };
  });
}

export const COLUNAS_CSV = [
  ['Credor CPF/CNPJ', 'documento'], ['Data', 'data'], ['PP nº', 'numero_documento'], ['Empenho', 'empenho'],
  ['Data empenho', 'data_empenho'], ['Tipo empenho', 'tipo_empenho'], ['Valor empenho', 'valor_empenho'],
  ['Líquido', 'valor'], ['Retido', 'valor_retencoes'], ['Bruto', null], ['Fase', 'fase'], ['Favorecido', 'favorecido'],
  ['Tipo documento', 'tipo_documento'], ['Conta bancária', 'conta_bancaria'], ['Restos a pagar', 'restos_a_pagar'],
  ['Município', 'municipio'], ['Entidade', 'entidade'], ['Órgão', 'orgao'], ['Unidade orçamentária', 'unidade_orcamentaria'],
  ['Função', 'funcao'], ['Subfunção', 'subfuncao'], ['Programa', 'programa'], ['Ação', 'acao'],
  ['Natureza (TCM)', 'natureza_tcm'], ['Natureza (gestor)', 'natureza_gestor'],
  ['Fonte (TCM)', 'classif_fonte_tcm'], ['Fonte (gestor)', 'classif_fonte_gestor'],
  ['Natureza (ementário do ano)', 'ementario:nat'], ['Fonte (ementário do ano)', 'ementario:fonte'],
  ['Licitação', 'licitacao'], ['Dispensa/Inexigibilidade', 'dispensa_inexigibilidade'], ['Contrato', 'contrato'],
  ['Status', 'status'],
];

export function linhasCsv(lista) {
  const dec = v => v.toFixed(2).replace('.', ',');
  return lista.map(p => COLUNAS_CSV.map(([, c]) => {
    if (c === null) return dec(bruto(p));
    if (c.startsWith('ementario:')) return classifTexto(p, c.slice(10));
    const v = p[c];
    if (typeof v === 'number') return dec(v);
    if (/^data/.test(c)) return dia(v);
    return v == null ? '' : v;
  }));
}
