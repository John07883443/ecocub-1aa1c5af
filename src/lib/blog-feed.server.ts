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

import { getAllPosts, sortPosts, type BlogPost } from "./blog";
import { buildMmPost, type MmArticle } from "./mm-article";
import { localizeFeedImage, mediaSizes, ogImageFor, prewarmMedia } from "./blog-media.server";

const FEED = process.env.MM_FEED ?? "https://mediamachina.ru/api/site/v1/articles";
const LIMIT = 50;
const FRESH_MS = 5 * 60_000;
const TIMEOUT_MS = 2_500;

type FeedArticle = MmArticle;

let cache: { at: number; posts: BlogPost[] } | null = null;
let inflight: Promise<void> | null = null;
let lastProblem = "";

function tagVocabulary(local: BlogPost[]): Map<string, string> {
  const vocabulary = new Map<string, string>();
  for (const post of local) for (const tag of post.tags) vocabulary.set(normalize(tag), tag);
  return vocabulary;
}

const normalize = (value: unknown) =>
  String(value ?? "")
    .toLowerCase()
    .replace(/[#\s_-]+/g, "")
    .replace(/ё/g, "е");

/**
 * Материал ленты → статья блога. null — не берём (те же правила, что у синка).
 * Разбор — общий с синком (mm-article.ts); кадры — на наш домен.
 */
export function feedArticleToPost(
  article: FeedArticle,
  vocabulary: Map<string, string>,
): BlogPost | null {
  const slug = String(article.slug ?? "");
  const built = buildMmPost(article, {
    vocabulary,
    localize: (url, index) => localizeFeedImage(slug, index, url),
  });
  if (!built) return null;
  return {
    slug: built.slug,
    title: built.title,
    excerpt: built.excerpt,
    content: built.content,
    cover: built.cover,
    coverAlt: built.coverAlt,
    category: built.category,
    tags: built.tags,
    keywords: built.keywords,
    date: built.date,
    ...(built.updated ? { updated: built.updated } : {}),
    readingTime: built.readingTime,
    seoTitle: built.seoTitle,
    seoDescription: built.seoDescription,
    legacyUid: null,
    sourceId: built.sourceId,
    ogImage: ogImageFor(built.cover),
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
    prewarmMedia();
  } catch (error) {
    const problem = error instanceof Error ? error.message : String(error);
    // В журнал службы — один раз на смену причины, а не на каждый запрос.
    if (problem !== lastProblem)
      console.warn(`[blog-feed] ${problem}; блог работает на файлах и прошлом ответе`);
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
  await Promise.race([
    inflight,
    new Promise((resolve) => (timer = setTimeout(resolve, TIMEOUT_MS))),
  ]);
  clearTimeout(timer);
  // cache мог появиться, пока ждали; TypeScript этого не видит после `if (cache)` выше.
  return currentPosts();
}

/** Размеры готовых кадров ленты — для width/height у <img>. */
function withSizes(post: BlogPost): BlogPost {
  if (!post.cover?.startsWith("/media/")) return post;
  const srcs = [
    post.cover,
    ...[...post.content.matchAll(/\]\((\/media\/blog\/[^)\s]+)\)/g)].map((m) => m[1]),
  ];
  const imageSizes = mediaSizes(srcs);
  return Object.keys(imageSizes).length ? { ...post, imageSizes } : post;
}

/**
 * Итоговый список блога: файлы + новые статьи ленты, свежие сверху.
 *
 * Файл главнее ленты (владелец 27.11: старые адреса не меняются, лента
 * только добавляет). Одно исключение: файл, который сделал новый синк
 * (есть mmUpdatedAt), лента может обновить, если материал в ММ правили
 * позже, — та же статья под адресом файла. У 36 старых статей mmUpdatedAt
 * нет, их лента не трогает никогда.
 */
export async function getLivePosts(): Promise<BlogPost[]> {
  const local = getAllPosts();
  const fromFeed = await feedPosts();
  if (fromFeed.length === 0) return local;

  const feedById = new Map(
    fromFeed.filter((p) => p.sourceId).map((p) => [p.sourceId as string, p]),
  );
  let changed = false;
  const merged = local.map((file) => {
    const fresh = file.mmUpdatedAt && file.sourceId ? feedById.get(file.sourceId) : undefined;
    if (!fresh?.updated || fresh.updated <= (file.mmUpdatedAt as string).slice(0, 10)) return file;
    changed = true;
    return withSizes({
      ...fresh,
      slug: file.slug,
      legacyUid: file.legacyUid,
      mmUpdatedAt: file.mmUpdatedAt,
    });
  });

  const slugs = new Set(local.map((p) => p.slug));
  const sourceIds = new Set(local.map((p) => p.sourceId).filter(Boolean));
  const extra = fromFeed
    .filter((p) => !slugs.has(p.slug) && !(p.sourceId && sourceIds.has(p.sourceId)))
    .map(withSizes);
  if (extra.length === 0 && !changed) return local;
  return sortPosts([...merged, ...extra]);
}

/** Для проверки на сервере: что сейчас с лентой. */
export function feedStatus(): { cachedAt: string | null; feedPosts: number; problem: string } {
  return {
    cachedAt: cache ? new Date(cache.at).toISOString() : null,
    feedPosts: cache?.posts.length ?? 0,
    problem: lastProblem,
  };
}
