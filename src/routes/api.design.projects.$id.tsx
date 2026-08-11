import { createFileRoute } from "@tanstack/react-router";
import { checkAccess, denied } from "@/lib/design-auth.server";
import {
  archive,
  duplicate,
  getAny,
  publish,
  remove,
  unpublish,
  toResponse,
  update,
} from "@/lib/house-projects.server";
import { parseProject, serializeProject } from "@/lib/house-project/serialize";
import { validateProject } from "@/lib/house-project/validate";

/**
 * Один проект: чтение, сохранение и операции над статусом.
 *
 * GET    — проект в любом статусе (черновик виден только здесь).
 * PUT    — сохранить. Обязателен `expectedVersion`: без него сохранение
 *          из старой вкладки затирало бы более свежую модель.
 * POST   — {"action": "publish" | "unpublish" | "archive" | "duplicate"}.
 *
 * DELETE — удалить безвозвратно. Подтверждение спрашивает интерфейс; рядом
 *          остаётся архив как обратимый вариант.
 */
export const Route = createFileRoute("/api/design/projects/$id")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const access = await checkAccess(request);
        if (!access.allowed) return denied(access);

        const project = await getAny(params.id);
        if (!project) return Response.json({ ok: false, reason: "not-found" }, { status: 404 });
        return Response.json({
          ok: true,
          project: serializeProject(project),
          issues: validateProject(project),
        });
      },

      PUT: async ({ request, params }) => {
        const access = await checkAccess(request);
        if (!access.allowed) return denied(access);

        let body: { project?: unknown; expectedVersion?: number };
        try {
          body = (await request.json()) as typeof body;
        } catch {
          return Response.json({ ok: false, reason: "bad_json" }, { status: 400 });
        }

        const incoming = parseProject(body.project);
        if (!incoming) {
          return Response.json(
            { ok: false, reason: "unreadable", message: "Присланный проект не читается" },
            { status: 400 },
          );
        }
        if (typeof body.expectedVersion !== "number") {
          return Response.json(
            {
              ok: false,
              reason: "no-version",
              message: "Не прислана версия проекта — сохранение без неё небезопасно",
            },
            { status: 400 },
          );
        }

        try {
          const saved = await update(
            params.id,
            {
              title: incoming.title,
              slug: incoming.slug,
              description: incoming.description,
              model: incoming.model,
              underlay: incoming.underlay,
              publication: incoming.publication,
              source: incoming.source,
            },
            body.expectedVersion,
          );
          return Response.json({
            ok: true,
            project: serializeProject(saved),
            issues: validateProject(saved),
          });
        } catch (e) {
          return toResponse(e);
        }
      },

      DELETE: async ({ request, params }) => {
        const access = await checkAccess(request);
        if (!access.allowed) return denied(access);
        try {
          await remove(params.id);
          return Response.json({ ok: true });
        } catch (e) {
          return toResponse(e);
        }
      },

      POST: async ({ request, params }) => {
        const access = await checkAccess(request);
        if (!access.allowed) return denied(access);

        let body: { action?: string };
        try {
          body = (await request.json()) as { action?: string };
        } catch {
          return Response.json({ ok: false, reason: "bad_json" }, { status: 400 });
        }

        try {
          switch (body.action) {
            case "publish": {
              const p = await publish(params.id);
              return Response.json({
                ok: true,
                project: serializeProject(p),
                url: `/houses/${p.slug}`,
              });
            }
            case "unpublish":
              return Response.json({
                ok: true,
                project: serializeProject(await unpublish(params.id)),
              });
            case "archive":
              return Response.json({
                ok: true,
                project: serializeProject(await archive(params.id)),
              });
            case "duplicate":
              return Response.json({
                ok: true,
                project: serializeProject(await duplicate(params.id)),
              });
            default:
              return Response.json({ ok: false, reason: "unknown-action" }, { status: 400 });
          }
        } catch (e) {
          return toResponse(e);
        }
      },
    },
  },
});
