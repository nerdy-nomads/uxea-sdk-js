/**
 * O mesmo corpo de provas que o `uxea-core` corre em Go.
 *
 * Se os dois validadores derem veredictos diferentes sobre o mesmo evento, um dos
 * dois está errado, e o integrador vai perder dados sem perceber porquê. É este
 * teste que impede isso, e é ele que dá sentido à frase "o esquema é o mesmo dos
 * dois lados".
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { validar, versaoProtocolo, compatibilidadeMeses } from "./validar.ts";
import corpus from "./corpus.json" with { type: "json" };
import esquema from "./schema.json" with { type: "json" };

interface Caso {
  nome: string;
  valido: boolean;
  erros_esperados?: string[];
  evento: Record<string, unknown>;
}
const casos = (corpus as { casos: Caso[] }).casos;

test("o corpo de provas é o mesmo, e não uma amostra", () => {
  assert.ok(casos.length >= 10, `corpus pequeno de mais: ${casos.length}`);
});

for (const c of casos) {
  test(`corpus: ${c.nome}`, () => {
    const erros = validar(c.evento);
    if (c.valido) {
      assert.deepEqual(erros, [], `devia passar, e recusou: ${JSON.stringify(erros)}`);
      return;
    }
    assert.ok(erros.length > 0, "devia recusar, e passou");
    const obtidos = erros.map((e) => `${e.campo}:${e.codigo}`).sort();
    for (const esperado of c.erros_esperados ?? []) {
      assert.ok(obtidos.includes(esperado), `faltou o erro ${esperado}; obtidos: ${obtidos.join(", ")}`);
    }
  });
}

test("o motivo vai sempre com a recusa", () => {
  for (const c of casos.filter((x) => !x.valido)) {
    for (const e of validar(c.evento)) {
      assert.ok(e.campo && e.codigo && e.motivo, `${c.nome}: recusa sem motivo utilizável`);
    }
  }
});

test("aponta todos os problemas de uma vez, e não só o primeiro", () => {
  const erros = validar({ event_type: "clique", platform: "windows" });
  assert.ok(erros.length >= 5, `apontou só ${erros.length}`);
});

test("o contrato de compatibilidade é o do ADR 0006", () => {
  assert.ok(compatibilidadeMeses >= 24);
  assert.ok(versaoProtocolo >= 1);
});

// Se alguém acrescentar um campo ao esquema e esquecer o validador, isto apanha.
test("o validador conhece todos os campos do esquema", () => {
  const nomes = (esquema.campos as { nome: string }[]).map((c) => c.nome);
  const so = Object.fromEntries(nomes.map((n) => [n, null]));
  const erros = validar(so);
  for (const e of erros) {
    assert.notEqual(e.codigo, "campo_desconhecido", `o validador não conhece ${e.campo}`);
  }
});
