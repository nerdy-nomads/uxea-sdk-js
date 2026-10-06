/**
 * O componente de avaliação embutido. Cartão 14.1, RF-PER-01 a RF-PER-03.
 *
 * **Aparece sem uma linha de código da instituição**, a partir da configuração
 * remota, e é o RF-PER-01 à letra: um componente que exigisse desenvolvimento
 * para aparecer não era embutido, era uma biblioteca.
 *
 * Quatro decisões, e todas se veem a usar:
 *
 *  1. **Não bloqueia nada.** Um cartão no canto de baixo, sem camada por cima da
 *     página, sem prender o foco e sem o roubar: quem está a escrever continua a
 *     escrever, e a página continua a responder a tudo enquanto o cartão está
 *     aberto. É `role="dialog"` com `aria-modal="false"`, que é o que ele é. Um
 *     inquérito que interrompe a tarefa mede a interrupção, e a fadiga que o
 *     RF-PER-05 quer evitar começa exatamente aí.
 *  2. **Vive numa árvore sombra.** O CSS da página não lhe chega e o dele não sai,
 *     e é o que faz a personalização do RF-PER-02 ser do tema e não da sorte: sem
 *     isto, um `button { width: 100% }` da instituição desfazia a escala. E é o que
 *     faz a captura não o ver (ver `captura/fora.ts`).
 *  3. **O tema entra por propriedades personalizadas de CSS**, escritas pelo CSSOM
 *     (`style.setProperty`), e a folha entra por `adoptedStyleSheets` quando o
 *     browser a tem. Nenhuma das duas é bloqueada por uma política de segurança de
 *     conteúdo que proíba estilos em linha, e uma instituição com CSP apertada é
 *     precisamente o género de instituição que compra isto.
 *  4. **O conteúdo monta-se com `createElement` e `textContent`**, e nunca a partir
 *     de marcação em texto. A pergunta e as opções vêm da consola da instituição, e
 *     um texto nunca pode virar um elemento.
 *
 * Acessível pelo teclado de ponta a ponta: os pontos das escalas são botões de
 * opção nativos (as setas andam entre eles), as opções têm rótulo visível, o
 * `Escape` fecha quando o foco está lá dentro, e em ecrãs estreitos ou de toque
 * cada alvo tem pelo menos 44 píxeis.
 */
import { protegido, protegidoAsync } from "../safe.ts";
import { ATRIBUTO_FORA } from "../captura/fora.ts";
import type { RegraDeInquerito, TemaDeInquerito } from "../core/tipos.ts";
import type { Entrega, Respondido } from "./envio.ts";

/** O nome do hospedeiro. Um elemento próprio, para nenhum `div { }` da página lhe tocar. */
export const ETIQUETA = "uxea-inquerito";

/** Quanto tempo o agradecimento fica à vista antes de o cartão se fechar sozinho. */
export const AGRADECIMENTO_MS = 2500;

export const ESCALAS: Record<"esforco" | "satisfacao" | "recomendacao", readonly [number, number]> = {
  esforco: [1, 7],
  satisfacao: [1, 5],
  recomendacao: [0, 10],
};

interface Textos {
  dialogo: string;
  fechar: string;
  enviar: string;
  aEnviar: string;
  obrigado: string;
  falhou: string;
  comentario: string;
  livre: string;
  privacidade: string;
  faltaNota: string;
  faltaEscolha: string;
  faltaTexto: string;
  extremos: Record<"esforco" | "satisfacao" | "recomendacao", readonly [string, string]>;
}

export const TEXTOS: Record<"pt" | "en", Textos> = {
  pt: {
    dialogo: "Inquérito",
    fechar: "Fechar",
    enviar: "Enviar",
    aEnviar: "A enviar...",
    obrigado: "Obrigado pela resposta.",
    falhou: "Não foi possível enviar a resposta.",
    comentario: "Quer acrescentar alguma coisa? (opcional)",
    livre: "A sua resposta",
    privacidade: "Não escreva dados pessoais: números e endereços de correio são retirados antes de enviar.",
    faltaNota: "Escolha um valor da escala.",
    faltaEscolha: "Escolha pelo menos uma opção.",
    faltaTexto: "Escreva a sua resposta.",
    extremos: {
      esforco: ["Muito difícil", "Muito fácil"],
      satisfacao: ["Nada satisfeito", "Muito satisfeito"],
      recomendacao: ["Nada provável", "Muito provável"],
    },
  },
  en: {
    dialogo: "Survey",
    fechar: "Close",
    enviar: "Send",
    aEnviar: "Sending...",
    obrigado: "Thank you for your answer.",
    falhou: "The answer could not be sent.",
    comentario: "Anything to add? (optional)",
    livre: "Your answer",
    privacidade: "Please do not write personal data: numbers and email addresses are removed before sending.",
    faltaNota: "Choose a value on the scale.",
    faltaEscolha: "Choose at least one option.",
    faltaTexto: "Write your answer.",
    extremos: {
      esforco: ["Very difficult", "Very easy"],
      satisfacao: ["Not at all satisfied", "Very satisfied"],
      recomendacao: ["Not at all likely", "Extremely likely"],
    },
  },
};

/**
 * A folha do componente.
 *
 * **Sem camada nenhuma por cima da página**: o cartão é a única caixa, fixa no
 * canto, e nada aqui cobre o resto do ecrã nem lhe tira os eventos. As cores são
 * todas do tema; o cinzento das bordas é translúcido de propósito, para funcionar
 * sobre um fundo claro e sobre um escuro sem o tema ter de o dizer.
 */
export const FOLHA = `
:host{all:initial}
.cartao{position:fixed;right:16px;bottom:16px;z-index:2147483000;box-sizing:border-box;width:360px;max-width:calc(100vw - 32px);max-height:calc(100vh - 32px);overflow:auto;padding:16px;background:var(--uxea-fundo);color:var(--uxea-texto);font:15px/1.45 var(--uxea-fonte);border-radius:var(--uxea-cantos);box-shadow:0 10px 30px rgba(0,0,0,.18),0 0 0 1px rgba(127,127,127,.25);text-align:left}
.cartao *{box-sizing:border-box;font:inherit;color:inherit}
.topo{display:flex;align-items:flex-start;gap:8px}
.pergunta{flex:1;margin:0;font-size:16px;font-weight:600}
.fechar{flex:none;width:32px;height:32px;margin:-6px -6px 0 0;padding:0;border:0;border-radius:var(--uxea-cantos);background:transparent;font-size:20px;line-height:1;cursor:pointer}
.escala,.opcoes{display:flex;flex-wrap:wrap;gap:6px;margin:12px 0 4px;padding:0;border:0}
.opcoes{flex-direction:column}
.ponto,.opcao{position:relative;cursor:pointer}
.ponto{flex:1 0 auto}
.ponto input,.opcao input{position:absolute;width:1px;height:1px;margin:0;opacity:0}
.ponto span{display:flex;align-items:center;justify-content:center;min-width:26px;height:36px;padding:0 4px;border:1px solid rgba(127,127,127,.45);border-radius:calc(var(--uxea-cantos) / 2)}
.opcao span{display:flex;align-items:center;min-height:36px;padding:6px 10px;border:1px solid rgba(127,127,127,.45);border-radius:calc(var(--uxea-cantos) / 2)}
input:checked+span{background:var(--uxea-primaria);border-color:var(--uxea-primaria);color:var(--uxea-fundo)}
input:focus-visible+span,button:focus-visible,textarea:focus-visible{outline:2px solid var(--uxea-primaria);outline-offset:2px}
.extremos{display:flex;justify-content:space-between;gap:8px;font-size:12px;opacity:.75}
.rotulo{display:block;margin:12px 0 4px;font-size:13px;font-weight:600}
textarea{display:block;width:100%;min-height:64px;padding:8px;border:1px solid rgba(127,127,127,.45);border-radius:calc(var(--uxea-cantos) / 2);background:transparent;resize:vertical}
.privacidade{margin:4px 0 0;font-size:12px;opacity:.75}
.aviso{margin:8px 0 0;font-size:13px}
.aviso:empty{display:none}
.acoes{display:flex;justify-content:flex-end;margin-top:12px}
.enviar{min-height:36px;padding:0 16px;border:0;border-radius:calc(var(--uxea-cantos) / 2);background:var(--uxea-primaria);color:var(--uxea-fundo);font-weight:600;cursor:pointer}
.enviar[aria-disabled="true"]{opacity:.6;cursor:progress}
.fim{margin:0;font-weight:600}
.invisivel{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
@media (max-width:480px){.cartao{left:8px;right:8px;bottom:8px;width:auto;max-width:none}}
@media (max-width:480px),(pointer:coarse){.ponto span{min-width:44px;min-height:44px}.opcao span{min-height:44px}.fechar{width:44px;height:44px}.enviar{min-width:44px;min-height:44px}textarea{font-size:16px}}
@media print{.cartao{display:none}}
`;

export interface OpcoesDoComponente {
  janela: any;
  documento: any;
  regra: RegraDeInquerito;
  tema: TemaDeInquerito;
  agora(): number;
  /** Entrega a resposta. O componente mostra o resultado, e nunca guarda o que foi escrito. */
  aoEnviar(r: Respondido): Promise<Entrega>;
  aoFechar(motivo: "fechado" | "respondido"): void;
}

export interface Componente {
  hospedeiro: any;
  /** A raiz da árvore sombra. Aberta, para os ensaios e as ferramentas de acessibilidade. */
  raiz: any;
  fechar(): void;
}

/** O browser sabe desenhar isto? Sem árvore sombra não se pede licença a ninguém. */
export function podeDesenhar(documento: any): boolean {
  try {
    return !!documento?.body && typeof documento.createElement === "function"
      && typeof documento.body.attachShadow === "function";
  } catch {
    return false;
  }
}

/** Há um componente à vista nesta página, deste SDK ou de outra instância dele. */
export function haUmAVista(documento: any): boolean {
  try {
    return !!documento?.querySelector?.(ETIQUETA);
  } catch {
    return false;
  }
}

function criar(doc: any, etiqueta: string, atributos: Record<string, string> = {}, texto?: string): any {
  const el = doc.createElement(etiqueta);
  for (const [k, v] of Object.entries(atributos)) el.setAttribute(k, v);
  if (texto !== undefined) el.textContent = texto;
  return el;
}

function aplicarFolha(raiz: any, doc: any, janela: any): void {
  try {
    const Folha = janela?.CSSStyleSheet;
    if (typeof Folha === "function" && "adoptedStyleSheets" in raiz) {
      const folha = new Folha();
      folha.replaceSync(FOLHA);
      raiz.adoptedStyleSheets = [folha];
      return;
    }
  } catch { /* segue para o elemento de estilo */ }
  raiz.appendChild(criar(doc, "style", {}, FOLHA));
}

export function desenharInquerito(op: OpcoesDoComponente): Componente {
  const { documento: doc, janela, regra, tema } = op;
  const idioma = tema.idioma;
  const t = TEXTOS[idioma];
  const escala = regra.formato === "esforco" || regra.formato === "satisfacao" || regra.formato === "recomendacao"
    ? regra.formato : null;

  const hospedeiro = doc.createElement(ETIQUETA);
  hospedeiro.setAttribute(ATRIBUTO_FORA, "");
  hospedeiro.style?.setProperty?.("all", "initial");
  const raiz = hospedeiro.attachShadow({ mode: "open" });
  aplicarFolha(raiz, doc, janela);

  const cartao = criar(doc, "section", {
    class: "cartao", role: "dialog", "aria-modal": "false", "aria-labelledby": "uxea-pergunta", lang: idioma,
  });
  const propriedades: Array<[string, string]> = [
    ["--uxea-primaria", tema.corPrimaria],
    ["--uxea-fundo", tema.corFundo],
    ["--uxea-texto", tema.corTexto],
    ["--uxea-fonte", tema.fonte],
    ["--uxea-cantos", `${tema.cantosPx}px`],
  ];
  for (const [nome, valor] of propriedades) cartao.style.setProperty(nome, valor);

  const temporizadores: any[] = [];
  const depois = (ms: number, fn: () => void) => {
    if (typeof janela?.setTimeout !== "function") return;
    temporizadores.push(janela.setTimeout(protegido("inquerito.temporizador", fn, undefined), ms));
  };

  let fechado = false;
  let aEnviar = false;
  const fechar = (motivo: "fechado" | "respondido") => {
    if (fechado) return;
    fechado = true;
    for (const id of temporizadores.splice(0)) {
      try { janela?.clearTimeout?.(id); } catch { /* nada */ }
    }
    try { hospedeiro.remove(); } catch { /* já saiu */ }
    op.aoFechar(motivo);
  };

  // Todos os ouvintes dentro da barreira: um erro aqui corria no despacho de
  // eventos da página, e chegava ao relatório de erros da instituição com a cara
  // dela.
  const ouvir = (el: any, evento: string, fn: (e: any) => unknown) => {
    el.addEventListener(evento, protegido(`inquerito.${evento}`, fn, undefined));
  };

  /* ------------------------------------------------------------- o topo */

  const topo = criar(doc, "div", { class: "topo" });
  topo.appendChild(criar(doc, "h2", { id: "uxea-pergunta", class: "pergunta" }, regra.pergunta[idioma]));
  const botaoFechar = criar(doc, "button", { type: "button", class: "fechar", "aria-label": t.fechar, title: t.fechar }, "×");
  ouvir(botaoFechar, "click", () => fechar("fechado"));
  topo.appendChild(botaoFechar);
  cartao.appendChild(topo);

  const corpo = criar(doc, "div", { class: "corpo" });
  cartao.appendChild(corpo);
  // Onde se diz o que falta. Criado já, e posto no fim do corpo mais abaixo.
  const aviso = criar(doc, "p", { class: "aviso", role: "status" });

  /* ------------------------------------------------------ escala ou escolha */

  let nota: number | null = null;
  const escolhas = new Set<string>();

  if (escala) {
    const [min, max] = ESCALAS[escala];
    const [baixo, alto] = t.extremos[escala];
    const grupo = criar(doc, "div", { class: "escala", role: "radiogroup", "aria-labelledby": "uxea-pergunta" });
    for (let n = min; n <= max; n++) {
      const rotulo = criar(doc, "label", { class: "ponto" });
      const entrada = criar(doc, "input", { type: "radio", name: "uxea-nota", value: String(n) });
      // Os extremos dizem o que o número quer dizer, e o nome acessível leva-o: um
      // leitor de ecrã que só dissesse "1" não dizia se 1 é bom ou mau.
      if (n === min) entrada.setAttribute("aria-label", `${n} (${baixo.toLowerCase()})`);
      if (n === max) entrada.setAttribute("aria-label", `${n} (${alto.toLowerCase()})`);
      ouvir(entrada, "change", () => { nota = n; aviso.textContent = ""; });
      rotulo.appendChild(entrada);
      rotulo.appendChild(criar(doc, "span", {}, String(n)));
      grupo.appendChild(rotulo);
    }
    corpo.appendChild(grupo);
    const extremos = criar(doc, "div", { class: "extremos", "aria-hidden": "true" });
    extremos.appendChild(criar(doc, "span", {}, baixo));
    extremos.appendChild(criar(doc, "span", {}, alto));
    corpo.appendChild(extremos);
  } else if (regra.formato === "escolha") {
    const grupo = criar(doc, "div", {
      class: "opcoes", role: regra.multipla ? "group" : "radiogroup", "aria-labelledby": "uxea-pergunta",
    });
    for (const opcao of regra.opcoes) {
      const rotulo = criar(doc, "label", { class: "opcao" });
      const entrada = criar(doc, "input", {
        type: regra.multipla ? "checkbox" : "radio", name: "uxea-escolha", value: opcao.chave,
      });
      ouvir(entrada, "change", () => {
        if (!regra.multipla) escolhas.clear();
        if (regra.multipla && !entrada.checked) escolhas.delete(opcao.chave);
        else escolhas.add(opcao.chave);
        aviso.textContent = "";
      });
      rotulo.appendChild(entrada);
      rotulo.appendChild(criar(doc, "span", {}, opcao[idioma]));
      grupo.appendChild(rotulo);
    }
    corpo.appendChild(grupo);
  }

  /* --------------------------------------------------------- o texto livre */

  let caixa: any = null;
  if (regra.formato === "livre" || regra.comentario) {
    const livre = regra.formato === "livre";
    corpo.appendChild(criar(doc, "label", { class: "rotulo", for: "uxea-comentario" }, livre ? t.livre : t.comentario));
    caixa = criar(doc, "textarea", {
      id: "uxea-comentario", rows: "3", maxlength: "500", autocomplete: "off",
      "aria-describedby": "uxea-privacidade", ...(livre ? { required: "", "aria-required": "true" } : {}),
    });
    corpo.appendChild(caixa);
    // Dito a quem escreve, e não só feito: o que sai é mascarado, e uma pessoa que
    // escreve o número de uma encomenda merece saber que ele não vai chegar.
    corpo.appendChild(criar(doc, "p", { id: "uxea-privacidade", class: "privacidade" }, t.privacidade));
  }

  corpo.appendChild(aviso);

  /* ------------------------------------------------------------ o envio */

  const acoes = criar(doc, "div", { class: "acoes" });
  const botaoEnviar = criar(doc, "button", { type: "button", class: "enviar" }, t.enviar);
  acoes.appendChild(botaoEnviar);
  corpo.appendChild(acoes);

  const terminar = (texto: string) => {
    // O que foi escrito sai do ecrã **antes** de qualquer outra coisa: o
    // agradecimento substitui o corpo inteiro, e a caixa de texto vai com ele.
    try { corpo.remove(); } catch { /* nada */ }
    cartao.removeAttribute("aria-labelledby");
    cartao.setAttribute("aria-label", t.dialogo);
    cartao.appendChild(criar(doc, "p", { class: "fim", role: "status" }, texto));
    depois(AGRADECIMENTO_MS, () => fechar("respondido"));
  };

  ouvir(botaoEnviar, "click", protegidoAsync("inquerito.enviar", async () => {
    if (aEnviar || fechado) return;
    if (escala && nota === null) { aviso.textContent = t.faltaNota; return; }
    if (regra.formato === "escolha" && escolhas.size === 0) { aviso.textContent = t.faltaEscolha; return; }
    const texto = caixa ? String(caixa.value ?? "") : "";
    if (regra.formato === "livre" && !texto.trim()) { aviso.textContent = t.faltaTexto; return; }

    aEnviar = true;
    botaoEnviar.setAttribute("aria-disabled", "true");
    botaoEnviar.textContent = t.aEnviar;
    const ocorridaEm = op.agora();
    let resultado: Entrega = "falhou";
    try {
      resultado = await op.aoEnviar({ nota: escala ? nota : null, escolhas: [...escolhas], comentario: texto, ocorridaEm });
    } catch { /* uma entrega que lança é uma entrega que falhou */ }
    if (fechado) return;
    terminar(resultado === "aceite" ? t.obrigado : t.falhou);
  }, undefined));

  // O `Escape` fecha, **só com o foco lá dentro**: com o foco na página, a tecla é
  // da página, e pode estar a fechar um diálogo dela.
  ouvir(cartao, "keydown", (e: any) => {
    if (e?.key !== "Escape" && e?.key !== "Esc") return;
    e.stopPropagation?.();
    fechar("fechado");
  });

  raiz.appendChild(cartao);

  // O anúncio. Um diálogo que não é modal não recebe o foco, e por isso um leitor
  // de ecrã não dava por ele: a região viva diz que apareceu, sem tirar ninguém de
  // onde está.
  const anuncio = criar(doc, "span", { class: "invisivel", role: "status" });
  raiz.appendChild(anuncio);
  depois(100, () => { anuncio.textContent = `${t.dialogo}: ${regra.pergunta[idioma]}`; });

  doc.body.appendChild(hospedeiro);
  return { hospedeiro, raiz, fechar: () => fechar("fechado") };
}
