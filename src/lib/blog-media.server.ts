/**
 * Кадры живой ленты Медиамашины — на нашем домене, только на сервере.
 *
 * Статья из ленты ссылается на /media/blog/<имя>.webp. Имя выдаёт
 * localizeFeedImage при разборе ленты и запоминает, с какого адреса ММ
 * этот кадр брать. Отдаём только то, что зарегистрировала лента: чужой
 * адрес через нас не скачать (не открытый прокси).
 *
 * Первый запрос кадра скачивает исходник, перегоняет в WebP ≤ 300 КБ (и
 * превью 1200×630 для og:image) и кладёт на диск; дальше отдаётся с диска.
 * После каждого обновления ленты кадры готовятся в фоне заранее, чтобы
 * у первого читателя не было задержки и были известны размеры
 * (width/height у <img>).
 *
 * Каталог: ECOCUB_MEDIA_DIR, по умолчанию /var/lib/ecocub/media на сервере
 * (служба может туда писать) или временный каталог при разработке.
 */

import { existsSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { imageBaseName } from "./mm-article";
import { toOgJpeg, toWebp } from "./image-webp";

const DIR =
  process.env.ECOCUB_MEDIA_DIR ??
  (existsSync("/var/lib/ecocub")
    ? "/var/lib/ecocub/media"
    : path.join(os.tmpdir(), "ecocub-media"));
export const MEDIA_PREFIX = "/media/blog/";
const MAX_SOURCE_BYTES = 25 * 1024 * 1024;
const FILE_NAME = /^[a-z0-9][a-z0-9-]{0,120}(\.webp|-og\.jpg)$/;

type Size = { width: number; height: number };
const sources = new Map<string, string>(); // имя файла → адрес ММ
const sizes = new Map<string, Size>(); // имя файла → размеры готового кадра
const inflight = new Map<string, Promise<Buffer | null>>();
const failed = new Set<string>(); // имя файла: кадр не скачался или не перегнался
let lastProblem = "";

/** Кадр ленты → адрес на нашем домене. index 0 — обложка (для неё же готовим og). */
export function localizeFeedImage(slug: string, index: number, url: string): string {
  const base = imageBaseName(slug, index, url);
  sources.set(`${base}.webp`, url);
  if (index === 0) sources.set(`${base}-og.jpg`, url);
  return `${MEDIA_PREFIX}${base}.webp`;
}

/** Превью для соцсетей к обложке ленты; для чужих адресов — null. */
export function ogImageFor(cover: string | null): string | null {
  if (!cover?.startsWith(MEDIA_PREFIX) || !cover.endsWith(".webp")) return null;
  const og = `${cover.slice(MEDIA_PREFIX.length, -".webp".length)}-og.jpg`;
  return sources.has(og) ? `${MEDIA_PREFIX}${og}` : null;
}

/**
 * Кадр не удалось перегнать (слишком большой, битый, ММ не отдала) — адрес
 * на ММ, чтобы читатель видел картинку, а не дыру. Иначе null.
 */
export function mediaFallback(src: string): string | null {
  if (!src.startsWith(MEDIA_PREFIX)) return null;
  const file = src.slice(MEDIA_PREFIX.length);
  return failed.has(file) ? (sources.get(file) ?? null) : null;
}

/** Размеры готового кадра (для width/height), если он уже перегнан. */
export function mediaSize(src: string): Size | undefined {
  return src.startsWith(MEDIA_PREFIX) ? sizes.get(src.slice(MEDIA_PREFIX.length)) : undefined;
}

export function mediaSizes(srcs: Iterable<string>): Record<string, Size> {
  const out: Record<string, Size> = {};
  for (const src of srcs) {
    const size = mediaSize(src);
    if (size) out[src] = size;
  }
  return out;
}

async function download(url: string): Promise<Buffer> {
  const response = await fetch(url, { signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw new Error(`кадр ответил ${response.status}`);
  const type = response.headers.get("content-type") ?? "";
  if (type && !type.startsWith("image/")) throw new Error(`не картинка (${type})`);
  const data = Buffer.from(await response.arrayBuffer());
  if (data.length > MAX_SOURCE_BYTES) throw new Error("кадр больше 25 МБ");
  return data;
}

async function produce(file: string): Promise<Buffer | null> {
  const target = path.join(DIR, file);
  const sidecar = `${target}.json`;
  if (existsSync(target)) {
    if (!sizes.has(file) && existsSync(sidecar)) {
      try {
        sizes.set(file, JSON.parse(await readFile(sidecar, "utf8")) as Size);
      } catch {
        /* размеры не обязательны */
      }
    }
    return readFile(target);
  }
  const url = sources.get(file);
  if (!url) return null;
  try {
    const source = await download(url);
    const converted = file.endsWith("-og.jpg") ? await toOgJpeg(source) : await toWebp(source);
    await mkdir(DIR, { recursive: true });
    const temp = `${target}.${process.pid}.tmp`;
    await writeFile(temp, converted.data);
    await rename(temp, target);
    const size = { width: converted.width, height: converted.height };
    await writeFile(sidecar, JSON.stringify(size));
    sizes.set(file, size);
    failed.delete(file);
    lastProblem = "";
    return converted.data;
  } catch (error) {
    const problem = error instanceof Error ? error.message : String(error);
    if (problem !== lastProblem) console.warn(`[blog-media] ${file}: ${problem}`);
    lastProblem = problem;
    failed.add(file);
    return null;
  }
}

/** Готовый кадр по имени файла или null (неизвестный или не скачался). */
export async function getMedia(file: string): Promise<{ data: Buffer; type: string } | null> {
  if (!FILE_NAME.test(file)) return null;
  let job = inflight.get(file);
  if (!job) {
    job = produce(file).finally(() => inflight.delete(file));
    inflight.set(file, job);
  }
  const data = await job;
  return data ? { data, type: file.endsWith(".webp") ? "image/webp" : "image/jpeg" } : null;
}

let warming = false;
/** Подготовить все известные кадры в фоне, по одному (сервер делит память с соседями). */
export function prewarmMedia(): void {
  if (warming) return;
  warming = true;
  void (async () => {
    try {
      for (const file of [...sources.keys()]) {
        if (!sizes.has(file)) await getMedia(file);
      }
    } finally {
      warming = false;
    }
  })();
}
