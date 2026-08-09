import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { ArrowLeft, BedDouble, Bath, Layers, Maximize2 } from "lucide-react";
import { fetchProjects, findBySlug } from "@/lib/projects";
import { PageLayout } from "@/components/PageLayout";
import { Container, Section } from "@/components/Container";
import { ContactForm } from "@/components/ContactForm";
import { Button } from "@/components/ui/button";
import { Reveal } from "@/components/motion/Reveal";
import { Parallax } from "@/components/motion/Parallax";
import { usePageEngagement } from "@/hooks/usePageEngagement";
import { analytics } from "@/lib/analytics";
import { useEffect } from "react";

const seriesLabel: Record<string, string> = {
  concrete: "Бетонный модуль",
  villa: "Вилла Hi-Tech",
};

const absUrl = (u: string) => (u.startsWith("http") ? u : `https://eco-cub.ru${u}`);

export const Route = createFileRoute("/projects/$slug")({
  loader: async ({ params }) => {
    const project = findBySlug(await fetchProjects(), params.slug);
    if (!project) throw notFound();
    return { project };
  },
  head: ({ loaderData }) => {
    const p = loaderData?.project;
    if (!p) return {};
    return {
      meta: [
        { property: "og:url", content: `https://eco-cub.ru/projects/${p.slug}` },
        {
          title: `${p.name} — ${seriesLabel[p.series] ?? "Проект"} EcoCub`,
        },
        {
          name: "description",
          content:
            p.tagline ??
            `Проект ${p.name}: площадь ${p.area_m2} м², ${p.bedrooms} спальни. EcoCub.`,
        },
        {
          property: "og:title",
          content: `${p.name} — EcoCub`,
        },
        {
          property: "og:description",
          content: p.tagline ?? p.description ?? "",
        },
        { property: "og:image", content: absUrl(p.cover_image) },
        { name: "twitter:image", content: absUrl(p.cover_image) },
      ],
      links: [{ rel: "canonical", href: `https://eco-cub.ru/projects/${p.slug}` }],
      scripts: [
        {
          type: "application/ld+json",
          children: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "Product",
            name: p.name,
            description: p.tagline ?? p.description ?? undefined,
            image: absUrl(p.cover_image),
            brand: { "@type": "Brand", name: "EcoCub" },
            ...(p.price_from
              ? {
                  offers: {
                    "@type": "Offer",
                    price: p.price_from,
                    priceCurrency: "RUB",
                    availability: "https://schema.org/InStock",
                  },
                }
              : {}),
          }),
        },
      ],
    };
  },
  errorComponent: ({ error }: { error: Error }) => (
    <PageLayout>
      <Container className="py-32 text-center text-destructive">Ошибка: {error.message}</Container>
    </PageLayout>
  ),
  notFoundComponent: () => (
    <PageLayout>
      <Container className="py-32 text-center">
        <h1 className="text-3xl font-bold">Проект не найден</h1>
        <Button asChild className="mt-6">
          <Link to="/portfolio">К списку проектов</Link>
        </Button>
      </Container>
    </PageLayout>
  ),
  component: ProjectPage,
});

function ProjectPage() {
  const { project } = Route.useLoaderData();
  usePageEngagement(`project:${project.slug}`);
  useEffect(() => {
    analytics.projectView(project.slug);
  }, [project.slug]);
  const specs = [
    project.area_m2 != null && {
      icon: Maximize2,
      label: "Площадь",
      value: `${project.area_m2} м²`,
    },
    project.bedrooms != null && {
      icon: BedDouble,
      label: "Спальни",
      value: project.bedrooms,
    },
    project.bathrooms != null && {
      icon: Bath,
      label: "Санузлы",
      value: project.bathrooms,
    },
    project.floors != null && {
      icon: Layers,
      label: "Этажей",
      value: project.floors,
    },
  ].filter(Boolean) as { icon: typeof Maximize2; label: string; value: React.ReactNode }[];

  return (
    <PageLayout headerVariant="dark">
      {/* HERO */}
      <section className="relative min-h-[80svh] w-full overflow-hidden bg-primary text-primary-foreground">
        <div className="absolute inset-0 opacity-70">
          <Parallax speed={0.1} max={50} className="h-[120%] w-full">
            <img
              src={project.cover_image}
              alt={project.name}
              className="hero-kenburns h-full w-full object-cover"
            />
          </Parallax>
        </div>
        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/30 to-black/40" />
        <Container className="relative flex min-h-[80svh] flex-col justify-end pb-16 pt-32">
          <Reveal variant="up">
            <Link
              to="/portfolio"
              className="mb-6 inline-flex w-fit items-center gap-2 text-xs font-medium uppercase tracking-[0.2em] text-white/80 transition-colors hover:text-accent"
            >
              <ArrowLeft className="size-4" />
              Все проекты
            </Link>
            <p className="text-xs font-medium uppercase tracking-[0.3em] text-accent">
              {seriesLabel[project.series] ?? project.series}
            </p>
            <h1 className="mt-3 text-4xl font-bold uppercase md:text-6xl">{project.name}</h1>
            {project.tagline && (
              <p className="mt-4 max-w-2xl text-lg text-white/85">{project.tagline}</p>
            )}
            {project.price_from != null && (
              <p className="mt-8 text-sm text-white/60">
                Стоимость от{" "}
                <span className="text-2xl font-semibold text-white">
                  {new Intl.NumberFormat("ru-RU").format(project.price_from)} ₽
                </span>
              </p>
            )}
          </Reveal>
        </Container>
      </section>

      {/* SPECS + DESCRIPTION */}
      <Section>
        <Container>
          <div className="grid gap-12 lg:grid-cols-3">
            <Reveal variant="left" className="lg:col-span-2">
              <h2 className="text-2xl font-bold uppercase md:text-3xl">О проекте</h2>
              {project.description && (
                <p className="mt-6 whitespace-pre-line text-base leading-relaxed text-muted-foreground">
                  {project.description}
                </p>
              )}

              {project.features.length > 0 && (
                <>
                  <h3 className="mt-12 text-lg font-semibold uppercase">Особенности</h3>
                  <ul className="mt-4 grid gap-2 sm:grid-cols-2">
                    {project.features.map((f: string) => (
                      <li key={f} className="flex items-start gap-2 text-sm text-foreground/80">
                        <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-accent" />
                        {f}
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </Reveal>

            <Reveal
              variant="right"
              delay={120}
              className="rounded-sm border border-border bg-secondary p-6"
            >
              <h3 className="text-sm font-semibold uppercase tracking-wider text-accent">
                Характеристики
              </h3>
              <dl className="mt-5 space-y-4">
                {specs.map((s) => (
                  <div
                    key={s.label}
                    className="flex items-center justify-between border-b border-border/60 pb-3"
                  >
                    <dt className="flex items-center gap-2 text-sm text-muted-foreground">
                      <s.icon className="size-4" />
                      {s.label}
                    </dt>
                    <dd className="font-semibold">{s.value}</dd>
                  </div>
                ))}
              </dl>
            </Reveal>
          </div>
        </Container>
      </Section>

      {/* GALLERY */}
      {project.gallery.length > 1 && (
        <Section className="border-t border-border bg-secondary">
          <Container>
            <Reveal>
              <h2 className="mb-8 text-2xl font-bold uppercase md:text-3xl">Галерея</h2>
            </Reveal>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {project.gallery.map((src: string, i: number) => (
                <Reveal
                  key={src}
                  variant="scale"
                  delay={(i % 3) * 90}
                  className="group aspect-[4/3] overflow-hidden rounded-sm bg-muted"
                >
                  <img
                    src={src}
                    alt={project.name}
                    loading="lazy"
                    className="h-full w-full object-cover transition-transform duration-[1100ms] ease-[cubic-bezier(0.16,1,0.3,1)] group-hover:scale-110"
                  />
                </Reveal>
              ))}
            </div>
          </Container>
        </Section>
      )}

      {/* CONTACT */}
      <Section className="relative overflow-hidden bg-primary text-primary-foreground">
        <span
          aria-hidden="true"
          className="ecocub-glow bottom-[-20%] left-[-8%] h-[45vw] max-h-[500px] w-[45vw] max-w-[500px]"
        />
        <Container className="relative">
          <Reveal variant="scale" className="mx-auto max-w-2xl">
            <h2 className="text-3xl font-bold uppercase md:text-4xl">
              Заказать проект {project.name}
            </h2>
            <p className="mt-4 text-white/70">
              Оставьте контакты — пришлём планировки, смету и сроки.
            </p>
            <div className="mt-8">
              <ContactForm
                variant="dark"
                formType="project"
                projectSlug={project.slug}
                submitLabel="Заказать проект"
              />
            </div>
          </Reveal>
        </Container>
      </Section>
    </PageLayout>
  );
}
