/**
 * A fila persistente. RF-CAP-06 e RNF-SDK-05.
 *
 * Sobrevive a fechar o separador e a recarregar a página, porque o evento que se
 * perde ao fechar é justamente o do fim da tentativa: o abandono, o erro, a
 * desistência. Perder esses é perder aquilo que o produto existe para medir.
 *
 * Guarda-se no armazenamento local e não em memória, e escreve-se **em cada
 * mudança**: um `beforeunload` não é garantido, e um separador que morre não dá
 * aviso nenhum.
 */
import type { Armazenamento, Evento } from "../core/tipos.ts";

/** Acima disto, deita-se fora o mais antigo. Um SDK não enche o disco de ninguém. */
export const MAX_EVENTOS = 500;
export const MAX_BYTES = 256 * 1024;

export class Armazem {
  private mem: Evento[] = [];
  private descartados = 0;
  private sujo = false;
  private selado = false;
  private bytes = 2;
  private readonly loja: Armazenamento | null;
  private readonly chave: string;
  private readonly agendar: ((fn: () => void) => void) | null;

  // Sem propriedades de parâmetro no construtor: o `node --experimental-strip-types`
  // corta tipos sem os interpretar, e essa forma exigia um compilador a sério.
  //
  // `agendar` é o que transforma uma escrita por evento numa escrita por lote.
  // Sem ele, cada evento serializava a fila inteira: com quinhentos eventos na
  // fila, guardar o quinhentos e um custava quinhentas vezes mais do que o
  // primeiro, e o orçamento do fio principal ia atrás. Quem o passa é o SDK, com
  // o temporizador do browser; quem não o passa (os ensaios) escreve na hora.
  constructor(loja: Armazenamento | null, chave = "uxda.fila", agendar: ((fn: () => void) => void) | null = null) {
    this.loja = loja;
    this.chave = chave;
    this.agendar = agendar;
    this.mem = this.ler();
    this.bytes = this.contarBytes();
  }

  private ler(): Evento[] {
    if (!this.loja) return [];
    const bruto = this.loja.getItem(this.chave);
    if (!bruto) return [];
    try {
      const v = JSON.parse(bruto);
      return Array.isArray(v) ? (v as Evento[]) : [];
    } catch {
      // Lixo no armazenamento não pode travar o arranque: deita-se fora e segue.
      this.loja.removeItem(this.chave);
      return [];
    }
  }

  /** Marca a fila como suja e deixa a escrita para o fim do lote. */
  private gravar(): void {
    if (!this.agendar) {
      this.gravarJa();
      return;
    }
    if (this.sujo) return;
    this.sujo = true;
    this.agendar(() => {
      this.sujo = false;
      this.gravarJa();
    });
  }

  /**
   * Esvazia e sela (cartão 18.1): a pessoa retirou o consentimento. Apaga o que
   * está em memória e no dispositivo, e uma escrita que já estava agendada deixa
   * de escrever, senão voltava a pôr no disco o que acabou de se apagar.
   */
  esvaziar(): void {
    this.selado = true;
    this.mem = [];
    this.bytes = 2;
    try { this.loja?.removeItem(this.chave); } catch { /* segue */ }
  }

  /** Escreve mesmo, agora. Chamado no fecho da página, que não espera por nada. */
  gravarJa(): void {
    if (!this.loja || this.selado) return;
    try {
      this.loja.setItem(this.chave, JSON.stringify(this.mem));
    } catch {
      // Quota cheia: corta-se metade da fila, o mais antigo primeiro, e tenta
      // outra vez. Sem isto, o SDK ficava a lançar em cada evento.
      const cortados = this.mem.splice(0, Math.ceil(this.mem.length / 2));
      this.descartados += cortados.length;
      try {
        this.loja.setItem(this.chave, JSON.stringify(this.mem));
      } catch {
        this.loja.removeItem(this.chave);
      }
    }
  }

  juntar(ev: Evento): void {
    if (this.selado) return;
    this.mem.push(ev);
    this.bytes += JSON.stringify(ev).length + 1;
    // O tamanho é contado à medida, e **não** medido de novo em cada evento:
    // serializar a fila inteira para saber se cabe mais um dava um custo que
    // cresce com o quadrado do número de eventos, e era o que mais pesava no
    // orçamento do fio principal.
    while (this.mem.length > MAX_EVENTOS || this.bytes > MAX_BYTES) {
      const fora = this.mem.shift();
      if (fora) this.bytes -= JSON.stringify(fora).length + 1;
      this.descartados++;
    }
    this.gravar();
  }

  /** O próximo lote, sem o tirar da fila: só sai quando a escrita confirmar. */
  lote(max: number, maxBytes: number): Evento[] {
    const out: Evento[] = [];
    let bytes = 2;
    for (const ev of this.mem) {
      const b = JSON.stringify(ev).length + 1;
      if (out.length >= max || (out.length > 0 && bytes + b > maxBytes)) break;
      out.push(ev);
      bytes += b;
    }
    return out;
  }

  /** Confirma a entrega de um lote. Compara por `event_id`, não por posição. */
  confirmar(lote: Evento[]): void {
    if (lote.length === 0) return;
    const entregues = new Set(lote.map((e) => e.event_id));
    this.mem = this.mem.filter((e) => !entregues.has(e.event_id));
    this.bytes = this.contarBytes();
    this.gravar();
  }

  private contarBytes(): number {
    let n = 2;
    for (const e of this.mem) n += JSON.stringify(e).length + 1;
    return n;
  }

  pendentes(): Evento[] {
    return this.mem.slice();
  }

  quantos(): number {
    return this.mem.length;
  }

  perdidos(): number {
    return this.descartados;
  }

  /** Tamanho aproximado em bytes, contado à medida. */
  tamanho(): number {
    return this.bytes;
  }

  limpar(): void {
    this.mem = [];
    this.bytes = 2;
    this.gravar();
  }
}
