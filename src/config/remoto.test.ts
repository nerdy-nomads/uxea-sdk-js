/**
 * Configuração remota e amostragem. Cartão 2.6, RF-CAP-09, RF-CAP-10, D-10.
 *
 * O ensaio que interessa é o do servidor mudo: **a aplicação continua a
 * funcionar**, e continua a medir. Uma configuração que não chega não pode
 * deixar o cliente às escuras, e é por isso que o valor por omissão mede tudo.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { criarBrowser, memoria, disparar } from "../ensaio/duplo.ts";
import { iniciar } from "../index.ts";
import { obter, daCache, capturaTipo, normalizar, VALIDADE_MS } from "./remoto.ts";
import { CONFIGURACAO_SEGURA } from "../core/tipos.ts";

const CONFIG = { amostragem: 0.5, nivel: "essencial", captura: ["ecra", "erro"], versao: 7 };

test("2.6 a configuração vem do servidor e fica em cache", async () => {
  const br = criarBrowser();
  br.responder((p) => p.url.includes("/v1/config")
    ? { estado: 200, corpo: JSON.stringify({ sucesso: true, dados: CONFIG }) }
    : { estado: 202, corpo: "{}" });
  const r = await obter(br.ambiente(), "http://ingest.local", "uxda_des_t");
  assert.equal(r.origem, "servidor");
  assert.equal(r.config.amostragem, 0.5);
  assert.deepEqual(daCache(br.loja, br.agora()), r.config);
});

test("2.6 sem resposta, usa-se a cache; sem cache, mede-se tudo", async () => {
  const loja = memoria();
  const br1 = criarBrowser("<p></p>", { loja });
  br1.responder(() => ({ estado: 200, corpo: JSON.stringify({ dados: CONFIG }) }));
  await obter(br1.ambiente(), "http://ingest.local", "uxda_des_t");

  const br2 = criarBrowser("<p></p>", { loja });
  br2.responder(() => { throw new Error("sem rede"); });
  const comCache = await obter(br2.ambiente(), "http://ingest.local", "uxda_des_t");
  assert.equal(comCache.origem, "cache");
  assert.equal(comCache.config.versao, 7);

  const br3 = criarBrowser();
  br3.responder(() => ({ estado: 500, corpo: "" }));
  const semNada = await obter(br3.ambiente(), "http://ingest.local", "uxda_des_t");
  assert.equal(semNada.origem, "omissao");
  assert.deepEqual(semNada.config, CONFIGURACAO_SEGURA);
  assert.equal(semNada.config.amostragem, 1, "por omissão mede-se tudo");
});

test("2.6 configuração absurda não passa: os valores são normalizados", () => {
  const c = normalizar({ amostragem: 42, nivel: "inventado", captura: [1, "ecra"], versao: "x" });
  assert.equal(c.amostragem, 1);
  assert.equal(c.nivel, "padrao");
  assert.deepEqual(c.captura, ["ecra"]);
  assert.equal(c.versao, 0);
});

test("2.6 a lista remota manda sobre o nível", () => {
  assert.equal(capturaTipo({ ...CONFIGURACAO_SEGURA, captura: ["ecra"] }, "ecra"), true);
  assert.equal(capturaTipo({ ...CONFIGURACAO_SEGURA, captura: ["ecra"] }, "toque"), false);
  assert.equal(capturaTipo({ ...CONFIGURACAO_SEGURA, nivel: "essencial" }, "toque"), false);
  assert.equal(capturaTipo({ ...CONFIGURACAO_SEGURA, nivel: "essencial" }, "erro"), true);
  assert.equal(capturaTipo(CONFIGURACAO_SEGURA, "tecla"), true);
});

test("2.6 baixar a amostragem faz efeito na sessão seguinte, sem publicar nada", async () => {
  const loja = memoria();
  // Primeira sessão: mede tudo.
  const antes = criarBrowser(`<button id="b">ok</button>`, { loja });
  antes.responder((p) => p.url.includes("/v1/config")
    ? { estado: 200, corpo: JSON.stringify({ dados: { amostragem: 1, nivel: "padrao", captura: [], versao: 1 } }) }
    : { estado: 202, corpo: "{}" });
  const s1 = iniciar({ chave: "uxda_des_t", servidor: "http://ingest.local", ambiente: antes.ambiente() });
  await antes.avancar(10);
  disparar(antes.documento, "#b", "click");
  await antes.avancar(30000);
  assert.ok(antes.eventos().length >= 2, "a primeira sessão devia ter medido");
  assert.equal(s1.diagnostico().amostrado, true);

  // Alguém baixa a amostragem na consola. Nada é publicado; o SDK é o mesmo.
  const depois = criarBrowser(`<button id="b">ok</button>`, { loja });
  depois.responder((p) => p.url.includes("/v1/config")
    ? { estado: 200, corpo: JSON.stringify({ dados: { amostragem: 0, nivel: "padrao", captura: [], versao: 2 } }) }
    : { estado: 202, corpo: "{}" });
  const s2 = iniciar({ chave: "uxda_des_t", servidor: "http://ingest.local", ambiente: depois.ambiente() });
  await depois.avancar(10);
  disparar(depois.documento, "#b", "click");
  await depois.avancar(30000);
  assert.equal(s2.diagnostico().amostrado, false);
  assert.equal(depois.eventos().length, 0, "continuou a medir com a amostragem a zero");
  assert.equal(s2.diagnostico().configuracao.versao, 2);
});

test("2.6 uma cache velha de mais não é usada", () => {
  const loja = memoria();
  loja.setItem("uxda.config", JSON.stringify({ config: CONFIG, quando: 0 }));
  assert.equal(daCache(loja, VALIDADE_MS * 10), null);
});
