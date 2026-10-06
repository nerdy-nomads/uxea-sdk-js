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
import { contextoDe } from "./captura/contexto.ts";
import { ligarRede } from "./captura/rede.ts";
import { capturaTipo, obter as obterConfig } from "./config/remoto.ts";
import { validar } from "./event/validar.ts";
import { ligarInqueritos, type ResumoDeInqueritos } from "./inquerito/index.ts";
import { apagarOQueGuardamos, CHAVE_RECUSA, propriedadesDoCliente, textoDoCliente } from "./privacidade.ts";
import { chao } from "./identity/mask.ts";

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
  /** Quantas regras de inquérito, o último gatilho e o último motivo. Nada do que foi respondido. */
  inqueritos: ResumoDeInqueritos;
  /**
   * O estado do consentimento (cartão 18.1): `implicito` (a instituição não o
   * exige), `pendente` (exige, e ainda não veio: nada corre), `dado` ou `recusado`.
   */
  consentimento: "implicito" | "pendente" | "dado" | "recusado";
  /** Os nomes das propriedades que a instituição passou e o esquema não conhece, e que por isso não saíram. */
  propriedadesDescartadas: string[];
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
  /**
   * Declara uma mensagem apresentada ao utilizador (RF-MSG-01, RF-MSG-02).
   *
   * A captura automática apanha o que está no DOM com `role="alert"`, com
   * `aria-live` ou com as classes do costume. Isto é para o resto: uma mensagem
   * desenhada em canvas, uma notificação do sistema, ou uma aplicação que prefere
   * declarar a chave em vez de deixar adivinhar pelo texto. **A chave ganha sempre
   * ao texto**: é estável, é independente do idioma e não arrasta dados nenhuns.
   */
  mensagem(chave: string, tipo: "erro" | "aviso" | "sucesso" | "info", extras?: Record<string, unknown>): void;
  /**
   * Declara um erro que **ninguém viu no ecrã** (RF-MSG-06).
   *
   * As falhas de rede e as respostas de erro do servidor já saem sozinhas. Isto é
   * para o que a aplicação apanha e engole: uma promessa rejeitada, uma resposta
   * ilegível, um passo que falhou em silêncio. São eles que explicam o abandono
   * que não tem explicação nenhuma no ecrã.
   */
  erroTecnico(chave: string, propriedades?: Record<string, unknown>): void;
  /**
   * Pede um inquérito pela chave, a partir do código da instituição (RF-PER-04).
   *
   * **Salta o sorteio, e não salta mais nada.** A fadiga do dispositivo, a pergunta
   * ao servidor, o atraso da regra e o limite de um por sessão valem na mesma: quem
   * chama pelo código decide o momento, e não decide quantas vezes a mesma pessoa é
   * questionada. Devolve `true` quando o componente apareceu.
   */
  inquerito(chave: string): Promise<boolean>;
  /** Força o envio do que está na fila. */
  descarregar(): Promise<void>;
  /** Desliga tudo, sem deixar ouvintes atrás. */
  parar(): void;
  /**
   * O sinal de consentimento da pessoa, transmitido pela aplicação (cartão 18.1,
   * `RNF-PRI-12`). `true` arranca a captura, se a integração a exigir e ainda não
   * tiver arrancado. `false` para tudo **já**, apaga a fila e os identificadores
   * deste dispositivo, e guarda só a recusa, para a página seguinte não começar a
   * medir antes de a aplicação voltar a dizer. Não há configuração que o contorne.
   */
  consentimento(dado: boolean): void;
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

function iniciarCaptura(op: Opcoes, consentimento: () => Diagnostico["consentimento"]): Uxda {
  const amb: Ambiente = { ...ambienteDoBrowser(op.ambiente?.janela ?? (globalThis as any).window), ...(op.ambiente ?? {}) } as Ambiente;
  const janela = amb.janela;
  const documento = amb.documento;
  const servidor = (op.servidor ?? SERVIDOR_POR_OMISSAO).replace(/\/$/, "");
  const ambienteNome = ambienteDaChave(op.chave);
  const est: Estado = { ligado: true, emitidos: 0, recusados: 0, msFio: 0 };

  const ident = identidade(amb.armazenamento, amb.agora());
  const descartadas = new Set<string>();
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

  // O contexto do dispositivo lê-se **uma vez**, e não a cada evento: nada nele muda
  // dentro de uma sessão, e ler o agente e o `Intl` vinte vezes por segundo era
  // pagar um custo por um valor constante.
  const ctx = contextoDe(janela);

  const versaoApp = op.versao
    ?? documento?.querySelector?.('meta[name="uxda:version"]')?.getAttribute?.("content")
    ?? "0.0.0";

  const ecraDe = (): string => chaveDeEcra(janela?.location?.pathname ?? "/", janela?.location?.hash ?? "");
  let ecraForcado = "";

  // Os inquéritos do RF-PER (cartões 14.1 e 14.2). Ligam-se já, e só começam a
  // disparar quando a configuração chega: antes dela não há regra nenhuma.
  //
  // **O envio vai direto pelo ambiente, e não pelo trabalhador**: a elegibilidade
  // precisa de ler a resposta, e uma resposta a um inquérito é um pedido por
  // pessoa, e não um lote que valha a pena tirar do fio principal.
  const inqueritos = ligarInqueritos({
    janela,
    documento,
    armazenamento: amb.armazenamento,
    agora: () => amb.agora(),
    aleatorio: typeof amb.aleatorio === "function" ? () => amb.aleatorio!() : Math.random,
    enviar: (url, corpo, cab, sincrono, metodo) => amb.enviar(url, corpo, cab, sincrono, metodo),
    servidor,
    chave: op.chave,
    configuracao: () => config.inqueritos,
    identidade: () => ({ anonimo: ident.anonimo, utilizador: ident.utilizador, sessao: ident.sessao }),
    dispositivo: () => {
      const d: Record<string, string> = { platform: "web", app_version: String(versaoApp) };
      for (const [k, v] of Object.entries(ctx)) if (typeof v === "string" && v) d[k] = v;
      return d;
    },
    ecra: () => ecraForcado || ecraDe(),
  });

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
      ...ctx,
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
    // Os gatilhos dos inquéritos leem **o evento que saiu**, e não o que se tentou
    // emitir: um evento que o nível corta ou que a validação recusa não existe para
    // o servidor, e um inquérito que ele disparasse ficava ligado a nada. Dentro da
    // medição do fio principal, porque é custo do SDK como outro qualquer.
    inqueritos.observar(ev);
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
    individual: () => config.rastreioIndividual,
    emVoo: () => emVoo,
    // RNF-PRI-04: mascaramento por omissão, e exposição só por lista explícita.
    // A lista vem da configuração remota, e por isso é decisão da instituição e
    // não de quem escreveu a aplicação.
    mensagemExposta: (chave: string) => config.mensagensExpostas.includes(chave),
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
    // Os gatilhos de arranque de sessão (o abandono da sessão anterior e a
    // amostragem) correm **antes** do primeiro evento desta: o primeiro ecrã pode
    // corresponder ao início da mesma tarefa, e reabri-la antes de ler a anterior
    // apagava o abandono que se queria perguntar.
    //
    // E só para quem está na amostra de medição. Um inquérito vale pelo cruzamento
    // com o comportamento medido (RF-PER-13, RF-PER-15), e sobre quem não é medido
    // não há tentativa a que o ligar nem evento que o dispare.
    inqueritos.arrancar();
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
    //
    // **Pela captura quando ela existe**, e não com um `emitir` direto: é ela que
    // diz ao deslocamento que um ecrã começou, e sem isso o primeiro ecrã de cada
    // sessão nunca media profundidade nenhuma (cartão 9.1). Sem captura
    // automática, o evento sai na mesma: quem desliga o `automatico` continua a
    // ter o ecrã de chegada.
    if (ligacao) ligacao.ecraInicial();
    else nucleo.emitir("ecra", {});
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
        inqueritos.guardar();
      } else {
        ligacao?.mostrar();
      }
    };
    const aoSair = () => { ligacao?.esconder(); void fila.fechar(); inqueritos.guardar(); };
    janela?.addEventListener?.("visibilitychange", aoEsconder, true);
    janela?.addEventListener?.("pagehide", aoSair, true);
    desligarCiclo.push(() => janela?.removeEventListener?.("visibilitychange", aoEsconder, true));
    desligarCiclo.push(() => janela?.removeEventListener?.("pagehide", aoSair, true));
    // O que ficou de sessões anteriores sai agora: eventos guardados enquanto
    // não havia rede não esperam por um evento novo para serem entregues.
    await fila.descarregar();
  }, undefined);

  // Guardado, para o `inquerito()` poder esperar pela configuração: uma
  // instituição que pede um inquérito logo no carregamento da página não pode
  // receber um `false` só por ter chegado antes da resposta do servidor.
  const pronto = arrancar();

  const api: Uxda = {
    track: protegido("uxda.track", (nome: string, extras: Record<string, unknown> = {}) => {
      // A marcação manual é a exceção, e é para o que o browser não deixa ver.
      // Vai como evento personalizado, com a chave do que o integrador marcou.
      //
      // **As propriedades passam pelo mascaramento por omissão** (cartão 18.1):
      // aceitam-se dentro de `properties` ou soltas, uma chave que o esquema não
      // conhece fica de fora (e conta-se), e um valor de texto sai mascarado.
      const { properties, ...soltas } = (extras && typeof extras === "object" ? extras : {}) as Record<string, unknown>;
      const f = propriedadesDoCliente({ ...soltas, ...(properties && typeof properties === "object" ? properties as object : {}) },
        config.propriedadesExpostas);
      for (const d of f.descartadas) if (descartadas.size < 50) descartadas.add(d);
      emitirCru("personalizado", {
        message_key: chao(String(nome)).slice(0, 256),
        ...(Object.keys(f.propriedades).length > 0 ? { properties: f.propriedades } : {}),
      });
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
      ecraForcado = chao(String(nome)).slice(0, 256);
      emitirCru("ecra", { screen_key: ecraForcado });
    }, undefined),

    passo: protegido("uxda.passo", (nome: string) => {
      ligacao?.passo(chao(String(nome)).slice(0, 64));
    }, undefined),

    terminal: protegido("uxda.terminal", (estado: "sucesso" | "erro" | "abandonado" | "expirado") => {
      ligacao?.terminal(estado);
    }, undefined),

    mensagem: protegido("uxda.mensagem", (chave: string, tipo: "erro" | "aviso" | "sucesso" | "info", extras?: Record<string, unknown>) => {
      // A operação é texto da instituição, e sai mascarada como o resto (18.1).
      const e = extras?.["operacao"] ? { ...extras, operacao: textoDoCliente(extras["operacao"], "operacao", config.propriedadesExpostas) } : extras;
      ligacao?.mensagem(chao(String(chave)).slice(0, 256), tipo, e);
    }, undefined),

    erroTecnico: protegido("uxda.erroTecnico", (chave: string, propriedades?: Record<string, unknown>) => {
      const props: Record<string, unknown> = { classe_erro: "sistema" };
      const operacao = propriedades?.["operacao"];
      if (operacao) props["operacao"] = textoDoCliente(operacao, "operacao", config.propriedadesExpostas).slice(0, 32);
      const codigo = propriedades?.["codigo_http"];
      if (typeof codigo === "number") props["codigo_http"] = codigo;
      ligacao?.mensagemTecnica(chao(String(chave)).slice(0, 256), props);
    }, undefined),

    inquerito: protegidoAsync("uxda.inquerito", async (chave: string): Promise<boolean> => {
      await pronto;
      if (!est.ligado || !amostrado) return false;
      return inqueritos.pedir(String(chave).slice(0, 128));
    }, false),

    descarregar: protegidoAsync("uxda.descarregar", async () => { await fila.descarregar(); }, undefined),

    parar: protegido("uxda.parar", () => {
      est.ligado = false;
      inqueritos.desligar();
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
      inqueritos: inqueritos.resumo(),
      consentimento: consentimento(),
      propriedadesDescartadas: [...descartadas],
    }), {
      versao: VERSAO, ambiente: ambienteNome, amostrado: false, configuracao: CONFIGURACAO_SEGURA,
      origemDaConfiguracao: "erro", identidade: ident, fila: fila.estado(), eventosEmitidos: 0,
      eventosRecusados: 0, msNoFioPrincipal: 0, foraDoFioPrincipal: false, errosInternos: 0,
      inqueritos: { regras: 0, ultimoGatilho: "", ultimoMotivo: "erro", aVista: false, respostasEnviadas: 0 },
      consentimento: consentimento(), propriedadesDescartadas: [],
    }),
    // O consentimento decide-se na fachada, por cima desta instância (ver `iniciar`).
    // Aqui só se faz a metade que precisa de chegar à fila: esvaziá-la sem enviar.
    consentimento: protegido("uxda.consentimento.fila", (dado: boolean) => {
      if (dado === false) fila.esvaziar();
    }, undefined),
  };

  return api;
}

/** O diagnóstico de um SDK que ainda não arrancou, ou que foi parado por recusa. */
function diagnosticoInerte(op: Opcoes, consentimento: Diagnostico["consentimento"]): Diagnostico {
  return {
    versao: VERSAO, ambiente: ambienteDaChave(op.chave), amostrado: false, configuracao: CONFIGURACAO_SEGURA,
    origemDaConfiguracao: "nenhuma", identidade: { anonimo: "", dispositivo: "", sessao: "", utilizador: null },
    fila: { pendentes: 0, enviados: 0, bytes: 0, falhas: 0, perdidos: 0, ultimoErro: "", proximaTentativaEm: 0 } as ReturnType<Fila["estado"]>,
    eventosEmitidos: 0, eventosRecusados: 0, msNoFioPrincipal: 0, foraDoFioPrincipal: false, errosInternos: errosInternos().length,
    inqueritos: { regras: 0, ultimoGatilho: "", ultimoMotivo: "sem_consentimento", aVista: false, respostasEnviadas: 0 },
    consentimento, propriedadesDescartadas: [],
  };
}

/** Lê a recusa guardada **sem escrever nada**: o `localStorage` cru, e não o ambiente, que sonda com uma escrita. */
function recusaGuardada(op: Opcoes): boolean {
  try {
    const loja = op.ambiente?.armazenamento ?? ((op.ambiente?.janela ?? (globalThis as any).window)?.localStorage ?? null);
    return loja?.getItem?.(CHAVE_RECUSA) === "recusado";
  } catch {
    return false;
  }
}

/**
 * Arranca o SDK, **por trás do consentimento** (cartão 18.1, `RNF-PRI-12`, ADR 0047).
 *
 * Devolve sempre a mesma fachada, e a captura só existe por trás dela quando pode
 * existir: com `consentimento: "exigido"` só depois de `consentimento(true)`, e em
 * qualquer modo nunca depois de `consentimento(false)` (até a aplicação voltar a
 * dizer que sim). Sem captura, a fachada não toca no dispositivo: nem uma leitura
 * da cache, nem um identificador, nem um pedido. O sinal decide-o a aplicação, e
 * não há configuração do servidor que o contorne.
 */
export function iniciar(op: Opcoes): Uxda {
  const exigido = op.consentimento === "exigido";
  let estado: Diagnostico["consentimento"] = recusaGuardada(op) ? "recusado" : exigido ? "pendente" : "implicito";
  let dentro: Uxda | null = null;
  const ler = () => estado;
  const arrancar = () => { if (!dentro) dentro = iniciarCaptura(op, ler); };
  if (estado === "implicito") arrancar();

  const lojaCrua = () => {
    try { return op.ambiente?.armazenamento ?? ((op.ambiente?.janela ?? (globalThis as any).window)?.localStorage ?? null); }
    catch { return null; }
  };

  return {
    track: (n, e) => dentro?.track(n, e),
    identificar: async (id) => { await dentro?.identificar(id); },
    esquecer: () => dentro?.esquecer(),
    ecra: (n) => dentro?.ecra(n),
    passo: (n) => dentro?.passo(n),
    terminal: (e) => dentro?.terminal(e),
    mensagem: (c, t, e) => dentro?.mensagem(c, t, e),
    erroTecnico: (c, p) => dentro?.erroTecnico(c, p),
    inquerito: async (c) => (dentro ? dentro.inquerito(c) : false),
    descarregar: async () => { await dentro?.descarregar(); },
    parar: () => dentro?.parar(),
    diagnostico: () => (dentro ? dentro.diagnostico() : diagnosticoInerte(op, estado)),
    consentimento: protegido("uxda.consentimento", (dado: boolean) => {
      const loja = lojaCrua();
      if (dado === true) {
        try { loja?.removeItem?.(CHAVE_RECUSA); } catch { /* segue */ }
        estado = exigido ? "dado" : "implicito";
        arrancar();
        return;
      }
      // Recusa: para já, sem esperar pelo lote, e apaga o que ficou no dispositivo.
      estado = "recusado";
      dentro?.consentimento(false);
      dentro?.parar();
      dentro = null;
      apagarOQueGuardamos(loja);
      try { loja?.setItem?.(CHAVE_RECUSA, "recusado"); } catch { /* sem armazenamento, a recusa vale para esta página */ }
    }, undefined),
  };
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
      consentimento: el.getAttribute("data-consentimento") === "exigido" ? "exigido" : "implicito",
    });
    janela.uxda = uxda;
    return uxda;
  } catch {
    return null;
  }
}

export { errosInternos, limparErros, LIMITES, VERSAO };
export type { Opcoes, Evento, Configuracao };
