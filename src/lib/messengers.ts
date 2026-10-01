/**
 * Ссылки в мессенджеры с заранее набранным текстом.
 *
 * Контакты не дублируются: номер WhatsApp и ник Telegram берутся из тех же
 * site.whatsappHref / site.telegramHref, что стоят в подвале и на /contacts.
 *
 * WhatsApp: wa.me/<номер>?text=… — поддерживается везде.
 * Telegram: t.me/<ник>?text=… — свежие клиенты подставляют текст в поле
 * ввода, старые просто открывают чат. Поэтому openMessenger дополнительно
 * кладёт текст в буфер обмена: человеку остаётся вставить.
 */

import { site } from "./site.ts";

export type Messenger = "telegram" | "whatsapp";

/** Предел длины: длинный URL часть клиентов режет молча. */
const MAX_TEXT = 900;

export function messengerHref(channel: Messenger, text?: string): string {
  const base = channel === "telegram" ? site.telegramHref : site.whatsappHref;
  if (!text) return base;
  const t = text.length > MAX_TEXT ? text.slice(0, MAX_TEXT - 1) + "…" : text;
  return `${base}?text=${encodeURIComponent(t)}`;
}

/**
 * Открыть чат с готовым текстом. Вызывать из обработчика клика — иначе
 * браузер заблокирует новое окно. Возвращает true, если текст удалось
 * скопировать в буфер (можно показать подсказку «текст скопирован»).
 */
export async function openMessenger(channel: Messenger, text: string): Promise<boolean> {
  // Окно открываем синхронно, до любого await: так его не режет блокировщик.
  window.open(messengerHref(channel, text), "_blank", "noopener,noreferrer");
  try {
    await navigator.clipboard?.writeText(text);
    return !!navigator.clipboard;
  } catch {
    return false;
  }
}
