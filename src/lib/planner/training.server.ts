/**
 * Хранилище отметок обучения. Только сервер.
 *
 * Рядом с базой заявок, в той же SQLite: отдельная база ради одной таблицы —
 * лишняя сущность в бэкапах и в правах доступа.
 *
 * Персональных данных здесь нет по построению: сохраняются форма дома,
 * признаки планировки и вердикт «годится / не годится». Ни имени, ни адреса,
 * ни IP — размечает владелец, а не посетитель, и учитывать его незачем.
 */

const SCHEMA = `
CREATE TABLE IF NOT EXISTS planner_verdicts (
  case_id     TEXT NOT NULL,
  run         TEXT NOT NULL,
  approved    INTEGER NOT NULL,
  reasons     TEXT NOT NULL DEFAULT '',
  features    TEXT NOT NULL DEFAULT '',
  note        TEXT NOT NULL DEFAULT '',
  created_at  TEXT NOT NULL,
  PRIMARY KEY (case_id, run)
);
`;

export interface Verdict {
  caseId: string;
  run: string;
  approved: boolean;
  reasons: string[];
  features: string[];
  note?: string;
}

type Row = Record<string, unknown>;
type Db = {
  exec: (sql: string) => void;
  prepare: (sql: string) => {
    run: (...p: unknown[]) => unknown;
    all: (...p: unknown[]) => Row[];
  };
};

let db: Db | null = null;
let unavailable = false;
/** Запасное хранилище: без SQLite разметка не должна падать, просто не переживёт перезапуск. */
const memory = new Map<string, Verdict>();

async function getDb(): Promise<Db | null> {
  if (db) return db;
  if (unavailable) return null;
  try {
    const { DatabaseSync } = await import("node:sqlite");
    const { mkdirSync } = await import("node:fs");
    const { dirname } = await import("node:path");
    const path = process.env.LEADS_DB_PATH || "/var/lib/ecocub/leads.db";
    mkdirSync(dirname(path), { recursive: true });
    const instance = new DatabaseSync(path) as unknown as Db;
    instance.exec("PRAGMA journal_mode = WAL");
    instance.exec(SCHEMA);
    db = instance;
    return db;
  } catch (e) {
    unavailable = true;
    console.warn("Обучение планировщика: SQLite недоступен:", (e as Error).message);
    return null;
  }
}

export async function saveVerdict(v: Verdict): Promise<void> {
  const database = await getDb();
  const at = new Date().toISOString();
  if (!database) {
    memory.set(`${v.run}|${v.caseId}`, v);
    return;
  }
  database
    .prepare(
      `INSERT INTO planner_verdicts (case_id, run, approved, reasons, features, note, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(case_id, run) DO UPDATE SET
         approved = excluded.approved,
         reasons = excluded.reasons,
         features = excluded.features,
         note = excluded.note,
         created_at = excluded.created_at`,
    )
    .run(
      v.caseId,
      v.run,
      v.approved ? 1 : 0,
      v.reasons.join(","),
      v.features.join(","),
      (v.note ?? "").slice(0, 500),
      at,
    );
}

export async function listVerdicts(run?: string): Promise<Verdict[]> {
  const database = await getDb();
  if (!database) {
    return [...memory.values()].filter((v) => !run || v.run === run);
  }
  const rows = run
    ? database.prepare("SELECT * FROM planner_verdicts WHERE run = ?").all(run)
    : database.prepare("SELECT * FROM planner_verdicts").all();
  return rows.map((r) => ({
    caseId: String(r.case_id),
    run: String(r.run),
    approved: Boolean(r.approved),
    reasons: String(r.reasons ?? "")
      .split(",")
      .filter(Boolean),
    features: String(r.features ?? "")
      .split(",")
      .filter(Boolean),
    note: String(r.note ?? ""),
  }));
}
