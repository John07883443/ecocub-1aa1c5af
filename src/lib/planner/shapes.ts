import { MODULE_SIDE_M } from "../constructor/constants.ts";
import type { ModuleItem } from "../constructor/types.ts";

/**
 * Генератор форм дома для прогонов.
 *
 * Смысл в исчерпывающем переборе, а не в случайной выборке: при небольшом
 * числе кубиков все связные формы можно построить целиком (полиомино), и
 * тогда «планировщик держится на любой форме» перестаёт быть надеждой.
 *
 * Формы строятся в клетках, потом переводятся в метры шагом модуля. Кубики
 * в шахматном порядке или уголком не рассматриваем: боевой конструктор их и
 * не даст — там действует правило одного здания.
 */

/** Все связные формы из n клеток (фиксированные полиомино), без дублей. */
export function polyominoes(n: number): Array<Array<[number, number]>> {
  let shapes: Array<Array<[number, number]>> = [[[0, 0]]];
  for (let size = 1; size < n; size += 1) {
    const next = new Map<string, Array<[number, number]>>();
    for (const shape of shapes) {
      for (const [x, z] of shape) {
        for (const [dx, dz] of [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ]) {
          const cell: [number, number] = [x + dx, z + dz];
          if (shape.some(([cx, cz]) => cx === cell[0] && cz === cell[1])) continue;
          next.set(...normalize([...shape, cell]));
        }
      }
    }
    shapes = [...next.values()];
  }
  return shapes;
}

/** Сдвинуть форму в начало координат и получить её канонический ключ. */
function normalize(shape: Array<[number, number]>): [string, Array<[number, number]>] {
  const minX = Math.min(...shape.map(([x]) => x));
  const minZ = Math.min(...shape.map(([, z]) => z));
  const moved = shape
    .map(([x, z]) => [x - minX, z - minZ] as [number, number])
    .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  return [moved.map(([x, z]) => `${x},${z}`).join(";"), moved];
}

/**
 * Сколько форм существует при таком числе кубиков — если это ещё считается.
 *
 * Число связных форм растёт примерно втрое на каждый кубик: 760 при семи,
 * 2725 при восьми, 9910 при девяти, полмиллиона при двенадцати. Перебирать
 * всё дальше десяти бессмысленно, поэтому выше берётся выборка.
 */
export const EXHAUSTIVE_LIMIT = 9;

/**
 * Выборка форм для больших домов.
 *
 * Форма выращивается из одной клетки: на каждом шаге к уже собранной фигуре
 * прибавляется соседняя свободная клетка. Так получается связная фигура любого
 * размера без перебора всех вариантов.
 *
 * Псевдослучайность своя и намеренно примитивная: `Math.random` дал бы разные
 * партии при каждом открытии страницы, и сравнивать прогоны стало бы не с чем.
 * Одно зерно — одна и та же выборка, всегда.
 */
export function sampleShapes(n: number, count: number, seed = 1): Array<Array<[number, number]>> {
  const out = new Map<string, Array<[number, number]>>();
  let state = (seed * 2654435761) >>> 0;
  const next = () => {
    // Линейный конгруэнтный генератор: качество распределения здесь не важно,
    // важна повторяемость и отсутствие зависимостей.
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };

  // Попыток больше, чем нужно форм: часть вырастет одинаковой и отсеется.
  for (let attempt = 0; attempt < count * 12 && out.size < count; attempt += 1) {
    const cells: Array<[number, number]> = [[0, 0]];
    while (cells.length < n) {
      const frontier: Array<[number, number]> = [];
      for (const [x, z] of cells) {
        for (const [dx, dz] of [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ]) {
          const cell: [number, number] = [x + dx, z + dz];
          if (cells.some(([cx, cz]) => cx === cell[0] && cz === cell[1])) continue;
          if (frontier.some(([cx, cz]) => cx === cell[0] && cz === cell[1])) continue;
          frontier.push(cell);
        }
      }
      if (!frontier.length) break;
      cells.push(frontier[Math.floor(next() * frontier.length) % frontier.length]);
    }
    if (cells.length !== n) continue;
    const [key, normalized] = normalize(cells);
    out.set(key, normalized);
  }
  return [...out.values()];
}

/**
 * Формы заданного размера: полный перебор, пока он посилен, иначе выборка.
 *
 * Вызывающему не нужно знать, где проходит граница, — а знать, что при
 * маленьких домах проверено всё, а при больших только срез, нужно, поэтому
 * граница объявлена рядом константой.
 */
export function shapesOfSize(
  n: number,
  sampleCount = 60,
  seed = 1,
): Array<Array<[number, number]>> {
  return n <= EXHAUSTIVE_LIMIT ? polyominoes(n) : sampleShapes(n, sampleCount, seed);
}

/** Перевести форму в модули конструктора: клетка → шаг модуля в метрах. */
export function toModules(shape: Array<[number, number]>): ModuleItem[] {
  return shape.map(([x, z], i) => ({
    id: `m${i}`,
    x: x * MODULE_SIDE_M,
    z: z * MODULE_SIDE_M,
    floor: 0,
    role: "living" as const,
  }));
}
