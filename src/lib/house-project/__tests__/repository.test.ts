import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Интеграционные тесты хранилища: настоящий SQLite во временном каталоге.
 *
 * Не заглушка. Половина того, что здесь проверяется, — поведение самой базы:
 * уникальность адреса, оптимистичная блокировка версии, то, что снятый с
 * публикации проект пропадает из каталога, но остаётся в редакторе. Проверять
 * это на подменённом объекте бессмысленно: он будет вести себя ровно так, как
 * его написали, а не так, как SQLite.
 *
 * Путь к базе задаётся до импорта модуля: он читает переменную окружения при
 * первом открытии соединения.
 */

const dir = mkdtempSync(join(tmpdir(), "ecocub-cad-"));
process.env.HOUSE_PROJECTS_DB_PATH = join(dir, "test.db");

const repo = await import("../../house-projects.server.ts");
const { createProject } = await import("../factory.ts");
const { computeMetrics } = await import("../geometry.ts");
const { weekendOneProject } = await import("../reference.ts");

after(() => rmSync(dir, { recursive: true, force: true }));

let created: Awaited<ReturnType<typeof repo.create>>;

before(async () => {
  const status = await repo.storageStatus();
  assert.equal(status.writable, true, `SQLite должен открыться: ${status.reason ?? ""}`);
});

test("создание кладёт черновик, невидимый в публичном каталоге", async () => {
  created = await repo.create(createProject("Тестовый дом"));
  assert.equal(created.status, "draft");
  assert.equal(created.version, 1);

  const published = await repo.listPublished();
  assert.ok(!published.some((p) => p.id === created.id));

  const all = await repo.listAll();
  assert.ok(all.some((p) => p.id === created.id));
});

test("адрес страницы уникален: второму проекту дописывается номер", async () => {
  const twin = await repo.create(createProject("Тестовый дом"));
  assert.notEqual(twin.slug, created.slug);
  assert.ok(twin.slug.startsWith("testovyi-dom"));
});

test("сохранение поднимает версию, а старая версия получает отказ", async () => {
  const opened = (await repo.getAny(created.id))!;
  const saved = await repo.update(
    created.id,
    { title: "Переименованный", model: opened.model },
    opened.version,
  );
  assert.equal(saved.version, opened.version + 1);
  assert.equal(saved.title, "Переименованный");

  await assert.rejects(
    () => repo.update(created.id, { title: "Из старой вкладки" }, opened.version),
    /уже изменён в другом месте/,
  );

  // Отказ обязан быть безоговорочным: чужая правка остаётся на месте.
  assert.equal((await repo.getAny(created.id))!.title, "Переименованный");
});

test("публикация не проходит без обложки и описания", async () => {
  await assert.rejects(() => repo.publish(created.id), /критические ошибки|проверку/);
});

test("публикация и снятие меняют видимость в каталоге", async () => {
  const current = (await repo.getAny(created.id))!;
  await repo.update(
    created.id,
    {
      description: "Дом для проверки публикации",
      publication: { ...current.publication, coverImage: "/images/projects/weekend-one.jpg" },
    },
    current.version,
  );

  const published = await repo.publish(created.id);
  assert.equal(published.status, "published");
  assert.ok(published.publishedAt);

  assert.ok((await repo.listPublished()).some((p) => p.id === created.id));
  assert.ok(await repo.getPublished(published.slug));

  const back = await repo.unpublish(created.id);
  assert.equal(back.status, "draft");
  assert.ok(!(await repo.listPublished()).some((p) => p.id === created.id));
  assert.equal(await repo.getPublished(back.slug), null);
  // Но из редактора он никуда не делся.
  assert.ok(await repo.getAny(created.id));
});

test("геометрия переживает круг через базу без изменений", async () => {
  const source = weekendOneProject();
  const stored = await repo.create({
    ...source,
    id: `${source.id}-roundtrip`,
    slug: "wo-roundtrip",
  });
  const read = (await repo.getAny(stored.id))!;

  assert.deepEqual(read.model.modules, source.model.modules);
  assert.deepEqual(read.model.openings, source.model.openings);
  assert.deepEqual(computeMetrics(read.model), computeMetrics(source.model));
});

test("копия независима и не связана с оригиналом", async () => {
  const copy = await repo.duplicate(created.id);
  assert.notEqual(copy.id, created.id);
  assert.equal(copy.status, "draft");

  const originalIds = new Set((await repo.getAny(created.id))!.model.modules.map((m) => m.id));
  for (const m of copy.model.modules) assert.ok(!originalIds.has(m.id));

  // Правка копии не должна доходить до оригинала.
  await repo.update(copy.id, { title: "Копия изменена" }, copy.version);
  assert.equal((await repo.getAny(created.id))!.title, "Переименованный");
});

test("архив убирает проект из каталога, но не уничтожает его", async () => {
  const archived = await repo.archive(created.id);
  assert.equal(archived.status, "archived");
  assert.ok(!(await repo.listPublished()).some((p) => p.id === created.id));
  assert.ok(await repo.getAny(created.id));
  assert.ok((await repo.listAll("archived")).some((p) => p.id === created.id));
});

test("обложка хранится отдельно от модели и читается обратно", async () => {
  const bytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3]);
  await repo.saveCover(created.id, "image/png", bytes);

  const cover = await repo.readCover(created.id);
  assert.ok(cover);
  assert.equal(cover!.mime, "image/png");
  assert.deepEqual(new Uint8Array(cover!.bytes), bytes);

  // В документе проекта картинки нет — только ссылка на неё.
  const project = (await repo.getAny(created.id))!;
  assert.ok(!JSON.stringify(project).includes("data:image"));

  await assert.rejects(() => repo.saveCover(created.id, "text/html", bytes), /PNG, JPEG или WebP/);
});
