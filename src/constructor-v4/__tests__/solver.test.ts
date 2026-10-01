import { test } from "node:test";
import assert from "node:assert/strict";
import { solve } from "../engine/solver.ts";
import { evaluate, modulesOnTier } from "../engine/rules.ts";
import { supportOf } from "../engine/geometry.ts";
import { buildPassport, passportGaps } from "../engine/passport.ts";
import type { Brief } from "../engine/types.ts";

const base: Brief = {
  bedrooms: 2,
  bathrooms: 1,
  tiers: 1,
  kitchenLiving: "compact",
  yearRound: true,
  plot: { widthM: 30, depthM: 40, northDeg: 0 },
  styleHints: ["скандинавский"],
};

test("«2 спальни, 1 санузел, кухня-гостиная, терраса» → 3 допустимых варианта", () => {
  const r = solve(base);
  assert.equal(r.variants.length, 3);
  const sigs = new Set<string>();
  for (const v of r.variants) {
    assert.ok(evaluate(v.project).valid, "вариант без hard-нарушений");
    const types = v.project.rooms.map((x) => x.type);
    assert.equal(types.filter((t) => t === "bedroom").length, 2);
    assert.equal(types.filter((t) => t === "wet-core").length, 1);
    assert.equal(types.filter((t) => t === "kitchen-living").length, 1);
    assert.ok(v.project.terrace.totalM2 > 0, "терраса есть");
    assert.equal(v.project.finishes.styleId, "scandi");
    sigs.add(JSON.stringify(v.project.modules.map((m) => [m.xMm, m.yMm, m.tier])));
  }
  assert.equal(sigs.size, 3, "варианты разные");
});

test("солвер детерминирован по seed", () => {
  assert.deepEqual(solve(base, { seed: 7 }), solve(base, { seed: 7 }));
});

test("два яруса: свес везде ≤ 1,5 м, холл над общей комнатой", () => {
  const r = solve({ ...base, tiers: 2 });
  assert.ok(r.variants.length >= 1);
  for (const v of r.variants) {
    const t1 = modulesOnTier(v.project, 1);
    const up = modulesOnTier(v.project, 2);
    assert.ok(up.length > 0);
    for (const u of up)
      for (const o of Object.values(supportOf(u, t1).overhangMm)) assert.ok(o <= 1500);
    assert.ok(v.project.rooms.some((x) => x.type === "hall" && x.tier === 2));
  }
});

test("tiers: any — в выдаче есть и одноярусный, и двухъярусный", () => {
  const r = solve({ ...base, tiers: "any" });
  assert.equal(r.variants.length, 3);
  assert.deepEqual(new Set(r.variants.map((v) => v.tiers)), new Set([1, 2]));
});

test("крупный бриф (4 спальни, большая кухня, кабинет) решается", () => {
  const r = solve({
    ...base,
    bedrooms: 4,
    bathrooms: undefined,
    kitchenLiving: "large",
    study: true,
    tiers: "any",
  });
  assert.ok(r.variants.length >= 1, r.notes.join("; "));
  for (const v of r.variants) assert.ok(evaluate(v.project).valid);
});

test("каждый вариант даёт полный паспорт проекта и бюджет вилкой", () => {
  const briefs: Brief[] = [
    base,
    { ...base, tiers: 2 },
    { ...base, bedrooms: 3, kitchenLiving: "large" },
  ];
  for (const brief of briefs)
    for (const v of solve(brief).variants) {
      const pp = buildPassport(v.project, v.evaluation);
      assert.deepEqual(passportGaps(pp), [], `паспорт ${v.project.id}`);
      assert.ok(pp.budget.total.max > pp.budget.total.min);
      assert.ok(pp.budget.lines.every((l) => l.max >= l.min));
      assert.ok(
        pp.budget.lines.some((l) => l.placeholder),
        "ставки помечены как заглушки",
      );
      assert.ok(pp.budget.whatCanChangePrice.length >= 5);
      assert.equal(pp.module.clearMm, "2780 × 3000 × 3150");
      assert.ok(pp.rooms.every((r) => r.clearAreaM2 >= 8.34));
      assert.ok(pp.verifyByDesigner.length > 0);
    }
});
