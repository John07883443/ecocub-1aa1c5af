/**
 * «Архитектор Лев»: промпт, контекст проекта для LLM, инструменты и
 * детерминированные комментарии к ходам в редакторе. Геометрию ИИ не трогает —
 * только вызывает команды, которые проверяет движок правил.
 */
import { COMMAND_TOOLS, applyCommand, parseCommand } from "../engine/commands.ts";
import { factoryModules, trucksForCubes } from "../engine/factory.ts";
import { budgetFor } from "../engine/price.ts";
import { columnsFor, evaluate, roomClearAreaM2, warmContourM2 } from "../engine/rules.ts";
import type { Project } from "../engine/types.ts";
import type { LifeScenario } from "../engine/scenario.ts";
import { FINISHES, roomSpec } from "../grammar/index.ts";
import { tvPlace } from "../engine/tv.ts";
import { PILOT } from "../pilot.config.ts";

export const SCENARIO_TOOL = {
  type: "function",
  name: "set_scenario",
  description:
    "Записать в анкету то, что человек рассказал о жизни, и пересобрать 3 варианта дома. Передавай только то, что узнал или что изменилось — остальное в анкете сохранится. Вызывай сразу, как узнал новый факт (кто живёт, питомцы, родители, участок, площадь, бюджет, стиль).",
  parameters: {
    type: "object",
    properties: {
      plotSotki: { type: "number", description: "Участок в сотках (1 сотка = 100 м²)" },
      plotWidthM: { type: "number" },
      plotDepthM: { type: "number" },
      adults: { type: "integer", minimum: 1, maximum: 6 },
      kids: { type: "integer", minimum: 0, maximum: 6 },
      kidsShareRoom: { type: "boolean" },
      dogs: { type: "integer", minimum: 0 },
      cats: { type: "integer", minimum: 0 },
      otherPets: { type: "integer", minimum: 0 },
      elderly: {
        type: "string",
        enum: ["none", "live", "visit"],
        description: "Пожилые родители: живут с нами (live) или приезжают в гости (visit)",
      },
      elderlyCount: { type: "integer", enum: [1, 2] },
      workFromHome: { type: "integer", minimum: 0 },
      guestsOften: { type: "boolean" },
      sauna: { type: "boolean" },
      storageLots: { type: "boolean" },
      car: { type: "boolean" },
      tiers: { type: "string", enum: ["1", "2", "any"] },
      desiredAreaMaxM2: { type: "integer" },
      budgetMaxRub: { type: "integer" },
      style: { type: "string", description: "Стиль словами, если назван" },
    },
    required: [],
  },
} as const;

export const WHAT_IF_TOOL = {
  type: "function",
  name: "what_if",
  description:
    "Посчитать «а если…» без изменения дома: убрать/добавить помещение или изменить размер — вернёт площадь, кубики, тралы и бюджет до и после. Для вопросов «а если убрать спальню, сколько выйдет?».",
  parameters: {
    type: "object",
    properties: {
      op: { type: "string", enum: ["remove_room", "add_room", "resize_room"] },
      roomId: { type: "string" },
      room: { type: "string", enum: ["bedroom", "study", "wet-core"] },
      modules: { type: "integer", minimum: 1, maximum: 5 },
      tier: { type: "integer", enum: [1, 2] },
    },
    required: ["op"],
  },
} as const;

export const SELECT_TOOL = {
  type: "function",
  name: "select_variant",
  description: "Выбрать вариант 1, 2 или 3 для правки.",
  parameters: {
    type: "object",
    properties: { index: { type: "integer", minimum: 1, maximum: 3 } },
    required: ["index"],
  },
} as const;

export const ALL_TOOLS = [SCENARIO_TOOL, SELECT_TOOL, WHAT_IF_TOOL, ...COMMAND_TOOLS];

const clampInt = (v: unknown, min: number, max: number): number | undefined => {
  if (v === undefined || v === null || v === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(min, Math.min(max, Math.round(n))) : undefined;
};
const bool = (v: unknown): boolean | undefined =>
  typeof v === "boolean" ? v : v === "true" ? true : v === "false" ? false : undefined;

/**
 * Аргументы set_scenario от модели → новая анкета. Только проверенные значения,
 * всё неизвестное остаётся как было: Лев дописывает факты, а не стирает форму.
 */
export function mergeScenario(cur: LifeScenario, args: Record<string, unknown>): LifeScenario {
  const a = args ?? {};
  const s: LifeScenario = { ...cur, pets: { ...cur.pets } };
  const adults = clampInt(a.adults, 1, 6);
  if (adults !== undefined) s.adults = adults;
  const kids = clampInt(a.kids, 0, 6);
  if (kids !== undefined) s.kids = kids;
  const share = bool(a.kidsShareRoom);
  if (share !== undefined) s.kidsShareRoom = share;
  const dogs = clampInt(a.dogs, 0, 5);
  if (dogs !== undefined) s.pets = { ...s.pets, dogs };
  const cats = clampInt(a.cats, 0, 5);
  if (cats !== undefined) s.pets = { ...s.pets, cats };
  const other = clampInt(a.otherPets, 0, 5);
  if (other !== undefined) s.pets = { ...s.pets, other };
  if (a.elderly === "none") s.elderly = undefined;
  else if (a.elderly === "live" || a.elderly === "visit")
    s.elderly = {
      mode: a.elderly,
      count: Number(a.elderlyCount ?? cur.elderly?.count ?? 1) === 2 ? 2 : 1,
    };
  else if (a.elderlyCount !== undefined && cur.elderly)
    s.elderly = { ...cur.elderly, count: Number(a.elderlyCount) === 2 ? 2 : 1 };
  const wfh = clampInt(a.workFromHome, 0, 4);
  if (wfh !== undefined) s.workFromHome = wfh;
  for (const k of ["guestsOften", "sauna", "car"] as const) {
    const b = bool(a[k]);
    if (b !== undefined) s[k] = b;
  }
  const lots = bool(a.storageLots);
  if (lots !== undefined) s.storage = lots ? "lots" : "normal";
  if (a.tiers === "1" || a.tiers === 1) s.tiers = 1;
  else if (a.tiers === "2" || a.tiers === 2) s.tiers = 2;
  else if (a.tiers === "any") s.tiers = "any";
  const area = clampInt(a.desiredAreaMaxM2, 20, 400);
  if (area !== undefined) s.desiredAreaM2 = { min: 0, max: area };
  const budget = clampInt(a.budgetMaxRub, 500_000, 200_000_000);
  if (budget !== undefined) s.budgetRub = { min: 0, max: budget };
  if (typeof a.style === "string" && a.style.trim()) s.styleHints = [a.style.trim().slice(0, 200)];
  // Участок: явные размеры или сотки → прямоугольник 1:1,4 (типовая нарезка).
  const sotki = Number(a.plotSotki);
  const w = Number(a.plotWidthM);
  const d = Number(a.plotDepthM);
  if (Number.isFinite(w) && Number.isFinite(d) && w >= 8 && d >= 8 && w <= 500 && d <= 500)
    s.plot = { ...(cur.plot ?? {}), widthM: Math.round(w), depthM: Math.round(d) };
  else if (a.plotSotki !== undefined && Number.isFinite(sotki) && sotki >= 2 && sotki <= 500) {
    const width = Math.round(Math.sqrt((sotki * 100) / 1.4));
    s.plot = { ...(cur.plot ?? {}), widthM: width, depthM: Math.round((sotki * 100) / width) };
  }
  return s;
}

/** Что уже известно из анкеты — словами, чтобы Лев не переспрашивал. */
export function scenarioContext(s: LifeScenario | null | undefined): string {
  if (!s) return "Анкета пуста.";
  const known: string[] = [];
  known.push(`взрослых ${s.adults}, детей ${s.kids}${s.kidsShareRoom ? " (в одной комнате)" : ""}`);
  const pets = [
    s.pets?.dogs ? `собак ${s.pets.dogs}` : "",
    s.pets?.cats ? `кошек ${s.pets.cats}` : "",
    s.pets?.other ? `других питомцев ${s.pets.other}` : "",
  ].filter(Boolean);
  known.push(pets.length ? `питомцы: ${pets.join(", ")}` : "питомцев нет");
  known.push(
    s.elderly
      ? `пожилые родители: ${s.elderly.mode === "live" ? "живут с нами" : "приезжают в гости"}, ${s.elderly.count} чел.`
      : "пожилых родителей в доме нет",
  );
  known.push(s.workFromHome ? `работают из дома: ${s.workFromHome}` : "из дома не работают");
  known.push(s.guestsOften ? "гости часто" : "гости нечасто");
  if (s.sauna) known.push("нужна сауна");
  if (s.storage === "lots") known.push("много хранения");
  known.push(s.car ? "есть машина — навес на участке" : "машины нет");
  known.push(
    `этажность: ${s.tiers === 1 ? "один ярус" : s.tiers === 2 ? "два яруса" : "не важно"}`,
  );
  if (s.desiredAreaM2?.max) known.push(`площадь до ${s.desiredAreaM2.max} м²`);
  const missing: string[] = [];
  if (s.budgetRub?.max)
    known.push(`бюджет до ${(s.budgetRub.max / 1e6).toLocaleString("ru-RU")} млн ₽`);
  else missing.push("бюджет");
  if (s.plot)
    known.push(
      `участок ${s.plot.widthM} × ${s.plot.depthM} м (${Math.round((s.plot.widthM * s.plot.depthM) / 100)} сот.)`,
    );
  else missing.push("участок");
  if (s.styleHints?.length) known.push(`стиль: ${s.styleHints.join(", ")}`);
  else missing.push("стиль и вкус");
  return [
    `Анкета (уже известно — НЕ переспрашивай, коротко подтверди): ${known.join("; ")}.`,
    missing.length
      ? `Не хватает: ${missing.join(", ")} — спрашивай по одному вопросу.`
      : "Анкета заполнена.",
  ].join("\n");
}

/** «А если…» — применить команду к копии дома и сравнить цифры. Дом не меняется. */
export function whatIf(p: Project | null, args: Record<string, unknown>): string {
  if (!p) return "Дом ещё не собран — сначала соберите варианты.";
  const parsed = parseCommand({ ...args });
  if (!parsed.ok) return `Не понял, что посчитать: ${parsed.error}.`;
  const res = applyCommand(p, parsed.command);
  if (!res.ok)
    return `Так нельзя: ${res.reason}. ${res.violations.slice(0, 2).join(" ")} ${res.suggestion ?? ""}`.trim();
  const fmt = (q: Project) => {
    const b = budgetFor(q).total;
    return `${q.modules.length} кубиков, ${Math.round(warmContourM2(q))} м², ${trucksForCubes(q.modules.length)} трала, ${fmtMln(b.min)}–${fmtMln(b.max)} млн ₽`;
  };
  const bb = budgetFor(p).total;
  const ba = budgetFor(res.project).total;
  const d = (ba.min + ba.max - bb.min - bb.max) / 2;
  return `Сейчас: ${fmt(p)}. Если так: ${fmt(res.project)} (${d >= 0 ? "+" : "−"}${fmtMln(Math.abs(d))} млн ₽ к середине вилки, предварительно). Дом не менял — скажите «делаем», и применю.`;
}

/** Формат инструментов для chat/completions (OpenAI-совместимый). */
export function chatTools() {
  return ALL_TOOLS.map((t) => ({
    type: "function",
    function: { name: t.name, description: t.description, parameters: t.parameters },
  }));
}

/** Формат для InWorld Realtime (session.update). */
export function realtimeTools() {
  return ALL_TOOLS.map((t) => ({
    type: "function",
    name: t.name,
    description: t.description,
    parameters: t.parameters,
  }));
}

/**
 * Знания архитектора — блок из ECOCUB/docs/ARCHITECT_KNOWLEDGE_WORLD_2026-10-01.md (раздел 4):
 * компактная форма, путь человека, зонирование, кухня-гостиная, свет, вода, порог, бетон, нормы.
 * Те же пороги проверяет движок правил (rules.ts, patterns.ts), Лев на них ссылается.
 */
export const ARCHITECT_KNOWLEDGE = `Ты — архитектор ЭкоКуба. Ты не раскладываешь кубы, ты проектируешь дом,
в котором будут жить люди. Думай так, как думает архитектор.

Материал: бетонная ячейка 3,2×3,42 м (в чистоте 2,78×3,0), модуль — 2 ячейки,
максимум 2 яруса, верхний может выноситься на 1,5 м (3 м с колонной).

1. Сначала форма целиком. Ищи компактный объём: прямоугольник, два ряда ячеек,
Г или П вокруг двора. Заполнение описанного прямоугольника не меньше 75 %,
углов контура не больше 8, пропорция не длиннее 1:2,2. Хорошие блоки:
2×3 (≈ золотое сечение), 3×2 (≈ √2), 3×3. Зигзаг и «змейка» — ошибка.

2. Путь человека. Улица → навес → прихожая с шкафом → общая зона → холл →
спальни. Каждой комнате нарисуй дверь. Спальня никогда не проходная и не
открывается в прихожую. Коридоры короткие, не больше 10–12 % площади.

3. День и ночь врозь: крыльями или ярусами (низ — день, верх — ночь).

4. Сердце дома — кухня-гостиная шириной минимум в две ячейки, со светом
с двух сторон и выходом на террасу. Гостиная в одну ячейку — запрещена.

5. Солнце и вид. Гостиная на юг или на вид, кухня на восток, спальни на
восток, санузлы, лестница, кладовые — на север. Если есть лес или вода —
главное стекло на вид.

6. Вода в одном месте: санузлы, кухня, постирочная, котельная — рядом,
на втором ярусе строго друг над другом.

7. Порог в сад: терраса под консолью или навесом, крыша нижнего яруса —
терраса верхнего. Пустая ячейка внутри контура — это дворик, а не дыра.

8. Бетон по Андо: тяжёлая стена прячет от лишнего и впускает свет
дозированно. Свет вдоль стены через щель на стыке ячеек, глубокий откос
становится скамьёй у окна, масса бетона копит тепло южного солнца.
Окна по сетке, головы проёмов на одной высоте, на фасаде одна доминанта.

9. Размеры по человеку (Модулор): 0,43 сиденье, 0,70 стол и подоконник,
0,86 столешница, 2,26 верх проёма. Нормы СП 55: спальня от 8 м², кухня от
6 м² и шириной от 1,7 м, прихожая от 1,4 м, коридор от 0,85 м.

10. Люди разные: для пожилых — спальня и санузел на первом ярусе, вход без
ступеней, двери 0,9 м. Для собак — тамбур с мойкой у двери во двор.
Хранение — не меньше 8 % площади, шкафы между комнатами.

Перед ответом проверь себя по этим пунктам. Если план не проходит —
переделай его молча и покажи лучший. Меньше, но точнее; простая форма,
одна сильная идея, свет как главный материал.`;

/** Миссия Льва — первая строка промпта (формулировка владельца 01.10.2026). */
export const LEV_MISSION =
  "Твоя главная задача — постепенно, вопрос за вопросом, узнавать клиента и рисовать ему дом мечты на технической базе ЭкоКуба: только реальные кубики 3200×3420, заводские модули по 2 кубика, до 2 ярусов, свесы в допустимых пределах. Всё, что ты предлагаешь, должно быть реально построимо.";

export function systemPrompt(context: string): string {
  return `${LEV_MISSION}

Ты — ${PILOT.architect.name}, архитектор компании ЭкоКуб: модульные дома из кубиков 3200 × 3420 мм (заводской модуль — 2 кубика, трал везёт 4 кубика).
Говоришь по-русски, коротко (1–3 фразы), тепло и по делу, как живой архитектор. Помогаешь обычному человеку собрать реальный дом.

Правила:
- В контексте ниже есть «Анкета» — то, что человек уже заполнил. Не переспрашивай известное: одной фразой подтверди («вижу: вас трое, три кошки, родители приезжают, есть машина») и спроси то, чего не хватает (бюджет, участок, стиль) — по одному вопросу.
- Узнал новый факт или человек что-то поправил — сразу вызови set_scenario только с изменившимися полями: анкета и варианты обновятся на экране.
- Вопросы про цифры (кубики, модули, тралы, кран, фундамент, отделка, итог) — отвечай по «Бюджету по статьям» из контекста. «А если убрать/добавить…» — вызови what_if: дом не меняется, пока человек не скажет «делаем».
- Геометрию сам не придумывай: только вызывай инструменты. Результат инструмента — правда; если отказ — объясни причину человеческим языком и предложи исправление из ответа.
- Стороны дома: N север, E восток, S юг, W запад. «Здесь / на этой стороне» — смотри «выбранная стена» в контексте.
- Попроси референсы или скриншоты понравившихся домов и интерьеров — «можно вставить прямо сюда» (разбор картинок появится позже).
- Не называй точную цену — только вилку «предварительно».
- В общей комнате всегда есть место под ТВ: глухая стена от 2,4 м, диван в 2,5–3,5 м, без панорамы за спиной зрителя (правило проверяет движок).
- По умолчанию держимся фирменного стиля ЭкоКуба — как построенные Weekend One/Two, Family One/Two, Sky River (eco-cub.ru/portfolio): бетонные кубы чистой геометрии, потолки 3,15 м, панорамное остекление общей комнаты, плоская (часто эксплуатируемая) кровля, гардеробные у спален, терраса с зоной барбекю; Family Two — премиальный Hi-Tech. Отходи от фирменного стиля осознанно — когда человек сам просит другое. Предлагая решение, ссылайся на наш построенный проект («как в Family One…»).
- Кровля всегда плоская, ярусов не больше двух, свес второго яруса до 1,5 м без колонны и до 3 м с колонной.

Архитектурные знания (проверяются движком правил — ссылайся на них, когда объясняешь отказ или совет):
${ARCHITECT_KNOWLEDGE}

Текущее состояние:
${context}`;
}

export function projectContext(
  p: Project | null,
  extra: { selectedWall?: string; variants?: string[]; scenario?: LifeScenario | null } = {},
): string {
  const form = extra.scenario !== undefined ? scenarioContext(extra.scenario) : "";
  if (!p) return [form, "Дом ещё не собран. Варианты: нет."].filter(Boolean).join("\n");
  const fm = factoryModules(p);
  const b = budgetFor(p);
  const rooms = p.rooms
    .map((r) => {
      const faces = [
        ...new Set(
          p.openings.filter((o) => o.roomId === r.id && o.kind === "window").map((o) => o.face),
        ),
      ].join("");
      return `${r.id} (${roomSpec(r.type).label}, ярус ${r.tier}, ${roomClearAreaM2(p, r)} м², окна: ${faces || "нет"})`;
    })
    .join("; ");
  const style = FINISHES.styles.find((s) => s.id === p.finishes.styleId)?.label ?? "свой";
  const lines = b.lines
    .map(
      (l) =>
        `${l.label}: ${fmtMln(l.min)}–${fmtMln(l.max)} млн${l.placeholder ? " (черновик)" : ""}${l.basis ? ` — ${l.basis}` : ""}`,
    )
    .join("; ");
  return [
    form,
    extra.variants?.length ? `Варианты: ${extra.variants.join(" | ")}` : "",
    `Выбранный дом: ${p.modules.length} кубиков (${fm.modules.length} модулей), ${Math.round(warmContourM2(p))} м², ${trucksForCubes(p.modules.length)} трала, стиль ${style}.`,
    `Помещения: ${rooms}.`,
    `Терраса: ${p.terrace.totalM2} м² на стороне ${p.terrace.side}.`,
    `Бюджет предварительно: ${(b.total.min / 1e6).toFixed(1)}–${(b.total.max / 1e6).toFixed(1)} млн ₽.`,
    `Бюджет по статьям (тот же расчёт, что в «Паспорт и бюджет»): ${lines}.`,
    extra.selectedWall ? `Выбранная стена: ${extra.selectedWall}.` : "Стена не выбрана.",
  ]
    .filter(Boolean)
    .join("\n");
}

const fmtMln = (n: number) => (n / 1e6).toLocaleString("ru-RU", { maximumFractionDigits: 1 });

/** Комментарий архитектора к ходу: что поменялось в правилах, цене, тралах. Без LLM — мгновенно. */
export function commentOn(before: Project, after: Project): string[] {
  const out: string[] = [];
  const eb = evaluate(before);
  const ea = evaluate(after);
  const softBefore = new Set(
    eb.results.filter((r) => r.level === "soft" && !r.ok).map((r) => r.message),
  );
  const softAfter = ea.results.filter((r) => r.level === "soft" && !r.ok);
  for (const r of softAfter)
    if (!softBefore.has(r.message)) out.push(`⚠ ${r.message} (правило: ${r.source})`);
  const fixed = eb.results.filter(
    (r) => r.level === "soft" && !r.ok && !ea.results.some((x) => x.message === r.message && !x.ok),
  );
  for (const r of fixed)
    out.push(
      `✓ Стало лучше: ${r.message.replace(/^Спальня с одной/, "спальня больше не с одной")}`,
    );
  const bb = budgetFor(before).total;
  const ba = budgetFor(after).total;
  const d = (ba.min + ba.max - bb.min - bb.max) / 2;
  if (Math.abs(d) >= 50_000)
    out.push(`${d > 0 ? "+" : "−"}${fmtMln(Math.abs(d))} млн ₽ к середине вилки.`);
  const tb = trucksForCubes(before.modules.length);
  const ta = trucksForCubes(after.modules.length);
  if (tb !== ta) out.push(`Тралов: ${tb} → ${ta}.`);
  const cb = columnsFor(before);
  const ca = columnsFor(after);
  if (ca !== cb)
    out.push(ca > cb ? `Под свесом нужны колонны: ${ca}.` : "Колонны больше не нужны.");
  const ub = factoryModules(before).unpairedCubeIds.length;
  const tvb = tvPlace(before);
  const tva = tvPlace(after);
  if (tva && (!tvb || tvb.face !== tva.face || tvb.moduleId !== tva.moduleId))
    out.push(
      `ТВ: глухая стена ${((tva.wall[1] - tva.wall[0]) / 1000).toFixed(1)} м${tva.interior ? " (внутренняя, без бликов)" : ""}, до дивана ${(tva.viewingMm / 1000).toFixed(1)} м.`,
    );
  const ua = factoryModules(after).unpairedCubeIds.length;
  if (ua > ub)
    out.push("Появился кубик без пары — завод делает модули по 2 кубика, проверит проектировщик.");
  if (ua < ub) out.push("Все кубики теперь собираются в заводские модули по 2.");
  return out;
}
