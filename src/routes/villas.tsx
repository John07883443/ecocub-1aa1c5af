import { createFileRoute } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { PageLayout } from "@/components/PageLayout";
import { Container, Section } from "@/components/Container";
import { ProjectCard, type ProjectCardData } from "@/components/ProjectCard";
import { ContactForm } from "@/components/ContactForm";
import { CheckCircle2 } from "lucide-react";

export const Route = createFileRoute("/villas")({
  head: () => ({
    meta: [
      {
        title:
          "Виллы Hi-Tech в Москве и Подмосковье — модульные виллы под ключ за 90 дней | EcoCub",
      },
      {
        name: "description",
        content:
          "Премиальные модульные виллы EcoCub в стиле Hi-Tech. От 4.5 млн ₽, готовность за 90 дней. Проекты с панорамным остеклением и террасами.",
      },
      {
        property: "og:title",
        content: "Виллы Hi-Tech от EcoCub — современные дома под ключ",
      },
      {
        property: "og:description",
        content:
          "Модульные виллы с панорамным остеклением, плоской кровлей и террасами. Архитектура Hi-Tech.",
      },
      { property: "og:image", content: "/images/section-villa.png" },
    ],
  }),
  loader: async () => {
    const { data, error } = await supabase
      .from("projects")
      .select(
        "slug,name,series,tagline,area_m2,bedrooms,price_from,cover_image",
      )
      .eq("series", "villa")
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
  component: VillasPage,
});

const features = [
  "Архитектура Hi-Tech с панорамным остеклением",
  "Плоская эксплуатируемая кровля",
  "Просторные террасы и веранды",
  "Премиальная отделка под ключ",
  "Системы умного дома (опция)",
  "Готовность 90–120 дней",
];

function VillasPage() {
  const { projects } = Route.useLoaderData();

  return (
    <PageLayout headerVariant="dark">
      <section className="relative min-h-[70svh] bg-primary text-primary-foreground">
        <img
          src="/images/section-villa.png"
          alt=""
          className="absolute inset-0 h-full w-full object-cover opacity-55"
        />
        <div className="absolute inset-0 bg-gradient-to-b from-black/60 via-black/30 to-black/70" />
        <Container className="relative flex min-h-[70svh] flex-col justify-end pb-16 pt-32">
          <p className="text-xs font-medium uppercase tracking-[0.3em] text-accent">
            Hi-Tech · Премиум
          </p>
          <h1 className="mt-3 max-w-4xl text-4xl font-bold uppercase leading-[1.05] tracking-tight md:text-6xl">
            Виллы, спроектированные<br />как техника
          </h1>
          <p className="mt-6 max-w-2xl text-lg text-white/85">
            Hi-tech модули из бетона. Панорамное остекление, эксплуатируемая кровля,
            террасы. Сборка на участке за 5 дней. Гарантия 50 лет.
          </p>
        </Container>
      </section>

      <Section>
        <Container>
          <div className="grid gap-x-12 gap-y-8 lg:grid-cols-2">
            <div>
              <h2 className="text-2xl font-bold uppercase md:text-3xl">
                О виллах EcoCub
              </h2>
              <p className="mt-4 text-muted-foreground">
                Виллы EcoCub — это современный дом полного цикла: от бетонных
                модулей до премиальной отделки и инженерии. Архитектура
                Hi-Tech, панорамное остекление, плоская кровля и просторные
                террасы. Подходят для участков с видом на воду или лес.
              </p>
            </div>
            <ul className="grid gap-3">
              {features.map((b) => (
                <li key={b} className="flex items-start gap-3 text-sm">
                  <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-accent" />
                  {b}
                </li>
              ))}
            </ul>
          </div>
        </Container>
      </Section>

      <Section className="bg-secondary">
        <Container>
          <h2 className="mb-10 text-2xl font-bold uppercase md:text-3xl">
            Проекты вилл
          </h2>
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {projects.map((p: ProjectCardData) => (
              <ProjectCard key={p.slug} project={p} />
            ))}
          </div>
        </Container>
      </Section>

      <Section className="bg-primary text-primary-foreground">
        <Container>
          <div className="mx-auto max-w-2xl">
            <h2 className="text-3xl font-bold uppercase md:text-4xl">
              Обсудить проект виллы
            </h2>
            <p className="mt-4 text-white/70">
              Оставьте заявку — пришлём презентацию, обсудим участок и бюджет.
            </p>
            <div className="mt-8">
              <ContactForm
                variant="dark"
                formType="contact"
                submitLabel="Получить презентацию"
              />
            </div>
          </div>
        </Container>
      </Section>
    </PageLayout>
  );
}
