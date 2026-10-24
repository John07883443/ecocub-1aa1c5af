/**
 * Сводка дома для QA: из JSON проекта (window.__pilotState.house или состояние React)
 * считаем то, что видит человек и что проверяет судья — кубики, комнаты, окна по фасадам,
 * отделка, бюджет движком сайта, жёсткие нарушения правил.
 */
import type { Project, Side } from "../../src/constructor-v4/engine/types.ts";
import { buildPassport } from "../../src/constructor-v4/engine/passport.ts";
import { compassOf, evaluate, warmContourM2 } from "../../src/constructor-v4/engine/rules.ts";
import { FINISHES, roomSpec } from "../../src/constructor-v4/grammar/index.ts";

const SIDES: Side[] = ["N", "E", "S", "W"];
const label = (cat: "facade" | "roof" | "windowFrames" | "interior", id: string) =>
  FINISHES.categories[cat]?.find((f) => f.id === id)?.label ?? id;

export type HouseSummary = {
  cubes: number;
  tiers: number;
  cubesTier2: number;
  warmM2: number;
  rooms: { type: string; label: string; tier: number; cubes: number }[];
  bedrooms: number;
  /** Окна по сторонам света (с учётом plot.northDeg): штук, сумма ширин, площадь. */
  windows: Record<Side, { count: number; widthSumMm: number; areaM2: number }>;
  entrances: Side[];
  finishes: { style: string | null; facade: string; roof: string; frames: string; interior: string };
  terrace: { side: Side; m2: number } | null;
  rotationDeg: number;
  budgetMln: { min: number; max: number } | null;
  hardViolations: string[];
};

export function summarize(p: Project | null | undefined): HouseSummary | null {
  if (!p || !Array.isArray(p.modules)) return null;
  const north = p.plot?.northDeg ?? 0;
  const windows = Object.fromEntries(
    SIDES.map((s) => [s, { count: 0, widthSumMm: 0, areaM2: 0 }]),
  ) as HouseSummary["windows"];
  const entrances: Side[] = [];
  for (const o of p.openings ?? []) {
    const side = compassOf(o.face, north);
    if (o.kind === "window") {
      windows[side].count++;
      windows[side].widthSumMm += o.widthMm;
      windows[side].areaM2 = +(windows[side].areaM2 + (o.widthMm * o.heightMm) / 1e6).toFixed(2);
    } else if (o.kind === "entrance") entrances.push(side);
  }
  let budgetMln: HouseSummary["budgetMln"] = null;
  let hard: string[] = [];
  try {
    const ev = evaluate(p);
    hard = ev.hardViolations.map((r) => r.message);
    const b = buildPassport(p, ev).budget.total;
    budgetMln = { min: +(b.min / 1e6).toFixed(1), max: +(b.max / 1e6).toFixed(1) };
  } catch (e) {
    hard = [`(движок не смог оценить: ${(e as Error).message})`];
  }
  const styleId = p.finishes?.styleId ?? null;
  return {
    cubes: p.modules.length,
    tiers: Math.max(1, ...p.modules.map((m) => Number(m.tier) || 1)),
    cubesTier2: p.modules.filter((m) => Number(m.tier) === 2).length,
    warmM2: Math.round(warmContourM2(p)),
    rooms: p.rooms.map((r) => ({
      type: r.type,
      label: safeRoomLabel(r.type),
      tier: Number(r.tier),
      cubes: r.moduleIds.length,
    })),
    bedrooms: p.rooms.filter((r) => r.type === "bedroom").length,
    windows,
    entrances,
    finishes: {
      style: styleId ? (FINISHES.styles.find((s) => s.id === styleId)?.label ?? styleId) : null,
      facade: label("facade", p.finishes?.facade),
      roof: label("roof", p.finishes?.roof),
      frames: label("windowFrames", p.finishes?.windowFrames),
      interior: label("interior", p.finishes?.interior),
    },
    terrace: p.terrace ? { side: p.terrace.side, m2: Math.round(p.terrace.totalM2) } : null,
    rotationDeg: p.rotationDeg ?? 0,
    budgetMln,
    hardViolations: hard,
  };
}

function safeRoomLabel(t: string): string {
  try {
    return roomSpec(t as never).label;
  } catch {
    return t;
  }
}

/** Что поменялось между «до» и «после» — коротко, по-русски, для судьи и таблицы. */
export function diffSummary(a: HouseSummary | null, b: HouseSummary | null): string[] {
  if (!a && !b) return ["дома нет"];
  if (!a) return ["дом появился"];
  if (!b) return ["дом пропал"];
  const out: string[] = [];
  const num = (k: keyof HouseSummary, ru: string) => {
    if (a[k] !== b[k]) out.push(`${ru}: ${a[k]} → ${b[k]}`);
  };
  num("cubes", "кубиков");
  num("tiers", "ярусов");
  num("cubesTier2", "кубиков на 2 ярусе");
  num("warmM2", "м² тёплого контура");
  num("bedrooms", "спален");
  num("rotationDeg", "поворот");
  const rooms = (s: HouseSummary) =>
    s.rooms
      .map((r) => `${r.label}/${r.tier}/${r.cubes}`)
      .sort()
      .join(", ");
  if (rooms(a) !== rooms(b)) out.push(`комнаты: [${rooms(a)}] → [${rooms(b)}]`);
  for (const s of SIDES) {
    const x = a.windows[s];
    const y = b.windows[s];
    if (x.count !== y.count || x.widthSumMm !== y.widthSumMm || x.areaM2 !== y.areaM2)
      out.push(
        `окна ${s}: ${x.count} шт/${x.areaM2} м² → ${y.count} шт/${y.areaM2} м²`,
      );
  }
  if (a.entrances.join() !== b.entrances.join())
    out.push(`входы: [${a.entrances.join(",")}] → [${b.entrances.join(",")}]`);
  for (const k of ["style", "facade", "roof", "frames", "interior"] as const)
    if (a.finishes[k] !== b.finishes[k]) out.push(`${k}: ${a.finishes[k]} → ${b.finishes[k]}`);
  if (JSON.stringify(a.terrace) !== JSON.stringify(b.terrace))
    out.push(`терраса: ${JSON.stringify(a.terrace)} → ${JSON.stringify(b.terrace)}`);
  if (JSON.stringify(a.budgetMln) !== JSON.stringify(b.budgetMln))
    out.push(
      `бюджет: ${a.budgetMln?.min}–${a.budgetMln?.max} → ${b.budgetMln?.min}–${b.budgetMln?.max} млн`,
    );
  if (a.hardViolations.join() !== b.hardViolations.join())
    out.push(`жёсткие нарушения: ${a.hardViolations.length} → ${b.hardViolations.length}`);
  return out.length ? out : ["без изменений"];
}

export function shortHouse(s: HouseSummary | null): string {
  if (!s) return "—";
  const w = SIDES.map((x) => `${x}${s.windows[x].count}`).join(" ");
  return `${s.cubes} куб, ${s.tiers} яр, ${s.warmM2} м², спален ${s.bedrooms}, окна ${w}, входы ${s.entrances.join(",") || "—"}, фасад «${s.finishes.facade}», ${s.budgetMln ? `${s.budgetMln.min}–${s.budgetMln.max} млн` : "—"}`;
}
