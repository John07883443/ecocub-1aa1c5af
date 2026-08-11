import { MODULE_SIDE_M } from "../constructor/constants.ts";
import type { ModuleItem } from "../constructor/types.ts";
import { auditModules, errors, type Finding } from "./audit.ts";
import { shapesOfSize, toModules } from "./shapes.ts";
import { houseFromModules } from "./zoning.ts";

/**
 * Прогоны для обучения планировщика.
 *
 * Инварианты ловят то, что можно записать формулой: запертую комнату, разрыв
 * общей зоны, отсутствие входа. Но «планировка выглядит глупо» формулой не
 * записывается — это видит человек. Поэтому здесь готовятся партии планировок,
 * которые владелец размечает вручную: годится или нет и почему.
 *
 * Разметка ценна не сама по себе, а тем, что из неё выводится правило.
 * Забраковали пять домов, где санузел оказался единственным проходом в
 * спальню, — значит нужен инвариант, а не пять поправок. Признаки каждого
 * случая (`features`) сохраняются вместе с вердиктом, чтобы такие совпадения
 * было видно, а не искать их глазами.
 *
 * Партии детерминированы: одно и то же зерно даёт один и тот же набор домов.
 * Иначе сравнивать прогоны между собой было бы не с чем.
 */

export interface TrainingCase {
  /** Устойчивый идентификатор: форма дома, а не порядковый номер в партии. */
  id: string;
  moduleCount: number;
  modules: ModuleItem[];
  /** Что нашли инварианты — человеку показывается вместе с чертежом. */
  findings: Finding[];
  /** Признаки для последующего разбора отметок. */
  features: string[];
}

/** Причины, которыми владелец объясняет отказ. Список закрытый — иначе разбор превращается в чтение свободного текста. */
export const REJECT_REASONS = [
  "rooms",
  "doors",
  "furniture",
  "windows",
  "proportions",
  "other",
] as const;
export type RejectReason = (typeof REJECT_REASONS)[number];

export const REJECT_LABELS: Record<RejectReason, string> = {
  rooms: "Не тот состав помещений",
  doors: "Двери и проходы",
  furniture: "Расстановка мебели",
  windows: "Окна и вход",
  proportions: "Пропорции и размеры",
  other: "Другое",
};

/** Ключ формы: одинаковые дома в разных партиях получают один идентификатор. */
export function shapeId(shape: Array<[number, number]>): string {
  return shape
    .map(([x, z]) => `${x},${z}`)
    .sort()
    .join(";");
}

/**
 * Собрать партию для разметки.
 *
 * Формы берутся из полного перебора, но не подряд: подряд идут почти
 * одинаковые дома, и разметка вырождается в двадцать раз «одно и то же».
 * Шаг выбирается так, чтобы партия равномерно прошла по всему набору форм
 * каждого размера.
 */
export function buildBatch(options: {
  sizes?: number[];
  perSize?: number;
  seed?: number;
}): TrainingCase[] {
  const sizes = options.sizes?.length ? options.sizes : [3, 4, 5, 6, 7, 8];
  // Один этаж и до 22 кубиков: дальше дом перестаёт быть модульным в том
  // смысле, в каком его делает завод, а второй этаж — отдельная задача с
  // лестницей и опиранием.
  const perSize = Math.max(1, Math.min(24, options.perSize ?? 6));
  const seed = options.seed ?? 1;
  const out: TrainingCase[] = [];

  for (const n of sizes) {
    if (n < 2 || n > 22) continue;
    const forms = shapesOfSize(n, Math.max(perSize * 3, 40), seed);
    const step = Math.max(1, Math.floor(forms.length / perSize));
    for (let i = 0; i < perSize; i += 1) {
      const index = (seed * 7 + i * step) % forms.length;
      const shape = forms[index];
      const modules = toModules(shape);
      const id = shapeId(shape);
      if (out.some((c) => c.id === id)) continue;
      out.push({
        id,
        moduleCount: n,
        modules,
        findings: auditModules(modules),
        features: featuresOf(modules),
      });
    }
  }
  return out;
}

/**
 * Признаки дома одной строкой каждый.
 *
 * Нужны для разбора отметок: если во всех забракованных домах встречается
 * `hall` или `bath-in-corner`, правило искать надо там, а не в общем впечатлении.
 */
export function featuresOf(modules: ModuleItem[]): string[] {
  const house = houseFromModules(modules);
  const out = new Set<string>();
  out.add(`modules:${modules.length}`);

  const types = house.rooms.map((r) => r.type);
  for (const t of new Set(types)) out.add(`has:${t}`);
  out.add(`rooms:${house.rooms.length}`);
  out.add(`bedrooms:${types.filter((t) => t === "bedroom").length}`);
  out.add(`bathrooms:${types.filter((t) => t === "bathroom").length}`);

  const xs = modules.map((m) => m.x);
  const zs = modules.map((m) => m.z);
  const w = (Math.max(...xs) - Math.min(...xs)) / MODULE_SIDE_M + 1;
  const d = (Math.max(...zs) - Math.min(...zs)) / MODULE_SIDE_M + 1;
  out.add(`bbox:${Math.max(w, d)}x${Math.min(w, d)}`);
  out.add(modules.length === w * d ? "shape:rect" : "shape:notched");

  // Самый зажатый модуль: у крестообразных форм именно он даёт странности.
  const maxNeighbours = Math.max(
    ...modules.map(
      (m) =>
        modules.filter(
          (o) =>
            o !== m &&
            ((Math.abs(o.x - m.x) === MODULE_SIDE_M && Math.abs(o.z - m.z) < MODULE_SIDE_M) ||
              (Math.abs(o.z - m.z) === MODULE_SIDE_M && Math.abs(o.x - m.x) < MODULE_SIDE_M)),
        ).length,
    ),
  );
  out.add(`crowded:${maxNeighbours}`);
  if (errors(house ? auditModules(modules) : []).length) out.add("audit:failed");

  return [...out].sort();
}

/**
 * Разбор размеченной партии: что общего у забракованного.
 *
 * Считаем не «сколько раз встретился признак», а насколько он смещает долю
 * отказов относительно среднего по партии. Признак, встречающийся у всех
 * подряд, ничего не объясняет, каким бы частым он ни был.
 */
export interface FeatureInsight {
  feature: string;
  rejected: number;
  total: number;
  /** Доля отказов с этим признаком минус доля отказов вообще. */
  lift: number;
}

export function analyze(
  verdicts: Array<{ features: string[]; approved: boolean }>,
): FeatureInsight[] {
  if (!verdicts.length) return [];
  const baseline = verdicts.filter((v) => !v.approved).length / verdicts.length;
  const stats = new Map<string, { rejected: number; total: number }>();
  for (const v of verdicts) {
    for (const f of v.features) {
      const cur = stats.get(f) ?? { rejected: 0, total: 0 };
      cur.total += 1;
      if (!v.approved) cur.rejected += 1;
      stats.set(f, cur);
    }
  }
  return [...stats.entries()]
    .filter(([, s]) => s.total >= 2)
    .map(([feature, s]) => ({
      feature,
      rejected: s.rejected,
      total: s.total,
      lift: Math.round((s.rejected / s.total - baseline) * 100) / 100,
    }))
    .sort((a, b) => b.lift - a.lift || b.total - a.total);
}
