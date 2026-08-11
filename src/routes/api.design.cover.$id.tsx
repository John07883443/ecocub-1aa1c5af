import { createFileRoute } from "@tanstack/react-router";
import { checkAccess, denied } from "@/lib/design-auth.server";
import { readCover, saveCover, toResponse } from "@/lib/house-projects.server";

/**
 * Обложка проекта: чтение публичное, запись — только из режима проектирования.
 *
 * GET открыт всем намеренно: картинка карточки должна грузиться со страницы
 * каталога без сессии. Ничего, кроме уже опубликованного изображения, по
 * этому адресу не отдаётся, а идентификатор проекта и так виден в ссылке.
 *
 * PUT принимает сырые байты изображения с заголовком Content-Type. Форму
 * multipart здесь заводить незачем: поле ровно одно, и снимок сцены
 * отправляется как есть.
 */
export const Route = createFileRoute("/api/design/cover/$id")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const cover = await readCover(params.id);
        if (!cover) return new Response("Нет обложки", { status: 404 });
        return new Response(new Uint8Array(cover.bytes), {
          headers: {
            "Content-Type": cover.mime,
            // Обложка меняется вручную и редко, но не «никогда»: час кэша
            // снимает нагрузку и при этом не заставляет ждать сутки правки.
            "Cache-Control": "public, max-age=3600",
            "Last-Modified": new Date(cover.updatedAt).toUTCString(),
          },
        });
      },

      PUT: async ({ request, params }) => {
        const access = await checkAccess(request);
        if (!access.allowed) return denied(access);

        const mime = request.headers.get("content-type") ?? "";
        const bytes = new Uint8Array(await request.arrayBuffer());
        if (!bytes.byteLength) {
          return Response.json({ ok: false, reason: "empty" }, { status: 400 });
        }
        try {
          await saveCover(params.id, mime.split(";")[0].trim(), bytes);
          return Response.json({ ok: true, url: `/api/design/cover/${params.id}` });
        } catch (e) {
          return toResponse(e);
        }
      },
    },
  },
});
