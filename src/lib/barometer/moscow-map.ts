/**
 * Реальная геометрия Московской области, МКАД, ЦКАД и федеральных трасс.
 *
 * Источник — OpenStreetMap (данные ODbL), выгружено через Overpass API
 * 2026-08-16 (граница области — relation admin_level=4 "Московская область",
 * МКАД — ways с name~"^МКАД", ЦКАД/кольца/трассы — ways по тегу ref: А-113,
 * А-108, А-107, М-1…М-12, А-104, А-105). Геометрия сшита из отдельных
 * OSM-сегментов в целые линии/полигоны и упрощена (Douglas-Peucker) — это
 * НЕ выдумка/ИИ-генерация, а настоящая топология, огрублённая для схемы:
 * мелкая уличная сеть намеренно не включалась, только МКАД/ЦКАД/крупные шоссе.
 *
 * Проекция — простая равнопромежуточная (эквидистантная) с масштабом по
 * широте (cos от широты Москвы), центр — Москва (55.7558, 37.6173). Для
 * схемы регионального масштаба этого достаточно, полноценная картографическая
 * проекция не нужна.
 */

import raw from "../../../content/analytics/moscow-map.json";

export type Point = { x: number; y: number };

export type HighwayData = {
  path: string;
  label: string;
};

type MoscowMapData = {
  viewBox: string;
  moscow: Point;
  boundaryPath: string;
  mkadPath: string;
  ringHighways: Record<string, HighwayData>;
  radialHighways: Record<string, HighwayData>;
  directionHighways: Record<string, string[]>;
  towns: Record<string, Point>;
};

export const moscowMapData = raw as MoscowMapData;

export function highwaysForDirection(directionId: string): string[] {
  return moscowMapData.directionHighways[directionId] ?? [];
}
