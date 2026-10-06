/**
 * O que a aplicação anfitriã nos dá, mascarado por omissão. Cartão 18.1,
 * `RNF-PRI-04`, ADR 0047.
 *
 * **Tudo o que vem do código da instituição passa por aqui**: as propriedades do
 * `track()`, a operação do `mensagem()` e do `erroTecnico()`. É o único ponto por
 * onde texto escrito por um programador da instituição entra num evento, e é por
 * isso que é aqui, e não em cada chamada, que se decide o que sai.
 *
 * As três regras, e a ordem importa:
 *
 *  1. **Uma chave que o esquema não conhece não sai.** Não recusa o evento: tira a
 *     chave e conta-a. Uma propriedade acrescentada daqui a um ano por quem não leu
 *     este ficheiro nasce assim invisível, e o evento continua a medir o que media.
 *  2. **Um valor de texto sai mascarado**, com as mesmas regras de uma mensagem sem
 *     chave: nomes, citações, números, identificadores e correio substituídos por
 *     marcadores. Vale para todas as chaves, porque a lista de chaves protege a
 *     chave e não o valor (a fuga que o ensaio do 5.4 escreve à mão).
 *  3. **Só a lista de permissões da instituição levanta a máscara**, e mesmo essa
 *     não levanta o chão: números, identificadores e correio saem sempre
 *     mascarados (o `mascarar`), autorize quem autorizar.
 */
import esquema from "./event/schema.json" with { type: "json" };
import { mascarar, mascararMensagem } from "./identity/mask.ts";

const PERMITIDAS = new Set(
  Object.entries((esquema as any).propriedades_permitidas ?? {})
    .filter(([nome]) => !nome.startsWith("$"))
    .flatMap(([, grupo]) => (grupo as { chaves: string[] }).chaves),
);
const IDENTIFICADOR = new Set<string>(((esquema as any).propriedades_identificador?.chaves ?? []) as string[]);

/** O comprimento máximo de um valor de propriedade, o mesmo do validador. */
const MAX = 64;

/** Um texto da instituição, mascarado por omissão, ou só pelo chão se a chave estiver exposta. */
export function textoDoCliente(valor: unknown, chave: string, expostas: ReadonlyArray<string>): string {
  const t = String(valor ?? "").replace(/\s+/g, " ").trim();
  return (expostas.includes(chave) ? mascarar(t) : mascararMensagem(t)).slice(0, MAX);
}

export interface Filtradas {
  propriedades: Record<string, unknown>;
  /** As chaves que o esquema não conhece, e que por isso não saíram. Só os nomes, para o diagnóstico. */
  descartadas: string[];
}

/**
 * Filtra e mascara as propriedades que a instituição passou ao SDK.
 *
 * Números e booleanos saem como vieram: não transportam texto. Uma chave de
 * elemento (o `campo_abandono`) sai como veio quando tem a forma de uma chave.
 */
export function propriedadesDoCliente(bruto: unknown, expostas: ReadonlyArray<string>): Filtradas {
  const out: Filtradas = { propriedades: {}, descartadas: [] };
  if (!bruto || typeof bruto !== "object" || Array.isArray(bruto)) return out;
  for (const [k, v] of Object.entries(bruto as Record<string, unknown>)) {
    if (!PERMITIDAS.has(k)) {
      out.descartadas.push(k.slice(0, 40));
      continue;
    }
    if (typeof v === "number" && Number.isFinite(v)) out.propriedades[k] = v;
    else if (typeof v === "boolean") out.propriedades[k] = v;
    else if (typeof v === "string" && IDENTIFICADOR.has(k) && v.includes("v1|f=")) out.propriedades[k] = v.slice(0, 512);
    else if (typeof v === "string") {
      const m = textoDoCliente(v, k, expostas);
      if (m) out.propriedades[k] = m;
    } else out.descartadas.push(k);
  }
  return out;
}

/* ------------------------------------------------- o consentimento (18.1) */

/** Onde fica a recusa, e só a recusa: guardar que alguém disse não é estritamente necessário. */
export const CHAVE_RECUSA = "uxda.consentimento";

/**
 * Apaga tudo o que o SDK guardou no dispositivo, menos a recusa. É o que acontece
 * quando a pessoa retira o consentimento: a fila, os identificadores, a sessão, a
 * cache da configuração e a fadiga dos inquéritos.
 */
/** As chaves que o SDK escreve, para os armazenamentos que não se deixam percorrer. */
const CONHECIDAS = ["uxda.anon", "uxda.dispositivo", "uxda.sessao", "uxda.utilizador", "uxda.fila", "uxda.config", "uxda.inqueritos"];

export function apagarOQueGuardamos(loja: { length?: number; key?(i: number): string | null; getItem(k: string): string | null; removeItem(k: string): void } | null): number {
  if (!loja) return 0;
  const chaves: string[] = CONHECIDAS.filter((k) => { try { return loja.getItem(k) !== null; } catch { return false; } });
  try {
    const n = typeof loja.length === "number" ? loja.length : 0;
    for (let i = 0; i < n; i++) {
      const k = loja.key?.(i);
      if (k && k.startsWith("uxda") && k !== CHAVE_RECUSA && !chaves.includes(k)) chaves.push(k);
    }
  } catch { /* um armazenamento que não se deixa percorrer: nada a apagar por esta via */ }
  for (const k of chaves) {
    try { loja.removeItem(k); } catch { /* segue */ }
  }
  return chaves.length;
}
