/**
 * A ligação ao browser, num sítio só.
 *
 * Está isolada por duas razões: os ensaios substituem-na por um duplo, e o
 * browser é o único sítio de onde pode vir uma surpresa (uma API que não existe,
 * um armazenamento negado, uma política de segurança que proíbe trabalhadores).
 * Tudo o que é `typeof x === "function"` está aqui, e não espalhado pelo código.
 */
import type { Ambiente, Armazenamento, Resposta } from "./tipos.ts";

/** Um armazenamento que finge, para quando o browser recusa o `localStorage`. */
export function armazenamentoDeMemoria(): Armazenamento {
  const m = new Map<string, string>();
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => void m.set(k, v),
    removeItem: (k) => void m.delete(k),
  };
}

/**
 * O `localStorage` só se sabe que existe depois de se lhe escrever: em modo
 * privado de alguns browsers ele está lá e lança na primeira escrita.
 */
export function armazenamentoDoBrowser(janela: any): Armazenamento {
  try {
    const l = janela?.localStorage;
    if (!l) return armazenamentoDeMemoria();
    const sonda = "uxea.sonda";
    l.setItem(sonda, "1");
    l.removeItem(sonda);
    return l as Armazenamento;
  } catch {
    return armazenamentoDeMemoria();
  }
}

/**
 * Envio. Três caminhos, por esta ordem:
 *
 *  1. `sendBeacon`, quando a página está a morrer: é o único que o browser
 *     promete entregar depois de a página desaparecer;
 *  2. `fetch` com `keepalive`, o caminho normal;
 *  3. `XMLHttpRequest`, para browsers sem `fetch`.
 *
 * **`mode: "cors"` e nunca `no-cors`**: sem resposta legível não se sabe se o
 * lote entrou, e a fila apagava eventos que nunca chegaram.
 */
export function envioDoBrowser(janela: any) {
  return async (url: string, corpo: string, cabecalhos: Record<string, string>, sincrono: boolean, metodo = "POST"): Promise<Resposta> => {
    const nav = janela?.navigator;
    if (sincrono && nav && typeof nav.sendBeacon === "function") {
      // O `sendBeacon` não deixa pôr cabeçalhos: a chave vai no URL, que é a
      // única forma de a ingestão a ver num pedido de despedida.
      const separador = url.includes("?") ? "&" : "?";
      const ok = nav.sendBeacon(url + separador + "chave=" + encodeURIComponent(cabecalhos["X-UXEA-Key"] ?? ""),
        new Blob([corpo], { type: "application/json" }));
      return { estado: ok ? 202 : 0, corpo: "" };
    }
    if (typeof janela?.fetch === "function") {
      const r = await janela.fetch(url, {
        method: metodo,
        body: metodo === "GET" ? undefined : corpo,
        headers: { "Content-Type": "application/json", ...cabecalhos },
        keepalive: metodo !== "GET" && corpo.length < 60000, mode: "cors", credentials: "omit",
      });
      return { estado: r.status, corpo: await r.text().catch(() => "") };
    }
    return await new Promise<Resposta>((resolve) => {
      const x = new janela.XMLHttpRequest();
      x.open(metodo, url, true);
      x.setRequestHeader("Content-Type", "application/json");
      for (const [k, v] of Object.entries(cabecalhos)) x.setRequestHeader(k, v);
      x.onreadystatechange = () => {
        if (x.readyState === 4) resolve({ estado: x.status, corpo: x.responseText ?? "" });
      };
      x.onerror = () => resolve({ estado: 0, corpo: "" });
      x.send(metodo === "GET" ? undefined : corpo);
    });
  };
}

export function ambienteDoBrowser(janela: any = (globalThis as any).window): Ambiente {
  return {
    agora: () => Date.now(),
    janela,
    documento: janela?.document ?? null,
    armazenamento: armazenamentoDoBrowser(janela),
    enviar: envioDoBrowser(janela),
  };
}
