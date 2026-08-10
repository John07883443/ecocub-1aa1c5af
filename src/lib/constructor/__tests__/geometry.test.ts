import { test } from "node:test";
import assert from "node:assert/strict";
import {
  anchorForPoint,
  areAdjacent,
  buildableSide,
  canAdd,
  canPlace,
  canRemove,
  computeStats,
  isConnected,
  isValidMove,
  maxAnchor,
  minAnchor,
  pickSnapAnchor,
  snapAnchors,
  validMoveAnchors,
} from "../geometry.ts";
import { MODULE_SIDE_M, SETBACK_M, STEP_M, TEMPLATES, snapToStep } from "../constants.ts";
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

/* ------------------------------------------------------------------ */
/* Связность: дом всегда один                                          */
/* ------------------------------------------------------------------ */

test("касание углом домом не считается", () => {
  const a = mod("a", 3, 3);
  const b = mod("b", 3 + MODULE_SIDE_M, 3 + MODULE_SIDE_M);
  assert.equal(areAdjacent(a, b), false);
  assert.equal(isConnected([a, b]), false);
});

test("общая грань короче метра не связывает", () => {
  const a = mod("a", 3, 3);
  // Сдвиг на 2.5 м оставляет общую грань 0.5 м — меньше порога стыковки.
  const b = mod("b", 3 + MODULE_SIDE_M, 3 + 2.5);
  assert.equal(areAdjacent(a, b), false);
  const c = mod("c", 3 + MODULE_SIDE_M, 3 + 2);
  assert.equal(areAdjacent(a, c), true);
});

test("второй этаж связан с первым через опору, а не через грань", () => {
  const ground = mod("g", 3, 3);
  const upper = { ...mod("u", 3, 3), floor: 1 };
  assert.equal(areAdjacent(ground, upper), false);
  assert.equal(isConnected([ground, upper]), true);
});

test("модуль на земле ставится только вплотную к дому", () => {
  const house = [mod("a", 6, 6)];
  // Впритык справа — можно.
  assert.equal(canAdd(house, { x: 6 + MODULE_SIDE_M, z: 6, floor: 0 }, 12), true);
  // На отшибе — нельзя, получилось бы два здания.
  assert.equal(canAdd(house, { x: 6 + MODULE_SIDE_M * 2, z: 6, floor: 0 }, 12), false);
  // Первый модуль в пустом доме встаёт где угодно.
  assert.equal(canAdd([], { x: 15, z: 15, floor: 0 }, 12), true);
});

test("тап мимо дома не создаёт отдельно стоящий кубик", () => {
  const house = [mod("a", 6, 6)];
  const far = anchorForPoint(house, 20, 20, 0, 12);
  if (far) {
    // Если позиция нашлась, она обязана быть состыкованной.
    assert.equal(canAdd(house, { ...far, floor: 0 }, 12), true);
    assert.equal(isConnected([...house, { ...mod("new", far.x, far.z) }]), true);
  }
});

test("разрывающее перемещение запрещено", () => {
  const line = [mod("a", 6, 6), mod("b", 6 + MODULE_SIDE_M, 6), mod("c", 6 + MODULE_SIDE_M * 2, 6)];
  // Крайний модуль можно двигать вдоль дома.
  assert.equal(isValidMove(line, "c", 6, 6 + MODULE_SIDE_M, 12), true);
  // Средний утащить в сторону нельзя — дом распадётся надвое.
  assert.equal(isValidMove(line, "b", 6, 6 + MODULE_SIDE_M * 2, 12), false);
});

test("удалить можно крайний модуль, но не тот, что держит дом вместе", () => {
  const line = [mod("a", 6, 6), mod("b", 6 + MODULE_SIDE_M, 6), mod("c", 6 + MODULE_SIDE_M * 2, 6)];
  assert.equal(canRemove(line, "a"), true);
  assert.equal(canRemove(line, "c"), true);
  assert.equal(canRemove(line, "b"), false);
  // Последний оставшийся модуль удаляется свободно: пустой дом связен.
  assert.equal(canRemove([mod("a", 6, 6)], "a"), true);
});

test("подсказки перемещения не предлагают позиций в отрыве от дома", () => {
  const house = [mod("a", 6, 6), mod("b", 6 + MODULE_SIDE_M, 6)];
  const spots = validMoveAnchors(house, "b", 12);
  assert.ok(spots.size > 0);
  for (const key of spots) {
    const [x, z] = key.split(",").map(Number);
    assert.equal(isValidMove(house, "b", x, z, 12), true, `позиция ${key} должна быть связной`);
  }
});

test("все готовые шаблоны собираются в одно здание", () => {
  for (const template of TEMPLATES) {
    const mods = template.seeds.map((c, i) => ({
      id: `${template.id}-${i}`,
      x: c.x,
      z: c.z,
      floor: c.floor,
      role: c.role,
    }));
    assert.equal(isConnected(mods), true, `шаблон «${template.name}» разорван`);
  }
});
