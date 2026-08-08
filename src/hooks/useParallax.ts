import { useEffect, useRef } from "react";

interface UseParallaxOptions {
  /**
   * Сила эффекта. Положительное значение сдвигает элемент против скролла
   * (создаёт «глубину»). Разумный диапазон 0.05–0.25.
   */
  speed?: number;
  /** Максимальное смещение в пикселях (страховка от больших сдвигов). */
  max?: number;
  /** Ось смещения. */
  axis?: "y" | "x";
}

const prefersReducedMotion = () =>
  typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/**
 * Плавный параллакс на requestAnimationFrame.
 * Смещает элемент относительно его позиции во вьюпорте.
 * Возвращает ref — повесьте его на элемент (обычно на картинку
 * внутри контейнера с overflow-hidden, чтобы не было сдвигов лэйаута).
 */
export function useParallax<T extends HTMLElement = HTMLDivElement>(
  options: UseParallaxOptions = {},
) {
  const { speed = 0.12, max = 60, axis = "y" } = options;
  const ref = useRef<T | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || prefersReducedMotion()) return;

    let raf = 0;

    const update = () => {
      raf = 0;
      const rect = el.getBoundingClientRect();
      const vh = window.innerHeight || document.documentElement.clientHeight;

      // Пропускаем расчёт, если элемент далеко за пределами экрана.
      if (rect.bottom < -vh || rect.top > vh * 2) return;

      const center = rect.top + rect.height / 2;
      const fromCenter = center - vh / 2;
      let offset = -fromCenter * speed;
      offset = Math.max(-max, Math.min(max, offset));

      el.style.transform =
        axis === "y"
          ? `translate3d(0, ${offset.toFixed(1)}px, 0)`
          : `translate3d(${offset.toFixed(1)}px, 0, 0)`;
    };

    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(update);
    };

    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll, { passive: true });

    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (raf) cancelAnimationFrame(raf);
      el.style.transform = "";
    };
  }, [speed, max, axis]);

  return ref;
}
