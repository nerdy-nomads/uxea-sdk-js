/**
 * A prova de que este SDK **nunca fotografa o ecrã**. Cartão 9.2, RF-IND-04,
 * RNF-PRI-01.
 *
 * # Porque é que isto é um ensaio e não um comentário
 *
 * O mapa de calor do cartão 9.2 desenha-se sobre um esquema reconstruído a partir
 * das caixas dos elementos observados, e a razão escrita em todo o lado é que
 * gravar o ecrã implicaria capturar conteúdo. Essa frase aparece em cinco ficheiros
 * do produto, e até hoje nenhum deles a verificava.
 *
 * **O risco é real e é de uma linha.** As APIs que fotografam um ecrã na web são
 * poucas e são conhecidas: `canvas.toDataURL`, `getDisplayMedia`, `captureStream`,
 * `html2canvas`. Qualquer uma delas cabe numa linha de captura escrita com boa
 * intenção, e o SDK passava a levar pixéis de um ecrã com dados de clientes lá
 * dentro sem ninguém dar por isso, porque nenhum teste de comportamento mudaria.
 *
 * # E é uma proibição e não uma heurística
 *
 * Percorre o código-fonte todo e falha se encontrar qualquer uma delas. Não há
 * caso legítimo: a identidade de um elemento são cinco sinais (cartão 2.3), a
 * posição é uma percentagem (cartão 9.1), e nenhum dos dois precisa de uma imagem.
 *
 * É a irmã do `fuga.test.ts`, que prova que nenhum conteúdo de campo sai daqui.
 * Aquele olha para o tráfego; este olha para o que o código sabe fazer.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * As formas de tirar uma fotografia a um ecrã num browser.
 *
 * Cada entrada diz **porque é que está aqui**, senão a lista envelhece e ninguém
 * sabe se pode tirar uma linha dela.
 */
const PROIBIDO: Array<{ padrao: RegExp; porque: string }> = [
  { padrao: /\btoDataURL\b/, porque: "serializa um canvas para imagem" },
  { padrao: /\btoBlob\b/, porque: "serializa um canvas para imagem" },
  { padrao: /\bgetImageData\b/, porque: "lê os pixéis de um canvas" },
  { padrao: /\bdrawImage\b/, porque: "copia pixéis para um canvas" },
  { padrao: /\bgetDisplayMedia\b/, porque: "grava o ecrã" },
  { padrao: /\bcaptureStream\b/, porque: "grava um elemento como vídeo" },
  { padrao: /\bhtml2canvas\b/, porque: "é uma biblioteca de captura de ecrã" },
  { padrao: /\bdom-to-image\b/, porque: "é uma biblioteca de captura de ecrã" },
  { padrao: /\bcreateImageBitmap\b/, porque: "constrói uma imagem a partir do ecrã" },
  { padrao: /\bXMLSerializer\b/, porque: "serializa a árvore do documento inteira, conteúdo incluído" },
  { padrao: /\.outerHTML\b/, porque: "leva o conteúdo do elemento consigo" },
  { padrao: /\.innerHTML\b/, porque: "leva o conteúdo do elemento consigo" },
];

/**
 * O que a guarda percorre: **o código que é publicado**, e não os ensaios.
 *
 * Os ensaios montam um documento falso para ter alguma coisa contra que correr, e
 * montá-lo é escrever `innerHTML`. Isso não é um caminho de captura: é a montagem
 * do próprio ensaio, e vive em ficheiros que o `tools/construir.ts` nunca inclui
 * no pacote.
 *
 * **A regra é a extensão e não uma lista de nomes.** Uma lista de exceções que
 * cresce acaba a cobrir o ficheiro onde o defeito está; uma regra que diz
 * "ficheiros de ensaio não são publicados" não cresce.
 */
function ehEnsaio(nome: string): boolean {
  return nome.endsWith(".test.ts");
}

function ficheiros(raiz: string): string[] {
  const achados: string[] = [];
  for (const entrada of readdirSync(raiz)) {
    const caminho = join(raiz, entrada);
    if (statSync(caminho).isDirectory()) {
      achados.push(...ficheiros(caminho));
      continue;
    }
    if (entrada.endsWith(".ts") && !ehEnsaio(entrada)) achados.push(caminho);
  }
  return achados;
}

test("nenhum ficheiro do SDK sabe fotografar um ecrã", () => {
  const lista = ficheiros(new URL("../src", import.meta.url).pathname);
  assert.ok(lista.length > 15, `só ${lista.length} ficheiros percorridos: o ensaio não está a ver o código`);

  const faltas: string[] = [];
  for (const caminho of lista) {
    const fonte = readFileSync(caminho, "utf8");
    for (const { padrao, porque } of PROIBIDO) {
      // O comentário também conta. **É de propósito**: a frase "não usamos
      // `toDataURL`" num comentário é indistinguível de uma chamada para quem lê
      // isto rapidamente, e escrever a proibição sem a palavra proibida custa uma
      // reescrita e vale a pena.
      if (padrao.test(fonte)) {
        faltas.push(`${caminho.split("/sdk-js/")[1]}: ${padrao.source} (${porque})`);
      }
    }
  }
  assert.deepEqual(faltas, [],
    "o SDK ganhou um caminho de captura de ecrã:\n  " + faltas.join("\n  "));
});

test("a posição de um toque é uma percentagem, e não um pixel", () => {
  // A outra metade da mesma promessa: o que sai do dispositivo sobre *onde* a
  // pessoa tocou é uma percentagem do visor, e por isso não reconstitui um ecrã
  // nem um modelo de aparelho. O ensaio olha para o código da captura de toques,
  // que é o único sítio onde isto se decide.
  const fonte = readFileSync(new URL("../src/captura/toques.ts", import.meta.url).pathname, "utf8");
  assert.ok(/porCento|percent/i.test(fonte),
    "a captura de toques deixou de converter para percentagem");
  assert.ok(!/clientX\s*\)/.test(fonte.replace(/porCento\([^)]*clientX[^)]*\)/g, "")),
    "uma coordenada em pixéis saiu sem passar pela conversão para percentagem");
});
