/**
 * Забрать статьи из Медиамашины и положить их в блог сайта.
 *
 * Зачем так, а не встраиваемым скриптом. Владелец 07.09.2026: «только
 * полный текст на сайте, потому что SEO в приоритете, всё на стороне
 * сайта, куда подключаем контент». Статья становится таким же файлом в
 * content/blog, как остальные: своя страница, свой адрес, карта сайта.
 * Живая лента (blog-feed.server.ts) показывает статью сразу; синк делает
 * её файлом, чтобы она жила, даже если Медиамашина когда-нибудь исчезнет.
 *
 * Разбор материала — общий с живой лентой (src/lib/mm-article.ts): H2/H3,
 * описание, ключевые слова, рубрика, «Вопросы и ответы», подписи кадров,
 * ссылка на конструктор. Кадры скачиваются в public/images/blog и
 * перегоняются в WebP ≤ 300 КБ, к обложке — превью 1200×630 для соцсетей.
 *
 * Правила:
 *  - старый файл не трогаем никогда (ни ручной, ни принесённый до 27.11):
 *    правка на сайте главнее нашей копии, адреса со ссылочной массой не
 *    меняются (владелец 27.11);
 *  - файл нового синка (есть mmUpdatedAt) обновляется, если материал в ММ
 *    правили позже; адрес остаётся прежним;
 *  - статья, уже принесённая под другим адресом (sourceId совпал), второй
 *    раз не приносится — заголовок в Медиамашине могли поправить;
 *  - теги — только из словаря блога (фильтры на странице /blog).
 *
 * Запуск (Node 22: флаг нужен для общего разбора на TypeScript):
 *   MM_KEY=mm_... node --experimental-strip-types scripts/sync-mediamachine.mjs
 *   MM_KEY=mm_... node --experimental-strip-types scripts/sync-mediamachine.mjs --dry
 * По расписанию — .github/workflows/sync-mediamachine.yml.
 */

import { mkdir, readdir, readFile, unlink, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import {
  buildMmPost,
  imageBaseName,
  isHttpsUrl,
  isWithdrawn,
  normalizeTag,
  parseWithdrawn,
} from "../src/lib/mm-article.ts";
import { toOgJpeg, toWebp } from "../src/lib/image-webp.ts";

const FEED = process.env.MM_FEED ?? "https://mediamachina.ru/api/site/v1/articles";
const KEY = process.env.MM_KEY ?? "";
const LIMIT = Number(process.env.MM_LIMIT ?? "50");
const DRY = process.argv.includes("--dry");

// SYNC_ROOT — для проверок на копии репозитория.
const ROOT = process.env.SYNC_ROOT
  ? path.resolve(process.env.SYNC_ROOT)
  : path.resolve(import.meta.dirname, "..");
const POSTS_DIR = path.join(ROOT, "content", "blog");
const IMAGES_DIR = path.join(ROOT, "public", "images", "blog");
const MARK = "mediamachine";

if (!KEY) {
  console.error(
    "Нужен ключ: MM_KEY=mm_... node --experimental-strip-types scripts/sync-mediamachine.mjs",
  );
  process.exit(1);
}

function yamlString(value) {
  return `"${String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, " ")}"`;
}

function yamlList(items) {
  return `[${items.map(yamlString).join(", ")}]`;
}

/**
 * Кадр → public/images/blog/<имя>.webp (≤ 300 КБ); для обложки ещё и
 * <имя>-og.jpg 1200×630. Уже лежащий файл не перекачиваем.
 * null — кадр не скачался или не перегнался.
 */
async function saveImage(url, slug, index) {
  const base = imageBaseName(slug, index, url);
  const webp = `${base}.webp`;
  const og = `${base}-og.jpg`;
  const result = { src: `/images/blog/${webp}`, og: index === 0 ? `/images/blog/${og}` : null };
  const ready =
    existsSync(path.join(IMAGES_DIR, webp)) &&
    (index !== 0 || existsSync(path.join(IMAGES_DIR, og)));
  if (ready || DRY) return result;

  const response = await fetch(url, { signal: AbortSignal.timeout(30_000) }).catch(() => null);
  if (!response?.ok) {
    console.warn(`  кадр не скачался (${response?.status ?? "сеть"}): ${url}`);
    return null;
  }
  try {
    const source = Buffer.from(await response.arrayBuffer());
    await writeFile(path.join(IMAGES_DIR, webp), (await toWebp(source)).data);
    if (index === 0) await writeFile(path.join(IMAGES_DIR, og), (await toOgJpeg(source)).data);
    return result;
  } catch (error) {
    console.warn(
      `  кадр не перегнался (${error instanceof Error ? error.message : error}): ${url}`,
    );
    return null;
  }
}

/** Словарь тегов блога — то, что уже стоит в фильтрах на /blog. */
async function blogTagVocabulary(files) {
  const vocabulary = new Map();
  for (const file of files) {
    const text = await readFile(path.join(POSTS_DIR, file), "utf8");
    const line = text.match(/^tags:\s*\[(.*)\]\s*$/m)?.[1] ?? "";
    for (const raw of line.split(",")) {
      const tag = raw.trim().replace(/^"|"$/g, "");
      if (tag) vocabulary.set(normalizeTag(tag), tag);
    }
  }
  return vocabulary;
}

const field = (text, name) =>
  text.match(new RegExp(`^${name}:\\s*"?([^"\\n]*)"?\\s*$`, "m"))?.[1]?.trim() ?? "";

async function main() {
  const response = await fetch(`${FEED}?key=${encodeURIComponent(KEY)}&limit=${LIMIT}`, {
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok) {
    console.error(`Выдача ответила ${response.status}`);
    process.exit(1);
  }
  const { articles = [], withdrawn: rawWithdrawn } = await response.json();
  const withdrawn = parseWithdrawn(rawWithdrawn);
  console.log(`Получено материалов: ${articles.length}`);

  await mkdir(POSTS_DIR, { recursive: true });
  await mkdir(IMAGES_DIR, { recursive: true });

  const files = (await readdir(POSTS_DIR)).filter((file) => file.endsWith(".md"));
  const existing = new Set(files);
  const byId = new Map();
  for (const file of files) {
    const text = await readFile(path.join(POSTS_DIR, file), "utf8");
    const id = field(text, "sourceId");
    if (id) byId.set(id, { file, mmUpdatedAt: field(text, "mmUpdatedAt") });
  }
  const vocabulary = await blogTagVocabulary(files);

  // Снятые в ММ статьи (withdrawn[]) — файл удаляется, но только файл нового
  // синка (есть mmUpdatedAt). Статьи, бывшие на сайте до 27.11, не трогаем:
  // их адреса не меняются по решению владельца.
  let removed = 0;
  for (const file of files) {
    const text = await readFile(path.join(POSTS_DIR, file), "utf8");
    const post = { slug: file.replace(/\.md$/, ""), sourceId: field(text, "sourceId") || null };
    if (!isWithdrawn(post, withdrawn)) continue;
    if (!field(text, "mmUpdatedAt")) {
      console.warn(`  ММ сняла ${file}, но это старая статья — оставляю (решение владельца 27.11)`);
      continue;
    }
    if (!DRY) await unlink(path.join(POSTS_DIR, file));
    if (post.sourceId) byId.delete(post.sourceId);
    existing.delete(file);
    removed += 1;
    console.log(`  ${DRY ? "снял бы" : "снял"}: ${file}`);
  }

  let added = 0;
  let updated = 0;
  let skipped = 0;
  for (const article of articles) {
    if (
      isWithdrawn(
        {
          slug: String(article.slug ?? ""),
          sourceId: article.id != null ? String(article.id) : null,
        },
        withdrawn,
      )
    )
      continue;
    const known = article.id != null ? byId.get(String(article.id)) : undefined;
    const feedUpdated = String(article.updatedAt ?? "").slice(0, 10);
    let file = `${article.slug}.md`;
    let slug = String(article.slug ?? "");
    if (known) {
      // Та же статья уже лежит файлом: обновляем только файл нового синка и
      // только если материал правили позже. Адрес — прежний, из имени файла.
      const fresher =
        known.mmUpdatedAt && feedUpdated && feedUpdated > known.mmUpdatedAt.slice(0, 10);
      if (!fresher) {
        skipped += 1;
        continue;
      }
      file = known.file;
      slug = known.file.replace(/\.md$/, "");
    } else if (existing.has(file)) {
      skipped += 1;
      continue;
    }

    // Кадры — заранее (скачать и перегнать), разбор потом берёт готовые адреса.
    const local = new Map();
    let ogImage = null;
    const urls = [article.cover, ...(article.images ?? []).filter((url) => url !== article.cover)];
    for (const [index, url] of urls.entries()) {
      if (!isHttpsUrl(url)) continue;
      const saved = await saveImage(url, slug, index);
      if (saved) {
        local.set(`${index}|${url}`, saved.src);
        if (index === 0) ogImage = saved.og;
      } else if (index === 0) {
        break; // без обложки статью не берём — следующий прогон попробует снова
      }
    }

    // Без обложки и без текста в блог не берём (владелец 24.09.2026).
    const built = buildMmPost(
      { ...article, slug },
      { vocabulary, localize: (url, index) => local.get(`${index}|${url}`) ?? null },
    );
    if (!built) {
      console.log(`  пропускаю (нет текста или обложки): ${article.title}`);
      skipped += 1;
      continue;
    }

    const front = [
      "---",
      `title: ${yamlString(built.title)}`,
      `slug: ${built.slug}`,
      `date: ${built.date}`,
      ...(built.updated ? [`updated: ${built.updated}`] : []),
      `category: ${built.category}`,
      `tags: ${yamlList(built.tags)}`,
      ...(built.keywords.length ? [`keywords: ${yamlList(built.keywords)}`] : []),
      `excerpt: ${yamlString(built.excerpt)}`,
      `cover: ${built.cover}`,
      `coverAlt: ${yamlString(built.coverAlt)}`,
      ...(ogImage ? [`ogImage: ${ogImage}`] : []),
      `readingTime: ${built.readingTime}`,
      `seoTitle: ${yamlString(built.seoTitle)}`,
      `seoDescription: ${yamlString(built.seoDescription)}`,
      `source: ${MARK}`,
      `sourceId: ${built.sourceId ?? ""}`,
      `mmUpdatedAt: ${feedUpdated || built.date}`,
      "---",
      "",
    ].join("\n");

    const content = front + built.content.replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
    const verb = known ? "обновил" : "добавил";
    if (DRY) {
      console.log(
        `  ${verb} бы: ${file} · рубрика ${built.category} · кадров ${local.size} · теги ${JSON.stringify(built.tags)}`,
      );
      continue;
    }
    await writeFile(path.join(POSTS_DIR, file), content, "utf8");
    if (known) updated += 1;
    else added += 1;
    console.log(`  ${verb}: ${file}`);
  }

  console.log(
    DRY
      ? "Пробный прогон, файлы не тронуты."
      : `Добавлено: ${added}, обновлено: ${updated}, снято: ${removed}, пропущено: ${skipped}`,
  );
}

await main();
