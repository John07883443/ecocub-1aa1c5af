// .ts в относительных импортах — чтобы доменные тесты гонялись через
// `node --experimental-strip-types --test`, как остальная логика проекта.
import { DOOR_OPENING, MODULE, OPENING_HEIGHTS, PLANNING_RULES } from "../standards/ecocub.ts";
import type { FaceId, Mm, OpeningKind, RotationDeg } from "./types.ts";
import { FACE_IDS } from "./types.ts";

/**
 * Справочник типов модулей.
 *
 * Ни одно число здесь не придумано: всё приходит из `src/lib/standards`,
 * то есть в конечном счёте с листов архитектурного альбома. Если параметра
 * в исходниках нет — его нет и здесь, а вопрос уходит в `OPEN_QUESTIONS`.
 *
 * Почему справочник, а не константы прямо в редакторе. Заводских типоразмеров
 * сейчас один, но продукт живой: появится модуль другой глубины или модуль с
 * подготовленной мокрой зоной — он добавляется строкой сюда, и редактор,
 * валидация и каталог узнают о нём одновременно.
 */

/** Зона грани, в которой проём делать нельзя, и почему. */
export interface FaceRestriction {
  /** Отступ от каждого края грани, в пределах которого проём запрещён. */
  edgeMarginMm: Mm;
  reason: string;
}

export interface ModuleDefinition {
  id: string;
  label: string;
  /** Наружный габарит по короткой стороне (ширина модуля в его локальных осях). */
  externalWidthMm: Mm;
  /** Наружный габарит по длинной стороне (глубина модуля). */
  externalDepthMm: Mm;
  wallThicknessMm: Mm;
  clearWidthMm: Mm;
  clearDepthMm: Mm;
  /** Высота помещения в чистоте. Продуктовая константа 3150. */
  clearHeightMm: Mm;
  floorSlabMm: Mm;
  roofSlabMm: Mm;
  /** Полная высота изделия: пол + помещение + кровля. */
  totalHeightMm: Mm;
  allowedRotations: RotationDeg[];
  mirrorAllowed: boolean;
  /** Длина каждой грани в локальных осях модуля. */
  faceSpanMm: Record<FaceId, Mm>;
  restriction: FaceRestriction;
  /** Типы проёмов, допустимые в этом модуле. */
  allowedOpenings: OpeningKind[];
  /** Откуда взяты размеры. */
  sourceDoc: string;
  sourceSheet?: number;
}

/**
 * Запретная приконтурная зона проёма — 210 мм от края грани.
 *
 * Это не догадка и не «типовое решение из головы»: на всех развёртках
 * альбома, где проём выходит к углу, размерная цепочка начинается или
 * заканчивается отрезком 210 — ровно толщина стены. Например Р-1 модуля A:
 * 210 | 1980 | 800 | 210. Простенок тоньше стены на чертежах не встречается.
 *
 * Правило проверяется предупреждением, а не ошибкой: подтверждения
 * конструктором у него нет, и запрещать им сборку было бы превышением того,
 * что реально известно из документов.
 */
const CORNER_PIER_MM = MODULE.wallThicknessMm;

export const BASE_MODULE: ModuleDefinition = {
  id: MODULE.id,
  label: "Базовый модуль EcoCub 3200 × 3420",
  externalWidthMm: MODULE.externalWidthMm,
  externalDepthMm: MODULE.externalDepthMm,
  wallThicknessMm: MODULE.wallThicknessMm,
  clearWidthMm: MODULE.clearWidthMm,
  clearDepthMm: MODULE.clearDepthMm,
  clearHeightMm: MODULE.clearHeightMm,
  floorSlabMm: MODULE.floorSlabMm,
  roofSlabMm: MODULE.roofSlabMm,
  totalHeightMm: MODULE.totalHeightMm,
  allowedRotations: [0, 90, 180, 270],
  // Модуль симметричен относительно обеих осей: внутри пусто, перегородки
  // ставит проект. Отражать такой объём безопасно.
  mirrorAllowed: true,
  faceSpanMm: {
    "Р-1": MODULE.externalWidthMm,
    "Р-2": MODULE.externalDepthMm,
    "Р-3": MODULE.externalWidthMm,
    "Р-4": MODULE.externalDepthMm,
  },
  restriction: {
    edgeMarginMm: CORNER_PIER_MM,
    reason:
      "На развёртках альбома простенок у угла нигде не меньше толщины стены 210 мм. " +
      "Правило выведено из чертежей и не подтверждено конструктором — поэтому предупреждение.",
  },
  allowedOpenings: ["window", "door", "panoramic", "passage"],
  sourceDoc: "weekend-one-album",
  sourceSheet: 12,
};

export const MODULE_DEFINITIONS: ModuleDefinition[] = [BASE_MODULE];

export function findModuleDefinition(id: string): ModuleDefinition | undefined {
  return MODULE_DEFINITIONS.find((d) => d.id === id);
}

/** Тип по умолчанию: пока заводской типоразмер один. */
export const DEFAULT_MODULE_TYPE_ID = BASE_MODULE.id;

/**
 * Каталог проёмов.
 *
 * Высоты — подтверждённые варианты из стандарта. Ширины в альбом отдельным
 * каталогом не вынесены: с размерной цепочки не следует, какой отрезок проём,
 * а какой простенок. Поэтому ширина здесь есть только там, где она прочитана
 * с чертежа целиком (входная дверь 800 × 2100), а в остальных случаях
 * предлагается как стартовое значение, которое проектировщик задаёт сам.
 */
export interface OpeningPreset {
  id: string;
  label: string;
  kind: OpeningKind;
  widthMm: Mm;
  /** Собственная высота проёма: `topMm − sillMm`. */
  heightMm: Mm;
  sillMm: Mm;
  /** Ширина подтверждена чертежом, а не предложена редактором. */
  widthConfirmed: boolean;
  /** Низ проёма подтверждён чертежом. */
  sillConfirmed: boolean;
  /** Идентификатор варианта высоты из стандарта. */
  variantId: string;
  note: string;
}

/**
 * Верх проёма над чистым полом по стандарту.
 *
 * Внимание на разницу договорённостей. В стандарте `heightMm` варианта — это
 * отметка ВЕРХА проёма от пола: у h2500 headroom 650, и 2500 + 650 = 3150,
 * то есть 2500 отсчитывается от пола, а не от подоконника. В канонической
 * модели проём описан парой «низ + собственная высота», потому что рисовать и
 * проверять на пересечения удобнее именно её. Перевод одной договорённости в
 * другую делается здесь, в одном месте: высота = верх − низ.
 */
function topOf(id: string): Mm {
  const v = OPENING_HEIGHTS.find((h) => h.id === id);
  if (!v) throw new Error(`Нет варианта высоты проёма ${id} в стандарте`);
  return v.heightMm;
}

/** Подоконная линия +0.700 с фасадов альбома. В стандарте помечена needs-review. */
const SILL_LINE_MM: Mm = 700;

export const OPENING_PRESETS: OpeningPreset[] = [
  {
    id: "entrance-door",
    label: "Входная дверь 800 × 2100",
    kind: "door",
    widthMm: DOOR_OPENING.widthMm,
    heightMm: DOOR_OPENING.heightMm,
    sillMm: 0,
    widthConfirmed: true,
    sillConfirmed: true,
    variantId: "h2100",
    note: "Единственный проём, у которого в альбоме подтверждены оба габарита (лист 15, Р-4).",
  },
  {
    id: "window-2500",
    label: "Окно с верхом на +2.500",
    kind: "window",
    widthMm: 1500,
    heightMm: topOf("h2500") - SILL_LINE_MM,
    sillMm: SILL_LINE_MM,
    widthConfirmed: false,
    sillConfirmed: false,
    variantId: "h2500",
    note:
      "Верх +2.500 подтверждён развёрткой Р-3 модуля A. Низ взят по подоконной линии +0.700, " +
      "которая в стандарте помечена как требующая проверки; ширина — по цепочке конкретной грани.",
  },
  {
    id: "window-2800",
    label: "Высокое остекление с верхом на +2.800",
    kind: "window",
    widthMm: 1290,
    heightMm: topOf("h2800"),
    sillMm: 0,
    widthConfirmed: false,
    sillConfirmed: false,
    variantId: "h2800",
    note: "Р-2 модуля A: верх +2.800 снят с развёртки. Низ проёма альбомом не задан — по умолчанию от пола.",
  },
  {
    id: "panoramic-3150",
    label: "Панорама во всю высоту 3150",
    kind: "panoramic",
    widthMm: 2300,
    heightMm: topOf("h3150"),
    sillMm: 0,
    widthConfirmed: false,
    sillConfirmed: true,
    variantId: "h3150",
    note: "Остекление в пол, модуль B: подтверждена высота 3150, ширина берётся с плана.",
  },
  {
    id: "slit-2100",
    label: "Узкое окно-щель, верх +2.100",
    kind: "window",
    widthMm: 500,
    heightMm: topOf("h2100") - SILL_LINE_MM,
    sillMm: SILL_LINE_MM,
    widthConfirmed: false,
    sillConfirmed: false,
    variantId: "h2100",
    note: "Цепочка Р-4 модуля A: отрезки 500 при верхе проёма +2.100.",
  },
  {
    id: "passage-open",
    label: "Открытый проём между модулями",
    kind: "passage",
    widthMm: 2300,
    heightMm: topOf("h3150"),
    sillMm: 0,
    widthConfirmed: false,
    sillConfirmed: true,
    variantId: "h3150",
    note: "Снятая в стыке стена: помещения сливаются, площадь растёт на полосу стены (см. openedJointGainM2).",
  },
];

export function findOpeningPreset(id: string): OpeningPreset | undefined {
  return OPENING_PRESETS.find((p) => p.id === id);
}

/**
 * Основания, встречающиеся в проектах.
 *
 * Отметка −0.500 «низ конструкции основания» стоит на фасадах альбома —
 * отсюда просвет свай по умолчанию. Плита в альбоме Weekend One не показана,
 * но встречается в других проектах, поэтому оставлена как второй вариант с
 * нулевым просветом. Больше вариантов не добавляем, пока они не понадобятся
 * для воспроизведения конкретного дома.
 */
export const FOUNDATION_PRESETS = [
  {
    kind: "piles" as const,
    label: "Свайное основание",
    clearanceMm: 500,
    note: "Отметка −0.500 «низ конструкции основания», фасады альбома Weekend One.",
  },
  {
    kind: "slab" as const,
    label: "Плита",
    clearanceMm: 0,
    note: "Дом стоит на плите без просвета.",
  },
  {
    kind: "none" as const,
    label: "Без основания",
    clearanceMm: 0,
    note: "Основание не показывается — например, когда оно ещё не выбрано.",
  },
];

/**
 * Что редактор не знает и знать не может из имеющихся документов.
 *
 * Список показывается проектировщику в панели «Проверить проект», чтобы
 * неопределённость была видна, а не растворялась в интерфейсе.
 */
export const OPEN_QUESTIONS: { id: string; question: string }[] = [
  {
    id: "opening-widths",
    question:
      "Каталога ширин проёмов в альбоме нет: с размерной цепочки не видно, где проём, а где простенок. " +
      "Ширины вводятся вручную и требуют сверки с чертежом.",
  },
  {
    id: "grid-3393",
    question:
      "Сетка 3393 на планах CUBAX против 3420 в альбоме. Принято, что разница 27 мм — чистовая отделка; " +
      "производством это пока не подтверждено (см. GRID_RECONCILIATION).",
  },
  {
    id: "pile-grid",
    question:
      "Шаг и раскладка свай в исходниках отсутствуют. Поле есть, значение по умолчанию не проставляется.",
  },
  {
    id: "second-floor-support",
    question:
      "Норматив опирания модуля второго этажа документами не задан. Редактор предупреждает при опоре " +
      "меньше половины площади — правило перенесено из публичного конструктора и требует подтверждения.",
  },
];

/** Правила планировки из стандарта — показываются проектировщику как памятка. */
export const PLANNING_HINTS = PLANNING_RULES.map((r) => ({
  id: r.id,
  rule: r.rule,
  confidence: r.confidence,
}));

export { FACE_IDS };
