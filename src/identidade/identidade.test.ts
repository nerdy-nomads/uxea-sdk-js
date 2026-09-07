/**
 * Identidade do dispositivo e pseudonimização. Cartão 2.5, RF-CAP-11, RF-CAP-12,
 * RNF-PRI-02 e ADR 0005.
 *
 * O ensaio que decide o cartão é o do email: quem integra passa o que tem à mão,
 * e o que tem à mão costuma ser o correio eletrónico da pessoa. **Isso não pode
 * sair do dispositivo**, e não sai: é resumido aqui, e o que a plataforma recebe
 * é um pseudónimo.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { criarBrowser, memoria } from "../ensaio/duplo.ts";
import { iniciar } from "../index.ts";
import { identidade, sessaoAtual, pseudonimizar, pareceDireto, INATIVIDADE_MS } from "./anonimo.ts";
import { hash32, naAmostra } from "../core/uuid.ts";

test("2.5 o identificador anónimo nasce no dispositivo e sobrevive ao recarregamento", () => {
  const loja = memoria();
  const a = identidade(loja, 1000);
  const b = identidade(loja, 2000);
  assert.equal(a.anonimo, b.anonimo);
  assert.equal(a.dispositivo, b.dispositivo);
  assert.match(a.anonimo, /^[0-9a-f-]{36}$/);
});

test("2.5 a sessão técnica renova-se ao fim de trinta minutos parada", () => {
  const loja = memoria();
  const t = 1_000_000;
  const s1 = sessaoAtual(loja, t);
  assert.equal(sessaoAtual(loja, t + INATIVIDADE_MS - 1000), s1, "cortou uma sessão viva");
  const s2 = sessaoAtual(loja, t + 2 * INATIVIDADE_MS);
  assert.notEqual(s2, s1, "manteve a sessão depois de meia hora parada");
});

test("2.5 um identificador direto é resumido antes de sair", async () => {
  for (const direto of ["ana@exemplo.ao", "+244 923 000 111", "Ana Maria Silva"]) {
    assert.ok(pareceDireto(direto), `${direto} devia ser reconhecido como direto`);
    const { id, resumido } = await pseudonimizar(direto);
    assert.ok(resumido, "não foi resumido");
    assert.ok(id.startsWith("px_"));
    assert.ok(!id.includes("@") && !id.includes("Ana") && !id.includes("923"),
      `o original sobreviveu no pseudónimo: ${id}`);
  }
});

test("2.5 um pseudónimo que já vem opaco passa tal e qual", async () => {
  const { id, resumido } = await pseudonimizar("cliente-8f31c0");
  assert.equal(id, "cliente-8f31c0");
  assert.equal(resumido, false);
});

test("2.5 o mesmo identificador dá sempre o mesmo pseudónimo", async () => {
  const a = await pseudonimizar("ana@exemplo.ao");
  const b = await pseudonimizar("ana@exemplo.ao");
  assert.equal(a.id, b.id, "sem isto, a mesma pessoa seria duas");
});

test("2.5 identificar liga o anónimo ao pseudónimo, e pede a ligação retroativa", async () => {
  const br = criarBrowser();
  const uxda = iniciar({ chave: "uxda_des_t", servidor: "http://ingest.local", ambiente: br.ambiente() });
  await br.avancar(10);
  const anonimo = uxda.diagnostico().identidade.anonimo;

  await uxda.identificar("ana@exemplo.ao");
  await br.avancar(30000);

  const ligacao = br.pedidos.find((p) => p.url.includes("/v1/identidade/ligar"));
  assert.ok(ligacao, "não pediu a ligação retroativa ao servidor");
  const corpo = JSON.parse(ligacao!.corpo);
  assert.equal(corpo.anonymous_id, anonimo);
  assert.ok(String(corpo.user_id).startsWith("px_"), "mandou o email para o servidor");

  // E daqui em diante os eventos levam o pseudónimo.
  uxda.ecra("/conta");
  await br.avancar(30000);
  const ev = br.eventos().find((e) => e.screen_key === "/conta")!;
  assert.ok(ev, "o ecrã declarado não saiu");
  assert.equal(ev.user_id, corpo.user_id);

  // E o email não aparece em lado nenhum do que saiu do dispositivo.
  const tudo = JSON.stringify(br.pedidos);
  assert.ok(!tudo.includes("ana@exemplo.ao"), "o email saiu do dispositivo");
});

test("2.5 esquecer volta a pôr os eventos anónimos", async () => {
  const br = criarBrowser();
  const uxda = iniciar({ chave: "uxda_des_t", servidor: "http://ingest.local", ambiente: br.ambiente() });
  await br.avancar(10);
  await uxda.identificar("cliente-1");
  uxda.esquecer();
  uxda.ecra("/saida");
  await br.avancar(30000);
  const ev = br.eventos().find((e) => e.screen_key === "/saida")!;
  assert.equal(ev.user_id, undefined);
});

test("2.6 a amostragem é a mesma conta que o servidor faz", () => {
  // Valores tirados do `hash/fnv` do Go, com a mesma entrada. Se algum dia
  // divergirem, o cliente envia o que o servidor deita fora.
  assert.equal(hash32("u-1"), 4281602306);
  assert.equal(hash32("a1b2c3"), 2332815293);
  assert.equal(hash32("00000000-0000-4000-8000-000000000001"), 3480239522);
  assert.equal(hash32("utilizador-ção"), 399627198);
  // 2306/10000: dentro de 30%, fora de 20%.
  assert.equal(naAmostra("u-1", 0.3), true);
  assert.equal(naAmostra("u-1", 0.2), false);
  assert.equal(naAmostra("u-1", 1), true);
  assert.equal(naAmostra("u-1", 0), false);
});
