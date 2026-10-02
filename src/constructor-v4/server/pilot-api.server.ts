/**
 * Серверная часть пилота конструктора v4: чат «Архитектора Льва» (rgrouter),
 * рендеры (rgrouter images), заявка с паспортом (база лидов + Telegram), здоровье.
 *
 * Работает и в маршрутах сайта (/api/pilot/*, боевой VPS), и в локальном
 * scripts/pilot-server.mjs. Все ключи — только из переменных окружения сервера,
 * в браузер не уходят. Нет ключа — ответ с понятной причиной, а не падение:
 * 3D, план, бюджет и паспорт работают без сервера вообще.
 *
 * Переменные: RGROUTER_API_KEY, INWORLD_API_KEY_BASE64, PILOT_TELEGRAM_BOT_TOKEN,
 * PILOT_TELEGRAM_CHAT_ID (запасной вариант — TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID сайта),
 * необязательные: PILOT_VOICE_URL (wss://…/pilot-voice), PILOT_CHAT_MODEL,
 * PILOT_IMAGE_MODEL, PILOT_REALTIME_MODEL (LLM голосовой сессии InWorld), PILOT_RENDER_RUNS,
 * PILOT_RENDER_DAILY_CAP, PILOT_CHAT_PER_SESSION,
 * PILOT_EDIT_MODEL (стадия 2, image-to-image; по умолчанию rg-google-gemini-3.1-flash-image),
 * PILOT_IMAGE_EDITS=0 — аварийный выключатель стадии 2 (тогда всё рисуется по промпту),
 * PILOT_EDIT_RUB_PER_FRAME / PILOT_IMAGE_RUB_PER_FRAME — оценка цены кадра для подписи.
 */

type Env = Record<string, string | undefined>;

export interface PilotResult {
  status: number;
  body: unknown;
}

const env = (): Env => (typeof process !== "undefined" ? process.env : {});
const num = (v: string | undefined, d: number) => (v && Number.isFinite(Number(v)) ? Number(v) : d);

const renderRuns = new Map<string, number>();
const chatCount = new Map<string, number>();
let renderDay = "";
let renderToday = 0;

function cfg() {
  const e = env();
  return {
    rgKey: e.RGROUTER_API_KEY ?? "",
    rgBase: e.RGROUTER_BASE_URL ?? "https://rgrouter.ru/v1",
    inworld: !!e.INWORLD_API_KEY_BASE64,
    voiceUrl: e.PILOT_VOICE_URL ?? "",
    tgToken: e.PILOT_TELEGRAM_BOT_TOKEN || e.TELEGRAM_BOT_TOKEN || "",
    tgChat: e.PILOT_TELEGRAM_CHAT_ID || e.TELEGRAM_CHAT_ID || "",
    chatModel: e.PILOT_CHAT_MODEL ?? "rg-google-gemini-3.8-flash",
    imageModel: e.PILOT_IMAGE_MODEL ?? "rg-gpt-image-2.5",
    editModel: e.PILOT_EDIT_MODEL || "rg-google-gemini-3.1-flash-image",
    imageEdits: e.PILOT_IMAGE_EDITS !== "0",
    editRubPerFrame: num(e.PILOT_EDIT_RUB_PER_FRAME, 5),
    imageRubPerFrame: num(e.PILOT_IMAGE_RUB_PER_FRAME, 3.8),
    realtimeModel: e.PILOT_REALTIME_MODEL ?? "",
    renderRuns: num(e.PILOT_RENDER_RUNS, 2),
    renderDailyCap: num(e.PILOT_RENDER_DAILY_CAP, 150),
    chatPerSession: num(e.PILOT_CHAT_PER_SESSION, 60),
  };
}

export function pilotHealth(opts: { localVoice?: boolean } = {}): PilotResult {
  const c = cfg();
  const voice = c.inworld && (!!c.voiceUrl || !!opts.localVoice);
  return {
    status: 200,
    body: {
      ok: true,
      rgrouter: !!c.rgKey,
      inworld: c.inworld,
      voice,
      voiceUrl: c.voiceUrl || null,
      voiceReason: !c.inworld
        ? "Голос не настроен: нет ключа InWorld на сервере."
        : voice
          ? null
          : "Голос включится, когда на сервере запустят голосовой релей (PILOT_VOICE_URL).",
      telegram: !!(c.tgToken && c.tgChat),
      chatModel: c.chatModel,
      imageModel: c.imageModel,
      editModel: c.editModel,
      imageEdits: c.imageEdits,
      realtimeModel: c.realtimeModel || null,
    },
  };
}

async function rg(path: string, body: unknown): Promise<Record<string, unknown>> {
  const c = cfg();
  const r = await fetch(`${c.rgBase}${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${c.rgKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`rgrouter ${r.status}: ${text.slice(0, 300)}`);
  return JSON.parse(text) as Record<string, unknown>;
}

/** Вызов chat/completions rgrouter (для архитектора-раскладчика и критика). */
export async function rgChat(body: Record<string, unknown>): Promise<Record<string, unknown>> {
  if (!cfg().rgKey) throw new Error("Нет ключа rgrouter на сервере.");
  return rg("/chat/completions", body);
}

/** Модели пилота из окружения (без ключей). */
export function pilotModels() {
  const c = cfg();
  const e = env();
  return {
    chat: c.chatModel,
    layout: e.PILOT_LAYOUT_MODEL || c.chatModel,
    critic: e.PILOT_CRITIC_MODEL || "rg-google-gemini-3.8-flash",
    configured: !!c.rgKey,
  };
}

export async function pilotChat(input: unknown, session: string): Promise<PilotResult> {
  const c = cfg();
  if (!c.rgKey)
    return { status: 503, body: { error: "Чат не настроен: нет ключа rgrouter на сервере." } };
  const used = chatCount.get(session) ?? 0;
  if (used >= c.chatPerSession)
    return {
      status: 429,
      body: {
        error: `Лимит сообщений на сессию: ${c.chatPerSession}. Оставьте заявку — продолжим с проектировщиком.`,
      },
    };
  chatCount.set(session, used + 1);
  const {
    messages = [],
    tools = [],
    system = "",
  } = (input ?? {}) as {
    messages?: unknown[];
    tools?: unknown[];
    system?: string;
  };
  const override = (input as { model?: unknown } | null)?.model;
  const evalOk =
    typeof override === "string" &&
    !!env().PILOT_EVAL_SECRET &&
    (input as { evalSecret?: unknown }).evalSecret === env().PILOT_EVAL_SECRET;
  const out = await rg("/chat/completions", {
    model: evalOk ? override : c.chatModel,
    messages: [
      { role: "system", content: String(system).slice(0, 20_000) },
      ...messages.slice(-30),
    ],
    tools: tools.length ? tools : undefined,
    temperature: 0.4,
  });
  const choices = out.choices as { message?: unknown }[] | undefined;
  return { status: 200, body: { message: choices?.[0]?.message ?? {}, usage: out.usage ?? null } };
}

export type EditAspect = "16:9" | "3:2" | "1:1";
const ASPECTS: EditAspect[] = ["16:9", "3:2", "1:1"];

export type Shot = { id: string; prompt: string; image?: string; aspect?: EditAspect };
export type ShotResult = {
  id: string;
  url?: string | null;
  b64?: string | null;
  error?: string;
  /** edit — фото поверх 3D-снимка (стадия 2), text — по промпту (запасной путь). */
  mode?: "edit" | "text";
  /** Почему стадия 2 не сработала и кадр нарисован по промпту. */
  fallbackReason?: string;
  ms?: number;
  /** Цена кадра в ₽: из usage апстрима, если он её отдал, иначе оценка. */
  costRub?: number;
  costEstimated?: boolean;
};

/** Проверка лимитов и списание одного прогона. null — можно рисовать. */
function takeRenderRun(session: string): PilotResult | null {
  const c = cfg();
  if (!c.rgKey)
    return { status: 503, body: { error: "Рендеры не настроены: нет ключа rgrouter на сервере." } };
  const today = new Date().toISOString().slice(0, 10);
  if (today !== renderDay) {
    renderDay = today;
    renderToday = 0;
  }
  if (renderToday >= c.renderDailyCap)
    return {
      status: 429,
      body: { error: "Дневной лимит рендеров исчерпан — завтра снова можно." },
    };
  const used = renderRuns.get(session) ?? 0;
  if (used >= c.renderRuns)
    return { status: 429, body: { error: `Лимит рендеров на сессию: ${c.renderRuns}.` } };
  renderRuns.set(session, used + 1);
  renderToday++;
  return null;
}

function parseShots(input: unknown): Shot[] {
  const { shots = [] } = (input ?? {}) as { shots?: unknown[] };
  return (Array.isArray(shots) ? shots : [])
    .slice(0, 3)
    .filter((s): s is Shot => !!s && typeof (s as Shot).id === "string")
    .map((s) => ({
      id: String(s.id).slice(0, 60),
      prompt: String(s.prompt ?? "").slice(0, 4000),
      image:
        typeof s.image === "string" &&
        /^data:image\/(png|jpeg|webp);base64,/.test(s.image) &&
        s.image.length < 6_000_000
          ? s.image
          : undefined,
      aspect: ASPECTS.includes((s as Shot).aspect as EditAspect)
        ? ((s as Shot).aspect as EditAspect)
        : undefined,
    }));
}

/** data:image/...;base64 → Blob (Node 18+ и браузер). null — не картинка. */
export function dataUrlToBlob(dataUrl: string): Blob | null {
  const m = dataUrl.match(/^data:(image\/(?:png|jpeg|webp));base64,(.+)$/);
  if (!m) return null;
  const bin =
    typeof Buffer !== "undefined"
      ? Uint8Array.from(Buffer.from(m[2], "base64"))
      : Uint8Array.from(atob(m[2]), (ch) => ch.charCodeAt(0));
  return new Blob([bin], { type: m[1] });
}

/**
 * Multipart-тело для rgrouter POST /v1/images/edits (проверено 02.10.2026 с VPS):
 * model, prompt, image (PNG), aspect_ratio, resolution=1K, response_format=b64_json.
 */
export function buildEditForm(s: Shot, model: string): FormData | null {
  if (!s.image) return null;
  const blob = dataUrlToBlob(s.image);
  if (!blob) return null;
  const ext = blob.type === "image/jpeg" ? "jpg" : blob.type === "image/webp" ? "webp" : "png";
  const form = new FormData();
  form.set("model", model);
  form.set("prompt", s.prompt);
  form.set("image", blob, `massing.${ext}`);
  form.set("aspect_ratio", s.aspect ?? "16:9");
  form.set("resolution", "1K");
  form.set("response_format", "b64_json");
  return form;
}

type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

/** Цена из usage апстрима, если он её прислал (разные роутеры кладут по-разному). */
function usageCost(usage: unknown): number | null {
  if (!usage || typeof usage !== "object") return null;
  const u = usage as Record<string, unknown>;
  for (const k of ["cost_rub", "cost", "total_cost"]) {
    const v = Number(u[k]);
    if (Number.isFinite(v) && v > 0) return Math.round(v * 100) / 100;
  }
  return null;
}

const firstImage = (out: { data?: { url?: string; b64_json?: string }[] }) => {
  const d = out.data?.[0] ?? {};
  return { url: d.url ?? null, b64: d.b64_json ?? null };
};

/**
 * Стадия 2: фото поверх 3D-снимка через /images/edits. Включена по умолчанию,
 * PILOT_IMAGE_EDITS=0 — выключатель. Ошибка → { fail }, вызывающий рисует по промпту.
 */
async function renderEdit(
  s: Shot,
  f: Fetch,
): Promise<{ ok: ShotResult } | { fail: string } | null> {
  const c = cfg();
  if (!c.imageEdits || !s.image) return null;
  const form = buildEditForm(s, c.editModel);
  if (!form) return { fail: "снимок 3D не распознан" };
  const t0 = Date.now();
  try {
    const r = await f(`${c.rgBase}/images/edits`, {
      method: "POST",
      headers: { Authorization: `Bearer ${c.rgKey}` },
      body: form,
    });
    if (!r.ok) return { fail: `images/edits ${r.status}` };
    const out = (await r.json()) as {
      data?: { url?: string; b64_json?: string }[];
      usage?: unknown;
    };
    const img = firstImage(out);
    if (!img.url && !img.b64) return { fail: "images/edits без картинки" };
    const cost = usageCost(out.usage);
    return {
      ok: {
        id: s.id,
        ...img,
        mode: "edit",
        ms: Date.now() - t0,
        costRub: cost ?? c.editRubPerFrame,
        costEstimated: cost === null,
      },
    };
  } catch (e) {
    return { fail: `images/edits: ${String((e as Error).message ?? e).slice(0, 120)}` };
  }
}

/** Кадр: сначала стадия 2 по снимку, при любой её ошибке — по промпту. fetch подменяется в тестах. */
export async function renderShot(s: Shot, f: Fetch = (u, i) => fetch(u, i)): Promise<ShotResult> {
  const c = cfg();
  const edited = await renderEdit(s, f);
  if (edited && "ok" in edited) return edited.ok;
  const fallbackReason = edited && "fail" in edited ? edited.fail : undefined;
  const t0 = Date.now();
  try {
    const r = await f(`${c.rgBase}/images/generations`, {
      method: "POST",
      headers: { Authorization: `Bearer ${c.rgKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: c.imageModel, prompt: s.prompt, size: "1536x1024", n: 1 }),
    });
    const text = await r.text();
    if (!r.ok) throw new Error(`rgrouter ${r.status}: ${text.slice(0, 300)}`);
    const out = JSON.parse(text) as {
      data?: { url?: string; b64_json?: string }[];
      usage?: unknown;
    };
    const cost = usageCost(out.usage);
    return {
      id: s.id,
      ...firstImage(out),
      mode: "text",
      ...(fallbackReason ? { fallbackReason } : {}),
      ms: Date.now() - t0,
      costRub: cost ?? c.imageRubPerFrame,
      costEstimated: cost === null,
    };
  } catch (e) {
    return {
      id: s.id,
      error: String((e as Error).message ?? e),
      ...(fallbackReason ? { fallbackReason } : {}),
    };
  }
}

/** Синхронный рендер (старый контракт, scripts/pilot-server.mjs и обратная совместимость). */
export async function pilotRender(input: unknown, session: string): Promise<PilotResult> {
  const denied = takeRenderRun(session);
  if (denied) return denied;
  const c = cfg();
  const results = await Promise.all(parseShots(input).map((s) => renderShot(s)));
  return {
    status: 200,
    body: { results, runsLeft: Math.max(0, c.renderRuns - (renderRuns.get(session) ?? 0)) },
  };
}

// ── Рендер задачей: старт → jobId сразу, клиент опрашивает. Ни один запрос не ждёт > 60 с nginx. ──

export interface RenderJob {
  id: string;
  session: string;
  status: "running" | "done";
  total: number;
  done: number;
  results: ShotResult[];
  createdAt: number;
  runsLeft: number;
}

/** Задачи в памяти процесса (один инстанс pm2), живут 15 минут. */
const renderJobs = new Map<string, RenderJob>();
export const RENDER_JOB_TTL_MS = 15 * 60_000;

function sweepJobs(now = Date.now()) {
  for (const [id, j] of renderJobs)
    if (now - j.createdAt > RENDER_JOB_TTL_MS) renderJobs.delete(id);
}

/** Запустить рендер задачей. render — подменяется в тестах. */
export function pilotRenderStart(
  input: unknown,
  session: string,
  render: (s: Shot) => Promise<ShotResult> = (s) => renderShot(s),
): PilotResult {
  sweepJobs();
  const shots = parseShots(input);
  if (!shots.length) return { status: 400, body: { error: "Нет кадров для рендера." } };
  const denied = takeRenderRun(session);
  if (denied) return denied;
  const id = `r${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  const job: RenderJob = {
    id,
    session,
    status: "running",
    total: shots.length,
    done: 0,
    results: [],
    createdAt: Date.now(),
    runsLeft: Math.max(0, cfg().renderRuns - (renderRuns.get(session) ?? 0)),
  };
  renderJobs.set(id, job);
  // Кадры по одному: прогресс «рисуем 1 из 3…» честный, апстрим не душим параллелью.
  void (async () => {
    for (const s of shots) {
      const r = await render(s).catch((e) => ({ id: s.id, error: String(e?.message ?? e) }));
      job.results.push(r);
      job.done++;
    }
    job.status = "done";
  })();
  return { status: 202, body: { jobId: id, total: job.total, runsLeft: job.runsLeft } };
}

/** Состояние задачи рендера. Готовые кадры отдаются сразу, не дожидаясь остальных. */
export function pilotRenderStatus(jobId: string, session?: string): PilotResult {
  sweepJobs();
  const j = renderJobs.get(jobId);
  if (!j || (session && j.session !== session && j.session !== "anon"))
    return {
      status: 404,
      body: { error: "Задача рендера не найдена или устарела — запустите ещё раз." },
    };
  return {
    status: 200,
    body: {
      jobId: j.id,
      status: j.status,
      done: j.done,
      total: j.total,
      results: j.results,
      runsLeft: j.runsLeft,
    },
  };
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Заявка: Telegram (сообщение + JSON паспорта файлом) и, если передан, сохранение в базу лидов. */
export async function pilotLead(
  input: unknown,
  saveLead?: (lead: {
    formType: string;
    name: string;
    phone: string;
    message: string | null;
    sourcePage: string;
    payload: unknown;
  }) => Promise<boolean>,
): Promise<PilotResult> {
  const c = cfg();
  const {
    name = "",
    phone = "",
    comment = "",
    summary = "",
    passport = null,
  } = (input ?? {}) as Record<string, unknown>;
  const n = String(name).slice(0, 100).trim();
  const ph = String(phone).slice(0, 30).trim();
  if (n.length < 2 && ph.length < 5)
    return { status: 400, body: { error: "Нужны имя или телефон." } };
  const stored = saveLead
    ? await saveLead({
        formType: "constructor-v4",
        name: n,
        phone: ph,
        message:
          [String(comment), String(summary)].filter(Boolean).join("\n\n").slice(0, 4000) || null,
        sourcePage: "/constructor",
        payload: passport,
      }).catch(() => false)
    : false;
  let notified = false;
  if (c.tgToken && c.tgChat) {
    try {
      const text = [
        "<b>Заявка из конструктора v4 (бета)</b>",
        `Имя: ${esc(n)}`,
        `Телефон: ${esc(ph)}`,
        comment ? `Комментарий: ${esc(String(comment).slice(0, 500))}` : "",
        "",
        esc(String(summary)).slice(0, 3000),
      ]
        .filter((x) => x !== "")
        .join("\n");
      const f1 = new FormData();
      f1.set("chat_id", c.tgChat);
      f1.set("text", text);
      f1.set("parse_mode", "HTML");
      const r1 = await fetch(`https://api.telegram.org/bot${c.tgToken}/sendMessage`, {
        method: "POST",
        body: f1,
      });
      notified = r1.ok;
      if (passport) {
        const f2 = new FormData();
        f2.set("chat_id", c.tgChat);
        f2.set("caption", "Паспорт проекта (JSON) — для проектировщика");
        f2.set(
          "document",
          new Blob([JSON.stringify(passport, null, 2)], { type: "application/json" }),
          `passport-${Date.now()}.json`,
        );
        await fetch(`https://api.telegram.org/bot${c.tgToken}/sendDocument`, {
          method: "POST",
          body: f2,
        });
      }
    } catch {
      notified = false;
    }
  }
  if (!stored && !notified)
    return {
      status: c.tgToken ? 502 : 503,
      body: {
        error: c.tgToken
          ? "Не удалось отправить заявку — попробуйте ещё раз."
          : "Заявки не настроены: нет Telegram на сервере.",
      },
    };
  return { status: 200, body: { ok: true, stored, notified } };
}
