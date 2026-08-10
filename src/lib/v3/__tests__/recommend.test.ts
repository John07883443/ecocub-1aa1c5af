import { test } from "node:test";
import assert from "node:assert/strict";
import { PLAN_LIBRARY } from "../plans.ts";
import { hardFilter, recommend, scorePlan, totalScore, SCORING_WEIGHTS } from "../recommend.ts";
import { normalizeProfile } from "../profile.ts";
import type { ClientHomeProfile } from "../types.ts";

const familyProfile: ClientHomeProfile = normalizeProfile({
  purpose: "Круглогодичное проживание (ПМЖ)",
  household: "Семья с двумя и более детьми",
  floors: "1 этаж",
  plot: "Участок уже есть",
  budget: "11–15 млн ₽",
  timing: "В ближайший сезон",
});

test("жёсткий фильтр отсекает планы с недостатком спален и чужой этажностью", () => {
  const { passed, rejected } = hardFilter(PLAN_LIBRARY, familyProfile);
  for (const plan of passed) {
    assert.ok(plan.metrics.bedrooms >= familyProfile.bedrooms, plan.id);
    assert.equal(plan.metrics.floors, 1, plan.id);
  }
  assert.ok(rejected.some((r) => r.plan.slug === "studio"));
  for (const r of rejected) assert.ok(r.reasons.length > 0);
});

test("семье с двумя детьми рекомендуются реальные планы, сбалансированный первым", () => {
  const { recommendations } = recommend(PLAN_LIBRARY, familyProfile);
  assert.ok(recommendations.length >= 1 && recommendations.length <= 3);
  assert.equal(recommendations[0].kind, "balanced");
  for (const rec of recommendations) {
    assert.ok(rec.plan.metrics.bedrooms >= 3, rec.plan.id);
    assert.ok(rec.reasons.length > 0);
    assert.ok(rec.estimate.price > 0);
    // Условные схемы обязаны нести компромисс-предупреждение.
    if (rec.plan.needsReview) {
      assert.ok(rec.tradeoffs.some((t) => t.includes("условная")));
    }
  }
});

test("если подходит меньше трёх планов — фиктивные варианты не создаются", () => {
  // Три спальни и строго два этажа: в библиотеке такой план один — two-story.
  const narrow: ClientHomeProfile = {
    ...familyProfile,
    bedrooms: 3,
    preferredFloors: [2],
  };
  const { recommendations } = recommend(PLAN_LIBRARY, narrow);
  assert.equal(recommendations.length, 1);
  assert.equal(recommendations[0].plan.slug, "two-story");
  assert.equal(recommendations[0].kind, "balanced");
});

test("запрос, которому не отвечает ни один план, честно даёт пустой список", () => {
  const impossible: ClientHomeProfile = { ...familyProfile, bedrooms: 6 };
  const { recommendations, rejected } = recommend(PLAN_LIBRARY, impossible);
  assert.equal(recommendations.length, 0);
  assert.equal(rejected.length, PLAN_LIBRARY.length);
});

test("скоринг прозрачен: сумма компонентов с весами даёт итог", () => {
  const plan = PLAN_LIBRARY.find((p) => p.slug === "family-one")!;
  const breakdown = scorePlan(plan, familyProfile);
  assert.equal(breakdown.length, Object.keys(SCORING_WEIGHTS).length);
  const manual =
    breakdown.reduce((s, b) => s + b.value * b.weight, 0) /
    breakdown.reduce((s, b) => s + b.weight, 0);
  assert.ok(Math.abs(totalScore(breakdown) - manual) < 1e-9);
  for (const b of breakdown) assert.ok(b.value >= 0 && b.value <= 1, b.key);
});

test("участок с известными размерами отсекает слишком большие дома", () => {
  const smallPlot: ClientHomeProfile = {
    ...familyProfile,
    plot: { exists: true, widthM: 15, depthM: 15 },
  };
  const { passed } = hardFilter(PLAN_LIBRARY, smallPlot);
  for (const plan of passed) {
    const ground = plan.cells.filter((c) => c.floor === 0);
    const w = Math.max(...ground.map((c) => c.x + 3)) - Math.min(...ground.map((c) => c.x));
    const d = Math.max(...ground.map((c) => c.z + 3)) - Math.min(...ground.map((c) => c.z));
    assert.ok(Math.min(w, d) <= 9 && Math.max(w, d) <= 9, plan.id);
  }
});
