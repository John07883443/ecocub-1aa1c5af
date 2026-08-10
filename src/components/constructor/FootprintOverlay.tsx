import { FOOTPRINT_IMAGE_SIZE, projectFootprint, type Footprint } from "@/lib/ai-layout/footprint";

/**
 * Точный контур дома поверх сгенерированной картинки.
 *
 * Зачем это вообще нужно. Проверка десяти моделей показала: половина из них
 * контур не удерживает — достраивают вырезы до прямоугольника, сдвигают
 * границы, дорисовывают выступы. Даже выбранная модель может однажды
 * промахнуться. Источник истины — геометрия конструктора, а не картинка,
 * поэтому поверх результата всегда ложится настоящий контур:
 *
 * 1. Всё, что снаружи контура, закрашивается фоном. Если модель вышла за
 *    границы, наружу это не попадёт.
 * 2. Сам контур обводится линией — видно, где на самом деле стены.
 *
 * Геометрия совпадает с исходником по построению: и серверный рендер, и этот
 * оверлей используют одну функцию projectFootprint.
 */
export function FootprintOverlay({ footprint }: { footprint: Footprint }) {
  if (!footprint.modules.length) return null;

  const size = FOOTPRINT_IMAGE_SIZE;
  const { scale, offsetX, offsetZ } = projectFootprint(footprint, size);
  const px = (mx: number) => offsetX + mx * scale;
  const pz = (mz: number) => offsetZ + mz * scale;

  // Маска «всё, кроме дома». Внешний прямоугольник плюс прямоугольники
  // модулей с правилом evenodd: точка внутри модуля пересекает контур дважды
  // и остаётся незакрашенной, снаружи — один раз и закрашивается. Собирать
  // из отрезков замкнутый многоугольник не нужно, а модули не перекрываются.
  const mask = [
    `M0 0 H${size} V${size} H0 Z`,
    ...footprint.modules.map((m) => {
      const s = m.side * scale;
      return `M${px(m.x)} ${pz(m.z)} h${s} v${s} h${-s} Z`;
    }),
  ].join(" ");

  const outline = footprint.walls
    .map((w) => `M${px(w.x1)} ${pz(w.z1)} L${px(w.x2)} ${pz(w.z2)}`)
    .join(" ");

  return (
    <svg
      viewBox={`0 0 ${size} ${size}`}
      className="pointer-events-none absolute inset-0 h-full w-full"
      aria-hidden="true"
    >
      <path d={mask} fillRule="evenodd" className="fill-card" />
      <path
        d={outline}
        className="stroke-foreground"
        strokeWidth={Math.max(3, scale * 0.1)}
        strokeLinecap="square"
        fill="none"
      />
    </svg>
  );
}
