import type { FinishCategory, RoomType } from "../grammar/index.ts";

export type Side = "N" | "E" | "S" | "W";
export type Rotation = 0 | 90 | 180 | 270;
export type Tier = 1 | 2;

/** Модуль 3200 × 3420 на участке. Координаты в мм: x — на восток, y — на север. */
export interface ModulePlacement {
  id: string;
  xMm: number;
  yMm: number;
  rot: Rotation;
  /** Ярус. Тип допускает только 1 | 2, но из голоса/текста может прийти что угодно — проверяют правила. */
  tier: number;
  roomId: string;
}

export interface Room {
  id: string;
  type: RoomType;
  moduleIds: string[];
  tier: number;
  /** Что помещается внутри модуля перегородками 125 (санузел, бойлер, тамбур). */
  subRooms?: string[];
}

export type OpeningKind = "window" | "entrance" | "internal-door";

export interface Opening {
  id: string;
  moduleId: string;
  roomId: string;
  face: Side;
  kind: OpeningKind;
  widthMm: number;
  heightMm: number;
  /** Отступ от начала грани (от меньшей координаты), мм. */
  offsetMm: number;
  /** Окно поставил или поправил человек — при пересборке проёмов сохраняется. */
  userSet?: boolean;
}

export interface Terrace {
  side: Side;
  /** Настил в вырезах прямоугольника застройки. */
  notchM2: number;
  /** Добавочный настил вдоль грани общей комнаты. */
  deckM2: number;
  totalM2: number;
}

export interface Plot {
  widthM: number;
  depthM: number;
  /** Куда смотрит север относительно оси y участка, градусы. 0 — север вверх. */
  northDeg?: number;
  entrySide?: Side;
  /** Отступ от границ, мм. По умолчанию — из грамматики (3000, предварительно). */
  setbackMm?: number;
}

/** Посадка дома на участке: смещение и поворот; locked — человек поставил сам. */
export interface PlotPlacement {
  xMm: number;
  yMm: number;
  rotationDeg: 0 | 90 | 180 | 270;
  locked: boolean;
}

export interface Finishes {
  styleId: string | null;
  facade: string;
  roof: string;
  windowFrames: string;
  interior: string;
}

export interface Project {
  schemaVersion: 4;
  id: string;
  modules: ModulePlacement[];
  rooms: Room[];
  openings: Opening[];
  terrace: Terrace;
  plot: Plot | null;
  /** Положение начала координат дома на участке, мм. */
  placementMm: { xMm: number; yMm: number };
  /** Поворот дома относительно участка и признак ручной посадки. */
  rotationDeg?: PlotPlacement["rotationDeg"];
  placementLocked?: boolean;
  finishes: Finishes;
  yearRound: boolean;
  /** Материалы чистовой отделки: включить в расчёт (≈15 тыс./м²) или свои. По умолчанию — включены. */
  finishingMaterials?: "included" | "own";
  /** Профиль стиля из слов и референсов человека (см. style.ts). */
  styleProfile?: import("./style.ts").StyleProfile;
}

export interface Brief {
  bedrooms: number;
  bathrooms?: number;
  tiers: 1 | 2 | "any";
  study?: boolean;
  kitchenLiving: "compact" | "large";
  yearRound: boolean;
  plot?: Plot;
  budgetRub?: { max: number };
  styleHints?: string[];
  mustHave?: string[];
  notes?: string;
}

export type RuleLevel = "hard" | "soft" | "info";

export interface RuleResult {
  ruleId: string;
  level: RuleLevel;
  ok: boolean;
  /** Объяснение человеку, по-русски, без кодов. */
  message: string;
  source: string;
  subject?: string;
  /** Не нарушение, но пункт, который обязан проверить проектировщик. */
  review?: boolean;
}

export interface Range {
  min: number;
  max: number;
}

export type { FinishCategory, RoomType };
