import { useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import type { Direction } from "@/lib/barometer/price-barometer";

/**
 * Упрощённая, нелитеральная карта Московской области: кольцо из 8 секторов
 * по направлениям вокруг центра (Москва), а не реальная геометрия границ.
 * Осознанное решение — просили именно стилизованный дашборд, не точную карту
 * (см. docs/PRICE_BAROMETER_BRIEF.md).
 */

const SIZE = 360;
const CENTER = SIZE / 2;
const INNER_R = 54;
const OUTER_R = 168;
const GAP_DEG = 2.4;

/**
 * Угол по компасу (0° = север/верх, по часовой стрелке), а не порядок в
 * массиве direction.json — иначе при любой перестановке записей в JSON юг
 * мог бы отрисоваться не внизу карты.
 */
const COMPASS_ANGLE: Record<string, number> = {
  north: 0,
  northeast: 45,
  east: 90,
  southeast: 135,
  south: 180,
  southwest: 225,
  west: 270,
  northwest: 315,
};

function polar(r: number, angleDeg: number) {
  const a = (angleDeg * Math.PI) / 180;
  return { x: CENTER + r * Math.sin(a), y: CENTER - r * Math.cos(a) };
}

function wedgePath(startAngle: number, endAngle: number) {
  const outerStart = polar(OUTER_R, startAngle);
  const outerEnd = polar(OUTER_R, endAngle);
  const innerEnd = polar(INNER_R, endAngle);
  const innerStart = polar(INNER_R, startAngle);
  const largeArc = endAngle - startAngle > 180 ? 1 : 0;
  return [
    `M ${outerStart.x} ${outerStart.y}`,
    `A ${OUTER_R} ${OUTER_R} 0 ${largeArc} 1 ${outerEnd.x} ${outerEnd.y}`,
    `L ${innerEnd.x} ${innerEnd.y}`,
    `A ${INNER_R} ${INNER_R} 0 ${largeArc} 0 ${innerStart.x} ${innerStart.y}`,
    "Z",
  ].join(" ");
}

export function MoscowRegionMap({
  directions,
  activeId,
  onSelect,
}: {
  directions: Direction[];
  activeId: string | null;
  onSelect: (id: string) => void;
}) {
  const [hoverId, setHoverId] = useState<string | null>(null);
  const step = 360 / directions.length;

  const wedges = useMemo(
    () =>
      directions.map((d) => {
        const angle = COMPASS_ANGLE[d.id] ?? 0;
        const start = angle - step / 2 + GAP_DEG / 2;
        const end = angle + step / 2 - GAP_DEG / 2;
        const labelPos = polar((INNER_R + OUTER_R) / 2, angle);
        return { direction: d, path: wedgePath(start, end), labelPos };
      }),
    [directions, step],
  );

  return (
    <div className="flex flex-col items-center gap-6">
      <svg
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        className="w-full max-w-[420px]"
        role="group"
        aria-label="Карта направлений Московской области"
      >
        {wedges.map(({ direction, path, labelPos }) => {
          const isActive = direction.id === activeId;
          const isHover = direction.id === hoverId;
          const isDev = direction.status === "in_development";
          return (
            <g
              key={direction.id}
              className="cursor-pointer outline-none"
              tabIndex={0}
              role="button"
              aria-pressed={isActive}
              aria-label={`${direction.label}${isDev ? " — в разработке" : ""}`}
              onMouseEnter={() => setHoverId(direction.id)}
              onMouseLeave={() => setHoverId(null)}
              onFocus={() => setHoverId(direction.id)}
              onBlur={() => setHoverId(null)}
              onClick={() => onSelect(direction.id)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") onSelect(direction.id);
              }}
            >
              <path
                d={path}
                className={cn(
                  "transition-[fill,opacity] duration-300 ease-out",
                  isDev ? "fill-muted" : "fill-accent",
                  isActive ? "opacity-100" : isHover ? "opacity-80" : "opacity-45",
                )}
                stroke="var(--background)"
                strokeWidth={2}
              />
              <text
                x={labelPos.x}
                y={labelPos.y}
                textAnchor="middle"
                dominantBaseline="middle"
                className={cn(
                  "select-none text-[10px] font-medium uppercase tracking-wide",
                  isDev ? "fill-muted-foreground" : "fill-accent-foreground",
                )}
              >
                {direction.label.replace(" направление", "")}
              </text>
            </g>
          );
        })}
        <circle cx={CENTER} cy={CENTER} r={INNER_R - 4} className="fill-background" stroke="var(--border)" />
        <text
          x={CENTER}
          y={CENTER}
          textAnchor="middle"
          dominantBaseline="middle"
          className="fill-foreground text-xs font-semibold uppercase tracking-wider"
        >
          Москва
        </text>
      </svg>

      <p className="max-w-md text-center text-xs text-muted-foreground">
        Схематичная карта по направлениям, не географически точная. Активные направления
        выделены цветом — остальные пока «в разработке».
      </p>
    </div>
  );
}
