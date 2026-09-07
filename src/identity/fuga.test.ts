/**
 * Bateria de fuga de conteúdo. RNF-PRI-01, e a caixa da Definição de pronto de
 * qualquer cartão de SDK.
 *
 * Preenche formulários com marcadores reconhecíveis, corre a captura sobre DOM
 * **reais** (os mesmos instantâneos do cartão 0.2), e falha se algum marcador
 * aparecer no que sairia do dispositivo.
 *
 * A defesa principal contra fuga não é a revisão de código: é isto, que corre
 * sempre e falha quando alguém acrescentar um campo com boas intenções daqui a
 * dois anos.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseHTML } from "linkedom";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { acionavel, sinais, type ElementoLike } from "./element.ts";

const CACHE = join(dirname(fileURLToPath(import.meta.url)), "../../tools/survival/cache");

/** Valores que uma pessoa escreveria, e que nunca podem sair do dispositivo. */
const SEGREDOS = [
  "005123456LA041", "ana.silva@exemplo.ao", "+244923000111",
  "4111111111111111", "Rua Amilcar Cabral 42", "Ana Maria da Silva",
  "senha-super-secreta", "AO06000600000100037131174",
];

function semearSegredos(doc: any): void {
  const campos = Array.from(doc.querySelectorAll("input, textarea, select")) as any[];
  campos.forEach((el, i) => {
    const s = SEGREDOS[i % SEGREDOS.length]!;
    el.setAttribute("value", s);
    el.value = s;
    if (el.tagName?.toUpperCase() === "TEXTAREA") el.textContent = s;
  });
}

function capturarTudo(doc: any): string {
  const els = (Array.from(doc.querySelectorAll("*")) as any[]).filter((e) => acionavel(e as ElementoLike));
  return JSON.stringify(els.map((e) => sinais(e as ElementoLike)));
}

const ficheiros = existsSync(CACHE)
  ? readdirSync(CACHE).filter((f) => f.endsWith(".html"))
  : [];

test("nenhum valor escrito por uma pessoa sai do dispositivo, em DOM reais", () => {
  assert.ok(ficheiros.length >= 4, "faltam instantâneos: correr `npm run survival` primeiro");
  for (const f of ficheiros) {
    const doc = parseHTML(readFileSync(join(CACHE, f), "utf8")).document;
    semearSegredos(doc);
    const saida = capturarTudo(doc);
    for (const s of SEGREDOS) {
      assert.ok(!saida.includes(s), `o valor ${JSON.stringify(s)} saiu, em ${f}`);
    }
  }
});

test("a bateria apanha uma fuga introduzida de propósito", () => {
  const doc = parseHTML(`<form><input name="nif" placeholder="NIF"></form>`).document;
  semearSegredos(doc);
  const el = doc.querySelector("input") as any;
  // Uma captura ingénua, do género que alguém escreveria a depurar um problema.
  const ingenua = JSON.stringify({ ...sinais(el as ElementoLike), valor: el.getAttribute("value") });
  assert.ok(SEGREDOS.some((s) => ingenua.includes(s)), "a bateria não apanharia uma fuga");
  // E a captura a sério não deixa passar nada.
  const real = JSON.stringify(sinais(el as ElementoLike));
  assert.ok(!SEGREDOS.some((s) => real.includes(s)));
});

test("nem sequer o comprimento do que foi escrito é inferível", () => {
  const a = parseHTML(`<form><input name="x" placeholder="Nome"></form>`).document;
  const b = parseHTML(`<form><input name="x" placeholder="Nome"></form>`).document;
  (a.querySelector("input") as any).setAttribute("value", "a");
  (b.querySelector("input") as any).setAttribute("value", "a".repeat(500));
  assert.equal(capturarTudo(a), capturarTudo(b));
});
