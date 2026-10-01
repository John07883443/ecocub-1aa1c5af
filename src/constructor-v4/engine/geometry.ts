import { GRAMMAR } from "../grammar/index.ts";
import type { ModulePlacement, Side } from "./types.ts";

export interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export const SIDES: Side[] = ["N", "E", "S", "W"];

export function footprint(m: Pick<ModulePlacement, "xMm" | "yMm" | "rot">): Rect {
  const { w, d } = GRAMMAR.module.externalMm;
  const turned = m.rot === 90 || m.rot === 270;
  const sx = turned ? d : w;
  const sy = turned ? w : d;
  return { x0: m.xMm, y0: m.yMm, x1: m.xMm + sx, y1: m.yMm + sy };
}

export function area(r: Rect): number {
  return Math.max(0, r.x1 - r.x0) * Math.max(0, r.y1 - r.y0);
}

export function intersect(a: Rect, b: Rect): Rect | null {
  const r = {
    x0: Math.max(a.x0, b.x0),
    y0: Math.max(a.y0, b.y0),
    x1: Math.min(a.x1, b.x1),
    y1: Math.min(a.y1, b.y1),
  };
  return r.x1 > r.x0 && r.y1 > r.y0 ? r : null;
}

export function bbox(rects: Rect[]): Rect {
  return {
    x0: Math.min(...rects.map((r) => r.x0)),
    y0: Math.min(...rects.map((r) => r.y0)),
    x1: Math.max(...rects.map((r) => r.x1)),
    y1: Math.max(...rects.map((r) => r.y1)),
  };
}

export interface Contact {
  /** Грань модуля a, которой он касается b. */
  faceA: Side;
  faceB: Side;
  lengthMm: number;
  /** Смещение начала граней друг относительно друга, мм (0, 1710, ...). */
  offsetMm: number;
  /** Отрезок контакта по оси грани. */
  from: number;
  to: number;
}

/** Касание гранями (без пересечения объёмов). */
export function contact(a: Rect, b: Rect): Contact | null {
  const ov = (p0: number, p1: number, q0: number, q1: number) =>
    [Math.max(p0, q0), Math.min(p1, q1)] as const;
  if (a.x1 === b.x0 || b.x1 === a.x0) {
    const [from, to] = ov(a.y0, a.y1, b.y0, b.y1);
    if (to > from)
      return {
        faceA: a.x1 === b.x0 ? "E" : "W",
        faceB: a.x1 === b.x0 ? "W" : "E",
        lengthMm: to - from,
        offsetMm: Math.abs(a.y0 - b.y0),
        from,
        to,
      };
  }
  if (a.y1 === b.y0 || b.y1 === a.y0) {
    const [from, to] = ov(a.x0, a.x1, b.x0, b.x1);
    if (to > from)
      return {
        faceA: a.y1 === b.y0 ? "N" : "S",
        faceB: a.y1 === b.y0 ? "S" : "N",
        lengthMm: to - from,
        offsetMm: Math.abs(a.x0 - b.x0),
        from,
        to,
      };
  }
  return null;
}

/** Начало и конец грани по её оси. */
export function faceSpan(r: Rect, face: Side): [number, number] {
  return face === "N" || face === "S" ? [r.x0, r.x1] : [r.y0, r.y1];
}

/** Открытые (не закрытые соседом того же яруса) отрезки грани. */
export function uncoveredSegments(
  m: ModulePlacement,
  face: Side,
  sameTier: ModulePlacement[],
): [number, number][] {
  const r = footprint(m);
  const [s0, s1] = faceSpan(r, face);
  const covered: [number, number][] = [];
  for (const o of sameTier) {
    if (o.id === m.id) continue;
    const c = contact(r, footprint(o));
    if (c && c.faceA === face) covered.push([c.from, c.to]);
  }
  covered.sort((p, q) => p[0] - q[0]);
  const out: [number, number][] = [];
  let cur = s0;
  for (const [c0, c1] of covered) {
    if (c0 > cur) out.push([cur, c0]);
    cur = Math.max(cur, c1);
  }
  if (cur < s1) out.push([cur, s1]);
  return out;
}

export function longestUncovered(
  m: ModulePlacement,
  face: Side,
  sameTier: ModulePlacement[],
): [number, number] | null {
  const segs = uncoveredSegments(m, face, sameTier);
  if (!segs.length) return null;
  return segs.reduce((best, s) => (s[1] - s[0] > best[1] - best[0] ? s : best));
}

/** Сколько граней модуля наружные (открытый отрезок ≥ минимального контакта). */
export function exteriorFaces(m: ModulePlacement, sameTier: ModulePlacement[]): Side[] {
  return SIDES.filter((f) => {
    const s = longestUncovered(m, f, sameTier);
    return s !== null && s[1] - s[0] >= GRAMMAR.placement.minContactMm;
  });
}

/** Связность по контакту ≥ minContact. */
export function isConnected(
  mods: ModulePlacement[],
  minContact = GRAMMAR.placement.minContactMm,
): boolean {
  if (mods.length <= 1) return true;
  const seen = new Set<string>([mods[0].id]);
  const stack = [mods[0]];
  while (stack.length) {
    const cur = stack.pop()!;
    for (const o of mods) {
      if (seen.has(o.id)) continue;
      const c = contact(footprint(cur), footprint(o));
      if (c && c.lengthMm >= minContact) {
        seen.add(o.id);
        stack.push(o);
      }
    }
  }
  return seen.size === mods.length;
}

export interface SupportInfo {
  supportFraction: number;
  /** Свес за контур опоры по сторонам, мм. */
  overhangMm: Record<Side, number>;
  /** Опора без разрывов (верхний модуль не перекрывает пустоту между нижними). */
  continuous: boolean;
  supportedBy: string[];
}

/** Опора модуля второго яруса на модули первого. */
export function supportOf(upper: ModulePlacement, lower: ModulePlacement[]): SupportInfo {
  const u = footprint(upper);
  const parts: { id: string; r: Rect }[] = [];
  for (const l of lower) {
    const i = intersect(u, footprint(l));
    if (i) parts.push({ id: l.id, r: i });
  }
  if (!parts.length) {
    const full = Math.max(u.x1 - u.x0, u.y1 - u.y0);
    return {
      supportFraction: 0,
      overhangMm: { N: full, E: full, S: full, W: full },
      continuous: false,
      supportedBy: [],
    };
  }
  const sb = bbox(parts.map((p) => p.r));
  const covered = parts.reduce((s, p) => s + area(p.r), 0);
  return {
    supportFraction: covered / area(u),
    overhangMm: { N: u.y1 - sb.y1, E: u.x1 - sb.x1, S: sb.y0 - u.y0, W: sb.x0 - u.x0 },
    continuous: Math.abs(covered - area(sb)) < 1,
    supportedBy: parts.map((p) => p.id),
  };
}

export const MM2_PER_M2 = 1_000_000;
