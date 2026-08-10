/**
 * Настройки AI-планировки. Только сервер.
 *
 * Всё, что можно выключить, выключено по умолчанию: без явного
 * AI_LAYOUT_ENABLED=1 функция не работает вообще, а провайдером по умолчанию
 * стоит заглушка. Ключи читаются здесь и дальше config не покидают — наружу
 * уходит только publicConfig(), где секретов нет по построению.
 */

/** Заглушка, боевой провайдер и ручной режим — других вариантов нет. */
export type ProviderKind = "mock" | "higgsfield" | "manual";

export interface AiLayoutConfig {
  enabled: boolean;
  /** Аварийный выключатель: перекрывает enabled, не трогая остальные настройки. */
  killSwitch: boolean;
  provider: ProviderKind;
  /** Сколько генераций получает один посетитель бесплатно. */
  freePerVisitor: number;
  /** Потолок на все генерации за сутки — защита кошелька от всплеска. */
  dailyLimit: number;
  /** Путь, по которому создаётся задание. В публичной документации его нет. */
  submitPath: string;
  /** Идентификатор модели: уходит полем job_type в теле запроса. */
  jobType: string;
  /** Тариф генерации. Выбран по замерам этапа 0: 1k + low = 0.5 кредита. */
  resolution: string;
  quality: string;
  apiBase: string;
  apiKey: string | null;
  apiSecret: string | null;
  /** Абсолютный адрес сайта: провайдер забирает исходник по ссылке. */
  publicBase: string;
  /** Соль для HMAC поверх IP. Без неё посетители не различаются. */
  visitorSecret: string | null;
  /** Сколько ждать провайдера, прежде чем признать генерацию неудачной. */
  timeoutMs: number;
}

const DEFAULTS = {
  apiBase: "https://platform.higgsfield.ai",
  // Выбор этапа 0: точный контур и полная планировка за 0.5 кредита.
  jobType: "gpt_image_2",
  resolution: "1k",
  quality: "low",
  freePerVisitor: 1,
  dailyLimit: 50,
  timeoutMs: 180_000,
};

function num(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function flag(value: string | undefined): boolean {
  return value === "1" || value === "true" || value === "yes";
}

export function readConfig(env: NodeJS.ProcessEnv = process.env): AiLayoutConfig {
  const provider = env.AI_LAYOUT_PROVIDER;
  return {
    enabled: flag(env.AI_LAYOUT_ENABLED),
    killSwitch: flag(env.AI_LAYOUT_KILL_SWITCH),
    provider: provider === "higgsfield" || provider === "manual" ? provider : "mock",
    freePerVisitor: num(env.AI_LAYOUT_FREE_PER_VISITOR, DEFAULTS.freePerVisitor),
    dailyLimit: num(env.AI_LAYOUT_DAILY_LIMIT, DEFAULTS.dailyLimit),
    submitPath: env.AI_LAYOUT_SUBMIT_PATH || "",
    jobType: env.AI_LAYOUT_JOB_TYPE || DEFAULTS.jobType,
    resolution: env.AI_LAYOUT_RESOLUTION || DEFAULTS.resolution,
    quality: env.AI_LAYOUT_QUALITY || DEFAULTS.quality,
    apiBase: (env.AI_LAYOUT_API_BASE || DEFAULTS.apiBase).replace(/\/+$/, ""),
    apiKey: env.HIGGSFIELD_API_KEY || null,
    apiSecret: env.HIGGSFIELD_API_SECRET || null,
    publicBase: (env.AI_LAYOUT_PUBLIC_BASE || "https://eco-cub.ru").replace(/\/+$/, ""),
    visitorSecret: env.AI_LAYOUT_VISITOR_SECRET || null,
    timeoutMs: num(env.AI_LAYOUT_TIMEOUT_MS, DEFAULTS.timeoutMs),
  };
}

/** Работает ли функция прямо сейчас — и если нет, то почему. */
export function availability(config: AiLayoutConfig): { ok: boolean; reason?: string } {
  if (config.killSwitch) return { ok: false, reason: "kill_switch" };
  if (!config.enabled) return { ok: false, reason: "disabled" };
  if (!config.visitorSecret) return { ok: false, reason: "no_visitor_secret" };

  if (config.provider === "higgsfield") {
    // Публичная документация Higgsfield описывает только text-to-image и не
    // называет адрес, по которому создаётся задание с исходным изображением.
    // Угадывать его нельзя: промах — это либо ошибка, либо чужая модель за
    // деньги владельца. Пока путь не задан явно, провайдер не работает.
    if (!config.apiKey || !config.apiSecret) return { ok: false, reason: "no_credentials" };
    if (!config.submitPath) return { ok: false, reason: "no_submit_path" };
  }
  return { ok: true };
}

/**
 * То, что можно отдать в браузер. Список полей закрытый: добавить сюда ключ
 * можно только осознанно, случайно он здесь не окажется.
 */
export function publicConfig(config: AiLayoutConfig): {
  available: boolean;
  isMock: boolean;
  isManual: boolean;
  freePerVisitor: number;
} {
  return {
    available: availability(config).ok,
    isMock: config.provider === "mock",
    isManual: config.provider === "manual",
    freePerVisitor: config.freePerVisitor,
  };
}
