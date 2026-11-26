import { vi } from "vitest";

export const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

export const empty = () => new Response(null, { status: 204 });

type Handler = (url: URL, init: RequestInit | undefined) => Response | Promise<Response>;

/** `fetch` falso: registra as chamadas e responde com o handler. */
export function mockFetch(handler: Handler) {
  return vi.fn(async (input: string | URL | Request, init?: RequestInit) =>
    handler(new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url), init),
  );
}

/** Responde em sequência; repete a última resposta. */
export function sequence(...responses: Array<() => Response | Promise<Response>>) {
  let i = 0;
  return mockFetch(() => responses[Math.min(i++, responses.length - 1)]!());
}

export const urlOf = (fn: ReturnType<typeof mockFetch>, call = 0) => new URL(String(fn.mock.calls[call]![0]));
