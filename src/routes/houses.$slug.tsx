import { Suspense, lazy, useEffect, useState } from "react";
import { Link, createFileRoute, notFound } from "@tanstack/react-router";
import { ArrowLeft, Boxes, Layers, Maximize2, PencilRuler, Ruler } from "lucide-react";
import { PageLayout } from "@/components/PageLayout";
import { Container, Section } from "@/components/Container";
import { ContactForm } from "@/components/ContactForm";
import { Button } from "@/components/ui/button";
import { Reveal } from "@/components/motion/Reveal";
import { fetchPublishedHouse, formatArea, formatBounds, formatPrice } from "@/lib/house-projects";
import { computeMetrics } from "@/lib/house-project/geometry";
import type { HouseProject } from "@/lib/house-project/types";
import { usePageEngagement } from "@/hooks/usePageEngagement";
import { analytics } from "@/lib/analytics";
import { site } from "@/lib/site";

const HouseView3D = lazy(() => import("@/components/design/HouseView3D"));

/**
 * Страница опубликованного дома.
 *
 * Показывает не картинку дома, а сам дом: та же модель, что лежит в базе,
 * разворачивается в 3D прямо здесь. Характеристики считаются из неё же, а не
 * переписываются в отдельные поля — расхождение между «в карточке 43,8» и
 * «в модели 4 модуля» стало бы невозможным.
 */
export const Route = createFileRoute("/houses/$slug")({
  loader: async ({ params }) => {
    const project = await fetchPublishedHouse({ data: params.slug });
    if (!project) throw notFound();
    return { project: project as HouseProject };
  },
  head: ({ loaderData }) => {
    const p = loaderData?.project;
    if (!p) return {};
    const metrics = computeMetrics(p.model);
    const cover = p.publication.coverImage;
    const abs = (u: string) => (u.startsWith("http") ? u : `https://eco-cub.ru${u}`);
    return {
      meta: [
        { property: "og:url", content: `https://eco-cub.ru/houses/${p.slug}` },
        { title: `${p.title} — проект модульного дома EcoCub` },
        {
          name: "description",
          content:
            p.description ??
            `Проект ${p.title}: ${metrics.moduleCount} модулей, ${formatArea(metrics.livingAreaM2)}, ${metrics.floors} эт.`,
        },
        { property: "og:title", content: `${p.title} — EcoCub` },
        { property: "og:description", content: p.description ?? "" },
        ...(cover
          ? [
              { property: "og:image", content: abs(cover) },
              { name: "twitter:image", content: abs(cover) },
            ]
          : []),
      ],
      links: [{ rel: "canonical", href: `https://eco-cub.ru/houses/${p.slug}` }],
      scripts: [
        {
          type: "application/ld+json",
          children: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "Product",
            name: p.title,
            description: p.description ?? undefined,
            ...(cover ? { image: abs(cover) } : {}),
            brand: { "@type": "Brand", name: "EcoCub" },
            ...(p.publication.priceFrom
              ? {
                  offers: {
                    "@type": "Offer",
                    price: p.publication.priceFrom,
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
        <h1 className="text-3xl font-bold">Дом не найден</h1>
        <p className="mt-3 text-muted-foreground">
          Возможно, проект снят с публикации. В каталоге есть другие.
        </p>
        <Button asChild className="mt-6">
          <Link to="/houses">В каталог домов</Link>
        </Button>
      </Container>
    </PageLayout>
  ),
  component: HousePage,
});

function HousePage() {
  const { project } = Route.useLoaderData();
  const metrics = computeMetrics(project.model);
  const price = formatPrice(project.publication.priceFrom);

  usePageEngagement(`house:${project.slug}`);
  useEffect(() => {
    analytics.projectView(project.slug);
  }, [project.slug]);

  // 3D монтируется только на клиенте и только когда до него дошли: сцена
  // тянет отдельный чанк, и грузить его ради первого экрана незачем.
  const [show3d, setShow3d] = useState(false);
  useEffect(() => setShow3d(true), []);

  const specs = [
    { icon: Maximize2, label: "Жилая площадь", value: formatArea(metrics.livingAreaM2) },
    { icon: Boxes, label: "Модулей", value: String(metrics.moduleCount) },
    { icon: Layers, label: "Этажей", value: String(metrics.floors) },
    {
      icon: Ruler,
      label: "Габарит",
      value: formatBounds(metrics.boundsMm.widthMm, metrics.boundsMm.depthMm),
    },
  ];

  return (
    <PageLayout>
      <Section className="pb-6">
        <Container>
          <Link
            to="/houses"
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-accent"
          >
            <ArrowLeft className="size-4" /> Каталог домов
          </Link>

          <Reveal>
            <h1 className="mt-4 text-3xl font-bold uppercase tracking-tight md:text-5xl">
              {project.title}
            </h1>
            {project.description && (
              <p className="mt-4 max-w-2xl text-base text-muted-foreground">
                {project.description}
              </p>
            )}
          </Reveal>

          <div className="mt-8 grid gap-6 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
            <div className="h-[46vh] min-h-[320px] overflow-hidden rounded-sm border border-border bg-muted">
              {show3d ? (
                <Suspense
                  fallback={
                    <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                      Загрузка модели…
                    </div>
                  }
                >
                  <HouseView3D model={project.model} autoRotate />
                </Suspense>
              ) : project.publication.coverImage ? (
                <img
                  src={project.publication.coverImage}
                  alt={project.title}
                  className="h-full w-full object-cover"
                />
              ) : null}
            </div>

            <div className="space-y-6">
              <dl className="grid grid-cols-2 gap-4">
                {specs.map(({ icon: Icon, label, value }) => (
                  <div key={label} className="rounded-sm border border-border p-4">
                    <dt className="flex items-center gap-1.5 text-xs uppercase tracking-wide text-muted-foreground">
                      <Icon className="size-3.5" /> {label}
                    </dt>
                    <dd className="mt-1 text-lg font-semibold">{value}</dd>
                  </div>
                ))}
              </dl>

              <div className="rounded-sm border border-border p-4 text-sm">
                <p className="text-muted-foreground">
                  Высота помещений 3,15 м. Площадь застройки {formatArea(metrics.footprintAreaM2)},
                  высота дома {(metrics.heightMm / 1000).toFixed(2).replace(".", ",")} м от чистого
                  пола до верха плиты кровли.
                </p>
                {project.publication.marketingAreaM2 != null && (
                  <p className="mt-2 text-muted-foreground">
                    В рекламных материалах этот дом подаётся как{" "}
                    {project.publication.marketingAreaM2} м² — там в площадь входят террасы и
                    крыльцо. Расчётная жилая площадь по тёплому контуру —{" "}
                    {formatArea(metrics.livingAreaM2)}.
                  </p>
                )}
              </div>

              {price && (
                <p className="text-2xl font-semibold">
                  от {price}
                  <span className="ml-2 align-middle text-xs font-normal text-muted-foreground">
                    ориентир, точная смета — по участку
                  </span>
                </p>
              )}

              <div className="flex flex-wrap gap-2">
                <Button asChild size="lg">
                  <a href="#request">Обсудить этот дом</a>
                </Button>
                <Button asChild variant="outline" size="lg">
                  <Link to="/constructor" search={{ house: project.slug }}>
                    <PencilRuler className="size-4" /> Открыть в конструкторе
                  </Link>
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                В конструкторе откроется независимая копия этой конфигурации — меняйте её как
                угодно, опубликованный проект от этого не изменится. Конструктор работает с
                упрощённым кубиком 3 × 3 м, поэтому площадь в нём будет отличаться от расчётной.
              </p>
            </div>
          </div>

          {project.publication.highlights.length > 0 && (
            <div className="mt-10">
              <h2 className="text-xs font-medium uppercase tracking-[0.3em] text-accent">
                Особенности
              </h2>
              <ul className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {project.publication.highlights.map((h) => (
                  <li key={h} className="flex gap-2 text-sm">
                    <span className="mt-[7px] size-1 shrink-0 rounded-full bg-accent" />
                    {h}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {project.source.referenceHouseName && (
            <p className="mt-8 max-w-2xl text-xs leading-relaxed text-muted-foreground">
              Модель собрана по проектной документации дома «{project.source.referenceHouseName}».
              Размеры, не подтверждённые чертежами, уточняются конструктором на стадии рабочего
              проекта.
            </p>
          )}
        </Container>
      </Section>

      <Section id="request" className="bg-primary text-primary-foreground">
        <Container>
          <div className="grid gap-12 lg:grid-cols-2">
            <div>
              <p className="text-xs font-medium uppercase tracking-[0.3em] text-accent">
                Заявка по проекту
              </p>
              <h2 className="mt-3 text-3xl font-bold uppercase md:text-5xl">{project.title}</h2>
              <p className="mt-6 max-w-md text-base text-white/70">
                Пришлём планировки, смету с фиксированной ценой и сроки под ваш участок. Менеджер
                свяжется в течение часа.
              </p>
              <div className="mt-8 space-y-2 text-sm text-white/80">
                <a href={site.phoneHref} className="block text-2xl font-semibold text-white">
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
                formType="project"
                sourcePage={`/houses/${project.slug}`}
                projectSlug={project.slug}
                submitLabel="Получить расчёт"
              />
            </div>
          </div>
        </Container>
      </Section>
    </PageLayout>
  );
}
