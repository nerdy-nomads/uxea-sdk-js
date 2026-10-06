/**
 * Mensagens de sistema, cartões 5.1, 5.2 e 5.3.
 *
 * O que estes ensaios provam não é que as funções devolvem o que se espera: é que
 * **uma aplicação que mostra uma mensagem produz um evento**, sem ninguém a
 * instrumentar, e que o que sai do dispositivo não traz lá dentro nada que a
 * pessoa tenha escrito.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { criarBrowser, disparar } from "../ensaio/duplo.ts";
import { iniciar } from "../index.ts";
import { mascararMensagem, esqueletoDeMensagem, resumo, normalizarTexto } from "../identity/mask.ts";

const PAGINA = `
  <form id="f" action="/pagar">
    <label for="nif">NIF</label>
    <input id="nif" name="nif" aria-describedby="erro-nif">
    <span id="erro-nif" class="invalid-feedback" hidden></span>
    <button id="pagar" type="submit">Pagar</button>
  </form>
  <div id="avisos"></div>
`;

async function comSdk(html = PAGINA, config: Record<string, unknown> = {}) {
  const br = criarBrowser(html, { caminho: "/checkout" });
  br.responder((p) => p.url.includes("/v1/config")
    ? { estado: 200, corpo: JSON.stringify({ dados: { amostragem: 1, nivel: "padrao", captura: [], versao: 1, ...config } }) }
    : { estado: 202, corpo: "{}" });
  const uxda = iniciar({ chave: "uxda_des_teste", servidor: "https://ingest.local", ambiente: br.ambiente() });
  await br.avancar(10);
  return { br, uxda };
}

/** Põe uma mensagem no ecrã como uma aplicação a põe: cria o nó e acrescenta-o. */
function mostrar(br: any, html: string, dentroDe = "#avisos") {
  const alvo = br.documento.querySelector(dentroDe)!;
  const molde = br.documento.createElement("div");
  molde.innerHTML = html;
  for (const filho of Array.from(molde.children) as any[]) alvo.appendChild(filho);
}

const mensagens = (br: any) => br.eventos().filter((e: any) => e.event_type === "mensagem");

test("5.1 seis mensagens diferentes dão seis chaves distintas, nos quatro tipos", async () => {
  // É a linha `Pronto quando` do cartão, à letra. E nada disto está instrumentado:
  // é o DOM da aplicação tal como ela o escreveria.
  const { br, uxda } = await comSdk();
  mostrar(br, `
    <div role="alert" class="alert alert-danger">Pagamento recusado pelo banco</div>
    <div role="alert" class="alert alert-danger">Sessao expirada, entre outra vez</div>
    <div class="toast toast-warning">A ligacao esta lenta</div>
    <div class="notification notification-success">Transferencia concluida</div>
    <div role="status" class="alert alert-info">O comprovativo segue por correio</div>
    <div class="snackbar snackbar-info">Guardamos as suas preferencias</div>
  `);
  await br.avancar(50);
  await uxda.descarregar();
  await br.avancar(20000);

  const evs = mensagens(br);
  assert.equal(evs.length, 6, `saíram ${evs.length}: ${evs.map((e: any) => e.message_key).join(", ")}`);
  assert.equal(new Set(evs.map((e: any) => e.message_key)).size, 6, "duas mensagens diferentes ficaram com a mesma chave");
  const tipos = evs.map((e: any) => e.message_kind).sort();
  assert.deepEqual(tipos, ["aviso", "erro", "erro", "info", "info", "sucesso"]);
  // O contexto do RF-MSG-05: ecrã, versão e momento vêm de graça no envelope.
  for (const e of evs) {
    assert.equal(e.screen_key, "/checkout");
    assert.ok(e.app_version, "sem versão da aplicação");
    assert.ok(e.occurred_at, "sem momento");
    assert.equal(e.properties.visivel, true);
  }
});

test("5.1 a chave ganha ao texto, e o mesmo erro em dois idiomas conta como um", async () => {
  // É o RF-MSG-02, e é a razão de ele existir: uma aplicação bilingue com captura
  // por texto dá duas entradas no catálogo para o mesmo problema, e a segunda
  // parece metade do tamanho que tem.
  const { br, uxda } = await comSdk();
  mostrar(br, `<div role="alert" data-uxda-mensagem="saldo_insuficiente">Saldo insuficiente</div>`);
  await br.avancar(2000);
  mostrar(br, `<div role="alert" data-uxda-mensagem="saldo_insuficiente">Insufficient balance</div>`);
  await br.avancar(50);
  await uxda.descarregar();
  await br.avancar(20000);

  const evs = mensagens(br);
  assert.equal(evs.length, 2, "as duas apresentações contam, e são duas ocorrências");
  assert.equal(new Set(evs.map((e: any) => e.message_key)).size, 1, "duas entradas para a mesma mensagem");
  assert.equal(evs[0].message_key, "saldo_insuficiente");
  assert.equal(evs[0].properties.origem_mensagem, "chave");
  // Com chave, o texto **nem sai**: não há nada para mascarar nem para arriscar.
  assert.equal(evs[0].message_text_masked, undefined);
  assert.ok(!JSON.stringify(evs).includes("Insufficient"), "o texto saiu com a chave presente");
});

test("5.1 validação, operação e sistema são três coisas, e saem distinguidas", async () => {
  // RF-MSG-07. A distinção não é taxonómica: um erro de validação é trabalho de
  // quem desenhou o formulário, um de operação é de quem escreveu a regra de
  // negócio, e um de sistema é de quem opera a infraestrutura.
  const { br, uxda } = await comSdk();
  const campo = br.documento.querySelector("#erro-nif")!;
  campo.removeAttribute("hidden");
  campo.textContent = "NIF invalido";
  campo.setAttribute("class", "invalid-feedback erro");
  await br.avancar(50);
  mostrar(br, `<div role="alert" class="alert-danger">A operacao nao pode ser concluida</div>`);
  await br.avancar(50);
  await uxda.descarregar();
  await br.avancar(20000);

  const evs = mensagens(br);
  const validacao = evs.find((e: any) => e.properties.classe_erro === "validacao");
  const operacao = evs.find((e: any) => e.properties.classe_erro === "operacao");
  assert.ok(validacao, `sem erro de validação: ${JSON.stringify(evs.map((e: any) => e.properties))}`);
  assert.ok(operacao, "sem erro de operação");
  // E o campo associado vai lá, que é o que torna a mensagem acionável: sem ele,
  // sabe-se que o formulário falhou e não se sabe onde.
  assert.ok(String(validacao.properties.campo_associado).includes("nif"),
    `campo associado inesperado: ${validacao.properties.campo_associado}`);
  assert.equal(operacao.properties.campo_associado, undefined);
});

test("5.1 o passo em que a tentativa ia vai na mensagem", async () => {
  const { br, uxda } = await comSdk();
  uxda.passo("confirmacao");
  mostrar(br, `<div role="alert" data-uxda-mensagem="cartao_recusado">Cartao recusado</div>`);
  await br.avancar(50);
  await uxda.descarregar();
  await br.avancar(20000);
  assert.equal(mensagens(br)[0].properties.passo, "confirmacao");
});

test("5.2 montantes, datas e identificadores saem mascarados do dispositivo", async () => {
  // RF-MSG-04, e o sítio é o que interessa: **no dispositivo**. Mascarar no
  // servidor deixava a promessa verdadeira no desenho e falsa na prática, porque
  // o valor já tinha atravessado a rede.
  const { br, uxda } = await comSdk();
  mostrar(br, `<div role="alert" class="erro">O saldo de 12.400,50 Kz e insuficiente para o pedido 005123456LA041 de 2027-03-14</div>`);
  await br.avancar(50);
  await uxda.descarregar();
  await br.avancar(20000);

  const ev = mensagens(br)[0];
  assert.equal(ev.properties.origem_mensagem, "texto");
  const texto = String(ev.message_text_masked);
  assert.ok(texto.includes("{numero}"), texto);
  assert.ok(texto.includes("{id}"), texto);
  assert.ok(texto.includes("{data}"), texto);
  const bruto = JSON.stringify(br.eventos());
  for (const segredo of ["12.400", "12400", "005123456LA041", "2027-03-14"]) {
    assert.ok(!bruto.includes(segredo), `${segredo} atravessou a rede`);
  }
});

test("5.2 variantes da mesma mensagem caem numa entrada só", async () => {
  // O risco alto que o documento nomeia: o catálogo fragmentar-se em milhares de
  // variantes da mesma mensagem. Com marcadores, as duas primeiras são a mesma
  // entrada; a terceira é outra redação, e é o grupo que a junta.
  const a = mascararMensagem("O saldo de 12.400 Kz é insuficiente");
  const b = mascararMensagem("O saldo de 300 Kz é insuficiente");
  assert.equal(a, b, "duas variantes deram dois textos");
  const c = mascararMensagem("O saldo é insuficiente");
  assert.notEqual(a, c, "redações diferentes não são a mesma chave");
  assert.equal(
    resumo(esqueletoDeMensagem(a)), resumo(esqueletoDeMensagem(c)),
    "a mesma mensagem reescrita ficou em dois grupos",
  );
  assert.notEqual(
    resumo(esqueletoDeMensagem(a)),
    resumo(esqueletoDeMensagem(mascararMensagem("Pagamento recusado pelo banco emissor"))),
    "duas mensagens diferentes ficaram no mesmo grupo",
  );
});

test("5.2 nem o nome nem o que a pessoa escreveu saem dentro de uma mensagem", async () => {
  // É o risco crítico do documento: mensagens de erro com dados pessoais
  // interpolados enviadas sem mascaramento. O `mascarar` do elemento não chegava:
  // um nome não tem um único algarismo.
  const { br, uxda } = await comSdk();
  mostrar(br, `<div role="alert" class="erro">Ola Ana Maria da Silva, o valor "conta-secreta" nao e valido</div>`);
  await br.avancar(50);
  await uxda.descarregar();
  await br.avancar(20000);

  const bruto = JSON.stringify(br.eventos());
  for (const segredo of ["Ana Maria", "da Silva", "conta-secreta"]) {
    assert.ok(!bruto.includes(segredo), `${segredo} atravessou a rede: ${mensagens(br)[0]?.message_text_masked}`);
  }
  const texto = String(mensagens(br)[0].message_text_masked);
  assert.ok(texto.includes("{nome}") && texto.includes("{valor}"), texto);
});

test("5.2 a lista de permissões da instituição levanta a mascaragem, e o chão fica", async () => {
  // RNF-PRI-04: mascaramento por omissão, exposição só por lista explícita. E o
  // chão que a lista **não** levanta são os números, os identificadores e o
  // correio electrónico: esses punham-nos em falta independentemente de quem os
  // autorizou, e a ingestão recusa o evento que os traga.
  const texto = "Servico Multicaixa Express indisponivel ate as 18:00 de 2027-03-14";
  const chave = `txt_${resumo(normalizarTexto(mascararMensagem(texto)))}`;

  const semLista = await comSdk();
  mostrar(semLista.br, `<div role="alert" class="aviso">${texto}</div>`);
  await semLista.br.avancar(50);
  await semLista.uxda.descarregar();
  await semLista.br.avancar(20000);
  assert.ok(String(mensagens(semLista.br)[0].message_text_masked).includes("{hora}"), "por omissão tem de sair mascarado");

  const comLista = await comSdk(PAGINA, { mensagens_expostas: [chave] });
  mostrar(comLista.br, `<div role="alert" class="aviso">${texto}</div>`);
  await comLista.br.avancar(50);
  await comLista.uxda.descarregar();
  await comLista.br.avancar(20000);
  const exposto = String(mensagens(comLista.br)[0].message_text_masked);
  assert.ok(exposto.includes("Multicaixa Express"), `a lista não expôs nada: ${exposto}`);
  assert.ok(!exposto.includes("18:00") && !exposto.includes("2027-03-14"),
    `o chão foi levantado, e não podia: ${exposto}`);
});

test("5.3 os erros técnicos saem distinguidos, e nenhum deles esteve no ecrã", async () => {
  // RF-MSG-06. Falhas de rede, tempos esgotados e respostas de erro do servidor
  // não produzem mensagem visível, mas produzem abandono: sem elas, a causa
  // provável do abandono do 12.2 fica cega ao motivo mais frequente de todos.
  const { br, uxda } = await comSdk();
  const janela: any = br.janela;

  janela.fetch = async (url: string) => {
    if (String(url).includes("/pagamentos/")) return { status: 503, url: String(url) };
    if (String(url).includes("/perfis/")) return { status: 422, url: String(url) };
    if (String(url).includes("/lento")) { const e: any = new Error("abortado"); e.name = "AbortError"; throw e; }
    throw new Error("sem rede");
  };
  // O SDK embrulha o `fetch` que estiver posto no momento em que liga, e por isso
  // religa-se a captura de rede sobre este.
  const uxda2 = iniciar({ chave: "uxda_des_teste", servidor: "https://ingest.local", ambiente: br.ambiente() });
  await br.avancar(10);

  await janela.fetch("https://api.exemplo.ao/pagamentos/8412").catch(() => {});
  await janela.fetch("https://api.exemplo.ao/perfis/77").catch(() => {});
  await janela.fetch("https://api.exemplo.ao/lento").catch(() => {});
  await janela.fetch("https://api.exemplo.ao/saldos/1").catch(() => {});
  await br.avancar(50);
  await uxda.descarregar();
  await uxda2.descarregar();
  await br.avancar(20000);

  const tecnicos = br.eventos().filter((e: any) => e.event_type === "erro_rede");
  const porChave = new Map(tecnicos.map((e: any) => [e.message_key, e]));
  assert.ok(porChave.has("http_503"), `sem o 503: ${[...porChave.keys()].join(", ")}`);
  assert.ok(porChave.has("http_422"), "sem o 4xx: uma recusa do servidor que ninguém mostrou");
  assert.ok(porChave.has("rede_expirou"), "sem o tempo esgotado");
  assert.ok(porChave.has("rede_indisponivel"), "sem a falha de rede");
  assert.equal(porChave.get("http_503").properties.classe_erro, "sistema");
  assert.equal(porChave.get("http_422").properties.classe_erro, "operacao");
  assert.equal(porChave.get("http_503").properties.operacao, "pagamentos");
  for (const e of tecnicos) assert.equal(e.properties.visivel, false, `${e.message_key} saiu como visível`);
});

test("5.3 a aplicação declara o que apanhou e não mostrou", async () => {
  const { br, uxda } = await comSdk();
  uxda.erroTecnico("resposta_ilegivel", { operacao: "extrato", codigo_http: 200 });
  await uxda.descarregar();
  await br.avancar(20000);
  const ev = mensagens(br)[0];
  assert.equal(ev.message_key, "resposta_ilegivel");
  assert.equal(ev.properties.visivel, false);
  assert.equal(ev.properties.classe_erro, "sistema");
  assert.equal(ev.properties.operacao, "extrato");
});

test("5.1 a mesma mensagem a piscar não conta vinte vezes", async () => {
  const { br, uxda } = await comSdk();
  for (let i = 0; i < 5; i++) {
    mostrar(br, `<div role="alert" data-uxda-mensagem="rede_lenta">A ligacao esta lenta</div>`);
    await br.avancar(100);
  }
  await uxda.descarregar();
  await br.avancar(20000);
  assert.equal(mensagens(br).length, 1, "cinco apresentações em meio segundo contaram mais do que uma");
});

test("5.1 um invólucro vazio não é uma mensagem", async () => {
  // Uma aplicação tem dezenas de `div` de alerta escondidos à espera de serem
  // preenchidos. Contá-los dava um catálogo com entradas que ninguém viu.
  const { br, uxda } = await comSdk();
  mostrar(br, `<div role="alert" class="alert" id="vazio"></div>`);
  await br.avancar(50);
  await uxda.descarregar();
  await br.avancar(20000);
  assert.equal(mensagens(br).length, 0);
});

test("5.1 uma mensagem nunca lê o campo que está dentro dela", async () => {
  const { br, uxda } = await comSdk();
  mostrar(br, `<div role="alert" class="erro">Confirme o valor <input id="eco" value="ana.silva@exemplo.ao"><textarea>senha-super-secreta</textarea></div>`);
  await br.avancar(50);
  await uxda.descarregar();
  await br.avancar(20000);
  const bruto = JSON.stringify(br.eventos());
  assert.ok(!bruto.includes("senha-super-secreta"), "o conteúdo de um textarea saiu dentro da mensagem");
  assert.ok(!bruto.includes("ana.silva@exemplo.ao"), "o valor de um campo saiu dentro da mensagem");
});

void disparar;

test("5.1 o contentor dos avisos não é uma mensagem: só o que está lá dentro", async () => {
  // Apanhado no ensaio em telemóvel: o invólucro onde a aplicação empilha os
  // avisos chama-se `avisos`, tem `aria-live`, e o texto dele é a soma dos
  // filhos. Contava duas vezes, uma pelo filho e outra pelo pai, e a segunda com
  // a classificação do invólucro. A mensagem é sempre a mais funda.
  const { br, uxda } = await comSdk(`<div id="avisos" aria-live="polite" class="mensagens"></div>`);
  mostrar(br, `<div role="alert" class="alert-danger">Pagamento recusado pelo banco</div>`);
  await br.avancar(50);
  await uxda.descarregar();
  await br.avancar(20000);

  const evs = mensagens(br);
  assert.equal(evs.length, 1, `o contentor contou também: ${evs.map((e: any) => e.message_kind).join(", ")}`);
  assert.equal(evs[0].message_kind, "erro");
});
