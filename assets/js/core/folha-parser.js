import { isCurrencyCell, parseCurrencyBRL, normStr } from './format.js';

export const RE_COMPETENCIA = /^(0[1-9]|1[0-2])-\d{4}$/;

export const FOLHA_REQUIRED_HEADERS = Object.freeze([
  'Nome',
  'Matrícula',
  'Tipo Regime',
  'Cargo',
  'Salário Líquido',
  'Salário Base',
  'Vantagens',
  'Gratificação',
  '13º Salário',
  'Carga H Semanal',
  'Situação',
  'Ingresso/Admissão',
]);

const MESES = {
  janeiro: '01', fevereiro: '02', marco: '03', abril: '04',
  maio: '05', junho: '06', julho: '07', agosto: '08',
  setembro: '09', outubro: '10', novembro: '11', dezembro: '12',
};

const HEADER_ROW = 2;
const DATA_START = 3;

const RE_RODAPE = /^n\s*[º°o.]?\s*de\s+pessoas\s*:?\s*([\d.]+)?/i;

export class FolhaParseError extends Error {
  constructor(message) {
    super(message);
    this.name = 'FolhaParseError';
  }
}

export function detectUnidadeCompetencia(line) {
  const text = String(line || '').replace(/\s+/g, ' ').trim();
  const m = text.match(/([A-Za-zÀ-ÿ]+)\s*\/\s*(\d{4})$/);
  if (!m) return { unidade: text, competencia: '' };

  const before = text.slice(0, m.index);
  const word   = m[1];
  const year   = m[2];
  const wordN  = normStr(word);

  for (const [nome, mm] of Object.entries(MESES)) {
    if (wordN.endsWith(nome)) {
      const unidade = (before + word.slice(0, word.length - nome.length)).trim();
      return { unidade, competencia: `${mm}-${year}` };
    }
  }
  return { unidade: text, competencia: '' };
}

export function competenciaFromFilename(name) {
  const m = String(name || '').match(/(0[1-9]|1[0-2])[-_/](20\d{2})/);
  return m ? `${m[1]}-${m[2]}` : '';
}

export function parseFolhaMatrix(matrix) {
  if (!Array.isArray(matrix) || matrix.length <= DATA_START) {
    throw new FolhaParseError('Planilha sem dados utilizáveis.');
  }

  const cell = v => (v == null ? '' : String(v).trim());

  const headers = (matrix[HEADER_ROW] || []).map(cell);
  while (headers.length && headers[headers.length - 1] === '') headers.pop();
  if (headers.length === 0) throw new FolhaParseError('Cabeçalho não encontrado.');

  const found   = new Set(headers.map(normStr));
  const missing = FOLHA_REQUIRED_HEADERS.filter(h => !found.has(normStr(h)));
  if (missing.length) {
    throw new FolhaParseError(
      'Arquivo não reconhecido como Folha de Pagamento do TCM-BA. ' +
      'Colunas obrigatórias ausentes: ' + missing.join(', ') + '. ' +
      'Baixe o arquivo .xls em tcm.ba.gov.br/controle-social/pessoal e tente novamente.'
    );
  }

  const ncols = headers.length;
  const iNome = headers.findIndex(h => normStr(h) === 'nome');
  const rows  = [];
  let declaredCount = null;
  let r = DATA_START;
  for (; r < matrix.length; r++) {
    const src = matrix[r] || [];
    const vals = [];
    for (let c = 0; c < ncols; c++) vals.push(cell(src[c]));
    const rodape = vals[0].match(RE_RODAPE);
    if (rodape) {
      if (rodape[1]) declaredCount = parseInt(rodape[1].replace(/\./g, ''), 10);
      break;
    }
    if (vals[iNome] === '') break;
    rows.push(vals);
  }
  if (rows.length === 0) throw new FolhaParseError('Nenhum registro encontrado no arquivo.');
  if (declaredCount !== null && declaredCount !== rows.length) {
    throw new FolhaParseError(
      `A planilha declara ${declaredCount} pessoa(s), mas foram lidas ${rows.length} linha(s). ` +
      'O arquivo pode estar incompleto ou em formato diferente do esperado.'
    );
  }

  const currencyCols = [];
  for (let c = 0; c < ncols; c++) if (isCurrencyCell(rows[0][c])) currencyCols.push(c);

  const titleLine = (matrix[1] || []).map(cell).filter(Boolean).join(' ');
  const detected  = detectUnidadeCompetencia(titleLine);
  const resumo    = parseRodape(matrix.slice(r).map(row => (row || []).map(cell)));
  resumo.pessoas  = declaredCount;

  return { headers, rows, currencyCols, detected, titulo: titleLine, declaredCount, resumo };
}

export function parseRodape(tail) {
  const out = { pessoas: null, totalVencimentos: null, rclMensal: null, rcl12m: null, rcl12mPeriodo: '' };

  const valueAfter = (row, c) => {
    const inCell = row[c].split(':').slice(1).join(':').trim();
    if (isCurrencyCell(inCell)) return parseCurrencyBRL(inCell);
    for (let k = c + 1; k < row.length; k++) {
      if (isCurrencyCell(row[k])) return parseCurrencyBRL(row[k]);
    }
    return null;
  };

  for (const row of tail) {
    row.forEach((txt, c) => {
      const n = normStr(txt);
      if (!n) return;
      if (n.startsWith('total de vencimentos')) {
        out.totalVencimentos = valueAfter(row, c);
      } else if (n.startsWith('receita corrente liquida mensal')) {
        out.rclMensal = valueAfter(row, c);
      } else if (n.startsWith('receita corrente liquida de ')) {
        out.rcl12m = valueAfter(row, c);
        out.rcl12mPeriodo = txt.replace(/^receita corrente l[ií]quida de\s*/i, '').trim();
      }
    });
  }
  return out;
}

export function sumCurrencyCols(headers, rows, currencyCols) {
  const totals = {};
  for (const c of currencyCols) {
    let s = 0;
    for (const r of rows) s += parseCurrencyBRL(r[c]);
    totals[headers[c]] = s;
  }
  return totals;
}

export async function contentHash(headers, rows) {
  const payload = [headers.join('\x1f'), ...rows.map(r => r.join('\x1f'))].join('\x1e');
  const bytes   = new TextEncoder().encode(payload);
  const digest  = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
}
