/**
 * Публичное чтение каталога «Проекты домов».
 *
 * Всё, что здесь есть, отдаёт только опубликованные дома. Чтение идёт через
 * серверные функции: лоадеры маршрутов в TanStack Start при переходах внутри
 * сайта выполняются в браузере, и обращаться из них к серверному модулю
 * напрямую нельзя — уехал бы и путь к базе, и весь код работы с ней.
 *
 * Мутаций здесь нет ни одной. Создание, правка и публикация живут в
 * /api/design/* и закрыты сессией администратора.
 */

import { createServerFn } from "@tanstack/react-start";
import type { HouseProject, ProjectSummary } from "./house-project/types";
import { parseProject } from "./house-project/serialize";

/** Опубликованные дома для страницы каталога. */
export const fetchPublishedHouses = createServerFn({ method: "GET" }).handler(
  async (): Promise<ProjectSummary[]> => {
    const { listPublished } = await import("./house-projects.server");
    return listPublished();
  },
);

/**
 * Один опубликованный дом целиком — с моделью: страница проекта показывает
 * 3D и передаёт конфигурацию в конструктор. Черновик по этому пути не
 * отдаётся ни при каких условиях.
 */
export const fetchPublishedHouse = createServerFn({ method: "GET" })
  .inputValidator((slug: unknown) => String(slug ?? ""))
  .handler(async ({ data: slug }): Promise<HouseProject | null> => {
    const { getPublished } = await import("./house-projects.server");
    return getPublished(slug);
  });

/** Разбор ответа сервера обратно в проект — на стороне клиента. */
export function projectFromPayload(payload: unknown): HouseProject | null {
  return parseProject(payload);
}

/** Формат цены каталога. Отдельная функция, чтобы карточка и страница не разошлись. */
export function formatPrice(value: number | undefined): string | null {
  if (value == null) return null;
  return `${new Intl.NumberFormat("ru-RU").format(value)} ₽`;
}

/** Площадь с одним знаком после запятой и русской запятой. */
export function formatArea(m2: number): string {
  return `${m2.toFixed(1).replace(".", ",")} м²`;
}

/**
 * Русское склонение после числа: 1 модуль, 2 модуля, 5 модулей.
 *
 * Без этого в карточке стоит «4 модулей» — мелочь, которая читается как
 * недоделанный сайт, а не как каталог заводских домов.
 */
export function plural(n: number, one: string, few: string, many: string): string {
  const mod100 = Math.abs(n) % 100;
  const mod10 = mod100 % 10;
  if (mod100 >= 11 && mod100 <= 14) return many;
  if (mod10 === 1) return one;
  if (mod10 >= 2 && mod10 <= 4) return few;
  return many;
}

/** Габарит в метрах: 12 590 × 5 130 мм читается хуже, чем 12,59 × 5,13 м. */
export function formatBounds(widthMm: number, depthMm: number): string {
  const m = (v: number) => (v / 1000).toFixed(2).replace(".", ",");
  return `${m(widthMm)} × ${m(depthMm)} м`;
}
