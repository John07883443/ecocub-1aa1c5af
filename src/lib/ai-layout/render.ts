/**
 * Отрисовка исходного снимка контура для модели.
 *
 * Требования к исходнику (ТЗ): строго вид сверху, светлый фон, толстый чёрный
 * внешний контур, тонкая серая модульная сетка, однозначная отметка входа,
 * никакой перспективы, теней, ландшафта и элементов интерфейса. Экспорт
 * детерминированный: одна и та же конфигурация даёт побайтово одинаковый PNG.
 */

import { createCanvas, drawLine, encodePng, fillRect, type Canvas, type RGB } from "./png.ts";
import { entrancePoint, type EntranceSide, type Footprint } from "./footprint.ts";

export const FOOTPRINT_IMAGE_SIZE = 1024;
/** Поля вокруг дома, доля от стороны изображения. */
const PADDING_RATIO = 0.08;

const WHITE: RGB = [255, 255, 255];
const INK: RGB = [17, 17, 17];
const GRID: RGB = [205, 205, 205];
const FILL: RGB = [255, 255, 255];
const ENTRY: RGB = [17, 17, 17];
/**
 * Фон вне дома. Тёмное поле — не украшение, а ограничитель: на светлом фоне
 * модель охотно «достраивала» вырезы до полного прямоугольника, потому что
 * пустое место читается как свободный холст. Контрастная заливка снаружи
 * оставляет для планировки ровно одну область.
 */
const OUTSIDE: RGB = [38, 42, 48];

export interface FootprintImage {
  bytes: Uint8Array;
  size: number;
  /** Пикселей на метр — нужно для наложения контура поверх результата. */
  scale: number;
  offsetXpx: number;
  offsetZpx: number;
}

/**
 * Нарисовать контур. Масштаб выбирается так, чтобы дом занял максимум
 * площади кадра при одинаковых полях со всех сторон, а пропорции сохранились.
 */
export async function renderFootprintPng(
  footprint: Footprint,
  entrance: EntranceSide | null,
  size = FOOTPRINT_IMAGE_SIZE,
): Promise<FootprintImage> {
  const canvas = createCanvas(size, size, OUTSIDE);
  const pad = size * PADDING_RATIO;
  const usable = size - pad * 2;
  const span = Math.max(footprint.widthM, footprint.depthM, 1);
  const scale = usable / span;

  // Центрируем: одинаковые поля слева/справа и сверху/снизу.
  const offsetX = (size - footprint.widthM * scale) / 2;
  const offsetZ = (size - footprint.depthM * scale) / 2;
  const px = (mx: number) => offsetX + mx * scale;
  const pz = (mz: number) => offsetZ + mz * scale;

  // Тело дома — единственная светлая область кадра.
  for (const m of footprint.modules) {
    fillRect(canvas, px(m.x), pz(m.z), m.side * scale, m.side * scale, FILL);
  }

  // Модульная сетка — тонкие серые швы между секциями.
  for (const s of footprint.seams) {
    drawLine(canvas, px(s.x1), pz(s.z1), px(s.x2), pz(s.z2), Math.max(1, scale * 0.03), GRID);
  }

  // Внешний контур — толстая чёрная линия, главный ориентир для модели.
  const wallThickness = Math.max(4, scale * 0.14);
  for (const w of footprint.walls) {
    drawLine(canvas, px(w.x1), pz(w.z1), px(w.x2), pz(w.z2), wallThickness, INK);
  }

  // Вход: разрыв в стене и короткая засечка внутрь дома.
  if (entrance) {
    const point = entrancePoint(footprint, entrance);
    if (point) drawEntrance(canvas, point, px, pz, scale, wallThickness);
  }

  const bytes = await encodePng(canvas);
  return { bytes, size, scale, offsetXpx: offsetX, offsetZpx: offsetZ };
}

function drawEntrance(
  canvas: Canvas,
  point: { x: number; z: number; axis: "x" | "z"; widthM: number },
  px: (v: number) => number,
  pz: (v: number) => number,
  scale: number,
  wallThickness: number,
) {
  const half = (point.widthM / 2) * scale;
  const markThickness = Math.max(3, scale * 0.08);

  if (point.axis === "x") {
    // Вертикальная стена: вырезаем проём и ставим засечку внутрь.
    fillRect(
      canvas,
      px(point.x) - wallThickness,
      pz(point.z) - half,
      wallThickness * 2,
      half * 2,
      WHITE,
    );
    const inward = point.x < 1 ? 1 : -1;
    drawLine(
      canvas,
      px(point.x),
      pz(point.z),
      px(point.x) + inward * scale * 0.9,
      pz(point.z),
      markThickness,
      ENTRY,
    );
  } else {
    fillRect(
      canvas,
      px(point.x) - half,
      pz(point.z) - wallThickness,
      half * 2,
      wallThickness * 2,
      WHITE,
    );
    const inward = point.z < 1 ? 1 : -1;
    drawLine(
      canvas,
      px(point.x),
      pz(point.z),
      px(point.x),
      pz(point.z) + inward * scale * 0.9,
      markThickness,
      ENTRY,
    );
  }
}
