/**
 * Envio em lote, com recuo exponencial e respeito por quem paga o tráfego.
 * RF-CAP-07, RNF-SDK-05 e RNF-SDK-07.
 *
 * A regra que manda em tudo o resto: **a aplicação anfitriã não dá por nada**.
 * Se a plataforma estiver em baixo, os eventos ficam na fila e voltam a ser
 * tentados; não há erro na consola, não há promessa rejeitada, não há pedido a
 * bloquear o ecrã.
 */
import type { Ambiente, Evento, Resposta } from "../core/tipos.ts";
import { Armazem } from "./armazem.ts";
import { confirmarErrosReportados, errosPorReportar } from "../safe.ts";

export interface Limites {
  /** Eventos por lote. */
  maxLote: number;
  /** Bytes por lote, para caber num pedido normal. */
  maxBytes: number;
  /** Espera mínima entre envios, em milissegundos. */
  intervaloMs: number;
  /** Primeiro recuo depois de uma falha. Duplica em cada tentativa. */
  recuoMs: number;
  /** Tecto do recuo: acima disto não vale a pena continuar a duplicar. */
  recuoMaxMs: number;
  /** Tentativas seguidas antes de desistir **desta sessão**. A fila fica. */
  maxTentativas: number;
}

export const LIMITES: Limites = {
  maxLote: 50,
  maxBytes: 64 * 1024,
  intervaloMs: 5000,
  recuoMs: 1000,
  recuoMaxMs: 5 * 60 * 1000,
  maxTentativas: 8,
};

/**
 * Em rede medida ou lenta, o SDK abranda em vez de desligar: lotes maiores e
 * menos frequentes gastam menos bateria e menos dados do que muitos pedidos
 * pequenos, e continuam a não perder nada.
 */
export function limitesPara(conexao: any, base: Limites = LIMITES): Limites {
  if (!conexao) return base;
  const poupar = conexao.saveData === true;
  const lenta = conexao.effectiveType === "2g" || conexao.effectiveType === "slow-2g";
  if (!poupar && !lenta) return base;
  return { ...base, intervaloMs: poupar ? 60000 : 30000, maxLote: 200, maxBytes: 128 * 1024 };
}

export interface Estado {
  pendentes: number;
  enviados: number;
  /** Bytes de corpo entregues. É o tráfego que o SDK gasta a quem o instala. */
  bytes: number;
  falhas: number;
  perdidos: number;
  ultimoErro: string;
  proximaTentativaEm: number;
}

export class Fila {
  private enviando = false;
  private tentativas = 0;
  private ultimoEnvio = 0;
  private proxima = 0;
  private enviados = 0;
  private bytes = 0;
  private falhas = 0;
  private ultimoErro = "";
  private temporizador: any = null;

  private readonly armazem: Armazem;
  private readonly amb: Ambiente;
  private readonly url: string;
  private readonly cabecalhos: () => Record<string, string>;
  private limites: Limites;

  constructor(
    armazem: Armazem,
    amb: Ambiente,
    url: string,
    cabecalhos: () => Record<string, string>,
    limites: Limites = LIMITES,
  ) {
    this.armazem = armazem;
    this.amb = amb;
    this.url = url;
    this.cabecalhos = cabecalhos;
    this.limites = limites;
  }

  ajustarLimites(l: Limites): void {
    this.limites = l;
  }

  juntar(ev: Evento): void {
    this.armazem.juntar(ev);
    this.agendar();
  }

  estado(): Estado {
    return {
      pendentes: this.armazem.quantos(),
      enviados: this.enviados,
      bytes: this.bytes,
      falhas: this.falhas,
      perdidos: this.armazem.perdidos(),
      ultimoErro: this.ultimoErro,
      proximaTentativaEm: this.proxima,
    };
  }

  /** Agenda o envio seguinte, respeitando o intervalo mínimo e o recuo em curso. */
  private agendar(): void {
    if (this.temporizador !== null || this.armazem.quantos() === 0) return;
    const agora = this.amb.agora();
    const cedo = Math.max(this.ultimoEnvio + this.limites.intervaloMs, this.proxima);
    const espera = Math.max(0, cedo - agora);
    const janela = this.amb.janela;
    if (!janela || typeof janela.setTimeout !== "function") return;
    this.temporizador = janela.setTimeout(() => {
      this.temporizador = null;
      void this.descarregar();
    }, espera);
  }

  /**
   * Envia um lote. Nunca lança: quem chama é a captura, e a captura corre dentro
   * do fio da aplicação anfitriã.
   */
  async descarregar(sincrono = false): Promise<void> {
    if (this.enviando) return;
    const lote = this.armazem.lote(this.limites.maxLote, this.limites.maxBytes);
    if (lote.length === 0) return;
    this.enviando = true;
    this.ultimoEnvio = this.amb.agora();
    // Os erros internos do SDK viajam no mesmo lote (cartão 17.3): só o sítio, o tipo e
    // quantas vezes, e nunca a mensagem.
    const erros = errosPorReportar();
    try {
      const corpo = JSON.stringify({
        versao_protocolo: 1,
        sdk: "uxda-sdk-js",
        versao_sdk: VERSAO,
        enviado_em: new Date(this.amb.agora()).toISOString(),
        eventos: lote,
        ...(erros.length > 0 ? { erros_sdk: erros } : {}),
      });
      const r: Resposta = await this.amb.enviar(this.url, corpo, this.cabecalhos(), sincrono);
      if (r.estado >= 200 && r.estado < 300) {
        this.armazem.confirmar(lote);
        confirmarErrosReportados(erros);
        this.enviados += lote.length;
        this.bytes += corpo.length;
        this.tentativas = 0;
        this.proxima = 0;
        this.ultimoErro = "";
      } else if (r.estado >= 400 && r.estado < 500 && r.estado !== 408 && r.estado !== 429) {
        // Recusa definitiva (chave errada, corpo inválido): repetir não muda
        // nada e a fila crescia para sempre. Deita-se fora, com o motivo.
        this.armazem.confirmar(lote);
        confirmarErrosReportados(erros);
        this.ultimoErro = `recusado ${r.estado}`;
        this.falhas++;
      } else {
        this.recuar(`estado ${r.estado}`);
      }
    } catch (e) {
      this.recuar(String(e));
    } finally {
      this.enviando = false;
      this.agendar();
    }
  }

  private recuar(motivo: string): void {
    this.falhas++;
    this.ultimoErro = motivo;
    this.tentativas++;
    const espera = Math.min(
      this.limites.recuoMs * Math.pow(2, this.tentativas - 1),
      this.limites.recuoMaxMs,
    );
    this.proxima = this.amb.agora() + espera;
    if (this.tentativas >= this.limites.maxTentativas) {
      // Desiste **desta sessão**, e não da fila: os eventos ficam guardados e
      // saem no próximo arranque. É a diferença entre adiar e perder.
      this.proxima = this.amb.agora() + this.limites.recuoMaxMs;
    }
  }

  /** Última tentativa antes de a página morrer. Vai por `sendBeacon`, se houver. */
  async fechar(): Promise<void> {
    // A escrita pendente sai primeiro: se o envio não chegar a acontecer, o que
    // ficou na fila tem de estar em disco para a sessão seguinte o apanhar.
    this.armazem.gravarJa();
    await this.descarregar(true);
  }
}

export const VERSAO = "0.1.0";
