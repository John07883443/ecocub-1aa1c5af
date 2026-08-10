/**
 * Хранилище готовых планировок. Только сервер.
 *
 * Провайдер может вернуть картинку двумя способами: ссылкой на свой CDN или
 * байтами в теле ответа. Второй случай требует места, но он же и надёжнее:
 * чужая ссылка однажды протухнет вместе с чужим хранилищем, а планировка
 * должна открываться и через год — посетитель мог сохранить её себе или
 * прислать вместе с заявкой.
 *
 * Поэтому байты кладём рядом с базой заявок, за пределами каталога деплоя:
 * deploy.sh тасует .output и .output.prev, и всё, что лежит внутри, однажды
 * уедет вместе с откатом.
 */

import { isPng } from "./png.ts";

/** Ограничение сверху: планировка 1024×1024 в PNG весит около мегабайта. */
const MAX_BYTES = 8 * 1024 * 1024;

function baseDir(): string {
  const db = process.env.LEADS_DB_PATH || "/var/lib/ecocub/leads.db";
  const dir = db.replace(/\/[^/]*$/, "");
  return `${dir}/ai-layout`;
}

/** Ключ задания — hex-строка, но проверяем: из него собирается путь к файлу. */
function safeKey(key: string): string | null {
  return /^[a-f0-9]{8,64}$/.test(key) ? key : null;
}

/**
 * Сохранить картинку. Возвращает адрес, по которому её отдаёт сайт, или null,
 * если сохранить не удалось — тогда вызывающий покажет отказ, а не битую
 * ссылку.
 */
export async function saveImage(key: string, bytes: Uint8Array): Promise<string | null> {
  const safe = safeKey(key);
  if (!safe) return null;
  if (!bytes.length || bytes.length > MAX_BYTES) return null;
  // Принимаем только PNG: тип приходит от провайдера, а раздаём мы его сами.
  if (!isPng(bytes)) return null;

  try {
    const { mkdirSync, writeFileSync } = await import("node:fs");
    const dir = baseDir();
    mkdirSync(dir, { recursive: true });
    writeFileSync(`${dir}/${safe}.png`, bytes);
    return `/api/ai-layout/result?key=${safe}`;
  } catch (e) {
    console.error("AI-планировка: не удалось сохранить картинку:", (e as Error).message);
    return null;
  }
}

/** Прочитать сохранённую картинку. */
export async function readImage(key: string): Promise<Uint8Array | null> {
  const safe = safeKey(key);
  if (!safe) return null;
  try {
    const { readFileSync } = await import("node:fs");
    return new Uint8Array(readFileSync(`${baseDir()}/${safe}.png`));
  } catch {
    return null;
  }
}
