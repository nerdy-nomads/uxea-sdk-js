/**
 * Captura automática dos dez tipos do RF-CAP-04. Sem uma linha de instrumentação
 * na aplicação anfitriã, que é a promessa inteira do produto: capturar primeiro,
 * definir depois.
 *
 *   ecra         visualização de ecrã, incluindo navegação de página única
 *   toque        clique ou toque num elemento acionável
 *   foco         entrada num campo
 *   tecla        **primeira** tecla depois do foco, com a hesitação medida
 *   desfoco      saída do campo, com o tempo lá dentro
 *   submissao    envio de formulário
 *   erro         erro de validação
 *   recuo        navegação para trás
 *   plano_fundo  a aplicação deixou de estar à vista
 *   erro_rede    um pedido da aplicação falhou
 *
 * E, desde o cartão 4.1, a captura granular da secção 4.16, que vive em três
 * módulos ao lado: `toques.ts` (o que se tentou e não deu), `campos.ts` (como se
 * preenche, sem saber o quê) e `progressao.ts` (passos, esperas e o fim).
 *
 * **Nada aqui lê o que a pessoa escreveu.** Mede-se quando tocou, quanto tempo
 * esteve, quantas vezes voltou. O conteúdo do campo não é lido em sítio nenhum,
 * e há um ensaio de fuga que o prova (RNF-PRI-01).
 */
import { chave as chaveDoElemento, acionavel } from "../identity/index.ts";
import { protegido } from "../safe.ts";
import type { ElementoLike } from "../identity/element.ts";
import { normalizarDestino } from "../identity/element.ts";
import { serializar } from "../identidade/elemento.ts";
import { ligarToques } from "./toques.ts";
import { ligarCampos } from "./campos.ts";
import { ligarProgressao, type EstadoTerminal } from "./progressao.ts";

export interface Emissor {
  (tipo: string, extras?: Record<string, unknown>): void;
}

export interface Nucleo {
  emitir: Emissor;
  agora(): number;
  /** O ecrã atual, para os eventos que não trazem elemento. */
  ecra(): string;
  /** O nível de captura em vigor, que decide o que sai e o que não sai. */
  nivel?(): "essencial" | "padrao" | "detalhado";
  /** Pedidos da aplicação em voo, para saber se ela está ocupada. */
  emVoo?(): number;
}

/**
 * Normaliza a rota para chave de ecrã: `/pedidos/8412` vira `/pedidos/{numero}`.
 *
 * **A rota em `#` conta**, e não é detalhe: metade das aplicações de página única
 * navega assim, e sem isto todas elas apareciam como um ecrã só durante a sessão
 * inteira. Foi o ensaio no browser a sério que o mostrou, com quatro `ecra`
 * seguidos a dizer todos a mesma coisa.
 */
export function chaveDeEcra(caminho: string, hash = ""): string {
  const limpo = (caminho || "/").split("?")[0]!.split("#")[0]!;
  const base = normalizarDestino(limpo) ?? "/";
  const rota = (hash || "").replace(/^#/, "").split("?")[0]!;
  if (!rota) return base;
  return `${base}#${normalizarDestino("/" + rota.replace(/^\//, "")) ?? ""}`.replace("#/", "#/");
}

export interface Ligacao {
  /** A página deixou de estar à vista: emite o `plano_fundo` com o tempo ativo. */
  esconder(): void;
  /** E voltou: o relógio do tempo à vista recomeça. */
  mostrar(): void;
  /** Uma transição de passo declarada pela aplicação (RF-GRA-20). */
  passo(nome: string): void;
  /** Uma espera imposta pelo sistema, que não é hesitação de ninguém. */
  espera(ms: number): void;
  /** O fim da tentativa, sem ambiguidade (RF-GRA-23). */
  terminal(estado: EstadoTerminal): void;
  desligar(): void;
}

/**
 * Liga os ouvintes. Devolve o que os desliga: sem isto, uma aplicação de página
 * única que reinicia o SDK ficava com ouvintes a duplicar em cada arranque.
 */
export function ligar(janela: any, documento: any, nucleo: Nucleo): Ligacao {
  const desligadores: Array<() => void> = [];

  // **Cada ouvinte vai dentro da barreira**, e não só o que ele emite. Um erro
  // dentro de um ouvinte de `click` sobe pelo despacho do evento e vai parar ao
  // relatório de erros da aplicação anfitriã, que passa a ter avarias nossas com
  // a cara dela. Foi a bateria de injeção de falhas do cartão 2.7 que apanhou
  // isto, com um elemento que lançava ao ser interrogado.
  const ouvir = (alvo: any, evento: string, fn: any, opcoes?: any) => {
    if (!alvo || typeof alvo.addEventListener !== "function") return;
    const seguro = protegido(`captura.${evento}`, fn, undefined);
    alvo.addEventListener(evento, seguro, opcoes ?? true);
    desligadores.push(() => alvo.removeEventListener(evento, seguro, opcoes ?? true));
  };

  const chaveDe = (alvo: any): string | undefined => {
    if (!alvo || typeof alvo.tagName !== "string") return undefined;
    const c = chaveDoElemento(alvo as ElementoLike);
    return c.principal ? serializar(c) : undefined;
  };

  /* ------------------------------------------------------ captura granular */

  const nivel = () => nucleo.nivel?.() ?? "padrao";
  const detalhado = () => nivel() === "detalhado";
  const essencial = () => nivel() === "essencial";

  const campos = ligarCampos(janela, documento, {
    emitir: nucleo.emitir, agora: nucleo.agora, chaveDe, detalhado, essencial,
  });

  const toques = ligarToques(janela, documento, {
    emitir: nucleo.emitir, agora: nucleo.agora, chaveDe, detalhado,
    emVoo: () => nucleo.emVoo?.() ?? 0,
  });

  const progressao = ligarProgressao(janela, documento, {
    emitir: nucleo.emitir, agora: nucleo.agora, essencial,
    campoDeAbandono: () => campos.campoDeAbandono(),
  });

  desligadores.push(() => campos.desligar());
  desligadores.push(() => toques.desligar());
  desligadores.push(() => progressao.desligar());

  /* ------------------------------------------------------------------ ecrã */

  let ecraAtual = "";
  const verEcra = (motivo: "carregamento" | "navegacao" | "recuo") => {
    const nova = nucleo.ecra();
    // Um recuo para o mesmo ecrã não é uma visualização nova, mas continua a ser
    // um recuo: o tipo do evento distingue, e a chave do ecrã não muda.
    if (nova === ecraAtual && motivo !== "recuo") return;
    ecraAtual = nova;
    nucleo.emitir(motivo === "recuo" ? "recuo" : "ecra", { screen_key: nova });
    // Um ecrã novo é um passo novo, e é onde a contagem até à primeira interação
    // recomeça: o RF-GRA-08 mede-a por ecrã, e não por sessão.
    toques.ecraNovo();
    progressao.passo(nova);
  };

  // Uma aplicação de página única não recarrega: a navegação é uma chamada ao
  // `history`, e sem isto o SDK via um ecrã só durante a sessão inteira.
  const historico = janela?.history;
  const originais: Record<string, any> = {};
  for (const nome of ["pushState", "replaceState"]) {
    if (historico && typeof historico[nome] === "function") {
      originais[nome] = historico[nome].bind(historico);
      historico[nome] = (...args: any[]) => {
        const r = originais[nome](...args);
        try { verEcra("navegacao"); } catch { /* a barreira do SDK trata */ }
        return r;
      };
      desligadores.push(() => { historico[nome] = originais[nome]; });
    }
  }

  // `popstate` é para trás **e** para a frente. O que distingue é o índice que
  // guardamos no estado do histórico: sem ele, um "recuo" seria adivinhação.
  let indice = 0;
  try {
    const estado = janela?.history?.state;
    indice = typeof estado?.__uxda === "number" ? estado.__uxda : 0;
    janela?.history?.replaceState?.({ ...(estado ?? {}), __uxda: indice }, "");
  } catch { /* histórico bloqueado: fica sem deteção de recuo */ }
  if (historico && originais["pushState"]) {
    const anterior = historico.pushState;
    historico.pushState = (estado: any, ...resto: any[]) => {
      indice++;
      return anterior({ ...(estado ?? {}), __uxda: indice }, ...resto);
    };
  }
  ouvir(janela, "popstate", (e: any) => {
    const novo = typeof e?.state?.__uxda === "number" ? e.state.__uxda : indice - 1;
    const paraTras = novo < indice;
    indice = novo;
    verEcra(paraTras ? "recuo" : "navegacao");
  });
  ouvir(janela, "hashchange", () => verEcra("navegacao"));

  /* ------------------------------------------------------------- interação */

  ouvir(documento, "click", (e: any) => {
    const alvo = e?.target;
    if (!alvo || typeof alvo.tagName !== "string") return;
    // Sobe até ao acionável: quem clica num ícone dentro de um botão clicou no
    // botão, e é o botão que é a unidade de funcionalidade (ADR 0007).
    let el: any = alvo;
    for (let i = 0; i < 5 && el; i++) {
      if (acionavel(el as ElementoLike)) break;
      el = el.parentElement;
    }
    if (!el) return;
    nucleo.emitir("toque", { element_key: chaveDe(el) });
  });

  // O foco, a tecla e o desfoco são agora do `campos.ts`, que os agrega num
  // evento por campo em vez de três por campo. O que ficou aqui era, à letra, o
  // que o RF-GRA-29 manda não fazer.

  /* ---------------------------------------------------- formulário e erros */

  ouvir(documento, "submit", (e: any) => {
    // O retrato de cada campo sai primeiro, e a contagem vai no próprio evento
    // de submissão: quem olha para a submissão vê logo se ela foi feita com
    // metade do formulário vazio.
    const contagem = campos.aoSubmeter(e?.target);
    nucleo.emitir("submissao", {
      element_key: chaveDe(e?.target),
      properties: {
        campos_preenchidos: contagem.preenchidos,
        campos_vazios: contagem.vazios,
        campos_com_erro: contagem.com_erro,
      },
    });
  });

  // `invalid` é o que o browser dispara quando a validação nativa recusa um
  // campo. Guarda-se **que** campo falhou, e nunca a mensagem, que costuma trazer
  // o valor escrito lá dentro.
  ouvir(documento, "invalid", (e: any) => {
    // Quem conta as tentativas até resolver é o `campos.ts`, que sabe quantas
    // vezes aquele campo já falhou nesta tentativa (RF-GRA-17).
    campos.aoErrar(e?.target, "validacao_nativa");
  });

  /* ------------------------------------------------------------ ciclo de vida */

  // O tempo que a página esteve mesmo à vista, e não o tempo desde que abriu: um
  // separador aberto de manhã e esquecido não são oito horas de uso.
  //
  // Vai no `duration_ms` do `plano_fundo`, que é onde o SDK Android o põe. Sem ele
  // dos dois lados, a comparação entre a aplicação móvel e o sítio Web da mesma
  // organização (RF-ADM-10) tem o número numa plataforma e um vazio na outra.
  //
  // **Quem ouve o `visibilitychange` é o arranque, e não este módulo.** O ouvinte
  // do fecho está registado na janela, em fase de captura, e por isso corre
  // *antes* de qualquer ouvinte do documento: a fila era despejada e só depois é
  // que o `plano_fundo` era emitido, ficando para trás numa página a morrer.
  // Tendo os dois no mesmo sítio, a ordem vê-se.
  let aVistaDesde = documento?.visibilityState === "hidden" ? 0 : nucleo.agora();
  let tempoAtivoMs = 0;

  return {
    esconder() {
      if (aVistaDesde > 0) tempoAtivoMs += Math.max(0, Math.round(nucleo.agora() - aVistaDesde));
      aVistaDesde = 0;
      toques.fechar();
      campos.esconder();
      nucleo.emitir("plano_fundo", { duration_ms: tempoAtivoMs });
      // O abandono marca-se **depois** do plano de fundo, e é de propósito: a
      // ordem no armazenamento passa a ser a ordem em que as coisas aconteceram.
      progressao.esconder();
    },
    mostrar() {
      if (aVistaDesde === 0) aVistaDesde = nucleo.agora();
      campos.mostrar();
      progressao.mostrar();
    },
    passo: (nome: string) => progressao.passo(nome),
    espera: (ms: number) => progressao.espera(ms),
    terminal: (estado: EstadoTerminal) => progressao.terminal(estado),
    desligar() {
      for (const d of desligadores.splice(0)) {
        try { d(); } catch { /* desligar não pode falhar */ }
      }
    },
  };
}

