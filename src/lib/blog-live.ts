/**
 * Блог для маршрутов: файлы + живая лента Медиамашины.
 *
 * Через серверные функции, а не прямым импортом: лоадеры TanStack Start при
 * переходах внутри сайта выполняются в браузере, а ключ ленты и сам запрос к
 * ней должны остаться на сервере (см. blog-feed.server.ts). При первой
 * загрузке страницы (SSR) функция вызывается на сервере напрямую.
 *
 * Список уходит без текстов статей: карточкам, фильтрам и счётчикам текст не
 * нужен, а 36+ статей целиком — лишние сотни килобайт на каждый переход.
 */

import { createServerFn } from "@tanstack/react-start";
import { getPostBySlug, getRelatedPosts, type BlogPost } from "./blog";

const withoutContent = (post: BlogPost): BlogPost => ({ ...post, content: "" });

/** Все статьи блога (без текстов), свежие сверху. */
export const fetchBlogList = createServerFn({ method: "GET" }).handler(async (): Promise<BlogPost[]> => {
  const { getLivePosts } = await import("./blog-feed.server");
  return (await getLivePosts()).map(withoutContent);
});

/** Одна статья целиком и похожие (без текстов). null — такой статьи нет. */
export const fetchBlogPost = createServerFn({ method: "GET" })
  .inputValidator((slug: unknown) => String(slug ?? "").slice(0, 200))
  .handler(async ({ data: slug }): Promise<{ post: BlogPost; related: BlogPost[] } | null> => {
    const { getLivePosts } = await import("./blog-feed.server");
    const posts = await getLivePosts();
    const post = getPostBySlug(slug, posts);
    if (!post) return null;
    return { post, related: getRelatedPosts(post, 3, posts).map(withoutContent) };
  });
