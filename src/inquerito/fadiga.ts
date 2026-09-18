/**
 * O controlo de fadiga do lado do dispositivo. Cartão 14.2, RF-PER-05.
 *
 * **É a primeira linha, e não a que manda.** Quem decide é o servidor, que sabe
 * quantas vezes esta pessoa foi questionada em todos os dispositivos dela e se
 * respondeu a qualquer inquérito do projeto; e sem a resposta dele não se mostra
 * nada. O que isto evita é perguntar ao servidor o que o dispositivo já sabe que é
 * não: um `apos_erro` numa página com a rede a falhar dispara vinte vezes num
 * minuto, e vinte pedidos de elegibilidade para ouvir vinte vezes a mesma recusa
 * são tráfego gasto num telemóvel que já está com a rede a falhar.
 *
 * Cinco perguntas, por esta ordem, e a primeira que diz não, diz porquê:
 *
 *   ja_mostrado_nesta_sessao   um inquérito por sessão, no máximo, e é regra do SDK
 *   limite_de_pedidos          `max_pedidos` nos últimos `periodo_dias`
 *   respondeu_recentemente     uma resposta nos últimos `excluir_respondeu_dias`
 *   (a recusa do servidor)     o servidor já disse que não nesta sessão, para o projeto
 *   inativo                    o servidor disse que este inquérito não existe
 *
 * A contagem é **em dias**, como o livro do servidor, e a janela é a mesma nos
 * dois sentidos: hoje e os `periodo_dias - 1` dias antes. Se as duas contas
 * divergirem num dia de fronteira, o dispositivo pergunta e o servidor responde,
 * que é a direção segura do erro.
 */
import type { FadigaDeInquerito } from "../core/tipos.ts";
import type { EstadoDeInqueritos } from "./estado.ts";

export const DIA_MS = 86_400_000;

export function diaDe(ms: number): number {
  return Math.floor(ms / DIA_MS);
}

/** O motivo pelo qual não se pergunta, ou vazio se se pode perguntar ao servidor. */
export function fadigaLocal(
  estado: EstadoDeInqueritos, fadiga: FadigaDeInquerito, sessao: string, agora: number,
  inativos?: ReadonlySet<string>, chave?: string,
): string {
  if (sessao && estado.mostradoNaSessao === sessao) return "ja_mostrado_nesta_sessao";
  const hoje = diaDe(agora);
  const noPeriodo = estado.pedidos.filter((d) => hoje - d >= 0 && hoje - d < fadiga.periodoDias).length;
  if (noPeriodo >= fadiga.maxPedidos) return "limite_de_pedidos";
  if (estado.respondeu >= 0 && hoje - estado.respondeu >= 0 && hoje - estado.respondeu < fadiga.excluirRespondeuDias) {
    return "respondeu_recentemente";
  }
  if (sessao && estado.recusa.sessao === sessao && estado.recusa.motivo) return estado.recusa.motivo;
  if (chave && inativos?.has(chave)) return "inativo";
  return "";
}

/** O servidor disse `pode`, e já contou o pedido: o dispositivo conta-o também. */
export function anotarPedido(estado: EstadoDeInqueritos, sessao: string, agora: number): void {
  estado.pedidos.push(diaDe(agora));
  estado.mostradoNaSessao = sessao;
}

/** Uma resposta aceite. Guarda o dia, e nada do que foi respondido. */
export function anotarResposta(estado: EstadoDeInqueritos, agora: number): void {
  estado.respondeu = diaDe(agora);
}

/**
 * Tira do livro o que já não conta para nada. **O livro expira sozinho no fim do
 * maior dos dois prazos**, como o do servidor: guardar dias de há três anos não
 * serve fadiga nenhuma e é informação sobre alguém que ninguém pediu.
 */
export function podar(estado: EstadoDeInqueritos, fadiga: FadigaDeInquerito, agora: number): void {
  const hoje = diaDe(agora);
  const prazo = Math.max(fadiga.periodoDias, fadiga.excluirRespondeuDias);
  estado.pedidos = estado.pedidos.filter((d) => hoje - d < prazo).slice(-100);
  if (estado.respondeu >= 0 && hoje - estado.respondeu >= prazo) estado.respondeu = -1;
}
