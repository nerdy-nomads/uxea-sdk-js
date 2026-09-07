/**
 * Trabalho fora do fio principal. RNF-SDK-03.
 *
 * O que custa num SDK de medição não é capturar: é **serializar e enviar**.
 * Escrever 64 KB de JSON no fio principal são milissegundos roubados à animação
 * de quem está a usar a aplicação, e é a diferença entre um SDK que ninguém nota
 * e um que faz o ecrã tremer.
 *
 * O trabalhador nasce de um `Blob`, e não de um ficheiro à parte: um SDK que
 * obriga a publicar um segundo ficheiro no servidor do cliente deixa de ser
 * "uma linha no `head`".
 *
 * **Se não houver trabalhador, o SDK continua a funcionar** no fio principal. Uma
 * política de segurança que proíba `blob:` é comum, e não pode ser motivo para
 * ninguém ficar sem medição.
 */
import type { Resposta } from "./tipos.ts";

const FONTE = `
self.onmessage = async (e) => {
  const { id, url, corpo, cabecalhos } = e.data;
  try {
    const r = await fetch(url, {
      method: "POST", body: corpo,
      headers: Object.assign({ "Content-Type": "application/json" }, cabecalhos),
      mode: "cors", credentials: "omit"
    });
    const texto = await r.text().catch(() => "");
    self.postMessage({ id, estado: r.status, corpo: texto });
  } catch (erro) {
    self.postMessage({ id, estado: 0, corpo: String(erro) });
  }
};
`;

export interface Trabalhador {
  enviar(url: string, corpo: string, cabecalhos: Record<string, string>): Promise<Resposta>;
  terminar(): void;
  ativo: boolean;
}

export function criarTrabalhador(janela: any): Trabalhador | null {
  try {
    if (typeof janela?.Worker !== "function" || typeof janela?.Blob !== "function") return null;
    const url = janela.URL.createObjectURL(new janela.Blob([FONTE], { type: "text/javascript" }));
    const w = new janela.Worker(url);
    const pendentes = new Map<number, (r: Resposta) => void>();
    let seq = 0;
    w.onmessage = (e: any) => {
      const resolver = pendentes.get(e.data?.id);
      if (resolver) {
        pendentes.delete(e.data.id);
        resolver({ estado: e.data.estado, corpo: e.data.corpo });
      }
    };
    // Um erro dentro do trabalhador não pode ficar pendurado: quem espera recebe
    // estado 0, que a fila trata como falha de rede e volta a tentar.
    w.onerror = () => {
      for (const [, r] of pendentes) r({ estado: 0, corpo: "trabalhador falhou" });
      pendentes.clear();
    };
    return {
      ativo: true,
      enviar(u, corpo, cabecalhos) {
        return new Promise<Resposta>((resolve) => {
          const id = ++seq;
          pendentes.set(id, resolve);
          w.postMessage({ id, url: u, corpo, cabecalhos });
          // Sem resposta em 30 s, considera-se falhado: é melhor repetir do que
          // deixar a fila parada à espera de uma promessa que nunca resolve.
          janela.setTimeout(() => {
            if (pendentes.delete(id)) resolve({ estado: 0, corpo: "sem resposta" });
          }, 30000);
        });
      },
      terminar() {
        try { w.terminate(); janela.URL.revokeObjectURL(url); } catch { /* nada */ }
      },
    };
  } catch {
    return null;
  }
}
