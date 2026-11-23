/**
 * Стадия 2: фото поверх 3D-снимка через rgrouter /v1/images/edits.
 * Multipart-запрос, запасной путь по промпту, выключатель PILOT_IMAGE_EDITS=0,
 * пропорции кадров и промпт «сохрани геометрию».
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildEditForm, dataUrlToBlob, renderShot, type Shot } from "../server/pilot-api.server.ts";
import {
  aspectFor,
  editPromptFor,
  promptFor,
  snapshotSize,
  viewSet,
} from "../engine/render-plan.ts";
import { EDIT_INSTRUCTION } from "../engine/render-prompt.ts";
import { frameNote } from "../ui/render-client.ts";
import { twoTier } from "./fixtures.ts";

// 1×1 PNG.
const PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

const shot = (over: Partial<Shot> = {}): Shot => ({
  id: "facade-S",
  prompt: "keep geometry",
  image: PNG,
  aspect: "16:9",
  ...over,
});

type Call = { url: string; init?: RequestInit };
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

function withEnv<T>(vars: Record<string, string | undefined>, fn: () => Promise<T>): Promise<T> {
  const prev: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(vars)) {
    prev[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  return fn().finally(() => {
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });
}

test("multipart images/edits: model, prompt, PNG, aspect_ratio, 1K, b64_json", async () => {
  const form = buildEditForm(shot({ aspect: "3:2" }), "rg-google-gemini-3.1-flash-image")!;
  assert.ok(form);
  assert.equal(form.get("model"), "rg-google-gemini-3.1-flash-image");
  assert.equal(form.get("prompt"), "keep geometry");
  assert.equal(form.get("aspect_ratio"), "3:2");
  assert.equal(form.get("resolution"), "1K");
  assert.equal(form.get("response_format"), "b64_json");
  const img = form.get("image") as File;
  assert.equal(img.type, "image/png");
  assert.equal(img.name, "massing.png");
  const bytes = new Uint8Array(await img.arrayBuffer());
  assert.deepEqual([...bytes.slice(1, 4)], [0x50, 0x4e, 0x47], "настоящие байты PNG");
  assert.equal(buildEditForm(shot({ aspect: undefined }), "m")!.get("aspect_ratio"), "16:9");
  assert.equal(buildEditForm(shot({ image: undefined }), "m"), null);
  assert.equal(dataUrlToBlob("data:text/html;base64,PGI+"), null);
});

test("по умолчанию — images/edits; модель из PILOT_EDIT_MODEL; цена и время в ответе", async () => {
  const calls: Call[] = [];
  const f = async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    return json({ created: 1, data: [{ b64_json: "AAA" }], usage: { total_tokens: 10 } });
  };
  const r = await withEnv(
    { RGROUTER_API_KEY: "k", PILOT_IMAGE_EDITS: undefined, PILOT_EDIT_MODEL: "rg-test-edit" },
    () => renderShot(shot(), f),
  );
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /\/images\/edits$/);
  assert.ok(calls[0].init?.body instanceof FormData);
  assert.equal((calls[0].init!.body as FormData).get("model"), "rg-test-edit");
  assert.equal((calls[0].init!.headers as Record<string, string>).Authorization, "Bearer k");
  assert.equal(r.mode, "edit");
  assert.equal(r.b64, "AAA");
  assert.equal(typeof r.ms, "number");
  assert.equal(r.costEstimated, true);
  assert.ok((r.costRub ?? 0) > 0);
});

test("edits упал → кадр по промпту (generations), причина видна", async () => {
  const calls: Call[] = [];
  const f = async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    return url.endsWith("/images/edits")
      ? json({ error: "nope" }, 500)
      : json({ data: [{ url: "https://x/y.png" }], usage: { cost: 4.2 } });
  };
  const r = await withEnv({ RGROUTER_API_KEY: "k", PILOT_IMAGE_EDITS: undefined }, () =>
    renderShot(shot(), f),
  );
  assert.deepEqual(
    calls.map((c) => c.url.replace(/^.*\/v1/, "")),
    ["/images/edits", "/images/generations"],
  );
  const body = JSON.parse(String(calls[1].init?.body));
  assert.equal(body.prompt, "keep geometry");
  assert.equal(r.mode, "text");
  assert.equal(r.url, "https://x/y.png");
  assert.equal(r.fallbackReason, "images/edits 500");
  assert.equal(r.costRub, 4.2);
  assert.equal(r.costEstimated, false);
});

test("edits бросил исключение или вернул пусто → тоже запасной путь", async () => {
  for (const edit of [
    async () => {
      throw new Error("socket hang up");
    },
    async () => json({ data: [] }),
  ]) {
    const f = async (url: string) =>
      url.endsWith("/images/edits") ? edit() : json({ data: [{ b64_json: "T" }] });
    const r = await withEnv({ RGROUTER_API_KEY: "k" }, () => renderShot(shot(), f));
    assert.equal(r.mode, "text");
    assert.equal(r.b64, "T");
    assert.ok(r.fallbackReason);
  }
});

test("PILOT_IMAGE_EDITS=0 и кадр без снимка — сразу по промпту, edits не зовётся", async () => {
  for (const [vars, s] of [
    [{ PILOT_IMAGE_EDITS: "0" }, shot()],
    [{ PILOT_IMAGE_EDITS: undefined }, shot({ image: undefined })],
  ] as const) {
    const urls: string[] = [];
    const f = async (url: string) => {
      urls.push(url);
      return json({ data: [{ b64_json: "T" }] });
    };
    const r = await withEnv({ RGROUTER_API_KEY: "k", ...vars }, () => renderShot(s, f));
    assert.deepEqual(
      urls.map((u) => u.replace(/^.*\/v1/, "")),
      ["/images/generations"],
    );
    assert.equal(r.mode, "text");
    assert.equal(r.fallbackReason, undefined);
  }
});

test("оба пути упали — ошибка кадра, а не исключение", async () => {
  const f = async () => json({ error: "down" }, 503);
  const r = await withEnv({ RGROUTER_API_KEY: "k" }, () => renderShot(shot(), f));
  assert.match(r.error ?? "", /503/);
  assert.equal(r.fallbackReason, "images/edits 503");
});

test("пропорции: фасад 16:9, сверху 3:2, интерьер без снимка; промпт «сохрани геометрию»", () => {
  const p = twoTier(1200);
  const vs = viewSet(p);
  const facade = vs.views.find((v) => v.kind === "facade")!;
  const aerial = vs.views.find((v) => v.kind === "aerial")!;
  assert.equal(aspectFor(facade), "16:9");
  assert.equal(aspectFor(aerial), "3:2");
  for (const v of vs.views.filter((x) => x.kind === "interior")) assert.equal(aspectFor(v), null);
  const s169 = snapshotSize("16:9");
  assert.ok(Math.abs(s169.w / s169.h - 16 / 9) < 0.01);
  const s32 = snapshotSize("3:2");
  assert.ok(Math.abs(s32.w / s32.h - 3 / 2) < 0.01);
  const ep = editPromptFor(p, facade);
  assert.ok(ep.startsWith(EDIT_INSTRUCTION));
  assert.match(ep, /Сохрани геометрию, пропорции, окна и консоли точно как на снимке/);
  assert.ok(ep.includes(promptFor(p, facade).slice(0, 200)), "внутри — промпт по точному дому");
  assert.match(ep, /cantilevering 1\.2 m to the east/);
  assert.ok(ep.length <= 4000);
});

test("подпись кадра: способ, секунды, рубли", () => {
  assert.equal(
    frameNote({ id: "a", mode: "edit", ms: 17_200, costRub: 5, costEstimated: true }),
    "фото по 3D-снимку — геометрия как в 3D · 17 с · ≈5 ₽",
  );
  assert.match(
    frameNote({ id: "a", mode: "text", fallbackReason: "images/edits 500", costRub: 3.8 }),
    /снимок не принят: images\/edits 500.*3,8 ₽/,
  );
  assert.equal(frameNote({ id: "a" }), "");
});
