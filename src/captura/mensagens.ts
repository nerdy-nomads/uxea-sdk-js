/**
 * Mensagens de sistema apresentadas ao utilizador. Cartões 5.1 e 5.2,
 * RF-MSG-01 a RF-MSG-05, RF-CAP-04a e RNF-PRI-04.
 *
 * O documento chama-lhe o registo mais barato de capturar e dos mais reveladores
 * que existem, e a razão é simples: **uma mensagem de erro é um problema já
 * identificado pelo próprio produto**, à espera de que alguém o conte.
 *
 * Três decisões mandam aqui, e todas vêm dos requisitos:
 *
 *  1. **A chave ganha ao texto** (RF-MSG-02). Uma chave é estável, é independente
 *     do idioma e não arrasta dados nenhuns. A mesma mensagem em português e em
 *     inglês tem de contar como uma, e só a chave dá isso.
 *  2. **O texto, quando é o que há, sai mascarado do dispositivo** (RF-MSG-04). No
 *     dispositivo, e não no servidor: mascarar do outro lado deixava a promessa
 *     verdadeira no desenho e falsa na prática.
 *  3. **A classificação separa três coisas que se confundem** (RF-MSG-07): um erro
 *     de validação num campo, um erro de operação e um erro de sistema pedem
 *     trabalho diferente a equipas diferentes.
 *
 * O que **não** se faz: ler o valor de um campo, mesmo quando ele está dentro do
 * elemento da mensagem. O texto é recolhido a saltar por cima de `input`,
 * `textarea` e `select`, e a bateria de fuga do cartão 5.4 prova-o.
 */
import { protegido } from "../safe.ts";
import { mascarar, mascararMensagem, esqueletoDeMensagem, resumo, normalizarTexto } from "../identity/mask.ts";

/** As quatro classes do RF-MSG-01. */
export type TipoDeMensagem = "erro" | "aviso" | "sucesso" | "info";

/** As três do RF-MSG-07, e só fazem sentido quando o tipo é `erro`. */
export type ClasseDeErro = "validacao" | "operacao" | "sistema";

export interface ContextoDeMensagens {
  emitir(tipo: string, extras?: Record<string, unknown>): void;
  agora(): number;
  /** A chave de identidade de um elemento, para o campo associado. */
  chaveDe(el: any): string | undefined;
  /** O passo em que a tentativa vai, para o contexto do RF-MSG-05. */
  passo(): string;
  /**
   * A lista explícita de permissões do RNF-PRI-04: as chaves cuja mensagem a
   * instituição autoriza a sair por inteiro. Vazia por omissão, que é o que
   * "mascaramento por omissão" quer dizer.
   */
  exposta(chave: string): boolean;
}

export interface LigacaoDeMensagens {
  /** A API pública: a aplicação declara uma mensagem que o SDK não vê sozinho. */
  declarar(chave: string, tipo: TipoDeMensagem, extras?: Record<string, unknown>): void;
  /** Um erro técnico, que nunca chegou ao ecrã (RF-MSG-06). Vem da rede. */
  tecnico(chave: string, propriedades: Record<string, unknown>, elemento?: string): void;
  desligar(): void;
}

/** O tamanho máximo do texto que sai. O esquema permite 1024; isto é o que cabe. */
const MAX_TEXTO = 240;

/* --------------------------------------------------------------- deteção */

/** Os atributos por onde uma aplicação declara a chave da mensagem, por ordem. */
const ATRIBUTOS_DE_CHAVE = [
  "data-uxda-mensagem", "data-mensagem", "data-message-key", "data-message-id",
  "data-msg", "data-i18n", "data-l10n-id", "data-error-code",
];

const ATRIBUTOS_DE_TIPO = ["data-uxda-tipo", "data-message-kind", "data-severity", "data-tipo"];

/**
 * Pelas classes, que é como noventa por cento das aplicações escreve isto. A
 * ordem importa: `erro` ganha a `info`, porque um `alert alert-danger` tem as
 * duas palavras e o que interessa é a segunda.
 */
const PISTAS: ReadonlyArray<readonly [RegExp, TipoDeMensagem]> = [
  [/(^|[-_ ])(erro|error|danger|invalid|invalido|fail|failure|critical|critico)/i, "erro"],
  [/(^|[-_ ])(aviso|warn|warning|caution|alerta)/i, "aviso"],
  [/(^|[-_ ])(sucesso|success|ok|confirm|done)/i, "sucesso"],
  [/(^|[-_ ])(info|informa|note|notice|hint|dica)/i, "info"],
];

/** O que faz de um elemento uma mensagem, e não um pedaço qualquer de página. */
const CLASSES_DE_MENSAGEM =
  /(^|[-_ ])(toast|snackbar|alert|notification|notificacao|flash|message|mensagem|erro|error|aviso|warning|success|sucesso|banner|callout|help-block|invalid-feedback|form-error)/i;

function atributo(el: any, nome: string): string {
  try {
    const v = el?.getAttribute?.(nome);
    return typeof v === "string" ? v.trim() : "";
  } catch { return ""; }
}

/** Ehmensagem: um elemento que a aplicação pôs no ecrã para alguém ler. */
export function ehMensagem(el: any): boolean {
  if (!el || typeof el.tagName !== "string") return false;
  const papel = atributo(el, "role").toLowerCase();
  if (papel === "alert" || papel === "status" || papel === "alertdialog") return true;
  const vivo = atributo(el, "aria-live").toLowerCase();
  if (vivo === "polite" || vivo === "assertive") return true;
  if (el.tagName.toUpperCase() === "OUTPUT") return true;
  for (const a of ATRIBUTOS_DE_CHAVE) if (atributo(el, a)) return true;
  const classe = String(el.className ?? "");
  return CLASSES_DE_MENSAGEM.test(classe);
}

/** A classe da mensagem, pela ordem de confiança das pistas. */
export function tipoDe(el: any): TipoDeMensagem {
  for (const a of ATRIBUTOS_DE_TIPO) {
    const v = atributo(el, a).toLowerCase();
    if (v === "erro" || v === "error") return "erro";
    if (v === "aviso" || v === "warning" || v === "warn") return "aviso";
    if (v === "sucesso" || v === "success") return "sucesso";
    if (v === "info" || v === "information") return "info";
  }
  const texto = `${String(el.className ?? "")} ${atributo(el, "id")} ${atributo(el, "data-testid")}`;
  for (const [re, tipo] of PISTAS) if (re.test(texto)) return tipo;
  // `role="alert"` sem mais nada é uma interrupção, e as aplicações usam-no para
  // o que corre mal. `role="status"` é o contrário: informa e não interrompe.
  const papel = atributo(el, "role").toLowerCase();
  if (papel === "alert" || papel === "alertdialog") return "erro";
  return "info";
}

/**
 * O texto visível, **sem nunca ler um campo**.
 *
 * O `textContent` traria o conteúdo de um `textarea` que estivesse lá dentro, e
 * isso é conteúdo escrito por uma pessoa. Por isso o texto recolhe-se a andar pela
 * árvore com esses ramos cortados.
 */
export function textoVisivel(el: any, limite = 4): string {
  if (!el) return "";
  const tag = String(el.tagName ?? "").toUpperCase();
  if (tag === "TEXTAREA" || tag === "INPUT" || tag === "SELECT" || tag === "OPTION") return "";
  const filhos = el.childNodes ? Array.from(el.childNodes) : [];
  if (filhos.length === 0 || limite <= 0) return String(el.textContent ?? "");
  let out = "";
  for (const n of filhos as any[]) {
    if (n?.nodeType === 3) out += String(n.textContent ?? "");
    else if (n?.nodeType === 1) out += " " + textoVisivel(n, limite - 1);
    if (out.length > 600) break;
  }
  return out;
}

/**
 * O campo a que a mensagem pertence, quando pertence a algum (RF-MSG-05).
 *
 * Três caminhos, do mais explícito ao mais comum, e é isto que distingue um erro
 * de validação de um erro de operação: uma mensagem que aponta para um campo é do
 * campo, e vai para a equipa que desenhou o formulário.
 */
export function campoAssociado(documento: any, el: any): any {
  try {
    const id = atributo(el, "id");
    if (id && documento?.querySelector) {
      const dono = documento.querySelector(
        `[aria-errormessage="${id}"], [aria-describedby~="${id}"]`,
      );
      if (dono) return dono;
    }
    const nome = atributo(el, "data-uxda-campo") || atributo(el, "data-campo") || atributo(el, "for");
    if (nome && documento?.querySelector) {
      const porNome = documento.querySelector(`#${CSS_ESCAPE(nome)}, [name="${nome}"]`);
      if (porNome) return porNome;
    }
    // O caso comum: a mensagem vive dentro do mesmo invólucro do campo.
    //
    // **Com duas guardas, e as duas custaram um ensaio.** A subida pára no
    // formulário e no corpo da página, senão um aviso de página inteira apanhava
    // o primeiro campo que houvesse no ecrã; e o invólucro tem de ter **um** campo
    // e não vários, porque um invólucro com três campos é uma secção, e a mensagem
    // que lá vive é da secção e não de nenhum deles.
    let pai = el?.parentElement;
    for (let i = 0; i < 3 && pai; i++) {
      const tag = String(pai.tagName ?? "").toUpperCase();
      if (tag === "FORM" || tag === "BODY" || tag === "HTML" || tag === "MAIN") break;
      const campos = pai.querySelectorAll?.("input, textarea, select");
      if (campos && campos.length === 1) return campos[0];
      if (campos && campos.length > 1) break;
      pai = pai.parentElement;
    }
  } catch { /* uma mensagem sem campo é o caso normal */ }
  return null;
}

/** Sem `CSS.escape` no ambiente de ensaio, e um identificador nosso não precisa de mais. */
function CSS_ESCAPE(s: string): string {
  return s.replace(/[^\w-]/g, "");
}

/* ---------------------------------------------------------------- ligação */

export function ligarMensagens(janela: any, documento: any, ctx: ContextoDeMensagens): LigacaoDeMensagens {
  const desligadores: Array<() => void> = [];
  // A mesma mensagem que reaparece de segundo a segundo é uma mensagem, e não
  // vinte. O que se guarda é a chave e o instante, e nunca o texto.
  const vistas = new Map<string, number>();
  const JANELA_REPETIDA_MS = 1500;

  const jaContou = (chave: string): boolean => {
    const agora = ctx.agora();
    const antes = vistas.get(chave);
    if (antes !== undefined && agora - antes < JANELA_REPETIDA_MS) return true;
    vistas.set(chave, agora);
    // A tabela não cresce sem fim: uma aplicação com centenas de mensagens
    // diferentes é rara, e uma com milhares é um vazamento de memória nosso.
    if (vistas.size > 200) {
      for (const [k, q] of vistas) if (agora - q > 60_000) vistas.delete(k);
    }
    return false;
  };

  const emitirMensagem = (dados: {
    chave?: string;
    texto?: string;
    tipo: TipoDeMensagem;
    classe?: ClasseDeErro;
    elemento?: string;
    campo?: string;
    origem: "chave" | "texto" | "declarada" | "rede" | "servidor";
    extra?: Record<string, unknown>;
    visivel: boolean;
  }) => {
    const propriedades: Record<string, unknown> = {
      origem_mensagem: dados.origem,
      visivel: dados.visivel,
      ...(dados.extra ?? {}),
    };
    if (dados.classe) propriedades["classe_erro"] = dados.classe;
    if (dados.campo) propriedades["campo_associado"] = dados.campo.slice(0, 64);
    const passo = ctx.passo();
    if (passo) propriedades["passo"] = passo.slice(0, 64);

    let chave = dados.chave;
    let texto: string | undefined;
    if (dados.texto) {
      // Mascarado **sempre**, e a lista de permissões só levanta a mascaragem
      // estrutural (nomes e citações). O chão que nunca se levanta são os
      // números, os identificadores e o correio electrónico: esses punham-nos em
      // falta independentemente de quem os autorizou, e a ingestão recusa-os.
      const mascarada = mascararMensagem(dados.texto);
      const grupo = esqueletoDeMensagem(mascarada);
      if (grupo) propriedades["grupo_mensagem"] = resumo(grupo);
      if (!chave) chave = `txt_${resumo(normalizarTexto(mascarada))}`;
      // Exposta ou não, o `mascarar` corre **sempre**: a lista levanta a
      // mascaragem estrutural (nomes e citações) e nunca o chão. A primeira
      // versão devolvia o texto cru, e o ensaio do chão apanhou-a.
      texto = (ctx.exposta(chave) ? mascarar(dados.texto) : mascarada).slice(0, MAX_TEXTO);
    }
    if (!chave) return;
    if (jaContou(`${chave}|${dados.visivel}`)) return;

    ctx.emitir("mensagem", {
      element_key: dados.elemento,
      message_key: chave.slice(0, 256),
      message_kind: dados.tipo,
      message_text_masked: texto,
      properties: propriedades,
    });
  };

  /* ------------------------------------------------- o que aparece no ecrã */

  const jaVistos = new WeakSet<object>();

  /**
   * Um contentor de mensagens **não é uma mensagem**.
   *
   * O invólucro onde a aplicação empilha os avisos costuma ter `aria-live` ou uma
   * classe com `mensagens` ou `toasts`, e por isso passa no `ehMensagem`; o texto
   * dele é a soma dos filhos. Sem esta pergunta, cada mensagem contava duas vezes,
   * uma pelo filho e outra pelo pai, e a segunda com a classificação do invólucro.
   *
   * Apanhado no ensaio em telemóvel do cartão 5.1, do lado do Android, e corrigido
   * nos dois no mesmo gesto: a mesma mensagem chegou ao armazenamento duas vezes,
   * uma como `info` e outra como `aviso`. **A mensagem é sempre a mais funda**,
   * porque é a que alguém escreveu.
   */
  const temMensagemDentro = (el: any, profundidade = 4): boolean => {
    if (!el?.children || profundidade <= 0) return false;
    for (const filho of Array.from(el.children) as any[]) {
      if (ehMensagem(filho)) return true;
      if (temMensagemDentro(filho, profundidade - 1)) return true;
    }
    return false;
  };

  const analisar = (el: any) => {
    if (!ehMensagem(el)) return;
    if (temMensagemDentro(el)) return;
    // Um nó só se conta uma vez, mesmo que o observador o veja duas: o `linkedom`
    // e os browsers entregam a mesma alteração de atributo em dois registos.
    if (jaVistos.has(el)) return;
    const texto = textoVisivel(el).replace(/\s+/g, " ").trim();
    let chave = "";
    for (const a of ATRIBUTOS_DE_CHAVE) {
      chave = atributo(el, a);
      if (chave) break;
    }
    // Sem chave e sem texto não há mensagem nenhuma: é um invólucro vazio à
    // espera de ser preenchido, e as aplicações têm dezenas deles no ecrã.
    if (!chave && !texto) return;
    jaVistos.add(el);

    const tipo = tipoDe(el);
    const campo = campoAssociado(documento, el);
    const declarada = atributo(el, "data-uxda-classe").toLowerCase();
    const classe: ClasseDeErro | undefined = tipo !== "erro"
      ? undefined
      : declarada === "sistema" || declarada === "validacao" || declarada === "operacao"
        ? (declarada as ClasseDeErro)
        : campo ? "validacao" : "operacao";

    emitirMensagem({
      chave: chave || undefined,
      texto: chave ? undefined : texto,
      tipo,
      classe,
      elemento: ctx.chaveDe(el),
      campo: campo ? ctx.chaveDe(campo) : undefined,
      origem: chave ? "chave" : "texto",
      visivel: true,
    });
  };

  const varrer = (no: any, profundidade = 6) => {
    if (!no || no.nodeType !== 1 || profundidade < 0) return;
    analisar(no);
    // Uma mensagem costuma vir dentro do que foi acrescentado, e não a ser o que
    // foi acrescentado: um `div` de página inteira com o alerta lá dentro.
    const filhos = no.children ? Array.from(no.children) : [];
    for (const f of filhos as any[]) varrer(f, profundidade - 1);
  };

  const Observador = janela?.MutationObserver;
  if (typeof Observador === "function" && documento?.body) {
    const observador = new Observador(
      protegido("captura.mensagens", (registos: any[]) => {
        for (const r of registos ?? []) {
          if (r.type === "attributes") analisar(r.target);
          for (const n of Array.from(r.addedNodes ?? [])) varrer(n);
        }
      }, undefined),
    );
    try {
      observador.observe(documento.body, {
        childList: true,
        subtree: true,
        attributes: true,
        // Uma aplicação que já tem o `div` no ecrã e só lhe muda a classe para o
        // mostrar não acrescenta nó nenhum: sem os atributos, metade das
        // mensagens do mundo real não era vista.
        attributeFilter: ["class", "role", "aria-live", "hidden", "data-uxda-mensagem", "data-mensagem"],
      });
      desligadores.push(() => observador.disconnect());
    } catch { /* sem observador, fica a API pública e a rede */ }
  }

  // O que já estava no ecrã quando o SDK arrancou. Uma página servida pelo
  // servidor com o erro já lá dentro nunca dispara mutação nenhuma.
  try {
    const iniciais = documento?.body?.querySelectorAll?.(
      '[role="alert"], [role="status"], [aria-live], output, [data-uxda-mensagem], [data-mensagem]',
    );
    for (const el of Array.from(iniciais ?? []) as any[]) analisar(el);
  } catch { /* nada */ }

  return {
    declarar(chave: string, tipo: TipoDeMensagem, extras?: Record<string, unknown>) {
      if (!chave) return;
      const classe = extras?.["classe_erro"];
      emitirMensagem({
        chave,
        tipo,
        classe: typeof classe === "string" ? (classe as ClasseDeErro) : tipo === "erro" ? "operacao" : undefined,
        origem: "declarada",
        visivel: true,
        extra: extras?.["operacao"] ? { operacao: String(extras["operacao"]).slice(0, 64) } : undefined,
      });
    },
    tecnico(chave: string, propriedades: Record<string, unknown>, elemento?: string) {
      emitirMensagem({
        chave,
        tipo: "erro",
        classe: (propriedades["classe_erro"] as ClasseDeErro) ?? "sistema",
        elemento,
        origem: "rede",
        visivel: false,
        extra: propriedades,
      });
    },
    desligar() {
      for (const d of desligadores.splice(0)) {
        try { d(); } catch { /* desligar não pode falhar */ }
      }
      vistas.clear();
    },
  };
}
