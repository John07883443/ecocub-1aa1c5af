import { createFileRoute } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { PageLayout } from "@/components/PageLayout";
import { Container, Section } from "@/components/Container";
import { ProjectCard, type ProjectCardData } from "@/components/ProjectCard";
import { Reveal } from "@/components/motion/Reveal";
import { usePageEngagement } from "@/hooks/usePageEngagement";

export const Route = createFileRoute("/portfolio")({
  head: () => ({
    meta: [
      { property: "og:url", content: "https://eco-cub.ru/portfolio" },
      { title: "Портфолио проектов EcoCub — модульные бетонные дома под ключ" },
      {
        name: "description",
        content:
          "Готовые проекты бетонных домов EcoCub: модули Weekend, Family и SkyRiver. Площади, цены, планировки.",
      },
      {
        property: "og:title",
        content: "Портфолио EcoCub — все проекты домов",
      },
      {
        property: "og:description",
        content: "Каталог проектов монолитно-модульных домов из бетона EcoCub. От 36 до 165 м².",
      },
    ],
    links: [{ rel: "canonical", href: "https://eco-cub.ru/portfolio" }],
  }),
  loader: async () => {
    const { data, error } = await supabase
      .from("projects")
      .select("slug,name,series,tagline,area_m2,bedrooms,price_from,cover_image")
      .eq("published", true)
      .order("display_order", { ascending: true });
    if (error) throw error;
    return { projects: (data ?? []) as ProjectCardData[] };
  },
  errorComponent: ({ error }: { error: Error }) => (
    <PageLayout>
      <Container className="py-32 text-center text-destructive">Ошибка: {error.message}</Container>
    </PageLayout>
  ),
  notFoundComponent: () => (
    <PageLayout>
      <Container className="py-32 text-center">Не найдено</Container>
    </PageLayout>
  ),
  component: PortfolioPage,
});

function PortfolioPage() {
  usePageEngagement("portfolio");
  const { projects } = Route.useLoaderData();

  return (
    <PageLayout>
      <Section className="border-b border-border">
        <Container>
          <Reveal>
            <p className="text-xs font-medium uppercase tracking-[0.3em] text-accent">Каталог</p>
            <h1 className="mt-3 text-4xl font-bold uppercase md:text-6xl">Портфолио проектов</h1>
            <p className="mt-6 max-w-2xl text-base text-muted-foreground">
              Готовые проекты EcoCub — от компактного Weekend One на 36 м² до флагманского SkyRiver
              на 165 м². Все дома можно адаптировать под ваш участок и пожелания.
            </p>
          </Reveal>
        </Container>
      </Section>

      <Section>
        <Container>
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {projects.map((p: ProjectCardData, i: number) => (
              <Reveal key={p.slug} variant="up" delay={(i % 3) * 90} className="h-full">
                <ProjectCard project={p} />
              </Reveal>
            ))}
          </div>
        </Container>
      </Section>
    </PageLayout>
  );
}
