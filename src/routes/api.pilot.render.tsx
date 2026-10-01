import { createFileRoute } from "@tanstack/react-router";
import { pilotRender } from "@/constructor-v4/server/pilot-api.server";

/** POST /api/pilot/render — фото-рендеры по промпту (rgrouter images), лимит на сессию и на день. */
export const Route = createFileRoute("/api/pilot/render")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let body: unknown;
        try {
          body = await request.json();
        } catch {
          return Response.json({ error: "bad_json" }, { status: 400 });
        }
        try {
          const r = await pilotRender(body, request.headers.get("x-pilot-session") ?? "anon");
          return Response.json(r.body, { status: r.status });
        } catch (e) {
          return Response.json({ error: String((e as Error).message ?? e) }, { status: 502 });
        }
      },
    },
  },
});
