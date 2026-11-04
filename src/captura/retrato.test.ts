/**
 * A captura ofuscada (cartão 32.20, ADR 0062): o que sai do browser e o que nunca sai.
 *
 * O documento é o do `linkedom`, que não tem motor de desenho: as caixas e os estilos
 * vêm de um leitor de ensaio, que os lê de `data-caixa` (x,y,largura,altura em px) e
 * de um `style` simples. O que se prova é a ofuscação, e é isso que tem de ser
 * verdade em qualquer browser.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseHTML } from "linkedom";
import { corDe, faixaDe, ligarRetratos, retratar, CHAVE_DO_LIVRO, type Leitor } from "./retrato.ts";

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
};

// Um ecrã de pagamento com tudo o que não pode sair: o nome da pessoa, o saldo, o
// correio, o IBAN, a fotografia, o valor escrito num campo, um mapa, uma área marcada.
const PAGINA = `<!doctype html><html><body data-caixa="0,0,390,844" style="background-color: rgb(255, 255, 255)">
  <header data-caixa="0,0,390,60" style="background-color: rgb(31, 79, 209)">
    <h1 data-caixa="16,16,200,28" style="color: rgb(255, 255, 255)">Olá, Maria Joana Tavares</h1>
    <img data-caixa="330,10,40,40" src="/fotos/maria.jpg" alt="Maria Joana">
  </header>
  <p data-caixa="16,80,300,20">Saldo disponível: 12.400,50 Kz</p>
  <p data-caixa="16,104,300,20">maria.tavares@banco.ao · AO06 0040 0000 1234 5678 1011 2</p>
  <label data-caixa="16,140,200,18" style="font-size: 14px">Montante a pagar</label>
  <input data-caixa="16,160,358,44" type="text" value="250000" placeholder="ex.: 1000" style="border-top-width: 1px; border-top-color: rgb(200, 200, 200); border-top-left-radius: 8px">
  <input data-caixa="16,210,358,44" type="password" value="segredo123">
  <textarea data-caixa="16,260,358,80">Pagamento da renda de março, apartamento 3B</textarea>
  <select data-caixa="16,350,358,44"><option selected>Conta ordenado 0040123456789</option></select>
  <div data-caixa="16,400,358,40" contenteditable="true">nota privada</div>
  <div data-caixa="16,450,358,100" data-uxea-ocultar><button data-caixa="20,460,100,30">Ver PIN 4821</button></div>
  <div data-caixa="16,560,358,60" style="background-image: url(/cartao.png)"></div>
  <iframe data-caixa="16,630,358,80" src="https://mapas.exemplo/?q=Rua+da+Missao+12"></iframe>
  <button data-caixa="16,720,358,48" style="background-color: rgb(31, 79, 209); color: rgb(255, 255, 255); font-weight: 700; border-top-left-radius: 12px">Pagar 12.400 Kz agora</button>
  <input data-caixa="16,780,170,40" type="submit" value="Confirmar">
  <nav data-caixa="0,790,390,54" data-uxea-mostrar><a data-caixa="20,800,80,20" href="/inicio">Início</a></nav>
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
    "Maria", "Joana", "Tavares", "12.400", "12400", "400,50", "maria.tavares", "@banco", "AO06", "1234 5678",
    "250000", "ex.:", "segredo", "renda", "apartamento", "0040123456789", "Conta ordenado", "nota privada",
    "4821", "PIN", "maria.jpg", "/fotos", "cartao.png", "mapas.exemplo", "Missao", "inquérito", "Abaixo da dobra",
    "nao sai", "src", "href", "/inicio\"",
  ]) {
    assert.ok(!corpo.includes(proibido), `«${proibido}» saiu na captura`);
  }
});

test("campos, imagens, multimédia e áreas marcadas viram blocos sem conteúdo", () => {
  const r = captura();
  const tipos = (k: string) => r.nos.filter((n) => n.k === k);
  // Os dois inputs, a textarea, o select e o contenteditable.
  assert.equal(tipos("c").length, 5);
  for (const n of [...tipos("c"), ...tipos("i"), ...tipos("m"), ...tipos("o")]) assert.equal(n.tx, undefined, JSON.stringify(n));
  // A fotografia e o fundo com url(.
  assert.equal(tipos("i").length, 2);
  assert.equal(tipos("m").length, 1);
  // O campo guarda a forma: 16/390 de largura em permilagem, e o canto redondo.
  const montante = tipos("c")[0]!;
  assert.deepEqual([montante.x, montante.y, montante.l, montante.a], [41, 190, 918, 52]);
  assert.equal(montante.r, 8);
});

test("só os rótulos da interface ficam à vista, com os números mascarados", () => {
  const textos = captura().nos.filter((n) => n.k === "t").map((n) => n.tx);
  assert.deepEqual(textos.sort(), ["Confirmar", "Início", "Montante a pagar", "Pagar {numero} Kz agora"].sort());
  const botao = captura().nos.find((n) => n.tx === "Pagar {numero} Kz agora")!;
  assert.equal(botao.c, "#ffffff");
  assert.equal(botao.p, 700);
});

test("o texto tapado é uma barra que não diz quantas letras tinha", () => {
  const barras = captura().nos.filter((n) => n.k === "o");
  // O título, o saldo, o correio e a área marcada.
  assert.equal(barras.length, 4);
  const titulo = barras.find((b) => b.y === Math.round((16 / 844) * 1000))!;
  // 200 px arredondam a 240 (cinco degraus de 48): a largura da barra não é a do nome.
  assert.equal(titulo.l, Math.round((240 / 390) * 1000));
});

test("os blocos levam as cores, e o que está fora do visor não entra", () => {
  const r = captura();
  assert.equal(r.faixa, "movel");
  assert.equal(r.visor.largura, 390);
  assert.ok(r.nos.some((n) => n.k === "b" && n.f === "#1f4fd1"));
  assert.ok(r.nos.every((n) => n.y + n.a <= 1000 && n.x + n.l <= 1000));
  assert.equal(r.ofuscada, true);
  assert.match(r.assinatura, /^[0-9a-f]{8}$/);
});

test("a assinatura muda com a forma e não com o texto", () => {
  const a = captura().assinatura;
  const { document } = parseHTML(PAGINA.replace("Olá, Maria Joana Tavares", "Olá, Pedro"));
  const b = retratar({ documento: document, visor: { largura: 390, altura: 844 }, ecra: "/pagar", versao: "1", leitor })!;
  assert.equal(a, b.assinatura);
  const { document: d2 } = parseHTML(PAGINA.replace('data-caixa="16,720,358,48"', 'data-caixa="16,600,358,48"'));
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
