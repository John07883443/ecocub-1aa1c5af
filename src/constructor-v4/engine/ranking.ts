/**
 * Оценка вариантов под сценарий: площадь, проходы, свет, приватность спален,
 * мокрая зона на одном стояке, стоимость. Лучший получает «рекомендуем» с
 * коротким объяснением — из двух самых сильных сторон.
 */
import { GRAMMAR } from "../grammar/index.ts";
import { contact, exteriorFaces, footprint, intersect } from "./geometry.ts";
import { budgetFor } from "./price.ts";
import {
  compassOf,
  modulesOnTier,
  roomClearAreaM2,
  roomsTouch,
  warmContourM2,
  type Evaluation,
} from "./rules.ts";
import type { Project, Room } from "./types.ts";

export type Criterion =
  "fit" | "areaEfficiency" | "circulation" | "daylight" | "privacy" | "wetStacking" | "cost";

export interface Rank {
  total: number;
  criteria: Record<Criterion, number>;
  recommended: boolean;
  why: string;
}

export const CRITERIA_WEIGHTS: Record<Criterion, number> = {
  fit: 2,
  areaEfficiency: 1,
  circulation: 1.5,
  daylight: 2,
  privacy: 1.5,
  wetStacking: 1,
  cost: 1.5,
};

const PHRASE: Record<Criterion, string> = {
  fit: "лучше всех соответствует приёмам наших домов",
  areaEfficiency: "меньше всего теряется площади",
  circulation: "короткие проходы: всё рядом с общей комнатой",
  daylight: "больше всего света в гостиной и спальнях",
  privacy: "спальни спокойнее всего — в стороне от входа",
  wetStacking: "вся мокрая зона на одном стояке",
  cost: "дешевле остальных",
};

const clamp = (x: number) => Math.max(0, Math.min(1, x));

function hopsFromEntrance(p: Project): number {
  const entrance = p.openings.find((o) => o.kind === "entrance");
  const start = p.rooms.find((r) => r.id === entrance?.roomId);
  if (!start) return 3;
  const hall = p.rooms.find((r) => r.type === "hall");
  const kitchen = p.rooms.find((r) => r.type === "kitchen-living");
  const dist = new Map<string, number>([[start.id, 0]]);
  const queue: Room[] = [start];
  while (queue.length) {
    const cur = queue.shift()!;
    const d = dist.get(cur.id)!;
    const next = p.rooms.filter(
      (o) =>
        !dist.has(o.id) &&
        (roomsTouch(p, cur, o) ||
          (cur === kitchen && o === hall) ||
          (cur === hall && o === kitchen)),
    );
    for (const n of next) {
      dist.set(n.id, d + 1);
      queue.push(n);
    }
  }
  const vals = p.rooms.filter((r) => r.id !== start.id).map((r) => dist.get(r.id) ?? 4);
  return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 1;
}

export function criteriaOf(p: Project, ev: Evaluation): Omit<Record<Criterion, number>, "cost"> {
  const warm = warmContourM2(p);
  const clear = p.rooms.reduce((s, r) => s + roomClearAreaM2(p, r), 0);
  const kitchen = p.rooms.find((r) => r.type === "kitchen-living");
  const north = p.plot?.northDeg ?? 0;
  const kitchenGlass = p.openings.filter((o) => o.roomId === kitchen?.id && o.kind === "window");
  const sunny = kitchenGlass
    .filter((o) => ["S", "W"].includes(compassOf(o.face, north)))
    .reduce((s, o) => s + o.widthMm, 0);
  const allGlass = kitchenGlass.reduce((s, o) => s + o.widthMm, 0) || 1;
  const bedrooms = p.rooms.filter((r) => r.type === "bedroom");
  const bedMods = bedrooms
    .map((r) => p.modules.find((m) => m.id === r.moduleIds[0])!)
    .filter(Boolean);
  const corner = bedMods.filter(
    (m) => exteriorFaces(m, modulesOnTier(p, m.tier)).length >= 2,
  ).length;
  const entrance = p.openings.find((o) => o.kind === "entrance");
  const entryRoom = p.rooms.find((r) => r.id === entrance?.roomId);
  const quiet = bedrooms.filter(
    (b) =>
      b.tier === 2 ||
      !entryRoom ||
      entryRoom.type === "kitchen-living" ||
      !roomsTouch(p, b, entryRoom),
  );
  const faceEntry = bedrooms.filter((b) =>
    p.openings.some(
      (o) =>
        o.roomId === b.id &&
        o.kind === "window" &&
        p.plot?.entrySide &&
        compassOf(o.face, north) === p.plot.entrySide,
    ),
  );
  const wet = p.modules.filter((m) => p.rooms.find((r) => r.id === m.roomId)?.type === "wet-core");
  let groups = 0;
  const seen = new Set<string>();
  for (const w of wet) {
    if (seen.has(w.id)) continue;
    groups++;
    const stack = [w];
    seen.add(w.id);
    while (stack.length) {
      const c = stack.pop()!;
      for (const o of wet)
        if (
          !seen.has(o.id) &&
          (intersect(footprint(c), footprint(o)) ||
            (o.tier === c.tier &&
              (contact(footprint(c), footprint(o))?.lengthMm ?? 0) >=
                GRAMMAR.placement.minContactMm))
        ) {
          seen.add(o.id);
          stack.push(o);
        }
    }
  }
  return {
    fit: ev.softScore,
    areaEfficiency: clamp((clear / warm - 0.7) / 0.15),
    circulation: clamp(1.5 / hopsFromEntrance(p)),
    daylight: 0.6 * (sunny / allGlass) + 0.4 * (bedMods.length ? corner / bedMods.length : 1),
    privacy: bedrooms.length ? clamp((quiet.length - faceEntry.length * 0.5) / bedrooms.length) : 1,
    wetStacking: groups ? 1 / groups : 1,
  };
}

/** Ранжирует набор вариантов; стоимость — относительно самого дешёвого в наборе. */
export function rankAll(items: { project: Project; evaluation: Evaluation }[]): Rank[] {
  const mids = items.map((i) => {
    const b = budgetFor(i.project);
    return (b.total.min + b.total.max) / 2;
  });
  const cheapest = Math.min(...mids);
  const ranks = items.map((it, k) => {
    const criteria = {
      ...criteriaOf(it.project, it.evaluation),
      cost: clamp(1 - (mids[k] - cheapest) / cheapest),
    };
    const wsum = Object.values(CRITERIA_WEIGHTS).reduce((a, b) => a + b, 0);
    const total =
      (Object.keys(criteria) as Criterion[]).reduce(
        (s, c) => s + criteria[c] * CRITERIA_WEIGHTS[c],
        0,
      ) / wsum;
    return { total, criteria, recommended: false, why: "" };
  });
  return ranks;
}

/** Объяснение: чем вариант сильнее остальных (две лучшие стороны относительно набора). */
export function explainRanks(ranks: Rank[]): void {
  if (!ranks.length) return;
  const best = ranks.reduce((b, r, i) => (r.total > ranks[b].total ? i : b), 0);
  ranks.forEach((r, i) => {
    const adv = (Object.keys(r.criteria) as Criterion[])
      .map((c) => ({
        c,
        d:
          r.criteria[c] - Math.max(...ranks.filter((_, j) => j !== i).map((o) => o.criteria[c]), 0),
      }))
      .sort((a, b) => b.d - a.d || CRITERIA_WEIGHTS[b.c] - CRITERIA_WEIGHTS[a.c])
      .slice(0, 2)
      .map((x) => PHRASE[x.c]);
    r.recommended = i === best;
    r.why = (i === best ? "Рекомендуем: " : "") + adv.join(", ") + ".";
  });
}
