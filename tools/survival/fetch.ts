/** Descarrega e guarda instantâneos do arquivo, para as medições serem repetíveis. */
import { mkdirSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const AQUI = dirname(fileURLToPath(import.meta.url));
export const CACHE = join(AQUI, "cache");

/**
 * O sufixo `id_` no caminho do arquivo devolve a página **original**, sem a barra
 * nem os scripts que o arquivo injeta. Sem ele, mediríamos o HTML do arquivo em
 * vez do da aplicação.
 */
export function urlArquivo(url: string, ts: string): string {
  return `https://web.archive.org/web/${ts}id_/${url}`;
}

export async function obter(url: string, ts: string): Promise<string> {
  mkdirSync(CACHE, { recursive: true });
  const ficheiro = join(CACHE, `${ts}-${url.replace(/[^a-z0-9]+/gi, "_")}.html`);
  if (existsSync(ficheiro)) return readFileSync(ficheiro, "utf8");
  const r = await fetch(urlArquivo(url, ts), {
    headers: { "user-agent": "uxda-survival-prototype/0.1 (cartao 0.2)" },
  });
  if (!r.ok) throw new Error(`${r.status} em ${url}@${ts}`);
  const html = await r.text();
  writeFileSync(ficheiro, html);
  return html;
}
