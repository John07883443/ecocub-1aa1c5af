import { test } from "node:test";
import assert from "node:assert/strict";

/**
 * Доступ к мутациям.
 *
 * Главное, что здесь проверяется, — что боевой сервер без заданного секрета
 * НЕ открыт на запись. Это ровно та ошибка, которая не видна глазами: сайт
 * работает, редактор открывается, и только чужой POST однажды показывает, что
 * защиты не было.
 */

const auth = await import("../../design-auth.server.ts");

const SECRET = "очень-длинный-секрет-для-теста";

function request(cookie?: string): Request {
  return new Request("https://eco-cub.ru/api/design/projects", {
    headers: cookie ? { cookie } : {},
  });
}

/** Вытащить значение куки из заголовка Set-Cookie. */
function cookieValue(header: string): string {
  return header.split(";")[0];
}

test("на боевом сервере без секрета запись закрыта", async () => {
  delete process.env.ECOCUB_ADMIN_SECRET;
  process.env.NODE_ENV = "production";

  const access = await auth.checkAccess(request());
  assert.equal(access.allowed, false);
  assert.equal(access.allowed === false && access.reason, "not-configured");
  assert.equal(auth.adminConfigured(), false);

  const response = auth.denied(access as Extract<typeof access, { allowed: false }>);
  assert.equal(response.status, 403);
});

test("в разработке без секрета правки разрешены — иначе редактор не открыть", async () => {
  delete process.env.ECOCUB_ADMIN_SECRET;
  process.env.NODE_ENV = "development";

  const access = await auth.checkAccess(request());
  assert.equal(access.allowed, true);
  assert.equal(access.allowed === true && access.mode, "dev");
});

test("слишком короткий секрет считается отсутствующим", async () => {
  process.env.ECOCUB_ADMIN_SECRET = "12345";
  process.env.NODE_ENV = "production";

  assert.equal(auth.adminConfigured(), false);
  assert.equal(await auth.issueToken("12345"), null);
});

test("правильный секрет выдаёт токен, неправильный — нет", async () => {
  process.env.ECOCUB_ADMIN_SECRET = SECRET;
  process.env.NODE_ENV = "production";

  assert.equal(await auth.issueToken("не тот секрет"), null);

  const token = await auth.issueToken(SECRET);
  assert.ok(token, "правильный секрет должен давать токен");
  // Сам секрет в токен не попадает: там только срок годности и подпись.
  assert.ok(!token!.includes(SECRET));
});

test("подписанная кука пускает, подделанная — нет", async () => {
  process.env.ECOCUB_ADMIN_SECRET = SECRET;
  process.env.NODE_ENV = "production";

  const token = (await auth.issueToken(SECRET))!;
  const cookie = cookieValue(auth.sessionCookie(token));

  const good = await auth.checkAccess(request(cookie));
  assert.equal(good.allowed, true);
  assert.equal(good.allowed === true && good.mode, "session");

  // Подпись пересчитывается из секрета, поэтому произвольный срок годности
  // без подписи не проходит.
  const forged = `${Date.now() + 1_000_000}.чужая-подпись`;
  const bad = await auth.checkAccess(request(`ecocub_design=${encodeURIComponent(forged)}`));
  assert.equal(bad.allowed, false);
  assert.equal(bad.allowed === false && bad.reason, "no-session");
});

test("просроченный токен не пускает", async () => {
  process.env.ECOCUB_ADMIN_SECRET = SECRET;
  process.env.NODE_ENV = "production";

  const token = (await auth.issueToken(SECRET))!;
  const [, signature] = token.split(".");
  const expired = `${Date.now() - 1000}.${signature}`;

  const access = await auth.checkAccess(request(`ecocub_design=${encodeURIComponent(expired)}`));
  assert.equal(access.allowed, false);
});

test("смена секрета обесценивает выданные токены", async () => {
  process.env.ECOCUB_ADMIN_SECRET = SECRET;
  const token = (await auth.issueToken(SECRET))!;
  const cookie = cookieValue(auth.sessionCookie(token));

  process.env.ECOCUB_ADMIN_SECRET = `${SECRET}-новый`;
  const access = await auth.checkAccess(request(cookie));
  assert.equal(access.allowed, false);
});

test("кука на боевом сервере помечена Secure и HttpOnly", async () => {
  process.env.NODE_ENV = "production";
  const header = auth.sessionCookie("токен");
  assert.match(header, /HttpOnly/);
  assert.match(header, /Secure/);
  assert.match(header, /SameSite=Lax/);

  // На localhost по http кука с флагом Secure просто не сохранилась бы.
  process.env.NODE_ENV = "development";
  assert.ok(!auth.sessionCookie("токен").includes("Secure"));
});
