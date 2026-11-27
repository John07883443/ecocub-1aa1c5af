/**
 * «Читать дальше» под статьёй — подбор по смыслу, без эмбеддингов и платных
 * сервисов. Перенос «Ещё по теме» из эталона media-block (RG Router,
 * build_media.py, ветка pc/media-related-idf, 88e5911): та же формула и те же
 * веса, менять одинаково во всех проектах.
 *
 * Признаки статьи: keywords (k), модели (m — у сайта моделей нет, всегда 0,
 * как в эталоне), слова тем (t — теги блога, разрезанные по пробелу, дефису,
 * точке, «_»), основы
 * заголовка (s — слова от 4 букв, не стоп-слова, первые 5 букв), рубрика (kind).
 * Балл = сумма по общим признакам «вес × редкость», редкость =
 * log(N/df)/log(N): признак у одной статьи весит 1, у всех — 0. Так общий тег
 * («монолит» у 20 из 36 статей) не перевешивает редкое слово заголовка.
 * «По теме» — если без вклада рубрики набралось ≥ MIN_RELATED; при равном
 * балле — свежее; не хватило — добор самыми свежими.
 *
 * Модуль без импортов: его проверяют тесты из Node напрямую.
 */

export type RelatedCandidate = {
  slug: string;
  title: string;
  category: string;
  tags: string[];
  keywords?: string[];
  date: string;
};

export const W_KEYWORD = 3;
export const W_MODEL = 3; // у сайта моделей нет: признак не появляется
export const W_TOPIC = 1;
export const W_TITLE = 1;
export const W_KIND = 1;
const FEATURE_WEIGHT = { k: W_KEYWORD, m: W_MODEL, t: W_TOPIC, s: W_TITLE, kind: W_KIND } as const;
/** Минимум «темы» без бонуса за рубрику. */
export const MIN_RELATED = 0.5;

// Служебные слова — список эталона один в один. Слова своей темы («дом»,
// «модульный») сюда не добавлять: по ним и совпадает тема.
const STOP_WORDS = new Set(
  `это этот эта эти того тому также такой такие такая когда какой какая какие каких чтобы чем через после перед
между более менее очень можно нужно нельзя будет будут есть быть было были свой своя свои ваш ваша ваши наш
наша наши весь всех всем всего только уже ещё еще даже если или либо него нему неё ней них ним который которая
которые которых where what with from that this your have will about into more than over when which their
году года годом лучше новый новая новые новое главное почему зачем сколько стоит стоят
выпустила выпустил выпустили представила представил представили показала показал показали вышел вышла вышли
запустила запустил анонсировала анонсировал обновила обновил объявила объявил`.split(/\s+/),
);

const lower = (text: string) => text.toLowerCase().replace(/ё/g, "е");

export function titleStems(post: Pick<RelatedCandidate, "title">): Set<string> {
  const words = lower(post.title).match(/[a-zа-я0-9]+/g) ?? [];
  return new Set(
    words.filter((w) => w.length >= 4 && !STOP_WORDS.has(w)).map((w) => w.slice(0, 5)),
  );
}

export function keywordSet(post: Pick<RelatedCandidate, "keywords">): Set<string> {
  return new Set(
    (post.keywords ?? [])
      .map((k) => lower(k).split(/\s+/).filter(Boolean).join(" "))
      .filter(Boolean),
  );
}

export function topicWords(post: Pick<RelatedCandidate, "tags">): Set<string> {
  return new Set(post.tags.flatMap((t) => lower(t).split(/[\s\-_.]+/)).filter(Boolean));
}

type Feature = string; // «вид:значение»
const kindOf = (feature: Feature) =>
  feature.slice(0, feature.indexOf(":")) as keyof typeof FEATURE_WEIGHT;

/** Признаки статьи; рубрика — такой же признак с поправкой на редкость. */
export function features(post: RelatedCandidate): Set<Feature> {
  const out = new Set<Feature>();
  for (const v of keywordSet(post)) out.add(`k:${v}`);
  for (const v of topicWords(post)) out.add(`t:${v}`);
  for (const v of titleStems(post)) out.add(`s:${v}`);
  if (post.category) out.add(`kind:${post.category}`);
  return out;
}

export type FeatureDf = { df: Map<Feature, number>; n: number };

/** Сколько статей сайта несут каждый признак. */
export function featureDf(pool: RelatedCandidate[]): FeatureDf {
  const df = new Map<Feature, number>();
  for (const post of pool) for (const f of features(post)) df.set(f, (df.get(f) ?? 0) + 1);
  return { df, n: pool.length };
}

/** Редкость log(N/df)/log(N): признак у одной статьи — 1, у всех — 0. */
export function rarity(feature: Feature, stats: FeatureDf | null): number {
  if (!stats || stats.n < 3) return 1;
  return Math.max(
    0,
    Math.log(stats.n / Math.max(stats.df.get(feature) ?? 1, 1)) / Math.log(stats.n),
  );
}

/** Балл близости x к a. stats = null — без поправки на редкость. */
export function relatedScore(
  a: RelatedCandidate,
  x: RelatedCandidate,
  stats: FeatureDf | null = null,
): number {
  const fx = features(x);
  let score = 0;
  for (const f of features(a)) if (fx.has(f)) score += FEATURE_WEIGHT[kindOf(f)] * rarity(f, stats);
  return score;
}

// df считается один раз на набор статей (список ленты меняется раз в 5 минут).
let cached: { key: string; stats: FeatureDf } | null = null;
function statsFor(pool: RelatedCandidate[]): FeatureDf {
  const key = pool.map((p) => p.slug).join("|");
  if (cached?.key !== key) cached = { key, stats: featureDf(pool) };
  return cached.stats;
}

/** n самых близких статей из всех статей сайта; без общего по существу — добор свежими. */
export function pickRelated<T extends RelatedCandidate>(
  post: T,
  pool: T[],
  n = 3,
  stats?: FeatureDf,
): T[] {
  const df = stats ?? statsFor(pool);
  const candidates = pool.filter((x) => x.slug !== post.slug);
  const kindPart = (x: T) =>
    post.category && x.category === post.category
      ? W_KIND * rarity(`kind:${post.category}`, df)
      : 0;
  const scored = candidates
    .map((x) => ({ x, score: relatedScore(post, x, df) }))
    .sort(
      (p, q) =>
        q.score - p.score || q.x.date.localeCompare(p.x.date) || p.x.slug.localeCompare(q.x.slug),
    );
  const result = scored
    .filter((s) => s.score - kindPart(s.x) >= MIN_RELATED)
    .slice(0, n)
    .map((s) => s.x);
  if (result.length < n) {
    const fresh = candidates
      .filter((x) => !result.includes(x))
      .sort((p, q) => q.date.localeCompare(p.date) || p.slug.localeCompare(q.slug));
    result.push(...fresh.slice(0, n - result.length));
  }
  return result;
}
