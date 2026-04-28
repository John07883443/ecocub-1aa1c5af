import { useState } from "react";

type Layer = {
  id: string;
  num: string;
  title: string;
  desc: string;
  /** Marker position on the image, in % of container. Optional — omit to hide marker. */
  x?: number;
  y?: number;
};

const layers: Layer[] = [
  {
    id: "concrete",
    num: "01",
    title: "Бетон М400",
    desc: "Прочность на сжатие 400 кг/см². В 12 раз прочнее газоблока, без усадки.",
    x: 70,
    y: 62,
  },
  {
    id: "steel",
    num: "02",
    title: "Оцинкованная сталь",
    desc: "Несущий каркас, не подверженный коррозии. Срок службы более 120 лет.",
    x: 70,
    y: 18,
  },
  {
    id: "foam",
    num: "03",
    title: "Пенополистирол ПСБ-С35",
    desc: "100 мм. Сопротивление теплопередаче 4,1 (м²·°C)/Вт — выше нормы СНиП для Москвы.",
    x: 40,
    y: 62,
  },
];

/** Variant A — Specification list beside the image. */
export function LayeredSectionA() {
  const [active, setActive] = useState<string | null>(null);

  return (
    <div className="grid w-full gap-8 md:grid-cols-[1.1fr_1fr] md:gap-10">
      {/* Image with optional numbered markers */}
      <div className="relative mx-auto aspect-square w-full max-w-[520px]">
        <img
          src="/images/wall-section-v10.png"
          alt="Послойный разрез монолитного модуля EcoCub: бетон М400, стальная арматура, ПСБ-С35"
          className="relative h-full w-full object-contain"
        />

        {layers.map((l) => {
          if (l.x === undefined || l.y === undefined) return null;
          const isActive = active === l.id;
          return (
            <button
              key={l.id}
              type="button"
              onMouseEnter={() => setActive(l.id)}
              onMouseLeave={() => setActive(null)}
              onFocus={() => setActive(l.id)}
              onBlur={() => setActive(null)}
              style={{ left: `${l.x}%`, top: `${l.y}%` }}
              className="absolute z-10 flex size-8 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full outline-none"
              aria-label={l.title}
            >
              <span
                aria-hidden
                className="absolute inset-0 animate-ping rounded-full bg-accent/30 [animation-duration:2.4s]"
              />
              <span
                className={`relative flex size-8 items-center justify-center rounded-full border text-[11px] font-bold transition-all duration-300 ${
                  isActive
                    ? "scale-110 border-accent bg-accent text-accent-foreground"
                    : "border-accent/60 bg-primary/80 text-accent backdrop-blur-sm"
                }`}
              >
                {l.num}
              </span>
            </button>
          );
        })}
      </div>

      {/* Spec list */}
      <ol className="flex flex-col justify-center gap-1">
        {layers.map((l) => {
          const isActive = active === l.id;
          return (
            <li key={l.id}>
              <button
                type="button"
                onMouseEnter={() => setActive(l.id)}
                onMouseLeave={() => setActive(null)}
                onFocus={() => setActive(l.id)}
                onBlur={() => setActive(null)}
                className={`group flex w-full items-start gap-4 rounded-sm border p-4 text-left transition-all duration-300 ${
                  isActive
                    ? "border-accent/60 bg-white/[0.06]"
                    : "border-white/10 bg-transparent hover:border-white/25"
                }`}
              >
                <span
                  className={`flex size-9 shrink-0 items-center justify-center rounded-full border text-xs font-bold transition-colors duration-300 ${
                    isActive
                      ? "border-accent bg-accent text-accent-foreground"
                      : "border-accent/50 text-accent"
                  }`}
                >
                  {l.num}
                </span>
                <span className="block">
                  <span className="block text-[11px] font-semibold uppercase tracking-[0.2em] text-accent">
                    {l.title}
                  </span>
                  <span className="mt-2 block text-sm leading-relaxed text-white/75">
                    {l.desc}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
