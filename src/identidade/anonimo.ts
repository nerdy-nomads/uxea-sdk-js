/**
 * Identidade do lado do dispositivo. RF-CAP-11, RF-CAP-12, ADR 0005 e 0011.
 *
 * Três identificadores, e cada um responde a uma pergunta diferente:
 *
 *   anonymous_id  quem está a usar isto, sem saber quem é. Nasce no dispositivo
 *   device_id     em que aparelho, para separar telemóvel de computador
 *   session_id    sessão técnica, e **não** unidade de análise: a unidade é a
 *                 tentativa, que se reconstrói na consulta (ADR 0002)
 *
 * O `user_id` é o pseudónimo depois da autenticação, e **nunca** um identificador
 * direto: ver `pseudonimizar`.
 */
import type { Armazenamento } from "../core/tipos.ts";
import { uuid } from "../core/uuid.ts";

const K_ANON = "uxda.anon";
const K_DISP = "uxda.dispositivo";
const K_SESSAO = "uxda.sessao";
const K_UTIL = "uxda.utilizador";

/** Uma sessão técnica morre ao fim de 30 minutos sem nada acontecer. */
export const INATIVIDADE_MS = 30 * 60 * 1000;

export interface Identidade {
  anonimo: string;
  dispositivo: string;
  sessao: string;
  utilizador: string | null;
}

function persistente(loja: Armazenamento | null, chave: string): string {
  const guardado = loja?.getItem(chave);
  if (guardado) return guardado;
  const novo = uuid();
  loja?.setItem(chave, novo);
  return novo;
}

export function sessaoAtual(loja: Armazenamento | null, agora: number): string {
  let id = "";
  let ultimo = 0;
  try {
    const bruto = loja?.getItem(K_SESSAO);
    if (bruto) {
      const v = JSON.parse(bruto);
      id = typeof v.id === "string" ? v.id : "";
      ultimo = typeof v.ultimo === "number" ? v.ultimo : 0;
    }
  } catch { /* sessão ilegível é sessão nova */ }
  if (!id || agora - ultimo > INATIVIDADE_MS) id = uuid();
  loja?.setItem(K_SESSAO, JSON.stringify({ id, ultimo: agora }));
  return id;
}

export function identidade(loja: Armazenamento | null, agora: number): Identidade {
  return {
    anonimo: persistente(loja, K_ANON),
    dispositivo: persistente(loja, K_DISP),
    sessao: sessaoAtual(loja, agora),
    utilizador: loja?.getItem(K_UTIL) ?? null,
  };
}

export function guardarUtilizador(loja: Armazenamento | null, pseudo: string | null): void {
  if (pseudo) loja?.setItem(K_UTIL, pseudo);
  else loja?.removeItem(K_UTIL);
}

/* ------------------------------------------------------- pseudonimização */

/**
 * Um identificador direto **não sai do dispositivo**. RNF-PRI-02.
 *
 * Quem integra passa muitas vezes o que tem à mão: o email, o telefone, o nome
 * do utilizador. Recusar perdia a ligação e obrigava-o a trabalho que ele não vai
 * fazer; enviar tal e qual punha dados pessoais diretos na plataforma, que é
 * exatamente o que a secção de privacidade promete que nunca acontece.
 *
 * Por isso: **o que parecer direto é resumido aqui**, com SHA-256 quando o
 * browser o oferece, e o original nunca chega a entrar num evento.
 */
export function pareceDireto(valor: string): boolean {
  const v = valor.trim();
  if (v.includes("@") && v.includes(".")) return true;          // email
  if (/^\+?[0-9][0-9 ()\-]{6,}$/.test(v)) return true;           // telefone
  if (/\s/.test(v) && /^[\p{L}\s.'-]+$/u.test(v)) return true;   // nome com espaço
  return false;
}

async function sha256(texto: string, cripto: any): Promise<string | null> {
  try {
    if (!cripto?.subtle?.digest) return null;
    const dados = new TextEncoder().encode(texto);
    const b = new Uint8Array(await cripto.subtle.digest("SHA-256", dados));
    return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  } catch {
    return null;
  }
}

/** Resumo local, para quando não há `crypto.subtle` (contexto não seguro). */
function resumoFraco(texto: string): string {
  let a = 0x811c9dc5, b = 0x01000193;
  for (let i = 0; i < texto.length; i++) {
    a = Math.imul(a ^ texto.charCodeAt(i), 0x01000193) >>> 0;
    b = Math.imul(b + texto.charCodeAt(i) * (i + 1), 0x85ebca6b) >>> 0;
  }
  return (a.toString(16).padStart(8, "0") + b.toString(16).padStart(8, "0")).repeat(2);
}

export async function pseudonimizar(valor: string, cripto?: any): Promise<{ id: string; resumido: boolean }> {
  const v = String(valor).trim();
  if (!pareceDireto(v)) return { id: v.slice(0, 128), resumido: false };
  const c = cripto ?? (globalThis as any).crypto;
  const forte = await sha256(v, c);
  return { id: "px_" + (forte ?? resumoFraco(v)).slice(0, 40), resumido: true };
}
