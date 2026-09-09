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

  // A mesma rota a falhar dez vezes num segundo é uma falha, e não dez. O que se
  // guarda é a chave e o instante: nunca o corpo, nunca o endereço por inteiro.
  const ultimas = new Map<string, number>();
  const repetido = (id: string): boolean => {
    const agora = nucleo.agora();
    const antes = ultimas.get(id);
    if (antes !== undefined && agora - antes < 3000) return true;
    ultimas.set(id, agora);
    if (ultimas.size > 100) {
      for (const [k, q] of ultimas) if (agora - q > 60_000) ultimas.delete(k);
    }
    return false;
  };

  /**
   * A operação, que é o primeiro segmento do caminho: `/pagamentos/8412` dá
   * `pagamentos`. É o que permite a taxa de sucesso por operação do RF-MSG-17 sem
   * ninguém instrumentar nada, e é de baixa cardinalidade de propósito.
   */
  const operacaoDe = (destino: string): string | undefined => {
    const seg = destino.split("/").filter(Boolean)[0];
    return seg && !seg.startsWith("{") ? seg.slice(0, 32) : undefined;
  };

  /**
   * Um erro técnico é um erro que **ninguém viu**, e é isso que o separa de tudo o
   * resto no catálogo (RF-MSG-06). Não produz mensagem no ecrã, produz abandono, e
   * sem ele a causa provável do abandono do 12.2 fica cega ao motivo mais
   * frequente de todos.
   *
   * Os três casos vão distinguidos, e não somados:
   *
   *   `rede_indisponivel`  o pedido não chegou a lado nenhum
   *   `rede_expirou`       chegou, e a resposta não veio a tempo
   *   `http_<n>`           chegou e respondeu, e a resposta é um erro
   */
  const anotar = (url: string, estado: number, expirou = false) => {
    try {
      if (nosso(url, servidor)) return;
      // O destino vai como sinal de elemento, normalizado: `/pedidos/8412` vira
      // `/pedidos/{numero}`. Sem normalizar, cada pedido dava um valor diferente
      // e não havia nada para agregar; e é a mesma cadeia de sinais que o resto
      // do SDK usa, por isso o servidor reconcilia-o como reconcilia um botão.
      const destino = normalizarDestino(url) ?? "";
      const chave = expirou ? "rede_expirou" : estado > 0 ? `http_${estado}` : "rede_indisponivel";
      if (repetido(`${destino}|${chave}`)) return;
      const operacao = operacaoDe(destino);
      nucleo.emitir("erro_rede", {
        element_key: destino ? `v1|f=destino|d=${destino.slice(0, 120)}` : undefined,
        message_key: chave,
        message_kind: "erro",
        properties: {
          // **Invisível ao utilizador**: é o que o distingue de uma mensagem de
          // erro no ecrã, e é a coluna por onde o catálogo os separa.
          visivel: false,
          // 5xx é o sistema a falhar; 4xx é a operação a ser recusada, e é
          // trabalho de outra equipa. Uma queda de rede não é nem uma nem outra.
          classe_erro: estado >= 500 || estado === 0 ? "sistema" : "operacao",
          ...(estado > 0 ? { codigo_http: estado } : {}),
          ...(operacao ? { operacao } : {}),
        },
      });
    } catch { /* nunca. */ }
  };

  const fetchOriginal = janela?.fetch;
  if (typeof fetchOriginal === "function") {
    const embrulhado = async function (this: any, ...args: any[]) {
      const url = String(args[0]?.url ?? args[0] ?? "");
      try {
        const r: any = await emVoo<any>(() => fetchOriginal.apply(this, args as any));
        // **Os 4xx contam, e antes não contavam.** A primeira versão dizia que um
        // 4xx é a aplicação a dizer que não, e isso é verdade; só que o RF-MSG-06
        // pede as respostas de erro do servidor recebidas pelo cliente, e um 422
        // que ninguém mostra no ecrã é exatamente o abandono que não se explica.
        // O que os separa é a `classe_erro`, e não deixá-los de fora.
        if (r && r.status >= 400) anotar(url, r.status);
        return r;
      } catch (erro: any) {
        // Um pedido cancelado por tempo esgotado chega aqui como `AbortError`, e
        // é uma coisa diferente de não haver rede: o sistema respondeu tarde.
        const expirou = erro?.name === "AbortError" || erro?.name === "TimeoutError";
        anotar(url, 0, expirou);
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
        // O `timeout` do XHR é o único sítio onde o browser diz, com todas as
        // letras, que a espera acabou sem resposta.
        this.addEventListener("timeout", () => anotar(this.__uxdaUrl ?? "", 0, true));
        this.addEventListener("load", () => {
          if (this.status >= 400) anotar(this.__uxdaUrl ?? "", this.status);
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
