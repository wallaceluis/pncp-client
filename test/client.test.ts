import { describe, expect, it } from "vitest";
import { formatarData, Modalidade, paginar, PncpClient, PncpError, type Pagina } from "../src/index.js";
import { rawAta, rawContratacao, rawItem, rawResultado } from "./fixtures/pncp.js";
import { empty, json, mockFetch, urlOf } from "./helpers.js";

const compra = { cnpj: "00394718000100", ano: 2026, sequencial: 21 };
const client = (fetch: ReturnType<typeof mockFetch>) => new PncpClient({ fetch, retryDelayMs: 0 });

describe("propostasAbertas", () => {
  it("monta a consulta e interpreta a página", async () => {
    const f = mockFetch(() => json({ data: [rawContratacao(), { numeroControlePNCP: "x" }], totalPaginas: 3, totalRegistros: 120, paginasRestantes: 1 }));
    const page = await client(f).propostasAbertas({ dataFinal: new Date("2026-12-31T12:00:00Z"), modalidade: Modalidade.PregaoEletronico, uf: "sp", pagina: 2 });

    const url = urlOf(f);
    expect(url.origin + url.pathname).toBe("https://pncp.gov.br/api/consulta/v1/contratacoes/proposta");
    expect(Object.fromEntries(url.searchParams)).toEqual({ dataFinal: "20261231", codigoModalidadeContratacao: "6", uf: "SP", pagina: "2", tamanhoPagina: "50" });
    expect(page).toMatchObject({ pagina: 2, totalPaginas: 3, totalRegistros: 120, paginasRestantes: 1, ignorados: 1 });
    expect(page.dados).toHaveLength(1);
    expect(page.dados[0]!.id).toBe("00394718000100-1-000021/2026");
  });

  it("trata 204 como página vazia", async () => {
    const page = await client(mockFetch(empty)).propostasAbertas({ dataFinal: "2026-12-31" });
    expect(page).toMatchObject({ dados: [], totalPaginas: 0, totalRegistros: 0, paginasRestantes: 0 });
  });

  it("recusa tamanhoPagina acima de 50 sem chamar a API", async () => {
    const f = mockFetch(() => json({}));
    await expect(client(f).propostasAbertas({ dataFinal: "2026-12-31", tamanhoPagina: 100 })).rejects.toBeInstanceOf(RangeError);
    await expect(client(f).propostasAbertas({ dataFinal: "2026-12-31", tamanhoPagina: 9 })).rejects.toBeInstanceOf(RangeError);
    await expect(client(f).atas({ dataInicial: "2026-12-01", dataFinal: "2026-12-31", tamanhoPagina: 5 })).rejects.toBeInstanceOf(RangeError);
    await expect(client(f).propostasAbertas({ dataFinal: "31/12/2026" })).rejects.toBeInstanceOf(RangeError);
    expect(f).not.toHaveBeenCalled();
  });

  it("repete 5xx e falha na hora em 4xx", async () => {
    let calls = 0;
    const flaky = mockFetch(() => (++calls < 3 ? json({}, 503) : json({ data: [], totalPaginas: 0 })));
    await client(flaky).propostasAbertas({ dataFinal: "20261231" });
    expect(calls).toBe(3);

    await expect(client(mockFetch(() => json({}, 400))).propostasAbertas({ dataFinal: "20261231" })).rejects.toBeInstanceOf(PncpError);
  });
});

describe("publicacoes e atualizacoes", () => {
  it("mandam período e modalidade", async () => {
    const f = mockFetch(() => json({ data: [rawContratacao()], totalPaginas: 1 }));
    const c = client(f);
    await c.publicacoes({ dataInicial: "2026-11-01", dataFinal: "2026-11-02", modalidade: 8, cnpj: "123", tamanhoPagina: 10 });
    await c.atualizacoes({ dataInicial: "2026-11-01", dataFinal: "2026-11-01", modalidade: 6 });
    expect(urlOf(f, 0).pathname).toBe("/api/consulta/v1/contratacoes/publicacao");
    expect(Object.fromEntries(urlOf(f, 0).searchParams)).toEqual({
      dataInicial: "20261101",
      dataFinal: "20261102",
      codigoModalidadeContratacao: "8",
      cnpj: "123",
      pagina: "1",
      tamanhoPagina: "10",
    });
    expect(urlOf(f, 1).pathname).toBe("/api/consulta/v1/contratacoes/atualizacao");
  });
});

describe("paginação", () => {
  it("percorre todas as páginas", async () => {
    const f = mockFetch((url) => {
      const p = Number(url.searchParams.get("pagina"));
      return json({ data: [rawContratacao({ numeroControlePNCP: `00394718000100-1-00000${p}/2026`, sequencialCompra: p })], totalPaginas: 3 });
    });
    const ids: string[] = [];
    for await (const c of client(f).iterarPublicacoes({ dataInicial: "2026-11-01", dataFinal: "2026-11-01", modalidade: 6 })) ids.push(c.id);
    expect(ids).toEqual(["00394718000100-1-000001/2026", "00394718000100-1-000002/2026", "00394718000100-1-000003/2026"]);
    expect(f).toHaveBeenCalledTimes(3);
  });

  it("para em página vazia e respeita maxPaginas", async () => {
    const f = mockFetch((url) => (url.searchParams.get("pagina") === "1" ? json({ data: [rawContratacao()], totalPaginas: 9 }) : empty()));
    const all = [];
    for await (const c of client(f).iterarPropostasAbertas({ dataFinal: "2026-12-31" })) all.push(c);
    expect(all).toHaveLength(1);
    expect(f).toHaveBeenCalledTimes(2);

    const g = mockFetch(() => json({ data: [rawContratacao()], totalPaginas: 99 }));
    let n = 0;
    for await (const _ of client(g).iterarPropostasAbertas({ dataFinal: "2026-12-31" }, { maxPaginas: 2 })) n++;
    expect(n).toBe(2);
  });

  it("paginar funciona com qualquer função de página", async () => {
    const pages: Pagina<number>[] = [1, 2].map((p) => ({ dados: [p * 10, p * 10 + 1], pagina: p, totalPaginas: 2, totalRegistros: 4, paginasRestantes: 2 - p, ignorados: 0 }));
    const out: number[] = [];
    for await (const v of paginar(async (p) => pages[p - 1]!)) out.push(v);
    expect(out).toEqual([10, 11, 20, 21]);
  });
});

describe("contratacao", () => {
  it("busca uma contratação e devolve null em 404", async () => {
    const f = mockFetch((url) => (url.pathname.endsWith("/21") ? json(rawContratacao()) : json({}, 404)));
    const c = client(f);
    expect((await c.contratacao(compra))!.id).toBe("00394718000100-1-000021/2026");
    expect(urlOf(f).pathname).toBe("/api/consulta/v1/orgaos/00394718000100/compras/2026/21");
    expect(await c.contratacao({ ...compra, sequencial: 22 })).toBeNull();
  });
});

describe("itens e resultados", () => {
  it("busca uma página de itens", async () => {
    const f = mockFetch(() => json([rawItem(1), rawItem(2), { semNumero: true }]));
    const itens = await client(f).itens(compra, { pagina: 2, tamanhoPagina: 30 });
    expect(itens.map((i) => i.numero)).toEqual([1, 2]);
    expect(urlOf(f).pathname).toBe("/api/pncp/v1/orgaos/00394718000100/compras/2026/21/itens");
    expect(Object.fromEntries(urlOf(f).searchParams)).toEqual({ pagina: "2", tamanhoPagina: "30" });
  });

  it("iterarItens pagina, tira repetidos e para se a API ignorar a paginação", async () => {
    const pagina = (from: number, size: number) => Array.from({ length: size }, (_, i) => rawItem(from + i));
    const f = mockFetch((url) => (url.searchParams.get("pagina") === "1" ? json(pagina(1, 3)) : json(pagina(4, 1))));
    const nums: number[] = [];
    for await (const i of client(f).iterarItens(compra, { tamanhoPagina: 3 })) nums.push(i.numero);
    expect(nums).toEqual([1, 2, 3, 4]);

    const ignora = mockFetch(() => json(pagina(1, 3)));
    nums.length = 0;
    for await (const i of client(ignora).iterarItens(compra, { tamanhoPagina: 3 })) nums.push(i.numero);
    expect(nums).toEqual([1, 2, 3]);
    expect(ignora).toHaveBeenCalledTimes(2);
  });

  it("busca resultados só dos itens que têm", async () => {
    const f = mockFetch((url) => {
      if (url.pathname.endsWith("/itens")) return json([rawItem(1, { temResultado: true }), rawItem(2)]);
      if (url.pathname.endsWith("/itens/1/resultados")) return json([rawResultado()]);
      return json({}, 404);
    });
    const out = [];
    for await (const r of client(f).iterarResultados(compra)) out.push(r);
    expect(out).toHaveLength(1);
    expect(out[0]!.item.numero).toBe(1);
    expect(out[0]!.resultados[0]).toMatchObject({ niFornecedor: "12345678000199", valorUnitarioHomologado: 20 });
    expect(await client(f).resultados(compra, 2)).toEqual([]);
  });
});

describe("arquivos", () => {
  it("lista os arquivos", async () => {
    const f = mockFetch(() => json([{ sequencialDocumento: 1, titulo: "Edital", tipoDocumentoNome: "Edital", url: "https://x/1" }, { sequencialDocumento: 2 }, { titulo: "sem seq" }]));
    const files = await client(f).arquivos(compra);
    expect(files.map(({ bruto, ...f }) => f)).toEqual([
      { sequencial: 1, titulo: "Edital", tipo: "Edital", url: "https://x/1", dataPublicacao: null, ativo: true },
      {
        sequencial: 2,
        titulo: "Documento 2",
        tipo: null,
        url: "https://pncp.gov.br/api/pncp/v1/orgaos/00394718000100/compras/2026/21/arquivos/2",
        dataPublicacao: null,
        ativo: true,
      },
    ]);
  });
});

describe("atas", () => {
  it("consulta vigência e atualização", async () => {
    const f = mockFetch(() => json({ data: [rawAta(), { numeroControlePNCPAta: "sem resto" }], totalPaginas: 1, totalRegistros: 2 }));
    const c = client(f);
    const page = await c.atas({ dataInicial: "2026-11-01", dataFinal: "2026-11-30" });
    expect(page).toMatchObject({ totalPaginas: 1, ignorados: 1 });
    expect(page.dados[0]!.vigenciaFim).toBe("2027-10-31");
    expect(urlOf(f).pathname).toBe("/api/consulta/v1/atas");
    expect(urlOf(f).searchParams.get("tamanhoPagina")).toBe("500");

    for await (const _ of c.iterarAtasAtualizadas({ dataInicial: "2026-11-01", dataFinal: "2026-11-01" })) break;
    expect(urlOf(f, 1).pathname).toBe("/api/consulta/v1/atas/atualizacao");
  });
});

describe("opções do cliente", () => {
  it("aceita URLs base, user-agent e cabeçalhos", async () => {
    const f = mockFetch(() => json([]));
    const c = new PncpClient({ fetch: f, consultaUrl: "http://localhost:9000/consulta/", pncpUrl: "http://localhost:9000/pncp", userAgent: "meu-app/2", headers: { "x-k": "1" } });
    await c.arquivos(compra);
    await c.propostasAbertas({ dataFinal: "2026-12-31" });
    expect(String(f.mock.calls[0]![0])).toBe("http://localhost:9000/pncp/v1/orgaos/00394718000100/compras/2026/21/arquivos");
    expect(String(f.mock.calls[1]![0])).toMatch(/^http:\/\/localhost:9000\/consulta\/v1\/contratacoes\/proposta\?/);
    expect(f.mock.calls[0]![1]!.headers).toMatchObject({ "user-agent": "meu-app/2", "x-k": "1" });
  });
});

describe("formatarData", () => {
  it("lê Date no horário de Brasília e aceita strings", () => {
    expect(formatarData(new Date("2026-12-31T12:00:00Z"))).toBe("20261231");
    // 01h UTC do dia 1º ainda é dia 31 em Brasília
    expect(formatarData(new Date("2027-01-01T01:00:00Z"))).toBe("20261231");
    expect(formatarData("2026-03-05")).toBe("20260305");
    expect(formatarData("20260305")).toBe("20260305");
    expect(() => formatarData("ontem")).toThrow(RangeError);
    expect(() => formatarData(new Date("x"))).toThrow(RangeError);
  });
});
