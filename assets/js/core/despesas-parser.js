import { formatBRL } from './format.js';

export const REQUIRED_COLUMNS = Object.freeze([
  'NumeroDocumento', 'empenho', 'data', 'dataEmpenho',
  'municipio', 'unidade', 'codigoUnidade', 'orgao',
  'unidadeOrcamentaria', 'credor', 'valor',
  'cd_ElementoGestor', 'de_ElementoGestor', 'cd_Fonte', 'de_Fonte',
]);

const REQUIRED_SET = new Set(REQUIRED_COLUMNS);

const HEADER_MAP = { data: 'dataPagamento' };

export class DespesasParseError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'DespesasParseError';
    this.code = code;
  }
}

export function validateColumns(rawHeaders) {
  const cleaned  = rawHeaders.filter(h => h !== '');
  const foundSet = new Set(cleaned);
  const missing  = REQUIRED_COLUMNS.filter(c => !foundSet.has(c));
  const extra    = cleaned.filter(c => !REQUIRED_SET.has(c));
  return { valid: missing.length === 0 && extra.length === 0, missing, extra };
}

export function parseDespesasCSV(text) {
  const clean = text.replace(/^﻿/, '');
  const lines = clean.split(/\r?\n/).filter(l => l.trim() !== '');
  if (lines.length < 2) {
    throw new DespesasParseError('EMPTY', 'Arquivo CSV vazio ou inválido.');
  }

  const rawHeaders = lines[0].split(';').map(h => h.trim());
  const check = validateColumns(rawHeaders);
  if (!check.valid) {
    const parts = [];
    if (check.missing.length) parts.push('ausentes: ' + check.missing.join(', '));
    if (check.extra.length)   parts.push('inesperadas: ' + check.extra.join(', '));
    throw new DespesasParseError('INVALID_COLUMNS', 'Colunas inválidas (' + parts.join('; ') + ').');
  }

  const headers = rawHeaders.map(h => HEADER_MAP[h] || h);

  const rows = lines.slice(1).map(line => {
    const cells = line.split(';');
    const obj = {};
    headers.forEach((h, i) => { obj[h] = (cells[i] || '').trim(); });
    return obj;
  }).filter(obj => Object.values(obj).some(v => v !== ''));

  const badValor = rows.find(obj => {
    const v = (obj.valor || '').trim();
    return v === '' || isNaN(parseFloat(v.replace(',', '.')));
  });
  if (badValor) {
    throw new DespesasParseError('INVALID_VALOR', 'Há linhas sem valor numérico na coluna "valor".');
  }

  return rows;
}

export function rowKey(obj) {
  return [
    obj.NumeroDocumento || '',
    obj.empenho         || '',
    obj.dataPagamento   || '',
    obj.credor          || '',
    obj.valor           || '',
    obj.unidade         || '',
  ].join('\x00');
}

export function parseDateBR(dateStr) {
  if (!dateStr || !dateStr.trim()) return '';
  const iso   = dateStr.trim().split(' ')[0];
  const parts = iso.split('-');
  if (parts.length !== 3) return dateStr.trim();
  return `${parts[2]}/${parts[1]}/${parts[0]}`;
}

export function toNumber(raw) {
  return parseFloat(String(raw).replace(',', '.')) || 0;
}

export function calcDiasPrazo(isoEmp, isoPag) {
  if (!isoEmp || !isoPag) return null;
  const e = new Date(isoEmp.slice(0, 10));
  const p = new Date(isoPag.slice(0, 10));
  if (isNaN(e) || isNaN(p)) return null;
  return Math.round((p - e) / 86400000);
}

export function buildRows(rawObjects) {
  return rawObjects.map(obj => {
    const numValue = toNumber(obj.valor);
    return {
      raw: {
        ...obj,
        _numValor:         numValue,
        _rawDataPagamento: obj.dataPagamento,
        _rawDataEmpenho:   obj.dataEmpenho,
        _diasPrazo:        calcDiasPrazo(obj.dataEmpenho, obj.dataPagamento),
      },
      display: {
        ...obj,
        dataPagamento: parseDateBR(obj.dataPagamento),
        dataEmpenho:   parseDateBR(obj.dataEmpenho),
        valor:         formatBRL(numValue),
      },
    };
  });
}

export function calcSummary(rows) {
  let totalP = 0, totalN = 0, countP = 0, countN = 0;
  for (const r of rows) {
    const v = r.raw._numValor;
    if (v < 0) { totalN += v; countN++; }
    else       { totalP += v; countP++; }
  }
  return { totalP, totalN, countP, countN, saldo: totalP + totalN, total: rows.length };
}
