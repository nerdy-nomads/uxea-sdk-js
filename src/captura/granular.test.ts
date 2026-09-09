/**
 * Captura granular: o que se tentou e não deu, e como se preencheu. Cartões 4.1
 * a 4.4, RF-GRA-01 a RF-GRA-25.
 *
 * O que estes ensaios protegem, e é a razão de existirem: **nenhum destes sinais
 * é visível numa ferramenta de funis**. Um funil vê os passos que aconteceram; um
 * toque numa zona morta não é um passo, e é exatamente por isso que ninguém o vê.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { iniciar } from "../index.ts";
import { criarBrowser, disparar } from "../ensaio/duplo.ts";

const PAGINA = `
  <div id="zona-morta" style="width:200px;height:80px">Toque aqui para continuar</div>
  <button id="pagar" data-testid="pagar">Pagar</button>
  <button id="lento" disabled>Confirmar</button>
  <form id="f">
    <input id="nome" name="nome" />
    <input id="cartao" name="cartao" />
    <input id="validade" name="validade" />
  </form>`;

async function comSdk(nivel: "essencial" | "padrao" | "detalhado" = "padrao") {
  const br = criarBrowser(PAGINA, { caminho: "/pagamento" });
  br.responder((p) => p.url.includes("/v1/config")
    ? { estado: 200, corpo: JSON.stringify({ dados: { amostragem: 1, nivel, captura: [], versao: 1 } }) }
    : { estado: 202, corpo: "{}" });
  const uxda = iniciar({ chave: "uxda_des_teste", servidor: "http://ingest.local", ambiente: br.ambiente() });
  await br.avancar(10);
  return { br, uxda };
}

const doTipo = (evs: any[], t: string) => evs.filter((e) => e.event_type === t);

async function despejar(br: any, uxda: any) {
  await uxda.descarregar();
  await br.avancar(20000);
  return br.eventos();
}

/* ------------------------------------------------------------------- 4.1 */

test("4.1 os três casos aparecem separados, e não num contador de toques falhados", async () => {
  const { br, uxda } = await comSdk();

  // Uma zona que parece acionável e não é. É o sinal que o documento chama dos
  // mais subvalorizados que existem.
  disparar(br.documento, "#zona-morta", "pointerdown", { clientX: 40, clientY: 300 });
  // Um botão desativado, que o browser nem sequer deixa despachar `click`.
  disparar(br.documento, "#lento", "pointerdown", { clientX: 10, clientY: 10 });
  // E insistir no mesmo botão: o sistema não respondeu à vista dela.
  for (let i = 0; i < 3; i++) {
    disparar(br.documento, "#pagar", "pointerdown", { clientX: 5, clientY: 5 });
    await br.avancar(200);
  }
  await br.avancar(2000);

  const evs = await despejar(br, uxda);
  assert.equal(doTipo(evs, "toque_sem_alvo").length, 1, "o toque na zona morta");
  assert.equal(doTipo(evs, "toque_desativado").length, 1, "o toque no desativado");
  assert.equal(doTipo(evs, "toque_repetido").length, 1, "a rajada, num evento só");

  const repetido = doTipo(evs, "toque_repetido")[0]!;
  assert.equal(repetido.properties.repeticoes, 3, "as três insistências");
  assert.ok(repetido.properties.intervalo_ms > 0, "o intervalo entre elas");

  // A zona vai sempre; as coordenadas só no detalhado.
  const semAlvo = doTipo(evs, "toque_sem_alvo")[0]!;
  assert.ok(typeof semAlvo.properties.zona === "string", "a zona identifica onde foi");
  assert.equal(semAlvo.properties.toque_x, undefined, "no padrão não saem coordenadas");
});

test("4.1 as coordenadas só saem no nível detalhado", async () => {
  const { br, uxda } = await comSdk("detalhado");
  disparar(br.documento, "#zona-morta", "pointerdown", { clientX: 40, clientY: 300 });
  const evs = await despejar(br, uxda);
  const semAlvo = doTipo(evs, "toque_sem_alvo")[0]!;
  assert.equal(typeof semAlvo.properties.toque_x, "number");
  assert.ok(semAlvo.properties.toque_x >= 0 && semAlvo.properties.toque_x <= 100,
    "em percentagem da janela, para telemóveis e computadores caberem no mesmo mapa");
});

test("4.1 o tempo até à primeira interação conta-se por ecrã, e não por sessão", async () => {
  const { br, uxda } = await comSdk();
  await br.avancar(1800);
  disparar(br.documento, "#pagar", "pointerdown", { clientX: 5, clientY: 5 });
  const evs = await despejar(br, uxda);
  const primeira = doTipo(evs, "primeira_interacao");
  assert.equal(primeira.length, 1, "uma por ecrã, e não uma por toque");
  assert.ok(primeira[0]!.duration_ms >= 1800, `esperava 1800 ou mais, veio ${primeira[0]!.duration_ms}`);
});

/* ------------------------------------------------------------------- 4.2 */

test("4.2 colagem distingue-se de introdução manual", async () => {
  // Muda a interpretação de tudo o resto: um campo preenchido por colagem em dois
  // décimos de segundo não é fácil, é um campo cujo valor a pessoa foi buscar a
  // outro lado, e esse desvio é um custo que não aparece no tempo medido.
  const { br, uxda } = await comSdk();

  disparar(br.documento, "#nome", "focusin");
  await br.avancar(300);
  disparar(br.documento, "#nome", "input", { inputType: "insertText" });
  disparar(br.documento, "#nome", "focusout");

  disparar(br.documento, "#cartao", "focusin");
  await br.avancar(200);
  disparar(br.documento, "#cartao", "input", { inputType: "insertFromPaste" });
  disparar(br.documento, "#cartao", "focusout");

  const evs = await despejar(br, uxda);
  const campos = doTipo(evs, "campo");
  assert.equal(campos.length, 2);
  assert.equal(campos[0]!.properties.origem, "manual");
  assert.equal(campos[1]!.properties.origem, "colagem");
});

test("4.2 regressos, ordem efetiva e ordem prevista", async () => {
  const { br, uxda } = await comSdk();

  // Preenche pela ordem errada, e volta ao primeiro campo.
  disparar(br.documento, "#validade", "focusin");
  disparar(br.documento, "#validade", "focusout");
  disparar(br.documento, "#nome", "focusin");
  disparar(br.documento, "#nome", "focusout");
  disparar(br.documento, "#validade", "focusin");
  disparar(br.documento, "#validade", "focusout");

  const evs = await despejar(br, uxda);
  const ultimoDoCampo = (n: number) =>
    doTipo(evs, "campo").filter((e) => e.properties.ordem_prevista === n).slice(-1)[0]!;

  const validade = ultimoDoCampo(3);
  const nome = ultimoDoCampo(1);
  assert.equal(validade.properties.ordem, 1, "foi o primeiro a ser preenchido");
  assert.equal(validade.properties.ordem_prevista, 3, "mas o formulário previa que fosse o terceiro");
  assert.equal(nome.properties.ordem, 2);
  assert.equal(validade.properties.regressos, 1, "voltou uma vez ao mesmo campo");
});

test("4.2 um campo visitado e deixado vazio não é um campo nunca visitado", async () => {
  const { br, uxda } = await comSdk();
  disparar(br.documento, "#cartao", "focusin");
  await br.avancar(4000);
  disparar(br.documento, "#cartao", "focusout");
  const evs = await despejar(br, uxda);
  const campo = doTipo(evs, "campo")[0]!;
  assert.equal(campo.properties.visitado_vazio, true);
  assert.equal(campo.properties.caracteres_escritos, 0);
  assert.ok(campo.duration_ms >= 4000, "e esteve lá quatro segundos a olhar para ele");
});

test("4.2 nenhum caractere escrito aparece no que sai", async () => {
  const { br, uxda } = await comSdk("detalhado");
  const marcadores = ["SEGREDOxNOME", "4111111111111111", "ana.silva@exemplo.ao"];
  for (const [i, id] of ["#nome", "#cartao", "#validade"].entries()) {
    const el = br.documento.querySelector(id);
    disparar(br.documento, id, "focusin");
    el.value = marcadores[i];
    disparar(br.documento, id, "input", { inputType: "insertText", data: marcadores[i] });
    disparar(br.documento, id, "focusout");
  }
  const evs = await despejar(br, uxda);
  const bruto = JSON.stringify(evs);
  for (const m of marcadores) {
    assert.ok(!bruto.includes(m), `o marcador ${m} saiu do dispositivo`);
  }
  // E as contagens continuam a existir: é isto que o RF-GRA-12 pede, e é isto
  // que muita gente lê como autorização para capturar o conteúdo.
  const campos = doTipo(evs, "campo");
  assert.equal(campos[1]!.properties.caracteres_escritos, 16, "contou os dezasseis dígitos sem os ler");
});

/* ------------------------------------------------------------------- 4.3 */

test("4.3 erro por campo, com a chave da mensagem e as tentativas até resolver", async () => {
  const { br, uxda } = await comSdk();
  disparar(br.documento, "#cartao", "focusin");
  disparar(br.documento, "#cartao", "invalid");
  disparar(br.documento, "#cartao", "invalid");
  const evs = await despejar(br, uxda);
  const erros = doTipo(evs, "erro");
  assert.equal(erros.length, 2);
  assert.equal(erros[0]!.message_key, "validacao_nativa");
  assert.equal(erros[1]!.properties.tentativas_ate_resolver, 2, "segunda tentativa no mesmo campo");
  assert.ok(erros[0]!.element_key.includes("cartao"), "o erro sabe de que campo é");
});

test("4.3 o campo de abandono é o campo onde ela estava, e não o passo", async () => {
  // O documento chama a isto a informação mais acionável do conjunto: não é o
  // passo que provoca abandono, é quase sempre um campo concreto dentro dele.
  const { br, uxda } = await comSdk();
  disparar(br.documento, "#nome", "focusin");
  disparar(br.documento, "#nome", "focusout");
  disparar(br.documento, "#cartao", "focusin");
  await br.avancar(3000);

  (br.documento as any).visibilityState = "hidden";
  disparar(br.documento, "body", "visibilitychange");

  const evs = await despejar(br, uxda);
  const terminal = doTipo(evs, "terminal")[0]!;
  assert.ok(terminal, "uma tentativa deixada a meio tem de acabar em terminal");
  assert.equal(terminal.properties.estado, "abandonado");
  assert.ok(String(terminal.properties.campo_abandono).includes("cartao"),
    `esperava o campo do cartão, veio ${terminal.properties.campo_abandono}`);
});

test("4.3 o estado de cada campo na submissão, incluindo os que ninguém visitou", async () => {
  const { br, uxda } = await comSdk();
  const nome = br.documento.querySelector("#nome");
  disparar(br.documento, "#nome", "focusin");
  nome.value = "Ana";
  disparar(br.documento, "#nome", "input", { inputType: "insertText" });
  disparar(br.documento, "#nome", "focusout");
  disparar(br.documento, "#f", "submit");

  const evs = await despejar(br, uxda);
  const naSubmissao = doTipo(evs, "campo").filter((e) => e.properties.fase === "submissao");
  assert.equal(naSubmissao.length, 3, "um retrato por campo do formulário");
  assert.equal(naSubmissao[0]!.properties.estado_na_submissao, "preenchido");
  assert.equal(naSubmissao[1]!.properties.estado_na_submissao, "vazio");

  const submissao = doTipo(evs, "submissao")[0]!;
  assert.equal(submissao.properties.campos_preenchidos, 1);
  assert.equal(submissao.properties.campos_vazios, 2);
});

/* ------------------------------------------------------------------- 4.4 */

test("4.4 cada transição de passo traz o passo anterior e o tempo que ele levou", async () => {
  const { br, uxda } = await comSdk();
  await br.avancar(2500);
  br.janela.history.pushState({}, "", "/pagamento/confirmar");
  await br.avancar(10);

  const evs = await despejar(br, uxda);
  const passos = doTipo(evs, "passo");
  assert.ok(passos.length >= 2, `esperava dois passos, vieram ${passos.length}`);
  const segundo = passos[1]!;
  assert.equal(segundo.properties.passo, "/pagamento/confirmar");
  assert.equal(segundo.properties.passo_anterior, "/pagamento");
  assert.ok(segundo.duration_ms >= 2500, "o tempo que o passo anterior levou");
});

test("4.4 o tempo de espera do sistema não é tempo de decisão de ninguém", async () => {
  // O `fetch` lento tem de estar posto **antes** de o SDK arrancar: é o da
  // aplicação que o SDK embrulha, e substituí-lo depois era deitar fora o
  // embrulho e medir coisa nenhuma.
  const br = criarBrowser(PAGINA, { caminho: "/pagamento" });
  br.responder((p: any) => p.url.includes("/v1/config")
    ? { estado: 200, corpo: JSON.stringify({ dados: { amostragem: 1, nivel: "padrao", captura: [], versao: 1 } }) }
    : { estado: 202, corpo: "{}" });
  br.janela.fetch = async () => {
    await br.avancar(900);
    return { status: 200 };
  };
  const uxda = iniciar({ chave: "uxda_des_teste", servidor: "http://ingest.local", ambiente: br.ambiente() });
  await br.avancar(10);

  await br.janela.fetch("https://api.exemplo.ao/pedidos");
  await br.avancar(50);

  const evs = await despejar(br, uxda);
  const espera = doTipo(evs, "espera")[0]!;
  assert.ok(espera, "a espera imposta pelo sistema tem de sair num evento próprio");
  assert.ok(espera.duration_ms >= 900, `esperava 900 ou mais, veio ${espera.duration_ms}`);
});

test("4.4 o evento terminal é inequívoco, e são quatro estados", async () => {
  for (const estado of ["sucesso", "erro", "abandonado", "expirado"] as const) {
    const { br, uxda } = await comSdk();
    uxda.terminal(estado);
    const evs = await despejar(br, uxda);
    const t = doTipo(evs, "terminal");
    assert.equal(t.length, 1, `${estado}: um terminal, e um só`);
    assert.equal(t[0]!.properties.estado, estado);
  }
});

test("4.4 a duração de cada ausência para segundo plano é registada", async () => {
  const { br, uxda } = await comSdk();
  (br.documento as any).visibilityState = "hidden";
  disparar(br.documento, "body", "visibilitychange");
  await br.avancar(7000);
  (br.documento as any).visibilityState = "visible";
  disparar(br.documento, "body", "visibilitychange");

  const evs = await despejar(br, uxda);
  const regresso = doTipo(evs, "ambiente").find((e) => e.properties.mudanca === "primeiro_plano")!;
  assert.ok(regresso, "o regresso é que sabe quanto tempo durou a ausência");
  assert.ok(regresso.duration_ms >= 7000, `esperava 7000 ou mais, veio ${regresso.duration_ms}`);
});
