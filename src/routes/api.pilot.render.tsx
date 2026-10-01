import { createFileRoute } from "@tanstack/react-router";
import {
  pilotRender,
  pilotRenderStart,
  pilotRenderStatus,
} from "@/constructor-v4/server/pilot-api.server";

/**
 * Фото-рендеры по промпту (rgrouter images), лимит на сессию и на день.
 * POST ?mode=job (по умолчанию у нового клиента) — сразу отдаёт jobId (202),
 * GET ?job=<id> — прогресс и готовые кадры. Ни один запрос не держит соединение
 * дольше пары секунд, поэтому таймаут nginx (60 с) не наступает.
 * POST без mode — старый синхронный ответ (совместимость).
 */
export const Route = createFileRoute("/api/pilot/render")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const job = new URL(request.url).searchParams.get("job");
        if (!job) return Response.json({ error: "Нужен параметр job" }, { status: 400 });
        const r = pilotRenderStatus(job, request.headers.get("x-pilot-session") ?? undefined);
        return Response.json(r.body, { status: r.status });
      },
      POST: async ({ request }) => {
        let body: unknown;
        try {
          body = await request.json();
        } catch {
          return Response.json({ error: "bad_json" }, { status: 400 });
        }
        const session = request.headers.get("x-pilot-session") ?? "anon";
        try {
          if (new URL(request.url).searchParams.get("mode") === "job") {
            const r = pilotRenderStart(body, session);
            return Response.json(r.body, { status: r.status });
          }
          const r = await pilotRender(body, session);
          return Response.json(r.body, { status: r.status });
        } catch (e) {
          return Response.json({ error: String((e as Error).message ?? e) }, { status: 502 });
        }
      },
    },
  },
});
