import { useMemo, useRef } from "react";
import type { HouseBuilderApi } from "@/lib/constructor/useHouseBuilder";
import { CELL_M, MODULE_SIDE_M, ROLES, STEP_M } from "@/lib/constructor/constants";

// Все размеры внутри SVG — в метрах участка: viewBox совпадает с реальными
// метрами, модуль 3×3 рисуется прямоугольником 3×3.
export function PlanEditor({ api }: { api: HouseBuilderApi }) {
  const { modules, floor, gridN, selectedId, placeAtPoint, selectModule } = api;
  const svgRef = useRef<SVGSVGElement>(null);

  const side = gridN * CELL_M;
  const pad = 1;
  const vb = side + pad * 2;

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

  const handlePlace = (e: React.PointerEvent<SVGRectElement>) => {
    const svg = svgRef.current;
    if (!svg) return;
    e.preventDefault();
    const r = svg.getBoundingClientRect();
    // Перевод точки тапа из пикселей в метры участка (учитывая рамку pad).
    const px = ((e.clientX - r.left) / r.width) * vb - pad;
    const pz = ((e.clientY - r.top) / r.height) * vb - pad;
    placeAtPoint(px, pz);
  };

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

          {/* Модули текущего этажа */}
          {current.map((m) => {
            const meta = ROLES[m.role];
            const selected = m.id === selectedId;
            return (
              <g
                key={m.id}
                onPointerDown={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  selectModule(m.id);
                }}
                style={{ cursor: "pointer" }}
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
        </g>
      </svg>
    </div>
  );
}
