/**
 * Проекты домов.
 *
 * Основной источник — таблица `projects` в Supabase: карточки правятся в
 * админке без коммита и деплоя. Чтение идёт через серверную функцию
 * `fetchProjects`, чтобы ключ базы не уезжал в браузер (см. lib/projects.server.ts).
 *
 * Запасной источник — content/projects/*.json, вшитые в сборку через
 * import.meta.glob. Файлы остаются в репозитории намеренно: если база
 * недоступна, витрина продолжает работать. Они же используются в локальной
 * разработке, когда переменные окружения не заданы.
 *
 * Почему JSON, а не markdown с front matter, как у блога: у проекта нет
 * «тела статьи», зато есть массивы (gallery, features), а значения в features
 * содержат запятые — «Потолки 3,15 м». Плоский парсер из lib/blog.ts разрезал
 * бы такую строку по запятой пополам. JSON снимает вопрос целиком.
 */

import { createServerFn } from "@tanstack/react-start";

export type Project = {
  slug: string;
  name: string;
  /** 'concrete' | 'villa' — расширяется строкой в базе, не миграцией. */
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
/* Разбор строки                                                       */
/* ------------------------------------------------------------------ */

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

/**
 * Одна строка — из файла или из базы — в карточку проекта.
 * Разбор общий, чтобы оба источника гарантированно давали одинаковую форму
 * и расхождение нельзя было внести правкой в одном месте.
 *
 * null означает, что строку показывать нельзя: без имени или обложки
 * сломается и вёрстка списка, и разметка Open Graph.
 */
export function normalizeProject(
  raw: Record<string, unknown>,
  fallbackSlug: string,
): Project | null {
  const slug = asString(raw.slug) ?? fallbackSlug;
  const name = asString(raw.name);
  const cover = asString(raw.cover_image);
  if (!slug || !name || !cover) return null;

  return {
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
    // Скрыть карточку — published: false. По умолчанию true: строка есть,
    // значит проект показываем.
    published: raw.published !== false,
    // Из базы приходит timestamptz, из файла — уже дата. Карте сайта нужен
    // только день, а лишняя точность сделала бы lastmod «меняющимся» при
    // каждом касании строки.
    updated_at: asString(raw.updated_at)?.slice(0, 10) ?? null,
  };
}

/* ------------------------------------------------------------------ */
/* Запасной источник: файлы                                            */
/* ------------------------------------------------------------------ */

const files = import.meta.glob<Record<string, unknown>>("../../content/projects/*.json", {
  import: "default",
  eager: true,
});

function buildFileProjects(): Project[] {
  const projects: Project[] = [];

  for (const [path, raw] of Object.entries(files)) {
    const fileSlug = path
      .split("/")
      .pop()!
      .replace(/\.json$/, "");
    const project = normalizeProject(raw, fileSlug);
    if (project?.published) projects.push(project);
  }

  // Порядок задаётся display_order; при равных значениях — по slug, чтобы
  // сборка была воспроизводимой и не зависела от порядка обхода каталога.
  return projects.sort((a, b) => a.display_order - b.display_order || a.slug.localeCompare(b.slug));
}

/** Опубликованные проекты из файлов репозитория. Запасной источник. */
export const fileProjects: Project[] = buildFileProjects();

/* ------------------------------------------------------------------ */
/* Публичный интерфейс                                                 */
/* ------------------------------------------------------------------ */

/**
 * Опубликованные проекты в порядке display_order.
 *
 * Выполняется на сервере всегда — и при первом рендере, и при переходах по
 * сайту. Возвращает весь список: карточек единицы, фильтрация по серии или
 * поиск по адресу дешевле сделать в памяти, чем ходить в базу за каждым
 * срезом и держать несколько кэшей.
 */
export const fetchProjects = createServerFn({ method: "GET" }).handler(async () => {
  const { loadProjects } = await import("./projects.server");
  return loadProjects();
});

/** Проекты одной серии: 'concrete', 'villa'. */
export function filterBySeries(projects: Project[], series: string): Project[] {
  return projects.filter((p) => p.series === series);
}

/** Проект по адресу страницы; undefined — если такого нет. */
export function findBySlug(projects: Project[], slug: string): Project | undefined {
  return projects.find((p) => p.slug === slug);
}
