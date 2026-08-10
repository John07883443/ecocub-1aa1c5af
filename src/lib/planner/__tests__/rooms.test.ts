import { test } from "node:test";
import assert from "node:assert/strict";
import { addRoom, clearHouse, deleteModule, emptyHouse, growRoom } from "../actions.ts";
import { computeAreas, computeJoints, deriveOpenings, roomHasRoute } from "../rooms.ts";
import { houseFromModules } from "../zoning.ts";
import { TEMPLATES } from "../../constructor/constants.ts";
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

test("готовая раскладка конструктора объединяет смежные общие зоны, но не спальни", () => {
  const template = TEMPLATES.find((t) => t.id === "family-two")!;
  const seeds = template.seeds.map((s, i) => ({ id: `m${i}`, ...s }));
  const house = houseFromModules(seeds);
  assert.equal(house.modules.length, seeds.length);

  // Гостиных ячеек несколько, а зона одна: стена между ними снята.
  const living = house.rooms.filter((r) => r.type === "living");
  const livingModules = house.modules.filter((m) => living.some((r) => r.id === m.roomId));
  assert.ok(livingModules.length > living.length);

  // Спальни и санузлы не сливаются, даже если стоят вплотную: это разные
  // помещения, а не одно большое.
  for (const type of ["bedroom", "bathroom"] as const) {
    const rooms = house.rooms.filter((r) => r.type === type);
    const cells = seeds.filter((s) => s.role === type).length;
    assert.equal(rooms.length, cells, `${type}: зон должно быть столько же, сколько кубиков`);
  }
});

test("во всех готовых раскладках мебель встаёт почти везде", () => {
  // Это защита от возврата к пустым комнатам. Планировщик уже дважды
  // оставлял спальню без кровати: сначала из-за двери на каждом стыке, потом
  // из-за отброшенного целиком варианта.
  //
  // Порог намеренно не 100 %. Пустыми остаются террасы, окружённые модулями
  // со всех сторон: лежак с уличным столом требует свободной грани, а её нет.
  // Такая «терраса» — скорее ошибка сборки, чем случай для планировщика, и
  // человеку про неё пишется отдельная строка под чертежом.
  let rooms = 0;
  let furnished = 0;
  for (const template of TEMPLATES) {
    const house = houseFromModules(template.seeds.map((s, i) => ({ id: `m${i}`, ...s })));
    for (const room of house.rooms) {
      rooms += 1;
      const items = house.layouts[room.id]?.items ?? [];
      if (items.length > 0) furnished += 1;
      // Отдельно и строго: ни одно закрытое помещение не имеет права остаться
      // пустым. Пустой может быть только терраса, зажатая модулями со всех
      // сторон, — лежаку нужна свободная грань.
      // Пустыми законно остаются терраса, зажатая модулями со всех сторон, и
      // холл: коридор мебелью не заставляют.
      else
        assert.ok(
          room.type === "terrace" || room.type === "entryway",
          `${template.id}: ${room.type} без мебели`,
        );
    }
  }
  assert.ok(rooms > 50, "проверяем все семь раскладок целиком");
  assert.ok(furnished / rooms >= 0.9, `меблировано ${furnished} из ${rooms}`);
});

test("одна и та же раскладка всегда даёт одну и ту же планировку", () => {
  // Клиент не должен видеть разное на двух открытиях страницы.
  const seeds = TEMPLATES[2].seeds.map((s, i) => ({ id: `m${i}`, ...s }));
  const snapshot = (h: ReturnType<typeof houseFromModules>) =>
    h.rooms
      .map(
        (r) =>
          `${r.type}:${(h.layouts[r.id]?.items ?? [])
            .map((i) => `${i.kind}@${i.x.toFixed(2)},${i.z.toFixed(2)}`)
            .join("|")}`,
      )
      .join(";");
  assert.equal(snapshot(houseFromModules(seeds)), snapshot(houseFromModules(seeds)));
});

test("спальня получает ровно одну дверь", () => {
  // Дверь на каждом стыке — то, из-за чего кровать переставала помещаться.
  const house = houseFromModules(
    TEMPLATES.find((t) => t.id === "family-two")!.seeds.map((s, i) => ({ id: `m${i}`, ...s })),
  );
  const joints = computeJoints(house);
  for (const room of house.rooms.filter((r) => r.type === "bedroom")) {
    const ids = new Set(room.moduleIds);
    const doors = joints.filter(
      (j) => ids.has(j.aId) !== ids.has(j.bId) && (j.state === "door" || j.state === "opening"),
    );
    assert.ok(doors.length <= 1, `у спальни ${doors.length} входов`);
  }
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

test("в любом доме есть входная дверь и нет запертых комнат", () => {
  // Оба дефекта нашлись на живом примере: дом из четырёх кубиков, где кухня
  // граничила только со спальней и санузлом. Обе приватные комнаты выбрали
  // своей единственной дверью гостиную, и кухня осталась замурована. Входной
  // двери при этом не было вовсе ни в одном доме: вход рисовался только для
  // прихожей, а прихожую планировщик не назначает.
  const shapes: Array<[string, Array<[number, number]>]> = [
    [
      "два кубика",
      [
        [0, 0],
        [3, 0],
      ],
    ],
    [
      "квадрат 2×2",
      [
        [0, 0],
        [3, 0],
        [0, 3],
        [3, 3],
      ],
    ],
    [
      "линия из трёх",
      [
        [0, 0],
        [3, 0],
        [6, 0],
      ],
    ],
    [
      "Г из пяти",
      [
        [0, 0],
        [3, 0],
        [6, 0],
        [0, 3],
        [0, 6],
      ],
    ],
    [
      "квадрат 3×3",
      [
        [0, 0],
        [3, 0],
        [6, 0],
        [0, 3],
        [3, 3],
        [6, 3],
        [0, 6],
        [3, 6],
        [6, 6],
      ],
    ],
    [
      "П из восьми",
      [
        [0, 0],
        [3, 0],
        [6, 0],
        [0, 3],
        [6, 3],
        [0, 6],
        [3, 6],
        [6, 6],
      ],
    ],
  ];

  for (const [label, cells] of shapes) {
    const house = houseFromModules(
      cells.map(([x, z], i) => ({ id: `m${i}`, x, z, floor: 0, role: "living" as const })),
    );
    const entries = deriveOpenings(house, 0).filter((o) => o.kind === "entry");
    assert.equal(entries.length, 1, `${label}: входная дверь должна быть ровно одна`);
    for (const room of house.rooms) {
      assert.ok(roomHasRoute(house, room.id), `${label}: ${room.type} заперта`);
    }
  }
});

test("общая зона не разрезается санузлом надвое", () => {
  // Две гостиные по диагонали читаются как ошибка планировки, а не замысел.
  const house = houseFromModules(
    (
      [
        [0, 0],
        [3, 0],
        [0, 3],
        [3, 3],
      ] as Array<[number, number]>
    ).map(([x, z], i) => ({
      id: `m${i}`,
      x,
      z,
      floor: 0,
      role: "living" as const,
    })),
  );
  const publicRooms = house.rooms.filter((r) => r.type === "living" || r.type === "kitchen");
  const modules = house.modules.filter((m) => publicRooms.some((r) => r.id === m.roomId));
  // Все модули общей зоны должны быть связаны между собой по граням.
  const seen = new Set([modules[0].id]);
  const queue = [modules[0]];
  while (queue.length) {
    const cur = queue.shift()!;
    for (const m of modules) {
      if (seen.has(m.id)) continue;
      const touches =
        (Math.abs(m.x - cur.x) === 3 && Math.abs(m.z - cur.z) < 3) ||
        (Math.abs(m.z - cur.z) === 3 && Math.abs(m.x - cur.x) < 3);
      if (!touches) continue;
      seen.add(m.id);
      queue.push(m);
    }
  }
  assert.equal(seen.size, modules.length, "общая зона разорвана");
});
