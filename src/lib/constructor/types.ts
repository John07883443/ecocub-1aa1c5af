// Ядро конструктора домов EcoCub.
// Дом собирается из одинаковых модулей 3 × 6 м, высота 3,15 м.
// Сетка участка — с шагом 3 м (сторона одной ячейки). Один модуль занимает
// две смежные ячейки, поэтому из модулей складываются I-, L-, П-, Т-, О-формы
// и дома в 1–2 этажа — как из конструктора LEGO.

export type Orientation = "h" | "v";
// "h" — модуль вытянут вдоль оси X: 6 м по X (2 ячейки), 3 м по Z (1 ячейка).
// "v" — модуль вытянут вдоль оси Z: 3 м по X (1 ячейка), 6 м по Z (2 ячейки).

export type Role = "living" | "bedroom" | "kitchen" | "bathroom" | "stairs" | "terrace";

export interface ModuleItem {
  id: string;
  /** Столбец левого-верхнего (минимального) угла модуля в ячейках сетки. */
  x: number;
  /** Ряд левого-верхнего (минимального) угла модуля в ячейках сетки. */
  z: number;
  /** Этаж, 0 — первый. */
  floor: number;
  orient: Orientation;
  role: Role;
}

export interface Cell {
  x: number;
  z: number;
}

export interface RoleMeta {
  id: Role;
  label: string;
  /** Отапливаемая жилая площадь (входит в основную стоимость). */
  heated: boolean;
  /** Цвет-метка на плане (hex). */
  plan: string;
  /** Цвет пола модуля в 3D (hex). */
  floor3d: string;
}

export interface DesignPreset {
  id: string;
  name: string;
  description: string;
  /** Цвет стен (hex). */
  wall: string;
  wallRoughness: number;
  wallMetalness: number;
  /** Цвет кровли / карнизов (hex). */
  roof: string;
  /** Цвет остекления (hex). */
  glass: string;
  /** Оттенок газона участка (hex). */
  ground: string;
}

/** Готовый пресет-планировка: точка старта, которую пользователь потом правит. */
export interface TemplateSeed {
  x: number;
  z: number;
  floor: number;
  orient: Orientation;
  role: Role;
}

export interface Template {
  id: string;
  name: string;
  shape: string;
  seeds: TemplateSeed[];
}

export interface HouseStats {
  moduleCount: number;
  floors: number;
  heatedArea: number;
  terraceArea: number;
  totalArea: number;
  footprintArea: number;
  plotArea: number;
  plotUsedPct: number;
  price: number;
  bedrooms: number;
  kitchens: number;
  bathrooms: number;
  livingRooms: number;
}
