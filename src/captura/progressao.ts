/**
 * Progressão da tentativa e evento terminal. Cartão 4.4, RF-GRA-20 a RF-GRA-25.
 *
 * A distinção que o documento pede, e que é a razão de este módulo existir, é
 * entre **tempo de espera imposto pelo sistema** e **tempo de decisão do
 * utilizador**. Confundi-los transforma a lentidão do servidor em hesitação da
 * pessoa, e leva a equipa a redesenhar um ecrã que estava bem.
 *
 * O evento terminal é inequívoco, e são quatro: concluído com sucesso, concluído
 * com erro, abandonado ou expirado. Sem ele, o abandono e a conclusão misturam-se
 * e todas as taxas ficam erradas.
 *
 * **O `expirado` não sai daqui.** Um dispositivo que fecha não sabe que expirou:
 * quem sabe é o motor, ao aplicar o limiar da tarefa (cartão 6.5). A API aceita-o
 * na mesma, para quem quiser marcá-lo por sua conta.
 */
import { protegido } from "../safe.ts";

export type EstadoTerminal = "sucesso" | "erro" | "abandonado" | "expirado";

export interface ContextoDeProgressao {
  emitir(tipo: string, extras?: Record<string, unknown>): void;
  agora(): number;
  essencial(): boolean;
  /** O campo onde a pessoa estava, para o abandono ter nome (RF-GRA-18). */
  campoDeAbandono(): string;
}

export interface LigacaoDeProgressao {
  /** Uma transição de passo, com o tempo que o anterior levou. */
  passo(nome: string): void;
  /** Em que passo a tentativa vai. É o contexto do RF-MSG-05, e não emite nada. */
  passoAtual(): string;
  /** Uma espera imposta pelo sistema, medida de ponta a ponta. */
  espera(ms: number): void;
  /** Fecha a tentativa, sem ambiguidade. */
  terminal(estado: EstadoTerminal): void;
  /** Houve atividade que pode acabar em abandono. */
  marcarAtividade(): void;
  /** Chamado quando a página se esconde: é aqui que o abandono se descobre. */
  esconder(): void;
  mostrar(): void;
  desligar(): void;
}

export function ligarProgressao(janela: any, documento: any, ctx: ContextoDeProgressao): LigacaoDeProgressao {
  const desligadores: Array<() => void> = [];

  let passoAtual = "";
  let passoDesde = ctx.agora();
  let atividadePendente = false;
  let terminada = false;
  let escondidoEm = 0;

  const ouvir = (alvo: any, evento: string, fn: any) => {
    if (!alvo || typeof alvo.addEventListener !== "function") return;
    const seguro = protegido(`captura.${evento}`, fn, undefined);
    alvo.addEventListener(evento, seguro, true);
    desligadores.push(() => alvo.removeEventListener(evento, seguro, true));
  };

  const ambiente = (mudanca: string, valor: string, duracao?: number) => {
    if (ctx.essencial()) return;
    ctx.emitir("ambiente", {
      duration_ms: duracao,
      properties: { mudanca, valor: valor.slice(0, 32) },
    });
  };

  // Orientação, rede e conectividade (RF-GRA-25). Uma tentativa que atravessa
  // uma queda de rede não é uma tentativa lenta: é outra coisa.
  ouvir(janela, "orientationchange", () => {
    const o = janela?.screen?.orientation?.type ?? (janela?.innerWidth > janela?.innerHeight ? "landscape" : "portrait");
    ambiente("orientacao", String(o));
  });
  ouvir(janela, "online", () => ambiente("conectividade", "online"));
  ouvir(janela, "offline", () => ambiente("conectividade", "offline"));
  const ligacao = janela?.navigator?.connection;
  if (ligacao && typeof ligacao.addEventListener === "function") {
    const aoMudar = protegido("captura.rede", () => ambiente("rede", String(ligacao.effectiveType ?? "")), undefined);
    ligacao.addEventListener("change", aoMudar);
    desligadores.push(() => ligacao.removeEventListener("change", aoMudar));
  }

  return {
    passoAtual: () => passoAtual,

    passo(nome: string) {
      if (ctx.essencial() || !nome) return;
      const agora = ctx.agora();
      ctx.emitir("passo", {
        duration_ms: passoAtual ? Math.max(0, Math.round(agora - passoDesde)) : undefined,
        properties: { passo: nome.slice(0, 64), ...(passoAtual ? { passo_anterior: passoAtual.slice(0, 64) } : {}) },
      });
      passoAtual = nome;
      passoDesde = agora;
      atividadePendente = true;
      terminada = false;
    },

    espera(ms: number) {
      if (ctx.essencial() || !(ms > 0)) return;
      // O tempo que o sistema impôs. Sai num evento próprio de propósito: somado
      // ao tempo do passo, ninguém consegue voltar a separá-los depois.
      ctx.emitir("espera", { duration_ms: Math.round(ms) });
    },

    terminal(estado: EstadoTerminal) {
      if (terminada) return;
      terminada = true;
      atividadePendente = false;
      const campo = ctx.campoDeAbandono();
      ctx.emitir("terminal", {
        properties: {
          estado,
          ...(estado === "abandonado" && campo ? { campo_abandono: campo.slice(0, 64) } : {}),
        },
      });
    },

    marcarAtividade() {
      atividadePendente = true;
      terminada = false;
    },

    esconder() {
      escondidoEm = ctx.agora();
      // Uma página que se esconde com trabalho a meio e nunca mais volta é um
      // abandono. Marca-se aqui, que é o último instante em que alguém pode.
      if (atividadePendente && !terminada) this.terminal("abandonado");
    },

    mostrar() {
      if (escondidoEm > 0) {
        // A duração de cada ausência (RF-GRA-24): o regresso é que a sabe.
        ambiente("primeiro_plano", "regresso", Math.max(0, Math.round(ctx.agora() - escondidoEm)));
        escondidoEm = 0;
      }
    },

    desligar() {
      for (const d of desligadores.splice(0)) {
        try { d(); } catch { /* desligar não pode falhar */ }
      }
    },
  };
}
