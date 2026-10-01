/**
 * 2D-план из той же модели, что и 3D: стены 210 (наружные) и 420 (стык спина к
 * спине), чистые размеры 2780 × 3000, двери с открыванием, окна, мебель,
 * подписи и площади. План ничего не придумывает — только рисует модель, поэтому
 * он всегда совпадает с 3D и с паспортом.
 */
import { GRAMMAR, roomSpec } from "../grammar/index.ts";
import { SIDES, contact, footprint, type Rect } from "./geometry.ts";
import { roomClearAreaM2 } from "./rules.ts";
import { kitchenZone, moduleBehind, openingSpan } from "./graph.ts";
import { tvPlace } from "./tv.ts";
import type { ModulePlacement, Opening, Project, Room, Side } from "./types.ts";

export type WallKind = "exterior" | "joint-b2b" | "partition";

export interface PlanWall {
  id: string;
  tier: number;
  moduleId: string;
  /** Полоса стены модуля (210) — для расчётов. */
  rect: Rect;
  /** Как рисовать: стык — тонкая стена 120 у линии стыка, чтобы две стены читались парой с зазором. */
  drawRect: Rect;
  thicknessMm: number;
  kind: WallKind;
}

/** Проём в стыке: дверь между помещениями или широкий портал внутри одного помещения. */
export interface PlanPortal {
  id: string;
  tier: number;
  kind: "open" | "door";
  /** Отрезок по линии стыка. */
  a: { x: number; y: number };
  b: { x: number; y: number };
  rooms: [string, string];
}

export interface PlanEntrance {
  tier: number;
  doorId: string;
  label: string;
  at: { x: number; y: number };
  /** Крыльцо снаружи у входной двери. */
  porch: Rect;
}

export interface PlanRoom {
  id: string;
  tier: number;
  type: Room["type"];
  label: string;
  areaM2: number;
  clearRects: Rect[];
  labelAt: { x: number; y: number };
  clearDims: string;
}

export interface PlanDoor {
  id: string;
  tier: number;
  kind: "entrance" | "internal-door";
  widthMm: number;
  /** Петля и конец полотна в открытом положении (90°) — дуга открывания между ними. */
  hinge: { x: number; y: number };
  leafEnd: { x: number; y: number };
  closedEnd: { x: number; y: number };
  swingInto: string;
}

export interface PlanWindow {
  id: string;
  tier: number;
  rect: Rect;
  heightMm: number;
}

export type FurnitureKind =
  | "bed"
  | "nightstand"
  | "kitchen-run"
  | "sofa"
  | "dining-table"
  | "shower"
  | "wc"
  | "sink"
  | "boiler"
  | "desk"
  | "stairs"
  | "tv"
  | "wardrobe"
  | "litter";

export interface PlanFurniture {
  id: string;
  roomId: string;
  tier: number;
  kind: FurnitureKind;
  rect: Rect;
}

export interface PlanModel {
  walls: PlanWall[];
  rooms: PlanRoom[];
  doors: PlanDoor[];
  windows: PlanWindow[];
  furniture: PlanFurniture[];
  portals: PlanPortal[];
  entrances: PlanEntrance[];
  notes: string[];
}

const W = () => GRAMMAR.module.wallMm;

export function clearRect(m: ModulePlacement): Rect {
  const r = footprint(m);
  const w = W();
  return { x0: r.x0 + w, y0: r.y0 + w, x1: r.x1 - w, y1: r.y1 - w };
}

/** Полоса стены модуля вдоль грани на отрезке [a, b] оси грани. */
function wallStrip(r: Rect, face: Side, a: number, b: number): Rect {
  const w = W();
  switch (face) {
    case "N":
      return { x0: a, x1: b, y0: r.y1 - w, y1: r.y1 };
    case "S":
      return { x0: a, x1: b, y0: r.y0, y1: r.y0 + w };
    case "E":
      return { x0: r.x1 - w, x1: r.x1, y0: a, y1: b };
    case "W":
      return { x0: r.x0, x1: r.x0 + w, y0: a, y1: b };
  }
}

function inward(face: Side): { x: number; y: number } {
  return { N: { x: 0, y: -1 }, S: { x: 0, y: 1 }, E: { x: -1, y: 0 }, W: { x: 1, y: 0 } }[face];
}

const JOINT_DRAW = 120;

/** Тонкая полоса у линии стыка — так рисуется каждая из двух стен стыка. */
function jointDraw(r: Rect, face: Side, a: number, b: number): Rect {
  const t = JOINT_DRAW;
  switch (face) {
    case "N":
      return { x0: a, x1: b, y0: r.y1 - t, y1: r.y1 };
    case "S":
      return { x0: a, x1: b, y0: r.y0, y1: r.y0 + t };
    case "E":
      return { x0: r.x1 - t, x1: r.x1, y0: a, y1: b };
    case "W":
      return { x0: r.x0, x1: r.x0 + t, y0: a, y1: b };
  }
}

/** Где в стене грани проёмы-двери: свои и соседа за стыком (дверь режет обе стены). */
function doorCuts(p: Project, m: ModulePlacement, face: Side): [number, number][] {
  const out: [number, number][] = [];
  for (const o of p.openings)
    if (o.kind !== "window" && o.moduleId === m.id && o.face === face) out.push(openingSpan(m, o));
  for (const o of p.openings) {
    if (o.kind !== "internal-door" || o.moduleId === m.id) continue;
    const om = p.modules.find((x) => x.id === o.moduleId);
    if (!om || om.tier !== m.tier) continue;
    const opposite = { N: "S", S: "N", E: "W", W: "E" }[o.face];
    if (face === opposite && moduleBehind(p, om, o)?.id === m.id) out.push(openingSpan(om, o));
  }
  return out.sort((x, y) => x[0] - y[0]);
}

function subtract(a: number, b: number, cuts: [number, number][]): [number, number][] {
  let segs: [number, number][] = [[a, b]];
  for (const [c0, c1] of cuts)
    segs = segs.flatMap(([s0, s1]) => {
      if (c1 <= s0 || c0 >= s1) return [[s0, s1] as [number, number]];
      const r: [number, number][] = [];
      if (c0 > s0) r.push([s0, c0]);
      if (c1 < s1) r.push([c1, s1]);
      return r;
    });
  return segs;
}

/** Зоны мокрого модуля: тамбур (проход между дверями) и санузел за перегородкой. */
export function wetZones(
  p: Project,
  m: ModulePlacement,
): { bath: Rect; tambour: Rect | null; partitions: Rect[] } {
  const c = clearRect(m);
  const doors = p.openings.filter((o) => o.moduleId === m.id && o.kind !== "window");
  const t = GRAMMAR.partitionsMm.wet;
  if (doors.length < 2 && !doors.some((o) => o.kind === "entrance"))
    return { bath: c, tambour: null, partitions: [] };
  const band = 1100;
  const gap = 700;
  // Двери ставятся у начала грани, поэтому полоса — у младшей стороны по x (или по y, если дверь на восточной грани).
  if (!doors.some((o) => o.face === "E")) {
    const x = c.x0 + band;
    const mid = (c.y0 + c.y1) / 2;
    return {
      tambour: { x0: c.x0, x1: x, y0: c.y0, y1: c.y1 },
      bath: { x0: x + t, x1: c.x1, y0: c.y0, y1: c.y1 },
      partitions: [
        { x0: x, x1: x + t, y0: c.y0, y1: mid - gap / 2 },
        { x0: x, x1: x + t, y0: mid + gap / 2, y1: c.y1 },
      ],
    };
  }
  const y = c.y0 + band;
  const mid = (c.x0 + c.x1) / 2;
  return {
    tambour: { x0: c.x0, x1: c.x1, y0: c.y0, y1: y },
    bath: { x0: c.x0, x1: c.x1, y0: y + t, y1: c.y1 },
    partitions: [
      { x0: c.x0, x1: mid - gap / 2, y0: y, y1: y + t },
      { x0: mid + gap / 2, x1: c.x1, y0: y, y1: y + t },
    ],
  };
}

function walls(p: Project): PlanWall[] {
  const out: PlanWall[] = [];
  let n = 0;
  for (const m of p.modules) {
    const r = footprint(m);
    const room = p.rooms.find((x) => x.moduleIds.includes(m.id));
    for (const face of SIDES) {
      const [s0, s1] = face === "N" || face === "S" ? [r.x0, r.x1] : [r.y0, r.y1];
      const joints: { a: number; b: number; same: boolean }[] = [];
      for (const o of p.modules) {
        if (o.id === m.id || o.tier !== m.tier) continue;
        const c = contact(r, footprint(o));
        if (!c || c.faceA !== face) continue;
        joints.push({ a: c.from, b: c.to, same: !!room?.moduleIds.includes(o.id) });
      }
      joints.sort((x, y) => x.a - y.a);
      const cuts = doorCuts(p, m, face);
      const push = (a: number, b: number, kind: WallKind) => {
        for (const [x0, x1] of subtract(a, b, cuts))
          if (x1 > x0)
            out.push({
              id: `w${++n}`,
              tier: m.tier,
              moduleId: m.id,
              rect: wallStrip(r, face, x0, x1),
              drawRect:
                kind === "joint-b2b" ? jointDraw(r, face, x0, x1) : wallStrip(r, face, x0, x1),
              thicknessMm: W(),
              kind,
            });
      };
      let cur = s0;
      for (const j of joints) {
        push(cur, j.a, "exterior");
        // Внутри одного помещения стык раскрыт (портал), между помещениями — две стены.
        if (!j.same) push(j.a, j.b, "joint-b2b");
        cur = Math.max(cur, j.b);
      }
      push(cur, s1, "exterior");
    }
    // Мокрый модуль: если в нём вход (тамбур) или две двери — тамбур полосой вдоль дверей,
    // санузел за перегородкой 125 с дверью 700. Проход идёт через тамбур, а не через санузел.
    if (room?.type === "wet-core") {
      const z = wetZones(p, m);
      for (const rect of z.partitions)
        out.push({
          id: `w${++n}`,
          tier: m.tier,
          moduleId: m.id,
          rect,
          drawRect: rect,
          thicknessMm: GRAMMAR.partitionsMm.wet,
          kind: "partition",
        });
    }
  }
  return out;
}

/** Порталы: раскрытые стыки внутри помещения и двери в стыках между помещениями. */
function portals(p: Project): PlanPortal[] {
  const out: PlanPortal[] = [];
  let n = 0;
  for (const r of p.rooms) {
    const mods = p.modules.filter((m) => r.moduleIds.includes(m.id));
    for (let i = 0; i < mods.length; i++)
      for (let j = i + 1; j < mods.length; j++) {
        const fa = footprint(mods[i]);
        const c = contact(fa, footprint(mods[j]));
        if (!c) continue;
        const line =
          c.faceA === "E" ? fa.x1 : c.faceA === "W" ? fa.x0 : c.faceA === "N" ? fa.y1 : fa.y0;
        const vertical = c.faceA === "E" || c.faceA === "W";
        out.push({
          id: `portal-${++n}`,
          tier: r.tier,
          kind: "open",
          a: vertical ? { x: line, y: c.from } : { x: c.from, y: line },
          b: vertical ? { x: line, y: c.to } : { x: c.to, y: line },
          rooms: [r.id, r.id],
        });
      }
  }
  for (const o of p.openings.filter((x) => x.kind === "internal-door")) {
    const m = p.modules.find((x) => x.id === o.moduleId);
    if (!m) continue;
    const behind = moduleBehind(p, m, o);
    const other = behind ? p.rooms.find((r) => r.moduleIds.includes(behind.id)) : undefined;
    if (!other) continue;
    const fr = footprint(m);
    const [s0, s1] = openingSpan(m, o);
    const line = o.face === "E" ? fr.x1 : o.face === "W" ? fr.x0 : o.face === "N" ? fr.y1 : fr.y0;
    const vertical = o.face === "E" || o.face === "W";
    out.push({
      id: `portal-${++n}`,
      tier: m.tier,
      kind: "door",
      a: vertical ? { x: line, y: s0 } : { x: s0, y: line },
      b: vertical ? { x: line, y: s1 } : { x: s1, y: line },
      rooms: [o.roomId, other.id],
    });
  }
  return out;
}

function entrances(p: Project): PlanEntrance[] {
  return p.openings
    .filter((o) => o.kind === "entrance")
    .flatMap((o) => {
      const m = p.modules.find((x) => x.id === o.moduleId);
      if (!m) return [];
      const r = footprint(m);
      const [s0, s1] = openingSpan(m, o);
      const depth = 1500;
      const pad = 600;
      const porch: Rect =
        o.face === "S"
          ? { x0: s0 - pad, x1: s1 + pad, y0: r.y0 - depth, y1: r.y0 }
          : o.face === "N"
            ? { x0: s0 - pad, x1: s1 + pad, y0: r.y1, y1: r.y1 + depth }
            : o.face === "E"
              ? { x0: r.x1, x1: r.x1 + depth, y0: s0 - pad, y1: s1 + pad }
              : { x0: r.x0 - depth, x1: r.x0, y0: s0 - pad, y1: s1 + pad };
      const room = p.rooms.find((x) => x.id === o.roomId);
      return [
        {
          tier: m.tier,
          doorId: o.id,
          label: room?.type === "wet-core" ? "Вход · тамбур" : "Вход",
          at: { x: (porch.x0 + porch.x1) / 2, y: (porch.y0 + porch.y1) / 2 },
          porch,
        },
      ];
    });
}

function openingLine(
  m: ModulePlacement,
  o: Opening,
): { a: { x: number; y: number }; b: { x: number; y: number } } {
  const r = footprint(m);
  const w = W();
  const horizontal = o.face === "N" || o.face === "S";
  const start = (horizontal ? r.x0 : r.y0) + o.offsetMm;
  const inner = { N: r.y1 - w, S: r.y0 + w, E: r.x1 - w, W: r.x0 + w }[o.face];
  return horizontal
    ? { a: { x: start, y: inner }, b: { x: start + o.widthMm, y: inner } }
    : { a: { x: inner, y: start }, b: { x: inner, y: start + o.widthMm } };
}

function furnitureFor(p: Project, room: Room): PlanFurniture[] {
  const mods = p.modules.filter((m) => room.moduleIds.includes(m.id));
  const out: PlanFurniture[] = [];
  let n = 0;
  const add = (kind: FurnitureKind, rect: Rect, m: ModulePlacement) =>
    out.push({ id: `${room.id}-f${++n}`, roomId: room.id, tier: m.tier, kind, rect });
  const doorFaces = (m: ModulePlacement) =>
    new Set(
      p.openings.filter((o) => o.moduleId === m.id && o.kind !== "window").map((o) => o.face),
    );
  const windowFaces = (m: ModulePlacement) =>
    new Set(
      p.openings.filter((o) => o.moduleId === m.id && o.kind === "window").map((o) => o.face),
    );
  for (const [i, m] of mods.entries()) {
    const c = clearRect(m);
    const cx = (c.x0 + c.x1) / 2;
    const cy = (c.y0 + c.y1) / 2;
    switch (room.type) {
      case "bedroom": {
        // Второй кубик главной спальни — гардеробная: шкафы вдоль глухой стены.
        if (i > 0) {
          const north = !doorFaces(m).has("N") && !windowFaces(m).has("N");
          add(
            "wardrobe",
            north
              ? { x0: c.x0 + 200, x1: c.x1 - 200, y0: c.y1 - 600, y1: c.y1 }
              : { x0: c.x0 + 200, x1: c.x1 - 200, y0: c.y0, y1: c.y0 + 600 },
            m,
          );
          break;
        }
        // Изголовье к стене без двери и окна: север или юг.
        const head: "N" | "S" = !doorFaces(m).has("N") && !windowFaces(m).has("N") ? "N" : "S";
        const y0 = head === "N" ? c.y1 - 2000 : c.y0;
        add("bed", { x0: cx - 800, x1: cx + 800, y0, y1: y0 + 2000 }, m);
        const ny0 = head === "N" ? c.y1 - 400 : c.y0;
        add("nightstand", { x0: cx - 1250, x1: cx - 850, y0: ny0, y1: ny0 + 400 }, m);
        add("nightstand", { x0: cx + 850, x1: cx + 1250, y0: ny0, y1: ny0 + 400 }, m);
        break;
      }
      case "kitchen-living":
        // Кухонный фронт — в кубике, куда не открываются спальни (graph.ts).
        if (m.id === (kitchenZone(p)?.moduleId ?? mods[0]?.id)) {
          add(
            "kitchen-run",
            kitchenZone(p)?.run ?? { x0: c.x0, x1: c.x0 + 600, y0: c.y0 + 300, y1: c.y1 - 300 },
            m,
          );
          add("dining-table", { x0: cx - 300, x1: cx + 600, y0: cy - 800, y1: cy + 800 }, m);
        }
        // Диван и ТВ ставятся по месту под телевизор (engine/tv.ts), а не «на глаз».
        if (i === 0) {
          const t = tvPlace(p);
          if (t) {
            add("tv", t.tv, m);
            add("sofa", t.sofa, m);
          }
        }
        break;
      case "wet-core": {
        const z = wetZones(p, m).bath;
        add("shower", { x0: z.x1 - 900, x1: z.x1, y0: z.y1 - 900, y1: z.y1 }, m);
        add("wc", { x0: z.x1 - 400, x1: z.x1, y0: z.y0 + 300, y1: z.y0 + 950 }, m);
        add(
          "sink",
          {
            x0: z.x1 - 1100 > z.x0 ? z.x1 - 1100 : z.x0,
            x1: (z.x1 - 1100 > z.x0 ? z.x1 - 1100 : z.x0) + 500,
            y0: z.y0,
            y1: z.y0 + 450,
          },
          m,
        );
        add("boiler", { x0: z.x0, x1: z.x0 + 500, y0: z.y1 - 500, y1: z.y1 }, m);
        // Кошки: ниша под лоток в техблоке (в тамбуре, если он есть) — у первого санузла 1-го яруса.
        const firstWet = p.rooms.find((x) => x.type === "wet-core" && x.tier === 1);
        if ((p.household?.cats ?? 0) > 0 && room.id === firstWet?.id && i === 0) {
          const t = wetZones(p, m).tambour;
          const at = t
            ? { x0: t.x0, x1: t.x0 + 600, y0: t.y1 - 500, y1: t.y1 }
            : { x0: z.x0 + 600, x1: z.x0 + 1200, y0: z.y1 - 500, y1: z.y1 };
          add("litter", at, m);
        }
        break;
      }
      case "study":
        add("desk", { x0: cx - 700, x1: cx + 700, y0: c.y1 - 700, y1: c.y1 }, m);
        break;
      case "hall":
        add("stairs", { x0: c.x0, x1: c.x0 + 1000, y0: c.y0, y1: c.y1 }, m);
        break;
    }
  }
  return out;
}

export function planFromProject(p: Project): PlanModel {
  const rooms: PlanRoom[] = p.rooms.map((r) => {
    const mods = p.modules.filter((m) => r.moduleIds.includes(m.id));
    const rects = mods.map(clearRect);
    const cx = rects.reduce((s, x) => s + (x.x0 + x.x1) / 2, 0) / rects.length;
    const cy = rects.reduce((s, x) => s + (x.y0 + x.y1) / 2, 0) / rects.length;
    const first = rects[0];
    return {
      id: r.id,
      tier: r.tier,
      type: r.type,
      // На плане коротко: подпись должна влезать в кубик.
      label: r.type === "hall" ? "Холл · лестница" : roomSpec(r.type).label,
      areaM2: roomClearAreaM2(p, r),
      clearRects: rects,
      labelAt: { x: Math.round(cx), y: Math.round(cy) },
      clearDims: first ? `${first.x1 - first.x0} × ${first.y1 - first.y0}` : "",
    };
  });
  const doors: PlanDoor[] = [];
  const windows: PlanWindow[] = [];
  for (const o of p.openings) {
    const m = p.modules.find((x) => x.id === o.moduleId);
    if (!m) continue;
    const { a, b } = openingLine(m, o);
    if (o.kind === "window") {
      const r = footprint(m);
      const strip = wallStrip(
        r,
        o.face,
        o.face === "N" || o.face === "S" ? a.x : a.y,
        o.face === "N" || o.face === "S" ? b.x : b.y,
      );
      windows.push({ id: o.id, tier: m.tier, rect: strip, heightMm: o.heightMm });
      continue;
    }
    const d = inward(o.face);
    doors.push({
      id: o.id,
      tier: m.tier,
      kind: o.kind,
      widthMm: o.widthMm,
      hinge: a,
      closedEnd: b,
      leafEnd: { x: a.x + d.x * o.widthMm, y: a.y + d.y * o.widthMm },
      swingInto: o.roomId,
    });
  }
  return {
    walls: walls(p),
    rooms,
    doors,
    windows,
    furniture: p.rooms.flatMap((r) => furnitureFor(p, r)),
    portals: portals(p),
    entrances: entrances(p),
    notes: [
      "Наружные стены 210; стык разных помещений — две стены модулей с зазором, двери прорезают обе; внутри помещения стык раскрыт порталом.",
      "Мебель — для понимания масштаба, не рабочая документация.",
      ...(p.modules.some((m) => m.tier === 2)
        ? ["Лестница показана условно: тип и габарит уточняет проектировщик."]
        : []),
    ],
  };
}
