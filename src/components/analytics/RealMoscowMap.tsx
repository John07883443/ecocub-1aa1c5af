import { cn } from "@/lib/utils";
import { moscowMapData, highwaysForDirection } from "@/lib/barometer/moscow-map";

/**
 * Настоящая карта Московской области (не стилизованная выдумка) — граница
 * региона, МКАД, ЦКАД и федеральные трассы взяты из реальных данных
 * OpenStreetMap (см. lib/barometer/moscow-map.ts). Мелкая дорожная сеть
 * сознательно не включена — по требованию владельца читаемость МКАД, ЦКАД
 * и крупных шоссе важнее детализации.
 */

const TRACKED_TOWNS: Record<string, { villageLabel: string; directionId: string }> = {
  Ступино: { villageLabel: "River Park", directionId: "south" },
};

export function RealMoscowMap({
  activeId,
  onSelectDirection,
}: {
  activeId: string;
  onSelectDirection: (id: string) => void;
}) {
  const activeHighways = new Set(highwaysForDirection(activeId));
  const { viewBox, boundaryPath, mkadPath, ringHighways, radialHighways, towns } = moscowMapData;

  return (
    <div className="flex flex-col items-center gap-4">
      <svg viewBox={viewBox} className="w-full max-w-[560px]" role="img" aria-label="Карта Московской области">
        <path d={boundaryPath} className="fill-muted" stroke="var(--border)" strokeWidth={12} fillRule="evenodd" />

        {Object.entries(ringHighways).map(([key, hw]) => (
          <path
            key={key}
            d={hw.path}
            fill="none"
            stroke={key === "a113" ? "var(--accent)" : "var(--muted-foreground)"}
            strokeWidth={key === "a113" ? 34 : 14}
            strokeOpacity={key === "a113" ? 0.85 : 0.35}
            strokeLinejoin="round"
          />
        ))}

        {Object.entries(radialHighways).map(([key, hw]) => {
          const isActive = activeHighways.has(key);
          return (
            <path
              key={key}
              d={hw.path}
              fill="none"
              stroke={isActive ? "var(--accent)" : "var(--foreground)"}
              strokeWidth={isActive ? 30 : 14}
              strokeOpacity={isActive ? 0.95 : 0.22}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          );
        })}

        <path
          d={mkadPath}
          fill="none"
          stroke="var(--foreground)"
          strokeWidth={46}
          strokeOpacity={0.9}
          strokeLinejoin="round"
        />

        {Object.entries(towns).map(([name, pt]) => {
          const tracked = TRACKED_TOWNS[name];
          const isActive = tracked && tracked.directionId === activeId;
          return (
            <g
              key={name}
              className={cn(tracked && "cursor-pointer")}
              tabIndex={tracked ? 0 : -1}
              role={tracked ? "button" : undefined}
              onClick={() => tracked && onSelectDirection(tracked.directionId)}
              onKeyDown={(e) => {
                if (tracked && (e.key === "Enter" || e.key === " ")) onSelectDirection(tracked.directionId);
              }}
            >
              <circle
                cx={pt.x}
                cy={pt.y}
                r={tracked ? 95 : 55}
                className={tracked ? (isActive ? "fill-accent" : "fill-accent/70") : "fill-foreground/50"}
                stroke="var(--background)"
                strokeWidth={tracked ? 14 : 8}
              />
              <text
                x={pt.x}
                y={pt.y - (tracked ? 130 : 85)}
                textAnchor="middle"
                className={cn(
                  "select-none text-[130px]",
                  tracked ? "fill-foreground font-semibold" : "fill-muted-foreground",
                )}
              >
                {name}
              </text>
              {tracked && (
                <text
                  x={pt.x}
                  y={pt.y + 220}
                  textAnchor="middle"
                  className="fill-accent text-[105px] font-medium uppercase tracking-wider"
                >
                  {tracked.villageLabel}
                </text>
              )}
            </g>
          );
        })}
      </svg>

      <p className="max-w-md text-center text-xs text-muted-foreground">
        Реальная граница области, МКАД, ЦКАД и федеральные трассы (данные
        OpenStreetMap). Мелкая дорожная сеть не показана.
      </p>
    </div>
  );
}
