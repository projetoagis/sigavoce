import { escapeHtml, formatBRL, formatInt } from '../core/format.js';
import {
  lerPacote, PacoteError, mascaraDoc, porAnoClassificacao, lerCruzamentos, rotuloAnomes,
  classificacoes, recortePorPP,
} from '../core/pacote-parser.js';
import { daCadeia } from '../core/despesa-detalhes.js';
import { linkDoc, registrarPartes } from './painel-doc.js';
import { tabela } from './tabela.js';
import { NATUREZAS_ATENCAO, FONTES_ATENCAO } from '../core/pontos-atencao.js';
import { desenharGrafo } from './grafo.js';
import { desenharDespesaDetalhada } from './despesa-detalhes.js';

const $ = id => document.getElementById(id);
const S = { p: null, aba: '', classif: '' };

const casaClassif = d => !S.classif || d.classificacao === S.classif;
const ABAS_COM_FILTRO = new Set(['cadeia', 'tcm_detalhes']);

function avisoFiltro(detalhe = '') {
  if (!S.classif) return '';
  return `<div class="iv-filtro-local" role="status">
    <span class="iv-filtro-tag">Filtro ativo</span>
    <span class="iv-filtro-txt">Classificação: <b>${escapeHtml(S.classif)}</b>${detalhe ? ` · ${detalhe}` : ''}</span>
    <button type="button" class="btn-ghost" data-limpar-classif>Limpar filtro</button>
  </div>`;
}

const brl = v => (typeof v === 'number' ? formatBRL(v) : '—');
const dataBR = s => {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?/.exec(String(s || ''));
  return m ? `${m[3]}/${m[2]}/${m[1]}${m[4] ? ` ${m[4]}:${m[5]}` : ''}` : String(s || '');
};
const num = v => {
  if (typeof v === 'number') return v;
  const n = parseFloat(String(v || '').replace(/[^\d,-]/g, '').replace(',', '.'));
  return isNaN(n) ? 0 : n;
};

const ICO_PASTA = `<svg class="iv-ico iv-pasta" viewBox="0 0 20 16" aria-hidden="true">
  <path class="iv-pasta-fundo" d="M1 2.5A1.5 1.5 0 0 1 2.5 1h4.6l1.8 2h8.6A1.5 1.5 0 0 1 19 4.5v9A1.5 1.5 0 0 1 17.5 15h-15A1.5 1.5 0 0 1 1 13.5z"/>
  <path class="iv-pasta-frente iv-pasta-fechada" d="M1 5h18v8.5a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 1 13.5z"/>
  <path class="iv-pasta-frente iv-pasta-aberta" d="M3.6 6.5h15.6l-2 7.3a1.5 1.5 0 0 1-1.45 1.2H1.7z"/>
</svg>`;
const ICO_PDF = `<svg class="iv-ico iv-ico-pdf" viewBox="0 0 16 20" aria-hidden="true">
  <path class="iv-pdf-folha" d="M2 .5h8.3L15.5 5.7V18a1.5 1.5 0 0 1-1.5 1.5H2A1.5 1.5 0 0 1 .5 18V2A1.5 1.5 0 0 1 2 .5z"/>
  <path class="iv-pdf-dobra" d="M10.3.5v3.7a1.5 1.5 0 0 0 1.5 1.5h3.7"/>
  <rect class="iv-pdf-faixa" x="0" y="10" width="13" height="6" rx="1"/>
  <text x="6.5" y="14.6" text-anchor="middle">PDF</text>
</svg>`;

function linhaDoc(d) {
  const novo = S.p.novos.has(d.id);
  const nome = d.rotulo || d.arquivo || d.codigo || `Documento ${d.n}`;
  return `<li class="iv-doc${novo ? ' iv-novo' : ''}">
    ${ICO_PDF}
    <span class="iv-n">DOC ${d.n}</span>
    <span class="iv-doc-corpo">
      <span class="iv-doc-nome">${escapeHtml(nome)}</span>
      <span class="iv-doc-meta">${escapeHtml(d.tipo_nome)}${d.competencia ? ` · ${escapeHtml(d.competencia)}` : ''}${d.paginas ? ` · ${d.paginas} pág.` : ''}${d.conjunto ? ` · parte de "${escapeHtml(d.conjunto)}"` : ''}${d.classificacao ? ` · ${escapeHtml(d.classificacao)}` : ''}</span>
      ${d.obs ? `<span class="iv-doc-obs">${escapeHtml(d.obs)}</span>` : ''}
      ${d.alertas && d.alertas.length ? `<span class="iv-doc-alerta">${d.alertas.length} ponto(s) de atenção</span>` : ''}
    </span>
    ${novo ? '<span class="iv-tag-novo">novo</span>' : ''}
    ${d.url ? linkDoc(d, 'Abrir', 'iv-pdf') : ''}
  </li>`;
}

const listaDocs = docs => `<ul class="iv-docs">${docs.map(linhaDoc).join('')}</ul>`;

function grupoDocs(titulo, docs, { porCompetencia = false, aberto = false } = {}) {
  if (!docs.length) return '';
  const novos = docs.filter(d => S.p.novos.has(d.id)).length;
  let corpo;
  if (porCompetencia) {
    corpo = porAnoClassificacao(docs).map(a => `
      <details class="iv-sub">
        <summary>${ICO_PASTA}${escapeHtml(a.ano)} <i>(${a.grupos.reduce((s, g) => s + g.docs.length, 0)})</i></summary>
        ${a.grupos.map(g => `
          <details class="iv-sub iv-sub2">
            <summary>${ICO_PASTA}${escapeHtml(g.classificacao)} <i>(${g.docs.length})</i></summary>
            ${listaDocs(g.docs)}
          </details>`).join('')}
      </details>`).join('');
  } else {
    corpo = listaDocs(docs);
  }
  return `<details class="iv-grupo"${aberto ? ' open' : ''}>
    <summary>${ICO_PASTA}${escapeHtml(titulo)} <i>(${formatInt(docs.length)})</i>${novos ? ` <span class="iv-tag-novo">${novos} novo(s)</span>` : ''}</summary>
    ${corpo}
  </details>`;
}

function partesHtml(partes) {
  if (!partes || !partes.length) return '';
  return `<ul class="iv-partes">${partes.map(p => `
    <li><span class="iv-papel">${escapeHtml(p.papel || 'parte')}</span>
      ${escapeHtml(p.nome || '')}${p.documento ? ` <span class="iv-docnum">${escapeHtml(mascaraDoc(p.documento))}</span>` : ''}
      ${p.doc_valido === false ? '<span class="iv-invalido" title="O dígito verificador não confere">documento inválido</span>' : ''}</li>`).join('')}</ul>`;
}

function alertasHtml(alertas) {
  if (!alertas || !alertas.length) return '';
  return `<div class="iv-alertas"><span class="iv-rot">Pontos de atenção</span>${alertas.map(a => `
    <div class="iv-alerta iv-grav-${escapeHtml(a.gravidade || 'media')}">
      <b>${escapeHtml(a.titulo || a.tipo || '')}</b>${a.pagina ? ` <i>(pág. ${escapeHtml(a.pagina)})</i>` : ''}
      ${a.explicacao ? `<p>${escapeHtml(a.explicacao)}</p>` : ''}
      ${a.trecho ? `<blockquote>${escapeHtml(a.trecho)}</blockquote>` : ''}
    </div>`).join('')}</div>`;
}

function execucaoHtml(e) {
  if (!e) return '';
  return `<div class="iv-exec">
    <span class="iv-rot">Execução (pagamentos do TCM-BA)</span>
    <div class="iv-exec-num">
      <span><b>${brl(e.pago)}</b> pagos</span>
      ${e.n_pagamentos != null ? `<span>${formatInt(e.n_pagamentos)} pagamento(s)</span>` : ''}
    </div>
    ${e.unidade ? `<p class="iv-doc-meta">${escapeHtml(e.unidade)}${e.consultado_em ? ` · consultado em ${escapeHtml(dataBR(e.consultado_em))}` : ''}</p>` : ''}
  </div>`;
}

function blocoContratacao(b) {
  const d = b.docContrato || {};
  const doc = id => S.p.docPorId.get(id);
  const lista = ids => (ids || []).map(doc).filter(Boolean).filter(casaClassif);

  const qtd = ids => (S.classif ? `${formatInt(lista(ids).length)} <i>de ${formatInt((ids || []).length)}</i>` : formatInt((ids || []).length));
  const vig = b.vig_inicio || b.vig_fim ? `${dataBR(b.vig_inicio) || '?'} a ${dataBR(b.vig_fim) || '?'}` : (d.vigencia || '');
  return `<article class="iv-contrato">
    <div class="iv-contrato-cab">
      <div class="iv-contrato-id">
        <span class="iv-selo">Contrato</span>
        <span class="iv-contrato-ref">DOC ${b.n}${b.competencia ? ` · competência ${escapeHtml(b.competencia)}` : ''}</span>
        <h3>${escapeHtml(d.rotulo || d.arquivo || 'Contrato')}</h3>
        ${b.contratada ? `<p class="iv-contratada">${escapeHtml(b.contratada.nome)} <span class="iv-docnum">${escapeHtml(mascaraDoc(b.contratada.documento))}</span></p>` : ''}
      </div>
      ${d.url ? linkDoc(d, 'Abrir contrato', 'btn-ghost iv-abrir') : ''}
    </div>
    <div class="iv-contrato-num">
      <div><span class="iv-rot">Valor contratado</span><b>${brl(b.valor)}</b></div>
      <div><span class="iv-rot">Vigência</span><b>${escapeHtml(vig || '—')}</b></div>
      <div><span class="iv-rot">Aditivos (total de arquivos)</span><b>${qtd(b.aditivos)}</b>${b.aditivos_acrescimo ? `<i> + ${brl(b.aditivos_acrescimo)}</i>` : ''}</div>
      <div><span class="iv-rot">Processos de pagamento</span><b>${qtd(b.pagamentos)}</b></div>
    </div>
    ${b.objeto ? `<p class="iv-objeto"><span class="iv-rot">Objeto</span>${escapeHtml(b.objeto)}</p>` : ''}
    ${execucaoHtml(b.execucao)}
    ${partesHtml(d.partes)}
    ${alertasHtml(d.alertas)}
    ${grupoDocs('Origem (licitação / contratação)', [...lista(b.origem), ...lista(b.origem_herdada)])}
    ${grupoDocs('Aditivos e apostilamentos', lista(b.aditivos), { porCompetencia: lista(b.aditivos).length > 20 })}
    ${grupoDocs('Processos de pagamento', lista(b.pagamentos), { porCompetencia: true })}
    ${grupoDocs('Demais documentos', lista(b.demais))}
  </article>`;
}

function blocoVisivel(b) {
  if (!S.classif) return true;
  const ids = [b.contrato, ...(b.origem || []), ...(b.origem_herdada || []), ...(b.aditivos || []), ...(b.pagamentos || []), ...(b.demais || [])];
  return ids.some(i => { const d = S.p.docPorId.get(i); return d && casaClassif(d); });
}

function abaCadeia(el) {
  const p = S.p;
  const docs = p.docs.filter(casaClassif);
  const blocos = p.blocos.filter(blocoVisivel);
  const fora = p.fora.filter(casaClassif);
  const classes = classificacoes(p.docs);
  const semContrato = p.secoes.has('tcm_detalhes')
    ? 'Nenhum documento de contrato nesta cadeia. Os contratos que constam nos pagamentos estão na aba <b>Despesa detalhada</b>.'
    : 'Nenhum documento de contrato nesta cadeia.';
  el.innerHTML = `
    <div class="tb-barra">
      ${classes.length > 1 ? `<select class="filter-select iv-classif" title="Classificação (pasta do arquivo no TCM-BA)">
        <option value="">Todas as classificações (${formatInt(p.docs.length)})</option>
        ${classes.map(c => `<option value="${escapeHtml(c.nome)}"${c.nome === S.classif ? ' selected' : ''}>${escapeHtml(c.nome)} (${formatInt(c.n)})</option>`).join('')}
      </select>` : ''}
      <input type="search" class="filter-input iv-busca-docs" placeholder="Buscar documento por nome do arquivo, código, competência..." autocomplete="off" />
      <span class="tb-info">${S.classif ? `${formatInt(docs.length)} de ` : ''}${formatInt(p.docs.length)} documento(s)</span>
    </div>
    ${avisoFiltro(`${formatInt(docs.length)} de ${formatInt(p.docs.length)} documentos`)}
    <div class="iv-busca-res" hidden></div>
    <div class="iv-blocos">
      ${blocos.length ? blocos.map(blocoContratacao).join('') : (p.blocos.length ? '' : `<p class="tb-vazio">${semContrato}</p>`)}
      ${fora.length ? `<article class="iv-contrato">${grupoDocs(p.blocos.length ? 'Documentos fora de uma contratação' : 'Documentos da cadeia', fora,
    { aberto: true, porCompetencia: fora.length > 20 })}</article>` : ''}
      ${!blocos.length && !fora.length && S.classif ? '<p class="tb-vazio">Nenhum documento nesta classificação.</p>' : ''}
    </div>`;
  const res = el.querySelector('.iv-busca-res');
  const areaBlocos = el.querySelector('.iv-blocos');
  el.querySelector('.iv-busca-docs').addEventListener('input', e => {
    const t = e.target.value.trim().toLowerCase();
    areaBlocos.hidden = !!t;
    res.hidden = !t;
    if (!t) return;
    const achados = docs.filter(d => `${d.arquivo} ${d.codigo} ${d.competencia} ${d.rotulo} ${d.tipo_nome} ${d.classificacao} DOC ${d.n}`.toLowerCase().includes(t));
    res.innerHTML = achados.length ? listaDocs(achados.slice(0, 300)) + (achados.length > 300 ? `<p class="tb-vazio">Mostrando 300 de ${achados.length}. Refine a busca.</p>` : '')
      : '<p class="tb-vazio">Nenhum documento encontrado.</p>';
  });
  const sel = el.querySelector('.iv-classif');
  if (sel) sel.addEventListener('change', () => {
    if (!sel.value) { aplicarClassif(''); return; }
    confirmarClassif(sel.value, () => aplicarClassif(sel.value), () => { sel.value = S.classif; });
  });
}

function aplicarClassif(v) {
  S.classif = v;
  desenhar();
}

const URL_RESOLUCAO = 'https://www.tcm.ba.gov.br/wp-content/uploads/2018/12/resolucao-1379-2018-1.pdf';

function montarLembrete() {
  const el = document.createElement('div');
  el.className = 'iv-bolhas';
  el.innerHTML = `<div class="iv-lembrete-caixa" id="iv-lembrete-txt" role="note" hidden>
      <b>Atenção</b>
      <p>Os dados exibidos aqui foram coletados das consultas públicas do <b>Tribunal de Contas dos Municípios do
        Estado da Bahia (TCM-BA)</b>. O SIGA VOCÊ apenas organiza e analisa essas informações e não substitui a fonte oficial.</p>
      <p>Antes de tomar qualquer decisão, confira os dados no site oficial do TCM-BA.</p>
      <div class="iv-lembrete-acoes">
        <a href="https://www.tcm.ba.gov.br/" target="_blank" rel="noopener">Abrir o site do TCM-BA</a>
        <button type="button" class="btn-ghost" data-fechar>Fechar</button>
      </div>
    </div>
    <div class="iv-bolhas-linha">
      <button type="button" class="iv-bolha iv-bolha-aviso" data-bolha="sobre" aria-expanded="false" aria-controls="iv-lembrete-txt" aria-label="Sobre os dados">
        <span aria-hidden="true">&#9888;</span><em>Sobre os dados</em></button>
      <button type="button" class="iv-bolha" data-bolha="ajuda" aria-label="Ajuda"><span aria-hidden="true">?</span><em>Ajuda</em></button>
    </div>`;
  const btn = el.querySelector('[data-bolha="sobre"]');
  const caixa = el.querySelector('.iv-lembrete-caixa');
  const abrir = v => { caixa.hidden = !v; btn.setAttribute('aria-expanded', String(v)); btn.classList.toggle('aberta', v); };
  btn.addEventListener('click', () => abrir(caixa.hidden));
  el.querySelector('[data-bolha="ajuda"]').addEventListener('click', () => { abrir(false); abrirAjuda(); });
  el.querySelector('[data-fechar]').addEventListener('click', () => abrir(false));
  el.addEventListener('keydown', e => { if (e.key === 'Escape' && !caixa.hidden) { e.stopPropagation(); abrir(false); btn.focus(); } });
  $('inv-area').appendChild(el);
  return abrir;
}

const tabelaAtencao = (rotulo, lista) => `<div class="table-wrapper"><table class="dd-tab iv-atencao">
    <thead><tr><th>Código</th><th>${rotulo}</th><th>Por que olhar</th></tr></thead>
    <tbody>${lista.map(([cod, desc, motivo]) => `<tr><td class="dd-mono"><b>${escapeHtml(cod)}</b></td>
      <td>${escapeHtml(desc)}</td><td>${escapeHtml(motivo)}</td></tr>`).join('')}</tbody>
  </table></div>`;

function abrirAjuda() {
  const fundo = document.createElement('div');
  fundo.className = 'iv-modal-fundo';
  fundo.innerHTML = `<div class="iv-modal iv-ajuda" role="dialog" aria-modal="true" aria-labelledby="iv-ajuda-tit">
      <h3 id="iv-ajuda-tit">Ajuda</h3>
      <p>Sabemos que fiscalizar as contas do seu município não é tarefa simples, e você não precisa fazer isso sozinho.
        Conheça um pouco do nosso trabalho e por onde costumamos começar a análise.</p>
      <h4>Pontos de atenção: onde a fiscalização precisa olhar primeiro</h4>
      <p>Uma seleção de naturezas de despesa e fontes de recurso que concentram os problemas mais recorrentes nas contas
        municipais. Códigos e descrições conforme o <b>ementário vigente do TCM-BA (2026)</b> e a tabela de fontes padronizada pela STN.</p>
      <h5>Naturezas de despesa</h5>
      ${tabelaAtencao('Natureza da despesa', NATUREZAS_ATENCAO)}
      <h5>Fontes de recurso</h5>
      ${tabelaAtencao('Fonte de recurso', FONTES_ATENCAO)}
      <p class="iv-ajuda-nota">Nos documentos a fonte aparece com 4 dígitos (1751) ou com o complemento (1751.0000).
        O primeiro dígito indica o exercício: 1 = corrente, 2 = anteriores.</p>
      <div class="iv-ajuda-contato">
        <b>Precisa de apoio para fiscalizar o seu município?</b>
        Fale com a gente: <a href="mailto:atendimento@projetoagis.com">atendimento@projetoagis.com</a>
      </div>
      <div class="iv-modal-acoes"><button type="button" class="iv-modal-sim" data-r="ok">Fechar</button></div>
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
  fundo.querySelector('[data-r]').focus({ preventScroll: true });
}

let abrirLembrete = null;

function orientacaoResolucao() {
  const fundo = document.createElement('div');
  fundo.className = 'iv-modal-fundo';
  fundo.innerHTML = `<div class="iv-modal" role="dialog" aria-modal="true" aria-labelledby="iv-res-tit" aria-describedby="iv-res-txt">
      <h3 id="iv-res-tit">Prestação de Contas de Gestão</h3>
      <div id="iv-res-txt">
        <p>Saiba mais sobre a Prestação de Contas de Gestão na <b>Resolução TCM-BA nº 1.379/2018</b>.</p>
        <p>Consulte-a também se tiver dúvidas sobre as classificações oficiais.</p>
      </div>
      <div class="iv-modal-acoes">
        <a class="btn-ghost iv-res-link" href="${URL_RESOLUCAO}" target="_blank" rel="noopener">Abrir a resolução (PDF)</a>
        <button type="button" class="iv-modal-sim" data-r="ok">Entendi</button>
      </div>
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

function confirmarClassif(nome, aceitar, descartar) {
  const fundo = document.createElement('div');
  fundo.className = 'iv-modal-fundo';
  fundo.innerHTML = `<div class="iv-modal" role="alertdialog" aria-modal="true" aria-labelledby="iv-modal-tit" aria-describedby="iv-modal-txt">
      <h3 id="iv-modal-tit">Filtrar pela classificação</h3>
      <p class="iv-modal-classif">${escapeHtml(nome)}</p>
      <div id="iv-modal-txt">
        <p>Ao aplicar o filtro, os <b>detalhes dos pagamentos</b> (aba Despesa detalhada) passam a seguir o
          <b>número do processo de pagamento</b> × o que a prefeitura informou nos arquivos desta classificação.</p>
        <p>Fica só o pagamento cujo número de PP, no mesmo ano, está em um arquivo da classificação escolhida.</p>
      </div>
      <div class="iv-modal-acoes">
        <button type="button" class="btn-ghost" data-r="nao">Descartar</button>
        <button type="button" class="iv-modal-sim" data-r="sim">Aceitar</button>
      </div>
    </div>`;
  const fechar = sim => {
    document.removeEventListener('keydown', tecla, true);
    fundo.remove();
    (sim ? aceitar : descartar)();
  };
  const tecla = e => { if (e.key === 'Escape') { e.stopPropagation(); fechar(false); } };
  fundo.addEventListener('click', e => {
    const b = e.target.closest('[data-r]');
    if (b) fechar(b.dataset.r === 'sim');
    else if (e.target === fundo) fechar(false);
  });
  document.addEventListener('keydown', tecla, true);
  document.body.appendChild(fundo);
  fundo.querySelector('[data-r="sim"]').focus();
}

const rotuloDoc = d => {
  const nums = [...(S.p.rec.porDoc.get(d.n) || [])];
  return `DOC ${d.n}${nums.length ? ` (PP ${nums.join(', ')})` : ''}`;
};
const docsDe = ids => (ids || []).map(i => S.p.docPorId.get(i)).filter(Boolean);
const refDocs = ids => docsDe(ids).map(rotuloDoc).join(', ');
const refDocsHtml = ids => docsDe(ids).map(d => linkDoc(d, rotuloDoc(d))).join(', ');

function abaEnvolvidos(el) {
  tabela(el, {
    linhas: S.p.bruto.envolvidos || [],
    csv: 'envolvidos.csv',
    colunas: [
      { t: 'Nome', v: e => e.nome },
      { t: 'CPF/CNPJ', v: e => mascaraDoc(e.documento) },
      { t: 'Papel', v: e => (e.papeis || []).join(', ') },
      { t: 'Documentos', v: e => refDocs(e.documentos), html: e => refDocsHtml(e.documentos) },
    ],
  });
}

function abaGrafos(el) {
  const gs = S.p.bruto.grafos || [];
  el.innerHTML = `${gs.length > 1 ? `<div class="seg iv-seg">${gs.map((g, i) =>
    `<button type="button" data-g="${i}" aria-pressed="${i === 0}">${escapeHtml(g.titulo || `Grafo ${i + 1}`)}</button>`).join('')}</div>` : ''}
    <div class="iv-grafo"></div>`;
  const area = el.querySelector('.iv-grafo');
  const abrir = i => desenharGrafo(area, gs[i]);
  el.querySelectorAll('[data-g]').forEach(b => b.addEventListener('click', () => {
    el.querySelectorAll('[data-g]').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
    abrir(Number(b.dataset.g));
  }));
  if (gs.length) abrir(0);
}

function abaFuncionarios(el) {
  const emps = S.p.bruto.funcionarios || [];
  el.innerHTML = emps.map((e, i) => `
    <section class="iv-secao">
      <h3>${escapeHtml(e.razao_social || e.nome)} <span class="iv-docnum">${escapeHtml(mascaraDoc(e.cnpj))}</span></h3>
      <p class="iv-doc-meta">${formatInt((e.lista || []).length)} vínculo(s) registrado(s)${e.estado === 'vazia' ? ' · consultada, sem funcionários' : ''}${e.mei ? ' · optante pelo MEI' : ''}</p>
      <div class="iv-tab-f" data-i="${i}"></div>
    </section>`).join('') || '<p class="tb-vazio">Nenhuma empresa.</p>';
  el.querySelectorAll('.iv-tab-f').forEach(div => {
    const e = emps[Number(div.dataset.i)];
    tabela(div, {
      linhas: e.lista || [],
      csv: `funcionarios_${e.cnpj}.csv`,
      colunas: [
        { t: 'Nome', v: f => f.nome },
        { t: 'CPF', v: f => mascaraDoc(f.cpf) },
        { t: 'Cargo', v: f => f.cargo },
        { t: 'Admissão', v: f => f.data_admissao },
        { t: 'Demissão', v: f => f.data_demissao },
        { t: 'Salário', v: f => num(f.salario), html: f => escapeHtml(f.salario || ''), num: true },
      ],
    });
  });
}

function abaSocios(el) {
  const emps = S.p.bruto.socios || [];
  el.innerHTML = emps.map(e => `
    <section class="iv-secao">
      <h3>${escapeHtml(e.razao_social || e.nome)} <span class="iv-docnum">${escapeHtml(mascaraDoc(e.cnpj))}</span></h3>
      <p class="iv-doc-meta">Situação: <b>${escapeHtml(e.situacao || '—')}</b> · início de atividade: ${escapeHtml(e.inicio || '—')}${e.contratos ? ` · ${formatInt(e.contratos)} contrato(s) na cadeia` : ''}</p>
      <div class="table-wrapper"><table>
        <thead><tr><th>Sócio</th><th>Tipo</th><th>Documento</th><th>Qualificação</th><th>Entrada</th><th>Faixa etária</th><th>Representante</th></tr></thead>
        <tbody>${(e.socios || []).map(s => `<tr><td>${escapeHtml(s.nome)}</td><td>${escapeHtml(s.tipo || '')}</td><td>${escapeHtml(s.doc || '')}</td>
          <td>${escapeHtml(s.qualificacao || '')}</td><td>${escapeHtml(s.entrada || '')}</td><td>${escapeHtml(s.faixa || '')}</td>
          <td>${s.rep_nome ? `${escapeHtml(s.rep_nome)}${s.rep_qualif ? ` <i>(${escapeHtml(s.rep_qualif)})</i>` : ''}${s.rep_doc ? ` ${escapeHtml(s.rep_doc)}` : ''}` : ''}</td></tr>`).join('')
          || '<tr><td colspan="7" class="tb-vazio">Sem sócios informados.</td></tr>'}</tbody>
      </table></div>
    </section>`).join('') || '<p class="tb-vazio">Nenhuma empresa.</p>';
}

function abaDespesa(el) {
  const todos = S.p.bruto.tcm_detalhes || {};
  let t = todos;
  if (S.classif) {
    const mun = S.p.cadeia.municipio || '';
    t = recortePorPP(todos, (numero, l) => daCadeia(l, mun)
      && ((S.p.rec.info(l.documento, l.codigo_unidade, numero, l.data || l.data_retencao) || {}).docs || []).some(a => casaClassif(a.d)));
  }
  el.innerHTML = `${avisoFiltro(`${formatInt((t.detalhes || []).length)} de ${formatInt((todos.detalhes || []).length)} pagamentos,
    casados pelo número do processo de pagamento com os arquivos desta classificação`)}
    <div class="iv-dd"></div>`;
  desenharDespesaDetalhada(el.querySelector('.iv-dd'), t, {
    municipio: S.p.cadeia.municipio || '',
    filtro: S.classif,
    rec: S.p.rec,
  });
}

function abaFolha(el) {
  const f = S.p.bruto.folha || {};
  const sit = f.situacoes || {};
  const porCpf = new Map();
  for (const a of f.achados || []) {
    if (!porCpf.has(a.cpf)) porCpf.set(a.cpf, []);
    porCpf.get(a.cpf).push(a);
  }
  const linhas = (f.servidores || []).filter(s => porCpf.has(s.cpf));
  const v = f.varredura || {};
  el.innerHTML = `<p class="iv-doc-meta">Servidores da folha do município citados nos documentos da cadeia${v.origem ? ` · folha de ${escapeHtml(v.origem)}` : ''}${v.criado_em ? ` · cruzamento de ${escapeHtml(dataBR(v.criado_em))}` : ''}. Clique numa linha para ver onde aparece.</p>
    <div class="iv-tab-folha"></div>`;
  tabela(el.querySelector('.iv-tab-folha'), {
    linhas,
    csv: 'folha_x_cadeia.csv',
    ordem: { col: 5, desc: true },
    colunas: [
      { t: 'Nome', v: s => s.nome },
      { t: 'CPF', v: s => mascaraDoc(s.cpf) },
      { t: 'Cargos', v: s => ((s.perfil || {}).cargos || []).join(', ') },
      { t: 'Vínculo', v: s => ((s.perfil || {}).tipos || []).join(', ') },
      { t: 'Período', v: s => [(s.perfil || {}).ano_ini, (s.perfil || {}).ano_fim].filter(Boolean).join('–') },
      { t: 'Documentos', v: s => new Set(porCpf.get(s.cpf).map(a => a.doc)).size, num: true },
      { t: 'Recebido na folha', v: s => (s.perfil || {}).total || 0, html: s => brl((s.perfil || {}).total), num: true },
      { t: 'Situação', v: s => (sit[s.cpf] || {}).situacao_txt || '' },
    ],
    detalhe: s => `<ul class="iv-ocorr">${porCpf.get(s.cpf).map(a => {
      const d = S.p.docPorId.get(a.doc);
      return (a.ocorrencias || []).map(o => `<li><b>${d ? linkDoc(d, rotuloDoc(d)) : 'Documento'}</b>${d && d.competencia ? ` · ${escapeHtml(d.competencia)}` : ''} · pág. ${escapeHtml(o.pagina)}<br><span class="iv-trecho">${escapeHtml(o.trecho || '')}</span></li>`).join('');
    }).join('')}</ul>`,
  });
}

function abaCruzamentos(el) {
  const linhas = lerCruzamentos(S.p.bruto.func_cruzamentos, S.p.nomes).filter(r => r.apontamentos.length);
  const faixa = l => (l.length ? `${rotuloAnomes(l[0])} a ${rotuloAnomes(l[l.length - 1])}` : '');
  el.innerHTML = `<p class="iv-doc-meta">Funcionários das contratadas cruzados com a folha do município, os documentos da cadeia e outras fontes. Só aparecem os que têm algum apontamento.</p>
    <div class="iv-tab-cruz"></div>`;
  tabela(el.querySelector('.iv-tab-cruz'), {
    linhas,
    csv: 'cruzamentos_funcionarios.csv',
    ordem: { col: 2, desc: true },
    colunas: [
      { t: 'Nome', v: r => r.nome, html: r => (r.nome ? escapeHtml(r.nome) : '<i class="iv-sem-nome">nome não informado</i>') },
      { t: 'CPF', v: r => mascaraDoc(r.cpf) },
      { t: 'Apontamentos', v: r => r.apontamentos.length, num: true },
      { t: 'Motivos', v: r => r.apontamentos.map(m => m.rotulo).join(' | '),
        html: r => r.apontamentos.map(m => `<span class="iv-chip">${escapeHtml(m.rotulo)}</span>`).join('') },
      { t: 'Meses na folha', v: r => r.folha.length, num: true },
      { t: 'Documentos', v: r => r.docs.length, num: true },
    ],
    detalhe: r => `<dl class="gr-ficha-dl">
      ${r.folha.length ? `<dt>Folha do município</dt><dd>${r.folha.length} mês(es): ${escapeHtml(faixa(r.folha))}</dd>` : ''}
      ${r.docs.length ? `<dt>Documentos da cadeia</dt><dd>${refDocsHtml(r.docs)}</dd>` : ''}
      ${r.pag.length ? `<dt>Pagamentos</dt><dd>${escapeHtml(r.pag.join(' · '))}</dd>` : ''}
      ${r.aux.length ? `<dt>Benefícios</dt><dd>${escapeHtml(r.aux.join(' · '))}</dd>` : ''}
      ${r.tse.length ? `<dt>Eleições</dt><dd>${escapeHtml(r.tse.join(' · '))}</dd>` : ''}
    </dl>`,
  });
}

function abaBeneficios(el) {
  const pessoas = Object.values((S.p.bruto.beneficios || {}).pessoas || {}).filter(p => (p.beneficios || []).length);
  el.innerHTML = `<p class="iv-doc-meta">Pessoas da cadeia com benefício social registrado no Portal da Transparência nos meses em que aparecem nos documentos ou na folha.</p>
    <div class="iv-tab-ben"></div>`;
  tabela(el.querySelector('.iv-tab-ben'), {
    linhas: pessoas,
    csv: 'beneficios_sociais.csv',
    colunas: [
      { t: 'Nome', v: p => p.nome },
      { t: 'CPF', v: p => mascaraDoc(p.cpf) },
      { t: 'Papel', v: p => p.papel },
      ...(pessoas.some(p => p.nivel) ? [{ t: 'Nível', v: p => p.nivel }] : []),
      { t: 'Programas', v: p => [...new Set(p.beneficios.map(b => b.nome_programa))].join(', ') },
      { t: 'Meses', v: p => p.beneficios.map(b => rotuloAnomes(b.anomes)).join(', ') },
      { t: 'Total', v: p => p.beneficios.reduce((s, b) => s + (Number(b.valor) || 0), 0),
        html: p => brl(p.beneficios.reduce((s, b) => s + (Number(b.valor) || 0), 0)), num: true },
    ],
    detalhe: p => `<ul class="iv-ocorr">${p.beneficios.map(b => `<li><b>${escapeHtml(b.nome_programa)}</b> · ${escapeHtml(rotuloAnomes(b.anomes))} · ${brl(b.valor)}
      ${b.municipio ? ` · ${escapeHtml(b.municipio)}` : ''}${(b.docs || []).length ? ` · ${refDocsHtml(b.docs)}` : ''}</li>`).join('')}</ul>`,
  });
}

function textoFormatado(t) {
  return escapeHtml(t).split('\n').map(l => {
    const h = /^(#{1,4})\s+(.*)$/.exec(l);
    if (h) return `<h4>${h[2]}</h4>`;
    if (/^\s*[-*]\s+/.test(l)) return `<li>${l.replace(/^\s*[-*]\s+/, '')}</li>`;
    return l.trim() ? `<p>${l}</p>` : '';
  }).join('').replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
}

function abaAnalises(el) {
  const as = S.p.bruto.analises || [];
  el.innerHTML = as.map(a => `<article class="iv-analise">
    <p class="iv-doc-meta">Análise de ${escapeHtml(dataBR(a.em))}${a.parcial ? ' · parcial' : ''}</p>
    ${textoFormatado(a.resultado || '')}
  </article>`).join('') || '<p class="tb-vazio">Nenhuma análise no pacote.</p>';
}

function temDados(id, v) {
  if (v == null) return false;
  if (Array.isArray(v)) return v.length > 0;
  if (id === 'tcm_detalhes') return (v.detalhes || []).length > 0;
  if (id === 'folha') return (v.achados || []).length > 0;
  if (id === 'beneficios') return Object.values(v.pessoas || {}).some(p => (p.beneficios || []).length);
  if (typeof v === 'object') return Object.keys(v).length > 0;
  return true;
}

const ABAS = [
  { id: 'cadeia',           nome: 'Cadeia',               fn: abaCadeia },
  { id: 'envolvidos',       nome: 'Envolvidos',           fn: abaEnvolvidos },
  { id: 'grafos',           nome: 'Relacionamentos',      fn: abaGrafos },
  { id: 'socios',           nome: 'Sócios',               fn: abaSocios },
  { id: 'funcionarios',     nome: 'Funcionários',         fn: abaFuncionarios },
  { id: 'tcm_detalhes',     nome: 'Despesa detalhada',    fn: abaDespesa },
  { id: 'folha',            nome: 'Folha × cadeia',       fn: abaFolha },
  { id: 'func_cruzamentos', nome: 'Cruzamentos',          fn: abaCruzamentos },
  { id: 'beneficios',       nome: 'Benefícios sociais',   fn: abaBeneficios },
  { id: 'analises',         nome: 'Análise',              fn: abaAnalises },
];

const CONTAGENS = {
  documentos: 'documentos', n_envolvidos: 'envolvidos', n_grafos: 'grafos', n_funcionarios: 'funcionários',
  n_socios: 'empresas com sócios', n_tcm_detalhes: 'pagamentos na Despesa detalhada', n_folha: 'achados na folha',
  n_func_cruzamentos: 'cruzamentos', n_beneficios: 'pessoas com benefício',
};

function novidadesHtml(p) {
  const nv = p.novidades;
  if (!nv) return '';
  const itens = [];
  if ((nv.documentos_novos || []).length) itens.push(`<b>${nv.documentos_novos.length}</b> documento(s) novo(s) — marcados como <span class="iv-tag-novo">novo</span>`);
  if ((nv.documentos_removidos || []).length) itens.push(`<b>${nv.documentos_removidos.length}</b> documento(s) retirado(s)`);
  if ((nv.envolvidos_novos || []).length) itens.push(`<b>${nv.envolvidos_novos.length}</b> envolvido(s) novo(s)`);
  if ((nv.grafos_alterados || []).length) itens.push(`<b>${nv.grafos_alterados.length}</b> grafo(s) atualizado(s)`);
  for (const [k, c] of Object.entries(nv.contagens || {})) {
    if (c && c.antes !== c.agora) itens.push(`${escapeHtml(CONTAGENS[k] || k.replace(/^n_/, '').replace(/_/g, ' '))}: ${formatInt(c.antes || 0)} → <b>${formatInt(c.agora || 0)}</b>`);
  }
  return `<div class="iv-novidades"><b>O que mudou desde a versão ${escapeHtml(p.pacote.anterior)}:</b>
    ${itens.length ? itens.join(' · ') : 'dados complementares atualizados.'}</div>`;
}

function clienteHtml(c) {
  if (!c) return '';
  return `<div class="iv-cliente">
    <span class="iv-rot">Cliente</span>
    <b>${escapeHtml(c.nome || 'não informado')}</b>
    ${c.cpf ? `<span class="iv-docnum">CPF ${escapeHtml(mascaraDoc(c.cpf))}</span>` : ''}
  </div>`;
}

function desenhar() {
  const p = S.p;
  const r = p.resumo;
  const abas = ABAS.filter(a => a.id === 'cadeia' || (p.secoes.has(a.id) && temDados(a.id, p.bruto[a.id])));
  if (!abas.some(a => a.id === S.aba)) S.aba = 'cadeia';
  $('inv-cab').innerHTML = `
    <div class="iv-cab-tit">
      <div>
        <span class="iv-rot">${escapeHtml(p.cadeia.municipio || '')}</span>
        <h2>${escapeHtml(p.cadeia.titulo || 'Pacote de investigação')}</h2>
        <p class="iv-doc-meta">Versão ${escapeHtml(p.pacote.versao || 1)}${p.pacote.nota ? ` · ${escapeHtml(p.pacote.nota)}` : ''} · gerado em ${escapeHtml(dataBR(p.gerado_em))}</p>
      </div>
      <div class="iv-cab-botoes">
        <button type="button" class="btn-ghost" id="inv-resolucao" title="Prestação de Contas de Gestão e classificações oficiais">Resolução TCM 1.379/2018</button>
        <button type="button" class="btn-reset" id="inv-outro">&#8634; Abrir outro arquivo</button>
      </div>
    </div>
    ${clienteHtml(p.cliente)}
    ${novidadesHtml(p)}
    <div class="summary-grid">
      <div class="card card--total"><div class="card-label">Documentos</div><div class="card-value">${formatInt(r.documentos || p.docs.length)}</div>
        <div class="card-sub">${Object.entries(r.por_papel || {}).map(([k, v]) => `${formatInt(v)} ${escapeHtml(k)}`).join(' · ')}</div></div>
      <div class="card card--saldo"><div class="card-label">Contratos</div><div class="card-value">${formatInt(r.contratos || 0)}</div>
        <div class="card-sub">valor contratado ${brl(r.valor_contratado)}</div></div>
      ${r.alertas != null ? `<div class="card card--negativo"><div class="card-label">Pontos de atenção</div><div class="card-value">${formatInt(r.alertas)}</div>
        <div class="card-sub">nos documentos da cadeia</div></div>` : ''}
      <div class="card card--positivo"><div class="card-label">Envolvidos</div><div class="card-value">${formatInt(r.n_envolvidos || 0)}</div>
        <div class="card-sub">pessoas e empresas nas partes</div></div>
    </div>
    <nav class="iv-abas" role="tablist">${abas.map(a => `<button type="button" role="tab" data-aba="${a.id}" aria-selected="${a.id === S.aba}">${a.nome}${
      S.classif && ABAS_COM_FILTRO.has(a.id) ? ' <span class="iv-aba-filtro" title="Filtro de classificação ativo nesta aba">filtrado</span>' : ''}</button>`).join('')}</nav>`;
  $('inv-outro').addEventListener('click', () => { resetInvestigacao(); $('inv-input').click(); });
  $('inv-resolucao').addEventListener('click', orientacaoResolucao);
  $('inv-cab').querySelectorAll('[data-aba]').forEach(b => b.addEventListener('click', () => { S.aba = b.dataset.aba; desenhar(); }));
  ABAS.find(a => a.id === S.aba).fn($('inv-corpo'));
}

function mostrarErro(msg) {
  $('inv-erro-texto').textContent = msg;
  $('inv-erro').hidden = !msg;
}

async function abrirArquivo(file) {
  mostrarErro('');
  if (!file) return;
  if (!/\.json$/i.test(file.name || '')) { mostrarErro('Selecione o arquivo .json do pacote de investigação.'); return; }
  try {
    S.p = lerPacote(await file.text());
  } catch (e) {
    mostrarErro(e instanceof PacoteError ? e.message : 'Não foi possível ler o arquivo.');
    return;
  }
  registrarPartes(S.p.rec.grupos);
  S.aba = 'cadeia';
  S.classif = '';
  $('inv-upload').hidden = true;
  $('inv-area').hidden = false;
  desenhar();
  window.scrollTo({ top: 0 });
  if (abrirLembrete) abrirLembrete(false);
  orientacaoResolucao();
}

export function resetInvestigacao() {
  S.p = null;
  S.classif = '';
  $('inv-cab').innerHTML = '';
  $('inv-corpo').innerHTML = '';
  $('inv-area').hidden = true;
  $('inv-upload').hidden = false;
  $('inv-input').value = '';
  mostrarErro('');
}

export function initInvestigacao() {
  abrirLembrete = montarLembrete();
  $('inv-area').addEventListener('click', e => {
    if (e.target.closest('[data-limpar-classif]')) aplicarClassif('');
  });
  const zona = $('inv-drop');
  const input = $('inv-input');
  zona.addEventListener('click', () => input.click());
  zona.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); } });
  input.addEventListener('change', () => abrirArquivo(input.files[0]));
  ['dragenter', 'dragover'].forEach(ev => zona.addEventListener(ev, e => { e.preventDefault(); zona.classList.add('drag-over'); }));
  ['dragleave', 'drop'].forEach(ev => zona.addEventListener(ev, e => { e.preventDefault(); zona.classList.remove('drag-over'); }));
  zona.addEventListener('drop', e => abrirArquivo(e.dataTransfer.files[0]));
}
