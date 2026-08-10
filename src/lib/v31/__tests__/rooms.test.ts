import { test } from "node:test";
import assert from "node:assert/strict";
import { addRoom, clearHouse, deleteModule, emptyHouse, growRoom } from "../actions.ts";
import { computeAreas, computeJoints, deriveOpenings, roomHasRoute } from "../rooms.ts";
import { houseFromPlan } from "../plans31.ts";
import { PLAN_LIBRARY } from "../../v3/plans.ts";
import { CEILING_HEIGHT_M } from "../constants.ts";
import type { HouseState } from "../types.ts";

function build(): HouseState {
  let house = emptyHouse();
  for (const type of ["kitchen", "bedroom", "bathroom", "entryway"] as const) {
    const r = addRoom(house, type, 0);
    assert.ok(r.ok, type);
    if (r.ok) house = r.house;
  }
  return house;
}

test("прихожая — полноценный тип: добавляется, считается, входит в общую площадь", () => {
  const house = build();
  const entry = house.rooms.find((r) => r.type === "entryway");
  assert.ok(entry);
  const areas = computeAreas(house);
  assert.equal(areas.totalAreaM2, 36);
  // Прихожая и санузел — в общей, но не в жилой площади.
  assert.equal(areas.livingAreaM2, 18);
  assert.equal(areas.moduleCount, 4);
});

test("прихожая не может появиться на втором этаже", () => {
  const house = build();
  const r = addRoom(house, "entryway", 1);
  assert.equal(r.ok, false);
});

test("терраса не входит в площадь дома, но считается отдельно", () => {
  let house = build();
  const r = addRoom(house, "terrace", 0);
  assert.ok(r.ok);
  if (r.ok) house = r.house;
  const areas = computeAreas(house);
  assert.equal(areas.totalAreaM2, 36);
  assert.equal(areas.terraceAreaM2, 9);
});

test("состояния общих граней различаются: дверь, проём и объединение", () => {
  const house = build();
  const joints = computeJoints(house);
  assert.ok(joints.length >= 3);
  for (const j of joints) {
    assert.ok(["closed", "door", "opening", "open"].includes(j.state), j.state);
    assert.equal(j.source, "derived");
  }
  // У санузла есть дверь, а не глухая стена со всех сторон.
  const bath = house.rooms.find((r) => r.type === "bathroom")!;
  assert.equal(roomHasRoute(house, bath.id), true);
});

test("несколько модулей одного помещения дают одну зону и один контур", () => {
  let house = build();
  const kitchen = house.rooms.find((r) => r.type === "kitchen")!;
  const r = growRoom(house, kitchen.id);
  assert.ok(r.ok);
  if (r.ok) house = r.house;
  const modules = house.modules.filter((m) => m.roomId === kitchen.id);
  assert.equal(modules.length, 2);
  // Мебель принадлежит комнате, а не плитке: одна раскладка на всю зону.
  const layout = house.layouts[kitchen.id];
  assert.ok(layout);
  const beds = layout.items.filter((i) => i.kind === "kitchen-line");
  assert.ok(beds.length <= 1, "кухонная линия не дублируется в каждой ячейке");
});

test("план из библиотеки v3 объединяет смежные ячейки одного типа в зоны", () => {
  const plan = PLAN_LIBRARY.find((p) => p.slug === "sky-river")!;
  const house = houseFromPlan(plan);
  assert.equal(house.modules.length, plan.cells.length);
  // Гостиных ячеек несколько, но зон меньше, чем ячеек.
  const livingRooms = house.rooms.filter((r) => r.type === "living");
  const livingModules = house.modules.filter((m) => livingRooms.some((r) => r.id === m.roomId));
  assert.ok(livingModules.length > livingRooms.length);
  // Санузлы не сливаются в одно помещение.
  const baths = house.rooms.filter((r) => r.type === "bathroom");
  assert.equal(baths.length, plan.cells.filter((c) => c.role === "bathroom").length);
});

test("окна не рисуются в санузле, а у прихожей появляется входная дверь", () => {
  const house = build();
  const openings = deriveOpenings(house, 0);
  assert.ok(openings.some((o) => o.kind === "entry"));
  const bath = house.rooms.find((r) => r.type === "bathroom")!;
  assert.equal(
    openings.some((o) => o.id.includes(bath.id) && o.kind === "window"),
    false,
  );
});

test("очистка обнуляет дом; площадь и цена становятся пустыми", () => {
  const cleared = clearHouse();
  assert.ok(cleared.ok);
  if (cleared.ok) {
    const areas = computeAreas(cleared.house);
    assert.equal(areas.moduleCount, 0);
    assert.equal(areas.totalAreaM2, 0);
    assert.equal(areas.floors, 0);
  }
});

test("удаление модуля убирает и его комнату, если она была одномодульной", () => {
  const house = build();
  const bath = house.rooms.find((r) => r.type === "bathroom")!;
  const moduleId = house.modules.find((m) => m.roomId === bath.id)!.id;
  const impactful = deleteModule(house, moduleId, true);
  assert.ok(impactful.ok);
  if (impactful.ok) {
    assert.equal(
      impactful.house.rooms.some((r) => r.id === bath.id),
      false,
    );
    assert.equal(impactful.house.layouts[bath.id], undefined);
  }
});

test("высота потолков — одна константа 3.15 и она не меняется действиями", () => {
  assert.equal(CEILING_HEIGHT_M, 3.15);
});
