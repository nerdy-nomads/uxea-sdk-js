/**
 * A captura do ecrã, ofuscada no dispositivo. Cartão 32.20, ADR 0062.
 *
 * O mapa de toques desenhava-se sobre um esquema de retângulos (cartão 9.2), e o
 * dono do produto pediu o ecrã a sério por baixo do calor. Isto dá-lho **sem
 * fotografar nada**: não há um pixel lido em lado nenhum (as guardas do
 * `sem-ecra.test.ts` continuam todas de pé). O que se copia é a **forma** do que
 * está à vista: a caixa de cada elemento, a cor de fundo, a borda, o tamanho da
 * letra. O conteúdo troca-se antes de existir fora do browser:
 *
 *   c  um campo de escrita (input, textarea, select, contenteditable): um bloco,
 *      com a caixa do campo e mais nada. Nem o valor, nem o comprimento dele, nem
 *      o texto de ajuda;
 *   i  uma imagem (img, picture, svg, fundo com `url(`): um retângulo do tamanho
 *      dela. Em vez de borrada, substituída, porque um borrão leve ainda deixa ler
 *      uma cara ou um número, e o retângulo não deixa nada;
 *   m  vídeo, áudio, canvas, iframe, objetos embebidos: um retângulo;
 *   o  texto tapado: uma barra, com a largura arredondada para cima a múltiplos de
 *      48 px, para a barra não dizer quantas letras tinha o nome;
 *   t  texto à vista: **só os rótulos da interface** (botões, etiquetas, legendas,
 *      cabeçalhos de tabela, separadores) e o que a instituição marcou com
 *      `data-uxea-mostrar`, e mesmo esses passam pela máscara dos números, das
 *      datas, das horas e dos correios (`mascarar`, a mesma das mensagens);
 *   b  um bloco com fundo ou borda, que é o que dá ao ecrã o aspeto dele.
 *
 * `data-uxea-ocultar` tapa um elemento e tudo o que está dentro dele, sempre, até
 * um botão. `data-uxea-ignorar` (o componente dos inquéritos) fica de fora.
 *
 * **As coordenadas são da janela, em permilagem**, como os toques (`toque_x` é da
 * janela, cartão 9.1): é o que faz o calor cair em cima do elemento certo, num
 * telemóvel e num computador. Por isso só entra o que está à vista no visor.
 */
import { mascarar, resumo } from "../identity/mask.ts";
import { ATRIBUTO_FORA } from "./fora.ts";

export const VERSAO_RETRATO = 1;
export const ATRIBUTO_OCULTAR = "data-uxea-ocultar";
export const ATRIBUTO_MOSTRAR = "data-uxea-mostrar";
/** Um ecrã com mais do que isto é desenhado até aqui: o resto é ruído para um mapa. */
export const MAXIMO_DE_NOS = 1500;
export const MAXIMO_DE_TEXTO = 80;
/** A barra de um texto tapado cresce aos saltos, para não dizer o comprimento dele. */
export const DEGRAU_DA_BARRA_PX = 48;

export type TipoDeNo = "b" | "t" | "o" | "c" | "i" | "m";

export interface NoDoRetrato {
  k: TipoDeNo;
  /** Caixa na janela, em permilagem (0 a 1000). */
  x: number; y: number; l: number; a: number;
  /** Fundo, cor do texto e borda, em `#rrggbb` ou `#rrggbbaa`. */
  f?: string; c?: string; b?: string;
  /** Raio dos cantos e tamanho da letra, em px do visor; peso da letra. */
  r?: number; s?: number; p?: number;
  /** Só nos `t`: o rótulo, já mascarado. */
  tx?: string;
}

export interface Retrato {
  v: number;
  /** A promessa de que isto passou pela ofuscação. A ingestão recusa sem ela. */
  ofuscada: true;
  screen_key: string;
  app_version: string;
  visor: { largura: number; altura: number };
  faixa: "movel" | "tablet" | "computador";
  /** O desenho sem texto nenhum: muda quando o ecrã muda de forma. */
  assinatura: string;
  nos: NoDoRetrato[];
}

interface Caixa { x: number; y: number; l: number; a: number }

interface EstiloLido {
  display: string; visibility: string; opacity: string;
  backgroundColor: string; backgroundImage: string; color: string;
  borderTopWidth: string; borderTopColor: string; borderTopLeftRadius: string;
  fontSize: string; fontWeight: string;
}

/** O que se lê do browser. Injetável, porque os ensaios não têm motor de desenho. */
export interface Leitor {
  caixa(el: any): Caixa | null;
  estilo(el: any): Partial<EstiloLido> | null;
  /** A caixa de um nó de texto, mais justa do que a do elemento. Opcional. */
  caixaDoTexto?(no: any): Caixa | null;
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

const SALTAR = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE", "HEAD", "META", "LINK", "TITLE", "BR", "WBR"]);
const IMAGENS = new Set(["IMG", "PICTURE", "SVG"]);
const MULTIMEDIA = new Set(["VIDEO", "AUDIO", "CANVAS", "IFRAME", "OBJECT", "EMBED", "MAP"]);
const CAMPOS = new Set(["TEXTAREA", "SELECT", "DATALIST", "OUTPUT"]);
/** Onde o texto é da interface, e não dos dados: o que a pessoa lê para saber o que fazer. */
const ROTULOS = new Set(["BUTTON", "LABEL", "LEGEND", "SUMMARY", "TH", "CAPTION"]);
const PAPEIS_DE_ROTULO = new Set(["button", "tab", "menuitem", "menuitemradio", "menuitemcheckbox", "columnheader", "switch"]);
const BOTOES_INPUT = new Set(["submit", "button", "reset"]);

function nomeDe(el: any): string {
  return String(el?.tagName ?? "").toUpperCase();
}

function atributo(el: any, nome: string): string | null {
  return typeof el?.getAttribute === "function" ? el.getAttribute(nome) : null;
}

function temAtributo(el: any, nome: string): boolean {
  return typeof el?.hasAttribute === "function" ? el.hasAttribute(nome) : atributo(el, nome) !== null;
}

/** O texto deste elemento pode ficar à vista? Sobe até seis níveis à procura de um rótulo. */
function textoAVista(el: any): boolean {
  let no = el;
  for (let i = 0; i < 6 && no && no.nodeType === 1; i++) {
    if (temAtributo(no, ATRIBUTO_OCULTAR)) return false;
    if (temAtributo(no, ATRIBUTO_MOSTRAR)) return true;
    if (ROTULOS.has(nomeDe(no))) return true;
    const papel = atributo(no, "role");
    if (papel && PAPEIS_DE_ROTULO.has(papel)) return true;
    no = no.parentElement;
  }
  return false;
}

function rotulo(texto: string): string {
  const limpo = mascarar(String(texto).replace(/\s+/g, " ").trim());
  return limpo.length > MAXIMO_DE_TEXTO ? limpo.slice(0, MAXIMO_DE_TEXTO - 1) + "…" : limpo;
}

function px(v: string | undefined): number {
  const n = parseFloat(String(v ?? ""));
  return Number.isFinite(n) ? n : 0;
}

/**
 * Monta a captura do que está à vista. Puro: não envia nada nem guarda nada.
 *
 * Devolve `null` quando não há visor (um documento sem janela, um separador a
 * fechar): melhor não desenhar do que desenhar um ecrã de zero por zero.
 */
export function retratar(entrada: {
  documento: any;
  visor: { largura: number; altura: number };
  ecra: string;
  versao: string;
  leitor: Leitor;
}): Retrato | null {
  const { documento, visor, leitor } = entrada;
  const W = Math.round(visor.largura), H = Math.round(visor.altura);
  if (!(W > 0) || !(H > 0) || !documento?.body) return null;

  const nos: NoDoRetrato[] = [];
  const pm = (c: Caixa): Caixa | null => {
    const x0 = Math.max(0, c.x), y0 = Math.max(0, c.y);
    const x1 = Math.min(W, c.x + c.l), y1 = Math.min(H, c.y + c.a);
    if (x1 - x0 < 1 || y1 - y0 < 1) return null;
    const q = (v: number, t: number) => Math.max(0, Math.min(1000, Math.round((v / t) * 1000)));
    return { x: q(x0, W), y: q(y0, H), l: Math.max(1, q(x1 - x0, W)), a: Math.max(1, q(y1 - y0, H)) };
  };
  const juntar = (k: TipoDeNo, c: Caixa, extra: Partial<NoDoRetrato> = {}): boolean => {
    if (nos.length >= MAXIMO_DE_NOS) return false;
    const p = pm(c);
    if (!p) return true;
    nos.push({ k, ...p, ...extra });
    return true;
  };
  const tapado = (k: TipoDeNo, c: Caixa, e: Partial<EstiloLido> | null) =>
    juntar(k, c, {
      ...(px(e?.borderTopLeftRadius) > 0 ? { r: Math.min(64, Math.round(px(e?.borderTopLeftRadius))) } : {}),
    });

  // Em profundidade e pela ordem do documento, que é a ordem em que o browser pinta
  // na grande maioria dos ecrãs. Uma pilha à mão, e não recursão: uma árvore funda
  // não pode rebentar a pilha da aplicação anfitriã.
  const pilha: any[] = [documento.body];
  let visitados = 0;
  while (pilha.length > 0 && nos.length < MAXIMO_DE_NOS && visitados < 20000) {
    const el = pilha.pop();
    visitados++;
    if (!el || el.nodeType !== 1) continue;
    const nome = nomeDe(el);
    if (SALTAR.has(nome)) continue;
    if (temAtributo(el, ATRIBUTO_FORA)) continue;
    const e = leitor.estilo(el);
    if (e && (e.display === "none" || e.visibility === "hidden" || e.visibility === "collapse" || e.opacity === "0")) continue;
    const caixa = leitor.caixa(el);
    const fora = caixa && (caixa.y >= H || caixa.y + caixa.a <= 0 || caixa.x >= W || caixa.x + caixa.l <= 0);
    if (fora) continue;

    if (caixa && temAtributo(el, ATRIBUTO_OCULTAR)) { tapado("o", caixa, e); continue; }

    if (nome === "INPUT") {
      const tipo = String(atributo(el, "type") ?? "text").toLowerCase();
      if (tipo === "hidden" || !caixa) continue;
      if (BOTOES_INPUT.has(tipo) && !temAtributo(el, ATRIBUTO_OCULTAR)) {
        // Um botão feito de `input`: o rótulo é o `value`, e é da interface.
        juntar("b", caixa, estiloDoBloco(e));
        const tx = rotulo(String(atributo(el, "value") ?? ""));
        if (tx) juntar("t", caixa, { tx, ...estiloDoTexto(e) });
        continue;
      }
      tapado("c", caixa, e);
      continue;
    }
    if (CAMPOS.has(nome) || (el.isContentEditable === true) || atributo(el, "contenteditable") === "true") {
      if (caixa) tapado("c", caixa, e);
      continue;
    }
    if (IMAGENS.has(nome)) { if (caixa) tapado("i", caixa, e); continue; }
    if (MULTIMEDIA.has(nome)) { if (caixa) tapado("m", caixa, e); continue; }

    if (caixa) {
      if (/url\(/i.test(String(e?.backgroundImage ?? ""))) tapado("i", caixa, e);
      else {
        const bloco = estiloDoBloco(e);
        if (bloco.f || bloco.b) juntar("b", caixa, bloco);
      }
    }

    // O texto deste elemento: só os nós de texto diretos, um por um.
    const filhos = el.childNodes ?? [];
    const aVista = textoAVista(el);
    for (let i = 0; i < filhos.length; i++) {
      const f = filhos[i];
      if (f?.nodeType !== 3) continue;
      const bruto = String(f.textContent ?? "");
      if (!bruto.trim()) continue;
      const cx = leitor.caixaDoTexto?.(f) ?? caixa;
      if (!cx) continue;
      if (aVista) {
        const tx = rotulo(bruto);
        if (tx && !juntar("t", cx, { tx, ...estiloDoTexto(e) })) break;
      } else {
        // Presa ao visor (o `pm` corta) e não à caixa do elemento: presa ao elemento,
        // um título do tamanho do nome voltava a dizer o tamanho do nome.
        const largura = Math.ceil(cx.l / DEGRAU_DA_BARRA_PX) * DEGRAU_DA_BARRA_PX;
        if (!juntar("o", { ...cx, l: largura })) break;
      }
    }

    // Os filhos entram ao contrário na pilha, para saírem pela ordem do documento.
    const elementos = el.children ?? [];
    for (let i = elementos.length - 1; i >= 0; i--) pilha.push(elementos[i]);
  }

  const forma = nos.map((n) => `${n.k}${Math.round(n.x / 20)},${Math.round(n.y / 20)},${Math.round(n.l / 20)},${Math.round(n.a / 20)}`).join(";");
  return {
    v: VERSAO_RETRATO,
    ofuscada: true,
    screen_key: String(entrada.ecra).slice(0, 256),
    app_version: String(entrada.versao).slice(0, 64),
    visor: { largura: W, altura: H },
    faixa: faixaDe(W),
    assinatura: resumo(`${W > 0 ? faixaDe(W) : ""}|${forma}`),
    nos,
  };
}

function estiloDoBloco(e: Partial<EstiloLido> | null): Partial<NoDoRetrato> {
  const f = corDe(e?.backgroundColor);
  const borda = px(e?.borderTopWidth) > 0 ? corDe(e?.borderTopColor) : "";
  const r = Math.min(64, Math.round(px(e?.borderTopLeftRadius)));
  return { ...(f ? { f } : {}), ...(borda ? { b: borda } : {}), ...(r > 0 ? { r } : {}) };
}

function estiloDoTexto(e: Partial<EstiloLido> | null): Partial<NoDoRetrato> {
  const c = corDe(e?.color);
  const s = Math.min(96, Math.round(px(e?.fontSize)));
  const p = Math.round(px(e?.fontWeight));
  return { ...(c ? { c } : {}), ...(s > 0 ? { s } : {}), ...(p >= 600 ? { p } : {}) };
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
      documento: o.documento, visor, ecra, versao: o.versao,
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

  return {
    ecraNovo() {
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
      temporizador = null;
    },
  };
}
