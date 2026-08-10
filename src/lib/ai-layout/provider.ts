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

import type { AiLayoutConfig } from "./config.ts";

export interface LayoutRequest {
  /** Абсолютная ссылка на исходник — провайдер забирает его сам. */
  footprintUrl: string;
  prompt: string;
  /** Ключ идемпотентности: тот же ключ не должен списывать деньги дважды. */
  key: string;
}

export type LayoutResult =
  | { status: "completed"; imageUrl: string; isMock?: boolean }
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
 * НЕ подтверждено документацией: форма запроса на генерацию с исходным
 * изображением — публично описан только text-to-image. Тело ниже собрано по
 * форме, которую видно в MCP-клиенте платформы (job_type, medias с парой
 * role/value, params с тарифом) и которую отдельно подтвердил ассистент
 * Higgsfield. Два независимых наблюдения — довод, но не замена живой проверке.
 *
 * Адрес, по которому задание создаётся, публично не назван, поэтому остаётся
 * обязательной настройкой: пока AI_LAYOUT_SUBMIT_PATH не задан, провайдер не
 * запускается вовсе. Промах по адресу — это либо ошибка, либо чужая модель за
 * деньги владельца, и выключенная функция лучше догадки.
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
    const body = {
      job_type: this.config.jobType,
      prompt: request.prompt,
      // Квадрат: исходник рисуется квадратным, и менять пропорции нельзя —
      // иначе контур поедет вместе с кадром.
      aspect_ratio: "1:1",
      // Бэкенд забирает картинку по прямой ссылке, поэтому предварительная
      // загрузка не нужна: отдаём адрес своего же маршрута с контуром.
      medias: [{ role: "image", value: request.footprintUrl }],
      params: { resolution: this.config.resolution, quality: this.config.quality },
      // Если платформа знает про идемпотентность, повтор не станет второй
      // оплаченной генерацией. Если не знает — лишнее поле её не сломает.
      idempotency_key: request.key,
    };

    try {
      const res = await fetch(`${this.config.apiBase}/${this.config.submitPath}`, {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(30_000),
      });
      if (!res.ok) return { status: "failed", reason: `http_${res.status}` };

      const json = (await res.json()) as {
        id?: string;
        request_id?: string;
        status?: string;
        images?: Array<{ url?: string }>;
      };
      // Синхронный ответ возможен, но рассчитывать на него нельзя.
      const ready = json.images?.[0]?.url;
      if (ready) return { status: "completed", imageUrl: ready };

      const id = json.request_id || json.id;
      if (!id) return { status: "failed", reason: "no_request_id" };
      return { status: "pending", externalId: id };
    } catch (e) {
      return { status: "failed", reason: errorReason(e) };
    }
  }

  async poll(externalId: string): Promise<LayoutResult> {
    try {
      const res = await fetch(
        `${this.config.apiBase}/requests/${encodeURIComponent(externalId)}/status`,
        { headers: this.headers(), signal: AbortSignal.timeout(15_000) },
      );
      if (!res.ok) return { status: "failed", reason: `http_${res.status}` };

      const json = (await res.json()) as {
        status?: string;
        images?: Array<{ url?: string }>;
      };
      switch (json.status) {
        case "completed": {
          const url = json.images?.[0]?.url;
          return url
            ? { status: "completed", imageUrl: url }
            : { status: "failed", reason: "empty_result" };
        }
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

function errorReason(e: unknown): string {
  const name = (e as Error)?.name;
  return name === "TimeoutError" || name === "AbortError" ? "timeout" : "network";
}

export function createProvider(config: AiLayoutConfig): LayoutImageProvider {
  switch (config.provider) {
    case "higgsfield":
      return new HiggsfieldProvider(config);
    case "manual":
      return new ManualLayoutProvider();
    default:
      return new MockLayoutProvider();
  }
}
