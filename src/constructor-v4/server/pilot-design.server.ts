/**
 * Нейросеть-архитектор и независимый критик — серверная часть.
 *
 * 1. designLayout: модель раскладывает кубики (propose_layout) → движок правил
 *    проверяет → нарушения уходят на исправление (до 3 попыток) → не вышло —
 *    честный откат на солвер.
 * 2. criticReview: модель зрения смотрит на картинку плана (и 3D-снимок, если
 *    есть) по чек-листу и возвращает правки командами редактора; клиент
 *    применяет их через тот же движок правил.
 * Обе задачи долгие — запускаются задачей (jobId сразу, клиент опрашивает),
 * чтобы ни один запрос не упирался в таймаут nginx.
 */
import {
  checkLayout,
  layoutSystemPrompt,
  LAYOUT_TOOL,
  repairMessage,
  solverFallback,
} from "../engine/llm-layout.ts";
import type { LayoutCheck } from "../engine/llm-layout.ts";
import { knowledgeFor, mentionsPrecedent } from "../engine/knowledge.ts";
import { parseCommand, type EditorCommand } from "../engine/commands.ts";
import { planSvgString } from "../engine/plan-svg.ts";
import { houseStyleBrief } from "../engine/house-style.ts";
import { buildPassport } from "../engine/passport.ts";
import type { Brief, Project } from "../engine/types.ts";
import { pilotModels, rgChat, type PilotResult } from "./pilot-api.server.ts";

type Chat = (body: Record<string, unknown>) => Promise<Record<string, unknown>>;

// ── Задачи в памяти (один инстанс), TTL 15 минут ─────────────────────────

interface Job {
  id: string;
  session: string;
  kind: string;
  status: "running" | "done" | "error";
  stage: string;
  result?: unknown;
  error?: string;
  createdAt: number;
}
const jobs = new Map<string, Job>();
const TTL = 15 * 60_000;
const perSession = new Map<string, number>();
const MAX_JOBS_PER_SESSION = 24;

function sweep(now = Date.now()) {
  for (const [id, j] of jobs) if (now - j.createdAt > TTL) jobs.delete(id);
}

export function startJob(
  session: string,
  kind: string,
  run: (report: (stage: string) => void) => Promise<unknown>,
): PilotResult {
  sweep();
  const used = perSession.get(session) ?? 0;
  if (used >= MAX_JOBS_PER_SESSION)
    return { status: 429, body: { error: "Лимит запросов к архитектору на сессию исчерпан." } };
  perSession.set(session, used + 1);
  const id = `${kind[0]}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  const job: Job = { id, session, kind, status: "running", stage: "старт", createdAt: Date.now() };
  jobs.set(id, job);
  void run((stage) => (job.stage = stage))
    .then((r) => {
      job.result = r;
      job.status = "done";
    })
    .catch((e) => {
      job.error = String((e as Error)?.message ?? e).slice(0, 300);
      job.status = "error";
    });
  return { status: 202, body: { jobId: id } };
}

export function jobStatus(id: string, session?: string): PilotResult {
  sweep();
  const j = jobs.get(id);
  if (!j || (session && j.session !== session && j.session !== "anon"))
    return { status: 404, body: { error: "Задача не найдена или устарела — запустите ещё раз." } };
  return {
    status: 200,
    body: {
      jobId: j.id,
      status: j.status,
      stage: j.stage,
      result: j.result ?? null,
      error: j.error ?? null,
    },
  };
}

// ── Нейросеть-архитектор ───────────────────────────────────────────────

export interface DesignResult {
  intent: string;
  project: Project | null;
  valid: boolean;
  attempts: number;
  fallback: boolean;
  precedent: string;
  why: string;
  violations: string[];
  latencyMs: number;
  tokens: number;
  model: string;
  precedentMentioned: boolean;
}

function toolArgs(out: Record<string, unknown>): {
  raw: unknown;
  message: Record<string, unknown>;
} {
  const msg = ((out.choices as { message?: Record<string, unknown> }[] | undefined)?.[0]?.message ??
    {}) as Record<string, unknown>;
  const calls = msg.tool_calls as { function?: { arguments?: string } }[] | undefined;
  const arg = calls?.[0]?.function?.arguments;
  if (arg) return { raw: arg, message: msg };
  // Модель ответила JSON текстом — тоже принимаем.
  const text = String(msg.content ?? "");
  const m = /\{[\s\S]*\}/.exec(text);
  return { raw: m ? m[0] : null, message: msg };
}

export async function designLayout(
  brief: Brief,
  opts: {
    intent: string;
    style?: string;
    model?: string;
    chat?: Chat;
    maxAttempts?: number;
    seed?: number;
  },
): Promise<DesignResult> {
  const t0 = Date.now();
  const chat = opts.chat ?? rgChat;
  const model = opts.model ?? pilotModels().layout;
  const cubesGuess = Math.max(
    4,
    brief.bedrooms +
      (brief.kitchenLiving === "compact" ? 2 : 3) +
      (brief.bathrooms ?? 1) +
      (brief.study ? 1 : 0),
  );
  const messages: Record<string, unknown>[] = [
    { role: "system", content: layoutSystemPrompt(knowledgeFor(cubesGuess, brief.tiers)) },
    {
      role: "user",
      content: `Бриф: ${JSON.stringify({
        bedrooms: brief.bedrooms,
        bathrooms: brief.bathrooms,
        study: brief.study,
        kitchenLiving: brief.kitchenLiving,
        tiers: brief.tiers,
        bedroomPurposes: brief.bedroomPurposes,
        maxAreaM2: brief.maxAreaM2,
        masterSuite: brief.masterSuite,
        household: brief.household,
        plot: brief.plot,
      })}\nЗамысел этого варианта: ${opts.intent}.${opts.style ? `\nСтиль клиента: ${opts.style}.` : ""}`,
    },
  ];
  let tokens = 0;
  let last: LayoutCheck | null = null;
  let precedent = "";
  let why = "";
  const max = opts.maxAttempts ?? 3;
  let attempts = 0;
  for (; attempts < max;) {
    attempts++;
    const out = await chat({
      model,
      messages,
      tools: [LAYOUT_TOOL],
      // rgrouter (01.10.2026) отклоняет принудительный выбор конкретной функции
      // (400 unsupported_request) на всех маршрутах; "required" проходит, а
      // функция у нас одна — поведение то же.
      tool_choice: "required",
      temperature: 0.5,
    });
    tokens += Number((out.usage as { total_tokens?: number } | undefined)?.total_tokens ?? 0);
    const { raw, message } = toolArgs(out);
    last = checkLayout(raw, brief);
    try {
      const o = typeof raw === "string" ? JSON.parse(raw) : raw;
      precedent = String(o?.precedent ?? "");
      why = String(o?.why ?? "");
    } catch {
      /* ответ не JSON — разберёт checkLayout */
    }
    if (last.valid) break;
    const callId =
      (message.tool_calls as { id?: string }[] | undefined)?.[0]?.id ?? `call-${attempts}`;
    messages.push({
      role: "assistant",
      content: message.content ?? "",
      tool_calls: message.tool_calls,
    });
    messages.push(
      message.tool_calls
        ? { role: "tool", tool_call_id: callId, content: repairMessage(last) }
        : { role: "user", content: repairMessage(last) },
    );
  }
  const valid = !!last?.valid;
  const project = valid ? last!.project : solverFallback(brief, opts.seed ?? 1);
  return {
    intent: opts.intent,
    project,
    valid,
    attempts,
    fallback: !valid,
    precedent,
    why,
    violations: valid ? [] : [...(last?.violations ?? []), ...(last?.programGaps ?? [])],
    latencyMs: Date.now() - t0,
    tokens,
    model,
    precedentMentioned: mentionsPrecedent(`${precedent} ${why}`),
  };
}

export const DEFAULT_INTENTS = [
  "Фирменный ЭкоКуб: один компактный объём, общая комната на юг к террасе во всю длину, спальни крылом",
  "Экономный: минимум кубиков и тралов под бюджет, все модули парами, без потерь на коридоры",
  "Смелый: двор-терраса в развороте Г или П, либо второй ярус с консолью над террасой",
];

export function pilotDesignStart(input: unknown, session: string): PilotResult {
  const { brief, intent, style } = (input ?? {}) as {
    brief?: Brief;
    intent?: string;
    style?: string;
  };
  if (!brief || typeof brief !== "object" || typeof brief.bedrooms !== "number")
    return { status: 400, body: { error: "Нужен бриф." } };
  if (!pilotModels().configured)
    return {
      status: 503,
      body: { error: "Архитектор-нейросеть не настроен: нет ключа rgrouter на сервере." },
    };
  return startJob(session, "design", async (report) => {
    report("раскладываю кубики");
    return designLayout(brief, {
      intent: String(intent ?? DEFAULT_INTENTS[0]).slice(0, 300),
      style: style ? String(style).slice(0, 500) : undefined,
    });
  });
}

// ── Независимый критик по картинке ─────────────────────────────────────

export interface CriticResult {
  score: number;
  verdict: string;
  notes: string[];
  commands: EditorCommand[];
  rejected: string[];
  model: string;
  latencyMs: number;
  usedImage: boolean;
}

export const CRITIC_CHECKLIST = [
  "путь человека: вход → прихожая/тамбур → общая зона → спальни; спальни не проходные, вход не через кухню",
  "зонирование: день отдельно от ночи (крылом или ярусом)",
  "пропорции и компактность пятна, без зигзага",
  "ритм фасада: окна по модульной сетке, одна доминанта, глухие стены у мокрых зон",
  "соответствие стилю клиента и фирменному стилю ЭкоКуба",
  "ТВ-стена и диван, кухня вдоль глухой стены, хранение у спален",
  "свет: общая комната на юг и к террасе, спальни на восток, санузлы на север",
];

async function planPng(p: Project): Promise<{ dataUrl: string | null; svg: string }> {
  const svg = planSvgString(p, 1, 1200);
  try {
    // sharp есть не везде — без него отдаём модели SVG текстом.
    const mod = (await import(/* @vite-ignore */ "sharp" as string)) as {
      default: (b: Buffer) => { png: () => { toBuffer: () => Promise<Buffer> } };
    };
    const buf = await mod.default(Buffer.from(svg)).png().toBuffer();
    return { dataUrl: `data:image/png;base64,${buf.toString("base64")}`, svg };
  } catch {
    return { dataUrl: null, svg };
  }
}

export async function criticReview(
  p: Project,
  opts: { style?: string; snapshot?: string | null; model?: string; chat?: Chat },
): Promise<CriticResult> {
  const t0 = Date.now();
  const chat = opts.chat ?? rgChat;
  const model = opts.model ?? pilotModels().critic;
  const pp = buildPassport(p);
  const { dataUrl, svg } = await planPng(p);
  const rooms = p.rooms
    .map((r) => {
      const faces = [
        ...new Set(
          p.openings.filter((o) => o.roomId === r.id && o.kind === "window").map((o) => o.face),
        ),
      ].join("");
      return `${r.id} (${r.type}, ярус ${r.tier}, кубиков ${r.moduleIds.length}, окна ${faces || "нет"})`;
    })
    .join("; ");
  const content: unknown[] = [
    {
      type: "text",
      text: `Ты — независимый архитектор-критик ЭкоКуба. Посмотри на план 1-го яруса${opts.snapshot ? " и 3D-снимок" : ""} и оцени по чек-листу: ${CRITIC_CHECKLIST.join("; ")}.
${houseStyleBrief(3)}
Стиль клиента: ${opts.style ?? "фирменный ЭкоКуб"}.
Дом: ${pp.summary.modules} кубиков, ${pp.summary.warmContourM2} м², ярусов ${pp.summary.tiers}, терраса ${pp.summary.terraceM2} м² на стороне ${p.terrace.side}. Помещения: ${rooms}.
Верни ТОЛЬКО JSON: {"score": 0..10, "verdict": "одна фраза", "notes": ["что не так и почему, коротко"], "commands": [команды редактора]}.
Команды (только эти): {"op":"move_terrace","side":"N|E|S|W"}, {"op":"window","action":"add|remove|enlarge|shrink|set","side":"N|E|S|W","roomId":"…","preset":"slot|small|standard|large|floor-to-ceiling"}, {"op":"door","action":"move","side":"…","roomId":"…"}, {"op":"set_finish","category":"facade|roof|windowFrames|interior","finishId":"…"}, {"op":"resize_room","roomId":"…","modules":N}, {"op":"rotate_house","deg":90|180|270}. Не больше 3 команд, только то, что точно улучшит.`,
    },
  ];
  if (dataUrl) content.push({ type: "image_url", image_url: { url: dataUrl } });
  else content.push({ type: "text", text: `План в SVG:\n${svg.slice(0, 60_000)}` });
  if (
    opts.snapshot &&
    /^data:image\/(png|jpeg|webp);base64,/.test(opts.snapshot) &&
    opts.snapshot.length < 3_000_000
  )
    content.push({ type: "image_url", image_url: { url: opts.snapshot } });
  const out = await chat({ model, messages: [{ role: "user", content }], temperature: 0.2 });
  const text = String(
    (out.choices as { message?: { content?: unknown } }[] | undefined)?.[0]?.message?.content ?? "",
  );
  return { ...parseCritic(text), model, latencyMs: Date.now() - t0, usedImage: !!dataUrl };
}

/** Разбор ответа критика: команды — только прошедшие parseCommand. */
export function parseCritic(text: string): Omit<CriticResult, "model" | "latencyMs" | "usedImage"> {
  const m = /\{[\s\S]*\}/.exec(text);
  let o: { score?: unknown; verdict?: unknown; notes?: unknown; commands?: unknown } = {};
  try {
    o = m ? JSON.parse(m[0]) : {};
  } catch {
    o = {};
  }
  const commands: EditorCommand[] = [];
  const rejected: string[] = [];
  for (const c of Array.isArray(o.commands) ? o.commands.slice(0, 3) : []) {
    const r = parseCommand(c);
    if (r.ok) commands.push(r.command);
    else rejected.push(r.error);
  }
  return {
    score: Math.max(0, Math.min(10, Number(o.score) || 0)),
    verdict: String(o.verdict ?? "").slice(0, 300),
    notes: (Array.isArray(o.notes) ? o.notes : []).map((x) => String(x).slice(0, 300)).slice(0, 6),
    commands,
    rejected,
  };
}

export function pilotCriticStart(input: unknown, session: string): PilotResult {
  const { project, style, snapshot } = (input ?? {}) as {
    project?: Project;
    style?: string;
    snapshot?: string;
  };
  if (
    !project ||
    !Array.isArray(project.modules) ||
    !project.modules.length ||
    project.modules.length > 16
  )
    return { status: 400, body: { error: "Нужен дом для разбора." } };
  if (!pilotModels().configured)
    return { status: 503, body: { error: "Критик не настроен: нет ключа rgrouter на сервере." } };
  return startJob(session, "critic", async (report) => {
    report("смотрю на план");
    return criticReview(project, {
      style: style ? String(style).slice(0, 500) : undefined,
      snapshot: snapshot ?? null,
    });
  });
}
