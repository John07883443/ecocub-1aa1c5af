/**
 * Хранилище проектов домов CAD Light. Только сервер.
 *
 * База — SQLite-файл на диске VPS через встроенный `node:sqlite`, тем же
 * способом, что и заявки (см. lib/leads.server.ts). Причины те же: ни одной
 * внешней зависимости, ни отдельного процесса СУБД, ни нативных модулей для
 * сборки. Проектов десятки, редактирует их один человек — этого достаточно
 * с большим запасом.
 *
 * Почему не Supabase, где уже живут карточки каталога. Карточка — это
 * полтора десятка полей и картинка, её удобно править в дашборде. Проект
 * CAD Light — документ с геометрией, который правится только редактором и
 * только целиком; дашборд для него бесполезен. Плюс запись в Supabase
 * требовала бы ключа service_role на сервере, то есть ещё одного секрета и
 * ещё одного внешнего сервиса на пути публикации. SQLite рядом с заявками
 * решает ту же задачу без этого.
 *
 * Где лежит файл. Переменная HOUSE_PROJECTS_DB_PATH, по умолчанию
 * /var/lib/ecocub/house-projects.db — то есть ВНЕ каталога деплоя, ровно по
 * той же причине, что и база заявок: deploy.sh тасует .output и .output.prev,
 * и база рядом с приложением однажды уехала бы вместе с откатом.
 *
 * Что происходит, если SQLite недоступен. Публичный каталог продолжает
 * работать: опубликованные проекты читаются из content/house-projects/*.json,
 * вшитых в сборку. Мутации в этом режиме отклоняются с внятной причиной —
 * молча «сохранить» проект в никуда хуже, чем отказать.
 */

import { computeMetrics } from "./house-project/geometry.ts";
import { duplicateProject, uniqueSlug } from "./house-project/factory.ts";
import { parseProject, serializeProject } from "./house-project/serialize.ts";
import { hasErrors, validateProject } from "./house-project/validate.ts";
import type { HouseProject, ProjectStatus, ProjectSummary } from "./house-project/types.ts";

/**
 * Запасной источник подгружается динамически и под try/catch.
 *
 * Он собран на `import.meta.glob`, то есть на возможности Vite. Прямой импорт
 * сделал бы весь этот модуль незапускаемым вне сборщика — а именно так его
 * гоняют интеграционные тесты хранилища. Отсутствие файлов-фикстур не повод
 * ронять сервер: без них просто нечего показать в аварийном режиме.
 */
let fallbackCache: HouseProject[] | null = null;

async function fallbackProjects(): Promise<HouseProject[]> {
  if (fallbackCache) return fallbackCache;
  try {
    const mod = await import("./house-projects.shared");
    fallbackCache = mod.fileHouseProjects;
  } catch {
    fallbackCache = [];
  }
  return fallbackCache;
}

const DEFAULT_DB_PATH = "/var/lib/ecocub/house-projects.db";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS house_projects (
  id           TEXT PRIMARY KEY,
  slug         TEXT NOT NULL UNIQUE,
  title        TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'draft',
  version      INTEGER NOT NULL DEFAULT 1,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL,
  published_at TEXT,
  document     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_house_projects_status ON house_projects (status);
CREATE INDEX IF NOT EXISTS idx_house_projects_updated ON house_projects (updated_at DESC);

CREATE TABLE IF NOT EXISTS house_project_covers (
  project_id text PRIMARY KEY,
  mime       text NOT NULL,
  bytes      blob NOT NULL,
  updated_at text NOT NULL
);
`;

/**
 * Документ хранится целиком в одной колонке, а не разложен по таблицам.
 *
 * Раскладывать модули и проёмы по строкам пришлось бы ради запросов, которых
 * нет: никто никогда не спросит «все окна шире метра во всех домах». Зато
 * каждая правка схемы модели превращалась бы в миграцию базы, а чтение — в
 * сборку документа из трёх джойнов, где легко потерять проём. Денормализованы
 * ровно те поля, по которым идут выборки и уникальность.
 */

type Row = {
  id: string;
  slug: string;
  title: string;
  status: string;
  version: number;
  created_at: string;
  updated_at: string;
  published_at: string | null;
  document: string;
};

type Statement = {
  run: (...params: unknown[]) => unknown;
  get: (...params: unknown[]) => unknown;
  all: (...params: unknown[]) => unknown[];
};
type Db = { prepare: (sql: string) => Statement; exec: (sql: string) => void };

let db: Db | null = null;
let sqliteError: string | null = null;

function dbPath(): string {
  return process.env.HOUSE_PROJECTS_DB_PATH || DEFAULT_DB_PATH;
}

async function getDb(): Promise<Db | null> {
  if (db) return db;
  if (sqliteError) return null;
  try {
    const { DatabaseSync } = await import("node:sqlite");
    const { mkdirSync } = await import("node:fs");
    const { dirname } = await import("node:path");
    const path = dbPath();
    mkdirSync(dirname(path), { recursive: true });
    const instance = new DatabaseSync(path) as unknown as Db;
    // WAL по той же причине, что и у заявок: читатель не должен натыкаться
    // на незакрытый журнал, пока редактор сохраняет черновик.
    instance.exec("PRAGMA journal_mode = WAL");
    instance.exec(SCHEMA);
    db = instance;
    await seedIfEmpty(instance);
    return db;
  } catch (e) {
    sqliteError = (e as Error).message;
    console.warn(
      `Проекты CAD: SQLite недоступен (${sqliteError}). Каталог читается из файлов, запись отключена.`,
    );
    return null;
  }
}

/**
 * Первичное наполнение.
 *
 * Пустая база на новом сервере означала бы пустой каталог и пустой редактор:
 * человек открывает «Проектирование» и не понимает, работает ли оно вообще.
 * Поэтому при первом запуске в базу кладутся эталонные дома из репозитория —
 * те же самые, что лежат в content/house-projects/*.json. Повторно это не
 * срабатывает: условие — полностью пустая таблица, а не отсутствие записи.
 */
async function seedIfEmpty(instance: Db): Promise<void> {
  try {
    const row = instance.prepare("SELECT COUNT(*) AS n FROM house_projects").get() as {
      n: number;
    };
    if (row?.n > 0) return;
    const seed = await fallbackProjects();
    for (const project of seed) {
      insertRow(instance, project);
    }
    if (seed.length) {
      console.info(`Проекты CAD: база пуста, залито ${seed.length} эталонных проектов.`);
    }
  } catch (e) {
    console.warn("Проекты CAD: первичное наполнение не удалось:", (e as Error).message);
  }
}

function insertRow(instance: Db, p: HouseProject): void {
  instance
    .prepare(
      `INSERT INTO house_projects
         (id, slug, title, status, version, created_at, updated_at, published_at, document)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      p.id,
      p.slug,
      p.title,
      p.status,
      p.version,
      p.createdAt,
      p.updatedAt,
      p.publishedAt ?? null,
      JSON.stringify(serializeProject(p)),
    );
}

function rowToProject(row: Row): HouseProject | null {
  try {
    return parseProject(JSON.parse(row.document));
  } catch (e) {
    console.warn(`Проекты CAD: запись ${row.id} не читается: ${(e as Error).message}`);
    return null;
  }
}

export type RepositoryErrorCode =
  | "not-found"
  | "conflict"
  | "slug-taken"
  | "validation"
  | "read-only"
  | "version-conflict";

/**
 * Ошибка репозитория с кодом, который роут превращает в HTTP-статус.
 *
 * Поля присваиваются в теле конструктора, а не сокращённой записью через
 * модификатор доступа в параметре: доменные тесты гоняются через
 * `node --experimental-strip-types`, а он умеет только вырезать типы и на
 * такой записи падает — она порождает код, а не только описание типов.
 */
export class RepositoryError extends Error {
  code: RepositoryErrorCode;
  issues?: unknown;

  constructor(code: RepositoryErrorCode, message: string, issues?: unknown) {
    super(message);
    this.name = "RepositoryError";
    this.code = code;
    this.issues = issues;
  }
}

function requireDb(instance: Db | null): asserts instance is Db {
  if (!instance) {
    throw new RepositoryError(
      "read-only",
      "Хранилище проектов недоступно: SQLite не открылся. Запись отключена, " +
        "каталог продолжает работать из файлов репозитория. Проверьте HOUSE_PROJECTS_DB_PATH и права на каталог.",
    );
  }
}

export function summaryOf(p: HouseProject): ProjectSummary {
  return {
    id: p.id,
    slug: p.slug,
    title: p.title,
    status: p.status,
    description: p.description,
    updatedAt: p.updatedAt,
    publishedAt: p.publishedAt,
    version: p.version,
    coverImage: p.publication.coverImage,
    priceFrom: p.publication.priceFrom,
    tags: p.publication.tags,
    highlights: p.publication.highlights,
    metrics: computeMetrics(p.model),
  };
}

/* ------------------------------------------------------------------ */
/* Чтение                                                              */
/* ------------------------------------------------------------------ */

/**
 * Опубликованные проекты. Никогда не бросает: при недоступной базе отдаёт
 * версию из файлов, чтобы публичный каталог не зависел от состояния диска.
 */
export async function listPublished(): Promise<ProjectSummary[]> {
  const instance = await getDb();
  if (!instance) {
    return (await fallbackProjects()).filter((p) => p.status === "published").map(summaryOf);
  }
  try {
    const rows = instance
      .prepare(
        `SELECT * FROM house_projects WHERE status = 'published' ORDER BY published_at DESC, title ASC`,
      )
      .all() as Row[];
    return rows
      .map(rowToProject)
      .filter((p): p is HouseProject => p !== null)
      .map(summaryOf);
  } catch (e) {
    console.warn("Проекты CAD: чтение каталога не удалось:", (e as Error).message);
    return (await fallbackProjects()).filter((p) => p.status === "published").map(summaryOf);
  }
}

/** Опубликованный проект по адресу. Черновики и архив наружу не отдаются. */
export async function getPublished(slug: string): Promise<HouseProject | null> {
  const instance = await getDb();
  if (!instance) {
    return (
      (await fallbackProjects()).find((p) => p.slug === slug && p.status === "published") ?? null
    );
  }
  try {
    const row = instance
      .prepare(`SELECT * FROM house_projects WHERE slug = ? AND status = 'published'`)
      .get(slug) as Row | undefined;
    return row ? rowToProject(row) : null;
  } catch (e) {
    console.warn("Проекты CAD: чтение проекта не удалось:", (e as Error).message);
    return (
      (await fallbackProjects()).find((p) => p.slug === slug && p.status === "published") ?? null
    );
  }
}

/** Все проекты — для режима «Проектирование». Требует прав администратора. */
export async function listAll(status?: ProjectStatus): Promise<ProjectSummary[]> {
  const instance = await getDb();
  if (!instance) return (await fallbackProjects()).map(summaryOf);
  const rows = (
    status
      ? instance
          .prepare(`SELECT * FROM house_projects WHERE status = ? ORDER BY updated_at DESC`)
          .all(status)
      : instance.prepare(`SELECT * FROM house_projects ORDER BY updated_at DESC`).all()
  ) as Row[];
  return rows
    .map(rowToProject)
    .filter((p): p is HouseProject => p !== null)
    .map(summaryOf);
}

/** Проект по id или адресу, в любом статусе. Требует прав администратора. */
export async function getAny(idOrSlug: string): Promise<HouseProject | null> {
  const instance = await getDb();
  if (!instance) {
    return (await fallbackProjects()).find((p) => p.id === idOrSlug || p.slug === idOrSlug) ?? null;
  }
  const row = instance
    .prepare(`SELECT * FROM house_projects WHERE id = ? OR slug = ? LIMIT 1`)
    .get(idOrSlug, idOrSlug) as Row | undefined;
  return row ? rowToProject(row) : null;
}

async function takenSlugs(instance: Db, exceptId?: string): Promise<string[]> {
  const rows = instance.prepare(`SELECT slug, id FROM house_projects`).all() as {
    slug: string;
    id: string;
  }[];
  return rows.filter((r) => r.id !== exceptId).map((r) => r.slug);
}

/* ------------------------------------------------------------------ */
/* Запись                                                              */
/* ------------------------------------------------------------------ */

/** Создать проект. Адрес приводится к уникальному, если занят. */
export async function create(project: HouseProject): Promise<HouseProject> {
  const instance = await getDb();
  requireDb(instance);

  const issues = validateProject(project);
  if (hasErrors(issues)) {
    throw new RepositoryError("validation", "Проект не проходит проверку", issues);
  }

  const stored: HouseProject = {
    ...project,
    status: "draft",
    slug: uniqueSlug(project.slug || project.title, await takenSlugs(instance)),
    version: 1,
  };
  insertRow(instance, stored);
  return stored;
}

/**
 * Сохранить изменения.
 *
 * `expectedVersion` — оптимистичная блокировка. Вкладка, провисевшая
 * открытой, присылает версию, которой в базе уже нет, и получает отказ
 * вместо тихой перезаписи чужой работы. Без этого механизма две вкладки
 * одного человека — а это обычное дело — молча теряют часть правок.
 */
export async function update(
  id: string,
  patch: Partial<HouseProject>,
  expectedVersion: number,
): Promise<HouseProject> {
  const instance = await getDb();
  requireDb(instance);

  const current = await getAny(id);
  if (!current) throw new RepositoryError("not-found", "Проект не найден");
  if (current.version !== expectedVersion) {
    throw new RepositoryError(
      "version-conflict",
      `Проект уже изменён в другом месте: в базе версия ${current.version}, прислана ${expectedVersion}. ` +
        `Перезагрузите страницу, чтобы не потерять чужие правки.`,
    );
  }

  const merged: HouseProject = {
    ...current,
    ...patch,
    id: current.id,
    createdAt: current.createdAt,
    // Статус меняют отдельные операции публикации и архивирования: обычное
    // сохранение не должно уметь выложить дом на сайт «заодно».
    status: current.status,
    updatedAt: new Date().toISOString(),
    version: current.version + 1,
  };

  const issues = validateProject(merged);
  if (hasErrors(issues)) {
    throw new RepositoryError("validation", "Проект не проходит проверку", issues);
  }

  if (merged.slug !== current.slug) {
    const taken = await takenSlugs(instance, current.id);
    if (taken.includes(merged.slug)) {
      throw new RepositoryError("slug-taken", `Адрес «${merged.slug}» уже занят другим проектом`);
    }
  }

  instance
    .prepare(
      `UPDATE house_projects
          SET slug = ?, title = ?, status = ?, version = ?, updated_at = ?, published_at = ?, document = ?
        WHERE id = ? AND version = ?`,
    )
    .run(
      merged.slug,
      merged.title,
      merged.status,
      merged.version,
      merged.updatedAt,
      merged.publishedAt ?? null,
      JSON.stringify(serializeProject(merged)),
      merged.id,
      expectedVersion,
    );

  return merged;
}

async function setStatus(id: string, status: ProjectStatus): Promise<HouseProject> {
  const instance = await getDb();
  requireDb(instance);

  const current = await getAny(id);
  if (!current) throw new RepositoryError("not-found", "Проект не найден");

  if (status === "published") {
    const issues = validateProject(current, { forPublication: true });
    if (hasErrors(issues)) {
      throw new RepositoryError(
        "validation",
        "Публикация невозможна: в модели есть критические ошибки",
        issues,
      );
    }
  }

  const next: HouseProject = {
    ...current,
    status,
    updatedAt: new Date().toISOString(),
    version: current.version + 1,
    publishedAt: status === "published" ? new Date().toISOString() : current.publishedAt,
  };

  instance
    .prepare(
      `UPDATE house_projects
          SET status = ?, version = ?, updated_at = ?, published_at = ?, document = ?
        WHERE id = ?`,
    )
    .run(
      next.status,
      next.version,
      next.updatedAt,
      next.publishedAt ?? null,
      JSON.stringify(serializeProject(next)),
      next.id,
    );

  return next;
}

export function publish(id: string): Promise<HouseProject> {
  return setStatus(id, "published");
}

/** Снять с публикации: дом исчезает из каталога, но остаётся в редакторе. */
export function unpublish(id: string): Promise<HouseProject> {
  return setStatus(id, "draft");
}

/** Архивировать. Безвозвратного удаления в системе нет намеренно. */
export function archive(id: string): Promise<HouseProject> {
  return setStatus(id, "archived");
}

/** Независимая копия. Все идентификаторы перевыпускаются. */
export async function duplicate(id: string): Promise<HouseProject> {
  const instance = await getDb();
  requireDb(instance);
  const current = await getAny(id);
  if (!current) throw new RepositoryError("not-found", "Проект не найден");
  const copy = duplicateProject(current, { takenSlugs: await takenSlugs(instance) });
  insertRow(instance, copy);
  return copy;
}

/* ------------------------------------------------------------------ */
/* Обложки                                                             */
/* ------------------------------------------------------------------ */

/**
 * Обложка хранится отдельной строкой в своей таблице, а не внутри документа.
 *
 * Причина простая: документ читается при каждом открытии проекта и при каждой
 * выдаче каталога, а картинка нужна только браузеру и только по прямой
 * ссылке. Base64 внутри JSON раздул бы каждое чтение модели на сотни
 * килобайт и попал бы в историю отмены редактора.
 *
 * Почему в базе, а не файлом на диске. Каталог деплоя перетасовывается при
 * каждой выкладке (см. deploy.sh), и картинка, положенная рядом с
 * приложением, исчезла бы при первом же откате. База лежит вне каталога
 * деплоя и переживает выкладку — как и заявки.
 */

/** Больше — это уже не обложка карточки, а недосмотр. */
const MAX_COVER_BYTES = 2_000_000;

export async function saveCover(projectId: string, mime: string, bytes: Uint8Array): Promise<void> {
  const instance = await getDb();
  requireDb(instance);
  if (bytes.byteLength > MAX_COVER_BYTES) {
    throw new RepositoryError(
      "validation",
      `Обложка больше ${Math.round(MAX_COVER_BYTES / 1000)} КБ — уменьшите изображение`,
    );
  }
  if (!/^image\/(png|jpeg|webp)$/.test(mime)) {
    throw new RepositoryError("validation", "Обложка должна быть PNG, JPEG или WebP");
  }
  instance
    .prepare(
      `INSERT INTO house_project_covers (project_id, mime, bytes, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(project_id) DO UPDATE SET mime = excluded.mime, bytes = excluded.bytes, updated_at = excluded.updated_at`,
    )
    .run(projectId, mime, bytes, new Date().toISOString());
}

export async function readCover(
  projectId: string,
): Promise<{ mime: string; bytes: Uint8Array; updatedAt: string } | null> {
  const instance = await getDb();
  if (!instance) return null;
  try {
    const row = instance
      .prepare(`SELECT mime, bytes, updated_at FROM house_project_covers WHERE project_id = ?`)
      .get(projectId) as { mime: string; bytes: Uint8Array; updated_at: string } | undefined;
    return row ? { mime: row.mime, bytes: row.bytes, updatedAt: row.updated_at } : null;
  } catch (e) {
    console.warn("Проекты CAD: обложка не читается:", (e as Error).message);
    return null;
  }
}

/** Адрес обложки проекта. Один на все места, где она показывается. */
export function coverUrl(projectId: string): string {
  return `/api/design/cover/${projectId}`;
}

/* ------------------------------------------------------------------ */
/* Пароль владельца                                                    */
/* ------------------------------------------------------------------ */

/**
 * Пароль режима проектирования, заданный из браузера.
 *
 * Лежит в той же базе, что и проекты, отдельной строкой — и только хешем.
 * Хранить пароль рядом с данными, которые он защищает, обычно плохо, но здесь
 * альтернатива хуже: единственное другое место — файл окружения на сервере,
 * а до него владелец с телефона не дотянется. Именно из-за этого раздел и
 * простаивал закрытым.
 *
 * Строка одна: пользователь системы один. Таблица «пользователи» с ролями для
 * одного человека — это лишняя сущность, которую придётся сопровождать годами.
 */
export interface OwnerSecretRow {
  salt: string;
  hash: string;
  createdAt: string;
}

const OWNER_SCHEMA = `
CREATE TABLE IF NOT EXISTS design_owner (
  id         INTEGER PRIMARY KEY CHECK (id = 1),
  salt       TEXT NOT NULL,
  hash       TEXT NOT NULL,
  created_at TEXT NOT NULL
);
`;

export async function readOwnerSecret(): Promise<OwnerSecretRow | null> {
  const instance = await getDb();
  if (!instance) return null;
  try {
    instance.exec(OWNER_SCHEMA);
    const row = instance
      .prepare(`SELECT salt, hash, created_at FROM design_owner WHERE id = 1`)
      .get() as { salt: string; hash: string; created_at: string } | undefined;
    return row ? { salt: row.salt, hash: row.hash, createdAt: row.created_at } : null;
  } catch (e) {
    console.warn("Проектирование: пароль владельца не читается:", (e as Error).message);
    return null;
  }
}

/**
 * Записать пароль. `onlyIfEmpty` защищает от перехвата: занять пустое место
 * можно один раз, а сменить пароль — только зная старый (это проверяет
 * вызывающий) или через переменную окружения.
 */
export async function writeOwnerSecret(
  value: OwnerSecretRow,
  opts: { onlyIfEmpty?: boolean } = {},
): Promise<boolean> {
  const instance = await getDb();
  if (!instance) {
    throw new RepositoryError(
      "read-only",
      "Хранилище недоступно, пароль сохранить некуда. Проверьте HOUSE_PROJECTS_DB_PATH и права на каталог.",
    );
  }
  instance.exec(OWNER_SCHEMA);
  if (opts.onlyIfEmpty) {
    const existing = instance.prepare(`SELECT 1 FROM design_owner WHERE id = 1`).get();
    if (existing) return false;
  }
  instance
    .prepare(
      `INSERT INTO design_owner (id, salt, hash, created_at) VALUES (1, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET salt = excluded.salt, hash = excluded.hash, created_at = excluded.created_at`,
    )
    .run(value.salt, value.hash, value.createdAt);
  return true;
}

/* ------------------------------------------------------------------ */
/* Мелкие серверные настройки                                          */
/* ------------------------------------------------------------------ */

/**
 * Пара «ключ — значение» для того, что не заслуживает своей таблицы:
 * ключ подписи сессий, почта владельца из Google. Заводить под каждую такую
 * величину отдельную таблицу — значит писать миграцию ради одной строки.
 */
const SETTINGS_SCHEMA = `
CREATE TABLE IF NOT EXISTS design_settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;

export async function readSetting(key: string): Promise<string | null> {
  const instance = await getDb();
  if (!instance) return null;
  try {
    instance.exec(SETTINGS_SCHEMA);
    const row = instance.prepare(`SELECT value FROM design_settings WHERE key = ?`).get(key) as
      | { value: string }
      | undefined;
    return row?.value ?? null;
  } catch (e) {
    console.warn(`Проектирование: настройка ${key} не читается:`, (e as Error).message);
    return null;
  }
}

/**
 * Записать настройку. `onlyIfEmpty` нужен там, где место занимается один раз
 * и навсегда: почта владельца именно такая — иначе следующий вошедший через
 * Google просто вытеснил бы предыдущего.
 */
export async function writeSetting(
  key: string,
  value: string,
  opts: { onlyIfEmpty?: boolean } = {},
): Promise<boolean> {
  const instance = await getDb();
  if (!instance) {
    throw new RepositoryError(
      "read-only",
      "Хранилище недоступно, настройку сохранить некуда. Проверьте HOUSE_PROJECTS_DB_PATH и права на каталог.",
    );
  }
  instance.exec(SETTINGS_SCHEMA);
  if (opts.onlyIfEmpty) {
    const existing = instance.prepare(`SELECT 1 FROM design_settings WHERE key = ?`).get(key);
    if (existing) return false;
  }
  instance
    .prepare(
      `INSERT INTO design_settings (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    )
    .run(key, value);
  return true;
}

/**
 * Ошибка репозитория → HTTP-ответ. Один перевод на все роуты: иначе один
 * из них однажды отдаст 500 там, где человеку нужно прочитать «адрес занят».
 */
export function toResponse(e: unknown): Response {
  if (e instanceof RepositoryError) {
    const status =
      e.code === "not-found"
        ? 404
        : e.code === "version-conflict" || e.code === "slug-taken"
          ? 409
          : e.code === "read-only"
            ? 503
            : 422;
    return Response.json(
      { ok: false, reason: e.code, message: e.message, issues: e.issues },
      { status },
    );
  }
  console.error("Проекты CAD: непредвиденная ошибка", e);
  return Response.json({ ok: false, reason: "internal" }, { status: 500 });
}

/** Доступна ли запись. Редактор показывает это состояние, а не молчит. */
export async function storageStatus(): Promise<{ writable: boolean; reason?: string }> {
  const instance = await getDb();
  return instance ? { writable: true } : { writable: false, reason: sqliteError ?? "неизвестно" };
}
