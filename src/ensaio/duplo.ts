/**
 * O browser de ensaio.
 *
 * Não é um duplo do SDK: é um duplo **do browser**, e o SDK corre inteiro por
 * cima dele. É a diferença entre testar o que se escreveu e testar o que vai
 * acontecer: o relógio, o armazenamento e a rede são controlados, e o DOM é a
 * sério (`linkedom`), com eventos que sobem e descem como no browser.
 */
import { parseHTML } from "linkedom";
import type { Armazenamento, Resposta } from "../core/tipos.ts";

export interface Pedido {
  url: string;
  corpo: string;
  cabecalhos: Record<string, string>;
  sincrono: boolean;
  metodo: string;
  /** O que a ingestão de ensaio respondeu. Uma tentativa falhada não é entrega. */
  estado: number;
}

export interface Browser {
  janela: any;
  documento: any;
  loja: Armazenamento;
  pedidos: Pedido[];
  /** Eventos que chegaram à ingestão de ensaio, já desempacotados do lote. */
  eventos(): any[];
  /** Avança o relógio e corre os temporizadores que vencerem. */
  avancar(ms: number): Promise<void>;
  agora(): number;
  /** Passa a responder assim a partir de agora. */
  responder(fn: (p: Pedido) => Resposta): void;
  ambiente(): any;
}

class AlvoSimples {
  private ouvintes = new Map<string, Set<Function>>();
  addEventListener(tipo: string, fn: Function): void {
    if (!this.ouvintes.has(tipo)) this.ouvintes.set(tipo, new Set());
    this.ouvintes.get(tipo)!.add(fn);
  }
  removeEventListener(tipo: string, fn: Function): void {
    this.ouvintes.get(tipo)?.delete(fn);
  }
  disparar(tipo: string, evento: any = {}): void {
    for (const fn of Array.from(this.ouvintes.get(tipo) ?? [])) fn({ type: tipo, ...evento });
  }
}

export function memoria(): Armazenamento {
  const m = new Map<string, string>();
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => void m.set(k, v),
    removeItem: (k) => void m.delete(k),
  };
}

export function criarBrowser(html = "<h1>ensaio</h1>", opcoes: { caminho?: string; loja?: Armazenamento } = {}): Browser {
  const { document, window } = parseHTML(`<!doctype html><html><body>${html}</body></html>`);
  const loja = opcoes.loja ?? memoria();
  let relogio = Date.parse("2026-09-07T10:00:00.000Z");
  const pedidos: Pedido[] = [];
  let resposta: (p: Pedido) => Resposta = () => ({ estado: 202, corpo: '{"sucesso":true}' });

  const temporizadores: Array<{ quando: number; fn: Function; id: number }> = [];
  let seqTemporizador = 0;
  const alvoJanela = new AlvoSimples();

  const janela: any = {
    document,
    location: { pathname: opcoes.caminho ?? "/", href: "https://exemplo.ao" + (opcoes.caminho ?? "/"), hash: "" },
    history: {
      state: null as any,
      pushState(estado: any, _t: string, url?: string) {
        this.state = estado;
        if (url) janela.location.pathname = String(url);
      },
      replaceState(estado: any, _t: string, url?: string) {
        this.state = estado;
        if (url) janela.location.pathname = String(url);
      },
    },
    // O relógio do SDK é falso (para os ensaios controlarem o tempo), mas o
    // `performance.now` é **a sério**: é ele que mede o custo no fio principal,
    // e um relógio falso dava um orçamento que não quer dizer nada.
    performance: { now: () => Number(process.hrtime.bigint() / 1000n) / 1000 },
    navigator: { connection: undefined, sendBeacon: undefined, userAgent: "ensaio" },
    setTimeout(fn: Function, ms: number) {
      const id = ++seqTemporizador;
      temporizadores.push({ quando: relogio + (ms || 0), fn, id });
      return id;
    },
    clearTimeout(id: number) {
      const i = temporizadores.findIndex((t) => t.id === id);
      if (i >= 0) temporizadores.splice(i, 1);
    },
    addEventListener: (t: string, fn: Function) => alvoJanela.addEventListener(t, fn),
    removeEventListener: (t: string, fn: Function) => alvoJanela.removeEventListener(t, fn),
    dispararJanela: (t: string, e?: any) => alvoJanela.disparar(t, e),
    Event: (window as any).Event,
    // O observador de mutações é o do `linkedom`, e é a sério: a captura de
    // mensagens do RF-MSG-01 vive dele, e um duplo escrito à mão teria provado
    // que o nosso duplo funciona, e não que a captura funciona.
    MutationObserver: (window as any).MutationObserver,
    localStorage: loja,
  };
  (document as any).visibilityState = "visible";
  // A ponte que deixa o `disparar` levar o evento à janela, como o DOM leva.
  (document as any).__janela = janela;

  const enviar = async (url: string, corpo: string, cabecalhos: Record<string, string>, sincrono: boolean, metodo = "POST"): Promise<Resposta> => {
    const p: Pedido = { url, corpo, cabecalhos, sincrono, metodo, estado: 0 };
    pedidos.push(p);
    const r = resposta(p);
    p.estado = r.estado;
    return r;
  };

  const br: Browser = {
    janela,
    documento: document,
    loja,
    pedidos,
    agora: () => relogio,
    // Só o que foi **aceite**: com a rede em baixo, o mesmo lote é tentado
    // muitas vezes, e contar tentativas dava por entregue o que nunca chegou.
    eventos() {
      const out: any[] = [];
      for (const p of pedidos) {
        if (!p.url.includes("/v1/eventos")) continue;
        if (p.estado < 200 || p.estado >= 300) continue;
        try {
          const corpo = JSON.parse(p.corpo);
          for (const e of corpo.eventos ?? []) out.push(e);
        } catch { /* pedido sem corpo legível */ }
      }
      return out;
    },
    async avancar(ms: number) {
      const fim = relogio + ms;
      // Passo a passo, para os temporizadores que se voltam a agendar a si
      // próprios correrem tantas vezes quantas correriam a sério.
      while (true) {
        const proximo = temporizadores.filter((t) => t.quando <= fim).sort((a, b) => a.quando - b.quando)[0];
        if (!proximo) break;
        temporizadores.splice(temporizadores.indexOf(proximo), 1);
        relogio = Math.max(relogio, proximo.quando);
        proximo.fn();
        await new Promise((r) => setImmediate(r));
      }
      relogio = fim;
      await new Promise((r) => setImmediate(r));
    },
    responder(fn) { resposta = fn; },
    ambiente() {
      return { agora: () => relogio, janela, documento: document, armazenamento: loja, enviar };
    },
  };
  return br;
}

/** Dispara um evento do DOM que sobe, como no browser.
 *
 * **E chega à janela primeiro**, que é o que o browser faz e o duplo não fazia.
 * Um ouvinte registado na janela em fase de captura corre antes de qualquer
 * ouvinte do documento, e essa ordem escondia um defeito a sério: o despejo da
 * fila corria antes de o `plano_fundo` ser emitido, e o evento que fecha uma
 * tentativa perdia-se numa página a morrer. Nos ensaios tudo passava.
 */
export function disparar(documento: any, seletor: string, tipo: string, extras: Record<string, unknown> = {}): void {
  const el = documento.querySelector(seletor);
  if (!el) throw new Error(`sem elemento ${seletor}`);
  (documento as any).__janela?.dispararJanela?.(tipo, extras);
  const ev = new (documento.defaultView as any).Event(tipo, { bubbles: true, cancelable: true });
  Object.assign(ev, extras);
  el.dispatchEvent(ev);
}
