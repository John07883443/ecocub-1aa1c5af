import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight, ShieldCheck, Layers, Flame, Thermometer } from "lucide-react";
import { PageLayout } from "@/components/PageLayout";
import { Container, Section } from "@/components/Container";
import { TechnologyComparison } from "@/components/TechnologyComparison";
import { EngineeringFeatures } from "@/components/EngineeringFeatures";
import { ContactForm } from "@/components/ContactForm";
import { LayeredSectionA } from "@/components/LayeredSectionA";
import { Button } from "@/components/ui/button";
import { Reveal } from "@/components/motion/Reveal";
import { Parallax } from "@/components/motion/Parallax";
import { usePageEngagement } from "@/hooks/usePageEngagement";

export const Route = createFileRoute("/technology")({
  head: () => ({
    meta: [
      { property: "og:url", content: "https://eco-cub.ru/technology" },
      {
        title:
          "Технология ECO·CUB — монолитно-модульный дом vs кирпич, газобетон, монолит, ЖБИ | EcoCub",
      },
      {
        name: "description",
        content:
          "Сравнение технологий строительства: монолитно-модульные дома ECO·CUB против кирпича, газобетона, заливного монолита и ЖБИ-панелей. Скорость, цена, долговечность, теплоизоляция, гарантия.",
      },
      {
        name: "keywords",
        content:
          "технология строительства домов, бетонный модульный дом vs газобетон, альтернатива кирпичному дому, ЖБИ панели против модульного бетона, монолит на участке сравнение, hi-tech дом из бетона, энергоэффективный дом A+++, модульный дом конструктор, передовая инженерия дома",
      },
      {
        property: "og:title",
        content: "Технология ECO·CUB — сравнение с кирпичом, газобетоном, монолитом",
      },
      {
        property: "og:description",
        content:
          "Бетон М400, оцинкованная сталь, утеплитель ПСБ-С35. Гарантия 50 лет, срок службы более 120 лет.",
      },
      { property: "og:image", content: "/images/tech-section.jpg" },
    ],
    scripts: [
      {
        type: "application/ld+json",
        children: JSON.stringify({
          "@context": "https://schema.org",
          "@type": "Article",
          headline:
            "Технология ECO·CUB — монолитно-модульный дом vs кирпич, газобетон, монолит, ЖБИ",
          author: { "@type": "Organization", name: "EcoCub" },
          image: "/images/tech-section.jpg",
        }),
      },
    ],
    links: [{ rel: "canonical", href: "https://eco-cub.ru/technology" }],
  }),
  component: TechnologyPage,
});

function TechnologyPage() {
  usePageEngagement("technology");
  return (
    <PageLayout headerVariant="dark">
      {/* HERO */}
      <section className="relative overflow-hidden bg-primary py-32 text-primary-foreground md:py-40">
        <div className="absolute inset-0 opacity-30">
          <Parallax speed={0.14} max={70} className="h-[130%] w-full">
            <img src="/images/tech-section.jpg" alt="" className="h-full w-full object-cover" />
          </Parallax>
        </div>
        <span
          aria-hidden="true"
          className="ecocub-glow left-[-8%] top-1/2 h-[45vw] max-h-[500px] w-[45vw] max-w-[500px] -translate-y-1/2"
        />
        <Container className="relative">
          <Reveal>
            <p className="text-xs font-medium uppercase tracking-[0.3em] text-accent">
              05 · Технология
            </p>
            <h1 className="mt-4 max-w-4xl text-4xl font-bold uppercase md:text-6xl">
              Технология ECO·CUB
            </h1>
            <p className="mt-6 max-w-2xl text-lg text-white/85">
              Капитальный монолитно-модульный дом из бетона за 90 дней. Заводское качество, гарантия
              50 лет, срок службы более 120 лет.
            </p>
          </Reveal>
        </Container>
      </section>

      {/* MATERIALS — DESIGN COMPARISON (3 варианта на сравнение) */}
      <Section className="bg-background">
        <Container>
          <Reveal className="mb-12 max-w-3xl">
            <p className="text-xs font-medium uppercase tracking-[0.3em] text-accent">
              Анатомия стены
            </p>
            <h2 className="mt-3 text-3xl font-bold uppercase md:text-4xl">
              Послойный разрез модуля
            </h2>
            <p className="mt-4 text-muted-foreground">
              Симметричный «сэндвич» 210 мм: бетон М400 на оцинкованном каркасе с обеих сторон, ядро
              — ПСБ-С35 100 мм.
            </p>
          </Reveal>

          {/* Variant A */}
          <Reveal variant="scale" className="mb-16">
            <div
              className="rounded-sm p-6 text-primary-foreground md:p-10"
              style={{ backgroundColor: "#222222" }}
            >
              <LayeredSectionA />
            </div>
          </Reveal>

          {/* Оригинальный список фич — оставляем */}
          <div className="grid items-center gap-12 lg:grid-cols-2">
            <Reveal variant="left">
              <p className="text-xs font-medium uppercase tracking-[0.3em] text-accent">
                Из чего сделан модуль
              </p>
              <h2 className="mt-3 text-3xl font-bold uppercase md:text-4xl">
                Три слоя капитальности
              </h2>
              <div className="mt-8 space-y-6">
                {[
                  {
                    Icon: Layers,
                    title: "Бетон М400",
                    desc: "Прочность на сжатие 400 кг/см² — в 12 раз больше, чем у газоблока. Не даёт усадки.",
                  },
                  {
                    Icon: ShieldCheck,
                    title: "Оцинкованная стальная арматура",
                    desc: "Несущий каркас, не подверженный коррозии. Срок службы — более 120 лет.",
                  },
                  {
                    Icon: Thermometer,
                    title: "Утеплитель ПСБ-С35",
                    desc: "Сопротивление теплопередаче 4,1 (м²·°C)/Вт — выше нормы СНиП для Москвы.",
                  },
                  {
                    Icon: Flame,
                    title: "Класс пожаробезопасности К0",
                    desc: "Полностью негорючие материалы. Безопасно для семьи с детьми.",
                  },
                ].map((f, i) => (
                  <Reveal key={f.title} variant="up" delay={i * 90} className="group flex gap-4">
                    <div className="flex size-12 shrink-0 items-center justify-center rounded-sm bg-accent/10 text-accent transition-all duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] group-hover:scale-110 group-hover:bg-accent group-hover:text-accent-foreground">
                      <f.Icon className="size-6" />
                    </div>
                    <div>
                      <h3 className="font-semibold">{f.title}</h3>
                      <p className="mt-1 text-sm text-muted-foreground">{f.desc}</p>
                    </div>
                  </Reveal>
                ))}
              </div>
            </Reveal>
            <Reveal variant="right" delay={120} className="rounded-sm bg-secondary p-6 md:p-10">
              <p className="text-sm text-muted-foreground">
                Все слои работают как единое целое: бетон даёт прочность, оцинкованная сталь —
                несущий каркас, ПСБ-С35 — теплоизоляцию выше норм СНиП.
              </p>
            </Reveal>
          </div>
        </Container>
      </Section>

      <Section className="bg-secondary">
        <Container>
          <Reveal className="mb-10 max-w-3xl">
            <p className="text-xs font-medium uppercase tracking-[0.3em] text-accent">
              Таблица сравнения
            </p>
            <h2 className="mt-3 text-3xl font-bold uppercase md:text-5xl">
              ECO·CUB vs другие технологии
            </h2>
            <p className="mt-4 text-muted-foreground">
              Сравниваем монолитно-модульную технологию с традиционными способами строительства
              капитального жилья.
            </p>
          </Reveal>
          <Reveal variant="up" delay={80}>
            <TechnologyComparison />
          </Reveal>
        </Container>
      </Section>

      {/* WHY CHEAPER THAN PANEL */}
      <Section className="bg-background">
        <Container>
          <Reveal className="mx-auto max-w-3xl">
            <p className="text-xs font-medium uppercase tracking-[0.3em] text-accent">
              Почему мы доступнее
            </p>
            <h2 className="mt-3 text-3xl font-bold uppercase md:text-4xl">
              Дешевле панельного дома, прочнее газобетона
            </h2>
            <div className="mt-8 space-y-6 text-base text-foreground/90">
              <p>
                Заводская сборка дома из железобетонных панелей — самая дорогая технология в
                Подмосковье: 130–180 тыс ₽ за м². Высокая цена объясняется огромным весом панелей,
                мощной техникой для монтажа и большим расходом стали.
              </p>
              <p>
                Модули ECO·CUB легче (бетон + утеплитель снаружи), монтируются обычным автокраном за
                10 дней, а утепление снаружи устраняет мостики холода. Поэтому наша цена —{" "}
                <strong className="text-accent">от 105 000 ₽ за м²</strong> с фиксированной сметой и
                заводской гарантией.
              </p>
              <p>
                По сравнению с газобетоном вы получаете капитальный дом из настоящего бетона с
                прочностью в 12 раз выше, без усадки, с заводским контролем качества и гарантией 50
                лет — за сопоставимую цену.
              </p>
            </div>
            <div className="mt-10">
              <Button
                asChild
                size="lg"
                className="btn-shine bg-accent text-accent-foreground hover:bg-accent/90"
              >
                <Link to="/portfolio">
                  Посмотреть проекты <ArrowRight />
                </Link>
              </Button>
            </div>
          </Reveal>
        </Container>
      </Section>

      {/* ENGINEERING */}
      <Section className="bg-background">
        <Container>
          <Reveal>
            <EngineeringFeatures />
          </Reveal>
        </Container>
      </Section>

      {/* CTA */}
      <Section className="relative overflow-hidden bg-primary text-primary-foreground">
        <span
          aria-hidden="true"
          className="ecocub-glow bottom-[-15%] right-[-8%] h-[45vw] max-h-[520px] w-[45vw] max-w-[520px]"
        />
        <Container className="relative">
          <div className="grid gap-12 lg:grid-cols-2">
            <Reveal variant="left">
              <p className="text-xs font-medium uppercase tracking-[0.3em] text-accent">
                Обсудим ваш проект
              </p>
              <h2 className="mt-3 text-3xl font-bold uppercase md:text-5xl">
                Расскажем подробнее о технологии
              </h2>
              <p className="mt-6 max-w-md text-base text-white/70">
                Менеджер свяжется в течение часа, ответит на вопросы и пришлёт техническую
                документацию.
              </p>
            </Reveal>
            <Reveal variant="right" delay={120} className="rounded-sm bg-white/5 p-6 md:p-8">
              <ContactForm
                variant="dark"
                formType="contact"
                sourcePage="/technology"
                submitLabel="Получить документацию"
              />
            </Reveal>
          </div>
        </Container>
      </Section>
    </PageLayout>
  );
}
