/**
 * Ponto de entrada público da identidade de elementos.
 *
 * Tudo o que sai daqui está atrás da barreira do RNF-SDK-01: um erro interno
 * devolve um valor seguro e **nunca** chega à aplicação anfitriã.
 */
import { protegido } from "../safe.ts";
import { acionavel as _acionavel, chave as _chave, sinais as _sinais, type Chave, type ElementoLike, type Sinais } from "./element.ts";

const SINAIS_VAZIOS: Sinais = { testid: null, caminho: null, rotulo: null, destino: null, papel: null };
const CHAVE_VAZIA: Chave = { principal: "", fonte: "papel", sinais: SINAIS_VAZIOS };

export const acionavel = protegido("identity.acionavel", _acionavel, false);
export const sinais = protegido("identity.sinais", _sinais, SINAIS_VAZIOS);
export const chave = protegido("identity.chave", _chave, CHAVE_VAZIA);

export type { Chave, Sinais, ElementoLike };
export { errosInternos, limparErros } from "../safe.ts";
