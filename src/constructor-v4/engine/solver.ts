/**
 * Солвер «бриф → до 3 вариантов». Детерминированный: одинаковые бриф и seed
 * дают одинаковый результат. Геометрию собирает код по грамматике, каждый
 * вариант проходит все hard-правила — иначе до человека не доходит.
 *
 * Схема перебора (MVP): модули первого яруса стоят колонками по 1–2 модуля,
 * колонка смещается на 0 или 1710 (как в построенных проектах). Второй ярус —
 * подмножество позиций первого со сдвигом в пределах свеса 1,5 м.
 */
import { GRAMMAR } from "../grammar/index.ts";
import type { RoomType } from "../grammar/index.ts";
import { bbox, contact, exteriorFaces, footprint } from "./geometry.ts";
import { buildProject, defaultFinishes } from "./derive.ts";
import { evaluate, expectedBathrooms, type Evaluation } from "./rules.ts";
import type { Brief, ModulePlacement, Project, Room, RoomPurpose } from "./types.ts";
import { findStyle } from "../grammar/index.ts";
import { canPair, factoryModules, trucksForCubes } from "./factory.ts";
import { patternShapes } from "./patterns.ts";
import { explainRanks, rankAll, type Rank } from "./ranking.ts";

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle<T>(arr: T[], rnd: () => number): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export interface Program {
  tier1: { kitchen: number; wet: number; study: number; bedrooms: number; corridor?: number };
  tier2: { hall: number; wet: number; bedrooms: number };
  bathrooms: number;
}

/** Сколько модулей и каких нужно под бриф. */
export function programFor(brief: Brief, tiers: 1 | 2, upperBedrooms?: number): Program {
  const kitchen = brief.kitchenLiving === "compact" ? 2 : brief.bedrooms >= 3 ? 4 : 3;
  const study = brief.study ? 1 : 0;
  let n = brief.bedrooms + kitchen + study + 1;
  const bathrooms = brief.bathrooms ?? expectedBathrooms(n * GRAMMAR.module.warmContourAreaM2);
  n = brief.bedrooms + kitchen + study + bathrooms;
  if (tiers === 1)
    return {
      tier1: { kitchen, wet: bathrooms, study, bedrooms: brief.bedrooms },
      tier2: { hall: 0, wet: 0, bedrooms: 0 },
      bathrooms,
    };
  // Санузел родителей остаётся внизу рядом с их спальней — наверх уходит только «лишний».
  const wet2 = bathrooms - (brief.bedroomPurposes?.includes("elderly") ? 1 : 0) >= 2 ? 1 : 0;
  // Комнаты пожилых родителей — только 1-й ярус: наверх уходят остальные спальни.
  let b2 = Math.max(0, brief.bedrooms - (brief.bedroomPurposes?.length ?? 0));
  const t1 = () => kitchen + (bathrooms - wet2) + study + (brief.bedrooms - b2);
  while (b2 > 0 && 1 + b2 + wet2 > t1()) b2--;
  if (upperBedrooms !== undefined) b2 = Math.min(b2, upperBedrooms);
  return {
    tier1: { kitchen, wet: bathrooms - wet2, study, bedrooms: brief.bedrooms - b2 },
    tier2: { hall: b2 > 0 ? 1 : 0, wet: b2 > 0 ? wet2 : 0, bedrooms: b2 },
    bathrooms,
  };
}

const W = () => GRAMMAR.module.externalMm.w;
const D = () => GRAMMAR.module.externalMm.d;

function touches(a: ModulePlacement, b: ModulePlacement): boolean {
  const c = contact(footprint(a), footprint(b));
  return !!c && c.lengthMm >= GRAMMAR.placement.minContactMm;
}

interface Assignment {
  rooms: Room[];
  modules: ModulePlacement[];
}

function assignTier1(
  cells: ModulePlacement[],
  prog: Program["tier1"],
  rnd: () => number,
): Assignment[] {
  const out: Assignment[] = [];
  const seeds = shuffle(cells, rnd);
  for (const seed of seeds) {
    const kit = [seed];
    while (kit.length < prog.kitchen) {
      const cand = cells.filter((c) => !kit.includes(c) && kit.some((k) => touches(k, c)));
      if (!cand.length) break;
      // Сначала — пара по длинной стороне: кухня-гостиная от 6,4 м, а не коридор 3,2 м.
      const score = (c: ModulePlacement) =>
        (kit.some((k) => canPair(k, c)) ? 10 : 0) +
        cells.filter((o) => o !== c && touches(o, c)).length;
      cand.sort((a, b) => score(b) - score(a) || a.xMm - b.xMm || a.yMm - b.yMm);
      kit.push(cand[0]);
    }
    if (kit.length < prog.kitchen) continue;
    // Холл-распределитель (CUBAX P05/P06): кубик у кухни-гостиной, раздающий остальные комнаты.
    const corr: ModulePlacement[] = [];
    if (prog.corridor) {
      const cand = cells
        .filter((c) => !kit.includes(c) && kit.some((k) => touches(k, c)))
        .sort(
          (a, b) =>
            cells.filter((o) => !kit.includes(o) && touches(o, b)).length -
              cells.filter((o) => !kit.includes(o) && touches(o, a)).length ||
            a.xMm - b.xMm ||
            a.yMm - b.yMm,
        );
      if (!cand.length) continue;
      corr.push(cand[0]);
    }
    const hubs = [...kit, ...corr];
    const rest = cells.filter((c) => !hubs.includes(c));
    if (!rest.every((c) => hubs.some((k) => touches(k, c)))) continue;
    const ext = (c: ModulePlacement) => exteriorFaces(c, cells).length;
    const byExt = [...rest].sort((a, b) => ext(b) - ext(a));
    const bedrooms = byExt.slice(0, prog.bedrooms);
    const study = byExt.slice(prog.bedrooms, prog.bedrooms + prog.study);
    const wet = byExt.slice(prog.bedrooms + prog.study);
    if (wet.length !== prog.wet) continue;
    const rooms: Room[] = [];
    const tag = (type: RoomType, mods: ModulePlacement[], i: number, subRooms?: string[]) => {
      const id = `${type}-${i + 1}`;
      mods.forEach((m) => (m.roomId = id));
      rooms.push({ id, type, tier: 1, moduleIds: mods.map((m) => m.id), subRooms });
    };
    const mods = cells.map((c) => ({ ...c }));
    const pick = (list: ModulePlacement[]) => list.map((l) => mods.find((m) => m.id === l.id)!);
    tag("kitchen-living", pick(kit), 0);
    if (corr.length) tag("corridor", pick(corr), 0, ["холл", "шкаф"]);
    pick(bedrooms).forEach((m, i) => tag("bedroom", [m], i));
    pick(study).forEach((m, i) => tag("study", [m], i));
    pick(wet).forEach((m, i) =>
      tag("wet-core", [m], i, i === 0 ? ["санузел", "бойлер и техшкаф", "тамбур"] : ["санузел"]),
    );
    out.push({ rooms, modules: mods });
    if (out.length >= 6) break;
  }
  return out;
}

const UPPER_SHIFTS = [0, 600, -600, 1200, -1200, 1500, -1500];

function addTier2(a: Assignment, prog: Program["tier2"], rnd: () => number): Assignment[] {
  const n2 = prog.hall + prog.wet + prog.bedrooms;
  if (!n2) return [a];
  const t1 = a.modules;
  const kitchen = a.rooms.find((r) => r.type === "kitchen-living")!;
  const wet1 = a.rooms.filter((r) => r.type === "wet-core");
  const out: Assignment[] = [];
  for (const hallBase of shuffle(
    t1.filter((m) => kitchen.moduleIds.includes(m.id)),
    rnd,
  )) {
    const wantWet = prog.wet
      ? t1.find((m) => wet1.some((w) => w.moduleIds.includes(m.id)))
      : undefined;
    // Второй ярус — прямоугольник из позиций первого (полоса или блок), не случайная россыпь.
    // Холл из одного кубика, а на больших ярусах — из двух (полоса-распределитель, как CUBAX P10).
    const blocks = [
      ...rectBlocks(t1, n2, hallBase).map((b) => ({
        block: b,
        hall2: null as ModulePlacement | null,
      })),
      ...(n2 >= 4
        ? rectBlocks(t1, n2 + 1, hallBase).flatMap((b) =>
            b
              .filter((m) => m !== hallBase && touches(m, hallBase))
              .map((h) => ({ block: b, hall2: h })),
          )
        : []),
    ];
    for (const { block, hall2 } of blocks) {
      if (wantWet && !block.includes(wantWet)) continue;
      if (hall2 && hall2 === wantWet) continue;
      const chosen = [hallBase, ...block.filter((m) => m !== hallBase && m !== hall2)];
      for (const dx of shuffle(UPPER_SHIFTS, rnd).slice(0, 3)) {
        const rooms: Room[] = a.rooms.map((r) => ({ ...r, moduleIds: [...r.moduleIds] }));
        const mods: ModulePlacement[] = a.modules.map((m) => ({ ...m }));
        const up = (base: ModulePlacement, type: RoomType, i: number, subRooms?: string[]) => {
          const id = `${type}-2-${i + 1}`;
          const m: ModulePlacement = {
            id: `u-${base.id}`,
            xMm: base.xMm + dx,
            yMm: base.yMm,
            rot: 0,
            tier: 2,
            roomId: id,
          };
          mods.push(m);
          rooms.push({ id, type, tier: 2, moduleIds: [m.id], subRooms });
        };
        up(hallBase, "hall", 0, ["лестница", "холл"]);
        if (hall2) {
          const m: ModulePlacement = {
            id: `u-${hall2.id}`,
            xMm: hall2.xMm + dx,
            yMm: hall2.yMm,
            rot: 0,
            tier: 2,
            roomId: "hall-2-1",
          };
          mods.push(m);
          rooms.find((r) => r.id === "hall-2-1")!.moduleIds.push(m.id);
        }
        const others = chosen.slice(1);
        let bi = 0;
        for (const base of others) {
          if (prog.wet && base === wantWet) up(base, "wet-core", 0, ["санузел"]);
          else up(base, "bedroom", bi++);
        }
        out.push({ rooms, modules: mods });
      }
    }
    if (out.length >= 12) break;
  }
  return out;
}

/** Прямоугольные блоки из n кубиков первого яруса, содержащие заданный кубик. */
function rectBlocks(t1: ModulePlacement[], n: number, must: ModulePlacement): ModulePlacement[][] {
  const out: ModulePlacement[][] = [];
  const seen = new Set<string>();
  for (const a of t1)
    for (const b of t1) {
      const x0 = Math.min(a.xMm, b.xMm);
      const x1 = Math.max(a.xMm, b.xMm);
      const y0 = Math.min(a.yMm, b.yMm);
      const y1 = Math.max(a.yMm, b.yMm);
      const inside = t1.filter((m) => m.xMm >= x0 && m.xMm <= x1 && m.yMm >= y0 && m.yMm <= y1);
      const cols = new Set(inside.map((m) => m.xMm)).size;
      const rows = new Set(inside.map((m) => m.yMm)).size;
      if (inside.length !== n || cols * rows !== n || !inside.includes(must)) continue;
      const key = inside
        .map((m) => m.id)
        .sort()
        .join(",");
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(inside);
    }
  return out;
}

export interface Variant {
  project: Project;
  evaluation: Evaluation;
  /** Итоговая оценка под сценарий (ranking.ts), 0..1. */
  score: number;
  rank?: Rank;
  tiers: 1 | 2;
  /** Чем вариант отличается — для объяснения человеку. */
  summary: string;
}

export interface SolveOptions {
  seed?: number;
  maxVariants?: number;
  attempts?: number;
}

export interface SolveResult {
  variants: Variant[];
  rejected: number;
  notes: string[];
  /** Почему отклонялись кандидаты: id правила → сколько раз. */
  rejectedBy: Record<string, number>;
}

function signature(p: Project): string {
  return p.modules
    .map(
      (m) =>
        `${m.tier}:${m.xMm}:${m.yMm}:${p.rooms.find((r) => r.moduleIds.includes(m.id))?.type ?? ""}`,
    )
    .sort()
    .join("|");
}

function shapeKey(p: Project): string {
  const b = bbox(p.modules.filter((m) => m.tier === 1).map(footprint));
  return `${p.modules.some((m) => m.tier === 2) ? 2 : 1}:${b.x1 - b.x0}x${b.y1 - b.y0}`;
}

/** Назначает комнаты родителям: спальни 1-го яруса, сначала рядом с санузлом. */
function tagPurposes(a: Assignment, purposes: RoomPurpose[]): Room[] {
  if (!purposes.length) return a.rooms;
  const rooms = a.rooms.map((r) => ({ ...r }));
  const mod = (r: Room) => a.modules.find((m) => m.id === r.moduleIds[0])!;
  const wet = rooms.filter((r) => r.type === "wet-core" && r.tier === 1).map(mod);
  const nearWet = (r: Room) => wet.some((w) => touches(mod(r), w));
  const free = rooms
    .filter((r) => r.type === "bedroom" && r.tier === 1)
    .sort((x, y) => Number(nearWet(y)) - Number(nearWet(x)));
  purposes.forEach((p, i) => {
    if (free[i]) free[i].purpose = p;
  });
  return rooms;
}

export function solve(brief: Brief, opts: SolveOptions = {}): SolveResult {
  const seed = opts.seed ?? 1;
  const max = opts.maxVariants ?? 3;
  const attempts = opts.attempts ?? 300;
  const rnd = mulberry32(seed);
  const notes: string[] = [];
  if (brief.bedrooms < 0 || brief.bedrooms > 6)
    return { variants: [], rejected: 0, rejectedBy: {}, notes: ["Спален от 0 до 6."] };
  const tierOptions: (1 | 2)[] = brief.tiers === "any" ? [1, 2] : [brief.tiers];
  const style = (brief.styleHints ?? []).map(findStyle).find(Boolean);
  const finishes = defaultFinishes(style?.id);
  const seen = new Set<string>();
  const valid: Variant[] = [];
  let rejected = 0;
  const rejectedBy: Record<string, number> = {};

  // Для двух ярусов пробуем разное число спален наверху: не каждая раскладка ложится в форму.
  const programs: { tiers: 1 | 2; prog: Program }[] = [];
  for (const tiers of tierOptions) {
    const base: Program[] = [];
    if (tiers === 1) base.push(programFor(brief, 1));
    else {
      const top = programFor(brief, 2).tier2.bedrooms;
      for (let b = top; b >= 1; b--) base.push(programFor(brief, 2, b));
      if (top === 0) base.push(programFor(brief, 2));
    }
    for (const prog of base) {
      programs.push({ tiers, prog });
      // Большой первый ярус: вариант с холлом-распределителем (+1 кубик).
      const n1 = prog.tier1.kitchen + prog.tier1.wet + prog.tier1.study + prog.tier1.bedrooms;
      if (n1 >= 6)
        programs.push({ tiers, prog: { ...prog, tier1: { ...prog.tier1, corridor: 1 } } });
    }
  }
  for (const { tiers, prog } of programs) {
    if (tiers === 2 && prog.tier2.bedrooms === 0) {
      notes.push("Второй ярус под этот состав не нужен: все спальни помещаются внизу.");
      continue;
    }
    const n1 =
      prog.tier1.kitchen +
      prog.tier1.wet +
      prog.tier1.study +
      prog.tier1.bedrooms +
      (prog.tier1.corridor ?? 0);
    if (n1 + prog.tier2.hall + prog.tier2.wet + prog.tier2.bedrooms > 16) {
      notes.push("Больше 16 модулей — это индивидуальный проект, его делает проектировщик.");
      continue;
    }
    const shapes = patternShapes(n1);
    if (!shapes.length)
      notes.push(`Для ${n1} кубиков первого яруса в библиотеке форм нет образца.`);
    const reps = Math.max(1, Math.ceil(attempts / Math.max(1, shapes.length) / 25));
    for (const shape of shapes.flatMap((s) => Array.from({ length: reps }, () => s))) {
      const cells: ModulePlacement[] = shape.cells.map((c, k) => ({
        id: `m${k + 1}`,
        xMm: c.x,
        yMm: c.y,
        rot: 0,
        tier: 1,
        roomId: "",
      }));
      for (const a1 of assignTier1(cells, prog.tier1, rnd))
        for (const a0 of addTier2(a1, prog.tier2, rnd)) {
          const a = { ...a0, rooms: tagPurposes(a0, brief.bedroomPurposes ?? []) };
          let project = buildProject({
            id: `v-${seed}-${valid.length + rejected + 1}`,
            modules: a.modules,
            rooms: a.rooms,
            plot: brief.plot ?? null,
            yearRound: brief.yearRound,
            finishes,
          });
          let ev = evaluate(project);
          // Не встал на участок — пробуем повернуть дом на 90°.
          if (!ev.valid && ev.hardViolations.every((v) => v.ruleId === "plot-fit")) {
            project = buildProject({
              id: project.id,
              modules: a.modules.map((m) => ({ ...m, xMm: m.yMm, yMm: m.xMm, rot: 90 })),
              rooms: a.rooms,
              plot: brief.plot ?? null,
              yearRound: brief.yearRound,
              finishes,
            });
            ev = evaluate(project);
          }
          const sig = signature(project);
          if (seen.has(sig)) continue;
          seen.add(sig);
          if (!ev.valid) {
            rejected++;
            for (const v of new Set(ev.hardViolations.map((x) => x.ruleId)))
              rejectedBy[v] = (rejectedBy[v] ?? 0) + 1;
            continue;
          }
          if (brief.recommendations?.length)
            project = { ...project, recommendations: brief.recommendations };
          valid.push({ project, evaluation: ev, score: ev.softScore, tiers, summary: "" });
        }
    }
  }

  rankAll(valid).forEach((r, i) => (valid[i].score = r.total));
  valid.sort(
    (a, b) => b.score - a.score || signature(a.project).localeCompare(signature(b.project)),
  );
  const picked: Variant[] = [];
  const shapes = new Set<string>();
  const tiersPicked = new Set<number>();
  // 1-й проход: разные ярусности и разные пятна застройки.
  for (const v of valid) {
    if (picked.length >= max) break;
    const k = shapeKey(v.project);
    if (shapes.has(k)) continue;
    if (
      tierOptions.length > 1 &&
      tiersPicked.has(v.tiers) &&
      valid.some((o) => !tiersPicked.has(o.tiers))
    )
      continue;
    picked.push(v);
    shapes.add(k);
    tiersPicked.add(v.tiers);
  }
  for (const v of valid) {
    if (picked.length >= max) break;
    if (!picked.includes(v)) picked.push(v);
  }
  // Ранги пересчитываются внутри выдачи: «дешевле» и «светлее» — относительно показанных.
  const ranks = rankAll(picked);
  explainRanks(ranks);
  picked.forEach((v, i) => {
    v.rank = ranks[i];
    v.score = ranks[i].total;
  });
  picked.sort((a, b) => b.score - a.score);
  picked.forEach((v, i) => {
    v.project = { ...v.project, id: `variant-${i + 1}` };
    const b = bbox(v.project.modules.filter((m) => m.tier === 1).map(footprint));
    const fm = factoryModules(v.project);
    v.summary = `${v.project.modules.length} кубиков (${fm.modules.length} модулей${fm.unpairedCubeIds.length ? ` + ${fm.unpairedCubeIds.length} без пары` : ""}), ${trucksForCubes(v.project.modules.length)} трала, ${v.tiers === 2 ? "два яруса" : "один ярус"}, пятно ${(b.x1 - b.x0) / 1000} × ${(b.y1 - b.y0) / 1000} м, терраса ${v.project.terrace.totalM2} м²`;
  });
  if (picked.length < max)
    notes.push(`Нашлось только ${picked.length} вариантов без нарушений конструктива.`);
  return { variants: picked, rejected, rejectedBy, notes };
}
