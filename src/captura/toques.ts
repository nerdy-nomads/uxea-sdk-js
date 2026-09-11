/**
 * Tentativas de interação: o que a pessoa tentou e não deu. Cartões 4.1 e 9.1,
 * RF-GRA-01 a RF-GRA-05, RF-GRA-08 e RF-IND-01 a RF-IND-03.
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
 *
 * # O que o cartão 9.1 acrescentou, e porquê são três percentagens e não uma
 *
 * O rastreio individual precisa de responder a duas perguntas diferentes sobre o
 * mesmo toque, e uma coordenada só responde a uma delas:
 *
 *   - **`toque_x` é da janela**, e é o que desenha o mapa de calor: sobrepõe
 *     telemóveis e computadores porque é relativo ao visor de cada um;
 *   - **`alvo_x` é da caixa do elemento**, e é o que diz se a pessoa acertou no
 *     meio do botão ou na beira dele. Cinquenta toques todos a 5% da borda
 *     esquerda de um botão são um botão com a área de toque mal desenhada, e no
 *     mapa da janela eles aparecem como uma mancha no sítio certo;
 *   - **`alvo_caixa` é a caixa do elemento na janela**, e é dela que a
 *     reconstrução esquemática do ecrã se faz (cartão 9.2). É a peça que permite
 *     desenhar o ecrã **sem nunca o fotografar**: o esquema é a mediana das caixas
 *     que os toques observaram, e não uma imagem.
 *
 * E vai a `ordem_na_sequencia`, que é a posição desta interação dentro do ecrã.
 * Sem ela, duas interações no mesmo milissegundo não se conseguem ordenar, e a
 * reconstrução do cartão 9.3 tinha de adivinhar qual veio primeiro.
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
  /**
   * Verdadeiro quando o projeto tem o rastreio individual ligado (cartão 9.5).
   *
   * **É uma segunda condição, e não a mesma que o nível detalhado.** O nível diz
   * quanta granularidade se capta; isto diz se é legítimo seguir uma pessoa. Um
   * projeto pode querer o detalhe agregado sem querer o individual, e é
   * exatamente esse o caso que o `RF-IND-09` existe para permitir.
   */
  individual?(): boolean;
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

/**
 * A caixa do elemento na janela, em percentagem, como `"x,y,largura,altura"`.
 *
 * **É texto e não quatro números**, porque quatro propriedades por toque são
 * quatro chaves a mais no esquema e no armazenamento para dizer uma coisa só. E é
 * em percentagem pela mesma razão das coordenadas: é o que permite sobrepor o que
 * um telemóvel viu e o que um computador viu no mesmo esquema.
 *
 * Devolve vazio quando o elemento não sabe a sua caixa (um nó sem `layout`, um
 * documento a fechar): **melhor não desenhar do que desenhar no sítio errado**.
 */
export function caixaDe(el: any, largura: number, altura: number): string {
  const r = typeof el?.getBoundingClientRect === "function" ? el.getBoundingClientRect() : null;
  if (!r || !(r.width > 0) || !(r.height > 0)) return "";
  const pc = (v: number, total: number) =>
    Math.max(0, Math.min(100, Math.round((v / Math.max(1, total || 1)) * 100)));
  return [
    pc(r.left, largura), pc(r.top, altura),
    pc(r.width, largura), pc(r.height, altura),
  ].join(",");
}

/**
 * Onde é que o toque caiu **dentro** do elemento, em percentagem da caixa dele.
 *
 * Cinquenta toques todos a 5% da borda esquerda de um botão são um botão com a
 * área de toque mal desenhada, e no mapa da janela eles aparecem como uma mancha
 * no sítio certo. É esta a pergunta que o `alvo_x` responde e a outra não.
 */
export function dentroDoAlvo(el: any, x: number, y: number): { alvo_x: number; alvo_y: number } | null {
  const r = typeof el?.getBoundingClientRect === "function" ? el.getBoundingClientRect() : null;
  if (!r || !(r.width > 0) || !(r.height > 0)) return null;
  const pc = (v: number, total: number) =>
    Math.max(0, Math.min(100, Math.round((v / Math.max(1, total)) * 100)));
  return { alvo_x: pc(x - r.left, r.width), alvo_y: pc(y - r.top, r.height) };
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
  /**
   * A posição do último gesto, para o evento de `toque` a levar consigo.
   * Cartão 9.1, RF-IND-02.
   *
   * # Porque é que isto existe, e é o defeito que corrigiu
   *
   * Um toque **que funciona** não é emitido aqui: o `pointerdown` só emite os
   * três casos em que nada aconteceu (sem alvo, desativado, em carregamento), e
   * o toque normal sai do `click` da captura base, que é onde a identidade do
   * elemento se resolve. O resultado é que as coordenadas saíam nos toques
   * mortos e **não saíam nos toques normais**, e o mapa de calor do cartão 9.2
   * ficava a desenhar só as falhas.
   *
   * Deu-se por isso a correr a loja de ensaio no browser: os eventos de `toque`
   * chegavam com `properties` vazio. Nenhum ensaio o apanhava, porque todos
   * verificavam os três casos que este módulo emite.
   *
   * O `click` segue sempre o `pointerdown` no mesmo alvo, e por isso a posição
   * que aqui se guarda é a daquele gesto. Um clique sem `pointerdown` (teclado,
   * `element.click()`) não tem posição nenhuma, e devolve-se vazio em vez de se
   * inventar uma.
   */
  posicaoDoToque(el: any): Record<string, unknown>;
}

export function ligarToques(janela: any, documento: any, ctx: ContextoDeToque): LigacaoDeToques {
  const desligadores: Array<() => void> = [];

  let ecraMostradoEm = ctx.agora();
  let jaInteragiu = false;
  // O gesto mais recente, para o `click` o poder levar consigo.
  let ultimaPosicao: { alvo: any; em: number; props: Record<string, unknown> } | null = null;
  // A ordem da interação **dentro do ecrã**, e não da sessão: é assim que o
  // RF-IND-01 a pede, e é o que faz duas visitas ao mesmo ecrã comparar-se uma com
  // a outra. Recomeça no `ecraNovo`.
  let ordem = 0;

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
    const larguraVisor = janela?.innerWidth || 1;
    const alturaVisor = janela?.innerHeight || 1;
    const porCento = (v: number, total: number) =>
      Math.max(0, Math.min(100, Math.round((v / Math.max(1, total || 1)) * 100)));

    // **Duas condições, e não uma.** O nível detalhado diz quanta granularidade se
    // capta; o rastreio individual diz se é legítimo seguir uma pessoa. As
    // coordenadas só saem quando as duas estão ligadas, e é isso que faz desligar
    // o rastreio no cartão 9.5 parar mesmo de recolher, e não só de mostrar.
    const segue = ctx.detalhado() && (ctx.individual?.() ?? true);
    ordem++;
    const coordenadas = segue
      ? {
          toque_x: porCento(x, larguraVisor),
          toque_y: porCento(y, alturaVisor),
          visor_largura: larguraVisor,
          visor_altura: alturaVisor,
          ordem_na_sequencia: ordem,
        }
      : {};
    const zona = zonaDe(x, y, larguraVisor, alturaVisor);

    if (!alvo) {
      ultimaPosicao = null;
      ctx.emitir("toque_sem_alvo", { properties: { ...coordenadas, zona } });
      return;
    }
    // A caixa do alvo e o ponto dentro dela. É daqui que sai o esquema do ecrã do
    // cartão 9.2, sem nenhuma captura: o desenho é a mediana das caixas que os
    // toques observaram.
    const doAlvo = segue
      ? {
          ...(dentroDoAlvo(alvo, x, y) ?? {}),
          ...(caixaDe(alvo, larguraVisor, alturaVisor)
            ? { alvo_caixa: caixaDe(alvo, larguraVisor, alturaVisor) }
            : {}),
        }
      : {};
    // Guardada para o `click` a poder levar no evento de `toque`. Ver o comentário
    // de `posicaoDoToque`.
    ultimaPosicao = { alvo, em: ctx.agora(), props: { ...coordenadas, ...doAlvo, zona } };
    if (estaDesativado(alvo)) {
      ctx.emitir("toque_desativado", {
        element_key: chave,
        properties: { ...coordenadas, ...doAlvo, zona, alvo_desativado: true },
      });
      return;
    }
    // A partir daqui houve alvo acionável, e o `click` trata do `toque`. O que
    // fica por dizer é se o sistema estava ocupado, e se ela está a insistir.
    if (ctx.emVoo() > 0 || ocupado(alvo, documento)) {
      ctx.emitir("toque_em_carregamento", {
        element_key: chave,
        properties: { ...coordenadas, ...doAlvo, zona, em_carregamento: true },
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
      ordem = 0;
    },
    fechar: fecharRajada,
    posicaoDoToque(el: any) {
      const u = ultimaPosicao;
      if (!u) return {};
      // **Um segundo, e não mais.** Um `click` que chegue muito depois do
      // `pointerdown` é de outro gesto (um menu que abriu, um diálogo que fechou),
      // e levar a posição do anterior seria pôr o toque no sítio errado.
      if (ctx.agora() - u.em > 1000) return {};
      // O alvo do `click` pode ser um ascendente do alvo do `pointerdown`: quem
      // carrega num ícone dentro de um botão carregou no botão, e é o botão que a
      // captura base identifica (ADR 0007).
      if (u.alvo !== el && !(typeof el?.contains === "function" && el.contains(u.alvo))) {
        return {};
      }
      return u.props;
    },
    desligar() {
      fecharRajada();
      for (const d of desligadores.splice(0)) {
        try { d(); } catch { /* desligar não pode falhar */ }
      }
    },
  };
}
