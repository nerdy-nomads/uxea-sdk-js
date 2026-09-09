/**
 * Configuração remota e amostragem. Cartão 2.6, RF-CAP-09, RF-CAP-10, D-10.
 *
 * O ensaio que interessa é o do servidor mudo: **a aplicação continua a
 * funcionar**, e continua a medir. Uma configuração que não chega não pode
 * deixar o cliente às escuras, e é por isso que o valor por omissão mede tudo.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { naAmostra } from "../core/uuid.ts";
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
  // O toque está no essencial, e é o ADR 0010 que o põe lá: sem ele não há
  // sequência nenhuma, e o essencial deixaria de servir para medir o que quer que
  // fosse. O que o essencial corta é o que multiplica o volume.
  assert.equal(capturaTipo({ ...CONFIGURACAO_SEGURA, nivel: "essencial" }, "toque"), true);
  assert.equal(capturaTipo({ ...CONFIGURACAO_SEGURA, nivel: "essencial" }, "foco"), false);
  assert.equal(capturaTipo({ ...CONFIGURACAO_SEGURA, nivel: "essencial" }, "erro"), true);
  // O padrão traz o agregado por campo e **não** traz a tecla: é o RF-GRA-29, e
  // é a diferença entre um evento por campo e um evento por tecla. A sequência
  // completa fica para o detalhado, que corre por amostragem.
  assert.equal(capturaTipo(CONFIGURACAO_SEGURA, "campo"), true);
  assert.equal(capturaTipo(CONFIGURACAO_SEGURA, "tecla"), false);
  assert.equal(capturaTipo(CONFIGURACAO_SEGURA, "toque_sem_alvo"), true);
  assert.equal(capturaTipo({ ...CONFIGURACAO_SEGURA, nivel: "detalhado" }, "tecla"), true);
  assert.equal(capturaTipo({ ...CONFIGURACAO_SEGURA, nivel: "essencial" }, "campo"), false);
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

test("4.5 a amostragem do detalhado é outra coisa que a amostragem de medir", () => {
  // A distinção é o ADR 0010: a `amostragem` decide **se** a pessoa é medida, e a
  // `amostragem_detalhado` decide **com que detalhe**. Com uma só, subir o detalhe
  // obrigava a subir para toda a gente, que é o custo que a decisão evita.
  const c = normalizar({ amostragem: 1, nivel: "padrao", amostragem_detalhado: 0.1, versao: 3 });
  assert.equal(c.amostragem, 1);
  assert.equal(c.amostragemDetalhado, 0.1);

  // E um valor absurdo não passa: uma fração acima de um punha toda a gente no
  // detalhado por engano, que é exatamente o acidente que isto evita.
  assert.equal(normalizar({ amostragem_detalhado: 7 }).amostragemDetalhado, 1);
  assert.equal(normalizar({ amostragem_detalhado: -3 }).amostragemDetalhado, 0);
  assert.equal(normalizar({}).amostragemDetalhado, 0, "por omissão ninguém está no detalhado");
});

test("4.5 a amostragem do detalhado é determinística, e por isso não deixa buracos", () => {
  // Com amostragem aleatória por sessão, a mesma pessoa entra e sai da amostra e
  // as tentativas dela ficam com buracos. Uma tentativa com buracos deixa de
  // significar o que quer que seja.
  const dentro = (id: string) => naAmostra("detalhado:" + id, 0.2);
  for (const id of ["a1", "pessoa-2", "3f2504e0-4f89-41d3-9a0c-0305e82c3301"]) {
    assert.equal(dentro(id), dentro(id), "a mesma pessoa tem de dar sempre o mesmo");
  }
  // E a fração sai perto do pedido, sobre gente a sério.
  let n = 0;
  const total = 20000;
  for (let i = 0; i < total; i++) if (dentro(`anonimo-${i}`)) n++;
  const fracao = n / total;
  assert.ok(fracao > 0.18 && fracao < 0.22, `esperava perto de 0,20 e deu ${fracao.toFixed(3)}`);

  // E quem está na amostra de medir não é a mesma gente que está na do detalhe:
  // sementes iguais concentravam as duas amostras nas mesmas pessoas.
  let iguais = 0;
  for (let i = 0; i < total; i++) if (dentro(`x${i}`) === naAmostra(`x${i}`, 0.2)) iguais++;
  assert.ok(iguais < total * 0.95, "as duas amostras não podem ser a mesma gente");
});
