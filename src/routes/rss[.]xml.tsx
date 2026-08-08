import { createFileRoute } from "@tanstack/react-router";
import { getAllPosts } from "@/lib/blog";

const SITE_URL = "https://eco-cub.ru";
const TITLE = "Блог EcoCub";
const DESCRIPTION =
  "Статьи о монолитно-модульных домах из бетона: технология, сравнения, цены, кейсы.";

/** Экранирование для XML. Без него один амперсанд в заголовке ломает всю ленту. */
function esc(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function rfc822(iso: string): string {
  const d = iso ? new Date(iso) : new Date();
  return (Number.isNaN(d.getTime()) ? new Date() : d).toUTCString();
}

export const Route = createFileRoute("/rss.xml")({
  server: {
    handlers: {
      GET: () => {
        const posts = getAllPosts();
        const lastBuild = rfc822(posts[0]?.date ?? "");

        const items = posts
          .map((p) => {
            const url = `${SITE_URL}/blog/${p.slug}`;
            return [
              "    <item>",
              `      <title>${esc(p.title)}</title>`,
              `      <link>${url}</link>`,
              `      <guid isPermaLink="true">${url}</guid>`,
              `      <pubDate>${rfc822(p.date)}</pubDate>`,
              `      <description>${esc(p.excerpt || p.title)}</description>`,
              ...p.tags.map((t) => `      <category>${esc(t)}</category>`),
              ...(p.cover
                ? [`      <enclosure url="${esc(p.cover)}" type="image/jpeg" />`]
                : []),
              "    </item>",
            ].join("\n");
          })
          .join("\n");

        const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${esc(TITLE)}</title>
    <link>${SITE_URL}/blog</link>
    <description>${esc(DESCRIPTION)}</description>
    <language>ru</language>
    <lastBuildDate>${lastBuild}</lastBuildDate>
    <atom:link href="${SITE_URL}/rss.xml" rel="self" type="application/rss+xml" />
${items}
  </channel>
</rss>`;

        return new Response(xml, {
          headers: {
            "Content-Type": "application/rss+xml; charset=utf-8",
            "Cache-Control": "public, max-age=1800",
          },
        });
      },
    },
  },
});
