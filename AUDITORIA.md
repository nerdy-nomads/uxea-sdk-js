# Auditar este SDK

Este SDK corre dentro da aplicação de quem o instala, e vê o que a pessoa faz.
**Quem o instala tem o direito de confirmar por si o que ele faz e o que não
faz**, sem acreditar em nós. Este ficheiro é o caminho mais curto para isso.

## O que se promete, e onde está escrito no código

| Promessa | Onde se verifica |
|---|---|
| Nenhum conteúdo escrito por uma pessoa sai do dispositivo (`RNF-PRI-01`) | `src/identity/fuga.test.ts`, `src/identity/mask.ts` |
| Um erro interno nunca chega à aplicação anfitriã (`RNF-SDK-01`) | `src/safe.ts`, `src/seguranca.test.ts` |
| Um identificador direto é resumido antes de sair (`RNF-PRI-02`) | `src/identidade/anonimo.ts`, função `pseudonimizar` |
| O acréscimo ao pacote fica abaixo de 300 KB (`RNF-SDK-02`) | `tools/orcamento.ts`, corre no CI |
| O trabalho sai do fio principal (`RNF-SDK-03`) | `src/core/trabalhador.ts` |
| Nada se perde sem rede (`RNF-SDK-05`) | `src/fila/`, ensaio dos dez minutos em `src/fila/fila.test.ts` |
| A aplicação não dá por uma falha da plataforma (`RNF-SDK-07`) | `src/fila/fila.ts`, e os ensaios de servidor em baixo |

## Correr a auditoria

```bash
npm ci
npm run check        # tipos, ensaios, empacotamento e os dois orçamentos
```

O que isto corre, por esta ordem: verificação de tipos; **85 ensaios**, dos quais
uma bateria de fuga sobre DOM reais de três aplicações públicas e uma bateria de
injeção de falhas que parte o SDK ponto de entrada a ponto de entrada; o
empacotamento; e os orçamentos de tamanho e de tempo no fio principal, que falham
a compilação quando forem ultrapassados.

## Ver com os próprios olhos, num browser

```bash
./scripts/dev.sh                                   # na raiz do workspace
cd sdk/sdk-js && npm run build
./exemplo/servir.sh <chave-de-ingestao> 8091
```

A aplicação de ensaio não tem uma única linha de instrumentação, e o painel do
lado direito mostra tudo o que o SDK sabe: a identidade, a fila, o custo no fio
principal e os erros internos. **O que sair do dispositivo vê-se no separador de
rede do browser**, pedido a pedido.

## O que inspecionar primeiro, se o tempo for pouco

1. **`src/identity/mask.ts`**, e a função `preparar`. É aqui que se decide o que
   se lê de um rótulo. Nada do que passa por aqui chega ao servidor sem ser
   resumido, e o resumo não é reversível.
2. **`src/captura/captura.ts`**, e a linha do `keydown`. Repare-se no que **não**
   está lá: `e.key` nunca é lido. Mede-se a hesitação, não o que foi escrito.
3. **`src/index.ts`**, função `emitirCru`. É o único sítio de onde nasce um
   evento, e vê-se ali o conjunto exato de campos que saem.
4. **`src/safe.ts`**. Todos os pontos de entrada passam por `protegido`. Um erro
   nosso fica registado por dentro e devolve um valor seguro.

## Reproduzir a fuga de propósito

A bateria de fuga tem um ensaio que introduz uma fuga a sério e exige que ela
seja apanhada. Para a ver a falhar como deve:

```bash
# em src/identity/element.ts, devolver o texto em vez do resumo no sinal do rótulo
npm test -- --test-name-pattern="fuga"
```

Se essa alteração passar nos ensaios, é um defeito nosso, e queremos saber.
