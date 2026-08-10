import type { ModuleItem, Role } from "../constructor/types.ts";
import { MODULE_SIDE_M } from "../constructor/constants.ts";

/**
 * Назначение помещений: какой кубик чем станет.
 *
 * Боевой конструктор намеренно оперирует одинаковыми кубиками — человек
 * собирает форму дома, а не раскладывает комнаты. Значит решить, где спальня,
 * а где санузел, должен планировщик. Без этого шага дом из девяти модулей
 * превращался в одну гостиную на 82 м² с диваном посередине.
 *
 * Решаем не на глаз. Состав помещений и их расстановка выведены из семи
 * разобранных проектов (см. src/lib/standards):
 *
 *  - Спальни угловые: у каждой две наружные стены и своё окно.
 *  - Спальня — целый модуль, не делится.
 *  - Мокрая зона в одном модуле, ближе к входу, стояк один.
 *  - Общая зона в середине, из смежных модулей со снятыми стенами.
 *  - Кухня примыкает к общей зоне и стоит у наружной стены.
 *  - Санузлов один до ~75 м², два на 90–115, три выше 130.
 *
 * Результат детерминирован: одинаковый набор кубиков всегда даёт одинаковый
 * состав помещений, иначе клиент увидел бы разное на двух открытиях страницы.
 */

interface Node {
  index: number;
  x: number;
  z: number;
  floor: number;
  /** Сколько соседей по грани — мера «зажатости» модуля. */
  neighbours: number;
  /** Сколько наружных граней: 4 минус соседи. Угловой модуль имеет две и больше. */
  exterior: number;
  /** Расстояние в модулях от входного кубика. */
  depth: number;
}

/** Сколько санузлов положено дому такого размера. */
export function bathroomCount(moduleCount: number): number {
  if (moduleCount >= 15) return 3;
  if (moduleCount >= 10) return 2;
  return 1;
}

/**
 * Сколько спален положено дому такого размера.
 *
 * Ряд снят с проектов: Weekend Mini на трёх модулях — одна спальня, Family One
 * на шести — две, Family Two на восьми — три. Выше трёх не поднимаемся: ни
 * один из семи домов четвёртой спальни не имеет, а выдумывать состав за
 * производство нельзя.
 */
export function bedroomCount(moduleCount: number): number {
  if (moduleCount <= 2) return 0;
  if (moduleCount <= 5) return 1;
  if (moduleCount <= 7) return 2;
  return 3;
}

/**
 * Разложить кубики по назначениям.
 *
 * Роли на входе игнорируются: боевой конструктор ставит все модули
 * одинаковыми, а террасы пока задаются только готовыми раскладками — их мы
 * уважаем и не переназначаем.
 */
export function assignRoles(modules: ModuleItem[]): ModuleItem[] {
  const ground = modules.filter((m) => m.floor === 0);
  if (ground.length < 2) return modules.map((m) => ({ ...m, role: "living" as Role }));

  // Террасы, если человек их задал, остаются террасами: это его решение о
  // неотапливаемой части, а не то, что планировщику стоит пересматривать.
  const fixed = new Map<ModuleItem, Role>();
  const open: ModuleItem[] = [];
  for (const m of ground) {
    if (m.role === "terrace") fixed.set(m, "terrace");
    else open.push(m);
  }
  if (!open.length) return modules;

  const nodes = describe(open);
  const entrance = pickEntrance(nodes);
  fillDepth(nodes, entrance);

  const assigned = new Map<number, Role>();
  const n = open.length;

  // 1. Спальни — самые дальние от входа углы. Дальние потому, что во всех
  //    семи проектах спальня уводится от прихожей, а угловые потому, что
  //    спальне нужно окно.
  const bedrooms = Math.min(bedroomCount(n), Math.max(0, n - 2));
  const forBedroom = [...nodes]
    .sort(
      (a, b) =>
        b.exterior - a.exterior ||
        b.depth - a.depth ||
        a.neighbours - b.neighbours ||
        a.index - b.index,
    )
    .slice(0, bedrooms);
  for (const node of forBedroom) assigned.set(node.index, "bedroom");

  // 2. Санузлы — наоборот, ближе к входу и в самых зажатых модулях: окно им
  //    не нужно, а стояк лучше держать компактно.
  const baths = Math.min(bathroomCount(n), Math.max(0, n - bedrooms - 1));
  const forBath = nodes
    .filter((node) => !assigned.has(node.index))
    .sort(
      (a, b) =>
        b.neighbours - a.neighbours ||
        a.depth - b.depth ||
        a.exterior - b.exterior ||
        a.index - b.index,
    )
    .slice(0, baths);
  for (const node of forBath) assigned.set(node.index, "bathroom");

  // 3. Кухня — один модуль общей зоны у наружной стены, подальше от санузлов.
  const rest = nodes.filter((node) => !assigned.has(node.index));
  const kitchen = [...rest].sort(
    (a, b) => b.exterior - a.exterior || b.depth - a.depth || a.index - b.index,
  )[0];
  if (kitchen && rest.length > 1) assigned.set(kitchen.index, "kitchen");

  // 4. Остальное — общая зона: смежные модули сольются в одно помещение.
  const roles = open.map((m, i) => ({ ...m, role: assigned.get(i) ?? ("living" as Role) }));

  // Верхние этажи целиком под спальни: так устроены двухэтажные раскладки.
  const upper = modules
    .filter((m) => m.floor > 0)
    .map((m) => ({ ...m, role: (m.role === "terrace" ? "terrace" : "bedroom") as Role }));

  const terraces = [...fixed.entries()].map(([m, role]) => ({ ...m, role }));
  return [...roles, ...terraces, ...upper];
}

function describe(modules: ModuleItem[]): Node[] {
  return modules.map((m, index) => {
    const neighbours = modules.filter(
      (o) =>
        o !== m &&
        ((Math.abs(o.x - m.x) === MODULE_SIDE_M && Math.abs(o.z - m.z) < MODULE_SIDE_M) ||
          (Math.abs(o.z - m.z) === MODULE_SIDE_M && Math.abs(o.x - m.x) < MODULE_SIDE_M)),
    ).length;
    return {
      index,
      x: m.x,
      z: m.z,
      floor: m.floor,
      neighbours,
      exterior: Math.max(0, 4 - neighbours),
      depth: 0,
    };
  });
}

/**
 * Входной модуль — самый южный, при равенстве самый западный.
 *
 * Юг выбран не случайно: на планах всех семи проектов вход и крыльцо смотрят
 * на подъезд к участку, а он в конструкторе снизу. Правило простое и
 * повторяемое, а точную сторону человек всё равно уточняет с инженером.
 */
function pickEntrance(nodes: Node[]): Node {
  return [...nodes].sort((a, b) => b.z - a.z || a.x - b.x)[0];
}

/** Расстояние в модулях от входа — обход в ширину по общим граням. */
function fillDepth(nodes: Node[], from: Node): void {
  const queue: Node[] = [from];
  const seen = new Set<number>([from.index]);
  from.depth = 0;
  while (queue.length) {
    const cur = queue.shift()!;
    for (const node of nodes) {
      if (seen.has(node.index)) continue;
      const touches =
        (Math.abs(node.x - cur.x) === MODULE_SIDE_M && Math.abs(node.z - cur.z) < MODULE_SIDE_M) ||
        (Math.abs(node.z - cur.z) === MODULE_SIDE_M && Math.abs(node.x - cur.x) < MODULE_SIDE_M);
      if (!touches) continue;
      seen.add(node.index);
      node.depth = cur.depth + 1;
      queue.push(node);
    }
  }
}
