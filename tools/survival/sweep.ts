/**
 * Escolhe o limiar e a margem com dados, e não a olho.
 *
 * Corre a bateria de mutações sobre os quatro DOM reais, com verdade conhecida, e
 * varre as duas constantes. O critério é o do ADR 0003: **primeiro nunca errar**
 * (um histórico silenciosamente errado é pior do que um partido), e só depois
 * cobrir o máximo.
 */
import { parseHTML } from "linkedom";
import { obter } from "./fetch.ts";
import { MUTACOES, mutacaoTotal, repor } from "./mutate.ts";
import { acionavel, sinais, type ElementoLike } from "../../src/identity/element.ts";
import { reconciliar } from "../../src/identity/reconcile.ts";

const SITES = [
  ["github.com/login", "20230602015340"], ["www.gov.uk", "20230602000018"],
  ["www.bbc.com", "20230601232750"], ["stackoverflow.com", "20230601223936"],
] as const;

const cands = (doc: any, marcar = false) =>
  (Array.from(doc.querySelectorAll("*")) as any[])
    .filter((e) => acionavel(e as ElementoLike))
    .map((e, i) => {
      if (marcar) e.setAttribute("data-gt", `g${i}`);
      return { ref: e.getAttribute("data-gt") ?? `#${i}`, sinais: sinais(e as ElementoLike) };
    });

const casos: Array<{ a: any[]; b: any[] }> = [];
for (const [url, ts] of SITES) {
  const base = parseHTML(await obter(url, ts)).document;
  for (const nome of [...Object.keys(MUTACOES), "tudo"]) {
    repor();
    const da = parseHTML(base.toString()).document;
    const a = cands(da, true);
    const db = parseHTML(da.toString()).document;
    if (nome === "tudo") mutacaoTotal(db); else MUTACOES[nome]!(db);
    casos.push({ a, b: cands(db) });
  }
}

console.log(`\n${casos.length} casos, ${casos.reduce((s, c) => s + c.a.length, 0)} elementos com verdade conhecida\n`);
console.log("limiar  margem   precisão   cobertura");
const linhas: any[] = [];
for (const limiar of [0.40, 0.45, 0.50, 0.55, 0.60, 0.65, 0.70]) {
  for (const margem of [0.05, 0.10, 0.15, 0.20]) {
    let certos = 0, errados = 0, total = 0;
    for (const c of casos) {
      for (const r of reconciliar(c.a, c.b, limiar, margem)) {
        total++;
        if (r.tipo === "reconciliado") (r.de === r.para ? certos++ : errados++);
      }
    }
    const precisao = certos + errados ? certos / (certos + errados) : 1;
    const cobertura = certos / total;
    linhas.push({ limiar, margem, precisao, cobertura, errados });
    console.log(`${limiar.toFixed(2)}    ${margem.toFixed(2)}   ${(precisao * 100).toFixed(2).padStart(7)}%   ${(cobertura * 100).toFixed(2).padStart(8)}%`);
  }
}
const perfeitos = linhas.filter((l) => l.errados === 0).sort((a, b) => b.cobertura - a.cobertura);
console.log(`\nmelhor com zero erros: limiar=${perfeitos[0]?.limiar} margem=${perfeitos[0]?.margem} cobertura=${(perfeitos[0]?.cobertura * 100).toFixed(2)}%`);
const quase = linhas.filter((l) => l.precisao >= 0.995).sort((a, b) => b.cobertura - a.cobertura);
console.log(`melhor com precisão >= 99,5%: limiar=${quase[0]?.limiar} margem=${quase[0]?.margem} cobertura=${(quase[0]?.cobertura * 100).toFixed(2)}%`);
