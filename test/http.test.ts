import { afterEach, describe, expect, it, vi } from "vitest";
import { getJson, parseRetryAfter, PncpError, type HttpOptions } from "../src/http.js";
import { empty, json, mockFetch, sequence } from "./helpers.js";

const opts = (fetch: typeof globalThis.fetch, extra: Partial<HttpOptions> = {}): HttpOptions => ({
  fetch,
  timeoutMs: 1_000,
  retries: 3,
  retryDelayMs: 0,
  maxRetryDelayMs: 30_000,
  ...extra,
});

afterEach(() => vi.useRealTimers());

describe("getJson", () => {
  it("devolve o JSON e manda os cabeçalhos", async () => {
    const f = mockFetch(() => json({ ok: true }));
    await expect(getJson("https://x/a", opts(f, { userAgent: "teste/1", headers: { "x-a": "1" } }))).resolves.toEqual({ ok: true });
    const headers = f.mock.calls[0]![1]!.headers as Record<string, string>;
    expect(headers).toMatchObject({ accept: "application/json", "user-agent": "teste/1", "x-a": "1" });
  });

  it("204 e corpo vazio viram null", async () => {
    await expect(getJson("https://x", opts(mockFetch(empty)))).resolves.toBeNull();
    await expect(getJson("https://x", opts(mockFetch(() => new Response("", { status: 200 }))))).resolves.toBeNull();
  });

  it("tenta de novo em 5xx e 429", async () => {
    const f = sequence(() => json({}, 503), () => json({}, 429), () => json({ ok: 1 }));
    const onRetry = vi.fn();
    await expect(getJson("https://x", opts(f, { onRetry }))).resolves.toEqual({ ok: 1 });
    expect(f).toHaveBeenCalledTimes(3);
    expect(onRetry.mock.calls.map((c) => [c[0].attempt, c[0].status])).toEqual([[1, 503], [2, 429]]);
  });

  it("falha na hora em 4xx, com status e corpo no erro", async () => {
    const f = mockFetch(() => new Response("tamanhoPagina inválido", { status: 400 }));
    const err = await getJson("https://x/b", opts(f)).catch((e) => e);
    expect(err).toBeInstanceOf(PncpError);
    expect(err).toMatchObject({ status: 400, url: "https://x/b", body: "tamanhoPagina inválido" });
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("desiste depois de `retries` e lança o último erro", async () => {
    const f = mockFetch(() => json({}, 502));
    await expect(getJson("https://x", opts(f, { retries: 2 }))).rejects.toMatchObject({ status: 502 });
    expect(f).toHaveBeenCalledTimes(3);
  });

  it("usa backoff exponencial com teto", async () => {
    vi.useFakeTimers();
    const delays: number[] = [];
    const f = mockFetch(() => json({}, 500));
    const p = getJson("https://x", opts(f, { retries: 4, retryDelayMs: 1_000, maxRetryDelayMs: 5_000, onRetry: (i) => delays.push(i.delayMs) })).catch((e) => e);
    await vi.runAllTimersAsync();
    expect(await p).toBeInstanceOf(PncpError);
    expect(delays).toEqual([1_000, 2_000, 4_000, 5_000]);
  });

  it("respeita Retry-After do 429", async () => {
    vi.useFakeTimers();
    const delays: number[] = [];
    const f = sequence(() => json({}, 429, { "retry-after": "7" }), () => json([1]));
    const p = getJson("https://x", opts(f, { retryDelayMs: 1_000, onRetry: (i) => delays.push(i.delayMs) }));
    await vi.advanceTimersByTimeAsync(6_999);
    expect(f).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await expect(p).resolves.toEqual([1]);
    expect(delays).toEqual([7_000]);
  });

  it("trata erro de rede e timeout como transitórios", async () => {
    const f = sequence(
      () => Promise.reject(new TypeError("fetch failed")),
      () => json("ok"),
    );
    await expect(getJson("https://x", opts(f))).resolves.toBe("ok");

    const hang = mockFetch(
      (_, init) => new Promise<Response>((_, reject) => init!.signal!.addEventListener("abort", () => reject(init!.signal!.reason))),
    );
    const err = await getJson("https://x", opts(hang, { timeoutMs: 20, retries: 1 })).then(
      () => null,
      (e: PncpError) => e,
    );
    expect(err).toBeInstanceOf(PncpError);
    expect(err!.status).toBeNull();
    expect(err!.message).toMatch(/timeout de 20 ms/);
    expect(hang).toHaveBeenCalledTimes(2);
  });

  it("para na hora quando o usuário aborta, inclusive durante a espera", async () => {
    const controller = new AbortController();
    const f = mockFetch(() => json({}, 503));
    const p = getJson("https://x", opts(f, { retryDelayMs: 60_000, onRetry: () => controller.abort(new Error("cancelado")) }), {
      signal: controller.signal,
    });
    await expect(p).rejects.toThrow("cancelado");
    expect(f).toHaveBeenCalledTimes(1);

    await expect(getJson("https://x", opts(f), { signal: AbortSignal.abort(new Error("antes")) })).rejects.toThrow("antes");
  });

  it("opções por requisição sobrepõem as do cliente", async () => {
    const f = mockFetch(() => json({}, 500));
    await expect(getJson("https://x", opts(f), { retries: 0 })).rejects.toBeInstanceOf(PncpError);
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("JSON inválido não é repetido", async () => {
    const f = mockFetch(() => new Response("<html>", { status: 200 }));
    await expect(getJson("https://x", opts(f))).rejects.toThrow(/JSON inválido/);
    expect(f).toHaveBeenCalledTimes(1);
  });
});

describe("parseRetryAfter", () => {
  it("lê segundos e datas HTTP", () => {
    expect(parseRetryAfter("3")).toBe(3_000);
    expect(parseRetryAfter("0.5")).toBe(500);
    expect(parseRetryAfter("Thu, 26 Nov 2026 12:00:10 GMT", Date.parse("2026-11-26T12:00:00Z"))).toBe(10_000);
    expect(parseRetryAfter(null)).toBeNull();
    expect(parseRetryAfter("amanhã")).toBeNull();
  });
});
