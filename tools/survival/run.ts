/**
 * Cartão 0.2: mede a taxa de sobrevivência de identificadores entre versões.
 *
 * Duas medições, e nenhuma substitui a outra:
 *
 *  1. **Pares reais**, do arquivo. Aplicações a sério, versões a sério. Não têm
 *     verdade conhecida: um elemento que não corresponde tanto pode ter sido mal
 *     identificado como ter deixado de existir. Por isso reporta-se também a taxa
 *     **entre os que continuam a existir**.
 *  2. **Mutações controladas** sobre os mesmos DOM. A verdade é conhecida por
 *     construção, e dá precisão e cobertura a sério.
 *
 * Correr: npm run survival
 */
import { parseHTML } from "linkedom";
import { writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { obter } from "./fetch.ts";
import { MUTACOES, mutacaoTotal, repor } from "./mutate.ts";
import { acionavel, sinais, type ElementoLike } from "../../src/identity/element.ts";
import { reconciliar, taxa, type Candidato } from "../../src/identity/reconcile.ts";

const AQUI = dirname(fileURLToPath(import.meta.url));

interface Par { nome: string; url: string; antes: string; depois: string; meses: number }

const PARES: Par[] = [
  { nome: "github/login",  url: "github.com/login",   antes: "20230602015340", depois: "20260602000129", meses: 36 },
  { nome: "gov.uk",        url: "www.gov.uk",         antes: "20230602000018", depois: "20260602005037", meses: 36 },
  { nome: "bbc.com",       url: "www.bbc.com",        antes: "20230601232750", depois: "20260602001501", meses: 36 },
  { nome: "stackoverflow", url: "stackoverflow.com",  antes: "20230601223936", depois: "20250205120008", meses: 20 },
];

const pct = (n: number) => `${(n * 100).toFixed(1)}%`;

function elementos(doc: any): any[] {
  return (Array.from(doc.querySelectorAll("*")) as any[]).filter((e) => acionavel(e as ElementoLike));
}

function candidatos(doc: any, marcar = false): Candidato[] {
  return elementos(doc).map((e, i) => {
    if (marcar) e.setAttribute("data-gt", `g${i}`);
    return { ref: e.getAttribute("data-gt") ?? `#${i}`, sinais: sinais(e as ElementoLike) };
  });
}

/** Quantos elementos de "antes" ainda existem em "depois", por rótulo ou atributo. */
function aindaExistem(a: Candidato[], b: Candidato[]): number {
  const rot = new Set(b.map((c) => c.sinais.rotulo).filter(Boolean));
  const tid = new Set(b.map((c) => c.sinais.testid).filter(Boolean));
  return a.filter((c) => (c.sinais.testid && tid.has(c.sinais.testid)) || (c.sinais.rotulo && rot.has(c.sinais.rotulo))).length;
}

const relatorio: any = { data: new Date().toISOString().slice(0, 10), reais: [], mutacoes: [] };

console.log("\n=== 1. PARES REAIS, do arquivo ===\n");
console.log("par                 meses   elems A   elems B   reconhecidos   ambíguos   entre os que existem");
for (const p of PARES) {
  const [ha, hb] = await Promise.all([obter(p.url, p.antes), obter(p.url, p.depois)]);
  const da = parseHTML(ha).document, db = parseHTML(hb).document;
  const ca = candidatos(da), cb = candidatos(db);
  const t = taxa(reconciliar(ca, cb));
  const existem = aindaExistem(ca, cb);
  const entre = existem ? Math.min(1, t.reconciliados / existem) : 0;
  console.log(
    `${p.nome.padEnd(18)} ${String(p.meses).padStart(5)}   ${String(ca.length).padStart(7)}   ${String(cb.length).padStart(7)}   ` +
    `${pct(t.sobrevivencia).padStart(12)}   ${pct(t.ambiguos / (t.total || 1)).padStart(8)}   ${pct(entre).padStart(20)}`);
  relatorio.reais.push({ ...p, elementosAntes: ca.length, elementosDepois: cb.length, ...t, aindaExistem: existem, entreOsQueExistem: entre });
}

console.log("\n=== 2. MUTAÇÕES CONTROLADAS, com verdade conhecida ===\n");
console.log("mutação          elems   corretos   errados   recusados   precisão   cobertura");
const base = parseHTML(await obter(PARES[0]!.url, PARES[0]!.antes)).document;
const nomes = [...Object.keys(MUTACOES), "tudo"];
for (const nome of nomes) {
  repor();
  const da = parseHTML(base.toString()).document;
  const ca = candidatos(da, true);
  const db = parseHTML(da.toString()).document;
  if (nome === "tudo") mutacaoTotal(db); else MUTACOES[nome]!(db);
  const cb = candidatos(db);
  const rs = reconciliar(ca, cb);
  const certos = rs.filter((r) => r.tipo === "reconciliado" && r.de === (r as any).para).length;
  const errados = rs.filter((r) => r.tipo === "reconciliado" && r.de !== (r as any).para).length;
  const recusados = rs.filter((r) => r.tipo !== "reconciliado").length;
  const precisao = certos + errados ? certos / (certos + errados) : 1;
  const cobertura = rs.length ? certos / rs.length : 0;
  console.log(
    `${nome.padEnd(15)} ${String(ca.length).padStart(5)}   ${String(certos).padStart(8)}   ${String(errados).padStart(7)}   ` +
    `${String(recusados).padStart(9)}   ${pct(precisao).padStart(8)}   ${pct(cobertura).padStart(9)}`);
  relatorio.mutacoes.push({ mutacao: nome, elementos: ca.length, certos, errados, recusados, precisao, cobertura });
}

writeFileSync(join(AQUI, "resultado.json"), JSON.stringify(relatorio, null, 2));
console.log(`\nresultado em tools/survival/resultado.json\n`);
