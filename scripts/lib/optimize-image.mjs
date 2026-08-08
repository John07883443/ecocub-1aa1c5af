/**
 * Оптимизация изображений блога.
 *
 * Единый формат для всех картинок блога — WebP: заметно легче JP/PNG при том же
 * визуальном качестве, и весь сайт уже отдаёт hero-картинки в WebP.
 *
 * Картинки в статье показываются в колонке шириной ~768 CSS-px, так что ширины
 * 1600 px хватает даже для retina-экранов с запасом. Всё, что шире, ужимается.
 */
import sharp from "sharp";

export const MAX_WIDTH = 1600;
export const WEBP_QUALITY = 80;

/**
 * Сжимает буфер картинки в WebP (с уменьшением ширины до MAX_WIDTH).
 * @returns {Promise<Buffer>}
 */
export async function toWebp(input) {
  const img = sharp(input, { failOn: "none" });
  const meta = await img.metadata();
  if (meta.width && meta.width > MAX_WIDTH) img.resize({ width: MAX_WIDTH, withoutEnlargement: true });
  return img.webp({ quality: WEBP_QUALITY, effort: 5 }).toBuffer();
}
