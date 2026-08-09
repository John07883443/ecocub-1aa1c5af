import { BedDouble, CookingPot, Bath, Layers, Maximize2 } from "lucide-react";
import type { HouseStats } from "@/lib/constructor/types";

const fmt = (n: number) => new Intl.NumberFormat("ru-RU").format(Math.round(n));

export function StatsPanel({ stats }: { stats: HouseStats }) {
  const priceMln = (stats.price / 1_000_000).toFixed(1);
  return (
    <div className="rounded-sm border border-border bg-card p-5">
      <div className="flex items-end justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Жилая площадь</p>
          <p className="text-3xl font-bold text-foreground">
            {fmt(stats.heatedArea)} <span className="text-base font-normal">м²</span>
          </p>
        </div>
        <div className="text-right">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Модулей</p>
          <p className="text-3xl font-bold text-foreground">{stats.moduleCount}</p>
        </div>
      </div>

      <div className="mt-4 rounded-sm border-l-2 border-accent bg-secondary p-4">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">
          Ориентировочная стоимость
        </p>
        <p className="mt-1 text-3xl font-bold text-accent">{fmt(stats.price)} ₽</p>
        <p className="mt-1 text-sm text-muted-foreground">
          ≈ {priceMln} млн ₽ под предчистовую отделку
        </p>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
        <Metric
          icon={<BedDouble className="size-4 text-accent" />}
          label="Спальни"
          value={stats.bedrooms}
        />
        <Metric
          icon={<CookingPot className="size-4 text-accent" />}
          label="Кухни"
          value={stats.kitchens}
        />
        <Metric
          icon={<Bath className="size-4 text-accent" />}
          label="Санузлы"
          value={stats.bathrooms}
        />
        <Metric
          icon={<Layers className="size-4 text-accent" />}
          label="Этажей"
          value={stats.floors}
        />
      </div>

      {stats.terraceArea > 0 && (
        <p className="mt-3 text-xs text-muted-foreground">
          + терраса {fmt(stats.terraceArea)} м² (по льготной ставке)
        </p>
      )}

      <div className="mt-4">
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <Maximize2 className="size-3.5" /> Пятно застройки
          </span>
          <span>
            {fmt(stats.footprintArea)} / {fmt(stats.plotArea)} м²
          </span>
        </div>
        <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-accent transition-all"
            style={{ width: `${Math.min(100, stats.plotUsedPct)}%` }}
          />
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          {stats.plotUsedPct.toFixed(1)}% участка занято домом
        </p>
      </div>
    </div>
  );
}

function Metric({ icon, label, value }: { icon: React.ReactNode; label: string; value: number }) {
  return (
    <div className="flex items-center gap-2 rounded-sm border border-border bg-background px-3 py-2">
      {icon}
      <div>
        <p className="text-lg font-bold leading-none text-foreground">{value}</p>
        <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
      </div>
    </div>
  );
}
