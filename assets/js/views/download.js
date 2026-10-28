export function downloadCSV(filename, headers, rows) {
  const q = v => {
    const s = String(v == null ? '' : v);
    return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [headers.map(q).join(';')].concat(rows.map(r => r.map(q).join(';')));
  const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export function numCSV(v, casas = 2) {
  return v == null || isNaN(v) ? '' : v.toFixed(casas).replace('.', ',');
}
