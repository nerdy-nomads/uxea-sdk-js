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

/**
 * O chão (cartão 18.1): o que sai mascarado **em qualquer texto**, até nos nomes que a
 * aplicação dá a um ecrã, a um passo, a um evento ou a uma mensagem. São nomes de
 * programador, e a máscara das mensagens destruía-os ("Pagamento Cartão" virava
 * `{nome}`); mas um correio, um número de conta ou uma referência longa lá dentro não
 * são nome nenhum, e nunca saem.
 */
const REGRAS_CHAO: ReadonlyArray<readonly [RegExp, string]> = [
  [/[^\s@/|]+@[^\s@/|]+\.[^\s@/|]+/g, "{email}"],
  [/[A-Za-z]{0,3}\d[\dA-Za-z]{7,}/g, "{id}"],
  [/\d{6,}/g, "{id}"],
];

export function chao(texto: string): string {
  let saida = String(texto ?? "");
  for (const [re, marcador] of REGRAS_CHAO) saida = saida.replace(re, marcador);
  return saida;
}

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

/* ------------------------------------------------------------- mensagens */

/**
 * O que se tira de uma mensagem além dos números: o que a aplicação lá interpolou
 * a partir do que a pessoa é ou escreveu.
 *
 * O `mascarar` acima cobre o RF-MSG-04 à letra, que fala de números, montantes,
 * datas e identificadores. Só que uma mensagem real também traz **nomes** ("Olá
 * Ana Maria, o pedido falhou") e **ecos do que foi escrito** ("O valor «abc» não é
 * válido"), e nenhum deles é número nenhum. Sem estas duas regras, a bateria de
 * fuga do cartão 5.4 apanhava conteúdo a sair dentro do texto de uma mensagem, que
 * é precisamente o risco crítico que o documento nomeia.
 *
 * **A garantia total é a chave, e não isto.** Estas regras são heurísticas, e a
 * direção do erro é a segura: mascaram a mais, nunca a menos. Por isso é que o
 * RF-MSG-02 manda preferir a chave, e o `README` explica o ganho a quem integra.
 */
const REGRAS_MENSAGEM: ReadonlyArray<readonly [RegExp, string]> = [
  // O que a aplicação cita é, quase sempre, o que a pessoa escreveu.
  [/[“”«»"]([^“”«»"]{1,120})[“”«»"]/g, "{valor}"],
  // Vocativo: o que vem a seguir a uma saudação é um nome, sempre.
  [/\b(Olá|Ola|Caro|Cara|Exmo\.|Exma\.|Sr\.|Sra\.|Bem-vindo|Bem-vinda)([,]?\s+)\p{Lu}[\p{Ll}\p{M}]+/gu, "$1$2{nome}"],
  // Duas ou mais palavras capitalizadas seguidas, com as partículas pelo meio:
  // "Ana Maria da Silva". Uma só não se toca, senão "Multicaixa" e "Kwanza"
  // desapareciam e o catálogo deixava de se perceber.
  [/\b\p{Lu}[\p{Ll}\p{M}]+(?:\s+(?:d[aeoi]s?|e|von|van|del)\s+\p{Lu}[\p{Ll}\p{M}]+|\s+\p{Lu}[\p{Ll}\p{M}]+)+/gu, "{nome}"],
];

/** Mascara uma mensagem de sistema, no dispositivo e antes de qualquer envio. */
export function mascararMensagem(texto: string): string {
  let saida = texto.replace(/\s+/g, " ").trim();
  for (const [re, marcador] of REGRAS_MENSAGEM) saida = saida.replace(re, marcador);
  return mascarar(saida);
}

/**
 * A chave de agrupamento por semelhança (RF-MSG-03).
 *
 * Duas variantes da mesma mensagem já têm a mesma chave depois de mascaradas, e
 * isso resolve a fragmentação por valores. O que **não** resolve é a mesma
 * mensagem reescrita: "O saldo é insuficiente" e "O saldo de {numero} Kz é
 * insuficiente" são duas entradas no catálogo, e são o mesmo problema.
 *
 * O esqueleto tira os marcadores e as palavras curtas, e fica com o que a mensagem
 * diz. As duas de cima dão `saldo insuficiente`, e caem no mesmo grupo.
 */
export function esqueletoDeMensagem(mascarada: string): string {
  const palavras = normalizarTexto(mascarada)
    .replace(/\{[a-z]+\}/g, " ")
    .split(/[^\p{L}]+/u)
    .filter((p) => p.length >= 4);
  return palavras.slice(0, 8).join(" ");
}
