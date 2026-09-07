/**
 * Mutações controladas sobre um DOM real.
 *
 * Os pares reais do arquivo dizem quantos elementos se reconhecem entre versões,
 * mas **não têm verdade conhecida**: não há forma de saber se um elemento que não
 * correspondeu desapareceu ou foi mal identificado.
 *
 * Aqui a verdade é conhecida por construção: cada elemento leva uma marca
 * `data-gt` que o algoritmo nunca lê, e que diz qual era ele antes. Isso dá
 * **precisão e cobertura reais**, e não apenas uma taxa de correspondência.
 */
type Doc = any;

let semente = 20260907;
/** Aleatório determinístico: a mesma execução dá sempre o mesmo resultado. */
function rnd(): number {
  semente = (semente * 1103515245 + 12345) & 0x7fffffff;
  return semente / 0x7fffffff;
}
export function repor(s = 20260907) { semente = s; }

const CLASSES = ["c-a1", "u-flex", "sc-xk21", "css-9df2", "layout__row", "is-active"];

export const MUTACOES: Record<string, (d: Doc) => void> = {
  /** Alguém mudou o tema: as classes todas passam a outras. */
  estilo(d) {
    for (const el of Array.from(d.querySelectorAll("[class]")) as any[]) {
      const n = 1 + Math.floor(rnd() * 3);
      el.setAttribute("class", Array.from({ length: n }, () => CLASSES[Math.floor(rnd() * CLASSES.length)]).join(" "));
    }
  },
  /** Alguém envolveu blocos em divs novos para os alinhar. */
  involucro(d) {
    for (const el of Array.from(d.querySelectorAll("[data-gt]")) as any[]) {
      const pai = el.parentElement;
      if (!pai) continue;
      const w = d.createElement("div");
      w.setAttribute("class", "grid-wrap");
      pai.insertBefore(w, el);
      w.appendChild(el);
    }
  },
  /** Alguém trocou a ordem de dois blocos irmãos. */
  reordenar(d) {
    for (const pai of Array.from(d.querySelectorAll("form, nav, ul, header, section")) as any[]) {
      const fs = Array.from(pai.children) as any[];
      if (fs.length < 2) continue;
      if (rnd() < 0.5) pai.insertBefore(fs[fs.length - 1], fs[0]);
    }
  },
  /** Alguém corrigiu um erro ortográfico ou reescreveu um rótulo. */
  texto(d) {
    for (const el of Array.from(d.querySelectorAll("[data-gt]")) as any[]) {
      if (rnd() > 0.3) continue;
      const t = (el.textContent ?? "").trim();
      if (t.length > 4 && el.children.length === 0) el.textContent = t.slice(0, -1) + "s";
      const ph = el.getAttribute("placeholder");
      if (ph && ph.length > 4) el.setAttribute("placeholder", ph.replace(/^./, ph[0]!.toUpperCase()) + ":");
    }
  },
  /** Alguém trocou a ferramenta de testes, ou o framework regenerou os ids. */
  atributos(d) {
    for (const el of Array.from(d.querySelectorAll("[data-testid],[data-test],[id]")) as any[]) {
      el.removeAttribute("data-testid");
      el.removeAttribute("data-test");
      if (el.getAttribute("id")) el.setAttribute("id", `mui-${Math.floor(rnd() * 100000)}`);
    }
  },
};

/** Tudo ao mesmo tempo: o cenário mau, que é uma reescrita de interface. */
export function mutacaoTotal(d: Doc): void {
  for (const nome of ["estilo", "involucro", "reordenar", "texto", "atributos"]) MUTACOES[nome]!(d);
}
