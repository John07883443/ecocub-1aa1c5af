import { test } from "node:test";
import assert from "node:assert/strict";
import { PLAN_LIBRARY, validatePlanLibrary, metricsFromCells } from "../plans.ts";

test("библиотека планов проходит валидацию геометрии и метрик", () => {
  const errors = validatePlanLibrary();
  assert.deepEqual(errors, []);
});

test("в библиотеке есть все 5 карточек каталога и 6 шаблонов конструктора", () => {
  const catalog = PLAN_LIBRARY.filter((p) => p.id.startsWith("catalog-"));
  const templates = PLAN_LIBRARY.filter((p) => p.id.startsWith("template-"));
  assert.equal(catalog.length, 5);
  assert.equal(templates.length, 6);
});

test("планы из карточек честно помечены needsReview с пояснениями", () => {
  for (const plan of PLAN_LIBRARY.filter((p) => p.id.startsWith("catalog-"))) {
    assert.equal(plan.needsReview, true, plan.id);
    assert.ok(plan.reviewNotes && plan.reviewNotes.length > 0, plan.id);
  }
});

test("метрики из ячеек считают спальни, санузлы, этажи и площади", () => {
  const plan = PLAN_LIBRARY.find((p) => p.slug === "sky-river")!;
  const m = metricsFromCells(plan.cells);
  assert.equal(m.bedrooms, 2);
  assert.equal(m.bathrooms, 1);
  assert.equal(m.floors, 1);
  assert.equal(m.heatedAreaM2 + m.terraceAreaM2, m.grossAreaM2);
});
