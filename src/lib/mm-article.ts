/**
 * Материал ленты Медиамашины → статья блога. Общая часть для живой ленты
 * (blog-feed.server.ts) и почасового синка (scripts/sync-mediamachine.mjs),
 * чтобы статья выглядела одинаково, откуда бы она ни пришла.
 *
 * Модуль без импортов и без побочных эффектов: синк запускает его прямо
 * из Node (--experimental-strip-types), сайт — через сборку.
 *
 * Что берём из ленты v1 (новые поля необязательные, ММ 27.11):
 *  - paragraphs: абзацы; строки «## » и «### » — подзаголовки H2/H3
 *    (H1 на странице один — заголовок статьи, поэтому «# » опускаем до H2);
 *  - description — отдельное описание для поиска, а не начало текста;
 *  - keywords — в разметку Article и meta keywords;
 *  - rubric — рубрика на сайте;
 *  - faq[] — блок «Вопросы и ответы» (из него же строится FAQPage);
 *  - imageAlts{url: alt} — подписи к кадрам;
 *  - updatedAt — дата обновления (dateModified, lastmod в карте сайта).
 *
 * Правила отбора прежние: без заголовка, обложки или текста статью не берём
 * (владелец 24.09.2026), повтор лида в первом абзаце убираем, теги — только
 * из словаря блога. Ссылка на конструктор в тексте становится ссылкой.
 */

export type MmFaqItem = { question?: string; answer?: string; q?: string; a?: string };

export type MmArticle = {
  id?: string | number;
  slug?: string;
  title?: string;
  description?: string;
  paragraphs?: string[];
  cover?: string | null;
  images?: string[];
  tags?: string[];
  keywords?: string[] | string;
  rubric?: string;
  faq?: MmFaqItem[];
  imageAlts?: Record<string, string>;
  publishedAt?: string;
  updatedAt?: string;
};

export type FaqEntry = { question: string; answer: string };

/** Рубрики сайта, в которые может попасть материал ленты. */
export type MmCategory = "tech" | "comparison" | "cases" | "news" | "guides";

export type MmPost = {
  slug: string;
  title: string;
  excerpt: string;
  seoTitle: string;
  seoDescription: string;
  content: string;
  /** Адрес обложки уже на нашем домене (его выдаёт localize). */
  cover: string;
  coverAlt: string;
  category: MmCategory;
  tags: string[];
  keywords: string[];
  date: string;
  updated: string;
  readingTime: number;
  sourceId: string | null;
};

/**
 * Куда положить кадр: исходный адрес ленты → адрес на нашем домене.
 * index 0 — обложка, дальше кадры по порядку. null — кадр не берём.
 */
export type Localize = (url: string, index: number) => string | null;

export const FAQ_HEADING = "Вопросы и ответы";
const MAX_TAGS = 3;
const MAX_KEYWORDS = 10;
const MAX_FAQ = 10;

export const normalizeTag = (value: unknown) =>
  String(value ?? "")
    .toLowerCase()
    .replace(/[#\s_-]+/g, "")
    .replace(/ё/g, "е");

const SAFE_SLUG = /^[a-z0-9][a-z0-9-]{0,150}$/;
export const isHttpsUrl = (value: unknown): value is string =>
  typeof value === "string" && /^https:\/\/[^\s"'<>()]+$/.test(value);

/** Текст ленты — обычные абзацы, не HTML: экранируем то, что rehype-raw принял бы за разметку. */
const escapeHtml = (text: string) => text.replace(/</g, "&lt;").replace(/>/g, "&gt;");
const escapeAlt = (text: string) =>
  text
    .replace(/[[\]\n]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const HEADING = /^(#{1,6})\s+(.+)$/;
const isHeading = (block: string) => HEADING.test(block);

/** «# », «## », «### »… → H2 или H3. Остальные абзацы — как есть. */
function normalizeBlock(raw: string): string {
  const text = escapeHtml(raw.trim());
  const match = HEADING.exec(text);
  if (!match || text.includes("\n")) return text;
  const level = Math.min(3, Math.max(2, match[1].length));
  return `${"#".repeat(level)} ${match[2].replace(/\s*#+\s*$/, "").trim()}`;
}

/** Обрезка по границе слова, с многоточием, если пришлось резать. */
export function clip(text: string, max: number): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max - 1);
  const space = cut.lastIndexOf(" ");
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s,.;:—-]+$/, "")}…`;
}

/** Убираем разметку Markdown для описаний и разметки schema.org. */
export function plainText(markdown: string): string {
  return markdown
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/[*_`]/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

const CATEGORY_HINTS: Array<[MmCategory, string[]]> = [
  ["comparison", ["comparison", "сравнен", "vs"]],
  ["cases", ["case", "кейс"]],
  ["news", ["news", "новост"]],
  [
    "guides",
    ["guide", "гайд", "инструкц", "check", "проверк", "prices", "цен", "review", "обзор", "совет"],
  ],
  ["tech", ["tech", "технолог"]],
];

/** Рубрика ленты (тип материала ММ или подпись) → рубрика сайта. */
export function rubricToCategory(rubric: unknown, fallback: MmCategory = "news"): MmCategory {
  const key = normalizeTag(rubric);
  if (!key) return fallback;
  for (const [category, hints] of CATEGORY_HINTS) {
    if (hints.some((hint) => key.includes(normalizeTag(hint)))) return category;
  }
  return fallback;
}

export function mapTags(feedTags: string[] | undefined, vocabulary: Map<string, string>): string[] {
  const picked: string[] = [];
  for (const feedTag of feedTags ?? []) {
    const key = normalizeTag(feedTag);
    if (!key) continue;
    for (const [norm, tag] of vocabulary) {
      if ((key === norm || key.includes(norm)) && !picked.includes(tag)) picked.push(tag);
    }
  }
  return picked.slice(0, MAX_TAGS);
}

function parseKeywords(value: MmArticle["keywords"]): string[] {
  const list = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(/[,;\n]/)
      : [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of list) {
    const keyword = String(raw ?? "")
      .replace(/\s+/g, " ")
      .replace(/["\\]/g, "")
      .trim();
    const key = keyword.toLowerCase();
    if (keyword && keyword.length <= 80 && !seen.has(key)) {
      seen.add(key);
      out.push(keyword);
    }
  }
  return out.slice(0, MAX_KEYWORDS);
}

function parseFaq(value: MmArticle["faq"]): FaqEntry[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => ({
      question: String(item?.question ?? item?.q ?? "")
        .replace(/\s+/g, " ")
        .trim(),
      answer: String(item?.answer ?? item?.a ?? "").trim(),
    }))
    .filter((item) => item.question && item.answer)
    .slice(0, MAX_FAQ);
}

const CONSTRUCTOR_LINK = /\]\(\/constructor[)/?#]/;
const CONSTRUCTOR_WORD = /(онлайн-)?конструктор[а-яё]*/i;

/** Первое упоминание конструктора в обычном абзаце — ссылкой на /constructor. */
const MD_LINK = /!?\[[^\]]*\]\([^)]*\)/g;

/** Первое упоминание вне готовых ссылок и картинок — ссылкой; null, если упоминания нет. */
function linkFirstMention(block: string): string | null {
  let done = false;
  let last = 0;
  let out = "";
  const plain = (text: string) =>
    done
      ? text
      : text.replace(CONSTRUCTOR_WORD, (word) => {
          done = true;
          return `[${word}](/constructor)`;
        });
  for (const match of block.matchAll(MD_LINK)) {
    out += plain(block.slice(last, match.index)) + match[0];
    last = (match.index ?? 0) + match[0].length;
  }
  out += plain(block.slice(last));
  return done ? out : null;
}

function linkConstructor(blocks: string[]): string[] {
  if (blocks.some((block) => CONSTRUCTOR_LINK.test(block))) return blocks;
  const out = [...blocks];
  for (const [index, block] of blocks.entries()) {
    if (isHeading(block)) continue;
    const linked = linkFirstMention(block);
    if (linked) {
      out[index] = linked;
      break;
    }
  }
  return out;
}

const isoDay = (value: unknown) => {
  const day = String(value ?? "").slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : "";
};

export type BuildOptions = {
  localize: Localize;
  vocabulary: Map<string, string>;
  fallbackCategory?: MmCategory;
};

/** Материал ленты → статья. null — не берём (нет заголовка, обложки или текста). */
export function buildMmPost(article: MmArticle, options: BuildOptions): MmPost | null {
  const slug = String(article.slug ?? "");
  const title = String(article.title ?? "")
    .replace(/\s+/g, " ")
    .trim();
  if (!SAFE_SLUG.test(slug) || !title || !isHttpsUrl(article.cover)) return null;

  let blocks = (article.paragraphs ?? [])
    .filter((p): p is string => typeof p === "string" && p.trim() !== "")
    .map(normalizeBlock);

  // Повтор заголовка или лида в первом абзаце — на странице он уже в шапке.
  const lead = normalizeTag(article.description);
  while (
    blocks.length &&
    !isHeading(blocks[0]) &&
    [normalizeTag(title), lead].includes(normalizeTag(blocks[0]))
  ) {
    blocks.shift();
  }
  // H1 в тексте — это повтор заголовка статьи.
  if (
    blocks.length &&
    isHeading(blocks[0]) &&
    normalizeTag(plainText(blocks[0])) === normalizeTag(title)
  )
    blocks.shift();
  const textBlocks = blocks.filter((block) => !isHeading(block));
  if (textBlocks.length === 0) return null;

  const cover = options.localize(article.cover, 0);
  if (!cover) return null;

  const alts = article.imageAlts && typeof article.imageAlts === "object" ? article.imageAlts : {};
  const altFor = (url: string, n: number) =>
    escapeAlt(String(alts[url] ?? "")) ||
    escapeAlt(n === 0 ? `Обложка статьи: ${title}` : `${title} — иллюстрация ${n}`);

  blocks = linkConstructor(blocks);

  // Кадры — между абзацами, а не в конце и не сразу под подзаголовком.
  const inline: Array<{ src: string; alt: string }> = [];
  for (const url of article.images ?? []) {
    if (!isHttpsUrl(url) || url === article.cover) continue;
    const src = options.localize(url, inline.length + 1);
    if (src) inline.push({ src, alt: altFor(url, inline.length + 1) });
  }
  const step =
    inline.length > 0 ? Math.max(2, Math.floor(textBlocks.length / (inline.length + 1))) : 0;
  const body: string[] = [];
  let placed = 0;
  let seenText = 0;
  for (const block of blocks) {
    body.push(block);
    if (isHeading(block)) continue;
    seenText += 1;
    if (step > 0 && placed < inline.length && seenText > 1 && seenText % step === 0) {
      body.push(`![${inline[placed].alt}](${inline[placed].src})`);
      placed += 1;
    }
  }
  for (; placed < inline.length; placed += 1)
    body.push(`![${inline[placed].alt}](${inline[placed].src})`);

  // Вопросы и ответы — отдельным разделом в конце, если ММ не поставила его сама.
  const faq = parseFaq(article.faq);
  const hasFaqSection = body.some(
    (block) => /^##\s+/.test(block) && normalizeTag(plainText(block)) === normalizeTag(FAQ_HEADING),
  );
  if (faq.length > 0 && !hasFaqSection) {
    body.push(`## ${FAQ_HEADING}`);
    for (const item of faq) body.push(`### ${escapeHtml(item.question)}`, escapeHtml(item.answer));
  }

  const firstText = plainText(textBlocks[0]);
  const description = String(article.description ?? "")
    .replace(/\s+/g, " ")
    .trim();
  const words = textBlocks.map(plainText).join(" ").split(/\s+/).filter(Boolean).length;
  const date = isoDay(article.publishedAt);
  const updated = isoDay(article.updatedAt);

  return {
    slug,
    title,
    excerpt: clip(description || firstText, 300),
    seoTitle: clip(title, 70),
    seoDescription: clip(description || firstText, 160),
    content: body.join("\n\n"),
    cover,
    coverAlt: altFor(article.cover, 0),
    category: rubricToCategory(article.rubric, options.fallbackCategory ?? "news"),
    tags: mapTags(article.tags, options.vocabulary),
    keywords: parseKeywords(article.keywords),
    date,
    updated: updated && (!date || updated >= date) ? updated : "",
    readingTime: Math.max(1, Math.round(words / 180)),
    sourceId: article.id != null && String(article.id) !== "" ? String(article.id) : null,
  };
}

/**
 * Раздел «Вопросы и ответы» из текста статьи → пары для FAQPage.
 * Работает и для файлов: достаточно «## Вопросы и ответы» и «### вопрос».
 */
export function extractFaq(content: string): FaqEntry[] {
  const lines = content.split(/\r?\n/);
  const start = lines.findIndex(
    (line) => /^##\s+/.test(line) && normalizeTag(plainText(line)) === normalizeTag(FAQ_HEADING),
  );
  if (start === -1) return [];
  const out: FaqEntry[] = [];
  let current: { question: string; answer: string[] } | null = null;
  const flush = () => {
    if (current) {
      const answer = plainText(current.answer.join("\n"));
      if (current.question && answer) out.push({ question: current.question, answer });
    }
  };
  for (const line of lines.slice(start + 1)) {
    if (/^##\s+/.test(line)) break;
    const question = /^###\s+(.+)$/.exec(line);
    if (question) {
      flush();
      current = { question: plainText(question[1]), answer: [] };
    } else if (current) {
      current.answer.push(line);
    }
  }
  flush();
  return out.slice(0, MAX_FAQ);
}

/** Короткий устойчивый хэш адреса (FNV-1a) — для имён файлов кадров. */
export function shortHash(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/** Имя файла кадра: по-латински со смыслом (адрес статьи) + номер + хэш источника. */
export function imageBaseName(slug: string, index: number, url: string): string {
  const base = slug
    .replace(/-[a-z0-9]{6}$/, "")
    .slice(0, 70)
    .replace(/-+$/, "");
  return `${base}-${index === 0 ? "cover" : index}-${shortHash(url)}`;
}
