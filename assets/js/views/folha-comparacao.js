import { escapeHtml, normStr } from '../core/format.js';
import { METRICAS, compararGrupos, destaques, mapaUnificacao, rotuloPeriodo } from '../core/folha-analise.js';
import { fmt } from './charts.js';
import { downloadCSV, numCSV } from './download.js';

const GRUPOS_POR_PAGINA = 15;
const $ = id => document.getElementById(id);

const st = {
  getBase: null,
  grupos: [],
  page: 1,
  abertos: new Set(),
  periodo: '',
};

const ORDENS = {
  amplitude: (a, b) => b.amplitude - a.amplitude,
  atipicos : (a, b) => b.atipicos - a.atipicos || b.amplitude - a.amplitude,
  n        : (a, b) => b.n - a.n,
  mediana  : (a, b) => b.mediana - a.mediana,
};

function razaoTxt(m) {
  if (m.razao === Infinity) return 'colegas: R$ 0';
  return m.razao.toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + '×';
}

export function renderComparacao(preferPeriodo = '') {
  const base = st.getBase();
  const recs = base.recs;
  const sel = $('cmp-comp');

  const periodos = [...new Set(recs.map(r => r.periodo))].sort().reverse();
  if (!periodos.length) {
    sel.innerHTML = '';
    $('cmp-content').innerHTML = '<p class="empty-note">Não há registros no recorte selecionado.</p>';
    return;
  }
  if (preferPeriodo && periodos.includes(preferPeriodo)) st.periodo = preferPeriodo;
  if (!periodos.includes(st.periodo)) st.periodo = periodos[0];
  sel.innerHTML = periodos.map(p => `<option value="${p}"${p === st.periodo ? ' selected' : ''}>${rotuloPeriodo(p)}</option>`).join('');
  sel.disabled = periodos.length < 2;

  const metrica  = $('cmp-metrica').value;
  const unificar = $('cmp-unificar').checked ? mapaUnificacao(base.cargos.semelhantes) : null;
  const busca    = normStr($('cmp-busca').value);

  let grupos = compararGrupos(recs.filter(r => r.periodo === st.periodo), {
    metrica,
    unificar,
    minPessoas: parseInt($('cmp-min').value, 10),
    display: base.cargos.display,
  });
  if (busca) grupos = grupos.filter(g => normStr(g.cargo).includes(busca) || g.grafias.some(x => normStr(x).includes(busca)));
  grupos.sort(ORDENS[$('cmp-ordem').value]);
  st.grupos = grupos;
  st.page = 1;
  st.abertos.clear();

  renderConteudo(base.multiUnidade);
}

function renderConteudo(multiUnidade) {
  const metrica = METRICAS[$('cmp-metrica').value];
  const grupos  = st.grupos;
  const box = $('cmp-content');

  if (!grupos.length) {
    box.innerHTML = '<p class="empty-note">Nenhum grupo com o tamanho mínimo escolhido. Reduza o "mínimo de servidores" ou limpe a busca.</p>';
    return;
  }

  const servidores = grupos.reduce((n, g) => n + g.n, 0);
  const comAtipicos = grupos.filter(g => g.atipicos > 0);
  const totalAtipicos = comAtipicos.reduce((n, g) => n + g.atipicos, 0);
  const top = destaques(grupos, 15);

  box.innerHTML = `
    <div class="cmp-summary">
      <span><strong>${fmt.int(grupos.length)}</strong> grupos comparáveis</span>
      <span><strong>${fmt.int(servidores)}</strong> servidores nesses grupos</span>
      <span><strong>${fmt.int(comAtipicos.length)}</strong> grupos com valores atípicos</span>
      <span><strong>${fmt.int(totalAtipicos)}</strong> servidores muito acima dos colegas</span>
    </div>

    <div class="cmp-subtitle">Maiores diferenças em relação aos colegas · ${escapeHtml(metrica.label)} · ${rotuloPeriodo(st.periodo)}</div>
    <div class="panel-body">
      <table class="dtable">
        <thead><tr>
          <th class="num">#</th><th>Servidor</th><th>Matrícula</th><th>Cargo</th><th>Regime</th><th>Carga</th>
          ${multiUnidade ? '<th>Unidade</th>' : ''}
          <th class="num">${escapeHtml(metrica.label)}</th><th class="num">Mediana dos colegas</th>
          <th class="num">Diferença</th><th class="num">Proporção</th>
        </tr></thead>
        <tbody>
          ${top.map((d, i) => `
            <tr class="${d.atipico ? 'atipico' : ''}">
              <td class="num">${i + 1}</td>
              <td>${escapeHtml(d.rec.nome)}</td>
              <td>${escapeHtml(d.rec.matricula)}</td>
              <td class="wrap">${escapeHtml(d.grupo.cargo)}</td>
              <td>${escapeHtml(d.grupo.regime)}</td>
              <td>${escapeHtml(d.grupo.carga)}</td>
              ${multiUnidade ? `<td class="wrap">${escapeHtml(d.grupo.unidade)}</td>` : ''}
              <td class="num">${fmt.brl(d.valor)}</td>
              <td class="num">${fmt.brl(d.grupo.mediana)}</td>
              <td class="num delta-up">+${fmt.brl(d.diff)}</td>
              <td class="num">${razaoTxt(d)}${d.atipico ? '<span class="badge badge--warn">atípico</span>' : ''}</td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>

    <div class="cmp-subtitle">Grupos · clique para ver o ranking interno</div>
    <div class="panel-body">
      <table class="dtable" id="cmp-grupos">
        <thead><tr>
          <th>Cargo</th><th>Regime</th><th>Carga</th>${multiUnidade ? '<th>Unidade</th>' : ''}
          <th class="num">Servidores</th><th class="num">Mínimo</th><th class="num">Mediana</th>
          <th class="num">Média</th><th class="num">Máximo</th><th class="num">Diferença máx.−mín.</th><th>Atípicos</th>
        </tr></thead>
        <tbody></tbody>
      </table>
    </div>
    <div class="cmp-pager">
      <span id="cmp-pageinfo"></span>
      <button class="btn-ghost" id="cmp-prev" type="button">← Anterior</button>
      <button class="btn-ghost" id="cmp-next" type="button">Próxima →</button>
    </div>
    <p class="panel-note">
      Grupo = mesma unidade, mesmo cargo, mesmo tipo de regime e mesma carga horária, na competência escolhida.
      <strong>Atípico</strong> = valor acima do 3º quartil + 1,5 × intervalo interquartil do grupo (regra de Tukey).
      Diferenças podem ter justificativa legal (tempo de serviço, adicionais, função) e precisam ser verificadas antes de qualquer conclusão.
    </p>`;

  $('cmp-prev').addEventListener('click', () => { st.page--; renderGrupos(multiUnidade); });
  $('cmp-next').addEventListener('click', () => { st.page++; renderGrupos(multiUnidade); });
  $('cmp-grupos').addEventListener('click', e => {
    const tr = e.target.closest('tr.grp-row');
    if (!tr) return;
    const k = st.grupos[+tr.dataset.i].key;
    if (st.abertos.has(k)) st.abertos.delete(k); else st.abertos.add(k);
    renderGrupos(multiUnidade);
  });
  renderGrupos(multiUnidade);
}

function renderGrupos(multiUnidade) {
  const metrica = METRICAS[$('cmp-metrica').value];
  const pages = Math.max(1, Math.ceil(st.grupos.length / GRUPOS_POR_PAGINA));
  st.page = Math.min(Math.max(1, st.page), pages);
  const slice = st.grupos.slice((st.page - 1) * GRUPOS_POR_PAGINA, st.page * GRUPOS_POR_PAGINA);
  const cols = multiUnidade ? 11 : 10;

  const offset = (st.page - 1) * GRUPOS_POR_PAGINA;
  $('cmp-grupos').querySelector('tbody').innerHTML = slice.map((g, i) => {
    const aberto = st.abertos.has(g.key);
    const linha = `
      <tr class="grp-row${aberto ? ' open' : ''}" data-i="${offset + i}" aria-expanded="${aberto}">
        <td class="wrap">${escapeHtml(g.cargo)}${g.grafias.length > 1 ? `<span class="badge badge--warn" title="${escapeHtml(g.grafias.join(' | '))}">${g.grafias.length} grafias</span>` : ''}</td>
        <td>${escapeHtml(g.regime)}</td>
        <td>${escapeHtml(g.carga)}</td>
        ${multiUnidade ? `<td class="wrap">${escapeHtml(g.unidade)}</td>` : ''}
        <td class="num">${fmt.int(g.n)}</td>
        <td class="num">${fmt.brl(g.min)}</td>
        <td class="num">${fmt.brl(g.mediana)}</td>
        <td class="num">${fmt.brl(g.media)}</td>
        <td class="num">${fmt.brl(g.max)}</td>
        <td class="num">${fmt.brl(g.amplitude)}</td>
        <td>${g.atipicos ? `<span class="badge badge--warn">${fmt.int(g.atipicos)} atípico(s)</span>` : '<span class="muted">—</span>'}</td>
      </tr>`;
    if (!aberto) return linha;
    return linha + `
      <tr class="grp-detail"><td colspan="${cols}">
        <table class="dtable">
          <thead><tr>
            <th class="num">#</th><th>Servidor</th><th>Matrícula</th><th class="num">Salário base</th>
            <th class="num">Vantagens</th><th class="num">Gratificação</th><th class="num">Salário líquido</th>
            <th class="num">${escapeHtml(metrica.label)}</th><th class="num">vs. mediana</th>
          </tr></thead>
          <tbody>
            ${g.membros.map((m, i) => `
              <tr class="${m.atipico ? 'atipico' : ''}">
                <td class="num">${i + 1}</td>
                <td>${escapeHtml(m.rec.nome)}${g.grafias.length > 1 ? ` <span class="muted">· ${escapeHtml(m.rec.cargo)}</span>` : ''}</td>
                <td>${escapeHtml(m.rec.matricula)}</td>
                <td class="num">${fmt.brl(m.rec.base)}</td>
                <td class="num">${fmt.brl(m.rec.vantagens)}</td>
                <td class="num">${fmt.brl(m.rec.gratificacao)}</td>
                <td class="num">${fmt.brl(m.rec.liquido)}</td>
                <td class="num"><strong>${fmt.brl(m.valor)}</strong></td>
                <td class="num ${m.diff > 0 ? 'delta-up' : 'muted'}">${m.diff > 0 ? '+' : ''}${fmt.brl(m.diff)}${m.atipico ? '<span class="badge badge--warn">atípico</span>' : ''}</td>
              </tr>`).join('')}
          </tbody>
        </table>
      </td></tr>`;
  }).join('');

  $('cmp-pageinfo').textContent = `Página ${st.page} de ${pages} · ${fmt.int(st.grupos.length)} grupos`;
  $('cmp-prev').disabled = st.page <= 1;
  $('cmp-next').disabled = st.page >= pages;
}

function exportar() {
  const metrica = METRICAS[$('cmp-metrica').value];
  const rows = [];
  for (const g of st.grupos) {
    g.membros.forEach((m, i) => rows.push([
      rotuloPeriodo(st.periodo), g.unidade, g.cargo, m.rec.cargo, g.regime, g.carga, g.n, i + 1,
      m.rec.nome, m.rec.matricula, numCSV(m.rec.base), numCSV(m.rec.vantagens), numCSV(m.rec.gratificacao),
      numCSV(m.rec.liquido), numCSV(m.valor), numCSV(g.mediana), numCSV(m.diff), m.atipico ? 'sim' : '',
    ]));
  }
  downloadCSV(`comparacao-salarial-${st.periodo}.csv`, [
    'Competência', 'Unidade', 'Cargo (grupo)', 'Cargo (como informado)', 'Tipo regime', 'Carga horária', 'Servidores no grupo',
    'Posição', 'Nome', 'Matrícula', 'Salário base', 'Vantagens', 'Gratificação', 'Salário líquido',
    metrica.label, 'Mediana do grupo', 'Diferença para a mediana', 'Atípico',
  ], rows);
}

export function initComparacao(getBase) {
  st.getBase = getBase;
  $('cmp-metrica').innerHTML = Object.entries(METRICAS)
    .map(([k, m]) => `<option value="${k}">${escapeHtml(m.label)}</option>`).join('');
  $('cmp-comp').addEventListener('change', e => { st.periodo = e.target.value; renderComparacao(); });
  ['cmp-metrica', 'cmp-min', 'cmp-ordem', 'cmp-unificar']
    .forEach(id => $(id).addEventListener('change', () => renderComparacao()));
  let t = null;
  $('cmp-busca').addEventListener('input', () => {
    clearTimeout(t);
    t = setTimeout(() => renderComparacao(), 200);
  });
  $('cmp-export').addEventListener('click', exportar);
}
