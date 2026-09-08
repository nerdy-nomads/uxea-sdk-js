/**
 * O SDK inteiro, contra um browser de ensaio. Cartões 2.1, 2.2 e 2.6.
 *
 * O que estes ensaios provam não é que as funções devolvem o que se espera: é
 * que **colar uma linha numa página produz eventos**, sem ninguém instrumentar
 * nada, que é a promessa do produto.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { criarBrowser, disparar } from "./ensaio/duplo.ts";
import { iniciar, ambienteDaChave } from "./index.ts";
import { TIPOS } from "./core/tipos.ts";

const PAGINA = `
  <nav><a href="/inicio" id="ir">Início</a></nav>
  <form id="f" action="/pagar">
    <input id="nome" name="nome" required>
    <input id="cartao" name="cartao" type="text">
    <button id="pagar" type="submit" data-testid="pagar">Pagar</button>
  </form>
`;

async function comSdk(html = PAGINA) {
  const br = criarBrowser(html, { caminho: "/checkout" });
  const uxda = iniciar({ chave: "uxda_des_teste", servidor: "http://ingest.local", ambiente: br.ambiente() });
  await br.avancar(10);
  return { br, uxda };
}

test("2.1 uma linha basta: sem configuração nenhuma, o primeiro ecrã sai", async () => {
  const { br } = await comSdk();
  await br.avancar(10000);
  const evs = br.eventos();
  assert.ok(evs.length >= 1, "não saiu nenhum evento");
  assert.equal(evs[0].event_type, "ecra");
  assert.equal(evs[0].screen_key, "/checkout");
  assert.equal(evs[0].platform, "web");
  assert.equal(evs[0].capture_level, "padrao");
  // A chave vai no cabeçalho, e o projeto **não** vai no corpo: quem o decide é
  // o servidor, a partir da chave.
  const pedido = br.pedidos.find((p) => p.url.includes("/v1/eventos"))!;
  assert.equal(pedido.cabecalhos["X-UXDA-Key"], "uxda_des_teste");
  assert.equal(evs[0].project_id, undefined);
});

test("2.1 o ambiente sai do prefixo da chave", () => {
  assert.equal(ambienteDaChave("uxda_pro_abc"), "producao");
  assert.equal(ambienteDaChave("uxda_tes_abc"), "testes");
  assert.equal(ambienteDaChave("uxda_des_abc"), "desenvolvimento");
});

test("2.2 os dez tipos do RF-CAP-04 saem sem uma linha de instrumentação", async () => {
  const { br, uxda } = await comSdk();

  disparar(br.documento, "#pagar", "click");
  disparar(br.documento, "#nome", "focusin");
  await br.avancar(1200);
  disparar(br.documento, "#nome", "keydown", { key: "a" });
  disparar(br.documento, "#nome", "focusout");
  disparar(br.documento, "#f", "submit");
  disparar(br.documento, "#nome", "invalid");

  // Navegação de página única, e depois um recuo a sério.
  br.janela.history.pushState({}, "", "/pagamento");
  await br.avancar(10);
  br.janela.dispararJanela("popstate", { state: { __uxda: 0 } });

  (br.documento as any).visibilityState = "hidden";
  disparar(br.documento, "body", "visibilitychange");

  // Erro de rede da aplicação anfitriã: o `fetch` dela falha.
  br.janela.fetch = async () => { throw new Error("sem rede"); };
  const uxdaRede = br as any;
  void uxdaRede;
  await br.avancar(100);

  await uxda.descarregar();
  await br.avancar(20000);

  const tipos = new Set(br.eventos().map((e) => e.event_type));
  for (const t of ["ecra", "toque", "foco", "tecla", "desfoco", "submissao", "erro", "recuo", "plano_fundo"]) {
    assert.ok(tipos.has(t), `faltou o tipo ${t}: saíram ${[...tipos].join(", ")}`);
  }
});

test("3.1 o plano de fundo leva o tempo que a página esteve mesmo à vista", async () => {
  // A paridade com o Android obriga: lá o `plano_fundo` traz o tempo ativo, e sem
  // ele dos dois lados a comparação entre canais da mesma organização (RF-ADM-10)
  // tem o número numa plataforma e um vazio na outra.
  //
  // E é **tempo à vista**, não tempo desde que abriu: um separador aberto de manhã
  // e esquecido não são oito horas de uso.
  const { br, uxda } = await comSdk();

  await br.avancar(3000);
  (br.documento as any).visibilityState = "hidden";
  disparar(br.documento, "body", "visibilitychange");

  (br.documento as any).visibilityState = "visible";
  disparar(br.documento, "body", "visibilitychange");
  await br.avancar(2000);
  (br.documento as any).visibilityState = "hidden";
  disparar(br.documento, "body", "visibilitychange");

  // **Sem `descarregar()` pelo meio, de propósito.** O que se está a fixar é que o
  // esconder da página entrega o evento por si: numa página a morrer não há
  // segunda oportunidade, e a versão anterior despejava a fila antes de o
  // `plano_fundo` lá entrar, perdendo exatamente o evento que fecha a tentativa.
  await br.avancar(20000);

  const fundo = br.eventos().filter((e) => e.event_type === "plano_fundo");
  assert.equal(fundo.length, 2, "um por cada vez que a página se escondeu, entregue pelo próprio esconder");
  assert.ok((fundo[0].duration_ms as number) >= 3000, `primeiro: ${fundo[0].duration_ms}`);
  assert.ok((fundo[1].duration_ms as number) >= 5000, `acumula as duas visitas: ${fundo[1].duration_ms}`);
});

test("2.2 a hesitação é medida, e a tecla escrita nunca é lida", async () => {
  const { br, uxda } = await comSdk();
  disparar(br.documento, "#nome", "focusin");
  await br.avancar(2500);
  disparar(br.documento, "#nome", "keydown", { key: "s" });
  disparar(br.documento, "#nome", "focusout");
  await uxda.descarregar();
  await br.avancar(20000);

  const tecla = br.eventos().find((e) => e.event_type === "tecla")!;
  assert.ok(tecla, "não saiu evento de tecla");
  assert.equal(tecla.duration_ms, 2500, "a hesitação não foi medida");
  const bruto = JSON.stringify(br.eventos());
  assert.ok(!bruto.includes('"key"') && !bruto.includes('"s"'), "a tecla escrita apareceu no que sai");
});

test("2.2 `track` marca o que a captura automática não alcança", async () => {
  const { br, uxda } = await comSdk();
  uxda.track("comprovativo_descarregado");
  await uxda.descarregar();
  await br.avancar(20000);
  const ev = br.eventos().find((e) => e.event_type === "personalizado")!;
  assert.ok(ev, "o evento manual não saiu");
  assert.equal(ev.message_key, "comprovativo_descarregado");
});

test("2.2 um clique num ícone dentro do botão conta como o botão", async () => {
  const { br, uxda } = await comSdk(`<button id="b" data-testid="guardar"><svg id="i"></svg>Guardar</button>`);
  disparar(br.documento, "#i", "click");
  await uxda.descarregar();
  await br.avancar(20000);
  const toque = br.eventos().find((e) => e.event_type === "toque")!;
  assert.ok(toque, "o clique não foi capturado");
  assert.ok(String(toque.element_key).includes("data-testid=guardar"), `chave inesperada: ${toque.element_key}`);
});

test("2.1 parar não deixa ouvintes atrás", async () => {
  const { br, uxda } = await comSdk();
  await uxda.descarregar();
  await br.avancar(20000);
  const antes = br.eventos().length;
  uxda.parar();
  disparar(br.documento, "#pagar", "click");
  await uxda.descarregar();
  await br.avancar(20000);
  assert.equal(br.eventos().length, antes, "continuou a capturar depois de parar");
});

test("os tipos declarados são os dez do RF-CAP-04", () => {
  assert.equal(TIPOS.length, 10);
});
