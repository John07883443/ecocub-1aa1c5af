/**
 * «Архитектор Лев»: промпт, контекст проекта для LLM, инструменты и
 * детерминированные комментарии к ходам в редакторе. Геометрию ИИ не трогает —
 * только вызывает команды, которые проверяет движок правил.
 */
import { COMMAND_TOOLS } from "../engine/commands.ts";
import { factoryModules, trucksForCubes } from "../engine/factory.ts";
import { budgetFor } from "../engine/price.ts";
import { columnsFor, evaluate, roomClearAreaM2, warmContourM2 } from "../engine/rules.ts";
import type { Project } from "../engine/types.ts";
import { FINISHES, roomSpec } from "../grammar/index.ts";
import { PILOT } from "../pilot.config.ts";

export const SCENARIO_TOOL = {
  type: "function",
  name: "set_scenario",
  description:
    "Записать сценарий жизни из разговора и собрать 3 варианта дома. Вызывай, когда понятно, кто живёт (взрослые, дети), и есть хотя бы примерная площадь или бюджет — или человек просит «собери».",
  parameters: {
    type: "object",
    properties: {
      adults: { type: "integer", minimum: 1, maximum: 6 },
      kids: { type: "integer", minimum: 0, maximum: 6 },
      kidsShareRoom: { type: "boolean" },
      dogs: { type: "integer", minimum: 0 },
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
    required: ["adults", "kids"],
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

export const ALL_TOOLS = [SCENARIO_TOOL, SELECT_TOOL, ...COMMAND_TOOLS];

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

export function systemPrompt(context: string): string {
  return `Ты — ${PILOT.architect.name}, архитектор компании ЭкоКуб: модульные дома из кубиков 3200 × 3420 мм (заводской модуль — 2 кубика, трал везёт 4 кубика).
Говоришь по-русски, коротко (1–3 фразы), тепло и по делу, как живой архитектор. Помогаешь обычному человеку собрать реальный дом.

Правила:
- Сначала расспроси о жизни: кто живёт (взрослые, дети), питомцы, работа из дома, гости, сауна, машина, примерная площадь или бюджет, этажность. Как только хватает — вызови set_scenario.
- Геометрию сам не придумывай: только вызывай инструменты. Результат инструмента — правда; если отказ — объясни причину человеческим языком и предложи исправление из ответа.
- Стороны дома: N север, E восток, S юг, W запад. «Здесь / на этой стороне» — смотри «выбранная стена» в контексте.
- Попроси референсы или скриншоты понравившихся домов и интерьеров — «можно вставить прямо сюда» (разбор картинок появится позже).
- Не называй точную цену — только вилку «предварительно».
- Кровля всегда плоская, ярусов не больше двух, свес второго яруса до 1,5 м без колонны и до 3 м с колонной.

Текущее состояние:
${context}`;
}

export function projectContext(
  p: Project | null,
  extra: { selectedWall?: string; variants?: string[] } = {},
): string {
  if (!p) return "Дом ещё не собран. Варианты: нет.";
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
  return [
    extra.variants?.length ? `Варианты: ${extra.variants.join(" | ")}` : "",
    `Выбранный дом: ${p.modules.length} кубиков (${fm.modules.length} модулей), ${Math.round(warmContourM2(p))} м², ${trucksForCubes(p.modules.length)} трала, стиль ${style}.`,
    `Помещения: ${rooms}.`,
    `Терраса: ${p.terrace.totalM2} м² на стороне ${p.terrace.side}.`,
    `Бюджет предварительно: ${(b.total.min / 1e6).toFixed(1)}–${(b.total.max / 1e6).toFixed(1)} млн ₽.`,
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
  for (const r of softAfter) if (!softBefore.has(r.message)) out.push(`⚠ ${r.message}`);
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
  const ua = factoryModules(after).unpairedCubeIds.length;
  if (ua > ub)
    out.push("Появился кубик без пары — завод делает модули по 2 кубика, проверит проектировщик.");
  if (ua < ub) out.push("Все кубики теперь собираются в заводские модули по 2.");
  return out;
}
