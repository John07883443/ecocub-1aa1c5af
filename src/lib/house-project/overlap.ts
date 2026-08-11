// .ts в относительных импортах — чтобы доменные тесты гонялись через
// `node --experimental-strip-types --test`, как остальная логика проекта.
import { defOf, rectOf } from "./geometry.ts";
import type { ModuleInstance } from "./types.ts";

/**
 * Пересечение модулей: чего в доме быть не может.
 *
 * Модуль — заводское изделие, отлитый объём. Два объёма не занимают одно
 * место, поэтому наложение в модели описывает дом, который нельзя построить.
 * Раньше редактор такое допускал и лишь помечал предупреждением — но
 * предупреждение о невозможном не помогает: его либо не замечают, либо
 * замечают, когда поверх наложения собрана половина проекта.
 *
 * Граница. Наложение ровно на толщину стены — не пересечение, а общая стена:
 * модули отлиты в один объём, и стена между ними одна. Это второй законный
 * вид стыка (правило two-joint-kinds стандарта), и запрещать его нельзя.
 * Поэтому проверка смотрит на МЕНЬШУЮ сторону пересечения: 210 мм — стык,
 * 211 мм — уже наложение.
 */

/** Ключ пары модулей, не зависящий от порядка. */
function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

/** Накладываются ли два модуля объёмами. Общая стена не считается. */
export function modulesOverlap(a: ModuleInstance, b: ModuleInstance): boolean {
  if (a.floor !== b.floor) return false;
  const ra = rectOf(a);
  const rb = rectOf(b);
  const ox = Math.min(ra.x + ra.w, rb.x + rb.w) - Math.max(ra.x, rb.x);
  const oy = Math.min(ra.y + ra.h, rb.y + rb.h) - Math.max(ra.y, rb.y);
  if (ox <= 0 || oy <= 0) return false;
  // Толщина стены берётся у типа: у изделия другого типоразмера она своя.
  const wall = Math.max(defOf(a).wallThicknessMm, defOf(b).wallThicknessMm);
  return Math.min(ox, oy) > wall;
}

/** Все накладывающиеся пары. Ключ пары не зависит от порядка модулей. */
export function overlapPairs(modules: ModuleInstance[]): Set<string> {
  const out = new Set<string>();
  for (let i = 0; i < modules.length; i++) {
    for (let j = i + 1; j < modules.length; j++) {
      if (modulesOverlap(modules[i], modules[j])) out.add(pairKey(modules[i].id, modules[j].id));
    }
  }
  return out;
}

/**
 * Появились ли НОВЫЕ наложения.
 *
 * Сравнение с прежним состоянием, а не проверка «есть ли наложения вообще».
 * Иначе проект, в котором наложение уже лежит — из старой записи или из
 * импортированного JSON, — оказался бы заперт: любое действие отклонялось бы,
 * в том числе то, которым наложение чинят.
 */
export function newOverlaps(before: ModuleInstance[], after: ModuleInstance[]): string[] {
  const had = overlapPairs(before);
  return [...overlapPairs(after)].filter((key) => !had.has(key));
}

/** Накладывается ли модуль на кого-то из уже стоящих. */
export function overlapsAny(candidate: ModuleInstance, modules: ModuleInstance[]): boolean {
  return modules.some((m) => m.id !== candidate.id && modulesOverlap(candidate, m));
}

/**
 * Свободное место рядом для копии модуля.
 *
 * Дублирование кладёт копию рядом с оригиналом, и «рядом» почти всегда занято
 * соседом. Отклонять дублирование в этом случае значило бы требовать от
 * человека сначала расчистить место — вместо этого копия обходит соседей по
 * кругу и встаёт в первое свободное положение.
 */
export function freeSpotNear(
  candidate: ModuleInstance,
  modules: ModuleInstance[],
): { x: number; y: number } | null {
  const r = rectOf(candidate);
  const steps: { x: number; y: number }[] = [];
  for (let ring = 1; ring <= 4; ring++) {
    steps.push(
      { x: r.w * ring, y: 0 },
      { x: 0, y: r.h * ring },
      { x: -r.w * ring, y: 0 },
      { x: 0, y: -r.h * ring },
      { x: r.w * ring, y: r.h * ring },
      { x: -r.w * ring, y: r.h * ring },
      { x: r.w * ring, y: -r.h * ring },
      { x: -r.w * ring, y: -r.h * ring },
    );
  }
  for (const s of steps) {
    const moved: ModuleInstance = {
      ...candidate,
      positionMm: { x: candidate.positionMm.x + s.x, y: candidate.positionMm.y + s.y },
    };
    if (!overlapsAny(moved, modules)) return moved.positionMm;
  }
  return null;
}
