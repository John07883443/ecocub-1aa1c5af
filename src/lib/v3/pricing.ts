/**
 * Единый расчёт стоимости для новой версии конструктора.
 *
 * Единственный подтверждённый прайс в проекте — базовая ставка за м²
 * (site.basePricePerM2) и понижающий коэффициент террасы
 * (TERRACE_PRICE_FACTOR) — ровно те же числа, по которым считает боевой
 * конструктор /constructor. Коэффициентов за этажность, фундамент, доставку
 * и остекление в данных проекта нет, поэтому они здесь НЕ выдумываются:
 * вместо них — честный диапазон неопределённости и дисклеймер.
 */

import { site } from "../site.ts";
import { MODULE_AREA, ROLES, TERRACE_PRICE_FACTOR } from "../constructor/constants.ts";
import type { ModuleItem } from "../constructor/types.ts";
import type { PriceEstimate } from "./types.ts";

/** Версия прайса: дата фиксации + база. Меняется вместе со ставкой. */
export const PRICE_VERSION = `base-${site.basePricePerM2}-2026-08`;

/** Верхняя граница диапазона: +15 % — тот же запас, что показывает квиз. */
const UNCERTAINTY_UP = 1.15;

export const PRICE_DISCLAIMER =
  "Предварительная стоимость по базовой площади. Фундамент, доставка, монтаж и выбранные опции уточняются после проверки проекта и участка.";

/** Оценка по площадям (жилая — полная ставка, терраса — понижающая). */
export function estimateByAreas(heatedAreaM2: number, terraceAreaM2: number): PriceEstimate {
  const price = Math.round(
    heatedAreaM2 * site.basePricePerM2 + terraceAreaM2 * site.basePricePerM2 * TERRACE_PRICE_FACTOR,
  );
  return {
    price,
    min: price,
    max: Math.round(price * UNCERTAINTY_UP),
    priceVersion: PRICE_VERSION,
    disclaimer: PRICE_DISCLAIMER,
  };
}

/** Разложить набор модулей на жилую площадь и террасы. */
export function areasOfModules(modules: Pick<ModuleItem, "role">[]): {
  heatedAreaM2: number;
  terraceAreaM2: number;
} {
  let heated = 0;
  let terrace = 0;
  for (const m of modules) {
    if (ROLES[m.role].heated) heated += MODULE_AREA;
    else terrace += MODULE_AREA;
  }
  return { heatedAreaM2: heated, terraceAreaM2: terrace };
}

/** Оценка конфигурации из модулей — то, чем живёт редактор. */
export function estimateModules(modules: Pick<ModuleItem, "role">[]): PriceEstimate {
  const { heatedAreaM2, terraceAreaM2 } = areasOfModules(modules);
  return estimateByAreas(heatedAreaM2, terraceAreaM2);
}

/**
 * Оценка планировки из библиотеки. Если у плана есть подтверждённая цена
 * из карточки проекта — она главная, расчётная лишь дополняет диапазон.
 */
export function estimatePlan(
  heatedAreaM2: number,
  terraceAreaM2: number,
  confirmedPriceFrom?: number,
): PriceEstimate {
  const computed = estimateByAreas(heatedAreaM2, terraceAreaM2);
  if (!confirmedPriceFrom) return computed;
  return {
    ...computed,
    price: confirmedPriceFrom,
    min: Math.min(confirmedPriceFrom, computed.min),
    max: Math.max(Math.round(confirmedPriceFrom * UNCERTAINTY_UP), computed.max),
  };
}
