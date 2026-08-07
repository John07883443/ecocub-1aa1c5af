import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ArrowLeft, Clock } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { PageLayout } from "@/components/PageLayout";
import { Container, Section } from "@/components/Container";
import { ContactForm } from "@/components/ContactForm";
import { Button } from "@/components/ui/button";
import { usePageEngagement } from "@/hooks/usePageEngagement";
import { analytics } from "@/lib/analytics";
import { useEffect } from "react";

const categoryLabels = {
  tech: "Технология",
  cases: "Кейсы",
  comparison: "Сравнения",
  news: "Новости",
} as const;

export const Route = createFileRoute("/blog/$slug")({
  loader: async ({ params }) => {
    const { data, error } = await supabase
      .from("blog_posts")
      .select("*")
      .eq("slug", params.slug)
      .eq("published", true)
      .maybeSingle();
    if (error) throw error;
    if (!data) throw notFound();
    return { post: data };
  },
  head: ({ loaderData }) => {
    if (!loaderData) return { meta: [{ title: "Статья — EcoCub" }] };
    const { post } = loaderData;
    return {
      meta: [
        { property: "og:url", content: `https://eco-cub.ru/blog/${post.slug}` },
        { title: `${post.title} | EcoCub` },
        { name: "description", content: post.excerpt ?? post.title },
        { property: "og:title", content: post.title },
        { property: "og:description", content: post.excerpt ?? "" },
        ...(post.cover_image ? [{ property: "og:image", content: post.cover_image }] : []),
        { property: "og:type", content: "article" },
      ],
      links: [{ rel: "canonical", href: `https://eco-cub.ru/blog/${post.slug}` }],
      scripts: [
        {
          type: "application/ld+json",
          children: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "Article",
            headline: post.title,
            description: post.excerpt,
            image: post.cover_image,
            datePublished: post.published_at,
            author: { "@type": "Organization", name: "EcoCub" },
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
  const { post } = Route.useLoaderData();
  usePageEngagement(`article:${post.slug}`);
  useEffect(() => {
    analytics.articleRead(post.slug);
  }, [post.slug]);
  const category = (post.category ?? "tech") as keyof typeof categoryLabels;
  return (
    <PageLayout>
      <Section className="bg-background">
        <Container className="max-w-3xl">
          <Link
            to="/blog"
            className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-accent"
          >
            <ArrowLeft className="size-4" /> Все статьи
          </Link>
          <div className="mt-8 flex items-center gap-3 text-xs uppercase tracking-wider">
            <span className="font-semibold text-accent">{categoryLabels[category]}</span>
            <span className="flex items-center gap-1 text-muted-foreground">
              <Clock className="size-3" /> {post.reading_time} мин
            </span>
          </div>
          <h1 className="mt-4 text-3xl font-bold leading-tight md:text-5xl">{post.title}</h1>
          {post.excerpt && <p className="mt-6 text-lg text-muted-foreground">{post.excerpt}</p>}
          {post.cover_image && (
            <div className="mt-10 aspect-[16/9] overflow-hidden rounded-sm bg-secondary">
              <img
                src={post.cover_image}
                alt={post.title}
                className="h-full w-full object-cover"
                onError={(e) => {
                  (e.currentTarget as HTMLImageElement).style.display = "none";
                }}
              />
            </div>
          )}
          <article className="prose prose-neutral mt-10 max-w-none prose-headings:font-bold prose-headings:uppercase prose-h2:text-2xl prose-a:text-accent prose-strong:text-foreground prose-table:text-sm">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{post.content}</ReactMarkdown>
          </article>
        </Container>
      </Section>

      <Section className="bg-primary text-primary-foreground">
        <Container className="max-w-3xl">
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
        </Container>
      </Section>
    </PageLayout>
  );
}
