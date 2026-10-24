# QA конструктора (scripts/qa)

Автоматический тестировщик `/constructor`: Playwright пишет Льву текстом по сценариям,
GPT-6 Astra судит каждый шаг («сказал = сделал?»), зрячая модель сравнивает итоговые
дома и рендеры с каталогом eco-cub.ru. Код приложения не трогает.

| Файл | Что делает |
|---|---|
| `scenarios.ts` | 3 потока, ~30 шагов: интервью, A/B/C, правки окон/фасада/этажей, «что если», рендеры; эталоны каталога |
| `constructor-e2e.ts` | Прогон в Chromium headless → `out/<run>/records.json`, `shots/`, `final/`, `references/` |
| `house.ts` | Сводка дома из JSON проекта движком сайта: кубики, комнаты, окна по фасадам, отделка, бюджет, жёсткие нарушения |
| `judge.ts` | Судья через rgrouter (Astra по тексту, Gemini 3.8 Flash / Sonnet 5 по картинкам) → `judged.json` + отчёт markdown |
| `judge-on-vps.sh` | Заливает прогон на VPS, где лежит ключ, судит там и забирает отчёт |

Дом читается из `window.__pilotState.house` (при `?qa=1`, ветка voice-edit), иначе — из
состояния React компонента пилота. Вызовы инструментов — строки «⚙ …» в чате и
`__pilotState.lastToolCalls`, если есть.

## Запуск

```bash
cd scripts/qa
npm i && npx playwright install chromium
node --experimental-strip-types constructor-e2e.ts                # прод
QA_URL=http://localhost:8080/constructor node --experimental-strip-types constructor-e2e.ts
# переменные: QA_FLOWS=family,edge  QA_NO_RENDERS=1 (рендеры ~12 ₽ за поток)  QA_RUN=<имя>
bash judge-on-vps.sh out/<run> ../../docs/QA_CONSTRUCTOR_<дата>.md
# повтор только упавших оценок: QA_REUSE_JUDGED=1 bash judge-on-vps.sh …
```

На машине с `RGROUTER_API_KEY` в окружении судью можно запустить и локально:
`node --experimental-strip-types judge.ts out/<run> report.md`.
