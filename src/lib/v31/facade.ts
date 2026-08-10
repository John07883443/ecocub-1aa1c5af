/**
 * Фасадные стили и контракт генерации рендера.
 *
 * Здесь только данные и типы: внешний image API не вызывается, ключей в
 * клиенте нет, моковый результат за настоящий не выдаётся. Генерация в
 * интерфейсе помечена как будущая функция — включить её можно будет, когда
 * появится серверный провайдер (см. ImageRenderProvider ниже).
 *
 * Два результата принципиально разные и не подменяют друг друга:
 *  1) точная белая 3D-модель — строится из состояния проекта, источник правды;
 *  2) концептуальный AI-рендер — эмоциональная картинка выбранного стиля,
 *     не чертёж и не подтверждение конструктивной реализуемости.
 */

import type { AreaBreakdown, Compass, SiteState } from "./types.ts";

export const FACADE_CATALOG_VERSION = "v31-facades-1";

export interface FacadeStyle {
  id: string;
  name: string;
  description: string;
  /** Основной материал стен и акцент — для превью и брифа. */
  wallColor: string;
  accentColor: string;
  frameColor: string;
  roofColor: string;
  /** Доля дерева в фасаде, 0..1 — правило, а не свободный текст. */
  woodShare: number;
  /** Фрагменты для будущего prompt builder. */
  promptFragments: string[];
  negativeConstraints: string[];
}

/** Каталог: современные фасады с плоской кровлей, единая светлая гамма. */
export const FACADE_STYLES: FacadeStyle[] = [
  {
    id: "white-monolith",
    name: "Белый монолит",
    description: "Матовый белый фасад, строгая геометрия, тёмные рамы.",
    wallColor: "#f2f1ee",
    accentColor: "#e6e4df",
    frameColor: "#33352f",
    roofColor: "#e2e0da",
    woodShare: 0,
    promptFragments: ["matte white concrete facade", "flat roof", "dark slim window frames"],
    negativeConstraints: ["no pitched roof", "no additional floors", "no decorative ornaments"],
  },
  {
    id: "light-concrete",
    name: "Светлый бетон",
    description: "Архитектурный бетон светло-серого тона с крупными окнами.",
    wallColor: "#d9d7d2",
    accentColor: "#bfbdb7",
    frameColor: "#3a3c3a",
    roofColor: "#cfcdc8",
    woodShare: 0,
    promptFragments: ["light architectural concrete", "large glazing", "flat roof"],
    negativeConstraints: ["no pitched roof", "no brick", "no extra volumes"],
  },
  {
    id: "concrete-wood",
    name: "Бетон и планкен",
    description: "Светлый бетон с тёплыми деревянными вставками.",
    wallColor: "#d5d3cd",
    accentColor: "#b08a5c",
    frameColor: "#33352f",
    roofColor: "#c9c7c1",
    woodShare: 0.35,
    promptFragments: ["concrete facade with warm wood planken accents", "flat roof"],
    negativeConstraints: ["no log cabin look", "no pitched roof", "no geometry changes"],
  },
  {
    id: "white-wood",
    name: "Белый с деревом",
    description: "Белый фасад с локальными деревянными акцентами у входа.",
    wallColor: "#f0efeb",
    accentColor: "#c09a6b",
    frameColor: "#2f312c",
    roofColor: "#e4e2dc",
    woodShare: 0.2,
    promptFragments: ["white facade", "wooden entrance accent", "flat roof"],
    negativeConstraints: ["no pitched roof", "no added storey"],
  },
  {
    id: "graphite-hitech",
    name: "Графитовый хай-тек",
    description: "Тёмно-серый фасад, панорамное остекление, строгие линии.",
    wallColor: "#565a5f",
    accentColor: "#3d4145",
    frameColor: "#1f2124",
    roofColor: "#4a4e52",
    woodShare: 0,
    promptFragments: ["graphite grey facade", "panoramic glazing", "flat roof", "hi-tech"],
    negativeConstraints: ["no pitched roof", "no rustic materials"],
  },
  {
    id: "nordic-light",
    name: "Скандинавский свет",
    description: "Светлый минимализм, мягкие тёплые оттенки, дерево у террасы.",
    wallColor: "#eae7e0",
    accentColor: "#c8ac85",
    frameColor: "#3c3e39",
    roofColor: "#ddd9d1",
    woodShare: 0.25,
    promptFragments: ["nordic minimalism", "warm light facade", "wooden terrace deck"],
    negativeConstraints: ["no pitched roof", "no bright colors"],
  },
  {
    id: "grey-natural",
    name: "Серый с фактурами",
    description: "Комбинированный серый фасад с натуральными материалами.",
    wallColor: "#c6c4be",
    accentColor: "#8d8a83",
    frameColor: "#33352f",
    roofColor: "#b9b7b1",
    woodShare: 0.15,
    promptFragments: ["combined grey facade", "natural stone and wood textures", "flat roof"],
    negativeConstraints: ["no pitched roof", "no geometry changes"],
  },
];

export function findFacadeStyle(id: string | null): FacadeStyle | undefined {
  return id ? FACADE_STYLES.find((s) => s.id === id) : undefined;
}

/* ------------------------------------------------------------------ */
/* Бриф и провайдер                                                    */
/* ------------------------------------------------------------------ */

/** Структурированное задание на рендер — независимо от конкретной модели. */
export interface RenderBrief {
  projectId: string;
  styleId: string;
  catalogVersion: string;
  geometry: {
    floors: number;
    moduleCount: number;
    totalAreaM2: number;
    /** Силуэт первого этажа: ячейки «x,z». */
    footprint: string[];
    ceilingHeightM: number;
  };
  site: {
    widthM: number;
    depthM: number;
    accessSide: Compass;
    northSide: Compass;
    houseRotation: number;
  };
  /** Время суток и ракурс — единственное, что меняет настроение картинки. */
  mood: { lighting: "day" | "evening"; season: "summer" | "winter" };
  /** Контрольное изображение точной белой 3D-модели (data URL), если снято. */
  controlImage?: string;
  /** Что модели запрещено менять. */
  invariants: string[];
}

export type RenderJobState = "unavailable" | "queued" | "processing" | "done" | "failed";

export interface RenderJob {
  jobId: string;
  state: RenderJobState;
  resultUrl?: string;
  error?: string;
}

/**
 * Серверный контракт генерации. Реализации появятся, когда будет backend
 * с защищённым ключом, лимитами и журналом заданий; MCP-инструмент агента
 * продакшен-механизмом для посетителя сайта не является.
 */
export interface ImageRenderProvider {
  readonly id: string;
  readonly available: boolean;
  createJob(brief: RenderBrief): Promise<RenderJob>;
  getStatus(jobId: string): Promise<RenderJob>;
  getResult(jobId: string): Promise<RenderJob>;
}

/** Заглушка: честно сообщает, что генерация ещё не подключена. */
export class UnavailableRenderProvider implements ImageRenderProvider {
  readonly id = "not-connected";
  readonly available = false;
  private note =
    "Генерация фасада появится после подключения серверного сервиса. Сейчас доступна точная белая 3D-модель и подготовка задания для специалиста EcoCub.";

  async createJob(): Promise<RenderJob> {
    return { jobId: "", state: "unavailable", error: this.note };
  }
  async getStatus(jobId: string): Promise<RenderJob> {
    return { jobId, state: "unavailable", error: this.note };
  }
  async getResult(jobId: string): Promise<RenderJob> {
    return { jobId, state: "unavailable", error: this.note };
  }
}

export function activeImageProvider(): ImageRenderProvider {
  return new UnavailableRenderProvider();
}

/** Собрать бриф из фактического состояния проекта. */
export function buildRenderBrief(input: {
  projectId: string;
  styleId: string;
  areas: AreaBreakdown;
  footprint: string[];
  ceilingHeightM: number;
  site: SiteState;
  mood: RenderBrief["mood"];
  controlImage?: string;
}): RenderBrief {
  return {
    projectId: input.projectId,
    styleId: input.styleId,
    catalogVersion: FACADE_CATALOG_VERSION,
    geometry: {
      floors: input.areas.floors,
      moduleCount: input.areas.moduleCount,
      totalAreaM2: input.areas.totalAreaM2,
      footprint: input.footprint,
      ceilingHeightM: input.ceilingHeightM,
    },
    site: {
      widthM: input.site.widthM,
      depthM: input.site.depthM,
      accessSide: input.site.accessSide,
      northSide: input.site.northSide,
      houseRotation: input.site.houseRotation,
    },
    mood: input.mood,
    controlImage: input.controlImage,
    invariants: [
      "keep the exact number of floors",
      "keep the module count and footprint silhouette",
      "keep flat roof",
      "do not move the entrance or add volumes",
    ],
  };
}
