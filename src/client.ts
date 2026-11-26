import { getJson, PncpError, type HttpOptions, type RequestOptions, type RetryInfo } from "./http.js";
import { parseArquivo, parseAta, parseContratacao, parseItem, parseResultado } from "./parse.js";
import type { Arquivo, Ata, Bruto, CompraRef, Contratacao, Item, Pagina, Resultado } from "./types.js";

export const CONSULTA_URL = "https://pncp.gov.br/api/consulta";
export const PNCP_URL = "https://pncp.gov.br/api/pncp";

/** Data como `Date`, `"AAAA-MM-DD"` ou `"AAAAMMDD"`. */
export type DataParam = Date | string;

export interface PncpClientOptions {
  /** `fetch` a usar (padrão: o global). Útil para testes, proxies e cache. */
  fetch?: typeof fetch;
  /** Timeout de cada requisição, em ms. Padrão: 30 000. */
  timeoutMs?: number;
  /** Novas tentativas depois de 429, 5xx, timeout ou erro de rede. Padrão: 3. */
  retries?: number;
  /** Espera base do backoff exponencial, em ms. Padrão: 1 000 (1 s, 2 s, 4 s...). */
  retryDelayMs?: number;
  /** Teto da espera entre tentativas, em ms. Padrão: 30 000. */
  maxRetryDelayMs?: number;
  /** Cabeçalho User-Agent. Padrão: `pncp-client`. Passe `null` para não enviar. */
  userAgent?: string | null;
  /** Cabeçalhos extras em todas as requisições. */
  headers?: Record<string, string>;
  /** URL base da API de consulta. Padrão: https://pncp.gov.br/api/consulta */
  consultaUrl?: string;
  /** URL base da API do PNCP (itens, resultados, arquivos). Padrão: https://pncp.gov.br/api/pncp */
  pncpUrl?: string;
  /** Chamado antes de cada nova tentativa (para log/métricas). */
  onRetry?: (info: RetryInfo) => void;
}

/** Filtros comuns das consultas de contratação. */
export interface FiltrosContratacao {
  uf?: string;
  codigoMunicipioIbge?: string;
  /** CNPJ do órgão, só dígitos. */
  cnpj?: string;
  codigoUnidadeAdministrativa?: string;
  /** Sistema de origem que publicou no PNCP. */
  idUsuario?: number;
  pagina?: number;
  /** Máximo 50 (a API devolve 400 acima disso). Padrão: 50. */
  tamanhoPagina?: number;
}

export interface PropostasAbertasParams extends FiltrosContratacao {
  /** Encerramento das propostas até esta data. */
  dataFinal: DataParam;
  /** Código de modalidade (ver `Modalidade`). */
  modalidade?: number;
}

export interface PeriodoContratacaoParams extends FiltrosContratacao {
  dataInicial: DataParam;
  dataFinal: DataParam;
  /** Código de modalidade (obrigatório nesta consulta; ver `Modalidade`). */
  modalidade: number;
  codigoModoDisputa?: number;
}

export interface AtasParams {
  dataInicial: DataParam;
  dataFinal: DataParam;
  cnpj?: string;
  codigoUnidadeAdministrativa?: string;
  idUsuario?: number;
  pagina?: number;
  /** Máximo 500. Padrão: 500. */
  tamanhoPagina?: number;
}

export interface ItensParams {
  pagina?: number;
  /** Padrão: 100. */
  tamanhoPagina?: number;
}

export interface IterarOptions extends RequestOptions {
  /** Para depois de N páginas. Padrão: sem limite (itens: 100). */
  maxPaginas?: number;
}

const MAX_CONTRATACOES = 50;
const MAX_ATAS = 500;

const BRT_OFFSET_MS = 3 * 60 * 60 * 1000;

/**
 * Formata a data como `AAAAMMDD`. Um `Date` é lido no horário de Brasília (UTC−3),
 * que é o fuso das datas do PNCP.
 */
export function formatarData(d: DataParam): string {
  if (d instanceof Date) {
    if (Number.isNaN(d.getTime())) throw new RangeError("Data inválida");
    return new Date(d.getTime() - BRT_OFFSET_MS).toISOString().slice(0, 10).replaceAll("-", "");
  }
  const m = /^(\d{4})-?(\d{2})-?(\d{2})$/.exec(d.trim());
  if (!m) throw new RangeError(`Data inválida: "${d}" (use AAAA-MM-DD, AAAAMMDD ou Date)`);
  return `${m[1]}${m[2]}${m[3]}`;
}

function tamanho(valor: number | undefined, padrao: number, max: number): number {
  const t = valor ?? padrao;
  if (!Number.isInteger(t) || t < 1 || t > max) throw new RangeError(`tamanhoPagina deve ser um inteiro entre 1 e ${max} (recebido: ${t})`);
  return t;
}

function pagina(valor: number | undefined): number {
  const p = valor ?? 1;
  if (!Number.isInteger(p) || p < 1) throw new RangeError(`pagina deve ser um inteiro ≥ 1 (recebido: ${p})`);
  return p;
}

function query(params: Record<string, string | number | undefined | null>): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== "") q.set(k, String(v));
  return q.toString();
}

/** Monta uma `Pagina` a partir da resposta paginada da API de consulta. */
function toPagina<T>(body: unknown, numero: number, parse: (r: Bruto) => T | null): Pagina<T> {
  const b = (body && typeof body === "object" ? body : {}) as Bruto;
  const rows = Array.isArray(b.data) ? (b.data as Bruto[]) : [];
  const dados = rows.flatMap((r) => {
    const v = r && typeof r === "object" ? parse(r) : null;
    return v ? [v] : [];
  });
  const totalPaginas = typeof b.totalPaginas === "number" ? b.totalPaginas : rows.length ? numero : 0;
  return {
    dados,
    pagina: numero,
    totalPaginas,
    totalRegistros: typeof b.totalRegistros === "number" ? b.totalRegistros : dados.length,
    paginasRestantes: typeof b.paginasRestantes === "number" ? b.paginasRestantes : Math.max(0, totalPaginas - numero),
    ignorados: rows.length - dados.length,
  };
}

/**
 * Percorre uma consulta paginada página a página, devolvendo cada registro.
 * Para na última página, numa página vazia (204) ou depois de `maxPaginas`.
 */
export async function* paginar<T>(
  buscar: (pagina: number) => Promise<Pagina<T>>,
  { paginaInicial = 1, maxPaginas = Infinity }: { paginaInicial?: number; maxPaginas?: number } = {},
): AsyncGenerator<T, void, undefined> {
  for (let p = paginaInicial, n = 0; n < maxPaginas; p++, n++) {
    const page = await buscar(p);
    yield* page.dados;
    if (page.dados.length + page.ignorados === 0 || p >= page.totalPaginas) return;
  }
}

/** Cliente da API pública do PNCP. */
export class PncpClient {
  readonly #http: HttpOptions;
  readonly #consulta: string;
  readonly #pncp: string;

  constructor(options: PncpClientOptions = {}) {
    const fetchImpl = options.fetch ?? globalThis.fetch;
    if (typeof fetchImpl !== "function") throw new TypeError("fetch não disponível: passe `fetch` nas opções");
    this.#http = {
      fetch: fetchImpl,
      timeoutMs: options.timeoutMs ?? 30_000,
      retries: options.retries ?? 3,
      retryDelayMs: options.retryDelayMs ?? 1_000,
      maxRetryDelayMs: options.maxRetryDelayMs ?? 30_000,
      userAgent: options.userAgent === null ? undefined : (options.userAgent ?? "pncp-client"),
      headers: options.headers,
      onRetry: options.onRetry,
    };
    this.#consulta = (options.consultaUrl ?? CONSULTA_URL).replace(/\/+$/, "");
    this.#pncp = (options.pncpUrl ?? PNCP_URL).replace(/\/+$/, "");
  }

  /** GET cru em JSON (com timeout e retry) para endpoints que o cliente ainda não cobre. */
  get(url: string, opts?: RequestOptions): Promise<unknown> {
    return getJson(url, this.#http, opts);
  }

  #compra(c: CompraRef): string {
    return `${this.#pncp}/v1/orgaos/${encodeURIComponent(c.cnpj)}/compras/${c.ano}/${c.sequencial}`;
  }

  #filtros(p: FiltrosContratacao) {
    return {
      uf: p.uf?.toUpperCase(),
      codigoMunicipioIbge: p.codigoMunicipioIbge,
      cnpj: p.cnpj,
      codigoUnidadeAdministrativa: p.codigoUnidadeAdministrativa,
      idUsuario: p.idUsuario,
    };
  }

  // ---------- Contratações ----------

  /**
   * Contratações com recebimento de propostas em aberto.
   * `GET /v1/contratacoes/proposta`
   */
  async propostasAbertas(params: PropostasAbertasParams, opts?: RequestOptions): Promise<Pagina<Contratacao>> {
    const p = pagina(params.pagina);
    const q = query({
      dataFinal: formatarData(params.dataFinal),
      codigoModalidadeContratacao: params.modalidade,
      ...this.#filtros(params),
      pagina: p,
      tamanhoPagina: tamanho(params.tamanhoPagina, MAX_CONTRATACOES, MAX_CONTRATACOES),
    });
    return toPagina(await this.get(`${this.#consulta}/v1/contratacoes/proposta?${q}`, opts), p, parseContratacao);
  }

  /** Todas as contratações com proposta aberta, página a página. */
  iterarPropostasAbertas(params: Omit<PropostasAbertasParams, "pagina">, opts: IterarOptions = {}): AsyncGenerator<Contratacao> {
    return paginar((pagina) => this.propostasAbertas({ ...params, pagina }, opts), opts);
  }

  /**
   * Contratações publicadas num período (inclui as já encerradas).
   * `GET /v1/contratacoes/publicacao`
   */
  publicacoes(params: PeriodoContratacaoParams, opts?: RequestOptions): Promise<Pagina<Contratacao>> {
    return this.#periodo("publicacao", params, opts);
  }

  iterarPublicacoes(params: Omit<PeriodoContratacaoParams, "pagina">, opts: IterarOptions = {}): AsyncGenerator<Contratacao> {
    return paginar((pagina) => this.publicacoes({ ...params, pagina }, opts), opts);
  }

  /**
   * Contratações atualizadas num período (retificações, mudança de situação etc.).
   * `GET /v1/contratacoes/atualizacao`
   */
  atualizacoes(params: PeriodoContratacaoParams, opts?: RequestOptions): Promise<Pagina<Contratacao>> {
    return this.#periodo("atualizacao", params, opts);
  }

  iterarAtualizacoes(params: Omit<PeriodoContratacaoParams, "pagina">, opts: IterarOptions = {}): AsyncGenerator<Contratacao> {
    return paginar((pagina) => this.atualizacoes({ ...params, pagina }, opts), opts);
  }

  async #periodo(tipo: "publicacao" | "atualizacao", params: PeriodoContratacaoParams, opts?: RequestOptions) {
    const p = pagina(params.pagina);
    const q = query({
      dataInicial: formatarData(params.dataInicial),
      dataFinal: formatarData(params.dataFinal),
      codigoModalidadeContratacao: params.modalidade,
      codigoModoDisputa: params.codigoModoDisputa,
      ...this.#filtros(params),
      pagina: p,
      tamanhoPagina: tamanho(params.tamanhoPagina, MAX_CONTRATACOES, MAX_CONTRATACOES),
    });
    return toPagina(await this.get(`${this.#consulta}/v1/contratacoes/${tipo}?${q}`, opts), p, parseContratacao);
  }

  /**
   * Uma contratação pelo CNPJ/ano/sequencial (ou `parseNumeroControle(id)`). `null` se não existir.
   * `GET /v1/orgaos/{cnpj}/compras/{ano}/{sequencial}`
   */
  async contratacao(c: CompraRef, opts?: RequestOptions): Promise<Contratacao | null> {
    try {
      const body = await this.get(`${this.#consulta}/v1/orgaos/${encodeURIComponent(c.cnpj)}/compras/${c.ano}/${c.sequencial}`, opts);
      return body && typeof body === "object" ? parseContratacao(body as Bruto) : null;
    } catch (err) {
      if (err instanceof PncpError && err.status === 404) return null;
      throw err;
    }
  }

  // ---------- Itens e resultados ----------

  /**
   * Uma página de itens da contratação.
   * `GET /v1/orgaos/{cnpj}/compras/{ano}/{sequencial}/itens`
   */
  async itens(c: CompraRef, params: ItensParams = {}, opts?: RequestOptions): Promise<Item[]> {
    const q = query({ pagina: pagina(params.pagina), tamanhoPagina: tamanho(params.tamanhoPagina, 100, 1000) });
    const body = await this.get(`${this.#compra(c)}/itens?${q}`, opts);
    return Array.isArray(body) ? body.flatMap((r: Bruto) => parseItem(r) ?? []) : [];
  }

  /**
   * Todos os itens da contratação, sem repetidos. Para quando a página vem incompleta
   * ou quando a API ignora a paginação e repete os mesmos itens.
   */
  async *iterarItens(c: CompraRef, opts: IterarOptions & { tamanhoPagina?: number } = {}): AsyncGenerator<Item> {
    const size = tamanho(opts.tamanhoPagina, 100, 1000);
    const vistos = new Set<number>();
    for (let p = 1; p <= (opts.maxPaginas ?? 100); p++) {
      const page = await this.itens(c, { pagina: p, tamanhoPagina: size }, opts);
      let novos = 0;
      for (const item of page) {
        if (vistos.has(item.numero)) continue;
        vistos.add(item.numero);
        novos++;
        yield item;
      }
      if (page.length < size || novos === 0) return;
    }
  }

  /**
   * Resultados (fornecedores homologados) de um item. `[]` quando ainda não há.
   * `GET /v1/orgaos/{cnpj}/compras/{ano}/{sequencial}/itens/{numeroItem}/resultados`
   */
  async resultados(c: CompraRef, numeroItem: number, opts?: RequestOptions): Promise<Resultado[]> {
    let body: unknown;
    try {
      body = await this.get(`${this.#compra(c)}/itens/${numeroItem}/resultados`, opts);
    } catch (err) {
      if (err instanceof PncpError && err.status === 404) return [];
      throw err;
    }
    return Array.isArray(body) ? body.flatMap((r: Bruto) => parseResultado(r, numeroItem) ?? []) : [];
  }

  /** Percorre os itens que já têm resultado, junto com os resultados de cada um. */
  async *iterarResultados(
    c: CompraRef,
    opts: IterarOptions = {},
  ): AsyncGenerator<{ item: Item; resultados: Resultado[] }> {
    for await (const item of this.iterarItens(c, opts)) {
      if (!item.temResultado) continue;
      yield { item, resultados: await this.resultados(c, item.numero, opts) };
    }
  }

  // ---------- Arquivos ----------

  /**
   * Arquivos da contratação (edital, termo de referência, anexos).
   * `GET /v1/orgaos/{cnpj}/compras/{ano}/{sequencial}/arquivos`
   */
  async arquivos(c: CompraRef, opts?: RequestOptions): Promise<Arquivo[]> {
    const base = `${this.#compra(c)}/arquivos`;
    const body = await this.get(base, opts);
    return Array.isArray(body) ? body.flatMap((r: Bruto) => parseArquivo(r, base) ?? []) : [];
  }

  // ---------- Atas de registro de preço ----------

  /**
   * Atas com vigência no período.
   * `GET /v1/atas`
   */
  atas(params: AtasParams, opts?: RequestOptions): Promise<Pagina<Ata>> {
    return this.#atas("atas", params, opts);
  }

  iterarAtas(params: Omit<AtasParams, "pagina">, opts: IterarOptions = {}): AsyncGenerator<Ata> {
    return paginar((pagina) => this.atas({ ...params, pagina }, opts), opts);
  }

  /**
   * Atas incluídas ou alteradas no período.
   * `GET /v1/atas/atualizacao`
   */
  atasAtualizadas(params: AtasParams, opts?: RequestOptions): Promise<Pagina<Ata>> {
    return this.#atas("atas/atualizacao", params, opts);
  }

  iterarAtasAtualizadas(params: Omit<AtasParams, "pagina">, opts: IterarOptions = {}): AsyncGenerator<Ata> {
    return paginar((pagina) => this.atasAtualizadas({ ...params, pagina }, opts), opts);
  }

  async #atas(path: string, params: AtasParams, opts?: RequestOptions) {
    const p = pagina(params.pagina);
    const q = query({
      dataInicial: formatarData(params.dataInicial),
      dataFinal: formatarData(params.dataFinal),
      cnpj: params.cnpj,
      codigoUnidadeAdministrativa: params.codigoUnidadeAdministrativa,
      idUsuario: params.idUsuario,
      pagina: p,
      tamanhoPagina: tamanho(params.tamanhoPagina, MAX_ATAS, MAX_ATAS),
    });
    return toPagina(await this.get(`${this.#consulta}/v1/${path}?${q}`, opts), p, parseAta);
  }
}
