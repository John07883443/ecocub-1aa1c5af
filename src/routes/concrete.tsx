import { createFileRoute } from "@tanstack/react-router";
import { fetchProjects, filterBySeries } from "@/lib/projects";
import { PageLayout } from "@/components/PageLayout";
import { Container, Section } from "@/components/Container";
import { ProjectCard, type ProjectCardData } from "@/components/ProjectCard";
import { ContactForm } from "@/components/ContactForm";
import { CheckCircle2 } from "lucide-react";
import { Reveal } from "@/components/motion/Reveal";
import { Parallax } from "@/components/motion/Parallax";
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
  loader: async () => ({
    projects: filterBySeries(await fetchProjects(), "concrete") as ProjectCardData[],
  }),
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
      <section className="relative overflow-hidden bg-primary text-primary-foreground">
        <div className="absolute inset-0 opacity-40">
          <Parallax speed={0.12} max={60} className="h-[130%] w-full">
            <img src="/images/section-concrete.png" alt="" className="h-full w-full object-cover" />
          </Parallax>
        </div>
        <div className="absolute inset-0 bg-gradient-to-r from-black/80 to-black/30" />
        <Container className="relative py-24 md:py-32">
          <Reveal>
            <p className="text-xs font-medium uppercase tracking-[0.3em] text-accent">
              Серия Concrete
            </p>
            <h1 className="mt-3 max-w-4xl text-4xl font-bold uppercase leading-[1.05] tracking-tight md:text-6xl">
              Капитальный дом
              <br />
              из бетона за 90 дней
            </h1>
            <p className="mt-6 max-w-2xl text-lg text-white/85">
              Hi-tech модули из бетона М400. Заводское качество, сборка на участке за 10 дней,
              гарантия 50 лет. От 105 000 ₽ за м² в комплектации под предчистовую отделку.
            </p>
          </Reveal>
        </Container>
      </section>

      <Section>
        <Container>
          <div className="grid gap-x-12 gap-y-8 lg:grid-cols-2">
            <Reveal variant="left">
              <h2 className="text-2xl font-bold uppercase md:text-3xl">Почему бетон</h2>
              <p className="mt-4 text-muted-foreground">
                Бетонная конструкция модулей даёт ключевое преимущество перед каркасом —
                долговечность, звукоизоляция и устойчивость к деформациям. Каждый модуль собирается
                на заводе, привозится на участок готовым и монтируется за 1 день.
              </p>
            </Reveal>
            <div className="grid gap-3">
              {benefits.map((b, i) => (
                <Reveal
                  key={b}
                  variant="right"
                  delay={i * 70}
                  className="flex items-start gap-3 text-sm"
                >
                  <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-accent" />
                  {b}
                </Reveal>
              ))}
            </div>
          </div>
        </Container>
      </Section>

      <Section className="bg-secondary">
        <Container>
          <Reveal>
            <h2 className="mb-10 text-2xl font-bold uppercase md:text-3xl">
              Проекты бетонных домов
            </h2>
          </Reveal>
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {projects.map((p: ProjectCardData, i: number) => (
              <Reveal key={p.slug} variant="up" delay={(i % 3) * 90} className="h-full">
                <ProjectCard project={p} />
              </Reveal>
            ))}
          </div>
        </Container>
      </Section>

      <Section className="relative overflow-hidden bg-primary text-primary-foreground">
        <span
          aria-hidden="true"
          className="ecocub-glow left-1/2 top-[-20%] h-[45vw] max-h-[500px] w-[45vw] max-w-[500px] -translate-x-1/2"
        />
        <Container className="relative">
          <Reveal variant="scale" className="mx-auto max-w-2xl">
            <h2 className="text-3xl font-bold uppercase md:text-4xl">Подобрать бетонный дом</h2>
            <p className="mt-4 text-white/70">
              Расскажем подробнее, подберём проект под ваш участок и бюджет.
            </p>
            <div className="mt-8">
              <ContactForm variant="dark" formType="contact" />
            </div>
          </Reveal>
        </Container>
      </Section>
    </PageLayout>
  );
}
