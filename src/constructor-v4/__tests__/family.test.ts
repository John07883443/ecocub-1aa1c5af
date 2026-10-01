import { test } from "node:test";
import assert from "node:assert/strict";
import {
  briefFromScenario,
  checkArea,
  programFromScenario,
  type LifeScenario,
} from "../engine/scenario.ts";
import { solve } from "../engine/solver.ts";
import { evaluate } from "../engine/rules.ts";
import { buildPassport } from "../engine/passport.ts";
import { buildProject } from "../engine/derive.ts";
import { twoTier } from "./fixtures.ts";

const plot = { widthM: 30, depthM: 40, northDeg: 0 };
const base: LifeScenario = { adults: 2, kids: 1, plot };

test("кошка, собака, другие — рекомендации в программе и паспорте", () => {
  const s: LifeScenario = { ...base, pets: { dogs: 1, cats: 2, other: 1 } };
  const prog = programFromScenario(s);
  assert.ok(prog.recommendations.some((r) => /лоток/.test(r) && /вытяжк/.test(r)));
  assert.ok(
    prog.recommendations.some((r) => /лап/.test(r) && /лежанк/.test(r) && /дверца/.test(r)),
  );
  assert.ok(prog.recommendations.some((r) => /Другие питомцы/.test(r)));
  assert.ok(prog.plotItems.some((x) => /Огороженная площадка/.test(x)));
  const v = solve(briefFromScenario(s)).variants[0];
  const pp = buildPassport(v.project);
  assert.ok(pp.recommendations.some((r) => /лоток/.test(r)));
  assert.ok(pp.recommendations.some((r) => /площадка/.test(r)));
});

test("пожилые родители живут с нами: +спальня и свой санузел, только 1-й ярус", () => {
  const withParents: LifeScenario = { ...base, elderly: { mode: "live", count: 2 }, tiers: 2 };
  const a = programFromScenario(base);
  const b = programFromScenario(withParents);
  assert.equal(b.minModules - a.minModules, 2, "спальня + санузел родителей");
  assert.ok(checkArea(withParents).minAreaM2 > checkArea(base).minAreaM2);
  const r = solve(briefFromScenario(withParents));
  assert.ok(r.variants.length >= 1, r.notes.join("; "));
  for (const v of r.variants) {
    const elder = v.project.rooms.find((x) => x.purpose === "elderly");
    assert.ok(elder, "есть комната родителей");
    assert.equal(elder.tier, 1, "родители не на втором ярусе");
    assert.ok(evaluate(v.project).valid);
    const door = v.project.openings.find(
      (o) => o.roomId === elder.id && o.kind === "internal-door",
    );
    assert.equal(door?.widthMm, 1000, "широкая дверь");
    const pp = buildPassport(v.project);
    assert.ok(pp.rooms.some((x) => /пожилых родителей/.test(x.label)));
    assert.ok(pp.verifyByDesigner.some((x) => /без порогов/.test(x)));
    assert.ok(pp.recommendations.some((x) => /поручни/.test(x)));
  }
});

test("родители в гостях: гостевая на 1-м ярусе, можно трансформируемая", () => {
  const s: LifeScenario = { ...base, elderly: { mode: "visit", count: 1 } };
  const prog = programFromScenario(s);
  assert.ok(prog.items.some((i) => i.purpose === "elderly-guest" && /1-й ярус/.test(i.label)));
  assert.ok(prog.recommendations.some((x) => /трансформируем/.test(x)));
  assert.equal(prog.minModules - programFromScenario(base).minModules, 1);
});

test("комната родителей на втором ярусе — жёсткий запрет", () => {
  const p = twoTier();
  const q = buildProject({
    id: "e",
    modules: p.modules,
    rooms: p.rooms.map((r) => (r.id === "bed1" ? { ...r, purpose: "elderly" as const } : r)),
    plot: p.plot,
  });
  assert.ok(evaluate(q).hardViolations.some((v) => v.ruleId === "elderly-ground-floor"));
});
