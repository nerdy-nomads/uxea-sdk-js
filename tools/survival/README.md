# Medidor de sobrevivência de identificadores

O protótipo do cartão `0.2`. Responde à pergunta de que depende o produto todo:
**consegue-se identificar um elemento de interface de forma estável entre versões,
sem cooperação do programador?**

```bash
npm run survival        # as duas medições
node --experimental-strip-types tools/survival/sweep.ts   # varredura do limiar
```

## Porquê duas medições, e não uma

**Pares reais**, do arquivo. Aplicações a sério, versões a sério, três anos de
distância. Não têm verdade conhecida: um elemento que não corresponde tanto pode ter
sido mal identificado como ter deixado de existir. Por isso reporta-se também a taxa
**entre os que ainda existem**, que é a que se aproxima do que interessa.

**Mutações controladas** sobre os mesmos DOM. Cada elemento leva uma marca
`data-gt` que o algoritmo nunca lê. A verdade é conhecida por construção, e dá
**precisão e cobertura a sério**, e não apenas uma taxa de correspondência.

Nenhuma das duas chega sozinha. A primeira é real e cega; a segunda vê tudo e é
artificial.

## O que se mede

| Mutação | O que simula |
|---|---|
| `estilo` | Alguém mudou o tema, e as classes passaram a outras |
| `involucro` | Alguém envolveu blocos em `div` novos para os alinhar |
| `reordenar` | Alguém trocou a ordem de dois blocos irmãos |
| `texto` | Alguém corrigiu um erro ortográfico ou reescreveu um rótulo |
| `atributos` | Alguém trocou a ferramenta de testes, ou o framework regenerou os ids |
| `tudo` | Tudo ao mesmo tempo: uma reescrita de interface |

O aleatório é determinístico: a mesma execução dá sempre o mesmo resultado.

## Os instantâneos

Vêm do arquivo, com o sufixo `id_` no caminho, que devolve a página **original**
sem a barra nem os scripts que o arquivo injeta. Sem isso mediríamos o HTML do
arquivo em vez do da aplicação.

Ficam em `cache/`, que não vai para o repositório: são 1,3 MB de derivados, e o
comando volta a descarregá-los. **A cache é o que torna a medição repetível
offline.**

## O resultado, a 2026-09-07

**Precisão 99,72%, cobertura 82,08%**, sobre 3426 elementos com verdade conhecida.
Nos pares reais, **91,1%** no `gov.uk` e **90,9%** no `stackoverflow` entre os
elementos que ainda existem.

Números, interpretação e o que eles mudaram na decisão: [ADR 0003](https://github.com/nerdy-nomads/ux-event-analytics/blob/master/docs/adr/0003-identificacao-estavel-de-elementos.md).

`resultado.json` guarda a última execução. `ensaio-gov-uk.png` é a captura da
execução num browser real, com uma moldura por elemento observado, colorida pelo
sinal que o identifica.
