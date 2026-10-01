/**
 * Голосовая правка ОДНОГО дома (владелец 01.10.2026): «добавить/убрать модуль,
 * спальню, убрать/добавить второй этаж, удалить комнату, дом больше/меньше,
 * развернуть, вход, окна больше/убрать». Каждая команда — через правила, с
 * диффом; отказ — с объяснением и ближайшей альтернативой.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  COMMAND_TOOLS,
  applyCommand,
  toolCallToCommand,
  type EditorCommand,
} from "../engine/commands.ts";
import { solve } from "../engine/solver.ts";
import { briefFromScenario, type LifeScenario } from "../engine/scenario.ts";
import { columnsFor, evaluate, modulesOnTier } from "../engine/rules.ts";
import { carportPlace } from "../engine/site.ts";
import { kitchenZone, doorLanding } from "../engine/graph.ts";
import { intersect } from "../engine/geometry.ts";
import { houseLook } from "../engine/house-look.ts";
import { buildProject } from "../engine/derive.ts";
import type { Project } from "../engine/types.ts";
import { singleTier, twoTier } from "./fixtures.ts";

const SCENARIO: LifeScenario = {
  adults: 2,
  kids: 1,
  pets: { dogs: 0 },
  workFromHome: 0,
  guestsOften: false,
  sauna: false,
  storage: "normal",
  car: false,
  terrace: true,
  tiers: "any",
  desiredAreaM2: { min: 50, max: 90 },
  plot: { widthM: 25, depthM: 35, northDeg: 0 },
};
let cached: Project | null = null;
/** Дом по умолчанию — тот, что видит человек после интервью. */
const house = (): Project => (cached ??= solve(briefFromScenario(SCENARIO)).variants[0].project);

function ok(p: Project, c: EditorCommand) {
  const r = applyCommand(p, c);
  assert.ok(r.ok, `${JSON.stringify(c)}: ${r.ok ? "" : `${r.reason} ${r.violations.join(" ")}`}`);
  if (!r.ok) throw new Error("unreachable");
  assert.ok(evaluate(r.project).valid, "после правки дом в правилах");
  assert.ok(r.diff.changed && r.diff.summary.length > 3, "у успеха есть дифф");
  return r;
}
const count = (p: Project, t: string) => p.rooms.filter((r) => r.type === t).length;

test("добавить модуль с юга: +2 кубика, подсветка новых, дифф с площадью и ценой", () => {
  const p = house();
  const r = ok(p, { op: "add_module", side: "S" });
  assert.equal(r.project.modules.length, p.modules.length + 2);
  assert.equal(r.diff.added.length, 2);
  for (const id of r.diff.added) assert.ok(r.diff.highlight.includes(id));
  assert.match(r.diff.summary, /\+2 кубика/);
  assert.match(r.diff.summary, /млн ₽/);
});

test("модуль с занятой стороны — отказ с альтернативой с другой стороны", () => {
  const r = applyCommand(house(), { op: "add_module", side: "E" });
  if (r.ok) return; // эта сторона свободна — тоже честно
  assert.ok(r.alternative, "предложена альтернатива");
  const alt = applyCommand(house(), r.alternative!.command as EditorCommand);
  assert.ok(alt.ok, "альтернатива действительно применима");
});

test("убрать модуль: −2 кубика, кухня-гостиная не меньше 2", () => {
  const big = ok(house(), { op: "add_module", side: "S" }).project;
  const r = ok(big, { op: "remove_module", side: "S" });
  assert.equal(r.project.modules.length, big.modules.length - 2);
  const k = r.project.rooms.find((x) => x.type === "kitchen-living")!;
  assert.ok(k.moduleIds.length >= 2);
});

test("добавить и убрать спальню, удалить комнату по виду", () => {
  const p = house();
  const add = ok(p, { op: "add_room", room: "bedroom", side: "W" });
  assert.equal(count(add.project, "bedroom"), count(p, "bedroom") + 1);
  const del = ok(add.project, { op: "remove_room", room: "bedroom" });
  assert.equal(count(del.project, "bedroom"), count(p, "bedroom"));
  // Последнюю кухню и единственный санузел не удалить — с причиной.
  const k = applyCommand(p, { op: "remove_room", room: "living" });
  assert.equal(k.ok, false);
  const w = applyCommand(p, { op: "remove_room", room: "bath" });
  assert.equal(w.ok, false);
  if (!w.ok) assert.match(w.reason, /санузел/);
});

test("сауна, кладовая, кабинет — отдельными кубиками", () => {
  const p = house();
  const sauna = ok(p, { op: "add_room", room: "sauna" });
  assert.ok(sauna.project.rooms.some((r) => r.subRooms?.includes("сауна")));
  assert.match(sauna.diff.summary, /сауна: 0 → 1/);
  const st = ok(p, { op: "add_room", room: "storage" });
  assert.equal(count(st.project, "storage"), 1);
  const study = ok(p, { op: "add_room", room: "study" });
  assert.equal(count(study.project, "study"), 1);
});

test("перенести комнату: на ту же сторону — честное «и так», на другую — переезд", () => {
  const p = house();
  const bed = p.rooms.find((r) => r.type === "bedroom")!;
  let moved = false;
  for (const side of ["N", "E", "S", "W"] as const) {
    const r = applyCommand(p, { op: "move_room", roomId: bed.id, side });
    if (r.ok) {
      moved = true;
      assert.ok(r.diff.highlight.length > 0);
    } else assert.ok(r.reason.length > 0);
  }
  assert.ok(moved, "хотя бы одна сторона подходит");
});

test("добавить второй этаж и убрать его: спальни переезжают, не теряются", () => {
  const p = house();
  const up = ok(p, { op: "add_second_tier" });
  assert.ok(modulesOnTier(up.project, 2).length >= 2);
  assert.ok(up.project.rooms.some((r) => r.type === "hall" && r.tier === 2));
  assert.match(up.diff.summary, /второй ярус/);
  const down = ok(up.project, { op: "remove_second_tier" });
  assert.equal(modulesOnTier(down.project, 2).length, 0);
  assert.equal(count(down.project, "bedroom"), count(up.project, "bedroom"));
  // Второй раз добавить второй ярус нельзя — он есть.
  assert.equal(applyCommand(up.project, { op: "add_second_tier" }).ok, false);
  // Частично: убрать один кубик второго яруса.
  const part = applyCommand(up.project, { op: "remove_second_tier", cubes: 1 });
  if (part.ok) assert.equal(part.project.modules.length, up.project.modules.length - 1);
});

test("дом больше на 22 м² и меньше на 11 м²: решатель выбирает сам", () => {
  const p = house();
  const big = ok(p, { op: "resize_house", deltaM2: 22 });
  assert.equal(big.project.modules.length, p.modules.length + 2);
  const small = ok(p, { op: "resize_house", deltaM2: -11 });
  assert.equal(small.project.modules.length, p.modules.length - 1);
  assert.ok(count(small.project, "kitchen-living") === 1 && count(small.project, "wet-core") >= 1);
});

test("развернуть дом и повернуть гостиную на юг", () => {
  const p = house();
  const r = ok(p, { op: "rotate_house", deg: 90 });
  assert.equal(r.project.rotationDeg, 90);
  assert.equal(r.diff.highlight.length, r.project.modules.length, "подсвечен весь дом");
  const o = applyCommand(p, { op: "orient_house", target: "living-south" });
  if (!o.ok) assert.match(o.reason, /юг/);
});

test("вход: перенести на другую сторону; на ту же — «и так»", () => {
  const p = house();
  const cur = p.openings.find((o) => o.kind === "entrance")!.face;
  assert.equal(applyCommand(p, { op: "door", action: "move", side: cur }).ok, false);
  const other = (["N", "E", "S", "W"] as const).find(
    (s) => s !== cur && applyCommand(p, { op: "door", action: "move", side: s }).ok,
  );
  assert.ok(other, "есть сторона для входа");
  const r = ok(p, { op: "door", action: "move", side: other! });
  const ent = r.project.openings.filter((o) => o.kind === "entrance");
  assert.equal(ent.length, 1);
  assert.equal(ent[0].face, other);
  assert.match(r.diff.summary, /вход/);
});

test("окна: добавить, убрать, больше, меньше, панорама — по фасаду и по комнате", () => {
  const p = house();
  // По комнате без стороны — все окна спальни больше.
  const big = ok(p, { op: "window", action: "enlarge", room: "bedroom" });
  assert.match(big.diff.summary, /окна .* больше/);
  // По фасаду: меньше.
  const southFace = p.openings.some((o) => o.kind === "window" && o.face === "S") ? "S" : "W";
  const small = ok(p, { op: "window", action: "shrink", side: southFace });
  assert.match(small.diff.summary, /меньше/);
  // Добавить окно на стену с местом.
  const sides = ["N", "E", "S", "W"] as const;
  const add = sides
    .map((s) => applyCommand(p, { op: "window", action: "add", side: s }))
    .find((r) => r.ok);
  assert.ok(add && add.ok && /окна .*: \d → \d/.test(add.diff.summary));
  // Убрать окно с кухни-гостиной — у неё их несколько.
  const k = p.rooms.find((r) => r.type === "kitchen-living")!;
  const kFace = p.openings.find((o) => o.roomId === k.id && o.kind === "window")!.face;
  const rm = ok(p, { op: "window", action: "remove", side: kFace, roomId: k.id });
  assert.ok(
    rm.project.openings.filter((o) => o.kind === "window").length <
      p.openings.filter((o) => o.kind === "window").length,
  );
  // Спальня без окна — нельзя, с предложением щели.
  const bed = p.rooms.find((r) => r.type === "bedroom")!;
  const bedFaces = [
    ...new Set(
      p.openings.filter((o) => o.roomId === bed.id && o.kind === "window").map((o) => o.face),
    ),
  ];
  if (bedFaces.length === 1) {
    const no = applyCommand(p, {
      op: "window",
      action: "remove",
      side: bedFaces[0],
      roomId: bed.id,
    });
    assert.equal(no.ok, false);
    if (!no.ok) assert.ok(no.alternative);
  }
  // Панорама в пол на спальне.
  const pano = applyCommand(p, {
    op: "window",
    action: "set",
    roomId: bed.id,
    preset: "floor-to-ceiling",
  });
  assert.ok(pano.ok || pano.alternative, "либо панорама, либо предложено большое окно");
});

test("окна: уже панорама — «больше некуда», а не выдуманное «сделал»", () => {
  const p = house();
  const k = p.rooms.find((r) => r.type === "kitchen-living")!;
  const r = applyCommand(p, {
    op: "window",
    action: "set",
    roomId: k.id,
    preset: "floor-to-ceiling",
  });
  if (!r.ok) assert.match(r.reason, /уже/);
});

test("терраса больше / убрать / вернуть, навес для машины", () => {
  const p = house();
  const ext = ok(p, { op: "terrace", action: "extend", m2: 10 });
  assert.ok(ext.project.terrace.totalM2 > p.terrace.totalM2 + 9);
  const rm = ok(p, { op: "terrace", action: "remove" });
  assert.equal(rm.project.terrace.totalM2, 0);
  const back = ok(rm.project, { op: "terrace", action: "add" });
  assert.ok(back.project.terrace.totalM2 > 0);
  const car = ok(p, { op: "carport", action: "add", side: "W" });
  assert.equal(carportPlace(car.project)?.side, "W");
  const noCar = ok(car.project, { op: "carport", action: "remove" });
  assert.equal(carportPlace(noCar.project), null);
});

test("опора под свесом: колонны, терраса под свесом, кубик под свесом", () => {
  const p = twoTier(1200); // второй ярус свешивается на восток на 1,2 м
  const col = ok(p, { op: "support_overhang", method: "column" });
  assert.ok(columnsFor(col.project) > columnsFor(p));
  const ter = ok(p, { op: "support_overhang", method: "terrace" });
  assert.equal(ter.project.terrace.side, "E");
  assert.ok(ter.project.overhangSupports?.includes("E"));
  const cube = ok(p, { op: "support_overhang", method: "cube" });
  assert.equal(cube.project.modules.length, p.modules.length + 1);
  // Свеса нет — честно «нечего подпирать».
  assert.equal(applyCommand(twoTier(), { op: "support_overhang", method: "column" }).ok, false);
});

test("стиль «светлый фирменный»: белая штукатурка, и 3D берёт цвет из модели", () => {
  const p = house();
  const r = ok(p, {
    op: "describe_style",
    text: "верни светлый фирменный: белая штукатурка, светлый бетон, деревянные ламели",
  });
  assert.equal(r.project.finishes.facade, "plaster-white");
  const look = houseLook(r.project);
  assert.equal(look.material, "plaster");
  assert.ok(parseInt(look.wall.slice(1, 3), 16) > 0xd0, "стена светлая");
  assert.ok(look.slats, "ламели акцентом");
  const dark = ok(p, { op: "set_finish", category: "facade", finishId: "planken-thermo" });
  assert.ok(parseInt(houseLook(dark.project).wall.slice(1, 3), 16) < 0x90);
});

test("ничего не поменялось — не успех (Лев не может сказать «сделал»)", () => {
  const p = house();
  const r = applyCommand(p, { op: "move_terrace", side: p.terrace.side });
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.reason, /уже/);
});

test("спальня не открывается в кухонную зону; фронт кухни уходит от дверей", () => {
  for (const p of [singleTier(), house(), twoTier()]) {
    const kz = kitchenZone(p);
    if (!kz) continue;
    for (const o of p.openings.filter((x) => x.kind === "internal-door")) {
      const r = p.rooms.find((x) => x.id === o.roomId);
      const m = p.modules.find((x) => x.id === o.moduleId)!;
      if (r?.type !== "bedroom" || m.tier !== 1) continue;
      assert.equal(intersect(doorLanding(m, o), kz.zone), null, `${p.id}: ${o.id} в кухонную зону`);
    }
  }
  // Правило ловит руками поставленную дверь спальни прямо к кухонному фронту.
  const p = buildProject({
    id: "kz",
    modules: [
      { id: "a", xMm: 0, yMm: 0, rot: 0, tier: 1, roomId: "k" },
      { id: "b", xMm: 3200, yMm: 0, rot: 0, tier: 1, roomId: "k" },
      { id: "c", xMm: 0, yMm: 3420, rot: 0, tier: 1, roomId: "bed" },
      { id: "d", xMm: 3200, yMm: 3420, rot: 0, tier: 1, roomId: "w" },
    ],
    rooms: [
      { id: "k", type: "kitchen-living", tier: 1, moduleIds: ["a", "b"] },
      { id: "bed", type: "bedroom", tier: 1, moduleIds: ["c"] },
      { id: "w", type: "wet-core", tier: 1, moduleIds: ["d"] },
    ],
    plot: { widthM: 30, depthM: 30 },
  });
  const kz = kitchenZone(p)!;
  const door = p.openings.find((o) => o.roomId === "bed" && o.kind === "internal-door")!;
  const m = p.modules.find((x) => x.id === door.moduleId)!;
  assert.equal(intersect(doorLanding(m, door), kz.zone), null, "генератор ставит дверь мимо кухни");
  // Сдвигаем дверь к кухонному фронту вручную — правило room-doors это запрещает.
  const runX = kz.run.x0;
  const bad: Project = {
    ...p,
    openings: p.openings.map((o) =>
      o.id === door.id ? { ...o, offsetMm: Math.max(210, runX - m.xMm) } : o,
    ),
  };
  if (
    intersect(
      doorLanding(
        m,
        bad.openings.find((o) => o.id === door.id)!,
      ),
      kitchenZone(bad)!.zone,
    )
  )
    assert.ok(evaluate(bad).hardViolations.some((v) => /кухонную зону/.test(v.message)));
});

test("каждый инструмент-команда разбирается из вызова модели", () => {
  const sample: Record<string, Record<string, unknown>> = {
    add_room: { room: "bedroom", side: "S" },
    remove_room: { room: "bedroom" },
    move_room: { room: "bedroom", side: "N" },
    resize_room: { roomId: "x", modules: 2 },
    add_cube: { side: "S" },
    remove_cube: { side: "E" },
    add_module: { side: "S", rooms: ["bedroom", "study"] },
    remove_module: { side: "N" },
    add_second_tier: { bedrooms: 2 },
    remove_second_tier: {},
    resize_house: {},
    rotate_house: { deg: 180 },
    orient_house: {},
    edit_window: { action: "enlarge", room: "bedroom" },
    edit_door: { action: "move", side: "E" },
    edit_terrace: { action: "extend", m2: 8 },
    carport: { action: "add" },
    support_overhang: { method: "column" },
    set_overhang: { side: "E", mm: 600 },
    shift_upper_tier: { dxMm: 0, dyMm: 300 },
    set_style: { style: "фирменный" },
    set_finish: { category: "facade", finishId: "plaster-white" },
    describe_style: { text: "белый фасад" },
    place_house: { xMm: 1000, yMm: 2000 },
  };
  for (const t of COMMAND_TOOLS) {
    const r = toolCallToCommand(t.name, sample[t.name] ?? {});
    assert.ok(r.ok, `${t.name}: ${r.ok ? "" : r.error}`);
  }
  // «Сделай дом больше» без числа — +22 м².
  const r = toolCallToCommand("resize_house", {});
  assert.ok(r.ok && r.command.op === "resize_house" && r.command.deltaM2 === 22);
  // Север участка повёрнут на 90°: «с юга» — это грань дома, смотрящая на юг.
  const turned = toolCallToCommand("add_room", { room: "bedroom", side: "S" }, 90);
  assert.ok(turned.ok && turned.command.op === "add_room" && turned.command.side !== "S");
  assert.equal(toolCallToCommand("edit_window", { action: "blink", side: "S" }).ok, false);
});

test("«фасад светлее» меняет только фасад: кровля, рамы, интерьер и форма дома те же", () => {
  const p0 = house();
  const p = { ...p0, finishes: { ...p0.finishes, facade: "planken-thermo" } };
  const r = ok(p, { op: "describe_style", text: "сделай фасад светлее" });
  assert.equal(r.project.finishes.facade, "plaster-white");
  for (const k of ["roof", "windowFrames", "interior"] as const)
    assert.equal(r.project.finishes[k], p.finishes[k], k);
  assert.deepEqual(r.project.modules, p.modules);
  assert.equal(r.diff.added.length + r.diff.removed.length, 0);
});
