const OLE2_SIG = [0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1];
const ZIP_SIG  = [0x50, 0x4B, 0x03, 0x04];

export const MAX_BYTES = 15 * 1024 * 1024;

let xlsxPromise = null;
function loadXLSX() {
  if (!xlsxPromise) xlsxPromise = import('../../../vendor/xlsx.mjs');
  return xlsxPromise;
}

function startsWith(bytes, sig) {
  return sig.every((b, i) => bytes[i] === b);
}

export async function readSpreadsheet(buffer, filename) {
  const name  = String(filename || '').toLowerCase();
  const bytes = new Uint8Array(buffer);

  if (bytes.length > MAX_BYTES) {
    throw new Error('Arquivo excede 15 MB. Folhas de pagamento do TCM-BA são bem menores.');
  }
  if (name.endsWith('.xls') && !startsWith(bytes, OLE2_SIG)) {
    throw new Error('Arquivo não é um .xls válido (assinatura inválida).');
  }
  if (name.endsWith('.xlsx') && !startsWith(bytes, ZIP_SIG)) {
    throw new Error('Arquivo não é um .xlsx válido (assinatura inválida).');
  }

  const XLSX = await loadXLSX();
  let wb;
  try {
    wb = XLSX.read(bytes, { type: 'array', cellFormula: false, cellHTML: false });
  } catch (err) {
    throw new Error('Não foi possível ler a planilha: ' + (err && err.message || err));
  }
  if (!wb.SheetNames.length) throw new Error('Planilha vazia.');

  const sheet  = wb.Sheets[wb.SheetNames[0]];
  const matrix = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: '', blankrows: true });
  return { matrix, title: (wb.Props && wb.Props.Title) || '' };
}
