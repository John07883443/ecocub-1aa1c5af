/**
 * Доменные типы конструктора v3.1 (/constructor-ai-v3-1).
 *
 * Отдельный слой от v3 (src/lib/v3): исходная версия остаётся рабочей и
 * доступной для сравнения, здесь появляются сущности, которых там не было —
 * общая грань модулей, функциональная зона комнаты, стены и мебель.
 *
 * Три сущности принципиально разведены и не смешиваются:
 *  1) ModuleFootprint — физический габарит конструктивной секции (3 × 3 м);
 *  2) RoomZone — функциональный контур помещения; занимает один модуль или
 *     несколько состыкованных;
 *  3) ModuleJoint — тип соединения на общей грани двух модулей.
 * Из них ВЫЧИСЛЯЮТСЯ внешний контур этажа, стены, граф проходов и мебель —
 * ни цвет, ни DOM-отступы источником геометрической истины не являются.
 */

/** Назначение помещения. Расширяет набор v3: добавлены прихожая, кабинет,
 *  столовая и хозблок; цветовой кодировки у типов больше нет. */
export type RoomType =
  | "entryway"
  | "living"
  | "kitchen"
  | "dining"
  | "bedroom"
  | "office"
  | "bathroom"
  | "storage"
  | "stairs"
  | "terrace";

export interface RoomTypeMeta {
  id: RoomType;
  /** Полное название — показывается при выборе, в tooltip и aria-label. */
  label: string;
  /** Отапливаемое помещение — входит в общую площадь дома. */
  heated: boolean;
  /** Жилое помещение — входит в жилую площадь (прихожая, санузел,
   *  лестница и хозблок в неё НЕ входят). */
  living: boolean;
  /** Короткое описание для карточек действий. */
  hint: string;
}

/** Физический модуль-секция. Координаты — метры от нуля плана, шаг 1 м. */
export interface ModuleFootprint {
  id: string;
  floor: number;
  x: number;
  z: number;
  /** Комната, которой принадлежит модуль (RoomZone.id). */
  roomId: string;
}

export interface RoomZone {
  id: string;
  type: RoomType;
  floor: number;
  /** Модули, из которых сложено помещение. */
  moduleIds: string[];
}

/** Общая грань двух модулей. */
export type JointState = "closed" | "door" | "opening" | "open" | "unknown";

export interface ModuleAdjacency {
  aId: string;
  bId: string;
  floor: number;
  /** Ось общей грани: "x" — вертикальная стена, "z" — горизонтальная. */
  axis: "x" | "z";
  /** Координата грани по нормали. */
  at: number;
  /** Отрезок соприкосновения вдоль грани. */
  from: number;
  to: number;
}

export interface ModuleJoint extends ModuleAdjacency {
  state: JointState;
  /** Откуда взято состояние: вычислено планировкой или задано человеком. */
  source: "derived" | "manual";
}

/** Отрезок стены. Наружные строятся по свободным граням общего контура. */
export interface WallSegment {
  x1: number;
  z1: number;
  x2: number;
  z2: number;
  kind: "exterior" | "interior";
  /** Для внутренних — состояние стыка, которому стена принадлежит. */
  joint?: JointState;
}

/** Проём: дверь, окно или широкий проход. */
export interface Opening {
  id: string;
  kind: "door" | "window" | "entry" | "opening";
  /** Центр проёма и его ширина, м. */
  x: number;
  z: number;
  widthM: number;
  /** Ось стены, в которой проём. */
  axis: "x" | "z";
}

/* ------------------------------------------------------------------ */
/* Мебель                                                              */
/* ------------------------------------------------------------------ */

export type FurnitureKind =
  | "bed"
  | "nightstand"
  | "wardrobe"
  | "sofa"
  | "coffee-table"
  | "tv"
  | "kitchen-line"
  | "dining-table"
  | "chair"
  | "desk"
  | "office-chair"
  | "bath"
  | "shower"
  | "toilet"
  | "sink"
  | "washer"
  | "shelf"
  | "bench"
  | "stairs-run"
  | "armchair"
  | "dresser"
  | "round-table"
  | "kitchen-island"
  | "fridge"
  | "dryer"
  | "tv-unit"
  | "single-bed"
  | "double-sink"
  | "boiler"
  | "plant"
  | "wardrobe-rail"
  | "lounge"
  | "outdoor-table";

export interface FurnitureItem {
  id: string;
  kind: FurnitureKind;
  /** Левый-верхний угол габарита в метрах плана (до поворота). */
  x: number;
  z: number;
  /** Габарит в метрах при rotation = 0. */
  w: number;
  d: number;
  /** Поворот вокруг центра, градусы (0/90/180/270). */
  rotation: 0 | 90 | 180 | 270;
  /** Закреплено пользователем — пересчёт такой предмет не двигает.
   *  Задел под ручное редактирование, в MVP всегда false. */
  locked: boolean;
}

export type LayoutSource = "rule-template" | "reference-project" | "ai-suggestion" | "manual";

export interface FurnitureLayout {
  roomId: string;
  items: FurnitureItem[];
  /** Версия алгоритма — старый проект должен воспроизводиться. */
  algorithmVersion: string;
  /** Идентификатор пресета внутри типа комнаты. */
  presetId: string;
  /** Сколько всего допустимых пресетов у этой комнаты (для «Другой вариант»). */
  presetCount: number;
  score: number;
  source: LayoutSource;
  /** Планировщик не смог разместить всё — показываем нейтральный fallback. */
  fallback: boolean;
  warnings: string[];
}

/* ------------------------------------------------------------------ */
/* Участок                                                             */
/* ------------------------------------------------------------------ */

export type Compass = "north" | "east" | "south" | "west";
export type PlacementPreset = "west" | "center" | "east";

export interface SiteState {
  widthM: number;
  depthM: number;
  setbackM: number;
  /** Сторона участка, с которой заезд (не путать со входной дверью дома). */
  accessSide: Compass;
  /** Куда смотрит север на схеме. Схема рисуется «север вверх» по умолчанию. */
  northSide: Compass;
  /** Смещение нуля плана дома относительно левого-верхнего угла участка. */
  houseX: number;
  houseZ: number;
  /** Поворот дома, только дискретные значения. */
  houseRotation: 0 | 90 | 180 | 270;
  preset: PlacementPreset | null;
}

/* ------------------------------------------------------------------ */
/* Состояние конструктора                                              */
/* ------------------------------------------------------------------ */

export interface HouseState {
  modules: ModuleFootprint[];
  rooms: RoomZone[];
  /** Ручные состояния стыков поверх вычисленных (ключ — id пары). */
  jointOverrides: Record<string, JointState>;
  layouts: Record<string, FurnitureLayout>;
}

export interface AreaBreakdown {
  /** Все отапливаемые помещения дома, включая прихожую и санузлы. */
  totalAreaM2: number;
  /** Только жилые помещения. */
  livingAreaM2: number;
  terraceAreaM2: number;
  floors: number;
  moduleCount: number;
}

/** Результат доменной операции: либо новое состояние, либо внятная причина. */
export type TxResult =
  | { ok: true; house: HouseState; note: string }
  | { ok: false; error: string; needsConfirm?: boolean };
