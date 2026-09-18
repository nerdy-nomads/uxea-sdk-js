/**
 * Os cinco gatilhos, sobre os eventos que o próprio SDK captura. Cartão 14.2,
 * RF-PER-04.
 *
 * **Uma regra muda sem publicar a aplicação**, e é por isso que isto vive no SDK e
 * lê a configuração remota: a instituição escreve na consola "depois de pagar", e a
 * sessão seguinte já pergunta, sem uma linha de código na aplicação dela.
 *
 *   apos_conclusao        um evento corresponde aos `criterios`
 *   apos_erro             idem, e os critérios por omissão são os erros
 *   primeira_utilizacao   a primeira vez **neste dispositivo** que um evento corresponde
 *   apos_abandono         no arranque de uma sessão, se na anterior houve início sem
 *                         fim, há menos de 24 horas
 *   amostragem            no arranque de uma sessão, sem mais condição
 *
 * Isto só decide **que um gatilho disparou**. O sorteio, a fadiga e a pergunta ao
 * servidor vêm depois, no `index.ts` desta pasta, e são iguais para os cinco.
 *
 * # Como é que um abandono atravessa sessões
 *
 * Um abandono só se sabe abandono depois de a pessoa ir embora, e quando ela vai
 * embora o SDK já não corre. Por isso o que se guarda é o contrário do abandono:
 * **a tarefa que começou e ainda não acabou**, na lista `abertas` do armazenamento
 * local, com a sessão em que começou. Um evento de fim apaga-a. No arranque de uma
 * sessão nova, o que lá estiver de outra sessão, com menos de 24 horas, é um
 * abandono; o que tiver mais é esquecido sem disparar nada, porque perguntar a
 * alguém por uma coisa que largou há três dias já não mede o que se queria medir.
 *
 * # Porque é que o início é o último, e não o primeiro
 *
 * O motor corta uma tentativa nova **em cada evento que corresponde ao início**
 * (`arraySplit` sobre o bit do início, no `motor.go`). A tentativa que estava a
 * decorrer quando a pessoa foi embora começa, portanto, no último desses eventos, e
 * é esse instante que vai no `tentativa_inicio`: com o primeiro, o servidor ligava
 * a resposta a uma tentativa anterior, que pode até ter acabado bem.
 *
 * E um evento que corresponde ao início **e** ao fim abre e fecha a tentativa no
 * mesmo instante, como no motor: o início lê-se primeiro.
 */
import type { CriterioDeRegra, GatilhoDeInquerito, RegraDeInquerito } from "../core/tipos.ts";
import type { EstadoDeInqueritos } from "./estado.ts";
import { algumCriterio } from "./regras.ts";

/** O limite do abandono, à letra do contrato. */
export const JANELA_DE_ABANDONO_MS = 24 * 60 * 60 * 1000;

export type Gatilho = GatilhoDeInquerito | "manual";

/** Um gatilho que disparou, com o contexto que a resposta vai levar. */
export interface Disparo {
  regra: RegraDeInquerito;
  gatilho: Gatilho;
  /** O ecrã do evento que disparou, ou o da tentativa abandonada. */
  ecra: string;
  /** O passo em que a tentativa ia, quando se sabe. */
  passo: string;
  /** O instante do início da tentativa, quando o gatilho o tem. */
  tentativaInicio: number | null;
}

const temCriterios = (c: CriterioDeRegra[]): boolean => c.length > 0;

/**
 * O arranque de uma sessão. Devolve os disparos do `apos_abandono` e da
 * `amostragem`, e limpa as tarefas abertas que já não contam.
 *
 * **Só corre quando a sessão é outra.** Um recarregamento de página dentro da
 * mesma sessão não é um arranque, e sem esta guarda cada página nova de um sítio
 * sem página única sorteava outra vez a amostragem.
 */
export function arranqueDaSessao(
  estado: EstadoDeInqueritos, regras: RegraDeInquerito[], sessao: string, agora: number, ecraAtual: string,
): { disparos: Disparo[]; novaSessao: boolean } {
  if (!sessao || estado.sessao === sessao) return { disparos: [], novaSessao: false };
  estado.sessao = sessao;
  const disparos: Disparo[] = [];
  const porChave = new Map(regras.map((r) => [r.chave, r]));

  for (const [chave, aberta] of Object.entries(estado.abertas)) {
    const regra = porChave.get(chave);
    const idade = agora - aberta.inicio;
    // Uma tarefa desta sessão não pode estar aqui (a sessão acabou de mudar), e
    // uma que venha do futuro é um relógio que andou para trás: nenhuma é abandono.
    const valida = aberta.sessao !== sessao && idade >= 0 && idade < JANELA_DE_ABANDONO_MS;
    delete estado.abertas[chave];
    if (!regra || !valida || regra.gatilho !== "apos_abandono") continue;
    disparos.push({ regra, gatilho: "apos_abandono", ecra: aberta.ecra, passo: aberta.passo, tentativaInicio: aberta.inicio });
  }

  for (const regra of regras) {
    if (regra.gatilho !== "amostragem") continue;
    disparos.push({ regra, gatilho: "amostragem", ecra: ecraAtual, passo: "", tentativaInicio: null });
  }
  return { disparos, novaSessao: true };
}

/**
 * Um evento capturado. Atualiza as tarefas abertas e devolve os disparos.
 *
 * `passoAtual` é o último passo declarado nesta página, e é o que se guarda na
 * tarefa aberta para o abandono levar consigo.
 *
 * Devolve também se o estado mudou, para quem grava saber quando gravar: um
 * início que corresponde a todos os eventos de um ecrã não pode escrever no
 * armazenamento a cada toque.
 */
export function aoEvento(
  estado: EstadoDeInqueritos, regras: RegraDeInquerito[], sessao: string,
  ev: Record<string, unknown>, agora: number, passoAtual: string,
): { disparos: Disparo[]; mudou: boolean } {
  const disparos: Disparo[] = [];
  let mudou = false;
  const ecra = typeof ev["screen_key"] === "string" ? ev["screen_key"] : "";

  for (const regra of regras) {
    if (regra.gatilho === "amostragem") continue;

    // 1. O início, que abre (ou reabre) a tentativa desta regra.
    let aberta = estado.abertas[regra.chave];
    if (temCriterios(regra.inicio) && algumCriterio(ev, regra.inicio)) {
      estado.abertas[regra.chave] = aberta = { sessao, inicio: agora, ecra, passo: passoAtual };
      mudou = true;
    } else if (aberta && aberta.sessao === sessao && (aberta.ecra !== ecra || aberta.passo !== passoAtual)) {
      // O sítio onde a tentativa vai. Muda pouco (um ecrã, um passo), e por isso
      // escrever quando muda não custa nada.
      aberta.ecra = ecra;
      aberta.passo = passoAtual;
      mudou = true;
    }

    // 2. O fim, que é o próprio gatilho para três dos quatro.
    if (!algumCriterio(ev, regra.criterios)) continue;
    const inicio = aberta && agora - aberta.inicio >= 0 && agora - aberta.inicio < JANELA_DE_ABANDONO_MS
      ? aberta.inicio : null;
    if (aberta) {
      delete estado.abertas[regra.chave];
      mudou = true;
    }
    if (regra.gatilho === "apos_abandono") continue; // acabou: não há abandono nenhum

    if (regra.gatilho === "primeira_utilizacao") {
      // **Gasta-se ao corresponder, e não ao mostrar.** A primeira vez é a primeira
      // vez: se o sorteio disser que não, esta pessoa nunca mais é questionada por
      // esta funcionalidade neste dispositivo, que é o que o nome promete.
      if (estado.primeiras.includes(regra.chave)) continue;
      estado.primeiras.push(regra.chave);
      mudou = true;
    }
    disparos.push({ regra, gatilho: regra.gatilho, ecra, passo: passoAtual, tentativaInicio: inicio });
  }
  return { disparos, mudou };
}
