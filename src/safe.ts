/**
 * A barreira de erro do SDK. RNF-SDK-01.
 *
 * É o único requisito do documento escrito com a frase **sem excepções**: qualquer
 * erro interno é capturado e silenciado. Um SDK que parte a aplicação do cliente é
 * desinstalado no mesmo dia e nunca mais volta.
 *
 * Todo o ponto de entrada público passa por aqui. Não há caminho que não passe.
 */

type Registo = { quando: number; erro: unknown; onde: string };

const MAX = 50;
const registo: Registo[] = [];

/** O que aconteceu por dentro, para o painel de saúde. Nunca chega à anfitriã. */
export function errosInternos(): ReadonlyArray<Registo> {
  return registo;
}

export function limparErros(): void {
  registo.length = 0;
}

/** Envolve uma função para ela nunca poder lançar. Devolve `alternativa` se falhar. */
export function protegido<A extends unknown[], R>(
  onde: string,
  fn: (...args: A) => R,
  alternativa: R,
): (...args: A) => R {
  return (...args: A): R => {
    try {
      return fn(...args);
    } catch (erro) {
      if (registo.length < MAX) registo.push({ quando: Date.now(), erro, onde });
      return alternativa;
    }
  };
}

/** Igual, para o que devolve promessa. Uma rejeição também não pode escapar. */
export function protegidoAsync<A extends unknown[], R>(
  onde: string,
  fn: (...args: A) => Promise<R>,
  alternativa: R,
): (...args: A) => Promise<R> {
  return async (...args: A): Promise<R> => {
    try {
      return await fn(...args);
    } catch (erro) {
      if (registo.length < MAX) registo.push({ quando: Date.now(), erro, onde });
      return alternativa;
    }
  };
}
