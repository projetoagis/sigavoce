import { escapeHtml } from '../core/format.js';
import {
  COMPONENTES, porRegime, seriePorPeriodo, regimePorPeriodo, resumoGeral,
  cargoKey, quantil, rotuloPeriodo,
} from '../core/folha-analise.js';
import { fmt, tema, opcoes, barras, linha, criar, COR_COMPONENTE } from './charts.js';
import { downloadCSV, numCSV } from './download.js';

const $ = id => document.getElementById(id);

const kpi = (label, value, sub = '') => `
  <div class="kpi">
    <div class="kpi-label">${escapeHtml(label)}</div>
    <div class="kpi-value">${value}</div>
    ${sub ? `<div class="kpi-sub">${sub}</div>` : ''}
  </div>`;

const fig = (id, title, sub, { wide = false, tall = false } = {}) => `
  <figure class="fig${wide ? ' fig--wide' : ''}">
    <div class="fig-title">${escapeHtml(title)}</div>
    <div class="fig-sub">${sub}</div>
    <div class="fig-canvas${tall ? ' fig-canvas--tall' : ''}"><canvas id="${id}" role="img" aria-label="${escapeHtml(title)}"></canvas></div>
  </figure>`;

function tabela(heads, rows, numCols = new Set(), totalRow = null) {
  const td = (c, i) => {
    const isObj = c && typeof c === 'object';
    const cls = [numCols.has(i) ? 'num' : '', isObj && c.cls ? c.cls : ''].filter(Boolean).join(' ');
    return `<td${cls ? ` class="${cls}"` : ''}>${isObj ? c.html : escapeHtml(c)}</td>`;
  };
  return `
    <div class="report-table"><table class="dtable">
      <thead><tr>${heads.map((h, i) => `<th${numCols.has(i) ? ' class="num"' : ''}>${escapeHtml(h)}</th>`).join('')}</tr></thead>
      <tbody>
        ${rows.map(r => `<tr>${r.map(td).join('')}</tr>`).join('')}
        ${totalRow ? `<tr class="total">${totalRow.map(td).join('')}</tr>` : ''}
      </tbody>
    </table></div>`;
}

const sw = cor => `<span class="swatch" style="background:${cor}"></span>`;

function relRegime(ctx, modo) {
  const t = tema();
  const reg = porRegime(ctx.recs);
  const geral = resumoGeral(ctx.recs);
  const corDe = r => ctx.cor(r.regime);
  if (!reg.length) return vazio('Tipo de Regime');

  const maiorMedia = [...reg].sort((a, b) => b.mediaLiquido - a.mediaLiquido)[0];
  const multi = geral.periodos.length > 1;

  const charts = [
    {
      id: 'rg-matr',
      config: {
        type: 'bar',
        data: { labels: reg.map(r => r.regime), datasets: [barras('Matrículas distintas', reg.map(r => r.matriculas), reg.map(corDe))] },
        options: opcoes({ valor: 'int', horizontal: true, legenda: false }),
      },
    },
    {
      id: 'rg-media',
      config: {
        type: 'bar',
        data: { labels: reg.map(r => r.regime), datasets: [barras('Média do líquido por servidor/mês', reg.map(r => r.mediaLiquido), reg.map(corDe))] },
        options: opcoes({ valor: 'brl', horizontal: true, legenda: false }),
      },
    },
    {
      id: 'rg-comp',
      config: {
        type: 'bar',
        data: {
          labels: reg.map(r => r.regime),
          datasets: COMPONENTES.filter(c => c.key !== 'decimo').map(c =>
            barras(c.label, reg.map(r => r.totals[c.key]), t.series[COR_COMPONENTE[c.key]])),
        },
        options: opcoes({ valor: 'brl', horizontal: true, empilhado: true }),
      },
    },
  ];

  let evolucao = '';
  if (multi) {
    const rp = regimePorPeriodo(ctx.recs, modo);
    charts.push({
      id: 'rg-tempo',
      config: {
        type: 'line',
        data: {
          labels: rp.periodos.map(rotuloPeriodo),
          datasets: rp.regimes.map((g, i) => linha(g, rp.valores[i], ctx.cor(g))),
        },
        options: opcoes({ valor: 'int' }),
      },
    });
    evolucao = fig('rg-tempo', 'Matrículas por tipo de regime ao longo do tempo',
      modo === 'ano' ? 'Média mensal de matrículas distintas em cada ano' : 'Matrículas distintas em cada competência',
      { wide: true });
  }

  const heads = ['Tipo de regime', 'Matrículas', '% matrículas', 'Registros', 'Salário base', 'Vantagens',
    'Gratificação', '13º salário', 'Total vencimentos', 'Salário líquido', 'Média líquida', 'Mediana líquida'];
  const rows = reg.map(r => [
    { html: sw(corDe(r)) + escapeHtml(r.regime) },
    fmt.int(r.matriculas), fmt.pct(r.share), fmt.int(r.registros),
    fmt.brl(r.totals.base), fmt.brl(r.totals.vantagens), fmt.brl(r.totals.gratificacao), fmt.brl(r.totals.decimo),
    fmt.brl(r.totals.vencimentos), fmt.brl(r.totals.liquido), fmt.brl(r.mediaLiquido), fmt.brl(r.medianaLiquido),
  ]);
  const total = ['Total', fmt.int(geral.matriculas), '100%', fmt.int(geral.registros),
    fmt.brl(geral.totals.base), fmt.brl(geral.totals.vantagens), fmt.brl(geral.totals.gratificacao), fmt.brl(geral.totals.decimo),
    fmt.brl(geral.totals.vencimentos), fmt.brl(geral.totals.liquido), fmt.brl(geral.mediaLiquido), ''];

  return {
    titulo: 'Quadro por Tipo de Regime',
    modos: multi,
    html: `
      <div class="report-kpis">
        ${kpi('Tipos de regime', fmt.int(reg.length))}
        ${kpi('Matrículas distintas', fmt.int(geral.matriculas), `${fmt.int(geral.registros)} registros (servidor × competência)`)}
        ${kpi('Regime predominante', escapeHtml(reg[0].regime), `<strong>${fmt.pct(reg[0].share)}</strong> das matrículas`)}
        ${kpi('Maior média líquida', fmt.brl(maiorMedia.mediaLiquido), escapeHtml(maiorMedia.regime))}
      </div>
      <div class="report-grid">
        ${fig('rg-matr', 'Matrículas distintas por tipo de regime', 'Quantidade de matrículas únicas em cada vínculo')}
        ${fig('rg-media', 'Salário líquido médio', 'Média por servidor em cada competência')}
        ${fig('rg-comp', 'Composição dos vencimentos por regime', 'Soma de Salário base, Vantagens e Gratificação', { wide: true })}
        ${evolucao}
      </div>
      <div class="report-section">Detalhamento</div>
      ${tabela(heads, rows, new Set([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]), total)}
      <p class="report-text">Matrículas distintas consideram unidade + matrícula. "Registros" contam uma linha por servidor em cada competência; médias e medianas são calculadas por registro.</p>`,
    charts,
    csv: {
      nome: 'relatorio-tipo-regime.csv',
      headers: heads,
      rows: reg.map(r => [r.regime, r.matriculas, numCSV(r.share * 100, 1), r.registros,
        numCSV(r.totals.base), numCSV(r.totals.vantagens), numCSV(r.totals.gratificacao), numCSV(r.totals.decimo),
        numCSV(r.totals.vencimentos), numCSV(r.totals.liquido), numCSV(r.mediaLiquido), numCSV(r.medianaLiquido)]),
    },
  };
}

function relComposicao(ctx, modo) {
  const t = tema();
  const geral = resumoGeral(ctx.recs);
  if (!geral.registros) return vazio('Composição Salarial');
  const venc = geral.totals.vencimentos || 1;
  const reg = porRegime(ctx.recs);
  const multi = geral.periodos.length > 1;

  const comComp = c => ctx.recs.filter(r => r[c.key] > 0).length;
  const charts = [
    {
      id: 'cp-tot',
      config: {
        type: 'bar',
        data: {
          labels: COMPONENTES.map(c => c.label),
          datasets: [barras('Total', COMPONENTES.map(c => geral.totals[c.key]), COMPONENTES.map(c => t.series[COR_COMPONENTE[c.key]]))],
        },
        options: opcoes({ valor: 'brl', horizontal: true, legenda: false }),
      },
    },
    {
      id: 'cp-reg',
      config: {
        type: 'bar',
        data: {
          labels: reg.map(r => r.regime),
          datasets: COMPONENTES.filter(c => c.key !== 'decimo').map(c =>
            barras(c.label, reg.map(r => (r.totals.vencimentos ? r.totals[c.key] / r.totals.vencimentos : 0)), t.series[COR_COMPONENTE[c.key]])),
        },
        options: (() => {
          const o = opcoes({ valor: 'pct', horizontal: true, empilhado: true });
          o.scales.x.max = 1;
          return o;
        })(),
      },
    },
  ];

  let tempo = '';
  if (multi) {
    const serie = seriePorPeriodo(ctx.recs, modo);
    charts.push({
      id: 'cp-tempo',
      config: {
        type: 'bar',
        data: {
          labels: serie.map(s => s.rotulo),
          datasets: COMPONENTES.filter(c => c.key !== 'decimo').map(c =>
            barras(c.label, serie.map(s => s.totals[c.key]), t.series[COR_COMPONENTE[c.key]])),
        },
        options: opcoes({ valor: 'brl', empilhado: true }),
      },
    });
    tempo = fig('cp-tempo', 'Composição dos vencimentos ao longo do tempo',
      modo === 'ano' ? 'Soma dos meses carregados em cada ano' : 'Por competência', { wide: true });
  }

  const heads = ['Componente', 'Total', '% dos vencimentos', 'Média por servidor/mês', 'Registros com valor', '% dos registros'];
  const rows = COMPONENTES.map(c => [
    { html: sw(t.series[COR_COMPONENTE[c.key]]) + escapeHtml(c.label) },
    fmt.brl(geral.totals[c.key]),
    c.key === 'decimo' ? { html: '<span class="muted">fora do total</span>' } : fmt.pct(geral.totals[c.key] / venc),
    fmt.brl(geral.totals[c.key] / geral.registros),
    fmt.int(comComp(c)),
    fmt.pct(comComp(c) / geral.registros),
  ]);

  return {
    titulo: 'Composição Salarial',
    modos: multi,
    html: `
      <div class="report-kpis">
        ${kpi('Total de vencimentos', fmt.brl(geral.totals.vencimentos), 'Base + Vantagens + Gratificação')}
        ${COMPONENTES.filter(c => c.key !== 'decimo').map(c =>
          kpi(c.label, fmt.brl(geral.totals[c.key]), `<strong>${fmt.pct(geral.totals[c.key] / venc)}</strong> dos vencimentos`)).join('')}
        ${kpi('Salário líquido', fmt.brl(geral.totals.liquido), `${fmt.pct(geral.totals.liquido / venc)} do total de vencimentos`)}
      </div>
      <div class="report-grid">
        ${fig('cp-tot', 'Total por componente', 'Soma no recorte selecionado')}
        ${fig('cp-reg', 'Peso de cada componente por regime', 'Participação no total de vencimentos de cada vínculo')}
        ${tempo}
      </div>
      <div class="report-section">Detalhamento</div>
      ${tabela(heads, rows, new Set([1, 2, 3, 4, 5]))}
      <p class="report-text">O "Total de vencimentos" segue a definição do TCM-BA no rodapé da planilha: Salário base + Vantagens + Gratificação. O 13º salário é informado à parte.</p>`,
    charts,
    csv: {
      nome: 'relatorio-composicao-salarial.csv',
      headers: heads,
      rows: COMPONENTES.map(c => [c.label, numCSV(geral.totals[c.key]),
        c.key === 'decimo' ? '' : numCSV(geral.totals[c.key] / venc * 100, 1),
        numCSV(geral.totals[c.key] / geral.registros), comComp(c), numCSV(comComp(c) / geral.registros * 100, 1)]),
    },
  };
}

function relEvolucao(ctx, modo) {
  const t = tema();
  const serie = seriePorPeriodo(ctx.recs, modo);
  if (serie.length < 2 && modo === 'mes') return vazio('Evolução', 'Carregue planilhas de duas ou mais competências para ver a evolução.');
  const prim = serie[0], ult = serie[serie.length - 1];
  const varPct = (a, b) => (a ? (b - a) / a : 0);
  const sinal = v => (v > 0 ? '+' : '') + fmt.pct(v);
  const matr = s => (modo === 'ano' ? s.mediaMensalMatriculas : s.matriculas);

  const charts = [
    {
      id: 'ev-tot',
      config: {
        type: 'line',
        data: {
          labels: serie.map(s => s.rotulo),
          datasets: [
            linha('Total de vencimentos', serie.map(s => s.totals.vencimentos), t.series[COR_COMPONENTE.vencimentos]),
            linha('Salário líquido', serie.map(s => s.totals.liquido), t.series[COR_COMPONENTE.liquido]),
          ],
        },
        options: opcoes({ valor: 'brl' }),
      },
    },
    {
      id: 'ev-matr',
      config: {
        type: 'bar',
        data: { labels: serie.map(s => s.rotulo), datasets: [barras(modo === 'ano' ? 'Média mensal de matrículas' : 'Matrículas distintas', serie.map(matr), t.series[0])] },
        options: opcoes({ valor: 'int', legenda: false }),
      },
    },
    {
      id: 'ev-media',
      config: {
        type: 'bar',
        data: { labels: serie.map(s => s.rotulo), datasets: [barras('Líquido médio por servidor/mês', serie.map(s => s.totals.liquido / s.registros), t.series[COR_COMPONENTE.liquido])] },
        options: opcoes({ valor: 'brl', legenda: false }),
      },
    },
  ];

  const heads = ['Período', 'Meses', modo === 'ano' ? 'Matrículas (média mensal)' : 'Matrículas', 'Salário base', 'Vantagens',
    'Gratificação', '13º salário', 'Total vencimentos', 'Salário líquido', 'Líquido médio'];
  const rows = serie.map(s => [
    s.rotulo + (modo === 'ano' && s.meses < 12 ? ` (${s.meses} ${s.meses === 1 ? 'mês' : 'meses'})` : ''),
    fmt.int(s.meses), fmt.int(matr(s)),
    fmt.brl(s.totals.base), fmt.brl(s.totals.vantagens), fmt.brl(s.totals.gratificacao), fmt.brl(s.totals.decimo),
    fmt.brl(s.totals.vencimentos), fmt.brl(s.totals.liquido), fmt.brl(s.totals.liquido / s.registros),
  ]);

  return {
    titulo: modo === 'ano' ? 'Evolução Anual' : 'Evolução por Competência',
    modos: true,
    html: `
      <div class="report-kpis">
        ${kpi('Períodos', fmt.int(serie.length), `${prim.rotulo} a ${ult.rotulo}`)}
        ${kpi('Total de vencimentos', fmt.brl(ult.totals.vencimentos), serie.length > 1 ? `${sinal(varPct(prim.totals.vencimentos, ult.totals.vencimentos))} desde ${prim.rotulo}` : ult.rotulo)}
        ${kpi('Matrículas', fmt.int(matr(ult)), serie.length > 1 ? `${sinal(varPct(matr(prim), matr(ult)))} desde ${prim.rotulo}` : ult.rotulo)}
        ${kpi('Líquido médio', fmt.brl(ult.totals.liquido / ult.registros), serie.length > 1 ? `${sinal(varPct(prim.totals.liquido / prim.registros, ult.totals.liquido / ult.registros))} desde ${prim.rotulo}` : ult.rotulo)}
      </div>
      ${modo === 'ano' && serie.some(s => s.meses < 12) ? '<p class="report-text"><strong>Atenção:</strong> anos com menos de 12 competências carregadas aparecem como parciais; os totais somam apenas os meses disponíveis.</p>' : ''}
      <div class="report-grid">
        ${fig('ev-tot', 'Total de vencimentos e salário líquido', modo === 'ano' ? 'Soma dos meses de cada ano' : 'Por competência', { wide: true })}
        ${fig('ev-matr', modo === 'ano' ? 'Matrículas (média mensal)' : 'Matrículas distintas', 'Quantidade de servidores na folha')}
        ${fig('ev-media', 'Salário líquido médio', 'Por servidor em cada competência')}
      </div>
      <div class="report-section">Detalhamento</div>
      ${tabela(heads, rows, new Set([1, 2, 3, 4, 5, 6, 7, 8, 9]))}`,
    charts,
    csv: {
      nome: `relatorio-evolucao-${modo === 'ano' ? 'anual' : 'mensal'}.csv`,
      headers: heads,
      rows: serie.map(s => [s.rotulo, s.meses, numCSV(matr(s), modo === 'ano' ? 1 : 0),
        numCSV(s.totals.base), numCSV(s.totals.vantagens), numCSV(s.totals.gratificacao), numCSV(s.totals.decimo),
        numCSV(s.totals.vencimentos), numCSV(s.totals.liquido), numCSV(s.totals.liquido / s.registros)]),
    },
  };
}

function relReceita(ctx, modo) {
  const t = tema();
  let q = ctx.quadro;
  if (!q.length) return vazio('Receita Corrente Líquida e Folha');
  const multiUni = new Set(q.map(r => r.unidade)).size > 1;

  if (modo === 'ano') {
    const m = new Map();
    for (const r of q) {
      const k = r.unidade + '\x00' + r.periodo.slice(0, 4);
      const g = m.get(k) || { unidade: r.unidade, periodo: r.periodo.slice(0, 4), meses: 0, totalVencimentos: 0, rclMensal: 0, temRcl: true };
      g.meses++;
      g.totalVencimentos += r.totalVencimentos ?? r.vencimentosCalculado;
      if (r.rclMensal == null) g.temRcl = false; else g.rclMensal += r.rclMensal;
      m.set(k, g);
    }
    q = [...m.values()].map(g => ({ ...g, competencia: g.periodo, folhaSobreRcl: g.temRcl && g.rclMensal ? g.totalVencimentos / g.rclMensal : null }));
  }

  const rotulo = r => (modo === 'ano' ? r.periodo : rotuloPeriodo(r.periodo)) + (multiUni ? ` · ${r.unidade}` : '');
  const ult = q[q.length - 1];
  const temRcl = q.some(r => r.rclMensal);

  const charts = [
    {
      id: 'rc-bar',
      config: {
        type: 'bar',
        data: {
          labels: q.map(rotulo),
          datasets: [
            barras(modo === 'ano' ? 'RCL (soma dos meses)' : 'RCL mensal', q.map(r => r.rclMensal), t.other),
            barras('Total de vencimentos', q.map(r => r.totalVencimentos ?? r.vencimentosCalculado), t.series[0]),
          ],
        },
        options: opcoes({ valor: 'brl' }),
      },
    },
    {
      id: 'rc-pct',
      config: {
        type: q.length > 1 ? 'line' : 'bar',
        data: { labels: q.map(rotulo), datasets: [(q.length > 1 ? linha : barras)('Vencimentos ÷ RCL', q.map(r => r.folhaSobreRcl), t.series[1])] },
        options: opcoes({ valor: 'pct', legenda: false }),
      },
    },
  ];

  const conf = r => r.confere == null
    ? { html: '<span class="muted">—</span>' }
    : r.confere ? { html: '<span class="badge badge--ok">✓ confere</span>' } : { html: '<span class="badge badge--crit">✗ diverge</span>' };

  const heads = modo === 'ano'
    ? ['Unidade', 'Ano', 'Meses', 'Total vencimentos', 'RCL (soma dos meses)', 'Vencimentos ÷ RCL']
    : ['Unidade', 'Competência', 'Pessoas (declarado)', 'Total vencimentos (declarado)', 'Calculado (base+vant.+grat.)', 'Conferência', 'RCL mensal', 'Vencimentos ÷ RCL', 'RCL 12 meses', 'Período da RCL 12 meses'];
  const rows = modo === 'ano'
    ? q.map(r => [r.unidade, r.periodo, fmt.int(r.meses), fmt.brl(r.totalVencimentos), r.temRcl ? fmt.brl(r.rclMensal) : '—', r.folhaSobreRcl == null ? '—' : fmt.pct(r.folhaSobreRcl)])
    : q.map(r => [r.unidade, r.competencia, r.pessoasDeclaradas == null ? '—' : fmt.int(r.pessoasDeclaradas),
      r.totalVencimentos == null ? '—' : fmt.brl(r.totalVencimentos), fmt.brl(r.vencimentosCalculado), conf(r),
      r.rclMensal == null ? '—' : fmt.brl(r.rclMensal), r.folhaSobreRcl == null ? '—' : fmt.pct(r.folhaSobreRcl),
      r.rcl12m == null ? '—' : fmt.brl(r.rcl12m), { html: escapeHtml(r.rcl12mPeriodo || '—'), cls: 'wrap' }]);

  return {
    titulo: 'Receita Corrente Líquida × Folha',
    modos: new Set(ctx.quadro.map(r => r.periodo)).size > 1,
    html: `
      <div class="report-kpis">
        ${kpi(modo === 'ano' ? 'RCL (soma dos meses)' : 'RCL mensal', ult.rclMensal ? fmt.brl(ult.rclMensal) : '—', rotulo(ult))}
        ${kpi('Total de vencimentos', fmt.brl(ult.totalVencimentos ?? ult.vencimentosCalculado), rotulo(ult))}
        ${kpi('Vencimentos ÷ RCL', ult.folhaSobreRcl == null ? '—' : fmt.pct(ult.folhaSobreRcl), rotulo(ult))}
        ${modo === 'mes' && ult.rcl12m ? kpi('RCL 12 meses', fmt.brl(ult.rcl12m), escapeHtml(ult.rcl12mPeriodo)) : ''}
      </div>
      ${temRcl ? '' : '<p class="report-text">As planilhas carregadas não trazem a Receita Corrente Líquida no rodapé.</p>'}
      <div class="report-grid">
        ${fig('rc-bar', 'Receita Corrente Líquida e total de vencimentos', 'Valores declarados no rodapé das planilhas do TCM-BA')}
        ${fig('rc-pct', 'Vencimentos em relação à RCL', 'Total de vencimentos ÷ RCL do mesmo período')}
      </div>
      <div class="report-section">Dados declarados por planilha</div>
      ${tabela(heads, rows, new Set(modo === 'ano' ? [2, 3, 4, 5] : [2, 3, 4, 6, 7, 8]))}
      <p class="report-text"><strong>Como ler:</strong> "Vencimentos ÷ RCL" é um indicador simples do peso da folha nominal sobre a receita do mesmo período.
      Ele <strong>não equivale</strong> ao limite de despesa com pessoal da Lei de Responsabilidade Fiscal, que considera 12 meses, encargos e outras parcelas.
      A coluna "Conferência" compara o total declarado pelo TCM-BA com a soma calculada a partir das linhas da planilha.</p>`,
    charts,
    csv: {
      nome: `relatorio-receita-folha-${modo === 'ano' ? 'anual' : 'mensal'}.csv`,
      headers: heads,
      rows: modo === 'ano'
        ? q.map(r => [r.unidade, r.periodo, r.meses, numCSV(r.totalVencimentos), r.temRcl ? numCSV(r.rclMensal) : '', r.folhaSobreRcl == null ? '' : numCSV(r.folhaSobreRcl * 100, 2)])
        : q.map(r => [r.unidade, r.competencia, r.pessoasDeclaradas ?? '', numCSV(r.totalVencimentos), numCSV(r.vencimentosCalculado),
          r.confere == null ? '' : r.confere ? 'confere' : 'diverge', numCSV(r.rclMensal), r.folhaSobreRcl == null ? '' : numCSV(r.folhaSobreRcl * 100, 2),
          numCSV(r.rcl12m), r.rcl12mPeriodo]),
    },
  };
}

function relCargos(ctx) {
  const t = tema();
  const m = new Map();
  for (const r of ctx.recs) {
    const k = cargoKey(r.cargo);
    let g = m.get(k);
    if (!g) {
      g = { cargo: ctx.cargos.display.get(k) || r.cargo || '(sem cargo)', grafias: new Set(), pessoas: new Set(), regimes: new Set(), registros: 0, venc: 0, liq: [], };
      m.set(k, g);
    }
    g.grafias.add(r.cargo);
    g.pessoas.add(r.pessoaKey);
    g.regimes.add(r.regime);
    g.registros++;
    g.venc += r.vencimentos;
    g.liq.push(r.liquido);
  }
  const cargos = [...m.values()].map(g => {
    const s = g.liq.sort((a, b) => a - b);
    return {
      ...g,
      matriculas: g.pessoas.size,
      mediaVenc: g.venc / g.registros,
      mediaLiq: s.reduce((a, b) => a + b, 0) / s.length,
      medianaLiq: quantil(s, 0.5),
    };
  }).sort((a, b) => b.matriculas - a.matriculas);
  if (!cargos.length) return vazio('Cargos');

  const top = cargos.slice(0, 15);
  const topMedia = cargos.filter(c => c.matriculas >= 3).sort((a, b) => b.mediaVenc - a.mediaVenc).slice(0, 15);

  const charts = [
    {
      id: 'cg-matr',
      config: {
        type: 'bar',
        data: { labels: top.map(c => c.cargo), datasets: [barras('Matrículas distintas', top.map(c => c.matriculas), t.series[0])] },
        options: opcoes({ valor: 'int', horizontal: true, legenda: false }),
      },
    },
    {
      id: 'cg-media',
      config: {
        type: 'bar',
        data: { labels: topMedia.map(c => c.cargo), datasets: [barras('Média de vencimentos por servidor/mês', topMedia.map(c => c.mediaVenc), t.series[1])] },
        options: opcoes({ valor: 'brl', horizontal: true, legenda: false }),
      },
    },
  ];

  const heads = ['Cargo', 'Grafias', 'Matrículas', 'Tipos de regime', 'Média vencimentos', 'Média líquida', 'Mediana líquida', 'Total vencimentos'];
  const rows = cargos.map(c => [
    { html: escapeHtml(c.cargo) + (c.grafias.size > 1 ? `<span class="badge badge--warn" title="${escapeHtml([...c.grafias].join(' | '))}">${c.grafias.size} grafias</span>` : ''), cls: 'wrap' },
    fmt.int(c.grafias.size), fmt.int(c.matriculas), { html: escapeHtml([...c.regimes].join(', ')), cls: 'wrap' },
    fmt.brl(c.mediaVenc), fmt.brl(c.mediaLiq), fmt.brl(c.medianaLiq), fmt.brl(c.venc),
  ]);

  return {
    titulo: 'Quadro de Cargos',
    html: `
      <div class="report-kpis">
        ${kpi('Cargos distintos', fmt.int(cargos.length), `${fmt.int(ctx.cargos.totalGrafias)} grafias encontradas nas planilhas`)}
        ${kpi('Cargo com mais servidores', escapeHtml(top[0].cargo), `${fmt.int(top[0].matriculas)} matrículas`)}
        ${topMedia[0] ? kpi('Maior média de vencimentos', fmt.brl(topMedia[0].mediaVenc), escapeHtml(topMedia[0].cargo) + ' · mín. 3 servidores') : ''}
      </div>
      <div class="report-grid">
        ${fig('cg-matr', 'Os 15 cargos com mais servidores', 'Matrículas distintas', { tall: true })}
        ${fig('cg-media', 'As 15 maiores médias de vencimentos', 'Cargos com pelo menos 3 servidores', { tall: true })}
      </div>
      <div class="report-section">Todos os cargos</div>
      ${tabela(heads, rows, new Set([1, 2, 4, 5, 6, 7]))}
      <p class="report-text">Grafias que diferem só em maiúsculas, acentos, pontuação ou marca de gênero "(a)" foram agrupadas. Veja o relatório "Qualidade dos cargos" para as divergências que exigem conferência.</p>`,
    charts,
    csv: {
      nome: 'relatorio-cargos.csv',
      headers: ['Cargo', 'Grafias encontradas', 'Matrículas', 'Tipos de regime', 'Média vencimentos', 'Média líquida', 'Mediana líquida', 'Total vencimentos'],
      rows: cargos.map(c => [c.cargo, [...c.grafias].join(' | '), c.matriculas, [...c.regimes].join(', '),
        numCSV(c.mediaVenc), numCSV(c.mediaLiq), numCSV(c.medianaLiq), numCSV(c.venc)]),
    },
  };
}

function relQualidade(ctx) {
  const c = ctx.cargos;
  const unif = tabela(['Cargo considerado', 'Grafias encontradas'],
    c.unificados.map(u => [u.display, { html: u.grafias.map(g => `${escapeHtml(g.txt)} <span class="muted">(${fmt.int(g.count)})</span>`).join('<br>'), cls: 'wrap' }]));
  const sem = tabela(['Grafia A', 'Registros', 'Grafia B', 'Registros', 'Indício'],
    c.semelhantes.map(s => [s.aTxt, fmt.int(s.aCount), s.bTxt, fmt.int(s.bCount), s.motivo]), new Set([1, 3]));
  const jor = tabela(['Cargo', 'Horas no nome do cargo', 'Carga horária registrada', 'Registros'],
    c.jornadaDivergente.map(j => [j.cargo, `${j.horasCargo}h`, `${j.carga}h`, fmt.int(j.count)]), new Set([1, 2, 3]));
  const gen = tabela(['Cargo informado', 'Registros'], c.grafiasGenericas.map(g => [g.txt, fmt.int(g.count)]), new Set([1]));

  const secao = (titulo, n, desc, corpo) => `
    <div class="report-section">${escapeHtml(titulo)} · ${fmt.int(n)}</div>
    <p class="report-text">${desc}</p>
    ${n ? corpo : '<p class="report-text">Nenhuma ocorrência.</p>'}`;

  return {
    titulo: 'Qualidade dos Nomes de Cargo',
    html: `
      <div class="report-kpis">
        ${kpi('Grafias encontradas', fmt.int(c.totalGrafias), `${fmt.int(c.totalCargos)} cargos após padronização`)}
        ${kpi('Grafias unificadas', fmt.int(c.unificados.length), 'maiúsculas, acentos, pontuação, "(a)"')}
        ${kpi('Possíveis duplicidades', fmt.int(c.semelhantes.length), 'não unificadas — conferir')}
        ${kpi('Jornada divergente', fmt.int(c.jornadaDivergente.reduce((n, j) => n + j.count, 0)), 'registros com horas no nome ≠ carga')}
        ${kpi('Cargo genérico ou vazio', fmt.int(c.genericos), 'registros')}
      </div>
      <p class="report-text">As prefeituras digitam os nomes de cargo livremente. A ferramenta padroniza o que é seguro e <strong>aponta o restante para conferência</strong>:
      comparações e rankings por cargo podem não ser 100% exatos enquanto essas divergências existirem.</p>
      ${secao('Possíveis duplicidades (não unificadas)', c.semelhantes.length,
        'Pares de cargos que parecem o mesmo, escritos de forma diferente. Na comparação salarial é possível unificá-los marcando "Unificar grafias semelhantes".', sem)}
      ${secao('Horas no nome do cargo diferentes da carga horária', c.jornadaDivergente.length,
        'O nome do cargo cita uma jornada (ex.: "20H") diferente da coluna "Carga H Semanal".', jor)}
      ${secao('Grafias unificadas automaticamente', c.unificados.length,
        'Diferenças só de maiúsculas, acentos, pontuação, espaços ou marca de gênero "(a)". Tratadas como o mesmo cargo.', unif)}
      ${secao('Cargos genéricos ou não informados', c.grafiasGenericas.length,
        'Registros sem cargo identificável.', gen)}`,
    charts: [],
    csv: {
      nome: 'relatorio-qualidade-cargos.csv',
      headers: ['Tipo', 'Cargo / Grafia A', 'Grafia B / Detalhe', 'Registros', 'Indício'],
      rows: [
        ...c.semelhantes.map(s => ['Possível duplicidade', s.aTxt, s.bTxt, s.aCount + s.bCount, s.motivo]),
        ...c.jornadaDivergente.map(j => ['Jornada divergente', j.cargo, `nome: ${j.horasCargo}h / carga: ${j.carga}h`, j.count, '']),
        ...c.unificados.map(u => ['Unificado', u.display, u.grafias.map(g => `${g.txt} (${g.count})`).join(' | '), u.grafias.reduce((n, g) => n + g.count, 0), '']),
        ...c.grafiasGenericas.map(g => ['Genérico', g.txt, '', g.count, '']),
      ],
    },
  };
}

function vazio(titulo, msg = 'Não há registros no recorte selecionado.') {
  return { titulo, html: `<p class="empty-note">${escapeHtml(msg)}</p>`, charts: [], csv: null };
}

const RELATORIOS = {
  regime: relRegime,
  composicao: relComposicao,
  evolucao: relEvolucao,
  receita: relReceita,
  cargos: relCargos,
  qualidade: relQualidade,
};

const estado = { tipo: null, modo: 'mes', getCtx: null, charts: [], csv: null, lastFocus: null };

function destruirGraficos() {
  estado.charts.forEach(c => c && c.destroy());
  estado.charts = [];
}

function render() {
  const ctx = estado.getCtx();
  const rel = RELATORIOS[estado.tipo](ctx, estado.modo);
  destruirGraficos();

  $('report-title').textContent = rel.titulo;
  $('report-scope').textContent = ctx.escopo;
  $('report-body').innerHTML = rel.html;
  $('report-csv').disabled = !rel.csv;
  estado.csv = rel.csv;

  const seg = $('report-modo');
  seg.hidden = !rel.modos;
  seg.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.modo === estado.modo)));

  $('report-gerado').textContent = 'Gerado em ' + new Date().toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
  estado.charts = rel.charts.map(ch => criar($(ch.id), ch.config));
}

export function abrirRelatorio(tipo, getCtx) {
  estado.tipo = tipo;
  estado.getCtx = getCtx;
  estado.modo = 'mes';
  estado.lastFocus = document.activeElement;
  const modal = $('report-modal');
  modal.hidden = false;
  document.body.style.overflow = 'hidden';
  render();
  modal.scrollTop = 0;
  $('report-close').focus();
}

export function fecharRelatorio() {
  const modal = $('report-modal');
  if (modal.hidden) return;
  destruirGraficos();
  modal.hidden = true;
  $('report-body').innerHTML = '';
  document.body.style.overflow = '';
  if (estado.lastFocus) estado.lastFocus.focus();
}

export function redesenharRelatorio() {
  if (!$('report-modal').hidden && estado.tipo) render();
}

export function initRelatorios() {
  $('report-close').addEventListener('click', fecharRelatorio);
  $('report-modal').addEventListener('click', e => { if (e.target.id === 'report-modal') fecharRelatorio(); });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && !$('report-modal').hidden) fecharRelatorio();
  });
  $('report-modo').addEventListener('click', e => {
    const b = e.target.closest('button[data-modo]');
    if (!b || b.dataset.modo === estado.modo) return;
    estado.modo = b.dataset.modo;
    render();
  });
  $('report-csv').addEventListener('click', () => {
    if (estado.csv) downloadCSV(estado.csv.nome, estado.csv.headers, estado.csv.rows);
  });
  $('report-print').addEventListener('click', () => {
    document.body.classList.add('printing-report');
    estado.charts.forEach(c => c && c.resize());
    window.print();
  });
  window.addEventListener('afterprint', () => {
    document.body.classList.remove('printing-report');
    estado.charts.forEach(c => c && c.resize());
  });
}
