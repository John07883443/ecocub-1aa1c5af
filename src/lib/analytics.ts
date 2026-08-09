/**
 * Событийная аналитика EcoCub.
 *
 * Цель — измерять не визиты, а путь к заявке: докуда дочитали, что смотрели,
 * где бросили форму. Все события уходят в Яндекс.Метрику как цели (reachGoal)
 * с параметрами (params), поэтому читаются через Reporting API локальным
 * агентом и ложатся в недельный цикл оптимизации.
 *
 * Правила именования целей: SCREAMING_SNAKE, префикс по группе.
 * Любое новое событие добавлять сюда, а не вызывать ym() по месту.
 */

import { addEngagement } from "./attribution";

const METRIKA_ID = 102678553;

type Params = Record<string, string | number | boolean | undefined>;

declare global {
  interface Window {
    ym?: (id: number, action: string, ...args: unknown[]) => void;
  }
}

/**
 * Вес события в балле вовлечённости — чем ближе действие к заявке, тем дороже.
 * Цифры подобраны экспертно и будут перекалиброваны, когда накопится связка
 * «балл при заявке → закрытая сделка».
 */
const WEIGHTS: Record<string, number> = {
  SCROLL_50: 3,
  SCROLL_75: 5,
  SCROLL_100: 7,
  TIME_30S: 3,
  TIME_60S: 6,
  TIME_180S: 12,
  PROJECT_VIEW: 10,
  PRICING_VIEW: 15,
  PRESENTATION_DOWNLOAD: 20,
  ARTICLE_READ: 8,
  CTA_CLICK: 10,
  CONTACT_CLICK: 25,
  FORM_START: 20,
  QUIZ_START: 8,
  QUIZ_COMPLETE: 25,
};

/** Базовая отправка цели. Безопасна на сервере и при заблокированном счётчике. */
export function track(goal: string, params?: Params) {
  if (typeof window === "undefined") return;
  try {
    window.ym?.(METRIKA_ID, "reachGoal", goal, params);
  } catch {
    /* аналитика никогда не ломает страницу */
  }
  const weight = WEIGHTS[goal];
  if (weight) addEngagement(weight);
}

/** Отправка пользовательских параметров визита (не цель, а срез аудитории). */
export function setVisitParams(params: Params) {
  if (typeof window === "undefined") return;
  try {
    window.ym?.(METRIKA_ID, "params", params);
  } catch {
    /* no-op */
  }
}

/* ------------------------------------------------------------------ */
/* Готовые события                                                     */
/* ------------------------------------------------------------------ */

export const analytics = {
  /** Глубина прокрутки страницы: 25/50/75/100 % — каждый порог один раз. */
  scrollDepth: (percent: 25 | 50 | 75 | 100, page: string) => track(`SCROLL_${percent}`, { page }),

  /** Секунды вовлечённого чтения (без учёта фоновой вкладки): 30/60/180. */
  engagedTime: (seconds: 30 | 60 | 180, page: string) => track(`TIME_${seconds}S`, { page }),

  /** Клик по любому CTA. place — где именно (hero, sticky, footer, card). */
  ctaClick: (place: string, label: string) => track("CTA_CLICK", { place, label }),

  /** Открыта карточка проекта. */
  projectView: (slug: string) => track("PROJECT_VIEW", { slug }),

  /** Первое касание формы — человек начал заполнять. */
  formStart: (formType: string, page: string) => track("FORM_START", { formType, page }),

  /** Форма отправлена успешно. */
  formSubmit: (formType: string, page: string, projectSlug?: string) =>
    track("FORM_SUBMIT", { formType, page, projectSlug }),

  /** Форма начата, но брошена — самое ценное событие для оптимизации. */
  formAbandon: (formType: string, page: string, lastField: string) =>
    track("FORM_ABANDON", { formType, page, lastField }),

  /** Ошибка валидации — показывает, какое поле мешает людям. */
  formError: (formType: string, field: string) => track("FORM_ERROR", { formType, field }),

  /** Клик по телефону / мессенджеру. */
  contactClick: (channel: "phone" | "whatsapp" | "telegram", place: string) =>
    track("CONTACT_CLICK", { channel, place }),

  /** Скачивание презентации. */
  presentationDownload: (page: string) => track("PRESENTATION_DOWNLOAD", { page }),

  /** Прочитана статья блога (дочитал до конца). */
  articleRead: (slug: string) => track("ARTICLE_READ", { slug }),

  /** Просмотр блока цен — маркер горячего интереса. */
  pricingView: (page: string) => track("PRICING_VIEW", { page }),

  /** Пользователь начал проходить квиз подбора проекта (первый ответ). */
  quizStart: () => track("QUIZ_START"),

  /** Ответ на шаг квиза — по нему видно, где люди отваливаются. */
  quizStep: (step: string, value: string) => track("QUIZ_STEP", { step, value }),

  /** Квиз пройден и заявка отправлена. */
  quizComplete: () => track("QUIZ_COMPLETE"),
};
