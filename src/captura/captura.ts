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
 * **Nada aqui lê o que a pessoa escreveu.** Mede-se quando tocou, quanto tempo
 * esteve, quantas vezes voltou. O conteúdo do campo não é lido em sítio nenhum,
 * e há um ensaio de fuga que o prova (RNF-PRI-01).
 */
import { chave as chaveDoElemento, acionavel } from "../identity/index.ts";
import { protegido } from "../safe.ts";
import type { ElementoLike } from "../identity/element.ts";
import { normalizarDestino } from "../identity/element.ts";
import { serializar } from "../identidade/elemento.ts";

export interface Emissor {
  (tipo: string, extras?: Record<string, unknown>): void;
}

export interface Nucleo {
  emitir: Emissor;
  agora(): number;
  /** O ecrã atual, para os eventos que não trazem elemento. */
  ecra(): string;
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

interface EstadoCampo {
  focadoEm: number;
  jaEscreveu: boolean;
  chave: string;
}

export interface Ligacao {
  desligar(): void;
}

/**
 * Liga os ouvintes. Devolve o que os desliga: sem isto, uma aplicação de página
 * única que reinicia o SDK ficava com ouvintes a duplicar em cada arranque.
 */
export function ligar(janela: any, documento: any, nucleo: Nucleo): Ligacao {
  const desligadores: Array<() => void> = [];
  const campos = new WeakMap<object, EstadoCampo>();

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

  /* ------------------------------------------------------------------ ecrã */

  let ecraAtual = "";
  const verEcra = (motivo: "carregamento" | "navegacao" | "recuo") => {
    const nova = nucleo.ecra();
    // Um recuo para o mesmo ecrã não é uma visualização nova, mas continua a ser
    // um recuo: o tipo do evento distingue, e a chave do ecrã não muda.
    if (nova === ecraAtual && motivo !== "recuo") return;
    ecraAtual = nova;
    nucleo.emitir(motivo === "recuo" ? "recuo" : "ecra", { screen_key: nova });
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

  ouvir(documento, "focusin", (e: any) => {
    const el = e?.target;
    if (!el || !ehCampo(el)) return;
    const c = chaveDe(el);
    campos.set(el, { focadoEm: nucleo.agora(), jaEscreveu: false, chave: c ?? "" });
    nucleo.emitir("foco", { element_key: c });
  });

  ouvir(documento, "keydown", (e: any) => {
    const el = e?.target;
    if (!el || !ehCampo(el)) return;
    const est = campos.get(el);
    if (!est || est.jaEscreveu) return;
    est.jaEscreveu = true;
    // A hesitação: quanto tempo esteve com o campo à frente antes de escrever.
    // O que **não** vai aqui é a tecla: `e.key` nunca é lido.
    nucleo.emitir("tecla", {
      element_key: est.chave || chaveDe(el),
      duration_ms: Math.max(0, Math.round(nucleo.agora() - est.focadoEm)),
    });
  });

  ouvir(documento, "focusout", (e: any) => {
    const el = e?.target;
    if (!el || !ehCampo(el)) return;
    const est = campos.get(el);
    campos.delete(el);
    nucleo.emitir("desfoco", {
      element_key: est?.chave || chaveDe(el),
      duration_ms: est ? Math.max(0, Math.round(nucleo.agora() - est.focadoEm)) : undefined,
    });
  });

  /* ---------------------------------------------------- formulário e erros */

  ouvir(documento, "submit", (e: any) => {
    nucleo.emitir("submissao", { element_key: chaveDe(e?.target) });
  });

  // `invalid` é o que o browser dispara quando a validação nativa recusa um
  // campo. Guarda-se **que** campo falhou, e nunca a mensagem, que costuma trazer
  // o valor escrito lá dentro.
  ouvir(documento, "invalid", (e: any) => {
    nucleo.emitir("erro", {
      element_key: chaveDe(e?.target),
      message_key: "validacao_nativa",
      message_kind: "erro",
    });
  });

  /* ------------------------------------------------------------ ciclo de vida */

  // O tempo que a página esteve mesmo à vista, e não o tempo desde que abriu: um
  // separador aberto de manhã e esquecido não são oito horas de uso.
  //
  // Vai no `duration_ms` do `plano_fundo`, que é onde o SDK Android o põe. Sem ele
  // dos dois lados, a comparação entre a aplicação móvel e o sítio Web da mesma
  // organização (RF-ADM-10) tem o número numa plataforma e um vazio na outra.
  let aVistaDesde = documento?.visibilityState === "hidden" ? 0 : nucleo.agora();
  let tempoAtivoMs = 0;

  ouvir(documento, "visibilitychange", () => {
    if (documento?.visibilityState === "hidden") {
      if (aVistaDesde > 0) tempoAtivoMs += Math.max(0, Math.round(nucleo.agora() - aVistaDesde));
      aVistaDesde = 0;
      nucleo.emitir("plano_fundo", { duration_ms: tempoAtivoMs });
    } else if (aVistaDesde === 0) {
      aVistaDesde = nucleo.agora();
    }
  });

  return {
    desligar() {
      for (const d of desligadores.splice(0)) {
        try { d(); } catch { /* desligar não pode falhar */ }
      }
    },
  };
}

function ehCampo(el: any): boolean {
  const tag = String(el?.tagName ?? "").toUpperCase();
  if (tag === "TEXTAREA" || tag === "SELECT") return true;
  if (tag !== "INPUT") return el?.isContentEditable === true;
  const tipo = String(el.getAttribute?.("type") ?? "text").toLowerCase();
  return tipo !== "hidden" && tipo !== "submit" && tipo !== "button";
}
