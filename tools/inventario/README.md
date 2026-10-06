# O ensaio dos trinta ecrãs

Responde à pergunta do cartão `10.1` e da decisão `D-07`: **quantas entradas é que o
catálogo automático produz sobre uma aplicação a sério?**

O risco está escrito no requisito `RF-FUN-01`: *o inventário automático produz
milhares de entradas sem significado e torna-se inutilizável*. Não é hipotético, e
este ensaio existe para medir se a mitigação chega.

## Porque é que não se responde com dados sintéticos

Porque quem escreve o semeador escolhe quantos elementos distintos existem, e a
resposta sai combinada de véspera. Aqui o corpo de dados é **o DOM real de trinta e
um ecrãs do `gov.uk`**, apanhados do arquivo para a medição ser repetível. Ninguém
escolheu quantas ligações a página dos benefícios tem.

## E corre a canalização toda, e não só a regra

- Os elementos saem do `acionavel()` e do `sinais()` **do próprio SDK**.
- A chave é serializada pelo `serializar()` **do próprio SDK**.
- Os eventos entram pela **ingestão a sério**, que resolve a identidade contra o que
  o projeto já conhece.
- O catálogo lê-se pela **rota `/v1/inventario` a sério**.

Se alguma peça da cadeia falhar, o número no fim está errado, que é exatamente o que
se quer de uma medição.

## Correr

```bash
# O DOM, só. Não precisa de nada de pé, e enche a cache na primeira corrida.
node --experimental-strip-types tools/inventario/ensaio.ts

# A canalização inteira, contra um projeto próprio (nunca o do semeador: os
# eventos deste ensaio entopem o catálogo de quem está a trabalhar no painel).
CHAVE=$( cd ../../backend/ingest && go run ./tools/semear -so-chave \
  -projeto 33333333-3333-3333-3333-333333333333 | grep -o 'uxea_des_[a-f0-9]*' )
node --experimental-strip-types tools/inventario/ensaio.ts "$CHAVE"
```

Os endereços dos ecrãs estão em `urls.txt`, um por linha, e a cache em `cache/`.
Apagar a cache faz o ensaio ir buscar tudo outra vez, e demora minutos.

## O resultado, a 2026-09-12

| Etapa | Entradas |
|---|---|
| Elementos acionáveis no DOM | **3 210** |
| Chaves canónicas, depois da reconciliação do servidor | **551** |
| Padrões, depois da regra do `D-07` | **522** |
| Entradas à vista, com o limiar de 10 utilizações | **158** |

Os padrões que mais juntaram: `/{id}` com 24 chaves, `/guidance/{id}` com 6.

**São centenas e não dezenas, e diz-se.** Um serviço público de trinta e um ecrãs
expõe mesmo umas quinhentas coisas acionáveis distintas, e esconder mais do que isto
seria esconder coisas reais. O que a regra garante é que não são milhares. A segunda
metade da legibilidade é o agrupamento de dois níveis do `RF-FUN-02`, que é outro
cartão e outra conversa.

O ficheiro `resultado.json` guarda os números da última corrida, com a contagem por
ecrã.

## Duas coisas que este ensaio aprendeu a fazer, à força

**Vai buscar as páginas por `curl` e não por `fetch`.** O `fetch` do Node tem um
tempo de ligação de dez segundos que não se configura sem trazer o `undici` para
dependência do projeto, e o arquivo demora regularmente mais do que isso. O sintoma
era trinta e uma linhas a dizer *"não veio do arquivo"*, com o mesmo endereço a
responder num `curl` ao lado.

**Lê os contadores da ingestão, e pára se algum evento for rejeitado.** A ingestão
responde `202` a um lote inteiramente rejeitado, e é o comportamento certo: aceita o
pedido e diz na resposta quantos ficaram de fora e porquê. Quem não lê essa resposta
fica com um ensaio que envia vinte e seis mil eventos, recebe `202` em todos os
lotes, e reporta um catálogo de **zero** entradas como se zero fosse a medição.
Aconteceu, e a causa era um `event_id` que não era um UUID.
