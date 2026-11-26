/** Objeto JSON cru, como veio da API. */
export type Bruto = Record<string, unknown>;

/** Identifica uma contratação (compra) no PNCP. */
export interface CompraRef {
  /** CNPJ do órgão, só dígitos. */
  cnpj: string;
  ano: number;
  sequencial: number;
}

/** Página de uma consulta paginada. */
export interface Pagina<T> {
  dados: T[];
  pagina: number;
  totalPaginas: number;
  totalRegistros: number;
  /** Quantas páginas faltam depois desta. */
  paginasRestantes: number;
  /** Registros que vieram sem os campos mínimos e foram descartados. */
  ignorados: number;
}

/** Contratação (licitação, dispensa etc.) normalizada. */
export interface Contratacao extends CompraRef {
  /** numeroControlePNCP, ex.: `00394718000100-1-000021/2026`. */
  id: string;
  numeroCompra: string | null;
  processo: string | null;
  objeto: string;
  informacaoComplementar: string | null;
  modalidadeId: number | null;
  modalidadeNome: string | null;
  situacao: string | null;
  valorEstimado: number | null;
  valorHomologado: number | null;
  srp: boolean | null;
  /** Datas em ISO 8601 (UTC). O PNCP manda horário de Brasília sem fuso. */
  dataAbertura: string | null;
  dataEncerramento: string | null;
  dataPublicacao: string | null;
  dataAtualizacao: string | null;
  orgao: string;
  unidade: string | null;
  uf: string | null;
  municipio: string | null;
  codigoIbge: string | null;
  linkSistemaOrigem: string | null;
  /** Objeto original da API, para campos que o cliente não normaliza. */
  bruto: Bruto;
}

/** Item de uma contratação. */
export interface Item {
  numero: number;
  descricao: string;
  quantidade: number | null;
  unidade: string | null;
  /** `null` quando o orçamento é sigiloso (a API manda 0 nesse caso). */
  valorUnitarioEstimado: number | null;
  valorTotal: number | null;
  /** "Material" ou "Serviço". */
  tipo: string | null;
  situacao: string | null;
  criterioJulgamento: string | null;
  sigiloso: boolean;
  temResultado: boolean;
  bruto: Bruto;
}

/** Resultado (fornecedor vencedor) de um item. */
export interface Resultado {
  numeroItem: number;
  sequencial: number | null;
  /** CNPJ ou CPF do fornecedor, só dígitos. */
  niFornecedor: string | null;
  /** "PJ", "PF" ou "PE" (estrangeiro). */
  tipoPessoa: string | null;
  nomeFornecedor: string | null;
  porteFornecedor: string | null;
  quantidadeHomologada: number | null;
  valorUnitarioHomologado: number | null;
  valorTotalHomologado: number | null;
  /** Classificação em registro de preço com mais de um vencedor (1 = primeiro). */
  ordemClassificacaoSrp: number | null;
  situacao: string | null;
  dataResultado: string | null;
  cancelado: boolean;
  bruto: Bruto;
}

/** Ata de registro de preço. */
export interface Ata {
  /** numeroControlePNCPAta */
  id: string;
  compraId: string | null;
  numero: string | null;
  ano: number | null;
  cnpj: string;
  orgao: string;
  unidade: string | null;
  objeto: string;
  /** Datas `AAAA-MM-DD`. */
  vigenciaInicio: string | null;
  vigenciaFim: string;
  dataAssinatura: string | null;
  cancelada: boolean;
  adesao: boolean | null;
  bruto: Bruto;
}

/** Arquivo (edital, termo de referência, anexo) de uma contratação. */
export interface Arquivo {
  sequencial: number;
  titulo: string;
  tipo: string | null;
  url: string;
  dataPublicacao: string | null;
  ativo: boolean;
  bruto: Bruto;
}
