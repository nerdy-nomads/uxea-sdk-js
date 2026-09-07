/**
 * A fila: persistência, lote, recuo e o ensaio de dez minutos sem rede.
 * Cartão 2.4, RF-CAP-06, RF-CAP-07, RNF-SDK-05 e RNF-SDK-07.
 *
 * O ensaio que decide este cartão é o último: **desligar a rede, usar a
 * aplicação, voltar a ligar**, e não perder um evento nem duplicar nenhum. É a
 * diferença entre um SDK que serve para medir abandono e um que só mede quem
 * tem boa ligação, que é precisamente quem não abandona.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { criarBrowser, memoria, disparar } from "../ensaio/duplo.ts";
import { iniciar } from "../index.ts";
import { Armazem, MAX_EVENTOS } from "./armazem.ts";
import { limitesPara, LIMITES } from "./fila.ts";
import type { Evento } from "../core/tipos.ts";

const evento = (n: number): Evento => ({
  event_id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
  anonymous_id: "a", device_id: "d", session_id: "s", event_type: "ecra",
  screen_key: "/x", occurred_at: "2026-09-07T10:00:00.000Z", app_version: "1",
  platform: "web", identity_scope: "aplicacao", capture_level: "padrao",
});

test("2.4 a fila sobrevive a fechar o separador", () => {
  const loja = memoria();
  const a1 = new Armazem(loja);
  a1.juntar(evento(1));
  a1.juntar(evento(2));
  // Outro `Armazem` sobre o mesmo armazenamento é o que acontece a seguir a um
  // recarregamento: o objeto morre, o que ficou escrito não.
  const a2 = new Armazem(loja);
  assert.equal(a2.quantos(), 2);
  assert.equal(a2.pendentes()[0]!.event_id, evento(1).event_id);
});

test("2.4 confirma por identificador, e não por posição", () => {
  const a = new Armazem(memoria());
  a.juntar(evento(1)); a.juntar(evento(2)); a.juntar(evento(3));
  const lote = a.lote(2, 1e6);
  a.juntar(evento(4));            // chegou um evento enquanto o lote ia a caminho
  a.confirmar(lote);
  assert.deepEqual(a.pendentes().map((e) => e.event_id), [evento(3).event_id, evento(4).event_id]);
});

test("2.4 acima do tecto deita fora o mais antigo, e conta quantos", () => {
  const a = new Armazem(memoria());
  for (let i = 0; i < MAX_EVENTOS + 20; i++) a.juntar(evento(i));
  assert.equal(a.quantos(), MAX_EVENTOS);
  assert.equal(a.perdidos(), 20);
  assert.equal(a.pendentes()[0]!.event_id, evento(20).event_id);
});

test("2.4 o lote respeita o limite de tamanho", () => {
  const a = new Armazem(memoria());
  for (let i = 0; i < 100; i++) a.juntar(evento(i));
  assert.equal(a.lote(10, 1e6).length, 10);
  assert.ok(JSON.stringify(a.lote(100, 2000)).length <= 2200);
});

test("2.4 em rede medida, o SDK abranda em vez de desligar", () => {
  assert.deepEqual(limitesPara(undefined), LIMITES);
  const poupa = limitesPara({ saveData: true });
  assert.equal(poupa.intervaloMs, 60000);
  assert.ok(poupa.maxLote > LIMITES.maxLote, "com dados contados, os lotes são maiores e mais raros");
  assert.equal(limitesPara({ effectiveType: "2g" }).intervaloMs, 30000);
});

test("2.4 dez minutos sem rede não perdem um evento, e a anfitriã não dá por nada", async () => {
  const loja = memoria();
  const br = criarBrowser(`<button id="b">ok</button>`, { caminho: "/tarefa", loja });
  // A rede está em baixo: estado 0 é o que um `fetch` falhado dá.
  br.responder(() => ({ estado: 0, corpo: "" }));
  const uxda = iniciar({ chave: "uxda_des_t", servidor: "http://ingest.local", ambiente: br.ambiente() });
  await br.avancar(10);

  // Dez minutos de uso: um clique de trinta em trinta segundos.
  for (let i = 0; i < 20; i++) {
    disparar(br.documento, "#b", "click");
    await br.avancar(30000);
  }
  const diag = uxda.diagnostico();
  assert.ok(diag.fila.pendentes >= 20, `ficaram ${diag.fila.pendentes} na fila`);
  assert.equal(diag.fila.perdidos, 0, "perdeu eventos com a rede em baixo");
  assert.equal(diag.errosInternos, 0, "a falha de rede virou erro interno");
  assert.equal(br.eventos().length, 0, "entregou alguma coisa sem rede");

  // A rede volta.
  br.responder(() => ({ estado: 202, corpo: '{"sucesso":true}' }));
  await br.avancar(20 * 60 * 1000);

  const entregues = br.eventos();
  const ids = entregues.map((e) => e.event_id);
  assert.equal(new Set(ids).size, ids.length, "entregou duplicados");
  assert.ok(entregues.filter((e) => e.event_type === "toque").length >= 20,
    `entregou ${entregues.filter((e) => e.event_type === "toque").length} toques de 20`);
  assert.equal(uxda.diagnostico().fila.pendentes, 0, "ficou coisa por entregar");
  // A ordem é a da captura: a reconstrução da tentativa depende dela.
  const horas = entregues.map((e) => e.occurred_at);
  assert.deepEqual(horas, [...horas].sort(), "os eventos chegaram fora de ordem");
});

test("2.4 uma recusa definitiva não fica a repetir para sempre", async () => {
  const br = criarBrowser(`<button id="b">ok</button>`);
  br.responder(() => ({ estado: 401, corpo: '{"erro":"chave inválida"}' }));
  const uxda = iniciar({ chave: "uxda_des_errada", servidor: "http://ingest.local", ambiente: br.ambiente() });
  await br.avancar(60000);
  const d = uxda.diagnostico();
  assert.equal(d.fila.pendentes, 0, "uma chave errada não pode encher a fila do cliente");
  assert.match(d.fila.ultimoErro, /recusado 401/);
});

test("2.4 o servidor em baixo não faz a aplicação anfitriã falhar", async () => {
  const br = criarBrowser(`<button id="b">ok</button>`);
  br.responder(() => { throw new Error("ligação recusada"); });
  const uxda = iniciar({ chave: "uxda_des_t", servidor: "http://ingest.local", ambiente: br.ambiente() });
  await br.avancar(10);
  disparar(br.documento, "#b", "click");
  await br.avancar(120000);
  assert.ok(uxda.diagnostico().fila.pendentes >= 1);
  assert.equal(uxda.diagnostico().errosInternos, 0);
});
