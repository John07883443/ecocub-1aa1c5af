import { Link } from "@tanstack/react-router";
import { Clock } from "lucide-react";
import { BLOG_CATEGORIES, formatDate, type BlogPost } from "@/lib/blog";

/**
 * Карточка статьи. Источник данных — локальные файлы (см. src/lib/blog.ts).
 */
export function BlogCard({ post }: { post: BlogPost }) {
  return (
    <Link
      to="/blog/$slug"
      params={{ slug: post.slug }}
      className="group flex flex-col overflow-hidden rounded-sm border border-border bg-card transition-all hover:border-accent"
    >
      {post.cover && (
        <div className="relative aspect-[16/10] overflow-hidden bg-secondary">
          <img
            src={post.cover}
            alt={post.title}
            loading="lazy"
            className="h-full w-full object-cover transition-transform duration-700 group-hover:scale-105"
            onError={(e) => {
              (e.currentTarget as HTMLImageElement).style.display = "none";
            }}
          />
        </div>
      )}
      <div className="flex flex-1 flex-col p-6">
        <div className="flex flex-wrap items-center gap-3 text-xs uppercase tracking-wider">
          <span className="font-semibold text-accent">{BLOG_CATEGORIES[post.category]}</span>
          <span className="flex items-center gap-1 text-muted-foreground">
            <Clock className="size-3" /> {post.readingTime} мин
          </span>
          {post.date && (
            <time dateTime={post.date} className="text-muted-foreground">
              {formatDate(post.date)}
            </time>
          )}
        </div>
        <h3 className="mt-3 text-xl font-semibold leading-snug transition-colors group-hover:text-accent">
          {post.title}
        </h3>
        {post.excerpt && (
          <p className="mt-3 line-clamp-3 flex-1 text-sm text-muted-foreground">{post.excerpt}</p>
        )}
      </div>
    </Link>
  );
}
