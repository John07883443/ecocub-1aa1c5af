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
