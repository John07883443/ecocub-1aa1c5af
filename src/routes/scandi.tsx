import { createFileRoute } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { PageLayout } from "@/components/PageLayout";
import { Container, Section } from "@/components/Container";
import { ProjectCard, type ProjectCardData } from "@/components/ProjectCard";
import { ContactForm } from "@/components/ContactForm";
import { CheckCircle2 } from "lucide-react";

export const Route = createFileRoute("/scandi")({
  head: () => ({
    meta: [
      {
        title:
          "Одноэтажные каркасные дома Scandi под ключ в Подмосковье | EcoCub",
      },
      {
        name: "description",
        content:
          "Серия Eco Wood: одноэтажные каркасные дома в скандинавском стиле под ключ в Московской области. Проекты, цены, планировки.",
      },
      {
        property: "og:title",
        content: "Каркасные дома Eco Wood — серия Scandi",
      },
      {
        property: "og:description",
        content:
          "Одноэтажные каркасные дома Scandi под ключ. Утеплённые, тёплый пол, круглогодичное проживание.",
      },
      { property: "og:image", content: "/images/section-scandi.png" },
    ],
  }),
  loader: async () => {
    const { data, error } = await supabase
      .from("projects")
      .select(
        "slug,name,series,tagline,area_m2,bedrooms,price_from,cover_image",
      )
      .eq("series", "scandi")
      .eq("published", true)
      .order("display_order", { ascending: true });
    if (error) throw error;
    return { projects: (data ?? []) as ProjectCardData[] };
  },
  errorComponent: ({ error }) => (
    <PageLayout>
      <Container className="py-32 text-center text-destructive">
        {error.message}
      </Container>
    </PageLayout>
  ),
  notFoundComponent: () => (
    <PageLayout>
      <Container className="py-32 text-center">Не найдено</Container>
    </PageLayout>
  ),
  component: ScandiPage,
});

const benefits = [
  "Лаконичная скандинавская архитектура",
  "Каркас из сухой строганой доски",
  "Теплоизоляция 200 мм + ветрозащита",
  "Отопление, тёплый пол, водоснабжение под ключ",
  "Подходит для постоянного проживания",
  "Готовность от 60 дней",
];

function ScandiPage() {
  const { projects } = Route.useLoaderData();

  return (
    <PageLayout>
      <section className="relative bg-primary text-primary-foreground">
        <img
          src="/images/section-scandi.png"
          alt=""
          className="absolute inset-0 h-full w-full object-cover opacity-40"
        />
        <div className="absolute inset-0 bg-gradient-to-r from-black/80 to-black/30" />
        <Container className="relative py-24 md:py-32">
          <p className="text-xs font-medium uppercase tracking-[0.3em] text-accent">
            Серия Eco Wood
          </p>
          <h1 className="mt-3 max-w-3xl text-4xl font-bold uppercase md:text-6xl">
            Каркасные дома Scandi
          </h1>
          <p className="mt-6 max-w-2xl text-lg text-white/85">
            Одноэтажные каркасные дома в скандинавском стиле — для тех, кто
            ценит лаконичную архитектуру и тепло настоящего дерева.
          </p>
        </Container>
      </section>

      <Section>
        <Container>
          <div className="grid gap-x-12 gap-y-8 lg:grid-cols-2">
            <div>
              <h2 className="text-2xl font-bold uppercase md:text-3xl">
                Почему Eco Wood
              </h2>
              <p className="mt-4 text-muted-foreground">
                Скандинавская технология каркасного домостроения адаптирована
                под подмосковный климат. Все материалы — сухая строганая доска,
                базальтовый утеплитель, ветрозащитная мембрана. Дом готов под
                ключ за 60 дней.
              </p>
            </div>
            <ul className="grid gap-3">
              {benefits.map((b) => (
                <li key={b} className="flex items-start gap-3 text-sm">
                  <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-accent" />
                  {b}
                </li>
              ))}
            </ul>
          </div>
        </Container>
      </Section>

      {projects.length > 0 && (
        <Section className="bg-secondary">
          <Container>
            <h2 className="mb-10 text-2xl font-bold uppercase md:text-3xl">
              Проекты Scandi
            </h2>
            <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {projects.map((p) => (
                <ProjectCard key={p.slug} project={p} />
              ))}
            </div>
          </Container>
        </Section>
      )}

      <Section className="bg-primary text-primary-foreground">
        <Container>
          <div className="mx-auto max-w-2xl">
            <h2 className="text-3xl font-bold uppercase md:text-4xl">
              Заказать каркасный дом
            </h2>
            <p className="mt-4 text-white/70">
              Подберём проект, рассчитаем смету, ответим на вопросы.
            </p>
            <div className="mt-8">
              <ContactForm variant="dark" formType="contact" />
            </div>
          </div>
        </Container>
      </Section>
    </PageLayout>
  );
}
