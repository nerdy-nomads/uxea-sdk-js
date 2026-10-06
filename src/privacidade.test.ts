/**
 * Mascaramento por omissão, lista de permissões e consentimento. Cartão 18.1,
 * `RNF-PRI-04`, `RNF-PRI-12`, ADR 0047.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { criarBrowser, disparar, memoria } from "./ensaio/duplo.ts";
import { iniciar } from "./index.ts";
import { propriedadesDoCliente, transporteDe } from "./privacidade.ts";

// Um formulário de pagamento, e um campo **acrescentado depois**, por quem nunca leu
// a documentação do SDK: sem `data-testid`, sem declaração, sem nada.
const PAGINA = `
<form id="f">
  <label for="nome">Nome no cartão</label>
  <input id="nome" data-testid="nome" data-caixa="10,10,200,30">
  <label for="nif_novo">Número de contribuinte</label>
  <input id="nif_novo" name="nif_novo" data-caixa="10,50,200,30">
  <button id="pagar" type="submit" data-caixa="10,90,100,30">Pagar</button>
</form>`;

const [NOME, NIF, CORREIO] = ["José Manuel Ferreira", "500123456", "jose.ferreira@exemplo.ao"] as const;
const CONTEUDO = [NOME, NIF, CORREIO];

function escrever(br: ReturnType<typeof criarBrowser>, seletor: string, valor: string) {
  disparar(br.documento, seletor, "focus");
  const el = br.documento.querySelector(seletor) as any;
  for (const c of valor) {
    el.value += c;
    disparar(br.documento, seletor, "input", { inputType: "insertText", data: c });
  }
  disparar(br.documento, seletor, "blur");
}

function comConfig(br: ReturnType<typeof criarBrowser>, config: Record<string, unknown>) {
  br.responder((p) => p.url.includes("/v1/config")
    ? { estado: 200, corpo: JSON.stringify({ sucesso: true, dados: { amostragem: 1, nivel: "padrao", versao: 3, ...config } }) }
    : { estado: 202, corpo: JSON.stringify({ sucesso: true, dados: { aceites: 1 } }) });
}

test("18.1 um campo novo, que ninguém declarou, nasce mascarado: mede-se o comportamento e nada do que se escreveu", async () => {
  const br = criarBrowser(PAGINA, { caminho: "/pagamento" });
  comConfig(br, {});
  const uxda = iniciar({ chave: "uxda_des_teste", servidor: "https://ingest.local", ambiente: br.ambiente() });
  await br.avancar(10);
  escrever(br, "#nif_novo", NIF);
  escrever(br, "#nome", NOME);
  disparar(br.documento, "#f", "submit");
  await uxda.descarregar();
  await br.avancar(20000);

  const saiu = JSON.stringify(br.pedidos);
  for (const c of CONTEUDO) assert.ok(!saiu.includes(c), `saiu do dispositivo: ${c}`);
  // O rótulo do campo novo é texto da aplicação, e nem esse sai: sai o resumo.
  assert.ok(!saiu.includes("contribuinte"), "o rótulo do campo novo saiu em claro");
  const doCampo = br.eventos().filter((e) => String(e.element_key ?? "").includes("nif_novo") || String(e.element_key ?? "").includes("input"));
  assert.ok(doCampo.length > 0, "o campo novo não foi medido: mascarar não é deixar de medir");
  const campo = br.eventos().find((e) => e.event_type === "campo" && e.properties?.caracteres_escritos === NIF.length);
  assert.ok(campo, "o campo novo devia ter o comportamento (nove caracteres escritos), e não o conteúdo");
});

test("18.1 uma propriedade que o esquema não conhece não sai, e um valor de texto sai mascarado", async () => {
  const br = criarBrowser(PAGINA, { caminho: "/pagamento" });
  comConfig(br, {});
  const uxda = iniciar({ chave: "uxda_des_teste", servidor: "https://ingest.local", ambiente: br.ambiente() });
  await br.avancar(10);
  // Um programador da instituição, daqui a um ano, a depurar.
  uxda.track("comprovativo", { nota_interna: NOME, segmento: "Cliente José Manuel Ferreira", valor_monetario: 12400 });
  uxda.erroTecnico("resposta_ilegivel", { operacao: `pagamento de ${CORREIO}` });
  await uxda.descarregar();
  await br.avancar(20000);

  const saiu = JSON.stringify(br.pedidos);
  for (const c of CONTEUDO) assert.ok(!saiu.includes(c), `saiu do dispositivo: ${c}`);
  const ev = br.eventos().find((e) => e.message_key === "comprovativo");
  assert.ok(ev, "o evento perdeu-se: uma chave desconhecida não pode deitar fora a medição");
  assert.equal(ev.properties.valor_monetario, 12400);
  assert.equal(ev.properties.nota_interna, undefined);
  assert.match(ev.properties.segmento, /\{nome\}/);
  assert.deepEqual(uxda.diagnostico().propriedadesDescartadas, ["nota_interna"]);
});

test("18.1 só a lista de permissões da instituição levanta a máscara, e nunca o chão", async () => {
  const br = criarBrowser(PAGINA, { caminho: "/pagamento" });
  comConfig(br, { exposicao: { propriedades: ["segmento"], mensagens: [] } });
  const uxda = iniciar({ chave: "uxda_des_teste", servidor: "https://ingest.local", ambiente: br.ambiente() });
  await br.avancar(10);
  uxda.track("um", { segmento: "Empresas Grandes" });
  uxda.track("dois", { segmento: "conta 500123456" });
  uxda.track("tres", { canal: "Balcão Central" });
  await uxda.descarregar();
  await br.avancar(20000);
  const por = (k: string) => br.eventos().find((e) => e.message_key === k)?.properties ?? {};
  assert.equal(por("um").segmento, "Empresas Grandes", "exposta pela instituição, sai como está");
  assert.ok(!JSON.stringify(br.pedidos).includes("500123456"), "o chão levantou: um número saiu numa propriedade exposta");
  assert.match(por("tres").canal, /\{nome\}/, "uma propriedade não exposta saiu sem máscara");
});

test("18.1 com o consentimento exigido e por dar, o SDK não toca no dispositivo nem na rede", async () => {
  const loja = memoria();
  const escritas: string[] = [];
  const espia = { ...loja, setItem: (k: string, v: string) => { escritas.push(k); loja.setItem(k, v); } };
  const br = criarBrowser(PAGINA, { caminho: "/pagamento", loja: espia as any });
  comConfig(br, {});
  const uxda = iniciar({ chave: "uxda_des_teste", servidor: "https://ingest.local", consentimento: "exigido", ambiente: br.ambiente() });
  await br.avancar(10);
  escrever(br, "#nome", NOME);
  disparar(br.documento, "#pagar", "click");
  uxda.track("antes", { segmento: "x" });
  await uxda.descarregar();
  await br.avancar(30000);
  assert.equal(br.pedidos.length, 0, "houve pedidos sem consentimento");
  assert.deepEqual(escritas, [], "escreveu no dispositivo sem consentimento");
  assert.equal(uxda.diagnostico().consentimento, "pendente");
  assert.equal(uxda.diagnostico().eventosEmitidos, 0);

  // Dado: arranca, e só o que acontece daqui para a frente conta.
  uxda.consentimento(true);
  await br.avancar(10);
  disparar(br.documento, "#pagar", "click");
  await uxda.descarregar();
  await br.avancar(20000);
  assert.ok(br.eventos().length > 0, "depois do consentimento devia medir");
  assert.ok(!br.eventos().some((e) => e.message_key === "antes"), "um evento de antes do consentimento saiu");
  assert.equal(uxda.diagnostico().consentimento, "dado");

  // Retirado: para já, apaga a fila e os identificadores, e guarda só a recusa.
  const antes = br.pedidos.length;
  disparar(br.documento, "#pagar", "click"); // fica na fila, por enviar
  uxda.consentimento(false);
  disparar(br.documento, "#pagar", "click");
  uxda.track("depois", {});
  await uxda.descarregar();
  await br.avancar(60000);
  assert.equal(br.pedidos.length, antes, "saiu alguma coisa depois da recusa");
  for (const k of ["uxda.anon", "uxda.dispositivo", "uxda.sessao", "uxda.fila", "uxda.config"]) {
    assert.equal(loja.getItem(k), null, `ficou no dispositivo depois da recusa: ${k}`);
  }
  assert.equal(loja.getItem("uxda.consentimento"), "recusado");
  assert.equal(uxda.diagnostico().consentimento, "recusado");

  // E a página seguinte, mesmo sem exigir, não começa a medir antes de a aplicação voltar a dizer.
  const br2 = criarBrowser(PAGINA, { caminho: "/pagamento", loja });
  comConfig(br2, {});
  const outra = iniciar({ chave: "uxda_des_teste", servidor: "https://ingest.local", ambiente: br2.ambiente() });
  await br2.avancar(10);
  disparar(br2.documento, "#pagar", "click");
  await outra.descarregar();
  await br2.avancar(20000);
  assert.equal(br2.pedidos.length, 0, "a recusa guardada não valeu na página seguinte");
  assert.equal(outra.diagnostico().consentimento, "recusado");
});

test("18.1 o filtro das propriedades, em unidade", () => {
  const f = propriedadesDoCliente({ segmento: "Ana Maria da Silva", inventada: "x", experiencia: true, moeda: 7 }, []);
  assert.deepEqual(f.descartadas, ["inventada"]);
  assert.equal(f.propriedades.experiencia, true);
  assert.equal(f.propriedades.moeda, 7);
  assert.equal(f.propriedades.segmento, "{nome}");
  assert.deepEqual(propriedadesDoCliente(null, []).propriedades, {});
});

test("18.1 o chão vale também nos nomes que a aplicação dá: ecrã, passo, evento e mensagem", async () => {
  const br = criarBrowser(PAGINA, { caminho: "/conta/jose.ferreira@exemplo.ao/movimentos" });
  comConfig(br, {});
  const uxda = iniciar({ chave: "uxda_des_teste", servidor: "https://ingest.local", ambiente: br.ambiente() });
  await br.avancar(10);
  uxda.ecra(`detalhe_${NIF}`);
  uxda.passo(`confirmar_${CORREIO}`);
  uxda.track(`pagou_AO06000600000100037131174`);
  uxda.mensagem(`recusado_${NIF}`, "erro");
  uxda.ecra("Pagamento Cartão");
  await uxda.descarregar();
  await br.avancar(20000);
  const saiu = JSON.stringify(br.pedidos);
  for (const c of [NIF, CORREIO, "AO06000600000100037131174", "jose.ferreira"]) assert.ok(!saiu.includes(c), `saiu: ${c}`);
  assert.ok(br.eventos().some((e) => e.screen_key === "Pagamento Cartão"), "um nome de ecrã normal foi estragado");
  assert.ok(br.eventos().some((e) => String(e.screen_key).startsWith("/conta/{id}")), "o correio no caminho não foi mascarado");
});

test("18.6 o SDK só fala cifrado, e HTTP só para a própria máquina", async () => {
  assert.equal(transporteDe("https://ingest.uxda.io"), "cifrado");
  assert.equal(transporteDe("http://localhost:8710"), "local");
  assert.equal(transporteDe("http://127.0.0.1:8710"), "local");
  assert.equal(transporteDe("http://10.0.2.2:8710"), "local");
  assert.equal(transporteDe("http://[::1]:8710"), "local");
  assert.equal(transporteDe("http://ingest.uxda.io"), "recusado");
  assert.equal(transporteDe("http://192.168.0.180:8710"), "recusado");
  assert.equal(transporteDe("ftp://ingest.uxda.io"), "recusado");
  assert.equal(transporteDe("isto não é um endereço"), "recusado");

  // De ponta a ponta: com um endereço em claro, nem com consentimento sai um pedido,
  // nem se escreve no dispositivo.
  const loja = memoria();
  const escritas: string[] = [];
  const espia = { ...loja, setItem: (k: string, v: string) => { escritas.push(k); loja.setItem(k, v); } };
  const br = criarBrowser("<button id='b'>Pagar</button>", { loja: espia as any });
  const sdk = iniciar({ chave: "uxda_tes_x", servidor: "http://ingest.exemplo.ao", ambiente: br.ambiente() });
  sdk.consentimento(true);
  disparar(br.documento, "#b", "click");
  sdk.track("compra");
  await br.avancar(10_000);
  await sdk.descarregar();
  assert.equal(br.pedidos.length, 0, "saiu um pedido em claro");
  assert.equal(sdk.diagnostico().transporte, "recusado");
  assert.deepEqual(escritas, [], "o SDK escreveu no dispositivo sem poder enviar");

  const bom = iniciar({ chave: "uxda_tes_x", servidor: "https://ingest.exemplo.ao", ambiente: criarBrowser().ambiente() });
  assert.equal(bom.diagnostico().transporte, "cifrado");
  bom.parar();
});
