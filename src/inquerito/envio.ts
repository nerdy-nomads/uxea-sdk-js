/**
 * A conversa com o servidor: pedir licença antes de mostrar, e entregar a resposta.
 * Cartões 14.1 e 14.2, `docs/contrato-das-respostas.md`, secções 2 e 3.
 *
 * Três regras, e todas vêm do contrato:
 *
 *  1. **Sem resposta do servidor, não se mostra.** Um pedido de elegibilidade que
 *     falha, que demora de mais ou que volta ilegível é um "não". A fadiga não se
 *     garante às cegas, e um inquérito mostrado sem licença é um pedido que o
 *     servidor não contou.
 *  2. **O comentário sai mascarado do dispositivo**, pela mesma função que mascara
 *     o texto das mensagens (`mascararMensagem`, RF-MSG-04), e com o chão por cima
 *     que o servidor verifica: nenhum algarismo e nenhum arroba sobrevivem. O
 *     servidor **recusa** um comentário com conteúdo em vez de o mascarar, e é de
 *     propósito: mascarar do outro lado esconderia o defeito de quem enviou.
 *  3. **Uma falha de rede tenta outra vez, uma vez.** A mesma `resposta_id` nas duas
 *     tentativas: o servidor é idempotente por ela, e uma resposta que chegou à
 *     primeira e cuja confirmação se perdeu conta uma vez e não duas.
 *
 * Nada aqui lança. Tudo o que pode correr mal devolve um valor que diz o que correu.
 */
import type { FormatoDeInquerito, Resposta } from "../core/tipos.ts";
import { mascararMensagem } from "../identity/mask.ts";
import { uuid } from "../core/uuid.ts";

export type Enviar = (url: string, corpo: string, cabecalhos: Record<string, string>, sincrono: boolean, metodo?: string) => Promise<Resposta>;

/** O tamanho do comentário que sai, à letra do contrato. */
export const MAX_COMENTARIO = 500;

/**
 * Mascara o que alguém escreveu num comentário, antes de sair do dispositivo.
 *
 * O `mascararMensagem` faz o trabalho a sério (números, datas, correio, nomes,
 * citações). **O chão vem por cima dele**, e é mais largo do que a regra do
 * servidor, de propósito: o `mascarar` usa fronteiras de palavra, e `a12345` ou
 * `ana@exemplo` passavam por ele e eram recusados do outro lado, com a resposta
 * inteira perdida por um comentário. Um comentário não precisa de algarismos nem
 * de arrobas para dizer o que correu mal, e perder um "passo 3" é barato ao lado
 * de perder a resposta.
 *
 * O corte aos 500 vem **depois** de mascarar: um marcador ocupa mais do que o
 * algarismo que substitui, e cortar antes deixava sair o fim de um número partido.
 */
export function mascararComentario(texto: string): string {
  const cru = String(texto ?? "").slice(0, MAX_COMENTARIO * 4);
  const mascarado = mascararMensagem(cru)
    .replace(/\S*@\S*/g, "{email}")
    .replace(/\d+/g, "{numero}");
  return mascarado.slice(0, MAX_COMENTARIO).trim();
}

/**
 * Corta um texto a um número de **bytes** em UTF-8, sem partir um carácter.
 *
 * A ingestão mede os campos do `contexto` em bytes (256 cada), e uma chave de ecrã
 * com acentos cortada aos 256 caracteres pode ter o dobro dos bytes: a resposta
 * inteira era recusada por um ecrã com um nome comprido.
 */
export function ateBytes(texto: string, max: number): string {
  const codificador = new TextEncoder();
  if (codificador.encode(texto).length <= max) return texto;
  let saida = "";
  let bytes = 0;
  for (const c of texto) {
    const n = codificador.encode(c).length;
    if (bytes + n > max) break;
    saida += c;
    bytes += n;
  }
  return saida;
}

export interface Elegibilidade {
  mostrar: boolean;
  motivo: string;
  pedidoId: string;
}

/**
 * `POST /v1/respostas/elegibilidade`. Devolve `null` quando não houve resposta
 * que se possa ler, e isso é um "não".
 */
export async function pedirElegibilidade(
  enviar: Enviar, servidor: string, chave: string,
  corpo: { inquerito: string; anonymous_id: string; user_id: string },
): Promise<Elegibilidade | null> {
  try {
    const r = await enviar(`${servidor}/v1/respostas/elegibilidade`, JSON.stringify(corpo),
      { "X-UXDA-Key": chave, "Content-Type": "application/json" }, false, "POST");
    if (!r || r.estado < 200 || r.estado >= 300 || !r.corpo) return null;
    const v = JSON.parse(r.corpo);
    const dados = v?.dados;
    if (v?.sucesso !== true || !dados || typeof dados.mostrar !== "boolean") return null;
    const pedidoId = typeof dados.pedido_id === "string" ? dados.pedido_id.slice(0, 128) : "";
    const motivo = typeof dados.motivo === "string" ? dados.motivo.slice(0, 64) : "";
    // `mostrar` sem `pedido_id` é uma resposta a meio, e uma resposta a meio é um
    // não: sem o pedido, a resposta que viesse a seguir não se ligava a nada.
    return { mostrar: dados.mostrar && !!pedidoId, motivo, pedidoId };
  } catch {
    return null;
  }
}

/** O que o componente devolve quando alguém responde. */
export interface Respondido {
  nota: number | null;
  escolhas: string[];
  comentario: string;
  ocorridaEm: number;
}

export interface DadosDaResposta {
  inquerito: string;
  formato: FormatoDeInquerito;
  pedidoId: string;
  contexto: Record<string, string>;
  dispositivo: Record<string, string>;
  anonimo: string;
  utilizador: string;
}

/**
 * O corpo do `POST /v1/respostas`, com os campos pela ordem do contrato.
 *
 * A `nota` **não vai** em `escolha` e `livre`, e as `escolhas` vão sempre, vazias
 * nas escalas: é o que o exemplo do contrato mostra, e o servidor recusa uma nota
 * onde ela é proibida.
 */
export function corpoDaResposta(
  d: DadosDaResposta, r: Respondido, respostaId: string, enviadaEm: number,
): Record<string, unknown> {
  const escala = d.formato === "esforco" || d.formato === "satisfacao" || d.formato === "recomendacao";
  const corpo: Record<string, unknown> = {
    resposta_id: respostaId,
    inquerito: d.inquerito,
    formato: d.formato,
  };
  if (escala && r.nota !== null) corpo["nota"] = r.nota;
  corpo["escolhas"] = d.formato === "escolha" ? r.escolhas.slice(0, 12) : [];
  corpo["comentario"] = r.comentario ? mascararComentario(r.comentario) : "";
  corpo["ocorrida_em"] = new Date(r.ocorridaEm).toISOString();
  corpo["enviada_em"] = new Date(enviadaEm).toISOString();
  corpo["pedido_id"] = d.pedidoId;
  corpo["origem"] = "componente";
  corpo["contexto"] = d.contexto;
  corpo["dispositivo"] = d.dispositivo;
  corpo["anonymous_id"] = d.anonimo;
  corpo["user_id"] = d.utilizador;
  return corpo;
}

export type Entrega = "aceite" | "recusada" | "falhou";

/**
 * `POST /v1/respostas`, com **uma** repetição quando a entrega falha.
 *
 * Falhar é a rede (uma exceção, ou o estado 0 que o browser dá a um pedido que não
 * saiu) ou o servidor em avaria (5xx). Uma **recusa** (4xx) não se repete: a mesma
 * resposta seria recusada outra vez, e a segunda tentativa só gastava a rede de
 * quem está a responder. O `enviada_em` é reescrito em cada tentativa, porque é por
 * ele que o servidor corrige o relógio do dispositivo, e o da primeira tentativa já
 * não é verdade na segunda.
 */
export async function entregarResposta(
  enviar: Enviar, servidor: string, chave: string, d: DadosDaResposta, r: Respondido,
  agora: () => number, esperar: (ms: number) => Promise<void>,
): Promise<Entrega> {
  const respostaId = uuid();
  for (let tentativa = 0; tentativa < 2; tentativa++) {
    if (tentativa > 0) await esperar(1000);
    let resposta: Resposta | null = null;
    try {
      const corpo = JSON.stringify(corpoDaResposta(d, r, respostaId, agora()));
      resposta = await enviar(`${servidor}/v1/respostas`, corpo,
        { "X-UXDA-Key": chave, "Content-Type": "application/json" }, false, "POST");
    } catch {
      resposta = null;
    }
    if (!resposta || resposta.estado === 0 || resposta.estado >= 500) continue;
    return resposta.estado >= 200 && resposta.estado < 300 ? "aceite" : "recusada";
  }
  return "falhou";
}
