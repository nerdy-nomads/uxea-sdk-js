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
import { profundidadeDe } from "./deslocamento.ts";

const PAGINA = `
  <div id="zona-morta" style="width:200px;height:80px">Toque aqui para continuar</div>
  <button id="pagar" data-testid="pagar" data-caixa="20,700,200,48">Pagar</button>
  <button id="lento" disabled data-caixa="20,600,200,48">Confirmar</button>
  <form id="f">
    <input id="nome" name="nome" />
    <input id="cartao" name="cartao" />
    <input id="validade" name="validade" />
  </form>`;

async function comSdk(
  nivel: "essencial" | "padrao" | "detalhado" = "padrao",
  individual = false,
) {
  const br = criarBrowser(PAGINA, { caminho: "/pagamento" });
  br.responder((p) => p.url.includes("/v1/config")
    ? {
        estado: 200,
        corpo: JSON.stringify({
          dados: {
            amostragem: 1, nivel, captura: [], versao: 1,
            rastreio_individual: individual,
          },
        }),
      }
    : { estado: 202, corpo: "{}" });
  const uxda = iniciar({ chave: "uxda_des_teste", servidor: "https://ingest.local", ambiente: br.ambiente() });
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

test("4.1 e 9.1 as coordenadas precisam das duas condições, e não de uma", async () => {
  // **O nível detalhado sozinho não chega.** Ele diz quanta granularidade se capta;
  // o rastreio individual diz se é legítimo seguir uma pessoa, e são decisões
  // diferentes de quem opera (RF-IND-09). Com uma condição só, desligar o rastreio
  // no cartão 9.5 deixava de mostrar e continuava a recolher.
  const so = await comSdk("detalhado", false);
  disparar(so.br.documento, "#zona-morta", "pointerdown", { clientX: 40, clientY: 300 });
  const semRastreio = doTipo(await despejar(so.br, so.uxda), "toque_sem_alvo")[0]!;
  assert.equal(semRastreio.properties.toque_x, undefined,
    "sem rastreio individual não saem coordenadas, mesmo no detalhado");
  assert.ok(typeof semRastreio.properties.zona === "string",
    "a zona continua a sair: ela agrupa e não localiza ninguém");

  const { br, uxda } = await comSdk("detalhado", true);
  disparar(br.documento, "#zona-morta", "pointerdown", { clientX: 40, clientY: 300 });
  const evs = await despejar(br, uxda);
  const semAlvo = doTipo(evs, "toque_sem_alvo")[0]!;
  assert.equal(typeof semAlvo.properties.toque_x, "number");
  assert.ok(semAlvo.properties.toque_x >= 0 && semAlvo.properties.toque_x <= 100,
    "em percentagem da janela, para telemóveis e computadores caberem no mesmo mapa");
  // As dimensões do visor vão junto: sem elas, duas percentagens iguais em ecrãs
  // de tamanhos diferentes são o mesmo ponto no mapa e coisas diferentes na vida.
  assert.ok(semAlvo.properties.visor_largura > 0 && semAlvo.properties.visor_altura > 0,
    "as dimensões do visor acompanham as coordenadas (RF-IND-02)");
  assert.equal(semAlvo.properties.ordem_na_sequencia, 1, "a primeira interação do ecrã");
});

test("9.1 um toque num elemento traz a caixa dele e o ponto dentro dela", async () => {
  // São duas perguntas diferentes sobre o mesmo toque: **onde no ecrã** (o mapa de
  // calor) e **onde no botão** (a área de toque mal desenhada). E a caixa é o que
  // permite desenhar o esquema do ecrã sem nunca o fotografar (cartão 9.2).
  const { br, uxda } = await comSdk("detalhado", true);
  disparar(br.documento, "#lento", "pointerdown", { clientX: 12, clientY: 8 });
  const desativado = doTipo(await despejar(br, uxda), "toque_desativado")[0]!;
  assert.ok(desativado, "o toque no botão desativado");
  assert.equal(typeof desativado.properties.alvo_x, "number", "o ponto dentro da caixa");
  assert.ok(desativado.properties.alvo_x >= 0 && desativado.properties.alvo_x <= 100);
  assert.equal(typeof desativado.properties.alvo_caixa, "string", "a caixa do elemento");
  assert.equal(desativado.properties.alvo_caixa.split(",").length, 4,
    "x, y, largura e altura, em percentagem do visor");
});

test("9.1 um toque que funciona traz a posição, e não só os que falham", async () => {
  // **É o defeito que a loja de ensaio apanhou no browser, e nenhum ensaio antes
  // deste.** O `pointerdown` só emite os três casos em que nada aconteceu; o toque
  // normal sai do `click` da captura base. As coordenadas estavam a sair nos
  // toques mortos e não nos que funcionam, e o mapa de calor do cartão 9.2 ficava
  // a desenhar só as falhas, que é o oposto de um mapa de calor.
  const { br, uxda } = await comSdk("detalhado", true);
  disparar(br.documento, "#pagar", "pointerdown", { clientX: 80, clientY: 720 });
  disparar(br.documento, "#pagar", "click", { clientX: 80, clientY: 720 });
  const toque = doTipo(await despejar(br, uxda), "toque")[0]!;
  assert.ok(toque, "o toque que funciona");
  assert.equal(typeof toque.properties.toque_x, "number", "sem coordenadas, não há mapa de calor");
  assert.equal(typeof toque.properties.alvo_caixa, "string", "sem caixa, não há esquema do ecrã");
  assert.ok(toque.properties.visor_largura > 0, "as dimensões do visor acompanham");
});

test("9.1 um clique sem gesto não inventa uma posição", async () => {
  // Um `click` disparado por teclado ou por `element.click()` não tem coordenadas
  // nenhumas. **Devolver zeros seria pôr um toque no canto superior esquerdo**, e
  // o canto superior esquerdo é um sítio a sério do ecrã.
  const { br, uxda } = await comSdk("detalhado", true);
  disparar(br.documento, "#pagar", "click", {});
  const toque = doTipo(await despejar(br, uxda), "toque")[0]!;
  assert.ok(toque, "o toque saiu na mesma: o que falta é a posição, e não o evento");
  assert.equal(toque.properties?.toque_x, undefined, "inventou uma posição que não houve");
});

test("9.1 sem rastreio individual, um toque que funciona não leva posição nenhuma", async () => {
  const { br, uxda } = await comSdk("detalhado", false);
  disparar(br.documento, "#pagar", "pointerdown", { clientX: 80, clientY: 720 });
  disparar(br.documento, "#pagar", "click", { clientX: 80, clientY: 720 });
  const toque = doTipo(await despejar(br, uxda), "toque")[0]!;
  assert.equal(toque.properties?.toque_x, undefined,
    "desligar o rastreio individual tem de parar de recolher, e não só de mostrar");
});

test("9.1 a ordem da interação conta-se por ecrã, e não por sessão", async () => {
  // É assim que duas visitas ao mesmo ecrã se comparam uma com a outra. Contada
  // por sessão, a segunda visita começava no número trinta e não se alinhava com
  // nada.
  const { br, uxda } = await comSdk("detalhado", true);
  disparar(br.documento, "#zona-morta", "pointerdown", { clientX: 10, clientY: 300 });
  disparar(br.documento, "#zona-morta", "pointerdown", { clientX: 20, clientY: 310 });
  const evs = await despejar(br, uxda);
  const ordens = doTipo(evs, "toque_sem_alvo").map((e) => e.properties.ordem_na_sequencia);
  assert.deepEqual(ordens, [1, 2], "a sequência dentro do ecrã");
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
  const uxda = iniciar({ chave: "uxda_des_teste", servidor: "https://ingest.local", ambiente: br.ambiente() });
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

/* ------------------------------------------------------------------- 9.1 */

test("9.1 a profundidade conta o fundo do visor, e não o topo", () => {
  // **Uma página que cabe inteira no ecrã foi vista toda**, e com o topo dava 0%,
  // que é o oposto do que aconteceu: ninguém teve de deslocar nada porque não
  // havia nada por baixo.
  assert.equal(profundidadeDe(0, 800, 800), 100, "coube inteira: cem por cento");
  assert.equal(profundidadeDe(0, 800, 1600), 50, "metade visível sem deslocar");
  assert.equal(profundidadeDe(800, 800, 1600), 100, "desceu até ao fim");
  assert.equal(profundidadeDe(400, 800, 1600), 75);
  // E nunca passa de cem, mesmo com o salto elástico do telemóvel a levar o
  // deslocamento para além do fim da página.
  assert.equal(profundidadeDe(2000, 800, 1600), 100, "o salto elástico não inventa página");
});

test("9.1 o deslocamento sai uma vez por ecrã, com o máximo, e não a cada movimento", async () => {
  // É a decisão inteira do módulo: um `scroll` dispara dezenas de vezes por
  // segundo, e um evento por cada um multiplicava o volume por cem para dizer a
  // mesma coisa. O que interessa é até onde a pessoa **chegou**.
  const { br, uxda } = await comSdk("detalhado", true);
  const doc: any = br.documento;
  doc.documentElement.scrollHeight = 2400;

  br.janela.scrollY = 400;
  br.janela.dispararJanela("scroll");
  br.janela.scrollY = 1600;
  br.janela.dispararJanela("scroll");
  br.janela.scrollY = 200; // voltou para cima: o máximo já foi atingido
  br.janela.dispararJanela("scroll");

  // O ecrã só fecha quando muda, e é aí que a profundidade se torna definitiva.
  br.janela.history.pushState({}, "", "/confirmacao");
  await br.avancar(50);

  const evs = await despejar(br, uxda);
  const deslocamentos = doTipo(evs, "deslocamento");
  // **Um por ecrã**, e não um por movimento: foram dois ecrãs (o de chegada e o
  // que a navegação abriu), e por isso são dois eventos e não dezenas.
  assert.equal(deslocamentos.length, 2, "um por ecrã, e não um por movimento");
  assert.equal(deslocamentos[0]!.properties.profundidade, 100,
    "o máximo que chegou a estar visível: 1600 + 800 de visor em 2400 de página");
  assert.equal(deslocamentos[0]!.screen_key, "/pagamento",
    "pertence ao ecrã que acabou, e não ao que começou");
});

test("9.1 o ecrã de chegada também mede a profundidade", async () => {
  // **É o defeito que a loja de ensaio apanhou no browser.** O primeiro `ecra`
  // era emitido por fora da captura, e por isso o deslocamento nunca começava a
  // medir na página de chegada. Numa aplicação de página única isso é um ecrã em
  // cada sessão; **numa aplicação de páginas é todas as páginas**, e o mapa de
  // profundidade do cartão 9.2 ficava vazio para sempre sem nada a dizer porquê.
  //
  // Este ensaio não navega para lado nenhum: é exatamente a forma de uma página
  // que se abre, se lê e se fecha.
  const { br, uxda } = await comSdk("detalhado", true);
  const doc: any = br.documento;
  doc.documentElement.scrollHeight = 2400;
  br.janela.scrollY = 800;
  br.janela.dispararJanela("scroll");

  const evs = await despejar(br, uxda);
  const deslocamentos = doTipo(evs, "deslocamento");
  assert.equal(deslocamentos.length, 1, "a página de chegada mede como qualquer outra");
  assert.equal(deslocamentos[0]!.screen_key, "/pagamento");
  assert.ok(deslocamentos[0]!.properties.profundidade >= 66,
    `800 + 800 de visor em 2400 de página: ${deslocamentos[0]!.properties.profundidade}`);
});

test("9.1 sem rastreio individual não sai profundidade nenhuma", async () => {
  const { br, uxda } = await comSdk("detalhado", false);
  const doc: any = br.documento;
  doc.documentElement.scrollHeight = 2400;
  br.janela.scrollY = 1600;
  br.janela.dispararJanela("scroll");
  br.janela.history.pushState({}, "", "/confirmacao");
  await br.avancar(50);
  assert.equal(doTipo(await despejar(br, uxda), "deslocamento").length, 0);
});
