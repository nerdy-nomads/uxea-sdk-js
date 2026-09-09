/**
 * Tentativas de interação: o que a pessoa tentou e não deu. Cartão 4.1,
 * RF-GRA-01 a RF-GRA-05 e RF-GRA-08.
 *
 * O documento chama a estes os sinais mais subvalorizados que existem, e a razão
 * é simples: uma zona onde muita gente toca e nada acontece é uma falha de desenho
 * documentada com precisão, e nenhuma ferramenta de funis a revela, porque um funil
 * só vê os passos que **aconteceram**.
 *
 * Quatro casos, e a distinção entre eles é o que os torna acionáveis:
 *
 *   toque_sem_alvo         tocou onde não havia nada acionável
 *   toque_desativado       tocou num botão desativado, e ninguém lhe disse porquê
 *   toque_repetido         tocou várias vezes seguidas: o sistema não respondeu à vista dele
 *   toque_em_carregamento  tocou enquanto o sistema estava ocupado, sem o perceber
 *
 * **Porque é que isto ouve `pointerdown` e não `click`.** Um elemento desativado
 * não despacha `click` nenhum: o browser suprime o evento, e o caso mais
 * interessante dos quatro seria invisível. O `pointerdown` chega ao documento na
 * mesma, e o `elementFromPoint` diz o que está mesmo debaixo do dedo, desativado
 * ou não.
 */
import { protegido } from "../safe.ts";
import { acionavel } from "../identity/index.ts";
import type { ElementoLike } from "../identity/element.ts";

export interface ContextoDeToque {
  emitir(tipo: string, extras?: Record<string, unknown>): void;
  agora(): number;
  /** Quantos pedidos da aplicação estão em voo, para saber se ela está ocupada. */
  emVoo(): number;
  /** Coordenadas só no nível detalhado; a zona vai sempre. */
  detalhado(): boolean;
  chaveDe(el: any): string | undefined;
}

/** Uma rajada acaba quando passa este tempo sem outro toque no mesmo sítio. */
export const JANELA_DE_RAJADA_MS = 1200;

/**
 * A zona é uma grelha grosseira sobre a janela, e não as coordenadas.
 *
 * Serve para agrupar: "muita gente toca no canto inferior direito do ecrã de
 * pagamento" é acionável, e "alguém tocou no pixel 412,908" não é. E é o que
 * permite juntar telemóveis e computadores no mesmo mapa, que com pixels não dava.
 */
export function zonaDe(x: number, y: number, largura: number, altura: number): string {
  const col = Math.min(5, Math.max(0, Math.floor((x / Math.max(1, largura)) * 6)));
  const lin = Math.min(9, Math.max(0, Math.floor((y / Math.max(1, altura)) * 10)));
  return `${col}x${lin}`;
}

function estaDesativado(el: any): boolean {
  if (!el) return false;
  if (el.disabled === true) return true;
  const aria = typeof el.getAttribute === "function" ? el.getAttribute("aria-disabled") : null;
  return aria === "true";
}

function ocupado(el: any, documento: any): boolean {
  let atual: any = el;
  for (let i = 0; i < 8 && atual; i++) {
    if (typeof atual.getAttribute === "function" && atual.getAttribute("aria-busy") === "true") return true;
    atual = atual.parentElement;
  }
  return documento?.body?.getAttribute?.("aria-busy") === "true";
}

/** Sobe até ao acionável mais próximo, que é a unidade de funcionalidade (ADR 0007). */
function subirAteAcionavel(el: any): any {
  let atual: any = el;
  for (let i = 0; i < 5 && atual; i++) {
    if (acionavel(atual as ElementoLike) || estaDesativado(atual)) return atual;
    atual = atual.parentElement;
  }
  return null;
}

export interface LigacaoDeToques {
  /** Um ecrã novo recomeça a contagem até à primeira interação. */
  ecraNovo(): void;
  /** Fecha a rajada em curso, se houver. Chamado quando a página se esconde. */
  fechar(): void;
  desligar(): void;
}

export function ligarToques(janela: any, documento: any, ctx: ContextoDeToque): LigacaoDeToques {
  const desligadores: Array<() => void> = [];

  let ecraMostradoEm = ctx.agora();
  let jaInteragiu = false;

  // A rajada: o mesmo elemento tocado várias vezes seguidas. Emite-se **uma vez
  // no fim**, com a contagem e o intervalo médio, e não um evento por toque: um
  // sinal de frustração que multiplica o volume por três é um sinal que ninguém
  // vai deixar ligado.
  let rajadaChave = "";
  let rajadaToques = 0;
  let rajadaPrimeiroEm = 0;
  let rajadaUltimoEm = 0;
  let temporizador: any = null;

  const fecharRajada = () => {
    if (rajadaToques >= 2 && rajadaChave) {
      const total = Math.max(0, Math.round(rajadaUltimoEm - rajadaPrimeiroEm));
      ctx.emitir("toque_repetido", {
        element_key: rajadaChave,
        duration_ms: total,
        properties: {
          repeticoes: rajadaToques,
          intervalo_ms: Math.round(total / Math.max(1, rajadaToques - 1)),
        },
      });
    }
    rajadaChave = "";
    rajadaToques = 0;
    if (temporizador !== null) {
      janela?.clearTimeout?.(temporizador);
      temporizador = null;
    }
  };

  const anotarRajada = (chave: string) => {
    const agora = ctx.agora();
    if (chave !== rajadaChave || agora - rajadaUltimoEm > JANELA_DE_RAJADA_MS) {
      fecharRajada();
      rajadaChave = chave;
      rajadaToques = 1;
      rajadaPrimeiroEm = agora;
    } else {
      rajadaToques++;
    }
    rajadaUltimoEm = agora;
    if (temporizador !== null) janela?.clearTimeout?.(temporizador);
    temporizador = janela?.setTimeout?.(protegido("captura.rajada", fecharRajada, undefined), JANELA_DE_RAJADA_MS);
  };

  const ouvir = (alvo: any, evento: string, fn: any) => {
    if (!alvo || typeof alvo.addEventListener !== "function") return;
    const seguro = protegido(`captura.${evento}`, fn, undefined);
    alvo.addEventListener(evento, seguro, true);
    desligadores.push(() => alvo.removeEventListener(evento, seguro, true));
  };

  const primeiraInteracao = () => {
    if (jaInteragiu) return;
    jaInteragiu = true;
    ctx.emitir("primeira_interacao", {
      duration_ms: Math.max(0, Math.round(ctx.agora() - ecraMostradoEm)),
    });
  };

  ouvir(documento, "pointerdown", (e: any) => {
    primeiraInteracao();

    const x = typeof e?.clientX === "number" ? e.clientX : 0;
    const y = typeof e?.clientY === "number" ? e.clientY : 0;
    // O que está mesmo debaixo do dedo, e não o que o browser resolveu despachar:
    // é a única forma de ver um elemento desativado.
    const sob = typeof documento?.elementFromPoint === "function"
      ? documento.elementFromPoint(x, y)
      : e?.target;
    const alvo = subirAteAcionavel(sob);
    const chave = alvo ? ctx.chaveDe(alvo) : undefined;

    // Em percentagem da janela e presa entre 0 e 100: um toque fora da área
    // visível, ou uma janela que ainda não sabe o seu tamanho, davam números que
    // não querem dizer nada e que estragavam qualquer mapa de calor.
    const porCento = (v: number, total: number) =>
      Math.max(0, Math.min(100, Math.round((v / Math.max(1, total || 1)) * 100)));
    const coordenadas = ctx.detalhado()
      ? { toque_x: porCento(x, janela?.innerWidth), toque_y: porCento(y, janela?.innerHeight) }
      : {};
    const zona = zonaDe(x, y, janela?.innerWidth || 1, janela?.innerHeight || 1);

    if (!alvo) {
      ctx.emitir("toque_sem_alvo", { properties: { ...coordenadas, zona } });
      return;
    }
    if (estaDesativado(alvo)) {
      ctx.emitir("toque_desativado", {
        element_key: chave,
        properties: { ...coordenadas, zona, alvo_desativado: true },
      });
      return;
    }
    // A partir daqui houve alvo acionável, e o `click` trata do `toque`. O que
    // fica por dizer é se o sistema estava ocupado, e se ela está a insistir.
    if (ctx.emVoo() > 0 || ocupado(alvo, documento)) {
      ctx.emitir("toque_em_carregamento", {
        element_key: chave,
        properties: { ...coordenadas, em_carregamento: true },
      });
    }
    if (chave) anotarRajada(chave);
  });

  // Escrever também conta como interagir: num formulário que abre com o cursor
  // no primeiro campo, a primeira interação é uma tecla e não um toque.
  ouvir(documento, "keydown", () => primeiraInteracao());

  return {
    ecraNovo() {
      fecharRajada();
      ecraMostradoEm = ctx.agora();
      jaInteragiu = false;
    },
    fechar: fecharRajada,
    desligar() {
      fecharRajada();
      for (const d of desligadores.splice(0)) {
        try { d(); } catch { /* desligar não pode falhar */ }
      }
    },
  };
}
