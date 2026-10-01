/**
 * 2D-план из той же модели, что и 3D: стены 210 (наружные) и 420 (стык спина к
 * спине), чистые размеры 2780 × 3000, двери с открыванием, окна, мебель,
 * подписи и площади. План ничего не придумывает — только рисует модель, поэтому
 * он всегда совпадает с 3D и с паспортом.
 */
import { GRAMMAR, roomSpec } from "../grammar/index.ts";
import { SIDES, contact, footprint, type Rect } from "./geometry.ts";
import { roomClearAreaM2 } from "./rules.ts";
import type { ModulePlacement, Opening, Project, Room, Side } from "./types.ts";

export type WallKind = "exterior" | "joint-b2b" | "partition";

export interface PlanWall {
  id: string;
  tier: number;
  moduleId: string;
  rect: Rect;
  thicknessMm: number;
  kind: WallKind;
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
  | "stairs";

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

function walls(p: Project): PlanWall[] {
  const out: PlanWall[] = [];
  let n = 0;
  for (const m of p.modules) {
    const r = footprint(m);
    const room = p.rooms.find((x) => x.moduleIds.includes(m.id));
    for (const face of SIDES) {
      const [s0, s1] = face === "N" || face === "S" ? [r.x0, r.x1] : [r.y0, r.y1];
      const cuts: { a: number; b: number; kind: WallKind | null }[] = [];
      for (const o of p.modules) {
        if (o.id === m.id || o.tier !== m.tier) continue;
        const c = contact(r, footprint(o));
        if (!c || c.faceA !== face) continue;
        const same = room?.moduleIds.includes(o.id);
        // Внутри одного помещения стык раскрыт — стены нет; между помещениями — две стены по 210 = 420.
        cuts.push({ a: c.from, b: c.to, kind: same ? null : "joint-b2b" });
      }
      cuts.sort((x, y) => x.a - y.a);
      let cur = s0;
      const push = (a: number, b: number, kind: WallKind) => {
        if (b > a)
          out.push({
            id: `w${++n}`,
            tier: m.tier,
            moduleId: m.id,
            rect: wallStrip(r, face, a, b),
            thicknessMm: W(),
            kind,
          });
      };
      for (const c of cuts) {
        push(cur, c.a, "exterior");
        if (c.kind) push(c.a, c.b, c.kind);
        cur = Math.max(cur, c.b);
      }
      push(cur, s1, "exterior");
    }
    // Мокрый модуль: перегородка 125 между санузлом и техчастью (тамбуром).
    if (room?.type === "wet-core") {
      const c = clearRect(m);
      const y = Math.round(c.y0 + (c.y1 - c.y0) * 0.62);
      out.push({
        id: `w${++n}`,
        tier: m.tier,
        moduleId: m.id,
        rect: { x0: c.x0, x1: c.x1, y0: y, y1: y + GRAMMAR.partitionsMm.wet },
        thicknessMm: GRAMMAR.partitionsMm.wet,
        kind: "partition",
      });
    }
  }
  return out;
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
        if (i === 0)
          add("kitchen-run", { x0: c.x0, x1: c.x0 + 600, y0: c.y0 + 300, y1: c.y1 - 300 }, m);
        if (i === 0)
          add("dining-table", { x0: cx - 300, x1: cx + 600, y0: cy - 800, y1: cy + 800 }, m);
        if (i === 1)
          add("sofa", { x0: cx - 1100, x1: cx + 1100, y0: c.y0 + 300, y1: c.y0 + 1200 }, m);
        break;
      case "wet-core": {
        const split = Math.round(c.y0 + (c.y1 - c.y0) * 0.62);
        add("shower", { x0: c.x1 - 900, x1: c.x1, y0: c.y0, y1: c.y0 + 900 }, m);
        add("wc", { x0: c.x0, x1: c.x0 + 400, y0: c.y0 + 200, y1: c.y0 + 850 }, m);
        add("sink", { x0: c.x0 + 700, x1: c.x0 + 1300, y0: c.y0, y1: c.y0 + 450 }, m);
        add("boiler", { x0: c.x1 - 500, x1: c.x1, y0: split + 200, y1: split + 700 }, m);
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
      label: roomSpec(r.type).label,
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
    notes: [
      "Наружные стены 210, стык разных помещений — спина к спине 420, внутри помещения стык раскрыт.",
      "Мебель — для понимания масштаба, не рабочая документация.",
      ...(p.modules.some((m) => m.tier === 2)
        ? ["Лестница показана условно: тип и габарит уточняет проектировщик."]
        : []),
    ],
  };
}
