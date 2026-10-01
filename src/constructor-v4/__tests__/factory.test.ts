import { test } from "node:test";
import assert from "node:assert/strict";
import { factoryModules, trucksForCubes } from "../engine/factory.ts";
import { buildProject } from "../engine/derive.ts";
import { budgetFor } from "../engine/price.ts";
import { buildPassport } from "../engine/passport.ts";
import { evaluate } from "../engine/rules.ts";
import { GRAMMAR } from "../grammar/index.ts";
import type { ModulePlacement, Room } from "../engine/types.ts";
import { singleTier } from "./fixtures.ts";

const cube = (id: string, x: number, y: number, roomId: string): ModulePlacement => ({
  id,
  xMm: x,
  yMm: y,
  rot: 0,
  tier: 1,
  roomId,
});

/** 6 кубиков: три пары по длинной грани. */
function sixCubes() {
  const modules = [
    cube("m1", 0, 0, "kitchen"),
    cube("m2", 3200, 0, "kitchen"),
    cube("m3", 0, 3420, "bed1"),
    cube("m4", 3200, 3420, "bed2"),
    cube("m5", 6400, 0, "wet"),
    cube("m6", 9600, 0, "study"),
  ];
  const rooms: Room[] = [
    { id: "kitchen", type: "kitchen-living", tier: 1, moduleIds: ["m1", "m2"] },
    { id: "bed1", type: "bedroom", tier: 1, moduleIds: ["m3"] },
    { id: "bed2", type: "bedroom", tier: 1, moduleIds: ["m4"] },
    { id: "wet", type: "wet-core", tier: 1, moduleIds: ["m5"] },
    { id: "study", type: "study", tier: 1, moduleIds: ["m6"] },
  ];
  return buildProject({ id: "six", modules, rooms, plot: { widthM: 30, depthM: 30 } });
}

test("модуль завода = 2 кубика по длинной грани, ≈ 6400 × 3420", () => {
  assert.equal(GRAMMAR.factoryModule.cubes, 2);
  assert.deepEqual(GRAMMAR.factoryModule.externalMm, { w: 6400, d: 3420 });
  assert.equal(GRAMMAR.transport.cubesPerTruck, 4);
  assert.deepEqual(GRAMMAR.transport.truckLengthsM, [18, 21, 24]);
});

test("6 кубиков → 3 модуля и 2 трала", () => {
  const p = sixCubes();
  const fm = factoryModules(p);
  assert.equal(fm.modules.length, 3);
  assert.deepEqual(fm.unpairedCubeIds, []);
  assert.equal(trucksForCubes(6), 2);
  const t = budgetFor(p).lines.find((l) => l.id === "transport")!;
  assert.match(t.basis, /^2 рейс/);
  assert.equal(t.min, 2 * 300_000);
  assert.equal(t.max, 2 * 400_000);
  const pp = buildPassport(p);
  assert.equal(pp.summary.factoryModules, 3);
  assert.equal(pp.summary.trucks, 2);
});

test("5 кубиков → 2 трала и предупреждение о кубике без пары", () => {
  const p = singleTier();
  const fm = factoryModules(p);
  assert.equal(fm.modules.length, 2);
  assert.deepEqual(fm.unpairedCubeIds, ["m5"]);
  assert.equal(trucksForCubes(5), 2);
  const ev = evaluate(p);
  assert.ok(ev.valid, "кубик без пары — не запрет, а пометка");
  const w = ev.review.find((r) => r.ruleId === "cubes-pair-into-modules");
  assert.ok(w);
  assert.match(w.message, /требует проверки проектировщиком/);
  const pp = buildPassport(p, ev);
  assert.equal(pp.summary.unpairedCubes, 1);
  assert.ok(pp.verifyByDesigner.some((x) => /без пары/.test(x)));
  assert.ok(pp.budget.whatCanChangePrice.some((x) => /без пары/.test(x)));
});

test("пары только по длинной грани без смещения", () => {
  const p = buildProject({
    id: "short",
    modules: [cube("a", 0, 0, "k"), cube("b", 0, 3420, "k")],
    rooms: [{ id: "k", type: "kitchen-living", tier: 1, moduleIds: ["a", "b"] }],
  });
  assert.equal(
    factoryModules(p).modules.length,
    0,
    "стык по короткой грани 3200 — не заводской модуль",
  );
  const q = buildProject({
    id: "offset",
    modules: [cube("a", 0, 0, "k"), cube("b", 3200, 1710, "k")],
    rooms: [{ id: "k", type: "kitchen-living", tier: 1, moduleIds: ["a", "b"] }],
  });
  assert.equal(factoryModules(q).modules.length, 0, "со смещением 1710 — два отдельных модуля");
});
