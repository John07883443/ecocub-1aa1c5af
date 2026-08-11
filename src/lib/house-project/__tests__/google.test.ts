import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Вход через Google: проверяются решения о доступе, а не обмен с Google.
 *
 * Сам обмен кода на токен — это два запроса по сети к серверам Google, и
 * подменять их заглушкой значит проверять заглушку. Здесь проверяется то, что
 * решает наш код и что действительно может пустить чужого: подтверждена ли
 * почта, входит ли она в разрешённые, кто занял место владельца и может ли
 * его перехватить второй аккаунт.
 */

const dir = mkdtempSync(join(tmpdir(), "ecocub-google-"));
process.env.HOUSE_PROJECTS_DB_PATH = join(dir, "google.db");
process.on("exit", () => rmSync(dir, { recursive: true, force: true }));

const google = await import("../../design-google.server.ts");
const auth = await import("../../design-auth.server.ts");

const OWNER = { email: "vladelec@example.com", emailVerified: true };
const STRANGER = { email: "prohozhii@example.com", emailVerified: true };

test("без ключей вход через Google выключен и кнопка не показывается", () => {
  delete process.env.GOOGLE_OAUTH_CLIENT_ID;
  delete process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  assert.equal(google.googleConfigured(), false);

  process.env.GOOGLE_OAUTH_CLIENT_ID = "client-id";
  assert.equal(google.googleConfigured(), false, "одного идентификатора мало");

  process.env.GOOGLE_OAUTH_CLIENT_SECRET = "client-secret";
  assert.equal(google.googleConfigured(), true);
});

test("адрес возврата собирается по заголовкам обратного прокси", () => {
  const request = new Request("http://127.0.0.1:3000/api/design/oauth/start", {
    headers: { "x-forwarded-proto": "https", "x-forwarded-host": "eco-cub.ru" },
  });
  assert.equal(google.redirectUri(request), "https://eco-cub.ru/api/design/oauth/callback");

  // Без прокси — адрес самого запроса, чтобы вход работал и локально.
  const local = new Request("http://localhost:5173/api/design/oauth/start");
  assert.equal(google.redirectUri(local), "http://localhost:5173/api/design/oauth/callback");
});

test("ссылка на согласие просит только личность и почту", async () => {
  const request = new Request("https://eco-cub.ru/api/design/oauth/start");
  const url = new URL(google.authorizationUrl(request, "sostoyanie"));

  assert.equal(url.origin + url.pathname, "https://accounts.google.com/o/oauth2/v2/auth");
  assert.equal(url.searchParams.get("scope"), "openid email");
  assert.equal(url.searchParams.get("response_type"), "code");
  assert.equal(url.searchParams.get("state"), "sostoyanie");
  // Секрета в адресе быть не может: он уходит только запросом сервер-серверу.
  assert.ok(!url.search.includes("client-secret"));
});

test("состояние одноразовое и разное от входа к входу", async () => {
  const a = await google.makeState();
  const b = await google.makeState();
  assert.notEqual(a, b);
  assert.ok(a.length >= 32);

  const cookie = google.stateCookie(a, true);
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /Secure/);
  // Кука ограничена адресом возврата: другим страницам она не видна.
  assert.match(cookie, /Path=\/api\/design\/oauth\/callback/);
});

test("неподтверждённая почта не пускается", async () => {
  const result = await google.loginWithEmail({ email: OWNER.email, emailVerified: false });
  assert.equal(result.ok, false);
  assert.equal(result.ok === false && result.reason, "unverified");
  assert.equal(await auth.googleOwnerEmail(), null, "место остаётся свободным");
});

test("первый вошедший занимает место владельца", async () => {
  const result = await google.loginWithEmail(OWNER);
  assert.equal(result.ok, true);
  assert.equal(result.ok === true && result.claimed, true);
  assert.equal(await auth.googleOwnerEmail(), OWNER.email);
  assert.equal(await auth.ownerClaimed(), true);

  // После этого сессию можно выпустить без пароля.
  const token = await auth.issueTokenForOwner();
  assert.ok(token);
});

test("второй аккаунт место не перехватывает", async () => {
  const result = await google.loginWithEmail(STRANGER);
  assert.equal(result.ok, false);
  assert.equal(result.ok === false && result.reason, "not-allowed");
  assert.equal(await auth.googleOwnerEmail(), OWNER.email, "владелец не сменился");
});

test("владелец входит повторно без нового захвата", async () => {
  const result = await google.loginWithEmail(OWNER);
  assert.equal(result.ok, true);
  assert.equal(result.ok === true && result.claimed, false);
});

test("почта сверяется без учёта регистра", async () => {
  const result = await google.loginWithEmail({
    email: OWNER.email.toUpperCase(),
    emailVerified: true,
  });
  assert.equal(result.ok, true);
});

test("список разрешённых почт сужает круг заранее", async () => {
  process.env.ECOCUB_ALLOWED_EMAILS = "kto-to@example.com, drugoi@example.com";
  // Даже владелец не пройдёт, если его нет в списке: список сильнее.
  const owner = await google.loginWithEmail(OWNER);
  assert.equal(owner.ok, false);
  assert.equal(owner.ok === false && owner.reason, "not-allowed");

  process.env.ECOCUB_ALLOWED_EMAILS = `${OWNER.email}, drugoi@example.com`;
  assert.equal((await google.loginWithEmail(OWNER)).ok, true);
  delete process.env.ECOCUB_ALLOWED_EMAILS;
});

test("вход через Google закрывает возможность задать пароль", async () => {
  // Место занято аккаунтом Google. Если бы пароль после этого всё ещё можно
  // было задать, посторонний завёл бы себе второй вход в обход владельца.
  assert.equal(await auth.ownerClaimed(), true);
  assert.equal(await auth.passwordClaimAvailable(), false);
  assert.equal(await auth.claimOwner("dostatochno-dlinnyi"), false);
});
