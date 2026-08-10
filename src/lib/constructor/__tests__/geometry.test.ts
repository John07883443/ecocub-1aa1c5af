import { test } from "node:test";
import assert from "node:assert/strict";
import {
  anchorForPoint,
  buildableSide,
  canPlace,
  computeStats,
  isValidMove,
  maxAnchor,
  minAnchor,
  pickSnapAnchor,
  snapAnchors,
  validMoveAnchors,
} from "../geometry.ts";
import { MODULE_SIDE_M, SETBACK_M, snapToStep, STEP_M } from "../constants.ts";
import type { ModuleItem } from "../types.ts";

const N = 8; // участок 24 × 24 м

const mod = (id: string, x: number, z: number, floor = 0): ModuleItem => ({
  id,
  x,
  z,
  floor,
  role: "living",
});

test("шаг установки — половина метра", () => {
  assert.equal(STEP_M, 0.5);
  assert.equal(snapToStep(1.24), 1);
  assert.equal(snapToStep(1.26), 1.5);
  assert.equal(snapToStep(-0.3), -0.5);
  // Сторона кубика кратна шагу: сетка не «уползает».
  assert.equal(MODULE_SIDE_M % STEP_M, 0);
});

test("модуль можно поставить со сдвигом в полметра", () => {
  const house = [mod("a", 6, 6)];
  assert.equal(canPlace(house, { x: 9, z: 6.5, floor: 0 }, N), true);
  assert.equal(canPlace(house, { x: 9, z: 8.5, floor: 0 }, N), true);
  // Наложение по-прежнему запрещено.
  assert.equal(canPlace(house, { x: 8.5, z: 6, floor: 0 }, N), false);
});

test("магнитные позиции идут через полметра вдоль общей грани", () => {
  // Модуль в середине участка: границы не отсекают часть позиций.
  const anchors = snapAnchors([mod("a", 6, 6)], 0, N);
  const right = anchors.filter((c) => c.x === 9).map((c) => c.z);
  assert.ok(right.includes(6));
  assert.ok(right.includes(6.5), "полушаг вдоль грани доступен");
  assert.ok(right.includes(5.5));
  // Минимальное перекрытие 1 м сохраняется: сдвиг на 2,5 м уже «уголком».
  assert.ok(!right.includes(8.5));
  assert.ok(right.includes(8));
});

test("стыковка вплотную: между гранями остаётся ровно ноль", () => {
  const a = mod("a", 6, 6);
  const anchors = snapAnchors([a], 0, N);
  const picked = pickSnapAnchor(anchors, 9.2, 6.4, null, 1.2);
  assert.ok(picked);
  assert.equal(picked!.x, 9);
  assert.equal(picked!.z, 6.5);
  // Правая грань первого и левая грань второго совпадают точно.
  assert.equal(a.x + MODULE_SIDE_M, picked!.x);
});

test("установка тапом прилипает к соседнему кубику", () => {
  const house = [mod("a", 6, 6)];
  // Точка рядом с правой гранью — модуль должен встать вплотную.
  const anchor = anchorForPoint(house, 10.4, 7.6, 0, N);
  assert.ok(anchor);
  assert.equal(anchor!.x, 9);
  assert.equal(anchor!.z % STEP_M, 0);
  assert.equal(canPlace(house, { ...anchor!, floor: 0 }, N), true);
});

test("перемещение на полшага допустимо и не ломает опору", () => {
  const house = [mod("a", 6, 6), mod("b", 9, 6), mod("up", 6.5, 6, 1)];
  assert.equal(isValidMove(house, "up", 7, 6, N), true);
  // Уехать полностью с опоры нельзя.
  assert.equal(isValidMove(house, "up", 6, 12, N), false);
});

test("к забору ближе 3 м модуль не встаёт", () => {
  assert.equal(SETBACK_M, 3);
  assert.equal(minAnchor(), 3);
  assert.equal(maxAnchor(N), N * 3 - MODULE_SIDE_M - SETBACK_M);
  assert.equal(buildableSide(N), N * 3 - SETBACK_M * 2);

  // Впритык к границе и в отступе — запрещено.
  assert.equal(canPlace([], { x: 0, z: 6, floor: 0 }, N), false);
  assert.equal(canPlace([], { x: 2.5, z: 6, floor: 0 }, N), false);
  assert.equal(canPlace([], { x: maxAnchor(N) + 0.5, z: 6, floor: 0 }, N), false);
  // Ровно по границе зоны застройки — можно.
  assert.equal(canPlace([], { x: 3, z: 3, floor: 0 }, N), true);
  assert.equal(canPlace([], { x: maxAnchor(N), z: maxAnchor(N), floor: 0 }, N), true);
});

test("тап у самого забора отодвигает модуль в зону застройки", () => {
  const anchor = anchorForPoint([], 0.4, 0.4, 0, N);
  assert.ok(anchor);
  assert.ok(anchor!.x >= minAnchor() && anchor!.z >= minAnchor());
});

test("перетащить модуль в отступ нельзя", () => {
  const house = [mod("a", 6, 6)];
  assert.equal(isValidMove(house, "a", 0, 6, N), false);
  assert.equal(isValidMove(house, "a", 3, 6, N), true);
});

test("список допустимых позиций строится по полуметровой сетке", () => {
  const house = [mod("a", 6, 6)];
  const valid = validMoveAnchors(house, "a", N);
  assert.ok(!valid.has("0,0"), "в отступе от забора позиций нет");
  assert.ok(valid.has(`${minAnchor()},${minAnchor()}`));
  assert.ok(valid.has(`${minAnchor() + STEP_M},${minAnchor()}`), "полушаговые позиции входят");
  assert.ok(valid.has(`${maxAnchor(N)},${maxAnchor(N)}`));
  const perAxis = (maxAnchor(N) - minAnchor()) / STEP_M + 1;
  assert.equal(valid.size, perAxis * perAxis);
});

test("площадь и цена считаются по модулям, а не по шагу сетки", () => {
  const stats = computeStats([mod("a", 0, 0), mod("b", 3, 0.5)], 10, 105000);
  assert.equal(stats.moduleCount, 2);
  assert.equal(stats.totalArea, 18);
  assert.equal(stats.price, 18 * 105000);
});
