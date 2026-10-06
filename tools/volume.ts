/**
 * Quanto é que cada nível de captura custa, medido e não estimado. Cartão 4.5,
 * RF-GRA-26 a RF-GRA-30, e a decisão D-10.
 *
 *   node --experimental-strip-types tools/volume.ts
 *
 * **É o número que decide se o produto é vendável.** O risco escrito no documento
 * é crítico: a captura granular multiplica o volume de eventos e torna o custo por
 * utilizador insustentável. A mitigação nomeada são os níveis e a agregação no
 * dispositivo, e isto mede se elas fazem o que prometem.
 *
 * A tarefa é sempre a mesma, e é a da loja de ensaio: chegar, preencher três
 * campos com uma correção pelo meio, falhar uma validação, insistir num botão que
 * não responde, mudar de ecrã e sair. Se a tarefa mudasse entre níveis, a
 * comparação media a tarefa e não o nível.
 */
import { iniciar } from "../src/index.ts";
import { criarBrowser, disparar } from "../src/ensaio/duplo.ts";

const PAGINA = `
  <div id="zona-morta">Precisa de ajuda?</div>
  <button id="pagar" data-testid="pagar">Pagar</button>
  <button id="lento" data-testid="lento">Lento</button>
  <form id="f">
    <input id="nome" name="nome" />
    <input id="cartao" name="cartao" />
    <input id="validade" name="validade" />
  </form>`;

type Nivel = "essencial" | "padrao" | "detalhado";

async function tarefa(nivel: Nivel) {
  const br = criarBrowser(PAGINA, { caminho: "/pagamento" });
  br.responder((p: any) => p.url.includes("/v1/config")
    ? { estado: 200, corpo: JSON.stringify({ dados: { amostragem: 1, nivel, captura: [], versao: 1 } }) }
    : { estado: 202, corpo: "{}" });
  const uxea = iniciar({ chave: "uxea_des_volume", servidor: "https://ingest.local", ambiente: br.ambiente() });
  await br.avancar(20);

  // Chega ao ecrã e olha para ele.
  await br.avancar(1500);

  // Preenche três campos, com uma correção pelo meio.
  for (const [i, id] of ["#nome", "#cartao", "#validade"].entries()) {
    disparar(br.documento, id, "focusin");
    await br.avancar(400 + i * 200);
    const el = br.documento.querySelector(id);
    el.value = "12345678";
    disparar(br.documento, id, "input", { inputType: "insertText" });
    if (i === 1) {
      el.value = "1234";
      disparar(br.documento, id, "input", { inputType: "deleteContentBackward" });
      el.value = "12345678";
      disparar(br.documento, id, "input", { inputType: "insertText" });
    }
    disparar(br.documento, id, "focusout");
  }

  // Uma validação que recusa, e a pessoa a insistir num botão que não responde.
  disparar(br.documento, "#cartao", "invalid");
  for (let i = 0; i < 3; i++) {
    disparar(br.documento, "#lento", "pointerdown", { clientX: 10, clientY: 10 });
    await br.avancar(250);
  }
  await br.avancar(1500);

  // Um toque onde não havia nada, a submissão, e a mudança de ecrã.
  disparar(br.documento, "#zona-morta", "pointerdown", { clientX: 40, clientY: 300 });
  disparar(br.documento, "#f", "submit");
  br.janela.history.pushState({}, "", "/pagamento/confirmar");
  await br.avancar(50);
  uxea.terminal("sucesso");

  await uxea.descarregar();
  await br.avancar(20000);

  const evs = br.eventos();
  const bytes = br.pedidos
    .filter((p: any) => p.url.includes("/v1/eventos"))
    .reduce((s: number, p: any) => s + p.corpo.length, 0);
  const porTipo = new Map<string, number>();
  for (const e of evs) porTipo.set(e.event_type, (porTipo.get(e.event_type) ?? 0) + 1);
  // As teclas que esta tarefa deu, contadas a partir do próprio agregado. É o
  // que permite dizer quanto custaria **sem** agregação, que é o número que
  // justifica o RF-GRA-29 em vez de o afirmar.
  const teclas = evs
    .filter((e: any) => e.event_type === "campo" && e.properties?.fase !== "submissao")
    .reduce((s: number, e: any) =>
      s + (e.properties?.caracteres_escritos ?? 0) + (e.properties?.caracteres_apagados ?? 0), 0);
  return { eventos: evs.length, bytes, porTipo, teclas };
}

const niveis: Nivel[] = ["essencial", "padrao", "detalhado"];
const medidas = [];
for (const n of niveis) medidas.push({ nivel: n, ...(await tarefa(n)) });

const padrao = medidas.find((m) => m.nivel === "padrao")!;

console.log("\nvolume por nível, na mesma tarefa da loja de ensaio\n");
console.log("  nível        eventos    bytes   bytes/evento   contra o padrão");
for (const m of medidas) {
  const razao = (m.eventos / padrao.eventos).toFixed(2);
  console.log(
    `  ${m.nivel.padEnd(11)}${String(m.eventos).padStart(7)}${String(m.bytes).padStart(9)}` +
    `${String(Math.round(m.bytes / Math.max(1, m.eventos))).padStart(15)}${(razao + "x").padStart(18)}`,
  );
}

console.log("\n  o que cada nível emite, por tipo\n");
const tipos = [...new Set(medidas.flatMap((m) => [...m.porTipo.keys()]))].sort();
console.log("  tipo".padEnd(26) + niveis.map((n) => n.padStart(11)).join(""));
for (const t of tipos) {
  console.log("  " + t.padEnd(24) + medidas.map((m) => String(m.porTipo.get(t) ?? 0).padStart(11)).join(""));
}

// O contrafactual, que é o que justifica a decisão: um evento por tecla, como o
// documento diz que não se faz. Cada agregado passaria a ser uma tecla de cada vez.
const semAgregacao = padrao.eventos - (padrao.porTipo.get("campo") ?? 0) + padrao.teclas;
console.log("\n  e sem agregação no dispositivo, um evento por tecla\n");
console.log(`  padrão com agregação      ${String(padrao.eventos).padStart(5)} eventos`);
console.log(`  o mesmo, um por tecla     ${String(semAgregacao).padStart(5)} eventos   ` +
  `${(semAgregacao / padrao.eventos).toFixed(1)}x`);
console.log(`  teclas nesta tarefa       ${String(padrao.teclas).padStart(5)}`);

// Uma pessoa que faça esta tarefa dez vezes por dia, trinta dias por mês.
console.log("\n  extrapolado: dez tarefas por dia, trinta dias\n");
for (const m of medidas) {
  const mes = m.bytes * 10 * 30;
  console.log(`  ${m.nivel.padEnd(11)}${String(m.eventos * 10 * 30).padStart(8)} eventos   ${(mes / 1024).toFixed(0).padStart(6)} KB por utilizador e por mês`);
}
console.log();
