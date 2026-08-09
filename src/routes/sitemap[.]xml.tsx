import { createFileRoute } from "@tanstack/react-router";
import { getAllPosts, getCategories, getTags } from "@/lib/blog";
import { fetchProjects } from "@/lib/projects";

const SITE_URL = "https://eco-cub.ru";

const staticRoutes = [
  "",
  "/concrete",
  "/technology",
  "/portfolio",
  "/blog",
  "/presentation",
  "/contacts",
];

function url(loc: string, lastmod?: string, changefreq = "weekly", priority?: string): string {
  return [
    "  <url>",
    `    <loc>${SITE_URL}${loc}</loc>`,
    lastmod ? `    <lastmod>${lastmod}</lastmod>` : "",
    `    <changefreq>${changefreq}</changefreq>`,
    priority ? `    <priority>${priority}</priority>` : "",
    "  </url>",
  ]
    .filter(Boolean)
    .join("\n");
}

export const Route = createFileRoute("/sitemap.xml")({
  server: {
    handlers: {
      GET: async () => {
        const urls: string[] = [];

        for (const route of staticRoutes) {
          urls.push(url(route, undefined, "weekly", route === "" ? "1.0" : "0.8"));
        }

        // Блог — из локальных файлов. Не зависит ни от сети, ни от базы:
        // если внешний сервис лежит, карта сайта всё равно полная по статьям.
        for (const post of getAllPosts()) {
          urls.push(url(`/blog/${post.slug}`, post.date, "monthly", "0.7"));
        }
        for (const category of getCategories()) {
          urls.push(url(`/blog/category/${category.key}`, undefined, "weekly", "0.5"));
        }
        for (const tag of getTags()) {
          urls.push(url(`/blog/tag/${tag.slug}`, undefined, "weekly", "0.4"));
        }

        // Проекты — из базы, с откатом на файлы внутри самой загрузки.
        // Карта сайта не может остаться без проектных адресов из-за того,
        // что внешний сервис в этот момент недоступен.
        for (const project of await fetchProjects()) {
          urls.push(
            url(`/projects/${project.slug}`, project.updated_at ?? undefined, "monthly", "0.7"),
          );
        }

        const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.join("\n")}
</urlset>`;

        return new Response(xml, {
          headers: {
            "Content-Type": "application/xml; charset=utf-8",
            "Cache-Control": "public, max-age=3600",
          },
        });
      },
    },
  },
});
