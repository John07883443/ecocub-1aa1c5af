/**
 * Место под телевизор в общей комнате (владелец 01.10.2026: «без телевизора сейчас никак»).
 *
 * Требования:
 *  - глухой отрезок стены ≥ 2,4 м в зоне гостиной: без окон, дверей и порталов;
 *  - диван напротив на расстоянии просмотра 2,5–3,5 м, диван помещается в комнату;
 *  - напротив ТВ (за спиной у зрителя) нет большого остекления 2800/3150 — блики;
 *  - лучше внутренняя стена, чем панорамный фасад.
 */
import { GRAMMAR } from "../grammar/index.ts";
import { contact, footprint, type Rect } from "./geometry.ts";
import type { ModulePlacement, Project, Side } from "./types.ts";

export interface TvPlace {
  roomId: string;
  moduleId: string;
  face: Side;
  /** Отрезок глухой стены по оси грани. */
  wall: [number, number];
  /** Сам телевизор (тонкий прямоугольник у стены) и диван напротив. */
  tv: Rect;
  sofa: Rect;
  viewingMm: number;
  interior: boolean;
}

export const TV = {
  minWallMm: 2400,
  tvWidthMm: 1600,
  tvDepthMm: 80,
  sofa: { w: 2200, d: 900 },
  viewMinMm: 2500,
  viewMaxMm: 3500,
  glareHeightsMm: [2800, 3150],
};

const WALL = () => GRAMMAR.module.wallMm;
const inward = (f: Side) =>
  ({ N: [0, -1], S: [0, 1], E: [-1, 0], W: [1, 0] })[f] as [number, number];
const opposite = (f: Side): Side => ({ N: "S", S: "N", E: "W", W: "E" })[f] as Side;

function subtract(segs: [number, number][], cuts: [number, number][]): [number, number][] {
  let out = segs;
  for (const [c0, c1] of cuts)
    out = out.flatMap(([a, b]) => {
      if (c1 <= a || c0 >= b) return [[a, b] as [number, number]];
      const r: [number, number][] = [];
      if (c0 > a) r.push([a, c0]);
      if (c1 < b) r.push([c1, b]);
      return r;
    });
  return out;
}

/** Внутренность помещения: чистые прямоугольники модулей, расширенные через раскрытые стыки. */
export function roomRegion(p: Project, mods: ModulePlacement[]): Rect[] {
  const w = WALL();
  return mods.map((m) => {
    const r = footprint(m);
    const c = { x0: r.x0 + w, y0: r.y0 + w, x1: r.x1 - w, y1: r.y1 - w };
    for (const o of mods) {
      if (o === m) continue;
      const k = contact(r, footprint(o));
      if (!k) continue;
      if (k.faceA === "E") c.x1 = r.x1;
      if (k.faceA === "W") c.x0 = r.x0;
      if (k.faceA === "N") c.y1 = r.y1;
      if (k.faceA === "S") c.y0 = r.y0;
    }
    return c;
  });
}

function inside(rect: Rect, region: Rect[]): boolean {
  const step = 100;
  for (let x = rect.x0; x <= rect.x1; x += step)
    for (let y = rect.y0; y <= rect.y1; y += step) {
      const px = Math.min(x, rect.x1);
      const py = Math.min(y, rect.y1);
      if (
        !region.some(
          (r) => px >= r.x0 - 0.5 && px <= r.x1 + 0.5 && py >= r.y0 - 0.5 && py <= r.y1 + 0.5,
        )
      )
        return false;
    }
  return true;
}

/** Все допустимые места под ТВ, лучшие первыми. */
export function tvCandidates(p: Project): TvPlace[] {
  const room = p.rooms.find((r) => r.type === "kitchen-living");
  if (!room) return [];
  const mods = p.modules.filter((m) => room.moduleIds.includes(m.id));
  const region = roomRegion(p, mods);
  const w = WALL();
  const out: TvPlace[] = [];
  // Собираем отрезки стен по линиям граней: для каждой грани каждого модуля.
  for (const m of mods) {
    const r = footprint(m);
    for (const face of ["N", "E", "S", "W"] as Side[]) {
      const horizontal = face === "N" || face === "S";
      const [s0, s1] = horizontal ? [r.x0 + w, r.x1 - w] : [r.y0 + w, r.y1 - w];
      let segs: [number, number][] = [[s0, s1]];
      let interior = false;
      // Стык с тем же помещением — портал, стены нет.
      for (const o of p.modules) {
        if (o.id === m.id || o.tier !== m.tier) continue;
        const k = contact(r, footprint(o));
        if (!k || k.faceA !== face) continue;
        if (room.moduleIds.includes(o.id)) segs = subtract(segs, [[k.from - w, k.to + w]]);
        else interior = true;
      }
      // Проёмы на этой грани: свои и соседей за стыком.
      const cuts: [number, number][] = [];
      for (const o of p.openings) {
        const om = p.modules.find((x) => x.id === o.moduleId);
        if (!om || om.tier !== m.tier) continue;
        const of = footprint(om);
        const start = (o.face === "N" || o.face === "S" ? of.x0 : of.y0) + o.offsetMm;
        if (om.id === m.id && o.face === face) cuts.push([start, start + o.widthMm]);
        else if (o.face === opposite(face)) {
          const k = contact(r, of);
          if (k && k.faceA === face) cuts.push([start, start + o.widthMm]);
        }
      }
      segs = subtract(segs, cuts);
      for (const [a, b] of segs) {
        if (b - a < TV.minWallMm) continue;
        const mid = (a + b) / 2;
        const [nx, ny] = inward(face);
        const line =
          face === "N" ? r.y1 - w : face === "S" ? r.y0 + w : face === "E" ? r.x1 - w : r.x0 + w;
        const tw = TV.tvWidthMm / 2;
        const tv: Rect = horizontal
          ? {
              x0: mid - tw,
              x1: mid + tw,
              y0: Math.min(line, line + ny * TV.tvDepthMm),
              y1: Math.max(line, line + ny * TV.tvDepthMm),
            }
          : {
              x0: Math.min(line, line + nx * TV.tvDepthMm),
              x1: Math.max(line, line + nx * TV.tvDepthMm),
              y0: mid - tw,
              y1: mid + tw,
            };
        // Диван: центр на расстоянии просмотра, пробуем от 2,5 до 3,5 м.
        for (let d = TV.viewMinMm; d <= TV.viewMaxMm; d += 250) {
          const cx = horizontal ? mid : line + nx * d;
          const cy = horizontal ? line + ny * d : mid;
          const hw = (horizontal ? TV.sofa.w : TV.sofa.d) / 2;
          const hd = (horizontal ? TV.sofa.d : TV.sofa.w) / 2;
          const sofa: Rect = { x0: cx - hw, x1: cx + hw, y0: cy - hd, y1: cy + hd };
          if (!inside(sofa, region)) continue;
          // Блики: напротив ТВ (за спиной зрителя) нет большого окна, перекрывающего ширину ТВ.
          const glare = p.openings.some((o) => {
            if (
              o.kind !== "window" ||
              !TV.glareHeightsMm.includes(o.heightMm) ||
              o.face !== opposite(face)
            )
              return false;
            if (!room.moduleIds.includes(o.moduleId)) return false;
            const om = p.modules.find((x) => x.id === o.moduleId)!;
            const of = footprint(om);
            const start = (horizontal ? of.x0 : of.y0) + o.offsetMm;
            return start < mid + tw && start + o.widthMm > mid - tw;
          });
          if (glare) continue;
          out.push({
            roomId: room.id,
            moduleId: m.id,
            face,
            wall: [a, b],
            tv,
            sofa,
            viewingMm: d,
            interior,
          });
          break;
        }
      }
    }
  }
  return out.sort(
    (x, y) =>
      Number(y.interior) - Number(x.interior) || y.wall[1] - y.wall[0] - (x.wall[1] - x.wall[0]),
  );
}

export function tvPlace(p: Project): TvPlace | null {
  return tvCandidates(p)[0] ?? null;
}
