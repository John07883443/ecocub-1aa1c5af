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

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Пароль владельца хранится в той же базе, что и проекты, поэтому тесту
// нужен свой временный файл — иначе он писал бы в боевую базу.
const dir = mkdtempSync(join(tmpdir(), "ecocub-auth-"));
process.env.HOUSE_PROJECTS_DB_PATH = join(dir, "auth.db");

const auth = await import("../../design-auth.server.ts");

const SECRET = "очень-длинный-секрет-для-теста";

process.on("exit", () => rmSync(dir, { recursive: true, force: true }));

function request(cookie?: string): Request {
  return new Request("https://eco-cub.ru/api/design/projects", {
    headers: cookie ? { cookie } : {},
  });
}

/** Вытащить значение куки из заголовка Set-Cookie. */
function cookieValue(header: string): string {
  return header.split(";")[0];
}

test("на боевом сервере без пароля запись закрыта", async () => {
  delete process.env.ECOCUB_ADMIN_SECRET;
  process.env.NODE_ENV = "production";

  const access = await auth.checkAccess(request());
  assert.equal(access.allowed, false);
  assert.equal(access.allowed === false && access.reason, "not-configured");
  assert.equal(await auth.adminConfigured(), false);
  assert.equal(await auth.ownerClaimed(), false);

  const response = auth.denied(access as Extract<typeof access, { allowed: false }>);
  assert.equal(response.status, 403);
});

test("в разработке без пароля правки разрешены — иначе редактор не открыть локально", async () => {
  delete process.env.ECOCUB_ADMIN_SECRET;
  process.env.NODE_ENV = "development";

  const access = await auth.checkAccess(request());
  assert.equal(access.allowed, true);
  assert.equal(access.allowed === true && access.mode, "dev");
});

test("пароль, заданный из браузера, открывает вход и место занимается один раз", async () => {
  delete process.env.ECOCUB_ADMIN_SECRET;
  process.env.NODE_ENV = "production";

  assert.equal(
    await auth.claimOwner("1234567"),
    false,
    "пароль короче восьми символов не принимается",
  );
  assert.equal(await auth.ownerClaimed(), false);

  const password = "пароль-владельца-1";
  assert.equal(await auth.claimOwner(password), true);
  assert.equal(await auth.ownerClaimed(), true);
  assert.equal(await auth.adminConfigured(), true);

  // Повторный захват невозможен: иначе любой посетитель сменил бы пароль.
  assert.equal(await auth.claimOwner("другой-пароль-1"), false);

  assert.equal(await auth.issueToken("другой-пароль-1"), null);
  const token = await auth.issueToken(password);
  assert.ok(token, "правильный пароль должен пускать");
  // В токене нет самого пароля — только срок годности и подпись.
  assert.ok(!token!.includes(password));

  const access = await auth.checkAccess(request(cookieValue(auth.sessionCookie(token!))));
  assert.equal(access.allowed, true);
});

test("переменная окружения перебивает пароль из базы", async () => {
  // Пароль в базе уже задан предыдущим тестом.
  process.env.ECOCUB_ADMIN_SECRET = SECRET;
  process.env.NODE_ENV = "production";

  // Прежний пароль больше не подходит — это и есть аварийный вход.
  assert.equal(await auth.issueToken("пароль-владельца-1"), null);
  assert.ok(await auth.issueToken(SECRET));
  // Пока переменная задана, задать пароль заново нельзя.
  assert.equal(await auth.claimOwner("ещё-один-пароль"), false);
});

test("слишком короткая переменная окружения считается отсутствующей", async () => {
  process.env.ECOCUB_ADMIN_SECRET = "12345";
  process.env.NODE_ENV = "production";

  assert.equal(auth.envSecretConfigured(), false);
  assert.equal(await auth.issueToken("12345"), null);
  // Короткая переменная просто игнорируется и не ломает вход по паролю из базы.
  assert.ok(await auth.issueToken("пароль-владельца-1"));
});

test("правильная переменная окружения выдаёт токен, неправильная — нет", async () => {
  process.env.ECOCUB_ADMIN_SECRET = SECRET;
  process.env.NODE_ENV = "production";

  assert.equal(await auth.issueToken("не тот секрет"), null);

  const token = await auth.issueToken(SECRET);
  assert.ok(token, "правильное значение должно давать токен");
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

test("смена пароля обесценивает выданные токены", async () => {
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
