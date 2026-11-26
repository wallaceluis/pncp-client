import { nomeModalidade } from "./modalidades.js";
import type { Arquivo, Ata, Bruto, CompraRef, Contratacao, Item, Resultado } from "./types.js";

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.replace(/\s+/g, " ").trim() : null);
const num = (v: unknown): number | null => {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() && Number.isFinite(Number(v))) return Number(v);
  return null;
};
const bool = (v: unknown): boolean | null => (typeof v === "boolean" ? v : null);
const obj = (v: unknown): Bruto => (v && typeof v === "object" ? (v as Bruto) : {});
const date = (v: unknown): string | null => str(v)?.slice(0, 10) ?? null;

/** Datas do PNCP vêm sem fuso (horário de Brasília): converte para ISO 8601 em UTC. */
export function toIsoBrt(value: unknown): string | null {
  const s = str(value);
  if (!s) return null;
  if (/[zZ]|[+-]\d{2}:?\d{2}$/.test(s)) {
    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  const withTime = s.length === 10 ? `${s}T00:00:00` : s;
  const d = new Date(`${withTime}-03:00`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** Lê o numeroControlePNCP (`CNPJ-1-SEQUENCIAL/ANO`). */
export function parseNumeroControle(id: string): CompraRef | null {
  const match = /^(\d{14})-\d+-(\d+)\/(\d{4})$/.exec(id.trim());
  if (!match) return null;
  return { cnpj: match[1]!, sequencial: Number(match[2]), ano: Number(match[3]) };
}

/** Link da página pública do edital no PNCP. */
export const linkEdital = (c: CompraRef): string => `https://pncp.gov.br/app/editais/${c.cnpj}/${c.ano}/${c.sequencial}`;

/**
 * Converte uma contratação de /contratacoes/proposta, /publicacao ou /atualizacao.
 * Aceita os campos aninhados (orgaoEntidade/unidadeOrgao, formato oficial) e variações
 * achatadas. Devolve `null` quando faltam id, objeto ou identificação da compra.
 */
export function parseContratacao(raw: Bruto): Contratacao | null {
  const id = str(raw.numeroControlePNCP);
  const objeto = str(raw.objetoCompra) ?? str(raw.objeto);
  if (!id || !objeto) return null;

  const control = parseNumeroControle(id);
  const orgaoRaw = obj(raw.orgaoEntidade ?? raw.orgao);
  const unidadeRaw = obj(raw.unidadeOrgao ?? raw.unidade);

  const cnpj = str(orgaoRaw.cnpj) ?? control?.cnpj ?? null;
  const ano = num(raw.anoCompra) ?? control?.ano ?? null;
  const sequencial = num(raw.sequencialCompra) ?? control?.sequencial ?? null;
  if (!cnpj || !ano || !sequencial) return null;

  const modalidadeId = num(raw.modalidadeId);

  return {
    id,
    cnpj,
    ano,
    sequencial,
    numeroCompra: str(raw.numeroCompra),
    processo: str(raw.processo),
    objeto,
    informacaoComplementar: str(raw.informacaoComplementar),
    modalidadeId,
    modalidadeNome: str(raw.modalidadeNome) ?? nomeModalidade(modalidadeId),
    situacao: str(raw.situacaoCompraNome),
    valorEstimado: num(raw.valorTotalEstimado),
    valorHomologado: num(raw.valorTotalHomologado),
    srp: bool(raw.srp),
    dataAbertura: toIsoBrt(raw.dataAberturaProposta),
    dataEncerramento: toIsoBrt(raw.dataEncerramentoProposta),
    dataPublicacao: toIsoBrt(raw.dataPublicacaoPncp),
    dataAtualizacao: toIsoBrt(raw.dataAtualizacaoGlobal ?? raw.dataAtualizacao),
    orgao: str(orgaoRaw.razaoSocial) ?? str(raw.orgaoRazaoSocial) ?? "Órgão não informado",
    unidade: str(unidadeRaw.nomeUnidade),
    uf: (str(unidadeRaw.ufSigla) ?? str(raw.uf))?.toUpperCase() ?? null,
    municipio: str(unidadeRaw.municipioNome) ?? str(raw.municipio),
    codigoIbge: str(unidadeRaw.codigoIbge) ?? num(unidadeRaw.codigoIbge)?.toString() ?? null,
    linkSistemaOrigem: str(raw.linkSistemaOrigem),
    bruto: raw,
  };
}

/** Converte um item de /orgaos/{cnpj}/compras/{ano}/{seq}/itens. */
export function parseItem(raw: Bruto): Item | null {
  const numero = num(raw?.numeroItem);
  if (numero === null) return null;
  const sigiloso = raw.orcamentoSigiloso === true;
  return {
    numero,
    descricao: str(raw.descricao) ?? `Item ${numero}`,
    quantidade: num(raw.quantidade),
    unidade: str(raw.unidadeMedida)?.toUpperCase() ?? null,
    // Orçamento sigiloso: o PNCP manda 0, que não é o valor real
    valorUnitarioEstimado: sigiloso ? null : num(raw.valorUnitarioEstimado),
    valorTotal: sigiloso ? null : num(raw.valorTotal),
    tipo: str(raw.materialOuServicoNome),
    situacao: str(raw.situacaoCompraItemNome),
    criterioJulgamento: str(raw.criterioJulgamentoNome),
    sigiloso,
    temResultado: raw.temResultado === true,
    bruto: raw,
  };
}

/** Converte um resultado de .../itens/{numero}/resultados. */
export function parseResultado(raw: Bruto, numeroItem?: number): Resultado | null {
  const numero = num(raw?.numeroItem) ?? numeroItem ?? null;
  if (numero === null) return null;
  return {
    numeroItem: numero,
    sequencial: num(raw.sequencialResultado),
    niFornecedor: str(raw.niFornecedor)?.replace(/\D/g, "") || null,
    tipoPessoa: str(raw.tipoPessoa),
    nomeFornecedor: str(raw.nomeRazaoSocialFornecedor),
    porteFornecedor: str(raw.porteFornecedorNome),
    quantidadeHomologada: num(raw.quantidadeHomologada),
    valorUnitarioHomologado: num(raw.valorUnitarioHomologado),
    valorTotalHomologado: num(raw.valorTotalHomologado),
    ordemClassificacaoSrp: num(raw.ordemClassificacaoSrp),
    situacao: str(raw.situacaoCompraItemResultadoNome),
    dataResultado: toIsoBrt(raw.dataResultado),
    cancelado: Boolean(raw.dataCancelamento) || raw.cancelado === true,
    bruto: raw,
  };
}

/** Converte uma ata de /atas ou /atas/atualizacao. */
export function parseAta(raw: Bruto): Ata | null {
  const id = str(raw.numeroControlePNCPAta);
  const cnpj = str(raw.cnpjOrgao);
  const objeto = str(raw.objetoContratacao);
  const fim = date(raw.vigenciaFim);
  if (!id || !cnpj || !objeto || !fim) return null;
  return {
    id,
    compraId: str(raw.numeroControlePNCPCompra),
    numero: str(raw.numeroAtaRegistroPreco),
    ano: num(raw.anoAta),
    cnpj,
    orgao: str(raw.nomeOrgao) ?? "Órgão não informado",
    unidade: str(raw.nomeUnidadeOrgao),
    objeto,
    vigenciaInicio: date(raw.vigenciaInicio),
    vigenciaFim: fim,
    dataAssinatura: date(raw.dataAssinatura),
    cancelada: raw.cancelado === true || Boolean(raw.dataCancelamento),
    adesao: bool(raw.possibilidadeAdesao),
    bruto: raw,
  };
}

/** Converte um arquivo de .../compras/{ano}/{seq}/arquivos. `baseUrl` monta a URL quando ela não vem. */
export function parseArquivo(raw: Bruto, baseUrl?: string): Arquivo | null {
  const sequencial = num(raw?.sequencialDocumento);
  if (sequencial === null) return null;
  const url = str(raw.url) ?? str(raw.uri) ?? (baseUrl ? `${baseUrl}/${sequencial}` : null);
  if (!url) return null;
  return {
    sequencial,
    titulo: str(raw.titulo) ?? `Documento ${sequencial}`,
    tipo: str(raw.tipoDocumentoNome),
    url,
    dataPublicacao: toIsoBrt(raw.dataPublicacaoPncp),
    ativo: raw.statusAtivo !== false,
    bruto: raw,
  };
}
