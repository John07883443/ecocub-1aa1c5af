import { useMemo } from "react";
import type { HouseBuilderApi } from "@/lib/constructor/useHouseBuilder";
import { gridKey } from "@/lib/constructor/geometry";
import { ROLES } from "@/lib/constructor/constants";

export function PlanEditor({ api }: { api: HouseBuilderApi }) {
  const { modules, floor, gridN, selectedId, placeAtCell, selectModule, occ } = api;

  const current = useMemo(() => modules.filter((m) => m.floor === floor), [modules, floor]);
  const others = useMemo(() => modules.filter((m) => m.floor !== floor), [modules, floor]);

  const occupiedHere = useMemo(() => {
    const s = new Set<string>();
    for (const m of current) s.add(`${m.x}:${m.z}`);
    return s;
  }, [current]);

  const pad = 0.5;
  const vb = gridN + pad * 2;

  return (
    <div className="w-full">
      <svg
        viewBox={`0 0 ${vb} ${vb}`}
        className="w-full touch-manipulation select-none rounded-sm border border-border bg-[#eef1ea]"
        role="img"
        aria-label="План дома — сетка участка"
      >
        <g transform={`translate(${pad} ${pad})`}>
          {/* Участок */}
          <rect x={0} y={0} width={gridN} height={gridN} fill="#e5eadd" />

          {/* Сетка + ячейки для установки */}
          {Array.from({ length: gridN }).map((_, gx) =>
            Array.from({ length: gridN }).map((__, gz) => {
              const empty = !occupiedHere.has(`${gx}:${gz}`);
              const supported = floor === 0 || occ.has(gridKey(floor - 1, gx, gz));
              return (
                <rect
                  key={`c-${gx}-${gz}`}
                  x={gx}
                  y={gz}
                  width={1}
                  height={1}
                  fill={empty && supported && floor > 0 ? "rgba(188,155,130,0.12)" : "transparent"}
                  stroke="rgba(0,0,0,0.08)"
                  strokeWidth={0.02}
                  onPointerDown={(e) => {
                    if (!empty) return;
                    e.preventDefault();
                    placeAtCell({ x: gx, z: gz });
                  }}
                  style={{ cursor: empty ? "copy" : "default" }}
                />
              );
            }),
          )}

          {/* Модули других этажей — призрачный контур */}
          {others.map((m) => (
            <rect
              key={`o-${m.id}`}
              x={m.x + 0.06}
              y={m.z + 0.06}
              width={0.88}
              height={0.88}
              fill="none"
              stroke="rgba(0,0,0,0.28)"
              strokeWidth={0.03}
              strokeDasharray="0.18 0.12"
              rx={0.06}
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
                  x={m.x + 0.05}
                  y={m.z + 0.05}
                  width={0.9}
                  height={0.9}
                  fill={meta.plan}
                  stroke={selected ? "#1a1a1a" : "rgba(0,0,0,0.25)"}
                  strokeWidth={selected ? 0.08 : 0.03}
                  rx={0.08}
                />
                <text
                  x={m.x + 0.5}
                  y={m.z + 0.5}
                  textAnchor="middle"
                  dominantBaseline="central"
                  fontSize={0.3}
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
