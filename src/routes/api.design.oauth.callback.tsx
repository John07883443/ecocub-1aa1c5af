import { createFileRoute } from "@tanstack/react-router";
import { issueTokenForOwner, sessionCookie } from "@/lib/design-auth.server";
import {
  clearStateCookie,
  exchangeCode,
  googleConfigured,
  loginWithEmail,
  readStateCookie,
} from "@/lib/design-google.server";

/**
 * Возврат из Google.
 *
 * Отвечает не JSON, а перенаправлением на /design: сюда браузер приходит сам,
 * переходом со страницы согласия, и человек должен оказаться в редакторе, а
 * не смотреть на служебный ответ. Причина отказа передаётся параметром адреса
 * — редактор показывает её понятной строкой.
 */
function back(reason?: string): Response {
  const location = reason ? `/design?oauth=${encodeURIComponent(reason)}` : "/design";
  return new Response(null, {
    status: 302,
    headers: { Location: location, "Set-Cookie": clearStateCookie() },
  });
}

export const Route = createFileRoute("/api/design/oauth/callback")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!googleConfigured()) return back("not-configured");

        const url = new URL(request.url);
        // Человек мог нажать «Отмена» в окне Google — это не ошибка.
        if (url.searchParams.get("error")) return back("cancelled");

        const code = url.searchParams.get("code");
        const state = url.searchParams.get("state");
        const expected = readStateCookie(request);
        if (!code || !state || !expected || state !== expected) return back("bad-state");

        const identity = await exchangeCode(request, code);
        if (!identity) return back("exchange-failed");

        const result = await loginWithEmail(identity);
        if (!result.ok) return back(result.reason);

        const token = await issueTokenForOwner();
        if (!token) return back("storage");

        return new Response(null, {
          status: 302,
          headers: [
            ["Location", result.claimed ? "/design?oauth=claimed" : "/design"],
            ["Set-Cookie", clearStateCookie()],
            ["Set-Cookie", sessionCookie(token)],
          ],
        });
      },
    },
  },
});
