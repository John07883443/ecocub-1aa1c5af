/**
 * Сквозная атрибуция EcoCub.
 *
 * Задача — ответить не на вопрос «сколько заявок», а «откуда пришёл человек,
 * который оставил заявку»: кампания Директа, ключевая фраза, поисковик, реферер.
 * Данные пишутся в поле payload таблицы submissions — миграция базы не нужна.
 *
 * Ключевое: сохраняем ДВА касания.
 *   first — как человек нашёл нас впервые (обычно SEO)
 *   last  — что вернуло его в момент заявки (обычно реклама или прямой заход)
 * Атрибуция «по последнему клику» систематически недооценивает SEO,
 * поэтому храним оба и решаем по данным, а не по умолчанию инструмента.
 *
 * yclid — метка клика Яндекс.Директа. По ней позже восстанавливается кампания,
 * группа, объявление и фраза, а также загружаются офлайн-конверсии обратно
 * в Метрику, чтобы автостратегии учились на сделках, а не на заполнениях формы.
 */

const KEY_FIRST = "ec_attr_first";
const KEY_LAST = "ec_attr_last";
const KEY_VISITS = "ec_attr_visits";
const KEY_SCORE = "ec_engagement";
const METRIKA_ID = 102678553;

export type Touch = {
  ts: string;
  landing: string;
  referrer: string | null;
  source: string | null;
  medium: string | null;
  campaign: string | null;
  content: string | null;
  term: string | null;
  yclid: string | null;
  gclid: string | null;
  /** Поисковая фраза, если поисковик передал её в реферере (Google/Bing иногда). */
  searchPhrase: string | null;
  /** Канал, вычисленный по правилам: direct / organic / cpc / referral / social. */
  channel: string;
};

function safeGet(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSet(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* приватный режим — атрибуция просто будет only-session */
  }
}

const SEARCH_HOSTS = /(^|\.)(yandex\.|google\.|bing\.|duckduckgo\.|mail\.ru|rambler\.)/i;
const SOCIAL_HOSTS =
  /(^|\.)(vk\.com|t\.me|telegram|instagram|facebook|ok\.ru|youtube|dzen\.ru|zen\.yandex)/i;

function detectChannel(params: URLSearchParams, referrer: string | null): string {
  const medium = params.get("utm_medium");
  if (params.get("yclid") || medium === "cpc" || medium === "ppc") return "cpc";
  if (params.get("gclid")) return "cpc";
  if (medium) return medium;
  if (!referrer) return "direct";
  try {
    const host = new URL(referrer).hostname;
    if (host === window.location.hostname) return "internal";
    if (SEARCH_HOSTS.test(host)) return "organic";
    if (SOCIAL_HOSTS.test(host)) return "social";
    return "referral";
  } catch {
    return "direct";
  }
}

function extractSearchPhrase(referrer: string | null): string | null {
  if (!referrer) return null;
  try {
    const url = new URL(referrer);
    for (const key of ["text", "q", "query", "search"]) {
      const v = url.searchParams.get(key);
      if (v) return v.slice(0, 200);
    }
  } catch {
    /* no-op */
  }
  return null;
}

function readTouch(): Touch {
  const params = new URLSearchParams(window.location.search);
  const referrer = document.referrer || null;
  return {
    ts: new Date().toISOString(),
    landing: window.location.pathname + window.location.search,
    referrer,
    source: params.get("utm_source"),
    medium: params.get("utm_medium"),
    campaign: params.get("utm_campaign"),
    content: params.get("utm_content"),
    term: params.get("utm_term"),
    yclid: params.get("yclid"),
    gclid: params.get("gclid"),
    searchPhrase: extractSearchPhrase(referrer),
    channel: detectChannel(params, referrer),
  };
}

/**
 * Вызывается один раз при загрузке приложения.
 * Пишет первое касание (если его ещё не было) и обновляет последнее,
 * игнорируя внутренние переходы, чтобы навигация по сайту не затирала источник.
 */
export function initAttribution() {
  if (typeof window === "undefined") return;

  const touch = readTouch();

  if (!safeGet(KEY_FIRST)) {
    safeSet(KEY_FIRST, JSON.stringify(touch));
  }

  if (touch.channel !== "internal") {
    safeSet(KEY_LAST, JSON.stringify(touch));
  }

  const visits = Number(safeGet(KEY_VISITS) || "0") + 1;
  safeSet(KEY_VISITS, String(visits));
}

/** Балл вовлечённости: копится по событиям, отправляется вместе с заявкой. */
export function addEngagement(points: number) {
  if (typeof window === "undefined") return;
  const current = Number(safeGet(KEY_SCORE) || "0");
  safeSet(KEY_SCORE, String(Math.min(current + points, 1000)));
}

export function getEngagement(): number {
  if (typeof window === "undefined") return 0;
  return Number(safeGet(KEY_SCORE) || "0");
}

/** ClientID Метрики — связывает заявку с визитом и всей его историей в отчётах. */
function getMetrikaClientId(timeoutMs = 600): Promise<string | null> {
  if (typeof window === "undefined" || !window.ym) return Promise.resolve(null);
  return new Promise((resolve) => {
    let done = false;
    const finish = (v: string | null) => {
      if (!done) {
        done = true;
        resolve(v);
      }
    };
    window.setTimeout(() => finish(null), timeoutMs);
    try {
      window.ym?.(METRIKA_ID, "getClientID", (id: string) => finish(id || null));
    } catch {
      finish(null);
    }
  });
}

function deviceType(): string {
  const w = window.innerWidth;
  if (w < 640) return "mobile";
  if (w < 1024) return "tablet";
  return "desktop";
}

function parse(key: string): Touch | null {
  const raw = safeGet(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Touch;
  } catch {
    return null;
  }
}

/**
 * Полный паспорт происхождения заявки. Кладётся в submissions.payload.
 * Ничего не спрашивает у пользователя и никак не влияет на форму —
 * если что-то недоступно, поле просто будет null.
 */
export async function buildAttribution(): Promise<Record<string, unknown>> {
  if (typeof window === "undefined") return {};

  const clientId = await getMetrikaClientId();
  const first = parse(KEY_FIRST);
  const last = parse(KEY_LAST) ?? readTouch();

  return {
    schema: "attribution/v1",
    capturedAt: new Date().toISOString(),
    firstTouch: first,
    lastTouch: last,
    metrikaClientId: clientId,
    visitNumber: Number(safeGet(KEY_VISITS) || "1"),
    engagementScore: getEngagement(),
    device: deviceType(),
    screen: `${window.innerWidth}x${window.innerHeight}`,
    language: navigator.language,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    pageAtSubmit: window.location.pathname,
  };
}

/** Короткая строка для Telegram-уведомления: откуда пришёл этот человек. */
export function attributionSummary(attr: Record<string, unknown>): string {
  const last = attr.lastTouch as Touch | null;
  const first = attr.firstTouch as Touch | null;
  if (!last) return "источник неизвестен";

  const parts: string[] = [];
  parts.push(last.channel);
  if (last.campaign) parts.push(`кампания ${last.campaign}`);
  if (last.term) parts.push(`фраза «${last.term}»`);
  else if (last.searchPhrase) parts.push(`запрос «${last.searchPhrase}»`);
  if (last.yclid) parts.push("Директ");
  if (first && first.channel !== last.channel) parts.push(`впервые — ${first.channel}`);
  const score = Number(attr.engagementScore || 0);
  if (score > 0) parts.push(`вовлечённость ${score}`);
  return parts.join(" · ");
}
