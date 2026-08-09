import type { Cell, HouseStats, ModuleItem } from "./types";
import { CELL_M, MODULE_AREA, ROLES, TERRACE_PRICE_FACTOR } from "./constants";

/** Сторона участка в ячейках для заданного числа соток (квадратный участок). */
export function gridSizeForSotki(sotki: number): number {
  const meters = Math.sqrt(sotki * 100); // сторона квадратного участка в метрах
  const cells = Math.round(meters / CELL_M);
  return Math.max(6, Math.min(20, cells));
}

const key = (floor: number, x: number, z: number) => `${floor}:${x}:${z}`;

/** Карта занятости ячеек → id модуля. Модуль занимает ровно одну ячейку. */
export function occupancy(modules: ModuleItem[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const m of modules) map.set(key(m.floor, m.x, m.z), m.id);
  return map;
}

function inBounds(c: Cell, n: number): boolean {
  return c.x >= 0 && c.z >= 0 && c.x < n && c.z < n;
}

/**
 * Можно ли поставить модуль: в границах участка, ячейка свободна и — для
 * верхних этажей — есть опора этажом ниже.
 */
export function canPlace(
  modules: ModuleItem[],
  candidate: Pick<ModuleItem, "x" | "z" | "floor">,
  n: number,
): boolean {
  if (!inBounds(candidate, n)) return false;
  const occ = occupancy(modules);
  if (occ.has(key(candidate.floor, candidate.x, candidate.z))) return false;
  if (candidate.floor > 0 && !occ.has(key(candidate.floor - 1, candidate.x, candidate.z)))
    return false;
  return true;
}

/** Модули на floor>0, оставшиеся без опоры после удаления removedId. */
export function orphansAfterRemoval(modules: ModuleItem[], removedId: string): ModuleItem[] {
  const remaining = modules.filter((m) => m.id !== removedId);
  const occ = occupancy(remaining);
  return remaining.filter((m) => m.floor > 0 && !occ.has(key(m.floor - 1, m.x, m.z)));
}

export function computeStats(
  modules: ModuleItem[],
  sotki: number,
  basePricePerM2: number,
): HouseStats {
  let heatedArea = 0;
  let terraceArea = 0;
  let footprintArea = 0;
  let bedrooms = 0;
  let kitchens = 0;
  let bathrooms = 0;
  let livingRooms = 0;
  let maxFloor = -1;

  for (const m of modules) {
    const heated = ROLES[m.role].heated;
    if (heated) heatedArea += MODULE_AREA;
    else terraceArea += MODULE_AREA;
    if (m.floor === 0) footprintArea += MODULE_AREA;
    if (m.floor > maxFloor) maxFloor = m.floor;
    if (m.role === "bedroom") bedrooms += 1;
    if (m.role === "kitchen") kitchens += 1;
    if (m.role === "bathroom") bathrooms += 1;
    if (m.role === "living") livingRooms += 1;
  }

  const plotArea = sotki * 100;
  const price = Math.round(
    heatedArea * basePricePerM2 + terraceArea * basePricePerM2 * TERRACE_PRICE_FACTOR,
  );

  return {
    moduleCount: modules.length,
    floors: maxFloor + 1 > 0 ? maxFloor + 1 : 0,
    heatedArea,
    terraceArea,
    totalArea: heatedArea + terraceArea,
    footprintArea,
    plotArea,
    plotUsedPct: plotArea > 0 ? Math.min(100, (footprintArea / plotArea) * 100) : 0,
    price,
    bedrooms,
    kitchens,
    bathrooms,
    livingRooms,
  };
}

export const gridKey = key;
