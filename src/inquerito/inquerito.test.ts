/**
 * O componente de avaliação, com o SDK inteiro por cima de um browser de ensaio.
 * Cartões 14.1 e 14.2, RF-PER-01 a RF-PER-08.
 *
 * O que estes ensaios provam não é que as funções devolvem o que se espera: é que
 * **a configuração remota faz aparecer um inquérito numa página sem uma linha de
 * código da instituição**, que ele não aparece quando não deve (sorteio, fadiga,
 * servidor mudo, servidor que diz não), e que o que sai quando alguém responde é o
 * corpo do contrato, com o comentário mascarado.
 *
 * E as duas garantias que não são deste cartão mas que ele podia partir: a captura
 * não vê o componente, e uma avaria dentro dele não chega à aplicação anfitriã nem
 * para a captura.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { criarBrowser, disparar, memoria } from "../ensaio/duplo.ts";
import { errosInternos, limparErros } from "../safe.ts";
import { normalizar } from "../config/remoto.ts";
import { ligarInqueritos } from "./index.ts";
import { ateBytes, mascararComentario } from "./envio.ts";
import { AGRADECIMENTO_MS, FOLHA } from "./componente.ts";
import * as E from "../ensaio/inquerito.ts";

const LOJA = `
  <main>
    <h1>Pagar a encomenda</h1>
    <form id="f"><input id="nome" name="nome"><button id="pagar" type="submit">Pagar</button></form>
    <button id="outro" type="button">Ver encomendas</button>
    <div id="avisos"></div>
  </main>
`;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

/** A pessoa chega à confirmação: é o fim da tarefa da regra de ensaio. */
async function concluir(br: any): Promise<void> {
  br.janela.history.pushState({}, "", "/confirmacao");
  await br.avancar(10);
}

/* ------------------------------------------------------- os cinco formatos */

const OPCOES = [
  { chave: "demorou", pt: "Demorou muito", en: "It took too long" },
  { chave: "confuso", pt: "Foi confuso", en: "It was confusing" },
  { chave: "outro", pt: "Outro motivo", en: "Something else" },
];

const CASOS: Array<{
  nome: string;
  extra: Record<string, unknown>;
  entradas: { tipo: string; n: number } | null;
  fazer: (br: any) => void;
  nota?: number;
  escolhas: string[];
  comentario: string;
}> = [
  {
    nome: "esforco, de 1 a 7, com comentário", extra: { formato: "esforco" }, entradas: { tipo: "radio", n: 7 },
    fazer: (br) => { E.escolher(br, "6"); E.escrever(br, "o botão de continuar ficou escondido"); },
    nota: 6, escolhas: [], comentario: "o botão de continuar ficou escondido",
  },
  {
    nome: "satisfacao, de 1 a 5", extra: { formato: "satisfacao", comentario: false }, entradas: { tipo: "radio", n: 5 },
    fazer: (br) => E.escolher(br, "5"), nota: 5, escolhas: [], comentario: "",
  },
  {
    nome: "recomendacao, de 0 a 10", extra: { formato: "recomendacao", comentario: false }, entradas: { tipo: "radio", n: 11 },
    fazer: (br) => E.escolher(br, "0"), nota: 0, escolhas: [], comentario: "",
  },
  {
    nome: "escolha múltipla", extra: { formato: "escolha", multipla: true, comentario: false, opcoes: OPCOES },
    entradas: { tipo: "checkbox", n: 3 },
    fazer: (br) => { E.escolher(br, "demorou"); E.escolher(br, "confuso"); },
    escolhas: ["demorou", "confuso"], comentario: "",
  },
  {
    nome: "escolha única", extra: { formato: "escolha", multipla: false, comentario: true, opcoes: OPCOES },
    entradas: { tipo: "radio", n: 3 },
    fazer: (br) => { E.escolher(br, "demorou"); E.escolher(br, "outro"); },
    escolhas: ["outro"], comentario: "",
  },
  {
    nome: "livre", extra: { formato: "livre", comentario: false }, entradas: null,
    fazer: (br) => E.escrever(br, "faltou pagar por referência"),
    escolhas: [], comentario: "faltou pagar por referência",
  },
];

for (const caso of CASOS) {
  test(`14.1 o formato ${caso.nome} desenha-se e envia o corpo do contrato`, async () => {
    const { br, uxea } = await E.comSdk(LOJA, E.inqueritos([E.regra(caso.extra)]));
    await concluir(br);
    const raiz = E.raiz(br);
    assert.ok(raiz, "o componente não apareceu");

    const entradas = Array.from(raiz.querySelectorAll("input")) as any[];
    if (caso.entradas) {
      assert.equal(entradas.length, caso.entradas.n);
      assert.ok(entradas.every((i) => i.getAttribute("type") === caso.entradas!.tipo));
      // Cada opção tem rótulo visível: o `input` vive dentro de um `label` com texto.
      assert.ok(entradas.every((i) => i.parentElement.tagName === "LABEL" && i.parentElement.textContent.trim()));
    } else {
      assert.equal(entradas.length, 0);
      assert.equal(raiz.querySelector("textarea").hasAttribute("required"), true, "o livre exige texto");
    }

    caso.fazer(br);
    await E.enviarResposta(br);

    const eleg = E.pedidosDeElegibilidade(br);
    assert.equal(eleg.length, 1);
    assert.deepEqual(JSON.parse(eleg[0]!.corpo), {
      inquerito: "facilidade_do_pagamento", anonymous_id: uxea.diagnostico().identidade.anonimo, user_id: "",
    });
    assert.equal(eleg[0]!.cabecalhos["X-UXEA-Key"], "uxea_des_inqueritos");

    const enviadas = E.respostasEnviadas(br);
    assert.equal(enviadas.length, 1);
    const corpo = enviadas[0]!;
    assert.match(corpo.resposta_id, UUID);
    assert.equal(corpo.inquerito, "facilidade_do_pagamento");
    assert.equal(corpo.formato, caso.extra["formato"]);
    if (caso.nota === undefined) assert.equal("nota" in corpo, false, "a nota é proibida fora das escalas");
    else assert.equal(corpo.nota, caso.nota);
    assert.deepEqual(corpo.escolhas, caso.escolhas);
    assert.equal(corpo.comentario, caso.comentario);
    assert.match(corpo.ocorrida_em, ISO);
    assert.match(corpo.enviada_em, ISO);
    assert.equal(corpo.pedido_id, "pedido-7f3c");
    assert.equal(corpo.origem, "componente");
    assert.equal(corpo.contexto.tarefa, "pagar_uma_encomenda");
    assert.equal(corpo.contexto.funcionalidade, "");
    assert.equal(corpo.contexto.gatilho, "apos_conclusao");
    assert.equal(corpo.contexto.ecra, "/confirmacao");
    assert.equal(corpo.contexto.passo, "", "sem passo na regra, a resposta não inventa um: o passo do dispositivo não é uma chave da definição");
    assert.match(corpo.contexto.tentativa_inicio, ISO);
    assert.ok(corpo.contexto.tentativa_inicio <= corpo.ocorrida_em);
    assert.deepEqual(corpo.dispositivo, { platform: "web", app_version: "0.0.0", device_class: "computador" });
    assert.equal(corpo.anonymous_id, uxea.diagnostico().identidade.anonimo);
    assert.equal(corpo.user_id, "");
    assert.deepEqual(Object.keys(corpo).filter((k) => k !== "nota"), [
      "resposta_id", "inquerito", "formato", "escolhas", "comentario", "ocorrida_em", "enviada_em",
      "pedido_id", "origem", "contexto", "dispositivo", "anonymous_id", "user_id",
    ]);

    // O agradecimento substitui o corpo, e a caixa de texto sai com ele.
    assert.equal(E.raiz(br).querySelector(".fim")?.textContent, "Obrigado pela resposta.");
    assert.equal(E.raiz(br).querySelector("textarea"), null);
    await br.avancar(AGRADECIMENTO_MS + 10);
    assert.equal(E.hospedeiro(br), null, "o cartão fecha-se sozinho depois de agradecer");
    assert.equal(uxea.diagnostico().inqueritos.respostasEnviadas, 1);
  });
}

test("14.1 sem escolher nada, o envio diz o que falta e não sai nada", async () => {
  const { br } = await E.comSdk(LOJA, E.inqueritos([E.regra()]));
  await concluir(br);
  await E.enviarResposta(br);
  assert.equal(E.respostasEnviadas(br).length, 0);
  assert.equal(E.raiz(br).querySelector(".aviso").textContent, "Escolha um valor da escala.");
  assert.equal(E.raiz(br).querySelector(".aviso").getAttribute("role"), "status");
});

/* --------------------------------------------------------- tema e língua */

test("14.1 o tema e a língua vêm da configuração, sem uma linha de código", async () => {
  const tema = { cor_primaria: "#0a7c3e", cor_fundo: "#101418", cor_texto: "#f5f5f5", fonte: "Georgia, serif", cantos_px: 4, idioma: "en" };
  const { br } = await E.comSdk(LOJA, E.inqueritos([E.regra()], { tema }));
  await concluir(br);
  const raiz = E.raiz(br);
  const cartao = raiz.querySelector(".cartao");
  assert.equal(cartao.style.getPropertyValue("--uxea-primaria"), "#0a7c3e");
  assert.equal(cartao.style.getPropertyValue("--uxea-fundo"), "#101418");
  assert.equal(cartao.style.getPropertyValue("--uxea-texto"), "#f5f5f5");
  assert.equal(cartao.style.getPropertyValue("--uxea-fonte"), "Georgia, serif");
  assert.equal(cartao.style.getPropertyValue("--uxea-cantos"), "4px");
  // E a folha usa-as todas: um tema escrito numa propriedade que ninguém lê não
  // personaliza nada.
  const folha = String(raiz.querySelector("style")?.textContent ?? "");
  for (const p of ["--uxea-primaria", "--uxea-fundo", "--uxea-texto", "--uxea-fonte", "--uxea-cantos"]) {
    assert.ok(folha.includes(`var(${p})`), `a folha não usa ${p}`);
  }
  assert.equal(cartao.getAttribute("lang"), "en");
  assert.equal(raiz.querySelector(".pergunta").textContent, "Was it easy to pay for the order?");
  assert.equal(raiz.querySelector(".enviar").textContent, "Send");
  assert.equal(raiz.querySelector(".fechar").getAttribute("aria-label"), "Close");
  assert.deepEqual(Array.from(raiz.querySelectorAll(".extremos span")).map((s: any) => s.textContent), ["Very difficult", "Very easy"]);
  assert.equal(raiz.querySelector('input[value="1"]').getAttribute("aria-label"), "1 (very difficult)");
});

/* -------------------------------------------------------- não bloqueia */

test("14.1 o cartão não bloqueia: a página responde a tudo enquanto ele está aberto", async () => {
  const { br, uxea } = await E.comSdk(LOJA, E.inqueritos([E.regra()]));
  let cliques = 0;
  br.documento.querySelector("#outro").addEventListener("click", () => cliques++);
  await concluir(br);
  const raiz = E.raiz(br);
  const cartao = raiz.querySelector(".cartao");
  assert.equal(cartao.getAttribute("role"), "dialog");
  assert.equal(cartao.getAttribute("aria-modal"), "false");
  assert.ok(raiz.getElementById("uxea-pergunta"), "o diálogo tem nome, pela pergunta");

  // Nada por cima da página: o hospedeiro é a única coisa que entrou no corpo, a
  // página não ficou inerte nem escondida, e a folha não tem camada nenhuma.
  assert.equal(br.documento.body.lastElementChild, E.hospedeiro(br));
  assert.equal(br.documento.querySelectorAll("[inert], [aria-hidden]").length, 0);
  assert.ok(!/inset\s*:\s*0|100vh\s*;|height\s*:\s*100%/.test(FOLHA), "a folha tem uma camada por cima da página");
  assert.ok(/\.cartao\{position:fixed;right:16px;bottom:16px/.test(FOLHA), "o cartão não está no canto");

  const antes = uxea.diagnostico().eventosEmitidos;
  disparar(br.documento, "#outro", "click");
  disparar(br.documento, "#nome", "focusin");
  disparar(br.documento, "#nome", "focusout");
  assert.equal(cliques, 1, "o botão da página deixou de responder com o cartão aberto");
  assert.ok(uxea.diagnostico().eventosEmitidos > antes, "a captura parou com o cartão aberto");
  assert.ok(E.hospedeiro(br), "mexer na página não fecha o cartão");
});

test("14.1 fecha pelo botão e pelo Escape, e o Escape da página não é dele", async () => {
  const { br } = await E.comSdk(LOJA, E.inqueritos([E.regra({ formato: "livre" })]));
  await concluir(br);
  // Com o foco na página, a tecla é da página.
  disparar(br.documento, "#nome", "keydown", { key: "Escape" });
  assert.ok(E.hospedeiro(br), "um Escape na página fechou o cartão");
  E.despachar(E.raiz(br).querySelector("textarea"), "keydown", { key: "Escape" });
  assert.equal(E.hospedeiro(br), null, "o Escape dentro do cartão não o fechou");

  const outro = await E.comSdk(LOJA, E.inqueritos([E.regra()]));
  await concluir(outro.br);
  E.despachar(E.raiz(outro.br).querySelector(".fechar"), "click");
  assert.equal(E.hospedeiro(outro.br), null);
  assert.equal(E.respostasEnviadas(outro.br).length, 0, "fechar não é responder");
});

test("14.1 os alvos de toque têm 44 píxeis em ecrãs estreitos e de toque", () => {
  const regra = /@media \(max-width:480px\),\(pointer:coarse\)\{([^@]+)\}/.exec(FOLHA);
  assert.ok(regra, "sem a regra dos ecrãs estreitos");
  for (const alvo of [".ponto span", ".opcao span", ".fechar", ".enviar"]) {
    assert.ok(new RegExp(`${alvo.replace(".", "\\.")}\\{[^}]*44px`).test(regra[1]!), `${alvo} sem 44 píxeis`);
  }
});

/* ---------------------------------------------- o servidor manda na fadiga */

test("14.2 o servidor diz que não: não aparece, e a sessão não volta a perguntar", async () => {
  for (const motivo of ["limite_de_pedidos", "respondeu_recentemente"]) {
    const { br, uxea } = await E.comSdk(LOJA, E.inqueritos([E.regra({ gatilho: "apos_erro", criterios: [], inicio: [] })]),
      { elegibilidade: E.NAO(motivo) });
    uxea.erroTecnico("resposta_ilegivel");
    await br.avancar(10);
    assert.equal(E.hospedeiro(br), null, `${motivo}: apareceu na mesma`);
    assert.equal(uxea.diagnostico().inqueritos.ultimoMotivo, motivo);
    // Mais erros na mesma sessão: o dispositivo já sabe a resposta.
    for (let i = 0; i < 5; i++) {
      uxea.erroTecnico(`outro_erro_${i}`);
      await br.avancar(2000);
    }
    assert.equal(E.pedidosDeElegibilidade(br).length, 1, `${motivo}: perguntou outra vez ao servidor`);
  }
});

test("14.2 inativo: não aparece, e esse inquérito não se pergunta outra vez nesta página", async () => {
  const { br, uxea } = await E.comSdk(LOJA, E.inqueritos([E.regra({ gatilho: "apos_erro", criterios: [], inicio: [] })]),
    { elegibilidade: E.NAO("inativo") });
  uxea.erroTecnico("a");
  await br.avancar(2000);
  uxea.erroTecnico("b");
  await br.avancar(10);
  assert.equal(E.hospedeiro(br), null);
  assert.equal(E.pedidosDeElegibilidade(br).length, 1);
});

test("14.2 sem resposta do servidor não se mostra: rede em baixo, avaria, lixo, resposta a meio", async () => {
  const MUDOS: Array<[string, () => any]> = [
    ["a rede lança", () => { throw new Error("sem rede"); }],
    ["500", () => ({ estado: 500, corpo: "" })],
    ["estado 0", () => ({ estado: 0, corpo: "" })],
    ["lixo de um proxy", () => ({ estado: 200, corpo: "<html>erro</html>" })],
    ["sem sucesso", () => ({ estado: 200, corpo: JSON.stringify({ sucesso: false, dados: { mostrar: true, pedido_id: "p" } }) })],
    ["mostrar sem pedido", () => ({ estado: 200, corpo: JSON.stringify({ sucesso: true, dados: { mostrar: true, motivo: "pode" } }) })],
    ["mostrar em texto", () => ({ estado: 200, corpo: JSON.stringify({ sucesso: true, dados: { mostrar: "true", pedido_id: "p" } }) })],
  ];
  for (const [nome, elegibilidade] of MUDOS) {
    const { br, uxea } = await E.comSdk(LOJA, E.inqueritos([E.regra()]), { elegibilidade });
    await concluir(br);
    await br.avancar(3000);
    assert.equal(E.hospedeiro(br), null, `${nome}: apareceu sem licença do servidor`);
    assert.equal(E.pedidosDeElegibilidade(br).length, 1, `${nome}: não chegou a perguntar`);
    if (nome !== "mostrar sem pedido") assert.equal(uxea.diagnostico().inqueritos.ultimoMotivo, "sem_resposta", nome);
  }
});

/* -------------------------------------------------------------- sorteio */

test("14.2 a amostragem por omissão é 0,1, e a da regra é a que se usa", async () => {
  // Cinco mil arranques de sessão, com o gerador semeado: o número é sempre o
  // mesmo, e fica escrito. O servidor diz sempre que não, para contar os pedidos
  // sem desenhar nada.
  const contar = async (amostragem: unknown, sementeInicial: number): Promise<number> => {
    const regra = E.regra({ gatilho: "amostragem", criterios: [], inicio: [] });
    if (amostragem === undefined) delete regra["amostragem"];
    else regra["amostragem"] = amostragem;
    const cfg = normalizar({ inqueritos: { lista: [regra] } }).inqueritos;
    const aleatorio = E.semente(sementeInicial);
    const documento = { body: { attachShadow() { return null; } }, createElement() { return {}; }, querySelector: () => null };
    let pedidos = 0;
    const N = 5000;
    for (let i = 0; i < N; i++) {
      const ligacao = ligarInqueritos({
        janela: null, documento, armazenamento: memoria(), agora: () => Date.parse("2026-09-14T10:00:00Z"), aleatorio,
        enviar: async () => {
          pedidos++;
          return { estado: 200, corpo: JSON.stringify({ sucesso: true, dados: { mostrar: false, motivo: "limite_de_pedidos", pedido_id: "" } }) };
        },
        servidor: E.SERVIDOR, chave: "uxea_des_t", configuracao: () => cfg,
        identidade: () => ({ anonimo: `anonimo-${i}`, utilizador: null, sessao: `sessao-${i}` }),
        dispositivo: () => ({ platform: "web" }), ecra: () => "/",
      });
      ligacao.arrancar();
    }
    await new Promise((r) => setImmediate(r));
    return pedidos / N;
  };
  const porOmissao = await contar(undefined, 20260914);
  assert.ok(porOmissao > 0.088 && porOmissao < 0.112, `esperava perto de 0,10 e deu ${porOmissao.toFixed(4)}`);
  const metade = await contar(0.5, 7);
  assert.ok(metade > 0.48 && metade < 0.52, `esperava perto de 0,50 e deu ${metade.toFixed(4)}`);
  assert.equal(await contar(0, 3), 0, "amostragem zero perguntou a alguém");
  console.log(`  14.2 sorteio: por omissão ${porOmissao.toFixed(4)} em 5000 sessões, com 0,5 deu ${metade.toFixed(4)}`);
});

test("14.2 fora do sorteio não se pergunta nada ao servidor", async () => {
  const { br, uxea } = await E.comSdk(LOJA, E.inqueritos([E.regra({ amostragem: 0.3 })]), { aleatorio: () => 0.31 });
  await concluir(br);
  assert.equal(E.pedidosDeElegibilidade(br).length, 0);
  assert.equal(uxea.diagnostico().inqueritos.ultimoMotivo, "fora_da_amostra");
});

/* ------------------------------------------------------ fadiga local */

test("14.2 fadiga local: quem já foi questionado não chega a perguntar ao servidor na sessão seguinte", async () => {
  const config = E.inqueritos([E.regra({ gatilho: "amostragem", criterios: [], inicio: [] })]);
  const s1 = await E.comSdk(LOJA, config, { caminho: "/" });
  assert.ok(E.hospedeiro(s1.br), "a primeira sessão devia ter perguntado");
  E.escolher(s1.br, "7");
  await E.enviarResposta(s1.br);
  await s1.br.avancar(AGRADECIMENTO_MS + 10);

  const s2 = await E.sessaoSeguinte(s1.br, LOJA, config);
  assert.equal(E.pedidosDeElegibilidade(s2.br).length, 0, "perguntou ao servidor o que o dispositivo já sabia");
  assert.equal(E.hospedeiro(s2.br), null);
  assert.equal(s2.uxea.diagnostico().inqueritos.ultimoMotivo, "limite_de_pedidos");

  // Com um limite largo, o que trava é ter respondido há pouco.
  const largo = E.inqueritos([E.regra({ gatilho: "amostragem", criterios: [], inicio: [] })], { fadiga: { max_pedidos: 10, periodo_dias: 30, excluir_respondeu_dias: 90 } });
  const s3 = await E.sessaoSeguinte(s2.br, LOJA, largo);
  assert.equal(E.pedidosDeElegibilidade(s3.br).length, 0);
  assert.equal(s3.uxea.diagnostico().inqueritos.ultimoMotivo, "respondeu_recentemente");
});

test("14.2 nunca dois ao mesmo tempo, e nunca mais do que um por sessão", async () => {
  const duas = E.inqueritos([
    E.regra({ chave: "a", gatilho: "apos_erro", criterios: [], inicio: [] }),
    E.regra({ chave: "b", gatilho: "apos_erro", criterios: [], inicio: [] }),
  ], { fadiga: { max_pedidos: 10, periodo_dias: 30, excluir_respondeu_dias: 0 } });
  const { br, uxea } = await E.comSdk(LOJA, duas);
  uxea.erroTecnico("resposta_ilegivel");
  await br.avancar(10);
  assert.equal(br.documento.querySelectorAll("uxea-inquerito").length, 1);
  assert.equal(E.pedidosDeElegibilidade(br).length, 1, "o segundo inquérito do mesmo evento perguntou na mesma");
  E.despachar(E.raiz(br).querySelector(".fechar"), "click");
  uxea.erroTecnico("outro_erro");
  await br.avancar(10);
  assert.equal(E.hospedeiro(br), null);
  assert.equal(E.pedidosDeElegibilidade(br).length, 1);
  assert.equal(uxea.diagnostico().inqueritos.ultimoMotivo, "ja_mostrado_nesta_sessao");
});

/* ---------------------------------------------- os gatilhos, de ponta a ponta */

test("14.2 apos_abandono: começou a pagar, foi embora, e é perguntado ao voltar", async () => {
  const config = E.inqueritos([E.regra({ gatilho: "apos_abandono", formato: "satisfacao", comentario: false })]);
  const s1 = await E.comSdk(LOJA, config, { caminho: "/pagamento" });
  await s1.br.avancar(500);
  assert.equal(E.pedidosDeElegibilidade(s1.br).length, 0, "perguntou antes de haver abandono");
  (s1.br.documento as any).visibilityState = "hidden";
  disparar(s1.br.documento, "body", "visibilitychange");

  const s2 = await E.sessaoSeguinte(s1.br, LOJA, config, { caminho: "/" });
  assert.ok(E.hospedeiro(s2.br), "a sessão seguinte não perguntou pelo abandono");
  E.escolher(s2.br, "2");
  await E.enviarResposta(s2.br);
  const corpo = E.respostasEnviadas(s2.br)[0]!;
  assert.equal(corpo.contexto.gatilho, "apos_abandono");
  assert.equal(corpo.contexto.ecra, "/pagamento", "o ecrã da tentativa abandonada, e não o de agora");
  assert.equal(corpo.contexto.tentativa_inicio.slice(0, 16), new Date(s1.br.agora()).toISOString().slice(0, 16));

  // E numa terceira sessão já não pergunta: o abandono foi perguntado uma vez.
  await s2.br.avancar(AGRADECIMENTO_MS + 10);
  const s3 = await E.sessaoSeguinte(s2.br, LOJA, E.inqueritos([E.regra({ gatilho: "apos_abandono" })], { fadiga: { max_pedidos: 10, periodo_dias: 30, excluir_respondeu_dias: 0 } }));
  assert.equal(E.pedidosDeElegibilidade(s3.br).length, 0);
});

test("14.2 apos_abandono: com mais de 24 horas pelo meio, esquece-se", async () => {
  const config = E.inqueritos([E.regra({ gatilho: "apos_abandono" })]);
  const s1 = await E.comSdk(LOJA, config, { caminho: "/pagamento" });
  await s1.br.avancar(500);
  const s2 = await E.sessaoSeguinte(s1.br, LOJA, config, { caminho: "/", depoisMs: 25 * 60 * 60 * 1000 });
  assert.equal(E.pedidosDeElegibilidade(s2.br).length, 0);
  assert.equal(E.hospedeiro(s2.br), null);
});

test("14.2 apos_erro: uma mensagem de erro na página dispara, sem instrumentação", async () => {
  const { br, uxea } = await E.comSdk(LOJA, E.inqueritos([E.regra({ gatilho: "apos_erro", criterios: [], inicio: [] })]), { caminho: "/checkout" });
  const aviso = br.documento.createElement("div");
  aviso.setAttribute("role", "alert");
  aviso.setAttribute("class", "erro");
  aviso.textContent = "O pagamento foi recusado";
  br.documento.querySelector("#avisos").appendChild(aviso);
  await br.avancar(10);
  assert.ok(E.hospedeiro(br));
  assert.equal(uxea.diagnostico().inqueritos.ultimoGatilho, "apos_erro:facilidade_do_pagamento");
});

test("14.2 primeira_utilizacao: a primeira vez neste dispositivo, e só essa", async () => {
  const config = E.inqueritos([E.regra({
    chave: "primeira_exportacao", gatilho: "primeira_utilizacao", inicio: [],
    criterios: [{ condicoes: [{ campo: "event_type", operador: "igual", valor: "toque" }, { campo: "element_key", operador: "existe" }] }],
  })], { fadiga: { max_pedidos: 10, periodo_dias: 30, excluir_respondeu_dias: 0 } });
  const s1 = await E.comSdk(LOJA, config, { caminho: "/" });
  assert.equal(E.hospedeiro(s1.br), null, "apareceu antes de a funcionalidade ser usada");
  disparar(s1.br.documento, "#outro", "click");
  await s1.br.avancar(10);
  assert.ok(E.hospedeiro(s1.br), "a primeira utilização não perguntou");
  E.despachar(E.raiz(s1.br).querySelector(".fechar"), "click");
  await s1.br.avancar(500);

  const s2 = await E.sessaoSeguinte(s1.br, LOJA, config);
  disparar(s2.br.documento, "#outro", "click");
  await s2.br.avancar(10);
  assert.equal(E.pedidosDeElegibilidade(s2.br).length, 0, "a segunda utilização foi tratada como primeira");
  assert.equal(s2.uxea.diagnostico().inqueritos.ultimoGatilho, "");
});

test("14.2 amostragem: no arranque da sessão, e um recarregamento não sorteia outra vez", async () => {
  const config = E.inqueritos([E.regra({ gatilho: "amostragem", criterios: [], inicio: [] })], { fadiga: { max_pedidos: 10, periodo_dias: 30, excluir_respondeu_dias: 0 } });
  const s1 = await E.comSdk(LOJA, config, { caminho: "/inicio" });
  assert.ok(E.hospedeiro(s1.br));
  E.despachar(E.raiz(s1.br).querySelector(".fechar"), "click");
  await s1.br.avancar(500);
  // A mesma sessão, outra página.
  const recarregada = await E.sessaoSeguinte(s1.br, LOJA, config, { depoisMs: 60_000 });
  assert.equal(recarregada.uxea.diagnostico().inqueritos.ultimoGatilho, "", "um recarregamento sorteou outra vez");
  assert.equal(E.pedidosDeElegibilidade(recarregada.br).length, 0);
});

/* ------------------------------------------------- uxea.inquerito(chave) */

test("14.2 uxea.inquerito salta o sorteio, e não salta o servidor nem a fadiga", async () => {
  const config = E.inqueritos([E.regra({ gatilho: "amostragem", criterios: [], inicio: [], amostragem: 0, atraso_ms: 1500 })]);
  // O sorteio diz sempre que não, e a amostragem da regra é zero.
  const { br, uxea } = await E.comSdk(LOJA, config, { aleatorio: () => 0.999, caminho: "/" });
  assert.equal(E.hospedeiro(br), null);
  assert.equal(await uxea.inquerito("nao_existe"), false);
  assert.equal(uxea.diagnostico().inqueritos.ultimoMotivo, "inquerito_desconhecido");

  const pedido = uxea.inquerito("facilidade_do_pagamento");
  await br.avancar(1000);
  assert.equal(E.hospedeiro(br), null, "o atraso da regra não foi respeitado");
  await br.avancar(600);
  assert.equal(await pedido, true);
  assert.ok(E.hospedeiro(br));
  E.escolher(br, "4");
  await E.enviarResposta(br);
  assert.equal(E.respostasEnviadas(br)[0]!.contexto.gatilho, "manual");
  await br.avancar(AGRADECIMENTO_MS + 10);

  // A fadiga vale: um por sessão.
  assert.equal(await uxea.inquerito("facilidade_do_pagamento"), false);
  assert.equal(E.pedidosDeElegibilidade(br).length, 1);

  // E o servidor vale: com um não, não aparece.
  const outro = await E.comSdk(LOJA, config, { aleatorio: () => 0.999, elegibilidade: E.NAO("respondeu_recentemente") });
  assert.equal(await outro.uxea.inquerito("facilidade_do_pagamento"), false);
  assert.equal(E.hospedeiro(outro.br), null);
});

test("14.2 uxea.inquerito chamado antes de a configuração chegar espera por ela", async () => {
  const br = criarBrowser(LOJA, { caminho: "/" });
  E.servir(br, E.inqueritos([E.regra({ atraso_ms: 0 })]));
  const { iniciar } = await import("../index.ts");
  const uxea = iniciar({ chave: "uxea_des_t", servidor: E.SERVIDOR, ambiente: { ...br.ambiente(), aleatorio: () => 0.9 } });
  const pedido = uxea.inquerito("facilidade_do_pagamento");
  await br.avancar(10);
  assert.equal(await pedido, true);
});

/* ------------------------------------------------ anonimato e mascaramento */

test("14.1 o comentário sai mascarado: nem correio, nem algarismos, nem nomes", async () => {
  const { br } = await E.comSdk(LOJA, E.inqueritos([E.regra()]));
  await concluir(br);
  E.escolher(br, "2");
  E.escrever(br, "Liguem para 923000111 ou para ana.silva@exemplo.ao, cartão 4111 1111 1111 1111, ref a12345, Ana Maria da Silva");
  await E.enviarResposta(br);
  const { comentario } = E.respostasEnviadas(br)[0]!;
  assert.ok(!/\d/.test(comentario), `saiu um algarismo: ${comentario}`);
  assert.ok(!comentario.includes("@"), `saiu um arroba: ${comentario}`);
  assert.ok(!comentario.includes("Ana Maria"), `saiu um nome: ${comentario}`);
  assert.ok(comentario.includes("{email}") && comentario.includes("{numero}"));
  assert.equal(E.raiz(br).querySelector(".fim").textContent, "Obrigado pela resposta.");
});

test("14.1 a máscara do comentário: o chão por cima da das mensagens, e o corte depois", () => {
  // Os dois que passavam pelo `mascarar`, por não terem fronteira de palavra nem
  // ponto depois do arroba, e que o servidor recusava.
  assert.equal(mascararComentario("a12345 e ana@exemplo sem ponto"), "a{numero} e {email} sem ponto");
  assert.ok(!/\d/.test(mascararComentario("nº12345, 1.234,56 Kz, 07/09/2026 às 14:30")));
  const longo = mascararComentario("9".repeat(3000));
  assert.ok(longo.length <= 500);
  assert.ok(!/\d/.test(longo));
  assert.equal(mascararComentario("x".repeat(900)).length, 500);
});

test("14.1 o contexto corta-se em bytes, como a ingestão o mede, e sem partir um carácter", () => {
  const ecra = "/confirmação".repeat(40);
  const cortado = ateBytes(ecra, 256);
  assert.ok(new TextEncoder().encode(cortado).length <= 256);
  assert.ok(ecra.startsWith(cortado));
  assert.ok(!cortado.endsWith("�"));
  assert.equal(ateBytes("/curto", 256), "/curto");
});

test("14.1 a resposta é anónima por omissão: o pseudónimo vai, e só para a fadiga", async () => {
  const { br, uxea } = await E.comSdk(LOJA, E.inqueritos([E.regra()]));
  await uxea.identificar("ana.silva@exemplo.ao");
  await concluir(br);
  E.escolher(br, "5");
  await E.enviarResposta(br);
  const corpo = E.respostasEnviadas(br)[0]!;
  assert.match(corpo.user_id, /^px_[0-9a-f]{40}$/, "o identificador direto saiu por inteiro");
  assert.ok(!JSON.stringify(br.pedidos).includes("ana.silva@exemplo.ao"));
});

/* ---------------------------------------------------------------- entrega */

test("14.1 uma falha de rede tenta outra vez, uma vez, com a mesma resposta_id", async () => {
  let vezes = 0;
  const { br } = await E.comSdk(LOJA, E.inqueritos([E.regra()]), {
    respostas: () => { vezes++; if (vezes === 1) throw new Error("sem rede"); return E.ACEITE(); },
  });
  await concluir(br);
  E.escolher(br, "3");
  E.despachar(E.raiz(br).querySelector(".enviar"), "click");
  await br.avancar(1100);
  const enviadas = br.pedidos.filter((p) => p.url.endsWith("/v1/respostas")).map((p) => JSON.parse(p.corpo));
  assert.equal(enviadas.length, 2);
  assert.equal(enviadas[0].resposta_id, enviadas[1].resposta_id, "a repetição é a mesma resposta");
  assert.notEqual(enviadas[0].enviada_em, enviadas[1].enviada_em, "o enviada_em é o de cada tentativa");
  assert.equal(E.raiz(br).querySelector(".fim").textContent, "Obrigado pela resposta.");

  // Uma recusa não se repete, e diz-se.
  const recusa = await E.comSdk(LOJA, E.inqueritos([E.regra()]), {
    respostas: () => ({ estado: 400, corpo: JSON.stringify({ sucesso: false, erro: "comentario_com_conteudo" }) }),
  });
  await concluir(recusa.br);
  E.escolher(recusa.br, "3");
  E.despachar(E.raiz(recusa.br).querySelector(".enviar"), "click");
  await recusa.br.avancar(1100);
  assert.equal(E.respostasEnviadas(recusa.br).length, 1);
  assert.equal(E.raiz(recusa.br).querySelector(".fim").textContent, "Não foi possível enviar a resposta.");

  // E duas falhas de rede ficam por duas.
  const mudo = await E.comSdk(LOJA, E.inqueritos([E.regra()]), { respostas: () => { throw new Error("sem rede"); } });
  await concluir(mudo.br);
  E.escolher(mudo.br, "3");
  E.despachar(E.raiz(mudo.br).querySelector(".enviar"), "click");
  await mudo.br.avancar(5000);
  assert.equal(mudo.br.pedidos.filter((p) => p.url.endsWith("/v1/respostas")).length, 2);
  assert.equal(mudo.uxea.diagnostico().inqueritos.ultimoMotivo, "resposta_falhou");
});

/* ----------------------------------------------------- a captura não o vê */

test("14.1 a captura não vê o componente: nem toques, nem campo, nem teclas", async () => {
  // No nível detalhado e com o rastreio individual, que é quando a captura emite
  // mais, e por isso quando há mais caminhos por onde o componente podia entrar.
  const { br, uxea } = await E.comSdk(LOJA, E.inqueritos([E.regra()]), { nivel: "detalhado", rastreioIndividual: true });
  await concluir(br);
  await br.avancar(2000);
  const host = E.hospedeiro(br);
  assert.ok(host);

  // O que a captura recebe num browser a sério quando alguém usa o componente: os
  // eventos compostos sobem com o alvo trocado pelo hospedeiro, e o
  // `elementFromPoint` devolve o hospedeiro. O duplo não redireciona, e por isso
  // despacha-se no hospedeiro diretamente.
  br.documento.elementFromPoint = () => host;
  const usar = () => {
    for (const [tipo, extras] of [
      ["pointerdown", { clientX: 320, clientY: 700 }], ["click", {}], ["focusin", {}],
      ["keydown", { key: "a" }], ["input", { inputType: "insertText" }], ["focusout", {}],
    ] as Array<[string, Record<string, unknown>]>) {
      disparar(br.documento, "uxea-inquerito", tipo, extras);
    }
  };
  const antes = uxea.diagnostico().eventosEmitidos;
  usar();
  // E o uso a sério, lá dentro.
  E.escolher(br, "5");
  E.escrever(br, "tudo bem");
  await br.avancar(3000);
  assert.equal(uxea.diagnostico().eventosEmitidos, antes, "a captura mediu o componente de avaliação");

  // A prova de que o ensaio falharia: sem a marca, os mesmos eventos saem.
  host.removeAttribute("data-uxea-ignorar");
  usar();
  await br.avancar(3000);
  assert.ok(uxea.diagnostico().eventosEmitidos > antes, "sem a marca, a captura também não via nada: o ensaio não provava");
});

test("14.1 a marca vale para o que está debaixo dela: campos, mensagens e toques", async () => {
  const pagina = `
    <div data-uxea-ignorar><input id="dentro"><button id="botao-dentro">ok</button><div id="avisos-dentro"></div></div>
    <input id="fora"><div id="avisos-fora"></div>
  `;
  const { br, uxea } = await E.comSdk(pagina, E.inqueritos([]), { nivel: "detalhado" });
  const aviso = (onde: string) => {
    const el = br.documento.createElement("div");
    el.setAttribute("role", "alert");
    el.textContent = "Erro no pagamento";
    br.documento.querySelector(onde).appendChild(el);
  };
  const antes = uxea.diagnostico().eventosEmitidos;
  for (const t of ["focusin", "input", "focusout"]) disparar(br.documento, "#dentro", t, { inputType: "insertText" });
  disparar(br.documento, "#botao-dentro", "click");
  aviso("#avisos-dentro");
  await br.avancar(3000);
  assert.equal(uxea.diagnostico().eventosEmitidos, antes);

  for (const t of ["focusin", "input", "focusout"]) disparar(br.documento, "#fora", t, { inputType: "insertText" });
  aviso("#avisos-fora");
  await br.avancar(3000);
  await uxea.descarregar();
  const tipos = br.eventos().map((e: any) => e.event_type);
  assert.ok(tipos.includes("campo") && tipos.includes("mensagem"), `fora da marca a captura devia ver: ${tipos.join(", ")}`);
});

/* -------------------------------------------------- avarias provocadas */

test("14.1 um desenho que rebenta não chega à anfitriã nem para a captura", async () => {
  limparErros();
  const { br, uxea } = await E.comSdk(LOJA, E.inqueritos([E.regra()]));
  let cliques = 0;
  br.documento.querySelector("#outro").addEventListener("click", () => cliques++);
  const original = br.documento.createElement.bind(br.documento);
  br.documento.createElement = (etiqueta: string) => {
    if (etiqueta === "uxea-inquerito") throw new Error("desenho partido");
    return original(etiqueta);
  };

  let escapou: unknown = null;
  try {
    await concluir(br);
    await br.avancar(100);
  } catch (e) {
    escapou = e;
  }
  assert.equal(escapou, null, "a avaria do componente chegou à anfitriã");
  assert.equal(E.hospedeiro(br), null);
  assert.ok(errosInternos().some((r) => r.onde.startsWith("inquerito.")), "a avaria não ficou registada por dentro");

  const antes = uxea.diagnostico().eventosEmitidos;
  disparar(br.documento, "#outro", "click");
  assert.equal(cliques, 1, "a anfitriã deixou de responder");
  assert.ok(uxea.diagnostico().eventosEmitidos > antes, "a captura parou depois da avaria");
  assert.equal(typeof uxea.diagnostico().inqueritos.regras, "number");
});

test("14.1 um sorteio que lança, um armazenamento hostil e uma configuração absurda não partem nada", async () => {
  limparErros();
  const br = criarBrowser(LOJA, { caminho: "/pagamento" });
  E.servir(br, { lista: [E.regra(), { chave: {}, formato: 7 }, "lixo"], tema: 5, fadiga: "x" });
  br.loja.setItem("uxea.inqueritos", "{{{ não é json");
  const uxea = await E.arrancar(br, () => { throw new Error("gerador partido"); });
  let escapou: unknown = null;
  try {
    await concluir(br);
    await uxea.inquerito(null as any);
    await uxea.inquerito({} as any);
    await br.avancar(100);
  } catch (e) {
    escapou = e;
  }
  assert.equal(escapou, null);
  assert.equal(uxea.diagnostico().inqueritos.regras, 1, "a regra boa não sobreviveu à má");
  assert.ok(errosInternos().some((r) => r.onde === "inquerito.tentar"));
  const antes = uxea.diagnostico().eventosEmitidos;
  disparar(br.documento, "#outro", "click");
  assert.ok(uxea.diagnostico().eventosEmitidos > antes);
  uxea.parar();
  assert.equal(E.hospedeiro(br), null);
});

test("14.1 parar desliga os inquéritos: o que estava à espera não aparece", async () => {
  const { br, uxea } = await E.comSdk(LOJA, E.inqueritos([E.regra({ atraso_ms: 5000 })]));
  await concluir(br);
  uxea.parar();
  await br.avancar(6000);
  assert.equal(E.hospedeiro(br), null);

  const aberto = await E.comSdk(LOJA, E.inqueritos([E.regra()]));
  await concluir(aberto.br);
  assert.ok(E.hospedeiro(aberto.br));
  aberto.uxea.parar();
  assert.equal(E.hospedeiro(aberto.br), null, "parar deixou o cartão na página");
});

test("14.1 o diagnóstico diz quantas regras, o último gatilho e o último motivo", async () => {
  const { br, uxea } = await E.comSdk(LOJA, E.inqueritos([E.regra(), E.regra({ chave: "outra" })]));
  assert.deepEqual(uxea.diagnostico().inqueritos, { regras: 2, ultimoGatilho: "", ultimoMotivo: "", aVista: false, respostasEnviadas: 0 });
  await concluir(br);
  const d = uxea.diagnostico().inqueritos;
  assert.equal(d.ultimoGatilho, "apos_conclusao:facilidade_do_pagamento");
  assert.equal(d.ultimoMotivo, "pode");
  assert.equal(d.aVista, true);
});

test("14.1 sem inquéritos, o armazenamento nem se toca", async () => {
  const { br } = await E.comSdk(LOJA, E.inqueritos([]));
  await concluir(br);
  await br.avancar(1000);
  assert.equal(br.loja.getItem("uxea.inqueritos"), null);
  assert.equal(E.pedidosDeElegibilidade(br).length, 0);
});
