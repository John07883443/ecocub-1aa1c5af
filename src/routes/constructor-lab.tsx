import { createFileRoute } from "@tanstack/react-router";
import { ArrowUpRight, FlaskConical } from "lucide-react";
import { PageLayout } from "@/components/PageLayout";
import { Container, Section } from "@/components/Container";
import { CONSTRUCTOR_VERSIONS } from "@/lib/v3/versions";
import type { ConstructorVersion } from "@/lib/v3/types";

/**
 * /constructor-lab — скрытая техническая витрина всех версий конструктора.
 *
 * Открывается только по прямой ссылке: нет в меню, нет в sitemap,
 * noindex/nofollow. Никаких секретов и служебных данных — только названия,
 * статусы и ссылки. Новая версия добавляется одной записью в
 * src/lib/v3/versions.ts.
 */

const STATUS_META: Record<ConstructorVersion["status"], { label: string; className: string }> = {
  current: { label: "Текущая", className: "bg-emerald-500/10 text-emerald-700" },
  experiment: { label: "Эксперимент", className: "bg-amber-500/10 text-amber-700" },
  archive: { label: "Архивная", className: "bg-muted text-muted-foreground" },
  development: { label: "В разработке", className: "bg-sky-500/10 text-sky-700" },
};

export const Route = createFileRoute("/constructor-lab")({
  head: () => ({
    meta: [
      { name: "robots", content: "noindex, nofollow" },
      { title: "Лаборатория версий конструктора | EcoCub" },
    ],
  }),
  component: ConstructorLabPage,
});

function ConstructorLabPage() {
  return (
    <PageLayout>
      <Section className="bg-background">
        <Container>
          <div className="mb-10 max-w-3xl">
            <p className="flex items-center gap-2 text-xs font-medium uppercase tracking-[0.3em] text-accent">
              <FlaskConical className="size-4" /> Внутренняя страница
            </p>
            <h1 className="mt-3 text-3xl font-bold uppercase tracking-tight md:text-4xl">
              Лаборатория версий конструктора
            </h1>
            <p className="mt-4 text-sm text-muted-foreground">
              Все реализации квизов и конструкторов EcoCub — для сравнения и тестирования. Страница
              не индексируется и не связана с основным меню сайта.
            </p>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            {CONSTRUCTOR_VERSIONS.map((v, i) => {
              const status = STATUS_META[v.status];
              return (
                <div key={v.id} className="flex flex-col rounded-sm border border-border p-5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-medium text-muted-foreground">
                      № {i + 1} · {v.id}
                    </span>
                    <span
                      className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${status.className}`}
                    >
                      {status.label}
                    </span>
                  </div>
                  <h2 className="mt-2 text-lg font-bold tracking-tight">{v.title}</h2>
                  <p className="mt-1 flex-1 text-sm text-muted-foreground">{v.description}</p>
                  <div className="mt-4 flex items-center justify-between">
                    <code className="text-xs text-muted-foreground">{v.route}</code>
                    <a
                      href={v.route}
                      className="inline-flex items-center gap-1 text-sm font-semibold text-accent hover:underline"
                    >
                      Открыть <ArrowUpRight className="size-4" />
                    </a>
                  </div>
                  {v.createdAt && (
                    <p className="mt-2 text-[11px] text-muted-foreground/70">
                      добавлена {v.createdAt}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        </Container>
      </Section>
    </PageLayout>
  );
}
