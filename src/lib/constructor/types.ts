// Ядро конструктора домов EcoCub.
// Дом собирается из одинаковых кубиков-модулей 3 × 3 м, высота 3,15 м.
// Модуль ставится с шагом 1 м (треть стороны кубика): соседние модули могут
// смещаться друг относительно друга, давая ступенчатые фасады и консоли.
// Из кубиков складываются I-, L-, П-, Т-, О-формы и дома в 1–3 этажа —
// как из конструктора LEGO.

export type Role = "living" | "bedroom" | "kitchen" | "bathroom" | "stairs" | "terrace";

export interface ModuleItem {
  id: string;
  /** X левого-верхнего угла модуля, в метрах от края участка (кратно 1 м). */
  x: number;
  /** Z левого-верхнего угла модуля, в метрах от края участка (кратно 1 м). */
  z: number;
  /** Этаж, 0 — первый. */
  floor: number;
  role: Role;
}

/** Точка на участке в метрах (кратно шагу установки). */
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
  /** Фотореалистичный рендер фасада (нейросеть). Может отсутствовать. */
  image?: string;
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
  role: Role;
}

export interface Template {
  id: string;
  name: string;
  shape: string;
  seeds: TemplateSeed[];
  /**
   * Идентификатор реального проекта из `src/lib/standards`, если шаблон
   * повторяет его раскладку. Отличает «настоящий дом, который можно взять за
   * основу» от абстрактной фигуры вроде «Куб».
   */
  reference?: string;
  /** Чем шаблон отличается от соседних — одной строкой для карточки. */
  note?: string;
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
