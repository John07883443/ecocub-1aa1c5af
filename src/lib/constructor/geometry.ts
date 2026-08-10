// Расширение .ts в относительных импортах — намеренно: доменная логика
// новой версии конструктора (src/lib/v3) гоняется юнит-тестами через
// `node --experimental-strip-types --test`, а Node в ESM-режиме требует
// полные пути. Vite и tsconfig (allowImportingTsExtensions) это разрешают.
import type { Cell, HouseStats, ModuleItem } from "./types.ts";
import {
  CELL_M,
  MIN_SUPPORT_AREA,
  MODULE_AREA,
  MODULE_SIDE_M,
  ROLES,
  STEP_M,
  TERRACE_PRICE_FACTOR,
} from "./constants.ts";

/** Сторона участка в ячейках по 3 м для заданного числа соток (квадратный участок). */
export function gridSizeForSotki(sotki: number): number {
  const meters = Math.sqrt(sotki * 100); // сторона квадратного участка в метрах
  const cells = Math.round(meters / CELL_M);
  return Math.max(6, Math.min(20, cells));
}

/** Максимально допустимый якорь модуля (левый-верхний угол) на участке из n ячеек. */
export function maxAnchor(n: number): number {
  return n * CELL_M - MODULE_SIDE_M;
}

/** Пересечение двух модулей в плане, м² (модули 3×3, координаты в метрах). */
function overlapArea(a: Pick<ModuleItem, "x" | "z">, b: Pick<ModuleItem, "x" | "z">): number {
  const ox = Math.min(a.x + MODULE_SIDE_M, b.x + MODULE_SIDE_M) - Math.max(a.x, b.x);
  const oz = Math.min(a.z + MODULE_SIDE_M, b.z + MODULE_SIDE_M) - Math.max(a.z, b.z);
  return ox > 0 && oz > 0 ? ox * oz : 0;
}

/**
 * Площадь опоры кандидата на модули этажом ниже, м². Модули одного этажа не
 * пересекаются, поэтому сумма попарных пересечений равна площади объединения.
 */
export function supportArea(
  candidate: Pick<ModuleItem, "x" | "z" | "floor">,
  modules: ModuleItem[],
): number {
  let area = 0;
  for (const m of modules) {
    if (m.floor !== candidate.floor - 1) continue;
    area += overlapArea(candidate, m);
  }
  return area;
}

function inBounds(c: Cell, n: number): boolean {
  const max = maxAnchor(n);
  return c.x >= 0 && c.z >= 0 && c.x <= max && c.z <= max;
}

/**
 * Можно ли поставить модуль: в границах участка, без пересечений с соседями
 * по этажу и — для верхних этажей — с опорой не меньше трети площади.
 */
export function canPlace(
  modules: ModuleItem[],
  candidate: Pick<ModuleItem, "x" | "z" | "floor">,
  n: number,
): boolean {
  if (!inBounds(candidate, n)) return false;
  for (const m of modules) {
    if (m.floor === candidate.floor && overlapArea(candidate, m) > 0) return false;
  }
  if (candidate.floor > 0 && supportArea(candidate, modules) < MIN_SUPPORT_AREA) return false;
  return true;
}

/**
 * Подобрать якорь под точку тапа: модуль центрируется на точке и прилипает к
 * шагу 1 м; если место занято, пробуем соседние позиции в радиусе одного шага.
 */
export function anchorForPoint(
  modules: ModuleItem[],
  px: number,
  pz: number,
  floor: number,
  n: number,
): Cell | null {
  const max = maxAnchor(n);
  const clamp = (v: number) => Math.max(0, Math.min(max, Math.round(v)));
  const ax = clamp(px - MODULE_SIDE_M / 2);
  const az = clamp(pz - MODULE_SIDE_M / 2);

  const candidates: Cell[] = [{ x: ax, z: az }];
  for (const dx of [-STEP_M, 0, STEP_M]) {
    for (const dz of [-STEP_M, 0, STEP_M]) {
      if (dx === 0 && dz === 0) continue;
      candidates.push({ x: clamp(ax + dx), z: clamp(az + dz) });
    }
  }
  for (const c of candidates) {
    if (canPlace(modules, { ...c, floor }, n)) return c;
  }
  return null;
}

/** Модули на floor>0, оставшиеся без достаточной опоры после удаления removedId. */
export function orphansAfterRemoval(modules: ModuleItem[], removedId: string): ModuleItem[] {
  const remaining = modules.filter((m) => m.id !== removedId);
  return remaining.filter((m) => m.floor > 0 && supportArea(m, remaining) < MIN_SUPPORT_AREA);
}

/** Каскадно убирает модули верхних этажей, оставшиеся без достаточной опоры. */
export function dropUnsupported(modules: ModuleItem[]): ModuleItem[] {
  let kept = modules;
  for (;;) {
    const orphans = kept.filter((m) => m.floor > 0 && supportArea(m, kept) < MIN_SUPPORT_AREA);
    if (!orphans.length) return kept;
    const ids = new Set(orphans.map((o) => o.id));
    kept = kept.filter((m) => !ids.has(m.id));
  }
}

/**
 * Можно ли передвинуть модуль id в позицию (x, z): без пересечений, с опорой
 * для него самого и не лишая опоры ни один из уже стоящих модулей.
 */
export function isValidMove(
  modules: ModuleItem[],
  id: string,
  x: number,
  z: number,
  n: number,
): boolean {
  const target = modules.find((m) => m.id === id);
  if (!target) return false;
  const rest = modules.filter((m) => m.id !== id);
  const moved = { ...target, x, z };
  if (!canPlace(rest, moved, n)) return false;
  const next = [...rest, moved];
  return dropUnsupported(next).length === next.length;
}

/** Все допустимые позиции (шаг 1 м) для перемещения модуля id по участку. */
export function validMoveAnchors(modules: ModuleItem[], id: string, n: number): Set<string> {
  const valid = new Set<string>();
  const max = maxAnchor(n);
  for (let x = 0; x <= max; x += STEP_M) {
    for (let z = 0; z <= max; z += STEP_M) {
      if (isValidMove(modules, id, x, z, n)) valid.add(`${x},${z}`);
    }
  }
  return valid;
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
