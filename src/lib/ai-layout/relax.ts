import { MODULE_SIDE_M, STEP_M, snapToStep } from "../constructor/constants.ts";
import { MIN_JOINT_LENGTH_M, isConnected } from "../constructor/geometry.ts";
import type { ModuleItem } from "../constructor/types.ts";
import { DOOR_OPENING, MODULE } from "../standards/ecocub.ts";

/**
 * Разжимание тесных стыков перед генерацией планировки.
 *
 * Задача такая. Человек волен сдвинуть кубик на полметра, и конструктор ему
 * это разрешит: минимальное перекрытие в стыке — метр. Но метр стыка не
 * значит метр прохода. Проём в стене нужно на что-то опереть: с обеих сторон
 * остаётся часть стены модуля, и дверь 800 мм в метровый стык физически не
 * встаёт. Модель в такой планировке либо нарисует дверь сквозь стену, либо
 * оставит комнату без входа — и то и другое выглядит как её ошибка, хотя
 * ошибка в геометрии.
 *
 * Почему правит геометрия, а не модель. Соблазн разрешить модели самой
 * подвинуть стену велик, но контур — единственное, что мы гарантируем: он
 * приходит из конструктора и накладывается поверх результата маской. Модель,
 * которой позволено двигать стены, начнёт двигать их везде, и накладка
 * срежет её работу. Поэтому геометрия правится здесь, до генерации, и
 * детерминированно: контур перерисовывается уже исправленным, накладка снова
 * совпадает с ним до пикселя, а человеку показывается, что именно подвинули.
 *
 * Правка минимальна по построению: перебираются сдвиги от малого к большому,
 * кратные шагу установки, и берётся первый, который открывает проход. Дом
 * при этом обязан остаться связным и не потерять ни одного стыка.
 */

/**
 * Сколько нужно стыка, чтобы в него встала дверь.
 *
 * Дверь 800 плюс по перегородке 190 с каждой стороны — 1180 мм. Округляем
 * вверх до шага установки: 1,5 м. Полтора метра стыка — это гарантия, что
 * дверь встанет и останется место на откосы, а не впритык по нулям.
 */
export const MIN_PASSAGE_M = ceilToStep((DOOR_OPENING.widthMm + 2 * MODULE.wallThicknessMm) / 1000);

/** Дальше этого не двигаем: правка должна остаться правкой, а не пересборкой. */
export const MAX_NUDGE_M = 1;

function ceilToStep(v: number): number {
  return Math.ceil(v / STEP_M) * STEP_M;
}

/** Насколько два модуля перекрываются вдоль общей грани. Ноль — не соседи. */
export function jointOverlapM(a: ModuleItem, b: ModuleItem): number {
  if (a.floor !== b.floor) return 0;
  const n = MODULE_SIDE_M;
  const touchesX = Math.abs(a.x - b.x) === n;
  const touchesZ = Math.abs(a.z - b.z) === n;
  if (touchesX && Math.abs(a.z - b.z) < n) {
    return n - Math.abs(a.z - b.z);
  }
  if (touchesZ && Math.abs(a.x - b.x) < n) {
    return n - Math.abs(a.x - b.x);
  }
  return 0;
}

/** Стык, в который дверь не встаёт. */
export interface TightJoint {
  a: string;
  b: string;
  overlapM: number;
}

export function findTightJoints(modules: ModuleItem[]): TightJoint[] {
  const out: TightJoint[] = [];
  for (let i = 0; i < modules.length; i += 1) {
    for (let j = i + 1; j < modules.length; j += 1) {
      const overlap = jointOverlapM(modules[i], modules[j]);
      if (overlap > 0 && overlap < MIN_PASSAGE_M) {
        out.push({ a: modules[i].id, b: modules[j].id, overlapM: overlap });
      }
    }
  }
  return out;
}

/** Что подвинули и почему — это уходит и в промпт, и человеку в интерфейс. */
export interface Nudge {
  moduleId: string;
  dxM: number;
  dzM: number;
  reason: string;
}

export interface RelaxResult {
  modules: ModuleItem[];
  nudges: Nudge[];
  /** Стыки, которые разжать не удалось: правка есть не всегда. */
  unresolved: TightJoint[];
}

/**
 * Дом остаётся домом: ничего не наложилось, связность цела.
 *
 * Проверка намеренно своя, а не `canPlace` из конструктора: та вдобавок
 * следит за отступом от границ участка, а здесь участка нет вовсе — на вход
 * приходит уже нормализованная геометрия, приведённая к началу координат.
 * Чужая проверка отбраковала бы верные сдвиги по причине, к делу не
 * относящейся.
 */
function overlap(a: ModuleItem, b: ModuleItem): boolean {
  if (a.floor !== b.floor) return false;
  const n = MODULE_SIDE_M;
  return Math.abs(a.x - b.x) < n - 1e-9 && Math.abs(a.z - b.z) < n - 1e-9;
}

function valid(modules: ModuleItem[]): boolean {
  for (let i = 0; i < modules.length; i += 1) {
    for (let j = i + 1; j < modules.length; j += 1) {
      if (overlap(modules[i], modules[j])) return false;
    }
  }
  return isConnected(modules);
}

/** Число стыков — правка не имеет права оторвать модуль от соседа. */
function jointCount(modules: ModuleItem[]): number {
  let n = 0;
  for (let i = 0; i < modules.length; i += 1) {
    for (let j = i + 1; j < modules.length; j += 1) {
      if (jointOverlapM(modules[i], modules[j]) >= MIN_JOINT_LENGTH_M) n += 1;
    }
  }
  return n;
}

/**
 * Разжать тесные стыки минимальным сдвигом.
 *
 * Порядок перебора важен: сначала маленькие сдвиги, потом большие, и первый
 * подошедший принимается. Так правка получается самой скромной из возможных,
 * а не первой попавшейся — человек узнаёт свой дом после исправления.
 */
export function relaxJoints(input: ModuleItem[]): RelaxResult {
  let modules = input.map((m) => ({ ...m }));
  const nudges: Nudge[] = [];
  const baselineJoints = jointCount(modules);

  // Больше одного захода на стык не делаем: если минимальный сдвиг не помог,
  // помогать будет уже перестройка, а это не наше дело.
  for (const joint of findTightJoints(modules)) {
    const fixed = tryFix(modules, joint, baselineJoints);
    if (!fixed) continue;
    modules = fixed.modules;
    nudges.push(fixed.nudge);
  }

  return { modules, nudges, unresolved: findTightJoints(modules) };
}

function tryFix(
  modules: ModuleItem[],
  joint: TightJoint,
  baselineJoints: number,
): { modules: ModuleItem[]; nudge: Nudge } | null {
  const need = MIN_PASSAGE_M - joint.overlapM;
  const steps: number[] = [];
  for (let d = STEP_M; d <= MAX_NUDGE_M + 1e-9; d += STEP_M) steps.push(d, -d);

  // Двигаем тот модуль, у которого меньше соседей: у него меньше шансов
  // испортить чужой стык. При равенстве — второй, чтобы результат не зависел
  // от порядка перечисления.
  const order = [joint.b, joint.a].sort((p, q) => neighbours(modules, p) - neighbours(modules, q));

  for (const id of order) {
    for (const d of steps) {
      if (Math.abs(d) < need - 1e-9) continue;
      for (const axis of ["x", "z"] as const) {
        const next = modules.map((m) =>
          m.id === id ? { ...m, [axis]: snapToStep(m[axis] + d) } : m,
        );
        if (!valid(next)) continue;
        if (jointCount(next) < baselineJoints) continue;
        const still = findTightJoints(next).some(
          (t) => (t.a === joint.a && t.b === joint.b) || (t.a === joint.b && t.b === joint.a),
        );
        if (still) continue;
        return {
          modules: next,
          nudge: {
            moduleId: id,
            dxM: axis === "x" ? d : 0,
            dzM: axis === "z" ? d : 0,
            reason: `стык ${joint.overlapM} м — дверь ${DOOR_OPENING.widthMm} мм не проходит`,
          },
        };
      }
    }
  }
  return null;
}

function neighbours(modules: ModuleItem[], id: string): number {
  const self = modules.find((m) => m.id === id);
  if (!self) return 0;
  return modules.filter((m) => m.id !== id && jointOverlapM(self, m) > 0).length;
}

/** Человеческая формулировка правки — для интерфейса. */
export function describeNudges(nudges: Nudge[]): string {
  if (!nudges.length) return "";
  const word = nudges.length === 1 ? "модуль" : "модуля";
  const max = Math.max(...nudges.map((n) => Math.abs(n.dxM) + Math.abs(n.dzM)));
  return `Для планировки ${nudges.length} ${word} сдвинуты на ${max} м: в исходной раскладке дверь между ними не помещалась.`;
}
