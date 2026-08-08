import { useEffect, useRef, useState } from "react";

type Layer = {
  id: string;
  title: string;
  desc: string;
  /** Position of the dot on the image, in % of container */
  x: number;
  y: number;
  /** Side where the label sits relative to the dot */
  side: "left" | "right";
};

const layers: Layer[] = [
  {
    id: "steel",
    title: "Оцинкованная сталь",
    desc: "Несущий каркас, не подверженный коррозии. Срок службы более 120 лет.",
    x: 62,
    y: 22,
    side: "right",
  },
  {
    id: "concrete",
    title: "Бетон М400",
    desc: "Прочность на сжатие 400 кг/см². В 12 раз прочнее газоблока, без усадки.",
    x: 78,
    y: 55,
    side: "right",
  },
  {
    id: "foam",
    title: "Пенополистирол ПСБ-С35",
    desc: "Сопротивление теплопередаче 4,1 (м²·°C)/Вт — выше нормы СНиП для Москвы.",
    x: 36,
    y: 78,
    side: "left",
  },
];

export function LayeredSection() {
  const [active, setActive] = useState<string | null>(null);
  const legendRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  // На мобильных карточка-подпись у точки скрыта, поэтому по тапу подсвечиваем
  // и подкручиваем к соответствующему пункту легенды под картинкой.
  useEffect(() => {
    if (!active) return;
    legendRefs.current[active]?.scrollIntoView({
      behavior: "smooth",
      block: "nearest",
    });
  }, [active]);

  return (
    <div className="w-full">
      <div className="relative mx-auto aspect-square w-full max-w-[640px]">
        {/* Рендер сразу на тёмном фоне #121212 (= bg-primary секции), поэтому
            сливается бесшовно и ничего не вырезается по краям. */}
        <img
          src="/images/tech-section-dark.webp"
          alt="Послойный разрез монолитного модуля EcoCub: бетон М400, оцинкованная сталь, ПСБ-С35"
          className="h-full w-full object-contain"
        />

        {/* Hotspots */}
        {layers.map((l) => {
          const isActive = active === l.id;
          return (
            <button
              key={l.id}
              type="button"
              onMouseEnter={() => setActive(l.id)}
              onMouseLeave={() =>
                setActive((prev) => (prev === l.id ? null : prev))
              }
              onFocus={() => setActive(l.id)}
              onBlur={() =>
                setActive((prev) => (prev === l.id ? null : prev))
              }
              onClick={() => setActive(isActive ? null : l.id)}
              style={{ left: `${l.x}%`, top: `${l.y}%` }}
              className="group absolute z-10 -translate-x-1/2 -translate-y-1/2 outline-none"
              aria-label={l.title}
            >
              {/* Pulsing ring */}
              <span
                aria-hidden
                className="absolute inset-0 -m-2 animate-ping rounded-full bg-accent/40 [animation-duration:2.4s]"
              />
              {/* Dot */}
              <span
                className={`relative block size-3 rounded-full border-2 border-accent bg-background transition-all duration-300 group-hover:scale-125 group-focus-visible:scale-125 ${
                  isActive ? "scale-125 bg-accent" : ""
                }`}
              />

              {/* Label card (desktop only) */}
              <span
                className={`pointer-events-none absolute top-1/2 hidden w-64 -translate-y-1/2 sm:block ${
                  l.side === "right" ? "left-6" : "right-6"
                }`}
              >
                {/* Connector line */}
                <span
                  aria-hidden
                  className={`absolute top-1/2 h-px w-5 -translate-y-1/2 transition-all duration-300 ${
                    l.side === "right" ? "-left-5" : "-right-5"
                  } ${isActive ? "bg-accent" : "bg-accent/60"}`}
                />
                <span
                  className={`block rounded-sm border px-4 py-3 text-left backdrop-blur-sm transition-all duration-300 ${
                    isActive
                      ? "border-accent/60 bg-primary/80 shadow-[0_8px_30px_-10px_rgba(0,0,0,0.6)]"
                      : "border-white/15 bg-white/5"
                  }`}
                >
                  <span className="block text-[11px] font-semibold uppercase tracking-[0.2em] text-accent">
                    {l.title}
                  </span>
                  <span
                    className={`mt-2 block text-xs leading-relaxed transition-all duration-300 ${
                      isActive ? "text-white/90" : "text-white/70"
                    }`}
                  >
                    {l.desc}
                  </span>
                </span>
              </span>
            </button>
          );
        })}
      </div>

      {/* Mobile legend (below image) — синхронизирована с точками по тапу */}
      <div className="mt-8 grid gap-3 sm:hidden">
        {layers.map((l) => {
          const isActive = active === l.id;
          return (
            <button
              key={l.id}
              type="button"
              ref={(el) => {
                legendRefs.current[l.id] = el;
              }}
              onClick={() => setActive(isActive ? null : l.id)}
              aria-pressed={isActive}
              className={`rounded-sm border px-4 py-3 text-left transition-colors duration-300 ${
                isActive
                  ? "border-accent/60 bg-accent/10"
                  : "border-white/15 bg-white/5"
              }`}
            >
              <p className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.2em] text-accent">
                <span
                  className={`inline-block size-2 rounded-full bg-accent transition-transform duration-300 ${
                    isActive ? "scale-150" : ""
                  }`}
                />
                {l.title}
              </p>
              <p
                className={`mt-1.5 text-xs leading-relaxed transition-colors duration-300 ${
                  isActive ? "text-white/90" : "text-white/70"
                }`}
              >
                {l.desc}
              </p>
            </button>
          );
        })}
      </div>
    </div>
  );
}
