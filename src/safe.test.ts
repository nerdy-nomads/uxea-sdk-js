/** RNF-SDK-01: um erro interno nunca chega à aplicação anfitriã. Sem excepções. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { protegido, protegidoAsync, errosInternos, limparErros } from "./safe.ts";
import * as publico from "./identity/index.ts";

test("uma função que lança devolve a alternativa e não propaga", () => {
  limparErros();
  const f = protegido("teste", () => { throw new Error("rebentei"); }, "seguro");
  assert.equal(f(), "seguro");
  assert.equal(errosInternos().length, 1);
});

test("uma promessa rejeitada também não escapa", async () => {
  limparErros();
  const f = protegidoAsync("teste", async () => { throw new Error("rebentei"); }, 0);
  assert.equal(await f(), 0);
  assert.equal(errosInternos().length, 1);
});

test("o registo interno não cresce sem limite", () => {
  limparErros();
  const f = protegido("teste", () => { throw new Error("x"); }, null);
  for (let i = 0; i < 500; i++) f();
  assert.ok(errosInternos().length <= 50);
});

test("injeção de falha em cada ponto de entrada público: nenhum propaga", () => {
  limparErros();
  // Um elemento que rebenta em tudo o que lhe perguntam, como um DOM exótico faria.
  const hostil: any = {
    get tagName(): string { throw new Error("tagName rebentou"); },
    get parentElement(): unknown { throw new Error("parentElement rebentou"); },
    get children(): unknown { throw new Error("children rebentou"); },
    getAttribute(): string { throw new Error("getAttribute rebentou"); },
    get textContent(): string { throw new Error("textContent rebentou"); },
  };
  assert.equal(publico.acionavel(hostil), false);
  assert.deepEqual(publico.sinais(hostil), { testid: null, caminho: null, rotulo: null, destino: null, papel: null });
  assert.equal(publico.chave(hostil).principal, "");
  assert.equal(errosInternos().length, 3, "os três pontos de entrada registaram, e nenhum propagou");
});

test("um elemento nulo não parte nada", () => {
  limparErros();
  assert.equal(publico.acionavel(null as any), false);
  assert.equal(publico.chave(undefined as any).principal, "");
});
