import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { PageLayout } from "@/components/PageLayout";
import { Container, Section } from "@/components/Container";
import { BlogCard } from "@/components/BlogCard";
import { usePageEngagement } from "@/hooks/usePageEngagement";
import { getPostsByTag, getTagBySlug } from "@/lib/blog";

const SITE_URL = "https://eco-cub.ru";

export const Route = createFileRoute("/blog/tag/$tag")({
  loader: ({ params }) => {
    const tag = getTagBySlug(params.tag);
    if (!tag) throw notFound();
    const posts = getPostsByTag(tag);
    if (posts.length === 0) throw notFound();
    return { tag, tagSlug: params.tag, posts };
  },

  head: ({ loaderData }) => {
    if (!loaderData) return { meta: [{ title: "Тег — Блог EcoCub" }] };
    const { tag, tagSlug, posts } = loaderData;
    const url = `${SITE_URL}/blog/tag/${tagSlug}`;
    const description = `Статьи блога EcoCub по теме «${tag}» — ${posts.length} материалов о монолитно-модульных домах из бетона.`;

    return {
      meta: [
        { title: `${tag} — статьи блога EcoCub` },
        { name: "description", content: description },
        { property: "og:url", content: url },
        { property: "og:type", content: "website" },
        { property: "og:title", content: `${tag} — статьи блога EcoCub` },
        { property: "og:description", content: description },
      ],
      links: [{ rel: "canonical", href: url }],
      scripts: [
        {
          type: "application/ld+json",
          children: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "CollectionPage",
            name: `${tag} — статьи блога EcoCub`,
            description,
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
      ],
    };
  },

  notFoundComponent: () => (
    <PageLayout>
      <Container className="py-32 text-center">
        <h1 className="text-3xl font-bold">Тег не найден</h1>
        <Link to="/blog" className="mt-4 inline-block text-accent hover:underline">
          ← Все статьи
        </Link>
      </Container>
    </PageLayout>
  ),

  component: TagPage,
});

function TagPage() {
  const { tag, posts } = Route.useLoaderData();
  usePageEngagement(`blog:tag:${tag}`);

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
            <p className="text-xs font-medium uppercase tracking-[0.3em] text-accent">Тема</p>
            <h1 className="mt-3 text-4xl font-bold uppercase md:text-5xl">{tag}</h1>
            <p className="mt-4 text-sm text-muted-foreground">
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
