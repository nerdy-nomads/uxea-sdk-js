/** A metade TypeScript da prova: os veredictos do validador do SDK, no mesmo formato. */
import { writeFileSync } from "node:fs";
import { validar } from "../src/event/validar.ts";
import corpus from "../src/event/corpus.json" with { type: "json" };

const casos = (corpus as { casos: { nome: string; evento: Record<string, unknown> }[] }).casos;
const out = casos.map((c) => {
  const erros = validar(c.evento);
  return { nome: c.nome, valido: erros.length === 0, erros: erros.map((e) => `${e.campo}:${e.codigo}`).sort() };
});
writeFileSync(process.argv[2]!, JSON.stringify(out, null, 2) + "\n");
