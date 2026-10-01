/**
 * Нейросеть-архитектор + движок правил как проверяющий.
 *
 * Модель получает бриф, стиль и прецеденты и отдаёт раскладку структурой
 * (кубики по сетке, ярус, комната, сдвиг второго яруса). Здесь раскладка
 * превращается в Project и проверяется всеми hard-правилами; список нарушений
 * уходит модели на исправление (до 3 попыток). Не вышло — честный откат на
 * ближайший вариант солвера. Солвер — запасной путь и ремонт, не автор.
 */
import { GRAMMAR } from "../grammar/index.ts";
import type { RoomType } from "../grammar/index.ts";
import { buildProject, defaultFinishes } from "./derive.ts";
import { evaluate } from "./rules.ts";
import { solve } from "./solver.ts";
import type { Brief, ModulePlacement, Project, Room, RoomPurpose, Side } from "./types.ts";

export interface LayoutCube {
  /** Колонка сетки (шаг 3200 мм, на восток). */
  col: number;
  /** Ряд сетки (шаг 3420 мм, на север). */
  row: number;
  tier: 1 | 2;
  /** id комнаты из rooms. */
  room: string;
  /** Сдвиг колонки на полкубика по ряду (1710 мм) — как в построенных проектах. */
  halfRow?: boolean;
}

export interface LayoutJson {
  intent: string;
  /** На какой прецедент опирается (название проекта ЭкоКуба или мировой). */
  precedent: string;
  cubes: LayoutCube[];
  rooms: { id: string; type: RoomType; purpose?: RoomPurpose }[];
  /** Сдвиг всего второго яруса по x, мм (свес), кратно 100, до ±1500 (до ±3000 с колонной). */
  upperShiftMm?: number;
  terraceSide?: Side;
  why: string;
}

const ROOM_TYPES: RoomType[] = [
  "bedroom",
  "kitchen-living",
  "wet-core",
  "study",
  "hall",
  "corridor",
];

/** Инструмент для function calling: модель отвечает только этой структурой. */
export const LAYOUT_TOOL = {
  type: "function",
  function: {
    name: "propose_layout",
    description:
      "Раскладка дома ЭкоКуба из кубиков 3200×3420 по сетке. Кубик = одна клетка сетки col/row на ярусе 1 или 2. Комната — 1..5 кубиков одного типа (кухня-гостиная 2–5 и минимум два кубика рядом по длинной стороне, спальня 1–2, санузел 1, холл второго яруса 1–2 над кухней-гостиной).",
    parameters: {
      type: "object",
      properties: {
        intent: { type: "string" },
        precedent: { type: "string", description: "На какой проект опираешься" },
        cubes: {
          type: "array",
          items: {
            type: "object",
            properties: {
              col: { type: "integer", minimum: 0, maximum: 8 },
              row: { type: "integer", minimum: 0, maximum: 8 },
              tier: { type: "integer", enum: [1, 2] },
              room: { type: "string" },
              halfRow: { type: "boolean" },
            },
            required: ["col", "row", "tier", "room"],
          },
        },
        rooms: {
          type: "array",
          items: {
            type: "object",
            properties: {
              id: { type: "string" },
              type: { type: "string", enum: ROOM_TYPES },
              purpose: { type: "string", enum: ["elderly", "elderly-guest"] },
            },
            required: ["id", "type"],
          },
        },
        upperShiftMm: { type: "integer", minimum: -1500, maximum: 1500 },
        terraceSide: { type: "string", enum: ["N", "E", "S", "W"] },
        why: { type: "string" },
      },
      required: ["intent", "precedent", "cubes", "rooms", "why"],
    },
  },
} as const;

/** Разбор ответа модели: форма и типы. Ошибки — словами, чтобы модель исправила. */
export function parseLayout(
  raw: unknown,
): { ok: true; layout: LayoutJson } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  const o = (typeof raw === "string" ? safeJson(raw) : raw) as Partial<LayoutJson> | null;
  if (!o || typeof o !== "object") return { ok: false, errors: ["Ответ — не объект раскладки."] };
  if (!Array.isArray(o.cubes) || !o.cubes.length) errors.push("Нет кубиков (cubes).");
  if (!Array.isArray(o.rooms) || !o.rooms.length) errors.push("Нет комнат (rooms).");
  const roomIds = new Set((o.rooms ?? []).map((r) => r?.id));
  for (const r of o.rooms ?? [])
    if (!ROOM_TYPES.includes(r?.type as RoomType))
      errors.push(`Комната ${r?.id}: неизвестный тип ${r?.type}.`);
  const seen = new Set<string>();
  for (const c of o.cubes ?? []) {
    if (!Number.isInteger(c?.col) || !Number.isInteger(c?.row))
      errors.push("Кубик без целых col/row.");
    if (c?.tier !== 1 && c?.tier !== 2)
      errors.push(`Кубик ${c?.col},${c?.row}: ярус только 1 или 2.`);
    if (!roomIds.has(c?.room))
      errors.push(`Кубик ${c?.col},${c?.row}: комната ${c?.room} не описана в rooms.`);
    const k = `${c?.tier}:${c?.col}:${c?.row}:${c?.halfRow ? 1 : 0}`;
    if (seen.has(k)) errors.push(`Два кубика в одной клетке ${k}.`);
    seen.add(k);
  }
  if ((o.cubes?.length ?? 0) > 16) errors.push("Больше 16 кубиков — это индивидуальный проект.");
  return errors.length
    ? { ok: false, errors }
    : {
        ok: true,
        layout: {
          intent: String(o.intent ?? ""),
          precedent: String(o.precedent ?? ""),
          cubes: o.cubes!,
          rooms: o.rooms!,
          upperShiftMm: Number.isFinite(o.upperShiftMm)
            ? Math.round(Number(o.upperShiftMm) / 100) * 100
            : 0,
          terraceSide: o.terraceSide,
          why: String(o.why ?? ""),
        },
      };
}

function safeJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

/** Раскладка → Project (проёмы, терраса, посадка — тем же derive, что у солвера). */
export function layoutToProject(l: LayoutJson, brief: Brief, id = "llm-1"): Project {
  const { w, d } = GRAMMAR.module.externalMm;
  const shift = l.upperShiftMm ?? 0;
  const modules: ModulePlacement[] = l.cubes.map((c, i) => ({
    id: `c${i + 1}`,
    xMm: c.col * w + (c.tier === 2 ? shift : 0),
    yMm: c.row * d + (c.halfRow ? d / 2 : 0),
    rot: 0,
    tier: c.tier,
    roomId: c.room,
  }));
  const rooms: Room[] = l.rooms
    .map((r) => ({
      id: r.id,
      type: r.type,
      tier: modules.find((m) => m.roomId === r.id)?.tier ?? 1,
      moduleIds: modules.filter((m) => m.roomId === r.id).map((m) => m.id),
      purpose: r.purpose,
      subRooms:
        r.type === "wet-core" ? ["санузел"] : r.type === "hall" ? ["лестница", "холл"] : undefined,
    }))
    .filter((r) => r.moduleIds.length);
  const firstWet = rooms.find((r) => r.type === "wet-core" && r.tier === 1);
  if (firstWet) firstWet.subRooms = ["санузел", "бойлер и техшкаф", "тамбур"];
  const p = buildProject({
    id,
    modules,
    rooms,
    plot: brief.plot ?? null,
    yearRound: brief.yearRound,
    finishes: defaultFinishes(),
    terraceSide: l.terraceSide,
  });
  return {
    ...p,
    recommendations: brief.recommendations,
    household: brief.household,
  };
}

export interface LayoutCheck {
  project: Project | null;
  valid: boolean;
  /** Нарушения словами — уходят модели на исправление. */
  violations: string[];
  /** Программа брифа не выполнена (не хватает спален и т. п.) — тоже на исправление. */
  programGaps: string[];
}

/** Проверка раскладки: правила движка + выполнение брифа. */
export function checkLayout(raw: unknown, brief: Brief): LayoutCheck {
  const parsed = parseLayout(raw);
  if (!parsed.ok)
    return { project: null, valid: false, violations: parsed.errors, programGaps: [] };
  const p = layoutToProject(parsed.layout, brief);
  const ev = evaluate(p);
  const count = (t: RoomType) => p.rooms.filter((r) => r.type === t).length;
  const gaps: string[] = [];
  if (count("bedroom") < brief.bedrooms)
    gaps.push(`Спален ${count("bedroom")}, а нужно ${brief.bedrooms}.`);
  if (brief.bathrooms && count("wet-core") < brief.bathrooms)
    gaps.push(`Санузлов ${count("wet-core")}, а нужно ${brief.bathrooms}.`);
  if (brief.study && !count("study")) gaps.push("Нужен кабинет.");
  for (const purpose of brief.bedroomPurposes ?? [])
    if (!p.rooms.some((r) => r.purpose === purpose && r.tier === 1))
      gaps.push(`Нужна спальня «${purpose}» на 1-м ярусе.`);
  if (brief.tiers !== "any" && Math.max(...p.modules.map((m) => m.tier)) !== brief.tiers)
    gaps.push(`Ярусов должно быть ${brief.tiers}.`);
  if (brief.maxAreaM2 && p.modules.length * GRAMMAR.module.warmContourAreaM2 > brief.maxAreaM2 + 1)
    gaps.push(`Площадь больше желаемой ${brief.maxAreaM2} м² — уберите кубик.`);
  const violations = ev.hardViolations.map((v) => v.message);
  return { project: p, valid: ev.valid && !gaps.length, violations, programGaps: gaps };
}

/** Сообщение модели на исправление. */
export function repairMessage(c: LayoutCheck): string {
  return [
    "Движок правил ЭкоКуба отклонил раскладку. Исправь и снова вызови propose_layout целиком:",
    ...c.violations.map((v) => `- ${v}`),
    ...c.programGaps.map((v) => `- ${v}`),
  ].join("\n");
}

/** Откат: ближайший допустимый вариант солвера (с честной пометкой). */
export function solverFallback(brief: Brief, seed = 1): Project | null {
  return solve(brief, { seed, maxVariants: 1 }).variants[0]?.project ?? null;
}

/** Системный промпт модели-архитектора. */
export function layoutSystemPrompt(knowledge: string): string {
  return `Ты — архитектор ЭкоКуба. Проектируешь дом из бетонных кубиков 3200 × 3420 мм (в чистоте 2780 × 3000), заводской модуль = 2 кубика рядом по длинной стороне, трал везёт 4 кубика.
Сетка: col — шаг 3200 на восток, row — шаг 3420 на север. Кубики стоят грань в грань; halfRow сдвигает кубик на 1710 по ряду (как в построенных домах).
Жёсткие правила (проверяет движок): до 2 ярусов; второй ярус опирается на первый не меньше чем наполовину, свес до 1,5 м (upperShiftMm); холл с лестницей (type hall) на 2-м ярусе стоит над кухней-гостиной; санузел 2-го яруса — над санузлом 1-го; кухня-гостиная 2–5 кубиков и шириной ≥ 6,4 м (два кубика рядом по длинной стороне); каждая комната открывается в кухню-гостиную или холл, спальни не проходные; холл 1-го яруса (corridor) только если раздаёт комнаты; пятно компактное (заполнение ≥ 75–80 %, без зигзага, пропорции до 1:2,2); в общей комнате есть глухая стена ≥ 2,4 м под ТВ; комнаты пожилых — только на 1-м ярусе.
Хорошие решения: общая комната на юг и к террасе, спальни по углам, мокрые зоны вместе у одного стояка, ночная зона отдельно от дневной (крылом или ярусом).
${knowledge}
Отвечай только вызовом propose_layout. В precedent назови, на что опираешься (наш проект: Weekend One/Two, Sky River, Family One/Two, рендер слайдера; или мировой прецедент).`;
}
