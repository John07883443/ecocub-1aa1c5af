import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { PageLayout } from "@/components/PageLayout";
import { Container, Section } from "@/components/Container";
import { Reveal } from "@/components/motion/Reveal";
import { HouseCard } from "@/components/houses/HouseCard";
import { fetchPublishedHouses } from "@/lib/house-projects";
import { usePageEngagement } from "@/hooks/usePageEngagement";
import type { ProjectSummary } from "@/lib/house-project/types";
import { cn } from "@/lib/utils";

/**
 * Каталог домов EcoCub — публичный список опубликованных моделей.
 *
 * Фильтры считаются по фактическим данным, а не по заранее вбитому диапазону:
 * если завтра появится дом на 22 модуля, ползунок дотянется до него сам, а
 * пустых пунктов «5 этажей» в списке не возникнет. Фильтрация идёт в памяти —
 * карточек десятки, ходить за каждым срезом на сервер незачем.
 */
export const Route = createFileRoute("/houses/")({
  head: () => ({
    meta: [
      { property: "og:url", content: "https://eco-cub.ru/houses" },
      { title: "Каталог домов EcoCub — проекты модульных бетонных домов" },
      {
        name: "description",
        content:
          "Проекты домов EcoCub, собранные из заводских бетонных модулей 3,2 × 3,42 м. Площадь, число модулей, этажность и габариты считаются из самой модели дома.",
      },
      { property: "og:title", content: "Каталог домов EcoCub" },
      {
        property: "og:description",
        content: "Опубликованные проекты модульных домов: площадь, модули, этажность, габариты.",
      },
    ],
    links: [{ rel: "canonical", href: "https://eco-cub.ru/houses" }],
  }),
  loader: async () => ({ houses: await fetchPublishedHouses() }),
  errorComponent: ({ error }: { error: Error }) => (
    <PageLayout>
      <Container className="py-32 text-center text-destructive">Ошибка: {error.message}</Container>
    </PageLayout>
  ),
  component: HousesPage,
});

function HousesPage() {
  usePageEngagement("houses");
  const { houses } = Route.useLoaderData() as { houses: ProjectSummary[] };

  const [floors, setFloors] = useState<number | null>(null);
  const [tag, setTag] = useState<string | null>(null);
  const [maxModules, setMaxModules] = useState<number | null>(null);

  const facets = useMemo(() => {
    const moduleCounts = houses.map((h) => h.metrics.moduleCount);
    const floorSet = [...new Set(houses.map((h) => h.metrics.floors))].sort((a, b) => a - b);
    const tags = [...new Set(houses.flatMap((h) => h.tags))].sort();
    return {
      floors: floorSet,
      tags,
      minModules: moduleCounts.length ? Math.min(...moduleCounts) : 0,
      maxModules: moduleCounts.length ? Math.max(...moduleCounts) : 0,
    };
  }, [houses]);

  const filtered = useMemo(
    () =>
      houses.filter((h) => {
        if (floors != null && h.metrics.floors !== floors) return false;
        if (tag && !h.tags.includes(tag)) return false;
        if (maxModules != null && h.metrics.moduleCount > maxModules) return false;
        return true;
      }),
    [houses, floors, tag, maxModules],
  );

  const chip = (active: boolean) =>
    cn(
      "rounded-sm border px-3 py-1.5 text-xs transition-colors",
      active ? "border-accent bg-accent/10 text-accent" : "border-border hover:border-accent",
    );

  return (
    <PageLayout>
      <Section className="border-b border-border">
        <Container>
          <Reveal>
            <p className="text-xs font-medium uppercase tracking-[0.3em] text-accent">Каталог</p>
            <h1 className="mt-3 text-4xl font-bold uppercase md:text-6xl">Каталог домов EcoCub</h1>
            <p className="mt-6 max-w-2xl text-base text-muted-foreground">
              Дома, собранные из заводских модулей 3,2 × 3,42 м с высотой помещений 3,15 м. Площадь,
              габариты и число модулей в карточках не вписаны руками — они считаются из самой модели
              дома, той же, что открывается в конструкторе.
            </p>
          </Reveal>
        </Container>
      </Section>

      {houses.length > 0 && (
        <Section className="pb-0 pt-8 md:pb-0 md:pt-10">
          <Container>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs uppercase tracking-wide text-muted-foreground">Этажей:</span>
              <button
                type="button"
                className={chip(floors === null)}
                onClick={() => setFloors(null)}
              >
                любая
              </button>
              {facets.floors.map((f) => (
                <button
                  key={f}
                  type="button"
                  className={chip(floors === f)}
                  onClick={() => setFloors(f)}
                >
                  {f}
                </button>
              ))}

              {facets.maxModules > facets.minModules && (
                <>
                  <span className="ml-4 text-xs uppercase tracking-wide text-muted-foreground">
                    Модулей до:
                  </span>
                  <input
                    type="range"
                    min={facets.minModules}
                    max={facets.maxModules}
                    value={maxModules ?? facets.maxModules}
                    onChange={(e) => setMaxModules(Number(e.target.value))}
                    className="w-40"
                  />
                  <span className="text-xs text-muted-foreground">
                    {maxModules ?? facets.maxModules}
                  </span>
                </>
              )}
            </div>

            {facets.tags.length > 0 && (
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <span className="text-xs uppercase tracking-wide text-muted-foreground">Теги:</span>
                <button type="button" className={chip(tag === null)} onClick={() => setTag(null)}>
                  все
                </button>
                {facets.tags.map((t) => (
                  <button
                    key={t}
                    type="button"
                    className={chip(tag === t)}
                    onClick={() => setTag(t)}
                  >
                    {t}
                  </button>
                ))}
              </div>
            )}
          </Container>
        </Section>
      )}

      <Section className="pt-6 md:pt-8">
        <Container>
          {houses.length === 0 ? (
            <div className="rounded-sm border border-dashed border-border py-20 text-center">
              <p className="text-lg font-medium">В каталоге пока нет опубликованных домов</p>
              <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
                Проекты собираются в разделе «Проектирование» и появляются здесь после публикации.
              </p>
            </div>
          ) : filtered.length === 0 ? (
            <div className="rounded-sm border border-dashed border-border py-20 text-center">
              <p className="text-lg font-medium">Под фильтры ничего не подошло</p>
              <button
                type="button"
                className="mt-3 text-sm text-accent underline"
                onClick={() => {
                  setFloors(null);
                  setTag(null);
                  setMaxModules(null);
                }}
              >
                Сбросить фильтры
              </button>
            </div>
          ) : (
            <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {filtered.map((house, i) => (
                <Reveal key={house.id} variant="up" delay={(i % 3) * 90} className="h-full">
                  <HouseCard house={house} />
                </Reveal>
              ))}
            </div>
          )}
        </Container>
      </Section>
    </PageLayout>
  );
}
