import { solve } from "./engine/solver.ts";
for (const tiers of [1, 2, "any"] as const) {
  const t = Date.now();
  const r = solve({
    bedrooms: 2,
    bathrooms: 1,
    tiers,
    kitchenLiving: "compact",
    yearRound: true,
    plot: { widthM: 30, depthM: 40, northDeg: 0 },
  });
  console.log(
    tiers,
    Date.now() - t,
    "ms",
    r.variants.length,
    r.rejected,
    r.notes,
    r.variants.map((v) => v.summary + " score " + v.score.toFixed(2)),
  );
}
