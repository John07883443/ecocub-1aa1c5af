# Конструктор v4 (бета) — заметки к выкладке

## Что меняется на сайте

- `/constructor` — новый конструктор v4 с пометкой «бета». Он клиентский: 3D, солвер, правила, план, бюджет и паспорт работают в браузере.
- `/constructor/classic` перенаправляет на `/constructor?classic=true`. Там старый конструктор, его код и SEO не менялись.
- Ссылка из каталога `?house=<slug>` по-прежнему открывает старый конструктор (копия проекта).
- `/pilot` перенаправляет на `/constructor`.
- Серверные маршруты: `GET /api/pilot/health`, `POST /api/pilot/chat`, `POST /api/pilot/render` и `POST /api/pilot/lead`. Заявка уходит в базу лидов с `form_type = constructor-v4` и в Telegram с JSON паспорта.

## Переменные окружения (`/home/deploy/ecocub.env`)

| Переменная | Зачем | Если нет |
|---|---|---|
| `RGROUTER_API_KEY` | чат «Архитектора Льва», фото-рендеры | чат и рендеры показывают «не настроено», остальное работает |
| `INWORLD_API_KEY_BASE64` | голос (общий ключ с МедиаМашиной) | кнопка голоса объясняет причину |
| `PILOT_TELEGRAM_BOT_TOKEN`, `PILOT_TELEGRAM_CHAT_ID` | заявка с паспортом в Telegram | запасной вариант — `TELEGRAM_*` сайта; заявка в любом случае пишется в базу |
| `PILOT_VOICE_URL` | адрес голосового релея, например `wss://eco-cub.ru/pilot-voice` | голос выключен с понятным сообщением |
| необязательные | `PILOT_CHAT_MODEL`, `PILOT_IMAGE_MODEL`, `PILOT_RENDER_RUNS` (2), `PILOT_RENDER_DAILY_CAP` (150), `PILOT_CHAT_PER_SESSION` (60) | значения по умолчанию |
| стадия 2 рендеров | `PILOT_EDIT_MODEL` (`rg-google-gemini-3.1-flash-image`), `PILOT_IMAGE_EDITS=0` — аварийно выключить фото по 3D-снимку (rgrouter `/v1/images/edits`), `PILOT_EDIT_RUB_PER_FRAME` (5) / `PILOT_IMAGE_RUB_PER_FRAME` (3.8) — оценка цены кадра в подписи | по умолчанию фото рисуется поверх снимка 3D, при ошибке — по промпту; снимок до ~3 МБ в теле `POST /api/pilot/render`, nginx `client_max_body_size` ≥ 8m |

CI (`.github/workflows/deploy.yml`) этих переменных не требует. Сборка и проверка запуска проходят без них, это проверено локально: `/`, `/portfolio`, `/concrete`, `/blog`, `/sitemap.xml`, `/constructor`, `/api/pilot/health` отвечают 200.

## Голос: отдельный шаг на VPS

У сборки сайта (nitro node-server) нет WebSocket-прокси. Поэтому голос идёт через отдельный маленький процесс `scripts/pilot-server.mjs`, это чистый мост к InWorld.

1. Скопировать `scripts/pilot-server.mjs` на сервер. В `.output` он не попадает, ему нужен только пакет `ws`.
2. Запустить его под pm2:
   `PILOT_PORT=8790 PILOT_ALLOWED_ORIGINS=https://eco-cub.ru INWORLD_API_KEY_BASE64=… node pilot-server.mjs`
3. Прописать в nginx:
   ```
   location /pilot-voice {
     proxy_pass http://127.0.0.1:8790;
     proxy_http_version 1.1;
     proxy_set_header Upgrade $http_upgrade;
     proxy_set_header Connection "upgrade";
     proxy_read_timeout 900s;
   }
   ```
4. Задать сайту `PILOT_VOICE_URL=wss://eco-cub.ru/pilot-voice` и перезапустить pm2 с перечитыванием env.

Пока этот шаг не сделан, всё остальное (текстовый чат, рендеры, заявки) работает, а кнопка голоса показывает «Голос включится, когда на сервере запустят голосовой релей».

## Локально

Выполнить `npm run pilot` и открыть http://localhost:8080/constructor. Ключи кладутся в `.env.pilot.local`.
