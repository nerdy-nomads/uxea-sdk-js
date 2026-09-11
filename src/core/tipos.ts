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
  /** Que tipos de evento capturar. Vazio quer dizer todos os do nível. */
  captura: string[];
  /** Versão da configuração, para se saber qual estava em vigor. */
  versao: number;
}

export const CONFIGURACAO_SEGURA: Configuracao = {
  // O valor por omissão mede tudo: uma configuração que não chega não pode
  // deixar o cliente sem dados, e o RF-CAP-10 diz que a degradação é decisão de
  // quem opera, nunca um acidente de rede.
  amostragem: 1,
  nivel: "padrao",
  amostragemDetalhado: 0,
  rastreioIndividual: false,
  mensagensExpostas: [],
  captura: [],
  versao: 0,
};

/** Os dez tipos do RF-CAP-04, e a ordem é a do documento. */
export const TIPOS = [
  "ecra", "toque", "foco", "tecla", "desfoco",
  "submissao", "erro", "recuo", "plano_fundo", "erro_rede",
] as const;
export type Tipo = (typeof TIPOS)[number];
