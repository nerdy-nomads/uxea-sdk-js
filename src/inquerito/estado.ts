/**
 * O que os inquéritos guardam no dispositivo, entre páginas e entre sessões.
 *
 * Uma chave só no armazenamento local, `uxda.inqueritos`, e quatro coisas lá
 * dentro, cada uma por uma razão que não se resolve em memória:
 *
 *   sessao / mostradoNaSessao   um inquérito por sessão, e uma sessão atravessa
 *                               recarregamentos de página
 *   primeiras                   o `primeira_utilizacao` é a primeira vez **neste
 *                               dispositivo**, e não nesta página
 *   abertas                     a tarefa que começou e não acabou: é o que o
 *                               `apos_abandono` lê no arranque da sessão seguinte,
 *                               e é de onde sai o `tentativa_inicio`
 *   pedidos / respondeu         o livro de fadiga local, **em dias e não em
 *                               instantes**, como o do servidor
 *
 * **Nada aqui é o que alguém respondeu.** Nem a nota, nem a escolha, nem o
 * comentário: o livro sabe que houve uma resposta num dia, e mais nada. É a mesma
 * separação que o servidor faz entre o controlo de fadiga e as respostas.
 *
 * A leitura é defensiva de ponta a ponta: um armazenamento que lança, ou que
 * devolve lixo, dá um estado vazio, e o pior que isso faz é um inquérito poder
 * voltar a ser pedido ao servidor, que é quem manda na fadiga a sério.
 */
import type { Armazenamento } from "../core/tipos.ts";

export const CHAVE_ESTADO = "uxda.inqueritos";

/** Uma tarefa começada, à espera de fim. */
export interface Aberta {
  /** A sessão em que começou: é o que separa "a anterior" desta. */
  sessao: string;
  /** O instante do último evento que correspondeu ao `inicio`. */
  inicio: number;
  /** O último ecrã em que a tentativa esteve, para o contexto do abandono. */
  ecra: string;
  /** O último passo declarado, pela mesma razão. */
  passo: string;
}

export interface EstadoDeInqueritos {
  sessao: string;
  mostradoNaSessao: string;
  primeiras: string[];
  abertas: Record<string, Aberta>;
  /** Os dias (desde a época) em que o servidor disse `pode`. Um por pedido. */
  pedidos: number[];
  /** O último dia em que houve uma resposta aceite, ou -1. */
  respondeu: number;
  /** A última recusa do servidor que vale para o projeto inteiro, e em que sessão. */
  recusa: { sessao: string; motivo: string };
}

export function estadoVazio(): EstadoDeInqueritos {
  return { sessao: "", mostradoNaSessao: "", primeiras: [], abertas: {}, pedidos: [], respondeu: -1, recusa: { sessao: "", motivo: "" } };
}

const texto = (v: unknown, max = 256): string => (typeof v === "string" ? v.slice(0, max) : "");
const numero = (v: unknown, omissao: number): number => (typeof v === "number" && Number.isFinite(v) ? v : omissao);

export function lerEstado(loja: Armazenamento | null): EstadoDeInqueritos {
  const e = estadoVazio();
  try {
    const bruto = loja?.getItem(CHAVE_ESTADO);
    if (!bruto) return e;
    const v = JSON.parse(bruto);
    if (!v || typeof v !== "object") return e;
    e.sessao = texto(v.sessao);
    e.mostradoNaSessao = texto(v.mostradoNaSessao);
    e.primeiras = Array.isArray(v.primeiras) ? v.primeiras.filter((x: unknown) => typeof x === "string").slice(0, 200) : [];
    if (v.abertas && typeof v.abertas === "object") {
      for (const [chave, a] of Object.entries(v.abertas as Record<string, any>).slice(0, 100)) {
        if (!a || typeof a !== "object" || typeof a.inicio !== "number") continue;
        e.abertas[chave] = { sessao: texto(a.sessao), inicio: a.inicio, ecra: texto(a.ecra), passo: texto(a.passo, 64) };
      }
    }
    e.pedidos = Array.isArray(v.pedidos) ? v.pedidos.filter((x: unknown) => typeof x === "number" && Number.isFinite(x)).slice(-200) : [];
    e.respondeu = numero(v.respondeu, -1);
    if (v.recusa && typeof v.recusa === "object") e.recusa = { sessao: texto(v.recusa.sessao), motivo: texto(v.recusa.motivo, 64) };
  } catch { /* estado ilegível é estado vazio */ }
  return e;
}

export function gravarEstado(loja: Armazenamento | null, estado: EstadoDeInqueritos): void {
  try {
    loja?.setItem(CHAVE_ESTADO, JSON.stringify(estado));
  } catch { /* sem armazenamento, fica em memória até a página fechar */ }
}
