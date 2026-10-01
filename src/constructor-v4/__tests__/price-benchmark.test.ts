import { test } from "node:test";
import assert from "node:assert/strict";
import { solve } from "../engine/solver.ts";
import { budgetFor } from "../engine/price.ts";
import { PRICE_CONFIG } from "../engine/price-config.ts";

function typicalHouse() {
  const r = solve({
    bedrooms: 2,
    bathrooms: 1,
    tiers: 1,
    kitchenLiving: "large",
    yearRound: true,
    plot: { widthM: 30, depthM: 40 },
  });
  return (r.variants.find((x) => x.project.modules.length === 6) ?? r.variants[0]).project;
}

test("ориентир владельца: типовой дом ≈150 тыс. ₽/м² под ключ, тёплый контур ≈130 тыс.", () => {
  assert.equal(PRICE_CONFIG.benchmarkAllInPerM2.min, 150_000);
  assert.equal(PRICE_CONFIG.benchmarkWarmShellPerM2.min, 130_000);
  const b = budgetFor(typicalHouse());
  assert.ok(
    b.benchmark.allInMidPerM2 >= 142_000 && b.benchmark.allInMidPerM2 <= 158_000,
    `под ключ ${b.benchmark.allInMidPerM2} ₽/м²`,
  );
  assert.ok(
    b.benchmark.warmShellMidPerM2 >= 122_000 && b.benchmark.warmShellMidPerM2 <= 138_000,
    `тёплый контур ${b.benchmark.warmShellMidPerM2} ₽/м²`,
  );
  assert.ok(b.total.max > b.total.min, "всегда вилка");
});

test("материалы чистовой отделки — отдельная строка ≈15 тыс./м², можно «свои»", () => {
  const p = typicalHouse();
  const warm = p.modules.length * 10.944;
  const inc = budgetFor(p).lines.find((l) => l.id === "finishing-materials")!;
  const mid = (inc.min + inc.max) / 2 / warm;
  assert.ok(mid >= 13_000 && mid <= 17_000, `материалы ${mid} ₽/м²`);
  assert.ok(inc.placeholder);
  const own = budgetFor({ ...p, finishingMaterials: "own" });
  const line = own.lines.find((l) => l.id === "finishing-materials")!;
  assert.equal(line.max, 0);
  assert.match(line.label, /свои/);
  assert.ok(own.total.max < budgetFor(p).total.max);
  assert.ok(budgetFor(p).lines.some((l) => l.id === "finishing-works"));
});
