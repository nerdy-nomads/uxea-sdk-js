/**
 * As condições de um gatilho, avaliadas no dispositivo. Cartão 14.2, RF-PER-04.
 *
 * **É a mesma linguagem das definições de tarefa**, e não uma parecida: os campos,
 * os operadores e a combinação (condições em **e**, critérios em **ou**) são os do
 * `core/definition`, e a semântica de cada operador é a que o motor escreve em SQL
 * (`condicaoSQL`, no `attempt/infra/clickhouse/motor.go`). O servidor compila o
 * `apos_conclusao` a partir dos fins de uma tarefa, e se o dispositivo lesse as
 * mesmas condições de outra maneira, o inquérito aparecia a quem o motor não conta
 * como tendo concluído, e a resposta ficava ligada a uma tentativa que não existe.
 *
 * Por isso cada linha aqui tem a linha do SQL ao lado, e as esquinas estranhas do
 * SQL estão copiadas de propósito:
 *
 *  - **um campo em falta vale texto vazio**, porque as colunas do armazenamento
 *    não são anuláveis e o que não veio fica `''`;
 *  - **uma propriedade que não é texto vale texto vazio** para `igual`, `contem` e
 *    os outros, porque é isso que o `JSONExtractString` devolve para um número ou
 *    um booleano; e o `existe` de uma propriedade pergunta pela chave
 *    (`JSONHas`), e não pelo valor;
 *  - **`maior` e `menor` comparam números**, e um texto que não é número nunca
 *    passa (`toFloat64OrNull` dá nulo, e nulo não é maior do que nada).
 *
 * Um critério sem condições **não corresponde a nada**. O `Validar` do servidor
 * recusa-o ao guardar, com a frase certa: corresponderia a tudo, e isso nunca é o
 * que alguém quer. Aqui a direção do erro é a segura, e um inquérito que não
 * aparece é sempre melhor do que um que aparece a toda a gente.
 */
import type { CondicaoDeRegra, CriterioDeRegra } from "../core/tipos.ts";

/** Os campos de coluna. O resto é `propriedade:<chave>`. */
export const CAMPOS = ["event_type", "screen_key", "element_key", "message_key", "message_kind", "platform", "app_version"] as const;

export const OPERADORES = ["igual", "diferente", "contem", "comeca_com", "existe", "nao_existe", "maior", "menor"] as const;

const PREFIXO = "propriedade:";

export function campoValido(campo: string): boolean {
  if ((CAMPOS as readonly string[]).includes(campo)) return true;
  return campo.startsWith(PREFIXO) && campo.length > PREFIXO.length;
}

export function operadorValido(operador: string): boolean {
  return (OPERADORES as readonly string[]).includes(operador);
}

/**
 * O texto de um campo, como a coluna o daria.
 *
 * Uma propriedade só conta quando é texto: é o que o `JSONExtractString` faz, e
 * quem quiser comparar números com uma regra tem de os ter como texto dos dois
 * lados.
 */
function texto(ev: Record<string, unknown>, campo: string): string {
  if (campo.startsWith(PREFIXO)) {
    const props = ev["properties"];
    if (!props || typeof props !== "object") return "";
    const v = (props as Record<string, unknown>)[campo.slice(PREFIXO.length)];
    return typeof v === "string" ? v : "";
  }
  const v = ev[campo];
  return typeof v === "string" ? v : "";
}

/** `JSONHas`: a chave está lá, seja qual for o valor. */
function temPropriedade(ev: Record<string, unknown>, chave: string): boolean {
  const props = ev["properties"];
  if (!props || typeof props !== "object") return false;
  return Object.prototype.hasOwnProperty.call(props, chave) && (props as Record<string, unknown>)[chave] !== undefined;
}

const DECIMAL = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;

/** `toFloat64OrNull`: um número escrito como tal, ou nulo. Sem espaços nem sufixos. */
function numeroOuNulo(v: string): number | null {
  if (!DECIMAL.test(v)) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * O limiar da condição, como o `numero` do motor o lê: com os espaços das pontas
 * tirados, e **zero quando não é número**, que é o que o `ParseFloat` falhado lá
 * escreve na consulta.
 */
function limiar(v: string): number {
  const t = v.trim();
  if (/^[+-]?inf(inity)?$/i.test(t)) return t.startsWith("-") ? -Infinity : Infinity;
  const n = numeroOuNulo(t);
  return n === null ? 0 : n;
}

export function condicaoCorresponde(ev: Record<string, unknown>, c: CondicaoDeRegra): boolean {
  const propriedade = c.campo.startsWith(PREFIXO);
  switch (c.operador) {
    case "igual": return texto(ev, c.campo) === c.valor;
    case "diferente": return texto(ev, c.campo) !== c.valor;
    case "contem": return texto(ev, c.campo).includes(c.valor);
    case "comeca_com": return texto(ev, c.campo).startsWith(c.valor);
    case "existe":
      return propriedade ? temPropriedade(ev, c.campo.slice(PREFIXO.length)) : texto(ev, c.campo) !== "";
    case "nao_existe":
      return propriedade ? !temPropriedade(ev, c.campo.slice(PREFIXO.length)) : texto(ev, c.campo) === "";
    case "maior": {
      const n = numeroOuNulo(texto(ev, c.campo));
      return n !== null && n > limiar(c.valor);
    }
    case "menor": {
      const n = numeroOuNulo(texto(ev, c.campo));
      return n !== null && n < limiar(c.valor);
    }
  }
  // Inalcançável depois da normalização, que recusa operadores desconhecidos. O
  // motor devolve `0` no mesmo caso, e é o mesmo aqui: não corresponde.
  return false;
}

/** Todas as condições ao mesmo tempo. Sem condições, nada. */
export function criterioCorresponde(ev: Record<string, unknown>, criterio: CriterioDeRegra): boolean {
  if (criterio.condicoes.length === 0) return false;
  for (const c of criterio.condicoes) if (!condicaoCorresponde(ev, c)) return false;
  return true;
}

/** Algum dos critérios. Uma lista vazia não corresponde a nada. */
export function algumCriterio(ev: Record<string, unknown>, criterios: CriterioDeRegra[]): boolean {
  for (const c of criterios) if (criterioCorresponde(ev, c)) return true;
  return false;
}
