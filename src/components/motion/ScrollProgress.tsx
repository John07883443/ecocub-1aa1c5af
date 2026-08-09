import { useEffect, useRef } from "react";

/**
 * Тонкая полоса прогресса чтения вверху страницы.
 * Обновляется на requestAnimationFrame через CSS-переменную,
 * без перерисовок React.
 */
export function ScrollProgress() {
  const barRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let raf = 0;

    const update = () => {
      raf = 0;
      const el = barRef.current;
      if (!el) return;
      const doc = document.documentElement;
      const max = doc.scrollHeight - window.innerHeight;
      const progress = max > 0 ? Math.min(1, Math.max(0, window.scrollY / max)) : 0;
      el.style.setProperty("--scroll-progress", progress.toFixed(4));
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
    };
  }, []);

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none fixed inset-x-0 top-0 z-50 h-[3px] bg-transparent"
    >
      <div
        ref={barRef}
        className="scroll-progress h-full w-full bg-gradient-to-r from-accent via-accent to-accent/40 shadow-[0_0_12px_color-mix(in_oklab,var(--accent)_60%,transparent)]"
      />
    </div>
  );
}
