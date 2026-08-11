import { BASE_MODULE } from "./catalog.ts";
import { defOf, footprintOf, rectOf } from "./geometry.ts";
import type { Mm, ModuleInstance } from "./types.ts";

/**
 * Привязка модулей при перетаскивании.
 *
 * Свободно двигать заводское изделие бессмысленно: на площадке оно встаёт
 * либо вплотную к соседу, либо в общую стену с ним. Поэтому редактор не
 * «округляет до сетки», а предлагает конечный список физически возможных
 * положений — и человек попадает в них мышью, не набирая координаты руками.
 *
 * Шаг вдоль стыка выбирается проектировщиком. По умолчанию — половина
 * глубины модуля, 1710 мм: именно так смещены B и C относительно A и D в
 * Weekend One, и это правило зафиксировано в стандарте (half-depth-offset).
 * Более мелкий шаг нужен, когда чертёж показывает другое смещение.
 */

/** Варианты шага смещения вдоль стыка, мм. */
export const SNAP_STEPS: { value: Mm; label: string; note: string }[] = [
  {
    value: BASE_MODULE.externalDepthMm / 2,
    label: "1710 — половина глубины",
    note: "Смещение соседних модулей в Weekend One. Правило half-depth-offset из стандарта.",
  },
  {
    value: BASE_MODULE.externalWidthMm / 2,
    label: "1600 — половина ширины",
    note: "Смещение на половину короткой стороны модуля.",
  },
  { value: 500, label: "500", note: "Мелкий шаг для нестандартных смещений с чертежа." },
  { value: 100, label: "100", note: "Самый мелкий шаг. Требует сверки с чертежом." },
];

/** Минимальное перекрытие граней, при котором стык считается стыком. */
export const MIN_JOINT_MM: Mm = 1000;

export interface SnapAnchor {
  x: Mm;
  y: Mm;
  /** Как модуль встаёт к соседу: вплотную двумя стенами или в общую стену. */
  joint: "back-to-back" | "shared-wall";
  anchorId: string;
}

/**
 * Смещения вдоль линии стыка.
 *
 * Отсчёт ведётся ОТ НУЛЯ в обе стороны, и это не мелочь. Раньше цикл начинался
 * от дальнего края (`-(длина - MIN_JOINT_MM)`) и шёл с шагом 1710: получалось
 * −2420, −710, 1000 — ровной стыковки в списке не было вовсе, и модули всегда
 * вставали ступенькой. Собрать простой прямоугольный дом было невозможно.
 *
 * Ноль и выравнивание по дальним краям добавляются всегда, независимо от шага:
 * это два положения, которые нужны в любом доме, и терять их из-за того, что
 * они не попали на сетку выбранного шага, нельзя.
 */
function jointOffsets(movingLenMm: Mm, anchorLenMm: Mm, stepMm: Mm): Mm[] {
  const min = -(movingLenMm - MIN_JOINT_MM);
  const max = anchorLenMm - MIN_JOINT_MM;

  // 0 — края совпали в начале, разница длин — совпали в конце. У одинаковых
  // модулей это одно и то же положение, у разных — два законных варианта.
  const out = new Set<Mm>([0, anchorLenMm - movingLenMm]);
  for (let o = stepMm; o <= max; o += stepMm) out.add(Math.round(o));
  for (let o = -stepMm; o >= min; o -= stepMm) out.add(Math.round(o));

  return [...out].filter((o) => o >= min && o <= max).sort((a, b) => a - b);
}

/**
 * Все положения, в которых модуль встаёт к уже стоящим без зазора.
 *
 * Возвращаются оба вида стыка. Общая стена — это наложение ровно на толщину
 * стены: два модуля отливаются в один объём, и стена между ними одна. Именно
 * так собрана кухня-гостиная Weekend One.
 */
export function snapAnchors(
  modules: ModuleInstance[],
  moving: ModuleInstance,
  stepMm: Mm,
): SnapAnchor[] {
  const wall = defOf(moving).wallThicknessMm;
  const f = footprintOf(moving);
  const out: SnapAnchor[] = [];
  const seen = new Set<string>();

  const push = (x: Mm, y: Mm, joint: SnapAnchor["joint"], anchorId: string) => {
    const key = `${x},${y}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ x, y, joint, anchorId });
  };

  for (const other of modules) {
    if (other.id === moving.id || other.floor !== moving.floor) continue;
    const r = rectOf(other);

    // Смещения вдоль линии стыка: ноль, выравнивание по краям и шаги в обе
    // стороны, пока перекрытие граней остаётся осмысленным.
    const offsetsY = jointOffsets(f.depthMm, r.h, stepMm);
    const offsetsX = jointOffsets(f.widthMm, r.w, stepMm);

    for (const o of offsetsY) {
      push(r.x + r.w, r.y + o, "back-to-back", other.id);
      push(r.x - f.widthMm, r.y + o, "back-to-back", other.id);
      push(r.x + r.w - wall, r.y + o, "shared-wall", other.id);
      push(r.x - f.widthMm + wall, r.y + o, "shared-wall", other.id);
    }
    for (const o of offsetsX) {
      push(r.x + o, r.y + r.h, "back-to-back", other.id);
      push(r.x + o, r.y - f.depthMm, "back-to-back", other.id);
      push(r.x + o, r.y + r.h - wall, "shared-wall", other.id);
      push(r.x + o, r.y - f.depthMm + wall, "shared-wall", other.id);
    }

    // Модуль верхнего этажа встаёт над нижним: те же положения плюс точное
    // совпадение габарита — самый частый случай на двухэтажных домах.
    if (moving.floor > 0) push(r.x, r.y, "back-to-back", other.id);
  }

  // Модуль второго этажа может встать над любым модулем этажа ниже.
  if (moving.floor > 0) {
    for (const below of modules) {
      if (below.floor !== moving.floor - 1) continue;
      const r = rectOf(below);
      push(r.x, r.y, "back-to-back", below.id);
    }
  }

  /*
    Отбрасываем положения, в которых модуль налезает на чужой объём.

    Каждое положение считается относительно ОДНОГО соседа и про остальных не
    знает. Поэтому среди предложенных оказывались точки, где модуль честно
    стыкуется с левым соседом — и ровно наполовину влезает в тех двоих, что
    стоят справа. Магнит тянул именно туда, потому что точка была ближе всех
    к курсору, и человек получал наложение вместо стыка.

    Наложение ровно на толщину стены не пересечение, а общая стена: два модуля
    отлиты в один объём. Поэтому порог — «толще стены хотя бы по одной оси»,
    а не «пересекается вообще».
  */
  const wallLimit = defOf(moving).wallThicknessMm;
  return out.filter((a) => {
    const candidate = { x: a.x, y: a.y, w: f.widthMm, h: f.depthMm };
    for (const other of modules) {
      if (other.id === moving.id || other.floor !== moving.floor) continue;
      const r = rectOf(other);
      const ox = Math.min(candidate.x + candidate.w, r.x + r.w) - Math.max(candidate.x, r.x);
      const oy = Math.min(candidate.y + candidate.h, r.y + r.h) - Math.max(candidate.y, r.y);
      if (ox > wallLimit && oy > wallLimit) return false;
    }
    return true;
  });
}

/** Ближайшая привязка к «сырой» точке, если она в пределах порога. */
export function pickAnchor(
  anchors: SnapAnchor[],
  rawX: Mm,
  rawY: Mm,
  thresholdMm: Mm,
): SnapAnchor | null {
  let best: SnapAnchor | null = null;
  let bestDist = Infinity;
  for (const a of anchors) {
    const dist = Math.hypot(a.x - rawX, a.y - rawY);
    if (dist > thresholdMm || dist >= bestDist) continue;
    bestDist = dist;
    best = a;
  }
  return best;
}

/** Округление до шага — когда рядом нет ни одного модуля. */
export function snapToStep(value: Mm, stepMm: Mm): Mm {
  return Math.round(value / stepMm) * stepMm;
}
