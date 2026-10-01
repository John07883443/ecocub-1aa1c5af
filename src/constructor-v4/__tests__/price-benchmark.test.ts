import { test } from "node:test";
import assert from "node:assert/strict";
import { solve } from "../engine/solver.ts";
import { budgetFor } from "../engine/price.ts";
import { PRICE_CONFIG } from "../engine/price-config.ts";

test("ориентир владельца: типовой дом ≈130 тыс. ₽/м² всё включено (середина вилки)", () => {
  assert.equal(PRICE_CONFIG.benchmarkAllInPerM2.min, 130_000);
  const r = solve({
    bedrooms: 2,
    bathrooms: 1,
    tiers: 1,
    kitchenLiving: "large",
    yearRound: true,
    plot: { widthM: 30, depthM: 40 },
  });
  const v = r.variants.find((x) => x.project.modules.length === 6) ?? r.variants[0];
  const b = budgetFor(v.project);
  assert.ok(
    b.benchmark.allInMidPerM2 >= 122_000 && b.benchmark.allInMidPerM2 <= 138_000,
    `середина ${b.benchmark.allInMidPerM2} ₽/м²`,
  );
  assert.ok(b.total.max > b.total.min, "всегда вилка");
});
