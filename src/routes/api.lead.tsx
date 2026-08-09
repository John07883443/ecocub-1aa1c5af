import { createFileRoute } from "@tanstack/react-router";
import { saveLead } from "@/lib/leads.server";

/**
 * POST /api/lead — единственная точка приёма заявок с сайта.
 *
 * Делает две вещи: кладёт заявку в базу на сервере и шлёт уведомление
 * в Telegram. Оба канала независимы — падение одного не отменяет другой,
 * и в ответе видно, что именно сработало.
 *
 * Раньше форма писала в базу напрямую из браузера анонимным ключом, а сюда
 * ходила только за уведомлением. Это означало, что слать записи в базу мог
 * кто угодно в обход сайта. Теперь запись возможна только отсюда.
 *
 * Токен и chat_id Telegram живут в переменных окружения сервера,
 * в код и в браузер они не попадают.
 */

type LeadPayload = {
  formType?: string;
  name?: string;
  phone?: string;
  email?: string;
  message?: string;
  attributionSummary?: string;
  sourcePage?: string;
  projectSlug?: string;
  payload?: unknown;
};

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const FORM_LABELS: Record<string, string> = {
  contact: "Обратная связь",
  project: "Заявка по проекту",
  presentation: "Запрос презентации",
  callback: "Обратный звонок",
  quiz: "Квиз · подбор проекта",
  dream: "Дом мечты · карта потребностей",
};

async function notifyTelegram(p: LeadPayload, name: string, phone: string): Promise<boolean> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return false;

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
  if (p.attributionSummary)
    lines.push(`Источник: ${esc(p.attributionSummary.toString().slice(0, 300))}`);

  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text: lines.join("\n"), parse_mode: "HTML" }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export const Route = createFileRoute("/api/lead")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let p: LeadPayload;
        try {
          p = (await request.json()) as LeadPayload;
        } catch {
          return Response.json({ ok: false, reason: "bad_json" }, { status: 400 });
        }

        const name = (p.name ?? "").toString().slice(0, 100).trim();
        const phone = (p.phone ?? "").toString().slice(0, 30).trim();
        if (name.length < 2 || phone.length < 5) {
          return Response.json({ ok: false, reason: "invalid" }, { status: 400 });
        }

        // Каналы независимы, поэтому запускаем оба и ждём вместе: Telegram
        // ходит по сети, и незачем задерживать на нём ответ форме.
        const [stored, notified] = await Promise.all([
          saveLead({
            formType: p.formType ?? "contact",
            name,
            phone,
            email: p.email ?? null,
            message: p.message ?? null,
            projectSlug: p.projectSlug ?? null,
            sourcePage: p.sourcePage ?? null,
            payload: p.payload,
          }),
          notifyTelegram(p, name, phone),
        ]);

        // Ошибку отдаём, только если заявка не ушла НИ ОДНИМ путём: тогда
        // человеку надо показать сбой и попросить повторить. Если сработал
        // хотя бы один канал, лид не потерян и форма считается отправленной.
        if (!stored && !notified) {
          return Response.json({ ok: false, stored, notified }, { status: 500 });
        }
        return Response.json({ ok: true, stored, notified });
      },
    },
  },
});
