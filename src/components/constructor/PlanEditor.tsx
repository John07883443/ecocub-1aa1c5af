import { useMemo, useRef, useState } from "react";
import type { HouseBuilderApi } from "@/lib/constructor/useHouseBuilder";
import { CELL_M, MODULE_SIDE_M, ROLES, STEP_M } from "@/lib/constructor/constants";
import { maxAnchor, validMoveAnchors } from "@/lib/constructor/geometry";
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
}

export function PlanEditor({ api }: { api: HouseBuilderApi }) {
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

  const handlePlace = (e: React.PointerEvent<SVGRectElement>) => {
    e.preventDefault();
    const p = toMetres(e.clientX, e.clientY);
    placeAtPoint(p.x, p.z);
  };

  /** Ближайшая к «сырой» позиции допустимая точка — туда модуль примагнитится. */
  const snapFor = (d: DragState): Cell | null => {
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
    });
  };

  const updateDrag = (e: React.PointerEvent<SVGGElement>) => {
    const d = dragRef.current;
    if (!d) return;
    let next = d;
    if (!d.active) {
      const dist = Math.hypot(e.clientX - d.startClientX, e.clientY - d.startClientY);
      if (dist < DRAG_THRESHOLD_PX) return;
      next = { ...next, active: true, valid: validMoveAnchors(modules, d.id, gridN) };
    }
    const p = toMetres(e.clientX, e.clientY);
    const clamp = (v: number) => Math.max(-0.6, Math.min(max + 0.6, v));
    setDrag({ ...next, rawX: clamp(p.x - d.grabDX), rawZ: clamp(p.z - d.grabDZ) });
  };

  const endDrag = (commit: boolean) => {
    const d = dragRef.current;
    setDrag(null);
    if (!d) return;
    if (!d.active) {
      if (commit) selectModule(d.id);
      return;
    }
    if (!commit) return;
    const snap = snapFor(d);
    if (snap) moveModule(d.id, snap.x, snap.z);
  };

  const dragModule = drag?.active ? (modules.find((m) => m.id === drag.id) ?? null) : null;
  const dragSnap = drag?.active && drag.valid ? snapFor(drag) : null;

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
              x={m.x + 0.15}
              y={m.z + 0.15}
              width={MODULE_SIDE_M - 0.3}
              height={MODULE_SIDE_M - 0.3}
              fill="none"
              stroke="rgba(0,0,0,0.28)"
              strokeWidth={0.09}
              strokeDasharray="0.55 0.35"
              rx={0.18}
              style={{ pointerEvents: "none" }}
            />
          ))}

          {/* Модули текущего этажа: тап — выбрать, потянуть — передвинуть */}
          {current.map((m) => {
            const meta = ROLES[m.role];
            const selected = m.id === selectedId;
            const isDragged = drag?.active && drag.id === m.id;
            return (
              <g
                key={m.id}
                onPointerDown={(e) => startDrag(e, m)}
                onPointerMove={updateDrag}
                onPointerUp={() => endDrag(true)}
                onPointerCancel={() => endDrag(false)}
                style={{ cursor: "grab", touchAction: "none", opacity: isDragged ? 0.25 : 1 }}
              >
                <rect
                  x={m.x + 0.15}
                  y={m.z + 0.15}
                  width={MODULE_SIDE_M - 0.3}
                  height={MODULE_SIDE_M - 0.3}
                  fill={meta.plan}
                  stroke={selected ? "#1a1a1a" : "rgba(0,0,0,0.25)"}
                  strokeWidth={selected ? 0.24 : 0.09}
                  rx={0.24}
                />
                <text
                  x={m.x + MODULE_SIDE_M / 2}
                  y={m.z + MODULE_SIDE_M / 2}
                  textAnchor="middle"
                  dominantBaseline="central"
                  fontSize={0.9}
                  fontWeight={700}
                  fill="#ffffff"
                  style={{ pointerEvents: "none" }}
                >
                  {meta.label.slice(0, 1)}
                </text>
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
                  x={dragSnap.x + 0.1}
                  y={dragSnap.z + 0.1}
                  width={MODULE_SIDE_M - 0.2}
                  height={MODULE_SIDE_M - 0.2}
                  fill="rgba(21,128,61,0.12)"
                  stroke="#15803d"
                  strokeWidth={0.12}
                  strokeDasharray="0.45 0.28"
                  rx={0.24}
                />
              )}

              <rect
                x={drag.rawX + 0.15}
                y={drag.rawZ + 0.15}
                width={MODULE_SIDE_M - 0.3}
                height={MODULE_SIDE_M - 0.3}
                fill={ROLES[dragModule.role].plan}
                fillOpacity={0.85}
                stroke={dragSnap ? "#1a1a1a" : "#dc2626"}
                strokeWidth={0.14}
                rx={0.24}
              />
            </g>
          )}
        </g>
      </svg>
    </div>
  );
}
