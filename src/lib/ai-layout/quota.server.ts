/**
 * Учёт генераций планировки: кто сколько потратил и что уже сгенерировано.
 * Только сервер.
 *
 * Хранилище — тот же SQLite, что и у заявок (node:sqlite, без зависимостей),
 * отдельной таблицей. Если SQLite недоступен, учёт ведётся в памяти процесса:
 * это хуже, но лимит продолжает работать, а не отключается вместе с базой.
 *
 * Сырой IP не хранится. В базу идёт HMAC-SHA256 от нормализованного адреса с
 * серверной солью: этого достаточно, чтобы отличить одного посетителя от
 * другого и посчитать бесплатные попытки, но по содержимому базы восстановить
 * адрес нельзя.
 */

import { createHash, createHmac } from "node:crypto";

export interface JobRecord {
  key: string;
  visitor: string;
  status: "pending" | "completed" | "failed" | "queued_manual";
  provider: string;
  imageUrl: string | null;
  externalId: string | null;
  isMock: boolean;
  reason: string | null;
  createdAt: string;
  /** Снимок запроса: по нему восстанавливается исходник и промпт. */
  payload: string;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS ai_layout_jobs (
  key         TEXT PRIMARY KEY,
  visitor     TEXT NOT NULL,
  status      TEXT NOT NULL,
  provider    TEXT NOT NULL,
  image_url   TEXT,
  external_id TEXT,
  is_mock     INTEGER NOT NULL DEFAULT 0,
  reason      TEXT,
  created_at  TEXT NOT NULL,
  payload     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ai_layout_visitor ON ai_layout_jobs (visitor);
CREATE INDEX IF NOT EXISTS idx_ai_layout_created ON ai_layout_jobs (created_at);
`;

/* ------------------------------------------------------------------ */
/* Опознание посетителя                                                */
/* ------------------------------------------------------------------ */

/**
 * Нормализация адреса перед хешированием. У IPv6 отбрасывается всё после
 * префикса /64: провайдеры раздают клиенту целую подсеть, и без этого один
 * человек получал бы неограниченное число «бесплатных первых» генераций,
 * просто меняя младшие разряды адреса.
 */
export function normalizeIp(raw: string): string {
  let ip = raw.trim().toLowerCase();
  if (ip.startsWith("::ffff:")) ip = ip.slice(7);
  // [2001:db8::1]:443 → 2001:db8::1
  if (ip.startsWith("[")) ip = ip.slice(1, ip.indexOf("]") > 0 ? ip.indexOf("]") : undefined);
  else if (ip.split(":").length === 2) ip = ip.split(":")[0];

  if (ip.includes(":")) {
    const groups = ip.split(":");
    return groups.slice(0, 4).join(":");
  }
  return ip;
}

/** Устойчивый и необратимый идентификатор посетителя. */
export function visitorHash(ip: string, secret: string): string {
  return createHmac("sha256", secret).update(normalizeIp(ip)).digest("hex").slice(0, 32);
}

/**
 * Адрес клиента. За nginx реальный IP приходит заголовком, поэтому берём
 * первый элемент X-Forwarded-For — последующие подставляются прокси и
 * доверия не заслуживают.
 */
export function clientIp(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return headers.get("x-real-ip")?.trim() || "";
}

/** Ключ идемпотентности: одинаковый запрос — одинаковый ключ. */
export function jobKey(source: string, visitor: string): string {
  return createHash("sha256").update(`${visitor}|${source}`).digest("hex").slice(0, 40);
}

/* ------------------------------------------------------------------ */
/* Хранилище                                                           */
/* ------------------------------------------------------------------ */

type Row = Record<string, unknown>;
type Db = {
  prepare: (sql: string) => {
    run: (...p: unknown[]) => unknown;
    get: (...p: unknown[]) => Row | undefined;
    all: (...p: unknown[]) => Row[];
  };
};

let db: Db | null = null;
let sqliteUnavailable = false;
/** Запасное хранилище на случай недоступного SQLite. */
const memory = new Map<string, JobRecord>();

function dbPath(): string {
  return process.env.LEADS_DB_PATH || "/var/lib/ecocub/leads.db";
}

async function getDb(): Promise<Db | null> {
  if (db) return db;
  if (sqliteUnavailable) return null;
  try {
    const { DatabaseSync } = await import("node:sqlite");
    const { mkdirSync } = await import("node:fs");
    const { dirname } = await import("node:path");
    const path = dbPath();
    mkdirSync(dirname(path), { recursive: true });
    const instance = new DatabaseSync(path) as unknown as Db & { exec: (s: string) => void };
    instance.exec("PRAGMA journal_mode = WAL");
    instance.exec(SCHEMA);
    db = instance;
    return db;
  } catch (e) {
    sqliteUnavailable = true;
    console.warn("AI-планировка: SQLite недоступен, учёт в памяти:", (e as Error).message);
    return null;
  }
}

function toRecord(row: Row): JobRecord {
  return {
    key: String(row.key),
    visitor: String(row.visitor),
    status: row.status as JobRecord["status"],
    provider: String(row.provider),
    imageUrl: (row.image_url as string) ?? null,
    externalId: (row.external_id as string) ?? null,
    isMock: Boolean(row.is_mock),
    reason: (row.reason as string) ?? null,
    createdAt: String(row.created_at),
    payload: String(row.payload),
  };
}

export async function findJob(key: string): Promise<JobRecord | null> {
  const database = await getDb();
  if (!database) return memory.get(key) ?? null;
  try {
    const row = database.prepare("SELECT * FROM ai_layout_jobs WHERE key = ?").get(key);
    return row ? toRecord(row) : null;
  } catch {
    return memory.get(key) ?? null;
  }
}

export async function saveJob(record: JobRecord): Promise<void> {
  memory.set(record.key, record);
  const database = await getDb();
  if (!database) return;
  try {
    database
      .prepare(
        `INSERT INTO ai_layout_jobs
           (key, visitor, status, provider, image_url, external_id, is_mock, reason, created_at, payload)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET
           status = excluded.status,
           image_url = excluded.image_url,
           external_id = excluded.external_id,
           reason = excluded.reason`,
      )
      .run(
        record.key,
        record.visitor,
        record.status,
        record.provider,
        record.imageUrl,
        record.externalId,
        record.isMock ? 1 : 0,
        record.reason,
        record.createdAt,
        record.payload,
      );
  } catch (e) {
    console.error("AI-планировка: запись не удалась:", (e as Error).message);
  }
}

/**
 * Сколько генераций посетитель уже потратил. Неудачные не считаются: если
 * провайдер упал, бесплатная попытка человека сгорать не должна.
 */
export async function visitorSpent(visitor: string): Promise<number> {
  const database = await getDb();
  if (!database) {
    return [...memory.values()].filter((j) => j.visitor === visitor && j.status !== "failed")
      .length;
  }
  try {
    const row = database
      .prepare("SELECT COUNT(*) AS n FROM ai_layout_jobs WHERE visitor = ? AND status != 'failed'")
      .get(visitor);
    return Number(row?.n ?? 0);
  } catch {
    return 0;
  }
}

/** Сколько генераций ушло за сегодня по всем посетителям. */
export async function spentToday(now = new Date()): Promise<number> {
  const day = now.toISOString().slice(0, 10);
  const database = await getDb();
  if (!database) {
    return [...memory.values()].filter((j) => j.createdAt.startsWith(day) && j.status !== "failed")
      .length;
  }
  try {
    const row = database
      .prepare(
        "SELECT COUNT(*) AS n FROM ai_layout_jobs WHERE created_at LIKE ? AND status != 'failed'",
      )
      .get(`${day}%`);
    return Number(row?.n ?? 0);
  } catch {
    return 0;
  }
}
