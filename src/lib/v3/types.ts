/**
 * Типы новой экспериментальной версии конструктора (/constructor-ai-v3).
 *
 * Здесь только данные и контракты — никакого React. Все файлы src/lib/v3
 * тестируются напрямую через `node --experimental-strip-types --test`,
 * поэтому импорты относительные и с расширением .ts.
 *
 * Терминология (важно не смешивать, см. CLAUDE.md и мастер-промпт V3):
 * - «ячейка» — клетка интерфейсной сетки 3 × 3 м (9 м²), в ней живёт один
 *   модуль-кубик конструктора;
 * - «заводской конструктивный модуль» — реальный блок производства EcoCub;
 *   его размеры и типы НЕ подтверждены данными в репозитории
 *   (см. DATA_REQUIRED_FROM_ECOCUB.md);
 * - «помещение» — комната, которая может занимать часть модуля или несколько.
 */

import type { ModuleItem, Role } from "../constructor/types.ts";

/* ------------------------------------------------------------------ */
/* Профиль клиента                                                     */
/* ------------------------------------------------------------------ */

export type OfficeNeed = "none" | "occasional" | "separate_room";
export type GuestNeed = "none" | "occasional" | "frequent";
export type StorageNeed = "basic" | "extended";
export type EntranceSide = "north" | "east" | "south" | "west" | "unknown";

export interface PlotProfile {
  exists?: boolean;
  widthM?: number;
  depthM?: number;
  entranceSide?: EntranceSide;
  terracePreference?: string;
}

/** Нормализованный профиль требований — единственный вход движка подбора. */
export interface ClientHomeProfile {
  adults?: number;
  children?: number;
  /** Минимально нужное число спален — обязательное поле жёсткого фильтра. */
  bedrooms: number;
  bathrooms?: number;
  officeNeed?: OfficeNeed;
  guestNeed?: GuestNeed;
  dog?: boolean;
  storageNeed?: StorageNeed;
  masterBedroom?: boolean;
  /** 0..1: важность приватных зон. */
  privacyPriority?: number;
  /** 0..1: важность большого общего пространства. */
  sharedSpacePriority?: number;
  futureProofing?: string[];
  /** Допустимая этажность; пусто/не задано — любая. */
  preferredFloors?: number[];
  targetArea?: { min?: number; max?: number };
  budget?: { min?: number; max?: number; currency: "RUB" };
  region?: string;
  desiredStart?: string;
  purpose?: string;
  plot?: PlotProfile;
  freeText?: string;
  /** Потребности, извлечённые из свободного текста (ключи из NEED_KEYWORDS). */
  extractedNeeds?: string[];
}

/* ------------------------------------------------------------------ */
/* Библиотека планировок                                               */
/* ------------------------------------------------------------------ */

export type PlanStatus = "built" | "approved" | "concept" | "needs_review";

export interface PlanCell {
  id: string;
  floor: number;
  /** Метры от нуля планировки (шаг 1 м, ячейка 3 × 3 м). */
  x: number;
  z: number;
  role: Role;
}

export interface PlanRoom {
  id: string;
  type: string;
  name: string;
  areaM2?: number;
  floor: number;
  moduleCellIds: string[];
}

export interface EcoCubPlan {
  id: string;
  slug: string;
  name: string;
  status: PlanStatus;
  /** Откуда взяты данные: пути в репозитории, карточки проектов. */
  sourceRefs: string[];
  description: string;

  /** Раскладка по ячейкам сетки 3×3 — стартовая конфигурация конструктора. */
  cells: PlanCell[];

  metrics: {
    grossAreaM2: number;
    heatedAreaM2?: number;
    terraceAreaM2?: number;
    floors: number;
    bedrooms: number;
    bathrooms: number;
    /** Подтверждённая цена «от» из карточки проекта, если есть. */
    confirmedPriceFrom?: number;
    priceVersion?: string;
  };

  rooms: PlanRoom[];

  constraints: {
    fixedElements: string[];
    forbiddenTransformations: string[];
  };

  fit: {
    minBedrooms: number;
    maxComfortablePeople: number;
    lifestyleTags: string[];
  };

  assets: {
    coverImage?: string;
    gallery?: string[];
  };

  /** true — часть данных не подтверждена EcoCub, показывать с оговоркой. */
  needsReview: boolean;
  reviewNotes?: string[];
}

/* ------------------------------------------------------------------ */
/* Подбор                                                              */
/* ------------------------------------------------------------------ */

export type VariantKind = "compact" | "balanced" | "spacious";

export interface ScoreBreakdown {
  key: string;
  label: string;
  /** 0..1 до умножения на вес. */
  value: number;
  weight: number;
}

export interface Recommendation {
  plan: EcoCubPlan;
  kind: VariantKind;
  score: number;
  breakdown: ScoreBreakdown[];
  /** Почему дом подходит этой семье — простыми словами. */
  reasons: string[];
  /** Честные компромиссы. */
  tradeoffs: string[];
  /** Что разрешено менять в конструкторе. */
  allowedChanges: string[];
  estimate: PriceEstimate;
}

/* ------------------------------------------------------------------ */
/* Цена                                                                */
/* ------------------------------------------------------------------ */

export interface PriceEstimate {
  /** Базовая оценка, ₽. */
  price: number;
  /** Диапазон неопределённости, ₽. */
  min: number;
  max: number;
  priceVersion: string;
  /** Что НЕ входит — показывается пользователю всегда. */
  disclaimer: string;
}

/* ------------------------------------------------------------------ */
/* Участок                                                             */
/* ------------------------------------------------------------------ */

export interface PlotSpec {
  widthM: number;
  depthM: number;
  /** Нормативный отступ дома от границ, м. */
  setbackM: number;
  entranceSide: EntranceSide;
  /** Смещение нулевой точки планировки от левого-верхнего угла участка, м. */
  houseX: number;
  houseZ: number;
}

/* ------------------------------------------------------------------ */
/* AI-рендер                                                           */
/* ------------------------------------------------------------------ */

export interface RenderRequest {
  projectId: string;
  /** Неизменяемые признаки — контроль соответствия результата. */
  invariants: {
    floors: number;
    moduleCount: number;
    /** Силуэт первого этажа: список ячеек «x,z». */
    footprint: string[];
  };
  facade: {
    presetId: string;
    presetName: string;
    lighting: "day" | "evening";
    season: "summer" | "winter";
    environment: string;
  };
  /** Текстовый бриф для генеративной модели. */
  prompt: string;
}

export type RenderJobState = "queued" | "processing" | "done" | "failed" | "manual";

export interface RenderJob {
  jobId: string;
  state: RenderJobState;
  /** Для manual-режима: готовое задание, которое запускается через Claude/MCP. */
  manualTask?: RenderRequest;
  resultUrl?: string;
  note?: string;
}

export interface RenderProvider {
  readonly id: string;
  /** Честное описание режима — показывается в интерфейсе. */
  readonly modeNote: string;
  createRender(input: RenderRequest): Promise<RenderJob>;
  getRenderStatus(jobId: string): Promise<RenderJob>;
}

/* ------------------------------------------------------------------ */
/* Проект пользователя                                                 */
/* ------------------------------------------------------------------ */

export interface V3Project {
  schemaVersion: 1;
  id: string;
  createdAt: string;
  updatedAt: string;
  /** Сырые ответы квиза и lifestyle-вопросов. */
  answers: Record<string, string | string[]>;
  freeText?: string;
  profile: ClientHomeProfile | null;
  basePlanId: string | null;
  /** Применённые крупные действия — история для объяснений и менеджера. */
  appliedActions: string[];
  modules: ModuleItem[];
  designId: string;
  plot: PlotSpec | null;
  renderJobs: RenderJob[];
  priceVersion: string;
  leadSubmitted: boolean;
}

/* ------------------------------------------------------------------ */
/* Реестр версий                                                       */
/* ------------------------------------------------------------------ */

export interface ConstructorVersion {
  id: string;
  title: string;
  route: string;
  status: "current" | "experiment" | "archive" | "development";
  description: string;
  createdAt?: string;
}
