import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { PageLayout } from "@/components/PageLayout";
import { Container, Section } from "@/components/Container";
import { DesignStudio } from "@/components/design/DesignStudio";

/**
 * «Проектирование» — CAD Light для точной сборки домов.
 *
 * Страница служебная: она не для посетителя сайта, и в поиске ей делать
 * нечего. Отсюда noindex и ссылка мелкой строкой в футере — тем же способом,
 * что и у страницы обучения.
 *
 * Рендер только на клиенте. Редактор целиком построен на измерении размеров
 * контейнера, ResizeObserver и работе с DOM; серверный проход не дал бы ничего,
 * кроме расхождения разметки при гидратации.
 */
export const Route = createFileRoute("/design")({
  head: () => ({
    meta: [
      { title: "Проектирование — CAD Light EcoCub" },
      { name: "robots", content: "noindex, nofollow" },
      {
        name: "description",
        content: "Внутренний редактор проектов домов EcoCub: точная сборка из заводских модулей.",
      },
    ],
  }),
  component: DesignPage,
});

function DesignPage() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  return (
    <PageLayout>
      <Section className="bg-background">
        <Container className="max-w-[1600px]">
          <div className="mb-5 max-w-3xl">
            <p className="text-xs font-medium uppercase tracking-[0.3em] text-accent">
              Проектирование
            </p>
            <h1 className="mt-2 text-2xl font-bold uppercase tracking-tight md:text-4xl">
              CAD Light EcoCub
            </h1>
            <p className="mt-3 text-sm text-muted-foreground">
              Точная сборка домов из заводских модулей 3200 × 3420 мм. Всё в миллиметрах:
              координаты, проёмы, отметки. Готовый проект сохраняется как модель и публикуется в
              раздел «Проекты домов» — картинкой дом не хранится нигде.
            </p>
          </div>

          {mounted ? (
            <DesignStudio />
          ) : (
            <div className="flex h-[60vh] items-center justify-center text-sm text-muted-foreground">
              Загрузка редактора…
            </div>
          )}
        </Container>
      </Section>
    </PageLayout>
  );
}
