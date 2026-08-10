import { test } from "node:test";
import assert from "node:assert/strict";
import { estimateByAreas, estimateModules, estimatePlan, PRICE_VERSION } from "../pricing.ts";
import { site } from "../../site.ts";
import { TERRACE_PRICE_FACTOR } from "../../constructor/constants.ts";

test("оценка по площадям совпадает с формулой боевого конструктора", () => {
  const e = estimateByAreas(90, 18);
  const expected = Math.round(
    90 * site.basePricePerM2 + 18 * site.basePricePerM2 * TERRACE_PRICE_FACTOR,
  );
  assert.equal(e.price, expected);
  assert.equal(e.min, expected);
  assert.ok(e.max > e.price);
  assert.equal(e.priceVersion, PRICE_VERSION);
  assert.ok(e.disclaimer.includes("Фундамент"));
});

test("оценка конфигурации из модулей делит жилое и террасы", () => {
  const e = estimateModules([{ role: "living" }, { role: "bedroom" }, { role: "terrace" }]);
  const expected = Math.round(
    18 * site.basePricePerM2 + 9 * site.basePricePerM2 * TERRACE_PRICE_FACTOR,
  );
  assert.equal(e.price, expected);
});

test("подтверждённая цена карточки главнее расчётной", () => {
  const e = estimatePlan(126, 18, 12_000_000);
  assert.equal(e.price, 12_000_000);
  assert.ok(e.min <= 12_000_000);
  assert.ok(e.max >= 12_000_000);
});
