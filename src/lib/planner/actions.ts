/**
 * Операции над домом v3.1 — чистые функции без React.
 *
 * Каждая операция атомарна: нормализует координаты, пересчитывает соседство,
 * связность, зоны и меблировку затронутых комнат и возвращает целиком новое
 * состояние либо внятную причину отказа. Промежуточных состояний, где модуль
 * уже удалён, а мебель и цена ещё старые, не существует.
 */

import { MAX_FLOORS, MODULE_SIDE_M, ROOM_TYPES } from "./constants.ts";
import {
  bestAttachSpot,
  bounds,
  canPlace,
  computeAdjacency,
  dropUnsupported,
  houseIssues,
  isFloorConnected,
  supportArea,
} from "./geometry.ts";
import { relayoutRooms, relayoutAll } from "./furniture.ts";
import { pruneRooms } from "./rooms.ts";
import type { HouseState, ModuleFootprint, RoomType, RoomZone, TxResult } from "./types.ts";
import { MIN_SUPPORT_AREA_M2 } from "./constants.ts";

let seq = 0;
export const newModuleId = () => `m${++seq}`;
export const newRoomId = () => `r${++seq}`;

export const emptyHouse = (): HouseState => ({
  modules: [],
  rooms: [],
  jointOverrides: {},
  layouts: {},
});

/** Комнаты, соседние с указанными модулями (их меблировку надо пересчитать). */
function affectedRoomIds(house: HouseState, moduleIds: string[]): string[] {
  const ids = new Set<string>();
  const byId = new Map(house.modules.map((m) => [m.id, m]));
  for (const mid of moduleIds) {
    const m = byId.get(mid);
    if (m) ids.add(m.roomId);
  }
  for (const adj of computeAdjacency(house.modules)) {
    if (moduleIds.includes(adj.aId)) {
      const b = byId.get(adj.bId);
      if (b) ids.add(b.roomId);
    }
    if (moduleIds.includes(adj.bId)) {
      const a = byId.get(adj.aId);
      if (a) ids.add(a.roomId);
    }
  }
  return Array.from(ids);
}

/* ------------------------------------------------------------------ */
/* Добавление помещения                                                */
/* ------------------------------------------------------------------ */

/**
 * Добавить помещение: модуль встаёт вплотную к дому в ближайшее валидное
 * место — пользователю не нужно ловить пиксели.
 */
export function addRoom(house: HouseState, type: RoomType, floor = 0): TxResult {
  if (floor >= MAX_FLOORS) {
    return { ok: false, error: `Технология EcoCub — до ${MAX_FLOORS} этажей` };
  }
  if (type === "entryway" && floor > 0) {
    return { ok: false, error: "Прихожая может быть только на первом этаже" };
  }
  const spot = bestAttachSpot(house.modules, floor);
  if (!spot) {
    return {
      ok: false,
      error:
        floor > 0
          ? "Наверху нет места с достаточной опорой — сначала расширьте этаж ниже"
          : "Не нашлось свободной грани — уберите лишний модуль или сдвиньте дом",
    };
  }

  const roomId = newRoomId();
  const module: ModuleFootprint = { id: newModuleId(), floor, x: spot.x, z: spot.z, roomId };
  const room: RoomZone = { id: roomId, type, floor, moduleIds: [module.id] };

  const next: HouseState = {
    ...house,
    modules: [...house.modules, module],
    rooms: [...house.rooms, room],
  };
  const withLayout = relayoutRooms(next, affectedRoomIds(next, [module.id]));
  return {
    ok: true,
    house: withLayout,
    note: `${ROOM_TYPES[type].label} — добавлено помещение`,
  };
}

/** Увеличить существующую комнату ещё одним модулем той же зоны. */
export function growRoom(house: HouseState, roomId: string): TxResult {
  const room = house.rooms.find((r) => r.id === roomId);
  if (!room) return { ok: false, error: "Помещение не найдено" };

  // Ищем позицию, стыкующуюся гранью именно с модулями этой комнаты.
  const roomModules = house.modules.filter((m) => m.roomId === roomId);
  for (const m of roomModules) {
    for (const [dx, dz] of [
      [MODULE_SIDE_M, 0],
      [-MODULE_SIDE_M, 0],
      [0, MODULE_SIDE_M],
      [0, -MODULE_SIDE_M],
    ]) {
      // Ровное примыкание сначала, затем со сдвигом вдоль грани на 1–2 м.
      for (const o of [0, 1, -1, 2, -2]) {
        const x = m.x + dx + (dx === 0 ? o : 0);
        const z = m.z + dz + (dz === 0 ? o : 0);
        if (!canPlace(house.modules, { x, z, floor: room.floor })) continue;
        const module: ModuleFootprint = {
          id: newModuleId(),
          floor: room.floor,
          x,
          z,
          roomId,
        };
        const next: HouseState = {
          ...house,
          modules: [...house.modules, module],
          rooms: house.rooms.map((r) =>
            r.id === roomId ? { ...r, moduleIds: [...r.moduleIds, module.id] } : r,
          ),
        };
        return {
          ok: true,
          house: relayoutRooms(next, affectedRoomIds(next, [module.id])),
          note: `${ROOM_TYPES[room.type].label} стала просторнее (+9 м²)`,
        };
      }
    }
  }
  return { ok: false, error: "Рядом с этим помещением нет свободного места" };
}

/* ------------------------------------------------------------------ */
/* Второй этаж и зеркало                                               */
/* ------------------------------------------------------------------ */

export function addSecondFloor(house: HouseState): TxResult {
  const hasStairs = house.rooms.some((r) => r.type === "stairs");
  let working = house;
  const notes: string[] = [];

  if (!hasStairs) {
    const stairs = addRoom(working, "stairs", 0);
    if (!stairs.ok) return stairs;
    working = stairs.house;
    notes.push("лестница");
  }

  const upper = addRoom(working, "bedroom", 1);
  if (!upper.ok) return upper;
  notes.push("спальня на втором этаже");
  return { ok: true, house: upper.house, note: `Добавлены: ${notes.join(" и ")}` };
}

export function mirrorHouse(house: HouseState): TxResult {
  if (!house.modules.length) return { ok: false, error: "План пуст" };
  const b = bounds(house.modules);
  const modules = house.modules.map((m) => ({
    ...m,
    x: b.minX + (b.maxX - (m.x + MODULE_SIDE_M)),
  }));
  const next: HouseState = { ...house, modules };
  if (houseIssues(next.modules).length) {
    return { ok: false, error: "Зеркальный вариант нарушает опору верхнего этажа" };
  }
  return { ok: true, house: relayoutAll(next), note: "Дом развёрнут зеркально" };
}

/* ------------------------------------------------------------------ */
/* Перемещение модуля                                                  */
/* ------------------------------------------------------------------ */

export function moveModule(house: HouseState, moduleId: string, x: number, z: number): TxResult {
  const target = house.modules.find((m) => m.id === moduleId);
  if (!target) return { ok: false, error: "Модуль не найден" };
  if (target.x === x && target.z === z) return { ok: true, house, note: "" };

  if (!canPlace(house.modules, { x, z, floor: target.floor }, moduleId)) {
    return { ok: false, error: "Сюда модуль не встаёт: место занято или нет опоры" };
  }
  const modules = house.modules.map((m) => (m.id === moduleId ? { ...m, x, z } : m));
  if (dropUnsupported(modules).length !== modules.length) {
    return { ok: false, error: "Так модули этажом выше останутся без опоры" };
  }
  const next: HouseState = { ...house, modules };
  return {
    ok: true,
    house: relayoutRooms(next, affectedRoomIds(next, [moduleId])),
    note: isFloorConnected(modules, target.floor)
      ? "Модуль переставлен"
      : "Модуль отсоединён от дома — состыкуйте его обратно",
  };
}

/* ------------------------------------------------------------------ */
/* Удаление модуля                                                     */
/* ------------------------------------------------------------------ */

export interface DeleteImpact {
  /** Разорвётся ли дом на несвязные части. */
  breaksConnectivity: boolean;
  /** Сколько модулей верхних этажей потеряет опору. */
  losesSupport: number;
  /** Это последний модуль своей комнаты. */
  removesRoom: boolean;
  /** Комната занимала несколько модулей. */
  splitsRoom: boolean;
}

export function deleteImpact(house: HouseState, moduleId: string): DeleteImpact | null {
  const target = house.modules.find((m) => m.id === moduleId);
  if (!target) return null;
  const rest = house.modules.filter((m) => m.id !== moduleId);
  const kept = dropUnsupported(rest);
  const roomModules = house.modules.filter((m) => m.roomId === target.roomId);
  return {
    breaksConnectivity: rest.length > 0 && !isFloorConnected(rest, target.floor),
    losesSupport: rest.length - kept.length,
    removesRoom: roomModules.length === 1,
    splitsRoom: roomModules.length > 2,
  };
}

/**
 * Удалить один физический модуль. Действие относится к секции, а не к
 * комнате целиком: если помещение занимало несколько модулей, остальные
 * остаются. Опасные последствия требуют подтверждения (needsConfirm).
 */
export function deleteModule(house: HouseState, moduleId: string, confirmed = false): TxResult {
  const target = house.modules.find((m) => m.id === moduleId);
  if (!target) return { ok: false, error: "Модуль не найден" };
  const impact = deleteImpact(house, moduleId)!;

  if (!confirmed && (impact.breaksConnectivity || impact.losesSupport > 0)) {
    return {
      ok: false,
      needsConfirm: true,
      error: impact.breaksConnectivity
        ? "Без этого модуля дом распадётся на несвязанные части"
        : `Без опоры останутся модули выше: ${impact.losesSupport}`,
    };
  }

  const rest = house.modules.filter((m) => m.id !== moduleId);
  const kept = dropUnsupported(rest);
  const removedIds = new Set([moduleId, ...rest.filter((m) => !kept.includes(m)).map((m) => m.id)]);

  const rooms = house.rooms.map((r) => ({
    ...r,
    moduleIds: r.moduleIds.filter((id) => !removedIds.has(id)),
  }));
  const next = pruneRooms({ ...house, modules: kept, rooms });
  const affected = affectedRoomIds(house, Array.from(removedIds)).filter((id) =>
    next.rooms.some((r) => r.id === id),
  );

  return {
    ok: true,
    house: relayoutRooms(next, affected),
    note: removedIds.size > 1 ? `Удалено модулей: ${removedIds.size}` : "Модуль удалён",
  };
}

/** Сменить назначение помещения, которому принадлежит модуль. */
export function changeRoomType(house: HouseState, roomId: string, type: RoomType): TxResult {
  const room = house.rooms.find((r) => r.id === roomId);
  if (!room) return { ok: false, error: "Помещение не найдено" };
  if (type === "entryway" && room.floor > 0) {
    return { ok: false, error: "Прихожая может быть только на первом этаже" };
  }
  const next: HouseState = {
    ...house,
    rooms: house.rooms.map((r) => (r.id === roomId ? { ...r, type } : r)),
  };
  return {
    ok: true,
    house: relayoutRooms(next, affectedRoomIds(next, room.moduleIds)),
    note: `Назначение изменено: ${ROOM_TYPES[type].label}`,
  };
}

/** Полная очистка дома. Ответы квиза и участок сохраняются вызывающим кодом. */
export function clearHouse(): TxResult {
  return { ok: true, house: emptyHouse(), note: "План очищен" };
}

/** Проверка перед переходом к фасаду/расчёту: дом собран и связен. */
export function houseReadiness(house: HouseState): { ready: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (!house.modules.length) reasons.push("В плане пока нет ни одного помещения");
  else {
    reasons.push(...houseIssues(house.modules));
    const hasHeated = house.rooms.some((r) => ROOM_TYPES[r.type].heated);
    if (!hasHeated) reasons.push("В доме нет ни одного отапливаемого помещения");
  }
  return { ready: reasons.length === 0, reasons };
}

/** Модули без достаточной опоры — для подсветки предупреждений. */
export function unsupportedModules(house: HouseState): ModuleFootprint[] {
  return house.modules.filter(
    (m) => m.floor > 0 && supportArea(m, house.modules) < MIN_SUPPORT_AREA_M2 - 1e-9,
  );
}
