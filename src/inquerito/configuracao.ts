/**
 * A leitura do campo `inqueritos` da configuração remota. Cartões 14.1 e 14.2.
 *
 * O contrato está em `docs/contrato-das-respostas.md`, secção 1. O que se decide
 * aqui é o que fazer com o que **não** está no contrato, e a regra é uma só:
 * **o que vier estragado não pergunta nada**.
 *
 *  - `inqueritos` que não é um objeto, ou `lista` que não é uma lista: nenhum
 *    inquérito, e o tema e a fadiga por omissão;
 *  - um inquérito estragado sai da lista, e **os outros ficam**. Os inquéritos
 *    mudam um a um na consola (`PUT /v1/inqueritos/{chave}`), e um só mal escrito
 *    não pode calar os que estavam bem;
 *  - uma condição estragada tira **o critério inteiro**, e nunca só a condição.
 *    As condições valem em **e**: tirar uma alargava o critério, e um gatilho mais
 *    largo do que o escrito é exatamente o inquérito a aparecer a quem não devia;
 *  - um gatilho que precisa de critérios e fica sem nenhum sai da lista. A exceção
 *    é o `apos_erro`, que tem critérios por omissão no contrato.
 *
 * Os valores que chegam ao ecrã (cores, fonte) são validados contra uma forma
 * fechada, e não só contra o tipo: vão parar a propriedades de CSS, e uma cor que
 * não é cor é, na melhor das hipóteses, um componente ilegível.
 */
import {
  FADIGA_POR_OMISSAO, SEM_INQUERITOS, TEMA_POR_OMISSAO,
  type ConfiguracaoDeInqueritos, type CriterioDeRegra, type FadigaDeInquerito, type FormatoDeInquerito,
  type GatilhoDeInquerito, type OpcaoDeInquerito, type RegraDeInquerito, type TemaDeInquerito,
} from "../core/tipos.ts";
import { campoValido, operadorValido } from "./regras.ts";

export const FORMATOS: readonly FormatoDeInquerito[] = ["esforco", "satisfacao", "recomendacao", "escolha", "livre"];
export const GATILHOS: readonly GatilhoDeInquerito[] = ["apos_conclusao", "apos_abandono", "apos_erro", "primeira_utilizacao", "amostragem"];

/** O sorteio quando a regra não o diz. **Nunca toda a gente sempre**, e é o contrato que o fixa. */
export const AMOSTRAGEM_POR_OMISSAO = 0.1;
/** O atraso quando a regra não o diz: o do exemplo do contrato. */
export const ATRASO_POR_OMISSAO_MS = 1500;
/** Um minuto. Um inquérito que aparece muito depois do que o disparou já não é sobre isso. */
const ATRASO_MAXIMO_MS = 60_000;
const MAX_REGRAS = 50;
const MAX_CRITERIOS = 20;
const MAX_OPCOES = 12;

/** Os critérios do `apos_erro` quando a regra não traz nenhum, à letra do contrato. */
export const CRITERIOS_DE_ERRO: CriterioDeRegra[] = [
  { condicoes: [{ campo: "event_type", operador: "igual", valor: "erro_rede" }] },
  { condicoes: [{ campo: "message_kind", operador: "igual", valor: "erro" }] },
];

const ehObjeto = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

function textoCurto(v: unknown, max: number): string {
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}

function inteiro(v: unknown, min: number, max: number, omissao: number): number {
  if (typeof v !== "number" || !Number.isFinite(v)) return omissao;
  return Math.min(max, Math.max(min, Math.round(v)));
}

/* ------------------------------------------------------------------- tema */

const COR = /^(#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})|(rgb|rgba|hsl|hsla)\([0-9.,%\s/+-]{1,60}\)|[a-z]{3,30})$/i;
// Nomes de família, vírgulas, aspas e espaços. Nada que feche uma declaração.
const FONTE = /^[\p{L}\p{N}\s,"'._-]{1,160}$/u;

function cor(v: unknown, omissao: string): string {
  return typeof v === "string" && COR.test(v.trim()) ? v.trim() : omissao;
}

export function normalizarTema(t: unknown): TemaDeInquerito {
  if (!ehObjeto(t)) return TEMA_POR_OMISSAO;
  return {
    corPrimaria: cor(t["cor_primaria"], TEMA_POR_OMISSAO.corPrimaria),
    corFundo: cor(t["cor_fundo"], TEMA_POR_OMISSAO.corFundo),
    corTexto: cor(t["cor_texto"], TEMA_POR_OMISSAO.corTexto),
    fonte: typeof t["fonte"] === "string" && FONTE.test(t["fonte"].trim()) ? t["fonte"].trim() : TEMA_POR_OMISSAO.fonte,
    cantosPx: inteiro(t["cantos_px"], 0, 32, TEMA_POR_OMISSAO.cantosPx),
    idioma: t["idioma"] === "en" ? "en" : "pt",
  };
}

/* ----------------------------------------------------------------- fadiga */

export function normalizarFadiga(f: unknown): FadigaDeInquerito {
  if (!ehObjeto(f)) return FADIGA_POR_OMISSAO;
  return {
    maxPedidos: inteiro(f["max_pedidos"], 0, 100, FADIGA_POR_OMISSAO.maxPedidos),
    periodoDias: inteiro(f["periodo_dias"], 1, 3650, FADIGA_POR_OMISSAO.periodoDias),
    excluirRespondeuDias: inteiro(f["excluir_respondeu_dias"], 0, 3650, FADIGA_POR_OMISSAO.excluirRespondeuDias),
  };
}

/* ------------------------------------------------------------- critérios */

/**
 * Uma lista de critérios, **com a forma do `Validar` do servidor**: um critério
 * tem de uma a oito condições, cada condição tem um campo e um operador que
 * existem, e um valor quando o operador o pede, até 256 bytes.
 */
export function normalizarCriterios(lista: unknown): CriterioDeRegra[] {
  if (!Array.isArray(lista)) return [];
  const out: CriterioDeRegra[] = [];
  for (const bruto of lista.slice(0, MAX_CRITERIOS)) {
    if (!ehObjeto(bruto) || !Array.isArray(bruto["condicoes"])) continue;
    const condicoes = bruto["condicoes"];
    if (condicoes.length === 0 || condicoes.length > 8) continue;
    const boas = [];
    for (const c of condicoes) {
      if (!ehObjeto(c)) break;
      const campo = typeof c["campo"] === "string" ? c["campo"] : "";
      const operador = typeof c["operador"] === "string" ? c["operador"] : "";
      const valor = c["valor"] === undefined || c["valor"] === null ? "" : c["valor"];
      if (!campoValido(campo) || !operadorValido(operador) || typeof valor !== "string") break;
      const semValor = operador === "existe" || operador === "nao_existe";
      if (!semValor && valor.trim() === "") break;
      if (new TextEncoder().encode(valor).length > 256) break;
      boas.push({ campo, operador, valor });
    }
    // Uma condição que não passou tira o critério inteiro: ver o topo do ficheiro.
    if (boas.length === condicoes.length) out.push({ condicoes: boas });
  }
  return out;
}

/* ----------------------------------------------------------------- regras */

function normalizarOpcoes(lista: unknown): OpcaoDeInquerito[] {
  if (!Array.isArray(lista)) return [];
  const vistas = new Set<string>();
  const out: OpcaoDeInquerito[] = [];
  for (const o of lista) {
    if (!ehObjeto(o)) continue;
    const chave = textoCurto(o["chave"], 64);
    const pt = textoCurto(o["pt"], 120);
    const en = textoCurto(o["en"], 120);
    if (!chave || vistas.has(chave) || (!pt && !en)) continue;
    vistas.add(chave);
    // Uma língua em falta mostra a outra: melhor uma opção em inglês num ecrã em
    // português do que um botão sem nada escrito.
    out.push({ chave, pt: pt || en, en: en || pt });
    if (out.length >= MAX_OPCOES) break;
  }
  return out;
}

export function normalizarRegra(r: unknown): RegraDeInquerito | null {
  if (!ehObjeto(r)) return null;
  const chave = textoCurto(r["chave"], 128);
  if (!chave) return null;
  const formato = FORMATOS.find((f) => f === r["formato"]);
  const gatilho = GATILHOS.find((g) => g === r["gatilho"]);
  if (!formato || !gatilho) return null;

  const p = ehObjeto(r["pergunta"]) ? r["pergunta"] : {};
  const pt = textoCurto(p["pt"], 300);
  const en = textoCurto(p["en"], 300);
  if (!pt && !en) return null;

  const opcoes = formato === "escolha" ? normalizarOpcoes(r["opcoes"]) : [];
  if (formato === "escolha" && opcoes.length === 0) return null;

  let criterios = normalizarCriterios(r["criterios"]);
  const inicio = normalizarCriterios(r["inicio"]);
  if (gatilho === "apos_erro" && criterios.length === 0) criterios = CRITERIOS_DE_ERRO;
  if ((gatilho === "apos_conclusao" || gatilho === "primeira_utilizacao") && criterios.length === 0) return null;
  // O abandono precisa das duas pontas: sem início não há tentativa, e sem fim
  // todas as tentativas eram abandono.
  if (gatilho === "apos_abandono" && (criterios.length === 0 || inicio.length === 0)) return null;

  const amostragem = typeof r["amostragem"] === "number" && r["amostragem"] >= 0 && r["amostragem"] <= 1
    ? r["amostragem"] : AMOSTRAGEM_POR_OMISSAO;

  const ctx = ehObjeto(r["contexto"]) ? r["contexto"] : {};
  return {
    chave,
    versao: inteiro(r["versao"], 0, Number.MAX_SAFE_INTEGER, 0),
    formato,
    pergunta: { pt: pt || en, en: en || pt },
    opcoes,
    multipla: formato === "escolha" && r["multipla"] === true,
    comentario: r["comentario"] === true,
    gatilho,
    criterios: gatilho === "amostragem" ? [] : criterios,
    inicio,
    amostragem,
    atrasoMs: inteiro(r["atraso_ms"], 0, ATRASO_MAXIMO_MS, ATRASO_POR_OMISSAO_MS),
    contexto: {
      tarefa: textoCurto(ctx["tarefa"], 64),
      passo: textoCurto(ctx["passo"], 64),
      funcionalidade: textoCurto(ctx["funcionalidade"], 64),
    },
  };
}

export function normalizarInqueritos(bruto: unknown): ConfiguracaoDeInqueritos {
  if (!ehObjeto(bruto) || !Array.isArray(bruto["lista"])) return SEM_INQUERITOS;
  const lista: RegraDeInquerito[] = [];
  const chaves = new Set<string>();
  for (const r of bruto["lista"]) {
    const regra = normalizarRegra(r);
    // Duas regras com a mesma chave são uma avaria de quem escreveu: fica a
    // primeira, e o registo de fadiga não conta a mesma coisa duas vezes.
    if (!regra || chaves.has(regra.chave)) continue;
    chaves.add(regra.chave);
    lista.push(regra);
    if (lista.length >= MAX_REGRAS) break;
  }
  return {
    tema: normalizarTema(bruto["tema"]),
    fadiga: normalizarFadiga(bruto["fadiga"]),
    // **Só `true` liga**, pela mesma razão do rastreio individual.
    associarRespostas: bruto["associar_respostas"] === true,
    lista,
  };
}
