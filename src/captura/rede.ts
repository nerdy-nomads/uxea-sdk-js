/**
 * Erros de rede da aplicação anfitriã. RF-CAP-04, décimo tipo.
 *
 * Um pedido que falha é o passo em que a tentativa morre sem a pessoa fazer nada
 * de errado, e sem isto aparece nos dados como hesitação: o utilizador fica no
 * mesmo ecrã, e o sistema é que não respondeu.
 *
 * **A regra que manda aqui é a do RNF-SDK-01.** Isto embrulha o `fetch` e o
 * `XMLHttpRequest` da aplicação, que é território alheio: o valor original é
 * devolvido tal e qual, os erros são relançados como estavam, e qualquer falha
 * nossa é engolida. Um SDK que estrague o `fetch` da anfitriã parte o produto
 * inteiro do cliente.
 */
import { normalizarDestino } from "../identity/element.ts";
import type { Nucleo } from "./captura.ts";

/** Só os erros da aplicação: os nossos próprios pedidos nunca entram aqui. */
function nosso(url: string, servidor: string): boolean {
  return !!servidor && url.startsWith(servidor);
}

/**
 * O que se quer saber de cada pedido além de ele ter falhado: que ele começou,
 * que acabou, e quanto tempo levou. É com isto que se separa o **tempo de espera
 * imposto pelo sistema** do tempo de decisão da pessoa (RF-GRA-21), e é com isto
 * que se sabe que um toque foi dado com a aplicação ocupada (RF-GRA-05).
 */
export interface ObservadorDePedidos {
  inicio(): void;
  fim(duracaoMs: number): void;
}

export function ligarRede(
  janela: any,
  nucleo: Nucleo,
  servidor: string,
  observador?: ObservadorDePedidos,
): { desligar(): void } {
  const desligadores: Array<() => void> = [];

  // Envolve um pedido para o contar enquanto está em voo. O `fim` corre sempre,
  // com sucesso ou sem ele: um contador de pedidos em voo que não desce é um
  // contador que passa a dizer que a aplicação está ocupada para sempre.
  const emVoo = <T>(nosso: () => Promise<T>): Promise<T> => {
    if (!observador) return nosso();
    const inicio = nucleo.agora();
    observador.inicio();
    const fim = () => observador.fim(Math.max(0, nucleo.agora() - inicio));
    return nosso().then(
      (r) => { fim(); return r; },
      (e) => { fim(); throw e; },
    );
  };

  const anotar = (url: string, estado: number) => {
    try {
      if (nosso(url, servidor)) return;
      // O destino vai como sinal de elemento, normalizado: `/pedidos/8412` vira
      // `/pedidos/{numero}`. Sem normalizar, cada pedido dava um valor diferente
      // e não havia nada para agregar; e é a mesma cadeia de sinais que o resto
      // do SDK usa, por isso o servidor reconcilia-o como reconcilia um botão.
      const destino = normalizarDestino(url);
      nucleo.emitir("erro_rede", {
        element_key: destino ? `v1|f=destino|d=${destino.slice(0, 120)}` : undefined,
        message_key: estado > 0 ? `http_${estado}` : "rede_indisponivel",
        message_kind: "erro",
      });
    } catch { /* nunca. */ }
  };

  const fetchOriginal = janela?.fetch;
  if (typeof fetchOriginal === "function") {
    const embrulhado = async function (this: any, ...args: any[]) {
      const url = String(args[0]?.url ?? args[0] ?? "");
      try {
        const r: any = await emVoo<any>(() => fetchOriginal.apply(this, args as any));
        // 5xx é falha do servidor; 4xx é a aplicação a dizer que não, e isso é
        // comportamento normal que não se marca como avaria.
        if (r && r.status >= 500) anotar(url, r.status);
        return r;
      } catch (erro) {
        anotar(url, 0);
        throw erro;
      }
    };
    janela.fetch = embrulhado;
    desligadores.push(() => { janela.fetch = fetchOriginal; });
  }

  const XHR = janela?.XMLHttpRequest;
  if (typeof XHR === "function" && XHR.prototype) {
    const abrirOriginal = XHR.prototype.open;
    const enviarOriginal = XHR.prototype.send;
    XHR.prototype.open = function (this: any, metodo: string, url: string, ...resto: any[]) {
      try { this.__uxdaUrl = String(url); } catch { /* nada */ }
      return abrirOriginal.call(this, metodo, url, ...resto);
    };
    XHR.prototype.send = function (this: any, ...args: any[]) {
      try {
        this.addEventListener("error", () => anotar(this.__uxdaUrl ?? "", 0));
        this.addEventListener("load", () => {
          if (this.status >= 500) anotar(this.__uxdaUrl ?? "", this.status);
        });
      } catch { /* nada */ }
      return enviarOriginal.apply(this, args as any);
    };
    desligadores.push(() => {
      XHR.prototype.open = abrirOriginal;
      XHR.prototype.send = enviarOriginal;
    });
  }

  return {
    desligar() {
      for (const d of desligadores.splice(0)) {
        try { d(); } catch { /* nada */ }
      }
    },
  };
}
