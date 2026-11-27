/**
 * Живая лента Медиамашины для блога — только на сервере.
 *
 * Статья, опубликованная в Медиамашине, появляется на /blog сразу, без
 * коммита и пересборки: страница блога на сервере читает ленту v1 и
 * подмешивает новые материалы к файлам content/blog.
 *
 * Надёжность важнее свежести:
 *  - ответ ленты кэшируется в памяти процесса на FRESH_MS; пока кэш свежий,
 *    лента не дёргается вовсе;
 *  - устаревший кэш отдаётся сразу, а обновление идёт в фоне (один запрос
 *    на процесс, без лавины);
 *  - лента не ответила за TIMEOUT_MS, ответила ошибкой или ключа нет —
 *    блог работает на том, что есть: прошлый удачный ответ или только файлы.
 *    Страница блога из-за ленты не падает и не ждёт дольше TIMEOUT_MS.
 *
 * Файл главнее ленты: статья, уже лежащая в content/blog (тот же адрес или
 * тот же sourceId — его ставит scripts/sync-mediamachine.mjs), берётся из
 * файла. Синк остаётся: он сохраняет статьи и картинки в репозиторий, и они
 * живут, даже если Медиамашина когда-нибудь исчезнет.
 *
 * Правила отбора те же, что у синка: без текста и без обложки не берём
 * (владелец 24.09.2026), повтор лида в первом абзаце убираем, теги — только
 * из словаря блога.
 *
 * Окружение: MM_SITE_KEY — ключ выдачи (тот же, что в секрете GitHub);
 * MM_FEED — адрес ленты, если нужно переопределить.
 */

import { getAllPosts, sortPosts, type BlogCategory, type BlogPost } from "./blog";

const FEED = process.env.MM_FEED ?? "https://mediamachina.ru/api/site/v1/articles";
const LIMIT = 50;
const FRESH_MS = 5 * 60_000;
const TIMEOUT_MS = 2_500;
const CATEGORY: BlogCategory = "news";
const MAX_TAGS = 3;

type FeedArticle = {
  id?: string | number;
  slug?: string;
  title?: string;
  description?: string;
  paragraphs?: string[];
  cover?: string | null;
  images?: string[];
  tags?: string[];
  publishedAt?: string;
};

let cache: { at: number; posts: BlogPost[] } | null = null;
let inflight: Promise<void> | null = null;
let lastProblem = "";

const normalize = (value: unknown) =>
  String(value ?? "").toLowerCase().replace(/[#\s_-]+/g, "").replace(/ё/g, "е");

function tagVocabulary(local: BlogPost[]): Map<string, string> {
  const vocabulary = new Map<string, string>();
  for (const post of local) for (const tag of post.tags) vocabulary.set(normalize(tag), tag);
  return vocabulary;
}

function mapTags(feedTags: string[] | undefined, vocabulary: Map<string, string>): string[] {
  const picked: string[] = [];
  for (const feedTag of feedTags ?? []) {
    const key = normalize(feedTag);
    for (const [norm, tag] of vocabulary) {
      if ((key === norm || key.includes(norm)) && !picked.includes(tag)) picked.push(tag);
    }
  }
  return picked.slice(0, MAX_TAGS);
}

const SAFE_SLUG = /^[a-z0-9][a-z0-9-]{0,150}$/;
const isHttpUrl = (value: unknown): value is string =>
  typeof value === "string" && /^https:\/\/[^\s"'<>()]+$/.test(value);

/** Материал ленты → статья блога. null — не берём (те же правила, что у синка). */
export function feedArticleToPost(article: FeedArticle, vocabulary: Map<string, string>): BlogPost | null {
  const slug = String(article.slug ?? "");
  const title = String(article.title ?? "").trim();
  if (!SAFE_SLUG.test(slug) || !title || !isHttpUrl(article.cover)) return null;

  // Текст ленты — обычные абзацы, не разметка: экранируем то, что
  // ReactMarkdown с rehype-raw иначе принял бы за HTML.
  const paragraphs = (article.paragraphs ?? [])
    .filter((p): p is string => typeof p === "string" && p.trim() !== "")
    .map((p) => p.trim().replace(/</g, "&lt;").replace(/>/g, "&gt;"));
  const lead = normalize(article.description);
  while (paragraphs.length && [normalize(title), lead].includes(normalize(paragraphs[0]))) paragraphs.shift();
  if (paragraphs.length === 0) return null;

  // Кадры между абзацами, как у синка: иначе они читаются приложением.
  const inline = (article.images ?? []).filter((src) => isHttpUrl(src) && src !== article.cover);
  const alt = title.replace(/[[\]]/g, "");
  const step = inline.length > 0 ? Math.max(2, Math.floor(paragraphs.length / (inline.length + 1))) : 0;
  const body: string[] = [];
  let placed = 0;
  paragraphs.forEach((paragraph, index) => {
    body.push(paragraph);
    if (step > 0 && placed < inline.length && index > 0 && (index + 1) % step === 0) {
      body.push(`![${alt}](${inline[placed++]})`);
    }
  });
  while (placed < inline.length) body.push(`![${alt}](${inline[placed++]})`);

  const words = paragraphs.join(" ").split(/\s+/).filter(Boolean).length;
  const description = String(article.description || article.paragraphs?.[0] || "").trim().replace(/\s+/g, " ");
  const date = String(article.publishedAt ?? "").slice(0, 10);

  return {
    slug,
    title,
    excerpt: description.slice(0, 300),
    content: body.join("\n\n"),
    cover: article.cover,
    category: CATEGORY,
    tags: mapTags(article.tags, vocabulary),
    date: /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : "",
    readingTime: Math.max(1, Math.round(words / 180)),
    seoTitle: title.slice(0, 70),
    seoDescription: description.slice(0, 160),
    legacyUid: null,
    sourceId: article.id != null ? String(article.id) : null,
  };
}

async function refresh(): Promise<void> {
  const key = process.env.MM_SITE_KEY ?? "";
  if (!key) {
    lastProblem = "нет MM_SITE_KEY";
    return;
  }
  try {
    const response = await fetch(`${FEED}?key=${encodeURIComponent(key)}&limit=${LIMIT}`, {
      signal: AbortSignal.timeout(TIMEOUT_MS * 4),
      headers: { accept: "application/json" },
    });
    if (!response.ok) throw new Error(`лента ответила ${response.status}`);
    const json = (await response.json()) as { articles?: FeedArticle[] };
    const vocabulary = tagVocabulary(getAllPosts());
    const posts = (Array.isArray(json.articles) ? json.articles : [])
      .map((article) => feedArticleToPost(article, vocabulary))
      .filter((post): post is BlogPost => post !== null);
    cache = { at: Date.now(), posts };
    lastProblem = "";
  } catch (error) {
    const problem = error instanceof Error ? error.message : String(error);
    // В журнал службы — один раз на смену причины, а не на каждый запрос.
    if (problem !== lastProblem) console.warn(`[blog-feed] ${problem}; блог работает на файлах и прошлом ответе`);
    lastProblem = problem;
    // Неудача тоже обновляет метку: следующая попытка — не раньше чем через FRESH_MS.
    cache = { at: Date.now(), posts: cache?.posts ?? [] };
  }
}

const currentPosts = (): BlogPost[] => cache?.posts ?? [];

/** Статьи из ленты (уже отобранные). Не бросает и не ждёт дольше TIMEOUT_MS. */
async function feedPosts(): Promise<BlogPost[]> {
  const stale = !cache || Date.now() - cache.at > FRESH_MS;
  if (stale && !inflight) inflight = refresh().finally(() => (inflight = null));
  if (cache) return cache.posts; // устаревший отдаём сразу, обновление идёт в фоне
  let timer: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([inflight, new Promise((resolve) => (timer = setTimeout(resolve, TIMEOUT_MS)))]);
  clearTimeout(timer);
  // cache мог появиться, пока ждали; TypeScript этого не видит после `if (cache)` выше.
  return currentPosts();
}

/** Итоговый список блога: файлы + новые статьи ленты, свежие сверху. */
export async function getLivePosts(): Promise<BlogPost[]> {
  const local = getAllPosts();
  const fromFeed = await feedPosts();
  if (fromFeed.length === 0) return local;

  const slugs = new Set(local.map((p) => p.slug));
  const sourceIds = new Set(local.map((p) => p.sourceId).filter(Boolean));
  const extra = fromFeed.filter((p) => !slugs.has(p.slug) && !(p.sourceId && sourceIds.has(p.sourceId)));
  return extra.length === 0 ? local : sortPosts([...local, ...extra]);
}

/** Для проверки на сервере: что сейчас с лентой. */
export function feedStatus(): { cachedAt: string | null; feedPosts: number; problem: string } {
  return {
    cachedAt: cache ? new Date(cache.at).toISOString() : null,
    feedPosts: cache?.posts.length ?? 0,
    problem: lastProblem,
  };
}
