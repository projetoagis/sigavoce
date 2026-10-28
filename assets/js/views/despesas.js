import { escapeHtml, formatBRL, formatInt, decodeText } from '../core/format.js';
import {
  parseDespesasCSV, rowKey, buildRows, calcSummary,
} from '../core/despesas-parser.js';

const PAGE_SIZE = 20;

const COLUMNS = [
  { key: 'valor',               label: 'Valor',              type: 'number' },
  { key: 'credor',              label: 'Credor',             type: 'string' },
  { key: 'dataPagamento',       label: 'Data Pagamento',     type: 'date'   },
  { key: 'dataEmpenho',         label: 'Data Empenho',       type: 'date'   },
  { key: 'NumeroDocumento',     label: 'Nº Documento',       type: 'string' },
  { key: 'de_Fonte',            label: 'Fonte',              type: 'string' },
  { key: 'unidade',             label: 'Unidade',            type: 'string' },
  { key: 'orgao',               label: 'Órgão',              type: 'string' },
  { key: 'unidadeOrcamentaria', label: 'Unid. Orçamentária', type: 'string' },
];

const MONTH_LABELS   = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun',
                        'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
const QUARTER_MONTHS = { 1: [1, 2, 3], 2: [4, 5, 6], 3: [7, 8, 9], 4: [10, 11, 12] };
const QUARTER_NAMES  = { 1: '1° Trimestre', 2: '2° Trimestre', 3: '3° Trimestre', 4: '4° Trimestre' };

let allRows         = [];
let filteredRows    = [];
let sortKey         = null;
let sortDir         = 1;
let currentPage     = 1;
let loadedFileNames = [];
let seenKeys        = new Set();
let chartInstance   = null;
let selectedQuarter = null;
let prazoAbsMin     = null;
let prazoAbsMax     = null;

const $ = id => document.getElementById(id);

function paletaGrafico() {
  const claro = document.documentElement.classList.contains('theme-light');
  if (!claro) return {
    posFill: 'rgba(63,185,80,0.72)', posLine: '#3fb950',
    posArea: 'rgba(63,185,80,0.12)',
    negFill: 'rgba(248,81,73,0.65)', negLine: '#f85149',
    texto: '#8b949e', grade: 'rgba(48,54,61,0.6)',
    tipFundo: 'rgba(9,14,20,0.92)', tipBorda: 'rgba(88,166,255,0.28)',
    tipTitulo: '#e6edf3', tipCorpo: '#c9d1d9',
  };
  return {
    posFill: 'rgba(26,127,55,0.38)', posLine: '#1a7f37',
    posArea: 'rgba(26,127,55,0.10)',
    negFill: 'rgba(180,35,24,0.34)', negLine: '#b42318',
    texto: '#5b6b7f', grade: 'rgba(2,33,93,0.10)',
    tipFundo: '#ffffff', tipBorda: '#3f67a2',
    tipTitulo: '#02215d', tipCorpo: '#1f2937',
  };
}

function showUploadError(detail) {
  $('info-card').hidden = false;
  $('info-card-detail').textContent = detail || '';
  $('info-card-detail').hidden = !detail;
}

function hideUploadError() {
  $('info-card').hidden = true;
}

async function readFileText(file) {
  return decodeText(await file.arrayBuffer());
}

async function processFileList(fileList) {
  hideUploadError();
  const files = Array.from(fileList);

  const notCsv = files.find(f => !f.name.toLowerCase().endsWith('.csv'));
  if (notCsv) {
    showUploadError(`"${notCsv.name}" não é um arquivo .csv.`);
    return;
  }
  const localKeys  = new Set();
  const batchRaw   = [];
  const batchNames = [];

  for (const file of files) {
    let rawObjects;
    try {
      rawObjects = parseDespesasCSV(await readFileText(file));
    } catch (err) {
      showUploadError(`${file.name}: ${err.message || 'falha ao ler o arquivo.'}`);
      return;
    }
    for (const obj of rawObjects) {
      const k = rowKey(obj);
      if (!seenKeys.has(k) && !localKeys.has(k)) {
        localKeys.add(k);
        batchRaw.push(obj);
      }
    }
    batchNames.push(file.name);
  }

  localKeys.forEach(k => seenKeys.add(k));
  loadedFileNames.push(...batchNames);

  const isAdd = allRows.length > 0;
  const built = buildRows(batchRaw);
  allRows = isAdd ? allRows.concat(built) : built;

  sortKey     = null;
  sortDir     = 1;
  currentPage = 1;

  ['filter-credor', 'filter-fonte', 'filter-orgao', 'filter-unidade', 'filter-elemento']
    .forEach(id => { $(id).value = ''; });
  $('filter-status').textContent = '';
  $('filter-status').classList.remove('active');

  populateDateSelects();
  initPrazoSlider();
  updateCascadingOptions();
  updateMunicipioFilterVisibility();
  filteredRows = [...allRows];
  renderSummary(calcSummary(filteredRows));
  updateAnalysisHeader();

  if (!isAdd) {
    $('analysis-area').classList.add('visible');
    $('upload-section').style.display = 'none';
    $('analysis-area').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  render();
  requestAnimationFrame(() => renderChart(allRows, null));
}

function updateAnalysisHeader() {
  const count = loadedFileNames.length;
  $('analysis-file-label').textContent = count === 1
    ? 'Arquivo carregado:'
    : `Arquivos carregados (${count}):`;
  $('analysis-filename').textContent = loadedFileNames.join(' · ');
}

function readFilters() {
  return {
    credor   : $('filter-credor').value.trim().toLowerCase(),
    municipio: $('filter-municipio').value,
    fonte    : $('filter-fonte').value,
    orgao    : $('filter-orgao').value,
    unid     : $('filter-unidade').value,
    elemento : $('filter-elemento').value,
    dataANO  : $('filter-data-ano').value,
    dataDE   : $('filter-data-de').value,
    dataATE  : $('filter-data-ate').value,
    dataTRIM : selectedQuarter,
    prazoMin : prazoAbsMin !== null ? parseInt($('range-prazo-min').value, 10) : null,
    prazoMax : prazoAbsMax !== null ? parseInt($('range-prazo-max').value, 10) : null,
  };
}

function subsetOf(f, {
  skipMunicipio = false, skipFonte = false, skipOrgao = false, skipUnid = false,
  skipElemento = false, skipQuarter = false, skipPrazo = false,
} = {}) {
  return allRows.filter(r => {
    if (f.credor                      && !r.raw.credor.toLowerCase().includes(f.credor)) return false;
    if (!skipMunicipio && f.municipio && r.raw.municipio           !== f.municipio)    return false;
    if (!skipFonte     && f.fonte     && r.raw.cd_Fonte            !== f.fonte)        return false;
    if (!skipOrgao     && f.orgao     && r.raw.orgao               !== f.orgao)        return false;
    if (!skipUnid      && f.unid      && r.raw.unidadeOrcamentaria !== f.unid)         return false;
    if (!skipElemento  && f.elemento  && r.raw.cd_ElementoGestor   !== f.elemento)     return false;
    const dp = (r.raw._rawDataPagamento || '').slice(0, 7);
    if (f.dataANO && dp.slice(0, 4) !== f.dataANO) return false;
    if (f.dataDE  && dp < f.dataDE)  return false;
    if (f.dataATE && dp > f.dataATE) return false;
    if (!skipQuarter && f.dataTRIM) {
      const m = parseInt(dp.slice(5, 7), 10);
      if (!QUARTER_MONTHS[f.dataTRIM].includes(m)) return false;
    }
    if (!skipPrazo && (f.prazoMin !== null || f.prazoMax !== null)) {
      const d = r.raw._diasPrazo;
      if (d !== null) {
        if (f.prazoMin !== null && d < f.prazoMin) return false;
        if (f.prazoMax !== null && d > f.prazoMax) return false;
      }
    }
    return true;
  });
}

function fillCodeSelect(id, cdKey, deKey, pool, allLabel) {
  const sel    = $(id);
  const curVal = sel.value;
  const pairsMap = new Map();
  for (const r of pool) {
    const cd = (r.raw[cdKey] || '').trim();
    const de = (r.raw[deKey] || '').trim();
    if (!cd) continue;
    const key = `${cd}\x00${de}`;
    if (!pairsMap.has(key)) pairsMap.set(key, { cd, de });
  }
  const pairs = [...pairsMap.values()].sort((a, b) =>
    a.de.toUpperCase().localeCompare(b.de.toUpperCase(), 'pt-BR', { sensitivity: 'base' })
  );
  sel.innerHTML = `<option value="">${allLabel}</option>` +
    pairs.map(({ cd, de }) =>
      `<option value="${escapeHtml(cd)}"${cd === curVal ? ' selected' : ''}>${escapeHtml(de.toUpperCase())} [${escapeHtml(cd)}]</option>`
    ).join('');
  if (curVal && !pairs.some(p => p.cd === curVal)) sel.value = '';
}

function updateCascadingOptions() {
  const f = readFilters();

  const SELECTS = [
    { id: 'filter-municipio', rawKey: 'municipio',           skip: { skipMunicipio: true }, label: 'Todos' },
    { id: 'filter-orgao',     rawKey: 'orgao',               skip: { skipOrgao: true },     label: 'Todos' },
    { id: 'filter-unidade',   rawKey: 'unidadeOrcamentaria', skip: { skipUnid: true },      label: 'Todas' },
  ];

  for (const { id, rawKey, skip, label } of SELECTS) {
    const sel    = $(id);
    const curVal = sel.value;
    const values = [...new Set(subsetOf(f, skip).map(r => r.raw[rawKey] || '').filter(Boolean))].sort();
    sel.innerHTML = `<option value="">${label}</option>` +
      values.map(v =>
        `<option value="${escapeHtml(v)}"${v === curVal ? ' selected' : ''}>${escapeHtml(v)}</option>`
      ).join('');
    if (curVal && !values.includes(curVal)) sel.value = '';
  }

  fillCodeSelect('filter-fonte',    'cd_Fonte',          'de_Fonte',          subsetOf(f, { skipFonte: true }),    'Todas');
  fillCodeSelect('filter-elemento', 'cd_ElementoGestor', 'de_ElementoGestor', subsetOf(f, { skipElemento: true }), 'Todos');
}

function applyFiltersAndSort({ skipPrazoRangeUpdate = false } = {}) {
  const f = readFilters();

  if (!skipPrazoRangeUpdate && (prazoAbsMin !== null || allRows.some(r => r.raw._diasPrazo !== null))) {
    updatePrazoRange(f);
    f.prazoMin = prazoAbsMin !== null ? parseInt($('range-prazo-min').value, 10) : null;
    f.prazoMax = prazoAbsMax !== null ? parseInt($('range-prazo-max').value, 10) : null;
  }

  let result = subsetOf(f, {
    skipPrazo: f.prazoMin === null || (f.prazoMin <= prazoAbsMin && f.prazoMax >= prazoAbsMax),
  });

  if (sortKey) result = sortRows(result, sortKey, sortDir);

  filteredRows = result;
  currentPage  = 1;

  updateCascadingOptions();

  const prazoActive = (f.prazoMin !== null && prazoAbsMin !== null &&
                       (f.prazoMin > prazoAbsMin || f.prazoMax < prazoAbsMax)) ? 1 : 0;
  const dateActive  = (f.dataANO || f.dataDE || f.dataATE || f.dataTRIM) ? 1 : 0;
  const activeCount = [f.credor, f.municipio, f.fonte, f.orgao, f.unid, f.elemento]
    .filter(Boolean).length + dateActive + prazoActive;
  const statusEl = $('filter-status');
  if (activeCount === 0) {
    statusEl.textContent = '';
    statusEl.classList.remove('active');
  } else {
    statusEl.textContent =
      `${activeCount} filtro(s) ativo(s) · ${formatInt(filteredRows.length)} de ${formatInt(allRows.length)} registros`;
    statusEl.classList.add('active');
  }

  updateQuarterButtonStates(f);
  renderChart(filteredRows, selectedQuarter);
  renderSummary(calcSummary(filteredRows));
  render();
}

function clearFilters() {
  ['filter-credor', 'filter-municipio', 'filter-fonte', 'filter-orgao', 'filter-unidade',
   'filter-elemento', 'filter-data-ano', 'filter-data-de', 'filter-data-ate']
    .forEach(id => { $(id).value = ''; });
  selectedQuarter = null;
  document.querySelectorAll('.btn-quarter').forEach(b => b.classList.remove('active'));
  if (prazoAbsMin !== null) {
    $('range-prazo-min').value = prazoAbsMin;
    $('range-prazo-max').value = prazoAbsMax;
    updatePrazoDisplay();
  }
  populateDateSelects();
  applyFiltersAndSort();
}

function updateMunicipioFilterVisibility() {
  const field = $('filter-field-municipio');
  const n = new Set(allRows.map(r => r.raw.municipio).filter(Boolean)).size;
  field.hidden = n <= 1;
  if (n <= 1) $('filter-municipio').value = '';
}

function minMax(values) {
  let mn = Infinity, mx = -Infinity;
  for (const v of values) { if (v < mn) mn = v; if (v > mx) mx = v; }
  return [mn, mx];
}

function setPrazoBounds(values) {
  const widget = $('prazo-slider-widget');
  if (values.length === 0) {
    prazoAbsMin = null;
    prazoAbsMax = null;
    widget.setAttribute('aria-disabled', 'true');
    return;
  }
  [prazoAbsMin, prazoAbsMax] = minMax(values);
  widget.removeAttribute('aria-disabled');

  const sMin = $('range-prazo-min');
  const sMax = $('range-prazo-max');
  for (const s of [sMin, sMax]) { s.min = prazoAbsMin; s.max = prazoAbsMax; }
  sMin.value = prazoAbsMin;
  sMax.value = prazoAbsMax;
  updatePrazoDisplay();
}

function initPrazoSlider() {
  setPrazoBounds(allRows.map(r => r.raw._diasPrazo).filter(v => v !== null));
}

function updatePrazoRange(f) {
  setPrazoBounds(subsetOf(f, { skipPrazo: true }).map(r => r.raw._diasPrazo).filter(v => v !== null));
}

function updatePrazoDisplay() {
  const sMin = $('range-prazo-min');
  const sMax = $('range-prazo-max');
  if (!sMin || prazoAbsMin === null) return;

  const cur  = { min: parseInt(sMin.value, 10), max: parseInt(sMax.value, 10) };
  const span = prazoAbsMax - prazoAbsMin || 1;
  $('range-prazo-fill').style.left  = ((cur.min - prazoAbsMin) / span) * 100 + '%';
  $('range-prazo-fill').style.right = ((prazoAbsMax - cur.max) / span) * 100 + '%';

  const fmt = v => v === 1 ? '1 dia' : `${v} dias`;
  $('range-prazo-val-min').textContent = fmt(cur.min);
  $('range-prazo-val-max').textContent = fmt(cur.max);

  sMin.style.zIndex = cur.min >= cur.max ? 5 : 3;
  sMax.style.zIndex = cur.min >= cur.max ? 3 : 5;

  const isFull = cur.min <= prazoAbsMin && cur.max >= prazoAbsMax;
  const cap = $('range-prazo-caption');
  cap.textContent = isFull
    ? `Intervalo total: ${fmt(prazoAbsMin)} a ${fmt(prazoAbsMax)}`
    : `Filtrando: ${fmt(cur.min)} até ${fmt(cur.max)}`;
  cap.classList.toggle('range-caption--active', !isFull);
}

function populateDateSelects() {
  const selAno = $('filter-data-ano');
  const selDe  = $('filter-data-de');
  const selAte = $('filter-data-ate');
  const curAno = selAno.value, curDe = selDe.value, curAte = selAte.value;

  const years = [...new Set(
    allRows.map(r => (r.raw._rawDataPagamento || '').slice(0, 4)).filter(y => /^\d{4}$/.test(y))
  )].sort();
  selAno.innerHTML = '<option value="">Ano...</option>' +
    years.map(y => `<option value="${y}">${y}</option>`).join('');
  if (curAno && years.includes(curAno)) selAno.value = curAno;

  const anoFilter = selAno.value;
  const months = [...new Set(
    allRows
      .map(r => (r.raw._rawDataPagamento || '').slice(0, 7))
      .filter(m => /^\d{4}-\d{2}$/.test(m))
      .filter(m => !anoFilter || m.slice(0, 4) === anoFilter)
  )].sort();

  const opts = months.map(m => {
    const [y, mm] = m.split('-');
    return `<option value="${m}">${mm}/${y}</option>`;
  }).join('');
  selDe.innerHTML  = `<option value="">De...</option>${opts}`;
  selAte.innerHTML = `<option value="">Até...</option>${opts}`;
  if (curDe  && months.includes(curDe))  selDe.value  = curDe;
  if (curAte && months.includes(curAte)) selAte.value = curAte;
}

function sortRows(rows, key, dir) {
  const col  = COLUMNS.find(c => c.key === key);
  const type = col ? col.type : 'string';
  return [...rows].sort((a, b) => {
    let va, vb;
    if (type === 'number') {
      va = a.raw._numValor; vb = b.raw._numValor;
    } else if (type === 'date') {
      const rawKey = key === 'dataPagamento' ? '_rawDataPagamento' : '_rawDataEmpenho';
      va = a.raw[rawKey] || ''; vb = b.raw[rawKey] || '';
    } else {
      va = (a.raw[key] || '').toLowerCase(); vb = (b.raw[key] || '').toLowerCase();
    }
    if (va < vb) return -dir;
    if (va > vb) return dir;
    return 0;
  });
}

function updateQuarterButtonStates(f) {
  const base = subsetOf(f, { skipQuarter: true });
  for (const q of [1, 2, 3, 4]) {
    const qm = QUARTER_MONTHS[q];
    const hasNeg = base.some(r => {
      const m = parseInt((r.raw._rawDataPagamento || '').slice(5, 7), 10);
      return qm.includes(m) && r.raw._numValor < 0;
    });
    const btn = $(`btn-q${q}`);
    if (btn) btn.classList.toggle('has-neg', hasNeg);
  }
}

function extractYear(isoStr) {
  if (!isoStr) return null;
  const y = parseInt(isoStr.trim().slice(0, 4), 10);
  return isNaN(y) ? null : y;
}

function renderChart(rows, quarter) {
  const section = $('chart-section');
  const titleEl = section.querySelector('.chart-title');

  if (chartInstance) { chartInstance.destroy(); chartInstance = null; }
  if (typeof window.Chart === 'undefined' || !rows || rows.length === 0) {
    section.classList.add('chart-hidden');
    return;
  }

  const uniqueYears = [...new Set(
    rows.map(r => extractYear(r.raw._rawDataPagamento)).filter(y => y !== null)
  )].sort((a, b) => a - b);
  if (uniqueYears.length === 0) {
    section.classList.add('chart-hidden');
    return;
  }

  const singleYear = uniqueYears.length === 1;
  const qMonths    = quarter ? QUARTER_MONTHS[quarter] : null;
  let labels, posData, negData, hasNeg = false, chartType, titleText;

  if (singleYear) {
    const year = uniqueYears[0];
    chartType = 'bar';
    const posArr = new Array(12).fill(0);
    const negArr = new Array(12).fill(0);
    for (const r of rows) {
      const iso = r.raw._rawDataPagamento || '';
      const y = parseInt(iso.slice(0, 4), 10);
      const m = parseInt(iso.slice(5, 7), 10);
      if (isNaN(y) || isNaN(m) || y !== year) continue;
      const v = r.raw._numValor;
      if (v >= 0) posArr[m - 1] += v;
      else { negArr[m - 1] += v; hasNeg = true; }
    }
    if (qMonths) {
      const idxs = qMonths.map(m => m - 1);
      labels    = idxs.map(i => MONTH_LABELS[i]);
      posData   = idxs.map(i => posArr[i]);
      negData   = idxs.map(i => negArr[i]);
      titleText = `${QUARTER_NAMES[quarter]} — ${year}`;
    } else {
      labels    = MONTH_LABELS;
      posData   = posArr;
      negData   = negArr;
      titleText = `Pagamentos Mensais — ${year}`;
    }
  } else {
    chartType = 'line';
    const posMap = new Map();
    const negMap = new Map();
    for (const r of rows) {
      const year = extractYear(r.raw._rawDataPagamento);
      if (year === null) continue;
      const v = r.raw._numValor;
      if (v >= 0) posMap.set(year, (posMap.get(year) || 0) + v);
      else { negMap.set(year, (negMap.get(year) || 0) + v); hasNeg = true; }
    }
    labels    = uniqueYears.map(String);
    posData   = uniqueYears.map(y => posMap.get(y) || 0);
    negData   = uniqueYears.map(y => negMap.get(y) || 0);
    titleText = qMonths ? `${QUARTER_NAMES[quarter]} — Evolução por Ano` : 'Evolução de Pagamentos por Ano';
  }

  if (titleEl) titleEl.textContent = titleText;

  const fmtAbs = v => formatBRL(Math.abs(v));
  const cor = paletaGrafico();
  const datasets = [];

  if (singleYear) {
    datasets.push({
      label: 'Pagamentos', data: posData,
      backgroundColor: cor.posFill, borderColor: cor.posLine,
      borderWidth: 1, borderRadius: 3, borderSkipped: false,
    });
    if (hasNeg) datasets.push({
      label: 'Estornos / Devoluções', data: negData,
      backgroundColor: cor.negFill, borderColor: cor.negLine,
      borderWidth: 1, borderRadius: 3, borderSkipped: false,
    });
  } else {
    datasets.push({
      label: 'Pagamentos (positivos)', data: posData,
      borderColor: cor.posLine, backgroundColor: cor.posArea, pointBackgroundColor: cor.posLine,
      pointRadius: 5, pointHoverRadius: 7, tension: 0.3, fill: true,
    });
    if (hasNeg) datasets.push({
      label: 'Estornos / Devoluções (negativos)', data: negData,
      borderColor: cor.negLine, backgroundColor: 'transparent', pointBackgroundColor: cor.negLine,
      pointRadius: 5, pointHoverRadius: 7, borderDash: [6, 4], tension: 0.3, fill: false,
    });
  }

  chartInstance = new window.Chart($('payments-chart').getContext('2d'), {
    type: chartType,
    data: { labels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { position: 'top', labels: { color: cor.texto, font: { size: 11 } } },
        tooltip: {
          backgroundColor: cor.tipFundo, borderColor: cor.tipBorda, borderWidth: 1,
          titleColor: cor.tipTitulo, bodyColor: cor.tipCorpo,
          callbacks: {
            label: ctx => {
              const prefix = ctx.datasetIndex === 1 && hasNeg ? '− ' : '';
              return `  ${ctx.dataset.label}: ${prefix}${fmtAbs(ctx.parsed.y)}`;
            },
          },
        },
      },
      scales: {
        x: { grid: { color: cor.grade }, ticks: { color: cor.texto, font: { size: 11 } } },
        y: { grid: { color: cor.grade }, ticks: { color: cor.texto, font: { size: 11 }, callback: v => fmtAbs(v) } },
      },
    },
  });

  section.classList.remove('chart-hidden');
}

function renderSummary(summary) {
  const fmt = n => formatBRL(Math.abs(n));
  const negCard = summary.countN > 0 ? `
    <div class="card card--negativo">
      <div class="card-label">Total Negativo</div>
      <div class="card-value negative">− ${fmt(summary.totalN)}</div>
      <div class="card-sub">${formatInt(summary.countN)} registro(s) · estornos/devoluções</div>
    </div>` : '';

  $('summary-cards').innerHTML = `
    <div class="card card--total">
      <div class="card-label">Total de registros</div>
      <div class="card-value">${formatInt(summary.total)}</div>
      <div class="card-sub">Linhas carregadas do CSV</div>
    </div>
    <div class="card card--positivo">
      <div class="card-label">Valor Total</div>
      <div class="card-value positive">${fmt(summary.totalP)}</div>
      <div class="card-sub">${formatInt(summary.countP)} registro(s)</div>
    </div>
    ${negCard}
  `;
}

function renderTableHeader() {
  $('table-head').innerHTML = '<tr>' + COLUMNS.map(col => {
    const sortable = col.key === 'valor';
    const isNdoc   = col.key === 'NumeroDocumento';
    let cls = '';
    if (sortable && sortKey === col.key) cls = sortDir === 1 ? 'sort-asc' : 'sort-desc';
    if (isNdoc) cls = (cls ? cls + ' ' : '') + 'th-ndoc';
    const attrs = sortable ? `class="${cls}" data-key="${col.key}"` : `class="${cls || 'no-sort'}"`;
    const copyBtn = isNdoc
      ? ` <button class="btn-copy-ndoc" type="button" title="Copiar lista completa de Nº Documento (${filteredRows.length} registros)">⎘</button>`
      : '';
    return `<th ${attrs}>${col.label}${copyBtn}</th>`;
  }).join('') + '</tr>';
}

function renderTable() {
  const tbody = $('table-body');
  const start = (currentPage - 1) * PAGE_SIZE;
  const slice = filteredRows.slice(start, start + PAGE_SIZE);

  if (slice.length === 0) {
    tbody.innerHTML = `<tr><td colspan="${COLUMNS.length}" class="state-empty">Nenhum registro encontrado.</td></tr>`;
    return;
  }

  tbody.innerHTML = slice.map(row => {
    const neg = row.raw._numValor < 0;
    const cells = COLUMNS.map(col => {
      if (col.key === 'valor') {
        return `<td class="col-valor ${neg ? 'valor-negativo' : 'valor-positivo'}">${escapeHtml(row.display.valor)}</td>`;
      }
      if (col.type === 'date') return `<td class="col-nowrap">${escapeHtml(row.display[col.key] || '')}</td>`;
      return `<td>${escapeHtml(row.display[col.key] || '')}</td>`;
    }).join('');
    return `<tr class="${neg ? 'row-negativo' : 'row-positivo'}">${cells}</tr>`;
  }).join('');
}

function copyNdocList(btn) {
  const values = [...new Set(filteredRows.map(r => (r.raw.NumeroDocumento || '').trim()).filter(Boolean))];
  if (values.length === 0) return;
  navigator.clipboard.writeText(values.join('\n')).then(() => {
    const orig = btn.textContent;
    btn.textContent = '✓';
    btn.classList.add('copied');
    setTimeout(() => { btn.textContent = orig; btn.classList.remove('copied'); }, 1500);
  });
}

function renderPagination() {
  const total      = filteredRows.length;
  const totalPages = Math.ceil(total / PAGE_SIZE) || 1;
  const start = total === 0 ? 0 : (currentPage - 1) * PAGE_SIZE + 1;
  const end   = Math.min(currentPage * PAGE_SIZE, total);
  const info  = `Mostrando ${start}–${end} de ${formatInt(total)} registros`;
  const page  = `Página ${currentPage} de ${totalPages}`;
  for (const pos of ['top', 'bot']) {
    $(`table-info-${pos}`).textContent     = info;
    $(`page-indicator-${pos}`).textContent = page;
    $(`btn-prev-${pos}`).disabled = currentPage <= 1;
    $(`btn-next-${pos}`).disabled = currentPage >= totalPages;
  }
}

function render() {
  renderTableHeader();
  renderTable();
  renderPagination();
}

function handleSort(key) {
  if (sortKey === key) sortDir = -sortDir;
  else { sortKey = key; sortDir = 1; }
  applyFiltersAndSort();
}

function handlePageChange(delta) {
  const totalPages = Math.ceil(filteredRows.length / PAGE_SIZE) || 1;
  currentPage = Math.max(1, Math.min(currentPage + delta, totalPages));
  render();
  $('analysis-area').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

export function resetDespesas() {
  allRows = [];
  filteredRows = [];
  sortKey = null;
  sortDir = 1;
  currentPage = 1;
  loadedFileNames = [];
  seenKeys.clear();

  if (chartInstance) { chartInstance.destroy(); chartInstance = null; }
  selectedQuarter = null;
  prazoAbsMin = null;
  prazoAbsMax = null;
  document.querySelectorAll('.btn-quarter').forEach(b => b.classList.remove('active', 'has-neg'));
  $('prazo-slider-widget').setAttribute('aria-disabled', 'true');
  $('range-prazo-val-min').textContent = '—';
  $('range-prazo-val-max').textContent = '—';
  $('range-prazo-caption').textContent = 'Carregue um arquivo para ativar';
  $('range-prazo-caption').classList.remove('range-caption--active');
  $('range-prazo-fill').style.left  = '0%';
  $('range-prazo-fill').style.right = '0%';
  $('chart-section').classList.add('chart-hidden');

  $('filter-credor').value = '';
  $('filter-municipio').innerHTML = '<option value="">Todos</option>';
  $('filter-field-municipio').hidden = true;
  $('filter-fonte').innerHTML    = '<option value="">Todas</option>';
  $('filter-orgao').innerHTML    = '<option value="">Todos</option>';
  $('filter-unidade').innerHTML  = '<option value="">Todas</option>';
  $('filter-elemento').innerHTML = '<option value="">Todos</option>';
  $('filter-data-ano').innerHTML = '<option value="">Ano...</option>';
  $('filter-data-de').innerHTML  = '<option value="">De...</option>';
  $('filter-data-ate').innerHTML = '<option value="">Até...</option>';
  $('filter-status').textContent = '';
  $('filter-status').classList.remove('active');

  hideUploadError();
  $('analysis-area').classList.remove('visible');
  $('upload-section').style.display = '';
  $('csv-input').value = '';
}

export function redrawDespesasChart() {
  if (chartInstance) renderChart(filteredRows, selectedQuarter);
}

export function initDespesas() {
  const zone  = $('drop-zone');
  const input = $('csv-input');

  zone.addEventListener('click', () => input.click());
  zone.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); }
  });
  ['dragenter', 'dragover'].forEach(evt =>
    zone.addEventListener(evt, e => { e.preventDefault(); zone.classList.add('drag-over'); })
  );
  ['dragleave', 'drop'].forEach(evt =>
    zone.addEventListener(evt, e => { e.preventDefault(); zone.classList.remove('drag-over'); })
  );
  zone.addEventListener('drop', e => {
    if (e.dataTransfer.files.length) processFileList(e.dataTransfer.files);
  });
  input.addEventListener('change', () => {
    if (input.files.length) {
      processFileList(input.files);
      input.value = '';
    }
  });

  $('btn-reset').addEventListener('click', () => {
    resetDespesas();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });
  $('btn-add-file').addEventListener('click', () => input.click());

  $('table-head').addEventListener('click', e => {
    const copy = e.target.closest('.btn-copy-ndoc');
    if (copy) { e.stopPropagation(); copyNdocList(copy); return; }
    const th = e.target.closest('th[data-key]');
    if (th) handleSort(th.dataset.key);
  });

  $('filter-credor').addEventListener('input', () => applyFiltersAndSort());
  ['filter-municipio', 'filter-fonte', 'filter-orgao', 'filter-unidade', 'filter-elemento',
   'filter-data-de', 'filter-data-ate']
    .forEach(id => $(id).addEventListener('change', () => applyFiltersAndSort()));
  $('filter-data-ano').addEventListener('change', () => {
    $('filter-data-de').value  = '';
    $('filter-data-ate').value = '';
    populateDateSelects();
    applyFiltersAndSort();
  });
  $('btn-clear-filters').addEventListener('click', clearFilters);

  for (const id of ['range-prazo-min', 'range-prazo-max']) {
    $(id).addEventListener('input', () => {
      const sMin = $('range-prazo-min');
      const sMax = $('range-prazo-max');
      if (parseInt(sMin.value, 10) > parseInt(sMax.value, 10)) {
        if (id === 'range-prazo-min') sMin.value = sMax.value;
        else sMax.value = sMin.value;
      }
      updatePrazoDisplay();
      applyFiltersAndSort({ skipPrazoRangeUpdate: true });
    });
  }

  document.querySelectorAll('.btn-quarter').forEach(btn => {
    btn.addEventListener('click', () => {
      const q = parseInt(btn.dataset.q, 10);
      selectedQuarter = selectedQuarter === q ? null : q;
      document.querySelectorAll('.btn-quarter').forEach(b => b.classList.remove('active'));
      if (selectedQuarter) $(`btn-q${selectedQuarter}`).classList.add('active');
      applyFiltersAndSort();
    });
  });

  $('btn-prev-top').addEventListener('click', () => handlePageChange(-1));
  $('btn-next-top').addEventListener('click', () => handlePageChange(+1));
  $('btn-prev-bot').addEventListener('click', () => handlePageChange(-1));
  $('btn-next-bot').addEventListener('click', () => handlePageChange(+1));
}
