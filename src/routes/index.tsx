import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight, CheckCircle2, Hammer, Ruler, Award } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { PageLayout } from "@/components/PageLayout";
import { Container, Section } from "@/components/Container";
import { Button } from "@/components/ui/button";
import { ProjectCard, type ProjectCardData } from "@/components/ProjectCard";
import { ContactForm } from "@/components/ContactForm";
import { site } from "@/lib/site";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "EcoCub — современные дома под ключ в Московской области" },
      {
        name: "description",
        content:
          "Производитель модульных бетонных домов и каркасных Eco Wood в Подмосковье. Hi-Tech виллы под ключ за 90 дней. Цены, проекты, портфолио.",
      },
      {
        property: "og:title",
        content: "EcoCub — современные дома под ключ",
      },
      {
        property: "og:description",
        content:
          "Модульные бетонные дома, каркас Scandi и виллы Hi-Tech от производителя в Московской области.",
      },
      { property: "og:image", content: "/images/hero.png" },
      { name: "twitter:image", content: "/images/hero.png" },
    ],
  }),
  loader: async () => {
    const { data, error } = await supabase
      .from("projects")
      .select("slug,name,series,tagline,area_m2,bedrooms,price_from,cover_image")
      .eq("published", true)
      .order("display_order", { ascending: true })
      .limit(6);
    if (error) throw error;
    return { projects: (data ?? []) as ProjectCardData[] };
  },
  errorComponent: ({ error, reset }) => (
    <PageLayout>
      <Container className="py-32 text-center">
        <p className="text-destructive">Ошибка: {error.message}</p>
        <Button onClick={reset} className="mt-4">
          Попробовать снова
        </Button>
      </Container>
    </PageLayout>
  ),
  component: HomePage,
});

const series = [
  {
    title: "Бетонные модульные дома",
    desc: "Долговечная конструкция из бетона, заводская сборка, готовность за 90 дней.",
    image: "/images/section-concrete.png",
    to: "/concrete",
  },
  {
    title: "Каркасные Eco Wood",
    desc: "Сканди-каркас одноэтажные дома для круглогодичного проживания.",
    image: "/images/section-scandi.png",
    to: "/scandi",
  },
  {
    title: "Виллы Hi-Tech",
    desc: "Премиальные модульные виллы под ключ с панорамным остеклением.",
    image: "/images/section-villa.png",
    to: "/villas",
  },
] as const;

const advantages = [
  {
    icon: Hammer,
    title: "Своё производство",
    desc: "Контроль качества на каждом этапе — от бетонных модулей до отделки",
  },
  {
    icon: Ruler,
    title: "Готовый проект за 90 дней",
    desc: "Заводская сборка модулей и быстрый монтаж на участке",
  },
  {
    icon: CheckCircle2,
    title: "Под ключ",
    desc: "Фундамент, коммуникации, отделка — всё включено в смету",
  },
  {
    icon: Award,
    title: "Гарантия 25 лет",
    desc: "На бетонную конструкцию модулей и инженерные системы",
  },
];

function HomePage() {
  const { projects } = Route.useLoaderData();

  return (
    <PageLayout headerVariant="dark">
      {/* HERO */}
      <section className="relative min-h-[100svh] w-full overflow-hidden bg-primary text-primary-foreground">
        <div className="absolute inset-0">
          <img
            src="/images/hero.png"
            alt="Современный модульный дом EcoCub в Московской области"
            className="h-full w-full object-cover opacity-60"
          />
          <div className="absolute inset-0 bg-gradient-to-b from-black/60 via-black/30 to-black/70" />
        </div>
        <Container className="relative flex min-h-[100svh] flex-col justify-end pb-20 pt-32 md:pb-28 md:pt-40">
          <p className="mb-4 inline-block text-xs font-medium uppercase tracking-[0.3em] text-accent">
            EcoCub · Московская область
          </p>
          <h1 className="max-w-4xl text-4xl font-bold uppercase leading-[1.05] tracking-tight md:text-6xl lg:text-7xl">
            Современные дома
            <br />
            под ключ
          </h1>
          <p className="mt-6 max-w-2xl text-base text-white/80 md:text-lg">
            Модульные бетонные дома, каркасные Eco Wood и виллы в стиле Hi-Tech
            от производителя. Готовность от 90 дней. Гарантия 25 лет.
          </p>
          <div className="mt-10 flex flex-wrap gap-4">
            <Button
              asChild
              size="lg"
              className="bg-accent text-accent-foreground hover:bg-accent/90"
            >
              <Link to="/portfolio">
                Смотреть проекты
                <ArrowRight />
              </Link>
            </Button>
            <Button
              asChild
              size="lg"
              variant="outline"
              className="border-white/40 bg-transparent text-white hover:bg-white hover:text-primary"
            >
              <Link to="/contacts">Получить расчёт</Link>
            </Button>
          </div>
        </Container>
      </section>

      {/* ADVANTAGES */}
      <Section className="bg-background">
        <Container>
          <div className="grid gap-8 md:grid-cols-2 lg:grid-cols-4">
            {advantages.map((a) => (
              <div key={a.title} className="flex flex-col">
                <a.icon className="size-8 text-accent" />
                <h3 className="mt-4 text-lg font-semibold">{a.title}</h3>
                <p className="mt-2 text-sm text-muted-foreground">{a.desc}</p>
              </div>
            ))}
          </div>
        </Container>
      </Section>

      {/* SERIES */}
      <Section className="bg-secondary">
        <Container>
          <div className="mb-12 max-w-3xl">
            <p className="text-xs font-medium uppercase tracking-[0.3em] text-accent">
              Серии домов
            </p>
            <h2 className="mt-3 text-3xl font-bold uppercase md:text-5xl">
              Три формата современного дома
            </h2>
          </div>
          <div className="grid gap-6 md:grid-cols-3">
            {series.map((s) => (
              <Link
                key={s.to}
                to={s.to}
                className="group relative block aspect-[4/5] overflow-hidden rounded-sm bg-primary"
              >
                <img
                  src={s.image}
                  alt={s.title}
                  loading="lazy"
                  className="absolute inset-0 h-full w-full object-cover opacity-70 transition-all duration-700 group-hover:scale-105 group-hover:opacity-90"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/20 to-transparent" />
                <div className="absolute inset-x-0 bottom-0 p-6 text-white">
                  <h3 className="text-2xl font-semibold uppercase">
                    {s.title}
                  </h3>
                  <p className="mt-2 text-sm text-white/80">{s.desc}</p>
                  <span className="mt-4 inline-flex items-center gap-1 text-sm font-medium text-accent">
                    Смотреть
                    <ArrowRight className="size-4 transition-transform group-hover:translate-x-1" />
                  </span>
                </div>
              </Link>
            ))}
          </div>
        </Container>
      </Section>

      {/* PROJECTS */}
      <Section className="bg-background">
        <Container>
          <div className="mb-12 flex items-end justify-between gap-4">
            <div>
              <p className="text-xs font-medium uppercase tracking-[0.3em] text-accent">
                Проекты
              </p>
              <h2 className="mt-3 text-3xl font-bold uppercase md:text-5xl">
                Готовые решения
              </h2>
            </div>
            <Link
              to="/portfolio"
              className="hidden items-center gap-1 text-sm font-medium text-foreground transition-colors hover:text-accent md:inline-flex"
            >
              Все проекты
              <ArrowRight className="size-4" />
            </Link>
          </div>
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {projects.map((p: ProjectCardData) => (
              <ProjectCard key={p.slug} project={p} />
            ))}
          </div>
        </Container>
      </Section>

      {/* CTA FORM */}
      <Section className="bg-primary text-primary-foreground">
        <Container>
          <div className="grid gap-12 lg:grid-cols-2">
            <div>
              <p className="text-xs font-medium uppercase tracking-[0.3em] text-accent">
                Связаться
              </p>
              <h2 className="mt-3 text-3xl font-bold uppercase md:text-5xl">
                Подберём проект под ваш участок
              </h2>
              <p className="mt-6 max-w-md text-base text-white/70">
                Оставьте заявку — менеджер свяжется в течение часа, подберёт
                подходящий проект и пришлёт расчёт.
              </p>
              <div className="mt-8 space-y-2 text-sm text-white/80">
                <a
                  href={site.phoneHref}
                  className="block text-2xl font-semibold text-white"
                >
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
                formType="contact"
                sourcePage="/"
                submitLabel="Получить расчёт"
              />
            </div>
          </div>
        </Container>
      </Section>
    </PageLayout>
  );
}
