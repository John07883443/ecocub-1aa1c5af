import { createFileRoute } from "@tanstack/react-router";

import { readImage } from "@/lib/ai-layout/store.server";

/**
 * /api/ai-layout/result — готовая планировка, сохранённая у нас.
 *
 * Нужен потому, что провайдер возвращает картинку байтами, а не ссылкой.
 * Раздавать её со своего адреса надёжнее чужого CDN: планировка должна
 * открываться и через год, в том числе из письма или сохранённой вкладки.
 *
 * Маршрут открытый, как и снимок контура: по ключу отдаётся картинка уже
 * существующего задания, сам ключ — HMAC-производная, подобрать её нельзя, а
 * персональных данных в изображении нет.
 */
export const Route = createFileRoute("/api/ai-layout/result")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const key = new URL(request.url).searchParams.get("key");
        if (!key) return new Response("key required", { status: 400 });

        const bytes = await readImage(key);
        if (!bytes) return new Response("not found", { status: 404 });

        return new Response(new Uint8Array(bytes), {
          headers: {
            "Content-Type": "image/png",
            "Content-Length": String(bytes.length),
            // Результат по ключу неизменен: одна генерация — одна картинка.
            "Cache-Control": "public, max-age=31536000, immutable",
          },
        });
      },
    },
  },
});
