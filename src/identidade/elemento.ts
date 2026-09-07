/**
 * A cadeia de sinais, serializada para o campo `element_key`. ADR 0003 e 0018.
 *
 * O esquema canónico diz, na nota do campo: *"o tuplo de sinais do ADR 0003,
 * serializado"*. É isto. O dispositivo **não decide** qual é a identidade final
 * do elemento: manda os cinco sinais, e o servidor reconcilia contra o que já
 * conhece daquele projeto. É essa divisão que faz um elemento sobreviver a uma
 * mudança de esquema entre duas versões da aplicação.
 *
 * O formato é deliberadamente aborrecido: texto plano, campos por `|`, chave e
 * valor por `=`. Cabe nos 512 caracteres do esquema, lê-se num registo sem
 * ferramenta nenhuma, e não obriga o servidor a desserializar JSON por evento.
 */
import type { Chave, Sinais } from "../identity/element.ts";

/** Quanto pode ocupar cada sinal. A soma cabe nos 512 do esquema, com folga. */
const LIMITE: Record<keyof Sinais, number> = {
  testid: 80, caminho: 200, rotulo: 32, destino: 120, papel: 40,
};

const CODIGO: Record<keyof Sinais, string> = {
  testid: "t", caminho: "c", rotulo: "r", destino: "d", papel: "p",
};

const POR_CODIGO: Record<string, keyof Sinais> = {
  t: "testid", c: "caminho", r: "rotulo", d: "destino", p: "papel",
};

// Só o separador de campos é que não pode aparecer num valor. O `=` pode: quem
// desserializa parte no **primeiro**, e o sinal `testid` traz naturalmente um
// (`data-testid=guardar`), que é justamente a parte legível de um registo.
function limpar(v: string, max: number): string {
  return v.replace(/[|\n\r]/g, "_").slice(0, max);
}

export function serializar(c: Chave): string {
  const partes = [`v1`, `f=${c.fonte}`];
  for (const nome of Object.keys(CODIGO) as Array<keyof Sinais>) {
    const v = c.sinais[nome];
    if (v) partes.push(`${CODIGO[nome]}=${limpar(String(v), LIMITE[nome])}`);
  }
  return partes.join("|").slice(0, 512);
}

export interface Desserializado {
  fonte: string;
  sinais: Sinais;
}

/** O inverso, usado nos ensaios e pelo lado do servidor quando é preciso em JS. */
export function desserializar(texto: string): Desserializado | null {
  if (!texto.startsWith("v1|")) return null;
  const sinais: Sinais = { testid: null, caminho: null, rotulo: null, destino: null, papel: null };
  let fonte = "";
  for (const parte of texto.split("|").slice(1)) {
    const i = parte.indexOf("=");
    if (i < 0) continue;
    const k = parte.slice(0, i);
    const v = parte.slice(i + 1);
    if (k === "f") fonte = v;
    else if (POR_CODIGO[k]) sinais[POR_CODIGO[k]!] = v;
  }
  return { fonte, sinais };
}
