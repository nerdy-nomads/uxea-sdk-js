/**
 * Bateria de fuga de conteúdo, sobre **todo o tráfego de saída do SDK**.
 * Cartão 5.4, RNF-PRI-01 e RF-MSG-04.
 *
 * É a irmã da `identity/fuga.test.ts`, e a diferença é o âmbito: aquela lê os
 * sinais de identidade de um elemento, esta lê **os bytes que saem pela rede**,
 * com o SDK inteiro a correr por cima de um browser a sério. O que interessa não é
 * que uma função não devolva um segredo: é que nenhum dos caminhos que existem o
 * ponha dentro de um pedido.
 *
 * O documento nomeia dois riscos críticos, e esta bateria fecha os dois:
 *
 *  1. **mensagens de erro com dados pessoais interpolados enviadas sem
 *     mascaramento**, que é o caminho novo que a fase 5 abriu;
 *  2. **requisitos de contagem de caracteres interpretados por quem implementa
 *     como autorização para capturar conteúdo**, que é a forma como isto se perde
 *     daqui a dois anos, com boas intenções e um `console.log` que ficou.
 *
 * A defesa não é uma revisão de código feita uma vez: é isto, que corre no CI a
 * cada alteração ao código de captura e que **falha quando alguém acrescentar um
 * campo com boas intenções**. O ensaio do fim prova que ela falha mesmo.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { criarBrowser, disparar } from "./ensaio/duplo.ts";
import { iniciar } from "./index.ts";
import * as I from "./ensaio/inquerito.ts";

/**
 * O que uma pessoa escreve, e que não pode sair do dispositivo por caminho nenhum.
 *
 * São valores reconhecíveis de propósito: nenhum deles aparece por acidente num
 * evento legítimo, e por isso encontrar um é sempre uma fuga e nunca um falso
 * positivo.
 */
const SEGREDOS = [
  "005123456LA041",              // documento de identificação
  "ana.silva@exemplo.ao",        // correio electrónico
  "+244923000111",               // contacto
  "4111111111111111",            // cartão
  "AO06000600000100037131174",   // IBAN
  "Ana Maria da Silva",          // nome
  "Rua Amilcar Cabral 42",       // morada
  "senha-super-secreta",         // palavra-passe
];

const PAGINA = `
  <form id="f" action="/pagar">
    <input id="nome" name="nome" placeholder="Nome completo">
    <input id="email" name="email" type="email" placeholder="Correio">
    <input id="bi" name="bi" placeholder="Documento">
    <input id="iban" name="iban" placeholder="IBAN">
    <input id="cartao" name="cartao" placeholder="Cartão">
    <input id="senha" name="senha" type="password" placeholder="Palavra-passe">
    <textarea id="morada" name="morada" placeholder="Morada"></textarea>
    <select id="pais" name="pais"><option value="AO">Angola</option></select>
    <button id="pagar" type="submit">Pagar</button>
  </form>
  <div id="avisos"></div>
`;

/**
 * Corre uma tarefa completa com o SDK inteiro, ao nível pedido, e devolve **tudo o
 * que saiu**: corpos, cabeçalhos, endereços e método, num texto só.
 *
 * O nível importa: o `detalhado` é o que emite mais, e por isso é o que tem mais
 * caminhos por onde escapar. Uma bateria que só corresse no padrão deixava a
 * captura mais falante por proteger.
 */
async function tudoOQueSai(nivel: "essencial" | "padrao" | "detalhado"): Promise<{ bruto: string; eventos: any[]; br: any }> {
  const br = criarBrowser(PAGINA, { caminho: "/checkout" });
  br.responder((p) => p.url.includes("/v1/config")
    ? { estado: 200, corpo: JSON.stringify({ dados: { amostragem: 1, nivel, captura: [], versao: 1 } }) }
    : { estado: 202, corpo: "{}" });
  const uxda = iniciar({ chave: "uxda_des_teste", servidor: "http://ingest.local", ambiente: br.ambiente() });
  await br.avancar(10);

  // Uma pessoa a preencher o formulário: escreve, apaga, cola, volta atrás.
  const campos = ["nome", "email", "bi", "iban", "cartao", "senha", "morada"];
  campos.forEach((id, i) => {
    const el = br.documento.querySelector("#" + id)!;
    const valor = SEGREDOS[i % SEGREDOS.length]!;
    disparar(br.documento, "#" + id, "focusin");
    el.value = valor;
    disparar(br.documento, "#" + id, "input", { inputType: "insertText", data: valor });
    disparar(br.documento, "#" + id, "keydown", { key: valor[0] });
    if (i === 2) disparar(br.documento, "#" + id, "input", { inputType: "insertFromPaste", data: valor });
    if (i === 3) disparar(br.documento, "#" + id, "input", { inputType: "deleteContentBackward" });
    disparar(br.documento, "#" + id, "focusout");
  });

  // E a aplicação a responder-lhe, com o que escreveu interpolado nas mensagens.
  // É o risco crítico do documento, e é o caminho que a fase 5 abriu.
  const avisos = br.documento.querySelector("#avisos")!;
  const mensagens = [
    `<div role="alert" class="erro">O documento 005123456LA041 nao existe</div>`,
    `<div role="alert" class="erro">Ja existe conta para ana.silva@exemplo.ao</div>`,
    `<div class="toast toast-warning">Olá Ana Maria da Silva, confirme o contacto +244923000111</div>`,
    `<div role="status" class="alert-info">Enviamos o comprovativo para Rua Amilcar Cabral 42</div>`,
    `<div role="alert" class="erro">O valor "senha-super-secreta" nao e valido</div>`,
    `<div role="alert" class="erro">O IBAN AO06000600000100037131174 nao pertence a este titular</div>`,
  ];
  for (const html of mensagens) {
    const molde = br.documento.createElement("div");
    molde.innerHTML = html;
    for (const filho of Array.from(molde.children) as any[]) avisos.appendChild(filho);
    await br.avancar(30);
  }

  // E o resto do que o SDK sabe fazer, para nenhum caminho ficar por percorrer.
  disparar(br.documento, "#pagar", "click");
  disparar(br.documento, "#f", "submit");
  disparar(br.documento, "#nome", "invalid");
  uxda.track("comprovativo_descarregado", { valor_monetario: 12400 });
  uxda.passo("confirmacao");
  uxda.mensagem("cartao_recusado", "erro");
  uxda.erroTecnico("resposta_ilegivel", { operacao: "pagamento" });
  uxda.identificar("Ana Maria da Silva");
  uxda.terminal("erro");
  (br.documento as any).visibilityState = "hidden";
  disparar(br.documento, "body", "visibilitychange");

  await uxda.descarregar();
  await br.avancar(30000);

  const bruto = JSON.stringify(br.pedidos);
  return { bruto, eventos: br.eventos(), br };
}

test("5.4 nada do que a pessoa escreveu sai do dispositivo, nos três níveis", async () => {
  for (const nivel of ["essencial", "padrao", "detalhado"] as const) {
    const { bruto, eventos } = await tudoOQueSai(nivel);
    assert.ok(eventos.length > 0, `${nivel}: não saiu evento nenhum, a bateria não provava nada`);
    for (const segredo of SEGREDOS) {
      assert.ok(!bruto.includes(segredo),
        `${nivel}: ${JSON.stringify(segredo)} saiu do dispositivo`);
    }
  }
});

test("5.4 a cobertura é das mensagens, das propriedades, das contagens e dos metadados", async () => {
  // Uma bateria que não veja os quatro é uma bateria que dá conforto a metade do
  // problema. O que se fixa aqui é que os quatro caminhos **existiram** nesta
  // corrida: sem isto, uma alteração que desligasse a captura fazia a bateria
  // passar por não haver nada para encontrar.
  const { eventos } = await tudoOQueSai("detalhado");
  const tipos = new Set(eventos.map((e: any) => e.event_type));
  assert.ok(tipos.has("mensagem"), `sem mensagens: ${[...tipos].join(", ")}`);
  assert.ok(tipos.has("campo"), "sem agregados de campo: as contagens não foram exercidas");

  const campos = eventos.filter((e: any) => e.event_type === "campo");
  assert.ok(campos.some((e: any) => (e.properties?.caracteres_escritos ?? 0) > 0),
    "nenhuma contagem de caracteres: o caminho mais perigoso não foi percorrido");
  assert.ok(eventos.some((e: any) => e.properties && Object.keys(e.properties).length > 0),
    "nenhuma propriedade");
  // Metadados: o que vai fora das propriedades, e que ninguém olha por ser
  // "infraestrutura". O `element_key` é o mais perigoso de todos, porque é
  // calculado a partir do que está no ecrã.
  assert.ok(eventos.some((e: any) => e.element_key), "nenhuma chave de elemento");
  assert.ok(eventos.every((e: any) => e.user_id !== "Ana Maria da Silva"),
    "o identificador direto saiu por identificar sem pseudonimizar");
});

test("5.4 o comprimento do que foi escrito não é inferível", async () => {
  // A contagem de caracteres é um requisito (RF-GRA-12), e é também a porta pela
  // qual alguém conclui que pode capturar conteúdo. O que se fixa aqui é a
  // fronteira: conta-se **quantos**, e nunca **quais**.
  const { eventos } = await tudoOQueSai("padrao");
  const campo = eventos.find((e: any) => e.event_type === "campo" && e.properties?.caracteres_escritos);
  assert.ok(campo, "sem agregado de campo com contagem");
  for (const [k, v] of Object.entries(campo.properties as Record<string, unknown>)) {
    if (typeof v !== "string") continue;
    assert.ok(v.length <= 64, `a propriedade ${k} traz um texto longo: ${v}`);
    assert.ok(!/\d{5}/.test(v), `a propriedade ${k} traz uma corrida de algarismos: ${v}`);
  }
});

test("5.4 a bateria falha quando se introduz uma fuga, e passa depois de a remover", async () => {
  // **É este ensaio que dá valor a todos os outros.** Uma bateria que nunca falhou
  // é uma bateria que ninguém sabe se funciona, e é assim que uma proteção morre:
  // não com um alarme, com um silêncio.
  const br = criarBrowser(PAGINA, { caminho: "/checkout" });
  const uxda = iniciar({ chave: "uxda_des_teste", servidor: "http://ingest.local", ambiente: br.ambiente() });
  await br.avancar(10);

  const el = br.documento.querySelector("#bi")! as any;
  el.value = "005123456LA041";

  // A fuga, escrita como alguém a escreveria a depurar um problema: uma
  // propriedade **da lista de permitidas**, com o valor de um campo lá dentro,
  // "só para ver". É a forma mais provável de isto acontecer a sério, porque a
  // lista de chaves dá a sensação de já proteger, e ela protege a chave e não o
  // valor.
  el.value = "Ana Maria da Silva";
  uxda.track("depuracao", { properties: { segmento: el.value } });
  await uxda.descarregar();
  await br.avancar(20000);
  const comFuga = JSON.stringify(br.pedidos);
  assert.ok(comFuga.includes("Ana Maria da Silva"),
    "a bateria não apanharia uma fuga: o valor nem chegou a sair");

  // E sem ela, o mesmo caminho não deixa passar nada.
  const br2 = criarBrowser(PAGINA, { caminho: "/checkout" });
  const uxda2 = iniciar({ chave: "uxda_des_teste", servidor: "http://ingest.local", ambiente: br2.ambiente() });
  await br2.avancar(10);
  (br2.documento.querySelector("#bi") as any).value = "Ana Maria da Silva";
  uxda2.track("depuracao", { properties: { segmento: "empresas" } });
  await uxda2.descarregar();
  await br2.avancar(20000);
  assert.ok(!JSON.stringify(br2.pedidos).includes("Ana Maria da Silva"),
    "sem a fuga introduzida, nada devia sair");

  // E o chão que o validador impõe: a mesma propriedade com um número de
  // documento lá dentro **nem sai**, porque a regra `sem_conteudo` do esquema diz
  // que um valor de propriedade é texto curto sem dígitos longos, e agora os dois
  // validadores impõem-no.
  const br3 = criarBrowser(PAGINA, { caminho: "/checkout" });
  const uxda3 = iniciar({ chave: "uxda_des_teste", servidor: "http://ingest.local", ambiente: br3.ambiente() });
  await br3.avancar(10);
  uxda3.track("depuracao", { properties: { segmento: "005123456LA041" } });
  await uxda3.descarregar();
  await br3.avancar(20000);
  assert.ok(!JSON.stringify(br3.pedidos).includes("005123456LA041"),
    "um número de documento numa propriedade permitida atravessou o validador");
  assert.ok(uxda3.diagnostico().eventosRecusados >= 1,
    "o evento devia ter sido recusado no dispositivo, e com o motivo escrito");
});

test("5.4 em volume: quinhentas mensagens com conteúdo interpolado, e nada escapa", async () => {
  // Sintético e em volume, que é o que a caixa do cartão pede. Uma corrida com
  // seis mensagens prova o caminho; quinhentas, geradas a partir de moldes reais
  // e com valores diferentes em cada uma, provam que não há um recanto do
  // mascaramento que só falhe para uma forma de escrever o montante.
  const br = criarBrowser(PAGINA, { caminho: "/checkout" });
  const uxda = iniciar({ chave: "uxda_des_teste", servidor: "http://ingest.local", ambiente: br.ambiente() });
  await br.avancar(10);
  const avisos = br.documento.querySelector("#avisos")!;

  const moldes = [
    (v: string) => `O saldo de ${v} Kz e insuficiente`,
    (v: string) => `O documento ${v} nao existe`,
    (v: string) => `Ja existe conta para ${v}`,
    (v: string) => `O valor "${v}" nao e valido`,
    (v: string) => `Confirme o contacto ${v}`,
  ];
  const valores: string[] = [];
  for (let i = 0; i < 500; i++) {
    const v = [
      `${12400 + i}`,
      `${(1000 + i).toLocaleString("pt-PT")},50`,
      `00512${String(i).padStart(4, "0")}LA041`,
      `pessoa${i}@exemplo.ao`,
      `+2449230001${String(i % 100).padStart(2, "0")}`,
    ][i % 5]!;
    valores.push(v);
    const el = br.documento.createElement("div");
    el.setAttribute("role", "alert");
    el.setAttribute("class", "erro");
    el.textContent = moldes[i % moldes.length]!(v);
    avisos.appendChild(el);
    // Cada mensagem tem de passar a janela de repetição, senão a segunda em diante
    // era descartada e a bateria corria sobre uma só.
    await br.avancar(2000);
  }
  await uxda.descarregar();
  await br.avancar(30000);

  const mensagens = br.eventos().filter((e: any) => e.event_type === "mensagem");
  const textos = mensagens.map((e: any) => String(e.message_text_masked ?? ""));

  // **A verificação é por propriedade, e não por procura do valor no tráfego.**
  // Procurar `12575` no corpo cru dá um falso positivo à primeira: esse número
  // aparece dentro de uma duração e de um instante, e é legítimo. O que tem de ser
  // verdade é outra coisa, e é mais forte: nenhum texto de mensagem tem uma
  // corrida de algarismos nem um arroba, que é exatamente a regra que a ingestão
  // impõe do outro lado.
  for (const t of textos) {
    assert.ok(!/\d{5}/.test(t), `um texto saiu com uma corrida de algarismos: ${t}`);
    assert.ok(!t.includes("@"), `um texto saiu com um endereço de correio: ${t}`);
  }
  // E os valores que **não** se confundem com nada (documentos, correio,
  // contactos) verificam-se no tráfego inteiro, que é onde uma fuga por outro
  // caminho apareceria.
  const bruto = JSON.stringify(br.pedidos);
  const distintivos = valores.filter((v) => /[A-Za-z@+]/.test(v));
  const escaparam = distintivos.filter((v) => bruto.includes(v));
  assert.deepEqual(escaparam, [], `escaparam ${escaparam.length} valores: ${escaparam.slice(0, 5).join(", ")}`);

  // **Quinhentas, e não cem.** Antes chegavam cem, e o motivo era um defeito do
  // próprio chão que esta bateria trouxe: o resumo do grupo é hexadecimal, e
  // quatro em cada cinco tinham cinco algarismos seguidos, que o validador
  // recusava como se fosse conteúdo. A lista de propriedades opacas do esquema
  // resolve-o, e este número é o que prova que ficou resolvido.
  assert.ok(mensagens.length >= 480, `só saíram ${mensagens.length} mensagens: a bateria correu sobre pouco`);
  // E o número fica escrito, que é o que a `Definição de pronto` pede.
  console.log(`  5.4 volume: ${mensagens.length} mensagens verificadas, ${valores.length} valores interpolados, ${distintivos.length} distintivos, 0 fugas`);
});

test("14.1 um inquérito respondido com segredos no comentário, numa página cheia deles, e nada escapa", async () => {
  // **O caminho novo que a fase 14 abriu**, e é o mais direto de todos: pela
  // primeira vez o SDK tem um campo onde a pessoa escreve de propósito, e o que ela
  // escreve vai para o servidor. As outras baterias provam que o conteúdo dos campos
  // da página não sai; esta prova que o conteúdo do campo **do próprio SDK** só sai
  // mascarado, e que responder a um inquérito não abre um caminho para os campos da
  // página ao lado.
  //
  // No nível detalhado e com o rastreio individual, que é quando a captura emite
  // mais caminhos por onde escapar.
  const br = criarBrowser(PAGINA, { caminho: "/checkout" });
  I.servir(br, I.inqueritos([I.regra({
    gatilho: "apos_erro", criterios: [], inicio: [], formato: "esforco", comentario: true, atraso_ms: 800,
  })]), { nivel: "detalhado", rastreioIndividual: true });
  const uxda = await I.arrancar(br);

  // A página com tudo preenchido, como na bateria de cima.
  const campos = ["nome", "email", "bi", "iban", "cartao", "senha", "morada"];
  campos.forEach((id, i) => {
    const el = br.documento.querySelector("#" + id)!;
    const valor = SEGREDOS[i % SEGREDOS.length]!;
    disparar(br.documento, "#" + id, "focusin");
    el.value = valor;
    disparar(br.documento, "#" + id, "input", { inputType: "insertText", data: valor });
    disparar(br.documento, "#" + id, "focusout");
  });

  // A aplicação mostra um erro com o que a pessoa escreveu lá dentro, e é esse erro
  // que dispara o inquérito.
  const aviso = br.documento.createElement("div");
  aviso.setAttribute("role", "alert");
  aviso.setAttribute("class", "erro");
  aviso.textContent = "O cartão 4111111111111111 foi recusado para ana.silva@exemplo.ao";
  br.documento.querySelector("#avisos")!.appendChild(aviso);
  await br.avancar(1000);
  assert.ok(I.hospedeiro(br), "o inquérito não apareceu, e a bateria não provava nada");

  // A resposta, com os segredos no comentário: o cartão por inteiro e às quatro, o
  // correio, o nome, o contacto e o documento.
  const comentario = "Paguei com o cartão 4111111111111111 (4111 1111 1111 1111) e o recibo não chegou a "
    + "ana.silva@exemplo.ao, falem com Ana Maria da Silva pelo +244923000111, documento 005123456LA041";
  I.escolher(br, "2");
  I.escrever(br, comentario);
  // E quem responde também mexe na página ao lado, com o cartão aberto.
  disparar(br.documento, "#cartao", "focusin");
  disparar(br.documento, "#cartao", "input", { inputType: "insertText", data: SEGREDOS[3] });
  disparar(br.documento, "#cartao", "focusout");
  await I.enviarResposta(br);

  uxda.terminal("erro");
  await uxda.descarregar();
  await br.avancar(30000);

  const enviadas = br.pedidos.filter((p) => p.url.endsWith("/v1/respostas") && p.estado === 202);
  assert.equal(enviadas.length, 1, "a resposta não chegou a sair, e a bateria não provava nada");
  const corpo = JSON.parse(enviadas[0]!.corpo);
  assert.ok(corpo.comentario.includes("{email}") && corpo.comentario.includes("{numero}"),
    `o comentário não passou pela máscara: ${corpo.comentario}`);
  assert.ok(!/\d{5}/.test(corpo.comentario), `uma corrida de algarismos no comentário: ${corpo.comentario}`);
  assert.ok(!corpo.comentario.includes("@"), `um arroba no comentário: ${corpo.comentario}`);

  // E o tráfego inteiro: eventos, elegibilidade, resposta e configuração.
  const bruto = JSON.stringify(br.pedidos);
  for (const segredo of [...SEGREDOS, "4111 1111 1111 1111"]) {
    assert.ok(!bruto.includes(segredo), `${JSON.stringify(segredo)} saiu do dispositivo`);
  }
  assert.ok(br.eventos().some((e: any) => e.event_type === "campo"), "a captura da página não correu");
  console.log(`  14.1 fuga: ${br.pedidos.length} pedidos, ${br.eventos().length} eventos e 1 resposta verificados, 0 fugas`);
});
