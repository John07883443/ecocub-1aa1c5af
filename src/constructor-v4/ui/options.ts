/**
 * Варианты A/B/C: карточки с буквой, картинкой и структурным описанием, и разбор
 * свободных реплик со ссылками на них — «из А крышу, из Б окна», «Б лучше всего,
 * только терраса побольше», «Б, но окна как в А». Без React: тестируется в node.
 *
 * Варианты отклоняются от фирменного стиля ЭкоКуба осознанно (house-style.ts):
 * A — сам фирменный стиль, B — теплее и деревяннее, C — бетон и консоль.
 */
import type { EditorCommand } from "../engine/commands.ts";
import { presetOf, type WindowPreset } from "../engine/derive.ts";
import type { FinishCategory } from "../grammar/index.ts";
import { HERO_REFERENCES } from "../engine/house-style.ts";
import type { Project } from "../engine/types.ts";

export type Letter = "A" | "B" | "C";
export const LETTERS: Letter[] = ["A", "B", "C"];
export type Feature = "roof" | "windows" | "facade" | "frames" | "interior" | "terrace" | "layout";

export interface Trait {
  label: string;
  finish?: { category: FinishCategory; id: string };
  window?: WindowPreset;
  /** layout: этажность для пересборки. */
  tiers?: 1 | 2;
  /** terrace: где и какая. */
  terrace?: string;
}

export interface OptionCard {
  letter: Letter;
  title: string;
  image?: string;
  summary: string;
  styleId: string;
  tags: string[];
  traits: Record<Feature, Trait>;
}

export const FEATURE_RU: Record<Feature, string> = {
  roof: "кровля",
  windows: "окна",
  facade: "фасад",
  frames: "рамы",
  interior: "интерьер",
  terrace: "терраса",
  layout: "форма дома",
};

const hero = (id: string) => HERO_REFERENCES.find((h) => h.id === id)?.image;

/** Три варианта стиля: фирменный и два осознанных отклонения. */
export function styleOptions(): OptionCard[] {
  return [
    {
      letter: "A",
      title: "Фирменный ЭкоКуб",
      image: hero("hero-1"),
      summary:
        "Белая штукатурка, ламели из лиственницы, окна в пол, навес над террасой во всю длину",
      styleId: "ecocub",
      tags: ["фирменный", "белый", "ламели", "окна в пол"],
      traits: {
        roof: {
          label: "плоская, тонкая плита с навесом",
          finish: { category: "roof", id: "flat-membrane" },
        },
        windows: { label: "панорама в пол", window: "floor-to-ceiling" },
        facade: { label: "белая штукатурка", finish: { category: "facade", id: "plaster-white" } },
        frames: { label: "графит", finish: { category: "windowFrames", id: "frame-graphite" } },
        interior: {
          label: "светлый дуб и белый",
          finish: { category: "interior", id: "interior-light-oak" },
        },
        terrace: { label: "во всю длину фасада", terrace: "во всю длину" },
        layout: { label: "один ярус, вытянутый", tiers: 1 },
      },
    },
    {
      letter: "B",
      title: "Тёплое дерево",
      image: hero("hero-4"),
      summary:
        "Планкен из лиственницы, зелёная кровля, большие окна в деревянной раме, терраса в углу",
      styleId: "scandi",
      tags: ["дерево", "тепло", "зелёная кровля", "Г-план"],
      traits: {
        roof: { label: "зелёная кровля", finish: { category: "roof", id: "flat-green" } },
        windows: { label: "большие окна 2800", window: "large" },
        facade: {
          label: "планкен лиственница",
          finish: { category: "facade", id: "planken-larch" },
        },
        frames: {
          label: "дерево-алюминий",
          finish: { category: "windowFrames", id: "frame-wood-alu" },
        },
        interior: {
          label: "тёплое дерево",
          finish: { category: "interior", id: "interior-warm-wood" },
        },
        terrace: { label: "угловая, в развороте Г", terrace: "угловая" },
        layout: { label: "один ярус, Г-план", tiers: 1 },
      },
    },
    {
      letter: "C",
      title: "Бетон и консоль",
      image: hero("hero-7"),
      summary: "Два яруса, верхний нависает консолью, бетон под опалубку, эксплуатируемая кровля",
      styleId: "concrete",
      tags: ["бетон", "два яруса", "консоль", "эксплуатируемая кровля"],
      traits: {
        roof: {
          label: "эксплуатируемая с настилом",
          finish: { category: "roof", id: "flat-exploitable-deck" },
        },
        windows: { label: "панорама в пол", window: "floor-to-ceiling" },
        facade: {
          label: "фиброцемент под бетон",
          finish: { category: "facade", id: "fiber-cement" },
        },
        frames: { label: "чёрные", finish: { category: "windowFrames", id: "frame-black" } },
        interior: {
          label: "микроцемент и графит",
          finish: { category: "interior", id: "interior-concrete" },
        },
        terrace: { label: "под консолью второго яруса", terrace: "под консолью" },
        layout: { label: "два яруса с консолью", tiers: 2 },
      },
    },
  ];
}

// ── Разбор ссылок ──────────────────────────────────────────────────────

export type Modifier = "bigger" | "smaller" | "darker" | "lighter";

export interface Pick {
  letter: Letter;
  /** "all" — вариант целиком. */
  features: Feature[] | "all";
}

export interface Adjustment {
  feature: Feature;
  modifier: Modifier;
}

export interface ParsedReply {
  picks: Pick[];
  adjustments: Adjustment[];
}

const FEATURE_WORDS: [Feature, RegExp][] = [
  ["roof", /крыш|кровл/],
  ["frames", /рам[аыуе]?\b|рамы|рамк/],
  ["windows", /окн|окош|остеклен|панорам|стекл/],
  ["facade", /фасад|отделк|облицов|стен|цвет|материал|дерев|бетон|штукатур/],
  ["interior", /интерьер|внутри/],
  ["terrace", /террас|веранд|настил/],
  ["layout", /планиров|форм|ярус|этаж|консол/],
];

const MOD_WORDS: [Modifier, RegExp][] = [
  ["bigger", /побольше|больше|шире|длиннее|крупнее|просторн/],
  ["smaller", /поменьше|меньше|уже\b|короче/],
  ["darker", /темнее|потемнее|тёмн|темн/],
  ["lighter", /светлее|посветлее|светл/],
];

const norm = (t: string) => t.toLowerCase().replace(/ё/g, "е");

/** Буква варианта в отрезке: латиница/кириллица, «вариант б», «из а», «как в б», «бэ», «цэ». */
function letterIn(clause: string, leading: boolean): Letter | null {
  const L = "(a|а|b|б|бэ|би|c|с|в|вэ|цэ|си)";
  const map = (x: string): Letter =>
    /^(a|а)$/.test(x) ? "A" : /^(b|б|бэ|би)$/.test(x) ? "B" : "C";
  // После маркеров: «из А», «вариант Б», «как в А», «у Б», «карточка В», «буква С».
  const marked = new RegExp(
    `(?:^|[^а-яa-z])(?:из|вариант[ау]?|как\\s+в|как\\s+у|у|карточк[аиуе]|букв[аыу]|в\\s+варианте)\\s+${L}(?![а-яa-z])`,
  ).exec(clause);
  if (marked) return map(marked[1]);
  // В начале реплики: «Б, …», «Б лучше всего», «А!» — но не союз «а …» в середине.
  if (leading) {
    const lead = new RegExp(`^\\s*${L}(?![а-яa-z])`).exec(clause);
    if (
      lead &&
      !(lead[1] === "а" && /^\s*а\s+[а-я]/.test(clause) && !/^\s*а\s*[,.!:-]/.test(clause))
    )
      return map(lead[1]);
  }
  // Латинская заглавная буква где угодно (карточки подписаны A/B/C).
  return null;
}

/** Разобрать реплику человека со ссылками на карточки A/B/C. */
export function parseOptionReply(text: string): ParsedReply {
  const raw = text.trim();
  // Латинские A/B/C как отдельные слова — однозначно карточки (до приведения к нижнему регистру).
  const t = norm(raw).replace(/\b([abc])\b/g, (m) => m);
  const clauses = t
    .split(/[,;.!?]|\s+но\s+|\s+только\s+|\s+а\s+(?=[а-я]+\s+(?:из|как|у)\b)|\s+и\s+(?=из\s)/)
    .map((c) => c.trim())
    .filter(Boolean);
  const picks: Pick[] = [];
  const adjustments: Adjustment[] = [];
  clauses.forEach((c, i) => {
    const letter = letterIn(c, i === 0 || /^(из|вариант|как)\b/.test(c));
    const features = FEATURE_WORDS.filter(([, re]) => re.test(c)).map(([f]) => f);
    // «рамы» не считаем ещё и «окнами».
    const feats = features.includes("frames") ? features.filter((f) => f !== "windows") : features;
    const mod = MOD_WORDS.find(([, re]) => re.test(c))?.[0];
    if (letter) {
      if (feats.length && !/лучше всего|целиком|полностью|весь|всё|все\b/.test(c))
        picks.push({ letter, features: feats });
      else picks.push({ letter, features: "all" });
      if (mod && feats.length)
        for (const f of feats) adjustments.push({ feature: f, modifier: mod });
    } else if (mod && feats.length) {
      for (const f of feats) adjustments.push({ feature: f, modifier: mod });
    }
  });
  return { picks, adjustments };
}

export interface MergedChoice {
  base: Letter;
  traits: Record<Feature, Trait & { from: Letter }>;
  adjustments: Adjustment[];
  /** Человеку и Льву: что из чего взято. */
  summary: string;
}

/** Слить выбор: основа — вариант «целиком» (или первый названный), поверх — отдельные черты. */
export function mergeChoice(options: OptionCard[], reply: ParsedReply): MergedChoice | null {
  if (!reply.picks.length && !reply.adjustments.length) return null;
  const byLetter = (l: Letter) => options.find((o) => o.letter === l) ?? options[0];
  const base =
    reply.picks.find((p) => p.features === "all")?.letter ?? reply.picks[0]?.letter ?? "A";
  const b = byLetter(base);
  const traits = Object.fromEntries(
    (Object.keys(b.traits) as Feature[]).map((f) => [f, { ...b.traits[f], from: base }]),
  ) as MergedChoice["traits"];
  for (const p of reply.picks) {
    if (p.features === "all") continue;
    const o = byLetter(p.letter);
    for (const f of p.features) traits[f] = { ...o.traits[f], from: p.letter };
  }
  const parts = (Object.keys(traits) as Feature[])
    .filter((f) => traits[f].from !== base)
    .map((f) => `${FEATURE_RU[f]} из ${traits[f].from} (${traits[f].label})`);
  const adj = reply.adjustments.map(
    (a) =>
      `${FEATURE_RU[a.feature]} ${{ bigger: "побольше", smaller: "поменьше", darker: "темнее", lighter: "светлее" }[a.modifier]}`,
  );
  return {
    base,
    traits,
    adjustments: reply.adjustments,
    summary: [`основа — ${base} «${b.title}»`, ...parts, ...adj].join(", "),
  };
}

/** Выбор → команды редактора (проверяет движок правил) + пожелания для паспорта и Льва. */
export function choiceToCommands(
  p: Project,
  choice: MergedChoice,
): { commands: EditorCommand[]; tiers?: 1 | 2; wishes: string[] } {
  const commands: EditorCommand[] = [];
  for (const f of ["facade", "roof", "frames", "interior"] as Feature[]) {
    const fin = choice.traits[f].finish;
    if (fin && p.finishes[fin.category] !== fin.id)
      commands.push({ op: "set_finish", category: fin.category, finishId: fin.id });
  }
  const preset = choice.traits.windows.window;
  const k = p.rooms.find((r) => r.type === "kitchen-living");
  if (preset && k) {
    // Только стены, где окна ещё не такие: иначе движок честно ответит «и так такой».
    const sides = new Set(
      p.openings
        .filter((o) => o.roomId === k.id && o.kind === "window" && presetOf(o) !== preset)
        .map((o) => o.face),
    );
    for (const side of sides)
      commands.push({ op: "window", action: "set", side, roomId: k.id, preset });
  }
  const wishes: string[] = [];
  const terrace = choice.traits.terrace;
  if (terrace.terrace) wishes.push(`терраса ${terrace.terrace}`);
  for (const a of choice.adjustments)
    if (a.feature === "terrace" && a.modifier === "bigger") wishes.push("терраса побольше");
    else if (a.feature === "windows" && a.modifier === "bigger" && k)
      for (const side of new Set(
        p.openings.filter((o) => o.roomId === k.id && o.kind === "window").map((o) => o.face),
      ))
        commands.push({ op: "window", action: "enlarge", side, roomId: k.id });
    else wishes.push(`${FEATURE_RU[a.feature]}: ${a.modifier}`);
  const currentTiers = Math.max(...p.modules.map((m) => m.tier)) as 1 | 2;
  const tiers = choice.traits.layout.tiers;
  return { commands, tiers: tiers && tiers !== currentTiers ? tiers : undefined, wishes };
}

/** Карточки на экране — структурно для Льва: он понимает «крышу из А» и «окна как в Б». */
export function optionsContext(cards: OptionCard[] | null | undefined): string {
  if (!cards?.length) return "";
  return `Карточки на экране (человек ссылается на буквы): ${cards
    .map(
      (c) =>
        `${c.letter} «${c.title}»: ${(Object.keys(c.traits) as Feature[])
          .map((f) => `${FEATURE_RU[f]} — ${c.traits[f].label}`)
          .join(", ")}`,
    )
    .join(" | ")}.`;
}
