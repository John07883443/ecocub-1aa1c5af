import { test } from "node:test";
import assert from "node:assert/strict";

import { availability, publicConfig, readConfig, submitPath } from "../config.ts";
import { clientIp, jobKey, normalizeIp, visitorHash } from "../quota.server.ts";
import { createProvider, MockLayoutProvider } from "../provider.ts";

const base = {
  AI_LAYOUT_ENABLED: "1",
  AI_LAYOUT_VISITOR_SECRET: "s3cret",
} as NodeJS.ProcessEnv;

test("функция выключена, пока её явно не включили", () => {
  const config = readConfig({} as NodeJS.ProcessEnv);
  assert.equal(config.enabled, false);
  assert.equal(config.provider, "mock");
  assert.equal(availability(config).reason, "disabled");
});

test("аварийный выключатель сильнее включённого флага", () => {
  const config = readConfig({ ...base, AI_LAYOUT_KILL_SWITCH: "1" });
  assert.equal(config.enabled, true);
  assert.equal(availability(config).reason, "kill_switch");
});

test("без соли посетители неразличимы, поэтому функция не запускается", () => {
  const config = readConfig({ AI_LAYOUT_ENABLED: "1" });
  assert.equal(availability(config).reason, "no_visitor_secret");
});

test("боевой провайдер не стартует без ключей и без пути", () => {
  const keys = {
    ...base,
    AI_LAYOUT_PROVIDER: "higgsfield",
    HIGGSFIELD_API_KEY: "k",
    HIGGSFIELD_API_SECRET: "s",
  };
  assert.equal(
    availability(readConfig({ ...base, AI_LAYOUT_PROVIDER: "higgsfield" })).reason,
    "no_credentials",
  );
  assert.equal(availability(readConfig(keys)).reason, "no_submit_path");
  assert.equal(
    availability(readConfig({ ...keys, AI_LAYOUT_SUBMIT_PATH: "vendor/model" })).ok,
    true,
  );
});

test("путь запроса не подставляется сам: угадать его нельзя", () => {
  // Идентификатор модели путём не является — живой запрос по нему вернул
  // model_not_found, потому что путь у платформы составной.
  assert.equal(submitPath(readConfig(base)), "");
  assert.equal(submitPath(readConfig({ ...base, AI_LAYOUT_JOB_TYPE: "gpt_image_2" })), "");
  // Ведущие и хвостовые слеши не должны склеиваться в двойные.
  assert.equal(
    submitPath(readConfig({ ...base, AI_LAYOUT_SUBMIT_PATH: "/openai/gpt-image-2/" })),
    "openai/gpt-image-2",
  );
});

test("по умолчанию — OpenRouter и модель, выбранная по замерам этапа 0", () => {
  const config = readConfig(base);
  assert.equal(config.model, "openai/gpt-image-2");
  assert.equal(config.quality, "low");
  assert.equal(config.apiBase, "https://openrouter.ai/api/v1");
});

test("у каждого провайдера свой ключ и своя база", () => {
  const env = {
    ...base,
    OPENROUTER_API_KEY: "or-key",
    HIGGSFIELD_API_KEY: "hf-key",
    HIGGSFIELD_API_SECRET: "hf-secret",
  };
  const openrouter = readConfig({ ...env, AI_LAYOUT_PROVIDER: "openrouter" });
  assert.equal(openrouter.apiKey, "or-key");
  assert.equal(availability(openrouter).ok, true);

  const higgsfield = readConfig({
    ...env,
    AI_LAYOUT_PROVIDER: "higgsfield",
    AI_LAYOUT_SUBMIT_PATH: "vendor/model",
  });
  assert.equal(higgsfield.apiKey, "hf-key");
  assert.equal(higgsfield.apiBase, "https://platform.higgsfield.ai");
  assert.equal(availability(higgsfield).ok, true);

  // Ключ Higgsfield не открывает OpenRouter и наоборот.
  assert.equal(
    availability(
      readConfig({ ...base, AI_LAYOUT_PROVIDER: "openrouter", HIGGSFIELD_API_KEY: "hf" }),
    ).reason,
    "no_credentials",
  );
});

test("через ретранслятор нужен его секрет, а ключ провайдера — нет", () => {
  const relay = {
    ...base,
    AI_LAYOUT_PROVIDER: "openrouter",
    AI_LAYOUT_RELAY_URL: "https://project.supabase.co/functions/v1/ai-layout-relay/",
  };
  // Адрес есть, секрета нет — дверь наружу оказалась бы открыта всем.
  assert.equal(availability(readConfig(relay)).reason, "no_relay_secret");

  const ok = readConfig({ ...relay, AI_LAYOUT_RELAY_SECRET: "shared" });
  assert.equal(availability(ok).ok, true);
  // Ключ OpenRouter на нашем сервере при этом не нужен вовсе: он в функции.
  assert.equal(ok.apiKey, null);
  // Хвостовой слеш не должен превращаться в двойной при обращении.
  assert.equal(ok.relayUrl, "https://project.supabase.co/functions/v1/ai-layout-relay");
});

test("таймаут короче лимита функции Supabase на бесплатном тарифе", () => {
  // Лимит 150 с. Свой обрыв должен наступать раньше чужого, иначе вместо
  // внятной ошибки получим оборванное соединение неизвестно почему.
  assert.ok(readConfig(base).timeoutMs < 150_000);
});

test("наружу не уходит ни одного секрета", () => {
  const config = readConfig({
    ...base,
    AI_LAYOUT_PROVIDER: "higgsfield",
    HIGGSFIELD_API_KEY: "key-value",
    HIGGSFIELD_API_SECRET: "secret-value",
    AI_LAYOUT_SUBMIT_PATH: "secret/path",
    AI_LAYOUT_RELAY_SECRET: "relay-secret-value",
    AI_LAYOUT_RELAY_URL: "https://project.supabase.co/functions/v1/relay",
  });
  const serialized = JSON.stringify(publicConfig(config));
  assert.ok(!serialized.includes("key-value"));
  assert.ok(!serialized.includes("secret-value"));
  assert.ok(!serialized.includes("secret/path"));
  assert.ok(!serialized.includes("relay-secret-value"));
  assert.ok(!serialized.includes("supabase.co"));
  assert.deepEqual(Object.keys(JSON.parse(serialized)).sort(), [
    "available",
    "freePerVisitor",
    "isManual",
    "isMock",
  ]);
});

test("IPv6 схлопывается до префикса /64, иначе бесплатных попыток бесконечно", () => {
  const a = normalizeIp("2001:0db8:85a3:0000:1111:2222:3333:4444");
  const b = normalizeIp("2001:0db8:85a3:0000:9999:8888:7777:6666");
  assert.equal(a, b);
  // IPv4 остаётся целиком: там подсеть клиенту не выдают.
  assert.notEqual(normalizeIp("81.2.3.4"), normalizeIp("81.2.3.5"));
  assert.equal(normalizeIp("::ffff:81.2.3.4"), "81.2.3.4");
  assert.equal(normalizeIp("81.2.3.4:51000"), "81.2.3.4");
});

test("хеш посетителя необратим и зависит от соли", () => {
  const ip = "81.2.3.4";
  const hash = visitorHash(ip, "salt-one");
  assert.ok(!hash.includes("81.2"));
  assert.equal(hash, visitorHash(ip, "salt-one"));
  assert.notEqual(hash, visitorHash(ip, "salt-two"));
});

test("берётся первый адрес из X-Forwarded-For, а не подставленный прокси", () => {
  const headers = new Headers({ "x-forwarded-for": "81.2.3.4, 10.0.0.1, 10.0.0.2" });
  assert.equal(clientIp(headers), "81.2.3.4");
  assert.equal(clientIp(new Headers({ "x-real-ip": "81.2.3.9" })), "81.2.3.9");
  assert.equal(clientIp(new Headers()), "");
});

test("ключ идемпотентности различает и запрос, и посетителя", () => {
  const one = jobKey("modules=a", "visitor-1");
  assert.equal(one, jobKey("modules=a", "visitor-1"));
  assert.notEqual(one, jobKey("modules=b", "visitor-1"));
  assert.notEqual(one, jobKey("modules=a", "visitor-2"));
});

test("заглушка честно помечает результат и не ходит в сеть", async () => {
  const provider = createProvider(readConfig(base));
  assert.ok(provider instanceof MockLayoutProvider);
  const result = await provider.start({
    footprintUrl: "https://eco-cub.ru/api/ai-layout/footprint?key=abc",
    prompt: "x",
    key: "abc",
  });
  assert.equal(result.status, "completed");
  assert.equal(result.status === "completed" && result.isMock, true);
});

test("ручной режим ничего не рисует, а ставит запрос в очередь", async () => {
  const provider = createProvider(readConfig({ ...base, AI_LAYOUT_PROVIDER: "manual" }));
  const result = await provider.start({ footprintUrl: "u", prompt: "x", key: "abc" });
  assert.equal(result.status, "queued_manual");
});

test("ноль означает «без ограничения», а не «запрещено всем»", () => {
  // Умолчание после решения владельца: лимитов нет. Ноль здесь легко принять
  // за запрет, поэтому смысл закреплён тестом — иначе снятие лимита однажды
  // превратится в отказ всем подряд.
  const config = readConfig(base);
  assert.equal(config.freePerVisitor, 0);
  assert.equal(config.dailyLimit, 0);
  // Снятие лимитов ничего не открывает само по себе: боевой провайдер
  // по-прежнему не стартует без ключей.
  assert.equal(
    availability(readConfig({ ...base, AI_LAYOUT_PROVIDER: "openrouter" })).reason,
    "no_credentials",
  );

  // Лимиты возвращаются переменными окружения, без правки кода.
  const capped = readConfig({
    ...base,
    AI_LAYOUT_FREE_PER_VISITOR: "1",
    AI_LAYOUT_DAILY_LIMIT: "50",
  });
  assert.equal(capped.freePerVisitor, 1);
  assert.equal(capped.dailyLimit, 50);
});

test("аварийный выключатель остаётся единственным тормозом", () => {
  // Без дневного потолка это и есть защита кошелька: она сильнее включённого
  // флага и гасит функцию целиком.
  const config = readConfig({ ...base, AI_LAYOUT_KILL_SWITCH: "1" });
  assert.equal(availability(config).reason, "kill_switch");
  assert.equal(publicConfig(config).available, false);
});
