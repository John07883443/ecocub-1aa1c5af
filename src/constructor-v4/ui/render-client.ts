/**
 * Клиент фото-рендеров: старт задачи → опрос прогресса. Без React — тестируется
 * в node. Любой ответ сервера, который не JSON (504 от nginx, HTML-страница
 * ошибки, обрыв), превращается в человеческую фразу, а не в
 * «Unexpected token '<' … is not valid JSON».
 */

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export interface RenderShot {
  id: string;
  prompt: string;
  /** Стадия 2: PNG-снимок 3D с камеры кадра для images/edits (render-plan.ts STAGE2). */
  image?: string;
  /** Пропорции кадра стадии 2: фасад 16:9, вид сверху 3:2. */
  aspect?: "16:9" | "3:2";
}

export interface RenderFrame {
  id: string;
  url?: string | null;
  b64?: string | null;
  error?: string;
  mode?: "edit" | "text";
  fallbackReason?: string;
  ms?: number;
  costRub?: number;
  costEstimated?: boolean;
}

/** Подпись под кадром: как нарисован, сколько ждали и сколько стоил. */
export function frameNote(f: RenderFrame): string {
  const parts: string[] = [];
  if (f.mode === "edit") parts.push("фото по 3D-снимку — геометрия как в 3D");
  else if (f.mode === "text")
    parts.push(
      f.fallbackReason
        ? `по описанию (снимок не принят: ${f.fallbackReason}) — примерно похоже`
        : "по описанию — примерно похоже, точная форма в 3D и на плане",
    );
  if (typeof f.ms === "number") parts.push(`${Math.max(1, Math.round(f.ms / 1000))} с`);
  if (typeof f.costRub === "number")
    parts.push(`${f.costEstimated ? "≈" : ""}${f.costRub.toLocaleString("ru-RU")} ₽`);
  return parts.join(" · ");
}

export interface RenderProgress {
  done: number;
  total: number;
  results: RenderFrame[];
}

/** Человеческое объяснение по коду ответа, когда тело не JSON или без поля error. */
export function humanHttpError(status: number): string {
  if (status === 504 || status === 524)
    return "Сервер не дождался картинок, попробуйте ещё раз через минуту.";
  if (status === 502 || status === 503)
    return "Сервис картинок сейчас недоступен — попробуйте ещё раз чуть позже.";
  if (status === 429) return "Лимит рендеров исчерпан — попробуйте позже.";
  if (status === 413) return "Слишком большой запрос на рендер.";
  if (status === 404) return "Задача рендера не найдена — запустите ещё раз.";
  if (status >= 500) return "На сервере что-то пошло не так — попробуйте ещё раз.";
  return `Не получилось (код ${status}) — попробуйте ещё раз.`;
}

/** Прочитать JSON-ответ безопасно: не JSON → { ok:false, error: человеческая фраза }. */
export async function readJson<T = Record<string, unknown>>(
  r: Response,
): Promise<{ ok: true; status: number; data: T } | { ok: false; status: number; error: string }> {
  let text = "";
  try {
    text = await r.text();
  } catch {
    return { ok: false, status: r.status, error: "Связь оборвалась — попробуйте ещё раз." };
  }
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    return { ok: false, status: r.status, error: humanHttpError(r.ok ? 502 : r.status) };
  }
  if (!r.ok) {
    const msg = (data as { error?: unknown } | null)?.error;
    return {
      ok: false,
      status: r.status,
      error: typeof msg === "string" && msg ? msg : humanHttpError(r.status),
    };
  }
  return { ok: true, status: r.status, data: data as T };
}

const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms));

/**
 * Рендер задачей: POST ?mode=job → jobId, затем GET ?job=… до готовности.
 * onProgress зовётся на каждом опросе (готовые кадры показываются сразу).
 * Бросает Error с человеческим текстом.
 */
export async function runRenderJob(
  api: string,
  shots: RenderShot[],
  opts: {
    session: string;
    fetch?: FetchLike;
    onProgress?: (p: RenderProgress) => void;
    pollMs?: number;
    timeoutMs?: number;
  },
): Promise<RenderProgress> {
  const f: FetchLike = opts.fetch ?? ((u, i) => fetch(u, i));
  const headers = { "Content-Type": "application/json", "X-Pilot-Session": opts.session };
  let start: Response;
  try {
    start = await f(`${api}/render?mode=job`, {
      method: "POST",
      headers,
      body: JSON.stringify({ shots }),
    });
  } catch {
    throw new Error("Сервер пилота не отвечает — проверьте интернет и попробуйте ещё раз.");
  }
  const s = await readJson<{ jobId?: string; total?: number; results?: RenderFrame[] }>(start);
  if (!s.ok) throw new Error(s.error);
  // Старый сервер ответил синхронно — кадры уже в ответе.
  if (!s.data.jobId && Array.isArray(s.data.results)) {
    const p = {
      done: s.data.results.length,
      total: s.data.results.length,
      results: s.data.results,
    };
    opts.onProgress?.(p);
    return p;
  }
  if (!s.data.jobId) throw new Error("Сервер не вернул задачу рендера — попробуйте ещё раз.");
  const total = s.data.total ?? shots.length;
  opts.onProgress?.({ done: 0, total, results: [] });
  const deadline = Date.now() + (opts.timeoutMs ?? 5 * 60_000);
  let failures = 0;
  for (;;) {
    if (Date.now() > deadline)
      throw new Error("Картинки рисуются слишком долго — попробуйте ещё раз позже.");
    await sleep(opts.pollMs ?? 2000);
    let r: Response;
    try {
      r = await f(`${api}/render?job=${encodeURIComponent(s.data.jobId)}`, { headers });
    } catch {
      if (++failures >= 5) throw new Error("Связь с сервером пропала — попробуйте ещё раз.");
      continue;
    }
    const j = await readJson<{
      status?: string;
      done?: number;
      total?: number;
      results?: RenderFrame[];
    }>(r);
    if (!j.ok) {
      // Разовый 502/504 на опросе — не повод бросать задачу.
      if (r.status >= 500 && ++failures < 5) continue;
      throw new Error(j.error);
    }
    failures = 0;
    const p = {
      done: j.data.done ?? 0,
      total: j.data.total ?? total,
      results: j.data.results ?? [],
    };
    opts.onProgress?.(p);
    if (j.data.status === "done") return p;
  }
}

/**
 * Общая задача сервера пилота (design / critic): POST → jobId, затем GET ?job=…
 * до status done/error. Бросает Error с человеческим текстом.
 */
export async function runJob<T>(
  api: string,
  path: string,
  body: unknown,
  opts: {
    session: string;
    fetch?: FetchLike;
    onStage?: (stage: string) => void;
    pollMs?: number;
    timeoutMs?: number;
  },
): Promise<T> {
  const f: FetchLike = opts.fetch ?? ((u, i) => fetch(u, i));
  const headers = { "Content-Type": "application/json", "X-Pilot-Session": opts.session };
  let start: Response;
  try {
    start = await f(`${api}/${path}`, { method: "POST", headers, body: JSON.stringify(body) });
  } catch {
    throw new Error("Сервер пилота не отвечает — проверьте интернет и попробуйте ещё раз.");
  }
  const s = await readJson<{ jobId?: string }>(start);
  if (!s.ok) throw new Error(s.error);
  if (!s.data.jobId) throw new Error("Сервер не вернул задачу — попробуйте ещё раз.");
  const deadline = Date.now() + (opts.timeoutMs ?? 4 * 60_000);
  let failures = 0;
  for (;;) {
    if (Date.now() > deadline)
      throw new Error("Архитектор думает слишком долго — попробуйте ещё раз.");
    await sleep(opts.pollMs ?? 1500);
    let r: Response;
    try {
      r = await f(`${api}/${path}?job=${encodeURIComponent(s.data.jobId)}`, { headers });
    } catch {
      if (++failures >= 5) throw new Error("Связь с сервером пропала — попробуйте ещё раз.");
      continue;
    }
    const j = await readJson<{
      status?: string;
      stage?: string;
      result?: T;
      error?: string | null;
    }>(r);
    if (!j.ok) {
      if (r.status >= 500 && ++failures < 5) continue;
      throw new Error(j.error);
    }
    failures = 0;
    if (j.data.stage) opts.onStage?.(j.data.stage);
    if (j.data.status === "error")
      throw new Error(j.data.error || "Не получилось — попробуйте ещё раз.");
    if (j.data.status === "done") return j.data.result as T;
  }
}
