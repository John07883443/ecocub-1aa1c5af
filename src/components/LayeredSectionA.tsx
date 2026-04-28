import { useState } from "react";

type Layer = {
  id: string;
  num: string;
  title: string;
  desc: string;
};

const layers: Layer[] = [
  {
    id: "concrete",
    num: "01",
    title: "Бетон М400",
    desc: "Прочность на сжатие 400 кг/см². В 12 раз прочнее газоблока, без усадки.",
  },
  {
    id: "steel",
    num: "02",
    title: "Оцинкованная сталь",
    desc: "Несущий каркас, не подверженный коррозии. Срок службы более 120 лет.",
  },
  {
    id: "foam",
    num: "03",
    title: "Пенополистирол ПСБ-С35",
    desc: "100 мм. Сопротивление теплопередаче 4,1 (м²·°C)/Вт — выше нормы СНиП для Москвы.",
  },
];

/** Variant A — Specification list beside the image. */
export function LayeredSectionA() {
  const [active, setActive] = useState<string | null>(null);

  return (
    <div className="grid w-full gap-8 md:grid-cols-[1.1fr_1fr] md:gap-10">
      {/* Image — clean, no markers */}
      <div className="relative mx-auto aspect-square w-full max-w-[520px]">
        <img
          src="/images/wall-section-v10.png"
          alt="Послойный разрез монолитного модуля EcoCub: бетон М400, стальная арматура, ПСБ-С35"
          className="relative h-full w-full object-contain"
        />
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
