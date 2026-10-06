/**
 * Monta a página de ensaio: o DOM real de uma aplicação, com o pacote do SDK
 * injetado, para se ver a captura a correr num browser a sério.
 *
 * Correr: bun build src/browser.ts --target=browser --format=iife --outfile=/tmp/uxea-browser.js
 *         node --experimental-strip-types tools/survival/demo.ts <ficheiro-do-cache> <base-href>
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const AQUI = dirname(fileURLToPath(import.meta.url));
const [, , ficheiro, base] = process.argv;
if (!ficheiro || !base) throw new Error("uso: demo.ts <ficheiro-do-cache> <base-href>");

const html = readFileSync(join(AQUI, "cache", ficheiro), "utf8");
const pacote = readFileSync("/tmp/uxea-browser.js", "utf8");

// O `base` faz os recursos relativos do instantâneo carregarem do sítio real,
// para a página aparecer como aparecia, e não como texto sem estilo.
const comBase = html.replace(/<head([^>]*)>/i, `<head$1><base href="${base}">`);
const comPacote = comBase.replace(/<\/body>/i, `<script>${pacote}</script></body>`);
writeFileSync(join(AQUI, "demo.html"), comPacote);
console.log(`demo.html gerado a partir de ${ficheiro}`);
