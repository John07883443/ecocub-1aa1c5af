/**
 * Бюджет — честная вилка с разбивкой. Никогда не одно число.
 * Ставки — из price-config.ts (сейчас PLACEHOLDER).
 */
import { FINISHES, findFinish } from "../grammar/index.ts";
import type { FinishCategory } from "../grammar/index.ts";
import { MM2_PER_M2, area, footprint } from "./geometry.ts";
import { PRICE_CONFIG, type PriceConfig, type Rate } from "./price-config.ts";
import { modulesOnTier, warmContourM2 } from "./rules.ts";
import type { Project, Range } from "./types.ts";

export type BudgetLineId =
  "modules" | "finishes" | "transport" | "crane-montage" | "foundation" | "terrace" | "options";

export interface BudgetLine {
  id: BudgetLineId;
  label: string;
  min: number;
  max: number;
  /** Как посчитано — человеческим языком. */
  basis: string;
  placeholder: boolean;
}

export interface Budget {
  currency: "RUB";
  lines: BudgetLine[];
  total: Range;
  status: PriceConfig["status"];
  disclaimer: string;
  whatCanChangePrice: string[];
}

const round = (n: number) => Math.round(n / 10_000) * 10_000;
const mul = (r: Range, k: number): Range => ({ min: r.min * k, max: r.max * k });

export interface BudgetOptions {
  foundation?: "piles" | "slab";
  config?: PriceConfig;
}

export function trucksFor(modules: number, cfg: PriceConfig = PRICE_CONFIG): Range {
  return {
    min: Math.ceil(modules / cfg.modulesPerTruck.max),
    max: Math.ceil(modules / cfg.modulesPerTruck.min),
  };
}

/** Грубая вилка по числу модулей — для проверки сценария до сборки дома (терраса 60 %, сваи, без опций). */
export function quickBudgetRange(modules: number, cfg: PriceConfig = PRICE_CONFIG): Range {
  const warm = modules * 10.944;
  const trucks = trucksFor(modules, cfg);
  const built = warm;
  const r = (k: "min" | "max") =>
    warm * cfg.warmContourPerM2[k] +
    trucks[k] * cfg.truckRub[k] +
    modules * cfg.installPerModule[k] +
    cfg.craneRub[k] +
    built * cfg.foundationPerM2.piles[k] +
    0.6 * warm * cfg.terracePerM2[k];
  return { min: round(r("min")), max: round(r("max")) };
}

export function budgetFor(p: Project, opts: BudgetOptions = {}): Budget {
  const cfg = opts.config ?? PRICE_CONFIG;
  const n = p.modules.length;
  const warm = warmContourM2(p);
  const lines: BudgetLine[] = [];
  const add = (id: BudgetLineId, label: string, r: Range, basis: string, rates: Rate[]) =>
    lines.push({
      id,
      label,
      min: round(r.min),
      max: round(r.max),
      basis,
      placeholder: rates.some((x) => x.placeholder),
    });

  add(
    "modules",
    "Модули заводской готовности",
    mul(cfg.warmContourPerM2, warm),
    `${n} модулей × 10,944 м² = ${warm.toFixed(1)} м² × ${cfg.warmContourPerM2.min.toLocaleString("ru-RU")}–${cfg.warmContourPerM2.max.toLocaleString("ru-RU")} ₽/м²`,
    [cfg.warmContourPerM2],
  );

  const cats: FinishCategory[] = ["facade", "roof", "windowFrames", "interior"];
  const fin = cats.reduce(
    (s, c) => {
      const f = findFinish(c, p.finishes[c]);
      return {
        min: s.min + (f?.surchargePerM2.min ?? 0),
        max: s.max + (f?.surchargePerM2.max ?? 0),
      };
    },
    { min: 0, max: 0 },
  );
  add(
    "finishes",
    "Отделка и стиль",
    mul(fin, warm),
    `Надбавки выбранных отделок × ${warm.toFixed(1)} м²`,
    [{ min: 0, max: 0, placeholder: FINISHES.status === "PLACEHOLDER", source: "finishes.json" }],
  );

  const trucks = trucksFor(n, cfg);
  add(
    "transport",
    "Доставка тралами",
    { min: trucks.min * cfg.truckRub.min, max: trucks.max * cfg.truckRub.max },
    `${trucks.min}–${trucks.max} рейсов трала (модулей на трал не подтверждено) × ${cfg.truckRub.min / 1000}–${cfg.truckRub.max / 1000} тыс. ₽`,
    [cfg.modulesPerTruck, cfg.truckRub],
  );

  add(
    "crane-montage",
    "Кран и монтаж",
    {
      min: n * cfg.installPerModule.min + cfg.craneRub.min,
      max: n * cfg.installPerModule.max + cfg.craneRub.max,
    },
    `${n} модулей × монтаж + кран на объект`,
    [cfg.installPerModule, cfg.craneRub],
  );

  const foundation = opts.foundation ?? "piles";
  const built = modulesOnTier(p, 1).reduce((s, m) => s + area(footprint(m)), 0) / MM2_PER_M2;
  add(
    "foundation",
    foundation === "piles" ? "Фундамент: ЖБИ-сваи" : "Фундамент: плита",
    mul(cfg.foundationPerM2[foundation], built),
    `Пятно застройки ${built.toFixed(1)} м²; тип уточняется по геологии`,
    [cfg.foundationPerM2[foundation]],
  );

  add(
    "terrace",
    "Терраса (настил)",
    mul(cfg.terracePerM2, p.terrace.totalM2),
    `${p.terrace.totalM2} м² × ${cfg.terracePerM2.min / 1000}–${cfg.terracePerM2.max / 1000} тыс. ₽/м²`,
    [cfg.terracePerM2],
  );

  const upper = modulesOnTier(p, 2).length;
  const baths = p.rooms.filter((r) => r.type === "wet-core").length;
  const panoramas = p.openings.filter((o) => o.kind === "window" && o.heightMm === 3150).length;
  const opt: Range = { min: 0, max: 0 };
  const optParts: string[] = [];
  const optRates: Rate[] = [];
  if (upper) {
    opt.min += upper * cfg.upperTierPerModule.min + cfg.stairsRub.min;
    opt.max += upper * cfg.upperTierPerModule.max + cfg.stairsRub.max;
    optParts.push(`второй ярус ${upper} мод. и лестница`);
    optRates.push(cfg.upperTierPerModule, cfg.stairsRub);
  }
  if (baths > 1) {
    opt.min += (baths - 1) * cfg.extraBathroomRub.min;
    opt.max += (baths - 1) * cfg.extraBathroomRub.max;
    optParts.push(`санузлов сверх первого: ${baths - 1}`);
    optRates.push(cfg.extraBathroomRub);
  }
  if (panoramas) {
    opt.min += panoramas * cfg.panoramicWindowRub.min;
    opt.max += panoramas * cfg.panoramicWindowRub.max;
    optParts.push(`панорам 3150: ${panoramas}`);
    optRates.push(cfg.panoramicWindowRub);
  }
  add("options", "Опции", opt, optParts.length ? optParts.join(", ") : "Без опций", optRates);

  const total = lines.reduce((s, l) => ({ min: s.min + l.min, max: s.max + l.max }), {
    min: 0,
    max: 0,
  });
  return {
    currency: "RUB",
    lines,
    total,
    status: cfg.status,
    disclaimer:
      cfg.status === "PLACEHOLDER"
        ? "Предварительный расчёт: ставки не подтверждены прайсом 2026. Точную сумму даст проектировщик после проверки проекта."
        : "Расчёт по прайсу; точную сумму даст проектировщик после проверки проекта и участка.",
    whatCanChangePrice: [
      "Прайс 2026: ставка за м² тёплого контура ещё не подтверждена",
      "Сколько модулей везёт один трал и расстояние до участка",
      "Подъезд для трала и крана (дорога от 4,5 м, площадка под кран)",
      "Тип фундамента по геологии участка: сваи или плита",
      "Окончательный выбор отделки фасада, кровли, окон и интерьера",
      ...(upper ? ["Тип лестницы и расчёт свеса второго яруса проектировщиком"] : []),
      "Инженерные сети на участке (электричество, вода, септик) в расчёт не входят",
      "Ширины окон по пролётам каркаса после проверки проектировщиком",
    ],
  };
}
