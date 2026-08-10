// .ts в импорте — для запуска доменных тестов через node --experimental-strip-types.
import type { DesignPreset, RoleMeta, Role, Template } from "./types.ts";

/** Метры на одну ячейку сетки (сторона). */
export const CELL_M = 3;
/** Габариты базового модуля-кубика в метрах: 3 × 3, высота 3,15. */
export const MODULE_SIDE_M = 3;
export const MODULE_HEIGHT_M = 3.15;
/** Площадь одного модуля, м². */
export const MODULE_AREA = MODULE_SIDE_M * MODULE_SIDE_M; // 9

/**
 * Шаг установки модуля — 0,5 м. Половина метра точнее целого: кубики
 * стыкуются гибче, ступенчатые фасады и консоли получают больше вариантов
 * смещения, а сетка остаётся кратной стороне модуля (3 / 0,5 = 6).
 */
export const STEP_M = 0.5;

/** Округление координаты к сетке установки. */
export function snapToStep(v: number): number {
  return Math.round(v / STEP_M) * STEP_M;
}
/** Минимальная опора модуля верхнего этажа — треть его площади. */
export const MIN_SUPPORT_AREA = MODULE_AREA / 3; // 3

/**
 * Минимальный отступ дома от границ участка (будущего забора), м.
 * Ближе модуль поставить нельзя — ни тапом, ни перетаскиванием.
 */
export const SETBACK_M = 3;

/** Терраса считается по сниженной ставке относительно жилой площади. */
export const TERRACE_PRICE_FACTOR = 0.4;

/** Участок по умолчанию и границы, соток. */
export const DEFAULT_SOTKI = 10;
export const MIN_SOTKI = 4;
export const MAX_SOTKI = 30;

/** Ограничение на число этажей — модульная технология EcoCub до 3 этажей. */
export const MAX_FLOORS = 3;

export const ROLES: Record<Role, RoleMeta> = {
  living: { id: "living", label: "Гостиная", heated: true, plan: "#bc9b82", floor3d: "#c8a888" },
  bedroom: { id: "bedroom", label: "Спальня", heated: true, plan: "#8ba0bc", floor3d: "#9fb0c6" },
  kitchen: { id: "kitchen", label: "Кухня", heated: true, plan: "#c6a15a", floor3d: "#d0b070" },
  bathroom: { id: "bathroom", label: "Санузел", heated: true, plan: "#6fae9f", floor3d: "#84bcae" },
  stairs: { id: "stairs", label: "Лестница", heated: true, plan: "#9a9a9a", floor3d: "#adadad" },
  terrace: { id: "terrace", label: "Терраса", heated: false, plan: "#c9b7a0", floor3d: "#b8a488" },
};

export const ROLE_ORDER: Role[] = ["living", "bedroom", "kitchen", "bathroom", "stairs", "terrace"];

export const DESIGN_PRESETS: DesignPreset[] = [
  {
    id: "warm-wood",
    name: "Тёплое дерево",
    description: "Деревянные рейки, мягкий свет, уют скандинавского загородного дома.",
    image: "/images/constructor/warm-wood.webp",
    wall: "#a9835a",
    wallRoughness: 0.85,
    wallMetalness: 0.0,
    roof: "#3a2f27",
    glass: "#20303a",
    ground: "#7c9166",
  },
  {
    id: "graphite",
    name: "Графит-бетон",
    description: "Тёмный архитектурный бетон и сталь — строгий hi-tech.",
    image: "/images/constructor/graphite.webp",
    wall: "#4a4d52",
    wallRoughness: 0.6,
    wallMetalness: 0.15,
    roof: "#1f2124",
    glass: "#101a22",
    ground: "#75895f",
  },
  {
    id: "glass",
    name: "Панорама",
    description: "Максимум остекления в пол — свет и виды на участок.",
    image: "/images/constructor/glass.webp",
    wall: "#d9d5cd",
    wallRoughness: 0.35,
    wallMetalness: 0.1,
    roof: "#2b2b2b",
    glass: "#1a2a34",
    ground: "#7c9166",
  },
  {
    id: "nordic-white",
    name: "Скандинавский белый",
    description: "Светлый матовый фасад и графитовые окна — чистая геометрия.",
    image: "/images/constructor/nordic-white.webp",
    wall: "#eceae4",
    wallRoughness: 0.7,
    wallMetalness: 0.0,
    roof: "#33352f",
    glass: "#22333b",
    ground: "#82946a",
  },
];

// Стартовые планировки. Координаты — в метрах от нуля (кратны шагу, модуль 3×3);
// при загрузке центрируются на участке.

/**
 * Готовые планировки — реальные проекты.
 *
 * Раньше здесь стояли абстрактные фигуры: «Студия», «Куб», «П-образный».
 * Человеку они говорили мало: непонятно, влезет ли в «Куб» семья и чем он
 * отличается от «Каскада». Теперь в списке семь построенных домов — разбор
 * каждого лежит в `src/lib/standards`. Стартовать с проверенного дома и
 * достроить кубик под кабинет проще, чем собирать форму с нуля.
 *
 * Раскладка приблизительная: конструктор пока считает модуль квадратом 3 × 3 м,
 * а на чертеже он 3,2 × 3,42 (см. docs/STANDARDS.md). Переносится состав
 * помещений и форма, а не обводка чертежа. Число модулей при этом настоящее, и
 * площадь получается близкой к каталожной — 9 м² на модуль в конструкторе
 * примерно равны площади настоящего модуля внутри стен.
 */
export const TEMPLATES: Template[] = [
  {
    id: "weekend-mini",
    name: "Weekend Mini",
    shape: "3 модуля · 27 м² · Г-образный",
    reference: "weekend-mini",
    note: "Спальня, общая комната с кухней, санузел. Терраса в вырезе буквы Г",
    seeds: [
      { x: 0, z: 0, floor: 0, role: "bedroom" },
      { x: 3, z: 0, floor: 0, role: "bathroom" },
      { x: 3, z: 3, floor: 0, role: "living" },
      { x: 0, z: 3, floor: 0, role: "terrace" },
    ],
  },
  {
    id: "weekend-one",
    name: "Weekend One",
    shape: "4 модуля · 36 м² · линия со смещением",
    reference: "weekend-one",
    note: "Кухня-гостиная из двух модулей, спальня целым модулем, террасы в уступах",
    seeds: [
      { x: 0, z: 1.5, floor: 0, role: "bathroom" },
      { x: 3, z: 3, floor: 0, role: "kitchen" },
      { x: 6, z: 3, floor: 0, role: "living" },
      { x: 9, z: 1.5, floor: 0, role: "bedroom" },
      { x: 0, z: 4.5, floor: 0, role: "terrace" },
      { x: 3, z: 0, floor: 0, role: "terrace" },
      { x: 6, z: 0, floor: 0, role: "terrace" },
      { x: 9, z: 4.5, floor: 0, role: "terrace" },
    ],
  },
  {
    id: "family-one",
    name: "Family One",
    shape: "6 модулей · 54 м² · 2 спальни",
    reference: "family-one",
    note: "Кухня и гостиная одним объёмом, спальни по углам, мокрый блок у входа",
    seeds: [
      { x: 0, z: 6, floor: 0, role: "kitchen" },
      { x: 3, z: 6, floor: 0, role: "living" },
      { x: 6, z: 6, floor: 0, role: "bedroom" },
      { x: 0, z: 3, floor: 0, role: "bedroom" },
      { x: 3, z: 3, floor: 0, role: "living" },
      { x: 6, z: 3, floor: 0, role: "bathroom" },
      { x: 0, z: 9, floor: 0, role: "terrace" },
      { x: 3, z: 9, floor: 0, role: "terrace" },
      { x: 6, z: 0, floor: 0, role: "terrace" },
    ],
  },
  {
    id: "family-two",
    name: "Family Two",
    shape: "8 модулей · 72 м² · 3 спальни",
    reference: "family-two",
    note: "Общая комната ядром на всю глубину, три спальни открываются прямо в неё",
    seeds: [
      { x: 0, z: 6, floor: 0, role: "bedroom" },
      { x: 3, z: 6, floor: 0, role: "living" },
      { x: 6, z: 6, floor: 0, role: "kitchen" },
      { x: 9, z: 6, floor: 0, role: "bedroom" },
      { x: 0, z: 3, floor: 0, role: "bedroom" },
      { x: 3, z: 3, floor: 0, role: "living" },
      { x: 6, z: 3, floor: 0, role: "living" },
      { x: 9, z: 3, floor: 0, role: "bathroom" },
      { x: 0, z: 9, floor: 0, role: "terrace" },
      { x: 3, z: 0, floor: 0, role: "terrace" },
      { x: 6, z: 0, floor: 0, role: "terrace" },
    ],
  },
  {
    id: "super-family",
    name: "Super Family",
    shape: "11 модулей · 99 м² · П-образный, 3 спальни",
    reference: "super-family",
    note: "Спальня родителей отдельным крылом, детские в других, терраса и двор в вырезах",
    seeds: [
      { x: 0, z: 9, floor: 0, role: "bedroom" },
      { x: 3, z: 9, floor: 0, role: "living" },
      { x: 6, z: 9, floor: 0, role: "bedroom" },
      { x: 0, z: 6, floor: 0, role: "bathroom" },
      { x: 3, z: 6, floor: 0, role: "living" },
      { x: 6, z: 6, floor: 0, role: "living" },
      { x: 0, z: 3, floor: 0, role: "living" },
      { x: 3, z: 3, floor: 0, role: "kitchen" },
      { x: 6, z: 3, floor: 0, role: "bathroom" },
      { x: 0, z: 0, floor: 0, role: "bedroom" },
      { x: 6, z: 0, floor: 0, role: "living" },
      { x: 3, z: 0, floor: 0, role: "terrace" },
      { x: 0, z: 12, floor: 0, role: "terrace" },
      { x: 3, z: 12, floor: 0, role: "terrace" },
    ],
  },
  {
    id: "nasledie",
    name: "Nasledie",
    shape: "12 модулей · 108 м² · 3 спальни, 2 санузла",
    reference: "nasledie",
    note: "Мастер-спальня блоком с гардеробом и своим санузлом, отдельный коридор к детским",
    seeds: [
      { x: 0, z: 9, floor: 0, role: "bedroom" },
      { x: 3, z: 9, floor: 0, role: "living" },
      { x: 6, z: 9, floor: 0, role: "living" },
      { x: 0, z: 6, floor: 0, role: "bathroom" },
      { x: 3, z: 6, floor: 0, role: "living" },
      { x: 6, z: 6, floor: 0, role: "kitchen" },
      { x: 0, z: 3, floor: 0, role: "living" },
      { x: 3, z: 3, floor: 0, role: "bathroom" },
      { x: 6, z: 3, floor: 0, role: "living" },
      { x: 0, z: 0, floor: 0, role: "bedroom" },
      { x: 3, z: 0, floor: 0, role: "bedroom" },
      { x: 6, z: 0, floor: 0, role: "living" },
      { x: 3, z: 12, floor: 0, role: "terrace" },
      { x: 6, z: 12, floor: 0, role: "terrace" },
    ],
  },
  {
    id: "dinastiya",
    name: "Dinastiya",
    shape: "15 модулей · 135 м² · 3 спальни, 3 санузла",
    reference: "dinastiya",
    note: "Симметричная раскладка: детские зеркально по краям, мастер-спальня с другого торца",
    seeds: [
      { x: 0, z: 9, floor: 0, role: "bedroom" },
      { x: 3, z: 9, floor: 0, role: "living" },
      { x: 6, z: 9, floor: 0, role: "living" },
      { x: 9, z: 9, floor: 0, role: "bedroom" },
      { x: 0, z: 6, floor: 0, role: "bathroom" },
      { x: 3, z: 6, floor: 0, role: "living" },
      { x: 6, z: 6, floor: 0, role: "living" },
      { x: 9, z: 6, floor: 0, role: "bathroom" },
      { x: 0, z: 3, floor: 0, role: "living" },
      { x: 3, z: 3, floor: 0, role: "kitchen" },
      { x: 6, z: 3, floor: 0, role: "living" },
      { x: 9, z: 3, floor: 0, role: "bathroom" },
      { x: 0, z: 0, floor: 0, role: "bedroom" },
      { x: 3, z: 0, floor: 0, role: "living" },
      { x: 6, z: 0, floor: 0, role: "living" },
      { x: 9, z: 0, floor: 0, role: "terrace" },
      { x: 3, z: 12, floor: 0, role: "terrace" },
    ],
  },
];
