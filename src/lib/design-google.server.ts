/**
 * Вход в режим проектирования через Google. Только сервер.
 *
 * Схема — authorization code flow, серверная. Браузер уходит на согласие
 * Google и возвращается с одноразовым кодом; код меняется на токены запросом
 * сервер-серверу, в котором участвует client secret. Секрет в браузер не
 * попадает никогда, и перехваченный код без него бесполезен.
 *
 * Библиотеки нет намеренно. Весь обмен — два обычных запроса к Google плюс
 * разбор JWT; готовый пакет добавил бы к сборке сотни килобайт и собственный
 * цикл обновлений ради тридцати строк логики.
 *
 * Про проверку подписи id_token. Токен приходит не из браузера, а прямо от
 * Google, по TLS, в ответ на наш запрос с секретом. Для этого случая Google
 * прямо разрешает пропустить проверку подписи; проверяются `aud` (токен
 * выписан нашему клиенту) и `iss` (выписал его действительно Google).
 * Токен, пришедший любым другим путём, здесь не принимается вовсе.
 *
 * Кто получает доступ. Первый вошедший аккаунт становится владельцем — тот же
 * принцип, что и у пароля. Дальше пускается только он. Список
 * ECOCUB_ALLOWED_EMAILS, если задан, сужает круг заранее: занять место сможет
 * только почта из него.
 */

const AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const ISSUERS = ["accounts.google.com", "https://accounts.google.com"];

/** Путь, на который Google возвращает браузер. Должен совпадать с настройкой в консоли. */
export const CALLBACK_PATH = "/api/design/oauth/callback";

/** Кука с одноразовым состоянием: защита от подделки запроса на вход. */
const STATE_COOKIE = "ecocub_oauth_state";
const STATE_TTL_S = 600;

export function googleClientId(): string | null {
  return process.env.GOOGLE_OAUTH_CLIENT_ID?.trim() || null;
}

function googleClientSecret(): string | null {
  return process.env.GOOGLE_OAUTH_CLIENT_SECRET?.trim() || null;
}

/** Настроен ли вход через Google. Кнопка показывается только если да. */
export function googleConfigured(): boolean {
  return googleClientId() !== null && googleClientSecret() !== null;
}

/**
 * Список почт, которым разрешено занять место владельца.
 *
 * Не обязателен: без него владельцем становится первый вошедший. Нужен, если
 * страницу могут открыть посторонние раньше владельца — тогда круг сужается
 * заранее, и окно перехвата закрывается совсем.
 */
function allowedEmails(): string[] {
  return (process.env.ECOCUB_ALLOWED_EMAILS ?? "")
    .split(/[,\s]+/)
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * Адрес возврата собирается из адреса самого запроса, а не из константы.
 *
 * Так один и тот же код работает и на localhost, и на боевом домене, и не
 * приходится заводить переменную окружения, которую однажды забудут поменять.
 */
export function redirectUri(request: Request): string {
  const url = new URL(request.url);
  // За обратным прокси схема в url приходит http, а снаружи сайт работает по
  // https — Google сверяет адрес возврата буквально, и расхождение схемы
  // сломало бы вход.
  const proto = request.headers.get("x-forwarded-proto") ?? url.protocol.replace(":", "");
  const host = request.headers.get("x-forwarded-host") ?? url.host;
  return `${proto}://${host}${CALLBACK_PATH}`;
}

export async function makeState(): Promise<string> {
  const { randomBytes } = await import("node:crypto");
  return randomBytes(16).toString("hex");
}

export function stateCookie(state: string, secure: boolean): string {
  const flags = [
    `${STATE_COOKIE}=${state}`,
    `Path=${CALLBACK_PATH}`,
    "HttpOnly",
    // Lax, а не Strict: браузер возвращается на этот адрес переходом с сайта
    // Google, и при Strict кука бы не отправилась — вход не состоялся бы.
    "SameSite=Lax",
    `Max-Age=${STATE_TTL_S}`,
  ];
  if (secure) flags.push("Secure");
  return flags.join("; ");
}

export function clearStateCookie(): string {
  return `${STATE_COOKIE}=; Path=${CALLBACK_PATH}; HttpOnly; SameSite=Lax; Max-Age=0`;
}

export function readStateCookie(request: Request): string | null {
  const header = request.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (k === STATE_COOKIE) return rest.join("=");
  }
  return null;
}

/** Адрес страницы согласия Google. */
export function authorizationUrl(request: Request, state: string): string {
  const url = new URL(AUTH_ENDPOINT);
  url.searchParams.set("client_id", googleClientId() ?? "");
  url.searchParams.set("redirect_uri", redirectUri(request));
  url.searchParams.set("response_type", "code");
  // Нужны только личность и почта: доступ к письмам, диску и прочему не
  // запрашивается, чтобы окно согласия не пугало лишними правами.
  url.searchParams.set("scope", "openid email");
  url.searchParams.set("state", state);
  // Согласие один раз: повторные входы проходят без вопросов.
  url.searchParams.set("prompt", "select_account");
  return url.toString();
}

export interface GoogleIdentity {
  email: string;
  emailVerified: boolean;
}

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    return JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
  } catch {
    return null;
  }
}

/** Обменять код на личность пользователя. null — обмен не удался. */
export async function exchangeCode(request: Request, code: string): Promise<GoogleIdentity | null> {
  const clientId = googleClientId();
  const clientSecret = googleClientSecret();
  if (!clientId || !clientSecret) return null;

  let body: { id_token?: string };
  try {
    const response = await fetch(TOKEN_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri(request),
        grant_type: "authorization_code",
      }),
    });
    if (!response.ok) {
      console.warn("Google: обмен кода не удался,", response.status, await response.text());
      return null;
    }
    body = (await response.json()) as { id_token?: string };
  } catch (e) {
    console.warn("Google: не удалось связаться с сервером токенов:", (e as Error).message);
    return null;
  }

  if (!body.id_token) return null;
  const payload = decodeJwtPayload(body.id_token);
  if (!payload) return null;

  if (payload.aud !== clientId) {
    console.warn("Google: токен выписан не этому клиенту");
    return null;
  }
  if (typeof payload.iss !== "string" || !ISSUERS.includes(payload.iss)) {
    console.warn("Google: неизвестный издатель токена");
    return null;
  }
  const email = typeof payload.email === "string" ? payload.email.toLowerCase() : null;
  if (!email) return null;

  return { email, emailVerified: payload.email_verified === true };
}

export type GoogleLoginResult =
  | { ok: true; email: string; claimed: boolean }
  | { ok: false; reason: "unverified" | "not-allowed" | "storage" };

/**
 * Впустить владельца по подтверждённой почте.
 *
 * Первый вход занимает место навсегда. Дальше пускается только та же почта:
 * второй аккаунт получает отказ, даже если он из списка разрешённых.
 */
export async function loginWithEmail(identity: GoogleIdentity): Promise<GoogleLoginResult> {
  // Неподтверждённая почта в Google может принадлежать кому угодно.
  if (!identity.emailVerified) return { ok: false, reason: "unverified" };

  // Регистр приводится здесь, а не только у вызывающего: почта — это
  // идентификатор владельца, и «Ivan@» не должен оказаться другим человеком,
  // чем «ivan@», по какому бы пути сюда ни попал.
  const email = identity.email.trim().toLowerCase();
  if (!email) return { ok: false, reason: "not-allowed" };

  const allowed = allowedEmails();
  if (allowed.length && !allowed.includes(email)) {
    return { ok: false, reason: "not-allowed" };
  }

  const { readSetting, writeSetting } = await import("./house-projects.server.ts");
  const { GOOGLE_OWNER_SETTING } = await import("./design-auth.server.ts");

  const current = await readSetting(GOOGLE_OWNER_SETTING);
  if (current) {
    return current === email
      ? { ok: true, email, claimed: false }
      : { ok: false, reason: "not-allowed" };
  }

  try {
    await writeSetting(GOOGLE_OWNER_SETTING, email, { onlyIfEmpty: true });
  } catch {
    return { ok: false, reason: "storage" };
  }
  return { ok: true, email, claimed: true };
}
