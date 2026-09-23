/**
 * Os erros internos do SDK reportados ao servidor. Cartão 17.3, RF-OPS-10, ADR 0045.
 *
 * Contam-se por sítio e por tipo, viajam no lote seguinte e saem da conta quando o
 * servidor os recebeu. **A mensagem nunca sai**: pode trazer o que a pessoa escreveu.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { confirmarErrosReportados, errosPorReportar, limparErros, protegido } from "./safe.ts";
import { Armazem } from "./fila/armazem.ts";
import { Fila } from "./fila/fila.ts";
import { memoria } from "./ensaio/duplo.ts";

test("conta por sítio e por tipo, e não guarda a mensagem", () => {
  limparErros();
  const parse = protegido("captura.campo", () => JSON.parse("{o cartão 4111 1111"), null);
  const tipo = protegido("captura.campo", () => (null as unknown as { x: number }).x, null);
  parse(); parse(); tipo();
  const e = errosPorReportar().sort((a, b) => a.tipo.localeCompare(b.tipo));
  assert.deepEqual(e, [
    { onde: "captura.campo", tipo: "SyntaxError", contagem: 2 },
    { onde: "captura.campo", tipo: "TypeError", contagem: 1 },
  ]);
  assert.ok(!JSON.stringify(e).includes("4111"));
});

test("um valor lançado que não é um erro também se conta, sem o valor", () => {
  limparErros();
  protegido("fila.enviar", () => { throw "a palavra-passe é segredo"; }, null)();
  assert.deepEqual(errosPorReportar(), [{ onde: "fila.enviar", tipo: "string", contagem: 1 }]);
});

test("não cresce sem limite: vinte combinações, e a contagem pára nos dez mil", () => {
  limparErros();
  for (let i = 0; i < 50; i++) protegido(`sitio.${i}`, () => { throw new Error("x"); }, null)();
  assert.equal(errosPorReportar().length, 20);
  limparErros();
  const f = protegido("sitio", () => { throw new Error("x"); }, null);
  for (let i = 0; i < 10050; i++) f();
  assert.equal(errosPorReportar()[0]!.contagem, 10000);
});

test("confirmar tira o que foi, e deixa o que aconteceu entretanto", () => {
  limparErros();
  const f = protegido("s", () => { throw new Error("x"); }, null);
  f(); f();
  const enviados = errosPorReportar();
  f();
  confirmarErrosReportados(enviados);
  assert.deepEqual(errosPorReportar(), [{ onde: "s", tipo: "Error", contagem: 1 }]);
});

test("viajam no lote e saem da conta quando o servidor aceita", async () => {
  limparErros();
  protegido("captura.toque", () => { throw new RangeError("fora"); }, null)();
  const corpos: string[] = [];
  const amb = {
    agora: () => 1_790_000_000_000,
    enviar: async (_url: string, corpo: string) => { corpos.push(corpo); return { estado: 202, corpo: "" }; },
  } as unknown as ConstructorParameters<typeof Fila>[1];
  const armazem = new Armazem(memoria());
  armazem.juntar({
    event_id: "00000000-0000-4000-8000-000000000001", anonymous_id: "a", device_id: "d", session_id: "s",
    event_type: "ecra", screen_key: "/x", occurred_at: "2026-09-23T10:00:00.000Z", app_version: "1",
    platform: "web", identity_scope: "aplicacao", capture_level: "padrao",
  });
  const fila = new Fila(armazem, amb, "http://ingest/v1/eventos", () => ({}));
  await fila.descarregar();
  const corpo = JSON.parse(corpos[0]!);
  assert.deepEqual(corpo.erros_sdk, [{ onde: "captura.toque", tipo: "RangeError", contagem: 1 }]);
  assert.ok(!corpos[0]!.includes("fora"));
  assert.deepEqual(errosPorReportar(), []);
});
