/**
 * Константы конструктора v3.1: сетка, высота потолков, типы помещений
 * и версионируемый каталог габаритов мебели.
 *
 * Все размеры мебели и минимальные проходы живут здесь, а не «магическими
 * числами» по компонентам: планировщик и отрисовка обязаны видеть одни и те
 * же цифры, а версия каталога позволяет воспроизвести старый проект.
 */

import type { FurnitureKind, RoomType, RoomTypeMeta } from "./types.ts";

/** Сторона модуля-секции и шаг установки — те же, что у боевого конструктора. */
export const MODULE_SIDE_M = 3;
export const STEP_M = 1;
export const MODULE_AREA_M2 = MODULE_SIDE_M * MODULE_SIDE_M;

/**
 * Высота потолков — фиксированная характеристика продукта, не настройка.
 * Единственный источник: и подпись в интерфейсе, и 3D-геометрия берут её
 * отсюда, поэтому объём и текст не могут разойтись.
 */
export const CEILING_HEIGHT_M = 3.15;
/** Толщина перекрытия между этажами в 3D, м (визуальная величина). */
export const SLAB_M = 0.25;

/** Минимальная опора модуля верхнего этажа — треть площади (правило v2/v3). */
export const MIN_SUPPORT_AREA_M2 = MODULE_AREA_M2 / 3;
export const MAX_FLOORS = 3;

/** Порог магнитного захвата в метрах плана (пересчитывается из пикселей). */
export const SNAP_THRESHOLD_M = 1.2;
/** Гистерезис: чтобы сменить выбранного кандидата, новый должен быть ближе
 *  на эту величину — иначе модуль дрожит между двумя позициями. */
export const SNAP_HYSTERESIS_M = 0.35;
/** Минимальная длина соприкосновения, считающаяся общей гранью. */
export const MIN_JOINT_LENGTH_M = 1;

export const ROOM_TYPES: Record<RoomType, RoomTypeMeta> = {
  entryway: {
    id: "entryway",
    label: "Прихожая",
    heated: true,
    living: false,
    hint: "входная зона, шкаф и место для обуви",
  },
  living: {
    id: "living",
    label: "Гостиная",
    heated: true,
    living: true,
    hint: "диван, зона отдыха",
  },
  kitchen: {
    id: "kitchen",
    label: "Кухня-гостиная",
    heated: true,
    living: true,
    hint: "кухонная линия и общая зона",
  },
  dining: {
    id: "dining",
    label: "Столовая",
    heated: true,
    living: true,
    hint: "обеденный стол со стульями",
  },
  bedroom: {
    id: "bedroom",
    label: "Спальня",
    heated: true,
    living: true,
    hint: "кровать, тумбы, шкаф",
  },
  office: {
    id: "office",
    label: "Кабинет",
    heated: true,
    living: true,
    hint: "рабочий стол и кресло",
  },
  bathroom: {
    id: "bathroom",
    label: "Санузел",
    heated: true,
    living: false,
    hint: "душ или ванна, раковина",
  },
  storage: {
    id: "storage",
    label: "Хранение и постирочная",
    heated: true,
    living: false,
    hint: "шкафы, стиральная машина",
  },
  stairs: {
    id: "stairs",
    label: "Лестница",
    heated: true,
    living: false,
    hint: "марш на второй этаж",
  },
  terrace: {
    id: "terrace",
    label: "Терраса",
    heated: false,
    living: false,
    hint: "открытая зона, считается по сниженной ставке",
  },
};

export const ROOM_TYPE_ORDER: RoomType[] = [
  "entryway",
  "kitchen",
  "living",
  "dining",
  "bedroom",
  "office",
  "bathroom",
  "storage",
  "stairs",
  "terrace",
];

/* ------------------------------------------------------------------ */
/* Каталог мебели                                                      */
/* ------------------------------------------------------------------ */

/** Версия каталога и правил планировщика. Меняется при правке габаритов. */
export const LAYOUT_ALGORITHM_VERSION = "v31-rules-1";

export interface FurnitureSpec {
  /** Ширина вдоль стены и глубина от стены, м. */
  w: number;
  d: number;
  label: string;
}

export const FURNITURE_CATALOG: Record<FurnitureKind, FurnitureSpec> = {
  bed: { w: 1.6, d: 2.0, label: "Кровать" },
  nightstand: { w: 0.45, d: 0.4, label: "Тумба" },
  wardrobe: { w: 1.4, d: 0.6, label: "Шкаф" },
  sofa: { w: 2.2, d: 0.9, label: "Диван" },
  "coffee-table": { w: 1.0, d: 0.6, label: "Журнальный стол" },
  tv: { w: 1.2, d: 0.25, label: "ТВ-зона" },
  "kitchen-line": { w: 2.6, d: 0.6, label: "Кухонная линия" },
  "dining-table": { w: 1.4, d: 0.9, label: "Обеденный стол" },
  chair: { w: 0.45, d: 0.45, label: "Стул" },
  desk: { w: 1.4, d: 0.7, label: "Рабочий стол" },
  "office-chair": { w: 0.55, d: 0.55, label: "Кресло" },
  bath: { w: 1.7, d: 0.7, label: "Ванна" },
  shower: { w: 0.9, d: 0.9, label: "Душ" },
  toilet: { w: 0.4, d: 0.6, label: "Унитаз" },
  sink: { w: 0.6, d: 0.45, label: "Раковина" },
  washer: { w: 0.6, d: 0.6, label: "Стиральная машина" },
  shelf: { w: 1.2, d: 0.45, label: "Стеллаж" },
  bench: { w: 1.0, d: 0.4, label: "Банкетка" },
  "stairs-run": { w: 1.1, d: 2.6, label: "Лестничный марш" },
  // Ниже — предметы, подписанные прямо на чертежах разобранных проектов.
  // Каталог собран не по каталогу мебельного магазина, а по тому, что
  // архитектор нарисовал: «комод» у Family One и Family Two, «остров» и
  // «Ст.м» / «Суш.м» у Nasledie, кресла вокруг круглого стола на террасе
  // Weekend One, бойлер в отдельной каморке 0,57 м² там же.
  armchair: { w: 0.75, d: 0.8, label: "Кресло" },
  dresser: { w: 1.1, d: 0.45, label: "Комод" },
  "round-table": { w: 1.2, d: 1.2, label: "Круглый стол" },
  "kitchen-island": { w: 1.8, d: 0.9, label: "Кухонный остров" },
  fridge: { w: 0.7, d: 0.7, label: "Холодильник" },
  dryer: { w: 0.6, d: 0.6, label: "Сушильная машина" },
  "tv-unit": { w: 1.6, d: 0.4, label: "Тумба под ТВ" },
  "single-bed": { w: 0.9, d: 2.0, label: "Односпальная кровать" },
  "double-sink": { w: 1.2, d: 0.5, label: "Двойная раковина" },
  boiler: { w: 0.6, d: 0.4, label: "Бойлер" },
  plant: { w: 0.5, d: 0.5, label: "Растение" },
  "wardrobe-rail": { w: 1.6, d: 0.6, label: "Гардеробная штанга" },
  // У входа почти всегда нужны шкаф, обувница и зеркало — без них прихожая
  // выглядит как пустой тамбур, которым никто не пользуется.
  "shoe-rack": { w: 0.9, d: 0.35, label: "Обувница" },
  mirror: { w: 0.6, d: 0.08, label: "Зеркало" },
  // Угловая душевая кабина: в санузел 2–3 м² ставят именно её, а не поддон
  // посреди стены.
  "corner-shower": { w: 0.9, d: 0.9, label: "Угловая душевая" },
  lounge: { w: 1.6, d: 0.8, label: "Лаунж-зона" },
  "outdoor-table": { w: 1.0, d: 1.0, label: "Уличный стол" },
};

/** Минимальный проход между предметами и до стен, м. */
export const MIN_CLEARANCE_M = 0.6;
/** Свободная зона перед входной дверью, м. */
export const ENTRY_CLEARANCE_M = 0.9;
