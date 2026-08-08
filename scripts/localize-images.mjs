#!/usr/bin/env node
/**
 * Локализация картинок блога.
 *
 * Скачивает все внешние изображения, на которые ссылаются статьи
 * content/blog/*.md (обложка `cover:` во фронтматтере и inline `![](url)`),
 * складывает их в public/images/blog/ и переписывает ссылки на локальные
 * пути `/images/blog/<file>`.
 *
 * Скрипт идемпотентный: уже скачанный файл повторно не тянется, а ссылка,
 * которая уже локальная, пропускается. Разметка переписывается только для тех
 * URL, чей файл реально лежит локально, — сайт не сломается, если какой-то
 * источник недоступен.
 *
 * Запуск (из окружения с доступом к static.tildacdn.com):
 *   node scripts/localize-images.mjs
 */

import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const BLOG_DIR = path.join(ROOT, "content", "blog");
const OUT_DIR = path.join(ROOT, "public", "images", "blog");
const PUBLIC_PREFIX = "/images/blog";

const CONCURRENCY = 6;
const RETRIES = 4;

/** Любой http(s) URL картинки. */
const URL_RE = /https?:\/\/[^\s"')<>]+\.(?:webp|png|jpe?g|gif|avif)(?:\?[^\s"')<>]*)?/gi;

/** Собственный домен — уже локально/на нашем CDN, не трогаем. */
const SELF_HOSTS = new Set(["eco-cub.ru", "www.eco-cub.ru"]);

/** Стабильное локальное имя файла для URL. */
function localNameFor(rawUrl) {
  const u = new URL(rawUrl);
  const base = path
    .basename(u.pathname)
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
  const short = createHash("sha256").update(rawUrl).digest("hex").slice(0, 10);
  return `${short}-${base || "image"}`;
}

async function fileExists(p) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function download(url, dest) {
  let lastErr;
  for (let attempt = 1; attempt <= RETRIES; attempt++) {
    try {
      const res = await fetch(url, {
        redirect: "follow",
        headers: { "user-agent": "ecocub-localize-images/1.0" },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length === 0) throw new Error("empty body");
      await fs.writeFile(dest, buf);
      return buf.length;
    } catch (err) {
      lastErr = err;
      if (attempt < RETRIES) {
        const wait = 2 ** attempt * 500;
        await new Promise((r) => setTimeout(r, wait));
      }
    }
  }
  throw lastErr;
}

async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      results[idx] = await fn(items[idx], idx);
    }
  });
  await Promise.all(workers);
  return results;
}

async function main() {
  await fs.mkdir(OUT_DIR, { recursive: true });

  const files = (await fs.readdir(BLOG_DIR)).filter((f) => f.endsWith(".md"));
  const contents = new Map();
  const urlSet = new Set();

  for (const f of files) {
    const full = path.join(BLOG_DIR, f);
    const text = await fs.readFile(full, "utf8");
    contents.set(full, text);
    for (const m of text.matchAll(URL_RE)) {
      const url = m[0];
      let host;
      try {
        host = new URL(url).host;
      } catch {
        continue;
      }
      if (SELF_HOSTS.has(host)) continue;
      urlSet.add(url);
    }
  }

  const urls = [...urlSet];
  console.log(`Найдено внешних картинок: ${urls.length} (в ${files.length} статьях)`);

  const mapping = new Map(); // url -> публичный путь (только успешно локализованные)
  let ok = 0;
  let skipped = 0;
  const failed = [];

  await mapLimit(urls, CONCURRENCY, async (url) => {
    const name = localNameFor(url);
    const dest = path.join(OUT_DIR, name);
    const publicPath = `${PUBLIC_PREFIX}/${name}`;
    if (await fileExists(dest)) {
      mapping.set(url, publicPath);
      skipped++;
      return;
    }
    try {
      const bytes = await download(url, dest);
      mapping.set(url, publicPath);
      ok++;
      console.log(`✓ ${name}  (${(bytes / 1024).toFixed(0)} KB)`);
    } catch (err) {
      failed.push({ url, error: String(err && err.message ? err.message : err) });
      console.warn(`✗ ${url}\n   ${err && err.message ? err.message : err}`);
    }
  });

  // Переписываем ссылки только для локализованных картинок.
  let rewrittenFiles = 0;
  let rewrittenRefs = 0;
  for (const [full, text] of contents) {
    let next = text;
    for (const [url, publicPath] of mapping) {
      if (!next.includes(url)) continue;
      const parts = next.split(url);
      rewrittenRefs += parts.length - 1;
      next = parts.join(publicPath);
    }
    if (next !== text) {
      await fs.writeFile(full, next, "utf8");
      rewrittenFiles++;
    }
  }

  console.log("\n— Итог —");
  console.log(`Скачано:        ${ok}`);
  console.log(`Уже локально:   ${skipped}`);
  console.log(`Не удалось:     ${failed.length}`);
  console.log(`Переписано ссылок в разметке: ${rewrittenRefs} (файлов: ${rewrittenFiles})`);

  if (failed.length) {
    console.log("\nНе удалось скачать (ссылки оставлены внешними):");
    for (const f of failed) console.log(`  ${f.url}  — ${f.error}`);
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
