/**
 * Доступ к режиму «Проектирование». Только сервер.
 *
 * Задача узкая и должна такой остаться: пользователь системы один — владелец
 * продукта. Ролевая система, таблица пользователей и восстановление пароля
 * здесь были бы дороже, чем то, что они защищают.
 *
 * Механизм. В окружении сервера лежит ECOCUB_ADMIN_SECRET. Человек вводит его
 * один раз, сервер сверяет и выдаёт подписанную HttpOnly-куку на 12 часов.
 * Кука хранит только срок годности и подпись — сам секрет в браузер не
 * попадает ни в каком виде, поэтому украсть его из localStorage или из
 * DevTools нельзя.
 *
 * Почему кука подписана, а не случайна. Случайный токен пришлось бы где-то
 * хранить и чистить, то есть завести ещё одну таблицу и фоновую уборку.
 * Подпись HMAC проверяется без состояния: сервер пересчитывает её из того же
 * секрета. Минус — досрочно отозвать сессию нельзя; лечится сменой секрета,
 * и для одного пользователя это приемлемо.
 *
 * Поведение без секрета. В production мутации закрыты наглухо: открытый на
 * запись боевой endpoint хуже, чем неработающая админка. В разработке
 * (NODE_ENV !== production) доступ разрешён с предупреждением в лог — иначе
 * редактор нельзя было бы открыть локально, не заведя секрет.
 */

const COOKIE_NAME = "ecocub_design";
const TTL_MS = 12 * 60 * 60 * 1000;

function secret(): string | null {
  const value = process.env.ECOCUB_ADMIN_SECRET;
  // Слишком короткий секрет — это отсутствие секрета: 4 символа перебираются
  // быстрее, чем читается эта строка.
  return value && value.length >= 16 ? value : null;
}

export function isProduction(): boolean {
  return process.env.NODE_ENV === "production";
}

/** Настроен ли доступ. Редактор показывает это состояние прямо в интерфейсе. */
export function adminConfigured(): boolean {
  return secret() !== null;
}

async function hmac(payload: string, key: string): Promise<string> {
  const { createHmac } = await import("node:crypto");
  return createHmac("sha256", key).update(payload).digest("base64url");
}

/** Сравнение постоянного времени: обычное «===» подсказывает длину совпадения. */
async function safeEqual(a: string, b: string): Promise<boolean> {
  const { timingSafeEqual } = await import("node:crypto");
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/** Проверить введённый секрет и выпустить токен сессии. null — не подошёл. */
export async function issueToken(input: string): Promise<string | null> {
  const key = secret();
  if (!key) return null;
  if (!(await safeEqual(input, key))) return null;
  const exp = String(Date.now() + TTL_MS);
  return `${exp}.${await hmac(exp, key)}`;
}

async function tokenValid(token: string): Promise<boolean> {
  const key = secret();
  if (!key) return false;
  const [exp, sig] = token.split(".");
  if (!exp || !sig) return false;
  const expires = Number(exp);
  if (!Number.isFinite(expires) || expires < Date.now()) return false;
  return safeEqual(sig, await hmac(exp, key));
}

function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (k === name) return decodeURIComponent(rest.join("="));
  }
  return null;
}

export function sessionCookie(token: string): string {
  const flags = [
    `${COOKIE_NAME}=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${Math.floor(TTL_MS / 1000)}`,
  ];
  // Secure только на боевом: на localhost по http кука с этим флагом
  // не сохранилась бы, и войти локально стало бы невозможно.
  if (isProduction()) flags.push("Secure");
  return flags.join("; ");
}

export function clearCookie(): string {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

export type Access =
  | { allowed: true; mode: "session" | "dev" }
  | { allowed: false; reason: "not-configured" | "no-session" };

/**
 * Есть ли у запроса право менять проекты.
 *
 * Единственная точка принятия решения. Каждый мутирующий роут вызывает её
 * первой строкой — иначе однажды появится роут, где проверку забыли.
 */
export async function checkAccess(request: Request): Promise<Access> {
  const token = readCookie(request, COOKIE_NAME);
  if (token && (await tokenValid(token))) return { allowed: true, mode: "session" };

  if (!adminConfigured()) {
    if (!isProduction()) {
      console.warn(
        "Проектирование: ECOCUB_ADMIN_SECRET не задан — в режиме разработки правки разрешены без входа. " +
          "На боевом сервере в этом случае запись будет закрыта.",
      );
      return { allowed: true, mode: "dev" };
    }
    return { allowed: false, reason: "not-configured" };
  }
  return { allowed: false, reason: "no-session" };
}

/** Готовый ответ на запрос без прав. Тексты одинаковы во всех роутах. */
export function denied(access: Extract<Access, { allowed: false }>): Response {
  const message =
    access.reason === "not-configured"
      ? "Режим проектирования на этом сервере не настроен: не задана переменная ECOCUB_ADMIN_SECRET. " +
        "Пока её нет, изменение проектов закрыто для всех."
      : "Нужен вход в режим проектирования.";
  return Response.json({ ok: false, reason: access.reason, message }, { status: 403 });
}
