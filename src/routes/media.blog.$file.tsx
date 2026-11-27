import { createFileRoute } from "@tanstack/react-router";

/**
 * Кадры статей из живой ленты Медиамашины на нашем домене (WebP ≤ 300 КБ
 * и превью 1200×630 для соцсетей). Отдаётся только то, что зарегистрировала
 * лента, — см. blog-media.server.ts.
 */
export const Route = createFileRoute("/media/blog/$file")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const { getMedia } = await import("@/lib/blog-media.server");
        const media = await getMedia(params.file);
        if (!media) return new Response("Нет такого кадра", { status: 404 });
        return new Response(new Uint8Array(media.data), {
          headers: {
            "Content-Type": media.type,
            // Имя содержит хэш исходника: новый кадр — новое имя, старый не меняется.
            "Cache-Control": "public, max-age=31536000, immutable",
          },
        });
      },
    },
  },
});
