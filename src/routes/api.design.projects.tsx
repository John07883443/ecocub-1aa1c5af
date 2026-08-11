import { createFileRoute } from "@tanstack/react-router";
import { checkAccess, denied } from "@/lib/design-auth.server";
import { create, listAll, storageStatus, toResponse } from "@/lib/house-projects.server";
import { createProject } from "@/lib/house-project/factory";
import { parseProject, serializeProject } from "@/lib/house-project/serialize";

/**
 * Список проектов и создание нового. Только для режима «Проектирование».
 *
 * Публичного чтения здесь нет намеренно: каталог ходит своей дорогой
 * (`fetchPublishedHouses`) и видит только опубликованные дома. Смешивать их
 * в одном роуте — верный способ однажды отдать наружу черновик.
 */
export const Route = createFileRoute("/api/design/projects")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const access = await checkAccess(request);
        if (!access.allowed) return denied(access);

        const url = new URL(request.url);
        const status = url.searchParams.get("status");
        const projects = await listAll(
          status === "draft" || status === "published" || status === "archived"
            ? status
            : undefined,
        );
        return Response.json({ ok: true, projects, storage: await storageStatus() });
      },

      POST: async ({ request }) => {
        const access = await checkAccess(request);
        if (!access.allowed) return denied(access);

        let body: Record<string, unknown>;
        try {
          body = (await request.json()) as Record<string, unknown>;
        } catch {
          return Response.json({ ok: false, reason: "bad_json" }, { status: 400 });
        }

        // Тело может быть либо целым проектом (импорт JSON, копия из каталога),
        // либо только названием — тогда создаётся пустой проект с одним модулем.
        const incoming = body.project
          ? parseProject(body.project)
          : createProject(typeof body.title === "string" ? body.title : undefined);

        if (!incoming) {
          return Response.json(
            { ok: false, reason: "unreadable", message: "Присланный проект не читается" },
            { status: 400 },
          );
        }

        try {
          const saved = await create(incoming);
          return Response.json({ ok: true, project: serializeProject(saved) }, { status: 201 });
        } catch (e) {
          return toResponse(e);
        }
      },
    },
  },
});
