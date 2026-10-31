import { normStr, parseCurrencyBRL } from './format.js';

export const COMPONENTES = Object.freeze([
  { key: 'base',         label: 'Salário Base',    header: 'salario base' },
  { key: 'vantagens',    label: 'Vantagens',       header: 'vantagens' },
  { key: 'gratificacao', label: 'Gratificação',    header: 'gratificacao' },
  { key: 'decimo',       label: '13º Salário',     header: '13º salario' },
]);

export const METRICAS = Object.freeze({
  extras      : { label: 'Vantagens + Gratificação', get: r => r.vantagens + r.gratificacao },
  vencimentos : { label: 'Total de vencimentos',     get: r => r.vencimentos },
  liquido     : { label: 'Salário Líquido',          get: r => r.liquido },
  base        : { label: 'Salário Base',             get: r => r.base },
  vantagens   : { label: 'Vantagens',                get: r => r.vantagens },
  gratificacao: { label: 'Gratificação',             get: r => r.gratificacao },
});

export function buildSchema(headers) {
  const norm = headers.map(h => normStr(h));
  const idx  = (...names) => {
    for (const n of names) {
      const i = norm.indexOf(normStr(n));
      if (i !== -1) return i;
    }
    return -1;
  };
  return {
    nome   : idx('Nome'),
    matr   : idx('Matrícula', 'Matricula'),
    regime : idx('Tipo Regime', 'Regime'),
    cargo  : idx('Cargo'),
    carga  : idx('Carga H Semanal', 'Carga Horária'),
    comp   : idx('Competência'),
    uni    : idx('Unidade'),
    liquido: idx('Salário Líquido'),
    base   : idx('Salário Base'),
    vantagens   : idx('Vantagens'),
    gratificacao: idx('Gratificação'),
    decimo : idx('13º Salário'),
  };
}

export function toRecord(row, sc) {
  const txt   = i => (i === -1 ? '' : String(row[i] ?? '').trim());
  const money = i => (i === -1 ? 0 : parseCurrencyBRL(row[i]));
  const cargaTxt = txt(sc.carga);
  const cargaNum = parseInt(cargaTxt, 10);
  const r = {
    row,
    nome     : txt(sc.nome),
    matricula: txt(sc.matr),
    regime   : txt(sc.regime) || 'Não informado',
    cargo    : txt(sc.cargo),
    carga    : isNaN(cargaNum) ? null : cargaNum,
    cargaTxt : cargaTxt || '—',
    comp     : txt(sc.comp),
    unidade  : txt(sc.uni),
    liquido  : money(sc.liquido),
    base     : money(sc.base),
    vantagens: money(sc.vantagens),
    gratificacao: money(sc.gratificacao),
    decimo   : money(sc.decimo),
  };
  r.vencimentos = r.base + r.vantagens + r.gratificacao;
  r.periodo = periodoDe(r.comp);
  r.ano     = r.periodo.slice(0, 4);
  r.pessoaKey = r.unidade + '\x00' + (r.matricula || r.nome);
  return r;
}

const MESES_ABREV = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];

export function periodoDe(comp) {
  const m = String(comp || '').match(/^(\d{2})-(\d{4})$/);
  return m ? `${m[2]}-${m[1]}` : String(comp || '');
}

export function rotuloPeriodo(p) {
  const m = String(p).match(/^(\d{4})-(\d{2})$/);
  return m ? `${MESES_ABREV[+m[2] - 1]}/${m[1]}` : String(p);
}

export function quantil(sorted, q) {
  if (sorted.length === 0) return 0;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

function somaComponentes() {
  return { liquido: 0, base: 0, vantagens: 0, gratificacao: 0, decimo: 0, vencimentos: 0 };
}

function acumula(t, r) {
  t.liquido += r.liquido;
  t.base += r.base;
  t.vantagens += r.vantagens;
  t.gratificacao += r.gratificacao;
  t.decimo += r.decimo;
  t.vencimentos += r.vencimentos;
}

export function resumoGeral(recs) {
  const totals = somaComponentes();
  const pessoas = new Set();
  const nomes = new Set();
  const periodos = new Set();
  const unidades = new Set();
  for (const r of recs) {
    acumula(totals, r);
    pessoas.add(r.pessoaKey);
    if (r.nome) nomes.add(r.nome);
    periodos.add(r.periodo);
    unidades.add(r.unidade);
  }
  return {
    registros: recs.length,
    matriculas: pessoas.size,
    nomes: nomes.size,
    periodos: [...periodos].sort(),
    unidades: [...unidades].sort(),
    totals,
    mediaLiquido: recs.length ? totals.liquido / recs.length : 0,
    mediaVencimentos: recs.length ? totals.vencimentos / recs.length : 0,
  };
}

export function porRegime(recs) {
  const map = new Map();
  for (const r of recs) {
    const k = normStr(r.regime);
    let g = map.get(k);
    if (!g) {
      g = { regime: r.regime, pessoas: new Set(), registros: 0, totals: somaComponentes(), liquidos: [] };
      map.set(k, g);
    }
    g.pessoas.add(r.pessoaKey);
    g.registros++;
    acumula(g.totals, r);
    g.liquidos.push(r.liquido);
  }
  const totalMatr = new Set(recs.map(r => r.pessoaKey)).size || 1;
  return [...map.values()].map(g => {
    const sorted = g.liquidos.sort((a, b) => a - b);
    return {
      regime: g.regime,
      matriculas: g.pessoas.size,
      share: g.pessoas.size / totalMatr,
      registros: g.registros,
      totals: g.totals,
      mediaLiquido: g.totals.liquido / g.registros,
      medianaLiquido: quantil(sorted, 0.5),
      mediaVencimentos: g.totals.vencimentos / g.registros,
    };
  }).sort((a, b) => b.matriculas - a.matriculas || a.regime.localeCompare(b.regime));
}

export function seriePorPeriodo(recs, modo = 'mes') {
  const map = new Map();
  for (const r of recs) {
    const p = modo === 'ano' ? r.ano : r.periodo;
    let g = map.get(p);
    if (!g) {
      g = { periodo: p, totals: somaComponentes(), pessoas: new Set(), meses: new Map(), registros: 0 };
      map.set(p, g);
    }
    acumula(g.totals, r);
    g.pessoas.add(r.pessoaKey);
    g.registros++;
    if (!g.meses.has(r.periodo)) g.meses.set(r.periodo, new Set());
    g.meses.get(r.periodo).add(r.pessoaKey);
  }
  return [...map.values()].sort((a, b) => a.periodo.localeCompare(b.periodo)).map(g => {
    const porMes = [...g.meses.values()].map(s => s.size);
    return {
      periodo: g.periodo,
      rotulo: rotuloPeriodo(g.periodo),
      meses: g.meses.size,
      registros: g.registros,
      matriculas: g.pessoas.size,
      mediaMensalMatriculas: porMes.reduce((a, b) => a + b, 0) / (porMes.length || 1),
      totals: g.totals,
    };
  });
}

export function regimePorPeriodo(recs, modo = 'mes') {
  const periodos = [...new Set(recs.map(r => (modo === 'ano' ? r.ano : r.periodo)))].sort();
  const regimes = porRegime(recs).map(g => g.regime);
  const idxReg = new Map(regimes.map((g, i) => [normStr(g), i]));
  const cube = regimes.map(() => periodos.map(() => new Map()));
  const idxPer = new Map(periodos.map((p, i) => [p, i]));
  for (const r of recs) {
    const cell = cube[idxReg.get(normStr(r.regime))][idxPer.get(modo === 'ano' ? r.ano : r.periodo)];
    if (!cell.has(r.periodo)) cell.set(r.periodo, new Set());
    cell.get(r.periodo).add(r.pessoaKey);
  }
  return {
    periodos,
    regimes,
    valores: cube.map(row => row.map(cell => {
      const sizes = [...cell.values()].map(s => s.size);
      return sizes.length ? sizes.reduce((a, b) => a + b, 0) / sizes.length : 0;
    })),
  };
}

export function quadroRodape(files) {
  const grupos = new Map();
  for (const f of files) {
    const k = f.unidade + '\x00' + f.competencia;
    if (!grupos.has(k)) grupos.set(k, []);
    grupos.get(k).push(f);
  }
  return [...grupos.values()].map(partes => {
    const f = partes[0];
    const soma = sel => (partes.every(p => sel(p) != null) ? partes.reduce((t, p) => t + sel(p), 0) : null);
    const decl = f.resumo || {};
    const totalVencimentos = soma(p => p.resumo?.totalVencimentos ?? null);
    const calcV = partes.reduce((t, p) => t + p.calc.vencimentos, 0);
    const parcial = partes.some(p => p.parcial);
    const confere = totalVencimentos == null || parcial ? null : Math.abs(totalVencimentos - calcV) < 0.05 * partes.length;
    return {
      unidade: f.unidade,
      competencia: f.competencia,
      periodo: periodoDe(f.competencia),
      partes: partes.length,
      pessoasDeclaradas: soma(p => p.resumo?.pessoas ?? null),
      registros: partes.reduce((t, p) => t + (p.carregadas ?? p.count), 0),
      parcial,
      totalVencimentos,
      vencimentosCalculado: calcV,
      liquido: partes.reduce((t, p) => t + p.calc.liquido, 0),
      confere,
      rclMensal: decl.rclMensal ?? null,
      rcl12m: decl.rcl12m ?? null,
      rcl12mPeriodo: decl.rcl12mPeriodo || '',
      folhaSobreRcl: decl.rclMensal ? (totalVencimentos ?? calcV) / decl.rclMensal : null,
    };
  }).sort((a, b) => a.unidade.localeCompare(b.unidade) || a.periodo.localeCompare(b.periodo));
}

const GENERICOS = new Set([
  '', 'nao informado', 'nao informada', 'outros', 'outro', 'diversos', 'sem cargo',
  'indefinido', 'nao definido', 'n i', 'ni', 'null', '0', '-',
]);

export function cargoKey(s) {
  return normStr(s)
    .replace(/\((a|as|o|os|e|es)\)/g, ' ')
    .replace(/\/(a|as|o|os)\b/g, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function isCargoGenerico(s) {
  const k = cargoKey(s);
  return GENERICOS.has(k) || k.length < 3;
}

function levenshtein(a, b, max) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      cur.push(v);
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > max) return max + 1;
    prev = cur;
  }
  return prev[b.length];
}

function isAbreviacao(ta, tb) {
  if (ta.length !== tb.length || ta.length === 0) return false;
  let diff = false;
  for (let i = 0; i < ta.length; i++) {
    const [x, y] = ta[i].length <= tb[i].length ? [ta[i], tb[i]] : [tb[i], ta[i]];
    if (!y.startsWith(x) || x.length < 3 && x !== y) return false;
    if (x !== y) diff = true;
  }
  return diff;
}

const RE_TOKEN_NIVEL = /^(\d.*|.*\d.*|[ivx]+|[a-z])$/;
function assinaturaNivel(tokens) {
  return tokens.filter(t => RE_TOKEN_NIVEL.test(t)).join(' ');
}

function isVariacaoGenero(ta, tb) {
  if (ta.length !== tb.length) return false;
  let diff = false;
  for (let i = 0; i < ta.length; i++) {
    if (ta[i] === tb[i]) continue;
    const x = ta[i], y = tb[i];
    if (x.length !== y.length || x.slice(0, -1) !== y.slice(0, -1)) return false;
    if (!/[ao]$/.test(x) || !/[ao]$/.test(y)) return false;
    diff = true;
  }
  return diff;
}

export function horasNoCargo(cargo) {
  const m = normStr(cargo).match(/\b(\d{1,2})\s*(h|hs|hrs?|horas)\b/);
  return m ? parseInt(m[1], 10) : null;
}

export function analisarCargos(recs) {
  const porChave = new Map();
  let genericos = 0;
  const grafiasGenericas = new Map();
  const jornada = new Map();
  for (const r of recs) {
    const h = horasNoCargo(r.cargo);
    if (h !== null && r.carga !== null && h !== r.carga) {
      const jk = r.cargo + '\x00' + r.carga;
      const j = jornada.get(jk) || { cargo: r.cargo, horasCargo: h, carga: r.carga, count: 0 };
      j.count++;
      jornada.set(jk, j);
    }
    if (isCargoGenerico(r.cargo)) {
      genericos++;
      grafiasGenericas.set(r.cargo || '(vazio)', (grafiasGenericas.get(r.cargo || '(vazio)') || 0) + 1);
    }
    const k = cargoKey(r.cargo);
    if (!porChave.has(k)) porChave.set(k, new Map());
    const m = porChave.get(k);
    m.set(r.cargo, (m.get(r.cargo) || 0) + 1);
  }

  const display = new Map();
  const unificados = [];
  for (const [k, grafias] of porChave) {
    const lista = [...grafias.entries()].map(([txt, count]) => ({ txt, count })).sort((a, b) => b.count - a.count);
    display.set(k, lista[0].txt);
    if (lista.length > 1) unificados.push({ key: k, display: lista[0].txt, grafias: lista });
  }

  const keys = [...porChave.keys()].filter(k => k.length >= 4 && !GENERICOS.has(k));
  const tokens = new Map(keys.map(k => [k, k.split(' ')]));
  const semelhantes = [];
  for (let i = 0; i < keys.length; i++) {
    for (let j = i + 1; j < keys.length; j++) {
      const a = keys[i], b = keys[j];
      let motivo = null;
      const ta = tokens.get(a), tb = tokens.get(b);
      if (assinaturaNivel(ta) !== assinaturaNivel(tb)) continue;
      if (ta.length === tb.length && [...ta].sort().join(' ') === [...tb].sort().join(' ')) {
        motivo = 'mesmas palavras em outra ordem';
      } else if (isVariacaoGenero(ta, tb)) {
        motivo = 'variação de gênero (a/o)';
      } else if (isAbreviacao(ta, tb)) {
        motivo = 'abreviação';
      } else {
        const max = Math.min(a.length, b.length) >= 12 ? 2 : 1;
        if (levenshtein(a, b, max) <= max) motivo = 'diferença de digitação';
      }
      if (motivo) {
        semelhantes.push({
          a, b, motivo,
          aTxt: display.get(a), bTxt: display.get(b),
          aCount: sumMap(porChave.get(a)), bCount: sumMap(porChave.get(b)),
        });
      }
    }
  }

  return {
    totalGrafias: [...porChave.values()].reduce((n, m) => n + m.size, 0),
    totalCargos: porChave.size,
    unificados: unificados.sort((x, y) => y.grafias.length - x.grafias.length),
    semelhantes,
    genericos,
    grafiasGenericas: [...grafiasGenericas.entries()].map(([txt, count]) => ({ txt, count })),
    jornadaDivergente: [...jornada.values()].sort((x, y) => y.count - x.count),
    display,
  };
}

function sumMap(m) {
  let n = 0;
  for (const v of m.values()) n += v;
  return n;
}

export function mapaUnificacao(semelhantes) {
  const parent = new Map();
  const peso = new Map();
  const find = x => {
    while (parent.get(x) !== x) {
      parent.set(x, parent.get(parent.get(x)));
      x = parent.get(x);
    }
    return x;
  };
  const add = (k, w) => { if (!parent.has(k)) { parent.set(k, k); peso.set(k, w); } };
  for (const s of semelhantes) {
    add(s.a, s.aCount);
    add(s.b, s.bCount);
    let ra = find(s.a), rb = find(s.b);
    if (ra === rb) continue;
    if (peso.get(rb) > peso.get(ra)) [ra, rb] = [rb, ra];
    parent.set(rb, ra);
    peso.set(ra, peso.get(ra) + peso.get(rb));
  }
  const out = new Map();
  for (const k of parent.keys()) out.set(k, find(k));
  return out;
}

export function compararGrupos(recs, { metrica = 'extras', unificar = null, minPessoas = 2, display = null } = {}) {
  const get = METRICAS[metrica].get;
  const map = new Map();
  for (const r of recs) {
    let ck = cargoKey(r.cargo);
    if (unificar && unificar.has(ck)) ck = unificar.get(ck);
    const k = [r.unidade, ck, normStr(r.regime), r.cargaTxt].join('\x00');
    let g = map.get(k);
    if (!g) {
      g = {
        key: k, unidade: r.unidade, cargoKey: ck,
        cargo: (display && display.get(ck)) || r.cargo || '(sem cargo)',
        regime: r.regime, carga: r.cargaTxt, membros: [], grafias: new Set(),
      };
      map.set(k, g);
    }
    g.grafias.add(r.cargo);
    g.membros.push({ rec: r, valor: get(r) });
  }

  const grupos = [];
  for (const g of map.values()) {
    if (g.membros.length < minPessoas) continue;
    const vals = g.membros.map(m => m.valor).sort((a, b) => a - b);
    const q1 = quantil(vals, 0.25);
    const q3 = quantil(vals, 0.75);
    const mediana = quantil(vals, 0.5);
    const limite = q3 + 1.5 * (q3 - q1);
    const membros = g.membros
      .map(m => ({
        ...m,
        diff: m.valor - mediana,
        razao: mediana > 0 ? m.valor / mediana : (m.valor > 0 ? Infinity : 1),
        atipico: m.valor > limite && m.valor > mediana,
      }))
      .sort((a, b) => b.valor - a.valor);
    grupos.push({
      key: g.key, unidade: g.unidade, cargo: g.cargo, cargoKey: g.cargoKey,
      regime: g.regime, carga: g.carga, grafias: [...g.grafias],
      n: membros.length,
      min: vals[0], max: vals[vals.length - 1],
      media: vals.reduce((a, b) => a + b, 0) / vals.length,
      mediana, q1, q3,
      amplitude: vals[vals.length - 1] - vals[0],
      atipicos: membros.filter(m => m.atipico).length,
      membros,
    });
  }
  return grupos;
}

export function destaques(grupos, limite = 50) {
  const all = [];
  for (const g of grupos) {
    for (const m of g.membros) {
      if (m.diff > 0) all.push({ ...m, grupo: g });
    }
  }
  return all.sort((a, b) => b.diff - a.diff).slice(0, limite);
}
