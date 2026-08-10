import { createFileRoute } from "@tanstack/react-router";

import { REJECT_REASONS, analyze, type RejectReason } from "@/lib/planner/training";
import { listVerdicts, saveVerdict } from "@/lib/planner/training.server";

/**
 * Отметки обучения планировщика.
 *
 * Маршрут открытый — так решил владелец: страница обучения доступна по мелкой
 * ссылке в подвале без пароля. Риск от этого ограниченный: наружу отдаётся
 * только статистика по формам домов, а внутрь принимается вердикт с закрытым
 * списком причин. Ни персональных данных, ни денег, ни влияния на боевой сайт
 * здесь нет — разметка ничего не меняет, пока правило не перенесут в код руками.
 *
 * Что всё-таки ограничено: длина полей и размер тела. Открытая ручка без
 * ограничений — это приглашение забить диск.
 */
export const Route = createFileRoute("/api/planner-training")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const run = new URL(request.url).searchParams.get("run") || undefined;
        const verdicts = await listVerdicts(run);
        return Response.json({
          ok: true,
          total: verdicts.length,
          approved: verdicts.filter((v) => v.approved).length,
          insights: analyze(verdicts).slice(0, 20),
          reasons: countReasons(verdicts),
        });
      },
      POST: async ({ request }) => {
        let body: unknown;
        try {
          body = await request.json();
        } catch {
          return Response.json({ ok: false, reason: "bad_json" }, { status: 400 });
        }
        const v = body as Record<string, unknown>;
        const caseId = String(v.caseId ?? "").slice(0, 200);
        const run = String(v.run ?? "").slice(0, 64);
        if (!caseId || !run) {
          return Response.json({ ok: false, reason: "bad_request" }, { status: 400 });
        }
        const reasons = Array.isArray(v.reasons)
          ? (v.reasons as unknown[])
              .map(String)
              .filter((r): r is RejectReason => (REJECT_REASONS as readonly string[]).includes(r))
          : [];
        const features = Array.isArray(v.features)
          ? (v.features as unknown[]).map(String).slice(0, 40)
          : [];

        await saveVerdict({
          caseId,
          run,
          approved: v.approved === true,
          reasons,
          features,
          note: typeof v.note === "string" ? v.note : "",
        });
        return Response.json({ ok: true });
      },
    },
  },
});

function countReasons(verdicts: Array<{ approved: boolean; reasons: string[] }>) {
  const out: Record<string, number> = {};
  for (const v of verdicts) {
    if (v.approved) continue;
    for (const r of v.reasons) out[r] = (out[r] ?? 0) + 1;
  }
  return out;
}
