/**
 * Os tipos que atravessam o SDK. Um sítio só, porque o mesmo evento é escrito
 * pela captura, guardado pela fila e validado antes de sair.
 */

/** O evento tal como sai daqui. É o esquema canónico do `uxda-core`. */
export interface Evento {
  event_id: string;
  anonymous_id: string;
  user_id?: string;
  device_id: string;
  session_id: string;
  event_type: string;
  screen_key: string;
  element_key?: string;
  occurred_at: string;
  app_version: string;
  platform: string;
  identity_scope: string;
  capture_level: string;
  duration_ms?: number;
  message_key?: string;
  message_kind?: string;
  message_text_masked?: string;
  properties?: Record<string, unknown>;
  [k: string]: unknown;
}

/** O que o integrador escreve. **Só a chave é obrigatória** (RF-CAP-01). */
export interface Opcoes {
  chave: string;
  /** Endereço da ingestão. Por omissão, o da plataforma. */
  servidor?: string;
  /** Versão da aplicação anfitriã. Sem ela, lê-se a meta `uxda:version`. */
  versao?: string;
  /** Desliga a captura automática, para quem só quer `track`. */
  automatico?: boolean;
  /**
   * O consentimento (cartão 18.1, ADR 0047). Com `exigido`, o SDK **não faz nada**
   * (não lê nem escreve no dispositivo, não pede a configuração, não ouve nada)
   * até a aplicação chamar `consentimento(true)`. Por omissão é `implicito`: a
   * instituição trata o fundamento da medição de outra forma, e a pessoa pode
   * recusar na mesma com `consentimento(false)`.
   */
  consentimento?: "exigido" | "implicito";
  /** Só para ensaios: relógio, armazenamento e transporte substituíveis. */
  ambiente?: Partial<Ambiente>;
}

/** Tudo o que o SDK toca fora de si próprio. Injetável, para os ensaios. */
export interface Ambiente {
  agora(): number;
  janela: any;
  documento: any;
  armazenamento: Armazenamento | null;
  enviar(url: string, corpo: string, cabecalhos: Record<string, string>, sincrono: boolean, metodo?: string): Promise<Resposta>;
  /**
   * O sorteio dos inquéritos (RF-PER-04), entre 0 e 1. Por omissão, `Math.random`.
   *
   * Existe só para os ensaios poderem semear o gerador: a amostragem de um
   * inquérito é um sorteio por disparo, e não a amostragem determinística por
   * utilizador da captura, e um ensaio estatístico sem semente é um ensaio que
   * falha uma vez em cada cem corridas.
   */
  aleatorio?(): number;
}

export interface Resposta {
  estado: number;
  corpo: string;
}

/** A parte do `localStorage` que usamos. Nada mais, para ser trivial de duplicar. */
export interface Armazenamento {
  getItem(chave: string): string | null;
  setItem(chave: string, valor: string): void;
  removeItem(chave: string): void;
}

/** A configuração que pode mudar sem publicar nada (RF-CAP-09, RF-CAP-10). */
export interface Configuracao {
  /** Fração de utilizadores medidos, de 0 a 1. Determinística por utilizador. */
  amostragem: number;
  /** Nível de captura do ADR 0010. */
  nivel: "essencial" | "padrao" | "detalhado";
  /**
   * Que fração dos utilizadores sobe ao nível detalhado (RF-GRA-27).
   *
   * É uma coisa diferente da `amostragem`: aquela decide **se** a pessoa é
   * medida, esta decide **com que detalhe**. Com uma só, subir o detalhe obrigava
   * a subir para toda a gente, que é o custo que o ADR 0010 existe para evitar.
   */
  amostragemDetalhado: number;
  /**
   * O rastreio individual do projeto. Cartão 9.5, `RF-IND-09`.
   *
   * **Falso por omissão, e é a única propriedade desta lista que degrada para
   * "não".** Todas as outras medem tudo quando a configuração não chega, porque o
   * `RF-CAP-10` diz que a degradação é decisão de quem opera. Esta é ao
   * contrário, pela mesma razão que a lista de mensagens expostas está vazia por
   * omissão: seguir o comportamento de uma pessoa, ainda que sob identificador
   * opaco, é tratamento de dados pessoais pseudonimizados, e isso não pode
   * começar por acidente de rede.
   *
   * Na prática não muda o comportamento de ninguém hoje: as coordenadas já só
   * saíam no nível detalhado, e a amostragem do detalhado também é zero por
   * omissão. O que muda é **qual das duas decisões falha para o lado seguro**.
   */
  rastreioIndividual: boolean;
  /**
   * As chaves de mensagem que a instituição autorizou a sair por inteiro
   * (RNF-PRI-04). Vazia por omissão: o mascaramento é o estado de repouso, e a
   * exposição é que precisa de uma decisão de quem é responsável pelos dados.
   *
   * **E há um chão que a lista não levanta:** números, identificadores e correio
   * electrónico saem sempre mascarados, autorize quem autorizar. Esses são os que
   * nos punham em falta independentemente de quem os deixou passar, e a ingestão
   * recusa o evento que os traga.
   */
  mensagensExpostas: string[];
  /**
   * As propriedades da instituição cujo valor sai sem a máscara das mensagens
   * (cartão 18.1). Vazia por omissão, como a de cima, e com o mesmo chão: números,
   * identificadores e correio saem sempre mascarados.
   */
  propriedadesExpostas: string[];
  /** Que tipos de evento capturar. Vazio quer dizer todos os do nível. */
  captura: string[];
  /** Versão da configuração, para se saber qual estava em vigor. */
  versao: number;
  /**
   * Os inquéritos do conjunto RF-PER, e o tema e a fadiga que valem para todos.
   *
   * **Degradam para "nenhum", como o rastreio individual.** Uma configuração que
   * não chega, ou que chega estragada, não pergunta nada a ninguém: perguntar de
   * mais é a fadiga que o RF-PER-05 existe para evitar, e nunca pode começar por
   * acidente de rede.
   */
  inqueritos: ConfiguracaoDeInqueritos;
}

/* ------------------------------------------------------------- inquéritos */

/** Os cinco formatos do RF-PER-03. */
export type FormatoDeInquerito = "esforco" | "satisfacao" | "recomendacao" | "escolha" | "livre";

/** Os cinco gatilhos do RF-PER-04. O `manual` é o de `uxda.inquerito()`, e não se configura. */
export type GatilhoDeInquerito = "apos_conclusao" | "apos_abandono" | "apos_erro" | "primeira_utilizacao" | "amostragem";

/** Uma condição, com a mesma forma e a mesma semântica do `core/definition`. */
export interface CondicaoDeRegra {
  campo: string;
  operador: string;
  valor: string;
}

/** Condições que valem em **e**. Uma lista de critérios vale em **ou**. */
export interface CriterioDeRegra {
  condicoes: CondicaoDeRegra[];
}

export interface OpcaoDeInquerito {
  chave: string;
  pt: string;
  en: string;
}

export interface RegraDeInquerito {
  chave: string;
  versao: number;
  formato: FormatoDeInquerito;
  pergunta: { pt: string; en: string };
  opcoes: OpcaoDeInquerito[];
  multipla: boolean;
  /** Um campo livre **opcional** ao lado da escala ou da escolha. */
  comentario: boolean;
  gatilho: GatilhoDeInquerito;
  criterios: CriterioDeRegra[];
  /** O início da tarefa: é por ele que se sabe o abandono e o `tentativa_inicio`. */
  inicio: CriterioDeRegra[];
  /** Probabilidade do sorteio, de 0 a 1. **0,1 quando não vem**, e nunca toda a gente. */
  amostragem: number;
  atrasoMs: number;
  contexto: { tarefa: string; passo: string; funcionalidade: string };
}

export interface TemaDeInquerito {
  corPrimaria: string;
  corFundo: string;
  corTexto: string;
  fonte: string;
  cantosPx: number;
  idioma: "pt" | "en";
}

export interface FadigaDeInquerito {
  maxPedidos: number;
  periodoDias: number;
  excluirRespondeuDias: number;
}

export interface ConfiguracaoDeInqueritos {
  tema: TemaDeInquerito;
  fadiga: FadigaDeInquerito;
  associarRespostas: boolean;
  lista: RegraDeInquerito[];
}

export const TEMA_POR_OMISSAO: TemaDeInquerito = {
  corPrimaria: "#1f4fd1",
  corFundo: "#ffffff",
  corTexto: "#1b1f24",
  fonte: "system-ui, sans-serif",
  cantosPx: 12,
  idioma: "pt",
};

export const FADIGA_POR_OMISSAO: FadigaDeInquerito = {
  maxPedidos: 1,
  periodoDias: 30,
  excluirRespondeuDias: 90,
};

export const SEM_INQUERITOS: ConfiguracaoDeInqueritos = {
  tema: TEMA_POR_OMISSAO,
  fadiga: FADIGA_POR_OMISSAO,
  associarRespostas: false,
  lista: [],
};

export const CONFIGURACAO_SEGURA: Configuracao = {
  // O valor por omissão mede tudo: uma configuração que não chega não pode
  // deixar o cliente sem dados, e o RF-CAP-10 diz que a degradação é decisão de
  // quem opera, nunca um acidente de rede.
  amostragem: 1,
  nivel: "padrao",
  amostragemDetalhado: 0,
  rastreioIndividual: false,
  mensagensExpostas: [],
  propriedadesExpostas: [],
  captura: [],
  versao: 0,
  inqueritos: SEM_INQUERITOS,
};

/** Os dez tipos do RF-CAP-04, e a ordem é a do documento. */
export const TIPOS = [
  "ecra", "toque", "foco", "tecla", "desfoco",
  "submissao", "erro", "recuo", "plano_fundo", "erro_rede",
] as const;
export type Tipo = (typeof TIPOS)[number];
