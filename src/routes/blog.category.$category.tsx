import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { PageLayout } from "@/components/PageLayout";
import { Container, Section } from "@/components/Container";
import { BlogCard } from "@/components/BlogCard";
import { usePageEngagement } from "@/hooks/usePageEngagement";
import { BLOG_CATEGORIES, getPostsByCategory, type BlogCategory } from "@/lib/blog";

const SITE_URL = "https://eco-cub.ru";

const descriptions: Record<BlogCategory, string> = {
  tech: "Как устроена монолитно-модульная технология: бетон, теплотехника, инженерия, заводская готовность.",
  comparison:
    "Честные сравнения с каркасом, газобетоном, кирпичом и железобетонной панелью — по цене, срокам и теплу.",
  cases: "Реализованные дома EcoCub: что заказывали, что получилось, сколько стоило и сколько заняло.",
  news: "Что происходит в компании и на рынке индивидуального жилищного строительства.",
};

export const Route = createFileRoute("/blog/category/$category")({
  loader: ({ params }) => {
    const key = params.category as BlogCategory;
    if (!(key in BLOG_CATEGORIES)) throw notFound();
    const posts = getPostsByCategory(key);
    if (posts.length === 0) throw notFound();
    return { category: key, posts };
  },

  head: ({ loaderData }) => {
    if (!loaderData) return { meta: [{ title: "Категория — Блог EcoCub" }] };
    const { category, posts } = loaderData;
    const label = BLOG_CATEGORIES[category];
    const url = `${SITE_URL}/blog/category/${category}`;

    return {
      meta: [
        { title: `${label} — блог EcoCub` },
        { name: "description", content: descriptions[category] },
        { property: "og:url", content: url },
        { property: "og:type", content: "website" },
        { property: "og:title", content: `${label} — блог EcoCub` },
        { property: "og:description", content: descriptions[category] },
      ],
      links: [{ rel: "canonical", href: url }],
      scripts: [
        {
          type: "application/ld+json",
          children: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "CollectionPage",
            name: `${label} — блог EcoCub`,
            description: descriptions[category],
            url,
            inLanguage: "ru-RU",
            mainEntity: {
              "@type": "ItemList",
              numberOfItems: posts.length,
              itemListElement: posts.map((p, i) => ({
                "@type": "ListItem",
                position: i + 1,
                url: `${SITE_URL}/blog/${p.slug}`,
                name: p.title,
              })),
            },
          }),
        },
        {
          type: "application/ld+json",
          children: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "BreadcrumbList",
            itemListElement: [
              { "@type": "ListItem", position: 1, name: "Главная", item: SITE_URL },
              { "@type": "ListItem", position: 2, name: "Блог", item: `${SITE_URL}/blog` },
              { "@type": "ListItem", position: 3, name: label, item: url },
            ],
          }),
        },
      ],
    };
  },

  notFoundComponent: () => (
    <PageLayout>
      <Container className="py-32 text-center">
        <h1 className="text-3xl font-bold">Категория не найдена</h1>
        <Link to="/blog" className="mt-4 inline-block text-accent hover:underline">
          ← Все статьи
        </Link>
      </Container>
    </PageLayout>
  ),

  component: CategoryPage,
});

function CategoryPage() {
  const { category, posts } = Route.useLoaderData();
  usePageEngagement(`blog:category:${category}`);

  return (
    <PageLayout>
      <Section className="bg-background">
        <Container>
          <Link
            to="/blog"
            className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-accent"
          >
            <ArrowLeft className="size-4" /> Все статьи
          </Link>

          <div className="mt-8 mb-12 max-w-3xl">
            <p className="text-xs font-medium uppercase tracking-[0.3em] text-accent">Категория</p>
            <h1 className="mt-3 text-4xl font-bold uppercase md:text-5xl">
              {BLOG_CATEGORIES[category]}
            </h1>
            <p className="mt-4 text-muted-foreground">{descriptions[category]}</p>
            <p className="mt-2 text-sm text-muted-foreground">
              {posts.length}{" "}
              {posts.length === 1 ? "статья" : posts.length < 5 ? "статьи" : "статей"}
            </p>
          </div>

          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {posts.map((p) => (
              <BlogCard key={p.slug} post={p} />
            ))}
          </div>
        </Container>
      </Section>
    </PageLayout>
  );
}
