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

/**
 * Кольцевые зоны по удалённости от Москвы — по референсу владельца
 * (жёлтый центр/оранжевое/зелёное/синее кольцо), но в монохромной палитре
 * сайта вместо буквальных цветов. Радиусы — реальные километры, переведённые
 * в проекционные единицы (масштаб см. lib/barometer/moscow-map.ts):
 * ~25 км и ~55 км (примерно по ЦКАД) от центра Москвы.
 */
const ZONE_NEAR_R = 2500;
const ZONE_MID_R = 5533;

export function RealMoscowMap({
  activeId,
  onSelectDirection,
}: {
  activeId: string;
  onSelectDirection: (id: string) => void;
}) {
  const activeHighways = new Set(highwaysForDirection(activeId));
  const { viewBox, boundaryPath, mkadPath, ringHighways, radialHighways, cities } = moscowMapData;
  const activeHighwayKey = Object.keys(radialHighways).find((k) => activeHighways.has(k));

  return (
    <div className="flex flex-col items-center gap-4">
      <svg viewBox={viewBox} className="w-full max-w-[560px]" role="img" aria-label="Карта Московской области">
        <defs>
          <clipPath id="oblast-clip">
            <path d={boundaryPath} fillRule="evenodd" />
          </clipPath>
        </defs>

        {/* дальняя зона — база */}
        <path d={boundaryPath} className="fill-muted" fillRule="evenodd" />
        {/* средняя и ближняя зоны — кольца по реальному расстоянию от Москвы, обрезаны по границе области */}
        <g clipPath="url(#oblast-clip)">
          <circle cx={0} cy={0} r={ZONE_MID_R} className="fill-accent/20" />
          <circle cx={0} cy={0} r={ZONE_NEAR_R} className="fill-accent/40" />
        </g>
        <path d={boundaryPath} fill="none" stroke="var(--border)" strokeWidth={12} fillRule="evenodd" />

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
              id={`hw-${key}`}
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
        <text x={0} y={-1950} textAnchor="middle" className="fill-foreground text-[95px] font-semibold uppercase">
          МКАД
        </text>
        <text x={0} y={-5750} textAnchor="middle" className="fill-accent text-[90px] font-semibold uppercase">
          ЦКАД
        </text>

        {activeHighwayKey && (
          <text className="fill-accent text-[95px] font-medium uppercase" dy={-24}>
            <textPath href={`#hw-${activeHighwayKey}`} startOffset="38%">
              {radialHighways[activeHighwayKey].label}
            </textPath>
          </text>
        )}

        {Object.entries(cities).map(([name, pt]) => {
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
                r={tracked ? 95 : 45}
                className={tracked ? (isActive ? "fill-accent" : "fill-accent/70") : "fill-foreground/55"}
                stroke="var(--background)"
                strokeWidth={tracked ? 14 : 7}
              />
              <text
                x={pt.x}
                y={pt.y - (tracked ? 130 : 75)}
                textAnchor="middle"
                className={cn(
                  "select-none text-[110px]",
                  tracked ? "fill-foreground text-[130px] font-semibold" : "fill-muted-foreground",
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
        Реальная граница области, МКАД, ЦКАД, федеральные трассы и крупнейшие
        города по населению (данные OpenStreetMap). Зоны — по расстоянию от
        Москвы. Мелкая дорожная сеть не показана.
      </p>
    </div>
  );
}
