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
  porReportar.clear();
}

/**
 * Os erros por reportar ao servidor, contados por sítio e por tipo. Cartão 17.3,
 * RF-OPS-10, ADR 0045.
 *
 * **Só o sítio e o nome do tipo, e nunca a mensagem**: a mensagem de um erro pode trazer
 * o que a pessoa escreveu (um `JSON.parse` de um valor de campo, por exemplo), e nada
 * que venha de um campo sai do dispositivo (RNF-PRI-01). O nome do tipo (`TypeError`,
 * `SyntaxError`) e o sítio do SDK onde falhou chegam para agrupar e reproduzir.
 */
export type ErroAgregado = { onde: string; tipo: string; contagem: number };

const MAX_POR_REPORTAR = 20;
const porReportar = new Map<string, ErroAgregado>();

function nomeDoTipo(erro: unknown): string {
  const n = (erro as { name?: unknown } | null)?.name;
  const t = typeof n === "string" ? n : erro === null ? "null" : typeof erro;
  return /^[A-Za-z0-9_.$:-]{1,60}$/.test(t) ? t : "Erro";
}

function contar(onde: string, erro: unknown): void {
  const tipo = nomeDoTipo(erro);
  const sitio = /^[A-Za-z0-9_.$:-]{1,80}$/.test(onde) ? onde : "desconhecido";
  const k = sitio + "|" + tipo;
  const atual = porReportar.get(k);
  if (atual) {
    if (atual.contagem < 10000) atual.contagem++;
  } else if (porReportar.size < MAX_POR_REPORTAR) {
    porReportar.set(k, { onde: sitio, tipo, contagem: 1 });
  }
}

function anotar(onde: string, erro: unknown): void {
  if (registo.length < MAX) registo.push({ quando: Date.now(), erro, onde });
  contar(onde, erro);
}

/** O que vai no próximo lote. Uma cópia: o que se envia não se mexe enquanto viaja. */
export function errosPorReportar(): ErroAgregado[] {
  return [...porReportar.values()].map((e) => ({ ...e }));
}

/** Tira o que o servidor já recebeu, e deixa o que entretanto aconteceu. */
export function confirmarErrosReportados(enviados: ReadonlyArray<ErroAgregado>): void {
  for (const e of enviados) {
    const k = e.onde + "|" + e.tipo;
    const atual = porReportar.get(k);
    if (!atual) continue;
    atual.contagem -= e.contagem;
    if (atual.contagem <= 0) porReportar.delete(k);
  }
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
      anotar(onde, erro);
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
      anotar(onde, erro);
      return alternativa;
    }
  };
}
