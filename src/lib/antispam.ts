/**
 * Минимальная защита форм заявок от ботов — без капчи.
 *
 * Два признака, оба проверяются на сервере (api.lead.tsx):
 * 1. Honeypot. В форме есть поле `website`, спрятанное от человека (вне экрана,
 *    aria-hidden, tabIndex -1, autocomplete off). Человек его не видит и не
 *    заполняет; бот, заполняющий все поля подряд, заполняет.
 * 2. Время до отправки. Форма запоминает момент первой отрисовки и шлёт
 *    `elapsedMs`. Человек не успеет ввести имя, телефон и поставить галочку
 *    быстрее MIN_FILL_MS.
 *
 * Отсутствие elapsedMs НЕ считается спамом: старые вкладки, открытые до
 * выкладки, шлют форму без него, и терять из-за этого живую заявку нельзя.
 *
 * Боту отвечаем «ok», а заявку молча выбрасываем — иначе он узнает, что его
 * поймали, и подстроится.
 */

export const HONEYPOT_FIELD = "website";
export const MIN_FILL_MS = 2500;

export type SpamVerdict = { spam: false } | { spam: true; reason: "honeypot" | "too_fast" };

export function checkSpam(input: { honeypot?: unknown; elapsedMs?: unknown }): SpamVerdict {
  if (typeof input.honeypot === "string" && input.honeypot.trim() !== "") {
    return { spam: true, reason: "honeypot" };
  }
  const ms = typeof input.elapsedMs === "number" ? input.elapsedMs : NaN;
  if (Number.isFinite(ms) && ms >= 0 && ms < MIN_FILL_MS) {
    return { spam: true, reason: "too_fast" };
  }
  return { spam: false };
}
