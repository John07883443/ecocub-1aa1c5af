/**
 * Контур дома для AI-планировки.
 *
 * Источник истины — не картинка от модели, а геометрия конструктора
 * (src/lib/constructor). Здесь она приводится к виду, пригодному и для
 * отрисовки исходника, и для промпта: габариты, площадь, наружные стены
 * первого этажа и положение входа.
 *
 * Единицы: метры в модели, миллиметры в запросе к провайдеру — так проще
 * говорить с моделью о реальных размерах и не путать масштаб.
 */

import { MODULE_AREA, MODULE_SIDE_M } from "../constructor/constants.ts";
import type { ModuleItem } from "../constructor/types.ts";

export interface Segment {
  x1: number;
  z1: number;
  x2: number;
  z2: number;
}

export interface Footprint {
  /** Наружные стены этажа — объединение граней без общих участков. */
  walls: Segment[];
  /** Швы между состыкованными модулями (тонкая сетка на исходнике). */
  seams: Segment[];
  /** Модули этажа, нормализованные к нулю контура. */
  modules: Array<{ id: string; x: number; z: number; side: number }>;
  widthM: number;
  depthM: number;
  areaM2: number;
  moduleCount: number;
  floors: number;
}

type Interval = { from: number; to: number };

function subtract(base: Interval, cuts: Interval[]): Interval[] {
  let parts: Interval[] = [base];
  for (const cut of cuts) {
    const next: Interval[] = [];
    for (const p of parts) {
      if (cut.to <= p.from + 1e-9 || cut.from >= p.to - 1e-9) {
        next.push(p);
        continue;
      }
      if (cut.from > p.from + 1e-9) next.push({ from: p.from, to: cut.from });
      if (cut.to < p.to - 1e-9) next.push({ from: cut.to, to: p.to });
    }
    parts = next.filter((p) => p.to - p.from > 1e-9);
  }
  return parts;
}

/**
 * Собрать контур первого этажа: координаты нормализуются так, чтобы левый
 * верхний угол габарита оказался в нуле — экспорт не зависит от того, в каком
 * месте участка пользователь собрал дом.
 */
export function buildFootprint(modules: ModuleItem[]): Footprint {
  const ground = modules.filter((m) => m.floor === 0);
  if (!ground.length) {
    return {
      walls: [],
      seams: [],
      modules: [],
      widthM: 0,
      depthM: 0,
      areaM2: 0,
      moduleCount: 0,
      floors: 0,
    };
  }

  const minX = Math.min(...ground.map((m) => m.x));
  const minZ = Math.min(...ground.map((m) => m.z));
  const local = ground
    .map((m) => ({ id: m.id, x: m.x - minX, z: m.z - minZ, side: MODULE_SIDE_M }))
    // Порядок фиксируем: экспорт должен быть детерминированным.
    .sort((a, b) => a.z - b.z || a.x - b.x);

  const walls: Segment[] = [];
  const seams: Segment[] = [];
  const S = MODULE_SIDE_M;

  for (const m of local) {
    const rest = local.filter((o) => o.id !== m.id);

    for (const [atX, isLeft] of [
      [m.x, true],
      [m.x + S, false],
    ] as const) {
      const cuts: Interval[] = [];
      for (const o of rest) {
        const touches = isLeft ? Math.abs(o.x + S - m.x) < 1e-9 : Math.abs(o.x - (m.x + S)) < 1e-9;
        if (!touches) continue;
        const from = Math.max(m.z, o.z);
        const to = Math.min(m.z + S, o.z + S);
        if (to > from) cuts.push({ from, to });
      }
      for (const part of subtract({ from: m.z, to: m.z + S }, cuts)) {
        walls.push({ x1: atX, z1: part.from, x2: atX, z2: part.to });
      }
      if (!isLeft) for (const c of cuts) seams.push({ x1: atX, z1: c.from, x2: atX, z2: c.to });
    }

    for (const [atZ, isTop] of [
      [m.z, true],
      [m.z + S, false],
    ] as const) {
      const cuts: Interval[] = [];
      for (const o of rest) {
        const touches = isTop ? Math.abs(o.z + S - m.z) < 1e-9 : Math.abs(o.z - (m.z + S)) < 1e-9;
        if (!touches) continue;
        const from = Math.max(m.x, o.x);
        const to = Math.min(m.x + S, o.x + S);
        if (to > from) cuts.push({ from, to });
      }
      for (const part of subtract({ from: m.x, to: m.x + S }, cuts)) {
        walls.push({ x1: part.from, z1: atZ, x2: part.to, z2: atZ });
      }
      if (!isTop) for (const c of cuts) seams.push({ x1: c.from, z1: atZ, x2: c.to, z2: atZ });
    }
  }

  const width = Math.max(...local.map((m) => m.x + S));
  const depth = Math.max(...local.map((m) => m.z + S));
  const floors = Math.max(...modules.map((m) => m.floor)) + 1;

  return {
    // Куски соседних граней склеиваем: контур должен состоять из сплошных
    // стен, иначе «самая длинная стена» упрётся в ширину одного модуля.
    walls: mergeCollinear(walls),
    seams: mergeCollinear(seams),
    modules: local,
    widthM: width,
    depthM: depth,
    areaM2: ground.length * MODULE_AREA,
    moduleCount: modules.length,
    floors,
  };
}

/**
 * Слить сонаправленные отрезки, лежащие на одной прямой и касающиеся концами.
 * Внешний контур собирается по граням модулей, поэтому одна физическая стена
 * приходит несколькими кусками — для промпта и входа нужна цельная стена.
 */
function mergeCollinear(segments: Segment[]): Segment[] {
  const vertical = segments.filter((s) => Math.abs(s.x1 - s.x2) < 1e-9);
  const horizontal = segments.filter((s) => Math.abs(s.z1 - s.z2) < 1e-9);
  const out: Segment[] = [];

  for (const group of groupBy(vertical, (s) => s.x1)) {
    const sorted = group
      .map((s) => ({ from: Math.min(s.z1, s.z2), to: Math.max(s.z1, s.z2) }))
      .sort((a, b) => a.from - b.from);
    for (const part of joinTouching(sorted)) {
      out.push({ x1: group[0].x1, z1: part.from, x2: group[0].x1, z2: part.to });
    }
  }
  for (const group of groupBy(horizontal, (s) => s.z1)) {
    const sorted = group
      .map((s) => ({ from: Math.min(s.x1, s.x2), to: Math.max(s.x1, s.x2) }))
      .sort((a, b) => a.from - b.from);
    for (const part of joinTouching(sorted)) {
      out.push({ x1: part.from, z1: group[0].z1, x2: part.to, z2: group[0].z1 });
    }
  }
  return out.sort(cmpSeg);
}

function groupBy(segments: Segment[], key: (s: Segment) => number): Segment[][] {
  const map = new Map<number, Segment[]>();
  for (const s of segments) {
    const k = Math.round(key(s) * 1e6) / 1e6;
    const list = map.get(k);
    if (list) list.push(s);
    else map.set(k, [s]);
  }
  return [...map.values()];
}

function joinTouching(parts: Interval[]): Interval[] {
  const out: Interval[] = [];
  for (const p of parts) {
    const last = out[out.length - 1];
    if (last && p.from <= last.to + 1e-9) last.to = Math.max(last.to, p.to);
    else out.push({ ...p });
  }
  return out;
}

function cmpSeg(a: Segment, b: Segment): number {
  return a.x1 - b.x1 || a.z1 - b.z1 || a.x2 - b.x2 || a.z2 - b.z2;
}

/** Сторона контура, у которой располагается главный вход. */
export type EntranceSide = "north" | "east" | "south" | "west";

export const ENTRANCE_LABELS: Record<EntranceSide, string> = {
  north: "северной",
  east: "восточной",
  south: "южной",
  west: "западной",
};

/**
 * Точка входа на контуре: середина самой длинной наружной стены выбранной
 * стороны. Если такой стены нет, вход не рисуется — модель не должна
 * додумывать его положение по подсказке, которой нет на исходнике.
 */
export function entrancePoint(
  footprint: Footprint,
  side: EntranceSide,
): { x: number; z: number; axis: "x" | "z"; widthM: number } | null {
  const isVertical = side === "west" || side === "east";
  const target = isVertical
    ? side === "west"
      ? 0
      : footprint.widthM
    : side === "north"
      ? 0
      : footprint.depthM;

  const candidates = footprint.walls.filter((w) =>
    isVertical
      ? Math.abs(w.x1 - w.x2) < 1e-9 && Math.abs(w.x1 - target) < 1e-9
      : Math.abs(w.z1 - w.z2) < 1e-9 && Math.abs(w.z1 - target) < 1e-9,
  );
  if (!candidates.length) return null;

  const longest = candidates.reduce((a, b) => (segLength(b) > segLength(a) ? b : a));
  const widthM = Math.min(1.2, segLength(longest) - 0.6);
  if (widthM <= 0.4) return null;

  return isVertical
    ? { x: longest.x1, z: (longest.z1 + longest.z2) / 2, axis: "x", widthM }
    : { x: (longest.x1 + longest.x2) / 2, z: longest.z1, axis: "z", widthM };
}

function segLength(s: Segment): number {
  return Math.hypot(s.x2 - s.x1, s.z2 - s.z1);
}

/* ------------------------------------------------------------------ */
/* Проекция контура в кадр                                             */
/* ------------------------------------------------------------------ */

/** Поля вокруг дома, доля от стороны изображения. */
export const PADDING_RATIO = 0.08;

/**
 * Сторона квадратного кадра. Живёт здесь, а не в модуле отрисовки: то же
 * значение нужно интерфейсу для наложения контура, а тянуть в браузер
 * серверный рендерер с zlib ради одной константы незачем.
 */
export const FOOTPRINT_IMAGE_SIZE = 1024;

export interface FootprintProjection {
  /** Пикселей на метр. */
  scale: number;
  offsetX: number;
  offsetZ: number;
  size: number;
}

/**
 * Как контур ложится в квадратный кадр: масштаб по большей стороне, поля
 * одинаковые со всех сторон, пропорции сохранены.
 *
 * Функция общая для серверного рендера исходника и для наложения контура
 * поверх результата в интерфейсе. Держать её в одном месте обязательно: если
 * две реализации разойдутся хоть на пиксель, наложенный контур перестанет
 * совпадать с домом на картинке, и вся затея потеряет смысл.
 */
export function projectFootprint(footprint: Footprint, size: number): FootprintProjection {
  const usable = size - size * PADDING_RATIO * 2;
  const span = Math.max(footprint.widthM, footprint.depthM, 1);
  const scale = usable / span;
  return {
    scale,
    offsetX: (size - footprint.widthM * scale) / 2,
    offsetZ: (size - footprint.depthM * scale) / 2,
    size,
  };
}
