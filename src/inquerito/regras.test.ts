/**
 * As condições dos gatilhos, operador a operador. Cartão 14.2, RF-PER-04.
 *
 * O que se fixa aqui é que o dispositivo lê as condições **como o motor as escreve
 * em SQL** (`condicaoSQL`, no `motor.go`), incluindo as esquinas: um campo em falta
 * vale texto vazio, uma propriedade que não é texto vale texto vazio, e o `existe`
 * de uma propriedade pergunta pela chave. Se o dispositivo e o motor divergissem, o
 * inquérito aparecia a quem o motor não conta como tendo concluído a tarefa.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { algumCriterio, condicaoCorresponde, criterioCorresponde } from "./regras.ts";

const EVENTO = {
  event_type: "ecra",
  screen_key: "/pagamento/confirmacao",
  element_key: "v1|f=botao-pagar",
  message_key: "",
  platform: "web",
  app_version: "2.4.0",
  properties: { passo: "dados", codigo: "404", tentativas: 3, visivel: true, nulo: null },
};

const c = (campo: string, operador: string, valor = "") => ({ campo, operador, valor });
const vale = (campo: string, operador: string, valor = "") => condicaoCorresponde(EVENTO, c(campo, operador, valor));

test("14.2 igual e diferente comparam o texto inteiro, com maiúsculas", () => {
  assert.equal(vale("event_type", "igual", "ecra"), true);
  assert.equal(vale("event_type", "igual", "Ecra"), false);
  assert.equal(vale("event_type", "diferente", "toque"), true);
  assert.equal(vale("event_type", "diferente", "ecra"), false);
  assert.equal(vale("propriedade:passo", "igual", "dados"), true);
});

test("14.2 contem e comeca_com procuram dentro do texto", () => {
  assert.equal(vale("screen_key", "contem", "confirma"), true);
  assert.equal(vale("screen_key", "contem", "checkout"), false);
  assert.equal(vale("screen_key", "comeca_com", "/pagamento"), true);
  assert.equal(vale("screen_key", "comeca_com", "pagamento"), false);
  assert.equal(vale("element_key", "comeca_com", "v1|f="), true);
});

test("14.2 existe e nao_existe: numa coluna é texto vazio, numa propriedade é a chave", () => {
  // Coluna: a de `message_key` está vazia, e vazio é não existir (`col = ''`).
  assert.equal(vale("message_key", "existe"), false);
  assert.equal(vale("message_key", "nao_existe"), true);
  assert.equal(vale("message_kind", "nao_existe"), true, "um campo em falta vale texto vazio");
  assert.equal(vale("screen_key", "existe"), true);
  // Propriedade: `JSONHas`, e por isso um número e até um nulo **existem**.
  assert.equal(vale("propriedade:tentativas", "existe"), true);
  assert.equal(vale("propriedade:nulo", "existe"), true);
  assert.equal(vale("propriedade:inventada", "existe"), false);
  assert.equal(vale("propriedade:inventada", "nao_existe"), true);
});

test("14.2 uma propriedade que não é texto vale texto vazio, como no JSONExtractString", () => {
  // É a esquina que mais surpreende, e é a do motor: comparar uma propriedade
  // numérica com `igual` nunca corresponde no armazenamento, e não pode
  // corresponder no dispositivo, senão o inquérito aparecia a quem o motor não conta.
  assert.equal(vale("propriedade:tentativas", "igual", "3"), false);
  assert.equal(vale("propriedade:visivel", "igual", "true"), false);
  assert.equal(vale("propriedade:tentativas", "maior", "1"), false);
});

test("14.2 maior e menor comparam números, e um texto que não é número nunca passa", () => {
  assert.equal(vale("propriedade:codigo", "maior", "399"), true);
  assert.equal(vale("propriedade:codigo", "maior", "404"), false);
  assert.equal(vale("propriedade:codigo", "menor", "500"), true);
  assert.equal(vale("propriedade:codigo", "menor", " 405 "), true, "o limiar lê-se com os espaços tirados");
  // `toFloat64OrNull('2.4.0')` é nulo, e nulo não é maior do que nada.
  assert.equal(vale("app_version", "maior", "1"), false);
  assert.equal(vale("app_version", "menor", "9"), false);
  // Um limiar que não é número vale zero, como o `numero` do motor escreve.
  assert.equal(vale("propriedade:codigo", "maior", "abc"), true);
  assert.equal(condicaoCorresponde({ properties: { n: "-3" } }, c("propriedade:n", "menor", "abc")), true);
});

test("14.2 um operador desconhecido não corresponde a nada", () => {
  assert.equal(vale("event_type", "parecido", "ecra"), false);
});

test("14.2 as condições valem em e, os critérios em ou, e o vazio não corresponde", () => {
  const ecra = c("event_type", "igual", "ecra");
  const pagamento = c("screen_key", "comeca_com", "/pagamento");
  const toque = c("event_type", "igual", "toque");
  assert.equal(criterioCorresponde(EVENTO, { condicoes: [ecra, pagamento] }), true);
  assert.equal(criterioCorresponde(EVENTO, { condicoes: [ecra, toque] }), false);
  assert.equal(algumCriterio(EVENTO, [{ condicoes: [toque] }, { condicoes: [ecra, pagamento] }]), true);
  assert.equal(algumCriterio(EVENTO, [{ condicoes: [toque] }]), false);
  // Um critério sem condições corresponderia a tudo: o servidor recusa-o ao
  // guardar, e o dispositivo não o deixa disparar.
  assert.equal(criterioCorresponde(EVENTO, { condicoes: [] }), false);
  assert.equal(algumCriterio(EVENTO, []), false);
  assert.equal(algumCriterio(EVENTO, [{ condicoes: [] }]), false);
});

test("14.2 um evento sem propriedades não parte nada", () => {
  const nu = { event_type: "toque" };
  assert.equal(condicaoCorresponde(nu, c("propriedade:x", "existe")), false);
  assert.equal(condicaoCorresponde(nu, c("propriedade:x", "igual", "y")), false);
  assert.equal(condicaoCorresponde({ properties: "lixo" }, c("propriedade:x", "nao_existe")), true);
});
