import { createFileRoute } from "@tanstack/react-router";

import { buildFootprint } from "@/lib/ai-layout/footprint";
import { renderFootprintPng } from "@/lib/ai-layout/render";
import { findJob } from "@/lib/ai-layout/quota.server";
import type { LayoutProgram } from "@/lib/ai-layout/prompt";
import type { ModuleItem } from "@/lib/constructor/types";

/**
 * /api/ai-layout/footprint — снимок контура дома для провайдера.
 *
 * Провайдер забирает исходник по ссылке, поэтому маршрут открытый. Утечки в
 * этом нет: по ключу отдаётся чёрно-белый контур уже сохранённой заявки, а сам
 * ключ — это HMAC-производная, подобрать которую нельзя, и никаких данных
 * человека в картинке нет.
 *
 * Картинка не хранится на диске, а перерисовывается из записи каждый раз:
 * рендер детерминирован, поэтому один и тот же ключ всегда даёт одни и те же
 * байты, и хранить нечего.
 */
export const Route = createFileRoute("/api/ai-layout/footprint")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const key = new URL(request.url).searchParams.get("key");
        if (!key) return new Response("key required", { status: 400 });

        const job = await findJob(key);
        if (!job) return new Response("not found", { status: 404 });

        let payload: { modules: ModuleItem[]; program: LayoutProgram };
        try {
          payload = JSON.parse(job.payload);
        } catch {
          return new Response("bad payload", { status: 500 });
        }

        const footprint = buildFootprint(payload.modules);
        const image = await renderFootprintPng(footprint, payload.program.entrance ?? null);

        return new Response(new Uint8Array(image.bytes), {
          headers: {
            "Content-Type": "image/png",
            "Content-Length": String(image.bytes.length),
            // Контур по ключу неизменен — пусть провайдер и браузер кешируют.
            "Cache-Control": "public, max-age=86400, immutable",
          },
        });
      },
    },
  },
});
