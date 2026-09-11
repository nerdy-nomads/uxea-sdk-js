/**
 * Até onde a pessoa desceu no ecrã. Cartão 9.1, RF-IND-05.
 *
 * # A pergunta que isto responde, e que nenhum outro sinal responde
 *
 * *O que está no fundo do ecrã chega a ser visto?* Um botão de continuar abaixo da
 * dobra, um aviso importante no rodapé, um terceiro plano de preços que 80% das
 * pessoas nunca vê: são todos invisíveis para um funil, porque **não acontece
 * nada** quando alguém não desce.
 *
 * É o mesmo raciocínio do toque sem efeito: o que interessa é a ausência, e a
 * ausência não produz eventos por si.
 *
 * # Um evento por ecrã, e não um por deslocamento
 *
 * **Isto é a decisão inteira deste módulo.** Um `scroll` dispara dezenas de vezes
 * por segundo; capturar cada um multiplicava o volume por cem para dizer a mesma
 * coisa, e o `RF-GRA-30` existe precisamente porque o volume é o risco crítico
 * deste conjunto.
 *
 * O que se guarda é o máximo: a percentagem da página que **chegou** a estar
 * visível, e quanto tempo demorou a lá chegar. Emite-se quando o ecrã se fecha,
 * porque é o único momento em que esse máximo já é definitivo.
 *
 * # E não há coordenadas de pessoa nenhuma aqui
 *
 * A profundidade é uma percentagem da própria página. Não diz onde a pessoa estava
 * nem o que leu: diz até onde o conteúdo chegou a ser mostrado.
 */
import { protegido } from "../safe.ts";

export interface ContextoDeDeslocamento {
  emitir(tipo: string, extras?: Record<string, unknown>): void;
  agora(): number;
  /** As coordenadas e a profundidade só saem no nível detalhado. */
  detalhado(): boolean;
  /** E só com o rastreio individual ligado no projeto (cartão 9.5). */
  individual?(): boolean;
  /**
   * O ecrã em que a medição começou.
   *
   * **É preciso porque a profundidade se emite quando o ecrã acaba**, e nessa
   * altura o endereço já mudou: numa aplicação de página única, o `pushState`
   * corre antes de o SDK dar por ela. Sem guardar o ecrã na abertura, a
   * profundidade medida numa página aparecia carimbada na seguinte, que é uma
   * mentira silenciosa e foi o ensaio que a apanhou.
   */
  ecra(): string;
}

export interface LigacaoDeDeslocamento {
  /** Fecha o ecrã em curso, emitindo o máximo, e recomeça. */
  ecraNovo(): void;
  fechar(): void;
  desligar(): void;
}

/**
 * A percentagem da página que já esteve visível.
 *
 * **Conta o fundo do visor e não o topo.** Com o topo, uma página que cabe inteira
 * no ecrã dava 0% de profundidade, que é o oposto do que aconteceu: ela foi vista
 * toda sem ninguém ter de deslocar nada.
 */
export function profundidadeDe(deslocado: number, visor: number, pagina: number): number {
  const total = Math.max(1, pagina);
  const fundo = Math.max(0, deslocado) + Math.max(0, visor);
  return Math.max(0, Math.min(100, Math.round((fundo / total) * 100)));
}

export function ligarDeslocamento(
  janela: any, documento: any, ctx: ContextoDeDeslocamento,
): LigacaoDeDeslocamento {
  const desligadores: Array<() => void> = [];

  let maximo = 0;
  let alcancadoEm = 0;
  let ecraEm = ctx.agora();
  let visorNoMaximo = 0;
  let ecraMedido = ctx.ecra();
  // **Nenhum ecrã está aberto antes do primeiro `ecraNovo`.** Sem esta guarda, a
  // medição inicial (uma página que cabe no visor já vale 100%) era emitida na
  // abertura do primeiro ecrã, e ficava uma profundidade de um ecrã que ainda não
  // tinha existido. Deu-se por isso no ensaio, que contou dois eventos onde tinha
  // de haver um.
  let aberto = false;

  const medir = () => {
    const visor = janela?.innerHeight || 0;
    const pagina = Math.max(
      documento?.documentElement?.scrollHeight || 0,
      documento?.body?.scrollHeight || 0,
      visor,
    );
    const deslocado = typeof janela?.scrollY === "number"
      ? janela.scrollY
      : (documento?.documentElement?.scrollTop || 0);
    const p = profundidadeDe(deslocado, visor, pagina);
    if (p > maximo) {
      maximo = p;
      alcancadoEm = ctx.agora();
      visorNoMaximo = visor;
    }
  };

  const fechar = () => {
    // **Um ecrã sem medição nenhuma não emite.** Zero aqui seria dizer que a
    // pessoa não viu nada, e o que houve foi um ecrã que nem chegou a desenhar.
    if (!aberto || maximo <= 0) return;
    if (!(ctx.detalhado() && (ctx.individual?.() ?? true))) return;
    ctx.emitir("deslocamento", {
      screen_key: ecraMedido,
      properties: {
        profundidade: maximo,
        alcance_ms: Math.max(0, Math.round((alcancadoEm || ecraEm) - ecraEm)),
        visor_altura: visorNoMaximo,
      },
    });
  };

  const ouvir = (alvo: any, evento: string, fn: any, opcoes?: any) => {
    if (!alvo || typeof alvo.addEventListener !== "function") return;
    const seguro = protegido(`captura.${evento}`, fn, undefined);
    alvo.addEventListener(evento, seguro, opcoes ?? true);
    desligadores.push(() => alvo.removeEventListener(evento, seguro, opcoes ?? true));
  };

  // `passive: true` é obrigatório e não é enfeite: sem ele, o browser tem de
  // esperar por este ouvinte antes de deslocar a página, e a promessa do
  // `RNF-SDK-01` de nunca degradar a aplicação anfitriã parte-se na primeira
  // página comprida.
  ouvir(janela, "scroll", medir, { passive: true, capture: true });
  ouvir(janela, "resize", medir, { passive: true, capture: true });
  medir();

  return {
    ecraNovo() {
      fechar();
      aberto = true;
      maximo = 0;
      alcancadoEm = 0;
      visorNoMaximo = 0;
      ecraEm = ctx.agora();
      ecraMedido = ctx.ecra();
      medir();
    },
    // Quando a página se esconde, o ecrã em curso fecha-se: sem isto, a
    // profundidade do último ecrã de cada sessão perdia-se sempre, e o último
    // ecrã é aquele em que as pessoas desistem.
    fechar() {
      fechar();
      aberto = false;
    },
    desligar() {
      for (const d of desligadores.splice(0)) {
        try { d(); } catch { /* desligar não pode falhar */ }
      }
    },
  };
}
