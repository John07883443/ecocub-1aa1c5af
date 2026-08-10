/**
 * Стартовые конфигурации v3.1 из библиотеки планов v3.
 *
 * Библиотека (src/lib/v3/plans.ts) остаётся единственным источником реальных
 * планировок EcoCub — v3.1 не заводит вторую копию данных, а переводит план
 * в свою модель: ячейки → модули, смежные ячейки одного назначения → одна
 * комната (RoomZone), затем считается меблировка.
 *
 * Отдельно: в v3 не было прихожей и кабинета, поэтому «служебные» ячейки
 * гостиной у входа НЕ переименовываются автоматически — выдумывать
 * планировочные решения за EcoCub нельзя. Прихожую пользователь добавляет
 * сам одним действием.
 */

import { findPlan, PLAN_LIBRARY } from "../v3/plans.ts";
import type { EcoCubPlan } from "../v3/types.ts";
import type { Role } from "../constructor/types.ts";
import { relayoutAll } from "./furniture.ts";
import { emptyHouse, newModuleId, newRoomId } from "./actions.ts";
import { computeAdjacency } from "./geometry.ts";
import type { HouseState, ModuleFootprint, RoomType, RoomZone } from "./types.ts";

/** Роли v3 → типы помещений v3.1. */
const ROLE_TO_TYPE: Record<Role, RoomType> = {
  living: "living",
  bedroom: "bedroom",
  kitchen: "kitchen",
  bathroom: "bathroom",
  stairs: "stairs",
  terrace: "terrace",
};

/**
 * Собрать дом v3.1 из плана v3. Смежные модули одного назначения на одном
 * этаже объединяются в одну комнату — так кухня-гостиная из двух ячеек
 * получает единый контур и одну расстановку мебели, а не две одинаковые.
 */
export function houseFromPlan(plan: EcoCubPlan): HouseState {
  const modules: ModuleFootprint[] = plan.cells.map((c) => ({
    id: newModuleId(),
    floor: c.floor,
    x: c.x,
    z: c.z,
    roomId: "",
  }));
  const typeByModule = new Map<string, RoomType>();
  plan.cells.forEach((c, i) => typeByModule.set(modules[i].id, ROLE_TO_TYPE[c.role]));

  // Объединение смежных модулей одного типа: обход в ширину по общим граням.
  const adjacency = computeAdjacency(modules);
  const neighbours = new Map<string, string[]>();
  for (const m of modules) neighbours.set(m.id, []);
  for (const a of adjacency) {
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
    // Санузлы и лестницы не сливаем в одну зону, даже если стоят рядом:
    // это разные помещения, а не одно большое.
    const chunks = type === "bathroom" || type === "stairs" ? group.map((id) => [id]) : [group];
    for (const chunk of chunks) {
      const roomId = newRoomId();
      rooms.push({ id: roomId, type, floor: m.floor, moduleIds: chunk });
      for (const id of chunk) {
        const mod = modules.find((x) => x.id === id)!;
        mod.roomId = roomId;
      }
    }
  }

  return relayoutAll({ ...emptyHouse(), modules, rooms });
}

export function houseFromPlanId(planId: string): HouseState | null {
  const plan = findPlan(planId);
  return plan ? houseFromPlan(plan) : null;
}

/** Небольшой стартовый дом для пути «Собрать самостоятельно». */
export function starterHouse(): HouseState {
  const plan = PLAN_LIBRARY.find((p) => p.slug === "cube");
  return plan ? houseFromPlan(plan) : emptyHouse();
}
