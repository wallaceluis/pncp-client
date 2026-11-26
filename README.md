# pncp-client

Cliente TypeScript para a [API pública do PNCP](https://pncp.gov.br/api/consulta/swagger-ui/index.html) (Portal Nacional de Contratações Públicas): licitações com proposta aberta, publicações por data, itens e resultados, atas de registro de preço e arquivos.

- **Tipado**: respostas normalizadas (`Contratacao`, `Item`, `Resultado`, `Ata`, `Arquivo`), com o JSON original em `bruto`.
- **Robusto**: timeout por requisição e retry com backoff exponencial em 429, 5xx, timeout e erro de rede, respeitando `Retry-After`.
- **Paginação** com async iterator (`for await`).
- **`fetch` injetável**: usa o `fetch` global por padrão (Node ≥ 20, Deno, Bun, Cloudflare Workers) ou o que você passar. Sem dependências.
- ESM + CommonJS, com tipos.

> Projeto independente, sem vínculo com o Governo Federal.

## Instalação

```sh
npm install pncp-client
```

## Uso rápido

```ts
import { PncpClient, Modalidade } from "pncp-client";

const pncp = new PncpClient();

// Pregões eletrônicos em SP com propostas abertas até 31/12/2026
const pagina = await pncp.propostasAbertas({
  dataFinal: "2026-12-31",
  modalidade: Modalidade.PregaoEletronico,
  uf: "SP",
});

console.log(pagina.totalRegistros, "licitações");
for (const c of pagina.dados) {
  console.log(c.id, c.orgao, c.objeto, c.dataEncerramento);
}
```

Com CommonJS: `const { PncpClient } = require("pncp-client");`

## Paginação

Cada consulta paginada tem uma versão `iterar*` que percorre todas as páginas:

```ts
for await (const c of pncp.iterarPublicacoes({
  dataInicial: "2026-11-01",
  dataFinal: "2026-11-01",
  modalidade: Modalidade.DispensaDeLicitacao,
})) {
  console.log(c.id, c.valorEstimado);
}

// Limite de páginas
for await (const c of pncp.iterarPropostasAbertas({ dataFinal: new Date() }, { maxPaginas: 5 })) {
  // ...
}
```

A iteração para na última página (`totalPaginas`), numa página vazia (HTTP 204) ou depois de `maxPaginas`. Para paginar algo próprio, use `paginar(buscarPagina)`.

## Consultas

| Método | Endpoint | Devolve |
| --- | --- | --- |
| `propostasAbertas({ dataFinal, modalidade?, uf?, ... })` | `GET /v1/contratacoes/proposta` | `Pagina<Contratacao>` |
| `publicacoes({ dataInicial, dataFinal, modalidade, ... })` | `GET /v1/contratacoes/publicacao` | `Pagina<Contratacao>` |
| `atualizacoes({ dataInicial, dataFinal, modalidade, ... })` | `GET /v1/contratacoes/atualizacao` | `Pagina<Contratacao>` |
| `contratacao({ cnpj, ano, sequencial })` | `GET /v1/orgaos/{cnpj}/compras/{ano}/{seq}` | `Contratacao \| null` |
| `itens(compra, { pagina?, tamanhoPagina? })` | `GET .../compras/{ano}/{seq}/itens` | `Item[]` |
| `resultados(compra, numeroItem)` | `GET .../itens/{n}/resultados` | `Resultado[]` |
| `arquivos(compra)` | `GET .../compras/{ano}/{seq}/arquivos` | `Arquivo[]` |
| `atas({ dataInicial, dataFinal, cnpj?, ... })` | `GET /v1/atas` (vigência) | `Pagina<Ata>` |
| `atasAtualizadas({ dataInicial, dataFinal, ... })` | `GET /v1/atas/atualizacao` | `Pagina<Ata>` |

Iteradores: `iterarPropostasAbertas`, `iterarPublicacoes`, `iterarAtualizacoes`, `iterarAtas`, `iterarAtasAtualizadas`, `iterarItens` e `iterarResultados`.

Filtros das contratações: `uf`, `codigoMunicipioIbge`, `cnpj`, `codigoUnidadeAdministrativa`, `idUsuario`, `pagina` e `tamanhoPagina`.

**Datas** podem ser `Date`, `"AAAA-MM-DD"` ou `"AAAAMMDD"`. Um `Date` é lido no horário de Brasília. As datas devolvidas (`dataAbertura`, `dataEncerramento` etc.) vêm em ISO 8601 UTC, já convertidas do horário de Brasília que a API usa.

**Tamanho de página**: o mínimo é 10 e o máximo é 50 nas contratações e 500 nas atas (a API responde 400 fora disso). O cliente valida antes de chamar a API e lança `RangeError`.

### Itens e resultados

```ts
const compra = { cnpj: "00394718000100", ano: 2026, sequencial: 21 };

// Todos os itens, sem repetidos (a API às vezes ignora a paginação)
for await (const item of pncp.iterarItens(compra)) {
  console.log(item.numero, item.descricao, item.valorUnitarioEstimado);
}

// Vencedores de cada item que já tem resultado
for await (const { item, resultados } of pncp.iterarResultados(compra)) {
  const vencedor = resultados.find((r) => !r.cancelado);
  console.log(item.descricao, vencedor?.nomeFornecedor, vencedor?.valorUnitarioHomologado);
}
```

Para partir do número de controle: `parseNumeroControle("00394718000100-1-000021/2026")` devolve `{ cnpj, ano, sequencial }`. `linkEdital(compra)` monta o link da página pública do edital.

### Arquivos

```ts
const arquivos = await pncp.arquivos(compra);
const edital = arquivos.find((a) => a.tipo === "Edital");
console.log(edital?.url);
```

## Opções

```ts
const pncp = new PncpClient({
  fetch: globalThis.fetch,     // fetch a usar
  timeoutMs: 30_000,           // timeout de cada requisição
  retries: 3,                  // novas tentativas em 429, 5xx, timeout e erro de rede
  retryDelayMs: 1_000,         // backoff: 1 s, 2 s, 4 s...
  maxRetryDelayMs: 30_000,     // teto da espera (vale também para Retry-After)
  userAgent: "meu-app/1.0",    // padrão "pncp-client"; null para não enviar
  headers: {},                 // cabeçalhos extras
  onRetry: ({ url, attempt, status, delayMs }) => console.warn(`PNCP ${status ?? "rede"}: tentativa ${attempt}, esperando ${delayMs} ms`),
});
```

Toda consulta aceita um último argumento `{ signal, retries, timeoutMs }` para sobrepor as opções numa chamada só. O `signal` também interrompe a espera entre tentativas, o que serve para dar um prazo a uma rotina inteira:

```ts
const signal = AbortSignal.timeout(5 * 60_000); // 5 minutos para tudo
for await (const c of pncp.iterarPropostasAbertas({ dataFinal: "2026-12-31" }, { signal })) {
  // ...
}
```

### `fetch` próprio

Qualquer função com a assinatura de `fetch` funciona: proxy, cache, instrumentação ou mock em testes.

```ts
const pncp = new PncpClient({
  fetch: async (url, init) => {
    console.time(String(url));
    try {
      return await fetch(url, init);
    } finally {
      console.timeEnd(String(url));
    }
  },
});
```

## Erros

- `PncpError`: resposta HTTP de erro ou falha de rede/timeout depois das tentativas. Tem `status` (`null` para rede/timeout), `url`, `body` (texto da resposta) e `cause`.
- `RangeError`: parâmetro inválido (data, página ou `tamanhoPagina`), lançado antes de chamar a API.
- Abortar pelo `signal` rejeita com o motivo do `AbortSignal`.

Status 4xx (exceto 429) não são repetidos. `contratacao()` e `resultados()` devolvem `null`/`[]` em 404, e as consultas tratam 204 como página vazia.

```ts
import { PncpError } from "pncp-client";

try {
  await pncp.propostasAbertas({ dataFinal: "2026-12-31" });
} catch (err) {
  if (err instanceof PncpError) console.error(err.status, err.url, err.body);
  throw err;
}
```

## Funções avulsas

O pacote também exporta os parsers (`parseContratacao`, `parseItem`, `parseResultado`, `parseAta`, `parseArquivo`), `toIsoBrt`, `formatarData`, `Modalidade`, `MODALIDADES` e `nomeModalidade`, úteis para dados do PNCP obtidos de outra forma. Para um endpoint que o cliente ainda não cobre, `pncp.get(url)` faz o GET com o mesmo timeout e retry.

## Dicas sobre a API do PNCP

- A API devolve 429 com frequência em consultas seguidas. O retry cuida disso, mas evite muitas consultas em paralelo.
- Algumas consultas (como atas por vigência) são lentas e às vezes estouram o timeout. Aumente `timeoutMs` se precisar.
- Os registros que vêm sem os campos mínimos (id, objeto, órgão) são descartados e contados em `pagina.ignorados`.

## Desenvolvimento

```sh
npm install
npm test          # vitest, sem acesso à rede
npm run check     # typecheck + testes + build + teste do pacote ESM/CJS
```

## Licença

[MIT](LICENSE)
