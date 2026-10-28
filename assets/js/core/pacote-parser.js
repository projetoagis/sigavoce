export const FORMATOS_ACEITOS = ['pacote-investigacao'];
export const VERSAO_MAXIMA = 1;

export class PacoteError extends Error {}

const so = v => String(v == null ? '' : v).replace(/[^0-9A-Za-z]/g, '').toUpperCase();

export function mascaraDoc(v) {
  const d = so(v);
  if (d.length === 11) return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
  if (d.length === 14) return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
  return String(v == null ? '' : v);
}

export function chaveCompetencia(c) {
  const m = /^(\d{2})\/(\d{4})$/.exec(String(c || ''));
  return m ? `${m[2]}-${m[1]}` : '';
}

export function rotuloAnomes(v) {
  const s = String(v || '');
  return /^\d{6}$/.test(s) ? `${s.slice(4)}/${s.slice(0, 4)}` : s;
}

export function lerPacote(texto) {
  let d;
  try {
    d = JSON.parse(texto);
  } catch {
    throw new PacoteError('O arquivo não é um JSON válido.');
  }
  if (!d || typeof d !== 'object' || !FORMATOS_ACEITOS.includes(d.formato)) {
    throw new PacoteError('Este arquivo não é um pacote de investigação.');
  }
  if (!(Number(d.versao_formato) >= 1) || Number(d.versao_formato) > VERSAO_MAXIMA) {
    throw new PacoteError(`Versão de formato ${d.versao_formato} não suportada por este visualizador.`);
  }
  if (!Array.isArray(d.documentos)) {
    throw new PacoteError('O pacote não traz a lista de documentos.');
  }
  return montar(d);
}

export function lerCliente(c) {
  if (!c || typeof c !== 'object') return null;
  const nome = String(c.nome || '').trim();
  const cpf = so(c.cpf);
  if (!nome && !cpf) return null;
  return { nome, cpf: cpf.length === 11 ? cpf : '' };
}

export function numeroPP(arquivo) {
  const m = /(?:^|[^A-Z0-9])PP\s*(?:N[º°O.]?\s*)?0*(\d+)/i.exec(String(arquivo || ''));
  return m ? m[1] : '';
}

const anoDe = s => {
  const t = String(s || '');
  const iso = /^(\d{4})-/.exec(t);
  if (iso) return iso[1];
  const br = /(\d{4})\s*$/.exec(t);
  return br ? br[1] : '';
};

export function indicePP(docs) {
  const idx = new Map();
  for (const d of docs || []) {
    if (d.papel && d.papel !== 'pagamento') continue;
    const n = numeroPP(d.arquivo);
    const ano = anoDe(d.competencia);
    if (!n || !ano) continue;
    const k = `${ano}|${n}`;
    if (!idx.has(k)) idx.set(k, []);
    idx.get(k).push(d);
  }
  for (const l of idx.values()) l.sort((a, b) => String(a.arquivo).localeCompare(String(b.arquivo), 'pt-BR', { numeric: true }));
  return idx;
}

export function docsDoPP(idx, numero, data) {
  const n = String(numero || '').replace(/\D/g, '').replace(/^0+(?=\d)/, '');
  const ano = anoDe(String(data || '').slice(0, 10));
  return (n && ano && idx.get(`${ano}|${n}`)) || [];
}

export function classificacoes(docs) {
  const c = new Map();
  for (const d of docs || []) {
    const k = d.classificacao || '';
    if (k) c.set(k, (c.get(k) || 0) + 1);
  }
  return [...c.entries()].map(([nome, n]) => ({ nome, n })).sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR', { numeric: true }));
}

export function recortePorPP(t, idx, aceita = () => true) {
  const casa = (numero, linha) => aceita(linha) && docsDoPP(idx, numero, linha.data || linha.data_retencao).length > 0;
  const detalhes = (t.detalhes || []).filter(p => casa(p.numero_documento, p));
  return {
    ...t,
    credores: (t.credores || []).map(c => ({ ...c, pagamentos: detalhes.filter(p => p.documento === c.documento).length })),
    detalhes,
    retencoes: (t.retencoes || []).filter(x => casa(x.pp || x.numero_documento, x)),
    notas: (t.notas || []).filter(n => casa(n.pp || n.numero_documento, n)),
  };
}

function montar(d) {
  const docs = d.documentos;
  const docPorId = new Map(docs.map(x => [x.id, x]));
  const novidades = (d.pacote && d.pacote.novidades) || null;
  const novos = new Set((novidades && novidades.documentos_novos) || []);

  const nomes = new Map();
  const anotar = (cpf, nome) => { const c = so(cpf); if (c && nome && !nomes.has(c)) nomes.set(c, nome); };
  for (const e of d.envolvidos || []) anotar(e.documento, e.nome);
  for (const emp of d.funcionarios || []) for (const f of emp.lista || []) anotar(f.cpf, f.nome);
  for (const s of (d.folha && d.folha.servidores) || []) anotar(s.cpf, s.nome);
  for (const p of Object.values((d.beneficios && d.beneficios.pessoas) || {})) anotar(p.cpf, p.nome);

  const blocos = ((d.contratacoes && d.contratacoes.blocos) || []).map(b => ({
    ...b,
    docContrato: docPorId.get(b.contrato) || null,
  }));

  return {
    bruto: d,
    pacote: d.pacote || {},
    cliente: lerCliente(d.cliente),
    cadeia: d.cadeia || {},
    resumo: d.resumo || {},
    secoes: new Set(d.secoes || []),
    gerado_em: d.gerado_em || '',
    docs,
    docPorId,
    novos,
    novidades,
    blocos,
    fora: ((d.contratacoes && d.contratacoes.fora_de_contratacao) || []).map(i => docPorId.get(i)).filter(Boolean),
    nomes,
    pp: indicePP(docs),
  };
}

export function porAnoCompetencia(lista) {
  const anos = new Map();
  for (const doc of lista) {
    const k = chaveCompetencia(doc.competencia);
    const ano = k ? k.slice(0, 4) : 'Sem competência';
    if (!anos.has(ano)) anos.set(ano, new Map());
    const meses = anos.get(ano);
    const comp = doc.competencia || '—';
    if (!meses.has(comp)) meses.set(comp, []);
    meses.get(comp).push(doc);
  }
  return [...anos.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([ano, meses]) => ({
      ano,
      meses: [...meses.entries()]
        .sort((a, b) => chaveCompetencia(b[0]).localeCompare(chaveCompetencia(a[0])))
        .map(([competencia, docs]) => ({ competencia, docs: docs.sort((x, y) => x.n - y.n) })),
    }));
}

function apontamentosDe(r) {
  const a = [];
  if (r.folha.length) a.push({ id: 'folha', rotulo: 'Na folha do município' });
  if (r.docs.length) a.push({ id: 'doc', rotulo: 'Citado em documento da cadeia' });
  if (r.pag.length) a.push({ id: 'pag', rotulo: 'Em pagamento' });
  if (r.aux.length) a.push({ id: 'aux', rotulo: 'Benefício social' });
  if (r.tse.length) a.push({ id: 'tse', rotulo: 'Eleições' });
  return a;
}

export function lerCruzamentos(obj, nomes) {
  return Object.entries(obj || {}).map(([cpf, itens]) => {
    const r = { cpf, nome: nomes.get(so(cpf)) || '', motivos: [], folha: [], docs: [], pag: [], aux: [], tse: [] };
    for (const [chave, rotulo] of Object.entries(itens || {})) {
      const [tipo, valor] = chave.split(':');
      if (chave === 'nome') r.nome = r.nome || String(rotulo || '');
      else if (tipo === 'motivo') r.motivos.push({ id: valor, rotulo });
      else if (tipo === 'folha') r.folha.push(valor);
      else if (tipo === 'doc') r.docs.push(Number(valor));
      else if (r[tipo]) r[tipo].push(rotulo || valor);
    }
    r.folha.sort();
    r.apontamentos = r.motivos.length ? r.motivos : apontamentosDe(r);
    return r;
  });
}
