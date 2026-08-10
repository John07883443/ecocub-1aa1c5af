/**
 * Чистая доменная геометрия v3.1: без DOM, без React.
 *
 * Отвечает за то, чтобы модули были секциями одного дома, а не карточками:
 * магнитная стыковка гранью в грань, соседство, связность этажа, единый
 * внешний контур и стены. Всё считается из координат модели; визуальные
 * отступы и цвета источником истины не являются.
 */

import {
  MIN_JOINT_LENGTH_M,
  MIN_SUPPORT_AREA_M2,
  MODULE_SIDE_M,
  SNAP_HYSTERESIS_M,
  SNAP_THRESHOLD_M,
  STEP_M,
} from "./constants.ts";
import type { ModuleAdjacency, ModuleFootprint, WallSegment } from "./types.ts";

export interface Rect {
  x: number;
  z: number;
  w: number;
  d: number;
}

export const moduleRect = (m: Pick<ModuleFootprint, "x" | "z">): Rect => ({
  x: m.x,
  z: m.z,
  w: MODULE_SIDE_M,
  d: MODULE_SIDE_M,
});

/** Площадь пересечения двух прямоугольников. */
export function overlapArea(a: Rect, b: Rect): number {
  const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const oz = Math.min(a.z + a.d, b.z + b.d) - Math.max(a.z, b.z);
  return ox > 0 && oz > 0 ? ox * oz : 0;
}

export function rectsIntersect(a: Rect, b: Rect): boolean {
  return overlapArea(a, b) > 1e-9;
}

/** Площадь опоры модуля на этаж ниже. */
export function supportArea(
  candidate: Pick<ModuleFootprint, "x" | "z" | "floor">,
  modules: ModuleFootprint[],
): number {
  let area = 0;
  for (const m of modules) {
    if (m.floor !== candidate.floor - 1) continue;
    area += overlapArea(moduleRect(candidate), moduleRect(m));
  }
  return area;
}

/** Можно ли поставить модуль: без наложений и с опорой для верхних этажей. */
export function canPlace(
  modules: ModuleFootprint[],
  candidate: Pick<ModuleFootprint, "x" | "z" | "floor">,
  ignoreId?: string,
): boolean {
  for (const m of modules) {
    if (m.id === ignoreId) continue;
    if (m.floor === candidate.floor && rectsIntersect(moduleRect(candidate), moduleRect(m))) {
      return false;
    }
  }
  if (candidate.floor > 0) {
    const rest = ignoreId ? modules.filter((m) => m.id !== ignoreId) : modules;
    if (supportArea(candidate, rest) < MIN_SUPPORT_AREA_M2 - 1e-9) return false;
  }
  return true;
}

/* ------------------------------------------------------------------ */
/* Соседство и связность                                               */
/* ------------------------------------------------------------------ */

/**
 * Пары модулей с общей гранью. Касание углами соединением НЕ считается:
 * длина соприкосновения должна быть не меньше MIN_JOINT_LENGTH_M.
 */
export function computeAdjacency(modules: ModuleFootprint[]): ModuleAdjacency[] {
  const out: ModuleAdjacency[] = [];
  for (let i = 0; i < modules.length; i += 1) {
    for (let j = i + 1; j < modules.length; j += 1) {
      const a = modules[i];
      const b = modules[j];
      if (a.floor !== b.floor) continue;

      // Вертикальная общая грань: правая сторона одного совпала с левой другого.
      const shareX =
        Math.abs(a.x + MODULE_SIDE_M - b.x) < 1e-9
          ? a.x + MODULE_SIDE_M
          : Math.abs(b.x + MODULE_SIDE_M - a.x) < 1e-9
            ? b.x + MODULE_SIDE_M
            : null;
      if (shareX !== null) {
        const from = Math.max(a.z, b.z);
        const to = Math.min(a.z + MODULE_SIDE_M, b.z + MODULE_SIDE_M);
        if (to - from >= MIN_JOINT_LENGTH_M - 1e-9) {
          out.push({ aId: a.id, bId: b.id, floor: a.floor, axis: "x", at: shareX, from, to });
        }
        continue;
      }

      const shareZ =
        Math.abs(a.z + MODULE_SIDE_M - b.z) < 1e-9
          ? a.z + MODULE_SIDE_M
          : Math.abs(b.z + MODULE_SIDE_M - a.z) < 1e-9
            ? b.z + MODULE_SIDE_M
            : null;
      if (shareZ !== null) {
        const from = Math.max(a.x, b.x);
        const to = Math.min(a.x + MODULE_SIDE_M, b.x + MODULE_SIDE_M);
        if (to - from >= MIN_JOINT_LENGTH_M - 1e-9) {
          out.push({ aId: a.id, bId: b.id, floor: a.floor, axis: "z", at: shareZ, from, to });
        }
      }
    }
  }
  return out;
}

export const jointKey = (aId: string, bId: string) => [aId, bId].sort().join("~");

/** Связны ли все модули этажа по общим граням (обход в ширину). */
export function isFloorConnected(modules: ModuleFootprint[], floor: number): boolean {
  const onFloor = modules.filter((m) => m.floor === floor);
  if (onFloor.length <= 1) return true;
  const adj = computeAdjacency(onFloor);
  const graph = new Map<string, string[]>();
  for (const m of onFloor) graph.set(m.id, []);
  for (const a of adj) {
    graph.get(a.aId)?.push(a.bId);
    graph.get(a.bId)?.push(a.aId);
  }
  const seen = new Set<string>([onFloor[0].id]);
  const queue = [onFloor[0].id];
  while (queue.length) {
    const id = queue.shift()!;
    for (const next of graph.get(id) ?? []) {
      if (seen.has(next)) continue;
      seen.add(next);
      queue.push(next);
    }
  }
  return seen.size === onFloor.length;
}

/** Все этажи дома связны и верхние опираются на нижние. */
export function houseIssues(modules: ModuleFootprint[]): string[] {
  const issues: string[] = [];
  const floors = Array.from(new Set(modules.map((m) => m.floor))).sort((a, b) => a - b);
  for (const f of floors) {
    if (!isFloorConnected(modules, f)) {
      issues.push(
        f === 0
          ? "Модули первого этажа не соединены в один дом"
          : `Модули ${f + 1}-го этажа не соединены между собой`,
      );
    }
  }
  for (const m of modules) {
    if (m.floor > 0 && supportArea(m, modules) < MIN_SUPPORT_AREA_M2 - 1e-9) {
      issues.push(`Модуль на ${m.floor + 1}-м этаже остался без достаточной опоры`);
      break;
    }
  }
  return issues;
}

/** Модули верхних этажей, потерявшие опору, — каскадом. */
export function dropUnsupported(modules: ModuleFootprint[]): ModuleFootprint[] {
  let kept = modules;
  for (;;) {
    const orphans = kept.filter(
      (m) => m.floor > 0 && supportArea(m, kept) < MIN_SUPPORT_AREA_M2 - 1e-9,
    );
    if (!orphans.length) return kept;
    const ids = new Set(orphans.map((o) => o.id));
    kept = kept.filter((m) => !ids.has(m.id));
  }
}

/* ------------------------------------------------------------------ */
/* Магнитная стыковка                                                  */
/* ------------------------------------------------------------------ */

export interface SnapCandidate {
  x: number;
  z: number;
  /** Модуль, к которому пристыковались, и сторона стыка. */
  toId: string;
  side: "left" | "right" | "top" | "bottom";
  distance: number;
}

/**
 * Кандидаты стыковки: позиции, где новый модуль встаёт вплотную гранью
 * к существующему. Смещение вдоль грани кратно шагу, перекрытие — не меньше
 * MIN_JOINT_LENGTH_M, поэтому «уголком» пристыковаться нельзя.
 */
export function snapCandidates(
  modules: ModuleFootprint[],
  floor: number,
  ignoreId?: string,
): SnapCandidate[] {
  const out: SnapCandidate[] = [];
  const seen = new Set<string>();
  const others = modules.filter((m) => m.id !== ignoreId);
  const anchors = others.filter((m) => m.floor === floor);
  const offsets: number[] = [];
  for (
    let o = -(MODULE_SIDE_M - MIN_JOINT_LENGTH_M);
    o <= MODULE_SIDE_M - MIN_JOINT_LENGTH_M;
    o += STEP_M
  ) {
    offsets.push(o);
  }

  const push = (x: number, z: number, toId: string, side: SnapCandidate["side"]) => {
    const key = `${x},${z}`;
    if (seen.has(key)) return;
    if (!canPlace(others, { x, z, floor }, ignoreId)) return;
    seen.add(key);
    out.push({ x, z, toId, side, distance: 0 });
  };

  for (const m of anchors) {
    for (const o of offsets) {
      push(m.x + MODULE_SIDE_M, m.z + o, m.id, "right");
      push(m.x - MODULE_SIDE_M, m.z + o, m.id, "left");
      push(m.x + o, m.z + MODULE_SIDE_M, m.id, "bottom");
      push(m.x + o, m.z - MODULE_SIDE_M, m.id, "top");
    }
  }
  return out;
}

/**
 * Ближайший кандидат к «сырой» позиции указателя.
 *
 * previous — кандидат, выбранный на прошлом кадре: чтобы его сменить, новый
 * должен быть ближе на SNAP_HYSTERESIS_M. Без этого модуль дрожит между двумя
 * равноудалёнными позициями при микродвижении пальца.
 */
export function pickSnap(
  candidates: SnapCandidate[],
  rawX: number,
  rawZ: number,
  previous?: SnapCandidate | null,
  thresholdM: number = SNAP_THRESHOLD_M,
): SnapCandidate | null {
  let best: SnapCandidate | null = null;
  let bestDist = Infinity;
  for (const c of candidates) {
    const dist = Math.hypot(c.x - rawX, c.z - rawZ);
    if (dist > thresholdM) continue;
    // Детерминированный разрыв ничьей: меньшая координата выигрывает.
    if (dist < bestDist - 1e-9 || (Math.abs(dist - bestDist) < 1e-9 && best && cmp(c, best) < 0)) {
      bestDist = dist;
      best = { ...c, distance: dist };
    }
  }
  if (!best) return null;
  if (previous) {
    const prevStill = candidates.find((c) => c.x === previous.x && c.z === previous.z);
    if (prevStill) {
      const prevDist = Math.hypot(previous.x - rawX, previous.z - rawZ);
      if (prevDist <= thresholdM && bestDist > prevDist - SNAP_HYSTERESIS_M) {
        return { ...previous, distance: prevDist };
      }
    }
  }
  return best;
}

function cmp(a: SnapCandidate, b: SnapCandidate): number {
  return a.x - b.x || a.z - b.z;
}

/* ------------------------------------------------------------------ */
/* Внешний контур и стены                                              */
/* ------------------------------------------------------------------ */

type Interval = { from: number; to: number };

/** Вычесть из отрезка перекрытые куски — остаётся то, что снаружи. */
function subtract(base: Interval, cuts: Interval[]): Interval[] {
  let parts: Interval[] = [base];
  for (const cut of cuts) {
    const next: Interval[] = [];
    for (const p of parts) {
      if (cut.to <= p.from + 1e-9 || cut.from >= p.to - 1e-9) {
        next.push(p);
        continue;
      }
      if (cut.from > p.from + 1e-9) next.push({ from: p.from, to: Math.max(p.from, cut.from) });
      if (cut.to < p.to - 1e-9) next.push({ from: Math.min(p.to, cut.to), to: p.to });
    }
    parts = next.filter((p) => p.to - p.from > 1e-9);
  }
  return parts;
}

/**
 * Стены этажа. Наружная стена — только та часть грани модуля, которую не
 * закрывает сосед; общая грань двух модулей даёт ОДНУ внутреннюю стену,
 * а не две наложенные наружные.
 */
export function computeWalls(modules: ModuleFootprint[], floor: number): WallSegment[] {
  const onFloor = modules.filter((m) => m.floor === floor);
  const walls: WallSegment[] = [];

  for (const m of onFloor) {
    const neighbours = onFloor.filter((o) => o.id !== m.id);

    // Левая и правая стороны (вертикальные грани).
    for (const [side, atX] of [
      ["left", m.x],
      ["right", m.x + MODULE_SIDE_M],
    ] as const) {
      const cuts: Interval[] = [];
      for (const o of neighbours) {
        const touches =
          side === "left"
            ? Math.abs(o.x + MODULE_SIDE_M - m.x) < 1e-9
            : Math.abs(o.x - (m.x + MODULE_SIDE_M)) < 1e-9;
        if (!touches) continue;
        const from = Math.max(m.z, o.z);
        const to = Math.min(m.z + MODULE_SIDE_M, o.z + MODULE_SIDE_M);
        if (to > from) cuts.push({ from, to });
      }
      for (const part of subtract({ from: m.z, to: m.z + MODULE_SIDE_M }, cuts)) {
        walls.push({ x1: atX, z1: part.from, x2: atX, z2: part.to, kind: "exterior" });
      }
    }

    // Верхняя и нижняя стороны (горизонтальные грани).
    for (const [side, atZ] of [
      ["top", m.z],
      ["bottom", m.z + MODULE_SIDE_M],
    ] as const) {
      const cuts: Interval[] = [];
      for (const o of neighbours) {
        const touches =
          side === "top"
            ? Math.abs(o.z + MODULE_SIDE_M - m.z) < 1e-9
            : Math.abs(o.z - (m.z + MODULE_SIDE_M)) < 1e-9;
        if (!touches) continue;
        const from = Math.max(m.x, o.x);
        const to = Math.min(m.x + MODULE_SIDE_M, o.x + MODULE_SIDE_M);
        if (to > from) cuts.push({ from, to });
      }
      for (const part of subtract({ from: m.x, to: m.x + MODULE_SIDE_M }, cuts)) {
        walls.push({ x1: part.from, z1: atZ, x2: part.to, z2: atZ, kind: "exterior" });
      }
    }
  }

  return walls;
}

/** Габарит этажа (или всего дома при floor = undefined). */
export function bounds(
  modules: ModuleFootprint[],
  floor?: number,
): { minX: number; minZ: number; maxX: number; maxZ: number; w: number; d: number } {
  const list = floor === undefined ? modules : modules.filter((m) => m.floor === floor);
  if (!list.length) return { minX: 0, minZ: 0, maxX: 0, maxZ: 0, w: 0, d: 0 };
  const minX = Math.min(...list.map((m) => m.x));
  const minZ = Math.min(...list.map((m) => m.z));
  const maxX = Math.max(...list.map((m) => m.x + MODULE_SIDE_M));
  const maxZ = Math.max(...list.map((m) => m.z + MODULE_SIDE_M));
  return { minX, minZ, maxX, maxZ, w: maxX - minX, d: maxZ - minZ };
}

/**
 * Ближайшее свободное место, пристыкованное к дому, для нового модуля.
 * Пользователю не нужно ловить пиксели: панель ставит модуль сама.
 */
export function bestAttachSpot(
  modules: ModuleFootprint[],
  floor: number,
): { x: number; z: number } | null {
  const onFloor = modules.filter((m) => m.floor === floor);
  if (!onFloor.length) {
    if (floor === 0) return { x: 0, z: 0 };
    // Верхний этаж начинается над центром нижнего.
    const below = modules.filter((m) => m.floor === floor - 1);
    if (!below.length) return null;
    for (const m of below) {
      if (canPlace(modules, { x: m.x, z: m.z, floor })) return { x: m.x, z: m.z };
    }
    return null;
  }

  const b = bounds(modules, floor);
  const cx = (b.minX + b.maxX) / 2;
  const cz = (b.minZ + b.maxZ) / 2;
  const candidates = snapCandidates(modules, floor);
  if (!candidates.length) return null;

  // Компактность важнее близости к центру: берём позицию, дающую наименьший
  // габарит этажа, а при равенстве — ближайшую к центру масс.
  let best = candidates[0];
  let bestScore = Infinity;
  for (const c of candidates) {
    const nb = bounds([...modules, { id: "__tmp", floor, x: c.x, z: c.z, roomId: "" }], floor);
    const score =
      nb.w + nb.d + Math.hypot(c.x + MODULE_SIDE_M / 2 - cx, c.z + MODULE_SIDE_M / 2 - cz) / 100;
    if (score < bestScore - 1e-9) {
      bestScore = score;
      best = c;
    }
  }
  return { x: best.x, z: best.z };
}
