import { createFileRoute } from "@tanstack/react-router";
import { pilotChat } from "@/constructor-v4/server/pilot-api.server";

/** POST /api/pilot/chat — текстовый «Архитектор Лев» через rgrouter; ключ только на сервере. */
export const Route = createFileRoute("/api/pilot/chat")({
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
          const r = await pilotChat(body, request.headers.get("x-pilot-session") ?? "anon");
          return Response.json(r.body, { status: r.status });
        } catch (e) {
          return Response.json({ error: String((e as Error).message ?? e) }, { status: 502 });
        }
      },
    },
  },
});
