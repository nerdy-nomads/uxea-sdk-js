/**
 * Reconciliação entre versões. ADR 0003.
 *
 * Quando o sinal principal muda entre duas versões da aplicação, o servidor tenta
 * reconhecer o elemento pela maioria dos sinais restantes.
 *
 * **Quando não reconcilia, o elemento aparece como novo, nunca como outro.** Um
 * histórico partido é mau; um histórico silenciosamente errado é pior, porque quem
 * o lê acredita nele. É por isso que existe a margem de unicidade abaixo: um
 * empate não é uma correspondência, é uma recusa.
 */
import type { Sinais } from "./element.ts";

export interface Candidato {
  ref: string;
  sinais: Sinais;
}

/** Um sinal só pesa quando existe dos dois lados. O peso é o do quadro do ADR. */
export const PESO: Readonly<Record<keyof Sinais, number>> = {
  testid: 1.0,
  destino: 0.4,
  rotulo: 0.35,
  caminho: 0.25,
  papel: 0.15,
};

/**
 * Abaixo disto não é correspondência.
 *
 * Escolhido por varredura contra 3426 elementos com verdade conhecida
 * (`tools/survival/sweep.ts`), e não a olho. O planalto vai de 0,40 a 0,55 com a
 * mesma precisão, e escolheu-se o meio por ser o menos sensível aos dados.
 */
export const LIMIAR = 0.5;
/** O melhor tem de ganhar ao segundo por esta margem, senão é ambíguo. */
export const MARGEM = 0.2;

/** Cauda do caminho, para um invólucro novo no topo não custar o sinal todo. */
function cauda(caminho: string | null, n = 2): string | null {
  if (!caminho) return null;
  const p = caminho.split(">");
  return p.length >= n ? p.slice(-n).join(">") : caminho;
}

/**
 * Pontuação **normalizada**: a soma dos pesos que bateram, a dividir pela soma dos
 * pesos que se podiam aplicar.
 *
 * Sem normalizar, um elemento com quatro sinais e um com dois jogavam em escalas
 * diferentes, e a margem de unicidade deixava de querer dizer nada. Foi a medição
 * do cartão 0.2 que o mostrou: ao acrescentar o quinto sinal, a cobertura das
 * mutações **desceu**, porque as pontuações se comprimiram e passaram a empatar.
 *
 * Devolve entre 0 e 1, e 1 quer dizer que todos os sinais comparáveis bateram.
 */
export function pontuar(a: Sinais, b: Sinais): number {
  if (a.testid && b.testid) return a.testid === b.testid ? 1 : 0;
  // Destinos diferentes não são o mesmo elemento, por mais que o resto se pareça.
  if (a.destino && b.destino && a.destino !== b.destino) return 0;

  let obtido = 0;
  let posivel = 0;
  const conta = (peso: number, igual: boolean, meio = false) => {
    posivel += peso;
    if (igual) obtido += meio ? peso * 0.5 : peso;
  };
  if (a.destino && b.destino) conta(PESO.destino, true);
  if (a.rotulo && b.rotulo) conta(PESO.rotulo, a.rotulo === b.rotulo);
  if (a.caminho && b.caminho) {
    posivel += PESO.caminho;
    if (a.caminho === b.caminho) obtido += PESO.caminho;
    else if (cauda(a.caminho) === cauda(b.caminho)) obtido += PESO.caminho * 0.5;
  }
  if (a.papel && b.papel) {
    posivel += PESO.papel;
    if (a.papel === b.papel) obtido += PESO.papel;
    else if (a.papel.split("#")[0] === b.papel.split("#")[0]) obtido += PESO.papel * 0.5;
  }
  return posivel ? obtido / posivel : 0;
}

export type Resultado =
  | { tipo: "reconciliado"; de: string; para: string; pontos: number }
  | { tipo: "novo"; de: string; melhor: number }
  | { tipo: "ambiguo"; de: string; melhor: number; segundo: number };

/** Chave de conteúdo: o que dois elementos partilham quando são indistinguíveis. */
const conteudo = (c: Candidato) => `${c.sinais.destino ?? ""}|${c.sinais.rotulo ?? ""}`;

export function reconciliar(antes: Candidato[], depois: Candidato[], limiar = LIMIAR, margem = MARGEM): Resultado[] {
  const usados = new Set<string>();
  const saida: Resultado[] = [];

  /**
   * Quantas vezes o mesmo conteúdo aparece. A medição do cartão 0.2 mostrou que
   * **todos os erros vinham daqui**: a mesma ligação no cabeçalho e no rodapé, com
   * o mesmo destino e o mesmo rótulo. Só a ordem as distingue, e a ordem é
   * precisamente o que muda entre versões.
   *
   * Quando o conteúdo é ambíguo, a correspondência passa a exigir **caminho
   * exacto**. Perde-se alguma cobertura, e ganha-se não colar histórico ao
   * elemento errado, que é o que o ADR 0003 põe à frente de tudo.
   */
  const repetido = new Map<string, number>();
  for (const c of [...antes, ...depois]) {
    const k = conteudo(c);
    if (k !== "|") repetido.set(k, (repetido.get(k) ?? 0) + 1);
  }
  const duplicado = (c: Candidato) => (repetido.get(conteudo(c)) ?? 0) > 2;

  for (const a of antes) {
    let m1 = { ref: "", p: -1 };
    let m2 = { ref: "", p: -1 };
    for (const b of depois) {
      if (usados.has(b.ref)) continue;
      let p = pontuar(a.sinais, b.sinais);
      // Conteúdo repetido: sem caminho exacto, não há como saber qual é qual.
      if (p > 0 && (duplicado(a) || duplicado(b)) && a.sinais.caminho !== b.sinais.caminho) p = 0;
      if (p > m1.p) { m2 = m1; m1 = { ref: b.ref, p }; }
      else if (p > m2.p) { m2 = { ref: b.ref, p }; }
    }
    if (m1.p < limiar) { saida.push({ tipo: "novo", de: a.ref, melhor: Math.max(m1.p, 0) }); continue; }
    if (m2.p >= limiar && m1.p - m2.p < margem) {
      saida.push({ tipo: "ambiguo", de: a.ref, melhor: m1.p, segundo: m2.p });
      continue; // ambíguo não corresponde: aparece como novo, e não como outro
    }
    usados.add(m1.ref);
    saida.push({ tipo: "reconciliado", de: a.ref, para: m1.ref, pontos: m1.p });
  }
  return saida;
}

export interface Taxa {
  total: number;
  reconciliados: number;
  novos: number;
  ambiguos: number;
  /** Fracção de elementos de antes reconhecidos depois. */
  sobrevivencia: number;
}

export function taxa(rs: Resultado[]): Taxa {
  const c = (t: Resultado["tipo"]) => rs.filter((r) => r.tipo === t).length;
  const total = rs.length;
  const rec = c("reconciliado");
  return {
    total, reconciliados: rec, novos: c("novo"), ambiguos: c("ambiguo"),
    sobrevivencia: total ? rec / total : 0,
  };
}
