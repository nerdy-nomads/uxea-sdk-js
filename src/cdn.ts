/**
 * Entrada do pacote para CDN. É este ficheiro que a etiqueta `<script>` carrega.
 *
 * Arranca sozinho a partir dos atributos da etiqueta, porque a promessa do
 * RF-CAP-01 é **uma linha**: se ainda for preciso escrever a chamada, já são
 * duas, e a diferença entre uma e duas é o programador ter de abrir o editor.
 */
import { arranqueAutomatico, iniciar, VERSAO } from "./index.ts";

const alvo = globalThis as any;
alvo.UXEA = { iniciar, versao: VERSAO };
arranqueAutomatico();
