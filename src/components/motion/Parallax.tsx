import { cn } from "@/lib/utils";
import { useParallax } from "@/hooks/useParallax";

interface ParallaxProps extends React.HTMLAttributes<HTMLDivElement> {
  speed?: number;
  max?: number;
  axis?: "y" | "x";
}

/**
 * Обёртка для параллакс-смещения содержимого при скролле.
 * Обычно кладут внутрь контейнера с overflow-hidden.
 */
export function Parallax({ speed, max, axis, className, children, ...props }: ParallaxProps) {
  const ref = useParallax<HTMLDivElement>({ speed, max, axis });

  return (
    <div ref={ref} data-parallax className={cn(className)} {...props}>
      {children}
    </div>
  );
}
