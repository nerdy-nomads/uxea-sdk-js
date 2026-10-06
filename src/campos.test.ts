/**
 * A página pública do que o SDK captura (CAMPOS.md) não fica atrás do código. Cartão
 * 18.5, RNF-PRI-11.
 *
 * Três verificações, e a terceira é a que a Definição de pronto pede: **o ensaio falha
 * quando o código captura um campo que a documentação não lista**. Corre a captura
 * inteira do 18.2 e procura na página cada campo e cada propriedade que saiu.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import esquema from "./event/schema.json" with { type: "json" };
import { corrida } from "./ensaio/corrida-total.ts";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");
const PAGINA = readFileSync(join(RAIZ, "CAMPOS.md"), "utf-8");
const DOCUMENTADOS = new Set([...PAGINA.matchAll(/^\| `([a-z_]+)` \|/gm)].map((m) => m[1]!));
const DO_SERVIDOR = new Set([...PAGINA.matchAll(/^- `([a-z_]+)`(?:, `([a-z_]+)`)?:/gm)].flatMap((m) => [m[1]!, m[2]!].filter(Boolean)));

test("18.5 cada ligação da página aponta para uma linha que produz o campo", () => {
  let vistas = 0;
  for (const m of PAGINA.matchAll(/^\| `([a-z_]+)` \|.*?\]\(https:\/\/github\.com\/nerdy-nomads\/uxea-sdk-js\/blob\/master\/([^#)]+)#L(\d+)\)/gm)) {
    const [, campo, ficheiro, linha] = m;
    const caminho = join(RAIZ, ficheiro!);
    assert.ok(existsSync(caminho), `${campo}: ${ficheiro} não existe`);
    const texto = readFileSync(caminho, "utf-8").split("\n")[Number(linha) - 1] ?? "";
    assert.ok(texto.includes(campo!) || texto.includes("propriedadesDoCliente"),
      `${campo}: a linha ${ficheiro}:${linha} já não o produz (${texto.trim()}). Correr python3 scripts/campos-capturados.py`);
    vistas++;
  }
  assert.ok(vistas > 60, `só ${vistas} ligações verificadas`);
});

test("18.5 todos os campos e propriedades do esquema estão na página", () => {
  const faltam: string[] = [];
  for (const c of esquema.campos as Array<{ nome: string }>) if (!DOCUMENTADOS.has(c.nome) && !DO_SERVIDOR.has(c.nome)) faltam.push(c.nome);
  for (const [g, v] of Object.entries((esquema as any).propriedades_permitidas)) {
    if (g.startsWith("$")) continue;
    for (const k of (v as { chaves: string[] }).chaves) if (!DOCUMENTADOS.has(k)) faltam.push(k);
  }
  assert.deepEqual(faltam, [], "o esquema tem campos que a página pública não lista");
});

test("18.5 o código não captura nenhum campo que a página não liste", async () => {
  const vistos = new Set<string>();
  for (const nivel of ["essencial", "padrao", "detalhado"] as const) {
    const { bruto } = await corrida(nivel);
    for (const p of JSON.parse(bruto) as Array<{ url: string; corpo: string }>) {
      if (!p.url.includes("/v1/eventos")) continue;
      const lote = JSON.parse(p.corpo);
      for (const k of Object.keys(lote)) vistos.add(k);
      for (const ev of lote.eventos ?? []) {
        for (const k of Object.keys(ev)) vistos.add(k);
        for (const k of Object.keys(ev.properties ?? {})) vistos.add(k);
      }
    }
  }
  const nao = [...vistos].filter((k) => !DOCUMENTADOS.has(k) && !DO_SERVIDOR.has(k));
  assert.deepEqual(nao, [], `o SDK enviou campos que a página pública não lista: ${nao.join(", ")}`);
  assert.ok(vistos.size > 40, `só ${vistos.size} campos vistos: a corrida não exerceu a captura`);
});
