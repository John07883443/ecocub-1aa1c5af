/**
 * Регрессионная проверка: шапка не дрожит при прокрутке.
 *
 * История дефекта. Светлая шапка была `position: sticky`, то есть занимала
 * место в потоке документа. В компактном режиме её высота уезжала со 113
 * до 81 px, документ на столько же укорачивался, и браузер включал привязку
 * прокрутки (overflow-anchor): вычитал из window.scrollY ровно столько, на
 * сколько ужалась шапка. Около порога это давало автоколебание — scrollY
 * проваливался ниже порога, компактный режим снимался, шапка росла назад,
 * scrollY возвращался выше порога, и цикл повторялся. Логотип и меню
 * прыгали между двумя положениями.
 *
 * Тест ловит именно первопричину, а не внешний симптом:
 *  1. высота документа не зависит от режима шапки;
 *  2. один «толчок» прокрутки не порождает самоподдерживающихся колебаний;
 *  3. header.top остаётся стабильным (допуск 0,5 CSS px);
 *  4. многократный проход через порог не переключает режим лишний раз.
 *
 * Playwright в зависимостях проекта намеренно нет: его postinstall тянет
 * ~150 МБ браузеров на каждую установку, а деплой собирается в CI. Запуск:
 *
 *     npm run dev
 *     npx --yes playwright@1.56.0 --version   # один раз, поставит пакет
 *     npm run test:header
 *
 * Переменные: BASE (по умолчанию http://127.0.0.1:8080),
 * CHROME (путь к браузеру, если он не там, где ждёт Playwright).
 */

import { chromium } from "playwright";

const BASE = process.env.BASE || "http://127.0.0.1:8080";
const PAGES = ["/constructor-ai-v3", "/constructor-ai-v3-1", "/", "/portfolio"];
// dsf ≠ 1 воспроизводит масштаб браузера: высота шапки перестаёт быть целым
// числом устройственных пикселей, и любая обратная связь по геометрии всплыла
// бы именно здесь.
const VIEWPORTS = [
  { width: 1440, height: 900, name: "desktop 1440×900" },
  { width: 1366, height: 768, name: "desktop 1366×768" },
  { width: 1920, height: 1080, name: "desktop 1920×1080" },
  { width: 1600, height: 1000, dsf: 0.9, name: "desktop 1440×900, масштаб 90%" },
  { width: 1309, height: 818, dsf: 1.1, name: "desktop 1440×900, масштаб 110%" },
  { width: 390, height: 844, name: "mobile 390×844" },
];

const launchOptions = process.env.CHROME ? { executablePath: process.env.CHROME } : {};
const browser = await chromium.launch(launchOptions);

const failures = [];
const check = (ok, message) => {
  console.log(`${ok ? "  ok  " : "  FAIL"} ${message}`);
  if (!ok) failures.push(message);
};

for (const path of PAGES) {
  for (const viewport of VIEWPORTS) {
    const ctx = await browser.newContext({
      viewport: { width: viewport.width, height: viewport.height },
      deviceScaleFactor: viewport.dsf ?? 1,
    });
    const page = await ctx.newPage();
    await page.goto(BASE + path, { waitUntil: "networkidle" });
    await page.waitForTimeout(800);

    console.log(`\n${path} — ${viewport.name}`);

    // 1. Единичный толчок к порогу и 2 секунды наблюдения без прокрутки.
    //    Устойчивая шапка обязана прийти в одно положение и остаться в нём.
    const settle = await page.evaluate(async () => {
      const header = document.querySelector("header");
      const html = document.documentElement;
      const prev = html.style.scrollBehavior;
      html.style.scrollBehavior = "auto"; // smooth-scroll не должен мешать замеру
      window.scrollTo(0, 30);
      html.style.scrollBehavior = prev;

      const frames = [];
      const t0 = performance.now();
      await new Promise((done) => {
        const tick = () => {
          const r = header.getBoundingClientRect();
          frames.push({
            y: window.scrollY,
            top: +r.top.toFixed(2),
            h: +r.height.toFixed(2),
            docH: html.scrollHeight,
          });
          if (performance.now() - t0 < 2000) requestAnimationFrame(tick);
          else done();
        };
        requestAnimationFrame(tick);
      });

      let reversals = 0;
      for (let i = 2; i < frames.length; i++) {
        const a = Math.sign(frames[i].h - frames[i - 1].h);
        const b = Math.sign(frames[i - 1].h - frames[i - 2].h);
        if (a !== 0 && b !== 0 && a !== b) reversals++;
      }
      return {
        reversals,
        scrollYSpread: Math.max(...frames.map((f) => f.y)) - Math.min(...frames.map((f) => f.y)),
        docHValues: [...new Set(frames.map((f) => f.docH))].length,
        topSpread: +(
          Math.max(...frames.map((f) => f.top)) - Math.min(...frames.map((f) => f.top))
        ).toFixed(2),
      };
    });

    check(
      settle.reversals === 0,
      `нет автоколебаний высоты после одного толчка (смен направления: ${settle.reversals})`,
    );
    check(
      settle.scrollYSpread === 0,
      `scrollY не меняется сам по себе (разброс: ${settle.scrollYSpread} px)`,
    );
    check(
      settle.docHValues === 1,
      `высота документа не зависит от режима шапки (значений: ${settle.docHValues})`,
    );
    check(settle.topSpread <= 0.5, `header.top стабилен (разброс: ${settle.topSpread} px)`);

    // 2. Двадцать проходов через порог: режим обязан переключаться ровно
    //    по одному разу на пересечение, без циклов на соседних кадрах.
    const cycling = await page.evaluate(async () => {
      const header = document.querySelector("header");
      const html = document.documentElement;
      let classChanges = 0;
      const observer = new MutationObserver((m) => (classChanges += m.length));
      observer.observe(header, { attributes: true, attributeFilter: ["class", "style"] });

      const prev = html.style.scrollBehavior;
      html.style.scrollBehavior = "auto";
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      const docHeights = new Set();
      const tops = new Set();
      for (let pass = 0; pass < 20; pass++) {
        for (const y of [0, 8, 16, 24, 32, 48, 64, 48, 32, 24, 16, 8]) {
          window.scrollTo(0, y);
          await sleep(16);
          docHeights.add(html.scrollHeight);
          tops.add(+header.getBoundingClientRect().top.toFixed(2));
        }
      }
      html.style.scrollBehavior = prev;
      await sleep(600);
      observer.disconnect();
      return { classChanges, docHeights: docHeights.size, tops: [...tops] };
    });

    // 20 проходов × 2 пересечения порога = 40 смен режима — это потолок.
    check(
      cycling.classChanges <= 60,
      `нет циклического переключения классов на 20 проходах (изменений атрибутов: ${cycling.classChanges})`,
    );
    check(
      cycling.docHeights === 1,
      `высота документа постоянна на всех проходах (значений: ${cycling.docHeights})`,
    );
    check(
      cycling.tops.every((t) => Math.abs(t) <= 0.5),
      `header.top держится у нуля на всех проходах (значения: ${cycling.tops.join(", ")})`,
    );

    await ctx.close();
  }
}

await browser.close();

console.log(
  failures.length
    ? `\nПРОВАЛЕНО: ${failures.length}\n` + failures.map((f) => ` - ${f}`).join("\n")
    : "\nВсе проверки стабильности шапки пройдены.",
);
process.exit(failures.length ? 1 : 0);
