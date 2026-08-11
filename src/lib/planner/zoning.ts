// .ts в импортах — для запуска доменных тестов через node --experimental-strip-types.
import type { ModuleItem, Role } from "../constructor/types.ts";
import { MODULE_SIDE_M } from "../constructor/constants.ts";
import { MODULE } from "../standards/ecocub.ts";
import { emptyHouse, newModuleId, newRoomId } from "./actions.ts";
import { MAX_COMMON_MODULES, assignRoles } from "./program.ts";
import { computeAdjacency } from "./geometry.ts";
import { computeJoints } from "./rooms.ts";
import { relayoutAll } from "./furniture.ts";
import type { HouseState, ModuleFootprint, RoomType, RoomZone } from "./types.ts";

/**
 * Разбор собранного дома на помещения.
 *
 * Вход — плоский список кубиков боевого конструктора. Выход — дом,
 * разложенный на комнаты, с расставленной мебелью. Между ними лежит всё, что
 * мы вычитали из семи построенных проектов: какие модули сливаются в одно
 * помещение, а какие остаются раздельными.
 *
 * Почему это заменило генерацию нейросетью. Модель получала контур и правила
 * и всё равно рисовала выдуманную квартиру: то санузел посреди гостиной, то
 * дверь в глухую стену. Здесь выдумывать нечего — правила выведены из
 * чертежей и проверяются тестами, а результат при одном входе всегда один и
 * тот же.
 */

/** Роли кубиков конструктора → типы помещений. */
const ROLE_TO_TYPE: Record<Role, RoomType> = {
  living: "living",
  bedroom: "bedroom",
  kitchen: "kitchen",
  bathroom: "bathroom",
  stairs: "stairs",
  terrace: "terrace",
};

/**
 * Какие помещения сливаются из нескольких модулей, а какие — нет.
 *
 * Паттерн «кухня-гостиная из двух модулей со снятой стеной» подтверждён всеми
 * семью проектами: у Weekend One это 17,35 м² на модулях B и C, у Family Two —
 * 35 м² на двух средних пролётах. Обратный паттерн столь же устойчив: спальня
 * занимает модуль целиком и не делится, а два санузла рядом остаются двумя
 * санузлами, а не одним большим — стояк общий, помещения разные.
 */
function mergeable(type: RoomType): boolean {
  return type !== "bathroom" && type !== "stairs" && type !== "bedroom";
}

/**
 * Собрать дом из кубиков конструктора.
 *
 * Смежные модули одного назначения объединяются в одну зону обходом в ширину
 * по общим граням — так кухня-гостиная получает единый контур и одну
 * расстановку мебели, а не две одинаковые в каждой ячейке.
 */
export function houseFromModules(input: ModuleItem[]): HouseState {
  // Кубики приходят одинаковыми: боевой конструктор роли не различает.
  // Назначение помещений — отдельный шаг, выведенный из семи проектов.
  const source = assignRoles(input);
  const modules: ModuleFootprint[] = source.map((m) => ({
    id: newModuleId(),
    floor: m.floor,
    x: m.x,
    z: m.z,
    roomId: "",
  }));
  if (!modules.length) return emptyHouse();

  const typeByModule = new Map<string, RoomType>();
  source.forEach((m, i) => typeByModule.set(modules[i].id, ROLE_TO_TYPE[m.role] ?? "living"));

  const neighbours = new Map<string, string[]>();
  for (const m of modules) neighbours.set(m.id, []);
  for (const a of computeAdjacency(modules)) {
    if (typeByModule.get(a.aId) !== typeByModule.get(a.bId)) continue;
    neighbours.get(a.aId)!.push(a.bId);
    neighbours.get(a.bId)!.push(a.aId);
  }

  const rooms: RoomZone[] = [];
  const seen = new Set<string>();
  for (const m of modules) {
    if (seen.has(m.id)) continue;
    const type = typeByModule.get(m.id)!;
    const group: string[] = [];
    const queue = [m.id];
    seen.add(m.id);
    while (queue.length) {
      const id = queue.shift()!;
      group.push(id);
      for (const n of neighbours.get(id) ?? []) {
        if (seen.has(n)) continue;
        seen.add(n);
        queue.push(n);
      }
    }
    const chunks = mergeable(type) ? [group] : group.map((id) => [id]);
    for (const chunk of chunks) {
      const roomId = newRoomId();
      rooms.push({ id: roomId, type, floor: m.floor, moduleIds: chunk });
      for (const id of chunk) {
        modules.find((x) => x.id === id)!.roomId = roomId;
      }
    }
  }

  return relayoutAll(
    addHallway(
      nameSingleCommon(
        retypeCirculation(splitOversizedCommon({ ...emptyHouse(), modules, rooms })),
      ),
    ),
  );
}

/**
 * Последняя проверка назначений — уже после всех перекроек.
 *
 * Столовая из одного модуля не получается: стен по периметру не остаётся, и
 * стол ставить негде. Отсечь такие при делении зоны мало — модуль у столовой
 * может забрать прихожая на следующем шаге. Поэтому проверка стоит в самом
 * конце, когда состав помещений окончателен.
 */
function normalizeCommon(house: HouseState): HouseState {
  return {
    ...house,
    rooms: house.rooms.map((r) =>
      r.type === "dining" && r.moduleIds.length < 2 ? { ...r, type: "living" as const } : r,
    ),
  };
}

/**
 * Прихожая у входа для домов покрупнее.
 *
 * В компактных домах её нет и быть не должно: входят прямо в общую комнату,
 * как в Weekend Mini на трёх модулях. Отдавать под тамбур целый кубик из
 * четырёх — расточительство.
 *
 * От восьми модулей прихожая появляется отдельным помещением: у Family One
 * она 5,1 м², у Family Two 3,4, у Nasledie 9,6. Забирается самый южный модуль
 * общей зоны — тот, у которого вход, — и только если общей зоны после этого
 * останется достаточно.
 */
function addHallway(house: HouseState): HouseState {
  const heated = house.rooms.filter((r) => r.type !== "terrace");
  if (heated.length < 4) return house;
  const modules = house.modules.filter((m) =>
    heated.some((r) => r.id === m.roomId && r.type !== "terrace"),
  );
  // Порог с запасом: на восьми модулях отрезание прихожей оставляло общую
  // зону из двух кусков, и планировщик переставал их обставлять. Прогон это
  // и показал — семь форм из восьмикубиковых.
  if (modules.length < 9) return house;
  if (house.rooms.some((r) => r.type === "entryway")) return house;

  // Прихожая отрезается от общей зоны: берётся самый южный её модуль — тот,
  // у которого вход. Отдельного помещения под неё в программе нет, и это
  // правильно: в реальных проектах прихожая и есть кусок общего объёма,
  // выгороженный перегородками.
  const donor = house.rooms
    .filter((r) => r.type === "living" && r.moduleIds.length >= 3)
    .sort((a, b) => b.moduleIds.length - a.moduleIds.length || a.id.localeCompare(b.id))[0];
  if (!donor) return house;

  const byId = new Map(house.modules.map((m) => [m.id, m]));
  const south = [...donor.moduleIds].sort((a, b) => {
    const p = byId.get(a)!;
    const q = byId.get(b)!;
    return q.z - p.z || p.x - q.x;
  })[0];

  // Остаток общей зоны обязан остаться связным, иначе прихожая разрежет дом.
  const left = donor.moduleIds.filter((id) => id !== south);
  if (!connected(left, byId)) return house;

  const hallId = newRoomId();
  return {
    ...house,
    modules: house.modules.map((m) => (m.id === south ? { ...m, roomId: hallId } : m)),
    rooms: [
      ...house.rooms.map((r) => (r.id === donor.id ? { ...r, moduleIds: left } : r)),
      { id: hallId, type: "entryway" as const, floor: donor.floor, moduleIds: [south] },
    ],
  };
}

/** Связна ли группа модулей по общим граням. */
function connected(ids: string[], byId: Map<string, ModuleFootprint>): boolean {
  if (ids.length <= 1) return true;
  const seen = new Set([ids[0]]);
  const queue = [ids[0]];
  while (queue.length) {
    const cur = byId.get(queue.shift()!)!;
    for (const id of ids) {
      if (seen.has(id)) continue;
      const o = byId.get(id)!;
      const touching =
        (Math.abs(o.x - cur.x) === MODULE_SIDE_M && Math.abs(o.z - cur.z) < MODULE_SIDE_M) ||
        (Math.abs(o.z - cur.z) === MODULE_SIDE_M && Math.abs(o.x - cur.x) < MODULE_SIDE_M);
      if (!touching) continue;
      seen.add(id);
      queue.push(id);
    }
  }
  return seen.size === ids.length;
}

/**
 * Единственная общая комната в доме — это кухня-гостиная, а не гостиная.
 *
 * На доме из трёх кубиков планировщик подписывал её «Гостиная» и рисовал
 * диван, а кухни не было нигде: выделять её было некуда, отдельного модуля не
 * осталось. Готовить в таком доме всё равно где-то надо, и в реальных
 * компактных проектах эта комната так и называется — кухня-гостиная
 * (Weekend Mini, 3 модуля).
 */
function nameSingleCommon(house: HouseState): HouseState {
  const common = house.rooms.filter(
    (r) => r.type === "living" || r.type === "kitchen" || r.type === "dining",
  );
  if (common.length !== 1 || common[0].type === "kitchen") return house;
  return {
    ...house,
    rooms: house.rooms.map((r) => (r.id === common[0].id ? { ...r, type: "kitchen" as const } : r)),
  };
}

/**
 * Разрезать разросшуюся общую зону на комнаты.
 *
 * Дом из двадцати двух кубиков давал одну гостиную на пятнадцать модулей —
 * сто тридцать метров, каких нет ни в одном построенном проекте. Загонять
 * излишек в спальни не выходит: чем меньше остаётся общей зоны, тем чаще
 * приватная комната теряет выход, и геометрия справедливо отказывает.
 *
 * Реальные проекты решают это иначе — делят общее на зоны. Super Family на
 * 92 м² разбивает его на кухню-гостиную 22,4 и столовую 11,4; Nasledie на 113
 * добавляет отдельный коридор. Здесь то же самое: зона режется на связные
 * куски не больше пяти модулей и получает разные назначения.
 *
 * Резать начинаем с дальнего от начала координат конца, чтобы кухня осталась
 * там, где её поставило назначение помещений.
 */
function splitOversizedCommon(house: HouseState): HouseState {
  const COMMON: RoomType[] = ["living", "kitchen", "dining"];
  const rooms: RoomZone[] = [];
  const modules = house.modules.map((m) => ({ ...m }));
  const byId = new Map(modules.map((m) => [m.id, m]));

  for (const room of house.rooms) {
    if (!COMMON.includes(room.type) || room.moduleIds.length <= MAX_COMMON_MODULES) {
      rooms.push(room);
      continue;
    }
    const chunks = partition(room.moduleIds, byId, MAX_COMMON_MODULES);
    // Назначения по порядку: первым остаётся исходный тип, дальше столовая и
    // гостиные. Больше трёх общих зон подряд не встречается ни в одном
    // проекте, поэтому дальше всё — гостиные.
    // Столовая из одного модуля не получается: стен по периметру не остаётся,
    // и стол ставить негде. Такой кусок остаётся гостиной.
    const types: RoomType[] = [room.type, "dining", "living"];
    chunks.forEach((chunk, i) => {
      const wanted = types[Math.min(i, types.length - 1)];
      const type = wanted === "dining" && chunk.length < 2 ? "living" : wanted;
      const id = i === 0 ? room.id : newRoomId();
      rooms.push({
        id,
        type: types[Math.min(i, types.length - 1)],
        floor: room.floor,
        moduleIds: chunk,
      });
      for (const moduleId of chunk) byId.get(moduleId)!.roomId = id;
    });
  }

  return { ...house, modules, rooms };
}

/** Разбить группу модулей на связные куски не больше заданного размера. */
function partition(
  moduleIds: string[],
  byId: Map<string, ModuleFootprint>,
  limit: number,
): string[][] {
  const left = new Set(moduleIds);
  const out: string[][] = [];
  while (left.size) {
    // Начинаем с самого дальнего модуля: так первый кусок остаётся у входа.
    const start = [...left].sort((a, b) => {
      const p = byId.get(a)!;
      const q = byId.get(b)!;
      return q.z - p.z || q.x - p.x;
    })[0];
    const chunk: string[] = [];
    const queue = [start];
    left.delete(start);
    while (queue.length && chunk.length < limit) {
      const cur = queue.shift()!;
      chunk.push(cur);
      const c = byId.get(cur)!;
      for (const id of [...left]) {
        if (chunk.length + queue.length >= limit) break;
        const o = byId.get(id)!;
        const touching =
          (Math.abs(o.x - c.x) === MODULE_SIDE_M && Math.abs(o.z - c.z) < MODULE_SIDE_M) ||
          (Math.abs(o.z - c.z) === MODULE_SIDE_M && Math.abs(o.x - c.x) < MODULE_SIDE_M);
        if (!touching) continue;
        left.delete(id);
        queue.push(id);
      }
    }
    // Всё, что осталось в очереди, возвращается в общий котёл.
    for (const id of queue) left.add(id);
    out.push(chunk);
  }
  return out;
}

/**
 * Комната, в которую ведут три и более дверей, — это не гостиная, а холл.
 *
 * Прогон по всем формам из девяти кубиков нашёл около полусотни домов, где
 * один модуль общей зоны окружён соседями со всех сторон. Диван туда не
 * встаёт и встать не может: зоны прохода перед четырьмя дверями не оставляют
 * стены. Настаивать на гостиной здесь бессмысленно — в реальных проектах
 * такое помещение и называется коридором или прихожей (Nasledie, коридор
 * 8,5 м²), а мебели в нём ровно столько, сколько помещается у одной стены.
 */
function retypeCirculation(house: HouseState): HouseState {
  const joints = computeJoints(house);
  const rooms = house.rooms.map((room) => {
    if (room.type !== "living" || room.moduleIds.length !== 1) return room;
    const ids = new Set(room.moduleIds);
    const doors = joints.filter(
      (j) => ids.has(j.aId) !== ids.has(j.bId) && j.state !== "closed" && j.state !== "unknown",
    );
    return doors.length >= 3 ? { ...room, type: "entryway" as const } : room;
  });
  return { ...house, rooms };
}

/**
 * Площадь помещения в чистоте, м².
 *
 * Считается по стандарту, а не по числу кубиков: модуль внутри стен — это
 * 2,78 × 3,00 = 8,34 м², а снятая в стыке стена становится полом и добавляет
 * 0,63 м² на каждый стык внутри помещения. Ровно так набирается 17,35 м² у
 * кухни-гостиной Weekend One.
 */
export function roomAreaM2(house: HouseState, roomId: string): number {
  const room = house.rooms.find((r) => r.id === roomId);
  if (!room) return 0;
  const clear = (MODULE.clearWidthMm * MODULE.clearDepthMm) / 1e6;
  const gain = (MODULE.wallThicknessMm * MODULE.clearDepthMm) / 1e6;
  const ids = new Set(room.moduleIds);
  const joints = computeAdjacency(house.modules).filter(
    (a) => ids.has(a.aId) && ids.has(a.bId),
  ).length;
  return Math.round((room.moduleIds.length * clear + joints * gain) * 100) / 100;
}
