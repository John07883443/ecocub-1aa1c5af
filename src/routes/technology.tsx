import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight, ShieldCheck, Layers, Flame, Thermometer } from "lucide-react";
import { PageLayout } from "@/components/PageLayout";
import { Container, Section } from "@/components/Container";
import { TechnologyComparison } from "@/components/TechnologyComparison";
import { EngineeringFeatures } from "@/components/EngineeringFeatures";
import { ContactForm } from "@/components/ContactForm";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/technology")({
  head: () => ({
    meta: [
      { title: "Технология ECO·CUB — монолитно-модульный дом vs кирпич, газобетон, монолит, ЖБИ | EcoCub" },
      {
        name: "description",
        content:
          "Сравнение технологий строительства: монолитно-модульные дома ECO·CUB против кирпича, газобетона, заливного монолита и ЖБИ-панелей. Скорость, цена, долговечность, теплоизоляция, гарантия.",
      },
      {
        name: "keywords",
        content: "технология строительства домов, бетонный модульный дом vs газобетон, альтернатива кирпичному дому, ЖБИ панели против модульного бетона, монолит на участке сравнение, hi-tech дом из бетона, энергоэффективный дом A+++, модульный дом конструктор, передовая инженерия дома",
      },
      { property: "og:title", content: "Технология ECO·CUB — сравнение с кирпичом, газобетоном, монолитом" },
      { property: "og:description", content: "Бетон М400, оцинкованная сталь, утеплитель ПСБ-С35. Гарантия 50 лет, срок службы более 120 лет." },
      { property: "og:image", content: "/images/tech-section.jpg" },
    ],
    scripts: [
      {
        type: "application/ld+json",
        children: JSON.stringify({
          "@context": "https://schema.org",
          "@type": "Article",
          headline: "Технология ECO·CUB — монолитно-модульный дом vs кирпич, газобетон, монолит, ЖБИ",
          author: { "@type": "Organization", name: "EcoCub" },
          image: "/images/tech-section.jpg",
        }),
      },
    ],
  }),
  component: TechnologyPage,
});

function TechnologyPage() {
  return (
    <PageLayout headerVariant="dark">
      {/* HERO */}
      <section className="relative bg-primary py-32 text-primary-foreground md:py-40">
        <div className="absolute inset-0 opacity-30">
          <img src="/images/tech-section.jpg" alt="" className="h-full w-full object-cover" />
        </div>
        <Container className="relative">
          <p className="text-xs font-medium uppercase tracking-[0.3em] text-accent">05 · Технология</p>
          <h1 className="mt-4 max-w-4xl text-4xl font-bold uppercase md:text-6xl">
            Технология ECO·CUB
          </h1>
          <p className="mt-6 max-w-2xl text-lg text-white/85">
            Капитальный монолитно-модульный дом из бетона за 90 дней. Заводское качество,
            гарантия 50 лет, срок службы более 120 лет.
          </p>
        </Container>
      </section>

      {/* MATERIALS */}
      <Section className="bg-background">
        <Container>
          <div className="grid items-center gap-12 lg:grid-cols-2">
            <div className="relative aspect-square overflow-hidden rounded-sm bg-secondary">
              <img src="/images/tech-section.jpg" alt="Послойный разрез монолитного модуля EcoCub" className="h-full w-full object-contain p-6" />
            </div>
            <div>
              <p className="text-xs font-medium uppercase tracking-[0.3em] text-accent">Из чего сделан модуль</p>
              <h2 className="mt-3 text-3xl font-bold uppercase md:text-4xl">Три слоя капитальности</h2>
              <div className="mt-8 space-y-6">
                <div className="flex gap-4">
                  <div className="flex size-12 shrink-0 items-center justify-center rounded-sm bg-accent/10">
                    <Layers className="size-6 text-accent" />
                  </div>
                  <div>
                    <h3 className="font-semibold">Бетон М400</h3>
                    <p className="mt-1 text-sm text-muted-foreground">Прочность на сжатие 400 кг/см² — в 12 раз больше, чем у газоблока. Не даёт усадки.</p>
                  </div>
                </div>
                <div className="flex gap-4">
                  <div className="flex size-12 shrink-0 items-center justify-center rounded-sm bg-accent/10">
                    <ShieldCheck className="size-6 text-accent" />
                  </div>
                  <div>
                    <h3 className="font-semibold">Оцинкованная стальная арматура</h3>
                    <p className="mt-1 text-sm text-muted-foreground">Несущий каркас, не подверженный коррозии. Срок службы — более 120 лет.</p>
                  </div>
                </div>
                <div className="flex gap-4">
                  <div className="flex size-12 shrink-0 items-center justify-center rounded-sm bg-accent/10">
                    <Thermometer className="size-6 text-accent" />
                  </div>
                  <div>
                    <h3 className="font-semibold">Утеплитель ПСБ-С35</h3>
                    <p className="mt-1 text-sm text-muted-foreground">Сопротивление теплопередаче 4,1 (м²·°C)/Вт — выше нормы СНиП для Москвы.</p>
                  </div>
                </div>
                <div className="flex gap-4">
                  <div className="flex size-12 shrink-0 items-center justify-center rounded-sm bg-accent/10">
                    <Flame className="size-6 text-accent" />
                  </div>
                  <div>
                    <h3 className="font-semibold">Класс пожаробезопасности К0</h3>
                    <p className="mt-1 text-sm text-muted-foreground">Полностью негорючие материалы. Безопасно для семьи с детьми.</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </Container>
      </Section>

      {/* COMPARISON TABLE */}
      <Section className="bg-secondary">
        <Container>
          <div className="mb-10 max-w-3xl">
            <p className="text-xs font-medium uppercase tracking-[0.3em] text-accent">Таблица сравнения</p>
            <h2 className="mt-3 text-3xl font-bold uppercase md:text-5xl">ECO·CUB vs другие технологии</h2>
            <p className="mt-4 text-muted-foreground">
              Сравниваем монолитно-модульную технологию с традиционными способами
              строительства капитального жилья.
            </p>
          </div>
          <TechnologyComparison />
        </Container>
      </Section>

      {/* WHY CHEAPER THAN PANEL */}
      <Section className="bg-background">
        <Container>
          <div className="mx-auto max-w-3xl">
            <p className="text-xs font-medium uppercase tracking-[0.3em] text-accent">Почему мы доступнее</p>
            <h2 className="mt-3 text-3xl font-bold uppercase md:text-4xl">
              Дешевле панельного дома, прочнее газобетона
            </h2>
            <div className="mt-8 space-y-6 text-base text-foreground/90">
              <p>
                Заводская сборка дома из железобетонных панелей — самая дорогая технология
                в Подмосковье: 130–180 тыс ₽ за м². Высокая цена объясняется огромным весом
                панелей, мощной техникой для монтажа и большим расходом стали.
              </p>
              <p>
                Модули ECO·CUB легче (бетон + утеплитель снаружи), монтируются обычным
                автокраном за 5 дней, а утепление снаружи устраняет мостики холода. Поэтому
                наша цена — <strong className="text-accent">от 105 000 ₽ за м²</strong> с
                фиксированной сметой и заводской гарантией.
              </p>
              <p>
                По сравнению с газобетоном вы получаете капитальный дом из настоящего бетона
                с прочностью в 12 раз выше, без усадки, с заводским контролем качества и
                гарантией 50 лет — за сопоставимую цену.
              </p>
            </div>
            <div className="mt-10">
              <Button asChild size="lg" className="bg-accent text-accent-foreground hover:bg-accent/90">
                <Link to="/portfolio">Посмотреть проекты <ArrowRight /></Link>
              </Button>
            </div>
          </div>
        </Container>
      </Section>

      {/* CTA */}
      <Section className="bg-primary text-primary-foreground">
        <Container>
          <div className="grid gap-12 lg:grid-cols-2">
            <div>
              <p className="text-xs font-medium uppercase tracking-[0.3em] text-accent">Обсудим ваш проект</p>
              <h2 className="mt-3 text-3xl font-bold uppercase md:text-5xl">Расскажем подробнее о технологии</h2>
              <p className="mt-6 max-w-md text-base text-white/70">
                Менеджер свяжется в течение часа, ответит на вопросы и пришлёт техническую
                документацию.
              </p>
            </div>
            <div className="rounded-sm bg-white/5 p-6 md:p-8">
              <ContactForm variant="dark" formType="contact" sourcePage="/technology" submitLabel="Получить документацию" />
            </div>
          </div>
        </Container>
      </Section>
    </PageLayout>
  );
}
