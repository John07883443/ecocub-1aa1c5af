/**
 * Проект v3.1: единое сериализуемое состояние (дом + участок + фасад)
 * и его хранение.
 *
 * Дом и посадка живут в ОДНОМ состоянии и на одном экране, поэтому проект
 * восстанавливается целиком: комнаты, мебель, участок и положение дома.
 * Хранилище — localStorage (серверного пока нет), интерфейс отделён от
 * реализации, ключ отдельный от v3 — версии не мешают друг другу.
 */

import { CEILING_HEIGHT_M } from "./constants.ts";
import { emptyHouse } from "./actions.ts";
import { relayoutAll } from "./furniture.ts";
import { defaultSite } from "./site.ts";
import type { HouseState, SiteState } from "./types.ts";
import type { ClientHomeProfile } from "../v3/types.ts";

export const PROJECT31_SCHEMA_VERSION = 2 as const;
const STORAGE_KEY = "ec_v31_project";

export interface V31Project {
  schemaVersion: typeof PROJECT31_SCHEMA_VERSION;
  id: string;
  createdAt: string;
  updatedAt: string;
  /** Ответы квиза и профиль — переносятся из v3, если человек его проходил. */
  answers: Record<string, string | string[]>;
  freeText?: string;
  profile: ClientHomeProfile | null;
  basePlanId: string | null;
  house: HouseState;
  site: SiteState;
  /** Идентификатор выбранного фасадного стиля (каталог — facade.ts). */
  facadeStyleId: string | null;
  /** Высота потолков — фиксированная характеристика продукта. */
  ceilingHeightM: number;
  appliedActions: string[];
  leadSubmitted: boolean;
}

export function newProjectId(): string {
  return `q${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

export function createProject31(now = new Date().toISOString()): V31Project {
  return {
    schemaVersion: PROJECT31_SCHEMA_VERSION,
    id: newProjectId(),
    createdAt: now,
    updatedAt: now,
    answers: {},
    profile: null,
    basePlanId: null,
    house: emptyHouse(),
    site: defaultSite(),
    facadeStyleId: null,
    ceilingHeightM: CEILING_HEIGHT_M,
    appliedActions: [],
    leadSubmitted: false,
  };
}

/**
 * Разбор сохранённого проекта. Строгий, но снисходительный к старым записям:
 * недостающая высота потолков подставляется константой, отсутствующая
 * меблировка пересчитывается — старый проект не должен ломаться.
 */
export function parseProject31(raw: string): V31Project | null {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!data || typeof data !== "object") return null;
  const p = data as Partial<V31Project>;
  if (p.schemaVersion !== PROJECT31_SCHEMA_VERSION) return null;
  if (typeof p.id !== "string" || !p.id) return null;

  const house = p.house;
  if (!house || !Array.isArray(house.modules) || !Array.isArray(house.rooms)) return null;
  for (const m of house.modules) {
    if (
      typeof m?.x !== "number" ||
      typeof m?.z !== "number" ||
      typeof m?.floor !== "number" ||
      typeof m?.id !== "string" ||
      typeof m?.roomId !== "string"
    ) {
      return null;
    }
  }

  const base = createProject31();
  const restoredHouse: HouseState = {
    modules: house.modules,
    rooms: house.rooms,
    jointOverrides: house.jointOverrides ?? {},
    layouts: house.layouts ?? {},
  };

  return {
    ...base,
    ...p,
    schemaVersion: PROJECT31_SCHEMA_VERSION,
    answers: p.answers && typeof p.answers === "object" ? p.answers : {},
    appliedActions: Array.isArray(p.appliedActions) ? p.appliedActions : [],
    site: { ...defaultSite(), ...(p.site ?? {}) },
    ceilingHeightM: CEILING_HEIGHT_M,
    // Мебель — производный слой: если её нет или версия алгоритма другая,
    // безопаснее пересчитать, чем показать пустые комнаты.
    house: Object.keys(restoredHouse.layouts).length ? restoredHouse : relayoutAll(restoredHouse),
  };
}

export function serializeProject31(project: V31Project): string {
  return JSON.stringify(project);
}

export interface Project31Store {
  readonly limitation: string;
  load(): V31Project | null;
  save(project: V31Project): void;
  clear(): void;
}

export class LocalProject31Store implements Project31Store {
  readonly limitation =
    "Проект сохраняется в этом браузере (localStorage). Ссылка для продолжения на другом устройстве появится после подключения серверного хранилища.";

  load(): V31Project | null {
    if (typeof window === "undefined") return null;
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      return raw ? parseProject31(raw) : null;
    } catch {
      return null;
    }
  }

  save(project: V31Project): void {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(
        STORAGE_KEY,
        serializeProject31({ ...project, updatedAt: new Date().toISOString() }),
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

export const project31Store: Project31Store = new LocalProject31Store();
