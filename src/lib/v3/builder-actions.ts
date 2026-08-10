/**
 * Крупные действия редактора v3 — чистые функции над списком модулей.
 *
 * Каждое действие проходит через боевой валидатор геометрии (canPlace,
 * dropUnsupported из src/lib/constructor/geometry.ts): недопустимый результат
 * не возвращается никогда — вместо него ошибка с человеческим объяснением.
 * React-обёртка с undo/redo живёт в useV3Builder.ts, здесь только логика.
 */

import { canPlace, dropUnsupported, maxAnchor } from "../constructor/geometry.ts";
import { MAX_FLOORS, MODULE_SIDE_M, ROLES, STEP_M } from "../constructor/constants.ts";
import type { ModuleItem, Role } from "../constructor/types.ts";

export type ActionResult =
  | { ok: true; modules: ModuleItem[]; note: string }
  | { ok: false; error: string };

let counter = 0;
export const nextModuleId = () => `v3m${++counter}`;

/* ------------------------------------------------------------------ */
/* Поиск места для нового модуля                                        */
/* ------------------------------------------------------------------ */

/**
 * Найти допустимую позицию для нового модуля, примыкающую к дому.
 * Обходим позиции по возрастанию расстояния до центра масс, отдавая
 * предпочтение тем, что касаются существующих модулей стороной.
 */
export function findAttachSpot(
  modules: ModuleItem[],
  floor: number,
  n: number,
): { x: number; z: number } | null {
  const max = maxAnchor(n);
  if (!modules.length) {
    const c = Math.round(max / 2);
    return { x: c, z: c };
  }

  const sameFloor = modules.filter((m) => m.floor === floor);
  const anchorsOf = sameFloor.length ? sameFloor : modules.filter((m) => m.floor === floor - 1);
  if (!anchorsOf.length) return null;

  const cx = anchorsOf.reduce((s, m) => s + m.x, 0) / anchorsOf.length;
  const cz = anchorsOf.reduce((s, m) => s + m.z, 0) / anchorsOf.length;

  // Кандидаты: клетки вплотную к каждому существующему модулю (по 4 стороны),
  // затем — их соседи со сдвигом 1 м. Сортировка по близости к центру масс.
  const candidates: { x: number; z: number }[] = [];
  const seen = new Set<string>();
  const push = (x: number, z: number) => {
    if (x < 0 || z < 0 || x > max || z > max) return;
    const key = `${x},${z}`;
    if (seen.has(key)) return;
    seen.add(key);
    candidates.push({ x, z });
  };

  for (const m of anchorsOf) {
    for (const [dx, dz] of [
      [MODULE_SIDE_M, 0],
      [-MODULE_SIDE_M, 0],
      [0, MODULE_SIDE_M],
      [0, -MODULE_SIDE_M],
    ]) {
      push(m.x + dx, m.z + dz);
      // сдвинутые на шаг варианты — если ровное место занято
      push(m.x + dx, m.z + STEP_M);
      push(m.x + dx, m.z - STEP_M);
      push(m.x + STEP_M, m.z + dz);
      push(m.x - STEP_M, m.z + dz);
    }
  }

  candidates.sort((a, b) => Math.hypot(a.x - cx, a.z - cz) - Math.hypot(b.x - cx, b.z - cz));

  for (const c of candidates) {
    if (canPlace(modules, { ...c, floor }, n)) return c;
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Крупные действия                                                     */
/* ------------------------------------------------------------------ */

const ROLE_ACTION_LABEL: Partial<Record<Role, string>> = {
  bedroom: "Спальня добавлена",
  bathroom: "Санузел добавлен",
  living: "Общая зона увеличена",
  terrace: "Терраса добавлена",
  kitchen: "Кухня расширена",
};

/** Добавить модуль роли на этаж floor рядом с домом. */
export function addRoleModule(
  modules: ModuleItem[],
  role: Role,
  floor: number,
  n: number,
  noteOverride?: string,
): ActionResult {
  if (floor >= MAX_FLOORS) {
    return { ok: false, error: `Технология EcoCub — до ${MAX_FLOORS} этажей` };
  }
  const spot = findAttachSpot(modules, floor, n);
  if (!spot) {
    return {
      ok: false,
      error:
        floor > 0
          ? "Наверху нет места с достаточной опорой — сначала расширьте этаж ниже"
          : "На участке не осталось места рядом с домом — увеличьте участок",
    };
  }
  const next = [...modules, { id: nextModuleId(), ...spot, floor, role }];
  return {
    ok: true,
    modules: next,
    note:
      noteOverride ??
      `${ROLE_ACTION_LABEL[role] ?? ROLES[role].label} (+9 м²${ROLES[role].heated ? "" : " террасы"})`,
  };
}

/** Рассмотреть второй этаж: перенести наверх спальню, добавив лестницу. */
export function addSecondFloor(modules: ModuleItem[], n: number): ActionResult {
  const hasUpper = modules.some((m) => m.floor > 0);
  const hasStairs = modules.some((m) => m.role === "stairs");
  let next = [...modules];

  if (!hasStairs) {
    const stairsSpot = findAttachSpot(next, 0, n);
    if (!stairsSpot) return { ok: false, error: "Нет места для лестницы на первом этаже" };
    next = [...next, { id: nextModuleId(), ...stairsSpot, floor: 0, role: "stairs" }];
  }

  const spot = findAttachSpot(next, 1, n);
  if (!spot) {
    return { ok: false, error: "Второму этажу нужна опора — не нашлось допустимой позиции" };
  }
  next = [...next, { id: nextModuleId(), ...spot, floor: 1, role: "bedroom" }];
  return {
    ok: true,
    modules: next,
    note: hasUpper
      ? "Спальня на втором этаже добавлена"
      : `Добавлен второй этаж: лестница${hasStairs ? "" : " (+9 м²)"} и спальня наверху`,
  };
}

/** Зеркально развернуть дом по горизонтали. */
export function mirrorHouse(modules: ModuleItem[], n: number): ActionResult {
  if (!modules.length) return { ok: false, error: "Дом пуст" };
  const minX = Math.min(...modules.map((m) => m.x));
  const maxX = Math.max(...modules.map((m) => m.x + MODULE_SIDE_M));
  const mirrored = modules.map((m) => ({
    ...m,
    x: minX + (maxX - (m.x + MODULE_SIDE_M)),
  }));
  // Зеркало сохраняет пересечения и опоры, но проверяем строго — правило
  // «нельзя вернуть недопустимое состояние» важнее рассуждений о симметрии.
  const sorted = [...mirrored].sort((a, b) => a.floor - b.floor);
  const placed: ModuleItem[] = [];
  for (const m of sorted) {
    if (!canPlace(placed, m, n)) {
      return { ok: false, error: "Зеркальный вариант не помещается на участке" };
    }
    placed.push(m);
  }
  return { ok: true, modules: mirrored, note: "Дом развёрнут зеркально" };
}

/** Убрать последний модуль роли (с каскадом осиротевших верхних). */
export function removeRoleModule(modules: ModuleItem[], role: Role): ActionResult {
  const target = [...modules].reverse().find((m) => m.role === role);
  if (!target) return { ok: false, error: `В доме нет модуля «${ROLES[role].label}»` };
  const rest = modules.filter((m) => m.id !== target.id);
  const kept = dropUnsupported(rest);
  const cascade = rest.length - kept.length;
  return {
    ok: true,
    modules: kept,
    note:
      cascade > 0
        ? `${ROLES[role].label} убрана; вместе с ней ${cascade} модул${cascade === 1 ? "ь" : "я"} наверху остались без опоры`
        : `${ROLES[role].label} убрана (−9 м²)`,
  };
}
