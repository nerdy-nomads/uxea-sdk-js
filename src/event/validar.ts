/**
 * Validador de eventos do SDK web. Lê o **mesmo** `schema.json` que o `uxda-core`.
 *
 * Não é uma segunda implementação do esquema: é uma segunda implementação do
 * *motor de validação*, sobre a mesma descrição. O que não pode divergir é a
 * descrição, e é por isso que o `schema.json` tem uma fonte só e o
 * `./scripts/sync-schema.sh --verificar` falha quando as cópias se afastam.
 *
 * Corre **antes do envio**: um evento inválido nunca sai do dispositivo, e o
 * integrador vê o motivo na consola em vez de o descobrir na fila de rejeitados.
 */
import esquema from "./schema.json" with { type: "json" };

export interface Campo {
  nome: string;
  tipo: "uuid" | "texto" | "enum" | "instante" | "inteiro" | "objeto";
  obrigatorio: boolean;
  max?: number;
  min?: number;
  max_valor?: number;
  valores?: string[];
}

export interface Erro {
  campo: string;
  codigo: string;
  motivo: string;
}

export const CODIGOS = {
  obrigatorio: "obrigatorio",
  tipo: "tipo",
  valor: "valor",
  tamanho: "tamanho",
  desconhecido: "campo_desconhecido",
  regra: "regra",
} as const;

const CAMPOS = esquema.campos as unknown as Campo[];
const POR_NOME = new Map(CAMPOS.map((c) => [c.nome, c]));

/**
 * As propriedades permitidas vêm do **esquema**, e não de uma lista escrita aqui.
 *
 * Estavam escritas duas vezes, uma em Go e outra aqui, e uma chave acrescentada de
 * um lado só passava a ser recusada pelo outro sem ninguém dar por isso: o SDK
 * considerava válido o que a ingestão deitava fora. Tudo o que não está na lista é
 * recusado, e não ignorado.
 */
const PROPRIEDADES_PERMITIDAS = new Set(
  Object.entries((esquema as any).propriedades_permitidas ?? {})
    .filter(([nome]) => !nome.startsWith("$"))
    .flatMap(([, grupo]) => (grupo as { chaves: string[] }).chaves),
);

if (PROPRIEDADES_PERMITIDAS.size === 0) {
  throw new Error("esquema sem propriedades permitidas: o validador recusaria tudo");
}

const RE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RE_RFC3339 = /^\d{4}-\d{2}-\d{2}[Tt]\d{2}:\d{2}:\d{2}(\.\d+)?([Zz]|[+-]\d{2}:\d{2})$/;

function validarCampo(c: Campo, bruto: unknown): Erro | null {
  const e = (codigo: string, motivo: string): Erro => ({ campo: c.nome, codigo, motivo });
  switch (c.tipo) {
    case "uuid":
      if (typeof bruto !== "string") return e(CODIGOS.tipo, "esperava texto");
      if (!RE_UUID.test(bruto)) return e(CODIGOS.valor, "não é um UUID");
      return null;
    case "texto":
      if (typeof bruto !== "string") return e(CODIGOS.tipo, "esperava texto");
      if (bruto === "" && c.obrigatorio) return e(CODIGOS.valor, "texto vazio num campo obrigatório");
      if (c.max && [...bruto].length > c.max) return e(CODIGOS.tamanho, `mais de ${c.max} caracteres`);
      return null;
    case "enum":
      if (typeof bruto !== "string") return e(CODIGOS.tipo, "esperava texto");
      if (!c.valores?.includes(bruto)) return e(CODIGOS.valor, `valor ${JSON.stringify(bruto)} fora da lista: ${c.valores?.join(", ")}`);
      return null;
    case "instante":
      if (typeof bruto !== "string") return e(CODIGOS.tipo, "esperava texto em RFC 3339");
      if (!RE_RFC3339.test(bruto) || Number.isNaN(Date.parse(bruto))) return e(CODIGOS.valor, "não é um instante em RFC 3339");
      return null;
    case "inteiro":
      if (typeof bruto !== "number" || !Number.isFinite(bruto)) return e(CODIGOS.tipo, "esperava número inteiro");
      if (!Number.isInteger(bruto)) return e(CODIGOS.tipo, "esperava inteiro, e veio fracionário");
      if (c.min !== undefined && bruto < c.min) return e(CODIGOS.valor, `abaixo de ${c.min}`);
      if (c.max_valor !== undefined && bruto > c.max_valor) return e(CODIGOS.valor, `acima de ${c.max_valor}`);
      return null;
    case "objeto": {
      if (typeof bruto !== "object" || bruto === null || Array.isArray(bruto)) return e(CODIGOS.tipo, "esperava objeto");
      for (const [k, v] of Object.entries(bruto as Record<string, unknown>)) {
        if (!PROPRIEDADES_PERMITIDAS.has(k)) return e(CODIGOS.valor, `propriedade ${JSON.stringify(k)} não está na lista de permitidas`);
        if (typeof v === "string" && [...v].length > 64) return e(CODIGOS.tamanho, `propriedade ${JSON.stringify(k)} com mais de 64 caracteres: parece conteúdo`);
      }
      return null;
    }
  }
}

function validarRegras(ev: Record<string, unknown>): Erro[] {
  const out: Erro[] = [];
  if (ev["event_type"] === "mensagem") {
    if (!ev["message_key"] && !ev["message_text_masked"])
      out.push({ campo: "message_key", codigo: CODIGOS.regra, motivo: "um evento de mensagem tem de trazer chave ou texto mascarado" });
    if (!ev["message_kind"])
      out.push({ campo: "message_kind", codigo: CODIGOS.regra, motivo: "um evento de mensagem tem de trazer o tipo" });
  }
  return out;
}

/** Devolve **todos** os problemas, e não só o primeiro: quem integra corrige de uma vez. */
export function validar(ev: Record<string, unknown>): Erro[] {
  const erros: Erro[] = [];
  for (const nome of Object.keys(ev)) {
    if (!POR_NOME.has(nome)) erros.push({ campo: nome, codigo: CODIGOS.desconhecido, motivo: "campo que o esquema não conhece" });
  }
  for (const c of CAMPOS) {
    const bruto = ev[c.nome];
    if (bruto === undefined || bruto === null) {
      if (c.obrigatorio) erros.push({ campo: c.nome, codigo: CODIGOS.obrigatorio, motivo: "campo obrigatório em falta" });
      continue;
    }
    const e = validarCampo(c, bruto);
    if (e) erros.push(e);
  }
  erros.push(...validarRegras(ev));
  return erros.sort((a, b) => a.campo.localeCompare(b.campo));
}

export const versaoProtocolo = esquema.versao_protocolo as number;
export const compatibilidadeMeses = esquema.compatibilidade_meses as number;
