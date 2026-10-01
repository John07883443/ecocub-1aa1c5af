import { test } from "node:test";
import assert from "node:assert/strict";
import { solve } from "../engine/solver.ts";
import { briefFromScenario, type LifeScenario } from "../engine/scenario.ts";
import { evaluate } from "../engine/rules.ts";
import { TV, tvPlace } from "../engine/tv.ts";
import { planFromProject } from "../engine/plan.ts";
import { buildPassport } from "../engine/passport.ts";
import { footprint } from "../engine/geometry.ts";
import { singleTier, twoTier } from "./fixtures.ts";
import type { Project } from "../engine/types.ts";

const plot = { widthM: 30, depthM: 40, northDeg: 0 };
const scenarios: LifeScenario[] = [
  { adults: 2, kids: 0, plot },
  { adults: 2, kids: 1, plot },
  { adults: 2, kids: 2, pets: { dogs: 1 }, plot },
  { adults: 2, kids: 3, plot, tiers: 2 },
  { adults: 2, kids: 1, elderly: { mode: "live", count: 2 }, plot },
];
const projects: Project[] = [
  singleTier(),
  twoTier(),
  ...scenarios.flatMap((s) => solve(briefFromScenario(s)).variants.map((v) => v.project)),
];

test("в каждой общей комнате есть место под ТВ по правилам", () => {
  for (const p of projects) {
    const t = tvPlace(p);
    assert.ok(t, `${p.id}: нет места под ТВ`);
    assert.ok(t.wall[1] - t.wall[0] >= TV.minWallMm, "глухая стена ≥ 2,4 м");
    assert.ok(t.viewingMm >= TV.viewMinMm && t.viewingMm <= TV.viewMaxMm, "до дивана 2,5–3,5 м");
    assert.ok(evaluate(p).results.some((r) => r.ruleId === "tv-wall" && r.ok));
    // На глухом отрезке нет проёмов.
    const m = p.modules.find((x) => x.id === t.moduleId)!;
    const r = footprint(m);
    const horizontal = t.face === "N" || t.face === "S";
    for (const o of p.openings.filter((x) => x.moduleId === m.id && x.face === t.face)) {
      const start = (horizontal ? r.x0 : r.y0) + o.offsetMm;
      assert.ok(start >= t.wall[1] || start + o.widthMm <= t.wall[0], `${p.id}: проём на стене ТВ`);
    }
  }
});

test("ТВ и диван на плане и в паспорте", () => {
  for (const p of projects) {
    const plan = planFromProject(p);
    assert.ok(
      plan.furniture.some((f) => f.kind === "tv"),
      p.id,
    );
    assert.ok(
      plan.furniture.some((f) => f.kind === "sofa"),
      p.id,
    );
    assert.ok(buildPassport(p).tv, p.id);
  }
});

test("общая комната без глухой стены — отказ правила tv-wall", () => {
  const p = singleTier();
  const k = p.rooms.find((r) => r.type === "kitchen-living")!;
  // Окна во всю стену на каждой грани общей комнаты (поставлены человеком — ремонт их не снимает).
  const glazed = {
    ...p,
    openings: [
      ...p.openings.filter((o) => o.roomId !== k.id || o.kind !== "window"),
      ...k.moduleIds.flatMap((id) =>
        (["N", "E", "S", "W"] as const).map((face, i) => ({
          id: `g-${id}-${i}`,
          moduleId: id,
          roomId: k.id,
          face,
          kind: "window" as const,
          widthMm: 2780,
          heightMm: 3150,
          offsetMm: 210,
          userSet: true,
        })),
      ),
    ],
  };
  assert.ok(!tvPlace(glazed));
  assert.ok(evaluate(glazed).hardViolations.some((v) => v.ruleId === "tv-wall"));
});
