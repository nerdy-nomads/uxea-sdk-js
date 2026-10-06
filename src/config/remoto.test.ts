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
  const r = await obter(br.ambiente(), "https://ingest.local", "uxda_des_t");
  assert.equal(r.origem, "servidor");
  assert.equal(r.config.amostragem, 0.5);
  assert.deepEqual(daCache(br.loja, br.agora()), r.config);
});

test("2.6 sem resposta, usa-se a cache; sem cache, mede-se tudo", async () => {
  const loja = memoria();
  const br1 = criarBrowser("<p></p>", { loja });
  br1.responder(() => ({ estado: 200, corpo: JSON.stringify({ dados: CONFIG }) }));
  await obter(br1.ambiente(), "https://ingest.local", "uxda_des_t");

  const br2 = criarBrowser("<p></p>", { loja });
  br2.responder(() => { throw new Error("sem rede"); });
  const comCache = await obter(br2.ambiente(), "https://ingest.local", "uxda_des_t");
  assert.equal(comCache.origem, "cache");
  assert.equal(comCache.config.versao, 7);

  const br3 = criarBrowser();
  br3.responder(() => ({ estado: 500, corpo: "" }));
  const semNada = await obter(br3.ambiente(), "https://ingest.local", "uxda_des_t");
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
  const s1 = iniciar({ chave: "uxda_des_t", servidor: "https://ingest.local", ambiente: antes.ambiente() });
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
  const s2 = iniciar({ chave: "uxda_des_t", servidor: "https://ingest.local", ambiente: depois.ambiente() });
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

/* ------------------------------------------------------------- inquéritos */

const REGRA = {
  chave: "facilidade_do_pagamento", versao: 3, formato: "esforco",
  pergunta: { pt: "Foi fácil pagar a encomenda?", en: "Was it easy to pay for the order?" },
  opcoes: [], multipla: false, comentario: true, gatilho: "apos_conclusao",
  criterios: [{ condicoes: [{ campo: "screen_key", operador: "igual", valor: "confirmacao" }] }],
  inicio: [{ condicoes: [{ campo: "screen_key", operador: "igual", valor: "pagamento" }] }],
  amostragem: 0.1, atraso_ms: 1500, contexto: { tarefa: "pagar_uma_encomenda", passo: "", funcionalidade: "" },
};

test("14.1 sem o campo, ou com ele estragado, não se pergunta nada", () => {
  assert.deepEqual(CONFIGURACAO_SEGURA.inqueritos.lista, [], "o valor seguro não tem inquéritos");
  for (const lixo of [undefined, null, "lixo", 42, [], { lista: "x" }, { lista: null }, { tema: {} }]) {
    assert.deepEqual(normalizar({ amostragem: 1, inqueritos: lixo }).inqueritos.lista, [], `${JSON.stringify(lixo)} deu inquéritos`);
  }
  const c = normalizar({ inqueritos: { lista: [null, 7, "x", { chave: "a" }, { ...REGRA, formato: "estrelas" }, { ...REGRA, gatilho: "sempre" }] } });
  assert.deepEqual(c.inqueritos.lista, []);
});

test("14.1 o exemplo do contrato lê-se inteiro, com os nomes do SDK", () => {
  const c = normalizar({
    inqueritos: {
      tema: { cor_primaria: "#1f4fd1", cor_fundo: "#ffffff", cor_texto: "#1b1f24", fonte: "system-ui, sans-serif", cantos_px: 12, idioma: "en" },
      fadiga: { max_pedidos: 2, periodo_dias: 14, excluir_respondeu_dias: 60 },
      associar_respostas: true,
      lista: [REGRA],
    },
  });
  assert.deepEqual(c.inqueritos.tema, { corPrimaria: "#1f4fd1", corFundo: "#ffffff", corTexto: "#1b1f24", fonte: "system-ui, sans-serif", cantosPx: 12, idioma: "en" });
  assert.deepEqual(c.inqueritos.fadiga, { maxPedidos: 2, periodoDias: 14, excluirRespondeuDias: 60 });
  assert.equal(c.inqueritos.associarRespostas, true);
  const r = c.inqueritos.lista[0]!;
  assert.equal(r.chave, "facilidade_do_pagamento");
  assert.equal(r.formato, "esforco");
  assert.equal(r.comentario, true);
  assert.equal(r.amostragem, 0.1);
  assert.equal(r.atrasoMs, 1500);
  assert.deepEqual(r.contexto, { tarefa: "pagar_uma_encomenda", passo: "", funcionalidade: "" });
});

test("14.2 os valores por omissão: amostragem 0,1, fadiga de 1 em 30 dias, 90 depois de responder", () => {
  const semNada = { ...REGRA } as Record<string, unknown>;
  delete semNada["amostragem"];
  delete semNada["atraso_ms"];
  const c = normalizar({ inqueritos: { lista: [semNada] } });
  assert.equal(c.inqueritos.lista[0]!.amostragem, 0.1, "nunca toda a gente sempre");
  assert.deepEqual(c.inqueritos.fadiga, { maxPedidos: 1, periodoDias: 30, excluirRespondeuDias: 90 });
  assert.equal(c.inqueritos.tema.idioma, "pt");
  assert.equal(c.inqueritos.associarRespostas, false, "anónima por omissão");
  // Uma amostragem absurda também vale 0,1, e não 1.
  assert.equal(normalizar({ inqueritos: { lista: [{ ...REGRA, amostragem: 7 }] } }).inqueritos.lista[0]!.amostragem, 0.1);
  assert.equal(normalizar({ inqueritos: { lista: [{ ...REGRA, amostragem: "1" }] } }).inqueritos.lista[0]!.amostragem, 0.1);
  // `associar_respostas` só liga com `true`.
  assert.equal(normalizar({ inqueritos: { associar_respostas: "true", lista: [] } }).inqueritos.associarRespostas, false);
});

test("14.1 um tema com valores que não são cores nem fontes cai para o por omissão", () => {
  const c = normalizar({
    inqueritos: {
      tema: { cor_primaria: "red;} body{display:none", cor_fundo: "url(x)", cor_texto: 12, fonte: "x}{", cantos_px: 900, idioma: "fr" },
      lista: [],
    },
  });
  assert.equal(c.inqueritos.tema.corPrimaria, "#1f4fd1");
  assert.equal(c.inqueritos.tema.corFundo, "#ffffff");
  assert.equal(c.inqueritos.tema.corTexto, "#1b1f24");
  assert.equal(c.inqueritos.tema.fonte, "system-ui, sans-serif");
  assert.equal(c.inqueritos.tema.cantosPx, 32);
  assert.equal(c.inqueritos.tema.idioma, "pt");
  const bom = normalizar({ inqueritos: { tema: { cor_primaria: "rgb(10, 20, 30)", fonte: '"Open Sans", Arial' }, lista: [] } });
  assert.equal(bom.inqueritos.tema.corPrimaria, "rgb(10, 20, 30)");
  assert.equal(bom.inqueritos.tema.fonte, '"Open Sans", Arial');
});

test("14.2 uma condição estragada tira o critério inteiro, e nunca só a condição", () => {
  // Tirar só a condição alargava o critério (as condições valem em **e**), e o
  // inquérito passava a aparecer a quem não devia.
  const c = normalizar({
    inqueritos: {
      lista: [{
        ...REGRA,
        criterios: [
          { condicoes: [{ campo: "screen_key", operador: "igual", valor: "confirmacao" }, { campo: "coluna_inventada", operador: "igual", valor: "x" }] },
          { condicoes: [{ campo: "event_type", operador: "igual", valor: "terminal" }, { campo: "propriedade:estado", operador: "igual", valor: "sucesso" }] },
          { condicoes: [{ campo: "event_type", operador: "igual", valor: "" }] },
          { condicoes: [] },
          { condicoes: [{ campo: "event_type", operador: "existe" }] },
        ],
      }],
    },
  });
  const criterios = c.inqueritos.lista[0]!.criterios;
  assert.equal(criterios.length, 2);
  assert.deepEqual(criterios[0]!.condicoes.map((x) => x.campo), ["event_type", "propriedade:estado"]);
  assert.deepEqual(criterios[1]!.condicoes, [{ campo: "event_type", operador: "existe", valor: "" }]);
});

test("14.2 um inquérito estragado sai, e os outros ficam", () => {
  const c = normalizar({
    inqueritos: {
      lista: [
        { ...REGRA, chave: "sem_criterios", criterios: [] },
        { ...REGRA, chave: "abandono_sem_inicio", gatilho: "apos_abandono", inicio: [] },
        { ...REGRA, chave: "escolha_sem_opcoes", formato: "escolha", opcoes: [] },
        { ...REGRA, chave: "sem_pergunta", pergunta: {} },
        { ...REGRA, chave: "erro_por_omissao", gatilho: "apos_erro", criterios: [] },
        { ...REGRA, chave: "amostra", gatilho: "amostragem", criterios: [] },
        { ...REGRA, chave: "escolha", formato: "escolha", multipla: true, opcoes: [{ chave: "demorou", pt: "Demorou muito" }, { chave: "demorou", pt: "Repetida" }, { pt: "sem chave" }] },
        REGRA,
        { ...REGRA, pergunta: { pt: "A mesma chave outra vez" } },
      ],
    },
  });
  assert.deepEqual(c.inqueritos.lista.map((r) => r.chave), ["erro_por_omissao", "amostra", "escolha", "facilidade_do_pagamento"]);
  const escolha = c.inqueritos.lista.find((r) => r.chave === "escolha")!;
  assert.deepEqual(escolha.opcoes, [{ chave: "demorou", pt: "Demorou muito", en: "Demorou muito" }]);
  assert.equal(escolha.multipla, true);
});

test("2.6 a cache é a resposta anterior inteira, e não só a amostragem e o nível", async () => {
  // O defeito: guardava-se a configuração já lida, com os nomes do SDK, e ao reler
  // o `normalizar` procurava os nomes do fio. O detalhado, as mensagens expostas, o
  // rastreio individual e os inquéritos voltavam todos ao valor por omissão num
  // arranque sem rede.
  const loja = memoria();
  const dados = {
    amostragem: 1, nivel: "padrao", captura: [], versao: 9, amostragem_detalhado: 0.25,
    mensagens_expostas: ["saldo_insuficiente"], rastreio_individual: true,
    inqueritos: { lista: [REGRA] },
  };
  const br1 = criarBrowser("<p></p>", { loja });
  br1.responder(() => ({ estado: 200, corpo: JSON.stringify({ sucesso: true, dados }) }));
  const doServidor = await obter(br1.ambiente(), "https://ingest.local", "uxda_des_t");

  const br2 = criarBrowser("<p></p>", { loja });
  br2.responder(() => { throw new Error("sem rede"); });
  const daCacheAgora = await obter(br2.ambiente(), "https://ingest.local", "uxda_des_t");
  assert.equal(daCacheAgora.origem, "cache");
  assert.deepEqual(daCacheAgora.config, doServidor.config);
  assert.equal(daCacheAgora.config.amostragemDetalhado, 0.25);
  assert.equal(daCacheAgora.config.rastreioIndividual, true);
  assert.deepEqual(daCacheAgora.config.mensagensExpostas, ["saldo_insuficiente"]);
  assert.equal(daCacheAgora.config.inqueritos.lista.length, 1);
});
