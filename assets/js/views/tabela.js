import { escapeHtml, normStr, formatInt } from '../core/format.js';
import { downloadCSV, numCSV } from './download.js';

const POR_PAGINA = 50;

export function tabela(el, { colunas, linhas, detalhe = null, csv = '', vazio = 'Nada para mostrar.', ordem = null }) {
  const S = { busca: '', pagina: 1, col: ordem ? ordem.col : -1, desc: ordem ? !!ordem.desc : false, aberta: new Set() };
  const texto = linhas.map(l => normStr(colunas.map(c => c.v(l)).join(' ')));

  el.innerHTML = `
    <div class="tb-barra">
      <input type="search" class="filter-input tb-busca" placeholder="Buscar nesta lista..." autocomplete="off" />
      <span class="tb-info"></span>
      ${csv ? '<button type="button" class="btn-ghost tb-csv">&#8681; Exportar CSV</button>' : ''}
    </div>
    <div class="table-wrapper"><table><thead></thead><tbody></tbody></table></div>
    <div class="tb-pag"></div>`;
  const q = s => el.querySelector(s);

  function visiveis() {
    const termo = normStr(S.busca);
    let idx = linhas.map((_, i) => i);
    if (termo) idx = idx.filter(i => texto[i].includes(termo));
    if (S.col >= 0) {
      const c = colunas[S.col];
      idx.sort((a, b) => {
        const x = c.v(linhas[a]), y = c.v(linhas[b]);
        const r = typeof x === 'number' && typeof y === 'number'
          ? x - y : String(x ?? '').localeCompare(String(y ?? ''), 'pt-BR', { numeric: true });
        return S.desc ? -r : r;
      });
    }
    return idx;
  }

  function desenhar() {
    const idx = visiveis();
    const paginas = Math.max(1, Math.ceil(idx.length / POR_PAGINA));
    S.pagina = Math.min(S.pagina, paginas);
    const trecho = idx.slice((S.pagina - 1) * POR_PAGINA, S.pagina * POR_PAGINA);

    q('thead').innerHTML = `<tr>${detalhe ? '<th class="tb-abre"></th>' : ''}${colunas.map((c, i) =>
      `<th class="th-sortable${c.num ? ' tb-num' : ''}${S.col === i ? (S.desc ? ' sort-desc' : ' sort-asc') : ''}" data-col="${i}">${escapeHtml(c.t)}</th>`).join('')}</tr>`;
    const n = colunas.length + (detalhe ? 1 : 0);
    q('tbody').innerHTML = trecho.length ? trecho.map(i => {
      const l = linhas[i];
      const aberta = S.aberta.has(i);
      const celulas = colunas.map(c => `<td class="${c.num ? 'tb-num' : ''}">${c.html ? c.html(l) : escapeHtml(c.v(l) ?? '')}</td>`).join('');
      return `<tr data-i="${i}" class="${detalhe ? 'tb-clicavel' : ''}">${detalhe ? `<td class="tb-abre">${aberta ? '▾' : '▸'}</td>` : ''}${celulas}</tr>` +
        (aberta ? `<tr class="tb-detalhe"><td colspan="${n}">${detalhe(l)}</td></tr>` : '');
    }).join('') : `<tr><td colspan="${n}" class="tb-vazio">${escapeHtml(vazio)}</td></tr>`;

    q('.tb-info').textContent = idx.length === linhas.length
      ? `${formatInt(linhas.length)} registro(s)`
      : `${formatInt(idx.length)} de ${formatInt(linhas.length)} registro(s)`;
    q('.tb-pag').innerHTML = paginas > 1 ? `
      <button type="button" class="btn-page" data-p="-1"${S.pagina === 1 ? ' disabled' : ''}>&#8592; Anterior</button>
      <span class="page-indicator">Página ${S.pagina} de ${paginas}</span>
      <button type="button" class="btn-page" data-p="1"${S.pagina === paginas ? ' disabled' : ''}>Próxima &#8594;</button>` : '';
  }

  q('.tb-busca').addEventListener('input', e => { S.busca = e.target.value; S.pagina = 1; desenhar(); });
  q('thead').addEventListener('click', e => {
    const th = e.target.closest('th[data-col]');
    if (!th) return;
    const c = Number(th.dataset.col);
    S.desc = S.col === c ? !S.desc : false;
    S.col = c;
    desenhar();
  });
  q('tbody').addEventListener('click', e => {
    if (!detalhe || e.target.closest('a, button')) return;
    const tr = e.target.closest('tr[data-i]');
    if (!tr) return;
    const i = Number(tr.dataset.i);
    if (S.aberta.has(i)) S.aberta.delete(i); else S.aberta.add(i);
    desenhar();
  });
  q('.tb-pag').addEventListener('click', e => {
    const b = e.target.closest('[data-p]');
    if (!b) return;
    S.pagina += Number(b.dataset.p);
    desenhar();
    el.scrollIntoView({ block: 'start', behavior: 'smooth' });
  });
  if (csv) {
    q('.tb-csv').addEventListener('click', () => {
      const cel = v => (typeof v === 'number' && !Number.isInteger(v) ? numCSV(v) : v);
      downloadCSV(csv, colunas.map(c => c.t), visiveis().map(i => colunas.map(c => cel(c.v(linhas[i])))));
    });
  }
  desenhar();
}
