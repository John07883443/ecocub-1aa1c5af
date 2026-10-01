/**
 * Типизированный доступ к грамматике v4. Числа живут в JSON, код только читает.
 * Новый тип помещения или правка допуска — запись в modules.json плюс тест.
 */
import modulesJson from "./modules.json" with { type: "json" };
import finishesJson from "./finishes.json" with { type: "json" };

export type RoomType = "bedroom" | "kitchen-living" | "wet-core" | "study" | "hall" | "corridor";
export type Confidence = "album" | "owner" | "derived" | "assumption";
export type FinishCategory = "facade" | "roof" | "windowFrames" | "interior";

export interface RoomTypeSpec {
  id: RoomType;
  label: string;
  modules: { min: number; max: number };
  partitionsMm?: number[];
  needs: {
    window?: boolean;
    windowHeightsMm?: number[];
    adjacentTo?: RoomType[];
    minExteriorFaces?: number;
    preferredExteriorFaces?: number;
    riser?: boolean;
    tier?: 1 | 2;
    aboveRoom?: RoomType;
  };
  evidence: string[];
  reviewNote?: string;
}

export interface Grammar {
  version: string;
  module: {
    id: string;
    externalMm: { w: number; d: number; h: number };
    wallMm: number;
    clearMm: { w: number; d: number; h: number };
    clearAreaM2: number;
    warmContourAreaM2: number;
    rotations: number[];
    source: string;
    confidence: Confidence;
  };
  joints: {
    id: "shared-wall-210" | "back-to-back-420";
    wallMm: number;
    merges: boolean;
    areaGainM2: number;
    minContactMm: number;
    source: string;
    confidence: Confidence;
  }[];
  placement: { snapMm: number; preferredOffsetsMm: number[]; minContactMm: number };
  tiers: {
    maxTiers: number;
    upperShift: "free";
    upperSnapMm: number;
    maxOverhangMm: number;
    overhangWithColumnMm: number | null;
    minSupportFraction: number;
  };
  openings: {
    heightsMm: number[];
    door: { widthMm: number; heightMm: number };
    commonDoorWidthsMm: number[];
    slotWidthMm: number;
    cornerPierMm: number;
  };
  partitionsMm: { betweenRooms: number; wet: number };
  /** Заводской модуль = 2 кубика по длинной грани. */
  factoryModule: {
    cubes: number;
    externalMm: { w: number; d: number };
    joinFaceMm: number;
    unpairedPolicy: "review";
    unpairedPriceFactor: number;
    source: string;
  };
  transport: {
    cubesPerTruck: number;
    truckLengthsM: number[];
    defaultTruckLengthM: number;
    note: string;
  };
  site: { setbackMm: number };
  roomTypes: RoomTypeSpec[];
  softRules: { id: string; weight: number }[];
}

export interface FinishItem {
  id: string;
  label: string;
  surchargePerM2: { min: number; max: number };
  placeholder: boolean;
}

export interface StyleSpec {
  id: string;
  label: string;
  aliases: string[];
  facade: string;
  roof: string;
  windowFrames: string;
  interior: string;
  /** Страна / регион, откуда стиль. */
  region: string;
  palette: string[];
  /** Пресет окон по умолчанию для стиля (см. WINDOW_PRESETS). */
  windows: "standard" | "large" | "floor-to-ceiling";
  /** Чего стиль у нас не получит из-за конструктива (скатная кровля и т. п.). */
  constraintNote?: string;
}

export interface FinishCatalog {
  version: string;
  status: string;
  categories: Record<FinishCategory, FinishItem[]>;
  styles: StyleSpec[];
}

export const GRAMMAR = modulesJson as unknown as Grammar;
export const FINISHES = finishesJson as unknown as FinishCatalog;

export function roomSpec(type: RoomType): RoomTypeSpec {
  const spec = GRAMMAR.roomTypes.find((r) => r.id === type);
  if (!spec) throw new Error(`Нет типа помещения ${type} в грамматике`);
  return spec;
}

export function findFinish(category: FinishCategory, id: string): FinishItem | undefined {
  return FINISHES.categories[category].find((f) => f.id === id);
}

/** Поиск стиля по id или по словам человека («скандинавский», «сканди»). */
export function findStyle(query: string): StyleSpec | undefined {
  const q = query.trim().toLowerCase().replace(/ё/g, "е");
  return (
    FINISHES.styles.find((s) => s.id === q) ??
    FINISHES.styles.find((s) => s.label.toLowerCase() === q) ??
    FINISHES.styles.find((s) => s.aliases.some((a) => a === q)) ??
    FINISHES.styles.find((s) => s.aliases.some((a) => q.includes(a)))
  );
}
