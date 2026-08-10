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

/**
 * События экспериментальной версии /constructor-ai-v3.
 * Отдельный неймспейс V3_*, чтобы в Метрике эксперимент читался одним срезом
 * и не смешивался с боевыми воронками. Персональные данные и свободный текст
 * пользователя в параметры не передаются — только ID, этапы и диапазоны.
 */
export const analyticsV3 = {
  opened: () => track("V3_OPENED"),
  pathSelected: (path: "guided" | "manual" | "resume") => track("V3_PATH_SELECTED", { path }),
  quizStarted: () => track("V3_QUIZ_STARTED"),
  quizCompleted: () => track("V3_QUIZ_COMPLETED"),
  lifestyleStarted: () => track("V3_LIFESTYLE_STARTED"),
  lifestyleCompleted: (questionsShown: number) =>
    track("V3_LIFESTYLE_COMPLETED", { questionsShown }),
  recommendationsShown: (count: number, topPlanId?: string) =>
    track("V3_RECOMMENDATIONS_SHOWN", { count, topPlanId }),
  planSelected: (planId: string, kind: string) => track("V3_PLAN_SELECTED", { planId, kind }),
  planModified: (action: string, planId?: string) => track("V3_PLAN_MODIFIED", { action, planId }),
  plotStarted: () => track("V3_PLOT_STARTED"),
  plotCompleted: (fits: boolean) => track("V3_PLOT_COMPLETED", { fits }),
  facadeSelected: (presetId: string) => track("V3_FACADE_SELECTED", { presetId }),
  renderRequested: (projectId: string, provider: string) =>
    track("V3_RENDER_REQUESTED", { projectId, provider }),
  telegramClicked: (projectId: string) => track("V3_TELEGRAM_CLICKED", { projectId }),
  leadSubmitted: (projectId: string, planId?: string) =>
    track("V3_LEAD_SUBMITTED", { projectId, planId }),
  projectRestored: (projectId: string) => track("V3_PROJECT_RESTORED", { projectId }),
  error: (stage: string, message: string) =>
    track("V3_ERROR", { stage, message: message.slice(0, 120) }),
};

/**
 * События конструктора v3.1 (/constructor-ai-v3-1). Отдельный префикс —
 * чтобы сравнивать версии между собой. Персональных данных, свободного
 * текста и абсолютных координат проекта в параметрах нет; события шлются
 * по завершённому действию, а не на каждый кадр перетаскивания.
 */
export const analyticsV31 = {
  opened: () => track("V31_OPENED"),
  pathSelected: (path: "guided" | "manual" | "resume") => track("V31_PATH_SELECTED", { path }),
  quizStarted: () => track("V31_QUIZ_STARTED"),
  quizCompleted: () => track("V31_QUIZ_COMPLETED"),
  lifestyleCompleted: (questionsShown: number) =>
    track("V31_LIFESTYLE_COMPLETED", { questionsShown }),
  recommendationsShown: (count: number, topPlanId?: string) =>
    track("V31_RECOMMENDATIONS_SHOWN", { count, topPlanId }),
  planSelected: (planId: string, kind: string) => track("V31_PLAN_SELECTED", { planId, kind }),

  viewModeChanged: (mode: "together" | "plan" | "3d") => track("V31_VIEW_MODE", { mode }),
  toolContextChanged: (context: "house" | "site") => track("V31_TOOL_CONTEXT", { context }),
  roomAdded: (type: string, floor: number) => track("V31_ROOM_ADDED", { type, floor }),
  entrywayAdded: () => track("V31_ENTRYWAY_ADDED"),
  moduleSelected: (type: string, floor: number) => track("V31_MODULE_SELECTED", { type, floor }),
  moduleMenuOpened: (input: "mouse" | "touch" | "keyboard") =>
    track("V31_MODULE_MENU_OPENED", { input }),
  moduleSnapped: (side: string, result: "snapped" | "free") =>
    track("V31_MODULE_SNAPPED", { side, result }),
  moduleDeleteRequested: () => track("V31_MODULE_DELETE_REQUESTED"),
  moduleDeleteBlocked: (reason: "connectivity" | "support") =>
    track("V31_MODULE_DELETE_BLOCKED", { reason }),
  moduleDeleted: () => track("V31_MODULE_DELETED"),
  connectivityWarningShown: () => track("V31_CONNECTIVITY_WARNING"),
  furnitureVariantRequested: (roomType: string) =>
    track("V31_FURNITURE_VARIANT_REQUESTED", { roomType }),
  furnitureFallbackShown: (roomType: string) => track("V31_FURNITURE_FALLBACK", { roomType }),
  clearRequested: () => track("V31_CLEAR_REQUESTED"),
  cleared: () => track("V31_CLEARED"),
  basePlanRestored: () => track("V31_BASE_PLAN_RESTORED"),
  expanded3d: () => track("V31_3D_EXPANDED"),
  webglFallbackShown: () => track("V31_WEBGL_FALLBACK"),

  siteDimensionsChanged: () => track("V31_SITE_DIMENSIONS_CHANGED"),
  siteAccessSideChanged: (side: string) => track("V31_SITE_ACCESS_SIDE", { side }),
  sitePlacementPreset: (preset: "west" | "center" | "east") =>
    track("V31_SITE_PLACEMENT_PRESET", { preset }),
  housePlacementChanged: () => track("V31_HOUSE_PLACEMENT_CHANGED"),

  facadeStyleSelected: (styleId: string) => track("V31_FACADE_STYLE_SELECTED", { styleId }),
  leadSubmitted: (projectId: string, planId?: string) =>
    track("V31_LEAD_SUBMITTED", { projectId, planId }),
  telegramClicked: (projectId: string) => track("V31_TELEGRAM_CLICKED", { projectId }),
  projectRestored: (projectId: string) => track("V31_PROJECT_RESTORED", { projectId }),
};

/**
 * События AI-планировки (блок под конструктором). Отдельный префикс: функция
 * платная, и её воронку надо считать отдельно от остального конструктора.
 *
 * В параметрах нет ни телефона, ни адреса, ни ключа задания, ни абсолютных
 * координат дома — только обезличенные размеры конфигурации и причина отказа.
 * Причина приходит из закрытого списка сервера, свободного текста в ней быть
 * не может.
 */
export const analyticsAiLayout = {
  shown: () => track("AI_LAYOUT_SHOWN"),
  requested: (modules: number, bedrooms: number, bathrooms: number) =>
    track("AI_LAYOUT_REQUESTED", { modules, bedrooms, bathrooms }),
  succeeded: (seconds: number) => track("AI_LAYOUT_SUCCEEDED", { seconds }),
  failed: (reason: string) => track("AI_LAYOUT_FAILED", { reason }),
  limitReached: (kind: "visitor" | "daily") => track("AI_LAYOUT_LIMIT", { kind }),
  leadClicked: () => track("AI_LAYOUT_LEAD_CLICKED"),
};
