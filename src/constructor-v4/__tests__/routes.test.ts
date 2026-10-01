import { test } from "node:test";
import assert from "node:assert/strict";
import { solve } from "../engine/solver.ts";
import { briefFromScenario, type LifeScenario } from "../engine/scenario.ts";
import { checkRoutes, roomGraph, openingSpan } from "../engine/graph.ts";
import { evaluate } from "../engine/rules.ts";
import { planFromProject } from "../engine/plan.ts";
import { buildProject } from "../engine/derive.ts";
import { footprint } from "../engine/geometry.ts";
import { singleTier, twoTier } from "./fixtures.ts";
import type { Project } from "../engine/types.ts";

const plot = { widthM: 30, depthM: 40, northDeg: 0 };
const scenarios: LifeScenario[] = [
  { adults: 2, kids: 0, plot },
  { adults: 2, kids: 1, plot },
  { adults: 2, kids: 2, pets: { dogs: 1 }, plot },
  { adults: 2, kids: 2, workFromHome: 1, guestsOften: true, plot },
  { adults: 2, kids: 3, plot, tiers: 2 },
  { adults: 2, kids: 1, elderly: { mode: "live", count: 2 }, plot },
];
const projects: Project[] = [
  singleTier(),
  twoTier(),
  ...scenarios.flatMap((s) => solve(briefFromScenario(s)).variants.map((v) => v.project)),
];

test("от входа через проёмы доходим до каждой комнаты, спальни не через спальню", () => {
  for (const p of projects) {
    const r = checkRoutes(p);
    assert.ok(r.entranceRooms.length >= 1, `${p.id}: нет входа`);
    assert.deepEqual(r.unreachable, [], `${p.id}: недостижимы ${r.unreachable}`);
    assert.deepEqual(r.throughBedroom, [], `${p.id}: через спальню ${r.throughBedroom}`);
  }
});

test("каждое ребро графа — портал на плане; межкомнатные двери 900 (родителям 1000)", () => {
  for (const p of projects) {
    const plan = planFromProject(p);
    const doorPortals = plan.portals.filter((x) => x.kind === "door");
    const doorEdges = roomGraph(p).filter((e) => e.via === "door");
    assert.equal(doorPortals.length, doorEdges.length, p.id);
    for (const o of p.openings.filter((x) => x.kind === "internal-door")) {
      const room = p.rooms.find((r) => r.id === o.roomId)!;
      assert.equal(o.widthMm, room.purpose ? 1000 : 900, `${p.id} ${o.id}`);
    }
  }
});

test("дверь прорезает обе стены стыка: на плане в проёме нет стены", () => {
  for (const p of projects) {
    const plan = planFromProject(p);
    for (const o of p.openings.filter((x) => x.kind !== "window")) {
      const m = p.modules.find((x) => x.id === o.moduleId)!;
      const [s0, s1] = openingSpan(m, o);
      const mid = (s0 + s1) / 2;
      const horizontal = o.face === "N" || o.face === "S";
      const fp = footprint(m);
      const line = o.face === "N" ? fp.y1 : o.face === "S" ? fp.y0 : o.face === "E" ? fp.x1 : fp.x0;
      // Стена на линии этой грани (своя или соседа вплотную), перекрывающая середину проёма.
      const blocked = plan.walls.some((w) => {
        if (w.tier !== m.tier || w.kind === "partition") return false;
        const d = w.rect;
        const along = horizontal ? mid > d.x0 && mid < d.x1 : mid > d.y0 && mid < d.y1;
        const onLine = horizontal ? d.y0 === line || d.y1 === line : d.x0 === line || d.x1 === line;
        return along && onLine;
      });
      assert.ok(!blocked, `${p.id}: стена закрывает проём ${o.id}`);
    }
  }
});

test("стык внутри помещения — портал, между помещениями — две тонкие стены", () => {
  const p = singleTier();
  const plan = planFromProject(p);
  assert.ok(plan.portals.some((x) => x.kind === "open" && x.rooms[0] === "kitchen"));
  const joint = plan.walls.filter((w) => w.kind === "joint-b2b");
  assert.ok(joint.length > 0);
  for (const w of joint) {
    const t = Math.min(w.drawRect.x1 - w.drawRect.x0, w.drawRect.y1 - w.drawRect.y0);
    assert.equal(t, 120, "стена стыка рисуется тонкой");
  }
  assert.equal(plan.entrances.length, 1);
  assert.match(plan.entrances[0].label, /Вход/);
});

test("комната без проёма к остальным — маршрутная ошибка", () => {
  const p = singleTier();
  const q = buildProject({ id: "nodoor", modules: p.modules, rooms: p.rooms, plot: p.plot });
  const cut = {
    ...q,
    openings: q.openings.filter((o) => !(o.kind === "internal-door" && o.roomId === "bed1")),
  };
  assert.ok(
    evaluate(cut).hardViolations.some((v) => v.ruleId === "routes" || v.ruleId === "room-doors"),
  );
  assert.ok(checkRoutes(cut).unreachable.includes("bed1"));
});

test("в мокром модуле со входом двери выходят в тамбур, а не в санузел", async () => {
  const { wetZones } = await import("../engine/plan.ts");
  for (const p of projects)
    for (const m of p.modules.filter(
      (x) => p.rooms.find((r) => r.moduleIds.includes(x.id))?.type === "wet-core",
    )) {
      const z = wetZones(p, m);
      if (!z.tambour) continue;
      for (const o of p.openings.filter((x) => x.moduleId === m.id && x.kind !== "window")) {
        const [s0, s1] = openingSpan(m, o);
        const horizontal = o.face === "N" || o.face === "S";
        const [t0, t1] = horizontal ? [z.tambour.x0, z.tambour.x1] : [z.tambour.y0, z.tambour.y1];
        assert.ok(s0 >= t0 - 220 && s1 <= t1 + 1, `${p.id} ${o.id}: дверь мимо тамбура`);
      }
    }
});

test("наружные стены целые: проём соседа режет только стену стыка", () => {
  // Холл второго яруса u1 (x 0..3200) граничит со спальней u2 на востоке;
  // дверь спальни прорезает стык, а западная наружная стена холла остаётся сплошной.
  const plan = planFromProject(twoTier());
  const west = plan.walls.filter(
    (w) => w.moduleId === "u1" && w.kind === "exterior" && w.rect.x0 === 0 && w.rect.x1 === 210,
  );
  assert.equal(
    west.reduce((s, w) => s + (w.rect.y1 - w.rect.y0), 0),
    3420,
  );
});
