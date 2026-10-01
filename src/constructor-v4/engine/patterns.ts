/**
 * Библиотека проверенных форм пятна застройки + метрики гармонии.
 *
 * Владелец 01.10.2026: свободный «ступенчатый рост» давал вытянутые и
 * зигзагообразные дома без ритма и пропорций. Теперь солвер берёт формы только
 * из этой библиотеки — она выведена из построенных проектов (src/lib/constructor
 * TEMPLATES и src/lib/standards): прямоугольник 2 × N (Family One 3×2, Family Two
 * 4×2), Г (Weekend Mini), П со двором (Super Family), линия со смещением середины
 * (Weekend One), квадрат 2×2 / 3×3. «Линейный дом» — только как явный паттерн.
 *
 * Координаты кубика: x = столбец × 3200, y = ряд × 3420 (+ 1710 для смещения).
 */
import { GRAMMAR } from "../grammar/index.ts";
import { footprint, type Rect } from "./geometry.ts";
import type { ModulePlacement, Side } from "./types.ts";

export type PatternId = "rect" | "square" | "L" | "U" | "notch" | "H" | "offset-line" | "linear";

export interface FootprintPattern {
  id: PatternId;
  label: string;
  /** Откуда приём: проект-образец. */
  reference: string;
  cells: { x: number; y: number }[];
}

const W = () => GRAMMAR.module.externalMm.w;
const D = () => GRAMMAR.module.externalMm.d;
const HALF = () => GRAMMAR.module.externalMm.d / 2;

const grid = (c: number, r: number, skip: (col: number, row: number) => boolean = () => false) => {
  const out: { x: number; y: number }[] = [];
  for (let row = 0; row < r; row++)
    for (let col = 0; col < c; col++) if (!skip(col, row)) out.push({ x: col * W(), y: row * D() });
  return out;
};

/** Все формы библиотеки на n кубиков первого яруса. */
export function patternShapes(n: number): FootprintPattern[] {
  const out: FootprintPattern[] = [];
  const push = (p: FootprintPattern) => {
    if (p.cells.length === n) out.push(p);
  };
  // Прямоугольники 2 × N, 3 × N, 4 × N, квадрат (CUBAX P02/P03/P04/P06, Family One/Two).
  for (let r = 2; r <= 4; r++)
    for (let c = 2; c <= 6; c++)
      if (c * r === n)
        push({
          id: c === r ? "square" : "rect",
          label: c === r ? `Квадрат ${c}×${r}` : `Прямоугольник ${c}×${r}`,
          reference:
            r === 2
              ? c === 3
                ? "Family One"
                : c === 4
                  ? "Family Two"
                  : "Family One/Two"
              : "Dinastiya",
          cells: grid(c, r),
        });
  // Г: прямоугольник без угла.
  for (let r = 2; r <= 3; r++)
    for (let c = 2; c <= 5; c++)
      if (c * r - 1 === n) {
        push({
          id: "L",
          label: `Г ${c}×${r} без угла`,
          reference: "Weekend Mini",
          cells: grid(c, r, (col, row) => col === c - 1 && row === r - 1),
        });
        push({
          id: "L",
          label: `Г ${c}×${r} без угла (зеркально)`,
          reference: "Weekend Mini",
          cells: grid(c, r, (col, row) => col === 0 && row === r - 1),
        });
      }
  // Г: прямоугольник 2 × c плюс кубик-крыло.
  for (let c = 2; c <= 5; c++)
    if (2 * c + 1 === n) {
      push({
        id: "L",
        label: `Г 2×${c} + крыло`,
        reference: "Family One",
        cells: [...grid(c, 2), { x: c * W(), y: 0 }],
      });
    }
  // П со двором: 3 × r без середины нижнего ряда (или двух нижних).
  for (let r = 2; r <= 4; r++) {
    if (3 * r - 1 === n)
      push({
        id: "U",
        label: `П 3×${r}, двор`,
        reference: "Super Family",
        cells: grid(3, r, (col, row) => col === 1 && row === 0),
      });
    if (r >= 3 && 3 * r - 2 === n)
      push({
        id: "U",
        label: `П 3×${r}, глубокий двор`,
        reference: "Super Family",
        cells: grid(3, r, (col, row) => col === 1 && row <= 1),
      });
  }
  // CUBAX P05: 4 × 3 без двух кубиков у торца — ниша-терраса, закрытая с двух сторон (Дом 93).
  if (n === 10)
    push({
      id: "notch",
      label: "4×3 с нишей-террасой",
      reference: "CUBAX P05, Дом 93",
      cells: grid(4, 3, (col, row) => col === 0 && row <= 1),
    });
  // CUBAX P07: Н-план 4 × 4 без двух центральных кубиков у фасада — двор-терраса (Дом 130/133).
  if (n === 14)
    push({
      id: "H",
      label: "Н-план 4×4 с двором",
      reference: "CUBAX P07, Дом 130/133",
      cells: grid(4, 4, (col, row) => col === 0 && (row === 1 || row === 2)),
    });
  // Линия со смещением (Weekend One) из библиотеки убрана: заполнение габарита < 75 %
  // (мировая база знаний Льва, правило A1) — даёт «рваный» силуэт.
  // Линейный дом — только явно и только короткий.
  if (n >= 2 && n <= 3)
    push({
      id: "linear",
      label: `Линейный дом ${n}`,
      reference: "Weekend One",
      cells: Array.from({ length: n }, (_, i) => ({ x: i * W(), y: 0 })),
    });
  return out;
}

// ── Метрики гармонии (для правил и ранжирования) ──────────────────────────

interface Compressed {
  xs: number[];
  ys: number[];
  occ: boolean[][]; // [ix][iy]
}

function compress(rects: Rect[]): Compressed {
  const xs = [...new Set(rects.flatMap((r) => [r.x0, r.x1]))].sort((a, b) => a - b);
  const ys = [...new Set(rects.flatMap((r) => [r.y0, r.y1]))].sort((a, b) => a - b);
  const occ = xs.slice(0, -1).map((_, ix) =>
    ys.slice(0, -1).map((__, iy) => {
      const cx = (xs[ix] + xs[ix + 1]) / 2;
      const cy = (ys[iy] + ys[iy + 1]) / 2;
      return rects.some((r) => cx > r.x0 && cx < r.x1 && cy > r.y0 && cy < r.y1);
    }),
  );
  return { xs, ys, occ };
}

/** Число углов контура (прямоугольник — 4, Г — 6, П — 8). Зигзаги дают больше. */
export function outlineCorners(mods: ModulePlacement[]): number {
  if (!mods.length) return 0;
  const { xs, ys, occ } = compress(mods.map(footprint));
  const at = (ix: number, iy: number) =>
    ix >= 0 && iy >= 0 && ix < xs.length - 1 && iy < ys.length - 1 && occ[ix][iy];
  let corners = 0;
  for (let ix = 0; ix < xs.length; ix++)
    for (let iy = 0; iy < ys.length; iy++) {
      const q = [at(ix - 1, iy - 1), at(ix, iy - 1), at(ix - 1, iy), at(ix, iy)];
      const k = q.filter(Boolean).length;
      if (k === 1 || k === 3) corners++;
      else if (k === 2 && q[0] === q[3]) corners += 2; // диагональ — двойной угол
    }
  return corners;
}

/** Профиль фасада: сколько ступенек и уровней по стороне. */
export function facadeProfile(
  mods: ModulePlacement[],
  side: Side,
): { steps: number; levels: number } {
  if (!mods.length) return { steps: 0, levels: 0 };
  const { xs, ys, occ } = compress(mods.map(footprint));
  const nx = xs.length - 1;
  const ny = ys.length - 1;
  const front: number[] = [];
  if (side === "S" || side === "N")
    for (let ix = 0; ix < nx; ix++) {
      const rows = occ[ix].map((v, iy) => (v ? iy : -1)).filter((v) => v >= 0);
      if (rows.length) front.push(side === "S" ? Math.min(...rows) : Math.max(...rows));
    }
  else
    for (let iy = 0; iy < ny; iy++) {
      const cols = occ.map((col, ix) => (col[iy] ? ix : -1)).filter((v) => v >= 0);
      if (cols.length) front.push(side === "W" ? Math.min(...cols) : Math.max(...cols));
    }
  let steps = 0;
  for (let i = 1; i < front.length; i++) if (front[i] !== front[i - 1]) steps++;
  return { steps, levels: new Set(front).size };
}

export function aspectRatio(mods: ModulePlacement[]): number {
  if (!mods.length) return 1;
  const rs = mods.map(footprint);
  const w = Math.max(...rs.map((r) => r.x1)) - Math.min(...rs.map((r) => r.x0));
  const d = Math.max(...rs.map((r) => r.y1)) - Math.min(...rs.map((r) => r.y0));
  return Math.max(w, d) / Math.min(w, d);
}

/** Близость пропорций пятна к золотому сечению, 0..1. */
export function proportionScore(mods: ModulePlacement[]): number {
  const r = aspectRatio(mods);
  return Math.max(0, 1 - Math.abs(r - 1.618) / 1.6);
}

/** Заполнение описанного прямоугольника, 0..1 (≥ 0,75 — компактно). */
export function fillRatio(mods: ModulePlacement[]): number {
  if (!mods.length) return 1;
  const rs = mods.map(footprint);
  const w = Math.max(...rs.map((r) => r.x1)) - Math.min(...rs.map((r) => r.x0));
  const d = Math.max(...rs.map((r) => r.y1)) - Math.min(...rs.map((r) => r.y0));
  return rs.reduce((s, r) => s + (r.x1 - r.x0) * (r.y1 - r.y0), 0) / (w * d);
}

export const HARMONY = {
  minFill: 0.75,
  maxCorners: 8,
  maxStepsPerFacade: 2,
  maxLevelsPerFacade: 2,
  /** Жёсткий предел пропорций — мировая практика (1:2,2); CUBAX предпочитает до 1,6. */
  maxAspect: 2.2,
  maxAspectUpper: 3,
  preferredAspect: 1.6,
};
