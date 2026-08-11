import { Link } from "@tanstack/react-router";
import { ArrowRight, Boxes, Layers, Maximize2, Ruler } from "lucide-react";
import type { ProjectSummary } from "@/lib/house-project/types";
import { formatArea, formatBounds, formatPrice } from "@/lib/house-projects";

/**
 * Карточка дома в каталоге.
 *
 * Все числа приходят посчитанными из модели (`ProjectSummary.metrics`) — в
 * карточке не остаётся ни одного значения, введённого руками и способного
 * разойтись с чертежом. Цена показывается, только если заполнена: «от 0 ₽»
 * хуже, чем отсутствие цены.
 */
export function HouseCard({ house }: { house: ProjectSummary }) {
  const price = formatPrice(house.priceFrom);

  return (
    <Link
      to="/houses/$slug"
      params={{ slug: house.slug }}
      className="group hover-lift flex h-full flex-col overflow-hidden rounded-sm border border-border bg-card hover:border-accent hover:shadow-[0_24px_50px_-24px_rgba(0,0,0,0.35)]"
    >
      <div className="aspect-[4/3] overflow-hidden bg-muted">
        {house.coverImage ? (
          <img
            src={house.coverImage}
            alt={house.title}
            loading="lazy"
            className="h-full w-full object-cover transition-transform duration-[900ms] ease-[cubic-bezier(0.16,1,0.3,1)] group-hover:scale-110"
          />
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            Без обложки
          </div>
        )}
      </div>

      <div className="flex flex-1 flex-col p-5 md:p-6">
        <h3 className="text-xl font-semibold">{house.title}</h3>
        {house.description && (
          <p className="mt-2 line-clamp-2 text-sm text-muted-foreground">{house.description}</p>
        )}

        <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 text-sm text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <Maximize2 className="size-4 shrink-0" />
            {formatArea(house.metrics.livingAreaM2)}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Boxes className="size-4 shrink-0" />
            {house.metrics.moduleCount} модулей
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Layers className="size-4 shrink-0" />
            {house.metrics.floors} эт.
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Ruler className="size-4 shrink-0" />
            {formatBounds(house.metrics.boundsMm.widthMm, house.metrics.boundsMm.depthMm)}
          </span>
        </div>

        {house.highlights.length > 0 && (
          <ul className="mt-4 space-y-1 text-[13px] text-muted-foreground">
            {house.highlights.slice(0, 3).map((h) => (
              <li key={h} className="flex gap-2">
                <span className="mt-[7px] size-1 shrink-0 rounded-full bg-accent" />
                {h}
              </li>
            ))}
          </ul>
        )}

        <div className="mt-auto flex items-center justify-between border-t border-border pt-4">
          <span>
            {price ? (
              <>
                <span className="text-xs text-muted-foreground">от </span>
                <span className="text-base font-semibold">{price}</span>
              </>
            ) : (
              <span className="text-xs text-muted-foreground">Цена по проекту</span>
            )}
          </span>
          <span className="inline-flex items-center gap-1 text-sm font-medium transition-colors group-hover:text-accent">
            Подробнее
            <ArrowRight className="size-4 transition-transform group-hover:translate-x-1" />
          </span>
        </div>
      </div>
    </Link>
  );
}
