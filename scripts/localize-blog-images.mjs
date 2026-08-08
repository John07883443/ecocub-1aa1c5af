#!/usr/bin/env node
/**
 * Локализация изображений блога.
 *
 * Скачивает все внешние картинки статей (обложки и картинки в теле) в
 * public/images/blog/, переписывает ссылки на локальные /images/blog/… и
 * проставляет осмысленный alt там, где он пустой.
 *
 * Скрипт идемпотентен: локальные ссылки (/images/…) пропускаются, поэтому его
 * можно запускать повторно — например, после добавления новой статьи с
 * внешними ссылками.
 *
 *   node scripts/localize-blog-images.mjs
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, extname, join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const BLOG_DIR = join(ROOT, "content/blog");
const OUT_DIR = join(ROOT, "public/images/blog");
const PUBLIC_PREFIX = "/images/blog";

mkdirSync(OUT_DIR, { recursive: true });

const IMAGE_RE = /!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;

const isExternal = (url) => /^https?:\/\//i.test(url);

function extFromUrl(url) {
  const clean = url.split(/[?#]/)[0];
  const ext = extname(clean).toLowerCase();
  return /^\.(jpe?g|png|webp|gif|avif|svg)$/.test(ext) ? ext.replace(".jpeg", ".jpg") : ".jpg";
}

function download(url, destPath) {
  // curl уважает HTTPS_PROXY окружения — важно в этом рантайме.
  execFileSync("curl", ["-sSL", "--fail", "--retry", "3", "--retry-delay", "2", "-o", destPath, url], {
    stdio: ["ignore", "ignore", "pipe"],
  });
  const size = readFileSync(destPath).length;
  if (size === 0) throw new Error("empty download");
  return size;
}

/** Осмысленный alt из ближайшего заголовка над картинкой, иначе — заголовок статьи. */
function stripMd(s) {
  return s
    .replace(/<[^>]+>/g, " ")
    .replace(/[*_`#>]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function altForImage(body, matchIndex, title) {
  const before = body.slice(0, matchIndex);
  const headings = [...before.matchAll(/^#{1,6}\s+(.+)$/gm)];
  if (headings.length) {
    const h = stripMd(headings[headings.length - 1][1]);
    if (h && h.toLowerCase() !== title.toLowerCase()) return `${title}. ${h}`;
    if (h) return h;
  }
  return title;
}

function parseFrontMatter(raw) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(raw);
  if (!m) return null;
  return { fmText: m[1], fmStart: m.index, fmEnd: m[0].length - m[2].length, body: m[2], full: m[0] };
}

function readField(fmText, key) {
  const m = new RegExp(`^${key}:\\s*(.+)$`, "m").exec(fmText);
  if (!m) return "";
  let v = m[1].trim();
  if (v.length > 1 && (v[0] === '"' || v[0] === "'") && v[v.length - 1] === v[0]) v = v.slice(1, -1);
  return v;
}

const usedNames = new Set(readdirSync(OUT_DIR));
function uniqueName(base, ext) {
  let name = `${base}${ext}`;
  let i = 2;
  while (usedNames.has(name)) name = `${base}-${i++}${ext}`;
  usedNames.add(name);
  return name;
}

const files = readdirSync(BLOG_DIR).filter((f) => f.endsWith(".md")).sort();
let totalDownloaded = 0;
let totalRewritten = 0;
let totalAlt = 0;
const failures = [];

for (const file of files) {
  const path = join(BLOG_DIR, file);
  let raw = readFileSync(path, "utf8");
  const fm = parseFrontMatter(raw);
  if (!fm) {
    console.warn(`!  ${file}: нет front matter, пропуск`);
    continue;
  }
  const slug = readField(fm.fmText, "slug") || file.replace(/\.md$/, "");
  const title = readField(fm.fmText, "title") || slug;
  const cache = new Map(); // url -> /images/blog/name

  const localize = (url, baseName) => {
    if (!isExternal(url)) return null;
    if (cache.has(url)) return cache.get(url);
    const name = uniqueName(baseName, extFromUrl(url));
    const dest = join(OUT_DIR, name);
    try {
      const size = download(url, dest);
      totalDownloaded++;
      const localUrl = `${PUBLIC_PREFIX}/${name}`;
      cache.set(url, localUrl);
      console.log(`   ↓ ${name}  (${(size / 1024).toFixed(0)} KB)`);
      return localUrl;
    } catch (e) {
      failures.push({ file, url, error: String(e.message || e) });
      usedNames.delete(name);
      console.warn(`   ✗ не удалось: ${url}`);
      return null;
    }
  };

  // --- Обложка ---
  const cover = readField(fm.fmText, "cover");
  let newFm = fm.fmText;
  if (cover && isExternal(cover)) {
    const local = localize(cover, `${slug}-cover`);
    if (local) {
      newFm = newFm.replace(
        new RegExp(`^(cover:\\s*).+$`, "m"),
        (_m, p1) => `${p1}${local}`,
      );
      totalRewritten++;
    }
  }

  // --- Картинки в теле ---
  let imgIdx = 0;
  const newBody = fm.body.replace(IMAGE_RE, (whole, alt, url, offset) => {
    if (!isExternal(url)) return whole;
    imgIdx++;
    const local = localize(url, `${slug}-${imgIdx}`);
    if (!local) return whole; // не тронуть, если скачать не удалось
    totalRewritten++;
    let outAlt = alt.trim();
    if (!outAlt) {
      outAlt = altForImage(fm.body, offset, title);
      totalAlt++;
    }
    return `![${outAlt}](${local})`;
  });

  const rebuilt = raw.slice(0, fm.fmStart) + `---\n${newFm}\n---\n` + newBody;
  if (rebuilt !== raw) {
    writeFileSync(path, rebuilt);
    console.log(`✓  ${file}`);
  }
}

console.log("\n──────── итог ────────");
console.log(`Скачано файлов:      ${totalDownloaded}`);
console.log(`Переписано ссылок:   ${totalRewritten}`);
console.log(`Проставлено alt:     ${totalAlt}`);
if (failures.length) {
  console.log(`\nНе удалось скачать (${failures.length}):`);
  for (const f of failures) console.log(`  ${f.file}: ${f.url}`);
  process.exitCode = 1;
}
