/**
 * Configuração remota. RF-CAP-09, RF-CAP-10 e decisão D-10.
 *
 * O que isto resolve: uma emergência de volume, às três da tarde, com o cliente
 * a queimar a quota do plano. Sem configuração remota, a resposta é *"publique
 * uma versão nova"*, e isso são semanas numa loja de aplicações. Com ela, são
 * dois minutos e a sessão seguinte já vem amostrada.
 *
 * Três regras que se notam ao ler:
 *
 *  - **O valor por omissão mede tudo.** Uma configuração que não chega não pode
 *    deixar o cliente sem dados: a degradação é decisão de quem opera, e nunca
 *    um acidente de rede.
 *  - **A cache é a resposta anterior.** Um arranque sem rede usa o que já sabia,
 *    e não o que estava no código no dia da publicação.
 *  - **A amostragem é determinística.** O mesmo utilizador está sempre dentro ou
 *    sempre fora, senão uma tentativa fica com metade dos passos.
 */
import type { Ambiente, Armazenamento, Configuracao } from "../core/tipos.ts";
import { CONFIGURACAO_SEGURA } from "../core/tipos.ts";
import { normalizarInqueritos } from "../inquerito/configuracao.ts";

const CHAVE_CACHE = "uxda.config";
/** Seis horas: uma emergência resolve-se na sessão seguinte, não daqui a um dia. */
export const VALIDADE_MS = 6 * 60 * 60 * 1000;

/**
 * O que fica guardado é **a resposta do servidor tal como chegou**, e não a
 * configuração já lida.
 *
 * # O defeito que isto corrigiu
 *
 * Guardava-se a configuração normalizada, com os nomes do SDK
 * (`amostragemDetalhado`, `mensagensExpostas`, `rastreioIndividual`), e ao reler
 * voltava a passar pelo `normalizar`, que lê os nomes do fio (`amostragem_detalhado`,
 * `mensagens_expostas`, `rastreio_individual`). Os três voltavam ao valor por
 * omissão num arranque sem rede, sem erro nenhum, e a cache deixava de ser "a
 * resposta anterior" em tudo o que não fosse a amostragem e o nível. Apareceu ao
 * acrescentar os inquéritos (cartão 14.1), que se perdiam da mesma maneira.
 *
 * Uma cache antiga, com a forma de antes, continua a ler-se: dá o que dava.
 */
interface Guardada {
  config: unknown;
  quando: number;
}

export function daCache(loja: Armazenamento | null, agora: number): Configuracao | null {
  try {
    const bruto = loja?.getItem(CHAVE_CACHE);
    if (!bruto) return null;
    const g = JSON.parse(bruto) as Guardada;
    if (!g?.config || typeof g.quando !== "number") return null;
    if (agora - g.quando > VALIDADE_MS * 4) return null; // muito velha, ignora-se
    return normalizar(g.config);
  } catch {
    return null;
  }
}

export function normalizar(c: any): Configuracao {
  const amostragem = typeof c?.amostragem === "number" && c.amostragem >= 0 && c.amostragem <= 1
    ? c.amostragem : CONFIGURACAO_SEGURA.amostragem;
  const nivel = c?.nivel === "essencial" || c?.nivel === "detalhado" ? c.nivel : "padrao";
  const captura = Array.isArray(c?.captura) ? c.captura.filter((x: unknown) => typeof x === "string") : [];
  const versao = typeof c?.versao === "number" ? c.versao : 0;
  const amostragemDetalhado = Math.min(1, Math.max(0,
    typeof c?.amostragem_detalhado === "number" ? c.amostragem_detalhado : 0));
  // A lista de permissões do RNF-PRI-04. **Vazia por omissão**, e é isso que
  // "mascaramento por omissão" quer dizer: uma configuração que não chega, ou que
  // chega estragada, deixa tudo mascarado, e nunca o contrário.
  // A lista de permissões do cartão 18.1 (`exposicao`) cobre as mensagens e as
  // propriedades, e a lista antiga das mensagens continua a ler-se: as duas somam.
  const lista = (v: unknown): string[] => Array.isArray(v)
    ? v.filter((x: unknown): x is string => typeof x === "string" && x !== "").slice(0, 200)
    : [];
  const mensagensExpostas = [...new Set([...lista(c?.mensagens_expostas), ...lista(c?.exposicao?.mensagens)])].slice(0, 200);
  const propriedadesExpostas = lista(c?.exposicao?.propriedades);
  // **Só `true` liga.** Qualquer outra coisa (ausente, nulo, a cadeia "true", um
  // número) deixa desligado: uma configuração meio escrita não pode ligar o
  // rastreio individual, e é a mesma regra da lista de mensagens expostas.
  const rastreioIndividual = c?.rastreio_individual === true;
  // Os inquéritos do RF-PER. Qualquer coisa estragada dá **nenhum**, e nunca o
  // contrário: ver `inquerito/configuracao.ts`.
  let inqueritos = CONFIGURACAO_SEGURA.inqueritos;
  try {
    inqueritos = normalizarInqueritos(c?.inqueritos);
  } catch { /* uma configuração hostil fica sem inquéritos, e a captura segue */ }
  return {
    amostragem, nivel, captura, versao, amostragemDetalhado,
    rastreioIndividual, mensagensExpostas, propriedadesExpostas, inqueritos,
  };
}

/**
 * Vai buscar a configuração. Nunca lança e nunca demora: se o servidor não
 * responder, devolve a cache, e se não houver cache devolve o valor seguro.
 */
export async function obter(amb: Ambiente, servidor: string, chave: string): Promise<{ config: Configuracao; origem: "servidor" | "cache" | "omissao" }> {
  const loja = amb.armazenamento;
  const cache = daCache(loja, amb.agora());
  try {
    // GET, e não POST: a configuração é uma leitura, e assim a resposta pode ser
    // guardada pela cache do browser e pelo CDN à frente da ingestão.
    const r = await amb.enviar(`${servidor}/v1/config`, "", { "X-UXDA-Key": chave }, false, "GET");
    if (r.estado >= 200 && r.estado < 300 && r.corpo) {
      const corpo = JSON.parse(r.corpo);
      const dados = corpo?.dados ?? corpo;
      const config = normalizar(dados);
      try {
        loja?.setItem(CHAVE_CACHE, JSON.stringify({ config: dados, quando: amb.agora() } satisfies Guardada));
      } catch { /* sem cache, segue na mesma */ }
      return { config, origem: "servidor" };
    }
  } catch { /* rede em baixo: cai para a cache */ }
  if (cache) return { config: cache, origem: "cache" };
  return { config: CONFIGURACAO_SEGURA, origem: "omissao" };
}

/**
 * O que cada nível deixa passar. ADR 0010, RF-GRA-26.
 *
 * A lista é explícita e não uma regra: um nível que se define por exclusão passa
 * a deixar entrar, sozinho, tudo o que alguém acrescentar ao SDK daqui a um ano, e
 * o volume cresce sem ninguém ter decidido nada.
 *
 * O `padrao` é o que quase toda a gente vai ter. Repare-se no que está lá e no que
 * não está: está o **agregado por campo**, e não estão a tecla nem o desfoco. É o
 * RF-GRA-29 inteiro, e é o que decide se o produto é vendável.
 */
const ESSENCIAL = [
  "ecra", "toque", "submissao", "erro", "erro_rede", "mensagem", "terminal",
];

const PADRAO = [
  ...ESSENCIAL,
  "foco", "campo",
  "toque_sem_alvo", "toque_desativado", "toque_repetido", "toque_em_carregamento",
  "primeira_interacao", "passo", "espera", "ambiente",
  "plano_fundo", "recuo", "personalizado",
];

export function tiposDoNivel(nivel: Configuracao["nivel"]): string[] {
  if (nivel === "essencial") return ESSENCIAL;
  if (nivel === "padrao") return PADRAO;
  // O detalhado é o padrão mais a sequência completa: tecla, desfoco e as
  // coordenadas dos toques. Lista vazia quer dizer "tudo o que o SDK produzir".
  return [];
}

/** Decide se um tipo de evento é para capturar com esta configuração. */
export function capturaTipo(c: Configuracao, tipo: string): boolean {
  if (c.captura.length > 0) return c.captura.includes(tipo);
  const doNivel = tiposDoNivel(c.nivel);
  return doNivel.length === 0 || doNivel.includes(tipo);
}
