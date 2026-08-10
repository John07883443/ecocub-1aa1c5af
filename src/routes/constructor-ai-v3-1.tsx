import { createFileRoute } from "@tanstack/react-router";
import { lazy, Suspense } from "react";
import { PageLayout } from "@/components/PageLayout";
import { Container, Section } from "@/components/Container";
import { usePageEngagement } from "@/hooks/usePageEngagement";

/**
 * /constructor-ai-v3-1 — итерация 3.1 экспериментального конструктора.
 *
 * Отличия от v3 (она остаётся рабочей по своему адресу): модули магнитно
 * стыкуются в единый дом, план монохромный с автоматической меблировкой,
 * объём виден одновременно с планом, а дом и участок редактируются на одном
 * экране. Страница не в меню и не в sitemap, noindex — как и вся лаборатория.
 */

const V31Constructor = lazy(() =>
  import("@/components/v31/V31Constructor").then((m) => ({ default: m.V31Constructor })),
);

export const Route = createFileRoute("/constructor-ai-v3-1")({
  head: () => ({
    meta: [
      { name: "robots", content: "noindex, nofollow" },
      { title: "AI-конструктор дома 3.1 — эксперимент | EcoCub" },
      {
        name: "description",
        content:
          "Экспериментальная версия 3.1 конструктора EcoCub: магнитная сборка модулей, меблированный план, синхронный 3D и посадка дома на участок в одном окне.",
      },
    ],
  }),
  component: ConstructorAiV31Page,
});

function ConstructorAiV31Page() {
  usePageEngagement("constructor-ai-v3-1");

  return (
    <PageLayout>
      <Section className="bg-background">
        <Container>
          <div className="mb-8 max-w-3xl">
            <p className="text-xs font-medium uppercase tracking-[0.3em] text-accent">
              Конструктор · версия 3.1 · эксперимент
            </p>
            <h1 className="mt-3 text-3xl font-bold uppercase tracking-tight md:text-5xl">
              Дом собирается из секций
            </h1>
            <p className="mt-4 text-muted-foreground">
              Модули 3 × 3 м стыкуются гранью в грань и образуют единый дом: план сразу показывает
              примерную расстановку мебели, объём обновляется рядом, а посадку на участок можно
              сделать здесь же, не уходя на другой экран.
            </p>
          </div>

          <Suspense
            fallback={
              <div className="flex min-h-64 items-center justify-center rounded-sm border border-border text-sm text-muted-foreground">
                Загружаем конструктор…
              </div>
            }
          >
            <V31Constructor />
          </Suspense>
        </Container>
      </Section>
    </PageLayout>
  );
}
