/**
 * Empacotamento. Cartão 2.1.
 *
 * Dois formatos, e cada um serve uma forma de integrar:
 *
 *   dist/uxea.js    para o `<script>`: arranca sozinho pelos atributos da etiqueta
 *   dist/uxea.mjs   para quem instala por npm e quer chamar `iniciar()` à mão
 *
 * O orçamento de tamanho é verificado a seguir, no `tools/orcamento.ts`, e o CI
 * falha acima dele. Um SDK de medição que pesa mais do que a aplicação que mede
 * não se instala.
 */
import { build } from "esbuild";
import { mkdirSync } from "node:fs";

mkdirSync("dist", { recursive: true });

import type { BuildOptions } from "esbuild";

const comum: BuildOptions = {
  bundle: true,
  minify: true,
  sourcemap: true,
  target: ["es2020"],
  legalComments: "none",
};

await build({
  ...comum,
  entryPoints: ["src/cdn.ts"],
  outfile: "dist/uxea.js",
  format: "iife",
  globalName: "UXEA_BUNDLE",
});

await build({
  ...comum,
  entryPoints: ["src/index.ts"],
  outfile: "dist/uxea.mjs",
  format: "esm",
});

console.log("dist/uxea.js e dist/uxea.mjs construídos");
