/**
 * Провайдеры генерации планировки.
 *
 * Слой существует ради одного: конкретная модель — сменная деталь. Этап 0
 * показал, что половина моделей контур дома не удерживает (см. README.md),
 * и выбранная сегодня может завтра подорожать или пропасть. Всё остальное
 * приложение знает только про интерфейс.
 *
 * Секреты сюда приходят из config.ts и наружу не возвращаются: в результате
 * есть ссылка на картинку и статус, ключей в нём нет.
 */

import { submitPath, type AiLayoutConfig } from "./config.ts";

export interface LayoutRequest {
  /** Абсолютная ссылка на исходник — провайдер забирает его сам. */
  footprintUrl: string;
  prompt: string;
  /** Ключ идемпотентности: тот же ключ не должен списывать деньги дважды. */
  key: string;
  /**
   * Куда положить картинку, если провайдер вернул байты, а не ссылку.
   * Возвращает адрес на сайте либо null, если сохранить не удалось.
   */
  store?: (key: string, bytes: Uint8Array) => Promise<string | null>;
}

export type LayoutResult =
  | { status: "completed"; imageUrl: string; isMock?: boolean; costUsd?: number }
  | { status: "pending"; externalId: string }
  | { status: "queued_manual" }
  | { status: "failed"; reason: string };

export interface LayoutImageProvider {
  readonly kind: string;
  /** Как называть источник в интерфейсе. Мок обязан признаваться моком. */
  readonly label: string;
  start(request: LayoutRequest): Promise<LayoutResult>;
  /** Опрос состояния. У синхронных провайдеров может отсутствовать. */
  poll?(externalId: string): Promise<LayoutResult>;
}

/* ------------------------------------------------------------------ */
/* Заглушка                                                            */
/* ------------------------------------------------------------------ */

/**
 * Ничего не генерирует и не тратит денег: возвращает тот же исходник.
 * Нужна, чтобы весь путь — квоты, идемпотентность, интерфейс — можно было
 * прогонять без единого обращения к платному API.
 *
 * Флаг isMock обязателен и поднимается наверх до самого экрана: выдавать
 * заглушку за настоящую планировку нельзя.
 */
export class MockLayoutProvider implements LayoutImageProvider {
  readonly kind = "mock";
  readonly label = "заглушка (генерация выключена)";

  async start(request: LayoutRequest): Promise<LayoutResult> {
    return { status: "completed", imageUrl: request.footprintUrl, isMock: true };
  }
}

/* ------------------------------------------------------------------ */
/* Ручной режим                                                        */
/* ------------------------------------------------------------------ */

/**
 * Запрос принимается, но рисует человек. Режим на случай, когда доступ к API
 * ещё не выдан, а показывать функцию уже хочется: посетитель получает честное
 * «пришлём планировку», а не выдуманную картинку.
 */
export class ManualLayoutProvider implements LayoutImageProvider {
  readonly kind = "manual";
  readonly label = "ручная отрисовка";

  async start(): Promise<LayoutResult> {
    return { status: "queued_manual" };
  }
}

/* ------------------------------------------------------------------ */
/* Higgsfield                                                          */
/* ------------------------------------------------------------------ */

/**
 * Боевой провайдер Higgsfield.
 *
 * Подтверждено официальной документацией: база platform.higgsfield.ai,
 * заголовок `Authorization: Key id:secret`, состояние читается с
 * GET /requests/{id}/status со значениями queued / in_progress / nsfw /
 * failed / completed, результат лежит в массиве images.
 *
 * Форма запроса с исходным изображением публично не описана — её назвал
 * ассистент платформы: идентификатор модели служит путём (POST /gpt_image_2),
 * исходник передаётся массивом medias, тариф — объектом params, а в ответе
 * приходят request_id и готовая ссылка status_url.
 *
 * Тело собрано ровно по присланному примеру cURL, без единого лишнего поля.
 * Строгость API не проверена: до первого живого запроса неизвестно, игнорирует
 * он незнакомые поля или отвергает запрос целиком. Пока это так, отправлять
 * что-либо сверх примера — риск без выгоды. Это касается и поля job_type,
 * которое ассистент платформы предлагал дублировать в теле, хотя модель
 * задаётся путём запроса.
 */
export class HiggsfieldProvider implements LayoutImageProvider {
  readonly kind = "higgsfield";
  readonly label = "Higgsfield";

  // Поле объявлено отдельно: сокращённая запись через параметр конструктора
  // не переживает разбор типов в тестовом раннере Node.
  private readonly config: AiLayoutConfig;

  constructor(config: AiLayoutConfig) {
    this.config = config;
  }

  private headers(): Record<string, string> {
    return {
      Authorization: `Key ${this.config.apiKey}:${this.config.apiSecret}`,
      "Content-Type": "application/json",
    };
  }

  async start(request: LayoutRequest): Promise<LayoutResult> {
    // Ровно те поля, что в примере платформы. Свой idempotency_key отсюда
    // убран: в примере его нет, а поведение API на незнакомых полях неизвестно.
    // Защита от двойного списания от него и не зависела — сервер сам находит
    // уже созданное задание по ключу прежде, чем идти к провайдеру.
    const body = {
      prompt: request.prompt,
      // Квадрат: исходник рисуется квадратным, и менять пропорции нельзя —
      // иначе контур поедет вместе с кадром.
      aspect_ratio: "1:1",
      // Бэкенд забирает картинку по прямой ссылке, поэтому предварительная
      // загрузка не нужна: отдаём адрес своего же маршрута с контуром.
      medias: [{ role: "image", value: request.footprintUrl }],
      params: { resolution: this.config.resolution, quality: this.config.quality },
    };

    try {
      const res = await fetch(`${this.config.apiBase}/${submitPath(this.config)}`, {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(30_000),
      });
      if (!res.ok) return { status: "failed", reason: await describeError(res) };

      const json = (await res.json()) as {
        id?: string;
        request_id?: string;
        status_url?: string;
        status?: string;
        images?: Array<{ url?: string }>;
      };
      // Синхронный ответ возможен, но рассчитывать на него нельзя.
      const ready = json.images?.[0]?.url;
      if (ready) return { status: "completed", imageUrl: ready };

      // Ссылку на опрос платформа присылает готовой — берём её, а не склеиваем
      // свою: так адрес переживёт смену маршрутизации на той стороне.
      const external = json.status_url || json.request_id || json.id;
      if (!external) return { status: "failed", reason: "no_request_id" };
      return { status: "pending", externalId: external };
    } catch (e) {
      return { status: "failed", reason: errorReason(e) };
    }
  }

  async poll(externalId: string): Promise<LayoutResult> {
    // externalId — либо готовая ссылка status_url, либо один request_id.
    const url = externalId.startsWith("https://")
      ? externalId
      : `${this.config.apiBase}/requests/${encodeURIComponent(externalId)}/status`;
    try {
      const res = await fetch(url, {
        headers: this.headers(),
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) return { status: "failed", reason: await describeError(res) };

      const json = (await res.json()) as {
        status?: string;
        images?: Array<{ url?: string }>;
      };
      switch (json.status) {
        case "completed": {
          const image = json.images?.[0]?.url;
          return image
            ? { status: "completed", imageUrl: image }
            : { status: "failed", reason: "empty_result" };
        }
        // Документация называет queued и in_progress, ответ на создание
        // задания — ещё и pending. Разбираем все три как «ещё не готово».
        case "pending":
        case "queued":
        case "in_progress":
          return { status: "pending", externalId };
        // nsfw на плане дома означать ничего осмысленного не может, но статус
        // документирован — разбираем его явно, чтобы не уйти в вечное ожидание.
        case "nsfw":
          return { status: "failed", reason: "rejected" };
        case "failed":
          return { status: "failed", reason: "provider_failed" };
        default:
          return { status: "failed", reason: "unknown_status" };
      }
    } catch (e) {
      return { status: "failed", reason: errorReason(e) };
    }
  }
}

/**
 * Код ошибки для интерфейса и — отдельно — текст платформы в лог сервера.
 * Наружу отдаётся только код: тело ответа чужого сервиса посетителю не место.
 * А без записи в лог любая ошибка выглядит как «http_400» и требует ещё одного
 * круга «включите — попробуйте — скажите, что было».
 */
async function describeError(res: Response): Promise<string> {
  let body = "";
  try {
    body = (await res.text()).slice(0, 300);
  } catch {
    body = "(тело ответа прочитать не удалось)";
  }
  console.error(`AI-планировка: провайдер ответил ${res.status}: ${body}`);
  return `http_${res.status}`;
}

function errorReason(e: unknown): string {
  const name = (e as Error)?.name;
  return name === "TimeoutError" || name === "AbortError" ? "timeout" : "network";
}

/* ------------------------------------------------------------------ */
/* OpenRouter                                                          */
/* ------------------------------------------------------------------ */

/**
 * Провайдер OpenRouter.
 *
 * Взят вместо прямой интеграции с Higgsfield по трём причинам, и все три
 * выяснились на живых запросах. У Higgsfield нужная модель через публичный
 * REST недоступна, каталога путей нет вовсе, а его собственный ассистент
 * дважды назвал неверный адрес. У OpenRouter та же модель `openai/gpt-image-2`
 * есть в каталоге, каталог отдаётся программно, а документация публичная.
 *
 * Технически проще: запрос синхронный, картинка приходит в том же ответе, и
 * механика опроса статуса не нужна вовсе — а это самая хрупкая часть любой
 * интеграции с генерацией.
 *
 * Плата за простоту — картинка приходит байтами в base64, поэтому её надо
 * сохранить у себя. Это скорее плюс: чужая ссылка однажды протухнет, а
 * планировка должна открываться и через год.
 *
 * Отдельный режим — через ретранслятор. Боевой сервер стоит в России, и
 * OpenRouter его не пускает: защита отбивает запрос по адресу отправителя ещё
 * до API. Тогда запрос уходит на свою функцию за границей, а ключ провайдера
 * живёт там же и на нашем сервере не хранится вовсе — заголовок авторизации
 * подставляет ретранслятор. Тело запроса в обоих режимах одно и то же.
 */
export class OpenRouterProvider implements LayoutImageProvider {
  readonly kind = "openrouter";
  readonly label = "OpenRouter";

  private readonly config: AiLayoutConfig;

  constructor(config: AiLayoutConfig) {
    this.config = config;
  }

  async start(request: LayoutRequest): Promise<LayoutResult> {
    const body = {
      model: this.config.model,
      prompt: request.prompt,
      // Квадрат: исходник рисуется квадратным, менять пропорции нельзя —
      // иначе контур поедет вместе с кадром.
      aspect_ratio: "1:1",
      quality: this.config.quality,
      // Бэкенд скачивает исходник по прямой ссылке, предварительная загрузка
      // не нужна: отдаём адрес своего же маршрута с контуром.
      input_references: [{ type: "image_url", image_url: { url: request.footprintUrl } }],
    };

    const viaRelay = Boolean(this.config.relayUrl);
    const headers: Record<string, string> = viaRelay
      ? {
          "Content-Type": "application/json",
          "X-Relay-Secret": this.config.relaySecret ?? "",
        }
      : {
          Authorization: `Bearer ${this.config.apiKey}`,
          "Content-Type": "application/json",
          // OpenRouter просит обозначать приложение — по этим полям владелец
          // видит в кабинете, откуда пришёл расход.
          "HTTP-Referer": this.config.publicBase,
          "X-Title": "EcoCub AI layout",
        };

    try {
      const res = await fetch(viaRelay ? this.config.relayUrl : `${this.config.apiBase}/images`, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        // Генерация идёт в том же запросе, поэтому ждём столько же, сколько
        // ждали бы результата опросом.
        signal: AbortSignal.timeout(this.config.timeoutMs),
      });
      if (!res.ok) return { status: "failed", reason: await describeError(res) };

      const json = (await res.json()) as {
        data?: Array<{ b64_json?: string; url?: string; media_type?: string }>;
        usage?: { cost?: number };
      };
      const first = json.data?.[0];
      if (!first) return { status: "failed", reason: "empty_result" };
      const costUsd = typeof json.usage?.cost === "number" ? json.usage.cost : undefined;

      // Ссылка, если провайдер вдруг её вернул: сохранять нечего.
      if (first.url) return { status: "completed", imageUrl: first.url, costUsd };

      if (!first.b64_json || !request.store) {
        return { status: "failed", reason: "empty_result" };
      }
      const bytes = decodeBase64(first.b64_json);
      const stored = await request.store(request.key, bytes);
      if (!stored) return { status: "failed", reason: "store_failed" };
      return { status: "completed", imageUrl: stored, costUsd };
    } catch (e) {
      return { status: "failed", reason: errorReason(e) };
    }
  }
}

function decodeBase64(value: string): Uint8Array {
  // Провайдер может прислать и data:-URI, и голый base64.
  const clean = value.includes(",") ? value.slice(value.indexOf(",") + 1) : value;
  return Uint8Array.from(Buffer.from(clean, "base64"));
}

export function createProvider(config: AiLayoutConfig): LayoutImageProvider {
  switch (config.provider) {
    case "openrouter":
      return new OpenRouterProvider(config);
    case "higgsfield":
      return new HiggsfieldProvider(config);
    case "manual":
      return new ManualLayoutProvider();
    default:
      return new MockLayoutProvider();
  }
}
