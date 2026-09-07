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
  captura: [],
  versao: 0,
};

/** Os dez tipos do RF-CAP-04, e a ordem é a do documento. */
export const TIPOS = [
  "ecra", "toque", "foco", "tecla", "desfoco",
  "submissao", "erro", "recuo", "plano_fundo", "erro_rede",
] as const;
export type Tipo = (typeof TIPOS)[number];
