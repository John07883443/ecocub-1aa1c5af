/**
 * Блог: статьи из файлов + живая лента Медиамашины.
 *
 * Здесь — файловая часть: каталог content/blog/*.md, собранный в бандл.
 * Это гарантированный минимум: он есть всегда, даже если лента лежит.
 * Живая лента (новые статьи без коммита и пересборки) подмешивается на
 * сервере в blog-feed.server.ts, маршруты получают итоговый список через
 * серверные функции из blog-live.ts. Все выборки ниже принимают список
 * статей параметром — по умолчанию файловый.
 *
 * Файлы читаются через import.meta.glob с eager: true — то есть на этапе
 * сборки, а не в рантайме. В собранном бандле остаются готовые данные,
 * обращений к файловой системе на боевом сервере не происходит.
 */

import { pickRelated } from "./related";

export const BLOG_CATEGORIES = {
  tech: "Технология",
  comparison: "Сравнения",
  cases: "Кейсы",
  news: "Новости",
  guides: "Гайды",
} as const;

export type BlogCategory = keyof typeof BLOG_CATEGORIES;

export type BlogPost = {
  slug: string;
  title: string;
  excerpt: string;
  content: string;
  cover: string | null;
  category: BlogCategory;
  tags: string[];
  /** ISO-дата публикации, YYYY-MM-DD */
  date: string;
  readingTime: number;
  seoTitle: string;
  seoDescription: string;
  /** uid статьи в Тильде — нужен для 301-редиректов со старых адресов /tpost/ */
  legacyUid: string | null;
  /** id материала в Медиамашине — по нему файл и лента не задваиваются */
  sourceId?: string | null;
  /** Подпись к обложке; нет — берётся заголовок. */
  coverAlt?: string;
  /** Ключевые слова для разметки Article и meta keywords (из ленты ММ). */
  keywords?: string[];
  /** ISO-дата обновления, YYYY-MM-DD (dateModified, lastmod в карте сайта). */
  updated?: string;
  /** Превью для соцсетей 1200×630 на нашем домене; нет — берётся обложка. */
  ogImage?: string | null;
  /** Размеры кадров на нашем домене: src → width/height для <img>. */
  imageSizes?: Record<string, { width: number; height: number }>;
  /**
   * updatedAt материала ММ, из которого синк сделал файл. Есть только у
   * файлов нового синка: такой файл лента может обновить (та же статья,
   * тот же адрес). У 36 старых статей поля нет — их лента не трогает никогда.
   */
  mmUpdatedAt?: string;
};

/* ------------------------------------------------------------------ */
/* Разбор front matter                                                 */
/* ------------------------------------------------------------------ */

/**
 * Намеренно свой минимальный парсер вместо YAML-библиотеки.
 * Формат front matter у нас плоский и под нашим контролем, а лишняя
 * зависимость в сборке — лишний риск и лишний вес.
 *
 * Поддерживается: key: value, key: "value", key: [a, b, c].
 */
function parseFrontMatter(raw: string): { data: Record<string, string | string[]>; body: string } {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(raw);
  if (!match) return { data: {}, body: raw };

  const data: Record<string, string | string[]> = {};
  for (const line of match[1].split(/\r?\n/)) {
    const sep = line.indexOf(":");
    if (sep === -1) continue;
    const key = line.slice(0, sep).trim();
    const value = line.slice(sep + 1).trim();
    if (!key) continue;

    if (value.startsWith("[") && value.endsWith("]")) {
      data[key] = value
        .slice(1, -1)
        .split(",")
        .map((v) => unquote(v.trim()))
        .filter(Boolean);
      continue;
    }
    data[key] = unquote(value);
  }
  return { data, body: match[2] };
}

function unquote(value: string): string {
  if (
    value.length > 1 &&
    value[0] === value[value.length - 1] &&
    (value[0] === '"' || value[0] === "'")
  ) {
    return value.slice(1, -1);
  }
  return value;
}

function asString(value: string | string[] | undefined, fallback = ""): string {
  if (Array.isArray(value)) return value.join(", ");
  return value ?? fallback;
}

function asCategory(value: string | string[] | undefined): BlogCategory {
  const v = asString(value);
  return v in BLOG_CATEGORIES ? (v as BlogCategory) : "tech";
}

/* ------------------------------------------------------------------ */
/* Загрузка                                                            */
/* ------------------------------------------------------------------ */

const files = import.meta.glob<string>("../../content/blog/*.md", {
  query: "?raw",
  import: "default",
  eager: true,
});

function buildPosts(): BlogPost[] {
  const posts: BlogPost[] = [];

  for (const [path, raw] of Object.entries(files)) {
    const { data, body } = parseFrontMatter(raw);
    const fileSlug = path.split("/").pop()!.replace(/\.md$/, "");
    const slug = asString(data.slug, fileSlug) || fileSlug;
    const title = asString(data.title);

    // Статья без заголовка или без текста — ошибка контента, а не повод
    // отдать пользователю пустую страницу. Молча пропускаем.
    if (!title || !body.trim()) continue;

    const words = body.trim().split(/\s+/).length;
    const declaredReading = Number(asString(data.readingTime));

    posts.push({
      slug,
      title,
      excerpt: asString(data.excerpt),
      content: body.trim(),
      cover: asString(data.cover) || null,
      category: asCategory(data.category),
      tags: Array.isArray(data.tags) ? data.tags : data.tags ? [data.tags] : [],
      date: asString(data.date),
      readingTime:
        Number.isFinite(declaredReading) && declaredReading > 0
          ? declaredReading
          : Math.max(2, Math.round(words / 900)),
      seoTitle: asString(data.seoTitle, title),
      seoDescription: asString(data.seoDescription, asString(data.excerpt)),
      legacyUid: asString(data.legacyUid) || null,
      sourceId: asString(data.sourceId) || null,
      ...(asString(data.coverAlt) ? { coverAlt: asString(data.coverAlt) } : {}),
      ...(Array.isArray(data.keywords) && data.keywords.length ? { keywords: data.keywords } : {}),
      ...(asString(data.updated) ? { updated: asString(data.updated) } : {}),
      ...(asString(data.ogImage) ? { ogImage: asString(data.ogImage) } : {}),
      ...(asString(data.mmUpdatedAt) ? { mmUpdatedAt: asString(data.mmUpdatedAt) } : {}),
    });
  }

  return sortPosts(posts);
}

const allPosts = buildPosts();

/* ------------------------------------------------------------------ */
/* Публичный интерфейс                                                 */
/* ------------------------------------------------------------------ */

export function getAllPosts(): BlogPost[] {
  return allPosts;
}

export function getPostBySlug(slug: string, posts: BlogPost[] = allPosts): BlogPost | undefined {
  return posts.find((p) => p.slug === slug);
}

export function getPostsByCategory(category: string, posts: BlogPost[] = allPosts): BlogPost[] {
  return posts.filter((p) => p.category === category);
}

export function getPostsByTag(tag: string, posts: BlogPost[] = allPosts): BlogPost[] {
  const needle = tag.toLowerCase();
  return posts.filter((p) => p.tags.some((t) => t.toLowerCase() === needle));
}

/** Свежие сверху; при равных датах — по адресу, чтобы порядок не прыгал. */
export function sortPosts(posts: BlogPost[]): BlogPost[] {
  return posts.sort((a, b) => b.date.localeCompare(a.date) || a.slug.localeCompare(b.slug));
}

/** Категории, в которых реально есть статьи, с количеством. */
export function getCategories(
  posts: BlogPost[] = allPosts,
): Array<{ key: BlogCategory; label: string; count: number }> {
  return (Object.keys(BLOG_CATEGORIES) as BlogCategory[])
    .map((key) => ({
      key,
      label: BLOG_CATEGORIES[key],
      count: posts.filter((p) => p.category === key).length,
    }))
    .filter((c) => c.count > 0);
}

/** Все теги с количеством статей, по убыванию частоты. */
export function getTags(
  posts: BlogPost[] = allPosts,
): Array<{ tag: string; slug: string; count: number }> {
  const counts = new Map<string, number>();
  for (const post of posts) {
    for (const tag of post.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([tag, count]) => ({ tag, slug: tagToSlug(tag), count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
}

/**
 * Тег в адрес страницы. Кириллица переводится в латиницу:
 * /blog/tag/tsena-i-smeta читается и людьми, и поисковиками,
 * в отличие от процентной кодировки.
 */
const TRANSLIT: Record<string, string> = {
  а: "a",
  б: "b",
  в: "v",
  г: "g",
  д: "d",
  е: "e",
  ё: "e",
  ж: "zh",
  з: "z",
  и: "i",
  й: "i",
  к: "k",
  л: "l",
  м: "m",
  н: "n",
  о: "o",
  п: "p",
  р: "r",
  с: "s",
  т: "t",
  у: "u",
  ф: "f",
  х: "h",
  ц: "ts",
  ч: "ch",
  ш: "sh",
  щ: "sch",
  ъ: "",
  ы: "y",
  ь: "",
  э: "e",
  ю: "yu",
  я: "ya",
};

export function tagToSlug(tag: string): string {
  return tag
    .toLowerCase()
    .split("")
    .map((ch) => (ch in TRANSLIT ? TRANSLIT[ch] : ch))
    .join("")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function getTagBySlug(slug: string, posts: BlogPost[] = allPosts): string | undefined {
  return getTags(posts).find((t) => t.slug === slug)?.tag;
}

/**
 * «Читать дальше»: самые близкие по смыслу статьи из всех статей сайта
 * (старые файлы и лента ММ вместе). Формула и порог — в related.ts
 * (перенос из эталона media-block); без общего признака — добор свежими.
 */
export function getRelatedPosts(
  post: BlogPost,
  limit = 3,
  posts: BlogPost[] = allPosts,
): BlogPost[] {
  return pickRelated(post, posts, limit);
}

/** Карта старых адресов Тильды на новые — для 301-редиректов. */
export function getLegacyRedirects(): Array<{ from: string; to: string }> {
  return allPosts
    .filter((p) => p.legacyUid)
    .map((p) => ({ from: `/tpost/${p.legacyUid}`, to: `/blog/${p.slug}` }));
}

/** Дата в человеческом виде: 20 апреля 2026. */
export function formatDate(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" });
}
