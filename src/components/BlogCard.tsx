import { Link } from "@tanstack/react-router";
import { Clock } from "lucide-react";

export type BlogCardData = {
  slug: string;
  title: string;
  excerpt: string | null;
  cover_image: string | null;
  category: "tech" | "cases" | "comparison" | "news";
  reading_time: number;
  published_at: string | null;
};

const categoryLabels: Record<BlogCardData["category"], string> = {
  tech: "Технология",
  cases: "Кейсы",
  comparison: "Сравнения",
  news: "Новости",
};

export function BlogCard({ post }: { post: BlogCardData }) {
  return (
    <Link
      to="/blog/$slug"
      params={{ slug: post.slug }}
      className="group flex flex-col overflow-hidden rounded-sm border border-border bg-card transition-all hover:border-accent"
    >
      {post.cover_image && (
        <div className="relative aspect-[16/10] overflow-hidden bg-secondary">
          <img
            src={post.cover_image}
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
        <div className="flex items-center gap-3 text-xs uppercase tracking-wider">
          <span className="font-semibold text-accent">{categoryLabels[post.category]}</span>
          <span className="flex items-center gap-1 text-muted-foreground">
            <Clock className="size-3" /> {post.reading_time} мин
          </span>
        </div>
        <h3 className="mt-3 text-xl font-semibold leading-snug transition-colors group-hover:text-accent">
          {post.title}
        </h3>
        {post.excerpt && (
          <p className="mt-3 line-clamp-3 flex-1 text-sm text-muted-foreground">
            {post.excerpt}
          </p>
        )}
      </div>
    </Link>
  );
}
