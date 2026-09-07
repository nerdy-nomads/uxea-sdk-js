import { test } from "node:test";
import assert from "node:assert/strict";
import { parseHTML } from "linkedom";
import { preparar, resumo, mascarar } from "./mask.ts";
import { acionavel, chave, sinais, sinalTestId, sinalCaminho, textoVisivel, type ElementoLike } from "./element.ts";
import { reconciliar, taxa, pontuar } from "./reconcile.ts";

const dom = (html: string) => parseHTML(`<!doctype html><html><body>${html}</body></html>`).document;
const q = (html: string, sel: string) => dom(html).querySelector(sel) as unknown as ElementoLike;
const todos = (html: string) =>
  Array.from(dom(html).querySelectorAll("*")).map((e) => e as unknown as ElementoLike).filter(acionavel);

/* ------------------------------------------------------------- mascaramento */

test("mascara montantes, datas, horas e correio", () => {
  assert.equal(preparar("Pagar 12.400,00 Kz"), "pagar {numero} kz");
  assert.equal(preparar("Pagar 300 Kz"), "pagar {numero} kz");
  assert.equal(preparar("Desconto de 15%"), "desconto de {numero}%");
  assert.equal(preparar("Fatura de 2026-09-07"), "fatura de {data}");
  assert.equal(preparar("Sessão às 14:30"), "sessao as {hora}");
  assert.equal(preparar("Enviar para ana@exemplo.ao"), "enviar para {email}");
  assert.equal(preparar("Conta AO06000600000100037131174"), "conta {id}");
});

test("duas variantes da mesma mensagem dão o mesmo resumo", () => {
  assert.equal(resumo(preparar("O saldo de 12.400 Kz é insuficiente")),
               resumo(preparar("O saldo de 300 Kz é insuficiente")));
});

test("o resumo é estável e não é reversível para o texto", () => {
  assert.equal(resumo("iniciar sessao"), resumo("iniciar sessao"));
  assert.notEqual(resumo("iniciar sessao"), resumo("terminar sessao"));
  assert.match(resumo("qualquer"), /^[0-9a-f]{8}$/);
});

test("mascarar não deixa passar dígitos", () => {
  const m = mascarar("ref 998877 no valor de 45,10 em 01/02/2026 às 9:05");
  assert.ok(!/\d/.test(m), `ficaram dígitos: ${m}`);
});

/* -------------------------------------------------------------- acionáveis */

test("reconhece o que recebe interação e ignora o resto", () => {
  const els = todos(`
    <h1>Título</h1><p>parágrafo</p>
    <button>Entrar</button><a href="/x">ir</a><input name="nif">
    <span role="button">falso botão</span><div>nada</div>
    <input type="hidden" name="csrf"><a>âncora sem href</a>`);
  assert.equal(els.length, 4);
});

/* ------------------------------------------------------ sinal 1: atributos */

test("prefere o atributo de teste, e recusa ids que parecem gerados", () => {
  assert.equal(sinalTestId(q(`<button data-ux-key="pagar">p</button>`, "button")), "data-ux-key=pagar");
  assert.equal(sinalTestId(q(`<button id="botao-pagar">p</button>`, "button")), "id=botao-pagar");
  for (const id of ["item-84213", ":r7:", "mui-4821", "css-1x2y3z4", "a3f9c81b2d4e5f60"]) {
    assert.equal(sinalTestId(q(`<button id="${id}">p</button>`, "button")), null, `aceitou ${id}`);
  }
});

/* --------------------------------------------------------- sinal 2: caminho */

test("o caminho ignora invólucros de disposição", () => {
  const semInvolucro = q(`<form><button>Entrar</button></form>`, "button");
  const comInvolucro = q(`<form><div class="grid"><div class="col"><button>Entrar</button></div></div></form>`, "button");
  assert.equal(sinalCaminho(semInvolucro), sinalCaminho(comInvolucro));
});

test("o caminho distingue dois botões irmãos", () => {
  const d = dom(`<form><button>A</button><button>B</button></form>`);
  const [a, b] = Array.from(d.querySelectorAll("button")).map((e) => sinalCaminho(e as unknown as ElementoLike));
  assert.notEqual(a, b);
});

/* ---------------------------------------------------------- sinal 3: rótulo */

test("nunca lê o conteúdo escrito pelo utilizador", () => {
  const el = q(`<input name="nif" placeholder="Escreva o NIF" value="005123456LA041">`, "input");
  assert.equal(textoVisivel(el), "Escreva o NIF");
  const s = JSON.stringify(sinais(el));
  assert.ok(!s.includes("005123456LA041"), "o valor do campo apareceu nos sinais");
});

test("o rótulo sai mascarado antes do resumo", () => {
  const a = q(`<button>Pagar 12.400 Kz</button>`, "button");
  const b = q(`<button>Pagar 300 Kz</button>`, "button");
  assert.equal(sinais(a).rotulo, sinais(b).rotulo);
});

/* ----------------------------------------------------------- reconciliação */

const cands = (html: string) => todos(html).map((e, i) => ({ ref: `#${i}`, sinais: sinais(e) }));

test("sobrevive a uma alteração de estilo", () => {
  const antes = cands(`<form><button class="btn btn-primary">Entrar</button><a href="/r">Recuperar</a></form>`);
  const depois = cands(`<form><button class="c-Button c-Button--main">Entrar</button><a href="/r" class="lnk">Recuperar</a></form>`);
  assert.equal(taxa(reconciliar(antes, depois)).sobrevivencia, 1);
});

test("sobrevive a um invólucro novo", () => {
  const antes = cands(`<form><button>Entrar</button><input name="nif" placeholder="NIF"></form>`);
  const depois = cands(`<form><div class="wrap"><div class="row"><button>Entrar</button><input name="nif" placeholder="NIF"></div></div></form>`);
  assert.equal(taxa(reconciliar(antes, depois)).sobrevivencia, 1);
});

test("sobrevive a um erro ortográfico corrigido, pelo caminho e pelo papel", () => {
  const antes = cands(`<form><button>Inicar sessão</button></form>`);
  const depois = cands(`<form><button>Iniciar sessão</button></form>`);
  assert.equal(taxa(reconciliar(antes, depois)).sobrevivencia, 1);
});

test("um elemento removido aparece como novo, e não colado a outro", () => {
  const antes = cands(`<form><button data-testid="apagar">Apagar</button></form>`);
  const depois = cands(`<form><button data-testid="guardar">Guardar</button></form>`);
  const r = reconciliar(antes, depois);
  assert.equal(r[0]!.tipo, "novo");
});

test("um empate é recusado, e não resolvido ao acaso", () => {
  const s = { testid: null, caminho: "FORM>BUTTON[1]", rotulo: "aaaa1111", destino: null, papel: "button#1" };
  const gemeo = { ...s };
  const r = reconciliar([{ ref: "a", sinais: s }], [{ ref: "b1", sinais: gemeo }, { ref: "b2", sinais: { ...gemeo } }]);
  assert.equal(r[0]!.tipo, "ambiguo");
});

test("o atributo de teste manda sobre tudo o resto", () => {
  const a = { testid: "data-ux-key=pagar", caminho: "X>Y[1]", rotulo: "1111", destino: null, papel: "button#1" };
  const b = { testid: "data-ux-key=pagar", caminho: "TOTALMENTE>OUTRO[9]", rotulo: "9999", destino: null, papel: "link#4" };
  assert.equal(pontuar(a, b), 1);
  assert.equal(pontuar(a, { ...b, testid: "data-ux-key=cancelar" }), 0);
});
