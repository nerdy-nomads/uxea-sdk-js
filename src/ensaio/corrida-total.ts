/**
 * A corrida inteira do 18.2, partilhada pela bateria de fuga e pelo ensaio da página
 * dos campos (cartão 18.5): o SDK todo, sobre uma página com segredos em todo o lado,
 * com todos os caminhos de captura exercidos.
 */
import { criarBrowser, disparar } from "./duplo.ts";
import { iniciar } from "../index.ts";

export const SEGREDOS = [
  "005123456LA041", "ana.silva@exemplo.ao", "+244923000111", "4111111111111111",
  "AO06000600000100037131174", "Ana Maria da Silva", "Rua Amilcar Cabral 42", "senha-super-secreta",
];

/**
 * Procura um segredo **em todas as formas em que pode sair**: tal e qual, em
 * minúsculas, codificado num endereço, e (para os que são números) só os algarismos,
 * com ou sem separadores pelo meio. Um detetor que só procura a forma escrita deixava
 * passar `ana.silva%40exemplo.ao` e `4111 1111 1111 1111`.
 */
export function fugas(bruto: string, segredos: ReadonlyArray<string> = SEGREDOS): string[] {
  let decodificado = bruto;
  try { decodificado = decodeURIComponent(bruto.replace(/%(?![0-9a-f]{2})/gi, "%25")); } catch { /* fica o bruto */ }
  const textos = [bruto, decodificado, bruto.toLowerCase(), decodificado.toLowerCase()];
  const soDigitos = decodificado.replace(/[^\d]/g, "");
  const out: string[] = [];
  for (const s of segredos) {
    const formas = [s, s.toLowerCase(), encodeURIComponent(s)];
    let achou = formas.some((f) => textos.some((t) => t.includes(f)));
    const d = s.replace(/[^\d]/g, "");
    if (!achou && d.length >= 9) achou = soDigitos.includes(d);
    if (achou) out.push(s);
  }
  return out;
}

export const CAMINHO = "/clientes/ana.silva@exemplo.ao/contas/AO06000600000100037131174";

export const PAGINA = `
  <nav>
    <a id="perfil" href="/clientes/005123456LA041/perfil?email=ana.silva@exemplo.ao" data-caixa="0,0,100,20">O meu perfil</a>
    <a id="ajuda" href="https://ajuda.exemplo.ao/tickets/4111111111111111" data-caixa="100,0,100,20">Ajuda</a>
  </nav>
  <form id="f" action="/pagar/+244923000111">
    <label for="nome">Nome</label>
    <input id="nome" name="nome" data-testid="titular-ana.silva@exemplo.ao" data-caixa="0,30,200,30">
    <input id="bi" name="bi" data-testid="bi_005123456LA041" data-caixa="0,70,200,30">
    <input id="senha" name="senha" type="password" data-caixa="0,110,200,30">
    <textarea id="morada" name="morada" data-caixa="0,150,200,60"></textarea>
    <button id="pagar" type="submit" data-caixa="0,220,100,30">Pagar a Ana Maria da Silva</button>
    <button id="desligado" type="button" disabled data-caixa="120,220,100,30">Confirmar 4111111111111111</button>
  </form>
  <div id="avisos"></div>
  <div id="vazio" data-caixa="0,400,400,300"></div>
`;

export async function corrida(nivel: "essencial" | "padrao" | "detalhado", configExtra: Record<string, unknown> = {}) {
  const br = criarBrowser(PAGINA, { caminho: CAMINHO });
  br.janela.location.hash = "#/detalhe/4111111111111111";
  br.janela.scrollY = 0;
  br.janela.navigator.connection = { effectiveType: "4g", addEventListener() {}, removeEventListener() {} };
  // A aplicação a fazer pedidos com dados no endereço, e um deles a falhar.
  // Lento de propósito: 800 ms no relógio do ensaio, que é o que faz nascer a espera e
  // o toque em carregamento.
  br.janela.fetch = (url: string) => new Promise((ok) => br.janela.setTimeout(() =>
    ok({ status: String(url).includes("falha") ? 500 : 200, ok: !String(url).includes("falha") }), 800));
  br.responder((p) => p.url.includes("/v1/config")
    ? { estado: 200, corpo: JSON.stringify({ dados: { amostragem: 1, nivel, versao: 1, amostragem_detalhado: 1, rastreio_individual: true, ...configExtra } }) }
    : { estado: 202, corpo: "{}" });
  const uxda = iniciar({ chave: "uxda_des_teste", servidor: "https://ingest.local", ambiente: br.ambiente() });
  await br.avancar(10);

  const tocar = (seletor: string, x: number, y: number) => {
    disparar(br.documento, seletor, "pointerdown", { clientX: x, clientY: y });
    disparar(br.documento, seletor, "click", { clientX: x, clientY: y });
  };
  tocar("#perfil", 10, 5);
  tocar("#vazio", 50, 500);
  tocar("#desligado", 130, 230);
  for (let i = 0; i < 4; i++) tocar("#pagar", 10, 230);
  await br.avancar(4000);
  const valores: Record<string, string> = { nome: SEGREDOS[5]!, bi: SEGREDOS[0]!, senha: SEGREDOS[7]!, morada: SEGREDOS[6]! };
  for (const [id, v] of Object.entries(valores)) {
    disparar(br.documento, "#" + id, "focusin");
    (br.documento.querySelector("#" + id) as any).value = v;
    disparar(br.documento, "#" + id, "input", { inputType: "insertText", data: v });
    disparar(br.documento, "#" + id, "keydown", { key: v[0] });
    disparar(br.documento, "#" + id, "focusout");
  }
  disparar(br.documento, "#bi", "invalid");
  disparar(br.documento, "#f", "submit");
  const avisos = br.documento.querySelector("#avisos")!;
  const m = br.documento.createElement("div");
  m.setAttribute("role", "alert");
  m.setAttribute("class", "erro");
  m.textContent = "O IBAN AO06000600000100037131174 de Ana Maria da Silva foi recusado";
  avisos.appendChild(m);
  await br.avancar(30);

  // A rede da aplicação: um pedido que corre bem e um que falha, com dados no endereço.
  const lento = br.janela.fetch(`https://api.exemplo.ao/clientes/${SEGREDOS[1]}/movimentos?nif=${SEGREDOS[0]}`);
  await br.avancar(100);
  tocar("#pagar", 12, 232); // a meio do pedido: um toque em carregamento
  await br.avancar(900);
  await lento;
  const falha = br.janela.fetch(`https://api.exemplo.ao/falha/${SEGREDOS[3]}?tel=${encodeURIComponent(SEGREDOS[2]!)}`);
  await br.avancar(900);
  await falha;
  br.janela.dispararJanela("offline");
  br.janela.dispararJanela("online");
  // Deslocamento, rede e espera.
  br.janela.scrollY = 600;
  br.janela.dispararJanela("scroll");
  await br.avancar(1200);
  // A API inteira, com o que um programador da instituição lá poria a depurar.
  uxda.ecra(`detalhe ${SEGREDOS[1]}`);
  uxda.passo(`confirmar_${SEGREDOS[0]}`);
  uxda.track(`pagou_${SEGREDOS[4]}`, { segmento: SEGREDOS[5], canal: SEGREDOS[6], nota: SEGREDOS[7], valor_monetario: 12400 });
  uxda.mensagem(`recusado_${SEGREDOS[3]}`, "erro", { operacao: `pagamento ${SEGREDOS[1]}` });
  uxda.erroTecnico("resposta_ilegivel", { operacao: SEGREDOS[2] });
  await uxda.identificar(SEGREDOS[5]!);
  uxda.terminal("erro");
  br.janela.history.state = { idx: 0 };
  br.janela.dispararJanela("popstate", { state: { idx: 0 } });
  (br.documento as any).visibilityState = "hidden";
  disparar(br.documento, "body", "visibilitychange");
  await uxda.descarregar();
  await br.avancar(30000);
  return { bruto: JSON.stringify(br.pedidos), eventos: br.eventos(), pedidos: br.pedidos.length };
}

