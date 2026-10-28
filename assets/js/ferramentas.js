export const GRUPOS = [
  { id: 'conversoes', nome: 'Conversão de dados do TCM-BA' },
  { id: 'investigacao', nome: 'Investigação' },
];

export const FERRAMENTAS = [
  {
    rota: 'despesas',
    grupo: 'conversoes',
    nome: 'Despesas Municipais',
    resumo: 'Arquivos .csv de Pagamento exportados pelo TCM-BA.',
    subtitulo: 'ANÁLISE DE DESPESAS MUNICIPAIS',
  },
  {
    rota: 'folha',
    grupo: 'conversoes',
    nome: 'Folha de Pagamento',
    resumo: 'Arquivos .xls de servidores da seção Pessoal do TCM-BA.',
    subtitulo: 'ANÁLISE DA FOLHA DE PAGAMENTO',
  },
  {
    rota: 'investigacao',
    grupo: 'investigacao',
    nome: 'Pacote de Investigação',
    resumo: 'Abrir o arquivo .json recebido: cadeia de documentos, envolvidos e cruzamentos.',
    subtitulo: 'PACOTE DE INVESTIGAÇÃO',
  },
];

export function ferramenta(rota) {
  return FERRAMENTAS.find(f => f.rota === rota) || null;
}

export function porGrupo() {
  return GRUPOS
    .map(g => ({ grupo: g, itens: FERRAMENTAS.filter(f => f.grupo === g.id) }))
    .filter(x => x.itens.length);
}
