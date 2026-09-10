/**
 * O contexto do dispositivo, que é a base da segmentação. RF-MET-12, cartão 7.6.
 *
 * Quatro sinais e mais nenhum: sistema operativo, versão maior, classe de
 * dispositivo e fuso horário. Cada um foi escolhido por **segmentar sem
 * identificar**, e o que ficou de fora custou mais a decidir do que o que ficou
 * dentro:
 *
 * - **A versão completa do sistema operativo não sai.** `Android 14` segmenta;
 *   `Android 14.0.1 build TQ3A.230901.001` é uma impressão digital, e num parque
 *   pequeno chega para distinguir pessoas.
 * - **O modelo do dispositivo não sai.** Um modelo raro numa amostra de mil é um
 *   identificador. A classe (telemóvel, tablet, computador) responde à pergunta
 *   que a segmentação faz, que é sobre o tamanho do ecrã e a forma de interagir.
 * - **A geografia é o fuso, e nunca o IP nem coordenadas.** Está no ADR 0022, e a
 *   regra `fuso_e_nao_lugar` do esquema recusa qualquer coisa que se pareça com um
 *   par de coordenadas, dos dois lados.
 *
 * Nada aqui pede permissões, e nada aqui lê o que o utilizador escreveu.
 */
import { protegido } from "../safe.ts";

export interface Contexto {
  os_name?: string;
  os_version?: string;
  device_class?: string;
  time_zone?: string;
}

/** Só a parte maior, e no máximo dois números. O resto é impressão digital. */
function maior(v: string | undefined): string | undefined {
  if (!v) return undefined;
  const m = /^(\d+)/.exec(v.trim());
  return m ? m[1] : undefined;
}

function sistema(ua: string): { nome?: string; versao?: string } {
  let m: RegExpExecArray | null;
  if ((m = /Android[ /](\d+)/.exec(ua))) return { nome: "Android", versao: m[1] };
  if ((m = /(?:iPhone|iPad|iPod).*?OS (\d+)[._]/.exec(ua))) return { nome: "iOS", versao: m[1] };
  // O `Version/x` do Safari em iPadOS 13+, que se apresenta como Macintosh.
  if (/Macintosh/.test(ua) && /Mobile|Tablet/.test(ua)) return { nome: "iOS" };
  if ((m = /CrOS [^ ]+ (\d+)/.exec(ua))) return { nome: "ChromeOS", versao: m[1] };
  if ((m = /Windows NT (\d+)/.exec(ua))) {
    // O Windows 11 continua a dizer `Windows NT 10.0`, e ninguém consegue
    // distingui-los pelo agente. Diz-se 10 porque é o que o dispositivo diz, e
    // inventar o 11 seria escrever um número que não foi medido.
    return { nome: "Windows", versao: m[1] };
  }
  if ((m = /Mac OS X (\d+)[._]/.exec(ua))) return { nome: "macOS", versao: m[1] };
  if (/Linux/.test(ua)) return { nome: "Linux" };
  return {};
}

function classe(ua: string, janela: any): string {
  if (/iPad/.test(ua)) return "tablet";
  // Android sem `Mobile` é tablet, e é a convenção do próprio agente.
  if (/Android/.test(ua) && !/Mobile/.test(ua)) return "tablet";
  if (/Tablet|PlayBook|Silk/.test(ua)) return "tablet";
  if (/Mobi|iPhone|iPod|Android|Windows Phone/.test(ua)) return "telemovel";
  // O iPadOS 13+ mente e diz Macintosh. O que o denuncia é ter toque.
  const toques = Number(janela?.navigator?.maxTouchPoints ?? 0);
  if (/Macintosh/.test(ua) && toques > 1) return "tablet";
  if (ua) return "computador";
  return "desconhecido";
}

/**
 * Lê o contexto uma vez. **Nunca lança**: um agente de utilizador estranho, um
 * `Intl` em falta ou um ambiente sem `navigator` devolvem menos campos, e o SDK
 * continua a medir. O RNF-SDK-01 não abre exceções para a segmentação.
 */
export const contextoDe = protegido("captura.contexto", (janela: any): Contexto => {
  const ua = String(janela?.navigator?.userAgent ?? "");
  const so = sistema(ua);
  const ctx: Contexto = {};
  if (so.nome) ctx.os_name = so.nome;
  const v = maior(so.versao);
  if (v) ctx.os_version = v;
  const c = classe(ua, janela);
  if (c) ctx.device_class = c;
  try {
    const fuso = janela?.Intl?.DateTimeFormat?.().resolvedOptions?.().timeZone;
    if (typeof fuso === "string" && fuso) ctx.time_zone = fuso;
  } catch {
    // Um ambiente sem base de fusos não é um erro: fica sem geografia.
  }
  return ctx;
}, {} as Contexto);
