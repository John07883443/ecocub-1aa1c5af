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
  SETBACK_M,
  snapToStep,
  STEP_M,
  TERRACE_PRICE_FACTOR,
} from "./constants.ts";

/** Сторона участка в ячейках по 3 м для заданного числа соток (квадратный участок). */
export function gridSizeForSotki(sotki: number): number {
  const meters = Math.sqrt(sotki * 100); // сторона квадратного участка в метрах
  const cells = Math.round(meters / CELL_M);
  return Math.max(6, Math.min(20, cells));
}

/**
 * Границы зоны застройки, м: дом обязан отступить от забора на SETBACK_M
 * с каждой стороны. minAnchor — самый левый-верхний допустимый якорь,
 * maxAnchor — самый правый-нижний.
 */
export function minAnchor(): number {
  return SETBACK_M;
}

export function maxAnchor(n: number): number {
  return n * CELL_M - MODULE_SIDE_M - SETBACK_M;
}

/** Сторона зоны застройки (участок минус отступы), м. */
export function buildableSide(n: number): number {
  return Math.max(0, n * CELL_M - SETBACK_M * 2);
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
  const min = minAnchor();
  const max = maxAnchor(n);
  return c.x >= min && c.z >= min && c.x <= max && c.z <= max;
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

/* ------------------------------------------------------------------ */
/* Магнитная стыковка                                                  */
/* ------------------------------------------------------------------ */

/** Минимальная длина общей грани, при которой модули считаются состыкованными. */
export const MIN_JOINT_LENGTH_M = 1;
/** Порог магнита по умолчанию, м (в UI пересчитывается из пикселей экрана). */
export const SNAP_THRESHOLD_M = 1.2;
/** Насколько ближе должен быть новый кандидат, чтобы сменить прежний. */
export const SNAP_HYSTERESIS_M = 0.35;

/**
 * Позиции, в которых модуль встаёт вплотную гранью к уже стоящему: между
 * кубиками не остаётся зазора. Смещение вдоль грани кратно шагу установки, но
 * перекрытие не меньше MIN_JOINT_LENGTH_M — «уголком» пристыковаться нельзя.
 */
export function snapAnchors(
  modules: ModuleItem[],
  floor: number,
  n: number,
  ignoreId?: string,
): Cell[] {
  const others = modules.filter((m) => m.id !== ignoreId);
  const anchorsOnFloor = others.filter((m) => m.floor === floor);
  const out: Cell[] = [];
  const seen = new Set<string>();

  const offsets: number[] = [];
  for (
    let o = -(MODULE_SIDE_M - MIN_JOINT_LENGTH_M);
    o <= MODULE_SIDE_M - MIN_JOINT_LENGTH_M;
    o += STEP_M
  ) {
    offsets.push(o);
  }

  const push = (x: number, z: number) => {
    const key = `${x},${z}`;
    if (seen.has(key)) return;
    if (!canPlace(others, { x, z, floor }, n)) return;
    seen.add(key);
    out.push({ x, z });
  };

  for (const m of anchorsOnFloor) {
    for (const o of offsets) {
      push(m.x + MODULE_SIDE_M, m.z + o);
      push(m.x - MODULE_SIDE_M, m.z + o);
      push(m.x + o, m.z + MODULE_SIDE_M);
      push(m.x + o, m.z - MODULE_SIDE_M);
    }
  }
  return out;
}

/**
 * Ближайшая магнитная позиция к «сырой» точке.
 *
 * previous — позиция, выбранная на прошлом кадре: чтобы её сменить, новая
 * должна быть ближе на SNAP_HYSTERESIS_M. Без этого модуль дрожит между двумя
 * равноудалёнными вариантами от микродвижения пальца.
 */
export function pickSnapAnchor(
  anchors: Cell[],
  rawX: number,
  rawZ: number,
  previous?: Cell | null,
  thresholdM: number = SNAP_THRESHOLD_M,
): Cell | null {
  let best: Cell | null = null;
  let bestDist = Infinity;
  for (const c of anchors) {
    const dist = Math.hypot(c.x - rawX, c.z - rawZ);
    if (dist > thresholdM) continue;
    // Ничья разрешается детерминированно — по меньшим координатам.
    if (
      dist < bestDist - 1e-9 ||
      (Math.abs(dist - bestDist) < 1e-9 && best && (c.x - best.x || c.z - best.z) < 0)
    ) {
      bestDist = dist;
      best = c;
    }
  }
  if (!best) return null;
  if (previous && anchors.some((a) => a.x === previous.x && a.z === previous.z)) {
    const prevDist = Math.hypot(previous.x - rawX, previous.z - rawZ);
    if (prevDist <= thresholdM && bestDist > prevDist - SNAP_HYSTERESIS_M) return previous;
  }
  return best;
}

/**
 * Подобрать якорь под точку тапа. Сначала пробуем встать вплотную к соседнему
 * модулю (кубики магнитятся друг к другу), и только если рядом никого нет —
 * ставим по сетке с шагом установки.
 */
export function anchorForPoint(
  modules: ModuleItem[],
  px: number,
  pz: number,
  floor: number,
  n: number,
): Cell | null {
  const max = maxAnchor(n);
  const min = minAnchor();
  const clamp = (v: number) => Math.max(min, Math.min(max, snapToStep(v)));
  const ax = clamp(px - MODULE_SIDE_M / 2);
  const az = clamp(pz - MODULE_SIDE_M / 2);

  // Магнит: ближайшая позиция впритык к существующему дому.
  const snapped = pickSnapAnchor(snapAnchors(modules, floor, n), ax, az, null, MODULE_SIDE_M);
  if (snapped) return snapped;

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

/**
 * Все допустимые позиции (шаг STEP_M) для перемещения модуля id по участку.
 *
 * С шагом 0,5 м позиций вчетверо больше, чем при метровой сетке, поэтому
 * дорогую проверку «не лишим ли опоры соседей» делаем только когда над
 * этажом модуля вообще что-то стоит. В типовом случае (одноэтажный дом или
 * модуль верхнего этажа) хватает быстрой canPlace.
 */
export function validMoveAnchors(modules: ModuleItem[], id: string, n: number): Set<string> {
  const valid = new Set<string>();
  const max = maxAnchor(n);
  const target = modules.find((m) => m.id === id);
  if (!target) return valid;

  const rest = modules.filter((m) => m.id !== id);
  const hasFloorsAbove = rest.some((m) => m.floor > target.floor);

  for (let x = minAnchor(); x <= max; x += STEP_M) {
    for (let z = minAnchor(); z <= max; z += STEP_M) {
      const ok = hasFloorsAbove
        ? isValidMove(modules, id, x, z, n)
        : canPlace(rest, { x, z, floor: target.floor }, n);
      if (ok) valid.add(`${x},${z}`);
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
