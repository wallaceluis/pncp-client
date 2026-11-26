// Confere que o build funciona como ESM e como CommonJS.
import { createRequire } from "node:module";
import assert from "node:assert/strict";

const esm = await import("../dist/index.js");
const cjs = createRequire(import.meta.url)("../dist/index.cjs");

for (const [name, mod] of [["esm", esm], ["cjs", cjs]]) {
  assert.equal(typeof mod.PncpClient, "function", `${name}: PncpClient`);
  assert.equal(mod.Modalidade.PregaoEletronico, 6, `${name}: Modalidade`);
  assert.equal(mod.formatarData("2026-01-02"), "20260102", `${name}: formatarData`);
  const client = new mod.PncpClient({ fetch: async () => new Response(null, { status: 204 }) });
  const page = await client.propostasAbertas({ dataFinal: "2026-12-31" });
  assert.deepEqual(page.dados, [], `${name}: propostasAbertas`);
}
console.log("ok: ESM e CJS");
