import { test } from "node:test";
import assert from "node:assert/strict";

import { BASE_MODULE } from "../catalog.ts";
import { bandCandidates, mergeBand } from "../opening-band.ts";
import { clearSpanMm } from "../opening-place.ts";
import type { HouseModel, ModuleInstance, OpeningInstance } from "../types.ts";

/**
 * Объединение соседних окон в ленту.
 *
 * Главное, что проверяется: после объединения окна действительно смыкаются, а
 * наружные простенки остаются на месте. Ошибка в знаке смещения здесь не
 * видна на глаз — окно просто уедет на 210 мм, и на фасаде это заметит только
 * тот, кто будет сверять с чертежом.
 */

const W = BASE_MODULE.externalWidthMm; // 3200
const D = BASE_MODULE.externalDepthMm; // 3420
const WALL = BASE_MODULE.wallThicknessMm; // 210
const FULL = clearSpanMm(W); // 2780

function mod(id: string, x: number, y = 0, floor = 0): ModuleInstance {
  return { id, moduleTypeId: BASE_MODULE.id, floor, positionMm: { x, y }, rotationDeg: 0 };
}

function win(
  id: string,
  moduleId: string,
  offsetMm: number,
  widthMm: number,
  extra: Partial<OpeningInstance> = {},
): OpeningInstance {
  return {
    id,
    moduleId,
    faceId: "Р-1",
    kind: "window",
    offsetMm,
    widthMm,
    heightMm: 3150,
    sillMm: 0,
    ...extra,
  };
}

function model(modules: ModuleInstance[], openings: OpeningInstance[]): HouseModel {
  return {
    units: "mm",
    modules,
    openings,
    foundation: { kind: "piles", clearanceMm: 500, visible: true },
  } as HouseModel;
}

/** Два модуля вплотную, у каждого окно во всю чистую стену. */
function pairFlush(): HouseModel {
  return model(
    [mod("A", 0), mod("B", W)],
    [win("o1", "A", WALL, FULL), win("o2", "B", WALL, FULL)],
  );
}

test("два окна во всю стену через стык — кандидат на ленту", () => {
  const m = pairFlush();
  const found = bandCandidates(m, "o1");
  assert.equal(found.length, 1);
  const c = found[0];
  assert.equal(c.neighbourId, "o2");
  // Между окнами два простенка по 210.
  assert.equal(c.gapMm, WALL * 2);
  assert.equal(c.grow.openingMm, WALL);
  assert.equal(c.grow.neighbourMm, WALL);
  assert.equal(c.grow.openingToEnd, true, "первое окно растёт вправо, к стыку");
  assert.equal(c.grow.neighbourToEnd, false, "второе растёт влево, к стыку");
  assert.equal(c.bandWidthMm, FULL * 2 + WALL * 2);
});

test("после объединения окна смыкаются, а наружные простенки на месте", () => {
  const m = pairFlush();
  const patches = mergeBand(m, bandCandidates(m, "o1")[0], "band-1");
  assert.equal(patches.length, 2);

  const pa = patches.find((p) => p.id === "o1")!;
  const pb = patches.find((p) => p.id === "o2")!;

  // Первое окно: левый край не тронут, правый дошёл до края грани.
  assert.equal(pa.offsetMm, WALL, "наружный простенок остался");
  assert.equal(pa.offsetMm + pa.widthMm, W, "правый край у стыка");
  // Второе: левый край у стыка, правый не тронут.
  assert.equal(pb.offsetMm, 0, "левый край у стыка");
  assert.equal(pb.offsetMm + pb.widthMm, W - WALL, "наружный простенок остался");

  // В мировых координатах отрезки смыкаются: A занимает [210, 3200],
  // B стоит с 3200 и занимает [3200, 6190].
  assert.equal(W + pb.offsetMm, pa.offsetMm + pa.widthMm, "между окнами нет стены");
  assert.equal(pa.bandId, pb.bandId);
});

test("спрашивать можно с любой стороны — ответ тот же", () => {
  const m = pairFlush();
  const fromRight = bandCandidates(m, "o2");
  assert.equal(fromRight.length, 1);
  assert.equal(fromRight[0].neighbourId, "o1");
  assert.equal(fromRight[0].grow.openingToEnd, false, "правое окно растёт влево");

  const patches = mergeBand(m, fromRight[0], "band-2");
  const pb = patches.find((p) => p.id === "o2")!;
  assert.equal(pb.offsetMm, 0);
  assert.equal(pb.widthMm, FULL + WALL);
});

test("общая стена: окна тоже сливаются", () => {
  // Модули наложены ровно на толщину стены — второй законный вид стыка.
  const m = model(
    [mod("A", 0), mod("B", W - WALL)],
    [win("o1", "A", WALL, FULL), win("o2", "B", WALL, FULL)],
  );
  const c = bandCandidates(m, "o1");
  assert.equal(c.length, 1);
  assert.equal(c[0].gapMm, WALL, "между окнами одна общая стена");

  const patches = mergeBand(m, c[0], "band-3");
  const pa = patches.find((p) => p.id === "o1")!;
  const pb = patches.find((p) => p.id === "o2")!;
  // Мировые отрезки: A [210, 3200], B [2990, 5980] — перекрываются, не рвутся.
  assert.ok(W - WALL + pb.offsetMm <= pa.offsetMm + pa.widthMm, "разрыва нет");
});

test("разные высоты — не лента", () => {
  const m = model(
    [mod("A", 0), mod("B", W)],
    [win("o1", "A", WALL, FULL), win("o2", "B", WALL, FULL, { sillMm: 700, heightMm: 1800 })],
  );
  assert.deepEqual(bandCandidates(m, "o1"), []);
});

test("узкие окна посреди стены не предлагаются к объединению", () => {
  // Между окнами больше метра стены: это два окна, а не разорванная лента.
  const m = model(
    [mod("A", 0), mod("B", W)],
    [win("o1", "A", WALL, 900), win("o2", "B", W - WALL - 900, 900)],
  );
  assert.deepEqual(bandCandidates(m, "o1"), []);
});

test("двери и открытые проёмы в ленту не собираются", () => {
  const m = model(
    [mod("A", 0), mod("B", W)],
    [
      win("o1", "A", WALL, FULL, { kind: "door", heightMm: 2100 }),
      win("o2", "B", WALL, FULL, { kind: "door", heightMm: 2100 }),
    ],
  );
  assert.deepEqual(bandCandidates(m, "o1"), []);
});

test("окна на разных этажах и на разных прямых не сливаются", () => {
  const upstairs = model(
    [mod("A", 0), mod("B", W, 0, 1)],
    [win("o1", "A", WALL, FULL), win("o2", "B", WALL, FULL)],
  );
  assert.deepEqual(bandCandidates(upstairs, "o1"), []);

  // Модули друг за другом по глубине: грани Р-1 лежат на разных прямых.
  const behind = model(
    [mod("A", 0, 0), mod("B", 0, D)],
    [win("o1", "A", WALL, FULL), win("o2", "B", WALL, FULL)],
  );
  assert.deepEqual(bandCandidates(behind, "o1"), []);
});

test("окна противоположных граней не сливаются, даже стоя на одной прямой", () => {
  // Р-3 модуля A и Р-1 модуля B: обе грани на прямой y = 0 у стыка,
  // но смотрят в разные стороны — это внутренние стены стыка.
  const m = model(
    [mod("A", 0, -D), mod("B", 0, 0)],
    [win("o1", "A", WALL, FULL, { faceId: "Р-3" }), win("o2", "B", WALL, FULL)],
  );
  assert.deepEqual(bandCandidates(m, "o1"), []);
});

test("уже собранная лента второй раз не предлагается", () => {
  const m = pairFlush();
  const patches = mergeBand(m, bandCandidates(m, "o1")[0], "band-4");
  const merged = model(m.modules, [
    { ...m.openings[0], ...patches[0] },
    { ...m.openings[1], ...patches[1] },
  ]);
  assert.deepEqual(bandCandidates(merged, "o1"), []);
});
