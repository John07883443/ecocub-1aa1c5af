import { cn } from "@/lib/utils";
import { useInView } from "@/hooks/useInView";

export type RevealVariant = "up" | "down" | "left" | "right" | "fade" | "scale" | "blur";

interface RevealProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Направление/характер появления. */
  variant?: RevealVariant;
  /** Задержка в мс — удобно для «шахматного» появления списков. */
  delay?: number;
  /** Порог видимости (0..1). */
  threshold?: number;
  /** Появиться один раз (по умолчанию) или каждый раз при входе в кадр. */
  once?: boolean;
}

/**
 * Универсальная обёртка «появление при скролле».
 * Работает как progressive enhancement: без JS и при
 * prefers-reduced-motion контент виден сразу (см. styles.css).
 */
export function Reveal({
  variant = "up",
  delay = 0,
  threshold,
  once,
  className,
  style,
  children,
  ...props
}: RevealProps) {
  const { ref, inView } = useInView({ threshold, once });

  return (
    <div
      ref={ref}
      data-reveal={variant}
      className={cn(inView && "is-visible", className)}
      style={delay ? ({ "--reveal-delay": `${delay}ms`, ...style } as React.CSSProperties) : style}
      {...props}
    >
      {children}
    </div>
  );
}
