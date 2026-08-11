import { createFileRoute } from "@tanstack/react-router";
import { isProduction } from "@/lib/design-auth.server";
import {
  authorizationUrl,
  googleConfigured,
  makeState,
  stateCookie,
} from "@/lib/design-google.server";

/**
 * Начало входа через Google: браузер уходит на страницу согласия.
 *
 * Отдельный адрес, а не ссылка прямо на Google, нужен ради состояния: сервер
 * выдаёт одноразовую строку, кладёт её в куку и вкладывает в ссылку. На
 * возврате обе половины сверяются — так посторонний сайт не сможет подсунуть
 * владельцу чужой ответ Google.
 */
export const Route = createFileRoute("/api/design/oauth/start")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!googleConfigured()) {
          return new Response(
            "Вход через Google на этом сервере не настроен: не заданы GOOGLE_OAUTH_CLIENT_ID и GOOGLE_OAUTH_CLIENT_SECRET.",
            { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } },
          );
        }

        const state = await makeState();
        return new Response(null, {
          status: 302,
          headers: {
            Location: authorizationUrl(request, state),
            "Set-Cookie": stateCookie(state, isProduction()),
          },
        });
      },
    },
  },
});
