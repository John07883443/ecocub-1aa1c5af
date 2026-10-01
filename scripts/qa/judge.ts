/**
 * Судья QA-прогона: GPT-6 Astra (rgrouter) разбирает каждый шаг, зрячая модель
 * (по умолчанию Gemini 3.8 Flash) сравнивает итоговые дома с каталогом eco-cub.ru,
 * Astra же пишет общий отчёт. Без зависимостей — только Node ≥ 22 и fetch.
 *
 *   set -a; . /home/deploy/ecocub.env; set +a        # нужен RGROUTER_API_KEY, не печатаем
 *   node --experimental-strip-types judge.ts <каталог прогона> <отчёт.md> [префикс ссылок на картинки]
 *
 * Модели: QA_JUDGE_MODEL (rg-openai-gpt-6-astra), QA_VISION_MODEL (rg-google-gemini-3.8-flash).
 * Пишет <каталог>/judged.json (сырые оценки) и отчёт в markdown.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const KEY = process.env.RGROUTER_API_KEY;
if (!KEY) {
  console.error("Нет RGROUTER_API_KEY в окружении (ключ не печатаем).");
  process.exit(2);
}
const [DIR, REPORT, PREFIX = ""] = process.argv.slice(2);
if (!DIR || !REPORT) {
  console.error("Использование: judge.ts <каталог прогона> <отчёт.md> [префикс ссылок]");
  process.exit(2);
}
const API = process.env.RGROUTER_BASE ?? "https://rgrouter.ru/v1";
const JUDGE = process.env.QA_JUDGE_MODEL ?? "rg-openai-gpt-6-astra";
const VISION = process.env.QA_VISION_MODEL ?? "rg-google-gemini-3.8-flash";
const VISION_FALLBACK = process.env.QA_VISION_FALLBACK ?? "rg-anthropic-claude-sonnet-5";
const CONC = Number(process.env.QA_JUDGE_CONCURRENCY ?? 3);
const REUSE = process.env.QA_REUSE_JUDGED === "1";

type Msg = { role: string; content: unknown };
let spentIn = 0;
let spentOut = 0;

/** Чат-запрос со стримом (длинные ответы не рвутся по таймауту прокси). */
async function chat(model: string, messages: Msg[], maxTokens: number, effort?: string): Promise<string> {
  const body: Record<string, unknown> = {
    model,
    messages,
    stream: true,
    max_tokens: maxTokens,
    stream_options: { include_usage: true },
  };
  if (effort) body.reasoning_effort = effort;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const r = await fetch(`${API}/chat/completions`, {
        method: "POST",
        headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!r.ok || !r.body) {
        const t = (await r.text()).slice(0, 300);
        if (r.status === 400 && body.reasoning_effort) {
          delete body.reasoning_effort; // маршрут не понимает параметр — без него
          continue;
        }
        throw new Error(`${r.status}: ${t}`);
      }
      let text = "";
      let buf = "";
      const dec = new TextDecoder();
      for await (const chunk of r.body as unknown as AsyncIterable<Uint8Array>) {
        buf += dec.decode(chunk, { stream: true });
        let i: number;
        while ((i = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, i).trim();
          buf = buf.slice(i + 1);
          if (!line.startsWith("data:")) continue;
          const data = line.slice(5).trim();
          if (data === "[DONE]") continue;
          try {
            const j = JSON.parse(data);
            const d = j.choices?.[0]?.delta?.content;
            if (typeof d === "string") text += d;
            if (j.usage) {
              spentIn += j.usage.prompt_tokens ?? 0;
              spentOut += j.usage.completion_tokens ?? 0;
            }
          } catch {
            /* неполная строка */
          }
        }
      }
      if (!text.trim()) throw new Error("пустой ответ (рассуждения съели лимит?)");
      return text;
    } catch (e) {
      if (attempt === 2) throw e;
      await new Promise((res) => setTimeout(res, 8000 * (attempt + 1)));
    }
  }
  throw new Error("недостижимо");
}

function parseJson<T>(s: string): T | null {
  const m = s.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = m ? m[1] : s.slice(s.indexOf("{"), s.lastIndexOf("}") + 1);
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

async function pool<T, R>(items: T[], n: number, fn: (x: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let k = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (k < items.length) {
        const i = k++;
        out[i] = await fn(items[i], i);
      }
    }),
  );
  return out;
}

const img = (rel: string) => {
  const p = join(DIR, rel);
  if (!existsSync(p)) return null;
  return { type: "image_url", image_url: { url: `data:image/jpeg;base64,${readFileSync(p).toString("base64")}` } };
};

// ── Данные ─────────────────────────────────────────────────────────────────
type Rec = Record<string, any>;
const records = JSON.parse(readFileSync(join(DIR, "records.json"), "utf8")) as Rec;
const steps: Rec[] = records.flows.flatMap((f: Rec) => f.steps ?? []);
const prev: Rec | null =
  REUSE && existsSync(join(DIR, "judged.json")) ? JSON.parse(readFileSync(join(DIR, "judged.json"), "utf8")) : null;

const CONTEXT = `Ты — строгий QA-инженер и архитектор-ревьюер. Проверяешь конструктор модульных домов ЭкоКуб (eco-cub.ru/constructor).
Дом собирается из бетонных кубиков 3,2 × 3,42 м (≈10,9 м² каждый), парами в заводские модули, плоская кровля, до 2 ярусов, консоли второго яруса.
Архитектор «Лев» — LLM с инструментами (set_scenario, edit_window, describe_style, add_room, remove_room, rotate_house, move_terrace, what_if, select_variant, design и др.).
Строки «⚙ имя: результат» — это реальный вызов инструмента и то, что он вернул. Поля before/after — сводка JSON дома ДО и ПОСЛЕ шага, посчитанная движком сайта; diff — что реально изменилось.
Главная претензия владельца: «Лев говорит то, чего не делает (фасад светлее — ничего не меняется), неправильно реагирует на команды, окна не работают, пользоваться сложно».
Сравнивай СЛОВА Льва с diff и с результатами инструментов. Если Лев утверждает изменение, а diff его не показывает (или показывает другое) — это ложь о выполнении, severity не ниже major.`;

async function judgeStep(s: Rec): Promise<Rec> {
  const old = prev?.steps?.find((x: Rec) => x.id === s.id && x.flow === s.flow);
  if (old && !old.error) return old;
  const rec = {
    flow: s.flow,
    id: s.id,
    action: s.action,
    expect: s.expect,
    note: s.note,
    timedOut: s.timedOut,
    ms: s.ms,
    levReply: s.levReply,
    toolCalls: s.toolCalls,
    systemLines: s.systemLines,
    diff: s.diff,
    before: s.before,
    after: s.after,
    comments: s.comments,
    consoleErrors: s.consoleErrors,
    httpErrors: s.httpErrors,
  };
  const prompt = `Шаг теста (JSON):\n${JSON.stringify(rec)}\n\nОцени шаг и ответь СТРОГО JSON без пояснений:
{"did_what_said":{"verdict":"yes|no|partial|n/a","evidence":"цитата Льва vs что в diff/инструментах"},
"command_understood":"yes|no|partial|n/a",
"rule_violation":{"has":true|false,"detail":"какое правило/ограничение нарушено или проигнорировано (в т.ч. жёсткие нарушения движка)"},
"ux_friction":["что мешает человеку: лишние вопросы, игнор команды, повтор интервью, непонятный ответ, долго (>20 с), ошибка сервера…"],
"severity":"critical|major|minor|none",
"title":"короткое название проблемы или «ок»",
"fix":"конкретная правка в коде/промпте/инструменте"}`;
  try {
    const t = await chat(JUDGE, [{ role: "system", content: CONTEXT }, { role: "user", content: prompt }], 6000, process.env.QA_STEP_EFFORT ?? "low");
    const j = parseJson<Rec>(t);
    console.log(`  ${s.id}: ${j?.severity ?? "?"} — ${j?.title ?? t.slice(0, 80)}`);
    return { flow: s.flow, id: s.id, ...(j ?? { raw: t.slice(0, 2000), error: "не JSON" }) };
  } catch (e) {
    console.log(`  ${s.id}: ошибка судьи ${(e as Error).message}`);
    return { flow: s.flow, id: s.id, error: (e as Error).message };
  }
}

async function judgeVisual(f: Rec): Promise<Rec> {
  const old = prev?.visual?.find((x: Rec) => x.flow === f.id);
  if (old && !old.error) return old;
  const refs: Rec[] = records.references ?? [];
  const imgs: Rec[] = f.final?.images ?? [];
  const content: unknown[] = [
    {
      type: "text",
      text: `Ниже сначала ЭТАЛОНЫ — дома из каталога eco-cub.ru и слайдера главной (так должен выглядеть продукт). Затем итоговый дом из конструктора после теста «${f.title}»: 3D-вид, план(ы) и фото-рендеры (если есть).
Сводка дома: ${JSON.stringify(f.final?.house ?? null)}`,
    },
  ];
  for (const r of refs) {
    const i = img(r.path);
    if (i) content.push({ type: "text", text: `Эталон: ${r.label}` }, i);
  }
  for (const r of imgs) {
    const i = img(r.path);
    if (i) content.push({ type: "text", text: `Конструктор, ${r.kind}` }, i);
  }
  if (!imgs.some((x) => x.kind.startsWith("render")))
    content.push({ type: "text", text: "Рендеров нет (не сгенерировались) — render_attractiveness = 0 и отметь это." });
  content.push({
    type: "text",
    text: `Оцени итоговый дом по критерию владельца: «дома должны быть реалистичны, приемлемы по дизайну и форм-фактору, а рендеры — привлекательны и соответствовать духу и формату домов каталога».
Ответь СТРОГО JSON: {"realism":0-10,"design":0-10,"form_factor":0-10,"render_attractiveness":0-10,"catalog_spirit":0-10,
"renders_match_house":"yes|no|partial|n/a","verdict":"PASS|FAIL","closest_reference":"какой эталон ближе","why":"2-4 предложения по-русски: что не так/что хорошо","fixes":["конкретно, что поменять в генерации дома/рендеров"]}
PASS только если все пять оценок ≥ 6.`,
  });
  let lastErr = "";
  for (const model of [VISION, VISION_FALLBACK]) {
    try {
      const t = await chat(model, [{ role: "user", content }], 6000);
      const j = parseJson<Rec>(t);
      console.log(`  визуально ${f.id} (${model}): ${j?.verdict ?? "?"}`);
      if (j) return { flow: f.id, model, ...j };
      lastErr = "не JSON";
    } catch (e) {
      lastErr = (e as Error).message;
      console.log(`  визуально ${f.id} (${model}): ошибка ${lastErr}`);
    }
  }
  return { flow: f.id, model: VISION, error: lastErr };
}

// ── Прогон судьи ───────────────────────────────────────────────────────────
console.log(`Судья ${JUDGE}: ${steps.length} шагов`);
const judged = await pool(steps, CONC, judgeStep);
console.log(`Зрение ${VISION}: ${records.flows.length} домов`);
const visual = await pool(records.flows as Rec[], 2, judgeVisual);
writeFileSync(join(DIR, "judged.json"), JSON.stringify({ steps: judged, visual }, null, 1));

const compact = steps.map((s, i) => ({
  id: s.id,
  cmd: "say" in s.action ? s.action.say : Object.keys(s.action)[0],
  lev: String(s.levReply ?? "").slice(0, 400),
  tools: s.toolCalls,
  diff: s.diff,
  ms: s.ms,
  errors: [...(s.consoleErrors ?? []), ...(s.httpErrors ?? [])],
  judge: judged[i],
}));
let overall = "";
try {
  overall = await chat(
    JUDGE,
    [
      { role: "system", content: CONTEXT },
      {
        role: "user",
        content: `Все шаги прогона с оценками (JSON):\n${JSON.stringify(compact)}\n\nВизуальные оценки итоговых домов против каталога:\n${JSON.stringify(visual)}\n
Напиши итог по-русски в markdown, без вступлений, ровно три раздела:
### Топ-10 ключевых ошибок
Нумерованный список по убыванию важности. Каждый пункт: **название** — что видно (id шагов как доказательство) — почему это важно для покупателя — серьёзность.
### Почему сложно пользоваться
5–8 пунктов о UX: где человек теряется, что раздражает, где Лев ведёт себя не как архитектор.
### Конкретные правки
8–12 пунктов: что поменять в коде (инструменты, проверка «сказал = сделал», промпт Льва, интервью, окна, фасад, рендеры), в порядке «сначала самое дешёвое с наибольшим эффектом».`,
      },
    ],
    16000,
    process.env.QA_OVERALL_EFFORT ?? "medium",
  );
} catch (e) {
  overall = `Итог Astra не получен: ${(e as Error).message}`;
}

// ── Отчёт ──────────────────────────────────────────────────────────────────
const esc = (s: unknown) => String(s ?? "").replace(/\|/g, "\\|").replace(/\n+/g, " ").trim();
const cut = (s: unknown, n: number) => {
  const t = esc(s);
  return t.length > n ? `${t.slice(0, n)}…` : t;
};
const link = (rel: string) => `${PREFIX}${rel}`;
const L: string[] = [];
const date = (records.meta?.finishedAt ?? new Date().toISOString()).slice(0, 10);
L.push(`# QA конструктора ЭкоКуба — ${date}`, "");
L.push(
  `Прогон: ${records.meta?.url} · ${steps.length} шагов в ${records.flows.length} потоках, текстом в чат Льва (тот же мозг и инструменты, что у голоса). Судья шагов и итога — \`${JUDGE}\`, визуальный судья — \`${VISION}\` (запасной \`${VISION_FALLBACK}\`, фактическая модель — в judged.json). Скрипты: \`scripts/qa/\`.`,
  "",
);
L.push("## Вердикт по критерию владельца: реалистичный дом и рендеры в духе каталога", "");
L.push("| Поток | Реализм | Дизайн | Форм-фактор | Рендеры | Дух каталога | Рендеры = дом | Итог | Ближе всего к | Почему |");
L.push("|---|---|---|---|---|---|---|---|---|---|");
for (const v of visual) {
  L.push(
    `| ${v.flow} | ${v.realism ?? "—"} | ${v.design ?? "—"} | ${v.form_factor ?? "—"} | ${v.render_attractiveness ?? "—"} | ${v.catalog_spirit ?? "—"} | ${v.renders_match_house ?? "—"} | **${v.verdict ?? "нет оценки"}** | ${esc(v.closest_reference)} | ${cut(v.why ?? v.error, 400)} |`,
  );
}
L.push("");
for (const f of records.flows as Rec[]) {
  const imgs: Rec[] = f.final?.images ?? [];
  if (!imgs.length) continue;
  L.push(`**${f.id}** — ${esc(f.title)}. Итог: ${esc(f.final?.house ? `${f.final.house.cubes} куб., ${f.final.house.tiers} яр., ${f.final.house.warmM2} м², фасад «${f.final.house.finishes?.facade}», ${f.final.house.budgetMln?.min}–${f.final.house.budgetMln?.max} млн ₽` : "—")}`, "");
  L.push(imgs.map((i) => `![${f.id} ${i.kind}](${link(i.path)})`).join(" "), "");
  const v = visual.find((x) => x.flow === f.id);
  if (v?.fixes?.length) L.push(`Что поменять: ${v.fixes.map(esc).join("; ")}`, "");
}
L.push(`Эталоны: ${(records.references ?? []).map((r: Rec) => `[${r.label}](${link(r.path)})`).join(" · ")}`, "");
L.push("## Итог судьи (GPT-6 Astra)", "", overall.trim(), "");

const sev = { critical: 0, major: 0, minor: 0, none: 0 } as Record<string, number>;
let lies = 0;
for (const j of judged) {
  if (j.severity in sev) sev[j.severity]++;
  if (j.did_what_said?.verdict === "no") lies++;
}
L.push("## Сводка шагов", "");
L.push(
  `Критических: ${sev.critical}, серьёзных: ${sev.major}, мелких: ${sev.minor}, без замечаний: ${sev.none}. «Сказал ≠ сделал»: ${lies} из ${steps.length}.`,
  "",
);
L.push("## Сырые данные по шагам", "");
L.push("| Шаг | Команда | Лев ответил | Инструменты | Что реально изменилось | Сделал что сказал | Понял | Правило | Серьёзность | Доказательство / правка | мс | Скрин |");
L.push("|---|---|---|---|---|---|---|---|---|---|---|---|");
steps.forEach((s, i) => {
  const j = judged[i] ?? {};
  const cmd = "say" in s.action ? `«${s.action.say}»` : "chip" in s.action ? `кнопка «${s.action.chip}»` : Object.keys(s.action)[0];
  L.push(
    `| ${s.id} | ${esc(cmd)}${s.note ? ` (${esc(s.note)})` : ""} | ${cut(s.levReply, 260)} | ${cut((s.toolCalls ?? []).join(" ; "), 220)} | ${cut((s.diff ?? []).join("; "), 220)} | ${esc(j.did_what_said?.verdict)} | ${esc(j.command_understood)} | ${j.rule_violation?.has ? cut(j.rule_violation.detail, 120) : "—"} | ${esc(j.severity ?? j.error)} | ${cut(`${j.did_what_said?.evidence ?? ""} → ${j.fix ?? ""}`, 300)} | ${s.ms}${s.timedOut ? " ⏱" : ""} | [скрин](${link(s.screenshot)}) |`,
  );
});
L.push("");
const tech = steps.filter((s) => (s.consoleErrors?.length ?? 0) + (s.httpErrors?.length ?? 0) > 0);
L.push("## Технические ошибки (консоль, сеть)", "");
if (!tech.length) L.push("Нет.");
for (const s of tech)
  L.push(`- ${s.id}: ${[...(s.consoleErrors ?? []), ...(s.httpErrors ?? [])].map(esc).join("; ")}`);
for (const f of records.flows as Rec[])
  if (f.crashed) L.push(`- поток ${f.id} упал: ${esc(f.crashed)}`);
L.push("");
L.push("## Как перезапустить", "");
L.push(
  "```",
  "cd scripts/qa && npm i && npx playwright install chromium",
  "node --experimental-strip-types constructor-e2e.ts          # прод; QA_URL=http://localhost:8080/constructor для дев-сервера",
  "# судья — там, где есть RGROUTER_API_KEY (VPS):",
  "set -a; . /home/deploy/ecocub.env; set +a",
  "node --experimental-strip-types judge.ts out/<run> report.md",
  "```",
  "",
  `Токены судьи: вход ${spentIn}, выход ${spentOut}.`,
);
writeFileSync(REPORT, L.join("\n"));
console.log(`Отчёт: ${REPORT}; токены вход ${spentIn}, выход ${spentOut}`);
