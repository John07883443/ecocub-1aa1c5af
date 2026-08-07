import { createFileRoute } from "@tanstack/react-router";
import { Download } from "lucide-react";
import { PageLayout } from "@/components/PageLayout";
import { Container, Section } from "@/components/Container";
import { ContactForm } from "@/components/ContactForm";
import { usePageEngagement } from "@/hooks/usePageEngagement";

export const Route = createFileRoute("/presentation")({
  head: () => ({
    meta: [
      { property: "og:url", content: "https://eco-cub.ru/presentation" },
      { title: "Скачать презентацию EcoCub — каталог проектов и цены" },
      {
        name: "description",
        content:
          "Получите PDF-презентацию EcoCub: все серии домов, проекты, технологии, ценообразование. Оставьте контакты — пришлём на email.",
      },
      { property: "og:title", content: "Презентация EcoCub" },
      {
        property: "og:description",
        content: "Полный каталог проектов, технологий и цен EcoCub в одном PDF.",
      },
    ],
    links: [{ rel: "canonical", href: "https://eco-cub.ru/presentation" }],
  }),
  component: PresentationPage,
});

function PresentationPage() {
  usePageEngagement("presentation");
  return (
    <PageLayout>
      <Section className="border-b border-border">
        <Container>
          <p className="text-xs font-medium uppercase tracking-[0.3em] text-accent">
            PDF · Каталог
          </p>
          <h1 className="mt-3 text-4xl font-bold uppercase md:text-6xl">Презентация EcoCub</h1>
          <p className="mt-6 max-w-2xl text-base text-muted-foreground">
            Подробный PDF с проектами, технологиями, материалами и ценообразованием. Пришлём на ваш
            email сразу после заявки.
          </p>
        </Container>
      </Section>

      <Section>
        <Container>
          <div className="mx-auto max-w-2xl rounded-sm border border-border bg-secondary p-6 md:p-10">
            <Download className="size-10 text-accent" />
            <h2 className="mt-4 text-2xl font-bold uppercase md:text-3xl">Получить презентацию</h2>
            <p className="mt-3 text-sm text-muted-foreground">
              Заполните форму — отправим презентацию на email и WhatsApp в течение нескольких минут.
            </p>
            <div className="mt-6">
              <ContactForm
                formType="presentation"
                sourcePage="/presentation"
                submitLabel="Получить презентацию"
                showMessage={false}
              />
            </div>
          </div>
        </Container>
      </Section>
    </PageLayout>
  );
}
