## Что делаем

Заменить альтернативный hover-эффект (3D-вращение + свечение) на плавную "дыхательную" левитацию **только куба** — надпись ECO CUB остаётся неподвижной. Эффект работает постоянно (не только на hover) — спокойный, бесконечный, ~3.5с цикл.

## Зачем

Цельный `<img src=".svg">` нельзя анимировать по частям. Поэтому переводим логотип на inline-SVG React-компонент, где куб и текст — отдельные `<g>`-группы, и анимируем только группу куба через `transform: translateY` с keyframes.

## Реализация

### 1) Новый компонент `src/components/LogoMark.tsx`

Inline-SVG логотипа с двумя группами:
- `<g class="ecocub-logo-cube">` — три полигона куба (две тёмные/белые грани + бежевый фронтальный ромб).
- `<g>` — буквы ECO CUB и фирменная бежевая точка-квадрат (без анимации).

Цвет переключается через проп `variant: "light" | "dark"` (передаём `ink` и `accent` как `fill` напрямую — SVG-классы из исходника не нужны). Поддерживается `motion-reduce` (отключение анимации).

### 2) Keyframes в `src/styles.css`

Добавить:

```css
@keyframes ecocub-cube-breathe {
  0%, 100% { transform: translateY(0); }
  50%      { transform: translateY(-14px); }
}

.ecocub-logo-cube {
  transform-origin: center;
  transform-box: fill-box;
  animation: ecocub-cube-breathe 3.6s ease-in-out infinite;
  will-change: transform;
}

@media (prefers-reduced-motion: reduce) {
  .ecocub-logo-cube { animation: none; }
}
```

Амплитуда `-14px` указана в координатах `viewBox` (850×850), что при отображении на ~64–72px высоты даёт смещение ~1px — деликатное "дыхание", без скачков.

### 3) `src/components/Header.tsx`

- Удалить импорты `logoBlack` / `logoWhite`.
- Заменить `<img>` в десктопной шапке на `<LogoMark variant={isDark ? "dark" : "light"} className="h-16 w-auto md:h-18" />`.
- Убрать остатки прошлого hover-эффекта (`[perspective]`, `group-hover:[transform]`, `drop-shadow` на изображении).
- В мобильном `Sheet`-меню тоже заменить `<img src={logoBlack}>` на `<LogoMark variant="light" className="h-8 w-auto" />` для консистентности.

## Затронутые файлы

- `src/components/LogoMark.tsx` — новый.
- `src/components/Header.tsx` — заменить разметку логотипа в двух местах, убрать импорты SVG.
- `src/styles.css` — добавить keyframes и класс `.ecocub-logo-cube`.

Старые файлы `src/assets/logo-white.svg` и `src/assets/logo-black.svg` оставляем как есть — могут пригодиться для og:image / favicon.
