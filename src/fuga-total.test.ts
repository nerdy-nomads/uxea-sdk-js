/**
 * A bateria de fuga sobre **toda a captura**, e não só as mensagens. Cartão 18.2,
 * `RNF-PRI-01`, `RNF-PRI-02`, `RNF-PRI-03`.
 *
 * O 5.4 provou o caminho das mensagens e dos campos. Esta leva a mesma pergunta a
 * todos os outros: o caminho, a consulta e o fragmento do endereço, as ligações, os
 * rótulos e os atributos de teste dos elementos, os pedidos de rede da aplicação, os
 * nomes que a aplicação dá a ecrãs, passos, eventos e mensagens, as propriedades da
 * instituição, a identificação do utilizador, o deslocamento, a rede, a espera, o
 * recuo, o fim da tentativa e o plano de fundo, nos três níveis e com o rastreio
 * individual ligado.
 *
 * E tem **uma guarda de cobertura**: a corrida tem de produzir todos os tipos de evento
 * do esquema. Um caminho de captura novo, sem um ensaio que o percorra aqui, faz esta
 * bateria cair no dia em que entra no esquema, e não no dia em que vaza.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import esquema from "./event/schema.json" with { type: "json" };
import { criarBrowser, disparar } from "./ensaio/duplo.ts";
import { iniciar } from "./index.ts";

export const SEGREDOS = [
  "005123456LA041", "ana.silva@exemplo.ao", "+244923000111", "4111111111111111",
  "AO06000600000100037131174", "Ana Maria da Silva", "Rua Amilcar Cabral 42", "senha-super-secreta",
];

/**
 * Procura um segredo **em todas as formas em que pode sair**: tal e qual, em
 * minúsculas, codificado num endereço, e (para os que são números) só os algarismos,
 * com ou sem separadores pelo meio. Um detetor que só procura a forma escrita deixava
 * passar `ana.silva%40exemplo.ao` e `4111 1111 1111 1111`.
 */
export function fugas(bruto: string, segredos: ReadonlyArray<string> = SEGREDOS): string[] {
  let decodificado = bruto;
  try { decodificado = decodeURIComponent(bruto.replace(/%(?![0-9a-f]{2})/gi, "%25")); } catch { /* fica o bruto */ }
  const textos = [bruto, decodificado, bruto.toLowerCase(), decodificado.toLowerCase()];
  const soDigitos = decodificado.replace(/[^\d]/g, "");
  const out: string[] = [];
  for (const s of segredos) {
    const formas = [s, s.toLowerCase(), encodeURIComponent(s)];
    let achou = formas.some((f) => textos.some((t) => t.includes(f)));
    const d = s.replace(/[^\d]/g, "");
    if (!achou && d.length >= 9) achou = soDigitos.includes(d);
    if (achou) out.push(s);
  }
  return out;
}

const CAMINHO = "/clientes/ana.silva@exemplo.ao/contas/AO06000600000100037131174";

const PAGINA = `
  <nav>
    <a id="perfil" href="/clientes/005123456LA041/perfil?email=ana.silva@exemplo.ao" data-caixa="0,0,100,20">O meu perfil</a>
    <a id="ajuda" href="https://ajuda.exemplo.ao/tickets/4111111111111111" data-caixa="100,0,100,20">Ajuda</a>
  </nav>
  <form id="f" action="/pagar/+244923000111">
    <label for="nome">Nome</label>
    <input id="nome" name="nome" data-testid="titular-ana.silva@exemplo.ao" data-caixa="0,30,200,30">
    <input id="bi" name="bi" data-testid="bi_005123456LA041" data-caixa="0,70,200,30">
    <input id="senha" name="senha" type="password" data-caixa="0,110,200,30">
    <textarea id="morada" name="morada" data-caixa="0,150,200,60"></textarea>
    <button id="pagar" type="submit" data-caixa="0,220,100,30">Pagar a Ana Maria da Silva</button>
    <button id="desligado" type="button" disabled data-caixa="120,220,100,30">Confirmar 4111111111111111</button>
  </form>
  <div id="avisos"></div>
  <div id="vazio" data-caixa="0,400,400,300"></div>
`;

async function corrida(nivel: "essencial" | "padrao" | "detalhado", configExtra: Record<string, unknown> = {}) {
  const br = criarBrowser(PAGINA, { caminho: CAMINHO });
  br.janela.location.hash = "#/detalhe/4111111111111111";
  br.janela.scrollY = 0;
  br.janela.navigator.connection = { effectiveType: "4g", addEventListener() {}, removeEventListener() {} };
  // A aplicação a fazer pedidos com dados no endereço, e um deles a falhar.
  // Lento de propósito: 800 ms no relógio do ensaio, que é o que faz nascer a espera e
  // o toque em carregamento.
  br.janela.fetch = (url: string) => new Promise((ok) => br.janela.setTimeout(() =>
    ok({ status: String(url).includes("falha") ? 500 : 200, ok: !String(url).includes("falha") }), 800));
  br.responder((p) => p.url.includes("/v1/config")
    ? { estado: 200, corpo: JSON.stringify({ dados: { amostragem: 1, nivel, versao: 1, amostragem_detalhado: 1, rastreio_individual: true, ...configExtra } }) }
    : { estado: 202, corpo: "{}" });
  const uxda = iniciar({ chave: "uxda_des_teste", servidor: "http://ingest.local", ambiente: br.ambiente() });
  await br.avancar(10);

  const tocar = (seletor: string, x: number, y: number) => {
    disparar(br.documento, seletor, "pointerdown", { clientX: x, clientY: y });
    disparar(br.documento, seletor, "click", { clientX: x, clientY: y });
  };
  tocar("#perfil", 10, 5);
  tocar("#vazio", 50, 500);
  tocar("#desligado", 130, 230);
  for (let i = 0; i < 4; i++) tocar("#pagar", 10, 230);
  await br.avancar(4000);
  const valores: Record<string, string> = { nome: SEGREDOS[5]!, bi: SEGREDOS[0]!, senha: SEGREDOS[7]!, morada: SEGREDOS[6]! };
  for (const [id, v] of Object.entries(valores)) {
    disparar(br.documento, "#" + id, "focusin");
    (br.documento.querySelector("#" + id) as any).value = v;
    disparar(br.documento, "#" + id, "input", { inputType: "insertText", data: v });
    disparar(br.documento, "#" + id, "keydown", { key: v[0] });
    disparar(br.documento, "#" + id, "focusout");
  }
  disparar(br.documento, "#bi", "invalid");
  disparar(br.documento, "#f", "submit");
  const avisos = br.documento.querySelector("#avisos")!;
  const m = br.documento.createElement("div");
  m.innerHTML = `<div role="alert" class="erro">O IBAN AO06000600000100037131174 de Ana Maria da Silva foi recusado</div>`;
  avisos.appendChild(m.firstElementChild!);
  await br.avancar(30);

  // A rede da aplicação: um pedido que corre bem e um que falha, com dados no endereço.
  const lento = br.janela.fetch(`https://api.exemplo.ao/clientes/${SEGREDOS[1]}/movimentos?nif=${SEGREDOS[0]}`);
  await br.avancar(100);
  tocar("#pagar", 12, 232); // a meio do pedido: um toque em carregamento
  await br.avancar(900);
  await lento;
  const falha = br.janela.fetch(`https://api.exemplo.ao/falha/${SEGREDOS[3]}?tel=${encodeURIComponent(SEGREDOS[2]!)}`);
  await br.avancar(900);
  await falha;
  br.janela.dispararJanela("offline");
  br.janela.dispararJanela("online");
  // Deslocamento, rede e espera.
  br.janela.scrollY = 600;
  br.janela.dispararJanela("scroll");
  await br.avancar(1200);
  // A API inteira, com o que um programador da instituição lá poria a depurar.
  uxda.ecra(`detalhe ${SEGREDOS[1]}`);
  uxda.passo(`confirmar_${SEGREDOS[0]}`);
  uxda.track(`pagou_${SEGREDOS[4]}`, { segmento: SEGREDOS[5], canal: SEGREDOS[6], nota: SEGREDOS[7], valor_monetario: 12400 });
  uxda.mensagem(`recusado_${SEGREDOS[3]}`, "erro", { operacao: `pagamento ${SEGREDOS[1]}` });
  uxda.erroTecnico("resposta_ilegivel", { operacao: SEGREDOS[2] });
  await uxda.identificar(SEGREDOS[5]!);
  uxda.terminal("erro");
  br.janela.history.state = { idx: 0 };
  br.janela.dispararJanela("popstate", { state: { idx: 0 } });
  (br.documento as any).visibilityState = "hidden";
  disparar(br.documento, "body", "visibilitychange");
  await uxda.descarregar();
  await br.avancar(30000);
  return { bruto: JSON.stringify(br.pedidos), eventos: br.eventos(), pedidos: br.pedidos.length };
}

test("18.2 nenhum segredo sai por caminho nenhum, nos três níveis e com o rastreio individual ligado", async () => {
  for (const nivel of ["essencial", "padrao", "detalhado"] as const) {
    const { bruto, eventos } = await corrida(nivel);
    assert.ok(eventos.length > 5, `${nivel}: quase nada saiu, a bateria não provava nada`);
    const f = fugas(bruto);
    assert.deepEqual(f, [], `${nivel}: saiu do dispositivo`);
  }
});

test("18.2 a cobertura: a corrida produz todos os tipos de evento do esquema", async () => {
  const { eventos } = await corrida("detalhado");
  const vistos = new Set(eventos.map((e: any) => e.event_type));
  const todos = (esquema.campos.find((c: any) => c.nome === "event_type") as any).valores as string[];
  const faltam = todos.filter((t) => !vistos.has(t));
  assert.deepEqual(faltam, [], `tipos de evento sem cobertura nesta bateria: ${faltam.join(", ")}. Um caminho de captura novo precisa de ser percorrido aqui`);
  // E os sítios onde o texto podia ir, para a bateria não estar verde por não olhar.
  assert.ok(eventos.some((e: any) => String(e.screen_key).includes("{")), "o caminho com dados não chegou a ser lido");
  assert.ok(eventos.some((e: any) => e.event_type === "erro_rede"), "a rede da aplicação não foi exercida");
  assert.ok(eventos.some((e: any) => e.user_id), "a identificação não foi exercida");
  assert.ok(eventos.some((e: any) => e.properties?.toque_x !== undefined), "o rastreio individual não foi exercido");
});

test("18.2 o detetor apanha os segredos nas formas codificadas", () => {
  assert.deepEqual(fugas(`{"u":"ana.silva%40exemplo.ao"}`), ["ana.silva@exemplo.ao"]);
  assert.deepEqual(fugas(`{"c":"4111 1111 1111 1111"}`), ["4111111111111111"]);
  assert.deepEqual(fugas(`{"n":"ANA MARIA DA SILVA"}`), ["Ana Maria da Silva"]);
  assert.deepEqual(fugas(`{"t":"%2B244923000111"}`), ["+244923000111"]);
  assert.deepEqual(fugas(`{"x":"{email} {id} {numero}"}`), []);
});

/** Um gerador pequeno e determinístico, para a corrida em volume ser a mesma em todo o lado. */
function gerador(semente: number) {
  let s = semente >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; };
}

test("18.2 em volume: mil pessoas com dados diferentes em todos os caminhos, e nada escapa", async () => {
  const r = gerador(18_2);
  const NOMES = ["Ana", "Bruno", "Carla", "Domingos", "Esperança", "Fernando", "Graça", "Helder", "Isabel", "Joaquim"];
  const APELIDOS = ["Silva", "Santos", "Ferreira", "Costa", "Neto", "Miranda", "Cardoso", "Tavares"];
  let pedidos = 0, eventos = 0, verificados = 0;
  const N = Number(process.env.UXDA_FUGA_N ?? 1000);
  const br = criarBrowser(PAGINA, { caminho: "/inicio" });
  br.janela.fetch = async () => ({ status: 500, ok: false }); // rápido: a espera não é o que aqui se mede
  const uxda = iniciar({ chave: "uxda_des_teste", servidor: "http://ingest.local", ambiente: br.ambiente() });
  await br.avancar(10);
  const segredosDaCorrida: string[] = [];
  for (let i = 0; i < N; i++) {
    const nome = `${NOMES[Math.floor(r() * NOMES.length)]} ${APELIDOS[Math.floor(r() * APELIDOS.length)]} ${APELIDOS[Math.floor(r() * APELIDOS.length)]}`;
    const nif = String(Math.floor(100000000 + r() * 899999999));
    const correio = `pessoa${i}.${nif.slice(0, 4)}@exemplo.ao`;
    const cartao = `4${String(Math.floor(r() * 1e15)).padStart(15, "0")}`;
    segredosDaCorrida.push(nome, nif, correio, cartao);
    (br.documento.querySelector("#nome") as any).value = nome;
    disparar(br.documento, "#nome", "focusin");
    disparar(br.documento, "#nome", "input", { inputType: "insertText", data: nome });
    disparar(br.documento, "#nome", "focusout");
    uxda.track(`evento_${nif}`, { segmento: nome, campanha: correio });
    uxda.ecra(`/clientes/${correio}`);
    uxda.mensagem(`erro_${cartao}`, "erro", { operacao: nome });
    await br.janela.fetch(`https://api.exemplo.ao/contas/${nif}/cartoes/${cartao}?email=${correio}`);
    if (i % 100 === 99) { await uxda.descarregar(); await br.avancar(20000); }
  }
  await uxda.descarregar();
  await br.avancar(30000);
  const bruto = JSON.stringify(br.pedidos);
  pedidos = br.pedidos.length;
  eventos = br.eventos().length;
  verificados = segredosDaCorrida.length;
  const achadas = fugas(bruto, segredosDaCorrida);
  console.log(`  18.2 volume: ${N} pessoas, ${verificados} valores pessoais distintos, ${eventos} eventos em ${pedidos} pedidos, ${achadas.length} fugas`);
  assert.ok(eventos > N, "saíram menos eventos do que pessoas: a corrida não provava nada");
  assert.deepEqual(achadas.slice(0, 5), []);
});

test("18.2 a bateria apanha uma fuga introduzida de propósito fora das mensagens, e passa sem ela", async () => {
  // A fuga: a instituição expõe a propriedade `segmento`, e a aplicação mete lá o nome
  // da pessoa. É o único caminho que o 18.1 deixou aberto, e é uma decisão de quem
  // trata os dados; a bateria tem de a ver quando acontece.
  const com = await corrida("padrao", { exposicao: { propriedades: ["segmento"] } });
  assert.deepEqual(fugas(com.bruto), ["Ana Maria da Silva"], "a bateria não apanhou a fuga introduzida");
  const sem = await corrida("padrao");
  assert.deepEqual(fugas(sem.bruto), [], "sem a fuga, nada devia sair");
});
