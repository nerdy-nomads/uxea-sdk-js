/**
 * Entrada para correr no browser, usada no ensaio do cartão 0.2.
 *
 * Expõe a captura em `window.__uxda` para se poder ver o resultado sobre uma
 * aplicação real, que é o que a Definição de pronto exige: visto a correr, e não
 * só verde em testes.
 */
import { acionavel, sinais, chave, errosInternos } from "./identity/index.ts";
import type { ElementoLike } from "./identity/element.ts";

export interface Observado {
  chave: string;
  fonte: string;
  sinais: ReturnType<typeof sinais>;
  rect: { x: number; y: number; w: number; h: number };
}

function capturar(): Observado[] {
  const saida: Observado[] = [];
  for (const el of Array.from(document.querySelectorAll("*"))) {
    const e = el as unknown as ElementoLike;
    if (!acionavel(e)) continue;
    const c = chave(e);
    const r = (el as HTMLElement).getBoundingClientRect();
    saida.push({ chave: c.principal, fonte: c.fonte, sinais: c.sinais, rect: { x: r.x, y: r.y, w: r.width, h: r.height } });
  }
  return saida;
}

/** Desenha uma moldura por elemento observado, com a cor do sinal que o identifica. */
function pintar(obs: Observado[]): void {
  const COR: Record<string, string> = {
    testid: "#2e6b4a", destino: "#2f5d7c", rotulo: "#8a4b2a", caminho: "#7c2f3d", papel: "#5b6270",
  };
  const camada = document.createElement("div");
  camada.id = "uxda-camada";
  camada.style.cssText = "position:fixed;inset:0;pointer-events:none;z-index:2147483647";
  for (const o of obs) {
    if (o.rect.w < 4 || o.rect.h < 4) continue;
    const m = document.createElement("div");
    m.style.cssText =
      `position:absolute;left:${o.rect.x}px;top:${o.rect.y}px;width:${o.rect.w}px;height:${o.rect.h}px;` +
      `border:2px solid ${COR[o.fonte] ?? "#000"};border-radius:3px;box-sizing:border-box`;
    camada.appendChild(m);
  }
  document.body.appendChild(camada);
}

(window as any).__uxda = { capturar, pintar, errosInternos };
