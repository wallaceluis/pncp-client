/** Erro de HTTP ou de rede ao falar com o PNCP. */
export class PncpError extends Error {
  override readonly name = "PncpError";
  constructor(
    message: string,
    /** Status HTTP; `null` quando a falha foi de rede ou timeout. */
    readonly status: number | null,
    readonly url: string,
    /** Corpo da resposta de erro (texto), quando houver. */
    readonly body?: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
  }
}

export interface RetryInfo {
  url: string;
  /** Tentativa que falhou (1 = primeira). */
  attempt: number;
  /** Quanto o cliente vai esperar antes da próxima tentativa. */
  delayMs: number;
  /** Status HTTP da falha, ou `null` para erro de rede/timeout. */
  status: number | null;
  error: unknown;
}

export interface HttpOptions {
  fetch: typeof fetch;
  /** Timeout de cada requisição, em ms. */
  timeoutMs: number;
  /** Quantas vezes tentar de novo depois da primeira falha transitória. */
  retries: number;
  /** Espera base do backoff exponencial (base · 2^tentativa), em ms. */
  retryDelayMs: number;
  /** Teto de espera entre tentativas (inclusive para `Retry-After`), em ms. */
  maxRetryDelayMs: number;
  userAgent?: string;
  headers?: Record<string, string>;
  onRetry?: (info: RetryInfo) => void;
}

export interface RequestOptions {
  signal?: AbortSignal;
  retries?: number;
  timeoutMs?: number;
}

const isTransient = (status: number) => status === 429 || status >= 500;

/** Lê `Retry-After` em segundos ou como data HTTP. */
export function parseRetryAfter(value: string | null, now = Date.now()): number | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (/^\d+(\.\d+)?$/.test(trimmed)) return Math.round(Number(trimmed) * 1000);
  const date = Date.parse(trimmed);
  return Number.isNaN(date) ? null : Math.max(0, date - now);
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal!.reason);
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/** Junta o sinal do usuário com o timeout da requisição (sem depender de AbortSignal.any). */
function withTimeout(timeoutMs: number, signal?: AbortSignal): { signal: AbortSignal; timedOut: () => boolean; done: () => void } {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort(new DOMException(`timeout de ${timeoutMs} ms`, "TimeoutError"));
  }, timeoutMs);
  const onAbort = () => controller.abort(signal!.reason);
  if (signal?.aborted) onAbort();
  else signal?.addEventListener("abort", onAbort, { once: true });
  return {
    signal: controller.signal,
    timedOut: () => timedOut,
    done: () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    },
  };
}

/**
 * GET em JSON com timeout e retry.
 *
 * - 200: devolve o JSON; 204 (página vazia): devolve `null`.
 * - 429 e 5xx, erro de rede e timeout: tenta de novo com backoff exponencial,
 *   respeitando `Retry-After` quando a API manda.
 * - Outros 4xx: lança `PncpError` na hora.
 * - Abortar pelo `signal` interrompe inclusive a espera entre tentativas.
 */
export async function getJson(url: string, http: HttpOptions, req: RequestOptions = {}): Promise<unknown> {
  const retries = req.retries ?? http.retries;
  const timeoutMs = req.timeoutMs ?? http.timeoutMs;
  const headers: Record<string, string> = { accept: "application/json", ...http.headers };
  if (http.userAgent) headers["user-agent"] = http.userAgent;

  for (let attempt = 0; ; attempt++) {
    req.signal?.throwIfAborted();
    const t = withTimeout(timeoutMs, req.signal);
    let error!: PncpError;
    let retryAfter: number | null = null;
    try {
      const res = await http.fetch(url, { headers, signal: t.signal });
      if (res.status === 204) return null;
      if (res.ok) {
        const text = await res.text();
        return text.trim() ? JSON.parse(text) : null;
      }
      const body = await res.text().catch(() => undefined);
      error = new PncpError(`PNCP respondeu ${res.status} em ${url}`, res.status, url, body);
      if (!isTransient(res.status)) throw error;
      retryAfter = parseRetryAfter(res.headers.get("retry-after"));
    } catch (err) {
      if (err instanceof PncpError && err.status !== null && !isTransient(err.status)) throw err;
      if (err instanceof PncpError) error = err;
      else if (req.signal?.aborted && !t.timedOut()) throw req.signal.reason;
      else if (err instanceof SyntaxError) throw new PncpError(`JSON inválido em ${url}`, 200, url, undefined, { cause: err });
      else {
        const what = t.timedOut() ? `timeout de ${timeoutMs} ms` : "falha de rede";
        error = new PncpError(`PNCP: ${what} em ${url}`, null, url, undefined, { cause: err });
      }
    } finally {
      t.done();
    }

    if (attempt >= retries) throw error;
    const backoff = http.retryDelayMs * 2 ** attempt;
    const delayMs = Math.min(http.maxRetryDelayMs, retryAfter ?? backoff);
    http.onRetry?.({ url, attempt: attempt + 1, delayMs, status: error.status, error });
    await sleep(delayMs, req.signal);
  }
}
