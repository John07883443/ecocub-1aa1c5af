/**
 * Запасной источник проектов CAD Light — файлы репозитория.
 *
 * Та же схема, что у карточек каталога (`src/lib/projects.ts`): основной
 * источник — база на сервере, но опубликованные дома продублированы файлами
 * в content/house-projects/*.json и вшиты в сборку. Если база не открылась,
 * публичный каталог продолжает работать, пусть и той версией, что была на
 * момент сборки.
 *
 * Эти же файлы заливаются в пустую базу при первом запуске — чтобы на новом
 * сервере редактор открывался не на пустом месте.
 *
 * Файлы генерируются из `src/lib/house-project/reference.ts` командой
 * `npm run house-projects:export`. Править их руками не нужно: единственный
 * источник координат — `src/lib/standards`.
 */

import { parseProject } from "./house-project/serialize.ts";
import type { HouseProject } from "./house-project/types.ts";

const files = import.meta.glob<Record<string, unknown>>("../../content/house-projects/*.json", {
  import: "default",
  eager: true,
});

function build(): HouseProject[] {
  const out: HouseProject[] = [];
  for (const [path, raw] of Object.entries(files)) {
    const project = parseProject(raw);
    if (!project) {
      console.warn(`Проекты CAD: файл ${path} не читается как проект и пропущен`);
      continue;
    }
    out.push(project);
  }
  // Порядок воспроизводимый: он не должен зависеть от обхода каталога.
  return out.sort((a, b) => a.slug.localeCompare(b.slug));
}

export const fileHouseProjects: HouseProject[] = build();
