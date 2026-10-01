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
  foundationPerM2: { piles: Rate; slab: Rate };
  /** Надбавка за модуль второго яруса (усиление, монтаж на высоте). */
  upperTierPerModule: Rate;
  stairsRub: Rate;
  /** Каждый санузел сверх первого (сантехника, стояк, вентиляция). */
  extraBathroomRub: Rate;
  /** Каждое панорамное окно 3150 сверх базового остекления. */
  panoramicWindowRub: Rate;
}

export const PRICE_CONFIG: PriceConfig = {
  status: "PLACEHOLDER",
  version: "2026-draft-01.10",
  confirmedBy: null,
  confirmedAt: null,
  warmContourPerM2: {
    min: 80_000,
    max: 105_000,
    placeholder: true,
    source: "Каталог 80–100 тыс., сайт 105 тыс. (ECONOMICS.md п. 14)",
  },
  terracePerM2: {
    min: 25_000,
    max: 42_000,
    placeholder: true,
    source: "Коэффициент 0,3–0,4 от ставки дома — допущение",
  },
  cubesPerTruck: {
    min: 4,
    max: 4,
    placeholder: false,
    source: "Владелец 01.10.2026: трал 18 м везёт 4 кубика = 2 модуля; тралы 21 и 24 м — опция",
  },
  truckRub: {
    min: 300_000,
    max: 400_000,
    placeholder: true,
    source: "Договор и сметы: 300–400 тыс. за трал",
  },
  installPerModule: {
    min: 8_000,
    max: 142_857,
    placeholder: true,
    source: "Смета 8 000 против договора 142 857 — расходятся",
  },
  craneRub: {
    min: 165_000,
    max: 250_000,
    placeholder: true,
    source: "Факт 165 тыс. на объект; кран 25–55 т",
  },
  foundationPerM2: {
    piles: {
      min: 4_000,
      max: 9_000,
      placeholder: true,
      source: "ЖБИ-сваи — ставка не подтверждена",
    },
    slab: { min: 9_000, max: 16_000, placeholder: true, source: "Плита — ставка не подтверждена" },
  },
  upperTierPerModule: { min: 0, max: 150_000, placeholder: true, source: "Нет данных завода" },
  stairsRub: { min: 150_000, max: 400_000, placeholder: true, source: "Тип лестницы не задан" },
  extraBathroomRub: { min: 150_000, max: 400_000, placeholder: true, source: "Нет данных" },
  panoramicWindowRub: { min: 0, max: 60_000, placeholder: true, source: "Нет данных" },
};
