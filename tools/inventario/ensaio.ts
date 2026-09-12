/**
 * Cartão 10.1: o ensaio que diz se o catálogo automático é legível.
 *
 * # A pergunta, e porque é que não se responde com dados sintéticos
 *
 * O risco do `RF-FUN-01` está escrito no próprio cartão: *"o inventário automático
 * produz milhares de entradas sem significado e torna-se inutilizável"*. Um
 * semeador não responde a isto, porque quem escreve o semeador escolhe quantos
 * elementos distintos existem, e a resposta sai combinada de véspera.
 *
 * Por isso este ensaio corre sobre **o DOM real de trinta e um ecrãs de uma
 * aplicação pública a sério**, o `gov.uk`, apanhados do arquivo para a medição ser
 * repetível. Ninguém aqui escolheu quantas ligações a página dos benefícios tem.
 *
 * # E corre a canalização toda, não só a regra
 *
 * Os elementos saem do `acionavel()` e do `sinais()` do próprio SDK, a chave é
 * serializada pelo `serializar()` do próprio SDK, os eventos entram pela ingestão
 * a sério (que resolve a identidade contra o que o projeto já conhece), e o
 * catálogo lê-se pela rota `/v1/inventario` a sério. Se alguma peça da cadeia
 * falhar, o número no fim está errado, que é exatamente o que se quer de uma
 * medição.
 *
 * As quatro contagens que saem daqui, e a razão de serem quatro:
 *
 *   1. **elementos acionáveis no DOM**, que é o que uma ferramenta ingénua teria
 *      de mostrar;
 *   2. **chaves canónicas** depois da reconciliação do servidor, que já junta o
 *      mesmo botão visto em vários ecrãs;
 *   3. **padrões** depois da regra do D-07, que é onde as vinte ligações de
 *      notícias viram uma entrada;
 *   4. **entradas acima do limiar**, que é o que uma pessoa vê ao abrir a página.
 *
 * Correr:
 *   node --experimental-strip-types tools/inventario/ensaio.ts <chave> [api] [ingestao]
 */
import { parseHTML } from "linkedom";
import { mkdirSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { acionavel, chave as chaveDoElemento, type ElementoLike } from "../../src/identity/element.ts";
import { serializar } from "../../src/identidade/elemento.ts";
import { chaveDeEcra } from "../../src/captura/captura.ts";

const AQUI = dirname(fileURLToPath(import.meta.url));
const CACHE = join(AQUI, "cache");
const SITIO = "https://www.gov.uk";
/** Um instante do arquivo, fixo: sem ele a medição de hoje não é a de amanhã. */
const QUANDO = "2026";

const [, , CHAVE = "", API = "http://localhost:8712", INGESTAO = "http://localhost:8710"] = process.argv;

const caminhos = readFileSync(join(AQUI, "urls.txt"), "utf8")
  .split("\n").map((l) => l.trim()).filter(Boolean);

/**
 * Vai buscar a página, e **por `curl` e não por `fetch`**.
 *
 * O `fetch` do Node tem um tempo de ligação de dez segundos que não se configura
 * sem trazer o `undici` para dependência do projeto, e o arquivo demora
 * regularmente mais do que isso a responder ao primeiro pedido de um instantâneo.
 * O sintoma era enganador: trinta e uma linhas a dizer "não veio do arquivo", com
 * o mesmo endereço a responder num `curl` ao lado.
 */
function obter(caminho: string): string | null {
  mkdirSync(CACHE, { recursive: true });
  const ficheiro = join(CACHE, caminho.replace(/[^a-z0-9]+/gi, "_") + ".html");
  if (existsSync(ficheiro)) return readFileSync(ficheiro, "utf8");
  const url = `https://web.archive.org/web/${QUANDO}id_/${SITIO}${caminho}`;
  const r = spawnSync("curl", [
    "-sL", "--compressed", "--max-time", "90", "-A", "uxda-inventario-ensaio/0.1 (cartao 10.1)", url,
  ], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  const html = r.stdout ?? "";
  if (r.status !== 0 || html.length < 2000) return null;
  writeFileSync(ficheiro, html);
  return html;
}

interface Observacao { ecra: string; chave: string }

const observacoes: Observacao[] = [];
const porEcra: Array<{ ecra: string; elementos: number }> = [];

console.log(`\n=== o DOM de ${caminhos.length} ecrãs reais de ${SITIO} ===\n`);
for (const caminho of caminhos) {
  const html = obter(caminho);
  if (!html) { console.log(`  ${caminho.padEnd(46)} (não veio do arquivo)`); continue; }
  const doc = parseHTML(html).document;
  const ecra = chaveDeEcra(caminho);
  let n = 0;
  for (const el of Array.from(doc.querySelectorAll("*")) as any[]) {
    if (!acionavel(el as ElementoLike)) continue;
    const c = chaveDoElemento(el as ElementoLike);
    if (!c.principal) continue;
    // **O ecrã vai colado à chave**, como o SDK faz: a identidade de um elemento é
    // do elemento mais o ecrã onde vive, senão o cabeçalho de trinta páginas
    // aparece como trinta elementos e o mesmo botão de dois ecrãs como um.
    observacoes.push({ ecra, chave: `${ecra}/${serializar(c)}` });
    n++;
  }
  porEcra.push({ ecra, elementos: n });
  console.log(`  ${caminho.padEnd(46)} ${String(n).padStart(5)} elementos acionáveis`);
}

const distintasNoDom = new Set(observacoes.map((o) => o.chave)).size;
console.log(`\n  ecrãs lidos:                 ${porEcra.length}`);
console.log(`  elementos acionáveis:        ${observacoes.length}`);
console.log(`  chaves distintas no DOM:     ${distintasNoDom}`);

if (!CHAVE) {
  console.log("\n  (sem chave de ingestão: fica pelo DOM. Passe a chave para correr a canalização toda)\n");
  process.exit(0);
}

/* ---------------------------------------------- a canalização a sério */

/**
 * Cada chave recebe utilização sintética, mas **a distribuição não é uniforme**:
 * numa aplicação a sério, meia dúzia de coisas leva quase todos os toques e a
 * cauda leva um cada. É essa forma que faz o limiar do catálogo ter trabalho a
 * fazer, e uma distribuição plana teria escondido que ele funciona.
 */
function quantasVezes(i: number, total: number): number {
  const p = i / Math.max(1, total - 1);
  if (p < 0.04) return 40 + Math.floor((1 - p) * 60);
  if (p < 0.2) return 8 + Math.floor((1 - p) * 12);
  return 1 + (i % 3);
}

const distintas = [...new Set(observacoes.map((o) => o.chave))];
const ecraDe = new Map(observacoes.map((o) => [o.chave, o.ecra]));
const agora = Date.now();
const eventos: any[] = [];
distintas.forEach((k, i) => {
  const vezes = quantasVezes(i, distintas.length);
  for (let v = 0; v < vezes; v++) {
    eventos.push({
      // **UUID, porque o esquema exige um.** A primeira corrida deste ensaio
      // mandou identificadores legíveis e a ingestão rejeitou os 26 713 eventos
      // com `motivos: {valor: ...}`; o catálogo respondeu zero entradas e o
      // relatório disse "zero" como se fosse um resultado.
      event_id: randomUUID(),
      anonymous_id: `ensaio-10-1-${(v % 120).toString().padStart(3, "0")}`,
      device_id: `d-ensaio-${v % 120}`, session_id: `s-ensaio-${v % 120}`,
      event_type: v % 5 === 0 ? "campo" : "toque",
      screen_key: ecraDe.get(k)!,
      element_key: k.slice(k.indexOf("/v1|") + 1),
      occurred_at: new Date(agora - (v % 20) * 3600_000).toISOString(),
      app_version: "gov-2026.1", platform: "web",
      identity_scope: "aplicacao", capture_level: "padrao",
      os_name: "Windows", os_version: "11",
      device_class: "computador", time_zone: "Europe/London",
    });
  }
});

console.log(`\n=== a canalização: ${eventos.length} eventos por ${INGESTAO} ===\n`);
/**
 * **Os contadores da ingestão leem-se, e não se deitam fora.**
 *
 * A ingestão responde 202 a um lote inteiramente rejeitado, e é o comportamento
 * certo: ela aceita o pedido e diz na resposta quantos eventos ficaram de fora e
 * porquê. Quem não lê essa resposta fica com um ensaio que envia vinte e seis mil
 * eventos, recebe 202 em todos os lotes, e depois reporta um catálogo de zero
 * entradas como se zero fosse a medição. Aconteceu, e a causa era um `event_id`
 * que não era um UUID.
 */
const conta = { recebidos: 0, aceites: 0, rejeitados: 0, duplicados: 0 };
const motivos: Record<string, number> = {};
for (let i = 0; i < eventos.length; i += 500) {
  const lote = eventos.slice(i, i + 500);
  const r = await fetch(`${INGESTAO}/v1/eventos`, {
    method: "POST",
    headers: { "content-type": "application/json", "X-UXDA-Key": CHAVE },
    body: JSON.stringify({
      versao_protocolo: 1, enviado_em: new Date().toISOString(),
      sdk: "ensaio-10-1", versao_sdk: "0.0.0", eventos: lote,
    }),
  });
  if (!r.ok) { console.error(`  a ingestão respondeu ${r.status}: ${(await r.text()).slice(0, 300)}`); process.exit(1); }
  const d = (await r.json())?.dados ?? {};
  conta.recebidos += d.recebidos ?? 0;
  conta.aceites += d.aceites ?? 0;
  conta.rejeitados += d.rejeitados ?? 0;
  conta.duplicados += d.duplicados ?? 0;
  for (const [k, v] of Object.entries(d.motivos ?? {})) motivos[k] = (motivos[k] ?? 0) + Number(v);
}
console.log(`  recebidos ${conta.recebidos}, aceites ${conta.aceites}, ` +
  `rejeitados ${conta.rejeitados}, duplicados ${conta.duplicados}`);
if (conta.rejeitados > 0) {
  console.error(`\n  A ingestão rejeitou ${conta.rejeitados} eventos: ${JSON.stringify(motivos)}`);
  console.error("  Um catálogo construído sobre eventos rejeitados não mede nada. A corrida pára aqui.\n");
  process.exit(1);
}

// A ingestão escreve em lote: dá-se-lhe tempo antes de perguntar pelo catálogo.
await new Promise((r) => setTimeout(r, 25_000));

async function catalogo(query: string): Promise<any> {
  const r = await fetch(`${API}/v1/inventario?${query}`, { headers: { "X-UXDA-Key": CHAVE } });
  const corpo = await r.json();
  if (!corpo?.sucesso) throw new Error(JSON.stringify(corpo).slice(0, 300));
  return corpo.dados;
}

const tudo = await catalogo("dias=2&limiar=-1&versao=gov-2026.1");
const visivel = await catalogo("dias=2&versao=gov-2026.1");

console.log(`\n=== o catálogo, pela rota a sério ===\n`);
const linha = (r: string, v: string | number) => console.log(`  ${r.padEnd(44)} ${String(v).padStart(6)}`);
linha("1. elementos acionáveis no DOM", observacoes.length);
linha("2. chaves canónicas, depois da reconciliação", tudo.chaves_brutas_observadas);
linha("3. padrões, depois da regra do D-07", tudo.padroes_observados);
linha(`4. entradas à vista, limiar ${visivel.limiar_de_utilizacao} utilizações`, visivel.entradas.length);
linha("   escondidas abaixo do limiar", visivel.entradas_ocultadas);
linha("   utilizadores ativos no período", visivel.utilizadores_ativos.total);
linha("   milissegundos da consulta", visivel.calculo_ms);

const juntou = tudo.entradas
  .map((e: any) => ({ rotulo: e.rotulo, brutas: e.chaves_brutas }))
  .filter((e: any) => e.brutas > 1)
  .sort((a: any, b: any) => b.brutas - a.brutas)
  .slice(0, 8);
if (juntou.length) {
  console.log(`\n  os padrões que mais chaves juntaram (a regra do D-07 a trabalhar):`);
  for (const j of juntou) console.log(`    ${String(j.brutas).padStart(4)} chaves  ->  ${j.rotulo}`);
}

console.log(`\n  as dez primeiras entradas, como quem abre a página as vê:`);
for (const e of visivel.entradas.slice(0, 10)) {
  console.log(`    ${String(e.utilizacoes.total).padStart(5)} usos  ${String(e.utilizacoes.utilizadores).padStart(4)} pessoas  ` +
    `${e.alcance.percentagem.toFixed(0).padStart(3)}%  ${e.rotulo.slice(0, 52)}`);
}

writeFileSync(join(AQUI, "resultado.json"), JSON.stringify({
  data: new Date().toISOString().slice(0, 10),
  ecras: porEcra.length, elementosAcionaveis: observacoes.length,
  chavesCanonicas: tudo.chaves_brutas_observadas, padroes: tudo.padroes_observados,
  entradasAVista: visivel.entradas.length, ocultadas: visivel.entradas_ocultadas,
  limiar: visivel.limiar_de_utilizacao, calculoMs: visivel.calculo_ms, porEcra,
}, null, 2) + "\n");
console.log(`\n  escrito em tools/inventario/resultado.json\n`);
