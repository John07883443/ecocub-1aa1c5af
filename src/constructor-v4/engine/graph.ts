/**
 * Граф связей помещений: кто с кем соединён проёмом. Ребро появляется только
 * там, где в стыке есть дверь (или лестница между ярусами), — ровно то, что
 * рисуется на плане и в 3D. По нему проверяется маршрут от входа.
 */
import { contact, footprint } from "./geometry.ts";
import type { ModulePlacement, Opening, Project, Room, Side } from "./types.ts";
import { intersect, type Rect } from "./geometry.ts";
import { GRAMMAR } from "../grammar/index.ts";

export interface RoomEdge {
  a: string;
  b: string;
  via: "door" | "stair";
  openingId?: string;
}

/** Абсолютный отрезок проёма по оси грани. */
export function openingSpan(m: ModulePlacement, o: Opening): [number, number] {
  const r = footprint(m);
  const start = (o.face === "N" || o.face === "S" ? r.x0 : r.y0) + o.offsetMm;
  return [start, start + o.widthMm];
}

/** Модуль соседа за дверью (тот же ярус, грань, перекрытие с проёмом). */
export function moduleBehind(
  p: Project,
  m: ModulePlacement,
  o: Opening,
): ModulePlacement | undefined {
  const [s0, s1] = openingSpan(m, o);
  return p.modules.find((x) => {
    if (x.id === m.id || x.tier !== m.tier) return false;
    const c = contact(footprint(m), footprint(x));
    return !!c && c.faceA === o.face && c.from < s1 && c.to > s0;
  });
}

/**
 * Кубик кухонного фронта в кухне-гостиной: первый кубик общей комнаты, в который
 * не открывается дверь спальни или кабинета. Спальня, открывающаяся прямо к
 * плите и мойке, — «вход через кухонную зону» (критик, 01.10.2026); план ставит
 * кухонный фронт сюда же (plan.ts).
 */
export function kitchenWorkModuleId(p: Project): string | null {
  const k = p.rooms.find((r) => r.type === "kitchen-living");
  if (!k?.moduleIds.length) return null;
  const privateRooms = new Set(
    p.rooms.filter((r) => r.type === "bedroom" || r.type === "study").map((r) => r.id),
  );
  const fed = new Set<string>();
  for (const o of p.openings) {
    if (o.kind !== "internal-door" || !privateRooms.has(o.roomId)) continue;
    const m = p.modules.find((x) => x.id === o.moduleId);
    const b = m ? moduleBehind(p, m, o) : undefined;
    if (b) fed.add(b.id);
  }
  return k.moduleIds.find((id) => !fed.has(id)) ?? k.moduleIds[0];
}

/**
 * Кухонный фронт (600 мм вдоль стены кубика кухни) и рабочая зона перед ним (+1000 мм).
 * Стена выбирается так, чтобы в зону не открывалась ни одна дверь: сначала стены без
 * стыка с соседним кубиком общей комнаты, без дверей и с меньшим остеклением.
 */
export function kitchenZone(
  p: Project,
): { run: Rect; zone: Rect; moduleId: string; wall: "N" | "E" | "S" | "W" } | null {
  const id = kitchenWorkModuleId(p);
  const m = id ? p.modules.find((x) => x.id === id) : undefined;
  if (!m) return null;
  const k = p.rooms.find((r) => r.moduleIds.includes(m.id));
  const r = footprint(m);
  const w = GRAMMAR.module.wallMm;
  const c = { x0: r.x0 + w, y0: r.y0 + w, x1: r.x1 - w, y1: r.y1 - w };
  const D = 600;
  const Z = 1000;
  const walls = {
    W: { run: { x0: c.x0, x1: c.x0 + D, y0: c.y0 + 300, y1: c.y1 - 300 }, dx: Z, dy: 0 },
    E: { run: { x0: c.x1 - D, x1: c.x1, y0: c.y0 + 300, y1: c.y1 - 300 }, dx: -Z, dy: 0 },
    N: { run: { x0: c.x0 + 300, x1: c.x1 - 300, y0: c.y1 - D, y1: c.y1 }, dx: 0, dy: -Z },
    S: { run: { x0: c.x0 + 300, x1: c.x1 - 300, y0: c.y0, y1: c.y0 + D }, dx: 0, dy: Z },
  } as const;
  const zoneOf = (wall: keyof typeof walls): Rect => {
    const { run, dx, dy } = walls[wall];
    return {
      x0: Math.min(run.x0, run.x0 + dx),
      x1: Math.max(run.x1, run.x1 + dx),
      y0: Math.min(run.y0, run.y0 + dy),
      y1: Math.max(run.y1, run.y1 + dy),
    };
  };
  // Двери спален и кабинетов в зону — запрет (правило room-doors), остальные двери — терпимо.
  const landings: { r: Rect; weight: number }[] = [];
  for (const o of p.openings) {
    if (o.kind === "window") continue;
    const om = p.modules.find((x) => x.id === o.moduleId);
    if (!om || om.tier !== m.tier) continue;
    if (o.kind === "entrance" && om.id === m.id) {
      landings.push({ r: entranceLanding(om, o), weight: 1e4 });
      continue;
    }
    const t = p.rooms.find((x) => x.id === o.roomId)?.type;
    if (om.id !== m.id)
      landings.push({
        r: doorLanding(om, o),
        weight: t === "bedroom" || t === "study" ? 1e6 : 1e4,
      });
  }
  const joint = (face: Side) =>
    p.modules.some((x) => {
      if (x.id === m.id || x.tier !== m.tier || !k?.moduleIds.includes(x.id)) return false;
      const ct = contact(r, footprint(x));
      return !!ct && ct.faceA === face;
    });
  const glass = (face: Side) =>
    p.openings
      .filter((o) => o.moduleId === m.id && o.face === face && o.kind === "window")
      .reduce((a, o) => a + o.widthMm, 0);
  const order = (["W", "E", "N", "S"] as const)
    .map((wall, i) => {
      const z = zoneOf(wall);
      const conflict = landings.reduce((a, l) => a + (intersect(l.r, z) ? l.weight : 0), 0);
      return { wall, score: conflict + (joint(wall) ? 1e5 : 0) + glass(wall) + i };
    })
    .sort((a, b) => a.score - b.score);
  const wall = order[0].wall;
  return { run: walls[wall].run, zone: zoneOf(wall), moduleId: m.id, wall };
}

/** Входная дверь кубика кухни: полоса на 1 м внутрь от проёма. */
function entranceLanding(m: ModulePlacement, o: Opening): Rect {
  const l = doorLanding(m, o);
  const r = footprint(m);
  const d = 1000;
  switch (o.face) {
    case "N":
      return { ...l, y0: r.y1 - d, y1: r.y1 };
    case "S":
      return { ...l, y0: r.y0, y1: r.y0 + d };
    case "E":
      return { ...l, x0: r.x1 - d, x1: r.x1 };
    case "W":
      return { ...l, x0: r.x0, x1: r.x0 + d };
  }
}

/** Куда ступаешь, войдя в дверь: полоса шириной в проём на 1 м вглубь соседнего кубика. */
export function doorLanding(m: ModulePlacement, o: Opening): Rect {
  const r = footprint(m);
  const [a, b] = openingSpan(m, o);
  const d = 1000;
  switch (o.face) {
    case "N":
      return { x0: a, x1: b, y0: r.y1, y1: r.y1 + d };
    case "S":
      return { x0: a, x1: b, y0: r.y0 - d, y1: r.y0 };
    case "E":
      return { x0: r.x1, x1: r.x1 + d, y0: a, y1: b };
    case "W":
      return { x0: r.x0 - d, x1: r.x0, y0: a, y1: b };
  }
}

export function roomGraph(p: Project): RoomEdge[] {
  const roomOfModule = (id: string) => p.rooms.find((r) => r.moduleIds.includes(id))?.id;
  const edges: RoomEdge[] = [];
  for (const o of p.openings.filter((x) => x.kind === "internal-door")) {
    const m = p.modules.find((x) => x.id === o.moduleId);
    if (!m) continue;
    const behind = moduleBehind(p, m, o);
    const other = behind ? roomOfModule(behind.id) : undefined;
    if (other && other !== o.roomId)
      edges.push({ a: o.roomId, b: other, via: "door", openingId: o.id });
  }
  // Лестница: холл второго яруса над общей комнатой.
  for (const h of p.rooms.filter((r) => r.type === "hall" && r.tier === 2)) {
    const hm = p.modules.filter((m) => h.moduleIds.includes(m.id));
    for (const k of p.rooms.filter((r) => r.type === "kitchen-living")) {
      const km = p.modules.filter((m) => k.moduleIds.includes(m.id));
      if (hm.some((a) => km.some((b) => intersect(footprint(a), footprint(b)))))
        edges.push({ a: h.id, b: k.id, via: "stair" });
    }
  }
  return edges;
}

export interface RouteCheck {
  entranceRooms: string[];
  unreachable: string[];
  /** Спальни, до которых можно дойти только через другую спальню. */
  throughBedroom: string[];
}

export function checkRoutes(p: Project): RouteCheck {
  const edges = roomGraph(p);
  const entranceRooms = [
    ...new Set(p.openings.filter((o) => o.kind === "entrance").map((o) => o.roomId)),
  ];
  const bedrooms = new Set(p.rooms.filter((r) => r.type === "bedroom").map((r) => r.id));
  const reach = (skipBedrooms: boolean) => {
    const seen = new Set<string>(entranceRooms);
    const queue = [...entranceRooms];
    while (queue.length) {
      const cur = queue.shift()!;
      if (skipBedrooms && bedrooms.has(cur) && !entranceRooms.includes(cur)) continue;
      for (const e of edges) {
        const nxt = e.a === cur ? e.b : e.b === cur ? e.a : null;
        if (nxt && !seen.has(nxt)) {
          seen.add(nxt);
          queue.push(nxt);
        }
      }
    }
    return seen;
  };
  const all = reach(false);
  const noBed = reach(true);
  return {
    entranceRooms,
    unreachable: p.rooms.filter((r) => !all.has(r.id)).map((r) => r.id),
    throughBedroom: [...bedrooms].filter((b) => all.has(b) && !noBed.has(b)),
  };
}

/** Холлы 1-го яруса, которые ничего не раздают: в них не открывается ни одна комната и нет входа. */
export function deadEndHalls(p: Project): Room[] {
  const edges = roomGraph(p);
  const typeOf = (id: string) => p.rooms.find((r) => r.id === id)?.type;
  return p.rooms.filter(
    (r) =>
      r.type === "corridor" &&
      !p.openings.some((o) => o.kind === "entrance" && o.roomId === r.id) &&
      !edges.some((e) => {
        const other = e.a === r.id ? e.b : e.b === r.id ? e.a : null;
        const t = other ? typeOf(other) : undefined;
        return !!t && t !== "kitchen-living" && t !== "hall";
      }),
  );
}
