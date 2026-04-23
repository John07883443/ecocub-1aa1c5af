import { useState } from "react";

type Layer = {
  id: string;
  num: string;
  title: string;
  desc: string;
  x: number;
  y: number;
  /** Where the callout card sits */
  side: "left" | "right";
};

const layers: Layer[] = [
  {
    id: "steel",
    num: "01",
    title: "Оцинкованная сталь",
    desc: "Несущий каркас, срок службы 120+ лет.",
    x: 62,
    y: 22,
    side: "right",
  },
  {
    id: "concrete",
    num: "02",
    title: "Бетон М400",
    desc: "400 кг/см² — в 12 раз прочнее газоблока, без усадки.",
    x: 78,
    y: 55,
    side: "right",
  },
  {
    id: "foam",
    num: "03",
    title: "ПСБ-С35",
    desc: "R = 4,1 (м²·°C)/Вт — выше нормы СНиП для Москвы.",
    x: 36,
    y: 78,
    side: "left",
  },
];

/** Variant B — Image centered with callouts on the OUTSIDE of it, connected by leader lines. */
export function LayeredSectionB() {
  const [active, setActive] = useState<string | null>(null);

  return (
    <div className="relative mx-auto w-full max-w-[820px] px-[170px] sm:px-[200px]">
      <div className="relative aspect-square w-full">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-[8%] rounded-full bg-accent/10 blur-3xl"
        />
        <img
          src="/images/tech-section-clean.png"
          alt="Послойный разрез монолитного модуля EcoCub"
          className="relative h-full w-full object-contain"
        />

        {layers.map((l) => {
          const isActive = active === l.id;
          const isRight = l.side === "right";
          return (
            <div
              key={l.id}
              style={{ left: `${l.x}%`, top: `${l.y}%` }}
              className="absolute z-10 -translate-x-1/2 -translate-y-1/2"
            >
              {/* Marker */}
              <button
                type="button"
                onMouseEnter={() => setActive(l.id)}
                onMouseLeave={() => setActive(null)}
                onFocus={() => setActive(l.id)}
                onBlur={() => setActive(null)}
                aria-label={l.title}
                className="relative flex size-7 items-center justify-center rounded-full outline-none"
              >
                <span
                  aria-hidden
                  className="absolute inset-0 animate-ping rounded-full bg-accent/30 [animation-duration:2.4s]"
                />
                <span
                  className={`relative flex size-7 items-center justify-center rounded-full border text-[10px] font-bold transition-all duration-300 ${
                    isActive
                      ? "scale-110 border-accent bg-accent text-accent-foreground"
                      : "border-accent bg-primary text-accent"
                  }`}
                >
                  {l.num}
                </span>
              </button>

              {/* Leader line + callout card */}
              <div
                className={`pointer-events-none absolute top-1/2 hidden -translate-y-1/2 sm:flex sm:items-center ${
                  isRight ? "left-3" : "right-3 flex-row-reverse"
                }`}
              >
                <span
                  aria-hidden
                  className={`block h-px w-[110px] transition-colors duration-300 ${
                    isActive ? "bg-accent" : "bg-accent/50"
                  }`}
                />
                <div
                  className={`pointer-events-auto w-44 shrink-0 rounded-sm border bg-primary px-3 py-2 shadow-[0_8px_24px_-12px_rgba(0,0,0,0.7)] transition-colors duration-300 ${
                    isActive ? "border-accent" : "border-white/15"
                  }`}
                >
                  <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-accent">
                    {l.title}
                  </p>
                  <p className="mt-1 text-[11px] leading-snug text-white/80">
                    {l.desc}
                  </p>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Mobile legend */}
      <div className="mt-8 grid gap-2 sm:hidden">
        {layers.map((l) => (
          <div
            key={l.id}
            className="flex gap-3 rounded-sm border border-white/15 bg-primary px-3 py-2"
          >
            <span className="flex size-7 shrink-0 items-center justify-center rounded-full border border-accent text-[10px] font-bold text-accent">
              {l.num}
            </span>
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-accent">
                {l.title}
              </p>
              <p className="mt-0.5 text-[11px] leading-snug text-white/80">
                {l.desc}
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
