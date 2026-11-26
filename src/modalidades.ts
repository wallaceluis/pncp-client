/** Códigos de modalidade de contratação (tabela de domínio do Manual de Integração do PNCP). */
export const Modalidade = {
  LeilaoEletronico: 1,
  DialogoCompetitivo: 2,
  Concurso: 3,
  ConcorrenciaEletronica: 4,
  ConcorrenciaPresencial: 5,
  PregaoEletronico: 6,
  PregaoPresencial: 7,
  DispensaDeLicitacao: 8,
  Inexigibilidade: 9,
  ManifestacaoDeInteresse: 10,
  PreQualificacao: 11,
  Credenciamento: 12,
  LeilaoPresencial: 13,
} as const;

export type ModalidadeId = (typeof Modalidade)[keyof typeof Modalidade];

/** Nome legível de cada modalidade. */
export const MODALIDADES: Readonly<Record<ModalidadeId, string>> = {
  1: "Leilão eletrônico",
  2: "Diálogo competitivo",
  3: "Concurso",
  4: "Concorrência eletrônica",
  5: "Concorrência presencial",
  6: "Pregão eletrônico",
  7: "Pregão presencial",
  8: "Dispensa de licitação",
  9: "Inexigibilidade",
  10: "Manifestação de interesse",
  11: "Pré-qualificação",
  12: "Credenciamento",
  13: "Leilão presencial",
};

/** Nome da modalidade, ou `null` para um código desconhecido. */
export const nomeModalidade = (id: number | null | undefined): string | null =>
  id != null && id in MODALIDADES ? MODALIDADES[id as ModalidadeId] : null;
