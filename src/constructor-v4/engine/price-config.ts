/**
 * ВНИМАНИЕ: PLACEHOLDER. Все ставки ниже — заглушки до подтверждения владельцем
 * прайса 2026, вместимости трала и типа фундамента. Каждая ставка — вилка
 * (min–max) с источником. Конструктор никогда не показывает одно точное число.
 *
 * Когда владелец подтвердит цифры: заменить значения, поставить placeholder: false,
 * заполнить confirmedBy/confirmedAt. Тест price.test.ts проверит, что вилки не схлопнулись
 * без подтверждения.
 */
import type { Range } from "./types.ts";

export interface Rate extends Range {
  placeholder: boolean;
  source: string;
}

export interface PriceConfig {
  status: "PLACEHOLDER" | "CONFIRMED";
  version: string;
  confirmedBy: string | null;
  confirmedAt: string | null;
  /** Ориентир владельца: ₽/м² всё включено (модули, отделка, доставка, кран, фундамент). */
  benchmarkAllInPerM2: Rate;
  /** Ориентир «тёплый контур без чистовой» для сравнения. */
  benchmarkWarmShellPerM2: Rate;
  /** Чистовая отделка: работы. */
  finishingWorksPerM2: Rate;
  /** Чистовая отделка: материалы (отдельная строка, можно «свои»). */
  finishingMaterialsPerM2: Rate;
  /** ₽ за м² тёплого контура (10,944 м² на модуль). */
  warmContourPerM2: Rate;
  /** ₽ за м² настила террасы. */
  terracePerM2: Rate;
  /** Кубиков на один трал (4 кубика = 2 заводских модуля на трал 18 м). */
  cubesPerTruck: Rate;
  /** ₽ за один рейс трала. */
  truckRub: Rate;
  installPerModule: Rate;
  craneRub: Rate;
  foundationPerM2: { piles: Rate; slab: Rate; "screw-piles": Rate };
  /** Надбавка за модуль второго яруса (усиление, монтаж на высоте). */
  upperTierPerModule: Rate;
  stairsRub: Rate;
  /** Колонна под свесом второго яруса больше 1,5 м. */
  columnRub: Rate;
  /** Каждый санузел сверх первого (сантехника, стояк, вентиляция). */
  extraBathroomRub: Rate;
  /** Каждое панорамное окно 3150 сверх базового остекления. */
  panoramicWindowRub: Rate;
}

/** Значения живут в едином конфиге пилота: src/constructor-v4/pilot.config.ts. */
export { PRICE_DRAFT as PRICE_CONFIG } from "../pilot.config.ts";
