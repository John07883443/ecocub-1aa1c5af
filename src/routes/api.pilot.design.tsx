import { createFileRoute } from "@tanstack/react-router";
import { jobStatus, pilotDesignStart } from "@/constructor-v4/server/pilot-design.server";

/**
 * POST /api/pilot/design — запустить задачу (202 + jobId сразу), GET ?job=<id> — статус и результат.
 * Долгая работа нейросети не держит соединение: таймаут nginx не наступает.
 */
export const Route = createFileRoute("/api/pilot/design")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const job = new URL(request.url).searchParams.get("job");
        if (!job) return Response.json({ error: "Нужен параметр job" }, { status: 400 });
        const r = jobStatus(job, request.headers.get("x-pilot-session") ?? undefined);
        return Response.json(r.body, { status: r.status });
      },
      POST: async ({ request }) => {
        const len = Number(request.headers.get("content-length") ?? 0);
        if (len > 4_000_000)
          return Response.json({ error: "Слишком большой запрос." }, { status: 413 });
        let body: unknown;
        try {
          body = await request.json();
        } catch {
          return Response.json({ error: "bad_json" }, { status: 400 });
        }
        const r = pilotDesignStart(body, request.headers.get("x-pilot-session") ?? "anon");
        return Response.json(r.body, { status: r.status });
      },
    },
  },
});
