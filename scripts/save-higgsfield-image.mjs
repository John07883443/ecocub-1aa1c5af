#!/usr/bin/env node
/**
 * Сохранение сгенерированного изображения (Higgsfield и любой другой внешний URL)
 * в репозиторий.
 *
 * Higgsfield отдаёт картинки внешними ссылками (d8j0ntlcm91z4.cloudfront.net…).
 * Такие ссылки живут вне нашего контроля и однажды протухнут, поэтому любое
 * изображение, попадающее в блог, должно лежать в public/images/blog/ и
 * версионироваться вместе с кодом.
 *
 * Скачивает URL в public/images/blog/ и печатает готовый локальный путь
 * (/images/blog/…), который остаётся вставить в статью — в cover или в тело.
 *
 *   node scripts/save-higgsfield-image.mjs <url> [имя-без-расширения]
 *
 * Пример:
 *   node scripts/save-higgsfield-image.mjs \
 *     https://d8j0ntlcm91z4.cloudfront.net/user_.../hf_....png \
 *     dom-s-terrasoi-1
 *   → /images/blog/dom-s-terrasoi-1.png
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { extname, join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const OUT_DIR = join(ROOT, "public/images/blog");
const PUBLIC_PREFIX = "/images/blog";

const [url, rawName] = process.argv.slice(2);
if (!url || !/^https?:\/\//i.test(url)) {
  console.error("Использование: node scripts/save-higgsfield-image.mjs <url> [имя-без-расширения]");
  process.exit(1);
}

mkdirSync(OUT_DIR, { recursive: true });

function extFromUrl(u) {
  const ext = extname(u.split(/[?#]/)[0]).toLowerCase();
  return /^\.(jpe?g|png|webp|gif|avif|svg)$/.test(ext) ? ext.replace(".jpeg", ".jpg") : ".png";
}

function slugify(s) {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "higgsfield"
  );
}

const ext = extFromUrl(url);
const base = rawName ? slugify(rawName.replace(/\.[a-z0-9]+$/i, "")) : `higgsfield-${slugify(url).slice(-12)}`;

let name = `${base}${ext}`;
let i = 2;
while (existsSync(join(OUT_DIR, name))) name = `${base}-${i++}${ext}`;

const dest = join(OUT_DIR, name);
execFileSync("curl", ["-sSL", "--fail", "--retry", "3", "--retry-delay", "2", "-o", dest, url], {
  stdio: ["ignore", "ignore", "inherit"],
});
if (readFileSync(dest).length === 0) {
  console.error("Скачан пустой файл — проверьте URL.");
  process.exit(1);
}

console.log(`${PUBLIC_PREFIX}/${name}`);
