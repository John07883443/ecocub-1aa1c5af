/**
 * Чтение проектов из базы. Только сервер.
 *
 * Источник — таблица `projects` в Supabase, запрос идёт через PostgREST
 * обычным fetch: библиотека `@supabase/supabase-js` ради одного SELECT не
 * нужна, а её отсутствие оставляет клиентский бандл лёгким.
 *
 * Почему модуль серверный. Ключ и адрес базы живут в переменных окружения
 * процесса и в браузер не попадают. Роут-лоадеры в TanStack Start при
 * переходах внутри сайта выполняются в браузере, поэтому обращаться сюда
 * напрямую из лоадера нельзя — только через серверную функцию (см.
 * `fetchProjects` в lib/projects.ts).
 *
 * Кэш. Главную открывают десятки человек в минуту, а карточки меняются раз
 * в квартал. Без кэша каждый рендер шёл бы в Ирландию — это лишние сотни
 * миллисекунд на посетителя и лишний трафик в бесплатном лимите.
 *
 * Запасной источник. Если база недоступна — уснула, упала, закрыт доступ, —
 * отдаём карточки из content/projects/*.json, вшитых в сборку. Витрина сайта
 * не должна зависеть от внешнего сервиса: посетитель увидит проекты в любом
 * случае, пусть и той версии, что была на момент сборки.
 */

import { type Project, fileProjects, normalizeProject } from "./projects";

/** Сколько живёт кэш. Минута — компромисс между «правка видна сразу» и нагрузкой. */
const CACHE_TTL_MS = 60_000;

/** Ждать базу дольше — значит держать посетителя перед пустым экраном. */
const REQUEST_TIMEOUT_MS = 4_000;

const COLUMNS = [
  "slug",
  "name",
  "series",
  "tagline",
  "description",
  "area_m2",
  "bedrooms",
  "bathrooms",
  "floors",
  "price_from",
  "cover_image",
  "gallery",
  "features",
  "display_order",
  "published",
  "updated_at",
].join(",");

type Cache = { at: number; value: Project[] };
let cache: Cache | null = null;

/** Параллельные запросы во время холодного кэша должны ждать один поход в базу. */
let inFlight: Promise<Project[]> | null = null;

function config(): { url: string; key: string } | null {
  const url = process.env.SUPABASE_URL?.replace(/\/+$/, "");
  const key = process.env.SUPABASE_ANON_KEY;
  return url && key ? { url, key } : null;
}

async function requestProjects(url: string, key: string): Promise<Project[]> {
  const endpoint =
    `${url}/rest/v1/projects` +
    `?select=${COLUMNS}&published=eq.true&order=display_order.asc,slug.asc`;

  const res = await fetch(endpoint, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  if (!res.ok) {
    throw new Error(`PostgREST ответил ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }

  const rows: unknown = await res.json();
  if (!Array.isArray(rows)) throw new Error("Ожидался массив строк");

  const projects = rows
    .map((row) => normalizeProject(row as Record<string, unknown>, ""))
    .filter((p): p is Project => p !== null);

  // Пустая таблица почти наверняка означает незалитые данные или слишком
  // строгую политику доступа, а не «проектов нет». Отдать пустую витрину
  // хуже, чем показать версию из файлов, поэтому считаем это ошибкой.
  if (!projects.length) throw new Error("База вернула ноль опубликованных проектов");

  return projects;
}

/**
 * Опубликованные проекты в порядке display_order.
 * Никогда не бросает: при любой проблеме отдаёт версию из файлов.
 */
export async function loadProjects(): Promise<Project[]> {
  const now = Date.now();
  if (cache && now - cache.at < CACHE_TTL_MS) return cache.value;
  if (inFlight) return inFlight;

  const cfg = config();
  if (!cfg) {
    // Переменные не заданы — это штатный режим локальной разработки,
    // предупреждать не о чем.
    return fileProjects;
  }

  inFlight = requestProjects(cfg.url, cfg.key)
    .then((projects) => {
      cache = { at: Date.now(), value: projects };
      return projects;
    })
    .catch((e: unknown) => {
      const message = e instanceof Error ? e.message : String(e);
      console.warn(`Проекты: база недоступна, отдаю версию из файлов — ${message}`);

      // Просроченный кэш лучше файлов: он свежее. Файлы — последний рубеж.
      if (cache) return cache.value;
      return fileProjects;
    })
    .finally(() => {
      inFlight = null;
    });

  return inFlight;
}
