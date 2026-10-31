import { normStr } from './format.js';
import { RE_COMPETENCIA, FOLHA_REQUIRED_HEADERS, contentHash } from './folha-parser.js';
import { UNIDADES_TCMBA } from '../../data/unidades-tcmba.js';

export const COLS_PROJETO = Object.freeze([
  'Município', 'Arquivo de origem', 'Título da planilha', 'Parte', 'Registros da planilha', 'Pessoas declaradas',
  'Total de vencimentos', 'RCL mensal', 'RCL 12 meses', 'Período RCL 12 meses', 'Conferência', 'Exportação',
  'Linha na planilha', 'Conferência da linha',
]);

const COLS_SEM_PARTE = COLS_PROJETO.filter(c => c !== 'Parte');

const N_LINHA = 2;

export const MSG_UM_MUNICIPIO = 'Exporte separadamente os municípios para não se atrapalhar: um projeto para cada município.';

export class ProjetoErro extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'ProjetoErro';
    this.code = code;
  }
}

const RE_ENTE = /^(?:Prefeitura|C[aâ]mara) Municipal de (.+)$/i;

const MINUSCULAS = new Set(['de', 'da', 'do', 'das', 'dos', 'e']);

function nomeProprio(s) {
  return String(s).trim().toLowerCase().replace(/\s+/g, ' ').split(' ').map((w, i) => {
    if (i > 0 && MINUSCULAS.has(w)) return w;
    return w.replace(/(^|[-'])(\p{L})/gu, (_, sep, l) => sep + l.toUpperCase())
      .replace(/^D'/, i > 0 ? "d'" : "D'");
  }).join(' ');
}

const MESMO_MUNICIPIO = { camaca: 'camacan', ibirapoa: 'ibirapua' };
const GRAFIA = { camacan: 'Camacan', ibirapua: 'Ibirapuã' };

const chaveMun = s => {
  const k = normStr(s).replace(/[^a-z0-9]/g, '');
  return MESMO_MUNICIPIO[k] || k;
};
const palavras = s => normStr(s).replace(/[^a-z0-9]+/g, ' ').trim();
const acentos  = s => (String(s).match(/[^\x00-\x7f]/g) || []).length;

export const MUNICIPIOS = Object.freeze([...UNIDADES_TCMBA
  .map(u => (u.match(RE_ENTE) || [])[1]).filter(Boolean)
  .reduce((mapa, m) => {
    const k = chaveMun(m), atual = mapa.get(k);
    if (!atual || acentos(m) > acentos(atual)) mapa.set(k, m.trim());
    return mapa;
  }, new Map()).entries()].map(([k, m]) => GRAFIA[k] || nomeProprio(m)).sort((a, b) => a.localeCompare(b, 'pt-BR')));

const MUNICIPIOS_CHAVE = new Map(MUNICIPIOS.map(m => [chaveMun(m), m]));
const MUNICIPIOS_PALAVRAS = MUNICIPIOS.map(m => [m, palavras(m)]).sort((a, b) => b[1].length - a[1].length);

export function municipioOficial(nome) {
  return MUNICIPIOS_CHAVE.get(chaveMun(nome)) || '';
}

export function municipioDaUnidade(unidade) {
  const txt = String(unidade || '').trim();
  const ente = txt.match(RE_ENTE);
  if (ente) return municipioOficial(ente[1]);
  const n = ` ${palavras(txt)} `;
  let melhor = null;
  for (const [m, mp] of MUNICIPIOS_PALAVRAS) {
    const i = n.lastIndexOf(` ${mp} `);
    if (i === -1) continue;
    const fim = i + mp.length;
    if (!melhor || fim > melhor.fim || (fim === melhor.fim && mp.length > melhor.len)) melhor = { m, fim, len: mp.length };
  }
  return melhor ? melhor.m : '';
}

export function mesmoMunicipio(a, b) {
  return chaveMun(a) === chaveMun(b);
}

export function municipiosDistintos(nomes) {
  const vistos = new Map();
  for (const nome of nomes) {
    const k = chaveMun(nome);
    if (k && !vistos.has(k)) vistos.set(k, String(nome).trim());
  }
  return [...vistos.values()];
}

export function avisoMunicipios(nomes, doProjeto = '') {
  const outros = municipiosDistintos(nomes).filter(m => !doProjeto || !mesmoMunicipio(m, doProjeto));
  if (doProjeto && outros.length) {
    return `Este projeto é de ${doProjeto} e há planilha de ${outros.join(', ')}. ${MSG_UM_MUNICIPIO}`;
  }
  const todos = municipiosDistintos(nomes);
  if (todos.length > 1) {
    return `Há planilhas de ${todos.length} municípios (${todos.join(', ')}). ${MSG_UM_MUNICIPIO}`;
  }
  return '';
}

export function chaveGrupo(unidade, competencia) {
  return normStr(unidade) + '|' + String(competencia || '').trim();
}

export function faixaNomes(nomes) {
  let min = null, max = null;
  for (const nome of nomes) {
    const k = normStr(nome);
    if (!k) continue;
    if (min === null || k < min) min = k;
    if (max === null || k > max) max = k;
  }
  return min === null ? null : [min, max];
}

function separadas(a, b) {
  return !!(a && b) && (a[1] <= b[0] || b[1] <= a[0]);
}

const txtFaixa = f => (f ? ` (nomes de ${f[0].toUpperCase()} a ${f[1].toUpperCase()})` : '');

export function duplicidades(existentes, novos) {
  const aceitos = [...existentes];
  const achados = [];
  novos.forEach((n, i) => {
    const k = chaveGrupo(n.unidade, n.competencia);
    const descr = `${n.unidade} em ${n.competencia}`;
    const igual = n.hash && aceitos.find(e => e.hash === n.hash);
    if (igual) {
      if (igual.parcial && !n.parcial) {
        aceitos.splice(aceitos.indexOf(igual), 1, n);
        return;
      }
      achados.push({
        i, motivo: chaveGrupo(igual.unidade, igual.competencia) === k
          ? `${descr} já está carregada (${igual.filename || 'planilha anterior'}). Nada foi somado duas vezes.`
          : `Conteúdo idêntico ao de ${igual.unidade} em ${igual.competencia} (${igual.filename || 'planilha anterior'}).`,
      });
      return;
    }
    const cruzada = aceitos.find(e => chaveGrupo(e.unidade, e.competencia) === k && !separadas(e.faixa, n.faixa));
    if (cruzada) {
      achados.push({
        i, motivo: `${descr} já tem planilha carregada (${cruzada.filename || 'planilha anterior'})${txtFaixa(cruzada.faixa)} ` +
          `e esta repete a mesma faixa${txtFaixa(n.faixa)}. Não é uma parte da folha: parece outra versão da mesma planilha. ` +
          'Nada foi somado duas vezes. Se for uma versão corrigida, reinicie e carregue só a nova.',
      });
      return;
    }
    aceitos.push(n);
  });
  return achados;
}

export function numerarPartes(files) {
  const grupos = new Map();
  for (const f of files) {
    const k = chaveGrupo(f.unidade, f.competencia);
    if (!grupos.has(k)) grupos.set(k, []);
    grupos.get(k).push(f);
  }
  for (const lista of grupos.values()) {
    lista.sort((a, b) => ((a.faixa?.[0] ?? '') < (b.faixa?.[0] ?? '') ? -1 : 1));
    lista.forEach((f, i) => { f.parte = i + 1; f.partes = lista.length; });
  }
  return files;
}

export function slugMunicipio(nome) {
  return normStr(nome).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'municipio';
}

export function nomeArquivoProjeto(municipio, d = new Date(), sufixo = '') {
  const p = n => String(n).padStart(2, '0');
  return `projeto_${slugMunicipio(municipio)}_${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${sufixo ? '_' + sufixo : ''}.csv`;
}

export function conferenciaLinha(ordem, valores) {
  let h = 0x811c9dc5;
  const txt = String(ordem) + '\x1f' + valores.join('\x1f');
  for (let i = 0; i < txt.length; i++) {
    h ^= txt.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

const numTxt = n => (n == null || Number.isNaN(n) ? '' : String(n).replace('.', ','));
const lerNum = s => {
  const t = String(s ?? '').trim();
  if (!t) return null;
  const n = Number(t.replace(',', '.'));
  return Number.isFinite(n) ? n : null;
};

export function montarProjeto(headers, files, recs, { filtrado = false } = {}) {
  const grupos = new Map(files.map(f => [f, []]));
  const porChave = new Map(files.map(f => [chaveGrupo(f.unidade, f.competencia) + '|' + (f.parte ?? 1), f]));
  if (porChave.size !== files.length) throw new ProjetoErro('DUPLICADO', 'Há planilha repetida (mesma unidade, competência e parte) na memória.');
  for (const r of recs) {
    const f = r.arq && grupos.has(r.arq) ? r.arq : porChave.get(chaveGrupo(r.unidade, r.comp) + '|' + (r.parte ?? 1));
    if (!f || chaveGrupo(f.unidade, f.competencia) !== chaveGrupo(r.unidade, r.comp)) {
      throw new ProjetoErro('ORFAO', `Há registro de ${r.unidade} em ${r.comp} sem planilha correspondente.`);
    }
    grupos.get(f).push(r);
  }
  const usados = files.filter(f => grupos.get(f).length > 0);
  if (usados.length === 0) throw new ProjetoErro('VAZIO', 'Nenhuma linha para exportar.');
  const municipios = municipiosDistintos(usados.map(f => f.municipio));
  if (municipios.length !== 1) {
    throw new ProjetoErro('MUNICIPIO', municipios.length ? avisoMunicipios(municipios) : 'Informe o município das planilhas.');
  }
  const dup = duplicidades([], usados);
  if (dup.length) throw new ProjetoErro('DUPLICADO', dup[0].motivo);

  const rows = [];
  for (const f of usados) {
    const linhas = grupos.get(f);
    const naMemoria = f.carregadas ?? f.count;
    if (filtrado ? linhas.length > naMemoria : linhas.length !== naMemoria) {
      throw new ProjetoErro('CONTAGEM', `${f.unidade} em ${f.competencia}: ${linhas.length} registro(s) para exportar, ${naMemoria} carregado(s).`);
    }
    const ordens = new Set();
    for (const l of linhas) {
      if (!Number.isInteger(l.ordem) || l.ordem < 1 || l.ordem > f.count || ordens.has(l.ordem)) {
        throw new ProjetoErro('DUPLICADO', `${f.unidade} em ${f.competencia}: linha ${l.ordem} repetida ou fora da planilha.`);
      }
      ordens.add(l.ordem);
    }
    const r = f.resumo || {};
    const meta = [
      municipios[0], f.filename || '', f.titulo || '', String(f.parte ?? 1), String(f.count), numTxt(r.pessoas), numTxt(r.totalVencimentos),
      numTxt(r.rclMensal), numTxt(r.rcl12m), r.rcl12mPeriodo || '', f.hash || '',
      linhas.length === f.count ? 'completa' : 'parcial',
    ];
    for (const l of [...linhas].sort((x, y) => x.ordem - y.ordem)) {
      rows.push(l.row.concat(meta, [String(l.ordem), conferenciaLinha(l.ordem, l.row)]));
    }
  }
  if (rows.length !== recs.length) {
    throw new ProjetoErro('CONTAGEM', `O arquivo teria ${rows.length} linha(s), mas há ${recs.length} para exportar.`);
  }
  return { headers: headers.concat(COLS_PROJETO), rows, municipio: municipios[0] };
}

export function parseCSV(texto, sep = ';') {
  const s = String(texto || '').replace(/^﻿/, '');
  const linhas = [];
  let row = [], cell = '', aspas = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (aspas) {
      if (c === '"') {
        if (s[i + 1] === '"') { cell += '"'; i++; } else aspas = false;
      } else cell += c;
    } else if (c === '"' && cell === '') aspas = true;
    else if (c === sep) { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++;
      row.push(cell); linhas.push(row); row = []; cell = '';
    } else cell += c;
  }
  if (aspas) throw new ProjetoErro('ASPAS', 'O arquivo termina no meio de um campo entre aspas: está incompleto ou corrompido.');
  if (cell !== '' || row.length) { row.push(cell); linhas.push(row); }
  return linhas.filter(l => l.some(v => v.trim() !== ''));
}

const ALTERADO = 'Este arquivo foi alterado fora do SIGA VOCÊ (por exemplo, aberto e salvo no Excel). ' +
  'Para não induzir a erro, ele não foi aberto. Use o arquivo original baixado em "Salvar projeto".';

function colunasFolha(base) {
  const raw = base.slice(0, -2);
  const found = new Set(raw.map(normStr));
  const faltam = FOLHA_REQUIRED_HEADERS.filter(h => !found.has(normStr(h)));
  if (faltam.length) throw new ProjetoErro('FORMATO', 'Colunas da folha ausentes no arquivo: ' + faltam.join(', ') + '.');
  return raw;
}

async function lerExportado(linhas, headers) {
  const raw = colunasFolha(headers);
  const iComp = headers.length - 2, iUni = headers.length - 1;
  const grupos = new Map();
  for (let li = 1; li < linhas.length; li++) {
    const l = linhas[li];
    while (l.length > headers.length && l[l.length - 1] === '') l.pop();
    if (l.length !== headers.length) throw new ProjetoErro('ALTERADO', `Linha ${li + 1} com ${l.length} coluna(s); o arquivo tem ${headers.length}.`);
    const competencia = l[iComp].trim(), unidade = l[iUni].trim();
    if (!RE_COMPETENCIA.test(competencia)) throw new ProjetoErro('ALTERADO', `Linha ${li + 1}: competência "${competencia}" inválida.`);
    const k = chaveGrupo(unidade, competencia);
    if (!grupos.has(k)) grupos.set(k, { unidade, competencia, linhas: [] });
    grupos.get(k).linhas.push(l);
  }

  const lista = [...grupos.values()];
  const semMunicipio = lista.filter(g => !municipioDaUnidade(g.unidade));
  if (semMunicipio.length) {
    throw new ProjetoErro('MUNICIPIO', `Não foi possível saber o município de "${semMunicipio[0].unidade}" pelo nome. ` +
      'Carregue essa unidade pelo .xls do TCM-BA e informe o município na janela.');
  }
  const aviso = avisoMunicipios(lista.map(g => municipioDaUnidade(g.unidade)));
  if (aviso) throw new ProjetoErro('MUNICIPIO', aviso);

  const iNome = raw.findIndex(h => normStr(h) === 'nome');
  const saida = [];
  for (const g of lista) {
    const rows = g.linhas.map(r => r.slice(0, raw.length));
    saida.push({
      unidade: g.unidade, competencia: g.competencia, municipio: municipioDaUnidade(g.unidade),
      filename: 'CSV exportado', count: rows.length, hash: await contentHash(raw, rows), linhas: g.linhas,
      faixa: faixaNomes(rows.map(r => r[iNome])),
      resumo: { pessoas: null, totalVencimentos: null, rclMensal: null, rcl12m: null, rcl12mPeriodo: '' },
    });
  }
  const dup = duplicidades([], saida);
  if (dup.length) throw new ProjetoErro('DUPLICADO', dup[0].motivo);

  return { municipio: saida[0].municipio, headers, rawHeaders: raw, grupos: saida, legado: true };
}

export async function lerProjeto(texto) {
  const linhas = parseCSV(texto);
  if (linhas.length < 2) throw new ProjetoErro('VAZIO', 'Arquivo de projeto vazio.');

  const headers = linhas[0].map(h => h.trim());
  while (headers.length && headers[headers.length - 1] === '') headers.pop();
  const n = COLS_PROJETO.length;
  const termina = cols => headers.length > cols.length && cols.every((c, i) => headers[headers.length - cols.length + i] === c);
  if (!termina(COLS_PROJETO) && termina(COLS_SEM_PARTE)) {
    const iParte = headers.length - COLS_SEM_PARTE.length + COLS_PROJETO.indexOf('Parte');
    for (const l of linhas) l.splice(iParte, 0, l === linhas[0] ? 'Parte' : '1');
    headers.splice(iParte, 0, 'Parte');
  }
  const ehProjeto = termina(COLS_PROJETO);
  if (!ehProjeto) {
    if (headers[headers.length - 2] === 'Competência' && headers[headers.length - 1] === 'Unidade') {
      return lerExportado(linhas, headers);
    }
    if (linhas[0].length === 1 && /,/.test(linhas[0][0])) throw new ProjetoErro('ALTERADO', ALTERADO);
    throw new ProjetoErro('FORMATO', 'Este .csv não é um projeto da Folha de Pagamento do SIGA VOCÊ.');
  }

  const base = headers.slice(0, -n);
  if (base[base.length - 2] !== 'Competência' || base[base.length - 1] !== 'Unidade') {
    throw new ProjetoErro('FORMATO', 'Projeto sem as colunas Competência e Unidade.');
  }
  const raw = colunasFolha(base);
  const iNome = raw.findIndex(h => normStr(h) === 'nome');

  const iComp = base.length - 2, iUni = base.length - 1, b = base.length;
  const grupos = new Map();
  for (let li = 1; li < linhas.length; li++) {
    const l = linhas[li];
    while (l.length > headers.length && l[l.length - 1] === '') l.pop();
    if (l.length !== headers.length) throw new ProjetoErro('ALTERADO', `Linha ${li + 1} com ${l.length} coluna(s); o projeto tem ${headers.length}. ${ALTERADO}`);
    const competencia = l[iComp].trim(), unidade = l[iUni].trim();
    if (!RE_COMPETENCIA.test(competencia)) throw new ProjetoErro('ALTERADO', `Linha ${li + 1}: competência "${competencia}" inválida. ${ALTERADO}`);
    const meta = l.slice(b, l.length - N_LINHA);
    const [ordemTxt, conf] = l.slice(l.length - N_LINHA);
    const valores = l.slice(0, b);
    const ordem = Number(ordemTxt);
    if (!Number.isInteger(ordem) || conferenciaLinha(ordem, valores) !== conf.trim()) {
      throw new ProjetoErro('ALTERADO', `Linha ${li + 1} (${unidade} em ${competencia}) foi modificada. ${ALTERADO}`);
    }
    const k = chaveGrupo(unidade, competencia) + '|' + meta[3];
    let g = grupos.get(k);
    if (!g) {
      g = { unidade, competencia, meta: meta.join('\x1f'), metaArr: meta, linhas: [], ordens: new Set() };
      grupos.set(k, g);
    } else if (g.meta !== meta.join('\x1f')) {
      throw new ProjetoErro('ALTERADO', `Linha ${li + 1}: dados da planilha de ${unidade} em ${competencia} diferentes das outras linhas dela. ${ALTERADO}`);
    }
    if (g.ordens.has(ordem)) {
      throw new ProjetoErro('DUPLICADO', `Linha ${li + 1}: a linha ${ordem} da planilha de ${unidade} em ${competencia} aparece duas vezes. ` +
        'Para não somar em dobro, o arquivo não foi aberto.');
    }
    g.ordens.add(ordem);
    g.linhas.push({ ordem, valores });
  }

  const lista = [...grupos.values()].map(g => {
    const [municipio, filename, titulo, parte, count, pessoas, totalVencimentos, rclMensal, rcl12m, rcl12mPeriodo, hash, exportacao] = g.metaArr;
    const ord = g.linhas.sort((x, y) => x.ordem - y.ordem);
    return {
      unidade: g.unidade, competencia: g.competencia, municipio: municipio.trim(), filename, titulo, parte: Number(parte) || 1,
      faixa: faixaNomes(ord.map(x => x.valores[iNome])),
      count: Number(count), hash: hash.trim(), exportacao: exportacao.trim(),
      linhas: ord.map(x => x.valores), ordens: ord.map(x => x.ordem),
      resumo: {
        pessoas: lerNum(pessoas), totalVencimentos: lerNum(totalVencimentos),
        rclMensal: lerNum(rclMensal), rcl12m: lerNum(rcl12m), rcl12mPeriodo,
      },
    };
  });

  const aviso = avisoMunicipios(lista.map(g => g.municipio));
  if (aviso) throw new ProjetoErro('MUNICIPIO', aviso);
  if (!lista[0].municipio) throw new ProjetoErro('ALTERADO', 'Projeto sem município. ' + ALTERADO);

  for (const g of lista) {
    const fora = g.ordens.find(o => o < 1 || o > g.count);
    if (!Number.isInteger(g.count) || fora !== undefined) {
      throw new ProjetoErro('ALTERADO', `${g.unidade} em ${g.competencia}: linha ${fora} fora da planilha de ${g.count}. ${ALTERADO}`);
    }
    if (g.exportacao === 'completa') {
      if (g.linhas.length !== g.count) {
        throw new ProjetoErro('CONTAGEM', `${g.unidade} em ${g.competencia}: a planilha tem ${g.count} linha(s), mas o arquivo tem ${g.linhas.length}. ` +
          'Há linha apagada. ' + ALTERADO);
      }
      const hash = await contentHash(raw, g.linhas.map(r => r.slice(0, raw.length)));
      if (hash !== g.hash) throw new ProjetoErro('ALTERADO', `${g.unidade} em ${g.competencia}: conteúdo diferente do salvo. ${ALTERADO}`);
      g.parcial = false;
    } else if (g.exportacao === 'parcial' && g.linhas.length < g.count) {
      g.parcial = true;
    } else {
      throw new ProjetoErro('ALTERADO', `${g.unidade} em ${g.competencia}: exportação "${g.exportacao}" inválida. ${ALTERADO}`);
    }
  }
  const dup = duplicidades([], lista);
  if (dup.length) throw new ProjetoErro('DUPLICADO', dup[0].motivo);

  return { municipio: lista[0].municipio, headers: base, rawHeaders: raw, grupos: lista };
}
