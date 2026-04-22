import { createFileRoute } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";

const SITE_URL = "https://eco-cub.ru";

const staticRoutes = ["", "/concrete", "/villas", "/technology", "/portfolio", "/blog", "/presentation", "/contacts"];

export const Route = createFileRoute("/sitemap.xml")({
  server: {
    handlers: {
      GET: async () => {
        const [projects, posts] = await Promise.all([
          supabase.from("projects").select("slug,updated_at").eq("published", true),
          supabase.from("blog_posts").select("slug,published_at").eq("published", true),
        ]);

        const urls: string[] = [];
        for (const r of staticRoutes) {
          urls.push(`<url><loc>${SITE_URL}${r}</loc><changefreq>weekly</changefreq></url>`);
        }
        for (const p of projects.data ?? []) {
          urls.push(`<url><loc>${SITE_URL}/projects/${p.slug}</loc><lastmod>${p.updated_at}</lastmod></url>`);
        }
        for (const p of posts.data ?? []) {
          urls.push(`<url><loc>${SITE_URL}/blog/${p.slug}</loc><lastmod>${p.published_at ?? ""}</lastmod></url>`);
        }

        const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.join("\n")}
</urlset>`;

        return new Response(xml, { headers: { "Content-Type": "application/xml" } });
      },
    },
  },
});
