import { BASE_MODULE, DEFAULT_MODULE_TYPE_ID, FOUNDATION_PRESETS } from "./catalog.ts";
import type { HouseProject, ModuleInstance, OpeningInstance } from "./types.ts";
import { SCHEMA_VERSION } from "./types.ts";

/**
 * Создание, копирование и переименование проектов.
 *
 * Идентификаторы генерируются здесь и нигде больше. Правило: id уникален в
 * пределах проекта и никогда не переиспользуется — на него ссылаются проёмы,
 * и совпадение id после копирования склеило бы окно из одного дома со стеной
 * другого.
 */

let counter = 0;

/**
 * Короткий идентификатор.
 *
 * Не UUID: id попадает в инспектор и в сообщения валидации, и человек должен
 * уметь прочитать его вслух. Времени и счётчика достаточно — записи создаёт
 * один проектировщик в одной вкладке.
 */
export function newId(prefix: string): string {
  counter += 1;
  const stamp = Date.now().toString(36).slice(-5);
  return `${prefix}${stamp}${counter.toString(36)}`;
}

/**
 * Транслитерация в адрес страницы.
 *
 * Кириллица в URL технически допустима, но ссылка на такой адрес в мессенджере
 * превращается в процентную кашу длиной в экран. Проектировщик вводит русское
 * название — адрес получается латиницей.
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
  ц: "c",
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

export function slugify(input: string): string {
  return input
    .toLowerCase()
    .split("")
    .map((ch) => TRANSLIT[ch] ?? ch)
    .join("")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

/** Уникальный адрес: к занятому дописывается номер. */
export function uniqueSlug(base: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  const root = slugify(base) || "house";
  if (!used.has(root)) return root;
  for (let i = 2; i < 1000; i += 1) {
    const candidate = `${root}-${i}`;
    if (!used.has(candidate)) return candidate;
  }
  return `${root}-${Date.now().toString(36)}`;
}

/** Пустой проект: один модуль в начале координат — с чего-то начинать надо. */
export function createProject(title = "Новый проект"): HouseProject {
  const now = new Date().toISOString();
  const piles = FOUNDATION_PRESETS[0];
  return {
    id: newId("hp-"),
    schemaVersion: SCHEMA_VERSION,
    status: "draft",
    title,
    slug: slugify(title) || newId("house-"),
    createdAt: now,
    updatedAt: now,
    version: 1,
    model: {
      units: "mm",
      modules: [
        {
          id: newId("m"),
          moduleTypeId: DEFAULT_MODULE_TYPE_ID,
          floor: 0,
          positionMm: { x: 0, y: 0 },
          rotationDeg: 0,
        },
      ],
      openings: [],
      foundation: {
        kind: piles.kind,
        clearanceMm: piles.clearanceMm,
        visible: true,
      },
      groundOffsetMm: 0,
    },
    publication: {
      gallery: [],
      highlights: [],
      tags: [],
      currency: "RUB",
      isFeatured: false,
    },
    source: {
      referenceDocumentIds: [],
      unresolvedQuestions: [],
    },
  };
}

/**
 * Независимая копия проекта.
 *
 * Перевыпускаются все идентификаторы — и проекта, и модулей, и проёмов, —
 * иначе правка копии дотянулась бы до оригинала через общие ссылки. Статус
 * копии всегда черновик: опубликованным дом делает человек, а не операция
 * копирования.
 */
export function duplicateProject(
  p: HouseProject,
  opts: { title?: string; takenSlugs?: Iterable<string> } = {},
): HouseProject {
  const now = new Date().toISOString();
  const idMap = new Map<string, string>();

  const modules: ModuleInstance[] = p.model.modules.map((m) => {
    const id = newId("m");
    idMap.set(m.id, id);
    return { ...m, id, positionMm: { ...m.positionMm } };
  });

  const openings: OpeningInstance[] = p.model.openings
    .filter((o) => idMap.has(o.moduleId))
    .map((o) => ({ ...o, id: newId("o"), moduleId: idMap.get(o.moduleId)! }));

  const title = opts.title ?? `${p.title} (копия)`;

  return {
    ...p,
    id: newId("hp-"),
    title,
    slug: uniqueSlug(title, opts.takenSlugs ?? []),
    status: "draft",
    createdAt: now,
    updatedAt: now,
    publishedAt: undefined,
    version: 1,
    model: {
      ...p.model,
      modules,
      openings,
      foundation: { ...p.model.foundation },
    },
    publication: {
      ...p.publication,
      gallery: [...p.publication.gallery],
      highlights: [...p.publication.highlights],
      tags: [...p.publication.tags],
    },
    source: {
      ...p.source,
      referenceDocumentIds: [...p.source.referenceDocumentIds],
      unresolvedQuestions: [...p.source.unresolvedQuestions],
    },
  };
}

/** Новый модуль выбранного типа в заданной точке. */
export function createModule(
  x: number,
  y: number,
  floor: number,
  moduleTypeId: string = DEFAULT_MODULE_TYPE_ID,
): ModuleInstance {
  return {
    id: newId("m"),
    moduleTypeId,
    floor,
    positionMm: { x: Math.round(x), y: Math.round(y) },
    rotationDeg: 0,
  };
}

/** Высота помещения — постоянная памятка редактора. */
export const CLEAR_HEIGHT_MM = BASE_MODULE.clearHeightMm;
