import { cn } from "@/lib/utils";

/**
 * Схематичная карта Южного направления в стиле "МКАД сверху, трассы вниз,
 * посёлки точками на трассах" — по референсу владельца (скриншот баннера с
 * похожей картой ЦКАД/М-2/М-4). Не географически точная схема, только
 * относительное взаиморасположение и подписи реальных трасс/нас. пунктов.
 *
 * Ступино выделено особо — это единственный сейчас отслеживаемый узел
 * (River Park, Ступинский район), остальные точки — просто ориентиры
 * для контекста "где мы на карте", без данных.
 */

type Settlement = {
  id: string;
  label: string;
  x: number;
  y: number;
  tracked?: boolean;
};

const SETTLEMENTS: Settlement[] = [
  { id: "vidnoe", label: "Видное", x: 205, y: 96 },
  { id: "podolsk", label: "Подольск", x: 108, y: 132 },
  { id: "domodedovo", label: "Домодедово", x: 214, y: 150 },
  { id: "chekhov", label: "Чехов", x: 96, y: 268 },
  { id: "mihnevo", label: "Михнево", x: 224, y: 268 },
  { id: "serpukhov", label: "Серпухов", x: 86, y: 384 },
  { id: "stupino", label: "Ступино", x: 226, y: 384, tracked: true },
];

function blob(cx: number, cy: number, seed: number) {
  const r1 = 13 + (seed % 3);
  const r2 = 10 + ((seed * 3) % 4);
  return `M ${cx - r1} ${cy} Q ${cx - r1} ${cy - r2} ${cx} ${cy - r2} Q ${cx + r1} ${cy - r2} ${cx + r1} ${cy} Q ${cx + r1} ${cy + r2} ${cx} ${cy + r2} Q ${cx - r1} ${cy + r2} ${cx - r1} ${cy} Z`;
}

export function SouthDirectionMap({
  selectedId,
  onSelect,
}: {
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="flex flex-col items-center gap-4">
      <svg viewBox="0 0 320 440" className="w-full max-w-[360px]" role="img" aria-label="Схема Южного направления">
        {/* МКАД */}
        <path
          d="M 60 34 Q 160 -6 260 34"
          fill="none"
          stroke="var(--foreground)"
          strokeWidth={2.5}
          strokeLinecap="round"
        />
        <text x={160} y={20} textAnchor="middle" className="fill-foreground text-[11px] font-semibold uppercase tracking-wider">
          МКАД
        </text>

        {/* ЦКАД — пересекает обе трассы */}
        <path d="M 70 190 Q 160 178 250 190" fill="none" stroke="var(--border)" strokeWidth={2} strokeDasharray="3 4" />
        <text x={160} y={172} textAnchor="middle" className="fill-muted-foreground text-[9px] uppercase tracking-wider">
          ЦКАД
        </text>

        {/* М-2 «Крым», левая ветка */}
        <path
          d="M 150 34 C 120 90, 90 140, 96 268 C 100 320, 90 360, 86 384"
          fill="none"
          stroke="var(--accent)"
          strokeWidth={2.5}
          strokeLinecap="round"
          opacity={0.55}
        />
        <text x={72} y={112} className="fill-accent text-[10px] font-medium">
          М-2
        </text>

        {/* М-4 «Дон», правая ветка */}
        <path
          d="M 190 34 C 210 90, 214 130, 214 150 C 214 200, 224 230, 224 268 C 224 320, 226 356, 226 384"
          fill="none"
          stroke="var(--accent)"
          strokeWidth={2.5}
          strokeLinecap="round"
          opacity={0.55}
        />
        <text x={232} y={112} className="fill-accent text-[10px] font-medium">
          М-4
        </text>

        {/* А-108, спутник у Михнево/Ступино — трасса River Park по данным барометра */}
        <path
          d="M 224 268 C 230 300, 234 340, 226 384"
          fill="none"
          stroke="var(--muted-foreground)"
          strokeWidth={1.5}
          strokeDasharray="2 3"
          opacity={0.6}
        />
        <text x={236} y={330} className="fill-muted-foreground text-[9px]">
          А-108
        </text>

        {SETTLEMENTS.map((s, i) => {
          const isSelected = s.id === selectedId;
          return (
            <g
              key={s.id}
              className={cn(s.tracked && "cursor-pointer")}
              tabIndex={s.tracked ? 0 : -1}
              role={s.tracked ? "button" : undefined}
              aria-pressed={s.tracked ? isSelected : undefined}
              onClick={() => s.tracked && onSelect(s.id)}
              onKeyDown={(e) => {
                if (s.tracked && (e.key === "Enter" || e.key === " ")) onSelect(s.id);
              }}
            >
              <path d={blob(s.x, s.y, i)} className="fill-muted" opacity={0.7} />
              <circle
                cx={s.x}
                cy={s.y}
                r={s.tracked ? 6 : 4}
                className={cn(s.tracked ? (isSelected ? "fill-accent" : "fill-accent/70") : "fill-foreground/60")}
                stroke="var(--background)"
                strokeWidth={1.5}
              />
              <text
                x={s.x}
                y={s.y - 12}
                textAnchor="middle"
                className={cn(
                  "select-none text-[10px]",
                  s.tracked ? "fill-foreground font-semibold" : "fill-muted-foreground",
                )}
              >
                {s.label}
              </text>
              {s.tracked && (
                <text x={s.x} y={s.y + 20} textAnchor="middle" className="fill-accent text-[8px] uppercase tracking-wider">
                  River Park
                </text>
              )}
            </g>
          );
        })}
      </svg>

      <p className="max-w-md text-center text-xs text-muted-foreground">
        Схематичная карта, не географически точная. Отслеживаемый посёлок — Ступино
        (River Park), остальные точки — для ориентира.
      </p>
    </div>
  );
}
