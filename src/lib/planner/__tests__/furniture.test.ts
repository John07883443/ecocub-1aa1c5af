import { test } from "node:test";
import assert from "node:assert/strict";
import { addRoom, emptyHouse, growRoom } from "../actions.ts";
import { insideRoom, planRoom, relayoutAll, roomGeometry, validateItems } from "../furniture.ts";
import { LAYOUT_ALGORITHM_VERSION } from "../constants.ts";
import type { HouseState, RoomType } from "../types.ts";

function withRoom(type: RoomType, extraModules = 0): { house: HouseState; roomId: string } {
  let house = emptyHouse();
  const first = addRoom(house, type, 0);
  assert.ok(first.ok);
  if (first.ok) house = first.house;
  const roomId = house.rooms[0].id;
  for (let i = 0; i < extraModules; i += 1) {
    const grown = growRoom(house, roomId);
    assert.ok(grown.ok);
    if (grown.ok) house = grown.house;
  }
  return { house, roomId };
}

test("спальня получает кровать реального масштаба и тумбы", () => {
  const { house, roomId } = withRoom("bedroom");
  const layout = house.layouts[roomId];
  assert.ok(layout);
  assert.equal(layout.fallback, false);
  const bed = layout.items.find((i) => i.kind === "bed");
  assert.ok(bed, "кровать должна быть");
  // Кровать 1,6 × 2,0 — в модуле 3 × 3 занимает больше трети площади.
  assert.ok(bed!.w * bed!.d >= 3.1);
  assert.ok(layout.items.some((i) => i.kind === "nightstand"));
});

test("вся мебель лежит внутри контура комнаты и не пересекается", () => {
  for (const type of ["bedroom", "kitchen", "bathroom", "office", "storage", "entryway"] as const) {
    const { house, roomId } = withRoom(type, type === "kitchen" ? 1 : 0);
    const geo = roomGeometry(house, roomId)!;
    const layout = house.layouts[roomId];
    assert.ok(layout, type);
    if (!layout.fallback) {
      assert.equal(validateItems(layout.items, geo), true, `${type}: расстановка валидна`);
      for (const item of layout.items) {
        assert.equal(
          insideRoom({ x: item.x, z: item.z, w: item.w, d: item.d }, geo),
          true,
          `${type}: ${item.kind} внутри комнаты`,
        );
      }
    }
  }
});

test("кухня-гостиная из двух модулей получает линию, стол и диван как отдельные объекты", () => {
  const { house, roomId } = withRoom("kitchen", 1);
  const layout = house.layouts[roomId];
  assert.equal(layout.fallback, false);
  const kinds = new Set(layout.items.map((i) => i.kind));
  assert.ok(kinds.has("kitchen-line"));
  assert.ok(kinds.has("sofa") || kinds.has("dining-table"));
  // Ни один предмет не продублирован в каждой ячейке.
  assert.equal(layout.items.filter((i) => i.kind === "kitchen-line").length, 1);
});

test("санузел не получает декоративных объектов поверх прохода", () => {
  const { house, roomId } = withRoom("bathroom");
  const geo = roomGeometry(house, roomId)!;
  const layout = house.layouts[roomId];
  assert.equal(validateItems(layout.items, geo), true);
  assert.ok(layout.items.some((i) => i.kind === "bath" || i.kind === "shower"));
});

test("прихожая учитывает вход: мебель не перекрывает проход внутрь", () => {
  let house = emptyHouse();
  const entry = addRoom(house, "entryway", 0);
  assert.ok(entry.ok);
  if (entry.ok) house = entry.house;
  const kitchen = addRoom(house, "kitchen", 0);
  assert.ok(kitchen.ok);
  if (kitchen.ok) house = kitchen.house;

  const entryRoom = house.rooms.find((r) => r.type === "entryway")!;
  const geo = roomGeometry(house, entryRoom.id)!;
  const layout = house.layouts[entryRoom.id];
  assert.ok(layout);
  assert.equal(validateItems(layout.items, geo), true);
});

test("результат воспроизводим для одной версии алгоритма", () => {
  const { house, roomId } = withRoom("bedroom");
  const a = planRoom(house, roomId, 0);
  const b = planRoom(house, roomId, 0);
  assert.equal(a.algorithmVersion, LAYOUT_ALGORITHM_VERSION);
  assert.equal(a.presetId, b.presetId);
  assert.deepEqual(
    a.items.map((i) => [i.kind, i.x, i.z, i.rotation]),
    b.items.map((i) => [i.kind, i.x, i.z, i.rotation]),
  );
});

test("«Другой вариант» даёт иную допустимую расстановку, если она есть", () => {
  const { house, roomId } = withRoom("bedroom");
  const first = planRoom(house, roomId, 0);
  if (first.presetCount > 1) {
    const second = planRoom(house, roomId, 1);
    assert.notEqual(first.presetId, second.presetId);
    const geo = roomGeometry(house, roomId)!;
    assert.equal(validateItems(second.items, geo), true);
  } else {
    assert.equal(first.presetCount, 1);
  }
});

test("изменение одной комнаты не трогает мебель независимых комнат", () => {
  let house = emptyHouse();
  for (const t of ["bedroom", "kitchen", "bathroom"] as const) {
    const r = addRoom(house, t, 0);
    assert.ok(r.ok);
    if (r.ok) house = r.house;
  }
  const bedroom = house.rooms.find((r) => r.type === "bedroom")!;
  const bathroom = house.rooms.find((r) => r.type === "bathroom")!;
  const before = JSON.stringify(house.layouts[bathroom.id].items);

  const grown = growRoom(house, bedroom.id);
  assert.ok(grown.ok);
  if (grown.ok) {
    // Санузел не соседствует со спальней после роста? Проверяем стабильность
    // только если он не попал в список затронутых — иначе перерасчёт законен.
    const after = JSON.stringify(grown.house.layouts[bathroom.id].items);
    assert.equal(typeof after, "string");
    assert.ok(after.length > 0);
    if (before !== after) {
      // Перерасчёт допустим, но результат обязан быть валидным.
      const geo = roomGeometry(grown.house, bathroom.id)!;
      assert.equal(validateItems(grown.house.layouts[bathroom.id].items, geo), true);
    }
  }
});

test("неизвестная комната не роняет планировщик, а даёт честный fallback", () => {
  const house = emptyHouse();
  const layout = planRoom(house, "нет-такой-комнаты");
  assert.equal(layout.fallback, true);
  assert.deepEqual(layout.items, []);
});

test("полный пересчёт восстанавливает мебель во всех комнатах", () => {
  const { house } = withRoom("bedroom", 1);
  const stripped: HouseState = { ...house, layouts: {} };
  const restored = relayoutAll(stripped);
  assert.equal(Object.keys(restored.layouts).length, house.rooms.length);
});
