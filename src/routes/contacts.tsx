import { createFileRoute } from "@tanstack/react-router";
import { Phone, Mail, MapPin, MessageCircle } from "lucide-react";
import { PageLayout } from "@/components/PageLayout";
import { Container, Section } from "@/components/Container";
import { ContactForm } from "@/components/ContactForm";
import { site } from "@/lib/site";

export const Route = createFileRoute("/contacts")({
  head: () => ({
    meta: [
      { property: "og:url", content: "https://eco-cub.ru/contacts" },
      { title: "Контакты EcoCub — связаться с производителем домов" },
      {
        name: "description",
        content:
          "Телефон, email, мессенджеры EcoCub. Производство монолитно-модульных домов из бетона в Московской области.",
      },
      { property: "og:title", content: "Контакты EcoCub" },
      {
        property: "og:description",
        content: "Свяжитесь с EcoCub — производителем современных домов в Подмосковье.",
      },
    ],
    links: [{ rel: "canonical", href: "https://eco-cub.ru/contacts" }],
  }),
  component: ContactsPage,
});

function ContactsPage() {
  return (
    <PageLayout>
      <Section className="border-b border-border">
        <Container>
          <p className="text-xs font-medium uppercase tracking-[0.3em] text-accent">Контакты</p>
          <h1 className="mt-3 text-4xl font-bold uppercase md:text-6xl">Связаться с EcoCub</h1>
          <p className="mt-6 max-w-2xl text-base text-muted-foreground">
            Ответим на любой вопрос о проектах, технологиях и условиях. Расчёт стоимости — в течение
            часа.
          </p>
        </Container>
      </Section>

      <Section>
        <Container>
          <div className="grid gap-12 lg:grid-cols-2">
            <div>
              <ul className="space-y-6">
                <li className="flex gap-4">
                  <Phone className="mt-1 size-5 shrink-0 text-accent" />
                  <div>
                    <p className="text-xs uppercase tracking-wider text-muted-foreground">
                      Телефон
                    </p>
                    <a href={site.phoneHref} className="text-xl font-semibold hover:text-accent">
                      {site.phone}
                    </a>
                  </div>
                </li>
                <li className="flex gap-4">
                  <Mail className="mt-1 size-5 shrink-0 text-accent" />
                  <div>
                    <p className="text-xs uppercase tracking-wider text-muted-foreground">Email</p>
                    <a
                      href={`mailto:${site.email}`}
                      className="block text-base font-medium hover:text-accent"
                    >
                      {site.email}
                    </a>
                    <a
                      href={`mailto:${site.emailPartners}`}
                      className="block text-sm text-muted-foreground hover:text-accent"
                    >
                      {site.emailPartners} (партнёрам)
                    </a>
                  </div>
                </li>
                <li className="flex gap-4">
                  <MessageCircle className="mt-1 size-5 shrink-0 text-accent" />
                  <div>
                    <p className="text-xs uppercase tracking-wider text-muted-foreground">
                      Мессенджеры
                    </p>
                    <div className="mt-1 flex flex-wrap gap-3">
                      <a
                        href={site.whatsappHref}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="rounded-sm border border-border px-4 py-2 text-sm hover:border-accent hover:text-accent"
                      >
                        WhatsApp
                      </a>
                      <a
                        href={site.telegramHref}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="rounded-sm border border-border px-4 py-2 text-sm hover:border-accent hover:text-accent"
                      >
                        Telegram
                      </a>
                    </div>
                  </div>
                </li>
                <li className="flex gap-4">
                  <MapPin className="mt-1 size-5 shrink-0 text-accent" />
                  <div>
                    <p className="text-xs uppercase tracking-wider text-muted-foreground">
                      Регион работы
                    </p>
                    <p className="text-base">Москва и Московская область</p>
                  </div>
                </li>
              </ul>
            </div>

            <div className="rounded-sm border border-border bg-secondary p-6 md:p-8">
              <h2 className="text-xl font-bold uppercase">Оставить заявку</h2>
              <p className="mt-2 text-sm text-muted-foreground">
                Менеджер свяжется с вами в течение часа.
              </p>
              <div className="mt-6">
                <ContactForm formType="contact" sourcePage="/contacts" />
              </div>
            </div>
          </div>
        </Container>
      </Section>
    </PageLayout>
  );
}
