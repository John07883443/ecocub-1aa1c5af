import { useEffect, useState } from "react";
import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { ArrowRight, ShieldCheck, Clock, Layers, Hammer } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { PageLayout } from "@/components/PageLayout";
import { Container, Section } from "@/components/Container";
import { Button } from "@/components/ui/button";
import { ProjectCard, type ProjectCardData } from "@/components/ProjectCard";
import { ContactForm } from "@/components/ContactForm";
import { PriceCalculator } from "@/components/PriceCalculator";
import { CompanyTimeline } from "@/components/CompanyTimeline";
import { WhatsIncluded } from "@/components/WhatsIncluded";
import { StagesCooperation } from "@/components/StagesCooperation";
import { InteriorsGallery } from "@/components/InteriorsGallery";
import { BlogCard } from "@/components/BlogCard";
import { BrandSpecs } from "@/components/BrandSpecs";
import { Configurator } from "@/components/Configurator";
import { HeroSlider } from "@/components/HeroSlider";
import { LayeredSection } from "@/components/LayeredSection";

import { site } from "@/lib/site";
import { getAllPosts } from "@/lib/blog";
import { analytics } from "@/lib/analytics";
import { usePageEngagement } from "@/hooks/usePageEngagement";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { property: "og:url", content: "https://eco-cub.ru" },
      {
        title:
          "Современные дома из бетона в Московской области — модульные дома под ключ за 90 дней | EcoCub",
      },
      {
        name: "description",
        content:
          "Монолитно-модульные дома из бетона от производителя в Московской области. Капитальный дом за 90 дней, гарантия 50 лет. От 105 000 ₽/м². Альтернатива кирпичу, газобетону и монолиту с фиксированной сметой.",
      },
      {
        name: "keywords",
        content:
          "модульные дома из бетона, монолитно-модульный дом, дом из бетона под ключ, капитальный дом быстро, hi-tech дом из бетона, модульный дом конструктор, энергоэффективный дом A+++, современный дом в стиле хай-тек Подмосковье, современные дома Московская область, дом для круглогодичного проживания, альтернатива газобетону",
      },
      { property: "og:title", content: "EcoCub — монолитно-модульные дома из бетона за 90 дней" },
      {
        property: "og:description",
        content:
          "Капитальный дом из бетона под ключ от 105 000 ₽/м². Производство в Московской области. Гарантия 50 лет, срок службы более 120 лет.",
      },
      { property: "og:image", content: "/images/hero-villa-1600.webp" },
      { name: "twitter:image", content: "/images/hero-villa-1600.webp" },
    ],
    links: [{ rel: "canonical", href: "https://eco-cub.ru" }],
  }),
  loader: async () => {
    // Статьи — из локальных файлов, без сети и без базы.
    const posts = getAllPosts().slice(0, 3);

    // Проекты пока во внешней базе: унаследованная зависимость, снимается отдельно.
    const projectsRes = await supabase
      .from("projects")
      .select("slug,name,series,tagline,area_m2,bedrooms,price_from,cover_image")
      .eq("published", true)
      .order("display_order", { ascending: true })
      .limit(6);
    if (projectsRes.error) throw projectsRes.error;

    return { projects: (projectsRes.data ?? []) as ProjectCardData[], posts };
  },
  errorComponent: ({ error, reset }: { error: Error; reset: () => void }) => (
    <PageLayout>
      <Container className="py-32 text-center">
        <p className="text-destructive">Ошибка: {error.message}</p>
        <Button onClick={reset} className="mt-4">
          Попробовать снова
        </Button>
      </Container>
    </PageLayout>
  ),
  notFoundComponent: () => {
    notFound();
    return null;
  },
  component: HomePage,
});

const competitors = [
  { vs: "vs Кирпич", stat: "В 6 раз быстрее", desc: "90 дней против 1,5 лет на стройплощадке" },
  {
    vs: "vs Газобетон",
    stat: "Прочнее в 12 раз",
    desc: "Бетон М400 не даёт усадки и не боится влаги",
  },
  {
    vs: "vs Монолит на участке",
    stat: "Не зависит от погоды",
    desc: "Заводская сборка круглый год",
  },
  { vs: "vs ЖБИ-панели", stat: "Дешевле и теплее", desc: "Утепление снаружи, теплопередача 4,1" },
];

function useLockedMobileViewportHeight() {
  const [height, setHeight] = useState<number | null>(null);

  useEffect(() => {
    let viewportWidth = window.innerWidth;
    const readHeight = () => Math.round(window.visualViewport?.height ?? window.innerHeight);

    setHeight(readHeight());

    const handleResize = () => {
      const nextWidth = window.innerWidth;
      if (Math.abs(nextWidth - viewportWidth) < 24) return;
      viewportWidth = nextWidth;
      setHeight(readHeight());
    };

    const handleOrientationChange = () => {
      window.setTimeout(() => {
        viewportWidth = window.innerWidth;
        setHeight(readHeight());
      }, 250);
    };

    window.addEventListener("resize", handleResize);
    window.addEventListener("orientationchange", handleOrientationChange);

    return () => {
      window.removeEventListener("resize", handleResize);
      window.removeEventListener("orientationchange", handleOrientationChange);
    };
  }, []);

  return height;
}

function HomePage() {
  usePageEngagement("home");
  const { projects, posts } = Route.useLoaderData();
  const mobileHeroHeight = useLockedMobileViewportHeight();

  return (
    <PageLayout headerVariant="dark">
      {/* HERO */}
      <section
        className="relative h-[var(--mobile-hero-height,100svh)] w-full overflow-hidden bg-primary text-primary-foreground md:h-screen"
        style={
          mobileHeroHeight
            ? ({ "--mobile-hero-height": `${mobileHeroHeight}px` } as React.CSSProperties)
            : undefined
        }
      >
        <HeroSlider />
        {/* Bottom panel — заголовок и CTA в нижней зоне, дом сверху не перекрыт */}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 bg-gradient-to-t from-black/85 via-black/55 to-transparent pb-20 pt-12 md:pb-16 md:pt-32">
          <Container>
            <div className="grid items-end gap-8 lg:grid-cols-12">
              <h1 className="lg:col-span-7 font-bold uppercase leading-[1.05] tracking-tight [font-size:clamp(1.75rem,5.5vw,3.75rem)]">
                <span className="block max-w-full whitespace-nowrap">Капитальные.</span>
                <span className="block max-w-full whitespace-nowrap text-accent">
                  Технологичные.
                </span>
              </h1>
              <div className="lg:col-span-5">
                <p className="max-w-md text-sm text-white/85 md:text-base">
                  Дома из бетона с заводским качеством. Сборка на участке за 10 дней.
                </p>
                <div className="pointer-events-auto mt-6 flex flex-wrap gap-3">
                  <Button
                    asChild
                    size="lg"
                    className="bg-accent text-accent-foreground hover:bg-accent/90"
                  >
                    <Link to="/portfolio">
                      Смотреть проекты <ArrowRight />
                    </Link>
                  </Button>
                  <Button
                    asChild
                    size="lg"
                    variant="outline"
                    className="border-white/40 bg-transparent text-white hover:bg-white hover:text-primary"
                  >
                    <Link to="/technology">Технология</Link>
                  </Button>
                </div>
              </div>
            </div>
          </Container>
        </div>
      </section>

      {/* BRAND SPECS — "дом как техника" */}
      <BrandSpecs />

      {/* COMPETITORS */}
      <Section id="comparison" className="bg-background">
        <Container>
          <div className="mb-12 max-w-3xl">
            <p className="text-xs font-medium uppercase tracking-[0.3em] text-accent">
              Сравнение технологий
            </p>
            <h2 className="mt-3 text-3xl font-bold uppercase md:text-5xl">
              Капитальный дом — без долгостроя
            </h2>
            <p className="mt-4 text-muted-foreground">
              Мы конкурируем не с каркасниками, а с кирпичом, газобетоном, монолитом и ЖБИ-панелями
              — но строим в разы быстрее и с фиксированной сметой.
            </p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {competitors.map((c) => (
              <div key={c.vs} className="flex flex-col rounded-sm border border-border bg-card p-6">
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  {c.vs}
                </p>
                <p className="mt-3 text-2xl font-bold text-accent">{c.stat}</p>
                <p className="mt-2 flex-1 text-sm text-muted-foreground">{c.desc}</p>
              </div>
            ))}
          </div>
          <div className="mt-8">
            <Link
              to="/technology"
              className="inline-flex items-center gap-2 text-sm font-medium text-accent hover:underline"
            >
              Полная таблица сравнения <ArrowRight className="size-4" />
            </Link>
          </div>
        </Container>
      </Section>

      {/* COMPANY TIMELINE */}
      <Section id="about" className="bg-secondary">
        <Container>
          <div className="mb-12 max-w-3xl">
            <p className="text-xs font-medium uppercase tracking-[0.3em] text-accent">О компании</p>
            <h2 className="mt-3 text-3xl font-bold uppercase md:text-5xl">
              Производство в Подмосковье
            </h2>
          </div>
          <CompanyTimeline />
        </Container>
      </Section>

      {/* LEGO */}
      <Section id="modules" className="bg-background">
        <Container>
          <div className="grid items-center gap-12 lg:grid-cols-2">
            <div>
              <p className="text-xs font-medium uppercase tracking-[0.3em] text-accent">
                Принцип LEGO
              </p>
              <h2 className="mt-3 text-3xl font-bold uppercase md:text-5xl">
                Соберите свой дом из готовых модулей
              </h2>
              <p className="mt-6 text-base text-muted-foreground">
                Каждый модуль ECO·CUB — это готовая комната с потолками 3,15 м, инженерией и
                отделкой, произведённая на заводе. На участке модули собираются в дом краном за 10
                дней. Хотите больше места — добавьте модуль. Гибкая планировка под ваши задачи.
              </p>
              <Button
                asChild
                className="mt-8 bg-accent text-accent-foreground hover:bg-accent/90"
                size="lg"
              >
                <Link to="/technology">
                  Подробнее о технологии <ArrowRight />
                </Link>
              </Button>
            </div>
            <div className="relative aspect-[4/3]">
              <img
                src="/images/lego-truck.png"
                alt="Принцип LEGO: модули EcoCub доставляются на участок"
                className="h-full w-full object-contain"
              />
            </div>
          </div>
        </Container>
      </Section>

      {/* CONFIGURATOR */}
      <Configurator />

      {/* TECHNOLOGY */}
      <Section id="technology" className="bg-primary text-primary-foreground">
        <Container>
          <div className="grid items-center gap-12 lg:grid-cols-2">
            <div className="relative">
              <LayeredSection />
            </div>
            <div>
              <p className="text-xs font-medium uppercase tracking-[0.3em] text-accent">
                05 · Технология
              </p>
              <h2 className="mt-3 text-3xl font-bold uppercase md:text-5xl">
                Бетон М400 + сталь + утеплитель
              </h2>
              <p className="mt-6 text-base text-white/80">
                Монолитные модули из бетона М400 с оцинкованной арматурой и утеплителем ПСБ-С35.
                Сопротивление теплопередаче — 4,1 (м²·°C)/Вт. Класс пожаробезопасности К0 —
                негорючие материалы. Подходит для круглогодичного проживания без дополнительного
                утепления.
              </p>
              <div className="mt-8 grid grid-cols-2 gap-6">
                <div>
                  <ShieldCheck className="size-6 text-accent" />
                  <p className="mt-3 text-2xl font-bold">50 лет</p>
                  <p className="text-sm text-white/70">гарантия на конструкцию</p>
                </div>
                <div>
                  <Clock className="size-6 text-accent" />
                  <p className="mt-3 text-2xl font-bold">{">"}120 лет</p>
                  <p className="text-sm text-white/70">срок службы</p>
                </div>
                <div>
                  <Layers className="size-6 text-accent" />
                  <p className="mt-3 text-2xl font-bold">К0</p>
                  <p className="text-sm text-white/70">класс пожаробезопасности</p>
                </div>
                <div>
                  <Hammer className="size-6 text-accent" />
                  <p className="mt-3 text-2xl font-bold">10 дней</p>
                  <p className="text-sm text-white/70">монтаж на участке</p>
                </div>
              </div>
            </div>
          </div>
        </Container>
      </Section>

      {/* CALCULATOR */}
      <Section id="calculator" className="bg-background">
        <Container>
          <div className="mb-12 max-w-3xl">
            <p className="text-xs font-medium uppercase tracking-[0.3em] text-accent">
              Прозрачная цена
            </p>
            <h2 className="mt-3 text-3xl font-bold uppercase md:text-5xl">
              Посчитайте свой дом за минуту
            </h2>
            <p className="mt-4 text-muted-foreground">
              Базовая цена 105 000 ₽ за м² в комплектации под предчистовую отделку — одна ставка для
              всех проектов. Никаких «доплатите ещё» по ходу стройки.
            </p>
          </div>
          <PriceCalculator />
        </Container>
      </Section>

      {/* WHATS INCLUDED */}
      <Section id="included" className="bg-secondary">
        <Container>
          <div className="mb-12 max-w-3xl">
            <p className="text-xs font-medium uppercase tracking-[0.3em] text-accent">
              Что входит в стоимость
            </p>
            <h2 className="mt-3 text-3xl font-bold uppercase md:text-5xl">
              Полная комплектация под ключ
            </h2>
          </div>
          <WhatsIncluded />
        </Container>
      </Section>

      {/* PROJECTS */}
      <Section id="projects" className="bg-background">
        <Container>
          <div className="mb-12 flex items-end justify-between gap-4">
            <div>
              <p className="text-xs font-medium uppercase tracking-[0.3em] text-accent">Проекты</p>
              <h2 className="mt-3 text-3xl font-bold uppercase md:text-5xl">Готовые решения</h2>
            </div>
            <Link
              to="/portfolio"
              className="hidden items-center gap-1 text-sm font-medium hover:text-accent md:inline-flex"
            >
              Все проекты <ArrowRight className="size-4" />
            </Link>
          </div>
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {projects.map((p: ProjectCardData) => (
              <ProjectCard key={p.slug} project={p} />
            ))}
          </div>
        </Container>
      </Section>

      {/* INTERIORS */}
      <Section id="interiors" className="bg-secondary">
        <Container>
          <div className="mb-12 max-w-3xl">
            <p className="text-xs font-medium uppercase tracking-[0.3em] text-accent">
              07 · Интерьеры
            </p>
            <h2 className="mt-3 text-3xl font-bold uppercase md:text-5xl">Дизайн интерьеров</h2>
            <p className="mt-4 text-muted-foreground">
              Потолки 3,15 м и панорамные окна позволяют реализовать любые дизайнерские решения.
            </p>
          </div>
          <InteriorsGallery />
        </Container>
      </Section>

      {/* STAGES */}
      <Section id="stages" className="bg-background">
        <Container>
          <div className="mb-12 max-w-3xl">
            <p className="text-xs font-medium uppercase tracking-[0.3em] text-accent">
              Этапы сотрудничества
            </p>
            <h2 className="mt-3 text-3xl font-bold uppercase md:text-5xl">5 шагов до ключей</h2>
            <p className="mt-4 text-muted-foreground">
              Прозрачный процесс с фиксированной сметой и оплатой 60% / 30% / 10%.
            </p>
          </div>
          <StagesCooperation />
        </Container>
      </Section>

      {/* BLOG */}
      {posts.length > 0 && (
        <Section id="blog" className="bg-secondary">
          <Container>
            <div className="mb-12 flex items-end justify-between gap-4">
              <div>
                <p className="text-xs font-medium uppercase tracking-[0.3em] text-accent">Блог</p>
                <h2 className="mt-3 text-3xl font-bold uppercase md:text-5xl">Из наших статей</h2>
              </div>
              <Link
                to="/blog"
                className="hidden items-center gap-1 text-sm font-medium hover:text-accent md:inline-flex"
              >
                Все статьи <ArrowRight className="size-4" />
              </Link>
            </div>
            <div className="grid gap-6 md:grid-cols-3">
              {posts.map((p) => (
                <BlogCard key={p.slug} post={p} />
              ))}
            </div>
          </Container>
        </Section>
      )}

      {/* CTA FORM */}
      <Section id="contact" className="bg-primary text-primary-foreground">
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
                Оставьте заявку — менеджер свяжется в течение часа, подберёт подходящий проект и
                пришлёт расчёт.
              </p>
              <div className="mt-8 space-y-2 text-sm text-white/80">
                <a
                  href={site.phoneHref}
                  onClick={() => analytics.contactClick("phone", "home-cta")}
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
