/**
 * Проекты домов на локальных файлах.
 *
 * Единственный источник — каталог content/projects/*.json. Базы данных здесь
 * нет и быть не должно: проектов пять, меняются они раз в квартал, и версия
 * карточки должна совпадать с версией кода, который её показывает.
 *
 * Почему JSON, а не markdown с front matter, как у блога: у проекта нет
 * «тела статьи», зато есть массивы (gallery, features), а значения в features
 * содержат запятые — «Потолки 3,15 м». Плоский парсер из lib/blog.ts разрезал
 * бы такую строку по запятой пополам. JSON снимает вопрос целиком.
 *
 * Файлы подтягиваются через import.meta.glob с eager: true — на этапе сборки.
 * В бандле остаются готовые данные, на боевом сервере ни обращений к диску,
 * ни сетевых вызовов при рендере не происходит.
 */

export type Project = {
  slug: string;
  name: string;
  /** 'concrete' | 'villa' — расширяется добавлением файла, не миграцией. */
  series: string;
  tagline: string | null;
  description: string | null;
  area_m2: number | null;
  bedrooms: number | null;
  bathrooms: number | null;
  floors: number | null;
  price_from: number | null;
  cover_image: string;
  gallery: string[];
  features: string[];
  display_order: number;
  published: boolean;
  /** YYYY-MM-DD, нужна карте сайта в качестве lastmod. */
  updated_at: string | null;
};

/* ------------------------------------------------------------------ */
/* Загрузка                                                            */
/* ------------------------------------------------------------------ */

const files = import.meta.glob<Record<string, unknown>>("../../content/projects/*.json", {
  import: "default",
  eager: true,
});

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function asNumber(value: unknown): number | null {
  const n = typeof value === "string" ? Number(value) : value;
  return typeof n === "number" && Number.isFinite(n) ? n : null;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === "string" && v.trim().length > 0);
}

function buildProjects(): Project[] {
  const projects: Project[] = [];

  for (const [path, raw] of Object.entries(files)) {
    const fileSlug = path
      .split("/")
      .pop()!
      .replace(/\.json$/, "");
    const slug = asString(raw.slug) ?? fileSlug;
    const name = asString(raw.name);
    const cover = asString(raw.cover_image);

    // Карточка без имени или без обложки сломала бы вёрстку списка и
    // разметку Open Graph. Это ошибка контента — молча пропускаем файл,
    // а не отдаём посетителю дырявую страницу.
    if (!name || !cover) continue;

    projects.push({
      slug,
      name,
      series: asString(raw.series) ?? "concrete",
      tagline: asString(raw.tagline),
      description: asString(raw.description),
      area_m2: asNumber(raw.area_m2),
      bedrooms: asNumber(raw.bedrooms),
      bathrooms: asNumber(raw.bathrooms),
      floors: asNumber(raw.floors),
      price_from: asNumber(raw.price_from),
      cover_image: cover,
      gallery: asStringArray(raw.gallery),
      features: asStringArray(raw.features),
      display_order: asNumber(raw.display_order) ?? 0,
      // Скрыть проект — published: false. Значение по умолчанию true:
      // файл положили в каталог, значит проект показываем.
      published: raw.published !== false,
      updated_at: asString(raw.updated_at),
    });
  }

  // Порядок задаётся display_order; при равных значениях — по slug, чтобы
  // сборка была воспроизводимой и не зависела от порядка обхода каталога.
  return projects.sort((a, b) => a.display_order - b.display_order || a.slug.localeCompare(b.slug));
}

const allProjects = buildProjects();
const publishedProjects = allProjects.filter((p) => p.published);

/* ------------------------------------------------------------------ */
/* Публичный интерфейс                                                 */
/* ------------------------------------------------------------------ */

/** Все опубликованные проекты в порядке display_order. */
export function getAllProjects(): Project[] {
  return publishedProjects;
}

/** Опубликованные проекты одной серии: 'concrete', 'villa'. */
export function getProjectsBySeries(series: string): Project[] {
  return publishedProjects.filter((p) => p.series === series);
}

/** Опубликованный проект по адресу страницы; undefined — если такого нет. */
export function getProjectBySlug(slug: string): Project | undefined {
  return publishedProjects.find((p) => p.slug === slug);
}
