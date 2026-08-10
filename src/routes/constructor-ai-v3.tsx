import { createFileRoute } from "@tanstack/react-router";
import { lazy, Suspense, useEffect } from "react";
import { PageLayout } from "@/components/PageLayout";
import { Container, Section } from "@/components/Container";
import { usePageEngagement } from "@/hooks/usePageEngagement";
import { validatePlanLibrary } from "@/lib/v3/plans";

/**
 * /constructor-ai-v3 — экспериментальная версия персонального конструктора.
 *
 * Правила эксперимента (мастер-промпт V3):
 * - существующие квиз, «Дом мечты» и /constructor не тронуты;
 * - страница не появляется в основном меню и в sitemap;
 * - noindex, nofollow — эксперимент не должен конкурировать с боевыми
 *   страницами в поиске;
 * - все версии перечислены на скрытой витрине /constructor-lab.
 */

const V3Constructor = lazy(() =>
  import("@/components/v3/V3Constructor").then((m) => ({ default: m.V3Constructor })),
);

export const Route = createFileRoute("/constructor-ai-v3")({
  head: () => ({
    meta: [
      { name: "robots", content: "noindex, nofollow" },
      { title: "AI-конструктор дома V3 — эксперимент | EcoCub" },
      {
        name: "description",
        content:
          "Экспериментальная версия персонального конструктора EcoCub: подбор дома под семью из реальных модульных планов, редактирование, посадка на участок и AI-рендер фасада.",
      },
    ],
  }),
  component: ConstructorAiV3Page,
});

function ConstructorAiV3Page() {
  usePageEngagement("constructor-ai-v3");

  // Самопроверка данных в dev: битая запись библиотеки видна сразу в консоли.
  useEffect(() => {
    if (import.meta.env.DEV) {
      const errors = validatePlanLibrary();
      if (errors.length) console.warn("Библиотека планов v3:", errors);
    }
  }, []);

  return (
    <PageLayout>
      <Section className="bg-background">
        <Container>
          <div className="mb-8 max-w-3xl">
            <p className="text-xs font-medium uppercase tracking-[0.3em] text-accent">
              Конструктор · версия 3 · эксперимент
            </p>
            <h1 className="mt-3 text-3xl font-bold uppercase tracking-tight md:text-5xl">
              Персональный подбор дома
            </h1>
            <p className="mt-4 text-muted-foreground">
              Ответьте на несколько вопросов о семье и образе жизни — EcoCub предложит подходящие
              дома из проверенных модульных решений, а вы доведёте выбранный вариант до своего:
              комнаты, участок, фасад.
            </p>
          </div>

          <Suspense
            fallback={
              <div className="flex min-h-64 items-center justify-center rounded-sm border border-border text-sm text-muted-foreground">
                Загружаем конструктор…
              </div>
            }
          >
            <V3Constructor />
          </Suspense>
        </Container>
      </Section>
    </PageLayout>
  );
}
