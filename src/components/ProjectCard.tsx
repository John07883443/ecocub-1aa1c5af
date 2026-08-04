import { Link } from "@tanstack/react-router";
import { ArrowRight, BedDouble, Maximize2 } from "lucide-react";

export type ProjectCardData = {
  slug: string;
  name: string;
  tagline?: string | null;
  area_m2?: number | null;
  bedrooms?: number | null;
  price_from?: number | null;
  cover_image: string;
  series: string;
};

const seriesLabel: Record<string, string> = {
  concrete: "Бетонный модуль",
  villa: "Вилла Hi-Tech",
};

export function ProjectCard({ project }: { project: ProjectCardData }) {
  return (
    <Link
      to="/projects/$slug"
      params={{ slug: project.slug }}
      className="group block overflow-hidden rounded-sm border border-border bg-card transition-all hover:border-accent hover:shadow-lg"
    >
      <div className="aspect-[4/3] overflow-hidden bg-muted">
        <img
          src={project.cover_image}
          alt={project.name}
          loading="lazy"
          className="h-full w-full object-cover transition-transform duration-700 group-hover:scale-105"
        />
      </div>
      <div className="p-5 md:p-6">
        <p className="text-[11px] font-medium uppercase tracking-wider text-accent">
          {seriesLabel[project.series] ?? project.series}
        </p>
        <h3 className="mt-2 text-xl font-semibold">{project.name}</h3>
        {project.tagline && (
          <p className="mt-2 line-clamp-2 text-sm text-muted-foreground">{project.tagline}</p>
        )}
        <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-muted-foreground">
          {project.area_m2 != null && (
            <span className="inline-flex items-center gap-1.5">
              <Maximize2 className="size-4" />
              {project.area_m2} м²
            </span>
          )}
          {project.bedrooms != null && (
            <span className="inline-flex items-center gap-1.5">
              <BedDouble className="size-4" />
              {project.bedrooms} спальни
            </span>
          )}
        </div>
        <div className="mt-5 flex items-center justify-between border-t border-border pt-4">
          <div>
            {project.price_from != null && (
              <>
                <span className="text-xs text-muted-foreground">от </span>
                <span className="text-base font-semibold">
                  {new Intl.NumberFormat("ru-RU").format(project.price_from)} ₽
                </span>
              </>
            )}
          </div>
          <span className="inline-flex items-center gap-1 text-sm font-medium text-foreground transition-colors group-hover:text-accent">
            Подробнее
            <ArrowRight className="size-4 transition-transform group-hover:translate-x-1" />
          </span>
        </div>
      </div>
    </Link>
  );
}
