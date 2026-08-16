/**
 * Барометр цен Подмосковье — данные для раздела «Аналитика».
 *
 * Источник — content/analytics/price-barometer.json, статичный файл в
 * репозитории (см. docs/PRICE_BAROMETER_BRIEF.md). Только агрегированные
 * цифры: без ФИО и кадастровых номеров — сырые данные с полей отдельных
 * участков сюда сознательно не идут, см. бриф.
 *
 * Позже, если понадобится обновлять цифры без пересборки сайта, источник
 * стоит перенести в Supabase по аналогии с lib/projects.server.ts — на
 * MVP статичного JSON достаточно.
 */

import raw from "../../../content/analytics/price-barometer.json";

export type DirectionStatus = "active" | "in_development";

export type Direction = {
  id: string;
  label: string;
  highways: string[];
  status: DirectionStatus;
  villageIds: string[];
};

export type Promotion = {
  plotId: string;
  status: "available" | "sold" | "reserved";
  pricePerSotka?: number;
  note?: string;
};

export type VillageStats = {
  totalPlots: number;
  available: number;
  sold: number;
  reserved: number;
  withdrawn: number;
  withdrawnNote?: string;
  medianPricePerSotka: number;
  meanPricePerSotka: number;
  minPricePerSotka: number;
  maxPricePerSotka: number;
  medianPricePer10Sotok: number;
  currency: string;
};

export type Village = {
  name: string;
  directionId: string;
  district: string;
  developer: string | null;
  developerNote?: string;
  trackingMethod: string;
  dataSourceUrl: string;
  lastUpdated: string;
  stats: VillageStats;
  promotions: Promotion[];
};

type BarometerData = {
  directions: Direction[];
  villages: Record<string, Village>;
};

const data = raw as BarometerData;

export const directions: Direction[] = data.directions;
export const villages: Record<string, Village> = data.villages;

export function villagesForDirection(directionId: string): Village[] {
  const direction = directions.find((d) => d.id === directionId);
  if (!direction) return [];
  return direction.villageIds.map((id) => villages[id]).filter((v): v is Village => Boolean(v));
}

export function formatRub(value: number): string {
  return new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 }).format(value) + " ₽";
}
