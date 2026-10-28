import { formatBRL } from '../core/format.js';

const COMPACT = new Intl.NumberFormat('pt-BR', {
  style: 'currency', currency: 'BRL', notation: 'compact', maximumFractionDigits: 1,
});
const INT = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 });
const PCT = new Intl.NumberFormat('pt-BR', { style: 'percent', maximumFractionDigits: 1 });

export const fmt = {
  brl: v => formatBRL(v),
  brlCompact: v => COMPACT.format(v),
  int: v => INT.format(v),
  pct: v => PCT.format(v),
};

function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

export function tema() {
  return {
    series: [1, 2, 3, 4, 5, 6, 7, 8].map(i => cssVar(`--series-${i}`)),
    other : cssVar('--series-other'),
    text  : cssVar('--chart-text'),
    grid  : cssVar('--chart-grid'),
    surface: cssVar('--bg-1'),
    ink   : cssVar('--text-0'),
    border: cssVar('--border'),
  };
}

export const COR_COMPONENTE = { base: 0, vantagens: 1, gratificacao: 2, decimo: 3, liquido: 6, vencimentos: 0 };

export function opcoes({ valor = 'brl', horizontal = false, empilhado = false, legenda = true } = {}) {
  const t = tema();
  const fmtEixo = valor === 'brl' ? fmt.brlCompact : valor === 'pct' ? fmt.pct : fmt.int;
  const fmtTip  = valor === 'brl' ? fmt.brl : valor === 'pct' ? fmt.pct : fmt.int;
  const valorAxis = {
    stacked: empilhado,
    beginAtZero: true,
    grid: { color: t.grid, drawTicks: false },
    border: { display: false },
    ticks: { color: t.text, font: { size: 11 }, padding: 6, callback: v => fmtEixo(v) },
  };
  const catAxis = {
    stacked: empilhado,
    grid: { display: false },
    border: { color: t.grid },
    ticks: { color: t.text, font: { size: 11 }, autoSkip: true, maxRotation: 0 },
  };
  return {
    responsive: true,
    maintainAspectRatio: false,
    indexAxis: horizontal ? 'y' : 'x',
    interaction: { mode: 'index', intersect: false, axis: horizontal ? 'y' : 'x' },
    animation: { duration: 250 },
    plugins: {
      legend: {
        display: legenda,
        position: 'top',
        align: 'start',
        labels: { color: t.text, boxWidth: 10, boxHeight: 10, useBorderRadius: true, borderRadius: 2, font: { size: 11 } },
      },
      tooltip: {
        backgroundColor: t.surface,
        borderColor: t.border,
        borderWidth: 1,
        titleColor: t.ink,
        bodyColor: t.ink,
        padding: 10,
        boxPadding: 4,
        callbacks: {
          label: ctx => {
            const v = horizontal ? ctx.parsed.x : ctx.parsed.y;
            return ` ${ctx.dataset.label}: ${fmtTip(v)}`;
          },
        },
      },
    },
    scales: horizontal ? { x: valorAxis, y: catAxis } : { x: catAxis, y: valorAxis },
  };
}

export function barras(label, data, cor, extra = {}) {
  return {
    label, data,
    backgroundColor: cor,
    borderColor: tema().surface,
    borderWidth: { top: 0, right: 0, bottom: 0, left: 0 },
    borderRadius: 4,
    borderSkipped: 'start',
    maxBarThickness: 34,
    categoryPercentage: 0.8,
    barPercentage: 0.9,
    ...extra,
  };
}

export function linha(label, data, cor, extra = {}) {
  return {
    label, data,
    borderColor: cor,
    backgroundColor: cor,
    borderWidth: 2,
    pointRadius: 4,
    pointHoverRadius: 6,
    pointBorderColor: tema().surface,
    pointBorderWidth: 2,
    tension: 0.25,
    ...extra,
  };
}

export function criar(canvas, config) {
  if (typeof window.Chart === 'undefined' || !canvas) return null;
  return new window.Chart(canvas.getContext('2d'), config);
}
