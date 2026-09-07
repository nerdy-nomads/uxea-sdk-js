/**
 * Mascaramento de valores variáveis dentro de texto visível.
 *
 * Corre **no dispositivo, antes de qualquer envio**. É usado em dois sítios, e é o
 * mesmo código nos dois de propósito:
 *
 *  - no sinal 3 da identidade de elementos (ADR 0003), antes de calcular o resumo
 *    do rótulo, porque um rótulo como "Pagar 12.400 Kz" muda a cada utilizador;
 *  - na normalização das mensagens de sistema (RF-MSG-03 e RF-MSG-04), onde o
 *    mesmo problema aparece com dados pessoais interpolados.
 *
 * Nunca se aplica ao conteúdo escrito pelo utilizador: esse não é capturado de
 * todo (RNF-PRI-01).
 */

/** Ordem importa: o mais específico primeiro, senão o número apanha a data. */
const REGRAS: ReadonlyArray<readonly [RegExp, string]> = [
  // Datas: 2026-09-07, 07/09/2026, 07-09-26
  [/\b\d{4}[-/]\d{1,2}[-/]\d{1,2}\b/g, "{data}"],
  [/\b\d{1,2}[-/]\d{1,2}[-/]\d{2,4}\b/g, "{data}"],
  // Horas: 14:30, 14:30:59
  [/\b\d{1,2}:\d{2}(:\d{2})?\b/g, "{hora}"],
  // Correio electrónico
  [/\b[^\s@]+@[^\s@]+\.[^\s@]+\b/g, "{email}"],
  // Sequências longas de dígitos ou alfanuméricas: contas, referências, NIF
  [/\b[A-Za-z]{0,3}\d[\dA-Za-z]{7,}\b/g, "{id}"],
  // Percentagens, antes dos números, senão o número come o sinal
  [/\b\d+([.,]\d+)?\s*%/g, "{numero}%"],
  // Montantes com separador de milhares ou decimal: 12.400,00 / 12,400.00 / 1 234,56
  // Vai para o **mesmo** marcador dos números soltos, e é de propósito: com
  // marcadores diferentes, "saldo de 12.400 Kz" e "saldo de 300 Kz" davam duas
  // entradas no catálogo, que é a fragmentação que o RF-MSG-03 existe para evitar.
  [/\b\d{1,3}([., \s]\d{3})+([.,]\d{1,2})?\b/g, "{numero}"],
  [/\b\d+[.,]\d{1,2}\b/g, "{numero}"],
  // Qualquer número que sobre
  [/\b\d+\b/g, "{numero}"],
];

/** Substitui valores variáveis por marcadores, para agrupar variantes do mesmo texto. */
export function mascarar(texto: string): string {
  let saida = texto;
  for (const [re, marcador] of REGRAS) saida = saida.replace(re, marcador);
  return saida;
}

/**
 * Normaliza texto visível: colapsa espaços, tira acentos e diacríticos, e baixa a
 * caixa. Sem isto, "Iniciar sessão" e "Iniciar Sessao" seriam elementos diferentes.
 */
export function normalizarTexto(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/** Normaliza e mascara, que é sempre o que se quer antes de calcular o resumo. */
export function preparar(texto: string): string {
  return mascarar(normalizarTexto(texto));
}

/**
 * FNV-1a de 32 bits, em hexadecimal.
 *
 * Não é criptográfico e não precisa de ser: serve para agrupar rótulos iguais sem
 * que o texto saia do dispositivo. É escrito à mão porque o SDK não tem
 * dependências (RNF-SDK-03) e o `crypto.subtle` é assíncrono, o que não serve num
 * caminho que corre a cada interação.
 */
export function resumo(texto: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < texto.length; i++) {
    h ^= texto.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}
