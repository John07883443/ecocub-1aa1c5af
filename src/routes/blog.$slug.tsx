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
import { BLOG_CATEGORIES, formatDate, tagToSlug, type BlogPost } from "@/lib/blog";
import { fetchBlogPost } from "@/lib/blog-live";
import { extractFaq } from "@/lib/mm-article";

const SITE_URL = "https://eco-cub.ru";

/** JSON-LD без «</»: текст ленты не может закрыть <script>. */
const ld = (value: unknown) => JSON.stringify(value).replace(/</g, "\\u003c");

const absolute = (src: string | null | undefined): string | null =>
  src
    ? src.startsWith("http")
      ? src
      : `${SITE_URL}${src.startsWith("/") ? "" : "/"}${src}`
    : null;

const WITHDRAWN_HTML = `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Материал снят с публикации — EcoCub</title><style>body{font-family:system-ui,sans-serif;display:grid;place-items:center;min-height:100vh;margin:0;color:#1a1a1a}a{color:#b5651d}</style></head><body><main style="text-align:center;padding:2rem"><h1>Материал снят с публикации</h1><p><a href="/blog">Все статьи EcoCub</a></p></main></body></html>`;

export const Route = createFileRoute("/blog/$slug")({
  // Снятая в МедиаМашине статья — 410 Gone с noindex (эталон media-block),
  // до отрисовки страницы. Остальное — обычная страница (next()).
  server: {
    handlers: {
      GET: async ({ params, next }) => {
        const { isWithdrawnSlug } = await import("@/lib/blog-feed.server");
        if (await isWithdrawnSlug(params.slug)) {
          return new Response(WITHDRAWN_HTML, {
            status: 410,
            headers: { "Content-Type": "text/html; charset=utf-8", "X-Robots-Tag": "noindex" },
          });
        }
        return next();
      },
    },
  },
  // Файлы + живая лента Медиамашины (см. blog-live.ts).
  loader: async ({ params }) => {
    const found = await fetchBlogPost({ data: params.slug });
    if (!found) throw notFound();
    return found;
  },

  head: ({ loaderData }) => {
    if (!loaderData) return { meta: [{ title: "Статья — EcoCub" }] };
    // Снята с публикации в ММ: ответ 410 ставит серверная функция.
    if ("withdrawn" in loaderData) {
      return {
        meta: [
          { title: "Материал снят с публикации — EcoCub" },
          { name: "robots", content: "noindex" },
        ],
      };
    }
    const { post } = loaderData;
    const url = `${SITE_URL}/blog/${post.slug}`;
    // Абсолютный адрес обложки (владелец 28.09.2026: в превью ссылки в
    // Telegram была общая картинка сайта, а не из статьи). Относительный
    // og:image Telegram и соцсети игнорируют и берут twitter:image из
    // __root — там общая заглавная вилла.
    const cover = absolute(post.ogImage) ?? absolute(post.cover);
    const images = [
      ...new Set([absolute(post.ogImage), absolute(post.cover)].filter(Boolean)),
    ] as string[];
    const description = post.seoDescription || post.excerpt || post.title;
    const modified = post.updated && post.updated > post.date ? post.updated : post.date;
    const keywords = post.keywords?.length ? post.keywords : post.tags;
    const faq = extractFaq(post.content);

    return {
      meta: [
        // «| EcoCub» — только к коротким заголовкам (эталон media-block: title 50–65 знаков).
        { title: post.seoTitle.length <= 52 ? `${post.seoTitle} | EcoCub` : post.seoTitle },
        { name: "description", content: description },
        ...(post.keywords?.length ? [{ name: "keywords", content: post.keywords.join(", ") }] : []),
        { property: "og:url", content: url },
        { property: "og:type", content: "article" },
        { property: "og:title", content: post.title },
        { property: "og:description", content: description },
        ...(cover
          ? [
              { property: "og:image", content: cover },
              { name: "twitter:image", content: cover },
            ]
          : []),
        { name: "twitter:title", content: post.title },
        { name: "twitter:description", content: description },
        { property: "article:published_time", content: post.date },
        ...(modified !== post.date
          ? [{ property: "article:modified_time", content: modified }]
          : []),
        { property: "article:section", content: BLOG_CATEGORIES[post.category] },
        ...post.tags.map((tag) => ({ property: "article:tag", content: tag })),
        { name: "twitter:card", content: post.cover ? "summary_large_image" : "summary" },
      ],
      links: [{ rel: "canonical", href: url }],
      scripts: [
        {
          type: "application/ld+json",
          children: ld({
            "@context": "https://schema.org",
            "@type": "Article",
            mainEntityOfPage: { "@type": "WebPage", "@id": url },
            headline: post.title,
            description,
            ...(images.length ? { image: images } : {}),
            datePublished: post.date,
            dateModified: modified,
            articleSection: BLOG_CATEGORIES[post.category],
            keywords: keywords.join(", "),
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
          children: ld({
            "@context": "https://schema.org",
            "@type": "BreadcrumbList",
            itemListElement: [
              { "@type": "ListItem", position: 1, name: "Главная", item: SITE_URL },
              { "@type": "ListItem", position: 2, name: "Блог", item: `${SITE_URL}/blog` },
              { "@type": "ListItem", position: 3, name: post.title, item: url },
            ],
          }),
        },
        // FAQPage — из раздела «Вопросы и ответы» в тексте (лента ММ ставит его сама).
        ...(faq.length
          ? [
              {
                type: "application/ld+json",
                children: ld({
                  "@context": "https://schema.org",
                  "@type": "FAQPage",
                  mainEntity: faq.map((item) => ({
                    "@type": "Question",
                    name: item.question,
                    acceptedAnswer: { "@type": "Answer", text: item.answer },
                  })),
                }),
              },
            ]
          : []),
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
  const data = Route.useLoaderData();
  if ("withdrawn" in data) return <WithdrawnPage />;
  return <BlogPostView post={data.post} related={data.related} />;
}

/** Статья снята с публикации в МедиаМашине (эталон media-block: 410 + noindex). */
function WithdrawnPage() {
  return (
    <PageLayout>
      <Container className="py-32 text-center">
        <h1 className="text-3xl font-bold">Материал снят с публикации</h1>
        <Link to="/blog" className="mt-4 inline-block text-accent hover:underline">
          ← Все статьи
        </Link>
      </Container>
    </PageLayout>
  );
}

function BlogPostView({ post, related }: { post: BlogPost; related: BlogPost[] }) {
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
                alt={post.coverAlt || post.title}
                width={post.imageSizes?.[post.cover]?.width}
                height={post.imageSizes?.[post.cover]?.height}
                fetchPriority="high"
                className="h-full w-full object-cover"
                onError={(e) => {
                  (e.currentTarget as HTMLImageElement).style.display = "none";
                }}
              />
            </Reveal>
          )}

          <article className="prose prose-neutral mt-10 max-w-none prose-headings:font-bold prose-headings:uppercase prose-h2:text-2xl prose-a:text-accent prose-strong:text-foreground prose-table:text-sm">
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              rehypePlugins={[rehypeRaw]}
              components={{
                // Ссылки: свои — как есть, чужие https — в новой вкладке; опасные
                // (javascript:, data:) react-markdown обнуляет — тогда просто текст.
                a: ({ node: _node, href, children, ...rest }) => {
                  if (!href) return <span>{children}</span>;
                  const external = /^https?:\/\//.test(href) && !href.startsWith(SITE_URL);
                  return (
                    <a
                      {...rest}
                      href={href}
                      {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
                    >
                      {children}
                    </a>
                  );
                },
                // Кадр с подписью отдельной строкой — <figure> с <figcaption>.
                p: ({ node, children, ...rest }) => {
                  const only = node?.children?.length === 1 ? node.children[0] : null;
                  const title =
                    only && only.type === "element" && only.tagName === "img"
                      ? String(only.properties?.title ?? "")
                      : "";
                  if (!title) return <p {...rest}>{children}</p>;
                  return (
                    <figure>
                      {children}
                      <figcaption>{title}</figcaption>
                    </figure>
                  );
                },
                // Кадры в тексте — лениво и с размерами, если они известны (лента ММ).
                img: ({ node: _node, src, alt, ...rest }) => {
                  const size = typeof src === "string" ? post.imageSizes?.[src] : undefined;
                  return (
                    <img
                      {...rest}
                      src={src}
                      alt={alt ?? ""}
                      loading="lazy"
                      decoding="async"
                      width={size?.width ?? rest.width}
                      height={size?.height ?? rest.height}
                    />
                  );
                },
              }}
            >
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
