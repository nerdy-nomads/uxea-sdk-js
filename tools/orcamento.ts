/**
 * Os dois orçamentos do SDK, verificados. Cartões 2.1 e 2.7, RNF-SDK-02 e 03.
 *
 *   tamanho     o acréscimo ao pacote da aplicação anfitriã, abaixo de 300 KB
 *   fio principal   o tempo que o SDK rouba a quem está a usar a aplicação
 *
 * Corre no CI, e **falha** quando algum passar. Um orçamento que só se mede
 * quando alguém se lembra é um orçamento que se perde na terceira semana.
 */
import { gzipSync } from "node:zlib";
import { readFileSync, existsSync } from "node:fs";
import { criarBrowser, disparar } from "../src/ensaio/duplo.ts";
import { iniciar } from "../src/index.ts";

const LIMITE_BYTES = 300 * 1024;
/** Por evento capturado, no fio principal. Uma trama a 60 Hz tem 16,7 ms. */
const LIMITE_MS_POR_EVENTO = 1;

let falhou = false;
const linha = (nome: string, valor: string, limite: string, ok: boolean) => {
  if (!ok) falhou = true;
  console.log(`  ${ok ? "ok   " : "FALHA"}  ${nome.padEnd(34)} ${valor.padStart(12)}   limite ${limite}`);
};

console.log("\norçamento do SDK\n");

/* ---------------------------------------------------------------- tamanho */

if (!existsSync("dist/uxda.js")) {
  console.error("  FALHA  dist/uxda.js não existe: correr `npm run build` primeiro");
  process.exit(1);
}
const bruto = readFileSync("dist/uxda.js");
const comprimido = gzipSync(bruto).length;
linha("tamanho do pacote (bruto)", `${(bruto.length / 1024).toFixed(1)} KB`, "300 KB", bruto.length < LIMITE_BYTES);
linha("tamanho do pacote (gzip)", `${(comprimido / 1024).toFixed(1)} KB`, "300 KB", comprimido < LIMITE_BYTES);

/* ----------------------------------------------------------- fio principal */

const N = 2000;
const br = criarBrowser(`<button id="b">ok</button><form id="f"><input id="i"></form>`, { caminho: "/orcamento" });
const uxda = iniciar({ chave: "uxda_des_orcamento", servidor: "http://ingest.local", ambiente: br.ambiente() });
await br.avancar(10);

const t0 = Number(process.hrtime.bigint()) / 1e6;
for (let i = 0; i < N; i++) {
  disparar(br.documento, "#b", "click");
  if (i % 4 === 0) {
    disparar(br.documento, "#i", "focusin");
    disparar(br.documento, "#i", "keydown", { key: "a" });
    disparar(br.documento, "#i", "focusout");
  }
}
const decorrido = Number(process.hrtime.bigint()) / 1e6 - t0;
const d = uxda.diagnostico();
const eventos = d.eventosEmitidos;
const porEvento = decorrido / Math.max(1, eventos);

linha("eventos capturados", String(eventos), "-", eventos >= N);
linha("tempo total no fio principal", `${decorrido.toFixed(1)} ms`, `${(LIMITE_MS_POR_EVENTO * eventos).toFixed(0)} ms`,
  decorrido < LIMITE_MS_POR_EVENTO * eventos);
linha("por evento capturado", `${porEvento.toFixed(3)} ms`, `${LIMITE_MS_POR_EVENTO} ms`, porEvento < LIMITE_MS_POR_EVENTO);
linha("erros internos", String(d.errosInternos), "0", d.errosInternos === 0);

console.log("");
process.exit(falhou ? 1 : 0);
