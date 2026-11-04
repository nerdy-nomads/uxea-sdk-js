/**
 * A captura ofuscada (cartões 32.20 e 32.22, ADR 0062 e 0063): o que sai do browser e
 * o que nunca sai.
 *
 * O documento é o do `linkedom`, que não tem motor de desenho: as caixas e os estilos
 * vêm de um leitor de ensaio, que os lê de `data-caixa` (x,y,largura,altura em px) e
 * de um `style` simples. As linhas de um parágrafo vêm de `data-linhas`, com as
 * quebras marcadas por `|`. O que se prova é a ofuscação, e é isso que tem de ser
 * verdade em qualquer browser.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseHTML } from "linkedom";
import { corDe, faixaDe, ligarRetratos, mascararCaptura, retratar, CHAVE_DO_LIVRO, TAPADO, type Leitor } from "./retrato.ts";

const leitor: Leitor = {
  caixa(el) {
    const c = el.getAttribute?.("data-caixa");
    if (!c) return null;
    const [x, y, l, a] = c.split(",").map(Number);
    return { x: x!, y: y!, l: l!, a: a! };
  },
  estilo(el) {
    const s: Record<string, string> = {};
    for (const parte of String(el.getAttribute?.("style") ?? "").split(";")) {
      const [k, v] = parte.split(":").map((p: string) => p?.trim());
      if (k && v) s[k.replace(/-([a-z])/g, (_m: string, l: string) => l.toUpperCase())] = v;
    }
    return s;
  },
  linhas(no) {
    const pai = no.parentNode;
    const marcas = pai?.getAttribute?.("data-linhas");
    const caixa = this.caixa(pai);
    if (!marcas || !caixa) return null;
    const partes = String(marcas).split("|");
    const alto = caixa.a / partes.length;
    return partes.map((texto, i) => ({ x: caixa.x, y: caixa.y + i * alto, l: caixa.l * (0.6 + 0.4 * (i % 2)), a: alto, texto }));
  },
};

// Um ecrã de pagamento com tudo o que não pode sair (o nome da pessoa, o saldo, o
// correio, o IBAN, o telefone, o NIF, o bilhete, a data de nascimento, o avatar, o
// valor escrito num campo, um mapa, uma área marcada, o menu da conta) ao lado do que
// tem de aparecer para o ecrã se ler: títulos, descrições, rótulos e preços.
const PAGINA = `<!doctype html><html><body data-caixa="0,0,390,844" style="background-color: rgb(255, 255, 255)">
  <header data-caixa="0,0,390,60" style="background-color: rgb(31, 79, 209)">
    <h1 data-caixa="16,16,200,28" style="color: rgb(255, 255, 255)">Olá, Maria Joana Tavares</h1>
    <img class="avatar" data-caixa="330,10,48,48" src="/fotos/maria.jpg" alt="Maria Joana">
  </header>
  <div class="user-menu" data-caixa="100,60,190,20"><span data-caixa="100,60,190,20">Maria Tavares · Sair</span></div>
  <p data-caixa="16,80,300,20">Saldo disponível: 12.400,50 Kz</p>
  <p data-caixa="16,104,300,20">maria.tavares@banco.ao · AO06 0040 0000 1234 5678 1011 2</p>
  <p data-caixa="16,124,300,16">Ligue +244 923 456 781 · NIF 5417091234 · BI 000123456LA041 · nasceu a 12/03/1990</p>
  <label data-caixa="16,140,200,18" style="font-size: 14px">Montante a pagar</label>
  <input data-caixa="16,160,358,44" type="text" value="250000" placeholder="ex.: 1000" style="border-top-width: 1px; border-top-color: rgb(200, 200, 200); border-top-left-radius: 8px">
  <input data-caixa="16,210,358,44" type="password" value="segredo123">
  <textarea data-caixa="16,260,358,80">Pagamento da renda de março, apartamento 3B</textarea>
  <select data-caixa="16,350,358,44"><option selected>Conta ordenado 0040123456789</option></select>
  <div data-caixa="16,400,358,40" contenteditable="true">nota privada</div>
  <div data-caixa="16,450,358,100" data-uxea-ocultar><button data-caixa="20,460,100,30">Ver PIN 4821</button></div>
  <div data-caixa="16,560,358,60" style="background-image: url(/cartao.png)"></div>
  <img data-caixa="200,560,170,60" src="/produtos/cafeteira.jpg" alt="Cafeteira italiana">
  <iframe data-caixa="16,630,358,80" src="https://mapas.exemplo/?q=Rua+da+Missao+12"></iframe>
  <p data-caixa="16,700,358,40" data-linhas="Entrega em todo o país em |dois dias úteis, sem custos." style="font-family: Georgia, serif">Entrega em todo o país em dois dias úteis, sem custos.</p>
  <button data-caixa="16,740,358,40" style="background-color: rgb(31, 79, 209); color: rgb(255, 255, 255); font-weight: 700; border-top-left-radius: 12px; text-transform: uppercase">Pagar 18 900 Kz agora</button>
  <input data-caixa="16,780,170,40" type="submit" value="Confirmar">
  <nav data-caixa="0,790,390,54"><a data-caixa="20,800,80,20" href="/inicio">Início</a></nav>
  <div data-uxea-ignorar data-caixa="0,0,390,844"><p data-caixa="0,0,100,20">componente do inquérito</p></div>
  <p data-caixa="16,900,300,20">Abaixo da dobra, fora do visor</p>
  <script>var segredo = "nao sai"</script>
</body></html>`;

function captura() {
  const { document } = parseHTML(PAGINA);
  const r = retratar({ documento: document, visor: { largura: 390, altura: 844 }, ecra: "/pagar", versao: "1.2.0", leitor });
  assert.ok(r);
  return r!;
}

test("nada do que a pessoa é, tem ou escreveu sai na captura", () => {
  const corpo = JSON.stringify(captura());
  for (const proibido of [
    "Maria", "Joana", "Tavares", "400,50", "12.400", "maria.tavares", "@banco", "AO06", "1234 5678",
    "923", "456 781", "5417091234", "000123456", "LA041", "12/03/1990", "1990",
    "250000", "ex.:", "segredo", "renda", "apartamento", "0040123456789", "Conta ordenado", "nota privada",
    "4821", "PIN", "maria.jpg", "/fotos", "cartao.png", "cafeteira.jpg", "mapas.exemplo", "Missao", "inquérito",
    "Abaixo da dobra", "nao sai", "src", "href", "/inicio\"",
  ]) {
    assert.ok(!corpo.includes(proibido), `«${proibido}» saiu na captura`);
  }
});

test("o texto da página lê-se: títulos, descrições, rótulos e preços", () => {
  const textos = captura().nos.filter((n) => n.k === "t").map((n) => n.tx);
  for (const esperado of [
    `Olá, ${TAPADO}`, `Saldo disponível: ${TAPADO}`, "Montante a pagar", "Cafeteira italiana",
    "Entrega em todo o país em", "dois dias úteis, sem custos.", "PAGAR 18 900 KZ AGORA", "Confirmar", "Início",
  ]) {
    assert.ok(textos.includes(esperado), `falta «${esperado}» em ${JSON.stringify(textos)}`);
  }
  const contactos = textos.find((t) => t?.startsWith("Ligue"))!;
  assert.equal(contactos, `Ligue ${TAPADO} · NIF ${TAPADO} · BI ${TAPADO} · nasceu a ${TAPADO}`);
  assert.ok(textos.includes(`${TAPADO} · ${TAPADO}`), "o correio e o IBAN ficam tapados, e a linha fica");
});

test("um parágrafo sai linha a linha, com a letra dele", () => {
  const linhas = captura().nos.filter((n) => n.k === "t" && (n.tx === "Entrega em todo o país em" || n.tx === "dois dias úteis, sem custos."));
  assert.equal(linhas.length, 2);
  assert.ok(linhas[1]!.y > linhas[0]!.y, "a segunda linha está por baixo da primeira");
  assert.ok(linhas.every((n) => n.ff === "r"), "Georgia é com serifa");
  const botao = captura().nos.find((n) => n.tx === "PAGAR 18 900 KZ AGORA")!;
  assert.equal(botao.c, "#ffffff");
  assert.equal(botao.p, 700);
  assert.equal(botao.ff, undefined);
});

test("campos, imagens, multimédia e zonas da pessoa viram blocos sem conteúdo", () => {
  const r = captura();
  const tipos = (k: string) => r.nos.filter((n) => n.k === k);
  // Os dois inputs, a textarea, o select e o contenteditable.
  assert.equal(tipos("c").length, 5);
  for (const n of [...tipos("c"), ...tipos("i"), ...tipos("m"), ...tipos("o")]) assert.equal(n.tx, undefined, JSON.stringify(n));
  // O avatar, o fundo com url( e o produto.
  assert.equal(tipos("i").length, 3);
  assert.equal(tipos("m").length, 1);
  // Só o produto leva o texto alternativo, e marcado como tal: o avatar é da pessoa.
  const alts = r.nos.filter((n) => n.al === 1).map((n) => n.tx);
  assert.deepEqual(alts, ["Cafeteira italiana"]);
  // O campo guarda a forma: 16/390 de largura em permilagem, e o canto redondo.
  const montante = tipos("c")[0]!;
  assert.deepEqual([montante.x, montante.y, montante.l, montante.a], [41, 190, 918, 52]);
  assert.equal(montante.r, 8);
});

test("o texto das zonas da pessoa é uma barra que não diz quantas letras tinha", () => {
  const barras = captura().nos.filter((n) => n.k === "o");
  // O menu da conta e a área marcada com data-uxea-ocultar.
  assert.equal(barras.length, 2);
  const menu = barras.find((b) => b.y === Math.round((60 / 844) * 1000))!;
  // 190 px arredondam a 192 (quatro degraus de 48): a largura da barra não é a do nome.
  assert.equal(menu.l, Math.round((192 / 390) * 1000));
});

test("a máscara equilibrada: o que identifica alguém sai, o catálogo fica", () => {
  const casos: Array<[string, string]> = [
    ["Café de Amboim, 250 g · 4500 Kz", "Café de Amboim, 250 g · 4500 Kz"],
    ["Mochila de lona 18 900 Kz", "Mochila de lona 18 900 Kz"],
    ["Passo 2 de 3", "Passo 2 de 3"],
    ["Bem-vinda, Rosalina Quissanga", `Bem-vinda, ${TAPADO}`],
    ["Boa tarde Pedro", `Boa tarde ${TAPADO}`],
    ["Escreva para ajuda@kubeta.ao", `Escreva para ${TAPADO}`],
    ["Cartão 4111 1111 1111 1111", `Cartão ${TAPADO}`],
    ["Telefone 923456781", `Telefone ${TAPADO}`],
    ["Encomenda de 2026-11-04", `Encomenda de ${TAPADO}`],
    ["Saldo: Kz 125 000,00", `Saldo: ${TAPADO}`],
  ];
  for (const [entrada, saida] of casos) assert.equal(mascararCaptura(entrada), saida, entrada);
});

test("os blocos levam as cores, e o que está fora do visor não entra", () => {
  const r = captura();
  assert.equal(r.v, 2);
  assert.equal(r.faixa, "movel");
  assert.equal(r.visor.largura, 390);
  assert.ok(r.nos.some((n) => n.k === "b" && n.f === "#1f4fd1"));
  // O fundo da página vem primeiro, do tamanho do visor.
  assert.deepEqual([r.nos[0]!.k, r.nos[0]!.f, r.nos[0]!.l, r.nos[0]!.a], ["b", "#ffffff", 1000, 1000]);
  assert.ok(r.nos.every((n) => n.y + n.a <= 1000 && n.x + n.l <= 1000));
  assert.equal(r.ofuscada, true);
  assert.match(r.assinatura, /^[0-9a-f]{8}$/);
});

test("a assinatura muda com a forma e não com o texto", () => {
  const a = captura().assinatura;
  const { document } = parseHTML(PAGINA.replace("Olá, Maria Joana Tavares", "Olá, Pedro"));
  const b = retratar({ documento: document, visor: { largura: 390, altura: 844 }, ecra: "/pagar", versao: "1", leitor })!;
  assert.equal(a, b.assinatura);
  const { document: d2 } = parseHTML(PAGINA.replace('data-caixa="16,740,358,40"', 'data-caixa="16,600,358,40"'));
  const c = retratar({ documento: d2, visor: { largura: 390, altura: 844 }, ecra: "/pagar", versao: "1", leitor })!;
  assert.notEqual(a, c.assinatura);
});

test("cores e faixas", () => {
  assert.equal(corDe("rgb(31, 79, 209)"), "#1f4fd1");
  assert.equal(corDe("rgba(0, 0, 0, 0)"), "");
  assert.equal(corDe("rgba(0, 0, 0, 0.5)"), "#00000080");
  assert.equal(corDe("transparent"), "");
  assert.equal(faixaDe(390), "movel");
  assert.equal(faixaDe(800), "tablet");
  assert.equal(faixaDe(1440), "computador");
});

test("sai uma vez por ecrã e tamanho, e só com permissão", () => {
  const { document, window } = parseHTML(PAGINA);
  const loja = new Map<string, string>();
  const enviados: string[] = [];
  let relogio = 1_000_000;
  let permitido = false;
  const pendentes: Array<() => void> = [];
  const janela = { innerWidth: 390, innerHeight: 844, setTimeout: undefined };
  const l = ligarRetratos({
    janela, documento: document,
    armazenamento: { getItem: (k) => loja.get(k) ?? null, setItem: (k, v) => void loja.set(k, v) },
    agora: () => relogio, ecra: () => "/pagar", versao: "1", leitor,
    permitido: () => permitido,
    enviar: async (corpo) => { enviados.push(corpo); },
    esperar: (fn) => { pendentes.push(fn); return 1; },
  });
  const correr = () => { while (pendentes.length) pendentes.shift()!(); };
  void window;

  l.ecraNovo(); correr();
  assert.equal(enviados.length, 0, "sem rastreio individual não sai nada");

  permitido = true;
  l.ecraNovo(); correr();
  assert.equal(enviados.length, 1);
  assert.equal(JSON.parse(enviados[0]!).screen_key, "/pagar");

  // O mesmo desenho, logo a seguir: não sai outra vez.
  relogio += 60_000;
  l.ecraNovo(); correr();
  assert.equal(enviados.length, 1);

  // Uma semana depois, renova-se.
  relogio += 8 * 24 * 3600 * 1000;
  l.ecraNovo(); correr();
  assert.equal(enviados.length, 2);
  assert.ok(loja.get(CHAVE_DO_LIVRO)?.includes("/pagar|movel"));

  // Dois ecrãs seguidos antes de a espera acabar: só o último conta.
  relogio += 8 * 24 * 3600 * 1000;
  l.ecraNovo(); l.ecraNovo(); correr();
  assert.equal(enviados.length, 3);

  l.desligar();
  relogio += 8 * 24 * 3600 * 1000;
  correr();
  assert.equal(enviados.length, 3);
});

test("uma captura por resolução: rodar o telemóvel ou estreitar a janela tira outra", () => {
  const { document } = parseHTML(PAGINA);
  const loja = new Map<string, string>();
  const enviados: string[] = [];
  const pendentes: Array<() => void> = [];
  let aoMudar: (() => void) | null = null;
  const janela = {
    innerWidth: 1280, innerHeight: 800,
    addEventListener: (nome: string, fn: () => void) => { if (nome === "resize") aoMudar = fn; },
    removeEventListener: (nome: string) => { if (nome === "resize") aoMudar = null; },
  };
  const l = ligarRetratos({
    janela, documento: document,
    armazenamento: { getItem: (k) => loja.get(k) ?? null, setItem: (k, v) => void loja.set(k, v) },
    agora: () => 1_000_000, ecra: () => "/pagar", versao: "1", leitor,
    permitido: () => true,
    enviar: async (corpo) => { enviados.push(corpo); },
    esperar: (fn) => { pendentes.push(fn); return 1; },
  });
  const correr = () => { while (pendentes.length) pendentes.shift()!(); };
  l.ecraNovo(); correr();
  assert.deepEqual(enviados.map((c) => JSON.parse(c).faixa), ["computador"]);

  // Dentro da mesma faixa não é um ecrã novo.
  janela.innerWidth = 1100; aoMudar!(); correr();
  assert.equal(enviados.length, 1);

  // Abaixo de 1024 é tablet, e abaixo de 600 é telemóvel: uma captura de cada.
  janela.innerWidth = 800; aoMudar!(); correr();
  janela.innerWidth = 390; janela.innerHeight = 844; aoMudar!(); correr();
  assert.deepEqual(enviados.map((c) => JSON.parse(c).faixa), ["computador", "tablet", "movel"]);
  assert.ok(loja.get(CHAVE_DO_LIVRO)?.includes("/pagar|tablet"));

  l.desligar();
  assert.equal(aoMudar, null, "desligar tira o ouvinte da janela");
});
