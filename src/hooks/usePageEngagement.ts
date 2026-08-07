import { useEffect, useRef } from "react";
import { analytics } from "@/lib/analytics";

/**
 * Замеряет вовлечённость на странице: глубину прокрутки и время активного
 * чтения. Каждый порог отправляется один раз за посещение страницы.
 *
 * Время считается только когда вкладка активна — иначе открытые в фоне
 * страницы давали бы фальшивые «3 минуты чтения».
 */
export function usePageEngagement(page: string) {
  const firedScroll = useRef<Set<number>>(new Set());
  const firedTime = useRef<Set<number>>(new Set());
  const activeMs = useRef(0);

  useEffect(() => {
    firedScroll.current = new Set();
    firedTime.current = new Set();
    activeMs.current = 0;

    const onScroll = () => {
      const doc = document.documentElement;
      const scrollable = doc.scrollHeight - window.innerHeight;
      if (scrollable <= 0) return;
      const pct = Math.round((window.scrollY / scrollable) * 100);
      for (const threshold of [25, 50, 75, 100] as const) {
        if (pct >= threshold && !firedScroll.current.has(threshold)) {
          firedScroll.current.add(threshold);
          analytics.scrollDepth(threshold, page);
        }
      }
    };

    const tick = () => {
      if (document.visibilityState !== "visible") return;
      activeMs.current += 1000;
      const sec = Math.floor(activeMs.current / 1000);
      for (const threshold of [30, 60, 180] as const) {
        if (sec >= threshold && !firedTime.current.has(threshold)) {
          firedTime.current.add(threshold);
          analytics.engagedTime(threshold, page);
        }
      }
    };

    window.addEventListener("scroll", onScroll, { passive: true });
    const timer = window.setInterval(tick, 1000);
    onScroll();

    return () => {
      window.removeEventListener("scroll", onScroll);
      window.clearInterval(timer);
    };
  }, [page]);
}

/**
 * Отмечает момент, когда блок реально показался пользователю.
 * Используется для «дошёл до цен», «увидел шоу-рум» и подобного.
 */
export function useSectionSeen(ref: React.RefObject<HTMLElement | null>, onSeen: () => void) {
  const fired = useRef(false);

  useEffect(() => {
    const el = ref.current;
    if (!el || fired.current || typeof IntersectionObserver === "undefined") return;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting && !fired.current) {
            fired.current = true;
            onSeen();
            observer.disconnect();
          }
        }
      },
      { threshold: 0.4 },
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, [ref, onSeen]);
}
