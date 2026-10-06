/**
 * O que a captura não vê. Cartão 14.1.
 *
 * **O SDK não se mede a si próprio.** O componente de avaliação é desenhado dentro
 * da página da instituição, e sem isto um toque na escala saía como `toque_sem_alvo`
 * numa zona do ecrã, a primeira tecla no comentário saía como `primeira_interacao`,
 * e o campo de comentário entrava no agregado por campo com a hesitação e os
 * caracteres apagados de quem estava a responder. Tudo isto é ruído nas métricas
 * da aplicação anfitriã, e o último é pior do que ruído: é medir **como** alguém
 * escreveu uma opinião sobre a própria aplicação.
 *
 * A marca é um atributo no hospedeiro, `data-uxea-ignorar`, e a pergunta é
 * "este elemento, ou algum acima dele, tem a marca?".
 *
 * # Porque é que chega olhar para o alvo do evento
 *
 * O componente vive numa **árvore sombra** (`attachShadow`). Um evento que nasce lá
 * dentro e sobe até ao documento chega aos ouvintes da captura **com o alvo
 * trocado pelo hospedeiro**: é o redirecionamento de alvo do DOM, e é igual para as
 * árvores abertas e fechadas. O mesmo acontece ao `elementFromPoint`, que devolve o
 * hospedeiro e não o botão debaixo do dedo. Por isso o `closest` sobre o alvo
 * encontra sempre a marca, e é uma chamada nativa só.
 *
 * E quando a pergunta vem de dentro da árvore (um nó que a observação de
 * mutações apanhe num browser que as deixe atravessar), sobe-se pela raiz até ao
 * hospedeiro, e a resposta é a mesma.
 */
export const ATRIBUTO_FORA = "data-uxea-ignorar";
const SELETOR = `[${ATRIBUTO_FORA}]`;

export function foraDaCaptura(el: any): boolean {
  try {
    let no = el;
    for (let i = 0; i < 4 && no; i++) {
      if (typeof no.closest === "function" && no.closest(SELETOR)) return true;
      const raiz = typeof no.getRootNode === "function" ? no.getRootNode() : null;
      // Só uma raiz de árvore sombra tem hospedeiro. O documento não tem, e o ciclo pára.
      no = raiz && raiz !== no && raiz.host ? raiz.host : null;
    }
  } catch { /* um elemento que lança não é nosso */ }
  return false;
}

/** O mesmo, a partir de um evento do DOM. */
export function eventoForaDaCaptura(e: any): boolean {
  return foraDaCaptura(e?.target);
}
