/**
 * Os inquéritos embutidos, de ponta a ponta. Cartões 14.1 e 14.2, conjunto RF-PER.
 *
 * O caminho é o mesmo para os cinco gatilhos, e cada passo pode dizer que não:
 *
 *   gatilho → sorteio → fadiga local → servidor → atraso → componente → resposta
 *
 *  - o **gatilho** (`gatilhos.ts`) lê os eventos que o SDK capturou;
 *  - o **sorteio** é a `amostragem` da regra, 0,1 quando não vem, e é o único passo
 *    que o `uxda.inquerito()` salta: quem chama pelo código já decidiu que é agora;
 *  - a **fadiga local** (`fadiga.ts`) é a primeira linha, e poupa o servidor ao que
 *    o dispositivo já sabe;
 *  - o **servidor** é quem manda na fadiga a sério, e **sem resposta dele não se
 *    mostra**;
 *  - o **componente** (`componente.ts`) aparece passados `atraso_ms`, e nunca dois
 *    ao mesmo tempo, e nunca mais do que um por sessão.
 *
 * **Tudo isto corre dentro da barreira do RNF-SDK-01.** Uma avaria aqui (um DOM
 * que lança, uma configuração que passou a normalização com uma forma estranha, um
 * armazenamento negado) fica no registo interno, e a captura continua como se os
 * inquéritos não existissem. É o ensaio `inquerito.test.ts` que o prova, com uma
 * avaria provocada de propósito.
 */
import { protegido, protegidoAsync } from "../safe.ts";
import type { Armazenamento, ConfiguracaoDeInqueritos, Evento, Resposta } from "../core/tipos.ts";
import { lerEstado, gravarEstado } from "./estado.ts";
import { arranqueDaSessao, aoEvento, type Disparo } from "./gatilhos.ts";
import { fadigaLocal, anotarPedido, anotarResposta, podar } from "./fadiga.ts";
import { ateBytes, pedirElegibilidade, entregarResposta, type DadosDaResposta, type Entrega } from "./envio.ts";
import { desenharInquerito, podeDesenhar, haUmAVista, type Componente } from "./componente.ts";

export interface ContextoDeInqueritos {
  janela: any;
  documento: any;
  armazenamento: Armazenamento | null;
  agora(): number;
  aleatorio(): number;
  enviar(url: string, corpo: string, cabecalhos: Record<string, string>, sincrono: boolean, metodo?: string): Promise<Resposta>;
  servidor: string;
  chave: string;
  configuracao(): ConfiguracaoDeInqueritos;
  /** Lida a cada uso: quem se autentica a meio de um inquérito responde já com o pseudónimo. */
  identidade(): { anonimo: string; utilizador: string | null; sessao: string };
  /** O mesmo contexto que os eventos levam, e é o que segmenta as avaliações (RF-PER-12). */
  dispositivo(): Record<string, string>;
  ecra(): string;
}

/** O que o `diagnostico()` mostra. Nada do que alguém respondeu. */
export interface ResumoDeInqueritos {
  regras: number;
  /** O último gatilho que passou a porta, como `gatilho:chave`. */
  ultimoGatilho: string;
  /** O motivo do último "não" ou "sim": do servidor (`pode`, `limite_de_pedidos`...) ou local. */
  ultimoMotivo: string;
  aVista: boolean;
  respostasEnviadas: number;
}

export interface LigacaoDeInqueritos {
  /** A configuração chegou: corre os gatilhos de arranque de sessão. */
  arrancar(): void;
  /** Um evento que o SDK emitiu, já validado. */
  observar(ev: Evento): void;
  /** `uxda.inquerito(chave)`: salta o sorteio, e não salta a fadiga nem o servidor. */
  pedir(chave: string): Promise<boolean>;
  /** Grava já o que estiver por gravar. Para quando a página se esconde. */
  guardar(): void;
  resumo(): ResumoDeInqueritos;
  desligar(): void;
}

export function ligarInqueritos(ctx: ContextoDeInqueritos): LigacaoDeInqueritos {
  let ligado = true;
  let pronto = false;
  let emCurso = false;
  let componente: Componente | null = null;
  let passoAtual = "";
  const estado = lerEstado(ctx.armazenamento);
  // O servidor disse que o inquérito não existe: não se volta a perguntar nesta página.
  const inativos = new Set<string>();
  const resumo = { ultimoGatilho: "", ultimoMotivo: "", respostasEnviadas: 0 };

  /* --------------------------------------------------------- gravação */

  // Um início que corresponde a todos os eventos de um ecrã mexe no estado a cada
  // toque. Grava-se uma vez por lote de cem milissegundos, como a fila, e o fecho
  // da página força a escrita.
  let gravacao: any = null;
  const gravarJa = () => {
    if (gravacao !== null) {
      try { ctx.janela?.clearTimeout?.(gravacao); } catch { /* nada */ }
      gravacao = null;
    }
    gravarEstado(ctx.armazenamento, estado);
  };
  const gravarDepois = () => {
    if (gravacao !== null) return;
    if (typeof ctx.janela?.setTimeout !== "function") { gravarEstado(ctx.armazenamento, estado); return; }
    gravacao = ctx.janela.setTimeout(protegido("inquerito.gravar", () => {
      gravacao = null;
      gravarEstado(ctx.armazenamento, estado);
    }, undefined), 100);
  };

  /* ------------------------------------------------------------ esperas */

  const esperas = new Set<{ id: any; fim: () => void }>();
  const esperar = (ms: number) => new Promise<void>((resolve) => {
    if (!(ms > 0) || typeof ctx.janela?.setTimeout !== "function") { resolve(); return; }
    const espera = { id: null as any, fim: () => { esperas.delete(espera); resolve(); } };
    espera.id = ctx.janela.setTimeout(espera.fim, ms);
    esperas.add(espera);
  });

  /* ------------------------------------------------------------ mostrar */

  const mostrar = (d: Disparo, pedidoId: string) => {
    const cfg = ctx.configuracao();
    const contexto: Record<string, string> = {
      tarefa: d.regra.contexto.tarefa,
      // **Só o passo da regra**, que é a chave de um passo da definição da tarefa. O
      // passo em que o dispositivo ia é um nome do SDK (muitas vezes o ecrã), e não
      // uma chave da definição: mandá-lo partia as respostas de uma tarefa em
      // "passos" que a análise não conhece. Foi visto no ensaio do emulador, com
      // `passo: "/loja"` numa resposta sobre a tarefa inteira.
      passo: d.regra.contexto.passo.slice(0, 64),
      funcionalidade: d.regra.contexto.funcionalidade,
      gatilho: d.gatilho,
      ecra: ateBytes(d.ecra, 256),
    };
    if (d.tentativaInicio !== null) contexto["tentativa_inicio"] = new Date(d.tentativaInicio).toISOString();

    componente = desenharInquerito({
      janela: ctx.janela,
      documento: ctx.documento,
      regra: d.regra,
      tema: cfg.tema,
      agora: () => ctx.agora(),
      aoEnviar: async (r): Promise<Entrega> => {
        const id = ctx.identidade();
        const dados: DadosDaResposta = {
          inquerito: d.regra.chave,
          formato: d.regra.formato,
          pedidoId,
          contexto,
          dispositivo: ctx.dispositivo(),
          anonimo: id.anonimo,
          // O pseudónimo, e nunca um identificador direto: o `identificar` já o
          // resumiu antes de chegar aqui. E vai sempre: é o servidor que o deita
          // fora quando a associação está desligada, depois de o usar para a fadiga.
          utilizador: id.utilizador ?? "",
        };
        const entrega = await entregarResposta(ctx.enviar, ctx.servidor, ctx.chave, dados, r, () => ctx.agora(), esperar);
        if (entrega === "aceite") {
          anotarResposta(estado, ctx.agora());
          gravarJa();
          resumo.respostasEnviadas++;
        }
        resumo.ultimoMotivo = entrega === "aceite" ? "respondido" : `resposta_${entrega}`;
        return entrega;
      },
      aoFechar: () => { componente = null; },
    });
  };

  /* -------------------------------------------------------------- tentar */

  const tentar = protegidoAsync("inquerito.tentar", async (d: Disparo, forcado: boolean): Promise<boolean> => {
    if (!ligado || emCurso || componente || haUmAVista(ctx.documento)) return false;
    resumo.ultimoGatilho = `${d.gatilho}:${d.regra.chave}`;
    const nao = (motivo: string) => { resumo.ultimoMotivo = motivo; return false; };

    // O sorteio é por disparo, e não por pessoa. A amostragem determinística da
    // captura existe para uma tentativa não ficar com buracos; aqui não há
    // tentativa nenhuma a proteger, e um sorteio fixo por pessoa perguntava sempre
    // às mesmas dez em cada cem.
    if (!forcado && !(ctx.aleatorio() < d.regra.amostragem)) return nao("fora_da_amostra");

    const cfg = ctx.configuracao();
    const id = ctx.identidade();
    const agora = ctx.agora();
    podar(estado, cfg.fadiga, agora);
    const local = fadigaLocal(estado, cfg.fadiga, id.sessao, agora, inativos, d.regra.chave);
    if (local) return nao(local);
    // Sem árvore sombra não se desenha, e por isso não se pede licença: um pedido
    // que o servidor contasse e o dispositivo não mostrasse gastava a fadiga de
    // alguém para nada.
    if (!podeDesenhar(ctx.documento)) return nao("sem_arvore_sombra");

    emCurso = true;
    try {
      const e = await pedirElegibilidade(ctx.enviar, ctx.servidor, ctx.chave, {
        inquerito: d.regra.chave, anonymous_id: id.anonimo, user_id: id.utilizador ?? "",
      });
      if (!ligado) return false;
      if (!e) return nao("sem_resposta");
      resumo.ultimoMotivo = e.motivo || (e.mostrar ? "pode" : "recusado");
      if (!e.mostrar) {
        if (e.motivo === "inativo") inativos.add(d.regra.chave);
        // Estas duas valem para o projeto inteiro e para esta pessoa: não há
        // inquérito nenhum que o servidor vá deixar mostrar nesta sessão.
        if (e.motivo === "limite_de_pedidos" || e.motivo === "respondeu_recentemente") {
          estado.recusa = { sessao: id.sessao, motivo: e.motivo };
          gravarJa();
        }
        return false;
      }
      // O servidor já contou este pedido. O dispositivo conta-o também, **antes** do
      // atraso: uma página que fecha durante o atraso não pode deixar a sessão com
      // um pedido gasto e nenhum registo dele.
      anotarPedido(estado, id.sessao, ctx.agora());
      gravarJa();
      await esperar(d.regra.atrasoMs);
      if (!ligado || componente || haUmAVista(ctx.documento)) return false;
      mostrar(d, e.pedidoId);
      return componente !== null;
    } finally {
      emCurso = false;
    }
  }, false);

  /* ------------------------------------------------------------ a ligação */

  return {
    arrancar: protegido("inquerito.arrancar", () => {
      if (!ligado || pronto) return;
      pronto = true;
      const cfg = ctx.configuracao();
      // Sem inquéritos, o armazenamento nem se toca: um projeto que não pergunta
      // nada não ganha uma chave nova no `localStorage` de ninguém.
      if (cfg.lista.length === 0) return;
      const agora = ctx.agora();
      podar(estado, cfg.fadiga, agora);
      const { disparos, novaSessao } = arranqueDaSessao(estado, cfg.lista, ctx.identidade().sessao, agora, ctx.ecra());
      if (novaSessao) gravarJa();
      for (const d of disparos) void tentar(d, false);
    }, undefined),

    observar: protegido("inquerito.observar", (ev: Evento) => {
      if (!ligado || !pronto) return;
      if (ev.event_type === "passo") {
        const p = ev.properties?.["passo"];
        if (typeof p === "string") passoAtual = p.slice(0, 64);
      }
      const regras = ctx.configuracao().lista;
      if (regras.length === 0) return;
      const r = aoEvento(estado, regras, ctx.identidade().sessao, ev as Record<string, unknown>, ctx.agora(), passoAtual);
      if (r.mudou) gravarDepois();
      for (const d of r.disparos) void tentar(d, false);
    }, undefined),

    pedir: protegidoAsync("inquerito.pedir", async (chave: string): Promise<boolean> => {
      if (!ligado || !pronto) return false;
      const regra = ctx.configuracao().lista.find((r) => r.chave === chave);
      if (!regra) {
        resumo.ultimoMotivo = "inquerito_desconhecido";
        return false;
      }
      const sessao = ctx.identidade().sessao;
      const aberta = estado.abertas[regra.chave];
      return tentar({
        regra,
        gatilho: "manual",
        ecra: ctx.ecra(),
        passo: passoAtual,
        tentativaInicio: aberta && aberta.sessao === sessao ? aberta.inicio : null,
      }, true);
    }, false),

    guardar: protegido("inquerito.guardar", () => {
      if (gravacao !== null) gravarJa();
    }, undefined),

    resumo: () => ({
      regras: ctx.configuracao().lista.length,
      ultimoGatilho: resumo.ultimoGatilho,
      ultimoMotivo: resumo.ultimoMotivo,
      aVista: componente !== null,
      respostasEnviadas: resumo.respostasEnviadas,
    }),

    desligar: protegido("inquerito.desligar", () => {
      ligado = false;
      if (gravacao !== null) gravarJa();
      const c = componente;
      componente = null;
      c?.fechar();
      for (const e of Array.from(esperas)) {
        try { ctx.janela?.clearTimeout?.(e.id); } catch { /* nada */ }
        e.fim();
      }
    }, undefined),
  };
}
