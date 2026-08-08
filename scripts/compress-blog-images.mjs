#!/usr/bin/env node
/**
 * Сжатие уже локализованных картинок блога в WebP.
 *
 * Приводит все изображения public/images/blog/ к единому формату WebP
 * (ширина ≤ 1600 px, качество 80), переписывает ссылки в статьях на новое
 * расширение и удаляет исходные PNG/JPG.
 *
 * Идемпотентно: файл .webp, который уже не шире 1600 px, не трогается, так что
 * повторный запуск не портит качество перекодированием.
 *
 *   node scripts/compress-blog-images.mjs
 */
import { readdirSync, readFileSync, writeFileSync, statSync, rmSync } from "node:fs";
import { join, extname } from "node:path";
import sharp from "sharp";
import { toWebp, MAX_WIDTH } from "./lib/optimize-image.mjs";

const ROOT = new URL("..", import.meta.url).pathname;
const BLOG_DIR = join(ROOT, "content/blog");
const IMG_DIR = join(ROOT, "public/images/blog");

const renames = new Map(); // /images/blog/old.ext -> /images/blog/new.webp
let before = 0;
let after = 0;
let processed = 0;
let skipped = 0;

for (const file of readdirSync(IMG_DIR).sort()) {
  const src = join(IMG_DIR, file);
  if (!/\.(png|jpe?g|webp)$/i.test(file)) continue;
  const ext = extname(file).toLowerCase();
  const base = file.slice(0, -ext.length);
  const srcBytes = statSync(src).size;

  // Уже webp и не шире лимита — оставляем как есть.
  if (ext === ".webp") {
    const meta = await sharp(src).metadata();
    if (!meta.width || meta.width <= MAX_WIDTH) {
      skipped++;
      continue;
    }
  }

  const webp = await toWebp(readFileSync(src));
  const destName = `${base}.webp`;
  const dest = join(IMG_DIR, destName);

  // Не перезаписываем чужой файл при коллизии имён (на практике не встречается).
  if (destName !== file && readdirSync(IMG_DIR).includes(destName)) {
    console.warn(`!  коллизия имени ${destName}, пропуск ${file}`);
    continue;
  }

  writeFileSync(dest, webp);
  if (destName !== file) {
    rmSync(src);
    renames.set(`/images/blog/${file}`, `/images/blog/${destName}`);
  }

  before += srcBytes;
  after += webp.length;
  processed++;
  console.log(`   ${file}  ${(srcBytes / 1024).toFixed(0)}→${(webp.length / 1024).toFixed(0)} KB`);
}

// Переписываем ссылки в статьях под новое расширение.
let touched = 0;
if (renames.size) {
  for (const f of readdirSync(BLOG_DIR).filter((x) => x.endsWith(".md"))) {
    const path = join(BLOG_DIR, f);
    let raw = readFileSync(path, "utf8");
    let changed = false;
    for (const [oldRef, newRef] of renames) {
      if (raw.includes(oldRef)) {
        raw = raw.split(oldRef).join(newRef);
        changed = true;
      }
    }
    if (changed) {
      writeFileSync(path, raw);
      touched++;
    }
  }
}

console.log("\n──────── итог ────────");
console.log(`Сжато файлов:        ${processed}`);
console.log(`Оставлено как есть:  ${skipped}`);
console.log(`Обновлено статей:    ${touched}`);
console.log(`Размер:              ${(before / 1048576).toFixed(1)} → ${(after / 1048576).toFixed(1)} MB`);
