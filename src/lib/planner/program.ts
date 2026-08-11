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
  if (moduleCount <= 16) return 3;
  // Выше шестнадцати модулей каталог не подсказывает ничего: самый большой
  // разобранный дом — Dinastiya, 133 м² и три спальни. Дальше идёт
  // экстраполяция, и она сделана самым скромным способом — по спальне на
  // каждые четыре лишних модуля. Иначе весь избыток уходил в общую зону, и
  // дом из двадцати двух кубиков получал гостиную на 130 м².
  return 3 + Math.floor((moduleCount - 16) / 4);
}

/**
 * Сколько модулей отдаём общей зоне.
 *
 * Потолок взят с самого большого проекта каталога: гостиная с кухней-столовой
 * Dinastiya — 46,6 м², это пять модулей конструктора. Больше не делаем не из
 * экономии, а потому что такой комнаты никто не строил и мы не знаем, как её
 * обставлять.
 */
export const MAX_COMMON_MODULES = 5;

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
  const bedroomCandidates = [...nodes].sort(
    (a, b) =>
      b.exterior - a.exterior ||
      b.depth - a.depth ||
      a.neighbours - b.neighbours ||
      a.index - b.index,
  );
  for (let placed = 0; placed < bedrooms; placed += 1) {
    const pick = bedroomCandidates.find(
      (node) => !assigned.has(node.index) && canBePrivate(nodes, assigned, node.index),
    );
    if (!pick) break;
    assigned.set(pick.index, "bedroom");
  }

  // 2. Санузлы — наоборот, ближе к входу и в самых зажатых модулях: окно им
  //    не нужно, а стояк лучше держать компактно.
  const baths = Math.min(bathroomCount(n), Math.max(0, n - bedrooms - 1));
  const bathCandidates = nodes
    .filter((node) => !assigned.has(node.index))
    .sort(
      (a, b) =>
        b.neighbours - a.neighbours ||
        a.depth - b.depth ||
        a.exterior - b.exterior ||
        a.index - b.index,
    );
  // Санузел не должен разрезать общую зону надвое. На доме из четырёх кубиков
  // неудачный выбор оставлял две гостиные по диагонали — формально два
  // помещения, а по смыслу одна разорванная комната. Поэтому из кандидатов
  // берётся первый, после которого общая зона остаётся односвязной.
  for (let placed = 0; placed < baths; placed += 1) {
    const free = bathCandidates.filter((node) => !assigned.has(node.index));
    const pick = free.find((node) => canBePrivate(nodes, assigned, node.index));
    if (!pick) break;
    assigned.set(pick.index, "bathroom");
  }

  // 3. Кухня — модуль общей зоны у наружной стены, но обязательно вплотную к
  //    другому модулю общей зоны. Кухня, отрезанная от гостиной по диагонали,
  //    превращается в отдельную комнату, куда ведёт дверь из спальни — именно
  //    это и получилось на доме из четырёх кубиков.
  //
  //    Если такого модуля нет, кухня не выделяется вовсе: дом получает одну
  //    кухню-гостиную, как в компактных проектах.
  const rest = nodes.filter((node) => !assigned.has(node.index));
  const restIds = new Set(rest.map((node) => node.index));
  const kitchen = [...rest]
    .filter((node) => rest.some((o) => o.index !== node.index && touches(node, o)))
    .sort((a, b) => b.exterior - a.exterior || b.depth - a.depth || a.index - b.index)[0];
  if (kitchen && restIds.size > 1) assigned.set(kitchen.index, "kitchen");

  // 4. Остальное — общая зона: смежные модули сольются в одно помещение,
  //    а если их окажется слишком много, зона поделится на комнаты при
  //    зонировании (см. splitOversizedCommon в zoning.ts).
  const roles = open.map((m, i) => ({ ...m, role: assigned.get(i) ?? ("living" as Role) }));

  // Верхние этажи целиком под спальни: так устроены двухэтажные раскладки.
  const upper = modules
    .filter((m) => m.floor > 0)
    .map((m) => ({ ...m, role: (m.role === "terrace" ? "terrace" : "bedroom") as Role }));

  const terraces = [...fixed.entries()].map(([m, role]) => ({ ...m, role }));
  return [...roles, ...terraces, ...upper];
}

/**
 * Можно ли отдать этот модуль под приватное помещение.
 *
 * Два условия, и оба вылезли из живых прогонов.
 *
 * Первое: у приватной комнаты должен остаться сосед из общей зоны. Иначе
 * единственная дверь спальни ведёт в санузел — а через санузел в спальню не
 * ходят. На крестообразном доме из восьми кубиков так и вышло: три спальни
 * открывались в один санузел, и мебель в нём перестала помещаться.
 *
 * Второе: общая зона не должна разорваться. Две гостиные по диагонали
 * читаются как ошибка планировки, а не как замысел.
 */
function canBePrivate(nodes: Node[], assigned: Map<number, Role>, candidate: number): boolean {
  const node = nodes.find((x) => x.index === candidate);
  if (!node) return false;
  // Проверяем не только кандидата, но и всех, кого уже назначили: соседний
  // модуль мог быть их единственным выходом в общую зону. Крестообразный дом
  // из восьми кубиков ловится именно здесь — там санузел вставал в центр, и
  // три уже назначенные спальни разом теряли выход, начиная открываться в
  // него.
  const stillPublic = (index: number) => !assigned.has(index) && index !== candidate;
  const hasPublicNeighbour = (node_: Node) =>
    nodes.some((o) => o.index !== node_.index && stillPublic(o.index) && touches(node_, o));

  if (!hasPublicNeighbour(node)) return false;
  for (const other of nodes) {
    if (!assigned.has(other.index)) continue;
    if (assigned.get(other.index) === "terrace") continue;
    if (!hasPublicNeighbour(other)) return false;
  }
  return publicStaysConnected(nodes, assigned, candidate);
}

/**
 * Останется ли общая зона односвязной, если отдать ещё один модуль приватному
 * помещению.
 *
 * Общая зона — это всё, что не назначено приватным помещением. Разрывать её
 * нельзя: две гостиные по диагонали читаются как ошибка планировки, а не как
 * замысел.
 */
function publicStaysConnected(
  nodes: Node[],
  assigned: Map<number, Role>,
  candidate: number,
): boolean {
  const rest = nodes.filter((node) => node.index !== candidate && !assigned.has(node.index));
  if (rest.length <= 1) return true;
  const seen = new Set([rest[0].index]);
  const queue = [rest[0]];
  while (queue.length) {
    const cur = queue.shift()!;
    for (const node of rest) {
      if (seen.has(node.index) || !touches(cur, node)) continue;
      seen.add(node.index);
      queue.push(node);
    }
  }
  return seen.size === rest.length;
}

/** Соприкасаются ли два модуля гранью. */
function touches(a: { x: number; z: number }, b: { x: number; z: number }): boolean {
  return (
    (Math.abs(a.x - b.x) === MODULE_SIDE_M && Math.abs(a.z - b.z) < MODULE_SIDE_M) ||
    (Math.abs(a.z - b.z) === MODULE_SIDE_M && Math.abs(a.x - b.x) < MODULE_SIDE_M)
  );
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
