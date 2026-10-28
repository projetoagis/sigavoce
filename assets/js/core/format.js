const BRL = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function formatBRL(num) {
  return BRL.format(num);
}

export function formatInt(n) {
  return n.toLocaleString('pt-BR');
}

export function parseCurrencyBRL(s) {
  if (s == null) return 0;
  const str = String(s).trim();
  if (!str) return 0;
  if (!/^-?\s*R\$/i.test(str)) {
    const n = parseFloat(str.replace(',', '.'));
    return isNaN(n) ? 0 : n;
  }
  const neg   = str.startsWith('-');
  const clean = str.replace(/^-?\s*R\$\s*/i, '').replace(/\./g, '').replace(',', '.');
  const n = parseFloat(clean);
  if (isNaN(n)) return 0;
  return neg ? -n : n;
}

export function isCurrencyCell(v) {
  return typeof v === 'string' && /^\s*-?\s*R\$/i.test(v);
}

export function normStr(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[-–—]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function decodeText(buffer) {
  const utf8 = new TextDecoder('utf-8').decode(buffer);
  if (!utf8.includes('�')) return utf8;
  return new TextDecoder('windows-1252').decode(buffer);
}
