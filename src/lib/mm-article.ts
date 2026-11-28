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

export type MmImage = { url?: string; alt?: string; caption?: string };

export type MmArticle = {
  id?: string | number;
  slug?: string;
  title?: string;
  description?: string;
  paragraphs?: string[];
  cover?: string | null;
  /** Адрес или {url, alt, caption}. */
  images?: Array<string | MmImage>;
  tags?: string[];
  keywords?: string[] | string;
  rubric?: string;
  faq?: MmFaqItem[];
  imageAlts?: Record<string, string>;
  publishedAt?: string;
  updatedAt?: string;
  /** Тип материала ММ (news, guide, review…), если рубрики нет. */
  type?: string;
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
const FAQ_HEADINGS = [FAQ_HEADING, "FAQ", "Частые вопросы", "Часто задаваемые вопросы"];
const isFaqHeading = (block: string) =>
  /^##\s/.test(block) &&
  FAQ_HEADINGS.some((h) => normalizeTag(plainText(block)) === normalizeTag(h));
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
const INLINE_IMAGE = /^!\[([^\]]*)\]\((\S+?)(?:\s+"([^"]*)")?\)$/;
const escapeCaption = (text: string) =>
  text.replace(/["\n]/g, " ").replace(/\s+/g, " ").trim().slice(0, 200);
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

/**
 * Описание собрано ММ автоматически из начала текста, а не написано отдельно:
 * совпадает с началом абзацев (без пробелов и регистра) или обрезано «…»
 * на полуслове внутри текста.
 */
export function isAutoDescription(description: string, paragraphs: unknown[]): boolean {
  const text = description.replace(/(…|\.\.\.)\s*$/, "");
  const key = normalizeTag(text);
  if (!key) return false;
  const list = paragraphs.filter((p): p is string => typeof p === "string");
  // Описание, равное первому абзацу целиком, — написанный лид (его просто не повторяем).
  if (list.length && key === normalizeTag(list[0])) return false;
  const body = normalizeTag(list.join(" "));
  if (body.startsWith(key)) return true;
  return /(…|\.\.\.)\s*$/.test(description) && key.length > 40 && body.includes(key.slice(-40));
}

/** Короткая строка без точки в конце — надзаголовок, а не абзац. */
function isDek(block: string): boolean {
  return (
    !isHeading(block) &&
    !block.startsWith("![") &&
    !block.includes("\n") &&
    block.length <= 140 &&
    !/[.!?…:;»"]$/.test(block.trim())
  );
}

/** Первое предложение абзаца и остаток. null — абзац не делится (одно предложение без точки). */
function splitFirstSentence(block: string): { sentence: string; rest: string } | null {
  if (block.includes("\n") || /^[-*+]\s|^\d+\.\s/.test(block)) return null;
  const match = /^(.{20,}?[.!?…])(?:\s+)(?=[«"(A-ZА-ЯЁ0-9])/.exec(block);
  if (!match) return /[.!?…]$/.test(block) ? { sentence: block, rest: "" } : null;
  return { sentence: match[1], rest: block.slice(match[0].length).trim() };
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

/**
 * Хэштег ММ слитно и в другом падеже («ПодготовкаУчастка») ↔ тег блога
 * («участок»): все значимые слова тега (от 4 букв) должны встретиться в
 * хэштеге своей основой — первыми 5 буквами.
 */
function stemsMatch(key: string, tag: string): boolean {
  const words = tag
    .toLowerCase()
    .replace(/ё/g, "е")
    .split(/[^a-zа-я0-9]+/)
    .filter((w) => w.length >= 4);
  return words.length > 0 && words.every((w) => key.includes(w.slice(0, 5)));
}

export function mapTags(feedTags: string[] | undefined, vocabulary: Map<string, string>): string[] {
  const picked: string[] = [];
  for (const feedTag of feedTags ?? []) {
    const key = normalizeTag(feedTag);
    if (!key) continue;
    for (const [norm, tag] of vocabulary) {
      if ((key === norm || key.includes(norm) || stemsMatch(key, tag)) && !picked.includes(tag)) {
        picked.push(tag);
      }
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

  // Описание, которое ММ собрала сама из начала текста (подзаголовок + обрезанный
  // первый абзац с «…»), — не описание: берём своё из текста.
  const rawDescription = String(article.description ?? "").trim();
  const autoDescription = isAutoDescription(rawDescription, article.paragraphs ?? []);
  const ownDescription = autoDescription ? "" : rawDescription.replace(/\s+/g, " ");

  // Подзаголовок-«надзаголовок» первой строкой (короткий, без точки) — это не
  // абзац: на странице он склеивался с анонсом. Убираем из текста.
  if (blocks.length > 1 && isDek(blocks[0]) && !isHeading(blocks[1])) blocks.shift();

  // Повтор заголовка или лида в первом абзаце — на странице он уже в шапке.
  const lead = normalizeTag(ownDescription);
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
  let textBlocks = blocks.filter((block) => !isHeading(block));
  if (textBlocks.length === 0) return null;

  // Без своего описания анонс под заголовком — первое предложение текста,
  // и в тексте оно второй раз не повторяется.
  let leadSentence = "";
  if (!ownDescription) {
    const firstIndex = blocks.findIndex((block) => !isHeading(block) && !block.startsWith("!["));
    const split = firstIndex === -1 ? null : splitFirstSentence(blocks[firstIndex]);
    if (split) {
      leadSentence = plainText(split.sentence);
      const rest = blocks.filter((block) => !isHeading(block)).length > 1 || split.rest;
      if (rest) {
        blocks = split.rest
          ? blocks.map((block, index) => (index === firstIndex ? split.rest : block))
          : blocks.filter((_, index) => index !== firstIndex);
        textBlocks = blocks.filter((block) => !isHeading(block));
      }
    }
  }

  const cover = options.localize(article.cover, 0);
  if (!cover) return null;

  const alts = article.imageAlts && typeof article.imageAlts === "object" ? article.imageAlts : {};
  const altFor = (url: string, n: number) =>
    escapeAlt(String(alts[url] ?? "")) ||
    escapeAlt(n === 0 ? `Обложка статьи: ${title}` : `${title} — иллюстрация ${n}`);

  blocks = linkConstructor(blocks);

  // Кадры, стоящие в тексте строкой «![alt](url)», — тоже на наш домен.
  let nextIndex = 1;
  const usedUrls = new Set<string>([article.cover]);
  const imageMd = (img: { src: string; alt: string; caption: string }) =>
    `![${img.alt}](${img.src}${img.caption ? ` "${img.caption}"` : ""})`;
  blocks = blocks.flatMap((block) => {
    const match = INLINE_IMAGE.exec(block);
    if (!match) return [block];
    const url = match[2].replace(/&amp;/g, "&");
    if (!isHttpsUrl(url)) return [];
    const src = usedUrls.has(url) ? null : options.localize(url, nextIndex);
    if (!src) return [];
    usedUrls.add(url);
    const alt = escapeAlt(String(alts[url] ?? "")) || escapeAlt(match[1]) || altFor(url, nextIndex);
    nextIndex += 1;
    return [imageMd({ src, alt, caption: escapeCaption(match[3] ?? "") })];
  });

  // Кадры из images[]: перед 2-м, 3-м… подзаголовком H2 (эталон media-block);
  // если подзаголовков мало — между абзацами, не сразу под подзаголовком.
  const inline: Array<{ src: string; alt: string; caption: string }> = [];
  for (const item of article.images ?? []) {
    const url = typeof item === "string" ? item : item?.url;
    if (!isHttpsUrl(url) || usedUrls.has(url)) continue;
    const src = options.localize(url, nextIndex);
    if (!src) continue;
    usedUrls.add(url);
    const own = typeof item === "string" ? "" : escapeAlt(String(item.alt ?? ""));
    inline.push({
      src,
      alt: escapeAlt(String(alts[url] ?? "")) || own || altFor(url, nextIndex),
      caption: typeof item === "string" ? "" : escapeCaption(String(item.caption ?? "")),
    });
    nextIndex += 1;
  }
  const body: string[] = [];
  let placed = 0;
  const h2Count = blocks.filter((block) => /^## /.test(block)).length;
  if (h2Count >= 2) {
    let h2Seen = 0;
    for (const block of blocks) {
      if (/^## /.test(block)) {
        h2Seen += 1;
        if (h2Seen >= 2 && placed < inline.length) body.push(imageMd(inline[placed++]));
      }
      body.push(block);
    }
  } else {
    const step =
      inline.length > 0 ? Math.max(2, Math.floor(textBlocks.length / (inline.length + 1))) : 0;
    let seenText = 0;
    for (const block of blocks) {
      body.push(block);
      if (isHeading(block)) continue;
      seenText += 1;
      if (step > 0 && placed < inline.length && seenText > 1 && seenText % step === 0) {
        body.push(imageMd(inline[placed++]));
      }
    }
  }
  for (; placed < inline.length; placed += 1) body.push(imageMd(inline[placed]));

  // Вопросы и ответы — отдельным разделом в конце, если ММ не поставила его сама.
  // Вопросы и ответы — из faq[]. Если ММ вдобавок написала такой раздел в
  // тексте, он вырезается до следующего «## » (эталон media-block,
  // strip_faq_section), чтобы блок не повторялся. Без faq[] текст не трогаем.
  const faq = parseFaq(article.faq);
  if (faq.length > 0) {
    const start = body.findIndex((block) => isFaqHeading(block));
    if (start !== -1) {
      let end = body.findIndex((block, index) => index > start && /^##\s/.test(block));
      if (end === -1) end = body.length;
      body.splice(start, end - start);
    }
    body.push(`## ${FAQ_HEADING}`);
    for (const item of faq) body.push(`### ${escapeHtml(item.question)}`, escapeHtml(item.answer));
  }

  const firstText = plainText(textBlocks[0]);
  const description = ownDescription;
  const announce = description || leadSentence || firstText;
  // Для поиска нужно 140–160 знаков: короткий анонс дополняем текстом.
  const searchText =
    description ||
    clip([leadSentence, ...textBlocks.map(plainText)].filter(Boolean).join(" "), 160);
  const words = textBlocks.map(plainText).join(" ").split(/\s+/).filter(Boolean).length;
  const date = isoDay(article.publishedAt);
  const updated = isoDay(article.updatedAt);

  return {
    slug,
    title,
    excerpt: clip(announce, 300),
    seoTitle: clip(title, 70),
    seoDescription: clip(searchText, 160),
    content: body.join("\n\n"),
    cover,
    coverAlt: altFor(article.cover, 0),
    // Рубрики нет — по типу материала; без типа это статья, а не новость.
    category: rubricToCategory(
      article.rubric || article.type,
      options.fallbackCategory ?? "guides",
    ),
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
