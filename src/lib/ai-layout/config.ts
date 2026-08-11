/**
 * Настройки AI-планировки. Только сервер.
 *
 * Всё, что можно выключить, выключено по умолчанию: без явного
 * AI_LAYOUT_ENABLED=1 функция не работает вообще, а провайдером по умолчанию
 * стоит заглушка. Ключи читаются здесь и дальше config не покидают — наружу
 * уходит только publicConfig(), где секретов нет по построению.
 */

/** Заглушка, два боевых провайдера и ручной режим — других вариантов нет. */
export type ProviderKind = "mock" | "openrouter" | "higgsfield" | "manual";

export interface AiLayoutConfig {
  enabled: boolean;
  /** Аварийный выключатель: перекрывает enabled, не трогая остальные настройки. */
  killSwitch: boolean;
  provider: ProviderKind;
  /** Сколько генераций получает один посетитель бесплатно. Ноль — без счёта. */
  freePerVisitor: number;
  /** Потолок на все генерации за сутки. Ноль — без потолка. */
  dailyLimit: number;
  /** Путь создания задания у Higgsfield. Обязателен: угадать его нельзя. */
  submitPath: string;
  /** Идентификатор модели у выбранного провайдера. Входит в ключ запроса. */
  model: string;
  /** Разрешение. Нужно только Higgsfield: у OpenRouter его нет в запросе. */
  resolution: string;
  /** Тариф качества. Выбран по замерам этапа 0: на плане линии, а не фактура,
   *  и повышение тарифа стоит денег, не добавляя читаемости. */
  quality: string;
  apiBase: string;
  apiKey: string | null;
  /** Второй ключ нужен только Higgsfield: у него авторизация парой. */
  apiSecret: string | null;
  /**
   * Адрес ретранслятора. Задан — запрос идёт через него, а ключ провайдера
   * живёт там же и на нашем сервере не хранится вовсе.
   */
  relayUrl: string;
  /** Общий секрет ретранслятора: без него это был бы открытый прокси. */
  relaySecret: string | null;
  /** Абсолютный адрес сайта: провайдер забирает исходник по ссылке. */
  publicBase: string;
  /** Соль для HMAC поверх IP. Без неё посетители не различаются. */
  visitorSecret: string | null;
  /** Сколько ждать провайдера, прежде чем признать генерацию неудачной. */
  timeoutMs: number;
}

const DEFAULTS = {
  // Провайдер по умолчанию — OpenRouter: у Higgsfield нужная модель через
  // публичный REST недоступна, а каталога путей нет вовсе (см. INTEGRATION.md).
  apiBase: "https://openrouter.ai/api/v1",
  higgsfieldBase: "https://platform.higgsfield.ai",
  // Выбор этапа 0: единственная модель, удержавшая контур и давшая полную
  // планировку. У OpenRouter она называется так же, с дефисами.
  model: "openai/gpt-image-2",
  resolution: "1k",
  quality: "low",
  // Лимиты сняли 10.08.2026 на время тестов и вернули 11.08.2026 по просьбе
  // владельца: генерация тратит деньги с кошелька OpenRouter, а повторные
  // запросы с одного адреса — самый простой способ этот кошелёк опустошить.
  //
  // Одна бесплатная генерация на посетителя и полсотни в сутки на всех. Ноль
  // по-прежнему означает «без ограничения» — при нуле проверка не
  // выполняется вовсе, — так что снять лимиты обратно можно переменными
  // окружения, не трогая код.
  //
  // Повторный запрос той же самой сборки денег не стоит в любом случае:
  // результат отдаётся из кэша по ключу дома, провайдер не вызывается.
  freePerVisitor: 1,
  dailyLimit: 50,
  // На двадцать секунд меньше, чем лимит функции Supabase на бесплатном
  // тарифе (150 с). Так мы получаем внятную ошибку раньше, чем ретранслятор
  // оборвётся сам, а не гадаем, что произошло.
  timeoutMs: 140_000,
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
    provider:
      provider === "openrouter" || provider === "higgsfield" || provider === "manual"
        ? provider
        : "mock",
    freePerVisitor: num(env.AI_LAYOUT_FREE_PER_VISITOR, DEFAULTS.freePerVisitor),
    dailyLimit: num(env.AI_LAYOUT_DAILY_LIMIT, DEFAULTS.dailyLimit),
    submitPath: env.AI_LAYOUT_SUBMIT_PATH || "",
    model: env.AI_LAYOUT_MODEL || DEFAULTS.model,
    resolution: env.AI_LAYOUT_RESOLUTION || DEFAULTS.resolution,
    quality: env.AI_LAYOUT_QUALITY || DEFAULTS.quality,
    apiBase: (
      env.AI_LAYOUT_API_BASE ||
      (provider === "higgsfield" ? DEFAULTS.higgsfieldBase : DEFAULTS.apiBase)
    ).replace(/\/+$/, ""),
    // У каждого провайдера свой ключ: перепутать их нельзя даже случайно.
    apiKey: (provider === "higgsfield" ? env.HIGGSFIELD_API_KEY : env.OPENROUTER_API_KEY) || null,
    apiSecret: env.HIGGSFIELD_API_SECRET || null,
    relayUrl: (env.AI_LAYOUT_RELAY_URL || "").replace(/\/+$/, ""),
    relaySecret: env.AI_LAYOUT_RELAY_SECRET || null,
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

  if (config.provider === "openrouter") {
    // Через ретранслятор ключ провайдера нам не нужен: он лежит там.
    // Зато обязателен общий секрет, иначе дверь наружу открыта всем.
    if (config.relayUrl) {
      if (!config.relaySecret) return { ok: false, reason: "no_relay_secret" };
    } else if (!config.apiKey) {
      return { ok: false, reason: "no_credentials" };
    }
  }
  if (config.provider === "higgsfield") {
    if (!config.apiKey || !config.apiSecret) return { ok: false, reason: "no_credentials" };
    if (!submitPath(config)) return { ok: false, reason: "no_submit_path" };
  }
  return { ok: true };
}

/**
 * Куда уходит запрос на генерацию.
 *
 * Раньше здесь стоял запасной путь — сам идентификатор модели. Живой запрос
 * показал, что это неверное умолчание: POST /gpt_image_2 вернул model_not_found,
 * потому что у платформы путь составной и включает поставщика
 * (в документации: higgsfield-ai/soul/standard, reve/text-to-image).
 *
 * Умолчания больше нет намеренно. Ненастроенная функция должна честно
 * сообщать «не настроена», а не отправлять запросы по выдуманному адресу и
 * получать невнятную ошибку на каждое нажатие кнопки.
 */
export function submitPath(config: AiLayoutConfig): string {
  return config.submitPath.replace(/^\/+|\/+$/g, "");
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
