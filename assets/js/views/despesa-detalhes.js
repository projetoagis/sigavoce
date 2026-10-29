import { escapeHtml as esc, formatBRL, formatInt } from '../core/format.js';
import { linkPP } from './painel-doc.js';
import { mascaraDoc } from '../core/pacote-parser.js';
import {
  num, bruto, soma, dia, ano, doCredor, municipios, munChave, munDe, entDe, orgao, multiUnidade,
  chavePP, resumo, CAMPO_CLASSIF, ementario, classifTexto, difereDoEmentario, contratos, porCodigo,
  filtrar, ordemPagamento, retencoesPorConta, quadro, quadroCodigo, outroEmitente,
  COLUNAS_CSV, linhasCsv,
} from '../core/despesa-detalhes.js';
import { downloadCSV } from './download.js';

const ABAS = [
  ['contratos', 'Contratos'],
  ['pagamentos', 'Pagamentos'],
  ['retencoes', 'Retenções'],
  ['notas', 'Notas fiscais'],
  ['classif', 'Classificação'],
];
const PASSO = 200;
const CHAVE_EMENTARIO = 'sigavoce-despesa-ementario';
const FILTRO_VAZIO = () => ({ ano: '', contrato: '', orgao: '', busca: '', cuni: '' });

const rs = v => (v == null || v === '' || !Number.isFinite(Number(v)) ? '—' : formatBRL(Number(v)));
const pct = (a, b) => (b ? `${(100 * a / b).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%` : '—');
const txt = v => (v ? esc(v) : '<span class="dd-mudo">—</span>');
const barra = (fr, passou = false) => `<span class="dd-barra${passou ? ' passou' : ''}"><i style="width:${Math.max(0, Math.min(100, fr * 100)).toFixed(1)}%"></i></span>`;
const nomeArq = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 60).toUpperCase();

function lerEmentario() {
  try { return JSON.parse(localStorage.getItem(CHAVE_EMENTARIO) || '{}') || {}; } catch { return {}; }
}
function gravarEmentario(v) {
  try { localStorage.setItem(CHAVE_EMENTARIO, JSON.stringify(v)); } catch {   }
}

function saibaEmpenho() {
  const fundo = document.createElement('div');
  fundo.className = 'iv-modal-fundo';
  fundo.innerHTML = `<div class="iv-modal dd-saiba-modal" role="dialog" aria-modal="true" aria-labelledby="dd-saiba-tit">
      <h3 id="dd-saiba-tit">Como se lê a tabela de empenhos</h3>
      <p>O <b>empenho</b> é a reserva do dinheiro no orçamento, feita antes da despesa. Todo pagamento sai de um empenho,
        e um empenho pode ser pago de uma vez ou em várias parcelas.</p>
      <h4>Tipos de empenho</h4>
      <dl class="dd-saiba-tipos">
        <dt>Ordinário</dt><dd>O valor exato é conhecido de antemão e a despesa costuma ser paga de uma só vez.</dd>
        <dt>Estimativo</dt><dd>O valor exato não dá para saber antes (água, energia, telefone, combustível...).
          O empenho é uma estimativa e vai sendo pago aos poucos; pode sobrar saldo ou receber reforço.</dd>
        <dt>Global</dt><dd>O valor total é conhecido, mas a despesa é paga em parcelas (aluguel, serviço contratado por mês...).</dd>
      </dl>
      <p class="dd-mudo">O tipo é o que aparece na ficha do pagamento no portal do TCM-BA (Lei 4.320/1964, art. 60).</p>
      <h4>Como as colunas são calculadas</h4>
      <ul>
        <li><b>Empenho</b>: cada linha é um empenho, identificado pelo número + ano do empenho + unidade pagadora
          (o mesmo número se repete em outros anos e em outras unidades).</li>
        <li><b>Valor do empenho</b>: o valor informado na ficha do pagamento. Quando vários pagamentos saem do mesmo
          empenho, vale o valor da primeira ficha.</li>
        <li><b>Pago (bruto)</b>: a soma, em todos os pagamentos deste contrato que saíram do empenho,
          do <b>líquido</b> (o que o credor recebeu) + o <b>retido</b> (IRRF, ISS, INSS...).</li>
        <li><b>Executado</b> = Pago (bruto) ÷ Valor do empenho × 100.</li>
      </ul>
      <h4>Cuidados na leitura</h4>
      <ul>
        <li>Só entram os pagamentos que estão neste arquivo, deste credor e do município/unidade escolhidos.
          Se o pacote foi recortado (por ano, competência, unidade ou classificação), o executado fica menor que o real.</li>
        <li>No <b>estimativo</b> e no <b>global</b>, um percentual abaixo de 100% é normal enquanto as parcelas ainda estão sendo pagas.</li>
        <li>Acima de 100% a barra fica vermelha: o pago passou do valor que a ficha mostra. Vale conferir no documento
          se houve reforço ou anulação do empenho.</li>
        <li>Empenho de um ano pago no ano seguinte (restos a pagar) continua na linha do ano em que foi empenhado.</li>
        <li>O cartão <b>Empenhado</b>, no alto, soma o valor de cada empenho uma vez só; o executado dele é o bruto pago ÷ esse total.</li>
      </ul>
      <div class="iv-modal-acoes"><button type="button" class="iv-modal-sim" data-r="ok">Entendi</button></div>
    </div>`;
  const fechar = () => {
    document.removeEventListener('keydown', tecla, true);
    fundo.remove();
  };
  const tecla = e => { if (e.key === 'Escape') { e.stopPropagation(); fechar(); } };
  fundo.addEventListener('click', e => {
    if (e.target === fundo || e.target.closest('[data-r]')) fechar();
  });
  document.addEventListener('keydown', tecla, true);
  document.body.appendChild(fundo);
  fundo.querySelector('[data-r]').focus();
}

export function desenharDespesaDetalhada(el, t, { municipio = '', docsDoPP = null, filtro = '' } = {}) {
  const credores = t.credores || [];
  const comDado = credores.find(c => c.pagamentos) || credores.find(c => (t.detalhes || []).some(p => p.documento === c.documento));
  const S = {
    doc: (comDado || credores[0] || {}).documento || '',
    aba: 'contratos',
    f: FILTRO_VAZIO(),
    mostrar: PASSO,
    abertos: new Set(),
    emen: lerEmentario(),
    mun: null,
    uni: '',
    munAviso: '',
    grupos: new Map(),
  };
  const temEmentario = (t.detalhes || []).some(p => p.ementario && Object.keys(p.ementario).length);
  const emen = lugar => temEmentario && !!S.emen[lugar];
  const caixaEmen = lugar => (temEmentario ? `<label class="dd-emen${emen(lugar) ? ' on' : ''}"
      title="Mostrar natureza e fonte pelo CÓDIGO, com a descrição do ementário do ano do pagamento (e o aviso de quando o código mudou de sentido)">
      <input type="checkbox" data-emen="${lugar}"${emen(lugar) ? ' checked' : ''}> ver pelo ementário</label>` : '');
  const munCadeia = munChave(municipio);

  const pp = (numero, linha) => {
    if (!docsDoPP || !numero || (munCadeia && munChave(munDe(linha)) !== munCadeia)) return esc(numero);
    return linkPP(numero, docsDoPP(numero, linha.data || linha.data_retencao));
  };

  el.innerHTML = '<div class="dd"></div>';
  const raiz = el.firstElementChild;

  function classifHtml(p, qual, comEmen) {
    const lancado = CAMPO_CLASSIF[qual](p);
    const r = ementario(p, qual);
    if (!comEmen || !r) return txt(lancado);
    if (!r.encontrado) {
      const semTabela = /^sem ement/i.test(r.nota || '');
      return `${txt(lancado)} <span class="dd-tag${semTabela ? '' : ' fora'}" title="${esc(r.nota || 'código fora do ementário')}">${semTabela ? 'sem ementário no ano' : 'fora do ementário'}</span>`;
    }
    const cod = qual.startsWith('nat') ? (r.fmt || r.codigo) : r.codigo;
    const alt = r.alteracoes || [];
    return `<span><b class="dd-mono">${esc(cod)}</b> ${esc(r.descricao)}</span>`
      + (r.aproximado ? ` <span class="dd-tag" title="o ementário não tem ${esc(ano(p))}; usado o exercício ${esc(r.ano_ref)}">≈ ${esc(r.ano_ref)}</span>` : '')
      + (alt.length ? ` <span class="dd-tag mudou" title="${esc(`Este código teve outro sentido:\n${alt.map(a => `${a.anos}: ${a.descricao}`).join('\n')}`)}">mudou</span>` : '')
      + (r.nota ? ` <span class="dd-tag" title="${esc(r.nota)}">${esc(r.nota)}</span>` : '')
      + (difereDoEmentario(p, qual) ? ` <span class="dd-tag difere" title="${esc(`Lançado pela prefeitura: ${lancado}`)}">≠ prefeitura</span>` : '');
  }

  function localHtml(todos, unidades) {
    if (!todos.length) return '';
    const muns = municipios(unidades);
    const ordM = [...muns].sort((a, b) => (b.chave === munCadeia) - (a.chave === munCadeia) || b.v - a.v);
    const totV = soma(todos, p => num(p.valor));
    const unisDoMun = [...unidades.values()].filter(u => S.mun === '*' || u.chave === S.mun).sort((a, b) => b.v - a.v);
    const tabela = unidades.size > 1 ? `<details class="dd-dist" open>
        <summary>Recebido por município e unidade pagadora · ${muns.length} município(s), ${unidades.size} unidade(s)</summary>
        <div class="table-wrapper"><table class="dd-tab"><thead><tr><th>Município</th><th>Unidade pagadora</th><th class="tb-num">Pag.</th><th>Período</th>
          <th class="tb-num">Líquido</th><th class="tb-num">% do credor</th></tr></thead>
        <tbody>${[...unidades.values()].sort((a, b) => (b.chave === munCadeia) - (a.chave === munCadeia) || a.mun.localeCompare(b.mun) || b.v - a.v).map(u => {
          const on = (S.mun === '*' || S.mun === u.chave) && (!S.uni || S.uni === u.cod);
          return `<tr class="dd-clicavel dd-dist-l${on ? ' on' : ''}" data-mun="${esc(u.chave)}" data-uni="${esc(u.cod)}" title="Clique para ver só esta unidade">
            <td>${esc(u.mun)}${u.chave === munCadeia ? ' <span class="dd-tag difere">município da cadeia</span>' : ''}</td>
            <td>${esc(u.ent)} <span class="dd-mudo dd-mono">${esc(u.cod)}</span></td>
            <td class="tb-num">${formatInt(u.n)}</td><td>${esc(dia(u.ini))} – ${esc(dia(u.fim))}</td>
            <td class="tb-num"><b>${rs(u.v)}</b></td>
            <td class="tb-num">${barra(totV ? u.v / totV : 0)} ${pct(u.v, totV)}</td></tr>`;
        }).join('')}</tbody></table></div></details>` : '';
    return `<div class="dd-local">
        <div class="dd-filtros">
          ${muns.length > 1 ? `<label class="dd-f"><span>Município</span><select class="filter-select" data-sel="mun">
            <option value="*"${S.mun === '*' ? ' selected' : ''}>Todos os municípios (${muns.length})</option>
            ${ordM.map(m => `<option value="${esc(m.chave)}"${m.chave === S.mun ? ' selected' : ''}>${esc(m.nome)}${m.chave === munCadeia ? ' — da cadeia' : ''} · ${m.n} pag. · ${rs(m.v)}</option>`).join('')}
          </select></label>` : `<span class="dd-f"><span>Município</span><b>${esc(muns[0] ? muns[0].nome : '')}</b></span>`}
          <label class="dd-f"><span>Unidade pagadora</span><select class="filter-select" data-sel="uni">
            <option value="">Todas as unidades (${unisDoMun.length})</option>
            ${unisDoMun.map(u => `<option value="${esc(u.cod)}"${u.cod === S.uni ? ' selected' : ''}>${esc(u.ent)}${S.mun === '*' && muns.length > 1 ? ` (${esc(u.mun)})` : ''} · ${u.n} pag.</option>`).join('')}
          </select></label>
          ${(S.mun !== '*' && muns.length > 1) || S.uni ? `<button type="button" class="btn-ghost" data-acao="local-todos">${muns.length > 1 ? 'Ver todos os municípios' : 'Ver todas as unidades'}</button>` : ''}
          ${S.mun !== munCadeia && munCadeia && muns.some(m => m.chave === munCadeia) ? '<button type="button" class="btn-ghost" data-acao="local-cadeia">Só o município da cadeia</button>' : ''}
        </div>
        ${S.munAviso ? `<p class="dd-aviso">Este credor não tem pagamento em <b>${esc(S.munAviso)}</b> (município da cadeia) — mostrando todos os municípios.</p>` : ''}
        ${tabela}
      </div>`;
  }

  function cartoesHtml(pag, retU, nfs) {
    const r = resumo(pag, retU, nfs);
    return `<div class="summary-grid dd-cartoes">
      <div class="card card--total"><div class="card-label">Pagamentos</div><div class="card-value">${formatInt(r.n)}</div>
        <div class="card-sub">${r.ini ? `${dia(r.ini)} a ${dia(r.fim)}` : '—'}${r.notas ? ` · ${r.notas} NF${r.outroEmitente ? ` · <span class="dd-ruim">${r.outroEmitente} de outro emitente</span>` : ''}` : ''}</div></div>
      <div class="card card--positivo"><div class="card-label">Líquido pago</div><div class="card-value">${rs(r.liquido)}</div>
        <div class="card-sub">bruto ${rs(r.bruto)}</div></div>
      <div class="card card--negativo"><div class="card-label">Retido</div><div class="card-value">${rs(r.retido)}</div>
        <div class="card-sub">${r.lancamentosRetencao} lançamento(s) de retenção · ${pct(r.retido, r.bruto)} do bruto</div></div>
      <div class="card card--saldo"><div class="card-label">Empenhado</div><div class="card-value">${rs(r.empenhado)}</div>
        <div class="card-sub">${r.nEmpenhos} empenho(s) · executado ${pct(r.bruto, r.empenhado)}</div></div>
      <div class="card card--total"><div class="card-label">Contratos</div><div class="card-value">${formatInt(r.contratos)}</div>
        <div class="card-sub">${esc(r.unidades.join(' · ')) || '—'}</div></div>
      <div class="card card--negativo"><div class="card-label">Sem ficha no portal</div><div class="card-value">${formatInt(r.semFicha)}</div>
        <div class="card-sub">${r.semFicha ? '<span class="dd-ruim">pagamento sem detalhe</span>' : 'todos detalhados'}</div></div>
    </div>`;
  }

  function abaContratos(pag) {
    const grupos = contratos(pag);
    const multi = multiUnidade(pag);
    const comEmen = emen('contratos');
    const cols = multi ? 9 : 8;
    const linhas = grupos.map(g => {
      const chave = `c:${g.chave}`;
      const aberto = S.abertos.has(chave) || grupos.length === 1;
      const origem = [
        g.dispensas.length ? `Dispensa/Inexigibilidade ${esc(g.dispensas.join(', '))}` : '',
        g.licitacoes.length ? `Licitação ${esc(g.licitacoes.join(', '))}` : '',
      ].filter(Boolean).join('<br>') || '<span class="dd-mudo">—</span>';
      return `<tr class="dd-clicavel dd-c-l${aberto ? ' aberto' : ''}" data-chave="${esc(chave)}">
          <td><span class="dd-seta">▸</span> <b>${g.contrato ? esc(g.contrato) : 'Sem contrato informado'}</b></td>
          ${multi ? `<td>${esc(entDe(g.lista[0]))}</td>` : ''}
          <td>${origem}</td>
          <td class="tb-num">${g.lista.length}</td>
          <td class="dd-pct">${g.ini ? `${esc(dia(g.ini))} – ${esc(dia(g.fim))}` : '—'}</td>
          <td class="tb-num"><b>${rs(g.liquido)}</b></td>
          <td class="tb-num">${g.retido ? rs(g.retido) : '<span class="dd-mudo">—</span>'}</td>
          <td class="tb-num">${rs(g.liquido + g.retido)}</td>
          <td class="tb-num">${g.empenhos.length}</td>
        </tr>${aberto ? `<tr class="dd-c-det"><td colspan="${cols}">${detalheContrato(g, comEmen)}</td></tr>` : ''}`;
    }).join('');
    const liq = soma(grupos, g => g.liquido);
    const ret = soma(grupos, g => g.retido);
    return `<div class="table-wrapper"><table class="dd-tab dd-contratos">
        <thead><tr><th>Contrato</th>${multi ? '<th>Unidade pagadora</th>' : ''}<th>Licitação · dispensa</th><th class="tb-num">Pag.</th><th>Período</th>
          <th class="tb-num">Líquido</th><th class="tb-num">Retido</th><th class="tb-num">Bruto</th><th class="tb-num">Empenhos</th></tr></thead>
        <tbody>${linhas}</tbody>
        <tfoot><tr><td colspan="${multi ? 3 : 2}">Total · ${grupos.length} contrato(s)</td><td class="tb-num">${pag.length}</td><td></td>
          <td class="tb-num">${rs(liq)}</td><td class="tb-num">${rs(ret)}</td><td class="tb-num">${rs(liq + ret)}</td><td></td></tr></tfoot>
      </table></div>
      <p class="dd-mudo dd-dica">${grupos.some(g => !g.contrato) ? 'Inclui os pagamentos sem contrato informado. ' : ''}${multi ? 'Separados por unidade pagadora. ' : ''}Clique na linha para ver ano a ano e os empenhos.</p>`;
  }

  function detalheContrato(g, comEmen) {
    const naturezas = porCodigo(g.lista, 'nat', comEmen).map(p => classifHtml(p, 'nat', comEmen));
    const fontes = porCodigo(g.lista, 'fonte', comEmen).map(p => classifHtml(p, 'fonte', comEmen));
    return `<h4 class="dd-h4 dd-h4-emen">Classificação ${caixaEmen('contratos')}</h4>
      <div class="table-wrapper"><table class="dd-tab dd-chave-valor"><tbody>
        <tr><th>Unidade pagadora</th><td>${esc(entDe(g.lista[0]))} <span class="dd-mudo">(${esc(munDe(g.lista[0]))})</span></td></tr>
        <tr><th>Órgão(s)</th><td>${g.orgaos.map(esc).join('<br>') || '—'}</td></tr>
        <tr><th>Natureza(s) da despesa</th><td>${naturezas.join('<br>') || '—'}</td></tr>
        <tr><th>Fonte(s) de recurso</th><td>${fontes.join('<br>') || '—'}</td></tr>
      </tbody></table></div>
      <h4 class="dd-h4">Por ano do pagamento</h4>
      <div class="table-wrapper"><table class="dd-tab"><thead><tr><th>Ano</th><th class="tb-num">Pag.</th><th class="tb-num">Líquido</th><th class="tb-num">Retido</th><th class="tb-num">Bruto</th></tr></thead>
        <tbody>${g.anos.map(o => `<tr><td>${esc(o.ano)}</td><td class="tb-num">${o.n}</td><td class="tb-num">${rs(o.liquido)}</td>
          <td class="tb-num">${rs(o.retido)}</td><td class="tb-num"><b>${rs(o.liquido + o.retido)}</b></td></tr>`).join('')}</tbody>
        <tfoot><tr><td>Total</td><td class="tb-num">${g.lista.length}</td><td class="tb-num">${rs(g.liquido)}</td><td class="tb-num">${rs(g.retido)}</td><td class="tb-num">${rs(g.liquido + g.retido)}</td></tr></tfoot>
      </table></div>
      <h4 class="dd-h4 dd-h4-emen">Empenhos <button type="button" class="btn-ghost dd-saiba" data-acao="saiba-empenho">Saiba mais</button></h4>
      <div class="table-wrapper"><table class="dd-tab"><thead><tr><th>Empenho</th><th>Data</th><th>Tipo</th><th>Órgão</th><th class="tb-num">Pag.</th><th class="tb-num">Valor do empenho</th><th class="tb-num">Pago (bruto)</th><th class="tb-num">Executado</th></tr></thead>
        <tbody>${g.empenhos.map(e => {
          const fr = e.valor ? e.bruto / e.valor : 0;
          return `<tr><td class="dd-mono"><b>${esc(e.empenho)}</b></td><td>${esc(dia(e.data))}</td>
            <td>${txt(e.tipo)}</td><td>${txt(e.orgao)}</td><td class="tb-num">${e.n}</td><td class="tb-num">${rs(e.valor)}</td><td class="tb-num">${rs(e.bruto)}</td>
            <td class="tb-num dd-pct">${barra(fr, fr > 1.0001)} ${pct(e.bruto, e.valor)}</td></tr>`;
        }).join('')}</tbody>
      </table></div>
      <button type="button" class="btn-ghost dd-ver-pag" data-acao="ver-pag" data-contrato="${esc(g.contrato)}" data-cuni="${esc(g.codUnidade)}">Ver os ${g.lista.length} pagamento(s) deste contrato</button>`;
  }

  function indices(ret, nfs) {
    const retPor = new Map();
    for (const x of ret) {
      const k = chavePP(x.codigo_unidade, x.pp, x.data_retencao);
      if (!retPor.has(k)) retPor.set(k, []);
      retPor.get(k).push(x);
    }
    const nfPor = new Map();
    for (const n of nfs) {
      const k = chavePP(n.codigo_unidade, n.pp || n.numero_documento, n.data);
      if (!nfPor.has(k)) nfPor.set(k, []);
      nfPor.get(k).push(n);
    }
    return { retPor, nfPor };
  }

  function abaPagamentos(pag, retU, nfs) {
    const f = S.f;
    f.multi = multiUnidade(pag);
    const anos = [...new Set(pag.map(ano).filter(Boolean))].sort();
    const contratosL = [...new Set(pag.map(p => p.contrato || '(sem)'))].sort();
    const orgaos = [...new Set(pag.map(p => orgao(p, f.multi)).filter(Boolean))].sort();
    const lista = filtrar(pag, f).sort(ordemPagamento);
    const liq = soma(lista, p => num(p.valor));
    const ret = soma(lista, p => num(p.valor_retencoes));
    const sel = (campo, rot, ops) => `<label class="dd-f"><span>${rot}</span><select class="filter-select" data-filtro="${campo}">
      <option value="">todos</option>${ops.map(o => `<option${o === f[campo] ? ' selected' : ''}>${esc(o)}</option>`).join('')}</select></label>`;
    const linhas = lista.slice(0, S.mostrar).map(p => {
      const k = `p:${p.id}`;
      const semFicha = String(p.status || '').toLowerCase() !== 'ok';
      return `<tr class="dd-clicavel dd-linha${S.abertos.has(k) ? ' aberto' : ''}" data-chave="${esc(k)}" data-id="${esc(p.id)}">
          <td><span class="dd-seta">▸</span> ${esc(dia(p.data))}</td>
          <td class="dd-mono"><b>${pp(p.numero_documento, p)}</b></td>
          <td class="dd-mono">${esc(p.empenho)}</td>
          <td>${txt(orgao(p, f.multi))}</td>
          <td>${classifHtml(p, 'nat', emen('pagamentos'))}</td>
          <td>${classifHtml(p, 'fonte', emen('pagamentos'))}</td>
          <td>${txt(p.contrato)}</td>
          <td class="tb-num"><b>${rs(p.valor)}</b></td>
          <td class="tb-num">${num(p.valor_retencoes) ? rs(p.valor_retencoes) : '<span class="dd-mudo">—</span>'}</td>
          <td>${semFicha ? '<span class="dd-tag fora">sem ficha</span>' : ''}</td>
        </tr>${S.abertos.has(k) ? fichaTr(p) : ''}`;
    }).join('');
    return `<div class="dd-filtros">
        ${sel('ano', 'Ano', anos)}
        ${sel('contrato', 'Contrato', contratosL)}
        ${sel('orgao', 'Órgão', orgaos)}
        <label class="dd-f dd-f-busca"><span>Buscar</span><input type="search" class="filter-input" data-busca value="${esc(f.busca)}"
          placeholder="PP, empenho, natureza, ação, conta..." autocomplete="off"></label>
        <button type="button" class="btn-ghost" data-acao="limpar">Limpar</button>
        ${caixaEmen('pagamentos')}
      </div>
      <p class="dd-tot">${formatInt(lista.length)} pagamento(s)${f.cuni ? ' · só a unidade do contrato escolhido' : ''} · líquido <b>${rs(liq)}</b> · retido ${rs(ret)} · bruto ${rs(liq + ret)}</p>
      <div class="table-wrapper"><table class="dd-tab dd-pag">
        <thead><tr><th>Data</th><th>PP nº</th><th>Empenho</th><th>Órgão</th><th>Natureza</th><th>Fonte</th><th>Contrato</th>
          <th class="tb-num">Líquido</th><th class="tb-num">Retido</th><th></th></tr></thead>
        <tbody>${linhas || '<tr><td colspan="10" class="tb-vazio">Nenhum pagamento com esse filtro.</td></tr>'}</tbody>
      </table></div>
      ${lista.length > S.mostrar ? `<button type="button" class="btn-ghost" data-acao="mais">Mostrar mais ${Math.min(PASSO, lista.length - S.mostrar)} de ${lista.length - S.mostrar}</button>` : ''}`;
  }

  function fichaTr(p) {
    return `<tr class="dd-ficha-tr"><td colspan="10">${ficha(p)}</td></tr>`;
  }

  function ficha(p) {
    const { retPor, nfPor } = S.idx;
    const rets = retPor.get(chavePP(p.codigo_unidade, p.numero_documento, p.data)) || [];
    const notas = nfPor.get(chavePP(p.codigo_unidade, p.numero_documento, p.data)) || [];
    const campo = (rot, v) => `<div><span>${rot}</span>${v || '<span class="dd-mudo">—</span>'}</div>`;
    const t = v => (v ? esc(v) : '');
    const extra = Object.entries(p.extra || {});
    const classif = emen('ficha')
      ? [['Natureza (TCM)', 'nat'], ['Natureza (gestor)', 'nat_gestor'], ['Fonte (TCM)', 'fonte'], ['Fonte (gestor)', 'fonte_gestor']]
        .map(([rot, q]) => campo(`${rot} · ementário`, classifHtml(p, q, true)
          + (CAMPO_CLASSIF[q](p) ? `<small class="dd-orig">lançado: ${esc(CAMPO_CLASSIF[q](p))}</small>` : ''))).join('')
      : `${campo('Natureza (TCM)', t(p.natureza_tcm))}${campo('Natureza (gestor)', t(p.natureza_gestor))}
         ${campo('Fonte (TCM)', t(p.classif_fonte_tcm || p.fonte_tcm))}${campo('Fonte (gestor)', t(p.classif_fonte_gestor || p.fonte_gestor))}`;
    return `<div class="dd-ficha">
      <section><h5>Dados básicos</h5>
        ${campo('Fase', t(p.fase))}
        ${campo('Data do pagamento', t(dia(p.data_pagamento) || dia(p.data)))}
        ${campo('Valor do pagamento', p.valor_pagamento != null ? rs(p.valor_pagamento) : rs(p.valor))}
        ${campo('Processo de pagamento', p.numero_documento ? pp(p.numero_documento, p) : '')}
        ${p.documento_pagamento && p.documento_pagamento !== p.numero_documento ? campo('Documento', t(p.documento_pagamento)) : ''}
        ${campo('Tipo de documento', t(p.tipo_documento))}
        ${campo('Favorecido', t(p.favorecido))}
        ${campo('Conta bancária', t(p.conta_bancaria))}
        ${campo('Restos a pagar', t(p.restos_a_pagar))}
      </section>
      <section><h5>Empenho</h5>
        ${campo('Empenho nº', t(p.empenho_numero || p.empenho))}
        ${campo('Data do empenho', t(dia(p.data_empenho_ficha || p.data_empenho)))}
        ${campo('Tipo de empenho', t(p.tipo_empenho))}
        ${campo('Valor do empenho', p.valor_empenho != null ? rs(p.valor_empenho) : '')}
        ${campo('Valor das retenções', p.valor_retencoes != null ? rs(p.valor_retencoes) : '')}
        ${campo('Bruto (líquido + retido)', rs(bruto(p)))}
      </section>
      <section><h5>Classificação institucional</h5>
        ${campo('Município', t(p.municipio))}
        ${campo('Entidade', t(p.entidade || p.unidade))}
        ${campo('Poder', t(p.poder))}
        ${campo('Órgão', t(p.orgao || p.cd_orgao))}
        ${campo('Unidade orçamentária', t(p.unidade_orcamentaria || p.cd_unidade_orcamentaria))}
      </section>
      <section><h5>Funcional programática</h5>
        ${campo('Função', t(p.funcao))}
        ${campo('Subfunção', t(p.subfuncao))}
        ${campo('Programa', t(p.programa))}
        ${campo('Tipo de ação', t(p.tipo_acao))}
        ${campo('Ação', t(p.acao))}
      </section>
      <section><h5 class="dd-h5-emen">Classificação da despesa ${caixaEmen('ficha')}</h5>${classif}</section>
      <section><h5>Licitação e contratação</h5>
        ${campo('Licitação nº', t(p.licitacao))}
        ${campo('Dispensa/Inexigibilidade', t(p.dispensa_inexigibilidade))}
        ${campo('Contrato', t(p.contrato))}
        ${campo('Declaração', t(p.declaracao))}
      </section>
      ${rets.length ? `<section class="dd-larga"><h5>Retenções deste pagamento</h5>
        <table class="dd-tab"><thead><tr><th>Competência</th><th>Data</th><th>Conta contábil</th><th class="tb-num">Valor</th></tr></thead>
          <tbody>${rets.map(x => `<tr><td>${esc(x.competencia)}</td><td>${esc(dia(x.data_retencao))}</td>
            <td><span class="dd-mono dd-mudo">${esc(x.conta_contabil_numero)}</span> ${esc(x.conta_contabil)}</td>
            <td class="tb-num">${rs(x.valor)}</td></tr>`).join('')}</tbody></table></section>` : ''}
      ${notas.length ? `<section class="dd-larga"><h5>Notas fiscais deste pagamento</h5>${tabNotas(notas)}</section>` : ''}
      ${extra.length ? `<section class="dd-larga"><h5>Outras colunas do portal</h5>${extra.map(([k, v]) => campo(esc(k), esc(v))).join('')}</section>` : ''}
    </div>`;
  }

  function abaRetencoes(retU, pag) {
    if (!retU.length) return '<p class="tb-vazio">Nenhuma retenção para este credor (o portal só traz retenção nos anos em que houve).</p>';
    const contas = retencoesPorConta(retU);
    const total = soma(retU, x => num(x.valor));
    const ord = [...retU].sort((a, b) => (a.data_retencao || '').localeCompare(b.data_retencao || ''));
    return `<h4 class="dd-h4">Por conta contábil</h4>
      <div class="table-wrapper"><table class="dd-tab"><thead><tr><th>Conta contábil</th><th>Anos</th><th class="tb-num">Lançamentos</th><th class="tb-num">Total</th><th class="tb-num">%</th></tr></thead>
        <tbody>${contas.map(o => `<tr><td><span class="dd-mono dd-mudo">${esc(o.numero)}</span> <b>${esc(o.nome)}</b></td><td>${esc(o.anos.join(', '))}</td>
          <td class="tb-num">${o.n}</td><td class="tb-num"><b>${rs(o.v)}</b></td><td class="tb-num">${pct(o.v, total)}</td></tr>`).join('')}</tbody>
        <tfoot><tr><td colspan="2">Total retido</td><td class="tb-num">${retU.length}</td><td class="tb-num">${rs(total)}</td><td></td></tr></tfoot></table></div>
      <h4 class="dd-h4">Lançamentos</h4>
      <div class="table-wrapper dd-rolo"><table class="dd-tab">
        <thead><tr><th>Competência</th><th>Data</th><th>PP nº</th><th>Empenho</th><th>Conta contábil</th><th class="tb-num">Valor</th></tr></thead>
        <tbody>${ord.map(x => `<tr><td>${esc(x.competencia)}</td><td>${esc(dia(x.data_retencao))}</td>
          <td class="dd-mono">${pp(x.pp, x)}</td><td class="dd-mono">${esc(x.empenho)}</td>
          <td>${esc(x.conta_contabil)}</td><td class="tb-num">${rs(x.valor)}</td></tr>`).join('')}</tbody></table></div>
      <p class="dd-mudo">O portal repete as retenções do mês em cada pagamento do mesmo empenho; aqui cada retenção conta uma vez (por pagamento, data, conta e valor).</p>`;
  }

  function tabNotas(notas, brutoPor) {
    return `<table class="dd-tab"><thead><tr><th>Competência</th><th>PP nº</th><th>NF nº · série</th><th>Data da NF</th>
      <th>Emitente</th><th class="tb-num">Valor da NF</th>${brutoPor ? '<th class="tb-num">Bruto do PP</th>' : ''}<th>Objeto</th></tr></thead>
      <tbody>${notas.map(n => {
        const b = brutoPor ? brutoPor.get(chavePP(n.codigo_unidade, n.pp || n.numero_documento, n.data)) : null;
        const dif = b != null && Math.abs(b - num(n.valor)) >= 0.01;
        return `<tr><td>${esc(n.competencia)}</td><td class="dd-mono">${pp(n.pp || n.numero_documento, n)}</td>
          <td class="dd-mono"><b>${esc(n.nf_numero)}</b>${n.serie ? ` · ${esc(n.serie)}` : ''}${n.subserie ? `/${esc(n.subserie)}` : ''}</td>
          <td>${esc(dia(n.data_nf))}</td>
          <td class="dd-mono">${esc(mascaraDoc(n.emitente))}${outroEmitente(n) ? ' <span class="dd-tag fora" title="A nota foi emitida por outro CPF/CNPJ, não pelo credor do pagamento">outro emitente</span>' : ''}</td>
          <td class="tb-num"><b>${rs(n.valor)}</b></td>
          ${brutoPor ? `<td class="tb-num">${b == null ? '<span class="dd-mudo">—</span>' : rs(b)}${dif ? ' <span class="dd-tag mudou" title="O valor da nota não é o bruto (líquido + retido) deste pagamento — pode ser pagamento parcial ou nota de outro período">≠</span>' : ''}</td>` : ''}
          <td class="dd-objeto">${txt(n.objeto)}</td></tr>`;
      }).join('')}</tbody></table>`;
  }

  function abaNotas(nfs, pag) {
    if (!nfs.length) return '<p class="tb-vazio">Nenhuma nota fiscal para este credor.</p>';
    const brutoPor = new Map();
    for (const p of pag) {
      const k = chavePP(p.codigo_unidade, p.numero_documento, p.data);
      brutoPor.set(k, (brutoPor.get(k) || 0) + bruto(p));
    }
    const outros = nfs.filter(outroEmitente).length;
    const ord = [...nfs].sort((a, b) => (a.data || '').localeCompare(b.data || '') || (a.data_nf || '').localeCompare(b.data_nf || ''));
    return `<p class="dd-tot">${formatInt(nfs.length)} nota(s) · total <b>${rs(soma(nfs, n => num(n.valor)))}</b>${outros ? ` · <span class="dd-ruim">${outros} emitida(s) por outro CPF/CNPJ</span>` : ''}</p>
      <div class="table-wrapper dd-rolo">${tabNotas(ord, brutoPor)}</div>`;
  }

  function linhaQuadro(titulo, rotHtml, rotTxt, lista, tot) {
    const id = `g${S.grupos.size}`;
    const chave = `q:${titulo}|${rotTxt}`;
    S.grupos.set(id, { titulo, rotulo: rotTxt, lista, chave });
    const v = soma(lista, p => num(p.valor));
    const ret = soma(lista, p => num(p.valor_retencoes));
    const aberto = S.abertos.has(chave);
    const multi = multiUnidade(lista);
    return `<tr class="dd-clicavel dd-q-l${aberto ? ' aberto' : ''}" data-g="${id}" title="Clique para ver os pagamentos">
        <td><span class="dd-seta">▸</span> ${rotHtml}</td><td class="tb-num">${lista.length}</td>
        <td class="tb-num"><b>${rs(v)}</b></td><td class="tb-num dd-pct">${barra(tot ? v / tot : 0)} ${pct(v, tot)}</td></tr>
      ${aberto ? `<tr class="dd-q-det"><td colspan="4">
        <div class="dd-q-cab"><span><b>${lista.length}</b> pagamento(s) · líquido <b>${rs(v)}</b> · retido ${rs(ret)} · bruto ${rs(v + ret)}</span>
          <button type="button" class="btn-ghost" data-acao="csv-grupo" data-g="${id}">&#8681; Exportar CSV</button></div>
        <div class="table-wrapper dd-rolo"><table class="dd-tab">
          <thead><tr><th>Data</th><th>PP nº</th><th>Empenho</th><th>Data emp.</th><th>Órgão</th><th>Natureza</th><th>Fonte</th>
            <th>Contrato</th><th class="tb-num">Líquido</th><th class="tb-num">Retido</th></tr></thead>
          <tbody>${[...lista].sort(ordemPagamento).map(p => `<tr>
            <td>${esc(dia(p.data))}</td><td class="dd-mono"><b>${pp(p.numero_documento, p)}</b></td>
            <td class="dd-mono">${esc(p.empenho)}</td><td>${esc(dia(p.data_empenho))}</td>
            <td>${txt(orgao(p, multi))}</td><td>${txt(p.natureza_tcm)}</td><td>${txt(p.classif_fonte_tcm || p.fonte_tcm)}</td>
            <td>${txt(p.contrato)}</td><td class="tb-num"><b>${rs(p.valor)}</b></td>
            <td class="tb-num">${num(p.valor_retencoes) ? rs(p.valor_retencoes) : '<span class="dd-mudo">—</span>'}</td></tr>`).join('')}
          </tbody></table></div></td></tr>` : ''}`;
  }

  function abaClassif(pag) {
    S.grupos = new Map();
    const tot = soma(pag, p => num(p.valor));
    const multi = multiUnidade(pag);
    const cab = () => `<thead><tr><th>Descrição</th><th class="tb-num">Pag.</th><th class="tb-num">Líquido</th><th class="tb-num">% do líquido</th></tr></thead>`;
    const simples = (titulo, campo) => `<div class="dd-quadro"><h4>${titulo}</h4>
      <div class="table-wrapper"><table class="dd-tab">${cab()}<tbody>${quadro(pag, campo).map(q => linhaQuadro(titulo, esc(q.rotulo), q.rotulo, q.lista, tot)).join('')}</tbody></table></div></div>`;
    const porCod = (titulo, qual, lugar) => {
      const com = emen(lugar);
      return `<div class="dd-quadro"><h4 class="dd-h4-emen">${titulo} ${caixaEmen(lugar)}</h4>
        <div class="table-wrapper"><table class="dd-tab">${cab()}<tbody>${quadroCodigo(pag, qual, com).map(o => {
          const rot = com ? classifHtml(o.ex, qual, true) : txt(o.maisUsada || '(não informado)');
          const variantes = o.nEscritas > 1 ? ` <span class="dd-tag" title="${esc(`Escrito de ${o.nEscritas} jeitos:\n${o.variantes.join('\n')}`)}">${o.nEscritas} escritas</span>` : '';
          const anos = o.mudouSentido ? ` <span class="dd-mudo">(${esc(o.anos.join(', '))})</span>` : '';
          return linhaQuadro(titulo, `${rot}${variantes}${anos}`, o.rotulo, o.lista, tot);
        }).join('')}</tbody></table></div></div>`;
    };
    return `<p class="dd-mudo dd-dica">Clique numa linha para ver os pagamentos dela e exportar em CSV.</p>
      <div class="dd-quadros">
      ${porCod('Natureza da despesa (TCM)', 'nat', 'q_nat')}
      ${porCod('Fonte de recurso (TCM)', 'fonte', 'q_fonte')}
      ${simples('Órgão', p => orgao(p, multi))}
      ${multi ? simples('Unidade pagadora', p => `${entDe(p)} (${munDe(p)})`) : ''}
      ${simples('Ação', 'acao')}
      ${simples('Função / subfunção', p => [p.funcao, p.subfuncao].filter(Boolean).join(' · '))}
      ${simples('Conta bancária pagadora', 'conta_bancaria')}
      ${simples('Tipo de documento', p => String(p.tipo_documento || '').replace(/,?\s*n[ºo°]\s*\d+.*$/i, '').trim())}
      ${simples('Tipo de empenho', 'tipo_empenho')}
    </div>`;
  }

  function atual() {
    const base = doCredor(t, S.doc, '*', '');
    if (S.mun == null) {
      const tem = !!munCadeia && [...base.unidades.values()].some(u => u.chave === munCadeia);
      S.mun = tem ? munCadeia : '*';
      S.munAviso = !tem && munCadeia && base.todos.length ? municipio : '';
    }
    return doCredor(t, S.doc, S.mun, S.uni);
  }

  function desenhar() {
    const d = atual();
    S.idx = indices(d.ret, d.nfs);
    S.pagAtual = d.pag;
    const credor = credores.find(c => c.documento === S.doc);
    const munsDe = doc => new Set((t.detalhes || []).filter(p => p.documento === doc).map(p => munChave(munDe(p)))).size;
    const chips = credores.length ? credores.map(c => {
      const n = c.pagamentos != null ? c.pagamentos : (t.detalhes || []).filter(p => p.documento === c.documento).length;
      return `<button type="button" class="dd-cred" data-doc="${esc(c.documento)}" aria-pressed="${c.documento === S.doc}" title="${esc(c.papel || '')}">
        <b>${esc(c.nome || '(sem nome)')}</b>
        <span>${esc(mascaraDoc(c.documento))}${c.papel ? ` · ${esc(c.papel)}` : ''}</span>
        <em>${n ? `${n} pagamento(s)${munsDe(c.documento) > 1 ? ` · ${munsDe(c.documento)} municípios` : ''}` : 'sem dados'}</em>
      </button>`;
    }).join('') : '<p class="tb-vazio">Nenhum credor nesta seção.</p>';

    let miolo;
    if (d.todos.length && !d.pag.length) {
      miolo = `${localHtml(d.todos, d.unidades)}<p class="tb-vazio">Nenhum pagamento deste credor com esse município/unidade.</p>`;
    } else if (!d.pag.length && !d.ret.length) {
      miolo = `<p class="tb-vazio">Nenhum pagamento detalhado para ${esc(credor ? (credor.nome || mascaraDoc(credor.documento)) : 'este credor')}.</p>`;
    } else {
      const aba = S.aba === 'pagamentos' ? abaPagamentos(d.pag, d.retUnicas, d.nfs)
        : S.aba === 'retencoes' ? abaRetencoes(d.retUnicas, d.pag)
          : S.aba === 'notas' ? abaNotas(d.nfs, d.pag)
            : S.aba === 'classif' ? abaClassif(d.pag)
              : abaContratos(d.pag);
      miolo = `${localHtml(d.todos, d.unidades)}${cartoesHtml(d.pag, d.retUnicas, d.nfs)}
        <div class="dd-barra-abas">
          <div class="seg iv-seg">${ABAS.map(([id, nome]) => `<button type="button" data-aba="${id}" aria-pressed="${S.aba === id}">${nome}${
            id === 'notas' && d.nfs.length ? ` (${d.nfs.length})` : id === 'retencoes' && d.retUnicas.length ? ` (${d.retUnicas.length})` : ''}</button>`).join('')}</div>
          <button type="button" class="btn-ghost" data-acao="csv" title="Os pagamentos (com o filtro da aba Pagamentos) em CSV">&#8681; Exportar CSV</button>
        </div>
        <div class="dd-aba">${filtro ? `<p class="dd-filtro"><span class="iv-filtro-tag">Filtro ativo</span>
          Só pagamentos da classificação <b>${esc(filtro)}</b></p>` : ''}${aba}</div>`;
    }
    raiz.innerHTML = `<div class="dd-creds">${chips}</div>${miolo}
      ${t.escopo ? `<p class="dd-nota">Este pacote traz só os pagamentos de <b>${esc(t.escopo)}</b>.</p>` : ''}
      ${t.cortado ? '<p class="dd-ruim">A lista chegou cortada no limite de linhas — os totais valem só para o que veio no arquivo.</p>' : ''}
      <p class="dd-nota">Fonte: consulta pública de despesas do TCM-BA. <b>Líquido</b> é o valor pago ao credor;
        <b>retido</b> é o que a prefeitura reteve (IRRF, ISS, INSS...); <b>bruto</b> = líquido + retido.
        Quando o portal não informa a data do pagamento na ficha, vale a data da lista.</p>`;
  }

  const novoLocal = (mun, uni) => {
    S.mun = mun; S.uni = uni || ''; S.munAviso = '';
    S.f = FILTRO_VAZIO(); S.mostrar = PASSO;
    desenhar();
  };
  const csv = (lista, nome) => downloadCSV(nome, COLUNAS_CSV.map(c => c[0]), linhasCsv(lista));

  raiz.addEventListener('click', e => {
    if (e.target.closest('a[data-pdf]')) return;
    const b = e.target.closest('[data-doc], [data-aba], [data-acao], .dd-linha, .dd-c-l, .dd-q-l, .dd-dist-l');
    if (!b || !raiz.contains(b)) return;
    if (b.dataset.doc) {
      S.doc = b.dataset.doc;
      S.mun = null; S.uni = ''; S.f = FILTRO_VAZIO(); S.mostrar = PASSO; S.abertos = new Set();
      desenhar();
    } else if (b.dataset.aba) {
      S.aba = b.dataset.aba;
      desenhar();
    } else if (b.dataset.acao) {
      const a = b.dataset.acao;
      if (a === 'local-todos') novoLocal('*', '');
      else if (a === 'local-cadeia') novoLocal(munCadeia, '');
      else if (a === 'limpar') { S.f = FILTRO_VAZIO(); desenhar(); }
      else if (a === 'mais') { S.mostrar += PASSO; desenhar(); }
      else if (a === 'saiba-empenho') saibaEmpenho();
      else if (a === 'ver-pag') {
        S.aba = 'pagamentos';
        S.f = { ...FILTRO_VAZIO(), contrato: b.dataset.contrato || '(sem)', cuni: b.dataset.cuni || '' };
        S.mostrar = PASSO;
        desenhar();
        raiz.scrollIntoView({ block: 'start', behavior: 'smooth' });
      } else if (a === 'csv') {
        S.f.multi = multiUnidade(S.pagAtual);
        csv(filtrar(S.pagAtual, S.f).sort(ordemPagamento), `DESPESA_DETALHADA_${S.doc}.csv`);
      } else if (a === 'csv-grupo') {
        e.stopPropagation();
        const g = S.grupos.get(b.dataset.g);
        if (g) csv([...g.lista].sort(ordemPagamento), `DESPESA_${S.doc}_${nomeArq(g.titulo)}_${nomeArq(g.rotulo) || 'NAO_INFORMADO'}.csv`);
      }
    } else if (b.classList.contains('dd-linha')) {
      if (e.target.closest('a, input, label')) return;
      const k = b.dataset.chave;
      const prox = b.nextElementSibling;
      if (S.abertos.has(k)) {
        S.abertos.delete(k);
        b.classList.remove('aberto');
        if (prox && prox.classList.contains('dd-ficha-tr')) prox.remove();
      } else {
        S.abertos.add(k);
        b.classList.add('aberto');
        const p = S.pagAtual.find(x => String(x.id) === b.dataset.id);
        if (p) b.insertAdjacentHTML('afterend', fichaTr(p));
      }
    } else if (b.classList.contains('dd-c-l')) {
      if (e.target.closest('a, input, label')) return;
      const k = b.dataset.chave;
      if (S.abertos.has(k)) S.abertos.delete(k); else S.abertos.add(k);
      desenhar();
    } else if (b.classList.contains('dd-q-l')) {
      const g = S.grupos.get(b.dataset.g);
      if (!g) return;
      if (S.abertos.has(g.chave)) S.abertos.delete(g.chave); else S.abertos.add(g.chave);
      desenhar();
    } else if (b.classList.contains('dd-dist-l')) {

      if (S.uni === b.dataset.uni) novoLocal(b.dataset.mun, '');
      else novoLocal(b.dataset.mun, b.dataset.uni);
    }
  });

  raiz.addEventListener('change', e => {
    const el2 = e.target;
    if (el2.dataset.emen) {
      S.emen[el2.dataset.emen] = el2.checked;
      gravarEmentario(S.emen);
      desenhar();
    } else if (el2.dataset.sel === 'mun') {
      novoLocal(el2.value, '');
    } else if (el2.dataset.sel === 'uni') {
      novoLocal(S.mun, el2.value);
    } else if (el2.dataset.filtro) {
      S.f[el2.dataset.filtro] = el2.value;
      S.mostrar = PASSO;
      desenhar();
    }
  });

  let espera = null;
  raiz.addEventListener('input', e => {
    if (!('busca' in e.target.dataset)) return;
    clearTimeout(espera);
    const valor = e.target.value;
    espera = setTimeout(() => {
      S.f.busca = valor;
      S.mostrar = PASSO;
      desenhar();
      const nova = raiz.querySelector('[data-busca]');
      if (nova) { nova.focus(); nova.setSelectionRange(nova.value.length, nova.value.length); }
    }, 250);
  });

  desenhar();
}
