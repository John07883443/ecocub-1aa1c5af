## Что меняем

В `src/components/Header.tsx` (строки 28–34) добавить интерактивную 3D-анимацию логотипу EcoCub.

### Поведение

- **При наведении** — куб плавно поворачивается на 360° вокруг вертикальной оси Y (полный оборот за 700 мс, easing `ease-out`), одновременно появляется мягкое свечение акцентным цветом (warm beige) под логотипом через `drop-shadow`.
- **3D-эффект** — родительский `<Link>` получает `perspective: 800px`, изображение — `transform-style: preserve-3d` для объёмности вращения.
- **Доступность** — для пользователей с включённой настройкой "уменьшить движение" (`prefers-reduced-motion`) анимация и transform отключаются (`motion-reduce`).

### Технические детали

Заменить разметку логотипа на:

```tsx
<Link to="/" className="group flex items-center gap-2 [perspective:800px]">
  <img
    src={isDark ? logoWhite : logoBlack}
    alt="EcoCub"
    className="h-16 w-auto md:h-18 origin-center transition-all duration-700 ease-out [transform-style:preserve-3d] group-hover:[transform:rotateY(360deg)] group-hover:[filter:drop-shadow(0_0_14px_color-mix(in_oklab,var(--accent)_55%,transparent))] motion-reduce:transition-none motion-reduce:group-hover:[transform:none] motion-reduce:group-hover:[filter:none]"
  />
</Link>
```

Свечение реализовано через `color-mix(in oklab, var(--accent) 55%, transparent)`, потому что accent в проекте задан в `oklch` (а не HSL) — это корректный способ применить токен в `drop-shadow`.

## Затронутые файлы

- `src/components/Header.tsx` — только разметка логотипа в десктопной шапке (мобильное меню `Sheet` не трогаем, чтобы не отвлекать при открытом меню).

Никаких новых ассетов, зависимостей или изменений в `styles.css` не требуется — всё через arbitrary-классы Tailwind.
