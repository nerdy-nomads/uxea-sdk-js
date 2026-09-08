# sdk-js

> Peça do workspace **[ux-data-analysis](https://github.com/nerdy-nomads/ux-data-analysis)**, onde vive como
> submódulo em `sdk/sdk-js`. O plano, o quadro e o documento de arquitetura estão lá.

O SDK web. Cola-se uma linha no `head` e começa a medir, **sem nenhuma configuração
obrigatória além da chave**.

## A promessa que ele carrega

Do registo ao primeiro evento em **menos de dez minutos**. É o primeiro critério de
sucesso da Fase 1, e o que mais depressa mata a adoção quando falha.

Um SDK que exija declarar ecrãs, tarefas ou elementos antes de mostrar seja o que for
anula o princípio de **capturar primeiro e definir depois**, que é o produto.

## O que capta sozinho

Visualização de ecrã, toque ou clique, foco em campo, primeira tecla, desfoco,
submissão, erro de validação, navegação para trás, mudança para segundo plano e erro
de rede. Mais as mensagens que a aplicação mostra, e o preenchimento agregado por
campo.

**Nada disto é declarado pelo integrador.** A marcação manual existe para o que o
browser não deixa ver, e é a exceção: se se tornar a regra, o produto perdeu a
promessa, e vale a pena saber cedo.

## O que nunca faz

- **Não tem dependências.** Nenhuma, e não é preferência: o acréscimo ao tamanho da
  aplicação tem de ficar **abaixo de 300 KB** (`RNF-SDK-03`), e esse orçamento não
  sobrevive a uma árvore de dependências. Sem dependências, a auditoria também fica
  simples, e a auditoria é condição de adoção.
- **Não é React, e nada do React ou do Next.js lhe entra.** Corre dentro da aplicação
  de outra pessoa, que pode ter outra versão do React ou não ter React nenhum.
- **Não regista um único caractere escrito pelo utilizador.** Conta quantos foram
  escritos e quantos apagados, e isso não exige conhecer nenhum.
- **Não faz a aplicação anfitriã falhar.** Barreira de erro em todos os pontos de
  entrada, com injeção sistemática de falhas no CI.
- **Não trabalha no fio principal.**
- **Não emite um evento por tecla.** Um por campo, no desfoco.
- **Não envia nada sem mascarar** números, montantes, datas e identificadores dentro
  do texto capturado.

## Estado: existe, corre num browser a sério, e está medido

Os cartões `2.1` a `2.7` estão fechados. A integração é isto, e mais nada:

```html
<script src="https://cdn.uxda.io/uxda.js" data-chave="uxda_pro_..."></script>
```

| Caminho | O que é |
|---|---|
| `src/index.ts` | A API pública: arranque, `track`, `identificar`, `ecra`, `parar`, `diagnostico` |
| `src/captura/` | Os dez tipos do `RF-CAP-04`, mais o erro de rede da aplicação anfitriã |
| `src/fila/` | Fila persistente, lote, recuo exponencial e respeito por rede medida |
| `src/identidade/` | Identificadores do dispositivo, pseudonimização e a cadeia de sinais |
| `src/config/` | Configuração remota, com cache e valor por omissão que mede tudo |
| `src/core/trabalhador.ts` | O envio fora do fio principal, e o recuo para quando não dá |
| `src/identity/` | Os cinco sinais de identidade de elementos, do cartão `0.2` |
| `src/safe.ts` | A barreira de erro. Nenhum erro interno chega à aplicação anfitriã |
| `exemplo/` | Uma loja de ensaio **sem uma linha de instrumentação**, para ver a correr |
| `tools/orcamento.ts` | Os dois orçamentos, que falham a compilação no CI |

```bash
npm run check      # tipos, 86 ensaios, empacotamento e os dois orçamentos
npm run build      # dist/uxda.js (CDN, arranca sozinho) e dist/uxda.mjs (npm)
./exemplo/servir.sh <chave> 8091     # a loja de ensaio, num browser a sério
```

### Os números, medidos e não estimados

| O quê | Medido | Limite |
|---|---|---|
| Tamanho do pacote | **27,4 KB** (10,4 KB comprimido) | 300 KB (`RNF-SDK-02`) |
| Fio principal, por evento capturado | **0,031 ms** no computador, **0,236 ms** num telemóvel de um núcleo | 1 ms |
| Tráfego | **524 bytes** por evento entregue | - |
| Ensaios | 85, incluindo fuga de conteúdo e injeção de falhas | - |

O ensaio no telemóvel é um emulador Android com **um núcleo** e 1 GB de memória.
A bateria não se mede lá (o medidor do emulador é sintético, e responde
`Computed drain: 0`), por isso o custo aparece como tempo de CPU, que é o que a
gasta: sobre 2000 eventos, a diferença de CPU do processo do browser com e sem o
SDK ficou **dentro do ruído da medição**, cerca de 2 centésimos de segundo.

![A loja de ensaio, com o diagnóstico do SDK ao lado](exemplo/ensaio-loja.png)

### Quatro coisas que só apareceram por correr isto num browser a sério

**Os ouvintes estavam fora da barreira de erro.** A barreira protegia o que se
emitia, e não o ouvinte que chamava o emissor: um elemento que lançasse ao ser
interrogado mandava a exceção para o despacho de eventos da aplicação anfitriã, e
ela passava a ter avarias nossas com a cara dela. Foi a bateria de injeção de
falhas do `2.7` a apanhar.

**Guardar a fila custava o quadrado do tamanho dela.** Cada evento serializava a
fila inteira para saber se ainda cabia. Com a contagem à medida e a escrita
adiada para o fim do lote, o custo no fio principal caiu de 0,78 ms para 0,031 ms
por evento: **vinte e cinco vezes**.

**As rotas em `#` não mudavam o ecrã.** Metade das aplicações de página única
navega assim, e todas elas apareciam como um ecrã só durante a sessão inteira.

**A reescrita retroativa da identidade tinha uma corrida.** Os eventos que iam a
caminho no momento em que a pessoa se autentica chegavam depois da reescrita e
ficavam sem pseudónimo para sempre. Fechou-se na ingestão, que preenche o dono
quando já o conhece.

## A API pública

Cinco funções, e nenhuma é obrigatória para o SDK medir. Todas passam pela
barreira do `RNF-SDK-01`: um erro interno devolve um valor seguro e nunca chega à
aplicação anfitriã.

| Chamada | Para quê |
|---|---|
| `uxda.track(nome, extras?)` | Marcação manual, para o que o browser não deixa ver (`RF-CAP-08`). É a **exceção**: se se tornar a regra, o produto perdeu a promessa |
| `uxda.identificar(id)` | Liga o anónimo ao pseudónimo depois da autenticação. **O que parecer um identificador direto é resumido aqui**, e o original não sai do dispositivo |
| `uxda.esquecer()` | Termina a ligação: os eventos seguintes voltam a ser anónimos |
| `uxda.ecra(nome)` | Declara um ecrã, para aplicações que mudam de vista sem mudar o URL |
| `uxda.descarregar()` | Força o envio do que está na fila |
| `uxda.parar()` | Desliga tudo, sem deixar ouvintes atrás |
| `uxda.diagnostico()` | O que o SDK sabe: identidade, fila, configuração, custo no fio principal e erros internos |

```html
<!-- O que é obrigatório: a chave. -->
<script src="https://cdn.uxda.io/uxda.js" data-chave="uxda_pro_..."></script>

<!-- O que é opcional, e para que serve. -->
<script src="https://cdn.uxda.io/uxda.js"
        data-chave="uxda_pro_..."
        data-servidor="https://ingest.uxda.io"
        data-versao="4.2.0"
        data-automatico="false"></script>
```

Por npm, para quem quer decidir o momento do arranque:

```js
import { iniciar } from "@uxda/sdk-js";
const uxda = iniciar({ chave: "uxda_pro_...", versao: "4.2.0" });
```

## Como identifica um elemento

Cadeia de **cinco** sinais com reserva, calculada no dispositivo: atributo explícito
de teste, caminho estrutural estável, rótulo normalizado em resumo, **destino da
ligação normalizado**, e papel mais posição no contentor.

O quinto entrou depois da medição do `0.2`, e não estava no desenho: sem ele, uma
barra de navegação dava 40,9% de elementos ambíguos. Com ele, 2,2%.

**A identidade é o tuplo dos cinco sinais, e não o principal sozinho**, que colide em
41% dos elementos de uma página real. O servidor reconcilia por maioria quando o principal muda entre
versões.

**Quando não reconcilia, o elemento aparece como novo, nunca como outro.** Um
histórico partido é mau; um histórico silenciosamente errado é pior, porque quem o lê
acredita nele.

## Stack

**TypeScript**, sem dependências de execução. Empacotado com `esbuild` e
distribuído por CDN e por npm. A auditoria está em [`AUDITORIA.md`](AUDITORIA.md).

## Os cartões que o constroem

| Cartão | O que acrescenta |
|---|---|
| `2.1` | Fundação numa linha, sem configuração |
| `2.2` | Captura automática dos eventos base e marcação manual |
| `2.3` | Identificação estável de elementos |
| `2.4` | Fila local, envio em lote, funcionamento sem ligação |
| `2.5` | Identidade pseudonimizada e continuidade entre dispositivos |
| `2.6` | Configuração remota e amostragem sem nova publicação |
| `2.7` | As garantias: nunca falhar a anfitriã, 300 KB, fora do fio principal |
| `4.1` a `4.5` | Captura granular e agregação no dispositivo |
| `5.1` a `5.4` | Mensagens de sistema, mascaramento, testes de fuga |
| `14.1` | Componente de avaliação embutido |
| `18.1`, `18.2` | Mascaramento por omissão e testes de fuga alargados |

## Ler antes de mexer

A secção 5.1 do documento de requisitos, e as decisões **D-03** e **D-10** em
[`docs/arquitetura.html`](https://github.com/nerdy-nomads/ux-data-analysis/blob/master/docs/arquitetura.html).
