import { createFileRoute } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { PageLayout } from "@/components/PageLayout";
import { Container, Section } from "@/components/Container";
import { ProjectCard, type ProjectCardData } from "@/components/ProjectCard";
import { ContactForm } from "@/components/ContactForm";
import { CheckCircle2 } from "lucide-react";
import { usePageEngagement } from "@/hooks/usePageEngagement";

export const Route = createFileRoute("/concrete")({
  head: () => ({
    meta: [
      { property: "og:url", content: "https://eco-cub.ru/concrete" },
      {
        title: "Бетонные модульные дома от производителя в Подмосковье | EcoCub",
      },
      {
        name: "description",
        content:
          "Каталог модульных бетонных домов EcoCub. Заводская сборка, готовность 90 дней, круглогодичное проживание. Цены, проекты, площади.",
      },
      {
        property: "og:title",
        content: "Модульные бетонные дома EcoCub",
      },
      {
        property: "og:description",
        content:
          "Бетонные модульные дома от производителя — Weekend, Family, Double. От 4.5 млн ₽.",
      },
      { property: "og:image", content: "/images/section-concrete.png" },
    ],
    links: [{ rel: "canonical", href: "https://eco-cub.ru/concrete" }],
  }),
  loader: async () => {
    const { data, error } = await supabase
      .from("projects")
      .select("slug,name,series,tagline,area_m2,bedrooms,price_from,cover_image")
      .eq("series", "concrete")
      .eq("published", true)
      .order("display_order", { ascending: true });
    if (error) throw error;
    return { projects: (data ?? []) as ProjectCardData[] };
  },
  errorComponent: ({ error }: { error: Error }) => (
    <PageLayout>
      <Container className="py-32 text-center text-destructive">{error.message}</Container>
    </PageLayout>
  ),
  notFoundComponent: () => (
    <PageLayout>
      <Container className="py-32 text-center">Не найдено</Container>
    </PageLayout>
  ),
  component: ConcretePage,
});

const benefits = [
  "Бетонные модули — долговечнее каркаса в 3 раза",
  "Заводская сборка под крышей — без зависимости от погоды",
  "Готовность от 90 дней с момента договора",
  "Круглогодичное проживание, утеплённый контур",
  "Минимальные требования к фундаменту",
  "Гарантия 25 лет на конструкцию",
];

function ConcretePage() {
  usePageEngagement("concrete");
  const { projects } = Route.useLoaderData();

  return (
    <PageLayout>
      <section className="relative bg-primary text-primary-foreground">
        <img
          src="/images/section-concrete.png"
          alt=""
          className="absolute inset-0 h-full w-full object-cover opacity-40"
        />
        <div className="absolute inset-0 bg-gradient-to-r from-black/80 to-black/30" />
        <Container className="relative py-24 md:py-32">
          <p className="text-xs font-medium uppercase tracking-[0.3em] text-accent">
            Серия Concrete
          </p>
          <h1 className="mt-3 max-w-4xl text-4xl font-bold uppercase leading-[1.05] tracking-tight md:text-6xl">
            Капитальный дом
            <br />
            из бетона за 90 дней
          </h1>
          <p className="mt-6 max-w-2xl text-lg text-white/85">
            Hi-tech модули из бетона М400. Заводское качество, сборка на участке за 10 дней, гарантия
            50 лет. От 105 000 ₽ за м² в комплектации под предчистовую отделку.
          </p>
        </Container>
      </section>

      <Section>
        <Container>
          <div className="grid gap-x-12 gap-y-8 lg:grid-cols-2">
            <div>
              <h2 className="text-2xl font-bold uppercase md:text-3xl">Почему бетон</h2>
              <p className="mt-4 text-muted-foreground">
                Бетонная конструкция модулей даёт ключевое преимущество перед каркасом —
                долговечность, звукоизоляция и устойчивость к деформациям. Каждый модуль собирается
                на заводе, привозится на участок готовым и монтируется за 1 день.
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

      <Section className="bg-secondary">
        <Container>
          <h2 className="mb-10 text-2xl font-bold uppercase md:text-3xl">Проекты бетонных домов</h2>
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
            <h2 className="text-3xl font-bold uppercase md:text-4xl">Подобрать бетонный дом</h2>
            <p className="mt-4 text-white/70">
              Расскажем подробнее, подберём проект под ваш участок и бюджет.
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
