import { describe, expect, it } from "vitest";
import { MODALIDADES, Modalidade, nomeModalidade } from "../src/modalidades.js";
import { linkEdital, parseArquivo, parseAta, parseContratacao, parseItem, parseNumeroControle, parseResultado, toIsoBrt } from "../src/parse.js";
import { rawAta, rawContratacao, rawItem, rawResultado } from "./fixtures/pncp.js";

describe("parseContratacao", () => {
  it("lê o formato oficial aninhado", () => {
    const raw = rawContratacao();
    const c = parseContratacao(raw)!;
    expect(c).toMatchObject({
      id: "00394718000100-1-000021/2026",
      cnpj: "00394718000100",
      ano: 2026,
      sequencial: 21,
      modalidadeId: 6,
      modalidadeNome: "Pregão - Eletrônico",
      valorEstimado: 250000.5,
      orgao: "MUNICIPIO DE CAMPINAS",
      unidade: "Secretaria de Administração",
      uf: "SP",
      municipio: "Campinas",
      codigoIbge: "3509502",
      dataEncerramento: "2026-10-25T12:30:00.000Z",
    });
    expect(c.bruto).toBe(raw);
  });

  it("usa o numeroControlePNCP e campos achatados como alternativa", () => {
    const c = parseContratacao({
      numeroControlePNCP: "12345678000199-1-000007/2025",
      objetoCompra: "Aquisição de notebooks",
      orgaoRazaoSocial: "ESTADO X",
      uf: "mg",
      municipio: "Belo Horizonte",
      modalidadeId: 8,
    })!;
    expect(c).toMatchObject({ cnpj: "12345678000199", ano: 2025, sequencial: 7, uf: "MG", orgao: "ESTADO X", modalidadeNome: "Dispensa de licitação" });
  });

  it("descarta registros sem id, objeto ou identificação", () => {
    expect(parseContratacao(rawContratacao({ numeroControlePNCP: null }))).toBeNull();
    expect(parseContratacao(rawContratacao({ objetoCompra: "" }))).toBeNull();
    expect(parseContratacao({ numeroControlePNCP: "invalido", objetoCompra: "x" })).toBeNull();
  });
});

describe("toIsoBrt", () => {
  it("trata horários sem fuso como horário de Brasília", () => {
    expect(toIsoBrt("2026-10-25T09:30:00")).toBe("2026-10-25T12:30:00.000Z");
    expect(toIsoBrt("2026-10-25")).toBe("2026-10-25T03:00:00.000Z");
    expect(toIsoBrt("2026-10-25T09:30:00Z")).toBe("2026-10-25T09:30:00.000Z");
    expect(toIsoBrt("2026-10-25T09:30:00-02:00")).toBe("2026-10-25T11:30:00.000Z");
    expect(toIsoBrt("lixo")).toBeNull();
    expect(toIsoBrt(null)).toBeNull();
  });
});

describe("número de controle e link", () => {
  it("lê o numeroControlePNCP e monta o link do edital", () => {
    expect(parseNumeroControle("00394718000100-1-000021/2026")).toEqual({ cnpj: "00394718000100", sequencial: 21, ano: 2026 });
    expect(parseNumeroControle("abc")).toBeNull();
    expect(linkEdital({ cnpj: "00394718000100", ano: 2026, sequencial: 21 })).toBe("https://pncp.gov.br/app/editais/00394718000100/2026/21");
  });
});

describe("parseItem", () => {
  it("normaliza e esconde orçamento sigiloso", () => {
    expect(parseItem(rawItem(2))).toMatchObject({ numero: 2, unidade: "UN", valorUnitarioEstimado: 25.5, valorTotal: 255, tipo: "Material", sigiloso: false });
    expect(parseItem(rawItem(1, { orcamentoSigiloso: true, valorUnitarioEstimado: 0, valorTotal: 0 }))).toMatchObject({
      sigiloso: true,
      valorUnitarioEstimado: null,
      valorTotal: null,
    });
    expect(parseItem({ descricao: "sem número" })).toBeNull();
  });
});

describe("parseResultado", () => {
  it("normaliza o fornecedor e o cancelamento", () => {
    expect(parseResultado(rawResultado())).toMatchObject({
      numeroItem: 1,
      niFornecedor: "12345678000199",
      nomeFornecedor: "EMPRESA EXEMPLO LTDA",
      valorUnitarioHomologado: 20,
      cancelado: false,
      dataResultado: "2026-11-01T13:00:00.000Z",
    });
    expect(parseResultado(rawResultado({ numeroItem: undefined, dataCancelamento: "2026-11-02" }), 9)).toMatchObject({ numeroItem: 9, cancelado: true });
  });
});

describe("parseAta", () => {
  it("normaliza datas e flags", () => {
    expect(parseAta(rawAta())).toMatchObject({
      id: "00394718000100-1-000021/2026-000001",
      ano: 2026,
      vigenciaInicio: "2026-11-01",
      vigenciaFim: "2027-10-31",
      cancelada: false,
      adesao: true,
    });
    expect(parseAta(rawAta({ vigenciaFim: null }))).toBeNull();
    expect(parseAta(rawAta({ dataCancelamento: "2026-12-01" }))!.cancelada).toBe(true);
  });
});

describe("parseArquivo", () => {
  it("usa a URL da API ou monta uma", () => {
    expect(parseArquivo({ sequencialDocumento: 1, titulo: "Edital", tipoDocumentoNome: "Edital", url: "https://x/1" })).toMatchObject({
      sequencial: 1,
      titulo: "Edital",
      tipo: "Edital",
      url: "https://x/1",
      ativo: true,
    });
    expect(parseArquivo({ sequencialDocumento: 2 }, "https://base")).toMatchObject({ titulo: "Documento 2", url: "https://base/2" });
    expect(parseArquivo({ titulo: "sem seq" })).toBeNull();
  });
});

describe("modalidades", () => {
  it("tem nome para cada código", () => {
    for (const id of Object.values(Modalidade)) expect(MODALIDADES[id]).toBeTruthy();
    expect(nomeModalidade(Modalidade.PregaoEletronico)).toBe("Pregão eletrônico");
    expect(nomeModalidade(99)).toBeNull();
    expect(nomeModalidade(null)).toBeNull();
  });
});
