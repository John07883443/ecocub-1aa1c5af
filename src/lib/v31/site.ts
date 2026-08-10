/**
 * Участок v3.1: тот же холст, что и дом, — отдельного экрана посадки нет.
 *
 * Дом хранится один раз: посадка — это трансформация (смещение и дискретный
 * поворот) единого контура относительно участка, а не вторая копия геометрии
 * комнат. Поэтому редактирование комнат не сбрасывает посадку, а перемещение
 * дома не меняет планировку.
 */

import { bounds } from "./geometry.ts";
import type { Compass, ModuleFootprint, PlacementPreset, SiteState } from "./types.ts";

export const DEFAULT_SETBACK_M = 3;
export const MIN_SITE_SIDE_M = 12;
export const MAX_SITE_SIDE_M = 100;

export const COMPASS_LABELS: Record<Compass, string> = {
  north: "Север",
  east: "Восток",
  south: "Юг",
  west: "Запад",
};

export const PLACEMENT_LABELS: Record<PlacementPreset, string> = {
  west: "К западной границе",
  center: "По центру",
  east: "К восточной границе",
};

export const SITE_DISCLAIMER =
  "Схема предварительная: нормативные отступы, красные линии и градостроительные ограничения по официальным данным не проверялись — размещение подтверждает специалист EcoCub.";

export const defaultSite = (): SiteState => ({
  widthM: 30,
  depthM: 40,
  setbackM: DEFAULT_SETBACK_M,
  accessSide: "south",
  northSide: "north",
  houseX: 9,
  houseZ: 12,
  houseRotation: 0,
  preset: "center",
});

/** Габарит дома с учётом поворота посадки. */
export function houseSize(
  modules: ModuleFootprint[],
  rotation: SiteState["houseRotation"],
): { w: number; d: number } {
  const b = bounds(modules, 0);
  return rotation === 90 || rotation === 270 ? { w: b.d, d: b.w } : { w: b.w, d: b.d };
}

/** Дом целиком внутри участка с учётом отступов. */
export function placementFits(modules: ModuleFootprint[], site: SiteState): boolean {
  const s = houseSize(modules, site.houseRotation);
  if (!s.w) return false;
  return (
    site.houseX >= site.setbackM - 1e-9 &&
    site.houseZ >= site.setbackM - 1e-9 &&
    site.houseX + s.w <= site.widthM - site.setbackM + 1e-9 &&
    site.houseZ + s.d <= site.depthM - site.setbackM + 1e-9
  );
}

/** Помещается ли дом на участок хоть в каком-то положении. */
export function houseFitsSite(modules: ModuleFootprint[], site: SiteState): boolean {
  const s = houseSize(modules, site.houseRotation);
  return (
    s.w > 0 &&
    s.w <= site.widthM - site.setbackM * 2 + 1e-9 &&
    s.d <= site.depthM - site.setbackM * 2 + 1e-9
  );
}

/** Допустимый диапазон положения дома. */
export function placementRange(modules: ModuleFootprint[], site: SiteState) {
  const s = houseSize(modules, site.houseRotation);
  return {
    minX: site.setbackM,
    maxX: Math.max(site.setbackM, site.widthM - site.setbackM - s.w),
    minZ: site.setbackM,
    maxZ: Math.max(site.setbackM, site.depthM - site.setbackM - s.d),
  };
}

/** Расстояния от дома до границ участка, м. */
export function setbacks(modules: ModuleFootprint[], site: SiteState) {
  const s = houseSize(modules, site.houseRotation);
  return {
    west: site.houseX,
    north: site.houseZ,
    east: site.widthM - (site.houseX + s.w),
    south: site.depthM - (site.houseZ + s.d),
  };
}

/**
 * Быстрые положения. Схема рисуется «север вверх», поэтому запад — левая
 * граница, восток — правая; по глубине дом ставится ближе к въезду, чтобы
 * подъезд был короче, но не ближе нормативного отступа.
 */
export function applyPreset(
  modules: ModuleFootprint[],
  site: SiteState,
  preset: PlacementPreset,
): SiteState {
  const s = houseSize(modules, site.houseRotation);
  const range = placementRange(modules, site);
  const x =
    preset === "west"
      ? range.minX
      : preset === "east"
        ? range.maxX
        : clamp((site.widthM - s.w) / 2, range.minX, range.maxX);

  // По глубине держим дом в глубине участка от стороны въезда — двор перед домом.
  const z =
    site.accessSide === "north"
      ? clamp(site.depthM * 0.45, range.minZ, range.maxZ)
      : site.accessSide === "south"
        ? clamp(site.depthM * 0.55 - s.d, range.minZ, range.maxZ)
        : clamp((site.depthM - s.d) / 2, range.minZ, range.maxZ);

  return { ...site, houseX: round(x), houseZ: round(z), preset };
}

/** Вернуть дом в допустимую зону после изменения габаритов или участка. */
export function reclampPlacement(modules: ModuleFootprint[], site: SiteState): SiteState {
  if (!modules.length) return site;
  if (site.preset) return applyPreset(modules, site, site.preset);
  const range = placementRange(modules, site);
  return {
    ...site,
    houseX: clamp(site.houseX, range.minX, range.maxX),
    houseZ: clamp(site.houseZ, range.minZ, range.maxZ),
  };
}

export function clampSiteSide(v: number): number {
  return Math.max(MIN_SITE_SIDE_M, Math.min(MAX_SITE_SIDE_M, Math.round(v)));
}

/** Координаты модуля в системе участка (с учётом поворота дома). */
export function moduleOnSite(
  m: Pick<ModuleFootprint, "x" | "z">,
  modules: ModuleFootprint[],
  site: SiteState,
  sideM: number,
): { x: number; z: number; w: number; d: number } {
  const b = bounds(modules, 0);
  const localX = m.x - b.minX;
  const localZ = m.z - b.minZ;
  switch (site.houseRotation) {
    case 90:
      return {
        x: site.houseX + (b.d - localZ - sideM),
        z: site.houseZ + localX,
        w: sideM,
        d: sideM,
      };
    case 180:
      return {
        x: site.houseX + (b.w - localX - sideM),
        z: site.houseZ + (b.d - localZ - sideM),
        w: sideM,
        d: sideM,
      };
    case 270:
      return {
        x: site.houseX + localZ,
        z: site.houseZ + (b.w - localX - sideM),
        w: sideM,
        d: sideM,
      };
    default:
      return { x: site.houseX + localX, z: site.houseZ + localZ, w: sideM, d: sideM };
  }
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function round(v: number): number {
  return Math.round(v * 2) / 2;
}
