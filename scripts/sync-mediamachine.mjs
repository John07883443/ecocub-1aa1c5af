/**
 * Забрать статьи из Медиамашины и положить их в блог сайта.
 *
 * Зачем так, а не встраиваемым скриптом. Владелец 07.09.2026: «только
 * полный текст на сайте, потому что SEO в приоритете, всё на стороне
 * сайта, куда подключаем контент». Текст, который появляется скриптом в
 * браузере, поисковики (особенно Яндекс) видят плохо, поэтому статья
 * должна стать таким же файлом в content/blog, как остальные: своя
 * страница, свой адрес, своя карта сайта, обычная сборка.
 *
 * Картинки скачиваются в public/images/blog. Это не перестраховка:
 * блог этого сайта уже наступал на внешние ссылки — CDN отдаёт кадры
 * пока живёт, а материал должен жить дольше любого чужого хостинга.
 *
 * Запуск:
 *   MM_KEY=mm_... node scripts/sync-mediamachine.mjs
 *   MM_KEY=mm_... node scripts/sync-mediamachine.mjs --dry
 *
 * Ключ берётся из кабинета Медиамашины, раздел «Интеграция с сайтом».
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

/** Рубрика по умолчанию. Медиамашина о рубриках сайта не знает, а
 *  «Новости» — то, чем эти материалы и являются для читателя. */
const CATEGORY = process.env.MM_CATEGORY ?? "news";

/** Пометка в конце файла: по ней видно, что статью принесла Медиамашина,
 *  и её можно безопасно перезаписать. Файлы, написанные руками, скрипт
 *  не тронет никогда. */
const MARK = "mediamachine";

if (!KEY) {
  console.error("Нужен ключ: MM_KEY=mm_... node scripts/sync-mediamachine.mjs");
  process.exit(1);
}

/** Кадры лежат у Медиамашины; тянем к себе и подписываем именем статьи,
 *  чтобы в папке было понятно, что к чему относится. */
async function downloadImage(url, slug, index) {
  const extension = (url.match(/\.(jpe?g|png|webp|avif)(\?|$)/i)?.[1] ?? "jpg").toLowerCase();
  const name = index === 0 ? `${slug}.${extension}` : `${slug}-${index}.${extension}`;
  const target = path.join(IMAGES_DIR, name);
  const publicPath = `/images/blog/${name}`;

  if (existsSync(target)) return publicPath;
  if (DRY) return publicPath;

  const response = await fetch(url);
  if (!response.ok) {
    console.warn(`  кадр не скачался (${response.status}): ${url}`);
    return null;
  }
  await writeFile(target, Buffer.from(await response.arrayBuffer()));
  return publicPath;
}

/** Кавычки в заголовке ломают frontmatter, поэтому значение оборачиваем и
 *  экранируем — иначе одна статья с кавычкой обрушит разбор всего блога. */
function yamlString(value) {
  return `"${String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function yamlList(items) {
  return `[${items.map(yamlString).join(", ")}]`;
}

async function main() {
  const url = `${FEED}?key=${encodeURIComponent(KEY)}&limit=${LIMIT}`;
  const response = await fetch(url);
  if (!response.ok) {
    console.error(`Выдача ответила ${response.status}`);
    process.exit(1);
  }
  const { articles = [] } = await response.json();
  console.log(`Получено материалов: ${articles.length}`);

  await mkdir(POSTS_DIR, { recursive: true });
  await mkdir(IMAGES_DIR, { recursive: true });

  const existing = new Set(await readdir(POSTS_DIR));
  let added = 0;
  let updated = 0;
  let skipped = 0;

  for (const article of articles) {
    const file = `${article.slug}.md`;
    const target = path.join(POSTS_DIR, file);

    // Файл, написанный руками, не перезаписываем: он мог быть отредактирован
    // на сайте, и наша копия не главнее живой правки редактора.
    if (existing.has(file)) {
      const current = await readFile(target, "utf8");
      if (!current.includes(`source: ${MARK}`)) {
        console.log(`  пропускаю (правился руками): ${file}`);
        skipped += 1;
        continue;
      }
    }

    const cover = article.cover ? await downloadImage(article.cover, article.slug, 0) : null;
    // Кадры внутри текста: первый обычно совпадает с обложкой, поэтому её
    // в теле не повторяем — читатель уже видел этот кадр в шапке.
    const inline = [];
    for (const [index, image] of (article.images ?? []).entries()) {
      if (index === 0 && article.cover === image) continue;
      const local = await downloadImage(image, article.slug, index + 1);
      if (local) inline.push(local);
    }

    // Кадры расставляем между абзацами, а не сваливаем в конец: статья
    // читается сверху вниз, и все фотографии после текста выглядят
    // приложением к материалу, а не его частью.
    const paragraphs = article.paragraphs ?? [];
    const step = inline.length > 0 ? Math.max(2, Math.floor(paragraphs.length / (inline.length + 1))) : 0;
    const body = [];
    let placed = 0;
    for (const [index, paragraph] of paragraphs.entries()) {
      body.push(paragraph, "");
      if (step > 0 && placed < inline.length && index > 0 && (index + 1) % step === 0) {
        body.push(`![](${inline[placed]})`, "");
        placed += 1;
      }
    }
    for (; placed < inline.length; placed += 1) body.push(`![](${inline[placed]})`, "");

    const front = [
      "---",
      `title: ${yamlString(article.title)}`,
      `slug: ${article.slug}`,
      `date: ${String(article.publishedAt).slice(0, 10)}`,
      `category: ${CATEGORY}`,
      `tags: ${yamlList(article.tags ?? [])}`,
      `excerpt: ${yamlString(article.description ?? "")}`,
      ...(cover ? [`cover: ${cover}`] : []),
      `seoTitle: ${yamlString(article.title)}`,
      `seoDescription: ${yamlString(article.description ?? "")}`,
      `source: ${MARK}`,
      `sourceId: ${article.id}`,
      "---",
      "",
    ].join("\n");

    const content = front + body.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";

    if (DRY) {
      console.log(`  ${existing.has(file) ? "обновил бы" : "добавил бы"}: ${file} (${paragraphs.length} абз., ${inline.length} кадр.)`);
      continue;
    }

    const before = existing.has(file) ? await readFile(target, "utf8") : "";
    if (before === content) {
      skipped += 1;
      continue;
    }
    await writeFile(target, content, "utf8");
    if (existing.has(file)) updated += 1;
    else added += 1;
    console.log(`  ${existing.has(file) ? "обновил" : "добавил"}: ${file}`);
  }

  console.log(DRY ? "Пробный прогон, файлы не тронуты." : `Добавлено: ${added}, обновлено: ${updated}, без изменений: ${skipped}`);
}

await main();
