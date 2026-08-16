import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { PageLayout } from "@/components/PageLayout";
import { Container, Section } from "@/components/Container";
import { Reveal } from "@/components/motion/Reveal";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { usePageEngagement } from "@/hooks/usePageEngagement";
import { SouthDirectionMap } from "@/components/analytics/SouthDirectionMap";
import { cn } from "@/lib/utils";
import {
  directions,
  villagesForDirection,
  formatRub,
  type Village,
} from "@/lib/barometer/price-barometer";

export const Route = createFileRoute("/analytics")({
  head: () => ({
    meta: [
      { property: "og:url", content: "https://eco-cub.ru/analytics" },
      { title: "Барометр цен Подмосковье — аналитика EcoCub" },
      {
        name: "description",
        content:
          "Барометр цен на землю в коттеджных посёлках Подмосковья: медианные цены за сотку, свободные и проданные участки по направлениям.",
      },
      { property: "og:title", content: "Барометр цен Подмосковье — EcoCub" },
      {
        property: "og:description",
        content: "Живая аналитика цен на землю в Подмосковье по направлениям и посёлкам.",
      },
    ],
    links: [{ rel: "canonical", href: "https://eco-cub.ru/analytics" }],
  }),
  component: AnalyticsPage,
});

function StatRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-border/60 py-2 text-sm last:border-0">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium tabular-nums">{value}</span>
    </div>
  );
}

function VillageCard({ village }: { village: Village }) {
  const s = village.stats;
  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-lg">{village.name}</CardTitle>
          <Badge variant="secondary" className="font-normal">
            {village.district}
          </Badge>
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid gap-x-8 gap-y-1 sm:grid-cols-2">
          <div>
            <StatRow label="Всего участков" value={String(s.totalPlots)} />
            <StatRow label="Свободно" value={String(s.available)} />
            <StatRow label="Продано" value={String(s.sold)} />
            <StatRow label="Забронировано" value={String(s.reserved)} />
            <StatRow label="Придержано" value={String(s.withdrawn)} />
          </div>
          <div>
            <StatRow label="Медиана, ₽/сотка" value={formatRub(s.medianPricePerSotka)} />
            <StatRow label="Средняя, ₽/сотка" value={formatRub(s.meanPricePerSotka)} />
            <StatRow
              label="Разброс"
              value={`${formatRub(s.minPricePerSotka)} – ${formatRub(s.maxPricePerSotka)}`}
            />
            <StatRow label="За 10 соток (медиана)" value={formatRub(s.medianPricePer10Sotok)} />
          </div>
        </div>

        {s.withdrawnNote && (
          <p className="mt-4 text-xs text-muted-foreground">{s.withdrawnNote}</p>
        )}

        {village.promotions.length > 0 && (
          <div className="mt-6 border-t border-border pt-4">
            <p className="mb-2 text-xs font-medium uppercase tracking-wider text-accent">
              Текущие акции
            </p>
            <ul className="flex flex-wrap gap-2">
              {village.promotions.map((p) => (
                <li key={p.plotId}>
                  <Badge variant="outline" className="font-normal">
                    {p.plotId}
                    {p.pricePerSotka ? ` · ${formatRub(p.pricePerSotka)}/сотка` : ""}
                  </Badge>
                </li>
              ))}
            </ul>
          </div>
        )}

        <p className="mt-6 text-xs text-muted-foreground">
          Обновлено: {new Date(village.lastUpdated).toLocaleString("ru-RU")} · источник —
          виджет застройщика
          {village.developer ? `, ${village.developer}` : " (застройщик уточняется)"}
        </p>
      </CardContent>
    </Card>
  );
}

function AnalyticsPage() {
  usePageEngagement("analytics");
  const [activeId, setActiveId] = useState<string>("south");

  const activeDirection = useMemo(
    () => directions.find((d) => d.id === activeId) ?? directions[0],
    [activeId],
  );
  const villages = useMemo(() => villagesForDirection(activeId), [activeId]);

  return (
    <PageLayout>
      <Section className="border-b border-border">
        <Container>
          <Reveal>
            <p className="text-xs font-medium uppercase tracking-[0.3em] text-accent">Аналитика</p>
            <h1 className="mt-3 text-4xl font-bold uppercase md:text-6xl">
              Барометр цен Подмосковье
            </h1>
            <p className="mt-6 max-w-2xl text-base text-muted-foreground">
              Живая статистика по земельным участкам в коттеджных посёлках Подмосковья:
              сколько продано, забронировано и свободно, по какой цене — в разбивке по
              направлениям. Раздел растёт постепенно: пока полностью работает Южное
              направление, остальные подключаем по мере сбора данных.
            </p>
          </Reveal>
        </Container>
      </Section>

      <Section>
        <Container>
          <Reveal>
            <div className="mb-8 flex flex-wrap gap-2">
              {directions.map((d) => (
                <button
                  key={d.id}
                  type="button"
                  onClick={() => setActiveId(d.id)}
                  className={cn(
                    "rounded-full border px-3.5 py-1.5 text-xs font-medium uppercase tracking-wide transition-colors",
                    d.id === activeId
                      ? "border-accent bg-accent text-accent-foreground"
                      : "border-border text-muted-foreground hover:border-accent/50 hover:text-foreground",
                  )}
                >
                  {d.label.replace(" направление", "")}
                </button>
              ))}
            </div>
          </Reveal>

          <div className="grid gap-10 lg:grid-cols-[420px_1fr] lg:items-start">
            <Reveal variant="up">
              {activeId === "south" ? (
                <SouthDirectionMap selectedId="stupino" onSelect={() => {}} />
              ) : (
                <div className="flex aspect-square max-w-[360px] flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-border text-center text-sm text-muted-foreground">
                  <span className="text-3xl">🚧</span>
                  Схема направления в разработке
                </div>
              )}
            </Reveal>

            <Reveal variant="up" delay={90}>
              <div className="flex flex-col gap-6">
                <div>
                  <h2 className="text-2xl font-semibold">{activeDirection.label}</h2>
                  {activeDirection.highways.length > 0 && (
                    <p className="mt-1 text-sm text-muted-foreground">
                      Ориентиры: {activeDirection.highways.join(", ")}
                    </p>
                  )}
                </div>

                {activeDirection.status === "in_development" ? (
                  <Card className="border-dashed">
                    <CardContent className="py-10 text-center text-sm text-muted-foreground">
                      Направление в разработке — данные по посёлкам ещё не подключены.
                      Возвращайтесь позже.
                    </CardContent>
                  </Card>
                ) : villages.length === 0 ? (
                  <Card className="border-dashed">
                    <CardContent className="py-10 text-center text-sm text-muted-foreground">
                      Посёлки в этом направлении пока не отслеживаются.
                    </CardContent>
                  </Card>
                ) : (
                  <div className="flex flex-col gap-6">
                    {villages.map((v) => (
                      <VillageCard key={v.name} village={v} />
                    ))}
                  </div>
                )}
              </div>
            </Reveal>
          </div>
        </Container>
      </Section>
    </PageLayout>
  );
}
