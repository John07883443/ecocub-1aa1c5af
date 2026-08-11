import { createFileRoute } from "@tanstack/react-router";
import {
  adminConfigured,
  checkAccess,
  clearCookie,
  isProduction,
  issueToken,
  sessionCookie,
} from "@/lib/design-auth.server";

/**
 * Вход и выход из режима «Проектирование».
 *
 * GET  — состояние: настроен ли доступ на сервере и есть ли сессия сейчас.
 *        Нужен редактору, чтобы показать форму входа, а не молча ронять
 *        сохранение на 403.
 * POST — {"secret": "..."} → подписанная кука сессии.
 * DELETE — выход.
 *
 * Секрет приходит в теле POST, а не в адресе: адреса пишутся в логи сервера
 * и в историю браузера, тела запросов — нет.
 */
export const Route = createFileRoute("/api/design/session")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const access = await checkAccess(request);
        return Response.json({
          configured: adminConfigured(),
          production: isProduction(),
          allowed: access.allowed,
          mode: access.allowed ? access.mode : null,
        });
      },

      POST: async ({ request }) => {
        let body: { secret?: string };
        try {
          body = (await request.json()) as { secret?: string };
        } catch {
          return Response.json({ ok: false, reason: "bad_json" }, { status: 400 });
        }

        if (!adminConfigured()) {
          return Response.json(
            {
              ok: false,
              reason: "not-configured",
              message:
                "На сервере не задана переменная ECOCUB_ADMIN_SECRET, поэтому войти некуда. " +
                "Пока её нет, изменение проектов закрыто.",
            },
            { status: 503 },
          );
        }

        const token = await issueToken((body.secret ?? "").toString());
        if (!token) {
          // Пауза против перебора. Секрет один, форма без ограничения частоты
          // запросов позволила бы молотить по ней сколько угодно.
          await new Promise((r) => setTimeout(r, 700));
          return Response.json({ ok: false, reason: "wrong-secret" }, { status: 401 });
        }

        return Response.json({ ok: true }, { headers: { "Set-Cookie": sessionCookie(token) } });
      },

      DELETE: async () => Response.json({ ok: true }, { headers: { "Set-Cookie": clearCookie() } }),
    },
  },
});
