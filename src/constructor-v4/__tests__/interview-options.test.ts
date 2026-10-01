/**
 * PR B: интервью Льва, карточки A/B/C со смешиванием, нейросеть-архитектор с
 * проверкой правил и откатом, критик, фирменный стиль, знания, цифры.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  answer,
  currentMode,
  interviewContext,
  startInterview,
  stepsForFields,
  touchForm,
  STEPS,
} from "../ui/interview.ts";
import {
  choiceToCommands,
  mergeChoice,
  optionsContext,
  parseOptionReply,
  styleOptions,
} from "../ui/options.ts";
import { applyCommand } from "../engine/commands.ts";
import { solve } from "../engine/solver.ts";
import {
  checkLayout,
  layoutToProject,
  parseLayout,
  type LayoutJson,
} from "../engine/llm-layout.ts";
import { designLayout, parseCritic, criticReview } from "../server/pilot-design.server.ts";
import { planSvgString } from "../engine/plan-svg.ts";
import { knowledgeFor, mentionsPrecedent } from "../engine/knowledge.ts";
import {
  ecocubStyleProfile,
  HERO_REFERENCES,
  RENDER_STYLE_BASELINE,
} from "../engine/house-style.ts";
import { FINISHES } from "../grammar/index.ts";
import { promptFor, viewSet } from "../engine/render-plan.ts";
import { budgetFor } from "../engine/price.ts";
import { projectContext, systemPrompt } from "../ui/architect.ts";
import type { Brief } from "../engine/types.ts";

const base = () =>
  solve({
    bedrooms: 2,
    tiers: 1,
    kitchenLiving: "large",
    yearRound: true,
    plot: { widthM: 30, depthM: 30 },
  }).variants[0].project;

// ── Интервью ─────────────────────────────────────────────────────────────

test("интервью: по одному шагу, участок первым, ответы двигают вперёд", () => {
  let s = startInterview();
  assert.equal(s.current, "plot");
  assert.equal(currentMode(s), "ask");
  s = answer(s, stepsForFields(["plotSotki"]));
  assert.equal(s.current, "people");
  s = answer(s, stepsForFields(["adults", "kids", "cats"]));
  assert.deepEqual(s.confirmed, ["plot", "people", "pets"]);
  assert.equal(s.current, "elderly");
  for (const st of STEPS) s = answer(s, [st]);
  assert.equal(s.current, null);
  assert.equal(currentMode(s), "done");
});

test("интервью: заполненное в анкете подтверждается, а не спрашивается заново", () => {
  let s = startInterview();
  s = answer(s, ["plot"]);
  s = touchForm(s, "people");
  assert.equal(s.current, "people");
  assert.equal(currentMode(s), "confirm");
  const ctx = interviewContext(s, {
    adults: 2,
    kids: 1,
    pets: { cats: 3 },
  });
  assert.match(ctx, /подтверди/);
  assert.match(ctx, /шаг 2 из 7/);
  const fresh = interviewContext(startInterview(), { adults: 2, kids: 0 });
  assert.match(fresh, /10 соток/);
  assert.match(fresh, /plotSotki: 10/);
});

// ── Карточки A/B/C ──────────────────────────────────────────────────────

test("карточки: три варианта с буквами, картинками слайдера и отделками из каталога", () => {
  const cards = styleOptions();
  assert.deepEqual(
    cards.map((c) => c.letter),
    ["A", "B", "C"],
  );
  for (const c of cards) {
    assert.ok(c.image?.startsWith("/images/hero-villa"));
    for (const t of Object.values(c.traits))
      if (t.finish)
        assert.ok(
          FINISHES.categories[t.finish.category].some((f) => f.id === t.finish!.id),
          `${c.letter}: ${t.finish.id}`,
        );
  }
  assert.match(optionsContext(cards), /A «Фирменный ЭкоКуб»: кровля/);
});

test("«из А крышу, из Б окна» — крыша из A, окна из B", () => {
  const r = parseOptionReply("Из А нравится крыша, из Б окна");
  assert.deepEqual(r.picks, [
    { letter: "A", features: ["roof"] },
    { letter: "B", features: ["windows"] },
  ]);
  const m = mergeChoice(styleOptions(), r)!;
  assert.equal(m.base, "A");
  assert.equal(m.traits.roof.from, "A");
  assert.equal(m.traits.windows.from, "B");
  assert.equal(m.traits.windows.window, "large");
  assert.match(m.summary, /окна из B/);
});

test("«Б лучше всего, только терраса побольше» — основа B и пожелание по террасе", () => {
  const r = parseOptionReply("Б лучше всего, только терраса побольше");
  assert.deepEqual(r.picks, [{ letter: "B", features: "all" }]);
  assert.deepEqual(r.adjustments, [{ feature: "terrace", modifier: "bigger" }]);
  const m = mergeChoice(styleOptions(), r)!;
  assert.equal(m.base, "B");
  const p = base();
  const plan = choiceToCommands(p, m);
  assert.ok(plan.wishes.includes("терраса побольше"));
  assert.ok(plan.commands.some((c) => c.op === "set_finish" && c.finishId === "flat-green"));
});

test("«Б, но окна как в А» и латинская «C» — разбор без путаницы с союзами", () => {
  const r = parseOptionReply("Б, но окна как в А");
  assert.deepEqual(r.picks, [
    { letter: "B", features: "all" },
    { letter: "A", features: ["windows"] },
  ]);
  const m = mergeChoice(styleOptions(), r)!;
  assert.equal(m.base, "B");
  assert.equal(m.traits.windows.from, "A");
  assert.deepEqual(parseOptionReply("C").picks, [{ letter: "C", features: "all" }]);
  assert.deepEqual(parseOptionReply("а терраса побольше").picks, []);
  assert.deepEqual(parseOptionReply("вариант в, рамы из а").picks, [
    { letter: "C", features: "all" },
    { letter: "A", features: ["frames"] },
  ]);
});

test("выбор по карточкам применяется командами через движок правил", () => {
  const p = base();
  const m = mergeChoice(styleOptions(), parseOptionReply("из А крышу, из Б окна"))!;
  let work = p;
  for (const c of choiceToCommands(p, m).commands) {
    const r = applyCommand(work, c);
    assert.ok(r.ok || r.reason, "отказ объяснён");
    if (r.ok) work = r.project;
  }
  assert.equal(work.finishes.roof, "flat-membrane");
  assert.equal(choiceToCommands(p, mergeChoice(styleOptions(), parseOptionReply("C"))!).tiers, 2);
});

// ── Нейросеть-архитектор ────────────────────────────────────────────────

const BRIEF: Brief = {
  bedrooms: 1,
  bathrooms: 1,
  tiers: 1,
  kitchenLiving: "compact",
  yearRound: true,
  plot: { widthM: 30, depthM: 30 },
};
const GOOD: LayoutJson = {
  intent: "компактный",
  precedent: "Weekend One",
  why: "две ячейки общей комнаты на юг",
  cubes: [
    { col: 0, row: 0, tier: 1, room: "k" },
    { col: 1, row: 0, tier: 1, room: "k" },
    { col: 0, row: 1, tier: 1, room: "bed" },
    { col: 1, row: 1, tier: 1, room: "wet" },
  ],
  rooms: [
    { id: "k", type: "kitchen-living" },
    { id: "bed", type: "bedroom" },
    { id: "wet", type: "wet-core" },
  ],
};
const ZIGZAG: LayoutJson = {
  ...GOOD,
  cubes: [
    { col: 0, row: 0, tier: 1, room: "k" },
    { col: 0, row: 1, tier: 1, room: "k" },
    { col: 1, row: 2, tier: 1, room: "bed" },
    { col: 2, row: 3, tier: 1, room: "wet" },
  ],
};

test("раскладка нейросети → Project и проверка правилами; зигзаг отклоняется со словами", () => {
  const ok = checkLayout(GOOD, BRIEF);
  assert.equal(ok.valid, true, [...ok.violations, ...ok.programGaps].join("; "));
  assert.equal(layoutToProject(GOOD, BRIEF).modules.length, 4);
  const bad = checkLayout(ZIGZAG, BRIEF);
  assert.equal(bad.valid, false);
  assert.ok(bad.violations.length > 0);
  assert.equal(parseLayout({ cubes: [] }).ok, false);
  const gaps = checkLayout(GOOD, { ...BRIEF, bedrooms: 2 });
  assert.ok(gaps.programGaps.some((g) => /Спален 1/.test(g)));
});

const reply = (l: unknown) => ({
  choices: [
    {
      message: {
        content: "",
        tool_calls: [
          { id: "t1", function: { name: "propose_layout", arguments: JSON.stringify(l) } },
        ],
      },
    },
  ],
  usage: { total_tokens: 100 },
});

test("цикл ремонта: нарушения уходят модели, со второй попытки раскладка проходит", async () => {
  const sent: unknown[] = [];
  let n = 0;
  const r = await designLayout(BRIEF, {
    intent: "тест",
    model: "fake",
    chat: async (body) => {
      sent.push(body);
      return reply(n++ === 0 ? ZIGZAG : GOOD);
    },
  });
  assert.equal(r.valid, true);
  assert.equal(r.attempts, 2);
  assert.equal(r.fallback, false);
  assert.equal(r.tokens, 200);
  assert.ok(r.precedentMentioned);
  const second = sent[1] as { messages: { role: string; content: string }[] };
  assert.ok(second.messages.some((m) => m.role === "tool" && /отклонил/.test(m.content)));
});

test("не уложилась в правила за 3 попытки — честный откат на солвер", async () => {
  const r = await designLayout(BRIEF, {
    intent: "тест",
    model: "fake",
    chat: async () => reply(ZIGZAG),
  });
  assert.equal(r.valid, false);
  assert.equal(r.fallback, true);
  assert.equal(r.attempts, 3);
  assert.ok(r.project && r.project.modules.length >= 4);
  assert.ok(r.violations.length > 0);
});

// ── Критик ──────────────────────────────────────────────────────────────

test("критик: команды только проверенные, мусор отбрасывается; план уходит картинкой или SVG", async () => {
  const parsed = parseCritic(
    'Вот: {"score": 7, "verdict": "Неплохо", "notes": ["вход через кухню"], "commands": [{"op":"move_terrace","side":"S"},{"op":"explode"}]}',
  );
  assert.equal(parsed.score, 7);
  assert.equal(parsed.commands.length, 1);
  assert.equal(parsed.rejected.length, 1);
  let seen: { messages: { content: { type: string }[] }[] } | null = null;
  const r = await criticReview(base(), {
    model: "fake",
    chat: async (body) => {
      seen = body as typeof seen;
      return {
        choices: [
          { message: { content: '{"score":8,"verdict":"Хорошо","notes":[],"commands":[]}' } },
        ],
      };
    },
  });
  assert.equal(r.verdict, "Хорошо");
  const parts = seen!.messages[0].content.map((c) => c.type);
  assert.ok(parts.includes("image_url") || parts.filter((t) => t === "text").length >= 2);
});

test("план строкой SVG: подписи комнат и мебели", () => {
  const svg = planSvgString(base());
  assert.ok(svg.startsWith("<svg"));
  assert.match(svg, /Кухня-гостиная/);
  assert.match(svg, /ТВ/);
});

// ── Стиль, знания, цифры ────────────────────────────────────────────────

test("фирменный стиль: 7 рендеров слайдера описаны, профиль по умолчанию из каталога, база рендеров", () => {
  assert.equal(HERO_REFERENCES.length, 7);
  const prof = ecocubStyleProfile();
  for (const [cat, id] of Object.entries(prof.finishes))
    assert.ok(
      FINISHES.categories[cat as "facade"].some((f) => f.id === id),
      id,
    );
  const p = base();
  const v = viewSet(p).views[0];
  assert.ok(promptFor(p, v).includes(RENDER_STYLE_BASELINE));
});

test("знания под дом: слайдер, паттерны CUBAX, мировые прецеденты; проверка ссылки на прецедент", () => {
  const k = knowledgeFor(8, 1);
  assert.match(k, /слайдера/);
  assert.match(k, /CUBAX 74/);
  assert.ok(mentionsPrecedent("Сделал как в CUBAX 74 — две спальни спиной к спине"));
  assert.ok(mentionsPrecedent("по мотивам Family One"));
  assert.ok(!mentionsPrecedent("просто дом"));
});

test("промпт Льва: интервью, карточки, знания и бюджет с проектом и подключением", () => {
  const p = base();
  const prompt = systemPrompt(
    projectContext(p, {
      scenario: { adults: 2, kids: 1 },
      interview: interviewContext(startInterview(), { adults: 2, kids: 1 }),
      options: optionsContext(styleOptions()),
    }),
  );
  assert.match(prompt, /Интервью, шаг 1 из 7/);
  assert.match(prompt, /Карточки на экране/);
  assert.match(prompt, /Знания под этот дом/);
  assert.match(prompt, /Проект и подключение к сетям/);
  assert.match(prompt, /кубики × 9,25/);
  const line = budgetFor(p).lines.find((l) => l.id === "project-connection")!;
  assert.equal(line.min, 380_000);
  assert.equal(line.max, 470_000);
});
