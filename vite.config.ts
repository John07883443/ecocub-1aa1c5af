// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - tanstackStart, viteReact, tailwindcss, tsConfigPaths, cloudflare (build-only),
//     componentTagger (dev-only), VITE_* env injection, @ path alias, React/TanStack dedupe,
//     error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... } }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

export default defineConfig({
  // Цель сборки задана явно и намеренно.
  //
  // Боевой сервер — обычный VPS: pm2 запускает `node .output/server/index.mjs`
  // под Node 22. Конфиг Lovable по умолчанию подставляет `cloudflare-module`,
  // то есть воркер для Cloudflare. Такой артефакт под Node не работает вообще:
  // процесс завершается сразу, HTTP-порт не слушается.
  //
  // Раньше это не проявлялось — на сервере сборка почему-то получалась
  // node-совместимой. Полагаться на такое совпадение нельзя: смена версии
  // nitro или переменных окружения молча превратила бы деплой в выкладку
  // неработающего сайта. Откат в deploy.sh спас бы прод, но причину пришлось
  // бы искать заново.
  //
  // Если проект когда-нибудь поедет на Cloudflare — меняется эта строка.
  nitro: { preset: "node-server" },
});
