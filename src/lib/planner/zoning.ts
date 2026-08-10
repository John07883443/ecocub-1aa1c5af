// .ts в импортах — для запуска доменных тестов через node --experimental-strip-types.
import type { ModuleItem, Role } from "../constructor/types.ts";
import { MODULE } from "../standards/ecocub.ts";
import { emptyHouse, newModuleId, newRoomId } from "./actions.ts";
import { computeAdjacency } from "./geometry.ts";
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
export function houseFromModules(source: ModuleItem[]): HouseState {
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

  return relayoutAll({ ...emptyHouse(), modules, rooms });
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
