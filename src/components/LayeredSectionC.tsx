type Layer = {
  id: string;
  num: string;
  title: string;
  metric: string;
  metricLabel: string;
  desc: string;
  /** Visual: thickness + texture/color band */
  thickness: string;
  band: string;
};

const layers: Layer[] = [
  {
    id: "steel",
    num: "01",
    title: "Оцинкованная сталь",
    metric: "120+",
    metricLabel: "лет службы",
    desc: "Несущий каркас, не подверженный коррозии.",
    thickness: "h-12",
    band:
      "bg-[repeating-linear-gradient(90deg,oklch(0.78_0.02_240)_0_2px,oklch(0.65_0.02_240)_2px_8px)]",
  },
  {
    id: "concrete",
    num: "02",
    title: "Бетон М400",
    metric: "400",
    metricLabel: "кг/см² на сжатие",
    desc: "В 12 раз прочнее газоблока, без усадки.",
    thickness: "h-28",
    band:
      "bg-[radial-gradient(circle_at_20%_30%,oklch(0.55_0.01_240)_0_2px,transparent_3px),radial-gradient(circle_at_70%_60%,oklch(0.5_0.01_240)_0_2px,transparent_3px),linear-gradient(180deg,oklch(0.62_0.01_240),oklch(0.52_0.01_240))] [background-size:16px_16px,22px_22px,100%_100%]",
  },
  {
    id: "foam",
    num: "03",
    title: "Пенополистирол ПСБ-С35",
    metric: "4,1",
    metricLabel: "(м²·°C)/Вт",
    desc: "Утепление снаружи — без мостиков холода.",
    thickness: "h-20",
    band:
      "bg-[radial-gradient(circle_at_25%_30%,oklch(0.96_0.01_85)_0_4px,transparent_5px),radial-gradient(circle_at_60%_70%,oklch(0.94_0.01_85)_0_3px,transparent_4px),radial-gradient(circle_at_80%_25%,oklch(0.97_0.01_85)_0_3px,transparent_4px),linear-gradient(180deg,oklch(0.92_0.015_85),oklch(0.88_0.015_85))] [background-size:14px_14px,18px_18px,12px_12px,100%_100%]",
  },
];

/** Variant C — Vertical cross-section diagram. Material bands stacked, with specs alongside. */
export function LayeredSectionC() {
  return (
    <div className="grid w-full gap-6 md:grid-cols-[260px_1fr] md:gap-8">
      {/* Diagram column */}
      <div className="mx-auto w-full max-w-[260px]">
        <p className="mb-3 text-[10px] font-semibold uppercase tracking-[0.25em] text-accent">
          Разрез стены · снаружи внутрь
        </p>
        <div className="overflow-hidden rounded-sm border border-white/15">
          {layers
            .slice()
            .reverse()
            .map((l) => (
              <div
                key={l.id}
                className={`relative flex w-full ${l.thickness} items-center px-4 ${l.band}`}
              >
                <span className="flex size-7 items-center justify-center rounded-full bg-primary/85 text-[10px] font-bold text-accent backdrop-blur-sm">
                  {l.num}
                </span>
                <span className="ml-3 text-[10px] font-semibold uppercase tracking-[0.18em] text-primary/90 mix-blend-multiply">
                  {l.title.split(" ")[0]}
                </span>
              </div>
            ))}
        </div>
        <p className="mt-3 text-[10px] uppercase tracking-[0.2em] text-white/50">
          Толщина пропорциональна реальной
        </p>
      </div>

      {/* Specs column */}
      <ol className="flex flex-col justify-center divide-y divide-white/10">
        {layers.map((l) => (
          <li key={l.id} className="flex items-start gap-5 py-5 first:pt-0 last:pb-0">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-full border border-accent/60 text-xs font-bold text-accent">
              {l.num}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-accent">
                {l.title}
              </p>
              <p className="mt-1 text-sm leading-relaxed text-white/75">
                {l.desc}
              </p>
            </div>
            <div className="hidden shrink-0 text-right sm:block">
              <p className="text-2xl font-bold leading-none text-white">
                {l.metric}
              </p>
              <p className="mt-1 text-[10px] uppercase tracking-[0.15em] text-white/55">
                {l.metricLabel}
              </p>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
