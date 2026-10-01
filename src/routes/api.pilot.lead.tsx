import { createFileRoute } from "@tanstack/react-router";
import { pilotLead } from "@/constructor-v4/server/pilot-api.server";
import { saveLead } from "@/lib/leads.server";

/** POST /api/pilot/lead — заявка из конструктора v4: база лидов + Telegram с паспортом проекта. */
export const Route = createFileRoute("/api/pilot/lead")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let body: unknown;
        try {
          body = await request.json();
        } catch {
          return Response.json({ error: "bad_json" }, { status: 400 });
        }
        const r = await pilotLead(body, (lead) =>
          saveLead({ ...lead, email: null, projectSlug: null }),
        );
        return Response.json(r.body, { status: r.status });
      },
    },
  },
});
