/**
 * Помещения (RoomZone), общие грани (ModuleJoint) и площади.
 *
 * Комната — это явная сущность состояния: модуль знает свой roomId, а не
 * «догадывается» о принадлежности по совпадению типа или цвета. Поэтому
 * четыре состыкованных модуля могут быть одной большой кухней-гостиной,
 * четырьмя разными комнатами или их комбинацией — это решает зонирование.
 */

import { ROOM_TYPES } from "./constants.ts";
import { computeAdjacency, jointKey } from "./geometry.ts";
import type {
  AreaBreakdown,
  HouseState,
  JointState,
  ModuleFootprint,
  ModuleJoint,
  Opening,
  RoomType,
  RoomZone,
} from "./types.ts";
import { MODULE_AREA_M2, MODULE_SIDE_M as MODULE_SIDE } from "./constants.ts";

export function roomOf(house: HouseState, moduleId: string): RoomZone | undefined {
  const m = house.modules.find((x) => x.id === moduleId);
  if (!m) return undefined;
  return house.rooms.find((r) => r.id === m.roomId);
}

export function modulesOfRoom(house: HouseState, roomId: string): ModuleFootprint[] {
  return house.modules.filter((m) => m.roomId === roomId);
}

export function roomAreaM2(house: HouseState, roomId: string): number {
  return modulesOfRoom(house, roomId).length * MODULE_AREA_M2;
}

/** Убрать комнаты, у которых не осталось модулей (после удаления секции). */
export function pruneRooms(house: HouseState): HouseState {
  const used = new Set(house.modules.map((m) => m.roomId));
  const rooms = house.rooms.filter((r) => used.has(r.id));
  const layouts: HouseState["layouts"] = {};
  for (const r of rooms) {
    if (house.layouts[r.id]) layouts[r.id] = house.layouts[r.id];
  }
  return { ...house, rooms, layouts };
}

/* ------------------------------------------------------------------ */
/* Общие грани                                                         */
/* ------------------------------------------------------------------ */

/**
 * Помещения, у которых дверь ровно одна.
 *
 * Правило снято с чертежей: во всех семи разобранных проектах спальня,
 * санузел и кладовая имеют один вход, а остальные грани — глухая стена. Без
 * этого ограничения комната на стыке трёх соседей получает три двери, зоны
 * прохода перед ними съедают её насквозь, и кровать перестаёт помещаться —
 * ровно то, из-за чего первая версия планировщика оставляла спальни пустыми.
 */
const SINGLE_DOOR_TYPES: RoomType[] = ["bedroom", "bathroom", "storage", "office"];

/**
 * Состояние стыка выводится из планировочной логики, а не из того, что
 * модули «просто рядом»:
 *  - модули одной комнаты — единое пространство (open);
 *  - прихожая и общая зона — широкий проём;
 *  - спальня, санузел, кабинет — дверь;
 *  - терраса и жильё — дверь (выход наружу);
 *  - остальное — закрытая перегородка.
 *
 * Это ПЛАНИРОВОЧНАЯ связь, а не согласованный демонтаж несущей стены:
 * конструктивные правила EcoCub в проекте не подтверждены
 * (см. DATA_REQUIRED_FROM_ECOCUB.md).
 */
export function deriveJointState(a: RoomType | undefined, b: RoomType | undefined): JointState {
  if (!a || !b) return "unknown";
  // Совпадение типа — ещё не одно помещение. Две спальни рядом остаются двумя
  // спальнями с глухой стеной между ними: сюда попадают только РАЗНЫЕ комнаты
  // (модули одной комнаты обрабатываются выше и дают "open"). Раньше здесь был
  // проём, и соседняя спальня съедала зоной прохода половину комнаты.
  if (a === b) return SINGLE_DOOR_TYPES.includes(a) ? "closed" : "opening";
  const pair = new Set([a, b]);
  const has = (t: RoomType) => pair.has(t);

  const publicTypes: RoomType[] = ["kitchen", "living", "dining"];
  const bothPublic = publicTypes.includes(a) && publicTypes.includes(b);
  if (bothPublic) return "open";

  if (has("entryway") && (publicTypes.includes(a) || publicTypes.includes(b))) return "opening";
  if (has("entryway")) return "door";
  if (has("terrace")) return "door";
  if (has("bathroom") || has("bedroom") || has("office") || has("storage")) return "door";
  if (has("stairs")) return "opening";
  return "closed";
}

/** Насколько тип помещения годится в качестве соседа для единственной двери. */
function doorPreference(type: RoomType | undefined): number {
  if (!type) return 0;
  if (type === "entryway") return 4;
  if (type === "living" || type === "dining") return 3;
  if (type === "kitchen") return 2;
  if (type === "stairs") return 1;
  return 0;
}

export function computeJoints(house: HouseState): ModuleJoint[] {
  const adjacency = computeAdjacency(house.modules);
  const roomById = new Map(house.rooms.map((r) => [r.id, r]));
  const moduleById = new Map(house.modules.map((m) => [m.id, m]));

  const joints: ModuleJoint[] = adjacency.map((adj) => {
    const key = jointKey(adj.aId, adj.bId);
    const override = house.jointOverrides[key];
    const ra = roomById.get(moduleById.get(adj.aId)?.roomId ?? "");
    const rb = roomById.get(moduleById.get(adj.bId)?.roomId ?? "");
    const derived =
      ra && rb && ra.id === rb.id ? ("open" as JointState) : deriveJointState(ra?.type, rb?.type);
    return {
      ...adj,
      state: override ?? derived,
      source: override ? "manual" : "derived",
    };
  });

  return applySingleDoorRule(joints, house, roomById, moduleById);
}

/**
 * Оставить приватным помещениям одну дверь, остальные стыки закрыть.
 *
 * Дверь выбирается не случайно: сначала по соседу — из прихожей лучше, чем из
 * кухни; при равенстве — по длине стыка, затем по идентификатору. Последнее
 * нужно для повторяемости: один и тот же дом обязан давать одну и ту же
 * планировку, иначе клиент увидит разное на двух открытиях страницы.
 *
 * Ручные состояния стыков не трогаются: если человек сам открыл проём, правило
 * не имеет права его закрыть.
 */
function applySingleDoorRule(
  joints: ModuleJoint[],
  house: HouseState,
  roomById: Map<string, RoomZone>,
  moduleById: Map<string, ModuleFootprint>,
): ModuleJoint[] {
  const roomOf = (id: string) => roomById.get(moduleById.get(id)?.roomId ?? "");
  const closed = new Set<ModuleJoint>();

  for (const room of house.rooms) {
    if (!SINGLE_DOOR_TYPES.includes(room.type)) continue;
    const ids = new Set(room.moduleIds);

    const outer = joints.filter(
      (j) => ids.has(j.aId) !== ids.has(j.bId) && j.state === "door" && j.source === "derived",
    );
    if (outer.length <= 1) continue;

    const ranked = [...outer].sort((p, q) => {
      const other = (j: ModuleJoint) => (ids.has(j.aId) ? roomOf(j.bId) : roomOf(j.aId));
      const byPreference = doorPreference(other(q)?.type) - doorPreference(other(p)?.type);
      if (byPreference !== 0) return byPreference;
      const span = (j: ModuleJoint) => j.to - j.from;
      if (span(q) !== span(p)) return span(q) - span(p);
      return jointKey(p.aId, p.bId).localeCompare(jointKey(q.aId, q.bId));
    });

    for (const j of ranked.slice(1)) closed.add(j);
  }

  return joints.map((j) => (closed.has(j) ? { ...j, state: "closed" as JointState } : j));
}

/** Есть ли у комнаты выход: дверь, проём или объединённое пространство. */
export function roomHasRoute(house: HouseState, roomId: string): boolean {
  const joints = computeJoints(house);
  const ids = new Set(modulesOfRoom(house, roomId).map((m) => m.id));
  return joints.some(
    (j) => ids.has(j.aId) !== ids.has(j.bId) && j.state !== "closed" && j.state !== "unknown",
  );
}

/* ------------------------------------------------------------------ */
/* Площади                                                             */
/* ------------------------------------------------------------------ */

/**
 * Общая площадь дома — все отапливаемые помещения, включая прихожую,
 * санузлы, лестницу и хозблок. Жилая — только жилые комнаты. Терраса
 * считается отдельно и в площадь дома не входит.
 */
export function computeAreas(house: HouseState): AreaBreakdown {
  let total = 0;
  let living = 0;
  let terrace = 0;
  let maxFloor = -1;

  const roomById = new Map(house.rooms.map((r) => [r.id, r]));
  for (const m of house.modules) {
    const room = roomById.get(m.roomId);
    const meta = room ? ROOM_TYPES[room.type] : undefined;
    if (!meta) continue;
    if (meta.heated) {
      total += MODULE_AREA_M2;
      if (meta.living) living += MODULE_AREA_M2;
    } else {
      terrace += MODULE_AREA_M2;
    }
    if (m.floor > maxFloor) maxFloor = m.floor;
  }

  return {
    totalAreaM2: total,
    livingAreaM2: living,
    terraceAreaM2: terrace,
    floors: maxFloor + 1,
    moduleCount: house.modules.length,
  };
}

/* ------------------------------------------------------------------ */
/* Проёмы наружных стен                                                */
/* ------------------------------------------------------------------ */

/**
 * Окна и входная дверь — производный слой: их положение вычисляется из
 * наружных стен комнат, а не хранится вручную. Санузел, хозблок и лестница
 * окон на схеме не получают, прихожая получает входную дверь.
 *
 * Это планировочная схема для понимания масштаба: точный состав остекления
 * подтверждает инженер EcoCub.
 */
export function deriveOpenings(house: HouseState, floor: number): Opening[] {
  const out: Opening[] = [];
  const noWindows: RoomType[] = ["bathroom", "storage", "stairs"];

  for (const room of house.rooms) {
    if (room.floor !== floor) continue;
    if (room.type === "terrace") continue;
    const geo = roomGeometryLite(house, room.id);
    if (!geo) continue;

    const exterior = geo
      .filter((w) => w.exterior && w.length >= 2.4)
      .sort((a, b) => b.length - a.length);
    if (!exterior.length) continue;

    if (room.type === "entryway") {
      const wall = exterior[0];
      out.push({
        id: `entry-${room.id}`,
        kind: "entry",
        x: wall.axis === "x" ? wall.at : (wall.from + wall.to) / 2,
        z: wall.axis === "x" ? (wall.from + wall.to) / 2 : wall.at,
        widthM: 1.1,
        axis: wall.axis,
      });
      continue;
    }
    if (noWindows.includes(room.type)) continue;

    // По одному окну на каждую достаточно длинную наружную стену, но не
    // больше двух — схема должна оставаться спокойной.
    for (const wall of exterior.slice(0, 2)) {
      out.push({
        id: `win-${room.id}-${wall.axis}-${wall.at}-${wall.from}`,
        kind: "window",
        x: wall.axis === "x" ? wall.at : (wall.from + wall.to) / 2,
        z: wall.axis === "x" ? (wall.from + wall.to) / 2 : wall.at,
        widthM: Math.min(2.2, wall.length - 0.8),
        axis: wall.axis,
      });
    }
  }
  return out;
}

/** Упрощённые стены комнаты — без зависимостей от планировщика мебели. */
function roomGeometryLite(
  house: HouseState,
  roomId: string,
): Array<{
  axis: "x" | "z";
  at: number;
  from: number;
  to: number;
  exterior: boolean;
  length: number;
}> | null {
  const room = house.rooms.find((r) => r.id === roomId);
  if (!room) return null;
  const own = house.modules.filter((m) => m.roomId === roomId);
  if (!own.length) return null;
  const sameFloor = house.modules.filter((m) => m.floor === room.floor);
  const side = MODULE_SIDE;
  const walls: Array<{
    axis: "x" | "z";
    at: number;
    from: number;
    to: number;
    exterior: boolean;
    length: number;
  }> = [];

  for (const m of own) {
    const others = sameFloor.filter((o) => o.id !== m.id);
    const edges = [
      { axis: "x" as const, at: m.x, from: m.z, to: m.z + side, dir: -1 },
      { axis: "x" as const, at: m.x + side, from: m.z, to: m.z + side, dir: 1 },
      { axis: "z" as const, at: m.z, from: m.x, to: m.x + side, dir: -1 },
      { axis: "z" as const, at: m.z + side, from: m.x, to: m.x + side, dir: 1 },
    ];
    for (const e of edges) {
      const neighbour = others.find((o) =>
        e.axis === "x"
          ? Math.abs((e.dir === 1 ? o.x : o.x + side) - e.at) < 1e-9 &&
            Math.min(o.z + side, e.to) - Math.max(o.z, e.from) > 1e-9
          : Math.abs((e.dir === 1 ? o.z : o.z + side) - e.at) < 1e-9 &&
            Math.min(o.x + side, e.to) - Math.max(o.x, e.from) > 1e-9,
      );
      if (neighbour && neighbour.roomId === roomId) continue;
      walls.push({
        axis: e.axis,
        at: e.at,
        from: e.from,
        to: e.to,
        exterior: !neighbour,
        length: e.to - e.from,
      });
    }
  }

  // Склейка коллинеарных кусков одной стены.
  const merged: typeof walls = [];
  for (const w of walls.sort(
    (a, b) => a.axis.localeCompare(b.axis) || a.at - b.at || a.from - b.from,
  )) {
    const prev = merged[merged.length - 1];
    if (
      prev &&
      prev.axis === w.axis &&
      Math.abs(prev.at - w.at) < 1e-9 &&
      prev.exterior === w.exterior &&
      Math.abs(prev.to - w.from) < 1e-9
    ) {
      prev.to = w.to;
      prev.length = prev.to - prev.from;
    } else {
      merged.push({ ...w });
    }
  }
  return merged;
}

/** Сколько комнат каждого типа — для сводки и заявки. */
export function roomCounts(house: HouseState): Array<{ type: RoomType; count: number }> {
  const counts = new Map<RoomType, number>();
  for (const r of house.rooms) counts.set(r.type, (counts.get(r.type) ?? 0) + 1);
  return Array.from(counts.entries()).map(([type, count]) => ({ type, count }));
}
