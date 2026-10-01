import { test } from "node:test";
import assert from "node:assert/strict";
import { solve } from "../engine/solver.ts";
import { briefFromScenario, type LifeScenario } from "../engine/scenario.ts";
import { evaluate, modulesOnTier } from "../engine/rules.ts";
import { canPair } from "../engine/factory.ts";
import {
  HARMONY,
  aspectRatio,
  facadeProfile,
  fillRatio,
  outlineCorners,
  patternShapes,
} from "../engine/patterns.ts";
import { buildProject } from "../engine/derive.ts";
import { planFromProject } from "../engine/plan.ts";
import type { Project, Side } from "../engine/types.ts";

const plot = { widthM: 30, depthM: 40, northDeg: 0 };
const scenarios: LifeScenario[] = [
  { adults: 2, kids: 0, plot },
  { adults: 2, kids: 1, plot },
  { adults: 2, kids: 2, pets: { dogs: 1 }, plot },
  { adults: 2, kids: 2, workFromHome: 1, guestsOften: true, plot },
  { adults: 2, kids: 3, plot, tiers: 2 },
  { adults: 2, kids: 1, elderly: { mode: "live", count: 2 }, plot },
];
const variants: Project[] = scenarios.flatMap((s) =>
  solve(briefFromScenario(s)).variants.map((v) => v.project),
);

test("каждый сценарий даёт варианты", () => {
  for (const s of scenarios)
    assert.ok(solve(briefFromScenario(s)).variants.length >= 1, JSON.stringify(s));
});

test("никаких зигзагов: ≤ 8 углов, ≤ 1 уступа на фасад, заполнение ≥ 75 %, пропорции ≤ 1:2,2", () => {
  for (const p of variants)
    for (const tier of [1, 2]) {
      const mods = modulesOnTier(p, tier);
      if (mods.length < 2) continue;
      assert.ok(
        outlineCorners(mods) <= HARMONY.maxCorners,
        `${p.id} ярус ${tier}: углов ${outlineCorners(mods)}`,
      );
      for (const side of ["N", "E", "S", "W"] as Side[]) {
        const f = facadeProfile(mods, side);
        assert.ok(f.steps <= 2 && f.levels <= 2, `${p.id} ${side}: ${JSON.stringify(f)}`);
      }
      if (mods.length >= 3)
        assert.ok(fillRatio(mods) >= 0.75, `${p.id}: заполнение ${fillRatio(mods)}`);
      assert.ok(aspectRatio(mods) <= (tier === 2 ? HARMONY.maxAspectUpper : HARMONY.maxAspect));
    }
});

test("у каждой комнаты есть дверь, спальни не проходные; двери нарисованы в 2D", () => {
  for (const p of variants) {
    const hubs = new Set(["kitchen-living", "hall", "corridor"]);
    for (const r of p.rooms.filter((x) => !hubs.has(x.type)))
      assert.ok(
        p.openings.some(
          (o) => o.roomId === r.id && (o.kind === "internal-door" || o.kind === "entrance"),
        ),
        `${p.id}: ${r.id} без двери`,
      );
    assert.ok(!evaluate(p).hardViolations.some((v) => v.ruleId === "room-doors"));
    const plan = planFromProject(p);
    assert.equal(plan.doors.length, p.openings.filter((o) => o.kind !== "window").length);
  }
});

test("кухня-гостиная не уже двух кубиков (≥ 6,4 м)", () => {
  for (const p of variants) {
    const k = p.rooms.find((r) => r.type === "kitchen-living")!;
    const mods = p.modules.filter((m) => k.moduleIds.includes(m.id));
    assert.ok(
      mods.some((a) => mods.some((b) => a !== b && canPair(a, b))),
      `${p.id}: узкая кухня`,
    );
  }
});

test("узкая кухня и зигзаг отклоняются правилами", () => {
  // Кухня из двух кубиков друг за другом по короткой стороне — 3,2 м шириной.
  const narrow = buildProject({
    id: "narrow",
    modules: [
      { id: "a", xMm: 0, yMm: 0, rot: 0, tier: 1, roomId: "k" },
      { id: "b", xMm: 0, yMm: 3420, rot: 0, tier: 1, roomId: "k" },
      { id: "c", xMm: 3200, yMm: 0, rot: 0, tier: 1, roomId: "w" },
    ],
    rooms: [
      { id: "k", type: "kitchen-living", tier: 1, moduleIds: ["a", "b"] },
      { id: "w", type: "wet-core", tier: 1, moduleIds: ["c"] },
    ],
  });
  assert.ok(evaluate(narrow).hardViolations.some((v) => v.ruleId === "kitchen-width"));
  // Лесенка: каждый следующий кубик сдвинут на 1710.
  const stairs = buildProject({
    id: "zigzag",
    modules: [0, 1, 2, 3].map((i) => ({
      id: `z${i}`,
      xMm: i * 3200,
      yMm: i * 1710,
      rot: 0 as const,
      tier: 1,
      roomId: "k",
    })),
    rooms: [{ id: "k", type: "kitchen-living", tier: 1, moduleIds: ["z0", "z1", "z2", "z3"] }],
  });
  assert.ok(evaluate(stairs).hardViolations.some((v) => v.ruleId === "footprint-harmony"));
});

test("библиотека форм: только проверенные формы с образцом", () => {
  for (let n = 2; n <= 12; n++)
    for (const s of patternShapes(n)) {
      assert.equal(s.cells.length, n);
      assert.ok(s.reference.length > 0);
    }
  assert.ok(patternShapes(6).some((s) => s.label.includes("3×2")));
  assert.ok(patternShapes(5).some((s) => s.id === "U"));
});
