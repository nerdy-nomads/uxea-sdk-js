/**
 * Identificadores. Usa `crypto.randomUUID` quando existe, e um recuo sobre
 * `getRandomValues` quando não existe (Safari antigo, contextos não seguros).
 *
 * Nunca usa `Math.random` para identidade: dois dispositivos com o mesmo
 * arranque de gerador dariam o mesmo `anonymous_id`, e a partir daí duas pessoas
 * seriam uma no armazenamento.
 */
export function uuid(cripto?: any): string {
  const c = cripto ?? (globalThis as any).crypto;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  const b = new Uint8Array(16);
  if (c && typeof c.getRandomValues === "function") c.getRandomValues(b);
  else for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
  b[6] = (b[6]! & 0x0f) | 0x40;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, "0"));
  return `${h.slice(0, 4).join("")}-${h.slice(4, 6).join("")}-${h.slice(6, 8).join("")}-${h.slice(8, 10).join("")}-${h.slice(10).join("")}`;
}

/**
 * Hash estável de 32 bits (FNV-1a), em hexadecimal. A mesma função existe no
 * lado do servidor: a amostragem tem de decidir igual nos dois sítios, senão o
 * cliente envia o que o servidor deita fora.
 */
export function hash32(texto: string): number {
  // Sobre os **bytes** em UTF-8, e não sobre as unidades de código: o servidor
  // faz FNV sobre bytes, e um identificador com um acento daria dois resultados
  // diferentes nos dois lados.
  const bytes = new TextEncoder().encode(texto);
  let h = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i++) {
    h ^= bytes[i]!;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/**
 * Decide, sem estado e sem sorteio, se este utilizador entra na amostra.
 *
 * **É a mesma conta que o servidor faz** (`ratelimit.PassaNaAmostra`), até ao
 * resto da divisão por dez mil. Se as duas divergissem, o cliente enviava o que
 * o servidor deita fora, e uma tentativa ficava com metade dos passos.
 */
export function naAmostra(id: string, fracao: number): boolean {
  if (fracao >= 1) return true;
  if (fracao <= 0) return false;
  return (hash32(id) % 10000) / 10000 < fracao;
}
