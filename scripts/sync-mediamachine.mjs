/**
 * Забрать статьи из Медиамашины и положить их в блог сайта.
 *
 * Зачем так, а не встраиваемым скриптом. Владелец 07.09.2026: «только
 * полный текст на сайте, потому что SEO в приоритете, всё на стороне
 * сайта, куда подключаем контент». Статья становится таким же файлом в
 * content/blog, как остальные: своя страница, свой адрес, карта сайта.
 *
 * Картинки скачиваются в public/images/blog: CDN отдаёт кадры, пока живёт,
 * а материал должен жить дольше любого чужого хостинга.
 *
 * Правила:
 *  - уже существующий файл не трогаем никогда (ни ручной, ни принесённый
 *    раньше): правка на сайте главнее нашей копии;
 *  - статья, уже принесённая под другим адресом (sourceId совпал), второй
 *    раз не приносится — заголовок в Медиамашине могли поправить;
 *  - теги — только из словаря блога (фильтры на странице /blog), хэштеги
 *    соцсетей вроде «#модульныйдом» в фильтры не просачиваются.
 *
 * Запуск:
 *   MM_KEY=mm_... node scripts/sync-mediamachine.mjs
 *   MM_KEY=mm_... node scripts/sync-mediamachine.mjs --dry
 * По расписанию — .github/workflows/sync-mediamachine.yml.
 */

import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

const FEED = process.env.MM_FEED ?? "https://mediamachina.ru/api/site/v1/articles";
const KEY = process.env.MM_KEY ?? "";
const LIMIT = Number(process.env.MM_LIMIT ?? "50");
const DRY = process.argv.includes("--dry");

const ROOT = path.resolve(import.meta.dirname, "..");
const POSTS_DIR = path.join(ROOT, "content", "blog");
const IMAGES_DIR = path.join(ROOT, "public", "images", "blog");

/** Рубрика по умолчанию: Медиамашина о рубриках сайта не знает. */
const CATEGORY = process.env.MM_CATEGORY ?? "news";
const MARK = "mediamachine";
const MAX_TAGS = 3;

if (!KEY) {
  console.error("Нужен ключ: MM_KEY=mm_... node scripts/sync-mediamachine.mjs");
  process.exit(1);
}

const normalize = (value) => String(value).toLowerCase().replace(/[#\s_-]+/g, "").replace(/ё/g, "е");

function yamlString(value) {
  return `"${String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, " ")}"`;
}

function yamlList(items) {
  return `[${items.map(yamlString).join(", ")}]`;
}

const EXT_BY_TYPE = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/avif": "avif" };

async function downloadImage(url, slug, index) {
  const guessed = (url.match(/\.(jpe?g|png|webp|avif)(\?|$)/i)?.[1] ?? "jpg").toLowerCase().replace("jpeg", "jpg");
  const base = index === 0 ? slug : `${slug}-${index}`;
  const already = ["jpg", "png", "webp", "avif"].map((ext) => `${base}.${ext}`).find((name) => existsSync(path.join(IMAGES_DIR, name)));
  if (already) return `/images/blog/${already}`;
  if (DRY) return `/images/blog/${base}.${guessed}`;

  const response = await fetch(url, { signal: AbortSignal.timeout(30_000) }).catch(() => null);
  if (!response?.ok) {
    console.warn(`  кадр не скачался (${response?.status ?? "сеть"}): ${url}`);
    return null;
  }
  const type = (response.headers.get("content-type") ?? "").split(";")[0].trim();
  const name = `${base}.${EXT_BY_TYPE[type] ?? guessed}`;
  await writeFile(path.join(IMAGES_DIR, name), Buffer.from(await response.arrayBuffer()));
  return `/images/blog/${name}`;
}

/** Словарь тегов блога — то, что уже стоит в фильтрах на /blog. */
async function blogTagVocabulary(files) {
  const vocabulary = new Map();
  for (const file of files) {
    const text = await readFile(path.join(POSTS_DIR, file), "utf8");
    const line = text.match(/^tags:\s*\[(.*)\]\s*$/m)?.[1] ?? "";
    for (const raw of line.split(",")) {
      const tag = raw.trim().replace(/^"|"$/g, "");
      if (tag) vocabulary.set(normalize(tag), tag);
    }
  }
  return vocabulary;
}

function mapTags(feedTags, vocabulary) {
  const picked = [];
  for (const feedTag of feedTags ?? []) {
    const key = normalize(feedTag);
    for (const [norm, tag] of vocabulary) {
      if ((key === norm || key.includes(norm)) && !picked.includes(tag)) picked.push(tag);
    }
  }
  return picked.slice(0, MAX_TAGS);
}

async function main() {
  const response = await fetch(`${FEED}?key=${encodeURIComponent(KEY)}&limit=${LIMIT}`, { signal: AbortSignal.timeout(60_000) });
  if (!response.ok) {
    console.error(`Выдача ответила ${response.status}`);
    process.exit(1);
  }
  const { articles = [] } = await response.json();
  console.log(`Получено материалов: ${articles.length}`);

  await mkdir(POSTS_DIR, { recursive: true });
  await mkdir(IMAGES_DIR, { recursive: true });

  const files = (await readdir(POSTS_DIR)).filter((file) => file.endsWith(".md"));
  const existing = new Set(files);
  const syncedIds = new Set();
  for (const file of files) {
    const text = await readFile(path.join(POSTS_DIR, file), "utf8");
    const id = text.match(/^sourceId:\s*(\S+)/m)?.[1];
    if (id) syncedIds.add(id);
  }
  const vocabulary = await blogTagVocabulary(files);

  let added = 0;
  let skipped = 0;
  for (const article of articles) {
    const file = `${article.slug}.md`;
    if (existing.has(file) || syncedIds.has(article.id)) {
      skipped += 1;
      continue;
    }

    // Первый абзац выдачи часто повторяет заголовок или лид — на странице
    // он уже стоит в шапке, дублировать его в тексте незачем.
    const paragraphs = (article.paragraphs ?? []).filter(Boolean);
    const lead = normalize(article.description ?? "");
    while (paragraphs.length && [normalize(article.title), lead].includes(normalize(paragraphs[0]))) paragraphs.shift();
    if (paragraphs.length === 0) {
      console.log(`  пропускаю (нет текста): ${article.title}`);
      skipped += 1;
      continue;
    }

    const cover = article.cover ? await downloadImage(article.cover, article.slug, 0) : null;
    const inline = [];
    for (const [index, image] of (article.images ?? []).entries()) {
      if (image === article.cover) continue;
      const local = await downloadImage(image, article.slug, index + 1);
      if (local) inline.push(local);
    }

    // Кадры между абзацами, а не в конце: иначе они читаются приложением.
    const alt = article.title.replace(/[[\]]/g, "");
    const step = inline.length > 0 ? Math.max(2, Math.floor(paragraphs.length / (inline.length + 1))) : 0;
    const body = [];
    let placed = 0;
    for (const [index, paragraph] of paragraphs.entries()) {
      body.push(paragraph, "");
      if (step > 0 && placed < inline.length && index > 0 && (index + 1) % step === 0) {
        body.push(`![${alt}](${inline[placed]})`, "");
        placed += 1;
      }
    }
    for (; placed < inline.length; placed += 1) body.push(`![${alt}](${inline[placed]})`, "");

    const words = paragraphs.join(" ").split(/\s+/).filter(Boolean).length;
    const description = (article.description || paragraphs[0]).trim();
    const tags = mapTags(article.tags, vocabulary);
    const front = [
      "---",
      `title: ${yamlString(article.title)}`,
      `slug: ${article.slug}`,
      `date: ${String(article.publishedAt).slice(0, 10)}`,
      `category: ${CATEGORY}`,
      `tags: ${yamlList(tags)}`,
      `excerpt: ${yamlString(description.slice(0, 300))}`,
      ...(cover ? [`cover: ${cover}`] : []),
      `readingTime: ${Math.max(1, Math.round(words / 180))}`,
      `seoTitle: ${yamlString(article.title.slice(0, 70))}`,
      `seoDescription: ${yamlString(description.slice(0, 160))}`,
      `source: ${MARK}`,
      `sourceId: ${article.id}`,
      "---",
      "",
    ].join("\n");

    const content = front + body.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
    if (DRY) {
      console.log(`  добавил бы: ${file} · ${paragraphs.length} абз. · обложка ${cover ? "да" : "нет"} · кадров ${inline.length} · теги ${JSON.stringify(tags)}`);
      continue;
    }
    await writeFile(path.join(POSTS_DIR, file), content, "utf8");
    added += 1;
    console.log(`  добавил: ${file}`);
  }

  console.log(DRY ? "Пробный прогон, файлы не тронуты." : `Добавлено: ${added}, пропущено: ${skipped}`);
}

await main();
