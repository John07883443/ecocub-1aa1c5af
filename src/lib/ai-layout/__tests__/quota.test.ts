import { test } from "node:test";
import assert from "node:assert/strict";

import { availability, publicConfig, readConfig } from "../config.ts";
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

test("боевой провайдер не стартует, пока не заданы путь модели и поле исходника", () => {
  const withKeys = {
    ...base,
    AI_LAYOUT_PROVIDER: "higgsfield",
    HIGGSFIELD_API_KEY: "k",
    HIGGSFIELD_API_SECRET: "s",
  };
  assert.equal(availability(readConfig(withKeys)).reason, "no_model_path");
  assert.equal(
    availability(readConfig({ ...withKeys, AI_LAYOUT_MODEL_PATH: "vendor/model" })).reason,
    "no_reference_field",
  );
  assert.equal(
    availability(
      readConfig({
        ...withKeys,
        AI_LAYOUT_MODEL_PATH: "vendor/model",
        AI_LAYOUT_REFERENCE_FIELD: "image_url",
      }),
    ).ok,
    true,
  );
  // Ключи без пути модели — тоже не повод идти в сеть.
  assert.equal(
    availability(readConfig({ ...base, AI_LAYOUT_PROVIDER: "higgsfield" })).reason,
    "no_credentials",
  );
});

test("наружу не уходит ни одного секрета", () => {
  const config = readConfig({
    ...base,
    AI_LAYOUT_PROVIDER: "higgsfield",
    HIGGSFIELD_API_KEY: "key-value",
    HIGGSFIELD_API_SECRET: "secret-value",
    AI_LAYOUT_MODEL_PATH: "vendor/model",
    AI_LAYOUT_REFERENCE_FIELD: "image_url",
  });
  const serialized = JSON.stringify(publicConfig(config));
  assert.ok(!serialized.includes("key-value"));
  assert.ok(!serialized.includes("secret-value"));
  assert.ok(!serialized.includes("vendor/model"));
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
