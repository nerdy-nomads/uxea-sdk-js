/**
 * O que os ensaios dos inquéritos partilham. Cartões 14.1 e 14.2.
 *
 * Um servidor de ensaio que fala o contrato das respostas
 * (`docs/contrato-das-respostas.md`), uma regra com a forma do exemplo do contrato,
 * e as formas de mexer no componente como uma pessoa mexeria: escolher um ponto da
 * escala, escrever no comentário, carregar em enviar.
 *
 * **O componente vive numa árvore sombra, e o duplo não redireciona alvos.** Um
 * evento despachado lá dentro chega aos ouvintes lá de dentro e não sobe até ao
 * documento, ao contrário do browser, que o faz subir com o alvo trocado pelo
 * hospedeiro. Os ensaios que provam que a captura não vê o componente despacham,
 * por isso, **no hospedeiro**, que é exatamente o que a captura recebe num browser
 * a sério; os que provam que o componente funciona despacham lá dentro.
 */
import { criarBrowser, type Browser, type Pedido } from "./duplo.ts";
import { iniciar, type Uxda } from "../index.ts";
import type { Resposta } from "../core/tipos.ts";

export const SERVIDOR = "http://ingest.local";

/** Uma regra com a forma do exemplo do contrato, que cada ensaio altera. */
export function regra(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    chave: "facilidade_do_pagamento",
    versao: 3,
    formato: "esforco",
    pergunta: { pt: "Foi fácil pagar a encomenda?", en: "Was it easy to pay for the order?" },
    opcoes: [],
    multipla: false,
    comentario: true,
    gatilho: "apos_conclusao",
    criterios: [{ condicoes: [{ campo: "screen_key", operador: "igual", valor: "/confirmacao" }] }],
    inicio: [{ condicoes: [{ campo: "screen_key", operador: "igual", valor: "/pagamento" }] }],
    amostragem: 1,
    atraso_ms: 0,
    contexto: { tarefa: "pagar_uma_encomenda", passo: "", funcionalidade: "" },
    ...extra,
  };
}

export function inqueritos(lista: unknown[], extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    tema: { cor_primaria: "#1f4fd1", cor_fundo: "#ffffff", cor_texto: "#1b1f24", fonte: "system-ui, sans-serif", cantos_px: 12, idioma: "pt" },
    fadiga: { max_pedidos: 1, periodo_dias: 30, excluir_respondeu_dias: 90 },
    associar_respostas: false,
    lista,
    ...extra,
  };
}

const json = (estado: number, corpo: unknown): Resposta => ({ estado, corpo: JSON.stringify(corpo) });

export const PODE = (): Resposta => json(200, { sucesso: true, dados: { mostrar: true, motivo: "pode", pedido_id: "pedido-7f3c" } });
export const NAO = (motivo: string) => (): Resposta => json(200, { sucesso: true, dados: { mostrar: false, motivo, pedido_id: "" } });
export const ACEITE = (): Resposta => json(202, { sucesso: true, dados: { aceite: true, associada: false } });

export interface OpcoesDoServidor {
  nivel?: "essencial" | "padrao" | "detalhado";
  rastreioIndividual?: boolean;
  elegibilidade?: (p: Pedido) => Resposta;
  respostas?: (p: Pedido) => Resposta;
}

/** Põe o browser a responder como a ingestão responderia, com estes inquéritos na configuração. */
export function servir(br: Browser, config: Record<string, unknown> | unknown, op: OpcoesDoServidor = {}): void {
  br.responder((p) => {
    if (p.url.includes("/v1/config")) {
      return json(200, {
        sucesso: true,
        dados: {
          amostragem: 1, nivel: op.nivel ?? "padrao", captura: [], versao: 1,
          ...(op.rastreioIndividual ? { rastreio_individual: true, amostragem_detalhado: 1 } : {}),
          inqueritos: config,
        },
      });
    }
    if (p.url.endsWith("/v1/respostas/elegibilidade")) return (op.elegibilidade ?? PODE)(p);
    if (p.url.endsWith("/v1/respostas")) return (op.respostas ?? ACEITE)(p);
    return { estado: 202, corpo: "{}" };
  });
}

export interface ComSdk {
  br: Browser;
  uxda: Uxda;
}

/** Arranca o SDK inteiro sobre um browser de ensaio, com o sorteio controlado. */
export async function arrancar(
  br: Browser, aleatorio: () => number = () => 0,
): Promise<Uxda> {
  const uxda = iniciar({ chave: "uxda_des_inqueritos", servidor: SERVIDOR, ambiente: { ...br.ambiente(), aleatorio } });
  await br.avancar(10);
  return uxda;
}

export async function comSdk(
  html: string, config: unknown, op: OpcoesDoServidor & { caminho?: string; aleatorio?: () => number } = {},
): Promise<ComSdk> {
  const br = criarBrowser(html, { caminho: op.caminho ?? "/pagamento" });
  servir(br, config, op);
  const uxda = await arrancar(br, op.aleatorio);
  return { br, uxda };
}

export const hospedeiro = (br: Browser): any => br.documento.querySelector("uxda-inquerito");
export const raiz = (br: Browser): any => hospedeiro(br)?.shadowRoot ?? null;

export function despachar(el: any, tipo: string, extras: Record<string, unknown> = {}): void {
  const ev = new (el.ownerDocument.defaultView as any).Event(tipo, { bubbles: true, cancelable: true });
  Object.assign(ev, extras);
  el.dispatchEvent(ev);
}

/** Escolhe uma opção como o browser faria: marca, e avisa com `change`. */
export function escolher(br: Browser, valor: string): void {
  const entrada = raiz(br)?.querySelector(`input[value="${valor}"]`);
  if (!entrada) throw new Error(`sem opção ${valor}`);
  entrada.checked = true;
  despachar(entrada, "change");
}

export function escrever(br: Browser, texto: string): void {
  const caixa = raiz(br)?.querySelector("textarea");
  if (!caixa) throw new Error("sem caixa de texto");
  caixa.value = texto;
  despachar(caixa, "input", { inputType: "insertText" });
}

export async function enviarResposta(br: Browser): Promise<void> {
  const botao = raiz(br)?.querySelector(".enviar");
  if (!botao) throw new Error("sem botão de enviar");
  despachar(botao, "click");
  await br.avancar(10);
}

export const pedidosDeElegibilidade = (br: Browser): Pedido[] =>
  br.pedidos.filter((p) => p.url.endsWith("/v1/respostas/elegibilidade"));

export const respostasEnviadas = (br: Browser): any[] =>
  br.pedidos.filter((p) => p.url.endsWith("/v1/respostas")).map((p) => JSON.parse(p.corpo));

/** Uma sessão nova no mesmo dispositivo: o mesmo armazenamento, meia hora e um minuto depois. */
export async function sessaoSeguinte(
  anterior: Browser, html: string, config: unknown, op: OpcoesDoServidor & { caminho?: string; depoisMs?: number; aleatorio?: () => number } = {},
): Promise<ComSdk> {
  const br = criarBrowser(html, { caminho: op.caminho ?? "/", loja: anterior.loja });
  await br.avancar(anterior.agora() - br.agora() + (op.depoisMs ?? 31 * 60 * 1000));
  servir(br, config, op);
  const uxda = await arrancar(br, op.aleatorio);
  return { br, uxda };
}

/** Um gerador com semente (mulberry32): o mesmo ensaio dá sempre o mesmo número. */
export function semente(n: number): () => number {
  let a = n >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
