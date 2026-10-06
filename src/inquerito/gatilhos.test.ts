/**
 * Os cinco gatilhos e o livro de fadiga, sobre o estado guardado. Cartão 14.2,
 * RF-PER-04 e RF-PER-05.
 *
 * São ensaios sobre as funções puras, e o estado passa **pelo armazenamento** entre
 * sessões (`gravarEstado` e `lerEstado`), porque é aí que um gatilho que atravessa
 * sessões se perde: um estado que só funciona em memória é um abandono que nunca é
 * perguntado.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { memoria } from "../ensaio/duplo.ts";
import { normalizarRegra } from "./configuracao.ts";
import { estadoVazio, gravarEstado, lerEstado } from "./estado.ts";
import { aoEvento, arranqueDaSessao, JANELA_DE_ABANDONO_MS } from "./gatilhos.ts";
import { anotarPedido, anotarResposta, diaDe, DIA_MS, fadigaLocal, podar } from "./fadiga.ts";
import type { RegraDeInquerito } from "../core/tipos.ts";
import { regra as bruta } from "../ensaio/inquerito.ts";

const T0 = Date.parse("2026-09-14T10:00:00.000Z");
const ecra = (screen_key: string, extra: Record<string, unknown> = {}) => ({ event_type: "ecra", screen_key, ...extra });

function r(extra: Record<string, unknown> = {}): RegraDeInquerito {
  const regra = normalizarRegra(bruta(extra));
  if (!regra) throw new Error("a regra de ensaio não passou a normalização");
  return regra;
}

test("14.2 apos_conclusao dispara no fim, com o início da tentativa mais recente", () => {
  const e = estadoVazio();
  const regras = [r()];
  arranqueDaSessao(e, regras, "s1", T0, "/");
  assert.equal(aoEvento(e, regras, "s1", ecra("/pagamento"), T0 + 1000, "").disparos.length, 0);
  // Um segundo início abre uma tentativa nova, como o `arraySplit` do motor.
  aoEvento(e, regras, "s1", ecra("/pagamento"), T0 + 5000, "dados");
  const { disparos } = aoEvento(e, regras, "s1", ecra("/confirmacao"), T0 + 9000, "dados");
  assert.equal(disparos.length, 1);
  assert.equal(disparos[0]!.gatilho, "apos_conclusao");
  assert.equal(disparos[0]!.tentativaInicio, T0 + 5000, "o início é o último, e não o primeiro");
  assert.equal(disparos[0]!.ecra, "/confirmacao");
  assert.equal(e.abertas["facilidade_do_pagamento"], undefined, "o fim fecha a tentativa");
  // Sem início, dispara na mesma, e sem `tentativa_inicio`.
  const outra = aoEvento(e, regras, "s1", ecra("/confirmacao"), T0 + 20000, "");
  assert.equal(outra.disparos.length, 1);
  assert.equal(outra.disparos[0]!.tentativaInicio, null);
});

test("14.2 apos_erro: os critérios por omissão são o erro de rede e a mensagem de erro", () => {
  const e = estadoVazio();
  const regras = [r({ gatilho: "apos_erro", criterios: [], inicio: [] })];
  assert.deepEqual(regras[0]!.criterios.map((c) => c.condicoes[0]!.valor), ["erro_rede", "erro"]);
  assert.equal(aoEvento(e, regras, "s1", { event_type: "toque" }, T0, "").disparos.length, 0);
  assert.equal(aoEvento(e, regras, "s1", { event_type: "erro_rede" }, T0, "").disparos.length, 1);
  assert.equal(aoEvento(e, regras, "s1", { event_type: "mensagem", message_kind: "erro" }, T0, "").disparos.length, 1);
  assert.equal(aoEvento(e, regras, "s1", { event_type: "mensagem", message_kind: "aviso" }, T0, "").disparos.length, 0);
});

test("14.2 primeira_utilizacao dispara uma vez neste dispositivo, e sobrevive ao armazenamento", () => {
  const loja = memoria();
  const regras = [r({ gatilho: "primeira_utilizacao", criterios: [{ condicoes: [{ campo: "element_key", operador: "igual", valor: "v1|f=exportar" }] }], inicio: [] })];
  const e1 = lerEstado(loja);
  const toque = { event_type: "toque", element_key: "v1|f=exportar" };
  assert.equal(aoEvento(e1, regras, "s1", toque, T0, "").disparos.length, 1);
  assert.equal(aoEvento(e1, regras, "s1", toque, T0 + 1, "").disparos.length, 0, "a segunda vez já não é a primeira");
  gravarEstado(loja, e1);
  // Outra página, outra sessão: continua a não ser a primeira.
  const e2 = lerEstado(loja);
  arranqueDaSessao(e2, regras, "s2", T0 + DIA_MS, "/");
  assert.equal(aoEvento(e2, regras, "s2", toque, T0 + DIA_MS, "").disparos.length, 0);
});

test("14.2 apos_abandono: início sem fim numa sessão, perguntado no arranque da seguinte", () => {
  const loja = memoria();
  const regras = [r({ gatilho: "apos_abandono" })];
  const e1 = lerEstado(loja);
  arranqueDaSessao(e1, regras, "s1", T0, "/");
  aoEvento(e1, regras, "s1", ecra("/pagamento"), T0 + 1000, "");
  aoEvento(e1, regras, "s1", ecra("/pagamento/dados"), T0 + 4000, "morada");
  gravarEstado(loja, e1);

  // A mesma sessão (um recarregamento) não é um arranque.
  const mesma = lerEstado(loja);
  assert.equal(arranqueDaSessao(mesma, regras, "s1", T0 + 60_000, "/").disparos.length, 0);

  const e2 = lerEstado(loja);
  const { disparos, novaSessao } = arranqueDaSessao(e2, regras, "s2", T0 + 40 * 60_000, "/");
  assert.equal(novaSessao, true);
  assert.equal(disparos.length, 1);
  assert.equal(disparos[0]!.gatilho, "apos_abandono");
  assert.equal(disparos[0]!.tentativaInicio, T0 + 1000);
  assert.equal(disparos[0]!.ecra, "/pagamento/dados", "o ecrã é onde a tentativa ficou, e não o de agora");
  assert.equal(disparos[0]!.passo, "morada");
  assert.deepEqual(e2.abertas, {}, "perguntado uma vez, e não em todas as sessões seguintes");
});

test("14.2 apos_abandono: não dispara com fim, nem passadas 24 horas", () => {
  const regras = [r({ gatilho: "apos_abandono" })];
  const comFim = estadoVazio();
  arranqueDaSessao(comFim, regras, "s1", T0, "/");
  aoEvento(comFim, regras, "s1", ecra("/pagamento"), T0, "");
  aoEvento(comFim, regras, "s1", ecra("/confirmacao"), T0 + 1000, "");
  assert.equal(arranqueDaSessao(comFim, regras, "s2", T0 + 3_600_000, "/").disparos.length, 0);

  const velho = estadoVazio();
  arranqueDaSessao(velho, regras, "s1", T0, "/");
  aoEvento(velho, regras, "s1", ecra("/pagamento"), T0, "");
  assert.equal(arranqueDaSessao(velho, regras, "s2", T0 + JANELA_DE_ABANDONO_MS + 1, "/").disparos.length, 0);
  assert.deepEqual(velho.abertas, {}, "o que caducou é esquecido, e não fica a ocupar o armazenamento");
});

test("14.2 amostragem dispara no arranque de cada sessão, e não em cada página", () => {
  const regras = [r({ gatilho: "amostragem", criterios: [], inicio: [] })];
  const e = estadoVazio();
  assert.equal(arranqueDaSessao(e, regras, "s1", T0, "/inicio").disparos[0]?.ecra, "/inicio");
  assert.equal(arranqueDaSessao(e, regras, "s1", T0 + 1000, "/outra").disparos.length, 0);
  assert.equal(arranqueDaSessao(e, regras, "s2", T0 + 3_600_000, "/").disparos.length, 1);
  assert.equal(aoEvento(e, regras, "s2", ecra("/qualquer"), T0, "").disparos.length, 0, "um evento não é um arranque");
});

test("14.2 um evento que é início e fim abre e fecha no mesmo instante", () => {
  const regras = [r({ inicio: [{ condicoes: [{ campo: "event_type", operador: "igual", valor: "submissao" }] }], criterios: [{ condicoes: [{ campo: "event_type", operador: "igual", valor: "submissao" }] }] })];
  const e = estadoVazio();
  const { disparos } = aoEvento(e, regras, "s1", { event_type: "submissao" }, T0 + 7, "");
  assert.equal(disparos[0]!.tentativaInicio, T0 + 7);
  assert.deepEqual(e.abertas, {});
});

/* ----------------------------------------------------------------- fadiga */

const FADIGA = { maxPedidos: 1, periodoDias: 30, excluirRespondeuDias: 90 };

test("14.2 fadiga local: um por sessão, o limite do período e a exclusão de quem respondeu", () => {
  const e = estadoVazio();
  assert.equal(fadigaLocal(e, FADIGA, "s1", T0), "");
  anotarPedido(e, "s1", T0);
  assert.equal(fadigaLocal(e, FADIGA, "s1", T0), "ja_mostrado_nesta_sessao");
  assert.equal(fadigaLocal(e, FADIGA, "s2", T0 + DIA_MS), "limite_de_pedidos");
  assert.equal(fadigaLocal(e, FADIGA, "s3", T0 + 29 * DIA_MS), "limite_de_pedidos");
  assert.equal(fadigaLocal(e, FADIGA, "s4", T0 + 30 * DIA_MS), "", "passado o período, pode-se perguntar outra vez");
  assert.equal(fadigaLocal(e, { ...FADIGA, maxPedidos: 3 }, "s2", T0 + DIA_MS), "");

  anotarResposta(e, T0);
  assert.equal(fadigaLocal(e, { ...FADIGA, maxPedidos: 9 }, "s5", T0 + 89 * DIA_MS), "respondeu_recentemente");
  assert.equal(fadigaLocal(e, { ...FADIGA, maxPedidos: 9 }, "s5", T0 + 90 * DIA_MS), "");

  // `max_pedidos: 0` é "nunca", e não "sem limite".
  assert.equal(fadigaLocal(estadoVazio(), { ...FADIGA, maxPedidos: 0 }, "s1", T0), "limite_de_pedidos");
});

test("14.2 fadiga local: a recusa do servidor vale para a sessão, e o inativo para a regra", () => {
  const e = estadoVazio();
  e.recusa = { sessao: "s1", motivo: "limite_de_pedidos" };
  assert.equal(fadigaLocal(e, FADIGA, "s1", T0), "limite_de_pedidos");
  assert.equal(fadigaLocal(e, FADIGA, "s2", T0), "", "noutra sessão pergunta-se outra vez");
  assert.equal(fadigaLocal(estadoVazio(), FADIGA, "s1", T0, new Set(["a"]), "a"), "inativo");
  assert.equal(fadigaLocal(estadoVazio(), FADIGA, "s1", T0, new Set(["a"]), "b"), "");
});

test("14.2 o livro guarda dias, e expira sozinho no fim do maior dos prazos", () => {
  const e = estadoVazio();
  anotarPedido(e, "s1", T0);
  anotarResposta(e, T0);
  assert.deepEqual(e.pedidos, [diaDe(T0)], "um dia, e não um instante");
  podar(e, FADIGA, T0 + 89 * DIA_MS);
  assert.equal(e.pedidos.length, 1);
  podar(e, FADIGA, T0 + 90 * DIA_MS);
  assert.deepEqual(e.pedidos, []);
  assert.equal(e.respondeu, -1);
});

test("14.2 um estado ilegível no armazenamento é um estado vazio", () => {
  for (const lixo of ["isto não é json", "[]", "null", '{"abertas":"x","pedidos":{},"primeiras":7}']) {
    const loja = memoria();
    loja.setItem("uxea.inqueritos", lixo);
    const e = lerEstado(loja);
    assert.deepEqual(e.abertas, {});
    assert.deepEqual(e.pedidos, []);
    assert.deepEqual(e.primeiras, []);
  }
  const hostil = { getItem() { throw new Error("negado"); }, setItem() { throw new Error("negado"); }, removeItem() {} };
  assert.deepEqual(lerEstado(hostil), estadoVazio());
  assert.doesNotThrow(() => gravarEstado(hostil, estadoVazio()));
});
