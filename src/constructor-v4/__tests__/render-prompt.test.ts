/**
 * Промпт рендера по точному дому: размеры пятна, ярусы и консоли, окна по фасаду
 * слева направо, материалы из отделок, терраса и навес, ближайший дом-образец.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { promptFor, viewSet } from "../engine/render-plan.ts";
import {
  buildRenderPrompt,
  closestArchetype,
  facadeOpenings,
  footprintShape,
  massingDescription,
  topViewGrid,
} from "../engine/render-prompt.ts";
import { applyCommand } from "../engine/commands.ts";
import { modulesOnTier } from "../engine/rules.ts";
import { singleTier, twoTier } from "./fixtures.ts";

test("масса: пятно в метрах, ярусы, консоль и схема сверху", () => {
  const p = twoTier(1200);
  const m = massingDescription(p);
  assert.match(m, /6 identical box modules/);
  assert.match(m, /Ground floor: 4 modules, rectangle footprint 6\.4 m \(east-west\) × 6\.8 m/);
  assert.match(m, /cantilevering 1\.2 m to the east/);
  assert.equal(topViewGrid(p, 1), "WS/LL");
  const one = massingDescription(singleTier());
  assert.match(one, /No upper floor/);
  assert.equal(footprintShape(modulesOnTier(singleTier(), 1)), "L-shape");
});

test("окна фасада — слева направо, как видит камера; число окон совпадает с моделью", () => {
  const p = singleTier();
  const vs = viewSet(p);
  for (const v of vs.views.filter((x) => x.kind === "facade")) {
    const fo = facadeOpenings(p, v.side!);
    const n = fo.reduce((a, f) => a + f.count, 0);
    assert.equal(n, v.expectedWindows, v.id);
    const t = promptFor(p, v);
    assert.match(t, new RegExp(`exactly ${v.expectedWindows} window`));
    if (n) assert.match(t, /left to right: /);
  }
  // Южный фасад: позиции растут слева направо.
  const s = facadeOpenings(p, "S")[0];
  if (s) {
    const at = [...s.text.matchAll(/at (\d+\.\d)/g)].map((x) => Number(x[1]));
    assert.deepEqual(
      at,
      [...at].sort((a, b) => a - b),
    );
  }
});

test("материалы и окружение из модели: белая штукатурка, терраса, навес, без скатной кровли", () => {
  const p0 = singleTier();
  const r = applyCommand(p0, { op: "set_style", style: "фирменный" });
  assert.ok(r.ok);
  const car = applyCommand(r.project, { op: "carport", action: "add", side: "W" });
  assert.ok(car.ok);
  const p = car.project;
  const v = viewSet(p).views.find((x) => x.kind === "aerial")!;
  const t = buildRenderPrompt(p, v);
  assert.match(t, /white plaster/);
  assert.match(t, /never pitched/);
  assert.match(t, /terrace ≈\d+ m² along the/);
  assert.match(t, /carport for one car on the west side/);
  assert.ok(t.length <= 3900, "сервер режет промпт на 4000");
  const dark = applyCommand(p0, {
    op: "set_finish",
    category: "facade",
    finishId: "planken-thermo",
  });
  assert.ok(dark.ok && /thermo-treated dark wood/.test(buildRenderPrompt(dark.project, v)));
});

test("ближайший образец: двухъярусный — двухъярусная вилла слайдера; размер — по каталогу", () => {
  const a2 = closestArchetype(twoTier(1200));
  assert.equal(a2.heroId, "hero-7");
  const a1 = closestArchetype(singleTier());
  assert.equal(a1.heroId, "hero-4", "Г-план — угловая вилла");
  assert.ok(["weekend-one", "sky-river"].includes(a1.catalogId));
  const v = viewSet(singleTier()).views[0];
  assert.match(buildRenderPrompt(singleTier(), v), /Closest EcoCub reference: «Угловая вилла/);
});
