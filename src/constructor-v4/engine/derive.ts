/**
 * Детерминированная пересборка производного: проёмы, терраса, посадка на участок.
 * Геометрию и помещения задают солвер или команды, остальное считается здесь —
 * одинаково для солвера, правок голосом и тестов.
 */
import { FINISHES, GRAMMAR, roomSpec } from "../grammar/index.ts";
import {
  MM2_PER_M2,
  SIDES,
  area,
  bbox,
  contact,
  faceSpan,
  footprint,
  uncoveredSegments,
} from "./geometry.ts";
import { compassOf, isLoadedFace, modulesOnTier, warmContourM2 } from "./rules.ts";
import type {
  Finishes,
  ModulePlacement,
  Opening,
  Plot,
  Project,
  Room,
  Side,
  Terrace,
} from "./types.ts";

export type WindowPreset = "slot" | "small" | "standard" | "large" | "floor-to-ceiling";

/** Пресеты размеров окон. Высоты — только из каталога альбома. Ширины — PLACEHOLDER до пролётов каркаса. */
export const WINDOW_PRESETS: Record<
  WindowPreset,
  { heightMm: number; widthMm: number | "fill"; label: string }
> = {
  slot: { heightMm: 2100, widthMm: 500, label: "узкая щель" },
  small: { heightMm: 2100, widthMm: 900, label: "небольшое окно" },
  standard: { heightMm: 2500, widthMm: 1500, label: "обычное окно" },
  large: { heightMm: 2800, widthMm: 2000, label: "большое окно" },
  "floor-to-ceiling": { heightMm: 3150, widthMm: "fill", label: "панорама в пол" },
};
export const PRESET_LADDER: WindowPreset[] = [
  "slot",
  "small",
  "standard",
  "large",
  "floor-to-ceiling",
];

export function presetOf(o: Pick<Opening, "heightMm" | "widthMm">): WindowPreset {
  if (o.heightMm === 3150) return "floor-to-ceiling";
  if (o.heightMm === 2800) return "large";
  if (o.heightMm === 2500) return "standard";
  return o.widthMm <= 500 ? "slot" : "small";
}

const PIER = () => GRAMMAR.openings.cornerPierMm;
const floor10 = (n: number) => Math.floor(n / 10) * 10;

export function faceStart(m: ModulePlacement, face: Side): number {
  return faceSpan(footprint(m), face)[0];
}

/** Свободные (без чужих проёмов) отрезки грани с учётом простенков. */
export function freeSegments(
  p: Project,
  m: ModulePlacement,
  face: Side,
  ignoreIds: string[] = [],
): [number, number][] {
  const pier = PIER();
  const start = faceStart(m, face);
  const taken = p.openings
    .filter(
      (o) =>
        o.moduleId === m.id &&
        o.face === face &&
        o.kind !== "internal-door" &&
        !ignoreIds.includes(o.id),
    )
    .map(
      (o) => [start + o.offsetMm - pier, start + o.offsetMm + o.widthMm + pier] as [number, number],
    );
  const out: [number, number][] = [];
  for (const [s0, s1] of uncoveredSegments(m, face, modulesOnTier(p, m.tier))) {
    let segs: [number, number][] = [[s0 + pier, s1 - pier]];
    for (const [t0, t1] of taken)
      segs = segs.flatMap(([a, b]) => {
        if (t1 <= a || t0 >= b) return [[a, b] as [number, number]];
        const r: [number, number][] = [];
        if (t0 > a) r.push([a, t0]);
        if (t1 < b) r.push([t1, b]);
        return r;
      });
    out.push(...segs.filter(([a, b]) => b > a));
  }
  return out;
}

/** Ставит окно пресета в самый длинный свободный отрезок грани. null — места нет. */
export function placeWindow(
  p: Project,
  m: ModulePlacement,
  face: Side,
  preset: WindowPreset,
  roomId: string,
  id: string,
  ignoreIds: string[] = [],
): Opening | null {
  const segs = freeSegments(p, m, face, ignoreIds);
  if (!segs.length) return null;
  const [a, b] = segs.reduce((best, s) => (s[1] - s[0] > best[1] - best[0] ? s : best));
  const spec = WINDOW_PRESETS[preset];
  const width = spec.widthMm === "fill" ? floor10(b - a) : Math.min(spec.widthMm, floor10(b - a));
  if (width < 500) return null;
  return {
    id,
    moduleId: m.id,
    roomId,
    face,
    kind: "window",
    widthMm: width,
    heightMm: spec.heightMm,
    offsetMm: a - faceStart(m, face),
    userSet: false,
  };
}

function preferredFaces(p: Project, m: ModulePlacement): Side[] {
  const north = p.plot?.northDeg;
  const rank = (f: Side) => {
    const c = north === undefined ? f : compassOf(f, north);
    return { S: 0, W: 1, E: 2, N: 3 }[c];
  };
  return [...SIDES].sort((a, b) => rank(a) - rank(b));
}

export function deriveOpenings(p: Project): Opening[] {
  const kept = p.openings.filter((o) => o.userSet && p.modules.some((m) => m.id === o.moduleId));
  const work: Project = { ...p, openings: [...kept] };
  let n = 0;
  const nid = (k: string) => `${k}-${++n}`;
  const modsOf = (r: Room) => p.modules.filter((m) => r.moduleIds.includes(m.id));
  const kitchen = p.rooms.find((r) => r.type === "kitchen-living");
  const wet1 = p.rooms.find((r) => r.type === "wet-core" && r.tier === 1);

  // 1. Вход: тамбур в мокром модуле для круглогодичного дома, иначе в общую комнату.
  const entryRooms = (p.yearRound ? [wet1, kitchen] : [kitchen, wet1]).filter(Boolean) as Room[];
  let entranceDone = work.openings.some((o) => o.kind === "entrance");
  for (const r of entryRooms) {
    if (entranceDone) break;
    for (const m of modsOf(r)) {
      if (entranceDone) break;
      for (const f of [...preferredFaces(p, m)].reverse()) {
        const segs = freeSegments(work, m, f);
        const seg = segs.find(([a, b]) => b - a >= GRAMMAR.openings.door.widthMm);
        if (!seg) continue;
        work.openings.push({
          id: nid("entrance"),
          moduleId: m.id,
          roomId: r.id,
          face: f,
          kind: "entrance",
          widthMm: GRAMMAR.openings.door.widthMm,
          heightMm: GRAMMAR.openings.door.heightMm,
          offsetMm: seg[0] - faceStart(m, f),
        });
        entranceDone = true;
        break;
      }
    }
  }

  // 2. Окна.
  for (const r of p.rooms) {
    const spec = roomSpec(r.type);
    if (!spec.needs.window) continue;
    if (work.openings.some((o) => o.roomId === r.id && o.kind === "window" && o.userSet)) continue;
    if (r.type === "kitchen-living") {
      for (const m of modsOf(r))
        for (const f of SIDES) {
          const preset: WindowPreset = isLoadedFace(work, m, f) ? "large" : "floor-to-ceiling";
          const w = placeWindow(work, m, f, preset, r.id, nid("window"));
          if (w && w.widthMm >= 900) work.openings.push(w);
        }
    } else {
      const m = modsOf(r)[0];
      if (!m) continue;
      for (const f of preferredFaces(p, m)) {
        const w = placeWindow(work, m, f, "standard", r.id, nid("window"));
        if (w && w.widthMm >= 900) {
          work.openings.push(w);
          break;
        }
      }
    }
  }

  // 3. Межкомнатные двери: помещение открывается в общую комнату или холл.
  for (const r of p.rooms) {
    const need = roomSpec(r.type).needs.adjacentTo;
    if (!need?.length) continue;
    let placed = false;
    for (const m of modsOf(r)) {
      if (placed) break;
      for (const o of p.rooms.filter((x) => need.includes(x.type) && x.tier === r.tier)) {
        if (placed) break;
        for (const om of modsOf(o)) {
          const c = contact(footprint(m), footprint(om));
          if (!c || c.lengthMm < GRAMMAR.placement.minContactMm) continue;
          work.openings.push({
            id: nid("door"),
            moduleId: m.id,
            roomId: r.id,
            face: c.faceA,
            kind: "internal-door",
            // Родителям — широкие двери 1000 без порогов.
            widthMm: r.purpose ? 1000 : GRAMMAR.openings.door.widthMm,
            heightMm: GRAMMAR.openings.door.heightMm,
            offsetMm: c.from + PIER() - faceStart(m, c.faceA),
          });
          placed = true;
          break;
        }
      }
    }
  }
  return work.openings;
}

export function deriveTerrace(p: Project, side?: Side): Terrace {
  const t1 = modulesOnTier(p, 1);
  if (!t1.length) return { side: side ?? "S", notchM2: 0, deckM2: 0, totalM2: 0 };
  const b = bbox(t1.map(footprint));
  const notch = (area(b) - t1.reduce((s, m) => s + area(footprint(m)), 0)) / MM2_PER_M2;
  const kitchen = p.rooms.find((r) => r.type === "kitchen-living");
  const glazing = (f: Side) =>
    p.openings
      .filter((o) => o.roomId === kitchen?.id && o.face === f && o.kind === "window")
      .reduce((s, o) => s + o.widthMm, 0);
  const chosen = side ?? [...SIDES].sort((a, c) => glazing(c) - glazing(a))[0];
  const deck = Math.max(0, 0.6 * warmContourM2(p) - notch);
  const r1 = (x: number) => Math.round(x * 10) / 10;
  return { side: chosen, notchM2: r1(notch), deckM2: r1(deck), totalM2: r1(notch + deck) };
}

export function centerOnPlot(p: Project): { xMm: number; yMm: number } {
  if (!p.plot || !p.modules.length) return { xMm: 0, yMm: 0 };
  const b = bbox(p.modules.map(footprint));
  return {
    xMm: Math.round((p.plot.widthM * 1000 - (b.x1 - b.x0)) / 2 - b.x0),
    yMm: Math.round((p.plot.depthM * 1000 - (b.y1 - b.y0)) / 2 - b.y0),
  };
}

export function defaultFinishes(styleId = "scandi"): Finishes {
  const s = FINISHES.styles.find((x) => x.id === styleId) ?? FINISHES.styles[0];
  return {
    styleId: s.id,
    facade: s.facade,
    roof: s.roof,
    windowFrames: s.windowFrames,
    interior: s.interior,
  };
}

export interface BuildInput {
  id: string;
  modules: ModulePlacement[];
  rooms: Room[];
  plot?: Plot | null;
  yearRound?: boolean;
  finishes?: Finishes;
  terraceSide?: Side;
  openings?: Opening[];
}

/** Собирает проект и пересчитывает всё производное. */
export function buildProject(input: BuildInput): Project {
  const base: Project = {
    schemaVersion: 4,
    id: input.id,
    modules: input.modules,
    rooms: input.rooms,
    openings: input.openings ?? [],
    terrace: { side: input.terraceSide ?? "S", notchM2: 0, deckM2: 0, totalM2: 0 },
    plot: input.plot ?? null,
    placementMm: { xMm: 0, yMm: 0 },
    finishes: input.finishes ?? defaultFinishes(),
    yearRound: input.yearRound ?? true,
  };
  return rederive(base, input.terraceSide);
}

export function rederive(p: Project, terraceSide?: Side): Project {
  const withOpenings = { ...p, openings: deriveOpenings(p) };
  const terrace = deriveTerrace(withOpenings, terraceSide);
  const out = { ...withOpenings, terrace };
  return { ...out, placementMm: p.placementLocked ? p.placementMm : centerOnPlot(out) };
}
