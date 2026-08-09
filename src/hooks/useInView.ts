import { useEffect, useRef, useState } from "react";

interface UseInViewOptions {
  /** Доля элемента, при которой он считается видимым (0..1). */
  threshold?: number;
  /** Отступы вокруг вьюпорта. По умолчанию срабатываем чуть раньше низа экрана. */
  rootMargin?: string;
  /** Показать один раз и больше не прятать (типичный сценарий reveal). */
  once?: boolean;
}

/**
 * Небольшой хук над IntersectionObserver.
 * Возвращает ref для элемента и флаг `inView`.
 * На сервере / без поддержки IO элемент сразу считается видимым,
 * чтобы контент никогда не «пропадал».
 */
export function useInView<T extends HTMLElement = HTMLDivElement>(options: UseInViewOptions = {}) {
  const { threshold = 0.15, rootMargin = "0px 0px -12% 0px", once = true } = options;
  const ref = useRef<T | null>(null);
  const [inView, setInView] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    if (typeof IntersectionObserver === "undefined") {
      setInView(true);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setInView(true);
            if (once) observer.unobserve(entry.target);
          } else if (!once) {
            setInView(false);
          }
        }
      },
      { threshold, rootMargin },
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, [threshold, rootMargin, once]);

  return { ref, inView };
}
