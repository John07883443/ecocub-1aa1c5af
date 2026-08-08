import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";
import { ArrowLeft, Clock } from "lucide-react";
import { PageLayout } from "@/components/PageLayout";
import { Container, Section } from "@/components/Container";
import { ContactForm } from "@/components/ContactForm";
import { BlogCard } from "@/components/BlogCard";
import { Button } from "@/components/ui/button";
import { Reveal } from "@/components/motion/Reveal";
import { usePageEngagement } from "@/hooks/usePageEngagement";
import { analytics } from "@/lib/analytics";
import { useEffect } from "react";
import { BLOG_CATEGORIES, formatDate, getPostBySlug, getRelatedPosts, tagToSlug } from "@/lib/blog";

const SITE_URL = "https://eco-cub.ru";

export const Route = createFileRoute("/blog/$slug")({
  loader: ({ params }) => {
    const post = getPostBySlug(params.slug);
    if (!post) throw notFound();
    return { post, related: getRelatedPosts(post) };
  },

  head: ({ loaderData }) => {
    if (!loaderData) return { meta: [{ title: "Статья — EcoCub" }] };
    const { post } = loaderData;
    const url = `${SITE_URL}/blog/${post.slug}`;

    return {
      meta: [
        { title: `${post.seoTitle} | EcoCub` },
        { name: "description", content: post.seoDescription || post.excerpt || post.title },
        { property: "og:url", content: url },
        { property: "og:type", content: "article" },
        { property: "og:title", content: post.title },
        { property: "og:description", content: post.excerpt },
        ...(post.cover ? [{ property: "og:image", content: post.cover }] : []),
        { property: "article:published_time", content: post.date },
        { property: "article:section", content: BLOG_CATEGORIES[post.category] },
        ...post.tags.map((tag) => ({ property: "article:tag", content: tag })),
        { name: "twitter:card", content: post.cover ? "summary_large_image" : "summary" },
      ],
      links: [{ rel: "canonical", href: url }],
      scripts: [
        {
          type: "application/ld+json",
          children: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "Article",
            mainEntityOfPage: { "@type": "WebPage", "@id": url },
            headline: post.title,
            description: post.seoDescription || post.excerpt,
            ...(post.cover ? { image: [post.cover] } : {}),
            datePublished: post.date,
            dateModified: post.date,
            articleSection: BLOG_CATEGORIES[post.category],
            keywords: post.tags.join(", "),
            inLanguage: "ru-RU",
            author: { "@type": "Organization", name: "EcoCub", url: SITE_URL },
            publisher: {
              "@type": "Organization",
              name: "EcoCub",
              url: SITE_URL,
              logo: { "@type": "ImageObject", url: `${SITE_URL}/logo.svg` },
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
              { "@type": "ListItem", position: 3, name: post.title, item: url },
            ],
          }),
        },
      ],
    };
  },

  errorComponent: ({ error, reset }: { error: Error; reset: () => void }) => (
    <PageLayout>
      <Container className="py-32 text-center">
        <p className="text-destructive">Ошибка: {error.message}</p>
        <Button onClick={reset} className="mt-4">
          Попробовать снова
        </Button>
      </Container>
    </PageLayout>
  ),

  notFoundComponent: () => (
    <PageLayout>
      <Container className="py-32 text-center">
        <h1 className="text-3xl font-bold">Статья не найдена</h1>
        <Link to="/blog" className="mt-4 inline-block text-accent hover:underline">
          ← Все статьи
        </Link>
      </Container>
    </PageLayout>
  ),

  component: BlogPostPage,
});

function BlogPostPage() {
  const { post, related } = Route.useLoaderData();
  usePageEngagement(`article:${post.slug}`);

  useEffect(() => {
    analytics.articleRead(post.slug);
  }, [post.slug]);

  return (
    <PageLayout>
      <Section className="bg-background">
        <Container className="max-w-3xl">
          <nav aria-label="Навигация" className="text-sm">
            <Link
              to="/blog"
              className="inline-flex items-center gap-2 text-muted-foreground hover:text-accent"
            >
              <ArrowLeft className="size-4" /> Все статьи
            </Link>
          </nav>

          <div className="mt-8 flex flex-wrap items-center gap-3 text-xs uppercase tracking-wider">
            <Link
              to="/blog/category/$category"
              params={{ category: post.category }}
              className="font-semibold text-accent hover:underline"
            >
              {BLOG_CATEGORIES[post.category]}
            </Link>
            <span className="flex items-center gap-1 text-muted-foreground">
              <Clock className="size-3" /> {post.readingTime} мин
            </span>
            {post.date && (
              <time dateTime={post.date} className="text-muted-foreground">
                {formatDate(post.date)}
              </time>
            )}
          </div>

          <h1 className="mt-4 text-3xl font-bold leading-tight md:text-5xl">{post.title}</h1>

          {post.excerpt && <p className="mt-6 text-lg text-muted-foreground">{post.excerpt}</p>}

          {post.cover && (
            <Reveal
              variant="scale"
              className="mt-10 aspect-[16/9] overflow-hidden rounded-sm bg-secondary"
            >
              <img
                src={post.cover}
                alt={post.title}
                className="h-full w-full object-cover"
                onError={(e) => {
                  (e.currentTarget as HTMLImageElement).style.display = "none";
                }}
              />
            </Reveal>
          )}

          <article className="prose prose-neutral mt-10 max-w-none prose-headings:font-bold prose-headings:uppercase prose-h2:text-2xl prose-a:text-accent prose-strong:text-foreground prose-table:text-sm">
            <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw]}>
              {post.content}
            </ReactMarkdown>
          </article>

          {post.tags.length > 0 && (
            <div className="mt-12 flex flex-wrap gap-2 border-t border-border pt-8">
              {post.tags.map((tag) => (
                <Link
                  key={tag}
                  to="/blog/tag/$tag"
                  params={{ tag: tagToSlug(tag) }}
                  className="rounded-sm bg-secondary px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:text-accent"
                >
                  #{tag}
                </Link>
              ))}
            </div>
          )}
        </Container>
      </Section>

      {related.length > 0 && (
        <Section className="bg-secondary/30">
          <Container>
            <Reveal>
              <h2 className="text-2xl font-bold uppercase">Читать дальше</h2>
            </Reveal>
            <div className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {related.map((p, i) => (
                <Reveal key={p.slug} variant="up" delay={(i % 3) * 90} className="h-full">
                  <BlogCard post={p} />
                </Reveal>
              ))}
            </div>
          </Container>
        </Section>
      )}

      <Section className="relative overflow-hidden bg-primary text-primary-foreground">
        <span
          aria-hidden="true"
          className="ecocub-glow bottom-[-20%] right-[-8%] h-[45vw] max-h-[500px] w-[45vw] max-w-[500px]"
        />
        <Container className="relative max-w-3xl">
          <Reveal variant="scale">
            <h2 className="text-3xl font-bold uppercase">Получить расчёт по вашему проекту</h2>
            <p className="mt-4 text-white/70">Менеджер свяжется в течение часа.</p>
            <div className="mt-8 rounded-sm bg-white/5 p-6 md:p-8">
              <ContactForm
                variant="dark"
                formType="contact"
                sourcePage={`/blog/${post.slug}`}
                submitLabel="Получить расчёт"
              />
            </div>
          </Reveal>
        </Container>
      </Section>
    </PageLayout>
  );
}
