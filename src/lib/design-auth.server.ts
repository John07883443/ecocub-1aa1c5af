/**
 * Доступ к режиму «Проектирование». Только сервер.
 *
 * Задача узкая и должна такой остаться: пользователь системы один — владелец
 * продукта. Ролевая система, таблица пользователей и восстановление пароля
 * здесь были бы дороже, чем то, что они защищают.
 *
 * Механизм. Пароль владельца задаётся при первом открытии раздела прямо в
 * браузере и хранится на сервере хешем (scrypt с солью). Человек вводит его
 * один раз, сервер сверяет и выдаёт подписанную HttpOnly-куку на 12 часов.
 * Кука хранит только срок годности и подпись — сам пароль в браузер не
 * попадает ни в каком виде, поэтому украсть его из localStorage или из
 * DevTools нельзя.
 *
 * Почему пароль задаётся из браузера, а не только переменной окружения.
 * Переменная лежит в файле на VPS, и добраться до неё можно лишь по SSH.
 * Владелец продукта работает с телефона; в результате раздел неделями стоял
 * бы закрытым, а работать в нём некому. Схема «первый вход задаёт пароль»
 * знакома по домашним серверам (Home Assistant, Jenkins) и снимает это
 * ограничение, не открывая запись всему интернету.
 *
 * Окно перехвата. Пока пароль не задан, задать его может любой, кто откроет
 * страницу. Окно длится от выкладки до первого входа владельца — минуты, — и
 * закрывается навсегда: второй раз занять место нельзя. На случай, если в это
 * окно кто-то влез или пароль забыт, остаётся ECOCUB_ADMIN_SECRET: заданная
 * переменная перебивает пароль из базы.
 *
 * Почему кука подписана, а не случайна. Случайный токен пришлось бы где-то
 * хранить и чистить, то есть завести ещё одну таблицу и фоновую уборку.
 * Подпись HMAC проверяется без состояния: сервер пересчитывает её из того же
 * секрета. Минус — досрочно отозвать сессию нельзя; лечится сменой секрета,
 * и для одного пользователя это приемлемо.
 *
 * Поведение без пароля. Читать проекты можно, менять — нет. В разработке
 * (NODE_ENV !== production) правки разрешены без входа с предупреждением в
 * лог, иначе редактор нельзя было бы открыть локально.
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

/** Задан ли запасной пароль в окружении сервера. */
export function envSecretConfigured(): boolean {
  return secret() !== null;
}

/** Ключ настройки, под которым лежит случайный секрет подписи сессий. */
const SIGNING_KEY_SETTING = "session_signing_key";
/** Ключ настройки с почтой владельца, вошедшего через Google. */
export const GOOGLE_OWNER_SETTING = "google_owner_email";

/**
 * Ключ, которым подписываются куки сессии.
 *
 * Переменная окружения имеет приоритет: это и запасной вход, и способ разом
 * выкинуть все сессии, если что-то утекло. Иначе берётся случайный ключ,
 * который сервер один раз создаёт и хранит в базе.
 *
 * Раньше вместо случайного ключа использовался хеш пароля — тогда смена
 * пароля заодно обесценивала куки. От этого пришлось отказаться: вход через
 * Google пароля не заводит вовсе, и подписывать сессию стало бы нечем.
 */
async function signingKey(): Promise<string | null> {
  const env = secret();
  if (env) return env;

  const { readSetting, writeSetting } = await import("./house-projects.server.ts");
  const existing = await readSetting(SIGNING_KEY_SETTING);
  if (existing) return existing;

  // Ключ создаётся только когда владелец уже есть: до этого подписывать
  // нечего, а лишняя запись в базе на пустом месте не нужна.
  if (!(await ownerClaimed())) return null;
  const { randomBytes } = await import("node:crypto");
  const fresh = randomBytes(32).toString("hex");
  try {
    await writeSetting(SIGNING_KEY_SETTING, fresh, { onlyIfEmpty: true });
  } catch {
    return null;
  }
  return (await readSetting(SIGNING_KEY_SETTING)) ?? fresh;
}

/** Задан ли доступ хоть каким-то способом. */
export async function adminConfigured(): Promise<boolean> {
  return envSecretConfigured() || (await ownerClaimed());
}

/** Почта владельца, вошедшего через Google. null — вход Google ещё не занят. */
export async function googleOwnerEmail(): Promise<string | null> {
  const { readSetting } = await import("./house-projects.server.ts");
  return readSetting(GOOGLE_OWNER_SETTING);
}

/**
 * Занято ли место владельца — паролем, аккаунтом Google или переменной
 * окружения. Пока не занято, редактор предлагает его занять.
 */
export async function ownerClaimed(): Promise<boolean> {
  if (envSecretConfigured()) return true;
  const { readOwnerSecret, readSetting } = await import("./house-projects.server.ts");
  if (await readOwnerSecret()) return true;
  return (await readSetting(GOOGLE_OWNER_SETTING)) !== null;
}

/**
 * Выпустить сессию без пароля — после подтверждённого входа через Google.
 * Вызывается только из обработчика ответа Google, проверившего личность.
 */
export async function issueTokenForOwner(): Promise<string | null> {
  const key = await signingKey();
  if (!key) return null;
  const exp = String(Date.now() + TTL_MS);
  return `${exp}.${await hmac(exp, key)}`;
}

/** Минимальная длина пароля. Короче — это не пароль, а формальность. */
export const MIN_PASSWORD_LENGTH = 8;

async function hashPassword(password: string, salt: string): Promise<string> {
  const { scrypt } = await import("node:crypto");
  return new Promise((resolve, reject) => {
    // scrypt намеренно медленный: подбор по словарю становится дорогим даже
    // при утечке базы. Параметры по умолчанию Node — 16384/8/1.
    scrypt(password, salt, 64, (err, key) => (err ? reject(err) : resolve(key.toString("hex"))));
  });
}

/**
 * Занять место владельца, задав пароль. Второй раз не сработает.
 * Возвращает false, если место уже занято.
 */
export async function claimOwner(password: string): Promise<boolean> {
  if (password.length < MIN_PASSWORD_LENGTH) return false;
  // Занято аккаунтом Google или переменной окружения — пароль уже не завести.
  if (!(await passwordClaimAvailable())) return false;
  const { randomBytes } = await import("node:crypto");
  const { writeOwnerSecret } = await import("./house-projects.server.ts");
  const salt = randomBytes(16).toString("hex");
  return writeOwnerSecret(
    { salt, hash: await hashPassword(password, salt), createdAt: new Date().toISOString() },
    { onlyIfEmpty: true },
  );
}

/** Подходит ли введённое значение: пароль из базы или переменная окружения. */
async function passwordMatches(input: string): Promise<boolean> {
  const env = secret();
  if (env) return safeEqual(input, env);
  const { readOwnerSecret } = await import("./house-projects.server.ts");
  const owner = await readOwnerSecret();
  if (!owner) return false;
  return safeEqual(await hashPassword(input, owner.salt), owner.hash);
}

/**
 * Можно ли ещё задать пароль.
 *
 * Условие — «владельца нет вообще», а не «нет пароля». Разница
 * принципиальная: пока проверялось только отсутствие пароля, посторонний мог
 * завести себе пароль уже после того, как владелец вошёл через Google, и
 * получить полный доступ в обход него. Место у раздела одно на все способы
 * входа.
 */
export async function passwordClaimAvailable(): Promise<boolean> {
  return !(await ownerClaimed());
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

/** Проверить введённый пароль и выпустить токен сессии. null — не подошёл. */
export async function issueToken(input: string): Promise<string | null> {
  const key = await signingKey();
  if (!key) return null;
  if (!(await passwordMatches(input))) return null;
  const exp = String(Date.now() + TTL_MS);
  return `${exp}.${await hmac(exp, key)}`;
}

async function tokenValid(token: string): Promise<boolean> {
  const key = await signingKey();
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

  if (!(await adminConfigured())) {
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
      ? "Пароль режима проектирования ещё не задан. Откройте раздел «Проектирование» и придумайте его — " +
        "до этого изменение проектов закрыто для всех."
      : "Нужен вход в режим проектирования.";
  return Response.json({ ok: false, reason: access.reason, message }, { status: 403 });
}
