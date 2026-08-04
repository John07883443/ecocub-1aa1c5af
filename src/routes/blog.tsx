import { createFileRoute } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { PageLayout } from "@/components/PageLayout";
import { Container, Section } from "@/components/Container";
import { BlogCard, type BlogCardData } from "@/components/BlogCard";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/blog")({
  head: () => ({
    meta: [
      { property: "og:url", content: "https://eco-cub.ru/blog" },
      { title: "Блог EcoCub — статьи о монолитно-модульных домах из бетона" },
      {
        name: "description",
        content:
          "Технология ECO·CUB, сравнения с кирпичом и газобетоном, кейсы реализованных проектов. Полезные статьи для тех, кто выбирает капитальный дом.",
      },
      { property: "og:title", content: "Блог EcoCub — статьи о капитальных домах из бетона" },
      {
        property: "og:description",
        content: "Сравнения технологий, разбор материалов, реальные кейсы.",
      },
    ],
    links: [{ rel: "canonical", href: "https://eco-cub.ru/blog" }],
  }),
  loader: async () => {
    const { data, error } = await supabase
      .from("blog_posts")
      .select("slug,title,excerpt,cover_image,category,reading_time,published_at")
      .eq("published", true)
      .order("published_at", { ascending: false });
    if (error) throw error;
    return { posts: (data ?? []) as BlogCardData[] };
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
  component: BlogPage,
});

function BlogPage() {
  const { posts } = Route.useLoaderData();
  return (
    <PageLayout>
      <Section className="bg-background">
        <Container>
          <div className="mb-12 max-w-3xl">
            <p className="text-xs font-medium uppercase tracking-[0.3em] text-accent">Блог</p>
            <h1 className="mt-3 text-4xl font-bold uppercase md:text-6xl">
              Статьи о бетонных домах
            </h1>
            <p className="mt-4 text-muted-foreground">
              Технологии, сравнения, кейсы. Помогаем разобраться в нюансах капитального
              строительства из бетона.
            </p>
          </div>
          {posts.length === 0 ? (
            <p className="text-muted-foreground">Статьи скоро появятся.</p>
          ) : (
            <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {posts.map((p: BlogCardData) => (
                <BlogCard key={p.slug} post={p} />
              ))}
            </div>
          )}
        </Container>
      </Section>
    </PageLayout>
  );
}
