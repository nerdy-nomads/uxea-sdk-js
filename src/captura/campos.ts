/**
 * Preenchimento, campo a campo, **sem nunca saber o que a pessoa escreveu**.
 * Cartões 4.2 e 4.3, RF-GRA-09 a RF-GRA-19.
 *
 * A regra que atravessa a secção é absoluta, e é a razão de este módulo existir
 * em vez de se ler o campo: mede-se o comportamento sobre o campo, nunca o
 * conteúdo. O RF-GRA-12 pede a contagem de caracteres introduzidos e apagados, e
 * o documento sublinha o que muita gente lê ao contrário: **isso não exige
 * conhecer um único caractere**.
 *
 * Como é que se conta sem ler:
 *
 *   - o `inputType` do evento `input` diz o que aconteceu (`insertText`,
 *     `deleteContentBackward`, `insertFromPaste`), e nunca o quê;
 *   - o número de caracteres sai da **diferença de comprimento** do campo, que é
 *     um número e não um texto.
 *
 * O `e.data` existe e traz o que foi escrito. Não é lido em lado nenhum, e a
 * bateria de fuga do cartão 5.4 falha se algum dia passar a ser.
 *
 * **Um evento por campo, emitido no desfoco** (RF-GRA-29). É o que torna a
 * granularidade viável: um evento por tecla multiplicaria o volume por dezenas.
 * Os valores são acumulados dentro da tentativa, e por isso o último evento de um
 * campo é o retrato completo dele.
 */
import { protegido } from "../safe.ts";

export interface ContextoDeCampo {
  emitir(tipo: string, extras?: Record<string, unknown>): void;
  agora(): number;
  chaveDe(el: any): string | undefined;
  /** Ao nível detalhado saem também o foco, a tecla e o desfoco, um a um. */
  detalhado(): boolean;
  /** Ao nível essencial não sai nada disto. */
  essencial(): boolean;
}

export type Origem = "manual" | "colagem" | "sugestao" | "automatico";

interface Estado {
  chave: string;
  /**
   * Uma bandeira, e não `focadoEm === 0`. O zero é um instante como outro
   * qualquer, e usá-lo como "não focado" é um defeito à espera de um relógio que
   * comece em zero. O SDK Android tem o mesmo código, e foi lá que se viu.
   */
  focado: boolean;
  escondido: boolean;
  ordem: number;
  ordemPrevista: number;
  visitas: number;
  focadoEm: number;
  escondidoEm: number;
  ativoMs: number;
  fundoMs: number;
  hesitacaoMs: number | null;
  escritos: number;
  apagados: number;
  origem: Origem | null;
  comprimento: number;
  erros: number;
  resolvido: boolean;
}

const CAMPOS = new Set(["INPUT", "TEXTAREA", "SELECT"]);

/** Campos que nunca se medem, porque medir já seria dizer alguma coisa sobre eles. */
const TIPOS_FORA = new Set(["password", "hidden"]);

export function ehCampo(el: any): boolean {
  const tag = String(el?.tagName ?? "").toUpperCase();
  if (tag === "TEXTAREA" || tag === "SELECT") return true;
  if (tag !== "INPUT") return el?.isContentEditable === true;
  return !TIPOS_FORA.has(String(el?.type ?? "text").toLowerCase());
}

/** O comprimento do que lá está. Um número, e nunca o texto. */
function comprimentoDe(el: any): number {
  const v = el?.value;
  return typeof v === "string" ? v.length : 0;
}

function origemDe(inputType: string, salto: number, el: any): Origem {
  if (inputType === "insertFromPaste") return "colagem";
  if (inputType === "insertReplacementText" || inputType === "insertFromDrop") return "sugestao";
  // Um salto grande num `insertText` é colagem que o browser não etiquetou, e
  // acontece em teclados móveis e em gestores de palavras-passe.
  if (salto > 1) return "colagem";
  try {
    if (typeof el?.matches === "function" && el.matches(":autofill")) return "automatico";
  } catch { /* o seletor não existe em todos os browsers */ }
  return "manual";
}

/** A ordem prevista pelo formulário, que é contra a qual a efetiva se compara. */
function ordemPrevistaDe(el: any, documento: any): number {
  try {
    const formulario = el?.form;
    const lista = formulario?.elements
      ? Array.from(formulario.elements as any[])
      : Array.from(documento?.querySelectorAll?.("input,textarea,select") ?? []);
    const i = lista.indexOf(el);
    return i >= 0 ? i + 1 : 0;
  } catch {
    return 0;
  }
}

export interface LigacaoDeCampos {
  /** O último campo com foco antes de sair: é o campo de abandono (RF-GRA-18). */
  campoDeAbandono(): string;
  /**
   * Fecha o que estiver aberto e emite o retrato de cada campo do formulário.
   * Devolve as contagens, que vão no próprio evento de submissão.
   */
  aoSubmeter(formulario: any): { preenchidos: number; vazios: number; com_erro: number };
  /** Um erro de validação naquele campo, com a chave da mensagem. */
  aoErrar(el: any, chaveDaMensagem: string): void;
  /** A página escondeu-se ou voltou: o tempo em segundo plano não é tempo dela. */
  esconder(): void;
  mostrar(): void;
  /** Uma tentativa nova recomeça as contagens. */
  recomecar(): void;
  desligar(): void;
}

export function ligarCampos(janela: any, documento: any, ctx: ContextoDeCampo): LigacaoDeCampos {
  const desligadores: Array<() => void> = [];
  const estados = new WeakMap<object, Estado>();
  let ordemSeguinte = 1;
  let abertoEm: any = null;
  let ultimoComFoco = "";
  let escondido = false;

  const ouvir = (alvo: any, evento: string, fn: any) => {
    if (!alvo || typeof alvo.addEventListener !== "function") return;
    const seguro = protegido(`captura.${evento}`, fn, undefined);
    alvo.addEventListener(evento, seguro, true);
    desligadores.push(() => alvo.removeEventListener(evento, seguro, true));
  };

  const estadoDe = (el: any): Estado => {
    let e = estados.get(el);
    if (!e) {
      e = {
        chave: ctx.chaveDe(el) ?? "",
        ordem: 0,
        ordemPrevista: ordemPrevistaDe(el, documento),
        visitas: 0,
        focado: false,
        escondido: false,
        focadoEm: 0,
        escondidoEm: 0,
        ativoMs: 0,
        fundoMs: 0,
        hesitacaoMs: null,
        escritos: 0,
        apagados: 0,
        origem: null,
        comprimento: comprimentoDe(el),
        erros: 0,
        resolvido: true,
      };
      estados.set(el, e);
    }
    return e;
  };

  const propriedadesDe = (e: Estado, estadoNaSubmissao?: string, fase?: string) => {
    const p: Record<string, unknown> = {
      caracteres_escritos: e.escritos,
      caracteres_apagados: e.apagados,
      regressos: Math.max(0, e.visitas - 1),
      ordem: e.ordem,
      ordem_prevista: e.ordemPrevista,
    };
    if (e.hesitacaoMs !== null) p["hesitacao_ms"] = e.hesitacaoMs;
    if (e.fundoMs > 0) p["tempo_fundo_ms"] = e.fundoMs;
    if (e.origem) p["origem"] = e.origem;
    if (e.visitas > 0 && e.comprimento === 0) p["visitado_vazio"] = true;
    if (e.erros > 0) p["tentativas_ate_resolver"] = e.erros;
    if (estadoNaSubmissao) p["estado_na_submissao"] = estadoNaSubmissao;
    if (fase) p["fase"] = fase;
    return p;
  };

  const emitirCampo = (e: Estado, extras: Record<string, unknown> = {}, estadoNaSubmissao?: string, fase?: string) => {
    if (ctx.essencial()) return;
    ctx.emitir("campo", {
      element_key: e.chave,
      // O tempo **ativo**: o que esteve em segundo plano sai daqui e vai no
      // `tempo_fundo_ms`, para ninguém somar espera de sistema a hesitação.
      duration_ms: Math.max(0, Math.round(e.ativoMs)),
      properties: propriedadesDe(e, estadoNaSubmissao, fase),
      ...extras,
    });
  };

  const fechar = (el: any) => {
    const e = estados.get(el);
    if (!e || !e.focado) return;
    e.ativoMs += Math.max(0, ctx.agora() - e.focadoEm - (e.escondido ? ctx.agora() - e.escondidoEm : 0));
    e.focado = false;
    e.comprimento = comprimentoDe(el);
    emitirCampo(e);
    if (ctx.detalhado()) {
      ctx.emitir("desfoco", { element_key: e.chave, duration_ms: Math.round(e.ativoMs) });
    }
  };

  ouvir(documento, "focusin", (ev: any) => {
    const el = ev?.target;
    if (!el || !ehCampo(el)) return;
    if (abertoEm && abertoEm !== el) fechar(abertoEm);
    const e = estadoDe(el);
    e.visitas++;
    if (e.ordem === 0) e.ordem = ordemSeguinte++;
    e.focado = true;
    e.focadoEm = ctx.agora();
    e.escondido = escondido;
    e.escondidoEm = escondido ? ctx.agora() : 0;
    abertoEm = el;
    ultimoComFoco = e.chave;
    if (ctx.detalhado() || !ctx.essencial()) ctx.emitir("foco", { element_key: e.chave });
  });

  ouvir(documento, "input", (ev: any) => {
    const el = ev?.target;
    if (!el || !ehCampo(el)) return;
    const e = estadoDe(el);
    const antes = e.comprimento;
    const agora = comprimentoDe(el);
    const salto = agora - antes;
    e.comprimento = agora;

    const tipo = String(ev?.inputType ?? "");
    const apaga = tipo.startsWith("delete") || salto < 0;
    if (apaga) {
      e.apagados += Math.max(1, antes - agora);
    } else {
      e.escritos += Math.max(1, salto);
      const o = origemDe(tipo, salto, el);
      // A origem que fica é a mais forte: uma colagem seguida de correção manual
      // continua a ser um campo que veio de fora.
      if (e.origem === null || e.origem === "manual") e.origem = o;
    }

    if (e.hesitacaoMs === null && e.focado) {
      e.hesitacaoMs = Math.max(0, Math.round(ctx.agora() - e.focadoEm));
      if (ctx.detalhado()) {
        ctx.emitir("tecla", { element_key: e.chave, duration_ms: e.hesitacaoMs });
      }
    }
  });

  ouvir(documento, "focusout", (ev: any) => {
    const el = ev?.target;
    if (!el || !ehCampo(el)) return;
    fechar(el);
    if (abertoEm === el) abertoEm = null;
  });

  return {
    campoDeAbandono: () => ultimoComFoco,

    aoSubmeter(formulario: any) {
      const contagem = { preenchidos: 0, vazios: 0, com_erro: 0 };
      if (abertoEm) {
        fechar(abertoEm);
        abertoEm = null;
      }
      // O retrato de cada campo no momento da submissão (RF-GRA-19), incluindo
      // os que ninguém chegou a visitar: é isso que distingue "visitou e deixou
      // vazio" de "nunca lá foi", que o RF-GRA-14 pede e que só aqui se sabe.
      // `form.elements` é o caminho certo e nem sempre existe: há formulários
      // montados por componentes que não o preenchem, e o `querySelectorAll` é o
      // que os apanha. Sem esta segunda tentativa, o retrato da submissão saía
      // vazio e ninguém dava por isso, porque não há erro nenhum a dar.
      let lista: any[] = [];
      try {
        const doForm = formulario?.elements ? Array.from(formulario.elements as any[]) : [];
        lista = doForm.length > 0
          ? doForm
          : Array.from(formulario?.querySelectorAll?.("input,textarea,select") ?? []);
      } catch { lista = []; }
      for (const el of lista) {
        if (!ehCampo(el)) continue;
        const e = estadoDe(el);
        e.comprimento = comprimentoDe(el);
        const estado = e.erros > 0 && !e.resolvido
          ? "com_erro_pendente"
          : e.comprimento > 0 ? "preenchido" : "vazio";
        if (estado === "preenchido") contagem.preenchidos++;
        else if (estado === "vazio") contagem.vazios++;
        else contagem.com_erro++;
        emitirCampo(e, {}, estado, "submissao");
      }
      return contagem;
    },

    aoErrar(el: any, chaveDaMensagem: string) {
      if (!el || !ehCampo(el)) return;
      const e = estadoDe(el);
      e.erros++;
      e.resolvido = false;
      ctx.emitir("erro", {
        element_key: e.chave,
        message_key: chaveDaMensagem,
        message_kind: "erro",
        properties: { tentativas_ate_resolver: e.erros },
      });
    },

    esconder() {
      escondido = true;
      const e = abertoEm ? estados.get(abertoEm) : null;
      if (e && e.focado) { e.escondido = true; e.escondidoEm = ctx.agora(); }
    },

    mostrar() {
      escondido = false;
      const e = abertoEm ? estados.get(abertoEm) : null;
      if (e && e.escondido) {
        e.fundoMs += Math.max(0, Math.round(ctx.agora() - e.escondidoEm));
        e.escondido = false;
      }
    },

    recomecar() {
      ordemSeguinte = 1;
      abertoEm = null;
      ultimoComFoco = "";
    },

    desligar() {
      for (const d of desligadores.splice(0)) {
        try { d(); } catch { /* desligar não pode falhar */ }
      }
    },
  };
}
