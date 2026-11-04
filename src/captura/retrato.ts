/**
 * A captura do ecrã, ofuscada no dispositivo. Cartões 32.20 e 32.22, ADR 0062 e 0063.
 *
 * O mapa de toques desenhava-se sobre um esquema de retângulos (cartão 9.2), e o
 * dono do produto pediu o ecrã a sério por baixo do calor. Isto dá-lho **sem
 * fotografar nada**: não há um pixel lido em lado nenhum (as guardas do
 * `sem-ecra.test.ts` continuam todas de pé). O que se copia é a **forma** do que
 * está à vista (a caixa de cada elemento, a cor, a borda, a letra) e o **texto da
 * página**, linha a linha, já mascarado. O que é da pessoa troca-se antes de existir
 * fora do browser:
 *
 *   c  um campo de escrita (input, textarea, select, contenteditable): um bloco,
 *      com a caixa do campo e mais nada. Nem o valor, nem o comprimento dele;
 *   i  uma imagem (img, picture, svg, fundo com `url(`): um retângulo do tamanho
 *      dela, com o texto alternativo por cima quando o tem. Substituída, e não
 *      borrada: um borrão leve ainda deixa ler uma cara ou um número;
 *   m  vídeo, áudio, canvas, iframe, objetos embebidos: um retângulo;
 *   o  texto tapado: uma barra, com a largura arredondada para cima a múltiplos de
 *      48 px. É o texto das **zonas da pessoa** (perfil, conta, avatar, morada, as
 *      marcas de privacidade das outras ferramentas e `data-uxea-ocultar`);
 *   t  uma linha de texto à vista, com a caixa dela e a máscara equilibrada por
 *      cima (`mascararCaptura`): correios, telefones, cartões, IBAN, NIF, números
 *      de documento, datas e o nome depois de um cumprimento saem como «•••»;
 *   b  um bloco com fundo ou borda, que é o que dá ao ecrã o aspeto dele.
 *
 * **Porque o texto passou a aparecer** (cartão 32.22, ADR 0063): com tudo tapado o
 * ecrã não se lia nem se entendia, e o dono do produto escolheu a 2026-11-04 o modo
 * equilibrado, o mesmo por omissão das ferramentas do género. O que fica sempre
 * tapado está nos ensaios de fuga do `retrato.test.ts`.
 *
 * **A página inteira, do topo ao fim, em píxeis da página** (cartão 32.23, ADR 0064).
 * Até à versão 2 só entrava o que estava à vista na janela, em permilagem dela, e o
 * dono do produto viu as páginas cortadas. Agora cada caixa é medida na página
 * (`pagina.ts`: o que o documento ou o rolante desceram, e os elementos fixos ancorados
 * no topo ou no fim), e cada toque leva a altura dele na página (`toque_pagina_y`),
 * para o calor cair no sítio certo mesmo depois de descer. O conteúdo de um contentor
 * com `overflow` fica preso à caixa dele, como no ecrã.
 */
import { resumo } from "../identity/mask.ts";
import { ATRIBUTO_FORA } from "./fora.ts";
import { MAXIMO_DA_PAGINA_PX, medirPagina, type MedidaDaPagina } from "./pagina.ts";

export const VERSAO_RETRATO = 3;
export const ATRIBUTO_OCULTAR = "data-uxea-ocultar";
/** Liberta uma zona que a heurística das zonas da pessoa tapava. A máscara continua. */
export const ATRIBUTO_MOSTRAR = "data-uxea-mostrar";
/** Uma página com mais do que isto é desenhada até aqui, e a captura diz que foi cortada. */
export const MAXIMO_DE_NOS = 6000;
export const MAXIMO_DE_TEXTO = 200;
/** A barra de um texto tapado cresce aos saltos, para não dizer o comprimento dele. */
export const DEGRAU_DA_BARRA_PX = 48;
/** Palavras medidas por captura, para partir o texto em linhas. Acima disto, uma linha por nó. */
export const MAXIMO_DE_PALAVRAS = 20000;
/** Elementos percorridos por captura, para uma árvore enorme não pesar na aplicação. */
export const MAXIMO_DE_ELEMENTOS = 60000;
export const TAPADO = "•••";

export type TipoDeNo = "b" | "t" | "o" | "c" | "i" | "m";

export interface NoDoRetrato {
  k: TipoDeNo;
  /** Caixa na página, em px (versão 3); até à 2 era em permilagem da janela. */
  x: number; y: number; l: number; a: number;
  /** Fundo, cor do texto e borda, em `#rrggbb` ou `#rrggbbaa`. */
  f?: string; c?: string; b?: string;
  /** Raio dos cantos e tamanho da letra, em px do visor; peso da letra. */
  r?: number; s?: number; p?: number;
  /** Família da letra quando não é sem serifa: `r` com serifa, `m` monoespaçada. */
  ff?: "r" | "m";
  /** Só nos `t`: a linha de texto, já mascarada. */
  tx?: string;
  /** Só nos `t`: é o texto alternativo de uma imagem, e desenha-se ao centro dela. */
  al?: 1;
}

export interface Retrato {
  v: number;
  /** A promessa de que isto passou pela ofuscação. A ingestão recusa sem ela. */
  ofuscada: true;
  screen_key: string;
  app_version: string;
  visor: { largura: number; altura: number };
  /** A página inteira: a altura dela em px, e se não coube toda na captura. */
  pagina: { altura: number; cortada?: true };
  faixa: "movel" | "tablet" | "computador";
  /** O desenho sem texto nenhum: muda quando o ecrã muda de forma. */
  assinatura: string;
  nos: NoDoRetrato[];
}

interface Caixa { x: number; y: number; l: number; a: number }
/** Uma linha de um nó de texto: a caixa dela e o pedaço do texto que lá cabe. */
export interface LinhaDeTexto extends Caixa { texto: string }

interface EstiloLido {
  display: string; visibility: string; opacity: string;
  backgroundColor: string; backgroundImage: string; color: string;
  borderTopWidth: string; borderTopColor: string; borderTopLeftRadius: string;
  fontSize: string; fontWeight: string; fontFamily: string; textTransform: string;
  position: string; overflow: string; overflowX: string; overflowY: string;
}

/** O que se lê do browser. Injetável, porque os ensaios não têm motor de desenho. */
export interface Leitor {
  caixa(el: any): Caixa | null;
  estilo(el: any): Partial<EstiloLido> | null;
  /** A caixa de um nó de texto, mais justa do que a do elemento. Opcional. */
  caixaDoTexto?(no: any): Caixa | null;
  /**
   * As linhas em que o browser partiu um nó de texto, com a caixa de cada uma.
   * `orcamento` é quantas palavras ainda se podem medir nesta captura. Opcional:
   * sem ele, o nó inteiro é uma linha.
   */
  linhas?(no: any, orcamento: { palavras: number }): LinhaDeTexto[] | null;
}

export function leitorDoBrowser(janela: any, documento: any): Leitor {
  const deRect = (r: any): Caixa | null =>
    r && r.width > 0 && r.height > 0 ? { x: r.left, y: r.top, l: r.width, a: r.height } : null;
  return {
    caixa: (el) => (typeof el?.getBoundingClientRect === "function" ? deRect(el.getBoundingClientRect()) : null),
    estilo: (el) => (typeof janela?.getComputedStyle === "function" ? janela.getComputedStyle(el) : null),
    caixaDoTexto: (no) => {
      if (typeof documento?.createRange !== "function") return null;
      const r = documento.createRange();
      r.selectNodeContents(no);
      return deRect(r.getBoundingClientRect());
    },
    linhas: (no, orcamento) => {
      if (typeof documento?.createRange !== "function") return null;
      const texto = String(no.textContent ?? "");
      const r = documento.createRange();
      const linhas: LinhaDeTexto[] = [];
      let atual: LinhaDeTexto | null = null;
      const re = /\S+\s*/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(texto)) !== null) {
        // Sem orçamento, o nó sai numa linha só: pior desenho, e nunca uma captura que pesa na aplicação.
        if (orcamento.palavras-- <= 0) return null;
        const fim = m.index + m[0].trimEnd().length;
        r.setStart(no, m.index);
        r.setEnd(no, fim);
        const caixas = r.getClientRects();
        const b = caixas && caixas.length > 0 ? caixas[0] : null;
        if (!b || !(b.width > 0) || !(b.height > 0)) continue;
        // A mesma linha é a que tem o topo a menos de meia letra da anterior.
        if (atual && Math.abs(b.top - atual.y) < b.height * 0.5) {
          const direita = Math.max(atual.x + atual.l, b.right);
          atual.x = Math.min(atual.x, b.left);
          atual.l = direita - atual.x;
          atual.a = Math.max(atual.a, b.height);
          atual.texto += m[0];
        } else {
          atual = { x: b.left, y: b.top, l: b.width, a: b.height, texto: m[0] };
          linhas.push(atual);
        }
      }
      return linhas;
    },
  };
}

export function faixaDe(largura: number): Retrato["faixa"] {
  return largura < 600 ? "movel" : largura < 1024 ? "tablet" : "computador";
}

/** `rgb(…)`/`rgba(…)` para `#rrggbb[aa]`; transparente dá vazio. */
export function corDe(css: string | undefined): string {
  const m = /rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)(?:[,\s/]+([\d.]+%?))?\s*\)/.exec(String(css ?? ""));
  if (!m) return /^#[0-9a-f]{6}$/i.test(String(css ?? "")) ? String(css).toLowerCase() : "";
  let alfa = m[4] === undefined ? 1 : m[4].endsWith("%") ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
  if (!(alfa > 0.02)) return "";
  alfa = Math.min(1, alfa);
  const h = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0");
  return "#" + h(+m[1]!) + h(+m[2]!) + h(+m[3]!) + (alfa < 0.99 ? h(alfa * 255) : "");
}

/* ----------------------------------------------------- a máscara equilibrada */

/**
 * O que sai sempre tapado de uma linha de texto à vista (ADR 0063). A ordem importa:
 * o mais específico primeiro, senão o telefone come o IBAN.
 *
 * **Os preços ficam à vista**, e é de propósito: «18 900 Kz» tem cinco dígitos, e um
 * catálogo sem preços não se entende. O que se tapa é o que identifica alguém: nove
 * dígitos ou mais seguidos (telefone, cartão, conta, NIF), um número de documento,
 * um correio, uma data, e o valor ao lado de «saldo».
 */
const MASCARA: ReadonlyArray<readonly [RegExp, string]> = [
  [/[^\s@<>()"',;:]+@[^\s@<>()"',;:]+\.[a-z]{2,}/gi, TAPADO],
  // IBAN e afins: duas letras, dois dígitos, e blocos de letras e dígitos.
  [/\b[A-Z]{2}\d{2}(?:[ ]?[A-Z0-9]{4}){2,8}(?:[ ]?[A-Z0-9]{1,4})?\b/g, TAPADO],
  // Um número de documento: letras e dígitos misturados, com seis dígitos seguidos ou mais.
  [/\b[A-Za-z]{0,3}\d{6,}[A-Za-z0-9]*\b/g, TAPADO],
  // Nove dígitos ou mais, com espaços, pontos, traços ou barras pelo meio.
  [/\+?\d(?:[\s.\-/]?\d){8,}/g, TAPADO],
  // Datas.
  [/\b\d{4}-\d{1,2}-\d{1,2}\b/g, TAPADO],
  [/\b\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}\b/g, TAPADO],
  // O valor ao lado de «saldo»: um preço é do catálogo, um saldo é da pessoa.
  [/\b(saldo|balance|dispon[ií]vel|available)(\s*[:\-]?\s*)(?:[A-Za-z$€£]{0,3}\s?)?\d(?:[\d\s.,]*\d)?(?:\s?(?:Kz|AOA|kz|€|\$|USD|EUR|R\$))?/gi, `$1$2${TAPADO}`],
];

/** «Olá, Maria Tavares»: fica o cumprimento, sai o nome. */
const CUMPRIMENTO = /^(\s*(?:ol[aá]|oi|bem[-\s]vind[oa]s?|hello|hi|hey|welcome|bom dia|boa tarde|boa noite|good (?:morning|afternoon|evening))[,!\s]+)(\S.{0,60})$/i;

export function mascararCaptura(texto: string): string {
  let saida = String(texto ?? "").replace(/\s+/g, " ").trim();
  if (!saida) return "";
  const c = CUMPRIMENTO.exec(saida);
  if (c) saida = c[1] + TAPADO;
  for (const [re, marcador] of MASCARA) saida = saida.replace(re, marcador);
  // Um código de letras e dígitos com três dígitos ou mais (encomenda, reserva, token):
  // um SKU do catálogo também cai aqui, e é o lado certo para errar.
  saida = saida.replace(/\b[A-Za-z0-9]{8,}\b/g, (t) => ((t.match(/\d/g)?.length ?? 0) >= 3 && /[A-Za-z]/.test(t) ? TAPADO : t));
  return saida.length > MAXIMO_DE_TEXTO ? saida.slice(0, MAXIMO_DE_TEXTO - 1) + "…" : saida;
}

/* ----------------------------------------------------- as zonas da pessoa */

/** As marcas de privacidade das outras ferramentas, que quem integra já pode ter posto. */
const ATRIBUTOS_PRIVADOS = ["data-private", "data-sensitive", "data-hj-suppress", "data-mask", "data-uxea-privado"];
const CLASSES_PRIVADAS = new Set([
  "ph-no-capture", "rr-mask", "rr-block", "fs-mask", "fs-exclude", "fs-block", "sentry-mask", "sentry-block",
  "hj-suppress", "data-hj-suppress", "private", "sensitive", "privado", "sensivel", "uxea-ocultar",
]);
/**
 * O nome de uma classe ou de um `id` que diz que a zona é da pessoa. Compostos, e não
 * palavras soltas: `product-name` é do catálogo, `user-name` é da pessoa. As exceções são
 * as palavras que sozinhas já são a zona da pessoa (`perfil`, `conta`, `profile`,
 * `account`): o ADR 0063 promete-as, e uma `<div class="perfil">` com o nome e a morada
 * passava inteira (encontrado ao verificar a 32.23).
 */
const NOME_PRIVADO = /^(perfil|profile|conta|account|minha-conta|my-account|a-minha-conta|dados-pessoais|personal-(?:data|info|details))$|(^|[-_])(avatar|e-?mail|correio|telefone|telemovel|phone|mobile-number|morada|address|endereco|saldo|balance|iban|nif|bi-numero)([-_]|$)|^(user|usuario|utilizador|cliente|customer|member|membro|account|conta|profile|perfil|me)[-_]?(name|nome|email|info|details|dados|data|card|cartao|menu|avatar|photo|foto|pic)$/i;
const ITEMPROP_PRIVADO = new Set(["email", "telephone", "address", "streetaddress", "givenname", "familyname", "birthdate", "taxid"]);

function classesDe(el: any): string[] {
  const c = el?.className;
  const texto = typeof c === "string" ? c : typeof c?.baseVal === "string" ? c.baseVal : String(atributo(el, "class") ?? "");
  return texto.split(/\s+/).filter(Boolean);
}

/** Este elemento, sozinho, é uma zona da pessoa? */
function zonaPrivada(el: any): boolean {
  if (temAtributo(el, ATRIBUTO_OCULTAR)) return true;
  if (temAtributo(el, "data-clarity-mask") && String(atributo(el, "data-clarity-mask")).toLowerCase() === "true") return true;
  for (const a of ATRIBUTOS_PRIVADOS) if (temAtributo(el, a)) return true;
  if (temAtributo(el, ATRIBUTO_MOSTRAR)) return false;
  const prop = String(atributo(el, "itemprop") ?? "").toLowerCase();
  if (prop && ITEMPROP_PRIVADO.has(prop)) return true;
  for (const c of classesDe(el)) {
    if (CLASSES_PRIVADAS.has(c.toLowerCase()) || NOME_PRIVADO.test(c)) return true;
  }
  const id = String(atributo(el, "id") ?? "");
  return !!id && NOME_PRIVADO.test(id);
}

/* ---------------------------------------------------------------- o desenho */

const SALTAR = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE", "HEAD", "META", "LINK", "TITLE", "BR", "WBR"]);
const IMAGENS = new Set(["IMG", "PICTURE", "SVG"]);
const MULTIMEDIA = new Set(["VIDEO", "AUDIO", "CANVAS", "IFRAME", "OBJECT", "EMBED", "MAP"]);
const CAMPOS = new Set(["TEXTAREA", "SELECT", "DATALIST", "OUTPUT"]);
const BOTOES_INPUT = new Set(["submit", "button", "reset"]);
/** Uma imagem mais pequena do que isto é um ícone, e não leva texto alternativo por cima. */
const ICONE_PX = 40;

function nomeDe(el: any): string {
  return String(el?.tagName ?? "").toUpperCase();
}

function atributo(el: any, nome: string): string | null {
  return typeof el?.getAttribute === "function" ? el.getAttribute(nome) : null;
}

function temAtributo(el: any, nome: string): boolean {
  return typeof el?.hasAttribute === "function" ? el.hasAttribute(nome) : atributo(el, nome) !== null;
}

function px(v: string | undefined): number {
  const n = parseFloat(String(v ?? ""));
  return Number.isFinite(n) ? n : 0;
}

/** Onde um elemento cai na página: o que se soma à caixa dele na janela, e o recorte. */
interface Lugar { ox: number; oy: number; corte: Caixa | null }

const OVERFLOW_QUE_CORTA = new Set(["hidden", "auto", "scroll", "clip", "overlay"]);

/**
 * Monta a captura da página inteira. Puro: não envia nada nem guarda nada.
 *
 * `pagina` é a medida do `pagina.ts`; sem ela, a página é a janela (os ensaios, e um
 * documento que não desce). Devolve `null` quando não há visor (um documento sem
 * janela, um separador a fechar): melhor não desenhar do que desenhar um ecrã de zero
 * por zero.
 */
export function retratar(entrada: {
  documento: any;
  visor: { largura: number; altura: number };
  pagina?: Pick<MedidaDaPagina, "altura" | "dx" | "dy" | "rolante" | "cortada">;
  ecra: string;
  versao: string;
  leitor: Leitor;
}): Retrato | null {
  const { documento, visor, leitor } = entrada;
  const W = Math.round(visor.largura), H = Math.round(visor.altura);
  if (!(W > 0) || !(H > 0) || !documento?.body) return null;
  const P = Math.max(H, Math.min(MAXIMO_DA_PAGINA_PX, Math.round(entrada.pagina?.altura ?? H)));
  const rolante = entrada.pagina?.rolante ?? null;
  let cortada = !!entrada.pagina?.cortada;

  const nos: NoDoRetrato[] = [];
  const orcamento = { palavras: MAXIMO_DE_PALAVRAS };
  // A caixa na página: a da janela mais o deslocamento do lugar, presa à página e ao
  // recorte do contentor. Píxeis inteiros.
  const naPagina = (c: Caixa, lugar: Lugar): Caixa | null => {
    let x0 = c.x + lugar.ox, y0 = c.y + lugar.oy, x1 = x0 + c.l, y1 = y0 + c.a;
    x0 = Math.max(0, x0); y0 = Math.max(0, y0); x1 = Math.min(W, x1); y1 = Math.min(P, y1);
    if (lugar.corte) {
      const k = lugar.corte;
      x0 = Math.max(x0, k.x); y0 = Math.max(y0, k.y); x1 = Math.min(x1, k.x + k.l); y1 = Math.min(y1, k.y + k.a);
    }
    if (x1 - x0 < 1 || y1 - y0 < 1) return null;
    // Arredondam-se as pontas, e não a largura: assim a caixa nunca passa da página.
    const x = Math.round(x0), y = Math.round(y0);
    return { x, y, l: Math.max(1, Math.round(x1) - x), a: Math.max(1, Math.round(y1) - y) };
  };
  const juntar = (k: TipoDeNo, c: Caixa, lugar: Lugar, extra: Partial<NoDoRetrato> = {}): boolean => {
    if (nos.length >= MAXIMO_DE_NOS) { cortada = true; return false; }
    const p = naPagina(c, lugar);
    if (!p) return true;
    // Uma linha de texto que um contentor cortou a menos de metade não se lê no ecrã, e
    // desenhada numa caixa de 1 px saía como uma letra inteira por cima do que está ao lado.
    if (k === "t" && p.a < c.a / 2) return true;
    nos.push({ k, ...p, ...extra });
    return true;
  };
  const tapado = (k: TipoDeNo, c: Caixa, lugar: Lugar, e: Partial<EstiloLido> | null) =>
    juntar(k, c, lugar, {
      ...(px(e?.borderTopLeftRadius) > 0 ? { r: Math.min(64, Math.round(px(e?.borderTopLeftRadius))) } : {}),
    });
  const barra = (c: Caixa, lugar: Lugar) =>
    // Presa à página e ao recorte, e não à caixa do elemento: presa ao elemento, um
    // título do tamanho do nome voltava a dizer o tamanho do nome.
    juntar("o", { ...c, l: Math.ceil(c.l / DEGRAU_DA_BARRA_PX) * DEGRAU_DA_BARRA_PX }, lugar);

  // O fundo da página, primeiro e por baixo de tudo, do topo ao fim: sem ele, uma
  // página escura desenhava-se branca, e o texto claro dela deixava de se ver.
  const raiz = documento.documentElement;
  const fundo = corDe(leitor.estilo(documento.body)?.backgroundColor) || (raiz ? corDe(leitor.estilo(raiz)?.backgroundColor) : "");
  const pagina: Lugar = { ox: entrada.pagina?.dx ?? 0, oy: entrada.pagina?.dy ?? 0, corte: null };
  if (fundo) juntar("b", { x: 0, y: 0, l: W, a: P }, { ox: 0, oy: 0, corte: null }, { f: fundo });

  // Em profundidade e pela ordem do documento, que é a ordem em que o browser pinta
  // na grande maioria dos ecrãs. Uma pilha à mão, e não recursão: uma árvore funda
  // não pode rebentar a pilha da aplicação anfitriã. Cada entrada leva se está dentro
  // de uma zona da pessoa e o lugar na página, para não ter de subir a árvore a cada nó.
  const pilha: Array<[any, boolean, Lugar]> = [[documento.body, false, pagina]];
  let visitados = 0;
  while (pilha.length > 0 && nos.length < MAXIMO_DE_NOS) {
    if (visitados >= MAXIMO_DE_ELEMENTOS) { cortada = true; break; }
    const [el, privadoAcima, acima] = pilha.pop()!;
    visitados++;
    if (!el || el.nodeType !== 1) continue;
    const nome = nomeDe(el);
    if (SALTAR.has(nome)) continue;
    if (temAtributo(el, ATRIBUTO_FORA)) continue;
    const e = leitor.estilo(el);
    if (e && (e.display === "none" || e.visibility === "hidden" || e.visibility === "collapse" || e.opacity === "0")) continue;
    const naJanela = leitor.caixa(el);
    // Um elemento fixo desenha-se no topo da página, ou no fim quando está na metade
    // de baixo da janela; os filhos vão com ele.
    const lugar: Lugar = e?.position === "fixed"
      ? { ox: 0, oy: naJanela && naJanela.y > H / 2 ? P - H : 0, corte: null }
      : acima;
    // O rolante desenha-se com a altura do conteúdo, e não só a da janela.
    const caixa = naJanela && el === rolante
      ? { ...naJanela, a: Math.max(naJanela.a, P - (naJanela.y + lugar.oy)) }
      : naJanela;
    if (caixa && !naPagina(caixa, lugar)) continue;
    // `data-uxea-ocultar` ganha sempre, até dentro de uma zona libertada.
    const privado = temAtributo(el, ATRIBUTO_OCULTAR) || (privadoAcima && !temAtributo(el, ATRIBUTO_MOSTRAR)) || zonaPrivada(el);

    if (nome === "INPUT") {
      const tipo = String(atributo(el, "type") ?? "text").toLowerCase();
      if (tipo === "hidden" || !caixa) continue;
      if (BOTOES_INPUT.has(tipo)) {
        // Um botão feito de `input`: o rótulo é o `value`, e é da interface.
        juntar("b", caixa, lugar, estiloDoBloco(e));
        const tx = privado ? "" : mascararCaptura(String(atributo(el, "value") ?? ""));
        if (tx) juntar("t", caixa, lugar, { tx, ...estiloDoTexto(e) });
        else if (privado) barra(caixa, lugar);
        continue;
      }
      tapado("c", caixa, lugar, e);
      continue;
    }
    if (CAMPOS.has(nome) || (el.isContentEditable === true) || atributo(el, "contenteditable") === "true") {
      if (caixa) tapado("c", caixa, lugar, e);
      continue;
    }
    if (IMAGENS.has(nome)) {
      if (caixa) {
        tapado("i", caixa, lugar, e);
        // O texto alternativo diz o que lá está («Café de Amboim»), e passa pela mesma
        // máscara. Numa zona da pessoa, ou num ícone, não leva nada: o `alt` de um avatar
        // é o nome de quem lá está.
        if (!privado && caixa.l >= ICONE_PX && caixa.a >= ICONE_PX) {
          const alt = mascararCaptura(String(atributo(el, "alt") ?? atributo(el, "aria-label") ?? atributo(el, "title") ?? ""));
          if (alt) juntar("t", caixa, lugar, { tx: alt, al: 1, s: 12 });
        }
      }
      continue;
    }
    if (MULTIMEDIA.has(nome)) { if (caixa) tapado("m", caixa, lugar, e); continue; }

    if (caixa) {
      if (/url\(/i.test(String(e?.backgroundImage ?? ""))) tapado("i", caixa, lugar, e);
      else {
        const bloco = estiloDoBloco(e);
        if (bloco.f || bloco.b) juntar("b", caixa, lugar, bloco);
      }
    }

    // O texto deste elemento: só os nós de texto diretos, um por um, e cada um partido
    // nas linhas em que o browser o partiu. Uma linha por nó desenhava um parágrafo
    // inteiro numa linha só, espremido até não se ler.
    const filhos = el.childNodes ?? [];
    const estiloTexto = estiloDoTexto(e);
    const maiusculas = String(e?.textTransform ?? "") === "uppercase";
    let cheio = false;
    for (let i = 0; i < filhos.length && !cheio; i++) {
      const f = filhos[i];
      if (f?.nodeType !== 3) continue;
      const bruto = String(f.textContent ?? "");
      if (!bruto.trim()) continue;
      const linhas = leitor.linhas?.(f, orcamento) ?? null;
      const partes: LinhaDeTexto[] = linhas && linhas.length > 0
        ? linhas
        : (() => { const cx = leitor.caixaDoTexto?.(f) ?? caixa; return cx ? [{ ...cx, texto: bruto }] : []; })();
      for (const linha of partes) {
        if (privado) { if (!barra(linha, lugar)) { cheio = true; break; } continue; }
        let tx = mascararCaptura(linha.texto);
        if (maiusculas) tx = tx.toUpperCase();
        if (tx && !juntar("t", linha, lugar, { tx, ...estiloTexto })) { cheio = true; break; }
      }
    }

    // O lugar dos filhos: o conteúdo do rolante desce com ele, e um contentor com
    // `overflow` corta o que lhe sai da caixa, como no ecrã (uma lista que desce lá
    // dentro desenhava-se por cima do resto da página). O corpo e a raiz não cortam:
    // são a página.
    let lugarDosFilhos = lugar;
    if (el === rolante) {
      lugarDosFilhos = { ...lugar, oy: lugar.oy + Math.round(px(String(el.scrollTop ?? 0))), corte: lugar.corte };
    } else if (naJanela && nome !== "BODY" && nome !== "HTML" && e
      && [e.overflow, e.overflowX, e.overflowY].some((o) => OVERFLOW_QUE_CORTA.has(String(o ?? "")))) {
      const k = naPagina(naJanela, lugar);
      if (k) lugarDosFilhos = { ...lugar, corte: k };
    }
    // Os filhos entram ao contrário na pilha, para saírem pela ordem do documento.
    const elementos = el.children ?? [];
    for (let i = elementos.length - 1; i >= 0; i--) pilha.push([elementos[i], privado, lugarDosFilhos]);
  }
  if (pilha.length > 0) cortada = true;

  // A assinatura é a forma, sem texto nenhum: dois clientes com nomes diferentes no
  // mesmo ecrã dão a mesma, e o ecrã não volta a sair por causa disso.
  // Em degraus de 40 px: um texto que muda de tamanho meia letra não é um ecrã novo.
  const forma = nos.map((n) => `${n.k}${Math.round(n.x / 40)},${Math.round(n.y / 40)},${Math.round(n.l / 40)},${Math.round(n.a / 40)}`).join(";");
  return {
    v: VERSAO_RETRATO,
    ofuscada: true,
    screen_key: String(entrada.ecra).slice(0, 256),
    app_version: String(entrada.versao).slice(0, 64),
    visor: { largura: W, altura: H },
    pagina: { altura: P, ...(cortada ? { cortada: true as const } : {}) },
    faixa: faixaDe(W),
    assinatura: resumo(`v${VERSAO_RETRATO}|${faixaDe(W)}|${forma}`),
    nos,
  };
}

function estiloDoBloco(e: Partial<EstiloLido> | null): Partial<NoDoRetrato> {
  const f = corDe(e?.backgroundColor);
  const borda = px(e?.borderTopWidth) > 0 ? corDe(e?.borderTopColor) : "";
  const r = Math.min(64, Math.round(px(e?.borderTopLeftRadius)));
  return { ...(f ? { f } : {}), ...(borda ? { b: borda } : {}), ...(r > 0 ? { r } : {}) };
}

function familiaDe(css: string | undefined): NoDoRetrato["ff"] | undefined {
  const f = String(css ?? "").toLowerCase();
  if (/mono|courier|consolas|menlo/.test(f)) return "m";
  // A primeira família da lista é a que o browser usa quando a tem.
  const primeira = f.split(",")[0]?.trim() ?? "";
  if (/serif/.test(primeira) && !/sans/.test(primeira)) return "r";
  if (/georgia|times|garamond|playfair|merriweather|lora/.test(primeira)) return "r";
  return undefined;
}

function estiloDoTexto(e: Partial<EstiloLido> | null): Partial<NoDoRetrato> {
  const c = corDe(e?.color);
  const s = Math.min(96, Math.round(px(e?.fontSize)));
  const p = Math.round(px(e?.fontWeight));
  const ff = familiaDe(e?.fontFamily);
  return { ...(c ? { c } : {}), ...(s > 0 ? { s } : {}), ...(p >= 600 ? { p } : {}), ...(ff ? { ff } : {}) };
}

/* -------------------------------------------------------------- o envio */

/** Onde se guarda o que já se enviou, por ecrã e faixa. Nada do ecrã, só a assinatura. */
export const CHAVE_DO_LIVRO = "uxea.retratos";
/** O mesmo desenho volta a sair ao fim de uma semana, para a captura não envelhecer. */
export const RENOVAR_MS = 7 * 24 * 3600 * 1000;
/** Um desenho que mudou não sai mais do que uma vez por hora: há ecrãs que mudam sempre. */
export const INTERVALO_MINIMO_MS = 3600 * 1000;
/** Espera depois de o ecrã abrir, para o desenho assentar (carregamentos, animações). */
export const ESPERA_MS = 2500;
/** Quanto a janela tem de estar parada, depois de mudar de tamanho, para contar. */
export const ESPERA_DO_TAMANHO_MS = 1500;

export interface LigacaoDeRetratos {
  ecraNovo(): void;
  desligar(): void;
}

export function ligarRetratos(o: {
  janela: any;
  documento: any;
  armazenamento: { getItem(k: string): string | null; setItem(k: string, v: string): void } | null;
  agora(): number;
  ecra(): string;
  versao: string;
  /** Rastreio individual ligado, captura não desligada pela aplicação, na amostra. */
  permitido(): boolean;
  enviar(corpo: string): Promise<unknown>;
  leitor?: Leitor;
  /** Só para ensaios: o relógio dos temporizadores. */
  esperar?(fn: () => void, ms: number): unknown;
}): LigacaoDeRetratos {
  let temporizador: any = null;
  let geracao = 0;
  const esperar = o.esperar ?? ((fn: () => void, ms: number) =>
    typeof o.janela?.setTimeout === "function" ? o.janela.setTimeout(fn, ms) : null);
  const livre = (fn: () => void) => {
    // Fora do caminho da aplicação: quando o browser não tem mais nada para fazer.
    if (typeof o.janela?.requestIdleCallback === "function") o.janela.requestIdleCallback(fn, { timeout: 4000 });
    else fn();
  };

  const tirar = (minha: number, ecra: string) => {
    if (minha !== geracao || ecra !== o.ecra()) return;
    if (!o.permitido()) return;
    if (o.documento?.visibilityState === "hidden") return;
    const visor = {
      largura: Number(o.janela?.innerWidth ?? 0),
      altura: Number(o.janela?.innerHeight ?? 0),
    };
    const r = retratar({
      documento: o.documento, visor, pagina: medirPagina(o.janela, o.documento), ecra, versao: o.versao,
      leitor: o.leitor ?? leitorDoBrowser(o.janela, o.documento),
    });
    if (!r || r.nos.length === 0) return;
    const chave = `${ecra}|${r.faixa}`;
    let livro: Record<string, [string, number]> = {};
    try { livro = JSON.parse(o.armazenamento?.getItem(CHAVE_DO_LIVRO) ?? "{}") ?? {}; } catch { livro = {}; }
    const agora = o.agora();
    const antes = livro[chave];
    if (antes) {
      const [assinatura, em] = antes;
      if (assinatura === r.assinatura && agora - em < RENOVAR_MS) return;
      if (assinatura !== r.assinatura && agora - em < INTERVALO_MINIMO_MS) return;
    }
    livro[chave] = [r.assinatura, agora];
    // O livro não cresce sem fim: ficam os duzentos mais recentes.
    const entradas = Object.entries(livro).sort((a, b) => b[1][1] - a[1][1]).slice(0, 200);
    try { o.armazenamento?.setItem(CHAVE_DO_LIVRO, JSON.stringify(Object.fromEntries(entradas))); } catch { /* sem livro, volta a sair */ }
    void o.enviar(JSON.stringify(r)).catch(() => { /* uma captura perdida não se repete à pressa */ });
  };

  // **Uma captura por resolução** (cartão 32.22): quem roda o telemóvel ou estreita a
  // janela do computador muda de faixa, e o ecrã nessa faixa é outro desenho. Espera
  // que a janela pare de mudar, e só volta a tirar quando a faixa mudou de facto: um
  // redimensionamento dentro da mesma faixa não é um ecrã novo.
  let faixaVista = faixaDe(Number(o.janela?.innerWidth ?? 0));
  let esperaDoTamanho: any = null;
  const aoMudarDeTamanho = () => {
    if (esperaDoTamanho !== null && typeof o.janela?.clearTimeout === "function") o.janela.clearTimeout(esperaDoTamanho);
    esperaDoTamanho = esperar(() => {
      esperaDoTamanho = null;
      const agora = faixaDe(Number(o.janela?.innerWidth ?? 0));
      if (agora !== faixaVista) { faixaVista = agora; ligacao.ecraNovo(); }
    }, ESPERA_DO_TAMANHO_MS);
  };
  // Um browser que recusa ouvintes (CSP, extensão) fica sem a nova captura ao mudar de
  // tamanho, e a aplicação segue: o erro não sobe para a anfitriã.
  try {
    if (typeof o.janela?.addEventListener === "function") o.janela.addEventListener("resize", aoMudarDeTamanho, { passive: true });
  } catch { /* fica a captura do primeiro tamanho */ }

  const ligacao: LigacaoDeRetratos = {
    ecraNovo() {
      faixaVista = faixaDe(Number(o.janela?.innerWidth ?? 0));
      geracao++;
      const minha = geracao;
      const ecra = o.ecra();
      if (temporizador !== null && typeof o.janela?.clearTimeout === "function") o.janela.clearTimeout(temporizador);
      temporizador = esperar(() => livre(() => {
        try { tirar(minha, ecra); } catch { /* a captura nunca parte a aplicação */ }
      }), ESPERA_MS);
    },
    desligar() {
      geracao++;
      if (temporizador !== null && typeof o.janela?.clearTimeout === "function") o.janela.clearTimeout(temporizador);
      if (esperaDoTamanho !== null && typeof o.janela?.clearTimeout === "function") o.janela.clearTimeout(esperaDoTamanho);
      temporizador = null;
      esperaDoTamanho = null;
      try {
        if (typeof o.janela?.removeEventListener === "function") o.janela.removeEventListener("resize", aoMudarDeTamanho);
      } catch { /* nada a desligar */ }
    },
  };
  return ligacao;
}
