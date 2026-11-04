/**
 * A página inteira, e não só a janela. Cartão 32.23, ADR 0064.
 *
 * A captura do ecrã copiava só o que estava à vista na janela, e o dono do produto viu
 * as páginas cortadas. Copiar a página toda pede três coisas, e vivem aqui para a
 * captura e os toques medirem da mesma maneira:
 *
 *   1. **a altura da página e quanto ela desceu**. Quase sempre é o documento que
 *      desce (`scrollY`). Há aplicações em que o documento tem a altura da janela e
 *      quem desce é um contentor lá dentro (`#app { height: 100vh; overflow: auto }`);
 *      esse é o **rolante**, e a página é a altura do conteúdo dele;
 *   2. **onde fica um elemento fixo**. Um cabeçalho `position: fixed` está sempre à
 *      vista; na página inteira desenha-se no topo, e uma barra fixa em baixo
 *      desenha-se no fim da página. Somar-lhes o deslocamento punha o cabeçalho no
 *      meio da página, no sítio onde a pessoa estava quando a captura saiu;
 *   3. **a posição de um toque na página**, com as mesmas duas regras: um toque no
 *      cabeçalho fixo cai no cabeçalho do topo, e não a meio.
 *
 * Nada disto lê conteúdo: são medidas de caixas e deslocamentos.
 */

/** Uma página mais alta do que isto desenha-se até aqui, e a captura diz que foi cortada. */
export const MAXIMO_DA_PAGINA_PX = 40000;

export interface MedidaDaPagina {
  /** A largura e a altura da janela, em px. */
  largura: number;
  alturaDoVisor: number;
  /** A altura da página inteira, em px, já presa ao máximo. */
  altura: number;
  /** A página era mais alta do que o máximo. */
  cortada: boolean;
  /** Quanto o documento desceu e andou para o lado. */
  dx: number;
  dy: number;
  /** O contentor que desce, quando não é o documento. */
  rolante: any | null;
}

const num = (v: any): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);

/**
 * O contentor que desce quando o documento não desce: o maior elemento com conteúdo
 * mais alto do que ele e com `overflow-y` a deixar descer. `null` quando é o documento.
 */
export function encontrarRolante(janela: any, documento: any): any | null {
  const H = num(janela?.innerHeight);
  const de = documento?.documentElement, b = documento?.body;
  if (!(H > 0) || !b) return null;
  if (Math.max(num(de?.scrollHeight), num(b?.scrollHeight)) > H + 2) return null;
  if (typeof b.querySelectorAll !== "function" || typeof janela?.getComputedStyle !== "function") return null;
  let melhor: any = null, area = 0;
  const todos = b.querySelectorAll("*");
  // Um limite, para uma página enorme não pagar uma procura enorme: o rolante de uma
  // aplicação está quase sempre perto do topo da árvore.
  for (let i = 0; i < todos.length && i < 4000; i++) {
    const el = todos[i];
    const ch = num(el.clientHeight), sh = num(el.scrollHeight);
    if (ch < H * 0.5 || sh <= ch + 40) continue;
    const oy = String(janela.getComputedStyle(el)?.overflowY ?? "");
    if (oy !== "auto" && oy !== "scroll" && oy !== "overlay") continue;
    const a = ch * num(el.clientWidth);
    if (a > area) { area = a; melhor = el; }
  }
  return melhor;
}

export function medirPagina(janela: any, documento: any, rolante: any | null = encontrarRolante(janela, documento)): MedidaDaPagina {
  const W = Math.round(num(janela?.innerWidth));
  const H = Math.round(num(janela?.innerHeight));
  const de = documento?.documentElement, b = documento?.body;
  let altura = Math.max(H, num(de?.scrollHeight), num(b?.scrollHeight));
  if (rolante) altura = Math.max(altura, H + Math.max(0, num(rolante.scrollHeight) - num(rolante.clientHeight)));
  const dy = num(janela?.scrollY) || num(janela?.pageYOffset) || num(de?.scrollTop) || num(b?.scrollTop);
  const dx = num(janela?.scrollX) || num(janela?.pageXOffset) || num(de?.scrollLeft) || num(b?.scrollLeft);
  const cortada = altura > MAXIMO_DA_PAGINA_PX;
  return {
    largura: W, alturaDoVisor: H, altura: Math.round(Math.min(MAXIMO_DA_PAGINA_PX, altura)), cortada,
    dx: Math.round(dx), dy: Math.round(dy), rolante,
  };
}

/**
 * Onde se ancora um elemento fixo na página inteira: no topo, ou no fim quando está na
 * metade de baixo da janela (uma barra de navegação, um botão de conversa). `null`
 * quando não é fixo nem está dentro de um fixo.
 */
export function ancoraFixa(el: any, janela: any): "topo" | "fundo" | null {
  if (typeof janela?.getComputedStyle !== "function") return null;
  const H = num(janela?.innerHeight);
  let n = el;
  for (let i = 0; n && n.nodeType === 1 && i < 40; i++, n = n.parentElement) {
    if (String(janela.getComputedStyle(n)?.position ?? "") !== "fixed") continue;
    const r = typeof n.getBoundingClientRect === "function" ? n.getBoundingClientRect() : null;
    return r && num(r.top) > H / 2 ? "fundo" : "topo";
  }
  return null;
}

/** A altura de um ponto da janela na página inteira, com as regras de cima. */
export function yNaPagina(alvo: any, clientY: number, m: MedidaDaPagina, janela: any): number {
  const ancora = ancoraFixa(alvo, janela);
  let y: number;
  if (ancora === "topo") y = clientY;
  else if (ancora === "fundo") y = m.altura - (m.alturaDoVisor - clientY);
  else if (m.rolante && typeof m.rolante.contains === "function" && m.rolante.contains(alvo)) y = clientY + num(m.rolante.scrollTop);
  else y = clientY + m.dy;
  return Math.max(0, Math.min(m.altura, Math.round(y)));
}
