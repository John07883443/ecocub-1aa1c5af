import { createFileRoute } from "@tanstack/react-router";
import { googleConfigured } from "@/lib/design-google.server";
import {
  MIN_PASSWORD_LENGTH,
  adminConfigured,
  checkAccess,
  claimOwner,
  clearCookie,
  envSecretConfigured,
  isProduction,
  issueToken,
  ownerClaimed,
  passwordClaimAvailable,
  sessionCookie,
} from "@/lib/design-auth.server";

/**
 * Вход и выход из режима «Проектирование».
 *
 * GET  — состояние: задан ли пароль и есть ли сессия сейчас. Нужен редактору,
 *        чтобы показать нужную форму, а не молча ронять сохранение на 403.
 * POST — {"password": "..."} вход, либо {"claim": "..."} — задать пароль
 *        первый раз. Занять место можно ровно один раз.
 * DELETE — выход.
 *
 * Пароль приходит в теле POST, а не в адресе: адреса пишутся в логи сервера
 * и в историю браузера, тела запросов — нет.
 */
export const Route = createFileRoute("/api/design/session")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const access = await checkAccess(request);
        return Response.json({
          configured: await adminConfigured(),
          claimed: await ownerClaimed(),
          google: googleConfigured(),
          passwordClaimAvailable: await passwordClaimAvailable(),
          envSecret: envSecretConfigured(),
          minPasswordLength: MIN_PASSWORD_LENGTH,
          production: isProduction(),
          allowed: access.allowed,
          mode: access.allowed ? access.mode : null,
        });
      },

      POST: async ({ request }) => {
        let body: { password?: string; secret?: string; claim?: string };
        try {
          body = (await request.json()) as typeof body;
        } catch {
          return Response.json({ ok: false, reason: "bad_json" }, { status: 400 });
        }

        // Первый вход: пароля ещё нет, и его задают прямо здесь.
        if (body.claim !== undefined) {
          const password = body.claim.toString();
          if (password.length < MIN_PASSWORD_LENGTH) {
            return Response.json(
              {
                ok: false,
                reason: "too-short",
                message: `Пароль короче ${MIN_PASSWORD_LENGTH} символов не принимается`,
              },
              { status: 400 },
            );
          }
          let claimed: boolean;
          try {
            claimed = await claimOwner(password);
          } catch (e) {
            return Response.json(
              { ok: false, reason: "storage", message: (e as Error).message },
              { status: 503 },
            );
          }
          if (!claimed) {
            return Response.json(
              {
                ok: false,
                reason: "already-claimed",
                message:
                  "Пароль уже задан. Введите его или задайте запасной через ECOCUB_ADMIN_SECRET.",
              },
              { status: 409 },
            );
          }
          const fresh = await issueToken(password);
          return Response.json(
            { ok: true, claimed: true },
            fresh ? { headers: { "Set-Cookie": sessionCookie(fresh) } } : undefined,
          );
        }

        if (!(await adminConfigured())) {
          return Response.json(
            {
              ok: false,
              reason: "not-configured",
              message: "Пароль ещё не задан. Обновите страницу — редактор предложит его придумать.",
            },
            { status: 503 },
          );
        }

        // `secret` оставлен ради совместимости с прежним телом запроса.
        const token = await issueToken((body.password ?? body.secret ?? "").toString());
        if (!token) {
          // Пауза против перебора. Секрет один, форма без ограничения частоты
          // запросов позволила бы молотить по ней сколько угодно.
          await new Promise((r) => setTimeout(r, 700));
          return Response.json({ ok: false, reason: "wrong-password" }, { status: 401 });
        }

        return Response.json({ ok: true }, { headers: { "Set-Cookie": sessionCookie(token) } });
      },

      DELETE: async () => Response.json({ ok: true }, { headers: { "Set-Cookie": clearCookie() } }),
    },
  },
});
