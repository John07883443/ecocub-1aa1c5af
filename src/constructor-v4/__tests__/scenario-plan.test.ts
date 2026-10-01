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
import { planFromProject, clearRect } from "../engine/plan.ts";
import { roomRegion } from "../engine/tv.ts";
import { STAGE2, promptFor, viewSet } from "../engine/render-plan.ts";
import { applyCommand, parseCommand, rotateHouse90 } from "../engine/commands.ts";
import { FINISHES, findStyle } from "../grammar/index.ts";
import { singleTier, twoTier } from "./fixtures.ts";

const plot = { widthM: 30, depthM: 40, northDeg: 0 };

test("семья из 4 с собакой в 60 м² — «не помещается, рекомендуем 85–95 м²»", () => {
  const s: LifeScenario = {
    adults: 2,
    kids: 2,
    pets: { dogs: 1 },
    desiredAreaM2: { min: 50, max: 60 },
    plot,
  };
  const prog = programFromScenario(s);
  assert.ok(
    prog.items.some((i) => /лапы/.test(i.why)),
    "собака → тамбур-грязевая",
  );
  assert.ok(prog.plotItems.some((x) => /собак/.test(x)));
  const c = checkArea(s, prog);
  assert.equal(c.fits, false);
  assert.deepEqual(c.limitedBy, ["area"]);
  assert.deepEqual(c.recommendedAreaM2, { min: 85, max: 95 });
  assert.match(c.message, /не помещается/);
  assert.match(c.message, /рекомендуем 85–95 м²/);
  const ids = c.options.map((o) => o.id);
  assert.ok(
    ids.includes("bigger") && ids.includes("kids-share") && ids.includes("compact-kitchen"),
  );
  assert.ok(c.options.every((o) => o.reason.length > 10));
});

test("двое взрослых — компактные варианты", () => {
  const s: LifeScenario = {
    adults: 2,
    kids: 0,
    desiredAreaM2: { min: 40, max: 55 },
    tiers: 1,
    plot,
  };
  const c = checkArea(s);
  assert.equal(c.fits, true);
  assert.equal(programFromScenario(s).minModules, 4);
  const r = solve(briefFromScenario(s));
  assert.ok(r.variants.length >= 2);
  for (const v of r.variants) {
    assert.ok(v.project.modules.length <= 5);
    assert.ok(evaluate(v.project).valid);
  }
});

test("бюджет меньше минимальной оценки — говорим честно", () => {
  const c = checkArea({ adults: 2, kids: 1, budgetRub: { min: 1_000_000, max: 2_000_000 }, plot });
  assert.equal(c.fits, false);
  assert.ok(c.limitedBy.includes("budget"));
  assert.match(c.message, /предварительно/);
  assert.ok(c.minBudgetRub.max > c.minBudgetRub.min);
});

test("работа из дома, гости, сауна, машина — в программе с причинами и пометками", () => {
  const p = programFromScenario({
    adults: 2,
    kids: 0,
    workFromHome: 2,
    guestsOften: true,
    sauna: true,
    car: true,
  });
  assert.ok(p.items.some((i) => i.room === "study"));
  assert.ok(p.items.some((i) => i.label === "Сауна" && i.review));
  assert.ok(p.plotItems.some((x) => /машин/.test(x)));
  assert.ok(p.notes.some((x) => /совместить/.test(x)));
});

test("варианты ранжированы, у лучшего «рекомендуем» с объяснением", () => {
  const r = solve(briefFromScenario({ adults: 2, kids: 2, tiers: "any", plot }));
  assert.equal(r.variants.length, 3);
  const rec = r.variants.filter((v) => v.rank?.recommended);
  assert.equal(rec.length, 1);
  assert.equal(r.variants[0], rec[0]);
  assert.match(rec[0].rank!.why, /^Рекомендуем: /);
  for (const v of r.variants) {
    assert.ok(v.rank!.why.length > 10);
    for (const x of Object.values(v.rank!.criteria)) assert.ok(x >= 0 && x <= 1);
  }
  for (let i = 1; i < r.variants.length; i++)
    assert.ok(r.variants[i - 1].score >= r.variants[i].score);
});

test("2D-план совпадает с моделью и паспортом", () => {
  for (const p of [
    singleTier(),
    twoTier(),
    ...solve(briefFromScenario({ adults: 2, kids: 1, plot })).variants.map((v) => v.project),
  ]) {
    const plan = planFromProject(p);
    const pp = buildPassport(p);
    assert.deepEqual(
      plan.rooms.map((r) => [r.id, r.areaM2]),
      pp.rooms.map((r) => [r.id, r.clearAreaM2]),
    );
    assert.ok(
      plan.rooms.every((r) => r.clearDims === "2780 × 3000" || r.clearDims === "3000 × 2780"),
    );
    assert.equal(plan.windows.length, p.openings.filter((o) => o.kind === "window").length);
    assert.equal(plan.doors.length, p.openings.filter((o) => o.kind !== "window").length);
    assert.ok(plan.walls.filter((w) => w.kind === "exterior").every((w) => w.thicknessMm === 210));
    if (p.rooms.length > 1) assert.ok(plan.walls.some((w) => w.kind === "joint-b2b"));
    for (const d of plan.doors) {
      const leaf = Math.hypot(d.leafEnd.x - d.hinge.x, d.leafEnd.y - d.hinge.y);
      assert.equal(Math.round(leaf), d.widthMm, "полотно = ширине проёма");
    }
    for (const f of plan.furniture) {
      const room = p.rooms.find((r) => r.id === f.roomId)!;
      const clear = p.modules.filter((m) => room.moduleIds.includes(m.id)).map(clearRect);
      // Диван и ТВ могут стоять поперёк раскрытого стыка — проверяем углы по всему помещению.
      const corners = [
        [f.rect.x0, f.rect.y0],
        [f.rect.x1, f.rect.y0],
        [f.rect.x0, f.rect.y1],
        [f.rect.x1, f.rect.y1],
      ];
      const inside =
        clear.some(
          (c) => f.rect.x0 >= c.x0 && f.rect.x1 <= c.x1 && f.rect.y0 >= c.y0 && f.rect.y1 <= c.y1,
        ) ||
        ((f.kind === "sofa" || f.kind === "tv") &&
          corners.every(([x, y]) =>
            roomRegion(
              p,
              p.modules.filter((m) => room.moduleIds.includes(m.id)),
            ).some((c) => x >= c.x0 - 0.5 && x <= c.x1 + 0.5 && y >= c.y0 - 0.5 && y <= c.y1 + 0.5),
          ));
      assert.ok(inside, `${f.kind} внутри помещения ${f.roomId}`);
    }
  }
});

test("паспорт объекта: 4 фасада, вид сверху, интерьеры, 4 прохода; стадия 2 заблокирована", () => {
  const p = singleTier();
  const vs = viewSet(p);
  assert.equal(vs.views.filter((v) => v.kind === "facade").length, 4);
  assert.equal(vs.views.filter((v) => v.kind === "aerial").length, 1);
  assert.equal(vs.views.filter((v) => v.kind === "interior").length, 3);
  assert.deepEqual(vs.passes, ["clay", "depth", "edges", "segmentation"]);
  assert.deepEqual(viewSet(p), vs, "детерминированно");
  assert.equal(STAGE2.status, "blocked");
  const s = vs.views.find((v) => v.id === "facade-S")!;
  assert.equal(
    s.expectedWindows,
    p.openings.filter((o) => o.kind === "window" && o.face === "S").length,
  );
  assert.match(promptFor(p, s), new RegExp(`exactly ${s.expectedWindows} window`));
});

test("стили по странам: американский, шале, средиземноморский, минимализм; кровля плоская", () => {
  for (const q of [
    "американский",
    "альпийское шале",
    "средиземноморский",
    "минимализм",
    "скандинавский",
    "японский",
  ])
    assert.ok(findStyle(q), q);
  assert.equal(findStyle("шале")!.id, "chalet");
  assert.ok(findStyle("шале")!.constraintNote);
  assert.ok(FINISHES.styles.every((s) => s.palette.length > 0 && s.region));
});

test("дверь: перенос входа, ширина из каталога, отказ с подсказкой", () => {
  const p = singleTier();
  const moved = applyCommand(p, {
    op: "door",
    action: "move",
    side: "S",
    roomId: "kitchen",
    preset: "wide",
  });
  assert.ok(moved.ok);
  if (moved.ok) {
    const ent = moved.project.openings.filter((o) => o.kind === "entrance");
    assert.equal(ent.length, 1);
    assert.equal(ent[0].widthMm, 1000);
  }
  const blocked = applyCommand(p, { op: "door", action: "add", side: "E", roomId: "bed1" });
  assert.equal(blocked.ok, false);
  if (!blocked.ok) assert.match(blocked.suggestion ?? "", /получится|стороне/);
  const entrance = p.openings.find((o) => o.kind === "entrance")!;
  const room = p.rooms.find((r) => r.id === entrance.roomId)!;
  const removeLast = applyCommand(p, {
    op: "door",
    action: "remove",
    side: entrance.face,
    roomId: room.id,
  });
  assert.equal(removeLast.ok, false, "без входной двери нельзя");
  assert.equal(parseCommand({ op: "door", action: "add", side: "S", preset: "garage" }).ok, false);
});

test("отказ по правилам несёт подсказку исправления", () => {
  const r = applyCommand(twoTier(), { op: "set_overhang", side: "W", mm: 3100 });
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.suggestion ?? "", /1,5 м|Сдвиньте/);
});

test("дом поворачивается и ставится на участке, правила проверяют посадку", () => {
  const p = singleTier();
  const q = rotateHouse90(p);
  assert.equal(q.rotationDeg, 90);
  assert.ok(evaluate(q).valid);
  assert.equal(q.modules.length, p.modules.length);
  const r = applyCommand(p, { op: "rotate_house", deg: 180 });
  assert.ok(r.ok);
  const placed = applyCommand(p, { op: "place_house", xMm: 4000, yMm: 4000 });
  assert.ok(placed.ok && placed.project.placementLocked);
  const outside = applyCommand(p, { op: "place_house", xMm: 26000, yMm: 4000 });
  assert.equal(outside.ok, false, "дом за отступом участка");
});
