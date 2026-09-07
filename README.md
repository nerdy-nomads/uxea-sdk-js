# sdk-js

> Peça do workspace **[ux-data-analysis](https://github.com/nerdy-nomads/ux-data-analysis)**, onde vive como
> submódulo em `sdk/sdk-js`. O plano, o quadro e o documento de arquitetura estão lá.

O SDK web. Cola-se uma linha no `head` e começa a medir, **sem nenhuma configuração
obrigatória além da chave**.

**Estado.** Ainda não tem código. O que se segue é a especificação, e os cartões que
a constroem estão no fim.

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

## Estado: o protótipo de identidade já existe e está medido

O cartão `0.2` está feito. O que existe hoje neste repositório:

| Caminho | O que é |
|---|---|
| `src/identity/mask.ts` | Mascaramento e normalização de texto, e o resumo FNV-1a |
| `src/identity/element.ts` | Os cinco sinais de identidade |
| `src/identity/reconcile.ts` | Reconciliação entre versões, com recusa em caso de empate |
| `src/identity/index.ts` | O ponto de entrada público, atrás da barreira do `RNF-SDK-01` |
| `src/safe.ts` | A barreira de erro. Nenhum erro interno chega à aplicação anfitriã |
| `tools/survival/` | O medidor de sobrevivência. Ver o [README de lá](tools/survival/README.md) |

```bash
npm run check      # tipos e testes
npm test           # 24 testes, incluindo a bateria de fuga sobre DOM reais
npm run survival   # a medição do cartão 0.2
```

**Medido a 2026-09-07:** precisão 99,72% e cobertura 82,08% sobre 3426 elementos com
verdade conhecida; 91,1% no `gov.uk` entre os elementos que ainda existem depois de
três anos. Numa página real, num browser real: 130 elementos em 10 ms, zero erros
internos.

Falta o resto do SDK: a captura de eventos, a fila, o envio. São os cartões `2.x`.

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

**TypeScript**, sem dependências. Distribuído por CDN e por npm.

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
