/**
 * QA-прогон конструктора ЭкоКуба в браузере (Playwright, Chromium headless).
 *
 * Пишем Льву ТЕКСТОМ в чат (тот же мозг и те же инструменты, что у голоса), на каждом шаге
 * снимаем: ответ Льва, вызовы инструментов («⚙ …» в чате или window.__pilotState),
 * дом до/после (JSON проекта → сводка движком сайта), скриншот, ошибки консоли, 4xx/5xx.
 * В конце каждого потока — 3D, план и фото-рендеры итогового дома (для визуального судьи).
 *
 * Запуск (из scripts/qa, один раз: npm i && npx playwright install chromium):
 *   node --experimental-strip-types constructor-e2e.ts
 *   QA_URL=http://localhost:8080/constructor QA_FLOWS=family,edge QA_NO_RENDERS=1 node ...
 * Итог: out/<run>/records.json + shots/ + final/ + references/. Судья — judge.ts.
 * Ключей не требует: ходит на сайт как обычный посетитель.
 */
import { chromium, type Page, type BrowserContext } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { FLOWS, REFERENCES, type Step } from "./scenarios.ts";
import { diffSummary, summarize, type HouseSummary } from "./house.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const URL_ = process.env.QA_URL ?? "https://eco-cub.ru/constructor";
const ORIGIN = new URL(URL_).origin;
const RUN = process.env.QA_RUN ?? new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
const OUT = process.env.QA_OUT ?? join(HERE, "out", RUN);
const ONLY = (process.env.QA_FLOWS ?? "").split(",").filter(Boolean);
const NO_RENDERS = process.env.QA_NO_RENDERS === "1";
const STEP_TIMEOUT = Number(process.env.QA_STEP_TIMEOUT_MS ?? 150_000);
const RENDER_TIMEOUT = Number(process.env.QA_RENDER_TIMEOUT_MS ?? 360_000);

mkdirSync(join(OUT, "shots"), { recursive: true });
mkdirSync(join(OUT, "final"), { recursive: true });
mkdirSync(join(OUT, "references"), { recursive: true });

type ChatItem = { role: "user" | "assistant" | "system" | "options" | "offer" | "busy"; text: string };
export type StepRecord = {
  flow: string;
  id: string;
  action: Step["action"];
  expect: string;
  startedAt: string;
  ms: number;
  timedOut: boolean;
  note?: string;
  levReply: string;
  systemLines: string[];
  toolCalls: string[];
  newChat: ChatItem[];
  pilotState: unknown;
  houseSource: "pilotState" | "react" | "none";
  before: HouseSummary | null;
  after: HouseSummary | null;
  diff: string[];
  comments: string[];
  screenshot: string;
  consoleErrors: string[];
  httpErrors: string[];
};
export type FlowFinal = {
  house: HouseSummary | null;
  images: { kind: string; path: string }[];
  renderNote: string;
};

// ── Чтение страницы ────────────────────────────────────────────────────────

/** Чат: все реплики по порядку (дети прокручиваемой ленты в правой колонке). */
async function readChat(page: Page): Promise<ChatItem[]> {
  return page.evaluate(() => {
    const box = document.querySelector("aside .overflow-auto");
    if (!box) return [];
    return [...box.children].map((el) => {
      const c = (el as HTMLElement).className || "";
      const text = (el.textContent ?? "").trim();
      let role = "assistant";
      if (el.tagName === "DIV" && el.querySelector("button img, .grid button")) role = "options";
      else if (c.includes("bg-amber-50")) role = "offer";
      else if (c.includes("ml-8")) role = "user";
      else if (c.includes("text-xs") && (text === "Лев думает…" || c.includes("animate-pulse")))
        role = "busy";
      else if (c.includes("text-xs")) role = "system";
      return { role, text };
    }) as { role: "assistant"; text: string }[];
  });
}

/** Проект: window.__pilotState.house (ветка voice-edit) или состояние React компонента пилота. */
async function readProject(page: Page): Promise<{ project: unknown; source: StepRecord["houseSource"]; state: unknown }> {
  return page.evaluate(() => {
    const w = window as unknown as { __pilotState?: Record<string, unknown> };
    const isP = (x: unknown) =>
      !!x &&
      typeof x === "object" &&
      Array.isArray((x as { modules?: unknown }).modules) &&
      Array.isArray((x as { rooms?: unknown }).rooms) &&
      Array.isArray((x as { openings?: unknown }).openings);
    const clone = (x: unknown) => JSON.parse(JSON.stringify(x));
    if (w.__pilotState) {
      const st = w.__pilotState;
      const house = (st.house ?? st.project ?? st.current) as unknown;
      const rest: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(st)) if (!["house", "project", "current"].includes(k)) rest[k] = v;
      if (isP(house)) return { project: clone(house), source: "pilotState", state: clone(rest) };
    }
    const el = document.querySelector("#pilot-3d");
    if (!el) return { project: null, source: "none", state: null };
    const key = Object.keys(el).find((k) => k.startsWith("__reactFiber$"));
    let f = key ? (el as unknown as Record<string, { return?: unknown }>)[key] : null;
    for (let depth = 0; f && depth < 40; depth++) {
      const fiber = f as { memoizedState?: unknown; return?: unknown };
      let h = fiber.memoizedState as { memoizedState?: unknown; next?: unknown; queue?: unknown } | null;
      // Сначала useState (у него есть queue) — это «текущий дом», потом рефы.
      const refs: unknown[] = [];
      for (let i = 0; h && typeof h === "object" && i < 400; i++) {
        const s = h.memoizedState;
        if (h.queue && isP(s)) return { project: clone(s), source: "react", state: null };
        if (s && typeof s === "object" && isP((s as { current?: unknown }).current))
          refs.push((s as { current: unknown }).current);
        h = h.next as typeof h;
      }
      if (refs.length) return { project: clone(refs[0]), source: "react", state: null };
      f = fiber.return as typeof f;
    }
    return { project: null, source: "none", state: null };
  });
}

async function readComments(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const out: string[] = [];
    document.querySelectorAll("main .rounded-lg.border.bg-white.p-3.text-sm").forEach((el) => {
      const b = el.querySelector("b");
      if (b && /Лев/.test(b.textContent ?? "")) out.push((el.textContent ?? "").trim().slice(0, 600));
    });
    return out;
  });
}

async function isBusy(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const t = document.querySelector("aside")?.textContent ?? "";
    if (t.includes("Лев думает…")) return true;
    if (document.querySelector("aside .animate-pulse.text-amber-700")) return true;
    const btn = [...document.querySelectorAll("button")].find((b) =>
      /Рисую|Рисуем/.test(b.textContent ?? ""),
    );
    return !!btn;
  });
}

/** Ждём, пока Лев договорит: не «думает», лента не растёт 3 с подряд. */
async function waitIdle(page: Page, timeoutMs: number): Promise<boolean> {
  const t0 = Date.now();
  let lastLen = -1;
  let stableSince = Date.now();
  await page.waitForTimeout(1500);
  while (Date.now() - t0 < timeoutMs) {
    const len = await page.evaluate(
      () => (document.querySelector("aside .overflow-auto")?.textContent ?? "").length,
    );
    const busy = await isBusy(page);
    if (len !== lastLen || busy) {
      lastLen = len;
      stableSince = Date.now();
    } else if (Date.now() - stableSince > 3000) return false;
    await page.waitForTimeout(500);
  }
  return true;
}

async function clickChip(page: Page, label: string): Promise<boolean> {
  const b = page.locator("aside button", { hasText: label }).first();
  if ((await b.count()) === 0) return false;
  await b.click();
  return true;
}

async function say(page: Page, text: string) {
  const input = page.locator("aside form input").first();
  await input.fill(text);
  await input.press("Enter");
}

// ── Прогон ─────────────────────────────────────────────────────────────────

async function runFlow(ctx: BrowserContext, flow: (typeof FLOWS)[number]) {
  const page = await ctx.newPage();
  let stepId = "load";
  const consoleErr: Record<string, string[]> = {};
  const httpErr: Record<string, string[]> = {};
  const push = (m: Record<string, string[]>, v: string) => (m[stepId] ??= []).push(v.slice(0, 300));
  page.on("console", (m) => m.type() === "error" && push(consoleErr, m.text()));
  page.on("pageerror", (e) => push(consoleErr, `pageerror: ${e.message}`));
  page.on("response", (r) => {
    if (r.status() >= 400) push(httpErr, `${r.status()} ${r.request().method()} ${r.url().split("?")[0]}`);
  });
  page.on("requestfailed", (r) => push(httpErr, `FAILED ${r.method()} ${r.url().split("?")[0]} ${r.failure()?.errorText ?? ""}`));

  const sep = URL_.includes("?") ? "&" : "?";
  await page.goto(`${URL_}${sep}qa=1`, { waitUntil: "load", timeout: 90_000 });
  await page.waitForSelector("aside form input", { timeout: 60_000 });
  await waitIdle(page, 30_000);

  const steps: StepRecord[] = [];
  for (const step of flow.steps) {
    stepId = step.id;
    const t0 = Date.now();
    const startedAt = new Date().toISOString();
    const before = await readProject(page);
    const chat0 = await readChat(page);
    let note: string | undefined;
    let timedOut = false;
    const a = step.action;
    if ("say" in a) {
      await say(page, a.say);
      timedOut = await waitIdle(page, STEP_TIMEOUT);
    } else if ("chip" in a) {
      if (!(await clickChip(page, a.chip))) {
        note = `быстрой кнопки «${a.chip}» нет на экране — написали текстом`;
        if (a.fallbackSay) await say(page, a.fallbackSay);
      }
      timedOut = await waitIdle(page, STEP_TIMEOUT);
    } else if ("renders" in a) {
      if (NO_RENDERS) note = "рендеры пропущены (QA_NO_RENDERS=1)";
      else {
        const btn = page.locator("button", { hasText: "Фото-рендеры" }).first();
        if ((await btn.count()) === 0) note = "кнопки «Фото-рендеры» нет";
        else {
          await btn.click();
          await page.waitForTimeout(2000);
          const tEnd = Date.now() + RENDER_TIMEOUT;
          while (Date.now() < tEnd && (await isBusy(page))) await page.waitForTimeout(2000);
          timedOut = Date.now() >= tEnd;
          await page.waitForTimeout(1500);
        }
      }
    } else {
      await page.waitForTimeout(1000);
    }
    const after = await readProject(page);
    const chat1 = await readChat(page);
    const newChat = chat1.slice(chat0.length).filter((c) => c.role !== "busy");
    const systemLines = newChat.filter((c) => c.role === "system").map((c) => c.text);
    const st = (after.state ?? {}) as { lastToolCalls?: unknown; lastLevMessage?: unknown };
    const toolCalls = [
      ...systemLines.filter((s) => s.startsWith("⚙")),
      ...(Array.isArray(st.lastToolCalls)
        ? (st.lastToolCalls as unknown[]).map((t) => `pilotState: ${JSON.stringify(t).slice(0, 300)}`)
        : []),
    ];
    const levReply =
      newChat
        .filter((c) => c.role === "assistant" || c.role === "options" || c.role === "offer")
        .map((c) => c.text)
        .join("\n") ||
      (step.action && "observe" in step.action ? chat1.map((c) => c.text).join("\n") : "");
    const shot = `shots/${flow.id}-${step.id}.jpg`;
    await page.screenshot({ path: join(OUT, shot), type: "jpeg", quality: 70 });
    const bS = summarize(before.project as never);
    const aS = summarize(after.project as never);
    const rec: StepRecord = {
      flow: flow.id,
      id: step.id,
      action: step.action,
      expect: step.expect,
      startedAt,
      ms: Date.now() - t0,
      timedOut,
      note,
      levReply: levReply.slice(0, 3000),
      systemLines,
      toolCalls,
      newChat,
      pilotState: after.state,
      houseSource: after.source,
      before: bS,
      after: aS,
      diff: diffSummary(bS, aS),
      comments: await readComments(page),
      screenshot: shot,
      consoleErrors: consoleErr[step.id] ?? [],
      httpErrors: httpErr[step.id] ?? [],
    };
    steps.push(rec);
    console.log(
      `[${flow.id}] ${step.id} ${"say" in a ? `«${a.say}»` : Object.keys(a)[0]} — ${rec.ms} мс${timedOut ? " ТАЙМАУТ" : ""}; ${rec.diff.join("; ").slice(0, 160)}`,
    );
  }

  // Итоговый дом: 3D, планы, рендеры — для визуального судьи.
  stepId = "final";
  const images: FlowFinal["images"] = [];
  const shotEl = async (kind: string, sel: string) => {
    const el = page.locator(sel).first();
    if ((await el.count()) === 0) return;
    const p = `final/${flow.id}-${kind}.jpg`;
    try {
      await el.scrollIntoViewIfNeeded();
      await el.screenshot({ path: join(OUT, p), type: "jpeg", quality: 80 });
      images.push({ kind, path: p });
    } catch {
      /* элемент не отрисовался — пропускаем */
    }
  };
  const tab = async (name: string) => {
    const b = page.locator("main button", { hasText: name }).first();
    if (await b.count()) {
      await b.click();
      await page.waitForTimeout(1500);
    }
  };
  await tab("3D");
  await page.waitForTimeout(2000);
  await shotEl("3d", "#pilot-3d");
  await tab("План 1 яруса");
  await shotEl("plan1", "#pilot-3d");
  const fin = summarize((await readProject(page)).project as never);
  if (fin && fin.tiers > 1) {
    await tab("План 2 яруса");
    await shotEl("plan2", "#pilot-3d");
  }
  await tab("3D");
  const renderImgs = page.locator("figure img");
  const n = await renderImgs.count();
  for (let i = 0; i < n; i++) {
    const p = `final/${flow.id}-render-${i + 1}.jpg`;
    try {
      await renderImgs.nth(i).scrollIntoViewIfNeeded();
      await renderImgs.nth(i).screenshot({ path: join(OUT, p), type: "jpeg", quality: 85 });
      images.push({ kind: `render-${i + 1}`, path: p });
    } catch {
      /* картинка не загрузилась */
    }
  }
  const renderNote = await page.evaluate(() =>
    [...document.querySelectorAll("figure")].map((f) => (f.textContent ?? "").trim()).join(" | "),
  );
  await page.close();
  return {
    id: flow.id,
    title: flow.title,
    steps,
    final: { house: fin, images, renderNote, consoleErrors: consoleErr.final ?? [], httpErrors: httpErr.final ?? [] },
    loadConsoleErrors: consoleErr.load ?? [],
    loadHttpErrors: httpErr.load ?? [],
  };
}

async function fetchReferences(ctx: BrowserContext) {
  const page = await ctx.newPage();
  await page.setViewportSize({ width: 768, height: 512 });
  const out: { id: string; label: string; path: string }[] = [];
  for (const r of REFERENCES) {
    const p = `references/${r.id}.jpg`;
    try {
      await page.setContent(
        `<body style="margin:0;background:#fff"><img id=i src="${ORIGIN}${r.path}" style="width:768px;height:512px;object-fit:cover"></body>`,
      );
      await page.waitForFunction(() => (document.getElementById("i") as HTMLImageElement)?.complete, null, {
        timeout: 30_000,
      });
      await page.screenshot({ path: join(OUT, p), type: "jpeg", quality: 80 });
      out.push({ id: r.id, label: r.label, path: p });
    } catch (e) {
      console.warn(`эталон ${r.id} не скачался: ${(e as Error).message}`);
    }
  }
  await page.close();
  return out;
}

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: "ru-RU" });
const flows = [];
for (const f of FLOWS.filter((f) => !ONLY.length || ONLY.includes(f.id))) {
  try {
    flows.push(await runFlow(ctx, f));
  } catch (e) {
    console.error(`поток ${f.id} упал: ${(e as Error).message}`);
    flows.push({ id: f.id, title: f.title, steps: [], crashed: (e as Error).message });
  }
  writeFileSync(join(OUT, "records.json"), JSON.stringify({ meta: { url: URL_, run: RUN }, flows }, null, 1));
}
const references = await fetchReferences(ctx);
await browser.close();
writeFileSync(
  join(OUT, "records.json"),
  JSON.stringify({ meta: { url: URL_, run: RUN, finishedAt: new Date().toISOString() }, flows, references }, null, 1),
);
console.log(`\nГотово: ${join(OUT, "records.json")}`);
