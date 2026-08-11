/**
 * Выгрузка эталонных проектов в content/house-projects/*.json.
 *
 * Запасной источник каталога и первичное наполнение базы держатся в файлах,
 * но набирать эти файлы руками нельзя: координаты домов живут в
 * src/lib/standards и проверяются тестами против чисел альбома. Скрипт
 * пересобирает файлы из того же источника, поэтому расхождение между
 * стандартом и витриной невозможно внести правкой в одном месте.
 *
 * Запуск: npm run house-projects:export
 * Требуется Node 22+ (--experimental-strip-types для чтения .ts напрямую).
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "content", "house-projects");

const { referenceProjects } = await import(
  join(root, "src", "lib", "house-project", "reference.ts")
);
const { serializeProject } = await import(
  join(root, "src", "lib", "house-project", "serialize.ts")
);

/**
 * Что публикуется, а что остаётся черновиком.
 *
 * Публикуется только дом, для которого есть и разбор чертежей, и снимок:
 * карточка без обложки в каталоге выглядит поломкой. Weekend Mini разобран,
 * но фотографии в репозитории нет — он остаётся черновиком в редакторе.
 */
const PUBLICATION = {
  "weekend-one-cad": {
    status: "published",
    coverImage: "/images/projects/weekend-one.jpg",
    gallery: ["/images/projects/weekend-one.jpg", "/images/projects/weekend-one-2.jpg"],
    priceFrom: 5500000,
  },
};

mkdirSync(outDir, { recursive: true });

let written = 0;
for (const project of referenceProjects()) {
  const extra = PUBLICATION[project.slug];
  if (extra) {
    project.status = extra.status;
    project.publishedAt = project.updatedAt;
    project.publication = {
      ...project.publication,
      coverImage: extra.coverImage,
      gallery: extra.gallery,
      priceFrom: extra.priceFrom,
    };
  }
  const file = join(outDir, `${project.slug}.json`);
  writeFileSync(file, `${JSON.stringify(serializeProject(project), null, 2)}\n`, "utf8");
  written += 1;
  console.log(`${project.slug}: ${project.status}`);
}

console.log(`Готово: ${written} файлов в content/house-projects`);
