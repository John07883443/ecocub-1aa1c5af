import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { PageLayout } from "@/components/PageLayout";
import { Container, Section } from "@/components/Container";
import { HouseBuilder } from "@/components/constructor/HouseBuilder";
import { ContactForm } from "@/components/ContactForm";
import { site } from "@/lib/site";
import { usePageEngagement } from "@/hooks/usePageEngagement";
import { fetchPublishedHouse } from "@/lib/house-projects";
import { seedsFromModel } from "@/lib/house-project/adapters";
import { CELL_M } from "@/lib/constructor/constants";
import type { HouseProject } from "@/lib/house-project/types";

/**
 * `?house=<slug>` открывает конструктор на копии опубликованного дома —
 * это действие кнопки «Открыть в конструкторе» на странице каталога.
 *
 * Копия существует только в состоянии вкладки: конструктор ничего никуда не
 * сохраняет, поэтому изменить исходный проект отсюда невозможно в принципе.
 * Заодно это снимает вопрос о правах — публичному посетителю нечего давать.
 */
/**
 * Поле помечено необязательным намеренно: без этого TanStack Router считает
 * параметр обязательным и требует `search` у каждой ссылки на конструктор —
 * включая те, что стояли на сайте до появления каталога.
 */
type ConstructorSearch = { house?: string };

export const Route = createFileRoute("/constructor")({
  validateSearch: (search: Record<string, unknown>): ConstructorSearch =>
    typeof search.house === "string" && search.house ? { house: search.house } : {},
  loaderDeps: ({ search }) => ({ house: search.house }),
  loader: async ({ deps }) => {
    if (!deps.house) return { source: null };
    // Дом мог быть снят с публикации после того, как ссылку скопировали.
    // Это не повод показывать ошибку: конструктор открывается как обычно.
    const project = (await fetchPublishedHouse({ data: deps.house })) as HouseProject | null;
    return {
      source: project ? { title: project.title, slug: project.slug, model: project.model } : null,
    };
  },
  head: () => ({
    meta: [
      { property: "og:url", content: "https://eco-cub.ru/constructor" },
      {
        title: "Конструктор дома онлайн — соберите модульный дом EcoCub в 3D | EcoCub",
      },
      {
        name: "description",
        content:
          "Онлайн-конструктор модульных домов EcoCub: соберите дом из модулей-кубиков 3×3 м, разместите на участке в масштабе, покрутите в 3D, выберите дизайн фасада и мгновенно узнайте площадь и стоимость.",
      },
      {
        property: "og:title",
        content: "Конструктор дома EcoCub — собери свой дом в 3D",
      },
      {
        property: "og:description",
        content: "Собери дом из модулей-кубиков 3×3 м, покрути в 3D и узнай площадь и цену онлайн.",
      },
      { property: "og:image", content: "/images/hero-villa-1600.webp" },
    ],
    links: [{ rel: "canonical", href: "https://eco-cub.ru/constructor" }],
  }),
  component: ConstructorPage,
});

function ConstructorPage() {
  usePageEngagement("constructor");
  const { source } = Route.useLoaderData();
  const [summary, setSummary] = useState<string | undefined>(undefined);
  const initialSeeds = source ? seedsFromModel(source.model) : undefined;

  const handleQuote = (text: string) => {
    setSummary(text);
    requestAnimationFrame(() => {
      document.getElementById("quote")?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  };

  return (
    <PageLayout>
      <Section className="bg-background">
        <Container>
          <div className="mb-8 max-w-3xl">
            <p className="text-xs font-medium uppercase tracking-[0.3em] text-accent">
              Конструктор
            </p>
            <h1 className="mt-3 text-3xl font-bold uppercase tracking-tight md:text-5xl">
              Соберите свой дом из модулей
            </h1>
            <p className="mt-4 text-muted-foreground">
              Базовый модуль EcoCub — кубик 3 × 3 м, высота 3,15 м. Складывайте из них дома любой
              формы — одноэтажные, двухэтажные, Г- и П-образные, со ступенчатыми фасадами и
              консолями. Перетаскивайте модули по участку мышкой или пальцем — зелёные подсказки
              покажут, куда можно передвинуть, а модуль сам примагнитится вплотную к соседнему —
              сетка с шагом 0,5 м даёт точную стыковку. Покрутите дом в 3D, примерьте дизайн фасада
              — площадь и стоимость считаются автоматически.
            </p>
          </div>

          {source && (
            <p className="mb-4 rounded-sm border border-accent/40 bg-accent/5 px-4 py-3 text-sm">
              Открыта копия проекта <b>{source.title}</b> из каталога. Меняйте её как угодно —
              опубликованный проект не изменится. Конструктор работает с упрощённым кубиком {CELL_M}{" "}
              × {CELL_M} м, поэтому площадь здесь отличается от расчётной на странице дома.
            </p>
          )}

          <HouseBuilder
            basePricePerM2={site.basePricePerM2}
            onRequestQuote={handleQuote}
            initialSeeds={initialSeeds}
          />
        </Container>
      </Section>

      <Section id="quote" className="bg-primary text-primary-foreground">
        <Container>
          <div className="grid gap-12 lg:grid-cols-2">
            <div>
              <p className="text-xs font-medium uppercase tracking-[0.3em] text-accent">
                Заявка по вашей сборке
              </p>
              <h2 className="mt-3 text-3xl font-bold uppercase md:text-5xl">
                Пришлём точный расчёт
              </h2>
              <p className="mt-6 max-w-md text-base text-white/70">
                Мы возьмём вашу конфигурацию за основу, уточним планировку под участок и пришлём
                смету с фиксированной ценой. Менеджер свяжется в течение часа.
              </p>
              <div className="mt-8 space-y-2 text-sm text-white/80">
                <a href={site.phoneHref} className="block text-2xl font-semibold text-white">
                  {site.phone}
                </a>
                <a href={`mailto:${site.email}`} className="block">
                  {site.email}
                </a>
              </div>
            </div>
            <div className="rounded-sm bg-white/5 p-6 md:p-8">
              <ContactForm
                variant="dark"
                formType="project"
                sourcePage="/constructor"
                submitLabel="Получить расчёт"
                defaultMessage={summary}
              />
            </div>
          </div>
        </Container>
      </Section>
    </PageLayout>
  );
}
