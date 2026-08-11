import { MODULE_SIDE_M, STEP_M } from "../constructor/constants.ts";
import { BASE_MODULE } from "./catalog.ts";
import { boundsOf, footprintOf, rectOf } from "./geometry.ts";
import { createModule } from "./factory.ts";
import type { HouseModel, ModuleInstance } from "./types.ts";

/**
 * Мост между канонической моделью (мм, модуль 3200 × 3420) и публичным
 * конструктором (метры, модуль 3 × 3, шаг 0,5 м).
 *
 * Зачем вообще два представления. Публичный конструктор — клиентская
 * игрушка-прикидка: он должен открываться мгновенно на телефоне и не пугать
 * человека размерными цепочками. CAD Light — рабочий инструмент, где число
 * обязано совпадать с чертежом. Свести их в одно представление можно было бы
 * только подняв конструктор до миллиметров, то есть переписав его целиком, —
 * а он работает и его никто не просил ломать.
 *
 * Что теряется при переводе. Модуль конструктора квадратный, поэтому поворот
 * на 90° в нём неотличим от отсутствия поворота; проёмы, отметки и фундамент
 * в конструкторе не существуют вовсе. Перенос сохраняет то единственное, что
 * в конструкторе есть: количество модулей, их взаимное расположение и
 * этажность. Это честная прикидка, и подаётся она именно так — «копия
 * конфигурации для дальнейшего изменения», а не «тот же дом».
 *
 * Обратное направление (`modelFromConstructor`) — только точка старта для
 * проектировщика: он всё равно введёт точные координаты по чертежу.
 */

/** Шаг сетки конструктора в метрах — сторона модуля. */
const PITCH_M = MODULE_SIDE_M;

function snap(v: number): number {
  return Math.round(v / STEP_M) * STEP_M;
}

export interface ConstructorSeed {
  x: number;
  z: number;
  floor: number;
}

/**
 * Канон → конструктор.
 *
 * Координаты пересчитываются пропорционально по каждой оси: доля габарита
 * модуля по X превращается в такую же долю трёхметровой ячейки. Соседние
 * модули остаются соседними, ступени и вырезы сохраняются, а абсолютный
 * размер меняется — что и ожидаемо, раз изделие в конструкторе другое.
 *
 * Ось Y канона (вверх) переворачивается в ось Z конструктора (вниз по
 * экрану), иначе дом окажется зеркальным относительно чертежа.
 */
export function seedsFromModel(model: HouseModel): ConstructorSeed[] {
  if (!model.modules.length) return [];
  const b = boundsOf(model.modules);
  const maxY = b.minY + b.depthMm;

  return model.modules.map((m) => {
    const r = rectOf(m);
    const xM = ((r.x - b.minX) / BASE_MODULE.externalWidthMm) * PITCH_M;
    // Верхняя грань модуля в канонических осях становится верхом на экране.
    const zM = ((maxY - (r.y + r.h)) / BASE_MODULE.externalDepthMm) * PITCH_M;
    return { x: snap(xM), z: snap(zM), floor: m.floor };
  });
}

/**
 * Конструктор → канон.
 *
 * Обратный пересчёт с тем же коэффициентом. Полученные координаты кратны
 * миллиметру, но не обязаны попадать на шаг стыковки модулей: сетка 0,5 м в
 * метрах не переводится в целое число шагов по 3200/3420. Поэтому результат
 * прогоняется через `snapModulesToGrid` — он ставит модули вплотную, как
 * они и стояли в конструкторе.
 */
export function modelFromConstructor(
  seeds: ConstructorSeed[],
): Pick<HouseModel, "modules"> & { modules: ModuleInstance[] } {
  if (!seeds.length) return { modules: [] };
  const maxZ = Math.max(...seeds.map((s) => s.z));

  const modules = seeds.map((s) => {
    const xMm = Math.round((s.x / PITCH_M) * BASE_MODULE.externalWidthMm);
    // Разворот оси обратно: нижний край экрана — начало координат чертежа.
    const yMm = Math.round(((maxZ - s.z) / PITCH_M) * BASE_MODULE.externalDepthMm);
    return createModule(xMm, yMm, s.floor);
  });

  return { modules: snapModulesToGrid(modules) };
}

/**
 * Подтянуть модули к сетке заводского габарита.
 *
 * Берём левый нижний модуль за начало отсчёта и округляем остальные до
 * кратности габариту по каждой оси. Это ровно то, что делает монтажник:
 * модули стыкуются гранями, промежуточных положений у них нет.
 */
export function snapModulesToGrid(modules: ModuleInstance[]): ModuleInstance[] {
  if (!modules.length) return modules;
  const b = boundsOf(modules);
  return modules.map((m) => {
    const f = footprintOf(m);
    const stepX = f.widthMm;
    const stepY = f.depthMm;
    return {
      ...m,
      positionMm: {
        x: b.minX + Math.round((m.positionMm.x - b.minX) / stepX) * stepX,
        y: b.minY + Math.round((m.positionMm.y - b.minY) / stepY) * stepY,
      },
    };
  });
}

/**
 * Сдвинуть дом так, чтобы его левый нижний угол оказался в начале координат.
 * Проекты приходят с разными смещениями (у одного 0, у другого 12 590),
 * и без нормализации сравнивать их габариты неудобно.
 */
export function normalizeToOrigin(modules: ModuleInstance[]): ModuleInstance[] {
  if (!modules.length) return modules;
  const b = boundsOf(modules);
  if (b.minX === 0 && b.minY === 0) return modules;
  return modules.map((m) => ({
    ...m,
    positionMm: { x: m.positionMm.x - b.minX, y: m.positionMm.y - b.minY },
  }));
}
