/**
 * Блог на локальных файлах.
 *
 * Единственный источник статей — каталог content/blog/*.md.
 * Никакой базы данных и никакой внешней CMS здесь нет и быть не должно:
 * статьи попадают на сайт коммитом, версионируются вместе с кодом
 * и собираются в статику на этапе сборки.
 *
 * Файлы читаются через import.meta.glob с eager: true — то есть на этапе
 * сборки, а не в рантайме. В собранном бандле остаются готовые данные,
 * обращений к файловой системе на боевом сервере не происходит.
 */

export const BLOG_CATEGORIES = {
  tech: "Технология",
  comparison: "Сравнения",
  cases: "Кейсы",
  news: "Новости",
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
    let value = line.slice(sep + 1).trim();
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
  if (value.length > 1 && value[0] === value[value.length - 1] && (value[0] === '"' || value[0] === "'")) {
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
      readingTime: Number.isFinite(declaredReading) && declaredReading > 0
        ? declaredReading
        : Math.max(2, Math.round(words / 900)),
      seoTitle: asString(data.seoTitle, title),
      seoDescription: asString(data.seoDescription, asString(data.excerpt)),
      legacyUid: asString(data.legacyUid) || null,
    });
  }

  // Свежие сверху. При равных датах — по алфавиту, чтобы порядок был
  // детерминированным и сборка воспроизводимой.
  return posts.sort((a, b) => (b.date.localeCompare(a.date) || a.slug.localeCompare(b.slug)));
}

const allPosts = buildPosts();

/* ------------------------------------------------------------------ */
/* Публичный интерфейс                                                 */
/* ------------------------------------------------------------------ */

export function getAllPosts(): BlogPost[] {
  return allPosts;
}

export function getPostBySlug(slug: string): BlogPost | undefined {
  return allPosts.find((p) => p.slug === slug);
}

export function getPostsByCategory(category: string): BlogPost[] {
  return allPosts.filter((p) => p.category === category);
}

export function getPostsByTag(tag: string): BlogPost[] {
  const needle = tag.toLowerCase();
  return allPosts.filter((p) => p.tags.some((t) => t.toLowerCase() === needle));
}

/** Категории, в которых реально есть статьи, с количеством. */
export function getCategories(): Array<{ key: BlogCategory; label: string; count: number }> {
  return (Object.keys(BLOG_CATEGORIES) as BlogCategory[])
    .map((key) => ({
      key,
      label: BLOG_CATEGORIES[key],
      count: allPosts.filter((p) => p.category === key).length,
    }))
    .filter((c) => c.count > 0);
}

/** Все теги с количеством статей, по убыванию частоты. */
export function getTags(): Array<{ tag: string; slug: string; count: number }> {
  const counts = new Map<string, number>();
  for (const post of allPosts) {
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
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh", з: "z",
  и: "i", й: "i", к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r",
  с: "s", т: "t", у: "u", ф: "f", х: "h", ц: "ts", ч: "ch", ш: "sh",
  щ: "sch", ъ: "", ы: "y", ь: "", э: "e", ю: "yu", я: "ya",
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

export function getTagBySlug(slug: string): string | undefined {
  return getTags().find((t) => t.slug === slug)?.tag;
}

/**
 * Похожие статьи: сначала совпадение по тегам, затем по категории.
 * Нужны для перелинковки — без неё статьи не передают друг другу вес.
 */
export function getRelatedPosts(post: BlogPost, limit = 3): BlogPost[] {
  const scored = allPosts
    .filter((p) => p.slug !== post.slug)
    .map((p) => ({
      post: p,
      score:
        p.tags.filter((t) => post.tags.includes(t)).length * 2 +
        (p.category === post.category ? 1 : 0),
    }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || b.post.date.localeCompare(a.post.date));

  const result = scored.slice(0, limit).map((x) => x.post);

  // Добираем свежими, если по тегам не хватило.
  if (result.length < limit) {
    for (const p of allPosts) {
      if (result.length >= limit) break;
      if (p.slug !== post.slug && !result.includes(p)) result.push(p);
    }
  }
  return result;
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
