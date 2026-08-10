/**
 * Посадка дома на участок: точная условная схема в масштабе.
 *
 * Всё геометрически: прямоугольный участок, нормативный отступ от границ,
 * след дома — объединение модулей первого этажа. Никакой генеративной
 * магии; юридические ограничения по официальным данным не проверяются,
 * поэтому интерфейс обязан показывать PLOT_DISCLAIMER.
 */

import { MODULE_SIDE_M } from "../constructor/constants.ts";
import type { ModuleItem } from "../constructor/types.ts";
import type { EntranceSide, PlotSpec } from "./types.ts";

export const DEFAULT_SETBACK_M = 3;
export const MIN_PLOT_SIDE_M = 12;
export const MAX_PLOT_SIDE_M = 100;

export const PLOT_DISCLAIMER =
  "Схема посадки предварительная: нормативные отступы, красные линии и градостроительные ограничения по официальным данным не проверялись — размещение подтверждает специалист EcoCub.";

export const ENTRANCE_LABELS: Record<EntranceSide, string> = {
  north: "Север",
  east: "Восток",
  south: "Юг",
  west: "Запад",
  unknown: "Не знаю",
};

/** Габарит дома по модулям первого этажа (в метрах, с нормализацией к нулю). */
export function houseBounds(modules: ModuleItem[]): {
  minX: number;
  minZ: number;
  w: number;
  d: number;
} {
  const ground = modules.filter((m) => m.floor === 0);
  if (!ground.length) return { minX: 0, minZ: 0, w: 0, d: 0 };
  const minX = Math.min(...ground.map((m) => m.x));
  const maxX = Math.max(...ground.map((m) => m.x + MODULE_SIDE_M));
  const minZ = Math.min(...ground.map((m) => m.z));
  const maxZ = Math.max(...ground.map((m) => m.z + MODULE_SIDE_M));
  return { minX, minZ, w: maxX - minX, d: maxZ - minZ };
}

export function defaultPlot(modules: ModuleItem[]): PlotSpec {
  const b = houseBounds(modules);
  const widthM = Math.max(20, Math.ceil(b.w + DEFAULT_SETBACK_M * 2 + 6));
  const depthM = Math.max(25, Math.ceil(b.d + DEFAULT_SETBACK_M * 2 + 10));
  const spec: PlotSpec = {
    widthM,
    depthM,
    setbackM: DEFAULT_SETBACK_M,
    entranceSide: "south",
    houseX: 0,
    houseZ: 0,
  };
  return { ...spec, ...centerHouse(modules, spec) };
}

/** Центрирование дома на участке (со сдвигом от въезда). */
export function centerHouse(
  modules: ModuleItem[],
  plot: PlotSpec,
): { houseX: number; houseZ: number } {
  const b = houseBounds(modules);
  return {
    houseX: Math.round((plot.widthM - b.w) / 2 - b.minX),
    houseZ: Math.round((plot.depthM - b.d) / 2 - b.minZ),
  };
}

/** Проверка посадки: дом целиком внутри участка с учётом отступа. */
export function placementFits(modules: ModuleItem[], plot: PlotSpec): boolean {
  const b = houseBounds(modules);
  if (!b.w) return false;
  const x0 = b.minX + plot.houseX;
  const z0 = b.minZ + plot.houseZ;
  return (
    x0 >= plot.setbackM &&
    z0 >= plot.setbackM &&
    x0 + b.w <= plot.widthM - plot.setbackM &&
    z0 + b.d <= plot.depthM - plot.setbackM
  );
}

/** Допустимый диапазон смещения дома по участку. */
export function placementRange(
  modules: ModuleItem[],
  plot: PlotSpec,
): { minX: number; maxX: number; minZ: number; maxZ: number } {
  const b = houseBounds(modules);
  return {
    minX: plot.setbackM - b.minX,
    maxX: plot.widthM - plot.setbackM - b.w - b.minX,
    minZ: plot.setbackM - b.minZ,
    maxZ: plot.depthM - plot.setbackM - b.d - b.minZ,
  };
}

/** Влезает ли дом на участок в принципе (в любом положении, без поворота). */
export function houseFitsPlot(modules: ModuleItem[], plot: PlotSpec): boolean {
  const b = houseBounds(modules);
  return (
    b.w > 0 && b.w <= plot.widthM - plot.setbackM * 2 && b.d <= plot.depthM - plot.setbackM * 2
  );
}

export function clampPlotSide(v: number): number {
  return Math.max(MIN_PLOT_SIDE_M, Math.min(MAX_PLOT_SIDE_M, Math.round(v)));
}
