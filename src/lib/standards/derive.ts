import { AREA_POLICY, MODULE } from "./ecocub.ts";
import type { JointKind, Mm, ModuleInstance } from "./types.ts";

/**
 * Расчёты поверх стандарта.
 *
 * Всё, что можно вывести из габаритов модуля, выводится здесь, а не
 * записывается вторым числом рядом. Дублирующее число рано или поздно
 * разойдётся с исходным, и никто не заметит.
 *
 * Внутри считаем в миллиметрах целыми: 3420 / 2 = 1710 точно, а 3,42 / 2 в
 * двоичной плавающей точке — уже нет. Наружу отдаём м² с округлением до
 * сотых, как в экспликации.
 */

function m2(areaMm2: number): number {
  return Math.round(areaMm2 / 1000) / 1000;
}

/** Наружная площадь одного модуля — по ней считается тёплый контур. */
export function moduleFootprintM2(): number {
  return m2(MODULE.externalWidthMm * MODULE.externalDepthMm);
}

/** Площадь помещения внутри одного модуля, если он не поделён перегородками. */
export function moduleClearM2(): number {
  return m2(MODULE.clearWidthMm * MODULE.clearDepthMm);
}

/** Тёплый контур: столько модулей — столько наружных площадей. */
export function warmContourM2(moduleCount: number): number {
  return m2(moduleCount * MODULE.externalWidthMm * MODULE.externalDepthMm);
}

/**
 * Жилая площадь дома по правилу подачи: тёплый контур целиком, округление в
 * большую сторону, террасы сюда не входят — они идут отдельной строкой.
 */
export function livingAreaM2(moduleCount: number): number {
  const exact = warmContourM2(moduleCount);
  return AREA_POLICY.rounding === "up" ? Math.ceil(exact * 10) / 10 : Math.round(exact * 10) / 10;
}

/** Толщина стены в стыке: общая стена — одна, спина к спине — две. */
export function jointThicknessMm(kind: JointKind): Mm {
  return kind === "shared-wall" ? MODULE.wallThicknessMm : MODULE.wallThicknessMm * 2;
}

/**
 * Сколько площади добавляет снос стены в стыке.
 *
 * Помещение, собранное из двух модулей, больше суммы двух модулей ровно на
 * то, что раньше занимала стена между ними.
 */
export function openedJointGainM2(kind: JointKind): number {
  return m2(jointThicknessMm(kind) * MODULE.clearDepthMm);
}

/** Высота модуля должна сходиться из состава: пол + помещение + кровля. */
export function totalHeightMm(): Mm {
  return MODULE.floorSlabMm + MODULE.clearHeightMm + MODULE.roofSlabMm;
}

/** Половина глубины модуля — шаг смещения соседних модулей вдоль стыка. */
export function offsetStepMm(): Mm {
  return MODULE.externalDepthMm / 2;
}

/** Габарит группы модулей по наружным граням. */
export function bounds(modules: ModuleInstance[]): {
  widthMm: Mm;
  depthMm: Mm;
  minXMm: Mm;
  minYMm: Mm;
} {
  const minX = Math.min(...modules.map((m) => m.xMm));
  const minY = Math.min(...modules.map((m) => m.yMm));
  const maxX = Math.max(...modules.map((m) => m.xMm + footprintOf(m).widthMm));
  const maxY = Math.max(...modules.map((m) => m.yMm + footprintOf(m).depthMm));
  return { widthMm: maxX - minX, depthMm: maxY - minY, minXMm: minX, minYMm: minY };
}

/** Габарит модуля с учётом поворота. */
export function footprintOf(module: ModuleInstance): { widthMm: Mm; depthMm: Mm } {
  return module.rotated
    ? { widthMm: MODULE.externalDepthMm, depthMm: MODULE.externalWidthMm }
    : { widthMm: MODULE.externalWidthMm, depthMm: MODULE.externalDepthMm };
}

/**
 * Сходится ли размерная цепочка грани с её габаритом.
 *
 * Проверка дешёвая, но именно она ловит опечатку при переносе числа с листа:
 * пропущенный или лишний отрезок сразу даёт неверную сумму.
 */
export function chainSumMm(chain: Mm[]): Mm {
  return chain.reduce((a, b) => a + b, 0);
}

/**
 * Сверка стандарта с тем, что зашито в боевом конструкторе.
 *
 * Отдельная функция, а не комментарий в документации: расхождение должно быть
 * видно машине. Пока конструктор считает модуль квадратом 3 × 3 м, каждая
 * площадь на сайте занижена примерно на 18 % относительно чертежа, и знать об
 * этом надо не из чужой памяти.
 */
export interface ConformanceItem {
  what: string;
  standard: number;
  constructor: number;
  unit: string;
  matches: boolean;
  impact: string;
}

export function conformance(constructorConstants: {
  moduleSideM: number;
  moduleHeightM: number;
  moduleAreaM2: number;
  stepM: number;
}): ConformanceItem[] {
  const items: ConformanceItem[] = [
    {
      what: "Ширина модуля",
      standard: MODULE.externalWidthMm / 1000,
      constructor: constructorConstants.moduleSideM,
      unit: "м",
      matches: MODULE.externalWidthMm / 1000 === constructorConstants.moduleSideM,
      impact: "Дом на сайте короче настоящего на 200 мм на каждый модуль по этой оси",
    },
    {
      what: "Глубина модуля",
      standard: MODULE.externalDepthMm / 1000,
      constructor: constructorConstants.moduleSideM,
      unit: "м",
      matches: MODULE.externalDepthMm / 1000 === constructorConstants.moduleSideM,
      impact:
        "Модуль в конструкторе квадратный, в чертеже — прямоугольный: ориентация модуля на плане ничего не меняет, хотя должна",
    },
    {
      what: "Площадь модуля снаружи",
      standard: moduleFootprintM2(),
      constructor: constructorConstants.moduleAreaM2,
      unit: "м²",
      matches: moduleFootprintM2() === constructorConstants.moduleAreaM2,
      impact: "Тёплый контур и цена по м² занижены: 9,00 вместо 10,94 — на 17,7 %",
    },
    {
      what: "Высота помещения",
      standard: MODULE.clearHeightMm / 1000,
      constructor: constructorConstants.moduleHeightM,
      unit: "м",
      matches: MODULE.clearHeightMm / 1000 === constructorConstants.moduleHeightM,
      impact: "Совпадает: 3,15 м — единственная продуктовая константа, которая на сайте верна",
    },
    {
      what: "Шаг смещения модуля",
      standard: offsetStepMm() / 1000,
      constructor: constructorConstants.stepM,
      unit: "м",
      matches: offsetStepMm() / 1000 === constructorConstants.stepM,
      impact:
        "В проекте смещение ровно на половину глубины (1,71 м); шаг 0,5 м даёт раскладки, которых завод не делает",
    },
  ];
  return items;
}
