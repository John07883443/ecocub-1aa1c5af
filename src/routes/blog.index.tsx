import { createFileRoute, Link } from "@tanstack/react-router";
import { PageLayout } from "@/components/PageLayout";
import { Container, Section } from "@/components/Container";
import { BlogCard } from "@/components/BlogCard";
import { usePageEngagement } from "@/hooks/usePageEngagement";
import { getAllPosts, getCategories, getTags } from "@/lib/blog";

const SITE_URL = "https://eco-cub.ru";

export const Route = createFileRoute("/blog/")({
  head: () => {
    const posts = getAllPosts();
    return {
      meta: [
        { title: "Блог EcoCub — статьи о монолитно-модульных домах из бетона" },
        {
          name: "description",
          content:
            "Технология ECO·CUB, сравнения с кирпичом, газобетоном и панелью, разбор смет и кейсы реализованных проектов. Статьи для тех, кто выбирает капитальный дом.",
        },
        { property: "og:url", content: `${SITE_URL}/blog` },
        { property: "og:type", content: "website" },
        { property: "og:title", content: "Блог EcoCub — статьи о капитальных домах из бетона" },
        {
          property: "og:description",
          content: "Сравнения технологий, честный разбор цен, реальные кейсы.",
        },
      ],
      links: [
        { rel: "canonical", href: `${SITE_URL}/blog` },
        {
          rel: "alternate",
          type: "application/rss+xml",
          title: "Блог EcoCub",
          href: `${SITE_URL}/rss.xml`,
        },
      ],
      scripts: [
        {
          type: "application/ld+json",
          children: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "Blog",
            name: "Блог EcoCub",
            url: `${SITE_URL}/blog`,
            description:
              "Статьи о монолитно-модульных домах из бетона: технология, сравнения, цены, кейсы.",
            publisher: { "@type": "Organization", name: "EcoCub", url: SITE_URL },
            blogPost: posts.slice(0, 20).map((p) => ({
              "@type": "BlogPosting",
              headline: p.title,
              url: `${SITE_URL}/blog/${p.slug}`,
              datePublished: p.date,
            })),
          }),
        },
      ],
    };
  },
  component: BlogPage,
});

function BlogPage() {
  usePageEngagement("blog");
  const posts = getAllPosts();
  const categories = getCategories();
  const tags = getTags();

  return (
    <PageLayout>
      <Section className="bg-background">
        <Container>
          <div className="mb-10 max-w-3xl">
            <p className="text-xs font-medium uppercase tracking-[0.3em] text-accent">Блог</p>
            <h1 className="mt-3 text-4xl font-bold uppercase md:text-6xl">
              Статьи о бетонных домах
            </h1>
            <p className="mt-4 text-muted-foreground">
              Технологии, сравнения, цены, кейсы. Помогаем разобраться в нюансах капитального
              строительства из бетона.
            </p>
          </div>

          {categories.length > 0 && (
            <nav aria-label="Категории" className="mb-6 flex flex-wrap gap-2">
              <span className="rounded-sm border border-accent bg-accent/10 px-3 py-1.5 text-xs font-medium uppercase tracking-wider text-accent">
                Все · {posts.length}
              </span>
              {categories.map((c) => (
                <Link
                  key={c.key}
                  to="/blog/category/$category"
                  params={{ category: c.key }}
                  className="rounded-sm border border-border px-3 py-1.5 text-xs font-medium uppercase tracking-wider text-muted-foreground transition-colors hover:border-accent hover:text-accent"
                >
                  {c.label} · {c.count}
                </Link>
              ))}
            </nav>
          )}

          {tags.length > 0 && (
            <nav aria-label="Теги" className="mb-12 flex flex-wrap gap-2">
              {tags.map((t) => (
                <Link
                  key={t.slug}
                  to="/blog/tag/$tag"
                  params={{ tag: t.slug }}
                  className="rounded-sm bg-secondary px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:text-accent"
                >
                  #{t.tag}
                </Link>
              ))}
            </nav>
          )}

          {posts.length === 0 ? (
            <p className="text-muted-foreground">Статьи скоро появятся.</p>
          ) : (
            <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {posts.map((p) => (
                <BlogCard key={p.slug} post={p} />
              ))}
            </div>
          )}
        </Container>
      </Section>
    </PageLayout>
  );
}
