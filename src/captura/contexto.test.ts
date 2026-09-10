/**
 * O contexto do dispositivo segmenta, e não identifica. Cartão 7.6.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { contextoDe } from "./contexto.ts";
import { pareceFuso, validar } from "../event/validar.ts";

function janelaCom(ua: string, extras: Record<string, unknown> = {}) {
  const { navigator: nav, fuso, ...resto } = extras;
  return {
    ...resto,
    navigator: { userAgent: ua, ...((nav as object) ?? {}) },
    Intl: { DateTimeFormat: () => ({ resolvedOptions: () => ({ timeZone: fuso ?? "Europe/Lisbon" }) }) },
  };
}

test("7.6 o sistema operativo sai com o nome e só a versão maior", () => {
  const casos: Array<[string, string, string | undefined, string]> = [
    ["Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Mobile Safari/537.36", "Android", "14", "telemovel"],
    ["Mozilla/5.0 (Linux; Android 13; SM-X200) AppleWebKit/537.36 Safari/537.36", "Android", "13", "tablet"],
    ["Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148", "iOS", "17", "telemovel"],
    ["Mozilla/5.0 (iPad; CPU OS 16_6 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148", "iOS", "16", "tablet"],
    ["Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36", "Windows", "10", "computador"],
    ["Mozilla/5.0 (Macintosh; Intel Mac OS X 14_2) AppleWebKit/605.1.15 Safari/605.1.15", "macOS", "14", "computador"],
    ["Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 Chrome/120", "ChromeOS", "14541", "computador"],
  ];
  for (const [ua, nome, versao, classe] of casos) {
    const c = contextoDe(janelaCom(ua));
    assert.equal(c.os_name, nome, ua);
    assert.equal(c.os_version, versao, ua);
    assert.equal(c.device_class, classe, ua);
  }
});

test("7.6 a versão completa nunca sai: só dígitos, e só a parte maior", () => {
  const c = contextoDe(janelaCom("Mozilla/5.0 (Linux; Android 14.0.1; build/TQ3A.230901.001) Mobile"));
  assert.equal(c.os_version, "14");
  assert.ok(!/\./.test(c.os_version ?? ""), "a versão não pode trazer pontos");
  // E o modelo do dispositivo não vai em campo nenhum: só a classe.
  assert.deepEqual(Object.keys(c).sort(), ["device_class", "os_name", "os_version", "time_zone"]);
});

test("7.6 o iPad que se diz Macintosh é apanhado pelo toque", () => {
  const ua = "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_2) AppleWebKit/605.1.15 Safari/605.1.15";
  assert.equal(contextoDe(janelaCom(ua)).device_class, "computador");
  assert.equal(contextoDe(janelaCom(ua, { navigator: { maxTouchPoints: 5 } })).device_class, "tablet");
});

test("7.6 a geografia é o fuso, e um par de coordenadas é recusado pelo validador", () => {
  assert.equal(contextoDe(janelaCom("Mozilla/5.0 (Linux; Android 14) Mobile")).time_zone, "Europe/Lisbon");
  assert.ok(pareceFuso("Europe/Lisbon"));
  assert.ok(pareceFuso("America/Argentina/Buenos_Aires"));
  assert.ok(pareceFuso("UTC"));
  assert.ok(!pareceFuso("38.7223,-9.1393"), "coordenadas não podem passar por fuso");
  assert.ok(!pareceFuso("lisboa"));
  assert.ok(!pareceFuso("-9.1393"));
});

test("7.6 um ambiente sem nada não rebenta, e devolve menos campos", () => {
  assert.deepEqual(contextoDe(undefined), { device_class: "desconhecido" });
  assert.deepEqual(contextoDe({}), { device_class: "desconhecido" });
  // Sem base de fusos, fica sem geografia e continua a medir.
  const semIntl = { navigator: { userAgent: "Mozilla/5.0 (Linux; Android 14) Mobile" } };
  const c = contextoDe(semIntl);
  assert.equal(c.os_name, "Android");
  assert.equal(c.time_zone, undefined);
});

test("7.6 o contexto que o SDK monta passa no validador do esquema", () => {
  const c = contextoDe(janelaCom("Mozilla/5.0 (Linux; Android 14; Pixel 8) Mobile"));
  const erros = validar({
    event_id: "3f2504e0-4f89-41d3-9a0c-0305e82c3301",
    project_id: "3f2504e0-4f89-41d3-9a0c-0305e82c3302",
    organization_id: "3f2504e0-4f89-41d3-9a0c-0305e82c3303",
    anonymous_id: "a1", device_id: "d1", session_id: "s1",
    event_type: "ecra", screen_key: "inicio",
    occurred_at: "2027-03-14T10:00:00Z",
    app_version: "1.0.0", platform: "web",
    identity_scope: "aplicacao", capture_level: "padrao",
    ...c,
  } as Record<string, unknown>);
  assert.deepEqual(erros, [], JSON.stringify(erros));
});
