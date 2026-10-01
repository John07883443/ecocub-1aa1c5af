/**
 * Обратная связь владельца с живого теста 01.10.2026 (вторая волна):
 * удаление комнаты, рендеры без «Unexpected token '<'», тупиковый холл,
 * навес для машины, лоток для кошек, спальня с гардеробной, Лев видит анкету.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { applyCommand, removeRoomGuard } from "../engine/commands.ts";
import { singleTier } from "./fixtures.ts";
import { buildProject } from "../engine/derive.ts";
import { evaluate } from "../engine/rules.ts";
import { solve, deadEndHalls } from "../engine/solver.ts";
import { briefFromScenario, type LifeScenario } from "../engine/scenario.ts";
import { carportPlace } from "../engine/site.ts";
import { bbox, footprint } from "../engine/geometry.ts";
import { planFromProject } from "../engine/plan.ts";
import { buildPassport } from "../engine/passport.ts";
import {
  LEV_MISSION,
  mergeScenario,
  projectContext,
  scenarioContext,
  systemPrompt,
  whatIf,
} from "../ui/architect.ts";
import { humanHttpError, readJson, runRenderJob, type FetchLike } from "../ui/render-client.ts";
import { pilotRenderStart, pilotRenderStatus } from "../server/pilot-api.server.ts";
import { labelFontMm } from "../ui/plan-labels.ts";

/** Сценарий со скриншота владельца: трое, 3 кошки, родители в гостях (2), машина. */
const OWNER: LifeScenario = {
  adults: 2,
  kids: 1,
  pets: { dogs: 0, cats: 3 },
  elderly: { mode: "visit", count: 2 },
  workFromHome: 0,
  guestsOften: false,
  sauna: false,
  storage: "normal",
  car: true,
  terrace: true,
  tiers: "any",
  desiredAreaM2: { min: 50, max: 90 },
  plot: { widthM: 25, depthM: 35, northDeg: 0 },
};

// ── 1. Удалить комнату ────────────────────────────────────────────────────

/** Дом из солвера: 2 спальни, один ярус — как у человека на экране. */
const base = () =>
  solve({
    bedrooms: 2,
    tiers: 1,
    kitchenLiving: "large",
    yearRound: true,
    plot: { widthM: 30, depthM: 30 },
  }).variants[0].project;

test("лишний санузел, добавленный «+ санузел», убирается командой «Удалить комнату»", () => {
  const p = base();
  const added = applyCommand(p, { op: "add_room", room: "wet-core" });
  assert.equal(added.ok, true);
  if (!added.ok) return;
  const extra = added.project.rooms.find(
    (r) => r.type === "wet-core" && !p.rooms.some((x) => x.id === r.id),
  )!;
  assert.ok(extra, "санузел добавился");
  assert.equal(removeRoomGuard(added.project, extra.id), null);
  const removed = applyCommand(added.project, { op: "remove_room", roomId: extra.id });
  assert.equal(removed.ok, true);
  if (!removed.ok) return;
  assert.ok(!removed.project.rooms.some((r) => r.id === extra.id));
  assert.equal(removed.project.modules.length, p.modules.length);
  assert.ok(evaluate(removed.project).valid);
});

test("удалить нельзя: последняя кухня-гостиная и единственный санузел — с причиной", () => {
  const p = singleTier();
  const k = removeRoomGuard(p, "kitchen");
  assert.ok(k && /ядро дома/.test(k.reason));
  const r = applyCommand(p, { op: "remove_room", roomId: "kitchen" });
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.reason, /Кухня-гостиная/);
  const w = removeRoomGuard(p, "wet");
  assert.ok(w && /единственный санузел/.test(w.reason));
  // Спальню — без заранее известного запрета; остальное скажет движок правил словами.
  assert.equal(removeRoomGuard(p, "bed1"), null);
  const bed = applyCommand(p, { op: "remove_room", roomId: "bed1" });
  if (!bed.ok) assert.ok(bed.violations.length > 0 && bed.violations.every((v) => v.length > 10));
});

// ── 2. Рендеры: не-JSON и задачи с опросом ────────────────────────────────

const html504 = () =>
  new Response("<html><body><h1>504 Gateway Time-out</h1></body></html>", {
    status: 504,
    headers: { "Content-Type": "text/html" },
  });

test("504 от nginx (HTML) — человеческая фраза, а не «Unexpected token '<'»", async () => {
  const r = await readJson(html504());
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.doesNotMatch(r.error, /Unexpected token|JSON/);
    assert.match(r.error, /Сервер не дождался картинок/);
  }
  assert.match(humanHttpError(502), /недоступен/);
  const f: FetchLike = async () => html504();
  await assert.rejects(
    runRenderJob("/api/pilot", [{ id: "a", prompt: "x" }], { session: "t", fetch: f, pollMs: 1 }),
    (e: Error) => /Сервер не дождался картинок/.test(e.message) && !/Unexpected/.test(e.message),
  );
});

test("рендер задачей: jobId сразу, опрос с прогрессом «1 из 3», разовый 504 на опросе не роняет", async () => {
  const calls: string[] = [];
  let poll = 0;
  const f: FetchLike = async (url, init) => {
    calls.push(`${init?.method ?? "GET"} ${url}`);
    if (init?.method === "POST") return Response.json({ jobId: "j1", total: 3 }, { status: 202 });
    poll++;
    if (poll === 1)
      return Response.json({
        status: "running",
        done: 1,
        total: 3,
        results: [{ id: "a", url: "u1" }],
      });
    if (poll === 2) return html504();
    return Response.json({
      status: "done",
      done: 3,
      total: 3,
      results: [
        { id: "a", url: "u1" },
        { id: "b", url: "u2" },
        { id: "c", error: "rgrouter 500" },
      ],
    });
  };
  const seen: number[] = [];
  const out = await runRenderJob(
    "/api/pilot",
    ["a", "b", "c"].map((id) => ({ id, prompt: id })),
    { session: "t", fetch: f, pollMs: 1, onProgress: (p) => seen.push(p.done) },
  );
  assert.equal(calls[0], "POST /api/pilot/render?mode=job");
  assert.ok(calls.slice(1).every((c) => c.includes("/api/pilot/render?job=j1")));
  assert.deepEqual(seen, [0, 1, 3]);
  assert.equal(out.results.length, 3);
  assert.equal(out.results[2].error, "rgrouter 500");
});

test("сервер: pilotRenderStart отвечает сразу (202), кадры рисуются по одному", async () => {
  process.env.RGROUTER_API_KEY = "test-key";
  process.env.PILOT_RENDER_RUNS = "5";
  try {
    const order: string[] = [];
    const start = pilotRenderStart(
      { shots: ["a", "b", "c"].map((id) => ({ id, prompt: id })) },
      "sess-job",
      async (s) => {
        order.push(s.id);
        await new Promise((r) => setTimeout(r, 5));
        return { id: s.id, url: `u-${s.id}` };
      },
    );
    assert.equal(start.status, 202);
    const { jobId } = start.body as { jobId: string };
    assert.ok(jobId);
    const first = pilotRenderStatus(jobId, "sess-job").body as { status: string; done: number };
    assert.equal(first.status, "running");
    for (let i = 0; i < 50; i++) {
      const b = pilotRenderStatus(jobId, "sess-job").body as { status: string };
      if (b.status === "done") break;
      await new Promise((r) => setTimeout(r, 5));
    }
    const done = pilotRenderStatus(jobId, "sess-job").body as {
      status: string;
      done: number;
      results: { id: string; url: string }[];
    };
    assert.equal(done.status, "done");
    assert.equal(done.done, 3);
    assert.deepEqual(order, ["a", "b", "c"]);
    assert.equal(pilotRenderStatus("nope").status, 404);
    assert.equal(pilotRenderStart({ shots: [] }, "sess-job").status, 400);
  } finally {
    delete process.env.RGROUTER_API_KEY;
    delete process.env.PILOT_RENDER_RUNS;
  }
});

// ── 3. Качество плана ─────────────────────────────────────────────────────

test("сценарий владельца: ни одного тупикового холла, правило hall-purpose проходит", () => {
  const r = solve(briefFromScenario(OWNER));
  assert.ok(r.variants.length >= 2);
  for (const v of r.variants) {
    assert.deepEqual(deadEndHalls(v.project), [], v.summary);
    assert.ok(evaluate(v.project).results.every((x) => x.ruleId !== "hall-purpose" || x.ok));
  }
});

test("тупиковый холл — жёсткое нарушение hall-purpose", () => {
  // Кухня парой, холл на дальнем конце кухни, в него никто не открывается; вход в санузле.
  const p = buildProject({
    id: "dead-hall",
    modules: [
      { id: "a", xMm: 0, yMm: 0, rot: 0, tier: 1, roomId: "k" },
      { id: "b", xMm: 3200, yMm: 0, rot: 0, tier: 1, roomId: "k" },
      { id: "c", xMm: 0, yMm: 3420, rot: 0, tier: 1, roomId: "bed" },
      { id: "d", xMm: 3200, yMm: 3420, rot: 0, tier: 1, roomId: "wet" },
      { id: "e", xMm: 6400, yMm: 0, rot: 0, tier: 1, roomId: "hall" },
    ],
    rooms: [
      { id: "k", type: "kitchen-living", tier: 1, moduleIds: ["a", "b"] },
      { id: "bed", type: "bedroom", tier: 1, moduleIds: ["c"] },
      { id: "wet", type: "wet-core", tier: 1, moduleIds: ["d"] },
      { id: "hall", type: "corridor", tier: 1, moduleIds: ["e"] },
    ],
    plot: { widthM: 30, depthM: 30 },
  });
  assert.equal(deadEndHalls(p).length, 1);
  const ev = evaluate(p);
  assert.ok(ev.hardViolations.some((v) => v.ruleId === "hall-purpose"));
});

test("площадь позволяет — главная спальня на 2 кубика (с гардеробной) среди вариантов", () => {
  const s: LifeScenario = {
    ...OWNER,
    pets: {},
    elderly: undefined,
    car: false,
    desiredAreaM2: { min: 0, max: 100 },
  };
  const r = solve(briefFromScenario(s));
  const suite = r.variants.find((v) =>
    v.project.rooms.some((x) => x.type === "bedroom" && x.moduleIds.length === 2),
  );
  assert.ok(suite, "есть вариант со спальней на 2 кубика");
  assert.ok(evaluate(suite!.project).valid);
  const bed = suite!.project.rooms.find((x) => x.type === "bedroom" && x.moduleIds.length === 2)!;
  assert.ok(bed.subRooms?.includes("гардеробная"));
  const plan = planFromProject(suite!.project);
  assert.equal(plan.furniture.filter((f) => f.roomId === bed.id && f.kind === "bed").length, 1);
  assert.ok(plan.furniture.some((f) => f.roomId === bed.id && f.kind === "wardrobe"));
});

test("машина в сценарии — навес на плане участка и в паспорте; без машины — нет", () => {
  const r = solve(briefFromScenario(OWNER));
  for (const v of r.variants) {
    const c = carportPlace(v.project);
    assert.ok(c, v.summary);
    const house = bbox(v.project.modules.map(footprint));
    const overlap =
      c!.rect.x0 < house.x1 &&
      c!.rect.x1 > house.x0 &&
      c!.rect.y0 < house.y1 &&
      c!.rect.y1 > house.y0;
    assert.equal(overlap, false, "навес не залезает на дом");
    const pp = buildPassport(v.project);
    assert.match(pp.site.carport?.note ?? "", /Навес для машины/);
  }
  const noCar = solve(briefFromScenario({ ...OWNER, car: false })).variants[0].project;
  assert.equal(carportPlace(noCar), null);
  assert.equal(buildPassport(noCar).site.carport, null);
});

test("кошки — на плане подписан лоток; без кошек — нет", () => {
  const v = solve(briefFromScenario(OWNER)).variants[0].project;
  assert.ok(planFromProject(v).furniture.some((f) => f.kind === "litter"));
  const noCats = solve(briefFromScenario({ ...OWNER, pets: {} })).variants[0].project;
  assert.ok(!planFromProject(noCats).furniture.some((f) => f.kind === "litter"));
});

test("подписи плана не мельче 11 px на обзорном масштабе", () => {
  // 0,036 px/мм — дом 10 м в окне 520 px: 150 мм дали бы 5 px.
  assert.ok(labelFontMm(150, 11, 0.036) * 0.036 >= 11);
  assert.equal(labelFontMm(150, 11, 1), 150);
  assert.equal(labelFontMm(150, 11, 0), 150);
});

// ── 4. Лев видит анкету и цифры ──────────────────────────────────────────

test("промпт Льва: миссия первой строкой, анкета с фактами, бюджет по статьям", () => {
  const p = solve(briefFromScenario(OWNER)).variants[0].project;
  const prompt = systemPrompt(projectContext(p, { scenario: OWNER, variants: ["1) …"] }));
  assert.ok(prompt.startsWith(LEV_MISSION));
  for (const fact of ["взрослых 2, детей 1", "кошек 3", "приезжают в гости, 2 чел.", "есть машина"])
    assert.ok(prompt.includes(fact), fact);
  assert.match(prompt, /НЕ переспрашивай/);
  assert.match(prompt, /Не хватает: бюджет/);
  assert.match(prompt, /Бюджет по статьям/);
  assert.match(prompt, /фирменного стиля ЭкоКуба/);
  assert.match(scenarioContext({ ...OWNER, budgetRub: { min: 0, max: 12e6 } }), /бюджет до 12 млн/);
});

test("set_scenario дописывает факты, не стирая анкету; сотки → участок; мусор отбрасывается", () => {
  const s = mergeScenario(OWNER, { budgetMaxRub: 15_000_000, plotSotki: 10 });
  assert.equal(s.adults, 2);
  assert.equal(s.pets?.cats, 3);
  assert.equal(s.elderly?.mode, "visit");
  assert.equal(s.budgetRub?.max, 15_000_000);
  assert.ok(s.plot && Math.abs(s.plot.widthM * s.plot.depthM - 1000) < 40);
  const bad = mergeScenario(OWNER, { adults: "много", kids: -3, cats: 99, elderly: "maybe" });
  assert.equal(bad.adults, 2);
  assert.equal(bad.kids, 0);
  assert.equal(bad.pets?.cats, 5);
  assert.equal(bad.elderly?.mode, "visit");
  assert.equal(mergeScenario(OWNER, { elderly: "none" }).elderly, undefined);
});

test("what_if: «а если убрать спальню» — цифры до и после, дом не меняется", () => {
  const p0 = base();
  const added = applyCommand(p0, { op: "add_room", room: "wet-core" });
  assert.ok(added.ok);
  if (!added.ok) return;
  const p = added.project;
  const extra = p.rooms.find((r) => r.type === "wet-core" && !p0.rooms.some((x) => x.id === r.id))!;
  const before = JSON.stringify(p);
  const out = whatIf(p, { op: "remove_room", roomId: extra.id });
  assert.match(out, new RegExp(`Сейчас: ${p.modules.length} кубиков`));
  assert.match(out, new RegExp(`Если так: ${p.modules.length - 1} кубиков`));
  assert.match(out, /млн ₽/);
  assert.equal(JSON.stringify(p), before);
  const k = p.rooms.find((r) => r.type === "kitchen-living")!;
  assert.match(whatIf(p, { op: "remove_room", roomId: k.id }), /Так нельзя/);
});
