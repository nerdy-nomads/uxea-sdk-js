/**
 * A bateria de fuga sobre **toda a captura**, e não só as mensagens. Cartão 18.2,
 * `RNF-PRI-01`, `RNF-PRI-02`, `RNF-PRI-03`.
 *
 * O 5.4 provou o caminho das mensagens e dos campos. Esta leva a mesma pergunta a
 * todos os outros: o caminho, a consulta e o fragmento do endereço, as ligações, os
 * rótulos e os atributos de teste dos elementos, os pedidos de rede da aplicação, os
 * nomes que a aplicação dá a ecrãs, passos, eventos e mensagens, as propriedades da
 * instituição, a identificação do utilizador, o deslocamento, a rede, a espera, o
 * recuo, o fim da tentativa e o plano de fundo, nos três níveis e com o rastreio
 * individual ligado.
 *
 * E tem **uma guarda de cobertura**: a corrida tem de produzir todos os tipos de evento
 * do esquema. Um caminho de captura novo, sem um ensaio que o percorra aqui, faz esta
 * bateria cair no dia em que entra no esquema, e não no dia em que vaza.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import esquema from "./event/schema.json" with { type: "json" };
import { criarBrowser, disparar } from "./ensaio/duplo.ts";
import { iniciar } from "./index.ts";

import { corrida, fugas, PAGINA, SEGREDOS } from "./ensaio/corrida-total.ts";

test("18.2 nenhum segredo sai por caminho nenhum, nos três níveis e com o rastreio individual ligado", async () => {
  for (const nivel of ["essencial", "padrao", "detalhado"] as const) {
    const { bruto, eventos } = await corrida(nivel);
    assert.ok(eventos.length > 5, `${nivel}: quase nada saiu, a bateria não provava nada`);
    const f = fugas(bruto);
    assert.deepEqual(f, [], `${nivel}: saiu do dispositivo`);
  }
});

test("18.2 a cobertura: a corrida produz todos os tipos de evento do esquema", async () => {
  const { eventos } = await corrida("detalhado");
  const vistos = new Set(eventos.map((e: any) => e.event_type));
  const todos = (esquema.campos.find((c: any) => c.nome === "event_type") as any).valores as string[];
  const faltam = todos.filter((t) => !vistos.has(t));
  assert.deepEqual(faltam, [], `tipos de evento sem cobertura nesta bateria: ${faltam.join(", ")}. Um caminho de captura novo precisa de ser percorrido aqui`);
  // E os sítios onde o texto podia ir, para a bateria não estar verde por não olhar.
  assert.ok(eventos.some((e: any) => String(e.screen_key).includes("{")), "o caminho com dados não chegou a ser lido");
  assert.ok(eventos.some((e: any) => e.event_type === "erro_rede"), "a rede da aplicação não foi exercida");
  assert.ok(eventos.some((e: any) => e.user_id), "a identificação não foi exercida");
  assert.ok(eventos.some((e: any) => e.properties?.toque_x !== undefined), "o rastreio individual não foi exercido");
});

test("18.2 o detetor apanha os segredos nas formas codificadas", () => {
  assert.deepEqual(fugas(`{"u":"ana.silva%40exemplo.ao"}`), ["ana.silva@exemplo.ao"]);
  assert.deepEqual(fugas(`{"c":"4111 1111 1111 1111"}`), ["4111111111111111"]);
  assert.deepEqual(fugas(`{"n":"ANA MARIA DA SILVA"}`), ["Ana Maria da Silva"]);
  assert.deepEqual(fugas(`{"t":"%2B244923000111"}`), ["+244923000111"]);
  assert.deepEqual(fugas(`{"x":"{email} {id} {numero}"}`), []);
});

/** Um gerador pequeno e determinístico, para a corrida em volume ser a mesma em todo o lado. */
function gerador(semente: number) {
  let s = semente >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; };
}

test("18.2 em volume: mil pessoas com dados diferentes em todos os caminhos, e nada escapa", async () => {
  const r = gerador(18_2);
  const NOMES = ["Ana", "Bruno", "Carla", "Domingos", "Esperança", "Fernando", "Graça", "Helder", "Isabel", "Joaquim"];
  const APELIDOS = ["Silva", "Santos", "Ferreira", "Costa", "Neto", "Miranda", "Cardoso", "Tavares"];
  let pedidos = 0, eventos = 0, verificados = 0;
  const N = Number(process.env.UXEA_FUGA_N ?? 1000);
  const br = criarBrowser(PAGINA, { caminho: "/inicio" });
  br.janela.fetch = async () => ({ status: 500, ok: false }); // rápido: a espera não é o que aqui se mede
  const uxea = iniciar({ chave: "uxea_des_teste", servidor: "https://ingest.local", ambiente: br.ambiente() });
  await br.avancar(10);
  const segredosDaCorrida: string[] = [];
  for (let i = 0; i < N; i++) {
    const nome = `${NOMES[Math.floor(r() * NOMES.length)]} ${APELIDOS[Math.floor(r() * APELIDOS.length)]} ${APELIDOS[Math.floor(r() * APELIDOS.length)]}`;
    const nif = String(Math.floor(100000000 + r() * 899999999));
    const correio = `pessoa${i}.${nif.slice(0, 4)}@exemplo.ao`;
    const cartao = `4${String(Math.floor(r() * 1e15)).padStart(15, "0")}`;
    segredosDaCorrida.push(nome, nif, correio, cartao);
    (br.documento.querySelector("#nome") as any).value = nome;
    disparar(br.documento, "#nome", "focusin");
    disparar(br.documento, "#nome", "input", { inputType: "insertText", data: nome });
    disparar(br.documento, "#nome", "focusout");
    uxea.track(`evento_${nif}`, { segmento: nome, campanha: correio });
    uxea.ecra(`/clientes/${correio}`);
    uxea.mensagem(`erro_${cartao}`, "erro", { operacao: nome });
    await br.janela.fetch(`https://api.exemplo.ao/contas/${nif}/cartoes/${cartao}?email=${correio}`);
    if (i % 100 === 99) { await uxea.descarregar(); await br.avancar(20000); }
  }
  await uxea.descarregar();
  await br.avancar(30000);
  const bruto = JSON.stringify(br.pedidos);
  pedidos = br.pedidos.length;
  eventos = br.eventos().length;
  verificados = segredosDaCorrida.length;
  const achadas = fugas(bruto, segredosDaCorrida);
  console.log(`  18.2 volume: ${N} pessoas, ${verificados} valores pessoais distintos, ${eventos} eventos em ${pedidos} pedidos, ${achadas.length} fugas`);
  assert.ok(eventos > N, "saíram menos eventos do que pessoas: a corrida não provava nada");
  assert.deepEqual(achadas.slice(0, 5), []);
});

test("18.2 a bateria apanha uma fuga introduzida de propósito fora das mensagens, e passa sem ela", async () => {
  // A fuga: a instituição expõe a propriedade `segmento`, e a aplicação mete lá o nome
  // da pessoa. É o único caminho que o 18.1 deixou aberto, e é uma decisão de quem
  // trata os dados; a bateria tem de a ver quando acontece.
  const com = await corrida("padrao", { exposicao: { propriedades: ["segmento"] } });
  assert.deepEqual(fugas(com.bruto), ["Ana Maria da Silva"], "a bateria não apanhou a fuga introduzida");
  const sem = await corrida("padrao");
  assert.deepEqual(fugas(sem.bruto), [], "sem a fuga, nada devia sair");
});
