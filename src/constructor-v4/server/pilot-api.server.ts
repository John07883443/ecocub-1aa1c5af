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
 * PILOT_IMAGE_MODEL, PILOT_RENDER_RUNS, PILOT_RENDER_DAILY_CAP, PILOT_CHAT_PER_SESSION.
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
  const out = await rg("/chat/completions", {
    model: c.chatModel,
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

export async function pilotRender(input: unknown, session: string): Promise<PilotResult> {
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
  const { shots = [] } = (input ?? {}) as { shots?: { id: string; prompt: string }[] };
  const results = await Promise.all(
    shots.slice(0, 3).map(async (s) => {
      try {
        const out = await rg("/images/generations", {
          model: c.imageModel,
          prompt: String(s.prompt).slice(0, 4000),
          size: "1536x1024",
          n: 1,
        });
        const d = (out.data as { url?: string; b64_json?: string }[] | undefined)?.[0] ?? {};
        return { id: s.id, url: d.url ?? null, b64: d.b64_json ?? null };
      } catch (e) {
        return { id: s.id, error: String((e as Error).message ?? e) };
      }
    }),
  );
  return { status: 200, body: { results, runsLeft: c.renderRuns - used - 1 } };
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
