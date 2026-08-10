/**
 * Проект пользователя: сериализация, восстановление и хранение.
 *
 * Ограничение среды (честно, без имитации серверного аккаунта): серверного
 * хранилища проектов на сайте нет, поэтому хранилище — localStorage.
 * Интерфейс хранилища (ProjectStore) отделён от реализации: когда появится
 * серверное сохранение, LocalProjectStore заменяется без правки экранов.
 */

import { DESIGN_PRESETS } from "../constructor/constants.ts";
import type { ModuleItem } from "../constructor/types.ts";
import { PRICE_VERSION } from "./pricing.ts";
import type { V3Project } from "./types.ts";

export const PROJECT_SCHEMA_VERSION = 1 as const;
const STORAGE_KEY = "ec_v3_project";

export function newProjectId(): string {
  // Достаточно уникально для локального проекта; без crypto — работает везде.
  return `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

export function createProject(now = new Date().toISOString()): V3Project {
  return {
    schemaVersion: PROJECT_SCHEMA_VERSION,
    id: newProjectId(),
    createdAt: now,
    updatedAt: now,
    answers: {},
    profile: null,
    basePlanId: null,
    appliedActions: [],
    modules: [],
    designId: DESIGN_PRESETS[0].id,
    plot: null,
    renderJobs: [],
    priceVersion: PRICE_VERSION,
    leadSubmitted: false,
  };
}

/** Строгая проверка при восстановлении: битое состояние не должно ронять UI. */
export function parseProject(raw: string): V3Project | null {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!data || typeof data !== "object") return null;
  const p = data as Partial<V3Project>;
  if (p.schemaVersion !== PROJECT_SCHEMA_VERSION) return null;
  if (typeof p.id !== "string" || !p.id) return null;
  if (!Array.isArray(p.modules)) return null;
  for (const m of p.modules as ModuleItem[]) {
    if (
      typeof m?.x !== "number" ||
      typeof m?.z !== "number" ||
      typeof m?.floor !== "number" ||
      typeof m?.role !== "string"
    ) {
      return null;
    }
  }
  const base = createProject();
  return {
    ...base,
    ...p,
    schemaVersion: PROJECT_SCHEMA_VERSION,
    answers: p.answers && typeof p.answers === "object" ? p.answers : {},
    appliedActions: Array.isArray(p.appliedActions) ? p.appliedActions : [],
    renderJobs: Array.isArray(p.renderJobs) ? p.renderJobs : [],
  } as V3Project;
}

export function serializeProject(project: V3Project): string {
  return JSON.stringify(project);
}

/* ------------------------------------------------------------------ */
/* Хранилище                                                            */
/* ------------------------------------------------------------------ */

export interface ProjectStore {
  /** Честное описание ограничения текущей реализации. */
  readonly limitation: string;
  load(): V3Project | null;
  save(project: V3Project): void;
  clear(): void;
}

export class LocalProjectStore implements ProjectStore {
  readonly limitation =
    "Проект сохраняется в этом браузере (localStorage). Ссылка для продолжения на другом устройстве появится после подключения серверного хранилища.";

  load(): V3Project | null {
    if (typeof window === "undefined") return null;
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      return raw ? parseProject(raw) : null;
    } catch {
      return null;
    }
  }

  save(project: V3Project): void {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(
        STORAGE_KEY,
        serializeProject({ ...project, updatedAt: new Date().toISOString() }),
      );
    } catch {
      /* приватный режим — проект живёт в памяти вкладки */
    }
  }

  clear(): void {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* no-op */
    }
  }
}

export const projectStore: ProjectStore = new LocalProjectStore();
