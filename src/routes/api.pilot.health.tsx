import { createFileRoute } from "@tanstack/react-router";
import { pilotHealth } from "@/constructor-v4/server/pilot-api.server";

/** GET /api/pilot/health — что из пилота конструктора v4 настроено на сервере (без секретов). */
export const Route = createFileRoute("/api/pilot/health")({
  server: {
    handlers: {
      GET: async () => {
        const r = pilotHealth({ localVoice: process.env.PILOT_LOCAL_VOICE === "1" });
        return Response.json(r.body, { status: r.status });
      },
    },
  },
});
