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
      { title: "EcoCub — современные дома из бетона под ключ в Подмосковье" },
      {
        name: "description",
        content:
          "Производство монолитно-модульных домов из бетона в Московской области. Капитальный дом под ключ за 90 дней, гарантия 50 лет. Цены, проекты, портфолио.",
      },
      { name: "author", content: "EcoCub" },
      { property: "og:site_name", content: "EcoCub" },
      {
        property: "og:title",
        content: "EcoCub — современные дома из бетона под ключ в Подмосковье",
      },
      {
        property: "og:description",
        content:
          "Монолитно-модульные дома из бетона от производителя в Московской области. Капитальный дом за 90 дней, гарантия 50 лет.",
      },
      { property: "og:type", content: "website" },
      { property: "og:locale", content: "ru_RU" },
      { property: "og:image", content: "https://eco-cub.ru/images/hero-villa-1600.webp" },
      { name: "twitter:card", content: "summary_large_image" },
      {
        name: "twitter:title",
        content: "EcoCub — современные дома из бетона под ключ в Подмосковье",
      },
      { name: "twitter:image", content: "https://eco-cub.ru/images/hero-villa-1600.webp" },
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

const METRIKA_ID = 102678553;

const metrikaSnippet = `
(function(m,e,t,r,i,k,a){m[i]=m[i]||function(){(m[i].a=m[i].a||[]).push(arguments)};
m[i].l=1*new Date();k=e.createElement(t),a=e.getElementsByTagName(t)[0],k.async=1,k.src=r,a.parentNode.insertBefore(k,a)})
(window,document,"script","https://mc.yandex.ru/metrika/tag.js","ym");
ym(${METRIKA_ID},"init",{clickmap:true,trackLinks:true,accurateTrackBounce:true,webvisor:true});
`;

const orgJsonLd = JSON.stringify({
  "@context": "https://schema.org",
  "@type": "HomeAndConstructionBusiness",
  name: "EcoCub",
  url: "https://eco-cub.ru",
  logo: "https://eco-cub.ru/favicon.ico",
  telephone: "+7 980 875-86-43",
  email: "info@eco-cub.ru",
  areaServed: "Москва и Московская область",
  description:
    "Производство монолитно-модульных домов из бетона под ключ. Капитальный дом за 90 дней, гарантия 50 лет.",
});

function RootShell({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru">
      <head>
        <HeadContent />
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: orgJsonLd }} />
      </head>
      <body>
        {children}
        <Toaster richColors position="top-right" />
        <Scripts />
        <script dangerouslySetInnerHTML={{ __html: metrikaSnippet }} />
        <noscript>
          <div>
            <img
              src={`https://mc.yandex.ru/watch/${METRIKA_ID}`}
              style={{ position: "absolute", left: "-9999px" }}
              alt=""
            />
          </div>
        </noscript>
      </body>
    </html>
  );
}

function RootComponent() {
  return <Outlet />;
}
