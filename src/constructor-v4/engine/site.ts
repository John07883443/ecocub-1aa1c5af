/**
 * Посадка вне модулей: навес для машины. Ставится у входа (машина — к крыльцу),
 * в пределах участка, с проходом от дома. Координаты — как у модулей (мм, x на
 * восток, y на север, начало — начало координат дома).
 */
import { bbox, footprint, type Rect } from "./geometry.ts";
import type { Project, Side } from "./types.ts";

export interface Carport {
  rect: Rect;
  /** Сторона дома, у которой стоит навес. */
  side: Side;
  widthMm: number;
  depthMm: number;
  label: string;
}

/** Навес на одну машину: 3,5 × 6 м (черновик, уточняет проектировщик). */
export const CARPORT = { widthMm: 3500, depthMm: 6000, gapMm: 2000 } as const;

function insidePlot(p: Project, r: Rect): boolean {
  if (!p.plot) return true;
  const x0 = -p.placementMm.xMm;
  const y0 = -p.placementMm.yMm;
  const x1 = x0 + p.plot.widthM * 1000;
  const y1 = y0 + p.plot.depthM * 1000;
  return r.x0 >= x0 && r.y0 >= y0 && r.x1 <= x1 && r.y1 <= y1;
}

/** Где стоит навес. null — машины нет в сценарии или на участке не помещается. */
export function carportPlace(p: Project): Carport | null {
  if (!p.household?.car || !p.modules.length) return null;
  const t1 = p.modules.filter((m) => m.tier === 1);
  const b = bbox((t1.length ? t1 : p.modules).map(footprint));
  const entrance = p.openings.find((o) => o.kind === "entrance");
  const order: Side[] = [entrance?.face ?? "S", "S", "E", "W", "N"].filter(
    (s, i, a) => a.indexOf(s) === i,
  ) as Side[];
  const { widthMm: w, depthMm: d, gapMm: g } = CARPORT;
  for (const side of order) {
    const cands: Rect[] =
      side === "S" || side === "N"
        ? [b.x0, b.x1 - w, (b.x0 + b.x1 - w) / 2].map((x) =>
            side === "S"
              ? { x0: x, x1: x + w, y0: b.y0 - g - d, y1: b.y0 - g }
              : { x0: x, x1: x + w, y0: b.y1 + g, y1: b.y1 + g + d },
          )
        : [b.y0, b.y1 - w, (b.y0 + b.y1 - w) / 2].map((y) =>
            side === "W"
              ? { x0: b.x0 - g - d, x1: b.x0 - g, y0: y, y1: y + w }
              : { x0: b.x1 + g, x1: b.x1 + g + d, y0: y, y1: y + w },
          );
    const fit = cands.find((r) => insidePlot(p, r));
    if (fit)
      return {
        rect: fit,
        side,
        widthMm: w,
        depthMm: d,
        label: "Навес · машина",
      };
  }
  return null;
}
