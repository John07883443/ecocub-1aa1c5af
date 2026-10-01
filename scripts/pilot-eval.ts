/**
 * Оценка моделей для Льва: 10 типовых брифов × модели rgrouter.
 *
 * Что меряем (на каждую модель):
 *  - архитектор-раскладчик (propose_layout + движок правил + ремонт до 3 попыток):
 *    доля валидных с первой попытки и после ремонта, откаты на солвер, задержка,
 *    токены, ссылка на прецедент, разные ли решения у трёх замыслов;
 *  - Лев в чате: отвечает ли по-русски, ссылается ли на прецедент, задержка;
 *  - критик по картинке плана: разобрался ли JSON, сколько правок прошли
 *    проверку, задержка, ушла ли картинка (sharp) или SVG текстом.
 *
 * Только чтение: ничего не пишет на сервер, кроме файла отчёта (по желанию),
 * ключ не печатает. Запуск на VPS из каталога приложения:
 *   set -a; . /home/deploy/ecocub.env; set +a
 *   node --experimental-strip-types scripts/pilot-eval.ts > /tmp/pilot-eval.md
 * Модели: PILOT_EVAL_MODELS="rg-anthropic-claude-sonnet-5,rg-google-gemini-3.8-flash,rg-openai-gpt-6.1-sol"
 * Быстрый прогон: PILOT_EVAL_BRIEFS=3.
 */
import { briefFromScenario, type LifeScenario } from "../src/constructor-v4/engine/scenario.ts";
import { solve } from "../src/constructor-v4/engine/solver.ts";
import { mentionsPrecedent } from "../src/constructor-v4/engine/knowledge.ts";
import { projectContext, systemPrompt } from "../src/constructor-v4/ui/architect.ts";
import {
  criticReview,
  designLayout,
  DEFAULT_INTENTS,
  type DesignResult,
} from "../src/constructor-v4/server/pilot-design.server.ts";
import { rgChat } from "../src/constructor-v4/server/pilot-api.server.ts";

if (!process.env.RGROUTER_API_KEY) {
  console.error(
    "Нет RGROUTER_API_KEY в окружении (ключ не печатаем). Загрузите env и запустите снова.",
  );
  process.exit(2);
}

const MODELS = (
  process.env.PILOT_EVAL_MODELS ??
  "rg-anthropic-claude-sonnet-5,rg-google-gemini-3.8-flash,rg-openai-gpt-6.1-sol"
)
  .split(",")
  .map((m) => m.trim())
  .filter(Boolean);

const plot = { widthM: 27, depthM: 37, northDeg: 0 };
const SCENARIOS: { name: string; s: LifeScenario }[] = [
  { name: "пара, дача", s: { adults: 2, kids: 0, desiredAreaM2: { min: 0, max: 55 }, plot } },
  { name: "семья 2+1", s: { adults: 2, kids: 1, desiredAreaM2: { min: 0, max: 90 }, plot } },
  {
    name: "семья 2+2, собака",
    s: { adults: 2, kids: 2, pets: { dogs: 1 }, desiredAreaM2: { min: 0, max: 110 }, plot },
  },
  {
    name: "трое, 3 кошки, родители в гостях, машина",
    s: {
      adults: 2,
      kids: 1,
      pets: { cats: 3 },
      elderly: { mode: "visit", count: 2 },
      car: true,
      desiredAreaM2: { min: 0, max: 90 },
      plot,
    },
  },
  {
    name: "родители живут с нами",
    s: {
      adults: 2,
      kids: 1,
      elderly: { mode: "live", count: 2 },
      desiredAreaM2: { min: 0, max: 120 },
      plot,
    },
  },
  {
    name: "работа из дома, гости",
    s: {
      adults: 2,
      kids: 0,
      workFromHome: 2,
      guestsOften: true,
      desiredAreaM2: { min: 0, max: 90 },
      plot,
    },
  },
  {
    name: "большая семья 2+3, два яруса",
    s: { adults: 2, kids: 3, tiers: 2, desiredAreaM2: { min: 0, max: 150 }, plot },
  },
  {
    name: "один взрослый, студия",
    s: { adults: 1, kids: 0, desiredAreaM2: { min: 0, max: 45 }, plot },
  },
  {
    name: "узкий участок 15×40",
    s: {
      adults: 2,
      kids: 2,
      desiredAreaM2: { min: 0, max: 100 },
      plot: { widthM: 15, depthM: 40 },
    },
  },
  {
    name: "сауна и много хранения",
    s: {
      adults: 2,
      kids: 1,
      sauna: true,
      storage: "lots",
      desiredAreaM2: { min: 0, max: 110 },
      plot,
    },
  },
];
const N = Math.max(
  1,
  Math.min(SCENARIOS.length, Number(process.env.PILOT_EVAL_BRIEFS ?? SCENARIOS.length)),
);

const sig = (r: DesignResult) =>
  r.project
    ? r.project.modules
        .map((m) => `${m.tier}:${m.xMm}:${m.yMm}`)
        .sort()
        .join("|")
    : "none";

interface Row {
  model: string;
  validFirst: number;
  validAfterRepair: number;
  fallback: number;
  errors: number;
  layoutMs: number[];
  tokens: number;
  precedent: number;
  distinctBriefs: number;
  chatRu: number;
  chatPrecedent: number;
  chatMs: number[];
  criticParsed: number;
  criticCommands: number;
  criticMs: number[];
  criticImage: number;
  criticRuns: number;
}

const median = (xs: number[]) => {
  if (!xs.length) return 0;
  const a = [...xs].sort((x, y) => x - y);
  return a[Math.floor(a.length / 2)];
};

const rows: Row[] = [];
for (const model of MODELS) {
  const row: Row = {
    model,
    validFirst: 0,
    validAfterRepair: 0,
    fallback: 0,
    errors: 0,
    layoutMs: [],
    tokens: 0,
    precedent: 0,
    distinctBriefs: 0,
    chatRu: 0,
    chatPrecedent: 0,
    chatMs: [],
    criticParsed: 0,
    criticCommands: 0,
    criticMs: [],
    criticImage: 0,
    criticRuns: 0,
  };
  for (const { name, s } of SCENARIOS.slice(0, N)) {
    const brief = briefFromScenario(s);
    // Три замысла на бриф — валидность, прецеденты и разнообразие.
    const results: DesignResult[] = [];
    for (const intent of DEFAULT_INTENTS) {
      try {
        const r = await designLayout(brief, { intent, model });
        results.push(r);
        if (r.valid && r.attempts === 1) row.validFirst++;
        if (r.valid) row.validAfterRepair++;
        if (r.fallback) row.fallback++;
        row.layoutMs.push(r.latencyMs);
        row.tokens += r.tokens;
        if (r.precedentMentioned) row.precedent++;
      } catch (e) {
        row.errors++;
        console.error(`[${model}] ${name}: ${(e as Error).message.slice(0, 160)}`);
      }
    }
    if (new Set(results.filter((r) => r.valid).map(sig)).size >= 2) row.distinctBriefs++;
    // Лев в чате: предложение по брифу.
    const house = solve(brief).variants[0]?.project ?? null;
    try {
      const t0 = Date.now();
      const out = await rgChat({
        model,
        messages: [
          { role: "system", content: systemPrompt(projectContext(house, { scenario: s })) },
          { role: "user", content: "Что бы вы предложили для нашего дома и почему? Коротко." },
        ],
        temperature: 0.4,
      });
      row.chatMs.push(Date.now() - t0);
      const text = String(
        (out.choices as { message?: { content?: string } }[] | undefined)?.[0]?.message?.content ??
          "",
      );
      if (
        /[а-яё]{4,}/i.test(text) &&
        !/[a-z]{12,}/i.test(text.replace(/CUBAX|Family|Weekend|Sky River|Muji|Habitat/gi, ""))
      )
        row.chatRu++;
      if (mentionsPrecedent(text)) row.chatPrecedent++;
    } catch (e) {
      row.errors++;
      console.error(`[${model}] чат ${name}: ${(e as Error).message.slice(0, 160)}`);
    }
    // Критик — на первых трёх брифах.
    if (house && row.criticRuns < 3) {
      row.criticRuns++;
      try {
        const c = await criticReview(house, { model });
        row.criticMs.push(c.latencyMs);
        if (c.verdict || c.notes.length) row.criticParsed++;
        row.criticCommands += c.commands.length;
        if (c.usedImage) row.criticImage++;
      } catch (e) {
        row.errors++;
        console.error(`[${model}] критик ${name}: ${(e as Error).message.slice(0, 160)}`);
      }
    }
  }
  rows.push(row);
}

const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)} %` : "—");
const runs = N * DEFAULT_INTENTS.length;
console.log(`# Оценка моделей Льва — ${new Date().toISOString().slice(0, 16)}, брифов ${N}\n`);
console.log(
  "| Модель | Валидно с 1-й | После ремонта | Откат на солвер | Медиана раскладки, с | Токенов на вариант | Прецедент в раскладке | Разные решения | Чат по-русски | Чат с прецедентом | Медиана чата, с | Критик: разобран | Правок прошло | Медиана критика, с | Ошибок |",
);
console.log("|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|");
for (const r of rows)
  console.log(
    `| ${r.model} | ${pct(r.validFirst, runs)} | ${pct(r.validAfterRepair, runs)} | ${pct(r.fallback, runs)} | ${(median(r.layoutMs) / 1000).toFixed(1)} | ${Math.round(r.tokens / Math.max(1, r.layoutMs.length))} | ${pct(r.precedent, runs)} | ${pct(r.distinctBriefs, N)} | ${pct(r.chatRu, N)} | ${pct(r.chatPrecedent, N)} | ${(median(r.chatMs) / 1000).toFixed(1)} | ${pct(r.criticParsed, r.criticRuns)} | ${r.criticCommands} | ${(median(r.criticMs) / 1000).toFixed(1)} | ${r.errors} |`,
  );
console.log(
  `\nКартинка плана критику: ${rows.map((r) => `${r.model} — ${r.criticImage}/${r.criticRuns}`).join("; ")} (0 — sharp не найден, ушёл SVG текстом).`,
);
