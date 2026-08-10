import { useMemo, useRef, useState } from "react";
import type { HouseBuilderApi } from "@/lib/constructor/useHouseBuilder";
import { CELL_M, MODULE_SIDE_M, ROLES, STEP_M } from "@/lib/constructor/constants";
import {
  maxAnchor,
  pickSnapAnchor,
  snapAnchors,
  validMoveAnchors,
} from "@/lib/constructor/geometry";
import type { Cell, ModuleItem } from "@/lib/constructor/types";

// Все размеры внутри SVG — в метрах участка: viewBox совпадает с реальными
// метрами, модуль 3×3 рисуется прямоугольником 3×3.

/** Радиус (в шагах по 1 м), в котором вокруг курсора показываем точки-подсказки. */
const HINT_RADIUS = 4;
/** Порог в пикселях экрана, после которого тап превращается в перетаскивание. */
const DRAG_THRESHOLD_PX = 6;

interface DragState {
  id: string;
  /** Смещение точки захвата относительно якоря модуля, м. */
  grabDX: number;
  grabDZ: number;
  /** Текущая «сырая» позиция якоря (плавно следует за пальцем), м. */
  rawX: number;
  rawZ: number;
  startClientX: number;
  startClientY: number;
  /** true после превышения порога — тап стал перетаскиванием. */
  active: boolean;
  /** Все допустимые позиции для этого модуля (ключ «x,z»), считается один раз. */
  valid: Set<string> | null;
  /** Позиции впритык к соседям — к ним модуль магнитится в первую очередь. */
  anchors: Cell[];
  /** Магнитная позиция прошлого кадра — нужна для гистерезиса. */
  snap: Cell | null;
}

export interface PlanEditorProps {
  api: HouseBuilderApi;
  /**
   * Показывать назначение модуля цветом и буквой. По умолчанию выключено:
   * модули EcoCub универсальные, план монохромный. Экспериментальные версии
   * включают режим явно, чтобы их прежний вид не изменился.
   */
  showRoles?: boolean;
  /** Тап/клик по модулю без перетаскивания — открыть меню рядом с ним. */
  onModuleTap?: (id: string, clientX: number, clientY: number) => void;
  /** Пока меню открыто, тап по свободному месту закрывает его, а не ставит модуль. */
  suppressPlace?: boolean;
}

export function PlanEditor({
  api,
  showRoles = false,
  onModuleTap,
  suppressPlace,
}: PlanEditorProps) {
  const { modules, floor, gridN, selectedId, placeAtPoint, moveModule, selectModule } = api;
  const svgRef = useRef<SVGSVGElement>(null);

  const side = gridN * CELL_M;
  const pad = 1;
  const vb = side + pad * 2;
  const max = maxAnchor(gridN);

  const [drag, setDragState] = useState<DragState | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const setDrag = (next: DragState | null) => {
    dragRef.current = next;
    setDragState(next);
  };

  const current = useMemo(() => modules.filter((m) => m.floor === floor), [modules, floor]);
  const others = useMemo(() => modules.filter((m) => m.floor !== floor), [modules, floor]);

  /**
   * Наружные стены и внутренние швы этажа: общая грань двух кубиков не
   * рисуется дважды, поэтому состыкованные модули читаются одним контуром,
   * а не набором отдельных карточек с воздухом между ними.
   */
  const outline = useMemo(() => buildOutline(current), [current]);

  // Линии сетки: каждый метр — тонкая, каждые 3 м — заметнее.
  const gridLines = useMemo(() => {
    const minor: number[] = [];
    const major: number[] = [];
    for (let v = STEP_M; v < side; v += STEP_M) {
      (v % CELL_M === 0 ? major : minor).push(v);
    }
    return { minor, major };
  }, [side]);

  /** Перевод точки экрана в метры участка (с учётом рамки pad). */
  const toMetres = (clientX: number, clientY: number) => {
    const svg = svgRef.current;
    if (!svg) return { x: 0, z: 0 };
    const r = svg.getBoundingClientRect();
    return {
      x: ((clientX - r.left) / r.width) * vb - pad,
      z: ((clientY - r.top) / r.height) * vb - pad,
    };
  };

  /** Метры на пиксель экрана: порог магнита не должен зависеть от масштаба. */
  const metresPerPixel = () => {
    const svg = svgRef.current;
    if (!svg) return 0.05;
    const r = svg.getBoundingClientRect();
    return r.width ? vb / r.width : 0.05;
  };

  const handlePlace = (e: React.PointerEvent<SVGRectElement>) => {
    e.preventDefault();
    if (suppressPlace) {
      // Меню открыто: этот тап только закрывает его.
      onModuleTap?.("", e.clientX, e.clientY);
      return;
    }
    const p = toMetres(e.clientX, e.clientY);
    placeAtPoint(p.x, p.z);
  };

  /**
   * Куда встанет модуль при отпускании: сначала магнитные позиции впритык к
   * соседям, и только если рядом никого нет — ближайшая свободная точка сетки.
   */
  const snapFor = (d: DragState): Cell | null => {
    const threshold = Math.max(0.7, metresPerPixel() * 28);
    const magnetic = pickSnapAnchor(d.anchors, d.rawX, d.rawZ, d.snap, threshold);
    if (magnetic) return magnetic;
    if (!d.valid) return null;
    const bx = Math.round(d.rawX);
    const bz = Math.round(d.rawZ);
    let best: Cell | null = null;
    let bestDist = Infinity;
    for (let dx = -2; dx <= 2; dx += 1) {
      for (let dz = -2; dz <= 2; dz += 1) {
        const x = bx + dx;
        const z = bz + dz;
        if (x < 0 || z < 0 || x > max || z > max) continue;
        if (!d.valid.has(`${x},${z}`)) continue;
        const dist = (x - d.rawX) ** 2 + (z - d.rawZ) ** 2;
        if (dist < bestDist) {
          bestDist = dist;
          best = { x, z };
        }
      }
    }
    return best;
  };

  const startDrag = (e: React.PointerEvent<SVGGElement>, m: ModuleItem) => {
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    const p = toMetres(e.clientX, e.clientY);
    setDrag({
      id: m.id,
      grabDX: p.x - m.x,
      grabDZ: p.z - m.z,
      rawX: m.x,
      rawZ: m.z,
      startClientX: e.clientX,
      startClientY: e.clientY,
      active: false,
      valid: null,
      anchors: [],
      snap: null,
    });
  };

  const updateDrag = (e: React.PointerEvent<SVGGElement>) => {
    const d = dragRef.current;
    if (!d) return;
    let next = d;
    if (!d.active) {
      const dist = Math.hypot(e.clientX - d.startClientX, e.clientY - d.startClientY);
      if (dist < DRAG_THRESHOLD_PX) return;
      next = {
        ...next,
        active: true,
        valid: validMoveAnchors(modules, d.id, gridN),
        anchors: snapAnchors(modules, floor, gridN, d.id),
      };
    }
    const p = toMetres(e.clientX, e.clientY);
    const clamp = (v: number) => Math.max(-0.6, Math.min(max + 0.6, v));
    const moved = { ...next, rawX: clamp(p.x - d.grabDX), rawZ: clamp(p.z - d.grabDZ) };
    setDrag({ ...moved, snap: snapFor(moved) });
  };

  const endDrag = (commit: boolean, e?: React.PointerEvent) => {
    const d = dragRef.current;
    setDrag(null);
    if (!d) return;
    if (!d.active) {
      // Короткое нажатие без сдвига — выбор модуля и меню действий.
      if (commit) {
        selectModule(d.id);
        if (e) onModuleTap?.(d.id, e.clientX, e.clientY);
      }
      return;
    }
    if (!commit) return;
    const snap = snapFor(d);
    if (snap) moveModule(d.id, snap.x, snap.z);
  };

  const dragModule = drag?.active ? (modules.find((m) => m.id === drag.id) ?? null) : null;
  const dragSnap = drag?.active ? drag.snap : null;

  // Точки-подсказки вокруг курсора: как ходы в шахматах — куда модуль можно поставить.
  const hintDots = useMemo(() => {
    if (!drag?.active || !drag.valid) return [];
    const bx = Math.round(drag.rawX);
    const bz = Math.round(drag.rawZ);
    const dots: Cell[] = [];
    for (let dx = -HINT_RADIUS; dx <= HINT_RADIUS; dx += 1) {
      for (let dz = -HINT_RADIUS; dz <= HINT_RADIUS; dz += 1) {
        const x = bx + dx;
        const z = bz + dz;
        if (x < 0 || z < 0 || x > max || z > max) continue;
        if (drag.valid.has(`${x},${z}`)) dots.push({ x, z });
      }
    }
    return dots;
  }, [drag, max]);

  const fillFor = (m: ModuleItem) => (showRoles ? ROLES[m.role].plan : "#ffffff");

  return (
    <div className="w-full">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${vb} ${vb}`}
        className="w-full touch-manipulation select-none rounded-sm border border-border bg-[#eef1ea]"
        role="img"
        aria-label="План дома — сетка участка с шагом 1 м"
      >
        <g transform={`translate(${pad} ${pad})`}>
          {/* Участок */}
          <rect x={0} y={0} width={side} height={side} fill="#e5eadd" />

          {/* Сетка: 1 м — тонко, 3 м — заметнее */}
          {gridLines.minor.map((v) => (
            <g key={`mn-${v}`} stroke="rgba(0,0,0,0.05)" strokeWidth={0.04}>
              <line x1={v} y1={0} x2={v} y2={side} />
              <line x1={0} y1={v} x2={side} y2={v} />
            </g>
          ))}
          {gridLines.major.map((v) => (
            <g key={`mj-${v}`} stroke="rgba(0,0,0,0.12)" strokeWidth={0.06}>
              <line x1={v} y1={0} x2={v} y2={side} />
              <line x1={0} y1={v} x2={side} y2={v} />
            </g>
          ))}

          {/* Слой установки: тап по свободному месту ставит модуль */}
          <rect
            x={0}
            y={0}
            width={side}
            height={side}
            fill="transparent"
            onPointerDown={handlePlace}
            style={{ cursor: "copy" }}
          />

          {/* Модули других этажей — призрачный контур */}
          {others.map((m) => (
            <rect
              key={`o-${m.id}`}
              x={m.x}
              y={m.z}
              width={MODULE_SIDE_M}
              height={MODULE_SIDE_M}
              fill="none"
              stroke="rgba(0,0,0,0.25)"
              strokeWidth={0.07}
              strokeDasharray="0.55 0.35"
              style={{ pointerEvents: "none" }}
            />
          ))}

          {/* Поверхность дома: кубики стоят встык — без зазоров и скруглений */}
          {current.map((m) => (
            <rect
              key={`s-${m.id}`}
              x={m.x}
              y={m.z}
              width={MODULE_SIDE_M}
              height={MODULE_SIDE_M}
              fill={fillFor(m)}
              fillOpacity={drag?.active && drag.id === m.id ? 0.25 : 1}
              style={{ pointerEvents: "none" }}
            />
          ))}

          {/* Технологический шов между соседними кубиками */}
          {outline.seams.map((s, i) => (
            <line
              key={`seam-${i}`}
              x1={s.x1}
              y1={s.z1}
              x2={s.x2}
              y2={s.z2}
              stroke="rgba(0,0,0,0.16)"
              strokeWidth={0.05}
              style={{ pointerEvents: "none" }}
            />
          ))}

          {/* Единый внешний контур дома */}
          {outline.walls.map((w, i) => (
            <line
              key={`wall-${i}`}
              x1={w.x1}
              y1={w.z1}
              x2={w.x2}
              y2={w.z2}
              stroke="#3f423e"
              strokeWidth={0.14}
              strokeLinecap="square"
              style={{ pointerEvents: "none" }}
            />
          ))}

          {/* Зоны захвата: тап — меню модуля, перетаскивание — перенос */}
          {current.map((m) => {
            const selected = m.id === selectedId;
            return (
              <g
                key={m.id}
                onPointerDown={(e) => startDrag(e, m)}
                onPointerMove={updateDrag}
                onPointerUp={(e) => endDrag(true, e)}
                onPointerCancel={() => endDrag(false)}
                style={{ cursor: "grab", touchAction: "none" }}
              >
                <rect
                  x={m.x}
                  y={m.z}
                  width={MODULE_SIDE_M}
                  height={MODULE_SIDE_M}
                  fill="transparent"
                />
                {selected && (
                  <rect
                    x={m.x + 0.08}
                    y={m.z + 0.08}
                    width={MODULE_SIDE_M - 0.16}
                    height={MODULE_SIDE_M - 0.16}
                    fill="rgba(198,161,90,0.14)"
                    stroke="#c6a15a"
                    strokeWidth={0.12}
                    style={{ pointerEvents: "none" }}
                  />
                )}
              </g>
            );
          })}

          {/* Слой перетаскивания: подсказки, магнитная позиция и «летящий» модуль */}
          {drag?.active && dragModule && (
            <g style={{ pointerEvents: "none" }}>
              {hintDots.map((c) => {
                const isSnap = dragSnap && c.x === dragSnap.x && c.z === dragSnap.z;
                return (
                  <circle
                    key={`h-${c.x}-${c.z}`}
                    cx={c.x + MODULE_SIDE_M / 2}
                    cy={c.z + MODULE_SIDE_M / 2}
                    r={isSnap ? 0.26 : 0.13}
                    fill={isSnap ? "#15803d" : "rgba(21,128,61,0.45)"}
                  />
                );
              })}

              {dragSnap && (
                <rect
                  x={dragSnap.x}
                  y={dragSnap.z}
                  width={MODULE_SIDE_M}
                  height={MODULE_SIDE_M}
                  fill="rgba(21,128,61,0.14)"
                  stroke="#15803d"
                  strokeWidth={0.12}
                />
              )}

              <rect
                x={drag.rawX}
                y={drag.rawZ}
                width={MODULE_SIDE_M}
                height={MODULE_SIDE_M}
                fill={fillFor(dragModule)}
                fillOpacity={0.9}
                stroke={dragSnap ? "#3f423e" : "#dc2626"}
                strokeWidth={0.12}
              />
            </g>
          )}
        </g>
      </svg>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Контур этажа                                                        */
/* ------------------------------------------------------------------ */

type Seg = { x1: number; z1: number; x2: number; z2: number };
type Interval = { from: number; to: number };

function subtract(base: Interval, cuts: Interval[]): Interval[] {
  let parts: Interval[] = [base];
  for (const cut of cuts) {
    const next: Interval[] = [];
    for (const p of parts) {
      if (cut.to <= p.from + 1e-9 || cut.from >= p.to - 1e-9) {
        next.push(p);
        continue;
      }
      if (cut.from > p.from + 1e-9) next.push({ from: p.from, to: cut.from });
      if (cut.to < p.to - 1e-9) next.push({ from: cut.to, to: p.to });
    }
    parts = next.filter((p) => p.to - p.from > 1e-9);
  }
  return parts;
}

/** Наружные стены (свободные грани) и внутренние швы (общие грани) этажа. */
function buildOutline(modules: ModuleItem[]): { walls: Seg[]; seams: Seg[] } {
  const walls: Seg[] = [];
  const seams: Seg[] = [];
  const S = MODULE_SIDE_M;

  for (const m of modules) {
    const rest = modules.filter((o) => o.id !== m.id);

    for (const [atX, isLeft] of [
      [m.x, true],
      [m.x + S, false],
    ] as const) {
      const cuts: Interval[] = [];
      for (const o of rest) {
        const touches = isLeft ? Math.abs(o.x + S - m.x) < 1e-9 : Math.abs(o.x - (m.x + S)) < 1e-9;
        if (!touches) continue;
        const from = Math.max(m.z, o.z);
        const to = Math.min(m.z + S, o.z + S);
        if (to > from) cuts.push({ from, to });
      }
      for (const part of subtract({ from: m.z, to: m.z + S }, cuts)) {
        walls.push({ x1: atX, z1: part.from, x2: atX, z2: part.to });
      }
      // Шов рисуем один раз — только со стороны правой грани.
      if (!isLeft) {
        for (const c of cuts) seams.push({ x1: atX, z1: c.from, x2: atX, z2: c.to });
      }
    }

    for (const [atZ, isTop] of [
      [m.z, true],
      [m.z + S, false],
    ] as const) {
      const cuts: Interval[] = [];
      for (const o of rest) {
        const touches = isTop ? Math.abs(o.z + S - m.z) < 1e-9 : Math.abs(o.z - (m.z + S)) < 1e-9;
        if (!touches) continue;
        const from = Math.max(m.x, o.x);
        const to = Math.min(m.x + S, o.x + S);
        if (to > from) cuts.push({ from, to });
      }
      for (const part of subtract({ from: m.x, to: m.x + S }, cuts)) {
        walls.push({ x1: part.from, z1: atZ, x2: part.to, z2: atZ });
      }
      if (!isTop) {
        for (const c of cuts) seams.push({ x1: c.from, z1: atZ, x2: c.to, z2: atZ });
      }
    }
  }

  return { walls, seams };
}
