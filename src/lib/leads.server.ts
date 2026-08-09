/**
 * Хранилище заявок. Только сервер.
 *
 * База — SQLite-файл на диске VPS, встроенный модуль node:sqlite: ни одной
 * внешней зависимости, ни одного нативного модуля для сборки, отдельного
 * процесса СУБД нет. При нагрузке в единицы заявок в день этого достаточно
 * с запасом, а памяти у сервера всего 2 ГБ и она нужна сборке.
 *
 * ВАЖНО про размещение файла. Путь задаётся переменной LEADS_DB_PATH и должен
 * указывать ЗА пределы каталога деплоя. deploy.sh тасует .output и .output.prev,
 * поэтому база, положенная рядом с приложением, однажды уедет вместе с откатом
 * или будет затёрта новой сборкой — вместе со всеми заявками. Значение по
 * умолчанию /var/lib/ecocub/leads.db выбрано именно из этого соображения.
 *
 * Запасной путь. node:sqlite появился в Node 22.5, и на более старых версиях
 * модуля просто нет. Терять заявку из-за версии рантайма недопустимо, поэтому
 * при недоступности SQLite запись уходит строкой JSON в соседний .jsonl —
 * формат, который не может быть недоступен. scripts/leads-export.mjs читает
 * оба источника, так что выгрузка работает в любом случае.
 */

export type LeadInput = {
  formType: string;
  name: string;
  phone: string;
  email?: string | null;
  message?: string | null;
  projectSlug?: string | null;
  sourcePage?: string | null;
  payload?: unknown;
};

/** Типы форм на сайте. Всё, чего нет в списке, записывается как 'other'. */
const FORM_TYPES = ["contact", "project", "presentation", "callback", "quiz"] as const;

const DEFAULT_DB_PATH = "/var/lib/ecocub/leads.db";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS leads (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at   TEXT NOT NULL,
  form_type    TEXT NOT NULL,
  name         TEXT NOT NULL,
  phone        TEXT NOT NULL,
  email        TEXT,
  message      TEXT,
  project_slug TEXT,
  source_page  TEXT,
  payload      TEXT,
  status       TEXT NOT NULL DEFAULT 'new'
);
CREATE INDEX IF NOT EXISTS idx_leads_created_at ON leads (created_at DESC);
`;

/* ------------------------------------------------------------------ */
/* Нормализация                                                        */
/* ------------------------------------------------------------------ */

function clamp(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

/**
 * Раньше границы полей проверяла RLS-политика в Supabase. Базы больше нет,
 * значит те же проверки должны жить здесь — иначе форма из браузера сможет
 * положить в базу что угодно любой длины.
 */
export function normalizeLead(input: LeadInput): {
  ok: boolean;
  reason?: string;
  lead?: Required<Omit<LeadInput, "payload">> & { payload: string | null; createdAt: string };
} {
  const name = clamp(input.name, 100);
  const phone = clamp(input.phone, 30);

  if (!name || name.length < 2) return { ok: false, reason: "invalid_name" };
  if (!phone || phone.length < 5) return { ok: false, reason: "invalid_phone" };

  const formType = (FORM_TYPES as readonly string[]).includes(input.formType)
    ? input.formType
    : "other";

  let payload: string | null = null;
  if (input.payload && typeof input.payload === "object") {
    try {
      // Ограничение сверху: payload приходит из браузера и в него собирается
      // вся аналитика визита. Разросшееся поле не должно раздувать базу.
      payload = JSON.stringify(input.payload).slice(0, 8000);
    } catch {
      payload = null;
    }
  }

  return {
    ok: true,
    lead: {
      formType,
      name,
      phone,
      email: clamp(input.email, 200),
      message: clamp(input.message, 2000),
      projectSlug: clamp(input.projectSlug, 100),
      sourcePage: clamp(input.sourcePage, 200),
      payload,
      createdAt: new Date().toISOString(),
    },
  };
}

/* ------------------------------------------------------------------ */
/* Запись                                                              */
/* ------------------------------------------------------------------ */

type Db = { prepare: (sql: string) => { run: (...params: unknown[]) => unknown } };

let db: Db | null = null;
let sqliteUnavailable = false;

function dbPath(): string {
  return process.env.LEADS_DB_PATH || DEFAULT_DB_PATH;
}

async function ensureDir(path: string): Promise<void> {
  const { mkdirSync } = await import("node:fs");
  const { dirname } = await import("node:path");
  mkdirSync(dirname(path), { recursive: true });
}

async function getDb(): Promise<Db | null> {
  if (db) return db;
  if (sqliteUnavailable) return null;

  try {
    const { DatabaseSync } = await import("node:sqlite");
    const path = dbPath();
    await ensureDir(path);
    const instance = new DatabaseSync(path) as unknown as Db & { exec: (sql: string) => void };
    // WAL обязателен: сайт пишет заявки непрерывно, а выгрузка читает базу
    // параллельно. В журнальном режиме по умолчанию читатель натыкается на
    // незакрытый журнал и не может открыть базу вовсе — выгрузка молча
    // возвращала бы пустоту. В WAL читатель и писатель не мешают друг другу.
    instance.exec("PRAGMA journal_mode = WAL");
    instance.exec(SCHEMA);
    db = instance;
    return db;
  } catch (e) {
    // Один раз запоминаем недоступность, чтобы не пытаться открыть базу
    // на каждой заявке и не сыпать одинаковыми ошибками в лог.
    sqliteUnavailable = true;
    console.warn("Заявки: SQLite недоступен, переключаюсь на JSONL:", (e as Error).message);
    return null;
  }
}

/**
 * Сохраняет заявку. Возвращает true, если запись легла на диск.
 * Исключений не бросает: отвалившееся хранилище не должно ронять форму,
 * пока у заявки есть второй путь — уведомление в Telegram.
 */
export async function saveLead(input: LeadInput): Promise<boolean> {
  const normalized = normalizeLead(input);
  if (!normalized.ok || !normalized.lead) return false;
  const lead = normalized.lead;

  const database = await getDb();
  if (database) {
    try {
      database
        .prepare(
          `INSERT INTO leads
             (created_at, form_type, name, phone, email, message, project_slug, source_page, payload, status)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'new')`,
        )
        .run(
          lead.createdAt,
          lead.formType,
          lead.name,
          lead.phone,
          lead.email,
          lead.message,
          lead.projectSlug,
          lead.sourcePage,
          lead.payload,
        );
      return true;
    } catch (e) {
      console.error("Заявки: запись в SQLite не удалась:", (e as Error).message);
      // Проваливаемся в JSONL — заявка важнее выбранного формата хранения.
    }
  }

  try {
    const { appendFileSync } = await import("node:fs");
    const path = dbPath().replace(/\.db$/, "") + ".jsonl";
    await ensureDir(path);
    appendFileSync(path, JSON.stringify(lead) + "\n", "utf8");
    return true;
  } catch (e) {
    console.error("Заявки: запись в JSONL не удалась:", (e as Error).message);
    return false;
  }
}
