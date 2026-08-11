import { livingAreaM2, warmContourM2 } from "../standards/derive.ts";
import { BASE_MODULE, findModuleDefinition, type ModuleDefinition } from "./catalog.ts";
import type {
  FaceId,
  HouseMetrics,
  HouseModel,
  Mm,
  ModuleInstance,
  OpeningInstance,
} from "./types.ts";
import { FACE_IDS } from "./types.ts";

/**
 * Геометрия канонической модели. Всё в целых миллиметрах.
 *
 * Здесь нет ни одного числа: габариты приходят из справочника модулей, а он —
 * из стандарта. Файл отвечает только за преобразования: где физически лежит
 * повёрнутый модуль, где проходит его грань, что с чем пересекается и какие
 * характеристики из этого следуют.
 *
 * Система координат плана: X вправо, Y вверх (как на чертеже, а не как на
 * экране). Перевод в экранные координаты делает SVG-компонент, и только он.
 */

/** Шаг привязки по умолчанию — половина глубины модуля, 1710 мм. */
export const HALF_DEPTH_MM: Mm = BASE_MODULE.externalDepthMm / 2;

/** Мелкий шаг ручной привязки, мм. Кратен и 3200, и 3420 не бывает — берём 10. */
export const FINE_STEP_MM: Mm = 10;

export function defOf(m: ModuleInstance): ModuleDefinition {
  return findModuleDefinition(m.moduleTypeId) ?? BASE_MODULE;
}

/** Габарит модуля в плане с учётом поворота. */
export function footprintOf(m: ModuleInstance): { widthMm: Mm; depthMm: Mm } {
  const d = defOf(m);
  const swapped = m.rotationDeg === 90 || m.rotationDeg === 270;
  return swapped
    ? { widthMm: d.externalDepthMm, depthMm: d.externalWidthMm }
    : { widthMm: d.externalWidthMm, depthMm: d.externalDepthMm };
}

/** Прямоугольник, занимаемый модулем в плане. */
export interface Rect {
  x: Mm;
  y: Mm;
  w: Mm;
  h: Mm;
}

export function rectOf(m: ModuleInstance): Rect {
  const f = footprintOf(m);
  return { x: m.positionMm.x, y: m.positionMm.y, w: f.widthMm, h: f.depthMm };
}

/**
 * Локальная точка модуля в мировые координаты.
 *
 * Порядок преобразований важен и выбран так, чтобы `positionMm` всегда
 * оставался левым нижним углом описанного прямоугольника — независимо от
 * поворота. Иначе при повороте модуль «прыгал» бы, а проектировщик не мог бы
 * ввести координату, которую видит на чертеже.
 *
 * Отражение выполняется первым, в локальных осях, относительно середины
 * ширины модуля. Физически это переворот изделия: проём, стоявший на Р-2,
 * оказывается там, где была Р-4, — что и должно происходить с зеркальным
 * модулем.
 */
export function localToWorld(m: ModuleInstance, p: { x: Mm; y: Mm }): { x: Mm; y: Mm } {
  const d = defOf(m);
  const W = d.externalWidthMm;
  const D = d.externalDepthMm;

  const lx = m.mirrored ? W - p.x : p.x;
  const ly = p.y;

  let rx: number;
  let ry: number;
  switch (m.rotationDeg) {
    case 90:
      rx = D - ly;
      ry = lx;
      break;
    case 180:
      rx = W - lx;
      ry = D - ly;
      break;
    case 270:
      rx = ly;
      ry = W - lx;
      break;
    default:
      rx = lx;
      ry = ly;
  }
  return { x: m.positionMm.x + rx, y: m.positionMm.y + ry };
}

/**
 * Грань модуля в локальных осях: начало, конец и длина.
 *
 * Обход контура против часовой стрелки, Р-1 → Р-2 → Р-3 → Р-4. Смещение
 * проёма отсчитывается от начала грани — так же, как размерная цепочка на
 * развёртке читается слева направо.
 */
export function localFace(
  d: ModuleDefinition,
  faceId: FaceId,
): { from: { x: Mm; y: Mm }; to: { x: Mm; y: Mm }; spanMm: Mm } {
  const W = d.externalWidthMm;
  const D = d.externalDepthMm;
  switch (faceId) {
    case "Р-1":
      return { from: { x: 0, y: 0 }, to: { x: W, y: 0 }, spanMm: W };
    case "Р-2":
      return { from: { x: W, y: 0 }, to: { x: W, y: D }, spanMm: D };
    case "Р-3":
      return { from: { x: W, y: D }, to: { x: 0, y: D }, spanMm: W };
    case "Р-4":
      return { from: { x: 0, y: D }, to: { x: 0, y: 0 }, spanMm: D };
  }
}

/** Грань модуля в мировых координатах. */
export function worldFace(
  m: ModuleInstance,
  faceId: FaceId,
): { from: { x: Mm; y: Mm }; to: { x: Mm; y: Mm }; spanMm: Mm } {
  const f = localFace(defOf(m), faceId);
  return { from: localToWorld(m, f.from), to: localToWorld(m, f.to), spanMm: f.spanMm };
}

/** Отрезок проёма на грани в мировых координатах. */
export function openingSegment(
  m: ModuleInstance,
  o: OpeningInstance,
): { from: { x: Mm; y: Mm }; to: { x: Mm; y: Mm } } | null {
  const face = worldFace(m, o.faceId);
  const len = Math.hypot(face.to.x - face.from.x, face.to.y - face.from.y);
  if (!len) return null;
  const ux = (face.to.x - face.from.x) / len;
  const uy = (face.to.y - face.from.y) / len;
  return {
    from: { x: face.from.x + ux * o.offsetMm, y: face.from.y + uy * o.offsetMm },
    to: {
      x: face.from.x + ux * (o.offsetMm + o.widthMm),
      y: face.from.y + uy * (o.offsetMm + o.widthMm),
    },
  };
}

/* ------------------------------------------------------------------ */
/* Пересечения и соседство                                             */
/* ------------------------------------------------------------------ */

/** Площадь пересечения двух прямоугольников, мм². */
export function overlapAreaMm2(a: Rect, b: Rect): number {
  const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return ox > 0 && oy > 0 ? ox * oy : 0;
}

/** Соприкасаются ли модули гранью (перекрытие вдоль общей линии больше нуля). */
export function touching(a: ModuleInstance, b: ModuleInstance): boolean {
  if (a.floor !== b.floor) return false;
  const ra = rectOf(a);
  const rb = rectOf(b);
  const overlapX = Math.min(ra.x + ra.w, rb.x + rb.w) - Math.max(ra.x, rb.x);
  const overlapY = Math.min(ra.y + ra.h, rb.y + rb.h) - Math.max(ra.y, rb.y);
  const gapX = Math.max(ra.x, rb.x) - Math.min(ra.x + ra.w, rb.x + rb.w);
  const gapY = Math.max(ra.y, rb.y) - Math.min(ra.y + ra.h, rb.y + rb.h);
  if (gapX === 0 && overlapY > 0) return true;
  if (gapY === 0 && overlapX > 0) return true;
  return false;
}

/**
 * Делят ли модули одну стену.
 *
 * Общая стена выглядит как наложение прямоугольников ровно на толщину стены:
 * модули отлиты в один объём, и стена между ними одна, а не две. Это не
 * пересечение и не ошибка — это второй законный вид стыка (см. `PLANNING_RULES`,
 * правило two-joint-kinds).
 */
export function sharesWall(a: ModuleInstance, b: ModuleInstance): boolean {
  if (a.floor !== b.floor) return false;
  const ra = rectOf(a);
  const rb = rectOf(b);
  const overlapX = Math.min(ra.x + ra.w, rb.x + rb.w) - Math.max(ra.x, rb.x);
  const overlapY = Math.min(ra.y + ra.h, rb.y + rb.h) - Math.max(ra.y, rb.y);
  if (overlapX <= 0 || overlapY <= 0) return false;
  return Math.min(overlapX, overlapY) === defOf(a).wallThicknessMm;
}

/** Соседи по этажу: стык спина к спине или общая стена. */
export function adjacentOnFloor(a: ModuleInstance, b: ModuleInstance): boolean {
  return touching(a, b) || sharesWall(a, b);
}

/**
 * Зазор между двумя модулями одного этажа, мм.
 *
 * Возвращает 0 для соприкасающихся и `null`, если модули не стоят друг
 * напротив друга (тогда «зазор» между ними — не конструктивная величина,
 * а расстояние по диагонали, и говорить о нём нечего).
 */
export function gapBetween(a: ModuleInstance, b: ModuleInstance): Mm | null {
  if (a.floor !== b.floor) return null;
  const ra = rectOf(a);
  const rb = rectOf(b);
  const overlapX = Math.min(ra.x + ra.w, rb.x + rb.w) - Math.max(ra.x, rb.x);
  const overlapY = Math.min(ra.y + ra.h, rb.y + rb.h) - Math.max(ra.y, rb.y);
  const gapX = Math.max(ra.x, rb.x) - Math.min(ra.x + ra.w, rb.x + rb.w);
  const gapY = Math.max(ra.y, rb.y) - Math.min(ra.y + ra.h, rb.y + rb.h);
  if (overlapY > 0 && gapX >= 0) return gapX;
  if (overlapX > 0 && gapY >= 0) return gapY;
  return null;
}

/** Площадь опоры модуля на этаж ниже, мм². */
export function supportAreaMm2(m: ModuleInstance, all: ModuleInstance[]): number {
  if (m.floor === 0) return Infinity;
  const r = rectOf(m);
  let area = 0;
  for (const other of all) {
    if (other.id === m.id || other.floor !== m.floor - 1) continue;
    area += overlapAreaMm2(r, rectOf(other));
  }
  return area;
}

/** Единое ли здание: связь гранью на этаже или опорой между этажами. */
export function isSingleBuilding(modules: ModuleInstance[]): boolean {
  if (modules.length < 2) return true;
  const linked = (a: ModuleInstance, b: ModuleInstance) =>
    adjacentOnFloor(a, b) ||
    (Math.abs(a.floor - b.floor) === 1 && overlapAreaMm2(rectOf(a), rectOf(b)) > 0);

  const seen = new Set<string>([modules[0].id]);
  const stack = [modules[0]];
  while (stack.length) {
    const cur = stack.pop()!;
    for (const m of modules) {
      if (seen.has(m.id) || !linked(cur, m)) continue;
      seen.add(m.id);
      stack.push(m);
    }
  }
  return seen.size === modules.length;
}

/* ------------------------------------------------------------------ */
/* Отметки                                                             */
/* ------------------------------------------------------------------ */

/**
 * Отметка чистого пола этажа относительно чистого пола первого, мм.
 * Этаж выше стоит на полной высоте изделия: пол + помещение + кровля.
 */
export function floorLevelMm(floor: number, d: ModuleDefinition = BASE_MODULE): Mm {
  return floor * d.totalHeightMm;
}

/** Отметка чистого пола конкретного модуля с учётом ручной поправки. */
export function moduleLevelMm(m: ModuleInstance): Mm {
  return floorLevelMm(m.floor, defOf(m)) + (m.elevationOffsetMm ?? 0);
}

/* ------------------------------------------------------------------ */
/* Характеристики                                                      */
/* ------------------------------------------------------------------ */

/** Габарит дома по наружным граням всех этажей. */
export function boundsOf(modules: ModuleInstance[]): {
  minX: Mm;
  minY: Mm;
  widthMm: Mm;
  depthMm: Mm;
} {
  if (!modules.length) return { minX: 0, minY: 0, widthMm: 0, depthMm: 0 };
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const m of modules) {
    const r = rectOf(m);
    minX = Math.min(minX, r.x);
    minY = Math.min(minY, r.y);
    maxX = Math.max(maxX, r.x + r.w);
    maxY = Math.max(maxY, r.y + r.h);
  }
  return { minX, minY, widthMm: maxX - minX, depthMm: maxY - minY };
}

function m2(areaMm2: number): number {
  return Math.round(areaMm2 / 1000) / 1000;
}

/**
 * Характеристики дома. Все — из геометрии.
 *
 * Жилая площадь считается по правилу подачи EcoCub (`AREA_POLICY`): тёплый
 * контур целиком, округление вверх, террасы отдельной строкой. Тот же расчёт
 * используется в стандарте, поэтому карточка каталога и разбор реального
 * проекта не могут разойтись.
 */
export function computeMetrics(model: HouseModel): HouseMetrics {
  const modules = model.modules;
  const floors = modules.length ? Math.max(...modules.map((m) => m.floor)) + 1 : 0;

  let footprintMm2 = 0;
  for (const m of modules) {
    if (m.floor !== 0) continue;
    const r = rectOf(m);
    footprintMm2 += r.w * r.h;
  }

  const openings = { windows: 0, doors: 0, panoramic: 0, passages: 0 };
  for (const o of model.openings) {
    if (o.kind === "window") openings.windows += 1;
    else if (o.kind === "door") openings.doors += 1;
    else if (o.kind === "panoramic") openings.panoramic += 1;
    else openings.passages += 1;
  }

  const b = boundsOf(modules);
  const d = BASE_MODULE;
  // От чистого пола первого этажа до верха плиты кровли верхнего:
  // на каждый этаж ниже верхнего — полная высота изделия, на верхний —
  // помещение и плита кровли (пол верхнего уже учтён предыдущим этажом).
  const heightMm = floors > 0 ? (floors - 1) * d.totalHeightMm + d.clearHeightMm + d.roofSlabMm : 0;

  return {
    moduleCount: modules.length,
    floors,
    warmAreaM2: warmContourM2(modules.length),
    livingAreaM2: livingAreaM2(modules.length),
    footprintAreaM2: m2(footprintMm2),
    boundsMm: { widthMm: b.widthMm, depthMm: b.depthMm },
    heightMm,
    openings,
  };
}

/* ------------------------------------------------------------------ */
/* Стыки                                                               */
/* ------------------------------------------------------------------ */

export interface JointInfo {
  a: string;
  b: string;
  /** Общая стена (модули отлиты в одну) или спина к спине (две стены). */
  kind: "shared-wall" | "back-to-back";
  /** Длина общей грани, мм. */
  lengthMm: Mm;
}

/**
 * Стыки модулей одного этажа.
 *
 * Различить два вида стыка по одной геометрии нельзя: и общая стена, и
 * «спина к спине» дают соприкосновение прямоугольников. Признак берётся из
 * расстояния между осями — если модули стоят вплотную, это спина к спине
 * (420 мм стены), а общая стена означает наложение на толщину стены, то есть
 * второй модуль заходит на 210 мм. Так стык и определяется.
 */
export function jointsOf(modules: ModuleInstance[]): JointInfo[] {
  const out: JointInfo[] = [];
  for (let i = 0; i < modules.length; i += 1) {
    for (let j = i + 1; j < modules.length; j += 1) {
      const a = modules[i];
      const b = modules[j];
      if (a.floor !== b.floor) continue;
      const ra = rectOf(a);
      const rb = rectOf(b);
      const overlapX = Math.min(ra.x + ra.w, rb.x + rb.w) - Math.max(ra.x, rb.x);
      const overlapY = Math.min(ra.y + ra.h, rb.y + rb.h) - Math.max(ra.y, rb.y);
      const wall = defOf(a).wallThicknessMm;

      // Спина к спине: касание без наложения.
      if (touching(a, b)) {
        const lengthMm = overlapX > 0 ? overlapX : overlapY;
        out.push({ a: a.id, b: b.id, kind: "back-to-back", lengthMm });
        continue;
      }
      // Общая стена: наложение ровно на толщину стены по одной оси.
      if (overlapX > 0 && overlapY > 0) {
        const thin = Math.min(overlapX, overlapY);
        if (thin === wall) {
          out.push({
            a: a.id,
            b: b.id,
            kind: "shared-wall",
            lengthMm: Math.max(overlapX, overlapY),
          });
        }
      }
    }
  }
  return out;
}

export { FACE_IDS };
