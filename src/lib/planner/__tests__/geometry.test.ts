import { test } from "node:test";
import assert from "node:assert/strict";
import {
  bestAttachSpot,
  bounds,
  canPlace,
  computeAdjacency,
  computeWalls,
  isFloorConnected,
  pickSnap,
  snapCandidates,
} from "../geometry.ts";
import { MODULE_SIDE_M } from "../constants.ts";
import type { ModuleFootprint } from "../types.ts";

const mod = (id: string, x: number, z: number, floor = 0): ModuleFootprint => ({
  id,
  x,
  z,
  floor,
  roomId: `room-${id}`,
});

test("стыковка даёт одинаковые координаты грани и нулевой зазор", () => {
  const house = [mod("a", 0, 0)];
  const candidates = snapCandidates(house, 0);
  const right = candidates.find((c) => c.x === 3 && c.z === 0);
  assert.ok(right, "справа должна быть позиция вплотную");
  // Правая грань первого и левая грань второго — одно и то же число.
  assert.equal(house[0].x + MODULE_SIDE_M, right!.x);
  const adjacency = computeAdjacency([...house, mod("b", right!.x, right!.z)]);
  assert.equal(adjacency.length, 1);
  assert.equal(adjacency[0].at, 3);
  assert.equal(adjacency[0].to - adjacency[0].from, 3);
});

test("касание углами не создаёт соседства", () => {
  const adjacency = computeAdjacency([mod("a", 0, 0), mod("b", 3, 3)]);
  assert.deepEqual(adjacency, []);
});

test("пересечение модулей отклоняется", () => {
  const house = [mod("a", 0, 0)];
  assert.equal(canPlace(house, { x: 1, z: 0, floor: 0 }), false);
  assert.equal(canPlace(house, { x: 3, z: 0, floor: 0 }), true);
});

test("связность этажа: остров не считается частью дома", () => {
  assert.equal(isFloorConnected([mod("a", 0, 0), mod("b", 3, 0)], 0), true);
  assert.equal(isFloorConnected([mod("a", 0, 0), mod("b", 9, 0)], 0), false);
  // Диагональ через угол — тоже не связность.
  assert.equal(isFloorConnected([mod("a", 0, 0), mod("b", 3, 3)], 0), false);
});

test("общая грань не порождает две наложенные наружные стены", () => {
  const walls = computeWalls([mod("a", 0, 0), mod("b", 3, 0)], 0);
  // Внутренней грани x=3 в наружных стенах быть не должно.
  const atSeam = walls.filter((w) => w.x1 === 3 && w.x2 === 3);
  assert.equal(atSeam.length, 0);
  // Периметр 2×1 модулей: 6+6+3+3 = 18 м суммарной длины.
  const total = walls.reduce((s, w) => s + Math.hypot(w.x2 - w.x1, w.z2 - w.z1), 0);
  assert.equal(Math.round(total), 18);
});

test("контур 2×2, L и T не содержит внутренних рёбер", () => {
  const square = [mod("a", 0, 0), mod("b", 3, 0), mod("c", 0, 3), mod("d", 3, 3)];
  const squareWalls = computeWalls(square, 0);
  assert.equal(
    Math.round(squareWalls.reduce((s, w) => s + Math.hypot(w.x2 - w.x1, w.z2 - w.z1), 0)),
    24,
  );

  const lShape = [mod("a", 0, 0), mod("b", 3, 0), mod("c", 0, 3)];
  assert.equal(
    Math.round(
      computeWalls(lShape, 0).reduce((s, w) => s + Math.hypot(w.x2 - w.x1, w.z2 - w.z1), 0),
    ),
    24,
  );

  const tShape = [mod("a", 0, 0), mod("b", 3, 0), mod("c", 6, 0), mod("d", 3, 3)];
  assert.equal(
    Math.round(
      computeWalls(tShape, 0).reduce((s, w) => s + Math.hypot(w.x2 - w.x1, w.z2 - w.z1), 0),
    ),
    30,
  );
});

test("ступенчатый контур со сдвигом на 1 м остаётся связным и без внутренних рёбер", () => {
  const step = [mod("a", 0, 0), mod("b", 3, 1)];
  assert.equal(isFloorConnected(step, 0), true);
  const walls = computeWalls(step, 0);
  // Общая грань длиной 2 м не должна попасть в наружные стены.
  const seam = walls.filter((w) => w.x1 === 3 && w.x2 === 3 && w.z1 >= 1 && w.z2 <= 3);
  assert.equal(seam.length, 0);
});

test("магнит липнет к ближайшей позиции и не дрожит между кандидатами", () => {
  const house = [mod("a", 0, 0)];
  const candidates = snapCandidates(house, 0);
  const first = pickSnap(candidates, 3.2, 0.1, null, 1.2);
  assert.ok(first);
  assert.equal(first!.x, 3);
  assert.equal(first!.z, 0);

  // Микродвижение в сторону соседнего кандидата не должно его переключить.
  const stable = pickSnap(candidates, 3.0, 0.52, first, 1.2);
  assert.equal(stable!.z, 0, "гистерезис удерживает прежнюю позицию");

  // Явное движение — кандидат меняется.
  const moved = pickSnap(candidates, 3.0, 1.4, first, 1.2);
  assert.equal(moved!.z, 1);
});

test("вне порога магнит не срабатывает — свободный черновик виден пользователю", () => {
  const candidates = snapCandidates([mod("a", 0, 0)], 0);
  assert.equal(pickSnap(candidates, 12, 12, null, 1.2), null);
});

test("новый модуль из панели встаёт вплотную к дому", () => {
  const house = [mod("a", 0, 0)];
  const spot = bestAttachSpot(house, 0);
  assert.ok(spot);
  const next = [...house, mod("b", spot!.x, spot!.z)];
  assert.equal(computeAdjacency(next).length, 1);
  assert.equal(isFloorConnected(next, 0), true);
});

test("габарит этажа считается по модулям", () => {
  const b = bounds([mod("a", 0, 0), mod("b", 3, 1)], 0);
  assert.equal(b.w, 6);
  assert.equal(b.d, 4);
});
