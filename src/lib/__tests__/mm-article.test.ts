import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildMmPost,
  clip,
  extractFaq,
  imageBaseName,
  rubricToCategory,
  type MmArticle,
} from "../mm-article.ts";

const localize = (url: string, index: number) => `/media/blog/x-${index}.webp#${url.length}`;
const vocabulary = new Map([
  ["участок", "участок"],
  ["цена", "цена"],
]);
const base: MmArticle = {
  id: "abc123",
  slug: "podgotovka-uchastka-rkm1lr",
  title: "Подготовка участка: 5 шагов",
  description:
    "Что сделать с участком до приезда модулей: геология, подъезд, сети и фундамент — по шагам.",
  cover: "https://mediamachina.ru/gallery-images/c.png",
  images: [
    "https://mediamachina.ru/gallery-images/c.png",
    "https://mediamachina.ru/gallery-images/a.png",
    "https://mediamachina.ru/gallery-images/b.png",
  ],
  imageAlts: {
    "https://mediamachina.ru/gallery-images/c.png": "Участок с разметкой под фундамент",
    "https://mediamachina.ru/gallery-images/a.png": "Кран ставит модуль",
  },
  paragraphs: [
    "Что сделать с участком до приезда модулей: геология, подъезд, сети и фундамент — по шагам.",
    "Прямой ответ: участок готовят заранее.",
    "## Шаг 1. Геология",
    "Абзац про геологию.",
    "### Подпункт",
    "Абзац про подпункт. Соберите дом в онлайн-конструкторе и узнайте площадь.",
    "# Шаг 2. Подъезд",
    "Абзац про подъезд, подробнее — [в статье о фундаменте](/blog/fundament).",
    "Ещё абзац <script>alert(1)</script>.",
  ],
  tags: ["#участок", "#другое"],
  keywords: ["подготовка участка", "фундамент для модульного дома", "подготовка участка"],
  rubric: "guide",
  faq: [
    { question: "Нужна ли геология?", answer: "Да, без неё фундамент не рассчитать." },
    { q: "Сколько стоит?", a: "Зависит от участка." },
    { question: "", answer: "пусто" },
  ],
  publishedAt: "2026-11-27T19:35:56.977Z",
  updatedAt: "2026-11-28T08:00:00Z",
};

test("подзаголовки ## и ### — H2/H3, «# » опускается до H2", () => {
  const post = buildMmPost(base, { localize, vocabulary })!;
  assert.match(post.content, /^## Шаг 1\. Геология$/m);
  assert.match(post.content, /^### Подпункт$/m);
  assert.match(post.content, /^## Шаг 2\. Подъезд$/m);
  assert.doesNotMatch(post.content, /^# /m);
});

test("описание из поля description, лид не дублируется в тексте", () => {
  const post = buildMmPost(base, { localize, vocabulary })!;
  assert.equal(post.seoDescription, base.description);
  assert.ok(!post.content.startsWith("Что сделать с участком"));
  assert.ok(post.content.startsWith("Прямой ответ"));
});

test("без description — начало текста, обрезанное по слову с многоточием", () => {
  const post = buildMmPost(
    { ...base, description: "", paragraphs: ["слово ".repeat(60), "второй"] },
    { localize, vocabulary },
  )!;
  assert.ok(post.seoDescription.length <= 160);
  assert.ok(post.seoDescription.endsWith("…"));
  assert.doesNotMatch(post.seoDescription, /сло…$/);
});

test("keywords без повторов, рубрика guide → «Гайды», теги из словаря", () => {
  const post = buildMmPost(base, { localize, vocabulary })!;
  assert.deepEqual(post.keywords, ["подготовка участка", "фундамент для модульного дома"]);
  assert.equal(post.category, "guides");
  assert.deepEqual(post.tags, ["участок"]);
  assert.equal(rubricToCategory("comparison"), "comparison");
  assert.equal(rubricToCategory(undefined), "news");
  assert.equal(rubricToCategory("Новости"), "news");
});

test("FAQ — разделом в конце, пустые пункты отброшены; extractFaq читает его обратно", () => {
  const post = buildMmPost(base, { localize, vocabulary })!;
  assert.match(
    post.content,
    /## Вопросы и ответы\n\n### Нужна ли геология\?\n\nДа, без неё фундамент не рассчитать\./,
  );
  const faq = extractFaq(post.content);
  assert.deepEqual(faq, [
    { question: "Нужна ли геология?", answer: "Да, без неё фундамент не рассчитать." },
    { question: "Сколько стоит?", answer: "Зависит от участка." },
  ]);
});

test("FAQ не дублируется: раздел в тексте вырезается, блок — из faq[]; без faq[] текст не трогаем", () => {
  const paragraphs = [
    ...base.paragraphs!,
    "## Часто задаваемые вопросы",
    "### Старый вопрос?",
    "Старый ответ.",
    "## Итог",
    "Вывод.",
  ];
  const post = buildMmPost({ ...base, paragraphs }, { localize, vocabulary })!;
  assert.equal(post.content.match(/Вопросы и ответы|Часто задаваемые/g)?.length, 1);
  assert.doesNotMatch(post.content, /Старый вопрос/);
  assert.match(post.content, /## Итог\n\nВывод\./);
  assert.match(post.content, /### Нужна ли геология\?/);
  const noFaq = buildMmPost({ ...base, faq: undefined, paragraphs }, { localize, vocabulary })!;
  assert.match(noFaq.content, /Старый вопрос/);
});

test("alt из imageAlts, кадры на нашем домене, обложка не повторяется в тексте", () => {
  const post = buildMmPost(base, { localize, vocabulary })!;
  assert.equal(post.coverAlt, "Участок с разметкой под фундамент");
  assert.ok(post.cover.startsWith("/media/blog/x-0"));
  assert.match(post.content, /!\[Кран ставит модуль\]\(\/media\/blog\/x-1/);
  assert.match(
    post.content,
    /!\[Подготовка участка: 5 шагов — иллюстрация 2\]\(\/media\/blog\/x-2/,
  );
  assert.doesNotMatch(post.content, /mediamachina\.ru/);
  // кадр не встаёт сразу под подзаголовком
  assert.doesNotMatch(post.content, /^#{2,3} .+\n\n!\[/m);
});

test("конструктор становится ссылкой, ссылки ленты остаются, HTML экранирован", () => {
  const post = buildMmPost(base, { localize, vocabulary })!;
  assert.match(post.content, /\[онлайн-конструкторе\]\(\/constructor\)/);
  assert.match(post.content, /\[в статье о фундаменте\]\(\/blog\/fundament\)/);
  assert.match(post.content, /&lt;script&gt;/);
  assert.doesNotMatch(post.content, /<script>/);
  const withLink = buildMmPost(
    { ...base, paragraphs: ["Абзац с [конструктором](/constructor).", "Другой конструктор тут."] },
    { localize, vocabulary },
  )!;
  assert.equal(withLink.content.match(/\/constructor/g)?.length, 1);
  const mixed = buildMmPost(
    {
      ...base,
      paragraphs: [
        "Соберите дом в онлайн-конструкторе, а подробности — [в статье о конструкторах](/blog/x).",
      ],
    },
    { localize, vocabulary },
  )!;
  assert.match(
    mixed.content,
    /^Соберите дом в \[онлайн-конструкторе\]\(\/constructor\), а подробности — \[в статье о конструкторах\]\(\/blog\/x\)\.$/m,
  );
});

test("даты: published и updated", () => {
  const post = buildMmPost(base, { localize, vocabulary })!;
  assert.equal(post.date, "2026-11-27");
  assert.equal(post.updated, "2026-11-28");
  assert.equal(
    buildMmPost({ ...base, updatedAt: "2026-01-01" }, { localize, vocabulary })!.updated,
    "",
  );
});

test("без обложки, текста или с плохим адресом — не берём", () => {
  assert.equal(buildMmPost({ ...base, cover: null }, { localize, vocabulary }), null);
  assert.equal(
    buildMmPost({ ...base, paragraphs: ["## Только заголовок"] }, { localize, vocabulary }),
    null,
  );
  assert.equal(buildMmPost({ ...base, slug: "../etc" }, { localize, vocabulary }), null);
  assert.equal(buildMmPost(base, { localize: () => null, vocabulary }), null);
});

test("старый формат ленты (без новых полей) по-прежнему работает", () => {
  const post = buildMmPost(
    {
      id: 1,
      slug: "old-abcdef",
      title: "Старая",
      cover: base.cover,
      paragraphs: ["Текст."],
      publishedAt: "2026-10-01",
    },
    { localize, vocabulary },
  )!;
  assert.equal(post.category, "guides");
  assert.deepEqual(post.keywords, []);
  assert.equal(post.content, "Текст.");
});

test("имя файла кадра латиницей и устойчиво", () => {
  const name = imageBaseName("podgotovka-uchastka-rkm1lr", 0, "https://x/c.png");
  assert.match(name, /^podgotovka-uchastka-cover-[0-9a-f]{8}$/);
  assert.equal(name, imageBaseName("podgotovka-uchastka-rkm1lr", 0, "https://x/c.png"));
  assert.equal(clip("короткий", 10), "короткий");
});

test("images[] объектами {url, alt, caption}, кадр строкой в тексте — на наш домен", () => {
  const post = buildMmPost(
    {
      ...base,
      images: [
        {
          url: "https://mediamachina.ru/gallery-images/o.png",
          alt: "Свой alt",
          caption: "Создано ИИ",
        },
      ],
      imageAlts: {},
      paragraphs: [
        "Первый абзац.",
        "## Раздел один",
        "Текст.",
        "![подпись ленты](https://mediamachina.ru/gallery-images/i.png)",
        "## Раздел два",
        "Текст два.",
      ],
    },
    { localize, vocabulary },
  )!;
  assert.doesNotMatch(post.content, /mediamachina\.ru/);
  assert.match(post.content, /!\[подпись ленты\]\(\/media\/blog\/x-1/);
  // кадр из images[] — перед вторым H2, с подписью
  assert.match(
    post.content,
    /!\[Свой alt\]\(\/media\/blog\/x-2[^)]* "Создано ИИ"\)\n\n## Раздел два/,
  );
});

test("первая статья ММ: авто-описание и надзаголовок не склеиваются, анонс не дублируется, без рубрики — «Гайды»", () => {
  const p1 =
    "Вы выбрали или уже купили участок в Подмосковье и хотите капитальный дом из заводских бетонных модулей. Модули приезжают с завода, и кажется, что остаётся немного.";
  const post = buildMmPost(
    {
      ...base,
      rubric: undefined,
      faq: undefined,
      keywords: undefined,
      imageAlts: undefined,
      images: [],
      description: `Участок нельзя доделать потом: пять шагов до приезда модулей

${p1.slice(0, 120)}…`,
      paragraphs: [
        "Участок нельзя доделать потом: пять шагов до приезда модулей",
        p1,
        "Но в модульной стройке участок нельзя «доделать потом».",
      ],
    },
    { localize, vocabulary },
  )!;
  assert.equal(
    post.excerpt,
    "Вы выбрали или уже купили участок в Подмосковье и хотите капитальный дом из заводских бетонных модулей.",
  );
  assert.doesNotMatch(post.excerpt, /пять шагов|…/);
  assert.ok(post.content.startsWith("Модули приезжают с завода"));
  assert.doesNotMatch(post.content, /Участок нельзя доделать потом: пять шагов/);
  assert.doesNotMatch(post.content, /Вы выбрали или уже купили/);
  assert.ok(post.seoDescription.length > 100 && post.seoDescription.length <= 160);
  assert.equal(post.category, "guides");
  const news = buildMmPost({ ...base, rubric: undefined, type: "news" }, { localize, vocabulary })!;
  assert.equal(news.category, "news");
});

test("хэштеги ММ слитно и в другом падеже попадают в теги блога", () => {
  const vocab = new Map([
    ["участок", "участок"],
    ["ценаисмета", "цена и смета"],
    ["монолит", "монолит"],
  ]);
  const post = buildMmPost(
    { ...base, tags: ["ПодготовкаУчастка", "ЭкологичныйДом", "СметаИЦена", "ДомВПодмосковье"] },
    { localize, vocabulary: vocab },
  )!;
  assert.deepEqual(post.tags, ["участок", "цена и смета"]);
});

test("снятие: withdrawn[] убирает статью ленты и файл нового синка, мусорный slug не проходит, 36 старых защищены", async () => {
  const { parseWithdrawn, dropWithdrawn } = await import("../mm-article.ts");
  const w = parseWithdrawn([
    "gone-abc123",
    { slug: "../etc/passwd", id: "id-9" },
    { slug: "Bad Slug" },
    42,
    null,
  ]);
  assert.deepEqual([...w.slugs], ["gone-abc123"]);
  assert.deepEqual([...w.ids], ["id-9"]);
  const posts = [
    { slug: "gone-abc123", sourceId: "x", file: false },
    { slug: "by-id", sourceId: "id-9", file: true, mmUpdatedAt: "2026-11-28" },
    { slug: "old-protected", sourceId: "id-9", file: true },
    { slug: "stays", sourceId: "y", file: false },
  ];
  const left = dropWithdrawn(posts, w, (p) => p.file && !("mmUpdatedAt" in p));
  assert.deepEqual(
    left.map((p) => p.slug),
    ["old-protected", "stays"],
  );
  assert.equal(dropWithdrawn(posts, parseWithdrawn(undefined), () => false).length, 4);
});
