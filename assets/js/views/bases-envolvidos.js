import { escapeHtml as esc, formatBRL, formatInt } from '../core/format.js';
import { mascaraDoc } from '../core/pacote-parser.js';
import { NOME_CURTO } from '../core/bases-envolvidos.js';
import { tabela } from './tabela.js';

const rs = v => (v == null || v === '' ? '' : formatBRL(Number(v) || 0));

function tab(linhas, cols) {
  const usar = cols.filter(([, f]) => linhas.some(l => {
    const v = typeof f === 'function' ? f(l) : l[f];
    return v != null && v !== '';
  }));
  if (!linhas.length || !usar.length) return '';
  const val = (l, f) => (typeof f === 'function' ? f(l) : l[f]);
  return `<div class="table-wrapper"><table class="dd-tab"><thead><tr>${usar.map(([t, , num]) =>
    `<th${num ? ' class="tb-num"' : ''}>${esc(t)}</th>`).join('')}</tr></thead>
    <tbody>${linhas.map(l => `<tr>${usar.map(([, f, num]) =>
      `<td${num ? ' class="tb-num"' : ''}>${esc(val(l, f) ?? '')}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
}

function chaveValor(pares) {
  const ok = pares.filter(([, v]) => v);
  if (!ok.length) return '';
  return `<div class="table-wrapper"><table class="dd-tab dd-chave-valor"><tbody>${ok.map(([k, v]) =>
    `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`).join('')}</tbody></table></div>`;
}

const VIGENCIA = { vigente: 'vigente', encerrada: 'encerrada', indeterminada: 'indeterminada' };

const COLS_SANCAO = [
  ['Categoria', 'categoria_da_sancao'],
  ['Órgão sancionador', s => [s.orgao_sancionador, s.uf_orgao_sancionador].filter(Boolean).join(' / ')],
  ['Início', 'data_inicio_sancao'],
  ['Fim', 'data_final_sancao'],
  ['Situação', s => VIGENCIA[s.vigencia] || s.vigencia || ''],
  ['Abrangência', 'abragencia_da_sancao'],
  ['Processo', 'numero_do_processo'],
  ['Fundamentação', 'fundamentacao_legal'],
  ['Registro', s => (s.casamento === 'raiz' ? `outra filial (${mascaraDoc(s.doc_sancionado)})` : '')],
];

const DETALHE = {
  receita: v => chaveValor([
    ['Razão social', v.razao_social],
    ['Nome fantasia', v.fantasia],
    ['Atividade (CNAE)', [v.cnae, v.atividade].filter(Boolean).join(' - ')],
    ['Início de atividade', v.inicio],
    ['Situação cadastral', [v.situacao, v.situacao_em ? `desde ${v.situacao_em}` : '', v.motivo].filter(Boolean).join(' · ')],
    ['Município', [v.municipio, v.uf].filter(Boolean).join(' / ')],
    ['Matriz / filial', v.matriz],
  ]),
  socios: v => tab(v.socios || [], [
    ['Sócio', 'nome'], ['Tipo', 'tipo'], ['Documento', 'doc'], ['Qualificação', 'qualificacao'],
    ['Entrada', 'entrada'], ['Faixa etária', 'faixa'],
    ['Representante', s => [s.rep_nome, s.rep_qualif ? `(${s.rep_qualif})` : '', s.rep_doc].filter(Boolean).join(' ')],
  ]),
  ceis: v => tab(v.sancoes || [], COLS_SANCAO),
  cnep: v => tab(v.sancoes || [], [...COLS_SANCAO, ['Multa', 'valor_da_multa', true]]),
  cepim: v => tab(v.sancoes || [], [
    ['Entidade', 'nome_entidade'],
    ['Convênio', 'numero_convenio'],
    ['Órgão concedente', 'orgao_concedente'],
    ['Motivo do impedimento', 'motivo_do_impedimento'],
    COLS_SANCAO[8],
  ]),
  pgfn: v => `${tab(v.por_base || [], [['Tipo de dívida', 'rotulo'], ['Inscrições', 'n', true], ['Total', b => rs(b.total), true]])}
    ${tab(v.inscricoes || [], [
      ['Inscrição', 'numero_inscricao'], ['Tipo', 'base'], ['Situação', s => s.situacao_inscricao || s.tipo_situacao_inscricao || ''],
      ['Receita principal', 'receita_principal'], ['Data', 'data_inscricao'], ['Ajuizada', 'indicador_ajuizado'],
      ['Valor', s => rs(s.valor), true],
    ])}`,
  tse: v => tab(v.linhas || [], [
    ['Ano', 'ano'], ['Data', 'data'], ['Sentido', s => (s.sentido === 'recebido' ? 'recebeu da campanha' : s.sentido === 'enviado' ? 'pagou à campanha' : s.sentido || '')],
    ['Valor', s => rs(s.valor), true], ['Campanha (prestador)', 'nm_prestador_conta'], ['Cargo', 'ds_cargo_prestador_conta'],
    ['Operação', 'nm_operacao'],
  ]),
};

function detalheEnvolvido(l, bases) {
  return l.achados.map(a => `<div class="iv-base">
      <h4 class="dd-h4">${esc(a.rotulo)} <span class="iv-doc-meta">· ${esc(a.resumo)}</span></h4>
      ${(DETALHE[a.chave] || (() => ''))(a.v)}
      ${a.chave === 'pgfn' && bases.pgfn && bases.pgfn.nota ? `<p class="iv-doc-meta">${esc(bases.pgfn.nota)}.</p>` : ''}
      ${a.chave === 'tse' && (a.v.linhas || []).length < (a.v.n || 0) ? `<p class="iv-doc-meta">Mostrando os ${formatInt((a.v.linhas || []).length)} maiores de ${formatInt(a.v.n)} lançamentos.</p>` : ''}
    </div>`).join('');
}

export function desenharBases(el, b) {
  const lista = b.consultados.map(c => NOME_CURTO[c]).join(', ');
  el.innerHTML = `<h3>Bases públicas dos envolvidos</h3>
    <p class="iv-doc-meta">${lista ? `Cada CPF/CNPJ da cadeia consultado em: ${esc(lista)}. ` : ''}Só aparece quem tem registro em alguma base. Clique numa linha para ver os registros.</p>
    <div class="iv-tab-bases"></div>`;
  tabela(el.querySelector('.iv-tab-bases'), {
    linhas: b.linhas,
    csv: 'envolvidos_bases_publicas.csv',
    vazio: 'Nenhum envolvido com registro nas bases consultadas.',
    colunas: [
      { t: 'Nome', v: l => l.nome, html: l => (l.nome ? esc(l.nome) : '<i class="iv-sem-nome">nome não informado</i>') },
      { t: 'CPF/CNPJ', v: l => mascaraDoc(l.documento) },
      { t: 'Papel', v: l => l.papeis.join(', ') },
      { t: 'Bases', v: l => l.achados.map(a => `${NOME_CURTO[a.chave]}: ${a.resumo}`).join(' | '),
        html: l => l.achados.map(a => `<span class="iv-chip" title="${esc(a.resumo)}">${esc(NOME_CURTO[a.chave])}</span>`).join('') },
    ],
    detalhe: l => detalheEnvolvido(l, b.bases),
  });
}
