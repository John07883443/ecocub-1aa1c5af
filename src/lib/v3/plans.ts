/**
 * Библиотека реальных планировочных решений EcoCub. Версия схемы: 1.
 *
 * Источники данных — только то, что реально есть в репозитории:
 *
 * 1. Стартовые планировки боевого конструктора (TEMPLATES в
 *    src/lib/constructor/constants.ts) — раскладки по ячейкам подтверждены
 *    кодом, работающим на проде; статус 'concept'.
 * 2. Карточки проектов content/projects/*.json — площадь, спальни, санузлы,
 *    этажность и цена «от» подтверждены боевым каталогом; статус 'approved'.
 *    Но раскладки по модулям у карточек в репозитории НЕТ, поэтому ячейки
 *    восстановлены по метрикам карточки и помечены needsReview: true —
 *    интерфейс обязан показывать такую схему как условную.
 *
 * Ничего не выдумано сверх этого: типы заводских модулей, лестницы, мокрые
 * зоны и допустимые проёмы не подтверждены данными — их список вынесен в
 * DATA_REQUIRED_FROM_ECOCUB.md, а неподтверждённые трансформации запрещены
 * в constraints.
 */

import { ALL_TEMPLATES, MODULE_AREA, ROLES } from "../constructor/constants.ts";
import { canPlace, minAnchor, supportArea } from "../constructor/geometry.ts";
import { MIN_SUPPORT_AREA } from "../constructor/constants.ts";
import type { ModuleItem, Role } from "../constructor/types.ts";
import type { EcoCubPlan, PlanCell, PlanRoom } from "./types.ts";

export const PLAN_SCHEMA_VERSION = 1;

/* ------------------------------------------------------------------ */
/* Помощники                                                           */
/* ------------------------------------------------------------------ */

const cellId = (floor: number, x: number, z: number) => `f${floor}-${x}-${z}`;

function cell(floor: number, x: number, z: number, role: Role): PlanCell {
  return { id: cellId(floor, x, z), floor, x, z, role };
}

/** Метрики, посчитанные из ячеек, — для планов без подтверждённой карточки. */
export function metricsFromCells(cells: PlanCell[]) {
  let heated = 0;
  let terrace = 0;
  let bedrooms = 0;
  let bathrooms = 0;
  let maxFloor = 0;
  for (const c of cells) {
    if (ROLES[c.role].heated) heated += MODULE_AREA;
    else terrace += MODULE_AREA;
    if (c.role === "bedroom") bedrooms += 1;
    if (c.role === "bathroom") bathrooms += 1;
    if (c.floor > maxFloor) maxFloor = c.floor;
  }
  return {
    grossAreaM2: heated + terrace,
    heatedAreaM2: heated,
    terraceAreaM2: terrace,
    floors: maxFloor + 1,
    bedrooms,
    bathrooms,
  };
}

/** Ячейки плана → модули конструктора (стартовая конфигурация редактора). */
export function cellsToModules(cells: PlanCell[]): ModuleItem[] {
  return cells.map((c) => ({ id: c.id, x: c.x, z: c.z, floor: c.floor, role: c.role }));
}

/** Комнаты по ролям ячеек — грубая, но честная сводка для карточки варианта. */
function roomsFromCells(cells: PlanCell[]): PlanRoom[] {
  const labels: Record<Role, string> = {
    living: "Гостиная / общая зона",
    bedroom: "Спальня",
    kitchen: "Кухня",
    bathroom: "Санузел",
    stairs: "Лестница",
    terrace: "Терраса",
  };
  const rooms: PlanRoom[] = [];
  const counters: Partial<Record<Role, number>> = {};
  for (const c of cells) {
    if (c.role === "living") continue; // общая зона сводится ниже одной строкой
    const n = (counters[c.role] = (counters[c.role] ?? 0) + 1);
    rooms.push({
      id: `${c.role}-${n}`,
      type: c.role,
      name: labels[c.role] + (n > 1 ? ` ${n}` : ""),
      areaM2: MODULE_AREA,
      floor: c.floor,
      moduleCellIds: [c.id],
    });
  }
  const livingCells = cells.filter((c) => c.role === "living");
  if (livingCells.length) {
    rooms.unshift({
      id: "living",
      type: "living",
      name: "Гостиная и общие зоны",
      areaM2: livingCells.length * MODULE_AREA,
      floor: 0,
      moduleCellIds: livingCells.map((c) => c.id),
    });
  }
  return rooms;
}

const BASE_ALLOWED = [
  "Добавить спальню, кабинет или санузел",
  "Увеличить кухню-гостиную",
  "Добавить террасу или зону хранения",
  "Передвинуть модули (шаг 1 м) и зеркально развернуть дом",
];

const CATALOG_FORBIDDEN = [
  "Перенос мокрых зон и стояков без проверки инженером",
  "Изменение несущей схемы (не подтверждена данными)",
];

const CATALOG_REVIEW_NOTES = [
  "Раскладка по ячейкам 3×3 м восстановлена по карточке проекта — условная схема, не заводской чертёж.",
  "Не подтверждены: типы заводских модулей, мокрые зоны, стояки, несущие сегменты (см. DATA_REQUIRED_FROM_ECOCUB.md).",
];

/* ------------------------------------------------------------------ */
/* Планы из карточек боевого каталога (content/projects/*.json)        */
/* ------------------------------------------------------------------ */

type CatalogSeed = {
  slug: string;
  name: string;
  description: string;
  areaM2: number;
  bedrooms: number;
  bathrooms: number;
  floors: number;
  priceFrom: number;
  coverImage: string;
  lifestyleTags: string[];
  maxComfortablePeople: number;
  cells: PlanCell[];
};

const CATALOG: CatalogSeed[] = [
  {
    slug: "weekend-one",
    name: "Weekend One",
    description:
      "Компактный одноэтажный дом с панорамным остеклением: гостиная-кухня, спальня, санузел и терраса. Идеален как дача, гостевой дом или старт для одного-двух человек.",
    areaM2: 55,
    bedrooms: 1,
    bathrooms: 1,
    floors: 1,
    priceFrom: 5_500_000,
    coverImage: "/images/projects/weekend-one.jpg",
    lifestyleTags: ["compact", "dacha", "guest-house", "terrace"],
    maxComfortablePeople: 2,
    cells: [
      cell(0, 0, 0, "living"),
      cell(0, 3, 0, "kitchen"),
      cell(0, 6, 0, "bedroom"),
      cell(0, 0, 3, "terrace"),
      cell(0, 3, 3, "bathroom"),
      cell(0, 6, 3, "living"),
    ],
  },
  {
    slug: "sky-river",
    name: "Sky River",
    description:
      "Дом с двумя спальнями и просторной гостиной-кухней, ориентированной на природу. Две террасы по углам — утренняя и вечерняя.",
    areaM2: 85,
    bedrooms: 2,
    bathrooms: 1,
    floors: 1,
    priceFrom: 8_500_000,
    coverImage: "/images/projects/sky-river.jpg",
    lifestyleTags: ["family", "views", "terrace", "one-floor"],
    maxComfortablePeople: 4,
    cells: [
      cell(0, 0, 0, "living"),
      cell(0, 3, 0, "living"),
      cell(0, 6, 0, "kitchen"),
      cell(0, 0, 3, "bedroom"),
      cell(0, 3, 3, "bathroom"),
      cell(0, 6, 3, "bedroom"),
      cell(0, 0, 6, "terrace"),
      cell(0, 3, 6, "living"),
      cell(0, 6, 6, "terrace"),
    ],
  },
  {
    slug: "weekend-two",
    name: "Weekend Two",
    description:
      "Просторный одноэтажный дом: две спальни, отдельный кабинет для работы из дома, два санузла и большая кухня-гостиная с панорамой.",
    areaM2: 124,
    bedrooms: 2,
    bathrooms: 2,
    floors: 1,
    priceFrom: 10_000_000,
    coverImage: "/images/projects/weekend-two.jpg",
    lifestyleTags: ["family", "office", "one-floor", "storage"],
    maxComfortablePeople: 4,
    cells: [
      cell(0, 0, 0, "living"),
      cell(0, 3, 0, "living"),
      cell(0, 6, 0, "living"),
      cell(0, 9, 0, "kitchen"),
      cell(0, 0, 3, "bedroom"),
      cell(0, 3, 3, "bathroom"),
      cell(0, 6, 3, "living"), // кабинет
      cell(0, 9, 3, "bedroom"),
      cell(0, 0, 6, "living"), // прихожая
      cell(0, 3, 6, "bathroom"),
      cell(0, 6, 6, "living"), // гардероб и постирочная
      cell(0, 9, 6, "living"),
      cell(0, 0, 9, "terrace"),
      cell(0, 9, 9, "terrace"),
    ],
  },
  {
    slug: "family-one",
    name: "Family One",
    description:
      "Семейный дом с тремя спальнями в приватной части, двумя санузлами и большой общей зоной. Гардеробные и хозблок — всё на одном уровне.",
    areaM2: 146,
    bedrooms: 3,
    bathrooms: 2,
    floors: 1,
    priceFrom: 12_000_000,
    coverImage: "/images/projects/family-one.jpg",
    lifestyleTags: ["family", "one-floor", "storage", "privacy"],
    maxComfortablePeople: 5,
    cells: [
      cell(0, 0, 0, "living"),
      cell(0, 3, 0, "living"),
      cell(0, 6, 0, "living"),
      cell(0, 9, 0, "kitchen"),
      cell(0, 12, 0, "terrace"),
      cell(0, 0, 3, "living"), // столовая
      cell(0, 3, 3, "bedroom"),
      cell(0, 6, 3, "bathroom"),
      cell(0, 9, 3, "bedroom"),
      cell(0, 12, 3, "terrace"),
      cell(0, 0, 6, "living"), // холл
      cell(0, 3, 6, "bedroom"),
      cell(0, 6, 6, "bathroom"),
      cell(0, 9, 6, "living"), // гардероб
      cell(0, 0, 9, "living"), // постирочная
      cell(0, 3, 9, "living"), // прихожая
    ],
  },
  {
    slug: "family-two",
    name: "Family Two",
    description:
      "Премиальная вилла в стиле Hi-Tech: три спальни, кабинет, два санузла, гардеробные и три террасы. Максимум площади и комфорта на одном этаже.",
    areaM2: 163,
    bedrooms: 3,
    bathrooms: 2,
    floors: 1,
    priceFrom: 13_000_000,
    coverImage: "/images/projects/family-two.jpg",
    lifestyleTags: ["family", "premium", "office", "terrace", "privacy"],
    maxComfortablePeople: 6,
    cells: [
      cell(0, 0, 0, "living"),
      cell(0, 3, 0, "living"),
      cell(0, 6, 0, "living"),
      cell(0, 9, 0, "kitchen"),
      cell(0, 12, 0, "terrace"),
      cell(0, 0, 3, "living"), // столовая
      cell(0, 3, 3, "bedroom"),
      cell(0, 6, 3, "bathroom"),
      cell(0, 9, 3, "bedroom"),
      cell(0, 12, 3, "terrace"),
      cell(0, 0, 6, "living"), // холл
      cell(0, 3, 6, "bedroom"),
      cell(0, 6, 6, "bathroom"),
      cell(0, 9, 6, "living"), // гардероб
      cell(0, 12, 6, "terrace"),
      cell(0, 0, 9, "living"), // кабинет
      cell(0, 3, 9, "living"), // прихожая
      cell(0, 6, 9, "living"), // постирочная
    ],
  },
];

function catalogPlan(seed: CatalogSeed): EcoCubPlan {
  const computed = metricsFromCells(seed.cells);
  return {
    id: `catalog-${seed.slug}`,
    slug: seed.slug,
    name: seed.name,
    status: "approved",
    sourceRefs: [`content/projects/${seed.slug}.json`],
    description: seed.description,
    cells: seed.cells,
    metrics: {
      grossAreaM2: seed.areaM2,
      heatedAreaM2: computed.heatedAreaM2,
      terraceAreaM2: computed.terraceAreaM2,
      floors: seed.floors,
      bedrooms: seed.bedrooms,
      bathrooms: seed.bathrooms,
      confirmedPriceFrom: seed.priceFrom,
    },
    rooms: roomsFromCells(seed.cells),
    constraints: {
      fixedElements: ["Санузлы (мокрые зоны) — положение согласуется с инженером"],
      forbiddenTransformations: CATALOG_FORBIDDEN,
    },
    fit: {
      minBedrooms: seed.bedrooms,
      maxComfortablePeople: seed.maxComfortablePeople,
      lifestyleTags: seed.lifestyleTags,
    },
    assets: { coverImage: seed.coverImage },
    needsReview: true,
    reviewNotes: CATALOG_REVIEW_NOTES,
  };
}

/* ------------------------------------------------------------------ */
/* Планы из стартовых шаблонов боевого конструктора                     */
/* ------------------------------------------------------------------ */

const TEMPLATE_META: Record<
  string,
  { description: string; lifestyleTags: string[]; maxComfortablePeople: number }
> = {
  studio: {
    description: "Студия из двух модулей — минимальный старт: жилая зона и санузел.",
    lifestyleTags: ["compact", "starter", "guest-house"],
    maxComfortablePeople: 2,
  },
  cube: {
    description: "Квадратный дом из четырёх модулей: гостиная, кухня, спальня, санузел.",
    lifestyleTags: ["compact", "dacha"],
    maxComfortablePeople: 2,
  },
  "l-family": {
    description: "Г-образный семейный дом: три спальни, общая зона и терраса во дворе.",
    lifestyleTags: ["family", "one-floor", "terrace"],
    maxComfortablePeople: 5,
  },
  "u-court": {
    description: "П-образный дом с внутренним двором: четыре спальни и две террасы.",
    lifestyleTags: ["family", "guests", "privacy", "terrace"],
    maxComfortablePeople: 7,
  },
  "two-story": {
    description: "Двухэтажный дом: общие зоны внизу, три спальни наверху, две террасы.",
    lifestyleTags: ["family", "two-floors", "narrow-plot"],
    maxComfortablePeople: 5,
  },
  cascade: {
    description: "Каскадный дом со ступенчатым фасадом и консолями второго этажа.",
    lifestyleTags: ["premium", "two-floors", "views"],
    maxComfortablePeople: 4,
  },
};

function templatePlan(templateId: string): EcoCubPlan | null {
  const tpl = ALL_TEMPLATES.find((t) => t.id === templateId);
  const meta = TEMPLATE_META[templateId];
  if (!tpl || !meta) return null;
  const cells = tpl.seeds.map((s) => cell(s.floor, s.x, s.z, s.role));
  const metrics = metricsFromCells(cells);
  return {
    id: `template-${tpl.id}`,
    slug: tpl.id,
    name: tpl.name,
    status: "concept",
    sourceRefs: ["src/lib/constructor/constants.ts (TEMPLATES)"],
    description: meta.description,
    cells,
    metrics,
    rooms: roomsFromCells(cells),
    constraints: {
      fixedElements: [],
      forbiddenTransformations: CATALOG_FORBIDDEN,
    },
    fit: {
      minBedrooms: metrics.bedrooms,
      maxComfortablePeople: meta.maxComfortablePeople,
      lifestyleTags: meta.lifestyleTags,
    },
    assets: {},
    needsReview: false,
  };
}

/* ------------------------------------------------------------------ */
/* Публичная библиотека и валидация                                     */
/* ------------------------------------------------------------------ */

export const PLAN_LIBRARY: EcoCubPlan[] = [
  ...CATALOG.map(catalogPlan),
  ...ALL_TEMPLATES.map((t) => templatePlan(t.id)).filter((p): p is EcoCubPlan => p !== null),
];

export function findPlan(id: string): EcoCubPlan | undefined {
  return PLAN_LIBRARY.find((p) => p.id === id);
}

/**
 * Валидация библиотеки. Запускается тестами и в dev-режиме страницы:
 * геометрия каждого плана обязана проходить те же правила, что и боевой
 * конструктор (без пересечений, верхние этажи с опорой ≥ трети площади),
 * а метрики карточки — не расходиться с ячейками сильнее допуска.
 */
export function validatePlanLibrary(plans: EcoCubPlan[] = PLAN_LIBRARY): string[] {
  const errors: string[] = [];
  const seen = new Set<string>();

  for (const plan of plans) {
    if (seen.has(plan.id)) errors.push(`${plan.id}: дублируется id`);
    seen.add(plan.id);

    if (!plan.cells.length) {
      errors.push(`${plan.id}: нет ячеек`);
      continue;
    }

    // Геометрия: собираем план по одной ячейке через боевой canPlace.
    // Координаты плана заданы от нуля, а на участке дом обязан отступить от
    // границ — поэтому проверяем план уже сдвинутым в зону застройки.
    const offset = minAnchor();
    const span = Math.max(...plan.cells.map((c) => Math.max(c.x, c.z))) + 6;
    const n = Math.ceil((span + offset * 2) / 3) + 2;
    const placed: ModuleItem[] = [];
    const byFloor = [...plan.cells].sort((a, b) => a.floor - b.floor);
    for (const c of byFloor) {
      const candidate = {
        id: c.id,
        x: c.x + offset,
        z: c.z + offset,
        floor: c.floor,
        role: c.role,
      };
      if (!canPlace(placed, candidate, n)) {
        errors.push(`${plan.id}: ячейка ${c.id} нарушает правила размещения`);
      }
      placed.push(candidate);
    }
    for (const m of placed) {
      if (m.floor > 0 && supportArea(m, placed) < MIN_SUPPORT_AREA) {
        errors.push(`${plan.id}: у ячейки ${m.id} нет достаточной опоры`);
      }
    }

    // Метрики: спальни/санузлы в ячейках должны совпадать с карточкой,
    // а заявленная площадь — с суммой ячеек в пределах 10 %.
    const computed = metricsFromCells(plan.cells);
    if (computed.bedrooms !== plan.metrics.bedrooms) {
      errors.push(
        `${plan.id}: спален в ячейках ${computed.bedrooms}, в карточке ${plan.metrics.bedrooms}`,
      );
    }
    if (computed.bathrooms !== plan.metrics.bathrooms) {
      errors.push(
        `${plan.id}: санузлов в ячейках ${computed.bathrooms}, в карточке ${plan.metrics.bathrooms}`,
      );
    }
    const drift = Math.abs(computed.grossAreaM2 - plan.metrics.grossAreaM2);
    if (drift / plan.metrics.grossAreaM2 > 0.1) {
      errors.push(
        `${plan.id}: площадь ячеек ${computed.grossAreaM2} м² расходится с карточкой ${plan.metrics.grossAreaM2} м² больше чем на 10 %`,
      );
    }
    if (computed.floors !== plan.metrics.floors) {
      errors.push(
        `${plan.id}: этажей в ячейках ${computed.floors}, в карточке ${plan.metrics.floors}`,
      );
    }

    if (plan.status === "approved" && plan.needsReview && !plan.reviewNotes?.length) {
      errors.push(`${plan.id}: needsReview без reviewNotes`);
    }
  }
  return errors;
}
