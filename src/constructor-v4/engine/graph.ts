/**
 * Граф связей помещений: кто с кем соединён проёмом. Ребро появляется только
 * там, где в стыке есть дверь (или лестница между ярусами), — ровно то, что
 * рисуется на плане и в 3D. По нему проверяется маршрут от входа.
 */
import { contact, footprint } from "./geometry.ts";
import type { ModulePlacement, Opening, Project } from "./types.ts";
import { intersect } from "./geometry.ts";

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
