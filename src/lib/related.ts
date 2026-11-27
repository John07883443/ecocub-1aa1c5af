/**
 * «Читать дальше» под статьёй — подбор по смыслу, без эмбеддингов и платных
 * сервисов. Перенос «Ещё по теме» из эталона media-block (RG Router,
 * build_media.py, ветка pc/media-related, 2403c78): та же формула и те же
 * веса, менять одинаково во всех проектах.
 *
 * Балл близости x к a:
 *   3 · общие keywords (целой фразой: нижний регистр, ё→е, пробелы схлопнуты)
 * + 3 · общие теги (у сайта моделей нет — вместо них теги блога)
 * + 1 · общие слова тем (теги, разрезанные по пробелу, дефису, точке, «_»)
 * + 1 · общие основы заголовка (слова от 4 букв, не стоп-слова, первые 5 букв)
 * + 1 · та же рубрика.
 * «По теме» — только балл больше 1 (одна общая рубрика ещё не тема); при
 * равном балле — свежее; не хватило — добор самыми свежими.
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
export const W_MODEL = 3; // у сайта — теги
export const W_TOPIC = 1;
export const W_TITLE = 1;
export const W_KIND = 1;

// Служебные слова — список эталона один в один. Слова своей темы («дом»,
// «модульный») сюда не добавлять: по ним и совпадает тема.
const STOP_WORDS = new Set(
  `это этот эта эти того тому также такой такие такая когда какой какая какие каких чтобы чем через после перед
между более менее очень можно нужно нельзя будет будут есть быть было были свой своя свои ваш ваша ваши наш
наша наши весь всех всем всего только уже ещё еще даже если или либо него нему неё ней них ним который которая
которые которых where what with from that this your have will about into more than over when which their
году года годом лучше новый новая новые новое главное почему зачем сколько стоит стоят`.split(
    /\s+/,
  ),
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

const tagSet = (post: RelatedCandidate) =>
  new Set(post.tags.map((t) => lower(t).trim()).filter(Boolean));

export function topicWords(post: RelatedCandidate): Set<string> {
  return new Set(post.tags.flatMap((t) => lower(t).split(/[\s\-_.]+/)).filter(Boolean));
}

const common = (a: Set<string>, b: Set<string>) => {
  let n = 0;
  for (const x of a) if (b.has(x)) n += 1;
  return n;
};

/** Балл близости x к a. */
export function relatedScore(a: RelatedCandidate, x: RelatedCandidate): number {
  return (
    W_KEYWORD * common(keywordSet(a), keywordSet(x)) +
    W_MODEL * common(tagSet(a), tagSet(x)) +
    W_TOPIC * common(topicWords(a), topicWords(x)) +
    W_TITLE * common(titleStems(a), titleStems(x)) +
    (x.category && x.category === a.category ? W_KIND : 0)
  );
}

/** n самых близких статей из всех статей сайта; без общего признака — добор свежими. */
export function pickRelated<T extends RelatedCandidate>(post: T, pool: T[], n = 3): T[] {
  const candidates = pool.filter((x) => x.slug !== post.slug);
  const scored = candidates
    .map((x) => ({ x, score: relatedScore(post, x) }))
    .sort(
      (p, q) =>
        q.score - p.score || q.x.date.localeCompare(p.x.date) || p.x.slug.localeCompare(q.x.slug),
    );
  const result = scored
    .filter((s) => s.score > W_KIND)
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
