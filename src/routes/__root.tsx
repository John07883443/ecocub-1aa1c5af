import { Outlet, Link, createRootRoute, HeadContent, Scripts } from "@tanstack/react-router";

import appCss from "../styles.css?url";
import { Toaster } from "@/components/ui/sonner";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Страница не найдена</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Такой страницы не существует или она была перенесена.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            На главную
          </Link>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "EcoCub — современные дома под ключ в Подмосковье" },
      {
        name: "description",
        content:
          "Производство модульных бетонных и каркасных домов в Московской области. Виллы Hi-Tech под ключ за 90 дней. Цены, проекты, портфолио.",
      },
      { name: "author", content: "EcoCub" },
      { property: "og:title", content: "EcoCub — современные дома под ключ в Подмосковье" },
      {
        property: "og:description",
        content:
          "Модульные бетонные дома, каркасные Scandi и виллы Hi-Tech от производителя в Московской области.",
      },
      { property: "og:type", content: "website" },
      { property: "og:locale", content: "ru_RU" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: "EcoCub — современные дома под ключ в Подмосковье" },
      { name: "description", content: "Site Migrator clones websites from platforms like Tilda to a modern React + TanStack Start framework." },
      { property: "og:description", content: "Site Migrator clones websites from platforms like Tilda to a modern React + TanStack Start framework." },
      { name: "twitter:description", content: "Site Migrator clones websites from platforms like Tilda to a modern React + TanStack Start framework." },
      { property: "og:image", content: "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/514aca7c-fe6f-47ac-b412-62472ce3ed88/id-preview-1854803b--11a56c57-baa4-4049-9002-d7a0650d363e.lovable.app-1776869666158.png" },
      { name: "twitter:image", content: "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/514aca7c-fe6f-47ac-b412-62472ce3ed88/id-preview-1854803b--11a56c57-baa4-4049-9002-d7a0650d363e.lovable.app-1776869666158.png" },
    ],
    links: [
      {
        rel: "preconnect",
        href: "https://fonts.googleapis.com",
      },
      {
        rel: "preconnect",
        href: "https://fonts.gstatic.com",
        crossOrigin: "anonymous",
      },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Manrope:wght@300;400;500;600;700&family=Unbounded:wght@500;600;700;800&display=swap",
      },
      {
        rel: "stylesheet",
        href: appCss,
      },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
});

function RootShell({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Toaster richColors position="top-right" />
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  return <Outlet />;
}
