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

/**
 * As propriedades cujo valor é um resumo calculado no dispositivo sobre texto já
 * mascarado.
 *
 * A guarda contra fugas recusa corridas de algarismos num valor de texto, e um
 * resumo em hexadecimal tem-nas com frequência: `62431dbd` traz cinco algarismos
 * seguidos e não traz informação nenhuma. Sem esta lista, a guarda recusava
 * exatamente os valores que não podem transportar conteúdo, e foi o que aconteceu:
 * quatro em cada cinco mensagens da bateria de volume do 5.4 nem chegaram a sair.
 */
const PROPRIEDADES_OPACAS = new Set(
  ((esquema as any).propriedades_opacas?.chaves ?? []) as string[],
);

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
        if (typeof v === "string") {
          if ([...v].length > 64) return e(CODIGOS.tamanho, `propriedade ${JSON.stringify(k)} com mais de 64 caracteres: parece conteúdo`);
          // A regra `sem_conteudo` diz, com todas as letras, que um valor de
          // propriedade é número, booleano ou **texto curto sem dígitos longos**.
          // A parte dos dígitos não estava imposta em lado nenhum: uma chave
          // permitida com um número de documento lá dentro passava nos dois
          // validadores, e é a forma mais provável de uma fuga entrar, porque a
          // lista de chaves dá a sensação de já proteger.
          const motivo = textoComConteudo(v);
          if (motivo && !PROPRIEDADES_OPACAS.has(k)) return e(CODIGOS.valor, `propriedade ${JSON.stringify(k)}: ${motivo}`);
        }
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
  // A regra vale para **qualquer** evento que traga texto, e não só para os de
  // tipo mensagem: um `erro` de validação com o texto do campo lá dentro seria
  // exatamente a fuga que o RF-MSG-04 existe para impedir, e escapava a uma
  // verificação presa ao tipo.
  const texto = ev["message_text_masked"];
  if (typeof texto === "string" && texto) {
    const motivo = textoComConteudo(texto);
    if (motivo) out.push({ campo: "message_text_masked", codigo: CODIGOS.regra, motivo });
  }
  // A geografia deste produto é o fuso, e é grosseira por construção (ADR 0022).
  // Sem esta regra o campo aceitava um par de coordenadas, e passava a ser a porta
  // por onde a localização exata entrava sem ninguém a ter pedido.
  const fuso = ev["time_zone"];
  if (typeof fuso === "string" && fuso && !pareceFuso(fuso)) {
    out.push({ campo: "time_zone", codigo: CODIGOS.regra, motivo: "não é um fuso IANA: esperava Area/Local, como Europe/Lisbon, ou UTC" });
  }
  return out;
}

/**
 * Aceita `Area/Local`, `Area/Sub/Local` e os dois nomes sem barra que existem de
 * facto. Recusa tudo o resto, e em particular qualquer coisa com um ponto decimal
 * ou uma vírgula, que é a forma que um par de coordenadas tem.
 */
export function pareceFuso(s: string): boolean {
  if (s === "UTC" || s === "GMT" || s === "Z") return true;
  const barras = (s.match(/\//g) ?? []).length;
  if (s.length > 64 || barras < 1 || barras > 2) return false;
  if (!/^[A-Z]/.test(s)) return false;
  return /^[A-Za-z][A-Za-z0-9_/+-]*$/.test(s);
}

/**
 * A contraprova da mascaragem do dispositivo (RF-MSG-04).
 *
 * O dispositivo promete que mascarou; isto verifica, e é a mesma verificação que a
 * ingestão faz em Go. **Recusa em vez de mascarar**, de propósito: mascarar aqui
 * deixava o defeito de quem enviou a passar em silêncio, e a fuga continuava a
 * existir em todas as versões instaladas.
 */
export function textoComConteudo(texto: string): string {
  for (const parte of texto.split(/\s+/)) {
    const i = parte.indexOf("@");
    if (i > 0 && parte.slice(i).includes(".")) return "texto com correio electrónico por mascarar";
  }
  // Quatro algarismos seguidos ainda pode ser um ano numa mensagem legítima;
  // cinco já é uma referência, um montante ou um contacto.
  if (/\d{5}/.test(texto)) return "texto com uma sequência de dígitos por mascarar";
  return "";
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
