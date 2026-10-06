/**
 * Identidade estável de elementos de interface. ADR 0003 (decisão D-03).
 *
 * Um identificador único, seja ele qual for, parte-se. O seletor parte-se quando
 * alguém muda o estilo; a posição parte-se quando alguém acrescenta um elemento
 * acima; o texto parte-se quando alguém corrige um erro ortográfico. **Vários
 * sinais fracos e independentes não se partem todos ao mesmo tempo.**
 *
 * Nada aqui lê conteúdo escrito pelo utilizador. O sinal do rótulo lê texto **da
 * aplicação**, mascara-o e guarda só o resumo (RNF-PRI-01).
 */
import { chao, preparar, resumo } from "./mask.ts";

/** Só o que precisamos de um elemento. Serve o DOM do browser e o do harness. */
export interface ElementoLike {
  readonly tagName: string;
  readonly parentElement: ElementoLike | null;
  readonly children: ArrayLike<ElementoLike>;
  getAttribute(nome: string): string | null;
  readonly textContent: string | null;
}

export interface Sinais {
  /** Sinal 1: atributo explícito de teste. O mais forte, e o mais raro. */
  testid: string | null;
  /** Sinal 2: caminho estrutural, saltando invólucros de disposição. */
  caminho: string | null;
  /** Sinal 3: resumo do rótulo normalizado e mascarado. Nunca o texto. */
  rotulo: string | null;
  /** Sinal 4: destino da ligação ou da submissão, com os identificadores mascarados. */
  destino: string | null;
  /** Sinal 5: papel e ordem dentro do contentor. */
  papel: string | null;
}

export interface Chave {
  /** O sinal mais forte disponível, para uso como identificador principal. */
  principal: string;
  /** Qual dos sinais deu o principal. */
  fonte: keyof Sinais;
  sinais: Sinais;
}

/* ---------------------------------------------------------------- acionáveis */

const TAGS_ACIONAVEIS = new Set(["BUTTON", "A", "INPUT", "SELECT", "TEXTAREA", "SUMMARY", "LABEL"]);
const PAPEIS_ACIONAVEIS = new Set([
  "button", "link", "checkbox", "radio", "tab", "menuitem", "menuitemcheckbox",
  "menuitemradio", "switch", "option", "combobox", "textbox", "searchbox", "slider",
]);

/**
 * Um elemento entra no inventário se **recebe interação**. É a unidade mínima de
 * funcionalidade do ADR 0007: um rótulo que ninguém pode tocar não é uma
 * funcionalidade que alguém possa deixar de usar.
 */
export function acionavel(el: ElementoLike): boolean {
  const tag = el.tagName.toUpperCase();
  if (tag === "INPUT" && (el.getAttribute("type") ?? "").toLowerCase() === "hidden") return false;
  if (tag === "A" && el.getAttribute("href") === null) return false;
  if (TAGS_ACIONAVEIS.has(tag)) return true;
  const papel = (el.getAttribute("role") ?? "").toLowerCase();
  if (PAPEIS_ACIONAVEIS.has(papel)) return true;
  if (el.getAttribute("onclick") !== null) return true;
  const ti = el.getAttribute("tabindex");
  return ti !== null && ti !== "-1";
}

/* ------------------------------------------------------- sinal 1: atributos */

const ATRIBUTOS_TESTE = ["data-ux-key", "data-testid", "data-test", "data-test-id", "data-cy", "data-qa"];

/**
 * Um `id` só serve se não parecer gerado. Os que parecem são a maioria em
 * aplicações modernas, e usá-los seria pior do que não ter sinal nenhum: mudavam
 * a cada renderização e o histórico partia-se todos os dias.
 */
const ID_GERADO = [
  /\d{4,}/,                    // contadores
  /^[0-9a-f]{8,}$/i,           // resumos
  /^:r[0-9a-z]+:$/i,           // React useId
  /^(ember|mui|mat|ng|radix|headlessui|chakra)[-_:]?\d/i,
  /^[a-z]+-(?=[0-9a-z]*\d)[0-9a-z]{5,}$/i,  // css-in-js: sufixo alfanumérico com dígito
];

// O chão vale também aqui (cartão 18.2): um atributo de teste escrito com um valor do
// cliente lá dentro (`bi_005123456LA041`, `titular-ana@exemplo.ao`) é um identificador
// direto no elemento. A bateria do 18.2 apanhou-o a sair tal e qual.
export function sinalTestId(el: ElementoLike): string | null {
  for (const a of ATRIBUTOS_TESTE) {
    const v = el.getAttribute(a);
    if (v && v.trim()) return `${a}=${chao(v.trim())}`;
  }
  const nome = el.getAttribute("name");
  if (nome && nome.trim()) return `name=${chao(nome.trim())}`;
  const id = el.getAttribute("id");
  if (id && id.trim() && !ID_GERADO.some((re) => re.test(id.trim()))) return `id=${chao(id.trim())}`;
  return null;
}

/* --------------------------------------------------------- sinal 2: caminho */

/**
 * Um invólucro de disposição não entra no caminho. É o que torna o sinal robusto
 * à alteração mais frequente que há numa interface: alguém envolver um bloco num
 * `div` novo para o alinhar.
 */
function ancora(el: ElementoLike): boolean {
  const tag = el.tagName.toUpperCase();
  if (!["DIV", "SPAN", "TBODY", "TEMPLATE", "SLOT"].includes(tag)) return true;
  return el.getAttribute("role") !== null || sinalTestId(el) !== null;
}

function ancestraisAncora(el: ElementoLike): ElementoLike[] {
  const cadeia: ElementoLike[] = [];
  let p = el.parentElement;
  while (p) {
    if (ancora(p)) cadeia.unshift(p);
    p = p.parentElement;
  }
  return cadeia;
}

/** Ordem entre irmãos-âncora do mesmo tipo, saltando os invólucros pelo meio. */
function ordemEntreAncoras(el: ElementoLike): number {
  const pai = ancestraisAncora(el).at(-1);
  if (!pai) return 1;
  const tag = el.tagName.toUpperCase();
  let n = 0;
  const visitar = (no: ElementoLike): boolean => {
    for (let i = 0; i < no.children.length; i++) {
      const f = no.children[i]!;
      if (ancora(f)) {
        if (f.tagName.toUpperCase() === tag) {
          n++;
          if (f === el) return true;
        }
        continue; // não desce: só conta o nível de âncoras imediato
      }
      if (visitar(f)) return true; // atravessa invólucros
    }
    return false;
  };
  visitar(pai);
  return n || 1;
}

export function sinalCaminho(el: ElementoLike): string {
  const partes = ancestraisAncora(el)
    .slice(-4) // os quatro ancestrais mais próximos chegam, e sobrevivem a mudanças no topo
    .map((a) => a.tagName.toUpperCase());
  return [...partes, `${el.tagName.toUpperCase()}[${ordemEntreAncoras(el)}]`].join(">");
}

/* ---------------------------------------------------------- sinal 3: rótulo */

const TAGS_ENTRADA = new Set(["INPUT", "TEXTAREA", "SELECT"]);

/**
 * O texto lido é **da aplicação**, não do utilizador. Num campo de entrada lê-se o
 * `placeholder` e o `aria-label`, e **nunca o `value`**, que é conteúdo escrito
 * por quem usa.
 */
export function textoVisivel(el: ElementoLike): string | null {
  const tag = el.tagName.toUpperCase();
  const aria = el.getAttribute("aria-label");
  if (aria && aria.trim()) return aria.trim();
  if (TAGS_ENTRADA.has(tag)) {
    const ph = el.getAttribute("placeholder");
    if (ph && ph.trim()) return ph.trim();
    const t = el.getAttribute("type");
    return t && t.trim() ? `[${t.trim()}]` : null;
  }
  const titulo = el.getAttribute("title");
  const txt = (el.textContent ?? "").trim() || (titulo ?? "").trim();
  return txt ? txt.slice(0, 120) : null;
}

export function sinalRotulo(el: ElementoLike): string | null {
  const t = textoVisivel(el);
  if (!t) return null;
  const p = preparar(t);
  return p ? resumo(p) : null;
}

/* -------------------------------------------------------- sinal 4: destino */

/**
 * O destino de uma ligação é dos sinais mais estáveis que há, e faltava.
 *
 * Foi a medição do cartão 0.2 que o mostrou: sem ele, uma barra de navegação com
 * dez ligações de rótulo parecido dava 40,9% de elementos ambíguos, porque nada os
 * distinguia. Com ele, distinguem-se pelo sítio para onde vão.
 *
 * Os segmentos que parecem identificadores são mascarados, senão cada artigo era
 * um elemento diferente e o inventário enchia-se de conteúdo em vez de
 * funcionalidades.
 */
// E o correio num segmento (cartão 18.1): `/u/ana@exemplo.ao` não é uma funcionalidade,
// é uma pessoa no caminho.
const SEGMENTO_ID = [/^\d+$/, /^[0-9a-f]{8,}$/i, /^[a-z]{0,3}\d{4,}[a-z0-9]*$/i, /^[0-9a-f-]{20,}$/i, /@/];

export function normalizarDestino(bruto: string): string | null {
  let d = bruto.trim();
  if (!d || d.startsWith("#") || d.startsWith("javascript:")) return null;
  d = d.replace(/^[a-z]+:\/\/[^/]+/i, "");   // fora o protocolo e o anfitrião
  d = d.split(/[?#]/)[0] ?? d;                // fora a consulta e o fragmento
  if (!d.startsWith("/")) d = "/" + d;
  // E um segmento onde o chão encontre alguma coisa (um contacto `+244923000111`, um
  // número com separadores) também é um identificador: o 18.2 apanhou um contacto num
  // `action` de formulário a sair tal e qual.
  const segs = d.split("/").filter(Boolean).map((s) => (SEGMENTO_ID.some((re) => re.test(s)) || chao(s) !== s || /\d{6,}/.test(s.replace(/[^\d]/g, "")) ? "{id}" : s));
  return "/" + segs.join("/");
}

export function sinalDestino(el: ElementoLike): string | null {
  for (const a of ["href", "action", "formaction"]) {
    const v = el.getAttribute(a);
    if (v) { const n = normalizarDestino(v); if (n) return n; }
  }
  return null;
}

/* ----------------------------------------------------------- sinal 5: papel */

const PAPEL_POR_TAG: Record<string, string> = {
  BUTTON: "button", A: "link", SELECT: "combobox", TEXTAREA: "textbox",
  SUMMARY: "button", LABEL: "label",
};

export function papelDe(el: ElementoLike): string {
  const explicito = el.getAttribute("role");
  if (explicito && explicito.trim()) return explicito.trim().toLowerCase();
  const tag = el.tagName.toUpperCase();
  if (tag === "INPUT") return `input:${(el.getAttribute("type") ?? "text").toLowerCase()}`;
  return PAPEL_POR_TAG[tag] ?? tag.toLowerCase();
}

export function sinalPapel(el: ElementoLike): string {
  return `${papelDe(el)}#${ordemEntreAncoras(el)}`;
}

/* ------------------------------------------------------------------- chave */

export function sinais(el: ElementoLike): Sinais {
  return {
    testid: sinalTestId(el),
    caminho: sinalCaminho(el),
    rotulo: sinalRotulo(el),
    destino: sinalDestino(el),
    papel: sinalPapel(el),
  };
}

const PRIORIDADE: ReadonlyArray<keyof Sinais> = ["testid", "destino", "rotulo", "caminho", "papel"];

export function chave(el: ElementoLike): Chave {
  const s = sinais(el);
  for (const f of PRIORIDADE) {
    const v = s[f];
    if (v) return { principal: `${f}:${v}`, fonte: f, sinais: s };
  }
  return { principal: `papel:${s.papel}`, fonte: "papel", sinais: s };
}
