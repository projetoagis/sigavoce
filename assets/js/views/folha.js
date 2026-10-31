import { escapeHtml, formatInt, normStr, decodeText, isCurrencyCell } from '../core/format.js';
import { readSpreadsheet } from '../core/xls-reader.js';
import {
  RE_COMPETENCIA, parseFolhaMatrix, competenciaFromFilename, contentHash,
} from '../core/folha-parser.js';
import {
  COMPONENTES, buildSchema, toRecord, resumoGeral, porRegime, quadroRodape,
  analisarCargos, periodoDe, rotuloPeriodo,
} from '../core/folha-analise.js';
import { UNIDADES_TCMBA } from '../../data/unidades-tcmba.js';
import { fmt, tema, COR_COMPONENTE } from './charts.js';
import {
  MUNICIPIOS, municipioDaUnidade, municipioOficial, avisoMunicipios, duplicidades, faixaNomes, numerarPartes,
  montarProjeto, lerProjeto, nomeArquivoProjeto,
} from '../core/projeto-folha.js';
import { downloadCSV } from './download.js';
import { abrirRelatorio, initRelatorios, redesenharRelatorio, fecharRelatorio } from './folha-relatorios.js';
import { initComparacao, renderComparacao } from './folha-comparacao.js';

const PAGE_SIZE = 50;
const LIMITE_PARTE = 4000;

const HIDDEN_HEADERS = new Set(['Situação', 'Unidade']);
const PINNED_FIRST = ['Competência'];

const UNIDADES_NORM = UNIDADES_TCMBA.map(u => [u, normStr(u)]);
const MUNICIPIOS_NORM = MUNICIPIOS.map(m => [m, normStr(m)]);

const S = {
  queue       : [],
  headers     : null,
  schema      : null,
  currencyCols: [],
  colIndex    : {},
  recs        : [],
  filtered    : [],
  files       : [],
  hashes      : new Set(),
  municipio   : '',
  projeto     : false,
  page        : 1,
  sortChain   : [],
  corRegime   : new Map(),
  cargos      : null,
};

const dom = {};
const $ = id => document.getElementById(id);

function visibleCols() {
  if (!S.headers) return [];
  const pinned = PINNED_FIRST
    .map(name => S.colIndex[name])
    .filter(idx => idx != null && !HIDDEN_HEADERS.has(S.headers[idx]));
  const pinnedSet = new Set(pinned);
  const rest = [];
  S.headers.forEach((h, i) => {
    if (!HIDDEN_HEADERS.has(h) && !pinnedSet.has(i)) rest.push(i);
  });
  return pinned.concat(rest);
}

async function enqueueFiles(fileList) {
  hideError();
  const todos = Array.from(fileList);
  const csvs  = todos.filter(f => /\.csv$/i.test(f.name || ''));
  const files = todos.filter(f => /\.xlsx?$/i.test(f.name || ''));
  if (files.length === 0 && csvs.length === 0) {
    showError('Apenas arquivos .xls do TCM-BA ou o projeto .csv salvo aqui são aceitos.');
    return;
  }
  for (const f of csvs) {
    if (!(await abrirProjeto(f))) return;
  }
  if (files.length === 0) return;

  const items = files.map(f => ({
    uid        : Math.random().toString(36).slice(2),
    file       : f,
    competencia: competenciaFromFilename(f.name),
    unidade    : '',
    municipio  : '',
    munManual  : false,
    hash       : '',
    status     : 'reading',
    error      : '',
    parsed     : null,
  }));
  S.queue.push(...items);
  openModal();
  renderQueue();

  for (const q of items) {
    try {
      const { matrix } = await readSpreadsheet(await q.file.arrayBuffer(), q.file.name);
      q.parsed = parseFolhaMatrix(matrix);
      const det = q.parsed.detected;
      if (det.competencia) q.competencia = det.competencia;
      if (det.unidade)     q.unidade     = matchUnidade(det.unidade);
      q.municipio = sugerirMunicipio(q.unidade);
      q.hash = await contentHash(q.parsed.headers, q.parsed.rows);
      const iNome = q.parsed.headers.findIndex(h => normStr(h) === 'nome');
      q.faixa = faixaNomes(q.parsed.rows.map(r => r[iNome]));
      q.status = 'pending';
    } catch (err) {
      q.status = 'error';
      q.error  = err.message || 'Não foi possível ler o arquivo.';
    }
    renderQueue();
  }
}

function sugerirMunicipio(unidade) {
  return municipioDaUnidade(unidade) || S.municipio;
}

function matchUnidade(detected) {
  const n = normStr(detected);
  const hit = UNIDADES_NORM.find(([, un]) => un === n);
  return hit ? hit[0] : detected;
}

function openModal() {
  dom.modal.hidden = false;
  dom.modal.setAttribute('aria-hidden', 'false');
  document.body.style.overflow = 'hidden';
}

function closeModal() {
  dom.modal.hidden = true;
  dom.modal.setAttribute('aria-hidden', 'true');
  document.body.style.overflow = '';
  S.queue = [];
}

function removeFromQueue(uid) {
  S.queue = S.queue.filter(q => q.uid !== uid);
  renderQueue();
}

function statusHtml(q) {
  switch (q.status) {
    case 'reading': return '<div class="queue-status loading">⌛ Lendo planilha...</div>';
    case 'pending': return `<div class="queue-status ok">✓ ${formatInt(q.parsed.rows.length)} registro(s) encontrados` +
      (parcialDe(q) ? ` · completa a versão filtrada já aberta (${formatInt(parcialDe(q).carregadas)} de ${formatInt(parcialDe(q).count)} linhas)` : '') +
      (q.parsed.rows.length === LIMITE_PARTE ? ` · o TCM-BA divide folhas grandes em partes de ${formatInt(LIMITE_PARTE)}: se o mês tiver mais pessoas, carregue as outras partes também` : '') +
      '</div>';
    case 'error':   return `<div class="queue-status error">✗ ${escapeHtml(q.error)}</div>`;
    default:        return '';
  }
}

function renderQueue() {
  const list = dom.queueList;
  list.innerHTML = '';
  dom.queueEmpty.style.display = S.queue.length ? 'none' : '';

  for (const q of S.queue) {
    const li = document.createElement('li');
    li.className = 'queue-item';
    const compInvalid = q.competencia !== '' && !RE_COMPETENCIA.test(q.competencia);
    li.innerHTML = `
      <span class="queue-filename" title="${escapeHtml(q.file.name)}">${escapeHtml(q.file.name)}</span>
      <button class="queue-remove" type="button" data-uid="${q.uid}" aria-label="Remover">&times;</button>
      <div class="queue-fields">
        <div class="queue-field">
          <label for="comp-${q.uid}">Competência <span class="queue-field-hint">(MM-AAAA)</span></label>
          <input id="comp-${q.uid}" class="queue-input ${compInvalid ? 'invalid' : ''}"
                 type="text" inputmode="numeric" maxlength="7" placeholder="02-2025"
                 value="${escapeHtml(q.competencia)}"
                 data-uid="${q.uid}" data-field="competencia" autocomplete="off" />
        </div>
        <div class="queue-field">
          <label for="uni-${q.uid}">Unidade</label>
          <div class="uni-wrap">
            <input id="uni-${q.uid}" class="queue-input" type="text"
                   placeholder="Digite para buscar na lista do TCM-BA..."
                   value="${escapeHtml(q.unidade)}"
                   data-uid="${q.uid}" data-field="unidade" autocomplete="off"
                   role="combobox" aria-autocomplete="list" aria-expanded="false"
                   aria-controls="unidd-${q.uid}" />
            <ul class="uni-dropdown" id="unidd-${q.uid}" role="listbox" hidden></ul>
          </div>
        </div>
        <div class="queue-field">
          <label for="mun-${q.uid}">Município</label>
          <div class="uni-wrap">
            <input id="mun-${q.uid}" class="queue-input ${q.municipio && !municipioOficial(q.municipio) ? 'invalid' : ''}" type="text"
                   placeholder="Município da unidade"
                   value="${escapeHtml(q.municipio)}"
                   data-uid="${q.uid}" data-field="municipio" autocomplete="off"
                   role="combobox" aria-autocomplete="list" aria-expanded="false"
                   aria-controls="mundd-${q.uid}" />
            <ul class="uni-dropdown" id="mundd-${q.uid}" role="listbox" hidden></ul>
          </div>
        </div>
        ${statusHtml(q)}
      </div>
    `;
    list.appendChild(li);
  }

  list.querySelectorAll('.queue-remove').forEach(btn =>
    btn.addEventListener('click', () => removeFromQueue(btn.dataset.uid))
  );

  list.querySelectorAll('.queue-input').forEach(inp => {
    inp.addEventListener('input', e => {
      const q = S.queue.find(x => x.uid === e.target.dataset.uid);
      if (!q) return;
      if (e.target.dataset.field === 'competencia') {
        const v = e.target.value.replace(/[^\d-]/g, '').slice(0, 7);
        q.competencia = v;
        e.target.value = v;
        e.target.classList.toggle('invalid', v !== '' && !RE_COMPETENCIA.test(v));
      } else if (e.target.dataset.field === 'municipio') {
        q.municipio = e.target.value;
        q.munManual = true;
        e.target.classList.toggle('invalid', q.municipio.trim() !== '' && !municipioOficial(q.municipio));
      } else {
        setUnidade(q, e.target.value);
      }
      updateConfirmState();
    });
  });

  list.querySelectorAll('input[data-field="unidade"]').forEach(inp => bindAutocomplete(inp, 'unidd-', UNIDADES_NORM));
  list.querySelectorAll('input[data-field="municipio"]').forEach(inp => bindAutocomplete(inp, 'mundd-', MUNICIPIOS_NORM));
  updateConfirmState();
}

function setUnidade(q, valor) {
  q.unidade = valor;
  if (q.munManual) return;
  q.municipio = sugerirMunicipio(valor);
  const inp = $('mun-' + q.uid);
  if (inp) {
    inp.value = q.municipio;
    inp.classList.remove('invalid');
  }
}

function bindAutocomplete(inp, prefixo, lista) {
  const uid = inp.dataset.uid;
  const dd  = $(prefixo + uid);
  const close = () => { dd.hidden = true; inp.setAttribute('aria-expanded', 'false'); };

  function show(term) {
    const n = normStr(term);
    if (n.length < 2) return close();
    const hits = lista.filter(([, un]) => un.includes(n)).slice(0, 10);
    if (hits.length === 0) return close();
    dd.innerHTML = hits.map(([l]) =>
      `<li role="option" tabindex="-1" data-val="${escapeHtml(l)}">${escapeHtml(l)}</li>`
    ).join('');
    dd.hidden = false;
    inp.setAttribute('aria-expanded', 'true');
  }

  inp.addEventListener('input', () => show(inp.value));
  inp.addEventListener('focus', () => { if (inp.value) show(inp.value); });
  inp.addEventListener('blur',  () => setTimeout(close, 160));
  inp.addEventListener('keydown', e => {
    if (e.key === 'Escape') close();
    if (e.key === 'ArrowDown' && !dd.hidden) {
      const li = dd.querySelector('li');
      if (li) li.focus();
      e.preventDefault();
    }
  });
  dd.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown' && e.target.nextElementSibling) e.target.nextElementSibling.focus();
    if (e.key === 'ArrowUp') {
      if (e.target.previousElementSibling) e.target.previousElementSibling.focus();
      else inp.focus();
    }
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.target.click(); }
    if (e.key === 'Escape') { close(); inp.focus(); }
  });
  dd.addEventListener('click', e => {
    const li = e.target.closest('li');
    if (!li) return;
    inp.value = li.dataset.val;
    const q = S.queue.find(x => x.uid === uid);
    if (q && inp.dataset.field === 'municipio') {
      q.municipio = li.dataset.val;
      q.munManual = true;
      inp.classList.remove('invalid');
    } else if (q) setUnidade(q, li.dataset.val);
    close();
    updateConfirmState();
  });
}

function parcialDe(q) {
  return q.hash ? S.files.find(f => f.parcial && f.hash === q.hash) : null;
}

function itemFila(q) {
  return {
    unidade: (q.unidade || '').trim(), competencia: q.competencia, hash: q.hash, faixa: q.faixa,
    filename: q.file.name, municipio: municipioOficial(q.municipio),
  };
}

function problemasFila(ready) {
  const msgs = [];
  for (const q of ready) {
    const m = (q.municipio || '').trim();
    if (m && !municipioOficial(m)) msgs.push(`${q.file.name}: "${m}" não é um município da Bahia na lista do TCM-BA.`);
  }
  const aviso = avisoMunicipios(ready.map(q => municipioOficial(q.municipio)), S.municipio);
  if (aviso) msgs.push(aviso);
  const itens = ready.filter(q => (q.unidade || '').trim() && RE_COMPETENCIA.test(q.competencia || '')).map(itemFila);
  for (const d of duplicidades(S.files, itens)) msgs.push(`${itens[d.i].filename}: ${d.motivo}`);
  return msgs;
}

function updateConfirmState() {
  const ready = S.queue.filter(q => q.status === 'pending');
  const msgs  = problemasFila(ready);
  dom.modalAviso.innerHTML = msgs.map(m => `<li>${escapeHtml(m)}</li>`).join('');
  dom.modalAviso.hidden = msgs.length === 0;
  const completam = ready.filter(parcialDe);
  dom.modalInfo.innerHTML = completam.length
    ? `<li>${completam.length === ready.length ? 'Todas estas planilhas já estão' : `${completam.length} destas planilhas já estão`} no projeto aberto, ` +
      'mas só com as linhas filtradas. Convertendo, a versão filtrada é trocada pela planilha completa: nenhuma linha é somada duas vezes.</li>'
    : '';
  dom.modalInfo.hidden = completam.length === 0;
  const valid = ready.length > 0 && msgs.length === 0 &&
    !S.queue.some(q => q.status === 'reading') &&
    ready.every(q => RE_COMPETENCIA.test(q.competencia || '') && (q.unidade || '').trim() && municipioOficial(q.municipio));
  dom.modalConfirm.disabled = !valid;
  dom.modalLabel.textContent = ready.length > 1 ? `Converter ${ready.length} arquivos` : 'Converter';
}

function adicionarGrupo(g) {
  const headers = g.rawHeaders.concat(['Competência', 'Unidade']);
  if (S.headers === null) {
    S.headers      = headers;
    S.schema       = buildSchema(headers);
    S.currencyCols = g.currencyCols.slice();
    S.colIndex     = Object.fromEntries(headers.map((h, i) => [h, i]));
  } else if (!sameArr(S.headers, headers)) {
    return 'Estrutura de colunas diferente do(s) arquivo(s) anterior(es).';
  }
  const dup = duplicidades(S.files, [g]);
  if (dup.length) return dup[0].motivo;
  if (S.municipio && avisoMunicipios([g.municipio], S.municipio)) return avisoMunicipios([g.municipio], S.municipio);

  const parcialAntigo = S.files.find(f => f.parcial && f.hash === g.hash);
  if (parcialAntigo) {
    S.files = S.files.filter(f => f !== parcialAntigo);
    S.recs  = S.recs.filter(r => r.arq !== parcialAntigo);
  }

  const count = g.count ?? g.rows.length;
  const arq = {
    filename: g.filename, titulo: g.titulo || '', competencia: g.competencia, unidade: g.unidade, municipio: g.municipio,
    count, carregadas: g.rows.length, parcial: g.rows.length < count, faixa: g.faixa || null,
    hash: g.hash, resumo: g.resumo, calc: null,
  };
  const novos = g.rows.map((r, i) => {
    const rec = toRecord(r.concat([g.competencia, g.unidade]), S.schema);
    rec.ordem = g.ordens ? g.ordens[i] : i + 1;
    rec.arq = arq;
    return rec;
  });
  arq.calc = resumoGeral(novos).totals;
  S.recs.push(...novos);
  S.files.push(arq);
  numerarPartes(S.files);
  if (novos.length === count) S.hashes.add(g.hash);
  S.municipio = S.municipio || g.municipio;
  return '';
}

async function convertQueue() {
  const pendentes = S.queue.filter(x => x.status === 'pending');
  if (problemasFila(pendentes).length) return updateConfirmState();
  dom.modalConfirm.disabled = true;
  dom.modalLabel.textContent = 'Convertendo...';

  let hadError = false;
  let added = 0;
  let completadas = 0;

  for (const q of pendentes) {
    const { headers: rawHeaders, rows, currencyCols, resumo, titulo } = q.parsed;
    const hash = await contentHash(rawHeaders, rows);
    if (S.hashes.has(hash)) {
      q.status = 'error';
      q.error  = 'Esta planilha já foi carregada.';
      hadError = true;
      continue;
    }
    const completa = !!parcialDe(q);
    const erro = adicionarGrupo({
      rawHeaders, currencyCols, rows, resumo, hash, titulo,
      ...itemFila(q),
    });
    if (erro) {
      q.status = 'error';
      q.error  = erro;
      hadError = true;
      continue;
    }
    if (completa) completadas++;
    q.status = 'done';
    added++;
  }

  if (added === 0) {
    S.queue = S.queue.filter(q => q.status !== 'done');
    renderQueue();
    return;
  }

  const limpou = limparFiltros();
  const partes = [];
  if (completadas) {
    partes.push(`${completadas} planilha(s) completaram a versão filtrada que estava aberta; nenhuma linha foi duplicada.`);
    if (added > completadas) partes.push(`${added - completadas} planilha(s) entraram como novas.`);
  }
  if (limpou) partes.push('Os filtros foram limpos para o painel mostrar o total com as planilhas novas.');
  if (S.projeto) partes.push('O projeto atualizado foi baixado.');

  if (hadError) {
    S.queue = S.queue.filter(q => q.status !== 'done');
    renderQueue();
  } else {
    closeModal();
  }
  renderAll();
  if (partes.length && (completadas || limpou)) showError(partes.join(' '));
  if (S.projeto) baixarDepois();
}

function limparFiltros() {
  const campos = [dom.fNome, dom.fUnidade, dom.fAno, dom.fCompetencia, dom.fRegime, dom.fCargo];
  const ativo = campos.some(el => el.value);
  for (const el of campos) el.value = '';
  return ativo;
}

function baixarDepois() {
  setTimeout(() => salvarProjeto({ manterAviso: true }), 400);
}

async function abrirProjeto(file) {
  let p;
  try {
    p = await lerProjeto(decodeText(await file.arrayBuffer()));
  } catch (err) {
    showError(`${file.name}: ${err.message || 'não foi possível ler o projeto.'}`);
    return false;
  }
  if (S.municipio && avisoMunicipios([p.municipio], S.municipio)) {
    showError(`${file.name}: ${avisoMunicipios([p.municipio], S.municipio)}`);
    return false;
  }
  if (S.headers && !sameArr(S.headers, p.headers)) {
    showError(`${file.name}: estrutura de colunas diferente das planilhas já carregadas.`);
    return false;
  }
  const dup = duplicidades(S.files, p.grupos);
  if (dup.length) {
    showError(`${file.name}: ${dup[0].motivo} O projeto não foi aberto para não duplicar linhas.`);
    return false;
  }
  const tinhaDados = S.files.length > 0;
  const antes = {
    headers: S.headers, schema: S.schema, currencyCols: S.currencyCols, colIndex: S.colIndex,
    recs: S.recs.slice(), files: S.files.slice(), hashes: new Set(S.hashes), municipio: S.municipio,
  };
  const primeira = p.grupos[0].linhas[0].slice(0, p.rawHeaders.length);
  const currencyCols = [];
  primeira.forEach((v, c) => { if (isCurrencyCell(v)) currencyCols.push(c); });
  for (const g of p.grupos) {
    const erro = adicionarGrupo({
      rawHeaders: p.rawHeaders, currencyCols, resumo: g.resumo, hash: g.hash,
      rows: g.linhas.map(r => r.slice(0, p.rawHeaders.length)),
      ordens: g.ordens, count: g.ordens ? g.count : undefined, titulo: g.titulo, parcial: g.parcial, faixa: g.faixa,
      unidade: g.unidade, competencia: g.competencia, filename: g.filename, municipio: municipioOficial(g.municipio) || g.municipio,
    });
    if (erro) {
      Object.assign(S, antes);
      showError(`${file.name}: ${erro} O projeto não foi aberto.`);
      return false;
    }
  }
  S.projeto = true;
  const limpou = tinhaDados && limparFiltros();
  renderAll();
  if (p.legado) avisoExportado(file.name, p);
  else avisoParcial(file.name, p);
  if (limpou && dom.error.hidden) showError('Os filtros foram limpos para o painel mostrar o total com o projeto aberto.');
  if (tinhaDados) baixarDepois();
  return true;
}

function avisoParcial(nome, p) {
  const parciais = p.grupos.filter(g => g.parcial);
  if (!parciais.length) return;
  const lista = parciais.map(g => `${g.competencia} (${formatInt(g.linhas.length)} de ${formatInt(g.count)} linhas)`).join('; ');
  showError(`${nome}: arquivo exportado com filtro. Competência(s) parcial(is): ${lista}. ` +
    'A RCL e os totais declarados de cada planilha foram preservados, mas tabelas e somas mostram só as linhas presentes. ' +
    'Para completar, carregue o .xls da competência: ele substitui a parte filtrada, sem duplicar.');
  dom.error.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function avisoExportado(nome, p) {
  const partes = [
    `${nome}: aberto o CSV antigo de "Exportar CSV" de ${p.municipio}, ${p.grupos.length} competência(s).`,
    'Esse arquivo não traz o rodapé das planilhas (RCL e totais declarados), não tem conferência das linhas e, se foi exportado com filtro, tem só as linhas filtradas.',
    'Para ter tudo conferido e com a RCL, carregue os .xls do TCM-BA e salve o projeto.',
  ];
  showError(partes.join(' '));
  dom.error.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function salvarProjeto({ manterAviso = false } = {}) {
  if (!S.headers || S.files.length === 0) return;
  if (!manterAviso) hideError();
  let p;
  try {
    p = montarProjeto(S.headers, S.files, S.recs);
  } catch (err) {
    showError(err.message);
    return;
  }
  downloadCSV(nomeArquivoProjeto(p.municipio), p.headers, p.rows);
  S.projeto = true;
}

function sameArr(a, b) {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

function renderAll() {
  dom.uploadSec.style.display = 'none';
  dom.analysis.classList.add('visible');
  assignRegimeColors();
  updateHeader();
  populateFilters();
  applyFilters();
  if (dom.modal.hidden) dom.analysis.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function assignRegimeColors() {
  S.corRegime = new Map(porRegime(S.recs).map((g, i) => [normStr(g.regime), i < 8 ? i : -1]));
}

function corRegime(regime) {
  const t = tema();
  const i = S.corRegime.get(normStr(regime));
  return i == null || i < 0 ? t.other : t.series[i];
}

function updateHeader() {
  const periodos = [...new Set(S.files.map(f => periodoDe(f.competencia)))].sort();
  const unidades = new Set(S.files.map(f => f.unidade));
  dom.fileLabel.textContent = `${S.municipio ? S.municipio + ' · ' : ''}${S.files.length} planilha(s) carregada(s):`;
  dom.filenames.textContent =
    `${unidades.size} unidade(s) · ${periodos.length} competência(s)` +
    (periodos.length ? ` · ${rotuloPeriodo(periodos[0])}` + (periodos.length > 1 ? ` a ${rotuloPeriodo(periodos[periodos.length - 1])}` : '') : '');
  dom.filenames.title = S.files.map(f => `${f.filename} · ${f.competencia}${f.partes > 1 ? ` (parte ${f.parte} de ${f.partes})` : ''} · ${f.unidade}`).join('\n');
}

function fillSelect(sel, values, allLabel, labelOf = v => v) {
  const cur = sel.value;
  sel.innerHTML = `<option value="">${allLabel}</option>` +
    values.map(v => `<option value="${escapeHtml(v)}">${escapeHtml(labelOf(v))}</option>`).join('');
  if (cur && values.includes(cur)) sel.value = cur;
}

function populateFilters() {
  const uni = new Set(), anos = new Set(), comps = new Set(), reg = new Set(), car = new Set();
  const ano = dom.fAno.value;
  for (const r of S.recs) {
    uni.add(r.unidade);
    anos.add(r.ano);
    if (!ano || r.ano === ano) comps.add(r.comp);
    if (r.regime) reg.add(r.regime);
    if (r.cargo) car.add(r.cargo);
  }
  fillSelect(dom.fUnidade,     [...uni].sort(), 'Todas');
  fillSelect(dom.fAno,         [...anos].sort(), 'Todos');
  fillSelect(dom.fCompetencia, [...comps].sort((a, b) => periodoDe(a).localeCompare(periodoDe(b))), 'Todas');
  fillSelect(dom.fRegime,      [...reg].sort(), 'Todos');
  fillSelect(dom.fCargo,       [...car].sort((a, b) => a.localeCompare(b, 'pt-BR')), 'Todos');
}

function readFilters() {
  return {
    nome       : normStr(dom.fNome.value),
    unidade    : dom.fUnidade.value,
    ano        : dom.fAno.value,
    competencia: dom.fCompetencia.value,
    regime     : dom.fRegime.value,
    cargo      : dom.fCargo.value,
  };
}

function filtrar(f, { periodo = true, nome = true } = {}) {
  return S.recs.filter(r =>
    (!f.unidade || r.unidade === f.unidade) &&
    (!f.regime  || r.regime  === f.regime) &&
    (!f.cargo   || r.cargo   === f.cargo) &&
    (!periodo || !f.ano         || r.ano  === f.ano) &&
    (!periodo || !f.competencia || r.comp === f.competencia) &&
    (!nome    || !f.nome        || normStr(r.nome).includes(f.nome))
  );
}

function applyFilters() {
  const f = readFilters();
  let out = filtrar(f);

  if (S.sortChain.length > 0) {
    out = [...out].sort((a, b) => {
      for (const { idx, dir } of S.sortChain) {
        const av = sortValue(a.row[idx], idx);
        const bv = sortValue(b.row[idx], idx);
        if (typeof av === 'number' && typeof bv === 'number') {
          if (av !== bv) return (av - bv) * dir;
        } else {
          const c = String(av).localeCompare(String(bv), 'pt-BR');
          if (c !== 0) return c * dir;
        }
      }
      return 0;
    });
  }

  S.filtered = out;
  S.page = 1;
  S.cargos = analisarCargos(filtrar(f, { nome: false }));

  const active = Object.values(f).filter(Boolean).length;
  if (active === 0) {
    dom.filterStatus.textContent = '';
    dom.filterStatus.classList.remove('active');
  } else {
    dom.filterStatus.textContent =
      `${active} filtro(s) ativo(s) · ${formatInt(S.filtered.length)} de ${formatInt(S.recs.length)} registros`;
    dom.filterStatus.classList.add('active');
  }

  renderKpis();
  renderAlerta();
  renderReportBar();
  renderRegimePanel();
  renderRodapePanel();
  renderTable();
  renderComparacao(f.competencia ? periodoDe(f.competencia) : '');
}

function clearFilters() {
  for (const el of [dom.fNome, dom.fUnidade, dom.fAno, dom.fCompetencia, dom.fRegime, dom.fCargo]) el.value = '';
  populateFilters();
  applyFilters();
}

function sortValue(v, idx) {
  if (S.currencyCols.includes(idx)) return parseMoney(v);
  if (v == null || v === '') return '';
  const str = String(v).trim();
  const dm = str.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (dm) return Date.UTC(+dm[3], +dm[2] - 1, +dm[1]);
  const comp = str.match(/^(\d{2})-(\d{4})$/);
  if (comp) return +comp[2] * 100 + +comp[1];
  if (/^[+-]?\d/.test(str)) {
    const n = parseFloat(str.replace(/[^\d,.-]/g, '').replace(',', '.'));
    if (!isNaN(n)) return n;
  }
  return str.toLowerCase();
}

function parseMoney(s) {
  const str = String(s || '').trim();
  const neg = str.startsWith('-');
  const n = parseFloat(str.replace(/^-?\s*R\$\s*/i, '').replace(/\./g, '').replace(',', '.'));
  return isNaN(n) ? 0 : (neg ? -n : n);
}

function descreverEscopo() {
  const f = readFilters();
  const partes = [];
  if (f.unidade) partes.push(f.unidade);
  if (f.competencia) partes.push(`Competência ${f.competencia}`);
  else if (f.ano) partes.push(`Ano ${f.ano}`);
  if (f.regime) partes.push(`Regime: ${f.regime}`);
  if (f.cargo) partes.push(`Cargo: ${f.cargo}`);
  if (f.nome) partes.push(`Nome contém "${dom.fNome.value.trim()}"`);
  const g = resumoGeral(S.filtered);
  const per = g.periodos.length
    ? `${rotuloPeriodo(g.periodos[0])}${g.periodos.length > 1 ? ' a ' + rotuloPeriodo(g.periodos[g.periodos.length - 1]) : ''}`
    : '';
  const base = `${formatInt(g.registros)} registros · ${g.unidades.length} unidade(s) · ${g.periodos.length} competência(s)${per ? ' (' + per + ')' : ''}`;
  return (partes.length ? 'Filtros: ' + partes.join(' · ') + ' — ' : 'Todos os dados carregados — ') + base;
}

function filesNoEscopo() {
  const f = readFilters();
  return S.files.filter(x =>
    (!f.unidade || x.unidade === f.unidade) &&
    (!f.competencia || x.competencia === f.competencia) &&
    (!f.ano || periodoDe(x.competencia).startsWith(f.ano))
  );
}

function contextoRelatorio() {
  return {
    recs: S.filtered,
    quadro: quadroRodape(filesNoEscopo()),
    escopo: descreverEscopo(),
    cargos: S.cargos,
    cor: corRegime,
  };
}

function renderKpis() {
  const g = resumoGeral(S.filtered);
  const t = tema();
  const venc = g.totals.vencimentos;
  const multi = g.periodos.length > 1;

  const per = filesNoEscopo().filter(x => g.periodos.includes(periodoDe(x.competencia)) && g.unidades.includes(x.unidade));
  const rcl = per.length && new Set(per.map(x => x.unidade + '\x00' + x.competencia)).size === 1 ? per[0].resumo?.rclMensal : null;

  const mensal = multi
    ? `<div class="kpi-sub">Soma de <strong>${g.periodos.length}</strong> competências · média de ${fmt.brl(venc / g.periodos.length)}/mês</div>`
    : '<div class="kpi-sub">Salário base + Vantagens + Gratificação</div>';

  dom.kpis.innerHTML = `
    <div class="kpi">
      <div class="kpi-label">Total de vencimentos</div>
      <div class="kpi-value">${fmt.brl(venc)}</div>
      ${mensal}
    </div>
    <div class="kpi">
      <div class="kpi-label">Salário líquido</div>
      <div class="kpi-value">${fmt.brl(g.totals.liquido)}</div>
      <div class="kpi-sub">Média de <strong>${fmt.brl(g.mediaLiquido)}</strong> por servidor/mês</div>
    </div>
    <div class="kpi">
      <div class="kpi-label">Matrículas distintas</div>
      <div class="kpi-value">${fmt.int(g.matriculas)}</div>
      <div class="kpi-sub">${fmt.int(g.nomes)} nomes · ${fmt.int(g.registros)} registros${multi ? ` · ${g.periodos.length} competências` : ''}</div>
    </div>
    <div class="kpi${rcl ? '' : ' kpi--muted'}">
      <div class="kpi-label">Vencimentos ÷ RCL mensal</div>
      <div class="kpi-value">${rcl ? fmt.pct(venc / rcl) : '—'}</div>
      <div class="kpi-sub">${rcl ? `RCL de ${fmt.brl(rcl)} em ${escapeHtml(per[0].competencia)}` : 'Disponível com 1 unidade e 1 competência'}</div>
    </div>`;

  dom.comp.innerHTML = COMPONENTES.map(c => {
    const v = g.totals[c.key];
    const share = venc ? v / venc : 0;
    const cor = t.series[COR_COMPONENTE[c.key]];
    return `
      <div class="comp-item">
        <div class="comp-head"><span><span class="swatch" style="background:${cor}"></span>${escapeHtml(c.label)}</span>
          <span>${c.key === 'decimo' ? 'fora do total' : fmt.pct(share)}</span></div>
        <div class="comp-value">${fmt.brl(v)}</div>
        <div class="meter"><span style="width:${Math.min(100, share * 100).toFixed(1)}%;background:${cor}"></span></div>
      </div>`;
  }).join('');
}

function renderAlerta() {
  const c = S.cargos;
  const jornada = c.jornadaDivergente.reduce((n, j) => n + j.count, 0);
  const itens = [];
  if (c.semelhantes.length) itens.push(`<strong>${fmt.int(c.semelhantes.length)}</strong> par(es) de cargos parecem o mesmo, escritos de forma diferente (ex.: “${escapeHtml(c.semelhantes[0].aTxt)}” × “${escapeHtml(c.semelhantes[0].bTxt)}”).`);
  if (jornada) itens.push(`<strong>${fmt.int(jornada)}</strong> registro(s) com horas no nome do cargo diferentes da carga horária (ex.: “${escapeHtml(c.jornadaDivergente[0].cargo)}” registrado com ${c.jornadaDivergente[0].carga}h).`);
  if (c.genericos) itens.push(`<strong>${fmt.int(c.genericos)}</strong> registro(s) com cargo vazio ou genérico.`);
  if (c.unificados.length) itens.push(`<strong>${fmt.int(c.unificados.length)}</strong> cargo(s) com grafias diferentes de maiúsculas/acentos foram unificados automaticamente.`);

  if (!itens.length) {
    dom.alerta.innerHTML = '';
    return;
  }
  dom.alerta.innerHTML = `
    <div class="alert" role="status">
      <div class="alert-icon" aria-hidden="true">⚠</div>
      <div class="alert-body">
        <div class="alert-title">Nomes de cargo sem padrão: análises por cargo podem não ser 100% exatas</div>
        A prefeitura digita os cargos livremente. Encontramos:
        <ul>${itens.map(i => `<li>${i}</li>`).join('')}</ul>
        <div class="alert-actions"><button class="btn-ghost" type="button" data-report="qualidade">Ver relatório de qualidade dos cargos</button></div>
      </div>
    </div>`;
}

function renderReportBar() {
  const periodos = new Set(S.filtered.map(r => r.periodo));
  const btnEv = dom.reportBar.querySelector('[data-report="evolucao"]');
  btnEv.disabled = periodos.size < 2;
  btnEv.title = periodos.size < 2 ? 'Carregue planilhas de duas ou mais competências' : '';
  dom.reportBar.querySelectorAll('[data-report]').forEach(b => {
    if (b !== btnEv) b.disabled = S.filtered.length === 0;
  });
}

function renderRegimePanel() {
  const reg = porRegime(S.filtered);
  const g = resumoGeral(S.filtered);
  if (!reg.length) {
    dom.regimePanel.innerHTML = '<p class="empty-note">Sem registros no recorte.</p>';
    return;
  }
  dom.regimePanel.innerHTML = `
    <table class="dtable">
      <thead><tr>
        <th>Tipo de regime</th><th class="num">Matrículas</th><th>Participação</th>
        <th class="num">Média líquida</th><th class="num">Total vencimentos</th>
      </tr></thead>
      <tbody>
        ${reg.map(r => `
          <tr>
            <td><span class="swatch" style="background:${corRegime(r.regime)}"></span>${escapeHtml(r.regime)}</td>
            <td class="num">${fmt.int(r.matriculas)}</td>
            <td><div class="cell-bar"><div class="meter"><span style="width:${(r.share * 100).toFixed(1)}%;background:${corRegime(r.regime)}"></span></div><span class="pct">${fmt.pct(r.share)}</span></div></td>
            <td class="num">${fmt.brl(r.mediaLiquido)}</td>
            <td class="num">${fmt.brl(r.totals.vencimentos)}</td>
          </tr>`).join('')}
        <tr class="total">
          <td>Total</td><td class="num">${fmt.int(g.matriculas)}</td><td></td>
          <td class="num">${fmt.brl(g.mediaLiquido)}</td><td class="num">${fmt.brl(g.totals.vencimentos)}</td>
        </tr>
      </tbody>
    </table>
    ${g.periodos.length > 1 ? '<p class="panel-note">Matrículas distintas em todo o período selecionado. Para ver mês a mês ou por ano, abra o relatório.</p>' : ''}`;
}

function renderRodapePanel() {
  const q = quadroRodape(filesNoEscopo());
  if (!q.length) {
    dom.rodapePanel.innerHTML = '<p class="empty-note">Sem planilhas no recorte.</p>';
    return;
  }
  const multiUni = new Set(q.map(r => r.unidade)).size > 1;
  const conf = r => r.parcial ? '<span class="muted" title="Carregada de uma exportação filtrada: só parte das linhas">parcial</span>'
    : r.confere == null ? '<span class="muted">—</span>'
    : r.confere ? '<span class="badge badge--ok" title="Total declarado = Base + Vantagens + Gratificação das linhas">✓</span>'
      : '<span class="badge badge--crit" title="Total declarado diferente da soma das linhas">✗</span>';
  dom.rodapePanel.innerHTML = `
    <table class="dtable">
      <thead><tr>
        ${multiUni ? '<th>Unidade</th>' : ''}<th>Competência</th><th class="num">Pessoas</th>
        <th class="num">Total de vencimentos</th><th class="num">RCL mensal</th><th class="num">Venc. ÷ RCL</th><th class="num">RCL 12 meses</th>
      </tr></thead>
      <tbody>
        ${q.map(r => `
          <tr>
            ${multiUni ? `<td class="wrap">${escapeHtml(r.unidade)}</td>` : ''}
            <td>${escapeHtml(rotuloPeriodo(r.periodo))}${r.partes > 1 ? ` <span class="muted" title="O TCM-BA dividiu esta folha em ${r.partes} arquivos; os valores somam as partes">(${r.partes} partes)</span>` : ''}</td>
            <td class="num">${r.pessoasDeclaradas == null ? '—' : fmt.int(r.pessoasDeclaradas)}</td>
            <td class="num">${r.totalVencimentos == null ? '—' : fmt.brl(r.totalVencimentos)} ${conf(r)}</td>
            <td class="num">${r.rclMensal == null ? '—' : fmt.brl(r.rclMensal)}</td>
            <td class="num">${r.folhaSobreRcl == null ? '—' : fmt.pct(r.folhaSobreRcl)}</td>
            <td class="num" title="${escapeHtml(r.rcl12mPeriodo)}">${r.rcl12m == null ? '—' : fmt.brl(r.rcl12m)}</td>
          </tr>`).join('')}
      </tbody>
    </table>
    <p class="panel-note">Valores declarados no rodapé de cada planilha do TCM-BA. ✓ = o total declarado confere com a soma das linhas. Passe o mouse na RCL de 12 meses para ver o período.</p>`;
}

function renderTable() {
  const cols = visibleCols();

  dom.head.innerHTML = '<tr>' + cols.map(idx => {
    const chainPos = S.sortChain.findIndex(s => s.idx === idx);
    let cls = 'th-sortable';
    if (S.currencyCols.includes(idx)) cls += ' th-currency';
    let badge = '';
    if (chainPos !== -1) {
      cls += S.sortChain[chainPos].dir === 1 ? ' sort-asc' : ' sort-desc';
      if (S.sortChain.length > 1) badge = `<span class="sort-rank">${chainPos + 1}</span>`;
    }
    return `<th class="${cls}" data-idx="${idx}" title="Clique para ordenar. Shift+Clique para combinar colunas.">${escapeHtml(S.headers[idx])}${badge}</th>`;
  }).join('') + '</tr>';

  const total      = S.filtered.length;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  if (S.page > totalPages) S.page = totalPages;
  const start = (S.page - 1) * PAGE_SIZE;
  const end   = Math.min(start + PAGE_SIZE, total);
  const slice = S.filtered.slice(start, end);

  if (slice.length === 0) {
    dom.body.innerHTML = `<tr><td colspan="${cols.length}" class="state-empty">Nenhum registro encontrado.</td></tr>`;
  } else {
    dom.body.innerHTML = slice.map(rec => '<tr>' + cols.map(idx => {
      const v = rec.row[idx];
      if (S.currencyCols.includes(idx)) {
        const zero = parseMoney(v) === 0 ? ' zero' : '';
        return `<td class="folha-currency${zero}">${escapeHtml(v)}</td>`;
      }
      return `<td>${escapeHtml(v)}</td>`;
    }).join('') + '</tr>').join('');
  }

  const info = `Mostrando ${total === 0 ? 0 : start + 1}–${end} de ${formatInt(total)} registros`;
  const page = `Página ${S.page} de ${totalPages}`;
  dom.infoTop.textContent = info;
  dom.infoBot.textContent = info;
  dom.pageTop.textContent = page;
  dom.pageBot.textContent = page;
  dom.prevTop.disabled = dom.prevBot.disabled = S.page <= 1;
  dom.nextTop.disabled = dom.nextBot.disabled = S.page >= totalPages;

  requestAnimationFrame(syncTopScrollbar);
}

function syncTopScrollbar() {
  const tbl = dom.wrapper.querySelector('table');
  if (!tbl) return;
  const w = tbl.scrollWidth;
  const visible = w > dom.wrapper.clientWidth + 1;
  dom.scrollTop.classList.toggle('hidden', !visible);
  if (visible) dom.scrollInner.style.width = w + 'px';
}

function changePage(delta) {
  const totalPages = Math.max(1, Math.ceil(S.filtered.length / PAGE_SIZE));
  S.page = Math.max(1, Math.min(S.page + delta, totalPages));
  renderTable();
  dom.tableTitle.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function exportCSV() {
  if (!S.headers || S.filtered.length === 0) return;
  hideError();
  const filtrado = S.filtered.length < S.recs.length;
  let p;
  try {
    p = montarProjeto(S.headers, S.files, S.filtered, { filtrado });
  } catch (err) {
    showError(err.message);
    return;
  }
  downloadCSV(nomeArquivoProjeto(p.municipio, new Date(), filtrado ? 'filtrado' : ''), p.headers, p.rows);
}

function showError(msg) {
  dom.errorText.textContent = msg;
  dom.error.hidden = false;
}
function hideError() { dom.error.hidden = true; }

export function resetFolha() {
  fecharRelatorio();
  Object.assign(S, {
    queue: [], headers: null, schema: null, currencyCols: [], colIndex: {}, recs: [],
    filtered: [], files: [], page: 1, sortChain: [], corRegime: new Map(), cargos: null,
    municipio: '', projeto: false,
  });
  S.hashes.clear();

  dom.input.value = '';
  dom.fNome.value = '';
  for (const [el, label] of [[dom.fUnidade, 'Todas'], [dom.fAno, 'Todos'], [dom.fCompetencia, 'Todas'], [dom.fRegime, 'Todos'], [dom.fCargo, 'Todos']]) {
    el.innerHTML = `<option value="">${label}</option>`;
  }
  dom.filterStatus.textContent = '';
  dom.filterStatus.classList.remove('active');
  for (const el of [dom.kpis, dom.comp, dom.alerta, dom.regimePanel, dom.rodapePanel, dom.head, dom.body]) el.innerHTML = '';
  $('cmp-content').innerHTML = '';
  dom.uploadSec.style.display = '';
  dom.analysis.classList.remove('visible');
  hideError();
  dom.modal.hidden = true;
  dom.modal.setAttribute('aria-hidden', 'true');
  document.body.style.overflow = '';
}

export function redrawFolha() {
  if (!S.recs.length) return;
  renderKpis();
  renderRegimePanel();
  redesenharRelatorio();
}

export function initFolha() {
  Object.assign(dom, {
    dropZone: $('folha-drop-zone'), input: $('folha-input'),
    uploadSec: $('folha-upload-section'), analysis: $('folha-analysis'),
    error: $('folha-error'), errorText: $('folha-error-text'),
    fileLabel: $('folha-file-label'), filenames: $('folha-filenames'),
    btnAdd: $('folha-btn-add'), btnReset: $('folha-btn-reset'), btnExport: $('folha-btn-export'),
    btnProjeto: $('folha-btn-projeto'),
    kpis: $('folha-kpis'), comp: $('folha-comp'), alerta: $('folha-alerta'),
    reportBar: $('folha-report-bar'), regimePanel: $('folha-regime-panel'), rodapePanel: $('folha-rodape-panel'),
    tableTitle: $('folha-table-title'),
    filterStatus: $('folha-filter-status'), btnClear: $('folha-btn-clear'),
    fNome: $('folha-filter-nome'), fUnidade: $('folha-filter-unidade'), fAno: $('folha-filter-ano'),
    fCompetencia: $('folha-filter-competencia'), fRegime: $('folha-filter-regime'),
    fCargo: $('folha-filter-cargo'),
    head: $('folha-head'), body: $('folha-body'), wrapper: $('folha-table-wrapper'),
    scrollTop: $('folha-scroll-top'), scrollInner: $('folha-scroll-top-inner'),
    infoTop: $('folha-info-top'), infoBot: $('folha-info-bot'),
    pageTop: $('folha-page-top'), pageBot: $('folha-page-bot'),
    prevTop: $('folha-prev-top'), nextTop: $('folha-next-top'),
    prevBot: $('folha-prev-bot'), nextBot: $('folha-next-bot'),
    modal: $('folha-modal'), modalClose: $('folha-modal-close'),
    modalCancel: $('folha-modal-cancel'), modalConfirm: $('folha-modal-confirm'),
    modalLabel: $('folha-modal-confirm-label'), modalAdd: $('folha-modal-add'),
    modalAviso: $('folha-modal-aviso'), modalInfo: $('folha-modal-info'),
    queueList: $('folha-queue'), queueEmpty: $('folha-queue-empty'),
  });

  initRelatorios();
  initComparacao(() => {
    const f = readFilters();
    const recs = filtrar({ ...f, ano: '', competencia: '' }, { nome: false });
    return { recs, cargos: S.cargos, multiUnidade: new Set(recs.map(r => r.unidade)).size > 1 };
  });

  dom.dropZone.addEventListener('click', () => dom.input.click());
  dom.dropZone.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); dom.input.click(); }
  });
  ['dragenter', 'dragover'].forEach(ev =>
    dom.dropZone.addEventListener(ev, e => { e.preventDefault(); dom.dropZone.classList.add('drag-over'); })
  );
  ['dragleave', 'drop'].forEach(ev =>
    dom.dropZone.addEventListener(ev, e => { e.preventDefault(); dom.dropZone.classList.remove('drag-over'); })
  );
  dom.dropZone.addEventListener('drop', e => {
    if (e.dataTransfer.files.length) enqueueFiles(e.dataTransfer.files);
  });
  dom.input.addEventListener('change', () => {
    if (dom.input.files.length) {
      enqueueFiles(dom.input.files);
      dom.input.value = '';
    }
  });

  dom.modalClose.addEventListener('click', closeModal);
  dom.modalCancel.addEventListener('click', closeModal);
  dom.modal.addEventListener('click', e => { if (e.target === dom.modal) closeModal(); });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && !dom.modal.hidden) closeModal();
  });
  dom.modalAdd.addEventListener('click', () => dom.input.click());
  dom.modalConfirm.addEventListener('click', convertQueue);

  dom.btnAdd.addEventListener('click', () => dom.input.click());
  dom.btnReset.addEventListener('click', () => {
    resetFolha();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });
  dom.btnExport.addEventListener('click', exportCSV);
  dom.btnProjeto.addEventListener('click', () => salvarProjeto());

  dom.analysis.addEventListener('click', e => {
    const b = e.target.closest('button[data-report]');
    if (b && !b.disabled) abrirRelatorio(b.dataset.report, contextoRelatorio);
  });

  let tNome = null;
  dom.fNome.addEventListener('input', () => {
    clearTimeout(tNome);
    tNome = setTimeout(applyFilters, 150);
  });
  dom.fAno.addEventListener('change', () => {
    dom.fCompetencia.value = '';
    populateFilters();
    applyFilters();
  });
  [dom.fUnidade, dom.fCompetencia, dom.fRegime, dom.fCargo]
    .forEach(el => el.addEventListener('change', applyFilters));
  dom.btnClear.addEventListener('click', clearFilters);

  dom.prevTop.addEventListener('click', () => changePage(-1));
  dom.nextTop.addEventListener('click', () => changePage(+1));
  dom.prevBot.addEventListener('click', () => changePage(-1));
  dom.nextBot.addEventListener('click', () => changePage(+1));

  let syncing = false;
  const link = (from, to) => from.addEventListener('scroll', () => {
    if (syncing) return;
    syncing = true;
    to.scrollLeft = from.scrollLeft;
    syncing = false;
  });
  link(dom.wrapper, dom.scrollTop);
  link(dom.scrollTop, dom.wrapper);
  window.addEventListener('resize', syncTopScrollbar);

  dom.head.addEventListener('click', e => {
    const th = e.target.closest('th[data-idx]');
    if (!th) return;
    const idx = parseInt(th.dataset.idx, 10);
    const existing = S.sortChain.find(s => s.idx === idx);
    if (e.shiftKey) {
      if (existing) existing.dir = -existing.dir;
      else S.sortChain.push({ idx, dir: 1 });
    } else if (S.sortChain.length === 1 && existing) {
      existing.dir = -existing.dir;
    } else {
      S.sortChain = [{ idx, dir: 1 }];
    }
    applyFilters();
  });
}
