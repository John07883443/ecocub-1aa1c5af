import { createFileRoute } from "@tanstack/react-router";

/**
 * POST /api/notify — уведомление о новой заявке в Telegram.
 * Токен и chat_id задаются в секретах окружения (Cloudflare/hosting),
 * в код и в браузер они не попадают.
 */

type NotifyPayload = {
  formType?: string;
  name?: string;
  phone?: string;
  email?: string;
  message?: string;
  sourcePage?: string;
  projectSlug?: string;
};

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const FORM_LABELS: Record<string, string> = {
  contact: "Обратная связь",
  project: "Заявка по проекту",
  presentation: "Запрос презентации",
  callback: "Обратный звонок",
};

export const Route = createFileRoute("/api/notify")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const token = process.env.TELEGRAM_BOT_TOKEN;
        const chatId = process.env.TELEGRAM_CHAT_ID;
        if (!token || !chatId) {
          // Секреты не настроены — заявка всё равно сохранена в базе формой.
          return Response.json({ ok: false, reason: "not_configured" }, { status: 200 });
        }

        let p: NotifyPayload;
        try {
          p = (await request.json()) as NotifyPayload;
        } catch {
          return Response.json({ ok: false, reason: "bad_json" }, { status: 400 });
        }

        const name = (p.name ?? "").toString().slice(0, 100).trim();
        const phone = (p.phone ?? "").toString().slice(0, 30).trim();
        if (name.length < 2 || phone.length < 5) {
          return Response.json({ ok: false, reason: "invalid" }, { status: 400 });
        }

        const lines = [
          `<b>Новая заявка с eco-cub.ru</b>`,
          `Тип: ${esc(FORM_LABELS[p.formType ?? ""] ?? p.formType ?? "—")}`,
          `Имя: ${esc(name)}`,
          `Телефон: ${esc(phone)}`,
        ];
        if (p.email) lines.push(`Email: ${esc(p.email.toString().slice(0, 200))}`);
        if (p.projectSlug) lines.push(`Проект: ${esc(p.projectSlug.toString().slice(0, 100))}`);
        if (p.sourcePage) lines.push(`Страница: ${esc(p.sourcePage.toString().slice(0, 200))}`);
        if (p.message) lines.push(`Сообщение: ${esc(p.message.toString().slice(0, 500))}`);

        try {
          const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              chat_id: chatId,
              text: lines.join("\n"),
              parse_mode: "HTML",
            }),
          });
          return Response.json({ ok: res.ok });
        } catch {
          return Response.json({ ok: false, reason: "telegram_error" }, { status: 200 });
        }
      },
    },
  },
});
