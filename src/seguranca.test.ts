/**
 * Injeção sistemática de falhas. Cartão 2.7, RNF-SDK-01.
 *
 * O RNF-SDK-01 é o único requisito do documento escrito com a frase **"sem
 * exceções"**: qualquer erro interno é capturado e silenciado. Um SDK que parte
 * a aplicação do cliente é desinstalado no mesmo dia e nunca mais volta.
 *
 * A forma destes ensaios é sempre a mesma: partir uma peça de propósito, correr
 * o SDK por cima da peça partida, e exigir que **a aplicação anfitriã continue a
 * funcionar**. Um `assert.doesNotThrow` não chega: verifica-se também que a
 * anfitriã manteve o comportamento dela, e que o SDK registou o problema por
 * dentro em vez de o esconder.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { criarBrowser, memoria, disparar } from "./ensaio/duplo.ts";
import { iniciar } from "./index.ts";
import { limparErros, errosInternos } from "./safe.ts";

/** Cada linha é um ponto de entrada, e uma forma de o partir. */
const AVARIAS: Array<{ nome: string; partir: (br: any) => void }> = [
  {
    nome: "o browser recusa ouvintes",
    partir: (br) => {
      br.janela.addEventListener = () => { throw new Error("CSP"); };
      br.documento.addEventListener = () => { throw new Error("CSP"); };
    },
  },
  {
    nome: "o armazenamento local lança em tudo",
    partir: (br) => {
      br.janela.localStorage = {
        getItem() { throw new Error("negado"); },
        setItem() { throw new Error("negado"); },
        removeItem() { throw new Error("negado"); },
      };
    },
  },
  {
    nome: "o armazenamento devolve lixo",
    partir: (br) => {
      br.loja.setItem("uxea.fila", "isto não é json");
      br.loja.setItem("uxea.config", "{{{");
      br.loja.setItem("uxea.sessao", "[]");
    },
  },
  {
    nome: "o histórico está bloqueado",
    partir: (br) => {
      br.janela.history = {
        get state() { throw new Error("bloqueado"); },
        pushState() { throw new Error("bloqueado"); },
        replaceState() { throw new Error("bloqueado"); },
      };
    },
  },
  {
    nome: "não há `performance` nem `crypto`",
    partir: (br) => {
      br.janela.performance = undefined;
      (globalThis as any).__cripto = (globalThis as any).crypto;
    },
  },
  {
    nome: "o servidor responde lixo",
    partir: (br) => br.responder(() => ({ estado: 200, corpo: "<html>erro do proxy</html>" })),
  },
  {
    nome: "o servidor devolve 500 sempre",
    partir: (br) => br.responder(() => ({ estado: 500, corpo: "" })),
  },
  {
    nome: "a rede lança em vez de responder",
    partir: (br) => br.responder(() => { throw new Error("ligação recusada"); }),
  },
  {
    nome: "o `Worker` explode ao ser criado",
    partir: (br) => {
      br.janela.Blob = function () { throw new Error("sem blob"); } as any;
      br.janela.Worker = function () { throw new Error("sem worker"); } as any;
    },
  },
  {
    nome: "um elemento mente sobre si próprio",
    partir: (br) => {
      const el = br.documento.querySelector("#b");
      Object.defineProperty(el, "tagName", { get() { throw new Error("elemento partido"); } });
    },
  },
];

for (const avaria of AVARIAS) {
  test(`2.7 a anfitriã sobrevive: ${avaria.nome}`, async () => {
    limparErros();
    const br = criarBrowser(`<button id="b">ok</button><form id="f"><input id="i"></form>`);
    avaria.partir(br);

    // Tudo o que se segue é a aplicação anfitriã a viver a vida dela.
    let anfitriaViva = true;
    try {
      const uxea = iniciar({ chave: "uxea_des_t", servidor: "https://ingest.local", ambiente: br.ambiente() });
      await br.avancar(10);
      disparar(br.documento, "#b", "click");
      disparar(br.documento, "#i", "focusin");
      disparar(br.documento, "#i", "keydown", { key: "a" });
      disparar(br.documento, "#i", "focusout");
      disparar(br.documento, "#f", "submit");
      uxea.track("passo", { segmento: "ensaio" });
      uxea.ecra("/outro");
      await uxea.identificar("cliente-1");
      await uxea.descarregar();
      await br.avancar(120000);
      // O diagnóstico responde mesmo com o SDK meio partido: é por ele que se
      // descobre o que se passou, e ele próprio não pode ser um sítio que falha.
      assert.equal(typeof uxea.diagnostico().versao, "string");
      uxea.parar();
    } catch (e) {
      anfitriaViva = false;
      assert.fail(`o SDK deixou escapar um erro para a anfitriã: ${e}`);
    }
    assert.ok(anfitriaViva);
  });
}

test("2.7 o `fetch` da anfitriã continua a devolver o que devolvia", async () => {
  const br = criarBrowser(`<p>x</p>`);
  const respostaOriginal = { status: 200, texto: "conteúdo do cliente" };
  br.janela.fetch = async () => respostaOriginal;
  iniciar({ chave: "uxea_des_t", servidor: "https://ingest.local", ambiente: br.ambiente() });
  await br.avancar(10);
  const r = await br.janela.fetch("/api/pedidos");
  assert.equal(r, respostaOriginal, "o SDK trocou a resposta da aplicação");
});

test("2.7 um erro do `fetch` da anfitriã chega à anfitriã tal e qual", async () => {
  const br = criarBrowser(`<p>x</p>`);
  const erroOriginal = new Error("500 do backend do cliente");
  br.janela.fetch = async () => { throw erroOriginal; };
  iniciar({ chave: "uxea_des_t", servidor: "https://ingest.local", ambiente: br.ambiente() });
  await br.avancar(10);
  await assert.rejects(() => br.janela.fetch("/api/x"), (e: unknown) => e === erroOriginal);
});

test("2.7 argumentos absurdos na API pública não passam disso", async () => {
  const br = criarBrowser(`<p>x</p>`);
  const uxea = iniciar({ chave: "uxea_des_t", servidor: "https://ingest.local", ambiente: br.ambiente() });
  await br.avancar(10);
  const circular: any = {}; circular.eu = circular;
  uxea.track(circular);
  uxea.track(null as any, circular);
  uxea.ecra(undefined as any);
  uxea.passo(circular);
  uxea.terminal("inventado" as any);
  uxea.mensagem(circular, null as any, circular);
  uxea.mensagem("", "erro");
  uxea.erroTecnico(null as any, circular);
  await uxea.identificar(12345 as any);
  await uxea.descarregar();
  await br.avancar(60000);
  assert.equal(typeof uxea.diagnostico().eventosEmitidos, "number");
});

test("2.7 o registo interno guarda o que aconteceu, e não cresce sem limite", async () => {
  limparErros();
  const br = criarBrowser(`<button id="b">ok</button>`);
  const el = br.documento.querySelector("#b");
  Object.defineProperty(el, "tagName", { get() { throw new Error("partido"); } });
  const uxea = iniciar({ chave: "uxea_des_t", servidor: "https://ingest.local", ambiente: br.ambiente() });
  await br.avancar(10);
  for (let i = 0; i < 200; i++) disparar(br.documento, "#b", "click");
  await br.avancar(60000);
  const n = errosInternos().length;
  assert.ok(n > 0, "não registou nada, e alguma coisa partiu");
  assert.ok(n <= 50, `o registo interno cresceu até ${n}`);
  assert.equal(typeof uxea.diagnostico().errosInternos, "number");
});
