/**
 * Контракт запроса на AI-планировку и его нормализация.
 *
 * Клиент присылает только геометрию и программу помещений; промпт, модель и
 * ключи живут на сервере. Всё, что приходит из браузера, проверяется здесь —
 * ни один параметр не идёт в провайдера «как есть».
 */

import { MODULE_SIDE_M } from "../constructor/constants.ts";
import type { ModuleItem, Role } from "../constructor/types.ts";
import type { EntranceSide } from "./footprint.ts";
import { EXTRA_ROOMS, type ExtraRoom, type LayoutProgram } from "./prompt.ts";

/** То, что приходит с фронта. */
export interface AiLayoutRequestInput {
  modules: Array<{ id?: string; x: number; z: number; floor: number }>;
  bedrooms: number;
  bathrooms: number;
  residents?: number;
  extraRooms?: string[];
  entrance?: string | null;
}

export interface NormalizedRequest {
  modules: ModuleItem[];
  program: LayoutProgram;
}

const ENTRANCES: EntranceSide[] = ["north", "east", "south", "west"];
/** Разумный потолок: больше секций конструктор всё равно не даёт собрать. */
const MAX_MODULES = 60;

export type NormalizeResult =
  | { ok: true; value: NormalizedRequest }
  | { ok: false; reason: string };

/**
 * Проверка и приведение входа. Координаты обязаны быть кратны половине метра
 * (шаг сетки конструктора) — это отсекает и мусор, и попытки подсунуть
 * произвольную геометрию, под которую исходник не построится.
 */
export function normalizeRequest(input: unknown): NormalizeResult {
  if (!input || typeof input !== "object") return { ok: false, reason: "bad_payload" };
  const raw = input as AiLayoutRequestInput;

  if (!Array.isArray(raw.modules) || raw.modules.length === 0) {
    return { ok: false, reason: "no_modules" };
  }
  if (raw.modules.length > MAX_MODULES) return { ok: false, reason: "too_many_modules" };

  const modules: ModuleItem[] = [];
  for (const [i, m] of raw.modules.entries()) {
    if (
      typeof m?.x !== "number" ||
      typeof m?.z !== "number" ||
      typeof m?.floor !== "number" ||
      !Number.isFinite(m.x) ||
      !Number.isFinite(m.z)
    ) {
      return { ok: false, reason: "bad_module" };
    }
    if (!isOnGrid(m.x) || !isOnGrid(m.z)) return { ok: false, reason: "off_grid" };
    if (m.floor < 0 || m.floor > 2) return { ok: false, reason: "bad_floor" };
    modules.push({
      id: typeof m.id === "string" && m.id ? m.id.slice(0, 40) : `m${i}`,
      x: m.x,
      z: m.z,
      floor: Math.round(m.floor),
      // Роль в планировке не участвует: модули универсальные.
      role: "living" as Role,
    });
  }

  if (!modules.some((m) => m.floor === 0)) return { ok: false, reason: "no_ground_floor" };

  // Пересечения на этаже — признак подделанного запроса.
  for (let i = 0; i < modules.length; i += 1) {
    for (let j = i + 1; j < modules.length; j += 1) {
      const a = modules[i];
      const b = modules[j];
      if (a.floor !== b.floor) continue;
      const ox = Math.min(a.x + MODULE_SIDE_M, b.x + MODULE_SIDE_M) - Math.max(a.x, b.x);
      const oz = Math.min(a.z + MODULE_SIDE_M, b.z + MODULE_SIDE_M) - Math.max(a.z, b.z);
      if (ox > 1e-9 && oz > 1e-9) return { ok: false, reason: "overlapping_modules" };
    }
  }

  const entrance =
    typeof raw.entrance === "string" && ENTRANCES.includes(raw.entrance as EntranceSide)
      ? (raw.entrance as EntranceSide)
      : null;

  const extraRooms = Array.isArray(raw.extraRooms)
    ? (raw.extraRooms.filter((r): r is ExtraRoom =>
        EXTRA_ROOMS.includes(r as ExtraRoom),
      ) as ExtraRoom[])
    : [];

  return {
    ok: true,
    value: {
      modules,
      program: {
        bedrooms: Number.isFinite(raw.bedrooms) ? Math.round(raw.bedrooms) : 2,
        bathrooms: Number.isFinite(raw.bathrooms) ? Math.round(raw.bathrooms) : 1,
        residents: Number.isFinite(raw.residents as number)
          ? Math.round(raw.residents as number)
          : undefined,
        extraRooms,
        entrance,
      },
    },
  };
}

function isOnGrid(v: number): boolean {
  return Math.abs(v * 2 - Math.round(v * 2)) < 1e-6;
}

/**
 * Канонический вид запроса: одинаковая конфигурация даёт одинаковую строку
 * независимо от порядка модулей и лишних полей. На ней строится
 * идемпотентный ключ, чтобы повтор не списывал кредиты второй раз.
 */
export function canonicalKeySource(
  value: NormalizedRequest,
  model: string,
  promptVersion: string,
): string {
  const modules = value.modules
    .map((m) => `${m.floor}:${m.x}:${m.z}`)
    .sort()
    .join("|");
  const p = value.program;
  const extra = [...p.extraRooms].sort().join(",");
  return [
    `model=${model}`,
    `prompt=${promptVersion}`,
    `modules=${modules}`,
    `bed=${p.bedrooms}`,
    `bath=${p.bathrooms}`,
    `extra=${extra}`,
    `entrance=${p.entrance ?? "auto"}`,
  ].join(";");
}
