import { test } from "node:test";
import assert from "node:assert/strict";

import { BASE_MODULE } from "../catalog.ts";
import {
  freeSpotNear,
  modulesOverlap,
  newOverlaps,
  overlapPairs,
  overlapsAny,
} from "../overlap.ts";
import type { ModuleInstance } from "../types.ts";

/**
 * Запрет наложения модулей.
 *
 * Главная тонкость — граница. Наложение ровно на толщину стены не
 * пересечение, а общая стена: модули отлиты в один объём. Ошибка в эту
 * сторону запретила бы законный вид стыка, ошибка в другую — пропустила бы
 * дом, который нельзя построить.
 */

const W = BASE_MODULE.externalWidthMm; // 3200
const D = BASE_MODULE.externalDepthMm; // 3420
const WALL = BASE_MODULE.wallThicknessMm; // 210

function mod(
  id: string,
  x: number,
  y = 0,
  floor = 0,
  rotationDeg: 0 | 90 | 180 | 270 = 0,
): ModuleInstance {
  return { id, moduleTypeId: BASE_MODULE.id, floor, positionMm: { x, y }, rotationDeg };
}

test("вплотную — не наложение", () => {
  assert.equal(modulesOverlap(mod("a", 0), mod("b", W)), false);
  assert.equal(modulesOverlap(mod("a", 0), mod("b", 0, D)), false);
});

test("общая стена — не наложение", () => {
  // Ровно 210 мм перекрытия: два модуля отлиты в один объём.
  assert.equal(modulesOverlap(mod("a", 0), mod("b", W - WALL)), false);
  assert.equal(modulesOverlap(mod("a", 0), mod("b", 0, D - WALL)), false);
});

test("на миллиметр больше стены — уже наложение", () => {
  assert.equal(modulesOverlap(mod("a", 0), mod("b", W - WALL - 1)), true);
});

test("модуль поверх другого — наложение", () => {
  assert.equal(modulesOverlap(mod("a", 0), mod("b", 0)), true);
  assert.equal(modulesOverlap(mod("a", 0), mod("b", 500, 500)), true);
});

test("разные этажи не пересекаются в плане", () => {
  assert.equal(modulesOverlap(mod("a", 0, 0, 0), mod("b", 0, 0, 1)), false);
});

test("уголком, с перекрытием меньше стены по одной оси, — не наложение", () => {
  // Сдвиг на всю глубину минус 100: по Y перекрытие 100 мм, меньше стены.
  assert.equal(modulesOverlap(mod("a", 0, 0), mod("b", 100, D - 100)), false);
});

test("пары считаются один раз и не зависят от порядка", () => {
  const pairs = overlapPairs([mod("a", 0), mod("b", 100), mod("c", 10_000)]);
  assert.equal(pairs.size, 1);
  assert.deepEqual([...pairs], ["a|b"]);

  const reversed = overlapPairs([mod("b", 100), mod("a", 0)]);
  assert.deepEqual([...reversed], ["a|b"]);
});

test("считаются только НОВЫЕ наложения — старый проект не заперт", () => {
  const before = [mod("a", 0), mod("b", 100)]; // наложение уже есть
  // Двигаем c, который никого не задевает: новых наложений нет.
  const after = [mod("a", 0), mod("b", 100), mod("c", 20_000)];
  assert.deepEqual(newOverlaps(before, after), []);

  // Чиним старое наложение — тоже никаких новых.
  assert.deepEqual(newOverlaps(before, [mod("a", 0), mod("b", W)]), []);

  // А вот наехали новым — отказ.
  assert.deepEqual(newOverlaps(before, [mod("a", 0), mod("b", 100), mod("c", 50)]), ["a|c", "b|c"]);
});

test("поворот, меняющий габарит, ловится как наложение", () => {
  // Два модуля стоят вплотную по X. Повернуть левый на 90° значит вырасти
  // с 3200 до 3420 в ширину и въехать в соседа на 220 мм.
  const before = [mod("a", 0), mod("b", W)];
  const after = [mod("a", 0, 0, 0, 90), mod("b", W)];
  assert.deepEqual(newOverlaps(before, after), ["a|b"]);
});

test("копия обходит занятое место", () => {
  const a = mod("a", 0);
  const right = mod("b", W);
  // Справа занято — копия должна встать не там.
  const spot = freeSpotNear({ ...a, id: "copy", positionMm: { x: W, y: 0 } }, [a, right]);
  assert.ok(spot);
  assert.equal(overlapsAny({ ...a, id: "copy", positionMm: spot! }, [a, right]), false);
});

test("если места нет вовсе — честный null", () => {
  const centre = mod("c", 0);
  // Окружаем со всех сторон на четыре кольца во все стороны.
  const crowd: ModuleInstance[] = [centre];
  for (let ring = 1; ring <= 5; ring++) {
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
      [1, 1],
      [-1, 1],
      [1, -1],
      [-1, -1],
    ]) {
      crowd.push(mod(`m${ring}${dx}${dy}`, dx * W * ring, dy * D * ring));
    }
  }
  assert.equal(freeSpotNear({ ...centre, id: "copy" }, crowd), null);
});
