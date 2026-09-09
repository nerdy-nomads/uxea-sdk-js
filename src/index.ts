/**
 * O SDK web da plataforma UX Data Analysis.
 *
 *   <script src="https://cdn.uxda.io/uxda.js" data-chave="uxda_pro_..."></script>
 *
 * É esta linha, e mais nada. Sem declarar ecrãs, sem declarar tarefas, sem
 * declarar elementos: é o princípio de **capturar primeiro, definir depois**, e é
 * a promessa comercial inteira (RF-CAP-01).
 *
 * Tudo o que é público passa pela barreira do RNF-SDK-01, que não tem exceções:
 * um erro interno é apanhado, registado por dentro, e a aplicação anfitriã segue
 * como se nada fosse.
 */
import { protegido, protegidoAsync, errosInternos, limparErros } from "./safe.ts";
import { ambienteDoBrowser } from "./core/ambiente.ts";
import { criarTrabalhador, type Trabalhador } from "./core/trabalhador.ts";
import { uuid, naAmostra } from "./core/uuid.ts";
import { CONFIGURACAO_SEGURA, type Ambiente, type Configuracao, type Evento, type Opcoes } from "./core/tipos.ts";
import { Armazem } from "./fila/armazem.ts";
import { Fila, LIMITES, VERSAO, limitesPara } from "./fila/fila.ts";
import { identidade, guardarUtilizador, pseudonimizar, type Identidade } from "./identidade/anonimo.ts";
import { ligar as ligarCaptura, chaveDeEcra, type Ligacao, type Nucleo } from "./captura/captura.ts";
import { ligarRede } from "./captura/rede.ts";
import { capturaTipo, obter as obterConfig } from "./config/remoto.ts";
import { validar } from "./event/validar.ts";

export const SERVIDOR_POR_OMISSAO = "https://ingest.uxda.io";

/** Marcador para a validação local: o valor a sério é escrito pela ingestão. */
const SEM_PROJETO = "00000000-0000-0000-0000-000000000000";

export interface Diagnostico {
  versao: string;
  ambiente: string;
  amostrado: boolean;
  configuracao: Configuracao;
  origemDaConfiguracao: string;
  identidade: Identidade;
  fila: ReturnType<Fila["estado"]>;
  eventosEmitidos: number;
  eventosRecusados: number;
  msNoFioPrincipal: number;
  foraDoFioPrincipal: boolean;
  errosInternos: number;
}

export interface Uxda {
  /** Marcação manual, para o que a captura automática não alcança (RF-CAP-08). */
  track(nome: string, extras?: Record<string, unknown>): void;
  /** Liga o anónimo ao pseudónimo depois da autenticação (RF-CAP-11). */
  identificar(idPseudonimizado: string): Promise<void>;
  /** Termina a ligação: os eventos seguintes voltam a ser anónimos. */
  esquecer(): void;
  /** Declara um ecrã, quando a aplicação não muda o URL ao mudar de vista. */
  ecra(nome: string): void;
  /**
   * Declara uma transição de passo dentro da tarefa (RF-GRA-20).
   *
   * Uma mudança de ecrã já conta como passo sozinha. Isto é para os fluxos que
   * acontecem no mesmo ecrã, que são a maioria dos assistentes por etapas.
   */
  passo(nome: string): void;
  /**
   * Fecha a tentativa, sem ambiguidade (RF-GRA-23).
   *
   * O `abandonado` sai sozinho quando a página morre com trabalho a meio, e o
   * `expirado` é normalmente do motor, que é quem conhece o limiar da tarefa.
   * Sem isto, o abandono e a conclusão misturam-se e todas as taxas ficam erradas.
   */
  terminal(estado: "sucesso" | "erro" | "abandonado" | "expirado"): void;
  /** Força o envio do que está na fila. */
  descarregar(): Promise<void>;
  /** Desliga tudo, sem deixar ouvintes atrás. */
  parar(): void;
  diagnostico(): Diagnostico;
}

/** Do prefixo da chave sai o ambiente: `uxda_pro_...` é produção. */
export function ambienteDaChave(chave: string): string {
  const p = chave.slice(5, 8);
  if (p === "pro") return "producao";
  if (p === "tes") return "testes";
  return "desenvolvimento";
}

interface Estado {
  ligado: boolean;
  emitidos: number;
  recusados: number;
  msFio: number;
}

export function iniciar(op: Opcoes): Uxda {
  const amb: Ambiente = { ...ambienteDoBrowser(op.ambiente?.janela ?? (globalThis as any).window), ...(op.ambiente ?? {}) } as Ambiente;
  const janela = amb.janela;
  const documento = amb.documento;
  const servidor = (op.servidor ?? SERVIDOR_POR_OMISSAO).replace(/\/$/, "");
  const ambienteNome = ambienteDaChave(op.chave);
  const est: Estado = { ligado: true, emitidos: 0, recusados: 0, msFio: 0 };

  const ident = identidade(amb.armazenamento, amb.agora());
  let config: Configuracao = CONFIGURACAO_SEGURA;
  let origemConfig = "omissao";
  let amostrado = true;
  /**
   * Quem está na amostra do detalhado sobe de nível, e **está sempre**.
   *
   * A amostragem é determinística, por resumo do identificador anónimo, e não
   * aleatória por sessão: com aleatória, a mesma pessoa entra e sai da amostra e
   * as tentativas dela ficam com buracos, e uma tentativa com buracos deixa de
   * significar o que quer que seja (ADR 0010).
   */
  let noDetalhe = false;
  const nivelEfetivo = (): "essencial" | "padrao" | "detalhado" =>
    noDetalhe && config.nivel !== "essencial" ? "detalhado" : config.nivel;

  // A escrita da fila sai do caminho do evento: junta-se em memória e grava-se
  // uma vez por lote de cem milissegundos. O fecho da página força a escrita.
  const armazem = new Armazem(amb.armazenamento, "uxda.fila",
    typeof janela?.setTimeout === "function" ? (fn) => janela.setTimeout(fn, 100) : null);
  const trabalhador: Trabalhador | null = criarTrabalhador(janela);
  // O envio sai do fio principal quando o browser deixa (RNF-SDK-03). O
  // `sendBeacon` do fecho fica no fio principal de propósito: é a única forma de
  // o browser prometer entregar o que resta quando a página desaparece.
  const enviar = async (url: string, corpo: string, cab: Record<string, string>, sincrono: boolean) => {
    if (!sincrono && trabalhador?.ativo) return trabalhador.enviar(url, corpo, cab);
    return amb.enviar(url, corpo, cab, sincrono);
  };
  const fila = new Fila(
    armazem,
    { ...amb, enviar },
    `${servidor}/v1/eventos`,
    () => ({ "X-UXDA-Key": op.chave }),
    limitesPara(janela?.navigator?.connection),
  );

  const versaoApp = op.versao
    ?? documento?.querySelector?.('meta[name="uxda:version"]')?.getAttribute?.("content")
    ?? "0.0.0";

  const ecraDe = (): string => chaveDeEcra(janela?.location?.pathname ?? "/", janela?.location?.hash ?? "");
  let ecraForcado = "";

  const emitirCru = (tipo: string, extras: Record<string, unknown> = {}): void => {
    if (!est.ligado || !amostrado) return;
    const t0 = typeof janela?.performance?.now === "function" ? janela.performance.now() : 0;
    if (!capturaTipo(config, tipo)) return;
    const ev: Evento = {
      event_id: uuid(),
      // O projeto e a organização vêm da chave, do lado do servidor: o cliente
      // não os conhece, e se os conhecesse podia escrever no projeto de outro.
      anonymous_id: ident.anonimo,
      device_id: ident.dispositivo,
      session_id: ident.sessao,
      event_type: tipo,
      screen_key: (extras["screen_key"] as string) || ecraForcado || ecraDe(),
      occurred_at: new Date(amb.agora()).toISOString(),
      app_version: String(versaoApp),
      platform: "web",
      identity_scope: "aplicacao",
      capture_level: nivelEfetivo(),
    };
    if (ident.utilizador) ev.user_id = ident.utilizador;
    for (const [k, v] of Object.entries(extras)) {
      if (k === "screen_key" || v === undefined) continue;
      ev[k] = v;
    }
    // Validar aqui, e não só no servidor: um evento que a ingestão vai recusar é
    // tráfego gasto e uma linha na fila de rejeitados de quem integra. O que não
    // passa fica no diagnóstico, para se ver porquê sem abrir a rede.
    //
    // O projeto e a organização entram só para a validação: **o dispositivo não
    // os conhece**, e quem os escreve é a ingestão, a partir da chave. Enviá-los
    // daqui seria dar ao cliente a possibilidade de escrever no projeto de outro.
    const erros = validar({ ...ev, project_id: SEM_PROJETO, organization_id: SEM_PROJETO } as unknown as Record<string, unknown>);
    if (erros.length > 0) {
      est.recusados++;
      return;
    }
    est.emitidos++;
    fila.juntar(ev);
    if (t0) est.msFio += janela.performance.now() - t0;
  };

  // Pedidos da aplicação anfitriã em voo. É o que deixa dizer que um toque foi
  // dado **enquanto o sistema estava ocupado** (RF-GRA-05), que é uma coisa
  // diferente de um toque que não deu nada.
  let emVoo = 0;

  const nucleo: Nucleo = {
    emitir: protegido("captura.emitir", emitirCru, undefined),
    agora: () => amb.agora(),
    ecra: () => ecraForcado || ecraDe(),
    // O nível vem da configuração remota, e por isso é lido a cada evento e não
    // guardado: uma descida de nível a meio da sessão tem de fazer efeito já.
    nivel: () => nivelEfetivo(),
    emVoo: () => emVoo,
  };

  let ligacao: Ligacao | null = null;
  let ligacaoRede: { desligar(): void } | null = null;
  const desligarCiclo: Array<() => void> = [];

  const arrancar = protegidoAsync("uxda.arrancar", async () => {
    const r = await obterConfig(amb, servidor, op.chave);
    config = r.config;
    origemConfig = r.origem;
    // A amostragem decide **por utilizador**, e com a mesma função que o
    // servidor usa: o mesmo utilizador está sempre dentro ou sempre fora, e uma
    // tentativa nunca fica com metade dos passos.
    amostrado = naAmostra(ident.anonimo, config.amostragem);
    if (!amostrado) return;
    // Sementes diferentes: quem está na amostra de ser medido não tem de ser a
    // mesma gente que está na amostra do detalhe.
    noDetalhe = naAmostra("detalhado:" + ident.anonimo, config.amostragemDetalhado);
    if (op.automatico !== false) {
      ligacao = ligarCaptura(janela, documento, nucleo);
      ligacaoRede = ligarRede(janela, nucleo, servidor, {
        inicio: () => { emVoo++; },
        fim: (ms) => {
          emVoo = Math.max(0, emVoo - 1);
          // Abaixo de meio segundo ninguém espera por nada, e emitir um evento
          // por cada pedido rápido era trocar o volume que o 4.5 poupou.
          if (ms >= 500) ligacao?.espera(ms);
        },
      });
    }
    // Primeiro ecrã: o que a pessoa viu ao chegar.
    nucleo.emitir("ecra", {});
    // O fim da página é o momento em que mais se perde: é aqui que estão o
    // abandono e a desistência, e é a última oportunidade de os entregar.
    // **A ordem é o que faz o evento chegar.** O `plano_fundo` entra na fila
    // primeiro, e só depois é que ela é despejada: ao contrário, o despejo levava
    // o que já lá estava e o evento que fecha a tentativa ficava para trás,
    // precisamente numa página que está a morrer e não vai ter outra
    // oportunidade. Foi visto num browser a sério, e não aparecia em ensaio
    // nenhum porque o duplo não propagava os eventos do documento até à janela.
    const aoEsconder = () => {
      if (documento?.visibilityState === "hidden") {
        ligacao?.esconder();
        void fila.fechar();
      } else {
        ligacao?.mostrar();
      }
    };
    const aoSair = () => { ligacao?.esconder(); void fila.fechar(); };
    janela?.addEventListener?.("visibilitychange", aoEsconder, true);
    janela?.addEventListener?.("pagehide", aoSair, true);
    desligarCiclo.push(() => janela?.removeEventListener?.("visibilitychange", aoEsconder, true));
    desligarCiclo.push(() => janela?.removeEventListener?.("pagehide", aoSair, true));
    // O que ficou de sessões anteriores sai agora: eventos guardados enquanto
    // não havia rede não esperam por um evento novo para serem entregues.
    await fila.descarregar();
  }, undefined);

  void arrancar();

  const api: Uxda = {
    track: protegido("uxda.track", (nome: string, extras: Record<string, unknown> = {}) => {
      // A marcação manual é a exceção, e é para o que o browser não deixa ver.
      // Vai como evento personalizado, com a chave do que o integrador marcou.
      emitirCru("personalizado", { ...extras, message_key: String(nome).slice(0, 256) });
    }, undefined),

    identificar: protegidoAsync("uxda.identificar", async (idPseudonimizado: string) => {
      const { id } = await pseudonimizar(idPseudonimizado);
      if (!id) return;
      ident.utilizador = id;
      guardarUtilizador(amb.armazenamento, id);
      // A ligação retroativa é do lado do servidor: é lá que estão os eventos já
      // entregues sob o identificador anónimo. Falhar aqui não pode partir o
      // início de sessão da aplicação, por isso o resultado é ignorado.
      try {
        await amb.enviar(`${servidor}/v1/identidade/ligar`,
          JSON.stringify({ anonymous_id: ident.anonimo, user_id: id }),
          { "X-UXDA-Key": op.chave, "Content-Type": "application/json" }, false);
      } catch { /* a ligação repete-se no próximo início de sessão */ }
    }, undefined),

    esquecer: protegido("uxda.esquecer", () => {
      ident.utilizador = null;
      guardarUtilizador(amb.armazenamento, null);
    }, undefined),

    ecra: protegido("uxda.ecra", (nome: string) => {
      ecraForcado = String(nome).slice(0, 256);
      emitirCru("ecra", { screen_key: ecraForcado });
    }, undefined),

    passo: protegido("uxda.passo", (nome: string) => {
      ligacao?.passo(String(nome).slice(0, 64));
    }, undefined),

    terminal: protegido("uxda.terminal", (estado: "sucesso" | "erro" | "abandonado" | "expirado") => {
      ligacao?.terminal(estado);
    }, undefined),

    descarregar: protegidoAsync("uxda.descarregar", async () => { await fila.descarregar(); }, undefined),

    parar: protegido("uxda.parar", () => {
      est.ligado = false;
      ligacao?.desligar();
      ligacaoRede?.desligar();
      for (const d of desligarCiclo.splice(0)) d();
      trabalhador?.terminar();
    }, undefined),

    diagnostico: protegido("uxda.diagnostico", (): Diagnostico => ({
      versao: VERSAO,
      ambiente: ambienteNome,
      amostrado,
      configuracao: config,
      origemDaConfiguracao: origemConfig,
      identidade: { ...ident },
      fila: fila.estado(),
      eventosEmitidos: est.emitidos,
      eventosRecusados: est.recusados,
      msNoFioPrincipal: Math.round(est.msFio * 100) / 100,
      foraDoFioPrincipal: !!trabalhador?.ativo,
      errosInternos: errosInternos().length,
    }), {
      versao: VERSAO, ambiente: ambienteNome, amostrado: false, configuracao: CONFIGURACAO_SEGURA,
      origemDaConfiguracao: "erro", identidade: ident, fila: fila.estado(), eventosEmitidos: 0,
      eventosRecusados: 0, msNoFioPrincipal: 0, foraDoFioPrincipal: false, errosInternos: 0,
    }),
  };

  return api;
}

/**
 * Arranque automático a partir da etiqueta `<script>`. É o que faz a integração
 * ser uma linha: sem isto, quem cola o script tem ainda de escrever a chamada.
 */
export function arranqueAutomatico(janela: any = (globalThis as any).window): Uxda | null {
  try {
    const doc = janela?.document;
    const el = doc?.currentScript ?? doc?.querySelector?.("script[data-chave]");
    const chave = el?.getAttribute?.("data-chave");
    if (!chave) return null;
    const uxda = iniciar({
      chave,
      servidor: el.getAttribute("data-servidor") ?? undefined,
      versao: el.getAttribute("data-versao") ?? undefined,
      automatico: el.getAttribute("data-automatico") !== "false",
    });
    janela.uxda = uxda;
    return uxda;
  } catch {
    return null;
  }
}

export { errosInternos, limparErros, LIMITES, VERSAO };
export type { Opcoes, Evento, Configuracao };
