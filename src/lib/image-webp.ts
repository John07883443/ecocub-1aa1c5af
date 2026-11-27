/**
 * Кадры блога на своём домене: WebP не тяжелее 300 КБ и превью для соцсетей
 * 1200×630 (эталон SEO-статьи, раздел D и B). Нужен sharp; импорт ленивый,
 * чтобы модуль можно было подключать без него (тесты, браузерная сборка).
 * Используется и сайтом (blog-media.server.ts), и синком (scripts/).
 */

export const MAX_WEBP_BYTES = 300 * 1024;

/** Шаги «ширина × качество»: от лучшего к лёгкому, пока не влезем в 300 КБ. */
const STEPS: Array<[number, number]> = [
  [1600, 82],
  [1600, 72],
  [1280, 72],
  [1280, 62],
  [1024, 60],
  [1024, 50],
  [800, 50],
];

export type Converted = { data: Buffer; width: number; height: number };

type SharpModule = typeof import("sharp");

async function loadSharp(): Promise<SharpModule["default"]> {
  const mod = (await import("sharp")) as unknown as SharpModule & {
    default?: SharpModule["default"];
  };
  return (mod.default ?? mod) as SharpModule["default"];
}

export async function toWebp(input: Buffer): Promise<Converted> {
  const sharp = await loadSharp();
  let last: Converted | null = null;
  for (const [width, quality] of STEPS) {
    const { data, info } = await sharp(input, { failOn: "error" })
      .rotate()
      .resize({ width, withoutEnlargement: true })
      .webp({ quality, effort: 4 })
      .toBuffer({ resolveWithObject: true });
    last = { data, width: info.width, height: info.height };
    if (data.length <= MAX_WEBP_BYTES) break;
  }
  return last!;
}

/** Превью для og:image: ровно 1200×630, JPEG (его понимают все соцсети и мессенджеры). */
export async function toOgJpeg(input: Buffer): Promise<Converted> {
  const sharp = await loadSharp();
  const { data, info } = await sharp(input, { failOn: "error" })
    .rotate()
    .resize({ width: 1200, height: 630, fit: "cover", position: "attention" })
    .jpeg({ quality: 80, mozjpeg: true })
    .toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}
